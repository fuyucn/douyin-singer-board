package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/sususongboard/nsgo-app/listener"
	"github.com/sususongboard/nsgo-app/queue"
)

type rules struct {
	Room     string `json:"room"`
	Template string `json:"template"`
	Fans     int    `json:"fans"`
	Cooldown int    `json:"cooldown"`
	Repeat   int    `json:"repeat"`
	Limit    int    `json:"limit"`
}

type blacklistEntry struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Artist    string `json:"artist,omitempty"`
	CreatedAt int64  `json:"createdAt,omitempty"`
}

type blacklistRow struct {
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	Artist  string `json:"artist,omitempty"`
	AddedAt string `json:"addedAt,omitempty"`
}

type boardSettings struct {
	Rules       rules                      `json:"rules"`
	Blacklist   []blacklistEntry           `json:"blacklist"`
	Platform    string                     `json:"platform"`
	Targets     map[string]playlistBinding `json:"targets"`
	Unconfirmed map[string]string          `json:"unconfirmed,omitempty"`
	ShowLogs    bool                       `json:"showLogs,omitempty"`
}

type songView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	User      string `json:"user"`
	Time      string `json:"time"`
	Detail    string `json:"detail"`
	Uncertain bool   `json:"uncertain"`
	Raw       string `json:"raw"`
	Artist    string `json:"artist"`
	Matched   string `json:"matched"`
	Match     string `json:"match"`
	CanAdd    bool   `json:"canAdd"`
	Quota     string `json:"quota"`
}

type playedSong struct {
	Song     queue.Song
	Track    track
	Platform string
	At       time.Time
}

type pendingPlaylistAdd struct {
	songID string
	key    string
}

type boardState struct {
	scope                    *core.Scope
	host                     *core.Host
	ctx                      context.Context
	settings                 boardSettings
	matcher                  *queue.Matcher
	notice                   string
	noticeID                 uint64
	connection               string
	frames                   int
	logs                     []string
	listenerCancel           context.CancelFunc
	listenerGeneration       uint64
	played                   []playedSong
	accepted                 []playedSong
	uncertain                map[string]bool
	searchFailed             map[string]bool
	matches                  map[string]songMatch
	matchCancel              context.CancelFunc
	matchContext             context.Context
	matchGeneration          uint64
	matchWorkers             int
	matchSlots               chan struct{}
	matchRetries             map[string]func() bool
	syncAfterResolve         bool
	services                 platformServices
	account                  session
	playlists                []playlist
	results                  []track
	qrKey, qrImage, qrStatus string
	qrUntil                  time.Time
	qrBusy                   bool
	qrTimer                  func() bool
	busy                     bool
	pendingAdd               pendingPlaylistAdd
	verified                 bool
	auto                     bool
	autoTimer                func() bool
	platformCancel           context.CancelFunc
	platformGeneration       uint64
	settingsInvalid          bool
	updatesEnabled           bool
	writeSettings            func([]byte) error
}

func newBoard(scope *core.Scope, services platformServices) *boardState {
	board := &boardState{scope: scope, host: core.NewHost(), ctx: scope.Context(), services: services,
		connection: "未连接", uncertain: map[string]bool{}, searchFailed: map[string]bool{}, matches: map[string]songMatch{}, matchSlots: make(chan struct{}, 2), matchRetries: map[string]func() bool{}}
	defaults := boardSettings{Rules: rules{Template: queue.DefaultTemplate, Repeat: 1800, Limit: 3}, Targets: map[string]playlistBinding{}}
	settings, save, err := openBoardPreferences(scope, defaults)
	board.settings, board.writeSettings = settings, save
	if err != nil {
		board.settingsInvalid = true
		board.notify("无法打开 SQLite 设置，已禁止保存和平台写入")
	}
	board.matcher, _ = queue.New(matcherConfig(board.settings))
	scope.Cleanup(func() { board.cancelListener(); board.cancelPlatform() })
	return board
}

func matcherConfig(settings boardSettings) queue.Config {
	config := queue.Config{Template: settings.Rules.Template, FansLevel: settings.Rules.Fans}
	for _, entry := range settings.Blacklist {
		if entry.Kind == "song" {
			config.BlacklistSongs = append(config.BlacklistSongs, entry.Name)
		}
		if entry.Kind == "singer" {
			config.BlacklistSingers = append(config.BlacklistSingers, entry.Name)
		}
	}
	return config
}

func (board *boardState) save(settings boardSettings) bool {
	if board.settingsInvalid {
		board.notify("无法读取 SQLite 设置，已阻止覆盖；请先备份并修复配置")
		return false
	}
	previous := board.matcher.Config()
	if err := board.matcher.Reconfigure(matcherConfig(settings)); err != nil {
		board.notify("点歌模板无效：" + err.Error())
		return false
	}
	encoded, err := json.Marshal(settings)
	if err != nil || board.writeSettings(encoded) != nil {
		_ = board.matcher.Reconfigure(previous)
		board.notify("无法保存设置，请重试")
		return false
	}
	board.settings = settings
	return true
}

func viewSong(song queue.Song, at time.Time, detail string, uncertain bool) songView {
	return songView{ID: song.ID, Name: song.Name, User: song.Nickname, Time: at.Local().Format("15:04:05"), Detail: detail, Uncertain: uncertain, Raw: song.RawMessage}
}

func (board *boardState) successCount(userID string) int {
	if userID == "" || userID == "manual" || isAnonymousUserID(userID) {
		return 0
	}
	count := 0
	for _, accepted := range board.accepted {
		if accepted.Song.UserID == userID {
			count++
		}
	}
	return count
}

func (board *boardState) snapshot() map[string]any {
	songs, played := []songView{}, []songView{}
	target := board.target()
	for _, song := range board.matcher.Queue() {
		detail := ""
		if board.pendingAdd.songID == song.ID {
			detail = "正在加入歌单…"
		} else if board.uncertain[song.ID] {
			detail = "加入结果未知，请检查平台歌单"
		} else if board.searchFailed[song.ID] {
			detail = "自动匹配未完成，可手动搜索"
		}
		view := viewSong(song, song.CreatedAt, detail, board.uncertain[song.ID])
		entry := board.matches[strings.TrimSpace(song.Name)]
		view.Match, view.Artist, view.Matched = entry.Status, entry.Track.Artist, entry.Track.Name
		if view.Detail == "" {
			switch entry.Status {
			case "pending":
				view.Detail = "正在匹配…"
			case "found":
				view.Detail = entry.Track.Name + " · " + entry.Track.Artist
				if board.blocked(song, entry.Track) {
					view.Detail = "黑名单跳过：" + view.Detail
				}
			case "not_found", "error":
				view.Detail = "未找到匹配，可手动搜索"
			}
		}
		if entry.Status == "found" && !board.blocked(song, entry.Track) && !view.Uncertain && target.ID > 0 {
			key := writeKey(board.settings.Platform, board.account.User, target.ID, entry.Track.identity())
			view.CanAdd = key == board.pendingAdd.key || board.settings.Unconfirmed[key] == ""
		}
		if !song.Manual && !isAnonymousUserID(song.UserID) && board.settings.Rules.Limit > 0 {
			view.Quota = fmt.Sprintf("%d/%d", board.successCount(song.UserID), board.settings.Rules.Limit)
		}
		songs = append(songs, view)
	}
	for _, song := range board.played {
		view := viewSong(song.Song, song.At, song.Track.Name+" · "+song.Track.Artist, false)
		view.Artist, view.Matched = song.Track.Artist, song.Track.Name
		played = append(played, view)
	}
	locks := []map[string]string{}
	for key, name := range board.settings.Unconfirmed {
		if key != board.pendingAdd.key && board.currentWriteKey(key) {
			locks = append(locks, map[string]string{"key": key, "name": name})
		}
	}
	blacklist := make([]blacklistRow, 0, len(board.settings.Blacklist))
	for _, entry := range board.settings.Blacklist {
		row := blacklistRow{Kind: entry.Kind, Name: entry.Name, Artist: entry.Artist}
		if entry.CreatedAt > 0 {
			row.AddedAt = time.Unix(entry.CreatedAt, 0).Local().Format("01-02 15:04")
		}
		blacklist = append(blacklist, row)
	}
	return map[string]any{"version": appVersion, "updatesEnabled": board.updatesEnabled, "showLogs": board.settings.ShowLogs, "rules": board.settings.Rules, "songs": songs, "played": played, "total": len(songs) + len(board.accepted),
		"blacklist": blacklist, "connection": board.connection, "running": board.listenerCancel != nil,
		"frames": board.frames, "logs": board.logs, "notice": board.notice, "noticeID": board.noticeID, "platform": board.settings.Platform,
		"account": board.account.displayName(), "verified": board.verified, "playlists": board.playlists, "results": board.results,
		"target": target, "playlistName": board.settings.Targets[board.settings.Platform].Name, "qrImage": board.qrImage, "qrStatus": board.qrStatus, "busy": board.busy, "addingSong": board.pendingAdd.songID, "auto": board.auto, "unconfirmed": locks}
}

func (board *boardState) publish() {
	board.scheduleMatches()
	_ = board.host.Send("board.changed", board.snapshot())
}

func (board *boardState) notify(message string) {
	board.noticeID++
	board.notice = message
}

func (board *boardState) logLevel(level, message string) {
	entry := fmt.Sprintf("%s  %-5s  %s", time.Now().Format("15:04:05"), level, strings.Join(strings.Fields(message), " "))
	board.logs = append(board.logs, entry)
	if len(board.logs) > 120 {
		board.logs = board.logs[len(board.logs)-120:]
	}
}

func (board *boardState) log(message string) {
	board.logLevel("INFO", message)
}

func (board *boardState) logDebug(message string) {
	board.logLevel("DEBUG", message)
}

func (board *boardState) logWarn(message string) {
	board.logLevel("WARN", message)
}

func (board *boardState) logError(message string) {
	board.logLevel("ERROR", message)
}

func (board *boardState) cancelListener() {
	board.listenerGeneration++
	if board.listenerCancel != nil {
		board.listenerCancel()
		board.listenerCancel = nil
	}
	board.connection = "未连接"
}

func (board *boardState) connect(room string) {
	room = strings.TrimSpace(room)
	if len(room) < 6 || len(room) > 30 || strings.Trim(room, "0123456789") != "" {
		board.notify("房间号必须是至少 6 位数字")
		return
	}
	board.cancelListener()
	ctx, cancel := context.WithCancel(board.ctx)
	board.listenerCancel = cancel
	generation := board.listenerGeneration
	board.frames, board.connection, board.notice = 0, "连接中", ""
	board.log("连接直播间 " + room)
	post := func(update func()) {
		board.scope.Post(func() {
			if generation == board.listenerGeneration {
				update()
				board.publish()
			}
		})
	}
	go func() {
		err := listener.Run(ctx, room, listener.Callbacks{
			OnStatus: func(message string) {
				post(func() {
					if strings.HasPrefix(message, "已连接") {
						board.connection = "已连接"
					}
					board.log(message)
				})
			},
			OnFrame: func() { post(func() { board.frames++ }) },
			OnChat: func(message listener.ChatMessage) {
				post(func() {
					board.handleChat(queue.ChatMessage{ID: message.ID, UserID: message.UserID, Nickname: message.Nickname,
						Content: message.Content, MedalName: message.MedalName, MedalLevel: message.MedalLevel})
				})
			},
		})
		post(func() {
			failed := err != nil && ctx.Err() == nil
			board.cancelListener()
			if failed {
				board.connection = "连接失败"
				board.notify("直播间监听中断，请查看日志或重新连接")
				board.logError(err.Error())
			}
		})
	}()
}

func decodeAction(call *core.HostCall, output any) bool {
	encoded, err := json.Marshal(call.Data)
	if err != nil || json.Unmarshal(encoded, output) != nil {
		call.Reject(errors.New("invalid workbench input"))
		return false
	}
	return true
}

func (board *boardState) actions() map[string]func(*core.HostCall) {
	actions := board.platformActions()
	local := func(name string, handle func(*core.HostCall)) {
		actions["board."+name] = func(call *core.HostCall) { handle(call); call.Resolve(board.snapshot()); board.publish() }
	}
	local("connect", func(call *core.HostCall) {
		var room string
		if decodeAction(call, &room) {
			board.connect(room)
		}
	})
	local("stop", func(*core.HostCall) { board.cancelListener(); board.notify("已停止监听") })
	local("checkUpdate", func(*core.HostCall) { board.checkUpdate() })
	saveRules := func(call *core.HostCall, announce bool) {
		var next rules
		if !decodeAction(call, &next) {
			return
		}
		if next.Fans < 0 || next.Cooldown < 0 || next.Repeat < 0 || next.Limit < 0 || len(next.Template) > 256 {
			board.notify("请输入有效的点歌规则")
			return
		}
		settings := board.settings
		settings.Rules = next
		if board.save(settings) && announce {
			board.notify("点歌规则已保存")
		}
	}
	local("save", func(call *core.HostCall) { saveRules(call, true) })
	local("autosave", func(call *core.HostCall) { saveRules(call, false) })
	local("manual", func(call *core.HostCall) {
		var name string
		if !decodeAction(call, &name) {
			return
		}
		song, err := board.matcher.AddManual(name)
		if err != nil {
			board.notify("无法添加：请检查歌名或黑名单")
			return
		}
		if board.admitSong(song) {
			board.notify("已添加：" + song.Name)
		}
	})
	local("remove", func(call *core.HostCall) {
		var id string
		if decodeAction(call, &id) {
			board.matcher.RemoveByID(id)
		}
	})
	local("clearQueue", func(*core.HostCall) { board.matcher.Clear() })
	local("clearPlayed", func(*core.HostCall) { board.played = nil })
	local("removePlayed", func(call *core.HostCall) {
		var id string
		if decodeAction(call, &id) {
			board.played = slices.DeleteFunc(board.played, func(item playedSong) bool { return item.Song.ID == id })
		}
	})
	local("showLogs", func(call *core.HostCall) {
		var visible bool
		if decodeAction(call, &visible) {
			settings := board.settings
			settings.ShowLogs = visible
			board.save(settings)
		}
	})
	local("clearLogs", func(*core.HostCall) { board.logs = nil; board.notify("日志已清空") })
	local("reset", func(*core.HostCall) {
		if board.busy {
			board.notify("请等待平台操作完成")
			return
		}
		board.cancelListener()
		board.stopSync()
		board.resetMatches()
		board.matcher.Clear()
		board.played, board.accepted, board.logs, board.frames = nil, nil, nil, 0
		clear(board.uncertain)
		clear(board.searchFailed)
		board.notify("本次会话已重置")
	})
	local("blacklist", func(call *core.HostCall) {
		var action struct {
			Kind, Name, Artist string
			Remove             bool
		}
		if !decodeAction(call, &action) {
			return
		}
		action.Name = strings.TrimSpace(action.Name)
		if action.Name == "" || len(action.Name) > 300 || (action.Kind != "song" && action.Kind != "singer") {
			return
		}
		settings := board.settings
		settings.Blacklist = slices.DeleteFunc(slices.Clone(settings.Blacklist), func(entry blacklistEntry) bool {
			return entry.Kind == action.Kind && strings.EqualFold(entry.Name, action.Name)
		})
		if !action.Remove {
			artist := strings.TrimSpace(action.Artist)
			if action.Kind == "singer" || len(artist) > 300 {
				artist = ""
			}
			settings.Blacklist = append(settings.Blacklist, blacklistEntry{Kind: action.Kind, Name: action.Name, Artist: artist, CreatedAt: time.Now().Unix()})
		}
		if board.save(settings) {
			board.notify(fmt.Sprintf("黑名单已更新（%d 项）", len(settings.Blacklist)))
		}
	})
	return actions
}

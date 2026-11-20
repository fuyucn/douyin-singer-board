package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"maps"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/sususongboard/nsgo-app/platform/adapter"
	"github.com/sususongboard/nsgo-app/queue"
	"github.com/zalando/go-keyring"
	"rsc.io/qr"
)

const credentialService = "com.sususongboard.nsgo.music"

type session struct {
	Token    string `json:"token"`
	User     string `json:"userid"`
	Device   string `json:"dfid"`
	Nickname string `json:"nickname"`
}

func (login session) displayName() string {
	if login.Token == "" || login.User == "" {
		return ""
	}
	if login.Nickname != "" {
		return login.Nickname
	}
	return login.User
}

func (login session) args() map[string]any {
	return map[string]any{"token": login.Token, "userid": login.User, "dfid": login.Device}
}

type track struct {
	Name   string `json:"name"`
	Artist string `json:"artist"`
	Key    string `json:"key"`
	Hash   string `json:"hash,omitempty"`
	Album  string `json:"albumId,omitempty"`
	Mix    string `json:"mixSongId,omitempty"`
}

func (item track) identity() string {
	if item.Key != "" {
		return item.Key
	}
	return item.Hash
}

type playlist struct {
	ID    int64  `json:"listid"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type playlistBinding struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Account string `json:"account"`
}

type platformServices struct {
	call   func(context.Context, string, string, any, any) error
	get    func(string, string) (string, error)
	set    func(string, string, string) error
	delete func(string, string) error
}

func (services platformServices) invoke(ctx context.Context, id, method string, arguments, result any) error {
	if services.call != nil {
		return services.call(ctx, id, method, arguments, result)
	}
	return (adapter.Client{ID: id}).Call(ctx, method, arguments, result)
}

func (services platformServices) load(id string) (session, error) {
	get := services.get
	if get == nil {
		get = keyring.Get
	}
	value, err := get(credentialService, id)
	if errors.Is(err, keyring.ErrNotFound) {
		return session{}, nil
	}
	var login session
	if err != nil || json.Unmarshal([]byte(value), &login) != nil || login.displayName() == "" {
		return session{}, errors.New("系统凭据无法读取，请重新登录")
	}
	return login, nil
}

func (services platformServices) save(id string, login session) error {
	set := services.set
	if set == nil {
		set = keyring.Set
	}
	value, err := json.Marshal(login)
	if login.displayName() == "" || err != nil || len(value) > 1900 {
		return errors.New("无法保存登录凭据，请检查系统钥匙串")
	}
	get := services.get
	if get == nil {
		get = keyring.Get
	}
	previous, loadErr := get(credentialService, id)
	if loadErr != nil && !errors.Is(loadErr, keyring.ErrNotFound) {
		return errors.New("无法访问系统钥匙串")
	}
	if loadErr == nil && previous == string(value) {
		return nil
	}
	if err := set(credentialService, id, string(value)); err != nil {
		return errors.New("无法保存登录凭据，请检查系统钥匙串")
	}
	return nil
}

func (services platformServices) forget(id string) error {
	remove := services.delete
	if remove == nil {
		remove = keyring.Delete
	}
	if err := remove(credentialService, id); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return errors.New("无法移除系统登录凭据")
	}
	return nil
}

func (board *boardState) target() playlistBinding {
	target := board.settings.Targets[board.settings.Platform]
	if !board.verified || target.Account != board.account.User {
		return playlistBinding{}
	}
	for _, candidate := range board.playlists {
		if candidate.ID == target.ID && strings.TrimSpace(candidate.Name) == target.Name {
			return target
		}
	}
	return playlistBinding{}
}

func (board *boardState) matchesPlaylistInput(name string, id int64) bool {
	target := board.target()
	return id > 0 && target.ID == id && target.Name == strings.TrimSpace(name)
}

func (board *boardState) bind(target playlistBinding) bool {
	settings := board.settings
	settings.Targets = maps.Clone(settings.Targets)
	settings.Targets[settings.Platform] = target
	board.stopSync()
	return board.save(settings)
}

func (board *boardState) cancelQR() {
	if board.qrTimer != nil {
		board.qrTimer()
		board.qrTimer = nil
	}
	board.qrKey, board.qrImage, board.qrStatus = "", "", ""
}

func (board *boardState) cancelLogin() {
	if board.qrBusy {
		board.platformGeneration++
		if board.platformCancel != nil {
			board.platformCancel()
			board.platformCancel = nil
		}
		board.busy, board.qrBusy = false, false
	}
	board.cancelQR()
}

func (board *boardState) cancelPlatform() {
	board.platformGeneration++
	board.pendingAdd = pendingPlaylistAdd{}
	if board.platformCancel != nil {
		board.platformCancel()
		board.platformCancel = nil
	}
	board.cancelQR()
	board.resetMatches()
	board.stopSync()
}

func runPlatform[T any](board *boardState, run func(context.Context, platformServices, string) (T, error), done func(T, error)) {
	ctx, cancel := context.WithCancel(board.ctx)
	board.platformCancel = cancel
	generation, id, services := board.platformGeneration, board.settings.Platform, board.services
	board.busy = true
	board.publish()
	go func() {
		value, err := run(ctx, services, id)
		board.scope.Post(func() {
			cancel()
			if generation != board.platformGeneration {
				return
			}
			board.busy, board.platformCancel, board.qrBusy = false, nil, false
			done(value, err)
			board.scheduleSync()
			board.publish()
		})
	}()
}

func platformCall[T any](board *boardState, method string, args any, done func(T, error)) {
	runPlatform(board, func(ctx context.Context, services platformServices, id string) (T, error) {
		var result T
		err := services.invoke(ctx, id, method, args, &result)
		return result, err
	}, done)
}

type accountInfo struct {
	login session
	lists []playlist
}

func loadAccount(ctx context.Context, services platformServices, id string, login session) (accountInfo, error) {
	if login.displayName() == "" {
		return accountInfo{}, nil
	}
	if id == adapter.NetEase {
		var verified session
		if err := services.invoke(ctx, id, "loginCookie", map[string]string{"token": login.Token}, &verified); err != nil || verified.User != login.User {
			return accountInfo{}, errors.New("网易云登录身份验证失败，请重新登录")
		}
		login = verified
	}
	var lists []playlist
	if err := services.invoke(ctx, id, "playlists", login.args(), &lists); err != nil {
		return accountInfo{login: login}, errors.New("无法验证平台登录或加载歌单，请刷新或重新登录")
	}
	return accountInfo{login, lists}, nil
}

func (board *boardState) accountLoaded(info accountInfo, err error) {
	board.account, board.playlists = info.login, info.lists
	board.verified = err == nil && info.login.displayName() != ""
	if err != nil {
		board.notify(err.Error())
		board.stopSync()
	}
}

func (board *boardState) restoreSession() {
	if board.busy || board.settingsInvalid || !adapter.Known(board.settings.Platform) {
		return
	}
	runPlatform(board, func(ctx context.Context, services platformServices, id string) (accountInfo, error) {
		login, err := services.load(id)
		if err != nil {
			return accountInfo{}, err
		}
		return loadAccount(ctx, services, id, login)
	}, board.accountLoaded)
}

type loginChallenge struct {
	Key   string `json:"key"`
	Image string `json:"image"`
}

func qrImage(id string, challenge loginChallenge) (string, error) {
	if challenge.Key == "" || len(challenge.Key) > 512 {
		return "", errors.New("平台未返回有效的登录二维码")
	}
	if id == adapter.NetEase {
		code, err := qr.Encode("https://music.163.com/login?codekey="+url.QueryEscape(challenge.Key)+"&type=1", qr.M)
		if err != nil {
			return "", errors.New("无法生成网易云登录二维码")
		}
		return "data:image/png;base64," + base64.StdEncoding.EncodeToString(code.PNG()), nil
	}
	data := strings.TrimPrefix(challenge.Image, "data:image/png;base64,")
	if len(data) > 512<<10 {
		return "", errors.New("登录二维码过大")
	}
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil || !strings.HasPrefix(string(decoded), "\x89PNG\r\n\x1a\n") {
		return "", errors.New("酷狗未返回有效的 PNG 二维码")
	}
	config, err := png.DecodeConfig(bytes.NewReader(decoded))
	if err != nil || config.Width > 1024 || config.Height > 1024 {
		return "", errors.New("酷狗二维码尺寸无效")
	}
	return "data:image/png;base64," + data, nil
}

func (board *boardState) startQR() {
	board.cancelQR()
	board.qrStatus = "正在生成二维码…"
	board.qrBusy = true
	platformCall(board, "loginQrKey", struct{}{}, func(challenge loginChallenge, err error) {
		if err == nil {
			board.qrImage, err = qrImage(board.settings.Platform, challenge)
		}
		if err != nil {
			board.qrStatus = "二维码生成失败，请重试"
			return
		}
		board.qrKey, board.qrUntil, board.qrStatus = challenge.Key, time.Now().Add(3*time.Minute), "等待扫码"
		board.scheduleQR()
	})
}

func (board *boardState) scheduleQR() {
	board.qrTimer = board.scope.AfterFunc(2*time.Second, board.pollQR)
}

func (board *boardState) pollQR() {
	board.qrTimer = nil
	if board.qrKey == "" {
		return
	}
	if time.Now().After(board.qrUntil) {
		board.cancelQR()
		board.qrStatus = "二维码已过期"
		board.publish()
		return
	}
	if board.busy {
		board.scheduleQR()
		return
	}
	key := board.qrKey
	board.qrBusy = true
	type qrResult struct {
		Status int `json:"status"`
		Code   int `json:"code"`
		session
	}
	type qrAnswer struct {
		info   accountInfo
		status int
	}
	runPlatform(board, func(ctx context.Context, services platformServices, id string) (qrAnswer, error) {
		var result qrResult
		if err := services.invoke(ctx, id, "loginQrCheck", map[string]string{"key": key}, &result); err != nil {
			return qrAnswer{}, errors.New("扫码状态查询失败，请重新生成二维码")
		}
		answer := qrAnswer{status: result.Status}
		if result.Status != 4 {
			return answer, nil
		}
		var err error
		answer.info, err = loadAccount(ctx, services, id, result.session)
		return answer, err
	}, func(answer qrAnswer, err error) {
		if err != nil {
			board.cancelQR()
			board.qrStatus = err.Error()
			return
		}
		switch answer.status {
		case 4:
			board.cancelQR()
			runPlatform(board, func(_ context.Context, services platformServices, id string) (accountInfo, error) {
				return answer.info, services.save(id, answer.info.login)
			}, func(info accountInfo, err error) {
				if err != nil {
					board.notify(err.Error())
					return
				}
				board.accountLoaded(info, nil)
				board.notify("平台已登录")
			})
		case -1:
			board.cancelQR()
			board.qrStatus = "网易云拒绝本次扫码，请改用 Cookie 登录"
		case 0:
			board.cancelQR()
			board.qrStatus = "二维码已过期"
		case 2:
			board.qrStatus = "已扫码，请在手机确认"
			board.scheduleQR()
		default:
			board.scheduleQR()
		}
	})
}

func (board *boardState) cookieLogin(cookie string) {
	if board.settings.Platform != adapter.NetEase {
		return
	}
	if !strings.Contains(cookie, "MUSIC_U=") || len(cookie) > 8000 || strings.ContainsAny(cookie, "\r\n") {
		board.notify("请在应用内填写有效的网易云 Cookie")
		return
	}
	board.cancelQR()
	runPlatform(board, func(ctx context.Context, services platformServices, id string) (accountInfo, error) {
		var login session
		if err := services.invoke(ctx, id, "loginCookie", map[string]string{"token": cookie}, &login); err != nil {
			return accountInfo{}, errors.New("网易云 Cookie 验证失败")
		}
		if err := services.save(id, login); err != nil {
			return accountInfo{}, err
		}
		return loadAccount(ctx, services, id, login)
	}, func(info accountInfo, err error) {
		if err == nil {
			board.notify("网易云已登录")
		}
		board.accountLoaded(info, err)
	})
}

func (board *boardState) refreshPlaylists() {
	if board.account.displayName() == "" {
		board.restoreSession()
		return
	}
	login := board.account
	runPlatform(board, func(ctx context.Context, services platformServices, id string) (accountInfo, error) {
		return loadAccount(ctx, services, id, login)
	}, board.accountLoaded)
}

func (board *boardState) updatePlaylist(method, name string) {
	if !board.verified {
		board.notify("请先登录并验证平台账号")
		return
	}
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 300 {
		board.notify("请输入有效的歌单名称")
		return
	}
	args := board.account.args()
	args["name"] = name
	previous := board.settings.Targets[board.settings.Platform]
	if method == "resolvePlaylist" {
		if previous.Name == name && previous.Account == board.account.User {
			args["currentId"] = previous.ID
		}
	}
	if method == "clearPlaylist" {
		current := board.target()
		if current.ID == 0 || current.Name != name {
			board.notify("歌单已变更，未执行清理")
			return
		}
		args["currentId"] = current.ID
	}
	board.stopSync()
	type result struct {
		ID      int64 `json:"listid"`
		Created bool  `json:"created"`
		Refused bool  `json:"refused"`
	}
	platformCall(board, method, args, func(answer result, err error) {
		if err != nil || answer.ID <= 0 || answer.Refused {
			board.syncAfterResolve = false
			if method == "clearPlaylist" {
				board.verified = false
			}
			board.notify("歌单操作未确认成功，请刷新并检查平台歌单")
			return
		}
		board.playlists = slices.DeleteFunc(board.playlists, func(item playlist) bool {
			return item.ID == answer.ID || (method == "clearPlaylist" && item.ID == previous.ID)
		})
		board.playlists = append(board.playlists, playlist{ID: answer.ID, Name: name})
		if board.settings.Targets[board.settings.Platform] != previous {
			board.stopSync()
			board.notify("歌单名称已修改，未切换绑定")
			return
		}
		resume := board.syncAfterResolve
		if board.bind(playlistBinding{answer.ID, name, board.account.User}) {
			if resume {
				board.auto = true
				if answer.Created {
					board.notify("未找到同名歌单，已创建并开启自动同步：" + name)
				} else {
					board.notify("已找到歌单并开启自动同步：" + name)
				}
			} else {
				board.notify("已绑定歌单：" + name)
			}
		}
	})
}

func (board *boardState) stopSync() {
	board.auto = false
	board.syncAfterResolve = false
	if board.autoTimer != nil {
		board.autoTimer()
		board.autoTimer = nil
	}
}

func writeKey(provider, account string, playlistID int64, trackID string) string {
	encoded, _ := json.Marshal([]string{provider, account, fmt.Sprint(playlistID), trackID})
	return string(encoded)
}

func (board *boardState) currentWriteKey(key string) bool {
	var parts []string
	if json.Unmarshal([]byte(key), &parts) != nil || len(parts) != 4 {
		return false
	}
	target := board.target()
	return parts[0] == board.settings.Platform && parts[1] == board.account.User && target.ID > 0 && parts[2] == fmt.Sprint(target.ID)
}

func (board *boardState) recordWrite(key, name string) bool {
	settings := board.settings
	settings.Unconfirmed = maps.Clone(settings.Unconfirmed)
	if settings.Unconfirmed == nil {
		settings.Unconfirmed = map[string]string{}
	}
	if name == "" {
		delete(settings.Unconfirmed, key)
	} else {
		settings.Unconfirmed[key] = name
	}
	return board.save(settings)
}

func (board *boardState) scheduleSync() {
	board.scheduleMatches()
	if !board.auto || board.busy || board.autoTimer != nil || board.target().ID == 0 || len(board.matcher.Queue()) == 0 {
		return
	}
	board.autoTimer = board.scope.AfterFunc(2*time.Second, func() {
		board.autoTimer = nil
		if !board.auto || board.busy {
			return
		}
		songs := board.matcher.Queue()
		for _, song := range songs {
			entry := board.matches[strings.TrimSpace(song.Name)]
			if entry.Status == "found" && !board.uncertain[song.ID] && !board.searchFailed[song.ID] && board.songAllowed(song, entry.Track) {
				board.syncSong(song, entry.Track, true)
				board.publish()
				return
			}
		}
		board.scheduleSync()
	})
}

func (board *boardState) songAllowed(song queue.Song, candidate track) bool {
	limit, count := board.settings.Rules.Limit, 0
	if board.blocked(song, candidate) {
		return false
	}
	for _, accepted := range board.accepted {
		elapsed := time.Since(accepted.At).Seconds()
		if !song.Manual && accepted.Song.UserID == song.UserID {
			count++
			if elapsed < float64(board.settings.Rules.Cooldown) {
				return false
			}
		}
		if elapsed < float64(board.settings.Rules.Repeat) && (strings.EqualFold(accepted.Song.Name, song.Name) ||
			(candidate.identity() != "" && accepted.Platform == board.settings.Platform && accepted.Track.identity() == candidate.identity())) {
			return false
		}
	}
	return song.Manual || limit == 0 || count < limit
}

func (board *boardState) syncSong(song queue.Song, candidate track, automatic bool) {
	target := board.target()
	if target.ID == 0 || board.uncertain[song.ID] || board.blocked(song, candidate) || (automatic && !board.songAllowed(song, candidate)) {
		board.notify("请检查已绑定歌单、点歌规则或上次加入结果")
		return
	}
	if candidate.identity() == "" {
		if entry := board.matches[strings.TrimSpace(song.Name)]; entry.Status == "found" {
			board.syncSong(song, entry.Track, automatic)
			return
		}
		platformCall(board, "search", map[string]any{"keyword": song.Name, "pagesize": 5}, func(matches []track, err error) {
			found := slices.IndexFunc(matches, func(item track) bool {
				return item.identity() != "" && item.Name != "" && !board.blocked(song, item) && (!automatic || board.songAllowed(song, item))
			})
			if err != nil || found < 0 {
				board.searchFailed[song.ID] = true
				board.notify("未找到可自动匹配的歌曲，请手动搜索")
				return
			}
			if board.target() != target || !slices.ContainsFunc(board.matcher.Queue(), func(item queue.Song) bool { return item.ID == song.ID }) || (automatic && !board.auto) {
				return
			}
			board.syncSong(song, matches[found], automatic)
		})
		return
	}
	args := board.account.args()
	args["listid"], args["track"] = target.ID, candidate
	key := writeKey(board.settings.Platform, board.account.User, target.ID, candidate.identity())
	if board.settings.Unconfirmed[key] != "" {
		board.stopSync()
		board.notify("此歌曲有未确认的加入记录，请先在平台核对")
		return
	}
	if !board.recordWrite(key, song.Name) {
		board.stopSync()
		return
	}
	board.pendingAdd = pendingPlaylistAdd{songID: song.ID, key: key}
	platformCall(board, "addTrack", args, func(result struct{ Status int }, err error) {
		board.pendingAdd = pendingPlaylistAdd{}
		if err != nil {
			board.uncertain[song.ID] = true
			board.stopSync()
			board.notify("加入结果未知，已停止自动同步；请在平台确认后处理")
			return
		}
		if result.Status != 1 {
			board.searchFailed[song.ID] = true
			board.stopSync()
			board.notify("平台未接受歌曲，已停止自动同步；请检查登录及歌单")
			return
		}
		item := playedSong{song, candidate, board.settings.Platform, time.Now()}
		if board.matcher.RemoveByID(song.ID) {
			board.played = append([]playedSong{item}, board.played...)
		}
		board.accepted = append(board.accepted, item)
		if !board.recordWrite(key, "") {
			board.stopSync()
			board.notify("歌曲已加入，但确认记录无法保存；请在平台核对后解除写入锁")
			return
		}
		message := "已加入平台歌单：" + candidate.Name
		board.log(message)
		if !automatic {
			board.notify(message)
		}
	})
}

func (board *boardState) platformActions() map[string]func(*core.HostCall) {
	actions := map[string]func(*core.HostCall){}
	register := func(name string, requirePlatform bool, handle func(*core.HostCall)) {
		actions["platform."+name] = func(call *core.HostCall) {
			if board.settingsInvalid && name != "stopSync" && name != "cancelQR" {
				board.notify("配置目录无法安全写入，已禁止平台操作")
			} else if board.busy && name != "stopSync" && name != "cancelQR" && name != "name" {
				board.notify("请等待当前平台操作完成")
			} else if !requirePlatform || adapter.Known(board.settings.Platform) {
				handle(call)
			}
			call.Resolve(board.snapshot())
			board.publish()
		}
	}
	register("select", false, func(call *core.HostCall) {
		var id string
		if !decodeAction(call, &id) || (id != "" && !adapter.Known(id)) || id == board.settings.Platform {
			return
		}
		settings := board.settings
		settings.Platform = id
		if !board.save(settings) {
			return
		}
		board.cancelPlatform()
		board.account, board.playlists, board.results, board.verified, board.notice = session{}, nil, nil, false, ""
		clear(board.searchFailed)
		board.restoreSession()
	})
	register("qr", true, func(*core.HostCall) { board.startQR() })
	register("cancelQR", true, func(*core.HostCall) { board.cancelLogin() })
	register("cookie", true, func(call *core.HostCall) {
		var cookie string
		if decodeAction(call, &cookie) {
			board.cookieLogin(cookie)
		}
	})
	register("logout", true, func(*core.HostCall) {
		board.cancelPlatform()
		runPlatform(board, func(_ context.Context, services platformServices, id string) (bool, error) {
			return true, services.forget(id)
		}, func(_ bool, err error) {
			if err != nil {
				board.notify(err.Error())
				return
			}
			board.accountLoaded(accountInfo{}, nil)
			board.notify("已退出平台登录")
		})
	})
	register("refresh", true, func(*core.HostCall) { board.refreshPlaylists() })
	register("bind", true, func(call *core.HostCall) {
		var id int64
		if !decodeAction(call, &id) || !board.verified {
			return
		}
		for _, item := range board.playlists {
			if id > 0 && item.ID == id {
				board.bind(playlistBinding{id, strings.TrimSpace(item.Name), board.account.User})
				return
			}
		}
	})
	register("acknowledge", true, func(call *core.HostCall) {
		var key string
		if !decodeAction(call, &key) || !board.currentWriteKey(key) {
			return
		}
		name := board.settings.Unconfirmed[key]
		if name == "" {
			return
		}
		if board.recordWrite(key, "") {
			for _, song := range board.matcher.Queue() {
				if song.Name == name {
					delete(board.uncertain, song.ID)
					delete(board.searchFailed, song.ID)
				}
			}
			board.notify("已按你的平台核对结果解除该次写入锁")
		}
	})
	register("clear", true, func(call *core.HostCall) {
		var input struct {
			Name string
			ID   int64
		}
		if !decodeAction(call, &input) {
			return
		}
		if !board.matchesPlaylistInput(input.Name, input.ID) {
			board.notify("歌单已变更，未执行清理")
			return
		}
		board.updatePlaylist("clearPlaylist", input.Name)
	})
	register("search", true, func(call *core.HostCall) {
		var keyword string
		if !decodeAction(call, &keyword) || strings.TrimSpace(keyword) == "" || len(keyword) > 300 {
			return
		}
		board.results = nil
		platformCall(board, "search", map[string]any{"keyword": strings.TrimSpace(keyword), "pagesize": 10}, func(results []track, err error) {
			if err != nil {
				board.notify("平台搜索失败，请重试")
				return
			}
			board.results = slices.DeleteFunc(results, func(item track) bool { return item.identity() == "" || item.Name == "" })
			if len(board.results) == 0 {
				board.notify("没有找到歌曲")
			}
		})
	})
	register("add", true, func(call *core.HostCall) {
		var input struct {
			Song string
			Key  string
			Name string
			ID   int64
		}
		if !decodeAction(call, &input) {
			return
		}
		if !board.matchesPlaylistInput(input.Name, input.ID) {
			board.notify("请先绑定与输入名称一致的歌单")
			return
		}
		var candidate track
		if input.Key != "" {
			index := slices.IndexFunc(board.results, func(item track) bool { return item.identity() == input.Key })
			if index < 0 {
				return
			}
			candidate = board.results[index]
		}
		for _, song := range board.matcher.Queue() {
			if song.ID == input.Song {
				board.syncSong(song, candidate, false)
				return
			}
		}
	})
	register("name", true, func(call *core.HostCall) {
		var name string
		if !decodeAction(call, &name) {
			return
		}
		name = strings.TrimSpace(name)
		previous := board.settings.Targets[board.settings.Platform]
		if name == previous.Name {
			return
		}
		board.stopSync()
		if len(name) > 300 {
			board.notify("请输入有效的歌单名称")
			return
		}
		settings := board.settings
		settings.Targets = maps.Clone(settings.Targets)
		settings.Targets[settings.Platform] = playlistBinding{Name: name, Account: board.account.User}
		board.save(settings)
	})
	register("startSync", true, func(call *core.HostCall) {
		var name string
		if !decodeAction(call, &name) {
			return
		}
		board.updatePlaylist("resolvePlaylist", name)
		board.syncAfterResolve = board.busy
	})
	register("stopSync", false, func(*core.HostCall) { board.stopSync() })
	return actions
}

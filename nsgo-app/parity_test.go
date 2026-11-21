package main

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/sususongboard/nsgo-app/platform/adapter"
	"github.com/sususongboard/nsgo-app/queue"
)

func TestNSHFirstMatchAndExplicitAddOverrideAutomaticQuota(t *testing.T) {
	for _, provider := range []string{adapter.KuGou, adapter.NetEase} {
		t.Run(provider, func(t *testing.T) {
			fixtureDatabase(t)
			mock := &mockPlatforms{credentials: map[string]string{}}
			var board *boardState
			app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
				board = newBoard(scope, mock.services())
				return core.Text{Content: "matching controller"}
			})
			var song queue.Song
			app.Post(func() {
				board.settings.Platform = provider
				board.settings.Rules.Limit = 1
				board.account, board.verified = session{Token: "TEST_ONLY", User: "account"}, true
				board.playlists = []playlist{{ID: 11, Name: "Target"}}
				board.settings.Targets[provider] = playlistBinding{ID: 11, Name: "Target", Account: "account"}
				result := board.matcher.Match(queue.ChatMessage{ID: "request", UserID: "viewer", Nickname: "Viewer", Content: "Requested cover"})
				song = *result.Added
				board.accepted = []playedSong{{Song: song, At: time.Now()}}
				board.publish()
			})
			app.WaitUntil(time.Second, func() bool { return board.matches[song.Name].Status == "found" })
			app.Post(func() {
				candidate := board.matches[song.Name].Track
				if candidate.Name != "Test song" {
					t.Fatal("did not retain the platform's first result")
				}
				if board.songAllowed(song, candidate) {
					t.Fatal("automatic add bypassed the success quota")
				}
				board.syncSong(song, candidate, false)
			})
			app.WaitUntil(time.Second, func() bool { return len(board.played) == 1 })
			if len(board.matcher.Queue()) != 0 {
				t.Fatal("confirmed explicit add did not move the row")
			}
		})
	}
}

func TestEagerMatchingIsBoundedAndDropsOldProviderResults(t *testing.T) {
	fixtureDatabase(t)
	var active, peak, started atomic.Int32
	release := make(chan struct{})
	services := platformServices{call: func(ctx context.Context, provider, method string, input, output any) error {
		if method != "search" {
			t.Error("unexpected non-search operation")
		}
		count := active.Add(1)
		defer active.Add(-1)
		for previous := peak.Load(); count > previous && !peak.CompareAndSwap(previous, count); previous = peak.Load() {
		}
		started.Add(1)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-release:
		}
		data, _ := json.Marshal([]track{{Name: provider, Key: provider}})
		return json.Unmarshal(data, output)
	}}
	var board *boardState
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
		board = newBoard(scope, services)
		return core.Text{Content: "bounded matcher"}
	})
	app.Post(func() {
		board.settings.Platform = adapter.KuGou
		for _, name := range []string{"One", "Two", "Three", "Four", "Five"} {
			_, _ = board.matcher.AddManual(name)
		}
		board.publish()
	})
	app.WaitUntil(time.Second, func() bool { return started.Load() == 2 })
	app.Post(func() { board.cancelPlatform(); board.settings.Platform = adapter.NetEase; board.publish() })
	app.WaitUntil(time.Second, func() bool { return started.Load() == 4 })
	close(release)
	app.WaitUntil(time.Second, func() bool {
		if len(board.matches) != 5 {
			return false
		}
		for _, entry := range board.matches {
			if entry.Status != "found" || entry.Track.Name != adapter.NetEase {
				return false
			}
		}
		return true
	})
	if peak.Load() > 2 {
		t.Fatalf("eager search exceeded two active requests: %d", peak.Load())
	}
}

func TestBothPlatformsResolveNamedPlaylistBeforeAutomaticAdd(t *testing.T) {
	for _, provider := range []string{adapter.KuGou, adapter.NetEase} {
		t.Run(provider, func(t *testing.T) {
			app, mock := startPlatformBoard(t, provider, true)
			app.Type("id:playlist-name", "New target")
			app.Type("id:manual-song", "Test song")
			app.Press("id:manual-add")
			app.WaitFor("text:Test song · Test artist", time.Second)
			app.Press("id:auto-sync")
			app.WaitFor("role:button 停止同步", time.Second)
			app.WaitFor("text:未找到同名歌单，已创建并开启自动同步：New target", time.Second)
			app.Clock.Advance(2 * time.Second)
			app.WaitUntil(time.Second, func() bool { return app.Find("id:queue-count").Text == "队列 0" })
			if app.Exists("role:alert 已加入平台歌单：Test song") {
				t.Fatal("automatic additions should update the history without showing a toast for each song")
			}
			mock.mu.Lock()
			methods := strings.Join(mock.methods, ",")
			mock.mu.Unlock()
			resolve, add := strings.Index(methods, ":resolvePlaylist"), strings.Index(methods, ":addTrack")
			if resolve < 0 || add <= resolve {
				t.Fatal("automatic add ran before named-playlist resolution")
			}
			app.Clear("id:playlist-name")
			app.Type("id:playlist-name", "Different target")
			app.WaitForGone("role:button 停止同步", time.Second)
			app.Press("id:clear-platform-playlist")
			app.WaitFor("text:请先选择与输入框同名的歌单", time.Second)
			if app.Exists("id:clear-playlist-dialog") {
				t.Fatal("renaming retained the old destructive binding")
			}
		})
	}
}

func TestSettingsModalAndVersionShareManifest(t *testing.T) {
	fixtureDatabase(t)
	app := nsgotest.Start(t, Root, nsgotest.Size(1000, 780))
	if app.Exists("id:about") || app.Exists("id:platform-account-button") {
		t.Fatal("plugin and about should only be available inside settings")
	}
	app.Press("id:settings")
	app.WaitFor("id:settings-dialog", time.Second)
	if !app.Exists("id:song-queue") {
		t.Fatal("settings replaced the workbench")
	}
	app.Press("id:settings-show-logs")
	app.Press("id:settings-about")
	if app.Find("id:app-version").Text != "v"+appVersion {
		t.Fatal("about version diverged from manifest")
	}
	app.Press("id:close-settings")
	if app.Exists("id:log-panel") {
		t.Fatal("empty log should stay hidden when enabled in settings")
	}
	data := savedSQLiteSettings(t)
	var saved boardSettings
	if json.Unmarshal([]byte(data), &saved) != nil || !saved.ShowLogs {
		t.Fatal("log visibility was not saved")
	}
}

func TestRequestRejectionReasonsAppearInLogs(t *testing.T) {
	fixtureDatabase(t)
	seedJSONPreferences(t, boardSettings{
		Rules:     rules{Template: queue.DefaultTemplate, Fans: 3, Limit: 1},
		Blacklist: []blacklistEntry{{Kind: "song", Name: "Blocked song"}, {Kind: "singer", Name: "Blocked artist"}},
		ShowLogs:  true,
	})
	var board *boardState
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
		board = newBoard(scope, platformServices{})
		scope.ProvideHost(board.host)
		board.host.Handle("board.snapshot", func(call *core.HostCall) { call.Resolve(board.snapshot()) })
		return renderBoard(scope)
	}, nsgotest.Size(1000, 780))
	app.Post(func() {
		board.accepted = []playedSong{{Song: queue.Song{Name: "Played song", UserID: "quota"}, At: time.Now()}}
		for _, message := range []queue.ChatMessage{
			{UserID: "viewer", Nickname: "Viewer", Content: "普通弹幕", MedalLevel: 1},
			{UserID: "viewer", Nickname: "Viewer", Content: "点歌 晴天", MedalLevel: 2},
			{UserID: "viewer", Nickname: "Viewer", Content: "点歌 Blocked song", MedalLevel: 3},
			{UserID: "viewer", Nickname: "Viewer", Content: "点歌 Blocked artist - Single", MedalLevel: 3},
			{UserID: "quota", Nickname: "Quota", Content: "点歌 夜曲", MedalLevel: 3},
			{UserID: "viewer", Nickname: "Viewer", Content: "点歌 七里香", MedalLevel: 3},
			{UserID: "other", Nickname: "Other", Content: "点歌 七里香", MedalLevel: 3},
		} {
			board.handleChat(message)
		}
		board.publish()
	})
	app.WaitFor("id:log-toggle", time.Second)
	app.Advance(4 * time.Second)
	app.Press("id:log-toggle")
	for _, line := range []string{
		"Viewer: 普通弹幕",
		"点歌拒绝：Viewer「点歌 晴天」— 粉丝团等级不足（当前 2，要求 3）",
		"点歌拒绝：Viewer「点歌 Blocked song」— 歌曲在黑名单中",
		"点歌拒绝：Viewer「点歌 Blocked artist - Single」— 歌手在黑名单中",
		"点歌拒绝：Quota「点歌 夜曲」— 已达每人单场点歌上限（1/1）",
		"Viewer: 点歌 七里香",
		"点歌拒绝：Other「点歌 七里香」— 已在待点或已点列表中",
	} {
		app.WaitFor("text:"+line, time.Second)
	}
	if app.Find("id:log-count").Text != "7" || app.Find("id:queue-count").Text != "队列 1" {
		t.Fatal("request logging duplicated entries or changed admission behavior")
	}
}

func TestSuccessCountExcludesManualAndEmptyUsers(t *testing.T) {
	board := &boardState{accepted: []playedSong{
		{Song: queue.Song{UserID: "viewer"}, At: time.Now()},
		{Song: queue.Song{UserID: "viewer"}, At: time.Now()},
		{Song: queue.Song{UserID: "manual"}, At: time.Now()},
		{Song: queue.Song{UserID: ""}, At: time.Now()},
	}}
	if got := board.successCount("viewer"); got != 2 {
		t.Fatalf("viewer success count = %d, want 2", got)
	}
	if got := board.successCount("manual"); got != 0 {
		t.Fatalf("manual success count = %d, want 0", got)
	}
	if got := board.successCount(""); got != 0 {
		t.Fatalf("empty user success count = %d, want 0", got)
	}
}

func TestChatUserIDFallback(t *testing.T) {
	cases := []struct {
		message queue.ChatMessage
		want    string
	}{
		{queue.ChatMessage{UserID: "12345", Nickname: "A"}, "12345"},
		{queue.ChatMessage{UserID: " 0 ", Nickname: "A"}, "anon:A"},
		{queue.ChatMessage{UserID: "", Nickname: " 张三 "}, "anon:张三"},
		{queue.ChatMessage{UserID: "0"}, "anonymous"},
	}
	for _, test := range cases {
		if got := chatUserID(test.message); got != test.want {
			t.Fatalf("chatUserID(%+v) = %q, want %q", test.message, got, test.want)
		}
	}
}

func TestAnonymousViewersIgnoreUserQuota(t *testing.T) {
	fixtureDatabase(t)
	seedJSONPreferences(t, boardSettings{Rules: rules{Template: "[song]", Limit: 1}})
	var board *boardState
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
		board = newBoard(scope, platformServices{})
		scope.ProvideHost(board.host)
		board.host.Handle("board.snapshot", func(call *core.HostCall) { call.Resolve(board.snapshot()) })
		return renderBoard(scope)
	}, nsgotest.Size(1000, 780))
	requests := []struct{ id, nickname, name string }{
		{"a1", "Alice", "Alice song"},
		{"b1", "Bob", "Bob song"},
		{"c1", "Carol", "Carol song"},
		{"a2", "Alice", "Alice second song"},
	}
	app.Post(func() {
		for _, request := range requests {
			board.handleChat(queue.ChatMessage{ID: request.id, UserID: "0", Nickname: request.nickname, Content: request.name})
		}
		board.publish()
	})
	app.WaitUntil(time.Second, func() bool { return app.Find("id:queue-count").Text == "队列 4" })
	if got := len(app.Query("text:0/1")) + len(app.Query("text:1/1")); got != 0 {
		t.Fatalf("anonymous rows showed %d quota badges, want none", got)
	}
	if got := board.successCount("anon:Alice"); got != 0 {
		t.Fatalf("anonymous success count = %d, want 0", got)
	}
}

func TestAnonymousCancelUsesNickname(t *testing.T) {
	app, board := controllerHarness(t, platformServices{})
	app.Post(func() {
		board.handleChat(queue.ChatMessage{ID: "anon-1", UserID: "0", Nickname: "Alice", Content: "Song one"})
		board.handleChat(queue.ChatMessage{ID: "anon-2", UserID: "0", Nickname: "Alice", Content: "取消点歌"})
	})
	app.Settle()
	if queue := board.matcher.Queue(); len(queue) != 0 {
		t.Fatalf("anonymous cancel left %d queued songs", len(queue))
	}
}

func TestQuotaUsesConfirmedAddsNotQueue(t *testing.T) {
	fixtureDatabase(t)
	seedJSONPreferences(t, boardSettings{Rules: rules{Template: "[song]", Limit: 3}})
	var board *boardState
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
		board = newBoard(scope, platformServices{})
		scope.ProvideHost(board.host)
		board.host.Handle("board.snapshot", func(call *core.HostCall) { call.Resolve(board.snapshot()) })
		return renderBoard(scope)
	}, nsgotest.Size(1000, 780))
	app.Post(func() {
		for _, name := range []string{"Queued one", "Queued two"} {
			result := board.matcher.Match(queue.ChatMessage{ID: name, UserID: "viewer", Nickname: "Viewer", Content: name})
			if result.Added != nil {
				board.admitSong(*result.Added)
			}
		}
		board.publish()
	})
	app.WaitUntil(time.Second, func() bool { return len(app.Query("text:0/3")) == 2 })
	if got := len(app.Query("text:0/3")); got != 2 {
		t.Fatalf("queued-only rows showed %d quota badges, want 2", got)
	}
	app.Post(func() {
		queued := board.matcher.Queue()
		if len(queued) == 0 {
			return
		}
		confirmed := queued[0]
		board.matcher.RemoveByID(confirmed.ID)
		board.played = []playedSong{{Song: confirmed, At: time.Now()}}
		board.accepted = []playedSong{{Song: confirmed, At: time.Now()}}
		board.publish()
	})
	app.WaitUntil(time.Second, func() bool { return len(app.Query("text:1/3")) == 1 })
	if got := len(app.Query("text:1/3")); got != 1 {
		t.Fatalf("rows showed %d confirmed-add badges, want 1", got)
	}
	if len(app.Query("text:0/3")) != 0 {
		t.Fatal("queued rows still showed a zero success count after a confirmed add")
	}
}

func TestWorkbenchNotificationsDoNotMoveTheTableOrReplay(t *testing.T) {
	fixtureDatabase(t)
	var board *boardState
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
		board = newBoard(scope, platformServices{})
		scope.ProvideHost(board.host)
		board.host.Handle("board.snapshot", func(call *core.HostCall) { call.Resolve(board.snapshot()) })
		return renderBoard(scope)
	}, nsgotest.Size(1000, 780))
	before := app.Find("id:workbench-tabs").Frame
	app.Post(func() {
		board.notify("同一条通知")
		board.publish()
		board.publish()
	})
	app.WaitFor("text:同一条通知", time.Second)
	if app.Find("id:workbench-tabs").Frame != before || app.Exists("id:notice") {
		t.Fatal("notification changed the workbench layout")
	}
	app.Press("id:settings")
	app.WaitFor("id:settings-dialog", time.Second)
	app.Post(func() { board.notify("同一条通知"); board.publish() })
	app.WaitUntil(time.Second, func() bool { return len(app.Query("text:同一条通知")) == 2 })
	if app.Exists("id:settings-notice") {
		t.Fatal("settings showed an inline notification")
	}
	app.Hover("id:app-header")
	app.Advance(4 * time.Second)
	app.WaitForGone("text:同一条通知", time.Second)
	app.Post(board.publish)
	app.Settle()
	if app.Exists("text:同一条通知") {
		t.Fatal("replayed an old notification")
	}
}

func TestStartControlUsesReferencePalette(t *testing.T) {
	for _, theme := range []struct {
		name       string
		dark       bool
		foreground core.Color
	}{
		{"light", false, core.RGB(0x191d24)},
		{"dark", true, core.RGB(0xedf0f1)},
	} {
		t.Run(theme.name, func(t *testing.T) {
			fixtureDatabase(t)
			app := startTestApp(t, Root, nsgotest.Size(1000, 680), nsgotest.Environment(desktopTestEnvironment(theme.dark)))
			app.Hover("id:app-header")
			if actual := app.Find("id:connect").Style.Background; actual != theme.foreground {
				t.Fatalf("start control background = %v, want reference foreground %v", actual, theme.foreground)
			}
		})
	}
}

func TestTableIconTooltip(t *testing.T) {
	app, _ := startPlatformBoard(t, adapter.NetEase, true)
	app.Type("id:manual-song", "Test request")
	app.Press("id:manual-add")
	app.WaitFor("text:Test song · Test artist", time.Second)
	app.Hover("role:button 加入歌单")
	app.Advance(650 * time.Millisecond)
	app.WaitFor("text:请先选择与输入名称一致的歌单，或开启自动同步", time.Second)
	app.Hover("role:button 复制歌名")
	app.Advance(650 * time.Millisecond)
	app.WaitFor("text:复制歌名", time.Second)
	app.RightClick("text:Test request")
	app.WaitFor("role:menuitem 复制弹幕", time.Second)
}

func TestWorkbenchPointerTooltip(t *testing.T) {
	app, _ := startPlatformBoard(t, adapter.NetEase, true)
	app.SetEnvironment(desktopTestEnvironment(false))
	app.Resize(1000, 680)
	app.Type("id:manual-song", "Hover request")
	app.Press("id:manual-add")
	app.WaitFor("text:Test song · Test artist", time.Second)
	app.Hover("role:button 复制歌名")
	app.Advance(650 * time.Millisecond)
	if nsgotest.Target() != "" {
		app.Screenshot("native-pointer-tooltip")
	}
	app.WaitFor("text:复制歌名", time.Second)
}

package main

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/sususongboard/nsgo-app/platform/adapter"
	_ "modernc.org/sqlite"
)

func TestMain(main *testing.M) { nsgotest.Main(main) }

func fixtureDatabase(t *testing.T) string {
	t.Helper()
	directory := filepath.Join(t.TempDir(), "SongBoard \u6570\u636e #1")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(directory, "sususongboard.db")
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec("CREATE TABLE config (id INTEGER PRIMARY KEY, room_id TEXT, sing_prefix TEXT, fans_level INTEGER, sing_cd INTEGER, cooldown_seconds INTEGER, max_songs_per_user INTEGER, target_playlist_name TEXT, target_playlist_id INTEGER, kugou_enabled INTEGER, extra TEXT); INSERT INTO config VALUES (1, '123456789', '[song]', 0, 0, 1800, 3, '', 0, 0, '{}'); CREATE TABLE blacklist (id INTEGER PRIMARY KEY, entry_type TEXT, name TEXT, created_at INTEGER);")
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SUSUSONGBOARD_DB", path)
	t.Setenv("SUSUSONGBOARD_SETTINGS_DIR", t.TempDir())
	return path
}

func seedJSONPreferences(t *testing.T, settings boardSettings) []byte {
	t.Helper()
	data, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(os.Getenv("SUSUSONGBOARD_SETTINGS_DIR"), preferencesFilename)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return data
}

func querySQLiteSettings(path string) (string, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return "", err
	}
	defer db.Close()
	var data string
	err = db.QueryRow("SELECT data FROM nsgo_board_settings WHERE id=1").Scan(&data)
	return data, err
}

func savedSQLiteSettings(t *testing.T) string {
	t.Helper()
	data, err := querySQLiteSettings(os.Getenv("SUSUSONGBOARD_DB"))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestListenerWindowStartsWithoutNetwork(t *testing.T) {
	fixtureDatabase(t)
	app := nsgotest.Start(t, Root, nsgotest.Size(1000, 680))
	for _, query := range []string{"id:app-header", "id:room-sidebar", "id:room", "id:connect", "id:sing-prefix", "id:song-queue", "id:workbench-tabs", "id:status-footer"} {
		if !app.Exists(query) {
			t.Fatalf("workbench is missing %q: %s", query, app.Dump())
		}
	}
	if app.Find("id:connection").Text != "未连接" {
		t.Fatal("listener started without an explicit action")
	}
	if app.Exists("id:log-panel") {
		t.Fatal("empty log should be hidden")
	}
	if app.Exists("id:manual-song") || app.Exists("id:playlist-controls") {
		t.Fatal("music operations should be hidden in listener-only mode")
	}
	app.Press("id:tab-played")
	app.WaitFor("id:played-queue", time.Second)
	app.Press("id:tab-blacklist")
	app.WaitFor("id:blacklist-panel", time.Second)
	app.WaitFor("text:黑名单为空", time.Second)
	if app.Exists("id:blacklist-columns") || !app.Find("id:blacklist-add").Props.Disabled {
		t.Fatal("empty blacklist exposed columns or enabled empty submission")
	}
	app.Press("id:blacklist-type-singer")
	app.Type("id:blacklist-name", "blocked singer")
	app.Submit("id:blacklist-name")
	app.WaitFor("text:blocked singer", time.Second)
	app.WaitFor("text:全部歌曲", time.Second)
	app.WaitFor("id:blacklist-columns", time.Second)
	app.Press("role:button 移出黑名单")
	app.WaitFor("text:黑名单为空", time.Second)
	app.Press("id:tab-songs")
	app.Clear("id:room")
	app.Type("id:room", "not-a-room")
	app.Press("id:connect")
	app.WaitFor("text:房间号必须是至少 6 位数字", time.Second)
}

func TestWorkbenchNarrowLayoutAndPlatformSettings(t *testing.T) {
	fixtureDatabase(t)
	app := nsgotest.Start(t, Root, nsgotest.Size(390, 700))
	if app.Exists("id:room") {
		t.Fatal("narrow configuration should start collapsed")
	}
	app.Press("role:button 配置")
	app.WaitFor("id:room", time.Second)
	app.Press("id:settings")
	app.WaitFor("id:settings-dialog", time.Second)
	app.Press("id:settings-plugin")
	app.WaitFor("id:platform-settings", time.Second)
	for _, selector := range []string{"id:plugin-kugou", "id:plugin-netease", "id:plugin-none"} {
		if !app.Exists(selector) {
			t.Errorf("platform control missing: %s", selector)
		}
	}
	app.Press("id:close-settings")
	app.Resize(1000, 680)
	app.WaitFor("id:song-queue", time.Second)
}

func TestWorkbenchNativeScreenshot(t *testing.T) {
	if nsgotest.Target() != "macos" {
		t.Skip("native Mac rendering test")
	}
	fixtureDatabase(t)
	mock := &mockPlatforms{credentials: map[string]string{}, qrState: 1}
	seedJSONPreferences(t, boardSettings{Rules: rules{Template: "[song]", Repeat: 1800, Limit: 3}, Platform: adapter.NetEase})
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node { return boardRoot(scope, mock.services()) },
		nsgotest.Size(1000, 900))
	app.Screenshot("nsgo-workbench")
	app.Type("id:manual-song", "Preview request")
	app.Press("id:manual-add")
	app.WaitUntil(time.Second, func() bool { return app.Find("id:queue-count").Text == "队列 1" })
	app.WaitFor("text:已添加：Preview request", time.Second)
	app.Advance(250 * time.Millisecond)
	app.Screenshot("nsgo-workbench-queue")
	app.Advance(4 * time.Second)
	app.Press("id:settings")
	app.Press("id:settings-plugin")
	app.WaitFor("id:platform-settings", time.Second)
	app.WaitUntil(time.Second, func() bool { return !app.Find("id:login-qr").Props.Disabled })
	app.Press("id:login-qr")
	app.WaitFor("id:login-qr-image", time.Second)
	app.Screenshot("nsgo-platforms")
	app.Press("id:cancel-qr")
	app.Type("id:netease-cookie", "MUSIC_U=TEST_ONLY")
	app.Press("id:cookie-login")
	app.WaitUntil(time.Second, func() bool { return app.Exists("id:logout") })
	app.WaitFor("role:alert 网易云已登录", time.Second)
	app.Advance(250 * time.Millisecond)
	app.Screenshot("susu-settings-toast")
	app.Press("id:close-settings")
	app.Advance(250 * time.Millisecond)
	app.WaitForGone("id:settings-dialog", 2*time.Second)
	bindFirstPlaylist(t, app)
	app.Advance(4 * time.Second)
	app.Screenshot("susu-workbench-playlists")
	app.Focus("role:button 加入歌单")
	app.Advance(250 * time.Millisecond)
	app.WaitFor("text:加入歌单：Test song", time.Second)
	app.Screenshot("susu-song-tooltip")
	app.RightClick("text:Preview request")
	app.WaitFor("id:song-menu-dialog", time.Second)
	app.Screenshot("susu-song-actions")
	app.Press("id:close-song-menu")
	app.Advance(250 * time.Millisecond)
	app.WaitForGone("id:song-menu-dialog", 2*time.Second)
	app.Press("id:theme-toggle")
	app.Hover("id:app-header")
	app.Advance(250 * time.Millisecond)
	app.Screenshot("susu-workbench-light")
	app.Press("id:tab-blacklist")
	app.WaitFor("text:黑名单为空", time.Second)
	app.Press("id:blacklist-type-singer")
	app.Type("id:blacklist-name", "示例歌手")
	app.Press("id:blacklist-add")
	app.WaitFor("id:blacklist-columns", time.Second)
	app.Press("id:blacklist-type-song")
	app.Type("id:blacklist-name", "示例歌曲")
	app.Submit("id:blacklist-name")
	app.Advance(4 * time.Second)
	app.Screenshot("susu-blacklist")
	app.Press("id:settings")
	app.Press("id:settings-show-logs")
	app.Press("id:close-settings")
	app.Advance(250 * time.Millisecond)
	app.WaitForGone("id:settings-dialog", time.Second)
	if app.Exists("id:log-panel") {
		t.Fatal("empty log should stay hidden")
	}
	app.Press("id:tab-songs")
	app.Press("role:button 加入歌单")
	app.WaitFor("text:已加入平台歌单：Test song", time.Second)
	app.Advance(4 * time.Second)
	app.WaitFor("id:log-panel", time.Second)
	app.Press("id:log-toggle")
	app.WaitFor("id:messages", time.Second)
	app.WaitFor("text:已加入平台歌单：Test song", time.Second)
	app.Screenshot("susu-log-panel")
	app.Press("id:clear-logs")
	app.WaitForGone("id:log-panel", time.Second)
	app.Press("id:settings")
	app.Press("id:reset-session")
	app.Screenshot("susu-reset-confirmation")
	app.Press("id:cancel-reset-session")
	app.Press("id:close-settings")
	app.Advance(250 * time.Millisecond)
	app.WaitForGone("id:settings-dialog", time.Second)
	if output := os.Getenv("SONGBOARD_SCREENSHOT"); output != "" {
		if err := os.WriteFile(output, app.CapturePNG(), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

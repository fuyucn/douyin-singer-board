package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/sususongboard/nsgo-app/platform/adapter"
	"github.com/zalando/go-keyring"
	"rsc.io/qr"
)

type mockPlatforms struct {
	mu          sync.Mutex
	credentials map[string]string
	methods     []string
	resolved    []string
	failSave    bool
	unknownAdd  bool
	qrState     int
	close       func()
}

func (mock *mockPlatforms) services() platformServices {
	return platformServices{
		get: func(service, id string) (string, error) {
			mock.mu.Lock()
			defer mock.mu.Unlock()
			if service != credentialService {
				return "", errors.New("wrong credential namespace")
			}
			value, ok := mock.credentials[id]
			if !ok {
				return "", keyring.ErrNotFound
			}
			return value, nil
		},
		set: func(service, id, value string) error {
			mock.mu.Lock()
			defer mock.mu.Unlock()
			if mock.failSave {
				return errors.New("keychain locked")
			}
			mock.credentials[id] = value
			return nil
		},
		delete: func(service, id string) error {
			mock.mu.Lock()
			defer mock.mu.Unlock()
			delete(mock.credentials, id)
			return nil
		},
		call: func(_ context.Context, id, method string, arguments, output any) error {
			mock.mu.Lock()
			defer mock.mu.Unlock()
			mock.methods = append(mock.methods, id+":"+method)
			var result any
			switch method {
			case "playlists":
				result = []playlist{{ID: 11, Name: "Target", Count: 2}}
			case "loginCookie":
				result = session{Token: "MUSIC_U=TEST_ONLY", User: "account", Device: "-", Nickname: "Test account"}
			case "loginQrKey":
				code, _ := qr.Encode("TEST_ONLY", qr.M)
				result = loginChallenge{Key: "key", Image: base64.StdEncoding.EncodeToString(code.PNG())}
			case "loginQrCheck":
				result = map[string]any{"status": mock.qrState, "token": "TEST_ONLY", "userid": "account", "nickname": "Test account"}
			case "search":
				result = []track{{Name: "Test song", Artist: "Test artist", Key: "track1", Hash: "track1"}}
			case "resolvePlaylist":
				var request struct {
					Name string `json:"name"`
				}
				encoded, _ := json.Marshal(arguments)
				_ = json.Unmarshal(encoded, &request)
				mock.resolved = append(mock.resolved, request.Name)
				result = map[string]any{"listid": 12, "created": true}
			case "clearPlaylist":
				result = map[string]any{"listid": 13, "deleted": true}
			case "addTrack":
				if mock.unknownAdd {
					return errors.New("timeout after send")
				}
				result = map[string]any{"status": 1}
			default:
				return errors.New("unexpected platform operation")
			}
			encoded, err := json.Marshal(result)
			if err != nil {
				return err
			}
			return json.Unmarshal(encoded, output)
		},
	}
}

func TestAutoSyncUsesPlaylistNameEditedImmediatelyBeforePress(t *testing.T) {
	app, mock := startPlatformBoard(t, adapter.NetEase, true)
	bindFirstPlaylist(t, app)
	app.Clear("id:playlist-name")
	app.Type("id:playlist-name", "Target 411")
	app.Press("id:auto-sync")
	app.WaitFor("role:button 停止同步", time.Second)
	app.WaitFor("text:未找到同名歌单，已创建并开启自动同步：Target 411", time.Second)
	if got := app.Find("id:playlist-name").Text; got != "Target 411" {
		t.Fatalf("sync replaced the edited input with a stale playlist name: %q", got)
	}
	app.Press("id:auto-sync")
	app.WaitFor("role:button 自动同步", time.Second)
	app.Resize(390, 700)
	app.Resize(1000, 900)
	if got := app.Find("id:playlist-name").Text; got != "Target 411" {
		t.Fatalf("remounting the sidebar reset the playlist input: %q", got)
	}
	mock.mu.Lock()
	defer mock.mu.Unlock()
	if len(mock.resolved) == 0 || mock.resolved[len(mock.resolved)-1] != "Target 411" {
		t.Fatalf("sync resolved stale playlist name: %v", mock.resolved)
	}
}

func TestPlaylistWritesRejectStaleInputOrBinding(t *testing.T) {
	mock := &mockPlatforms{credentials: map[string]string{}}
	app, board := controllerHarness(t, mock.services())
	app.Post(func() {
		board.settings.Platform = adapter.NetEase
		board.account, board.verified = session{Token: "TEST_ONLY", User: "account"}, true
		board.playlists = []playlist{{ID: 11, Name: "Target"}}
		board.settings.Targets[adapter.NetEase] = playlistBinding{11, "Target", "account"}
		song, _ := board.matcher.AddManual("Test song")
		board.results = []track{{Name: "Test song", Key: "track1"}}
		actions := board.platformActions()
		for _, target := range []struct {
			name string
			id   int64
		}{{"Different target", 11}, {"Target", 12}, {"", 11}} {
			for _, action := range []string{"platform.clear", "platform.add"} {
				actions[action](&core.HostCall{Data: map[string]any{"name": target.name, "id": target.id, "song": song.ID, "key": "track1"}})
			}
		}
	})
	app.Settle()
	mock.mu.Lock()
	defer mock.mu.Unlock()
	for _, method := range mock.methods {
		if strings.HasSuffix(method, ":clearPlaylist") || strings.HasSuffix(method, ":addTrack") {
			t.Fatalf("a write targeted the previous playlist: %s", method)
		}
	}
}

func TestEditingPlaylistDuringAddStopsSubsequentSync(t *testing.T) {
	mock := &mockPlatforms{credentials: map[string]string{}}
	services := mock.services()
	invoke := services.call
	started, finish := make(chan struct{}), make(chan struct{})
	services.call = func(ctx context.Context, provider, method string, input, output any) error {
		if method == "addTrack" {
			close(started)
			select {
			case <-finish:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return invoke(ctx, provider, method, input, output)
	}
	app, board := controllerHarness(t, services)
	app.Post(func() {
		board.settings.Platform = adapter.NetEase
		board.account, board.verified = session{Token: "TEST_ONLY", User: "account"}, true
		board.playlists = []playlist{{ID: 11, Name: "Target"}}
		board.settings.Targets[adapter.NetEase] = playlistBinding{11, "Target", "account"}
		board.auto = true
		song, _ := board.matcher.AddManual("Test song")
		board.syncSong(song, track{Name: "Test song", Key: "track1"}, true)
	})
	app.WaitUntil(time.Second, func() bool {
		select {
		case <-started:
			return true
		default:
			return false
		}
	})
	app.Post(func() {
		board.platformActions()["platform.name"](&core.HostCall{Data: "Different target"})
	})
	app.Settle()
	close(finish)
	app.WaitUntil(time.Second, func() bool { return !board.busy })
	if board.auto || board.autoTimer != nil || board.target().ID != 0 || board.settings.Targets[adapter.NetEase].Name != "Different target" {
		t.Fatal("the in-flight add restored the old target or re-enabled auto-sync")
	}
}

func startPlatformBoard(t *testing.T, id string, loggedIn bool) (*nsgotest.App, *mockPlatforms) {
	t.Helper()
	fixtureDatabase(t)
	mock := &mockPlatforms{credentials: map[string]string{}, qrState: 4}
	if loggedIn {
		encoded, _ := json.Marshal(session{Token: "TEST_ONLY", User: "account", Device: "-", Nickname: "Test account"})
		mock.credentials[id] = string(encoded)
	}
	seedJSONPreferences(t, boardSettings{Rules: rules{Template: "[song]", Repeat: 1800, Limit: 3}, Platform: id})
	app := startTestApp(t, func(scope *core.Scope) core.Node {
		mock.close = scope.Dispose
		return boardRoot(scope, mock.services())
	},
		nsgotest.Size(1000, 900),
		nsgotest.Environment(core.Environment{OS: core.OSMacOS, Idiom: core.IdiomDesktop}))
	app.Press("id:settings")
	app.Press("id:settings-plugin")
	app.WaitFor("id:platform-settings", time.Second)
	app.WaitUntil(time.Second, func() bool { return !app.Find("id:plugin-kugou").Props.Disabled })
	if loggedIn {
		app.Press("id:close-settings")
		app.Advance(250 * time.Millisecond)
		app.WaitForGone("id:settings-dialog", 2*time.Second)
	}
	return app, mock
}

func bindFirstPlaylist(t *testing.T, app *nsgotest.App) {
	t.Helper()
	app.WaitFor("id:playlist-picker", time.Second)
	app.Press("id:playlist-picker")
	app.WaitFor("id:bind-11", time.Second)
	app.Press("id:bind-11")
	app.WaitUntil(time.Second, func() bool { return strings.Contains(app.Find("id:bound-playlist").Text, "ID 11") })
	app.Press("id:close-playlist-picker")
	app.Advance(250 * time.Millisecond)
	app.WaitForGone("id:playlist-picker-dialog", 2*time.Second)
}

func TestBothPlatformSearchBindAddAndRestoreUI(t *testing.T) {
	for _, id := range []string{adapter.KuGou, adapter.NetEase} {
		t.Run(id, func(t *testing.T) {
			app, mock := startPlatformBoard(t, id, true)
			bindFirstPlaylist(t, app)
			app.Type("id:manual-song", "Test song")
			app.Press("id:manual-add")
			app.WaitUntil(time.Second, func() bool { return app.Find("id:queue-count").Text == "队列 1" })
			app.WaitUntil(time.Second, func() bool { return !app.Find("role:button 加入歌单").Props.Disabled })
			app.Press("role:button 加入歌单")
			app.WaitUntil(time.Second, func() bool { return app.Find("id:queue-count").Text == "队列 0" })
			app.Press("id:tab-played")
			if !app.Exists("text:Test artist") {
				t.Fatal("confirmed track did not move to played history")
			}
			stored := savedSQLiteSettings(t)
			if strings.Contains(stored, "TEST_ONLY") {
				t.Fatal("credential leaked into preferences")
			}
			mock.mu.Lock()
			methods := strings.Join(mock.methods, ",")
			mock.mu.Unlock()
			if !strings.Contains(methods, id+":addTrack") {
				t.Fatal("no real platform add action")
			}
		})
	}
}

func TestBothPlatformQRLoginAndCancellation(t *testing.T) {
	for _, id := range []string{adapter.KuGou, adapter.NetEase} {
		t.Run(id, func(t *testing.T) {
			app, mock := startPlatformBoard(t, id, false)
			app.Press("id:login-qr")
			app.WaitFor("id:login-qr-image", time.Second)
			app.Clock.Advance(2 * time.Second)
			app.WaitUntil(time.Second, func() bool { return strings.Contains(app.Find("id:platform-account").Text, "Test account") })
			mock.mu.Lock()
			raw := mock.credentials[id]
			mock.mu.Unlock()
			if !strings.Contains(raw, "TEST_ONLY") {
				t.Fatal("QR login was not stored in keyring")
			}
		})
	}
}

func TestCookieCredentialFailureDoesNotPersistSecrets(t *testing.T) {
	app, mock := startPlatformBoard(t, adapter.NetEase, false)
	mock.mu.Lock()
	mock.failSave = true
	mock.mu.Unlock()
	app.Type("id:netease-cookie", "MUSIC_U=TEST_ONLY")
	if !app.Find("id:netease-cookie").Input.Masked {
		t.Fatal("credential input is not masked")
	}
	app.Press("id:cookie-login")
	app.WaitFor("text:无法保存登录凭据", time.Second)
	if app.Find("id:netease-cookie").Text != "" {
		t.Fatal("credential input retained submitted secret")
	}
	if strings.Contains(fmt.Sprint(app.Texts()), "TEST_ONLY") {
		t.Fatal("credential leaked to status text")
	}
	value := savedSQLiteSettings(t)
	if strings.Contains(value, "TEST_ONLY") {
		t.Fatal("credential stored outside keyring")
	}
}

func TestPendingPlaylistAddOnlyShowsWarningAfterUnknownResult(t *testing.T) {
	fixtureDatabase(t)
	previousKey := writeKey(adapter.NetEase, "account", 11, "previous-track")
	seedJSONPreferences(t, boardSettings{
		Rules:       rules{Template: "[song]"},
		Platform:    adapter.NetEase,
		Targets:     map[string]playlistBinding{adapter.NetEase: {ID: 11, Name: "Target", Account: "account"}},
		Unconfirmed: map[string]string{previousKey: "Earlier song"},
	})
	credential, err := json.Marshal(session{Token: "TEST_ONLY", User: "account", Nickname: "Test account"})
	if err != nil {
		t.Fatal(err)
	}
	mock := &mockPlatforms{credentials: map[string]string{adapter.NetEase: string(credential)}}
	services := mock.services()
	invoke := services.call
	started, reply := make(chan struct{}, 1), make(chan struct{})
	services.call = func(ctx context.Context, provider, method string, input, output any) error {
		if method == "resolvePlaylist" {
			return json.Unmarshal([]byte("{\"listid\":11}"), output)
		}
		if method == "addTrack" {
			started <- struct{}{}
			select {
			case <-reply:
				return errors.New("timeout after send")
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return invoke(ctx, provider, method, input, output)
	}
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node { return boardRoot(scope, services) }, nsgotest.Size(1000, 960))
	app.WaitFor("id:playlist-name", time.Second)
	app.Type("id:manual-song", "Different request for the same track")
	app.Press("id:manual-add")
	app.Type("id:manual-song", "Pending song")
	app.Press("id:manual-add")
	app.WaitUntil(time.Second, func() bool {
		buttons := app.Query("role:button 加入歌单")
		return len(buttons) == 2 && !buttons[0].Props.Disabled && !buttons[1].Props.Disabled
	})
	otherAdd := app.Query("role:button 加入歌单")[1]
	otherSelector, otherAddOpacity := "id:"+otherAdd.Props.TestID, otherAdd.Style.Opacity
	app.Press("id:auto-sync")
	app.WaitFor("role:button 停止同步", time.Second)
	app.Press("id:settings")
	app.Press("id:settings-plugin")
	app.WaitFor("text:「Earlier song」加入结果未知", time.Second)
	opacity := app.Find("id:plugin-kugou").Style.Opacity
	app.Advance(2 * time.Second)
	app.WaitUntil(time.Second, func() bool {
		select {
		case <-started:
			return true
		default:
			return false
		}
	})
	app.Settle()
	var saved boardSettings
	if err := json.Unmarshal([]byte(savedSQLiteSettings(t)), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Unconfirmed[writeKey(adapter.NetEase, "account", 11, "track1")] != "Pending song" {
		t.Fatal("playlist write was not protected on disk")
	}
	if app.Exists("text:「Pending song」加入结果未知") || !app.Exists("text:「Earlier song」加入结果未知") {
		t.Fatal("settings display did not distinguish in-flight writes from unknown outcomes")
	}
	if switchButton := app.Find("id:plugin-kugou"); !switchButton.Props.Disabled || switchButton.Style.Opacity != opacity {
		t.Fatal("plugin switching must stay locked without dimming during a playlist add")
	}
	if locked := app.FindMounted(otherSelector); !locked.Props.Disabled || locked.Style.Opacity != otherAddOpacity {
		t.Fatalf("same-track row must stay locked without dimming: disabled=%t, opacity=%v, previous=%v", locked.Props.Disabled, locked.Style.Opacity, otherAddOpacity)
	}
	close(reply)
	app.WaitFor("text:「Pending song」加入结果未知", time.Second)
	app.WaitFor("role:alert 加入结果未知，已停止自动同步", time.Second)
}

func TestClearPlaylistCanOpenWhileAnAutomaticAddIsPending(test *testing.T) {
	fixtureDatabase(test)
	seedJSONPreferences(test, boardSettings{Rules: rules{Template: "[song]"}, Platform: adapter.KuGou})
	mock := &mockPlatforms{credentials: map[string]string{
		adapter.KuGou: "{\"token\":\"TEST_ONLY\",\"userid\":\"account\"}",
	}}
	services := mock.services()
	invoke := services.call
	finishAdd := make(chan struct{})
	clearTargets := make(chan map[string]any, 1)
	services.call = func(ctx context.Context, provider, method string, input, output any) error {
		if method == "addTrack" {
			select {
			case <-finishAdd:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if method == "clearPlaylist" {
			select {
			case clearTargets <- input.(map[string]any):
			default:
				return errors.New("duplicate clear operation in test")
			}
		}
		return invoke(ctx, provider, method, input, output)
	}
	app := nsgotest.Start(test, func(scope *core.Scope) core.Node { return boardRoot(scope, services) }, nsgotest.Size(1000, 900))
	bindFirstPlaylist(test, app)
	app.Type("id:manual-song", "Pending song")
	app.Press("id:manual-add")
	app.WaitFor("text:Test song · Test artist", time.Second)
	app.Press("id:auto-sync")
	app.WaitFor("role:button 停止同步", time.Second)
	app.Advance(2 * time.Second)
	app.WaitFor("text:正在加入歌单…", time.Second)
	app.Press("id:clear-platform-playlist")
	app.WaitFor("text:当前正在加歌，完成后即可确认清理。", time.Second)
	if app.Enabled("id:confirm-clear-platform") || !app.Enabled("id:cancel-clear-platform") || len(clearTargets) != 0 {
		test.Fatal("the pending add must block confirmation but not cancellation")
	}
	pressCenteredClearDialogButton(test, app, "id:cancel-clear-platform")
	app.WaitForGone("id:clear-playlist-dialog", time.Second)
	app.Press("id:clear-platform-playlist")
	app.WaitFor("id:confirm-clear-platform", time.Second)
	close(finishAdd)
	app.WaitUntil(time.Second, func() bool { return app.Enabled("id:confirm-clear-platform") })
	if len(clearTargets) != 0 {
		test.Fatal("clear was sent without an explicit confirmation")
	}
	pressCenteredClearDialogButton(test, app, "id:confirm-clear-platform")
	app.WaitFor("text:已绑定歌单：Target", time.Second)
	select {
	case target := <-clearTargets:
		if target["name"] != "Target" || target["currentId"] != int64(12) {
			test.Fatal("clear did not use the confirmed playlist")
		}
	default:
		test.Fatal("confirm did not start the clear operation")
	}
}

func TestClearPlaylistRequiresConfirmationAndStopsSync(t *testing.T) {
	app, mock := startPlatformBoard(t, adapter.NetEase, true)
	app.Resize(1000, 680)
	bindFirstPlaylist(t, app)
	app.Clear("id:playlist-name")
	app.Type("id:playlist-name", "Target")
	app.WaitUntil(time.Second, func() bool { return app.Find("id:playlist-name").Text == "Target" })
	app.Press("id:auto-sync")
	app.WaitUntil(time.Second, func() bool { return !app.Find("id:auto-sync").Props.Disabled })
	app.WaitFor("role:button 停止同步", time.Second)
	var background image.Image
	if nsgotest.Target() == "macos" {
		app.Advance(4 * time.Second)
		background = app.Capture()
	}
	app.Press("id:clear-platform-playlist")
	app.WaitFor("id:confirm-clear-platform", time.Second)
	if background != nil {
		app.Advance(250 * time.Millisecond)
		bounds := background.Bounds()
		point := image.Pt(bounds.Max.X-20, bounds.Min.Y+bounds.Dy()/2)
		if app.Capture().At(point.X, point.Y) != background.At(point.X, point.Y) {
			t.Fatal("the clear confirmation darkened the workbench")
		}
		app.Screenshot("clear-playlist-confirmation")
	}
	app.PressAt("id:clear-playlist-dialog", core.Point{X: 16, Y: 16})
	app.WaitFor("id:confirm-clear-platform", time.Second)
	app.PressAt("id:clear-playlist-backdrop", core.Point{X: 20, Y: 20})
	app.WaitForGone("id:clear-playlist-dialog", time.Second)
	app.Press("id:clear-platform-playlist")
	app.WaitFor("id:cancel-clear-platform", time.Second)
	pressCenteredClearDialogButton(t, app, "id:cancel-clear-platform")
	app.WaitForGone("id:clear-playlist-dialog", time.Second)
	mock.mu.Lock()
	before := strings.Join(mock.methods, ",")
	mock.mu.Unlock()
	if strings.Contains(before, "clearPlaylist") {
		t.Fatal("playlist cleared without explicit confirmation")
	}
	app.Press("id:clear-platform-playlist")
	app.WaitFor("id:confirm-clear-platform", time.Second)
	pressCenteredClearDialogButton(t, app, "id:confirm-clear-platform")
	app.WaitFor("text:已绑定歌单：Target", time.Second)
	app.WaitForGone("id:clear-playlist-dialog", time.Second)
	if app.Find("id:playlist-name").Text != "Target" {
		t.Fatalf("playlist cleanup cleared the input name: %q", app.Find("id:playlist-name").Text)
	}
	app.Press("id:playlist-picker")
	app.WaitUntil(time.Second, func() bool { return strings.Contains(app.Find("id:bound-playlist").Text, "ID 13") })
	app.Press("id:close-playlist-picker")
	if !app.Exists("role:button 自动同步") {
		t.Fatal("sync resumed after destructive playlist operation")
	}
	mock.mu.Lock()
	defer mock.mu.Unlock()
	if calls := strings.Count(strings.Join(mock.methods, ","), ":clearPlaylist"); calls != 1 {
		t.Fatalf("confirm sent %d clear operations, want 1", calls)
	}
}

func pressCenteredClearDialogButton(t *testing.T, app *nsgotest.App, selector string) {
	t.Helper()
	const backdrop = "id:clear-playlist-backdrop"
	viewport := app.Find(backdrop).Frame.Size
	dialog := app.Find("id:clear-playlist-dialog")
	button := app.Find(selector)
	centered := core.Point{
		X: (viewport.Width - dialog.Frame.Size.Width) / 2,
		Y: (viewport.Height - dialog.Frame.Size.Height) / 2,
	}
	deltaX, deltaY := dialog.Frame.Origin.X-centered.X, dialog.Frame.Origin.Y-centered.Y
	if deltaX < -1 || deltaX > 1 || deltaY < -1 || deltaY > 1 {
		t.Fatalf("clear dialog hit frame starts at %v, want centered at %v", dialog.Frame.Origin, centered)
	}
	position := core.Point{
		X: centered.X + button.Frame.Size.Width/2,
		Y: centered.Y + button.Frame.Size.Height/2,
	}
	for view := button; view != dialog; view = view.Parent {
		position.X += view.Frame.Origin.X
		position.Y += view.Frame.Origin.Y
	}
	app.PressAt(backdrop, position)
}

func TestUnknownAddOutcomeCannotBeAutomaticallyRetried(t *testing.T) {
	app, mock := startPlatformBoard(t, adapter.NetEase, true)
	bindFirstPlaylist(t, app)
	mock.mu.Lock()
	mock.unknownAdd = true
	mock.mu.Unlock()
	app.Type("id:manual-song", "Test song")
	app.Press("id:manual-add")
	app.WaitUntil(time.Second, func() bool { return !app.Find("role:button 加入歌单").Props.Disabled })
	app.Press("id:auto-sync")
	app.WaitUntil(time.Second, func() bool { return !app.Find("id:auto-sync").Props.Disabled })
	app.Clock.Advance(2 * time.Second)
	app.WaitFor("text:加入结果未知，已停止自动同步", time.Second)
	app.Clock.Advance(time.Minute)
	mock.mu.Lock()
	calls := strings.Count(strings.Join(mock.methods, ","), ":addTrack")
	mock.mu.Unlock()
	if calls != 1 {
		t.Fatalf("ambiguous write replayed %d times", calls)
	}
	if app.Find("id:queue-count").Text != "队列 1" {
		t.Fatal("unconfirmed add was recorded as success")
	}
}

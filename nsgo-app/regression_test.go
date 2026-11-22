package main

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/sususongboard/nsgo-app/platform/adapter"
)

func TestCredentialReplacementFailurePreservesOldEntry(t *testing.T) {
	original := "existing credential"
	deleted := false
	services := platformServices{
		get:    func(string, string) (string, error) { return original, nil },
		set:    func(string, string, string) error { return errors.New("locked") },
		delete: func(string, string) error { deleted = true; return nil },
	}
	err := services.save(adapter.NetEase, session{Token: "new credential", User: "account"})
	if err == nil || deleted {
		t.Fatal("failed credential replacement removed the previous entry")
	}
}

func TestCancelledQRCodeGenerationCannotSaveLogin(t *testing.T) {
	fixtureDatabase(t)
	mock := &mockPlatforms{credentials: map[string]string{}, qrState: 4}
	services := mock.services()
	base := services.call
	cancelled := make(chan struct{})
	services.call = func(ctx context.Context, id, method string, input, output any) error {
		if method == "loginQrKey" {
			<-ctx.Done()
			close(cancelled)
			return ctx.Err()
		}
		return base(ctx, id, method, input, output)
	}
	seedJSONPreferences(t, boardSettings{Rules: rules{Template: "[song]"}, Platform: adapter.NetEase})
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node { return boardRoot(scope, services) }, nsgotest.Size(1000, 900))
	app.Press("id:settings")
	app.Press("id:settings-plugin")
	app.WaitUntil(time.Second, func() bool { return !app.Find("id:login-qr").Props.Disabled })
	app.Press("id:login-qr")
	app.WaitFor("id:cancel-qr", time.Second)
	app.Press("id:cancel-qr")
	app.WaitUntil(time.Second, func() bool {
		select {
		case <-cancelled:
			return true
		default:
			return false
		}
	})
	if app.Exists("id:qr-status") {
		t.Fatal("cancelled QR status remained visible")
	}
	mock.mu.Lock()
	count := len(mock.credentials)
	mock.mu.Unlock()
	if count != 0 {
		t.Fatal("cancelled login persisted credentials")
	}
}

func TestAutoSyncReschedulesSongsInCooldown(t *testing.T) {
	fixtureDatabase(t)
	mock := &mockPlatforms{credentials: map[string]string{}}
	var board *boardState
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
		board = newBoard(scope, mock.services())
		return core.Text{Content: "test scheduler"}
	})
	app.Post(func() {
		board.settings.Platform = adapter.NetEase
		board.settings.Rules.Repeat = 1800
		board.account = session{Token: "TEST_ONLY", User: "account"}
		board.verified = true
		board.playlists = []playlist{{ID: 11, Name: "Target"}}
		board.settings.Targets[adapter.NetEase] = playlistBinding{ID: 11, Name: "Target", Account: "account"}
		song, _ := board.matcher.AddManual("Test song")
		board.accepted = []playedSong{{Song: song, At: time.Now()}}
		board.auto = true
		board.scheduleSync()
	})
	app.Settle()
	app.WaitUntil(time.Second, func() bool { return board.matches["Test song"].Status == "found" })
	app.Clock.Advance(2 * time.Second)
	app.Settle()
	if board.autoTimer == nil {
		t.Fatal("cooldown prevented future auto-sync scheduling")
	}
	app.Post(func() { board.accepted[0].At = time.Now().Add(-time.Hour) })
	app.Settle()
	app.Clock.Advance(2 * time.Second)
	app.WaitUntil(time.Second, func() bool { return len(board.played) == 1 })
}

func TestUnconfirmedWriteSurvivesRestartAndNewQueueRow(t *testing.T) {
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
	app.Post(mock.close)
	app.Settle()
	reopened := nsgotest.Start(t, func(scope *core.Scope) core.Node { return boardRoot(scope, mock.services()) },
		nsgotest.Size(1000, 900))
	reopened.Press("id:settings")
	reopened.Press("id:settings-plugin")
	reopened.WaitUntil(time.Second, func() bool { return strings.Contains(reopened.Find("id:platform-account").Text, "Test account") })
	reopened.Press("id:close-settings")
	reopened.Type("id:manual-song", "Test song")
	reopened.Press("id:manual-add")
	reopened.WaitFor("text:Test song · Test artist", time.Second)
	reopened.Press("id:auto-sync")
	reopened.WaitUntil(time.Second, func() bool { return !reopened.Find("id:auto-sync").Props.Disabled })
	reopened.Clock.Advance(2 * time.Second)
	reopened.WaitFor("text:此歌曲有未确认的加入记录", time.Second)
	mock.mu.Lock()
	count := strings.Count(strings.Join(mock.methods, ","), ":addTrack")
	mock.mu.Unlock()
	if count != 1 {
		t.Fatalf("replayed unconfirmed mutation after restart: %d", count)
	}
}

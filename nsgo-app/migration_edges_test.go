package main

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/sususongboard/nsgo-app/platform/adapter"
	"github.com/sususongboard/nsgo-app/queue"
)

func controllerHarness(t *testing.T, services platformServices) (*nsgotest.App, *boardState) {
	t.Helper()
	fixtureDatabase(t)
	var board *boardState
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
		board = newBoard(scope, services)
		return core.Text{Content: "migration edge controller"}
	})
	return app, board
}

func TestNSHDeduplicationCoversChatManualAndPlayed(t *testing.T) {
	app, board := controllerHarness(t, platformServices{})
	app.Post(func() {
		first := board.matcher.Match(queue.ChatMessage{ID: "first", UserID: "viewer", Content: "Same song"})
		if first.Added == nil || !board.admitSong(*first.Added) {
			t.Fatal("initial request rejected")
		}
		second := board.matcher.Match(queue.ChatMessage{ID: "second", UserID: "other", Content: "Same song"})
		if second.Added == nil || board.admitSong(*second.Added) {
			t.Fatal("duplicate chat admitted")
		}
		manual, _ := board.matcher.AddManual("Same song")
		if board.admitSong(manual) || len(board.matcher.Queue()) != 1 {
			t.Fatal("duplicate manual request admitted")
		}
		board.matcher.RemoveByID(first.Added.ID)
		board.played = []playedSong{{Song: *first.Added, At: time.Now()}}
		third := board.matcher.Match(queue.ChatMessage{ID: "third", UserID: "other", Content: "Same song"})
		if third.Added == nil || board.admitSong(*third.Added) {
			t.Fatal("played request admitted again")
		}
		manual, _ = board.matcher.AddManual("Same song")
		if board.admitSong(manual) || len(board.matcher.Queue()) != 0 {
			t.Fatal("manual request bypassed played-name deduplication")
		}
	})
	app.Settle()
}

func TestLatePlaylistSuccessDoesNotResurrectDeletedOrClearedRows(t *testing.T) {
	for _, clearQueue := range []bool{false, true} {
		t.Run(map[bool]string{false: "remove", true: "clear"}[clearQueue], func(t *testing.T) {
			started, finish := make(chan struct{}), make(chan struct{})
			mock := &mockPlatforms{credentials: map[string]string{}}
			services := mock.services()
			original := services.call
			services.call = func(ctx context.Context, provider, method string, input, output any) error {
				if method == "addTrack" {
					close(started)
					select {
					case <-finish:
					case <-ctx.Done():
						return ctx.Err()
					}
				}
				return original(ctx, provider, method, input, output)
			}
			app, board := controllerHarness(t, services)
			var song queue.Song
			app.Post(func() {
				board.settings.Platform = adapter.NetEase
				board.account, board.verified = session{Token: "TEST_ONLY", User: "account"}, true
				board.playlists = []playlist{{ID: 11, Name: "Target"}}
				board.settings.Targets[adapter.NetEase] = playlistBinding{ID: 11, Name: "Target", Account: "account"}
				song, _ = board.matcher.AddManual("Test song")
				board.syncSong(song, track{Name: "Test song", Key: "track1"}, false)
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
				if clearQueue {
					board.matcher.Clear()
				} else {
					board.matcher.RemoveByID(song.ID)
				}
			})
			app.Settle()
			close(finish)
			app.WaitUntil(time.Second, func() bool { return len(board.accepted) == 1 })
			if len(board.matcher.Queue()) != 0 || len(board.played) != 0 || len(board.settings.Unconfirmed) != 0 {
				t.Fatal("late response revived a row or lost the success receipt")
			}
		})
	}
}

func TestEagerSearchRetriesAreBoundedAndCancelled(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(map[bool]string{false: "bounded", true: "cancelled"}[cancel], func(t *testing.T) {
			var calls atomic.Int32
			services := platformServices{call: func(context.Context, string, string, any, any) error {
				calls.Add(1)
				return errors.New("transient search error")
			}}
			app, board := controllerHarness(t, services)
			app.Post(func() {
				board.settings.Platform = adapter.KuGou
				_, _ = board.matcher.AddManual("Retry song")
				board.publish()
			})
			app.WaitUntil(time.Second, func() bool { return board.matches["Retry song"].Status == "error" })
			if cancel {
				app.Post(func() { board.cancelPlatform(); board.settings.Platform = "" })
				app.Settle()
			} else {
				for attempt := 1; attempt <= 3; attempt++ {
					app.Advance(time.Duration(attempt) * 2 * time.Second)
					app.WaitUntil(time.Second, func() bool {
						return board.matches["Retry song"].Attempts == attempt+1 && board.matches["Retry song"].Status == "error"
					})
				}
			}
			app.Advance(time.Minute)
			expected := int32(4)
			if cancel {
				expected = 1
			}
			if calls.Load() != expected {
				t.Fatalf("unexpected retry count: %d, want %d", calls.Load(), expected)
			}
		})
	}
}

func TestOldSearchThatIgnoresCancellationCannotOverwriteNewProvider(t *testing.T) {
	started, finish := make(chan struct{}), make(chan struct{})
	var oldDone atomic.Bool
	services := platformServices{call: func(_ context.Context, provider, _ string, _ any, output any) error {
		if provider == adapter.KuGou {
			close(started)
			<-finish
			defer oldDone.Store(true)
		}
		data, _ := json.Marshal([]track{{Name: provider, Key: provider}})
		return json.Unmarshal(data, output)
	}}
	app, board := controllerHarness(t, services)
	app.Post(func() {
		board.settings.Platform = adapter.KuGou
		_, _ = board.matcher.AddManual("Provider song")
		board.publish()
	})
	app.WaitUntil(time.Second, func() bool {
		select {
		case <-started:
			return true
		default:
			return false
		}
	})
	app.Post(func() { board.cancelPlatform(); board.settings.Platform = adapter.NetEase; board.publish() })
	app.WaitUntil(time.Second, func() bool { return board.matches["Provider song"].Track.Name == adapter.NetEase })
	close(finish)
	app.WaitUntil(time.Second, oldDone.Load)
	app.Settle()
	if board.matches["Provider song"].Track.Name != adapter.NetEase {
		t.Fatal("late old-provider match replaced the current match")
	}
}

func TestStoppingDuringPlaylistResolveDoesNotEnableSyncOnLateSuccess(t *testing.T) {
	started, finish := make(chan struct{}), make(chan struct{})
	mock := &mockPlatforms{credentials: map[string]string{}}
	services := mock.services()
	original := services.call
	services.call = func(ctx context.Context, provider, method string, input, output any) error {
		if method == "resolvePlaylist" {
			close(started)
			select {
			case <-finish:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return original(ctx, provider, method, input, output)
	}
	app, board := controllerHarness(t, services)
	app.Post(func() {
		board.settings.Platform = adapter.NetEase
		board.account, board.verified = session{Token: "TEST_ONLY", User: "account"}, true
		board.updatePlaylist("resolvePlaylist", "Target")
		board.syncAfterResolve = true
	})
	app.WaitUntil(time.Second, func() bool {
		select {
		case <-started:
			return true
		default:
			return false
		}
	})
	app.Post(board.stopSync)
	app.Settle()
	close(finish)
	app.WaitUntil(time.Second, func() bool { return !board.busy })
	if board.auto || board.syncAfterResolve || board.target().ID != 12 {
		t.Fatal("late resolve ignored the explicit stop")
	}
}

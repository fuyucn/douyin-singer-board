package main

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/sususongboard/nsgo-app/platform/adapter"
	"github.com/sususongboard/nsgo-app/store"
)

func TestSongRequestSettingsAndManualQueueFlow(t *testing.T) {
	path := fixtureDatabase(t)
	before, err := store.LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	var root *core.Scope
	mock := &mockPlatforms{credentials: map[string]string{}}
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node { root = scope; return boardRoot(scope, mock.services()) }, nsgotest.Size(1000, 780))
	if app.Find("id:sing-prefix").Text != "[song]" {
		t.Fatal("legacy template did not load")
	}
	app.Press("id:settings")
	app.Press("id:settings-plugin")
	app.Press("id:plugin-kugou")
	app.WaitFor("id:manual-song", time.Second)
	app.Press("id:close-settings")
	app.Type("id:manual-song", "Test request")
	app.Press("id:manual-add")
	app.WaitUntil(time.Second, func() bool { return app.Find("id:queue-count").Text == "队列 1" })
	app.Clear("id:sing-prefix")
	app.Type("id:sing-prefix", "点歌[space][song]")
	if app.Exists("id:save-config") {
		t.Fatal("song request rules should not require a manual save button")
	}
	app.Advance(500 * time.Millisecond)
	value := savedSQLiteSettings(t)
	var saved boardSettings
	if json.Unmarshal([]byte(value), &saved) != nil || saved.Rules.Template != "点歌[space][song]" {
		t.Fatal("NSGo preferences did not save")
	}
	app.Press("role:button 移除歌曲")
	app.WaitForGone("id:queue-count", time.Second)
	app.Type("id:manual-song", "Next request")
	app.Press("id:manual-add")
	app.Press("id:settings")
	app.Press("id:reset-session")
	if app.Find("id:queue-count").Text != "队列 1" {
		t.Fatal("reset occurred before confirmation")
	}
	app.Press("id:cancel-reset-session")
	app.WaitForGone("id:confirm-reset-session", time.Second)
	app.Press("id:reset-session")
	app.Press("id:confirm-reset-session")
	app.WaitForGone("id:queue-count", time.Second)
	after, err := store.LoadConfig(path)
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatal("the legacy settings or blacklist changed")
	}
	app.Post(root.Dispose)
	app.Settle()
	reopened := nsgotest.Start(t, func(scope *core.Scope) core.Node { return boardRoot(scope, mock.services()) }, nsgotest.Size(1000, 780))
	if saved.Platform != adapter.KuGou {
		t.Fatal("selected platform did not persist")
	}
	if reopened.Find("id:sing-prefix").Text != saved.Rules.Template {
		t.Fatal("NSGo preferences did not restore")
	}
}

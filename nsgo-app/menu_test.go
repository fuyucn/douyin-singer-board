package main

import (
	"testing"
	"time"

	"github.com/sususongboard/nsgo-app/platform/adapter"
)

func TestSongMenuAlternativeMatchBlacklistAndPlayedRemoval(t *testing.T) {
	app, _ := startPlatformBoard(t, adapter.NetEase, true)
	bindFirstPlaylist(t, app)
	app.Type("id:manual-song", "Alternative title")
	app.Press("id:manual-add")
	app.WaitFor("text:Test song · Test artist", time.Second)
	app.RightClick("text:Alternative title")
	app.WaitFor("id:song-menu-dialog", time.Second)
	app.Press("id:platform-search")
	app.WaitFor("id:add-result-track1", time.Second)
	app.Press("id:add-result-track1")
	app.WaitUntil(time.Second, func() bool { return app.Find("id:queue-count").Text == "队列 0" })
	app.Press("id:close-song-menu")
	app.Press("id:tab-played")
	app.Press("role:button 歌曲操作")
	app.Press("id:blacklist-matched-artist")
	app.Press("id:blacklist-matched-song")
	app.Press("id:close-song-menu")
	app.Advance(4 * time.Second)
	app.Press("id:tab-blacklist")
	if len(app.Query("text:Test artist")) != 2 {
		t.Fatal("expected the singer entry and the matched song's artist")
	}
	app.WaitFor("text:Test song", time.Second)
	app.Press("id:tab-played")
	app.RightClick("text:Alternative title")
	app.Press("id:delete-song-menu")
	app.WaitFor("text:暂无已点歌曲", time.Second)
}

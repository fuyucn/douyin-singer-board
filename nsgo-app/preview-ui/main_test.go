package main

import (
	"slices"
	"testing"

	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestPreviewWorkbenchRenders(t *testing.T) {
	app := nsgotest.Start(t, Root, nsgotest.Size(1000, 680))
	for _, text := range []string{"SUSUSongBoard", "直播间配置", "点歌规则", "手动点歌", "七里香", "稻香", "日志"} {
		if !slices.Contains(app.Texts(), text) {
			t.Errorf("preview UI did not render %q; visible text: %q", text, app.Texts())
		}
	}
	for _, query := range []string{"text:点歌列表 (3)", "text:已点歌单 (0)", "text:黑名单 (0)"} {
		if !app.Exists(query) {
			t.Errorf("preview UI is missing %q", query)
		}
	}
}

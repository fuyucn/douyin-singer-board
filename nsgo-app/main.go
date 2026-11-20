package main

import (
	"embed"

	"github.com/nsgo-dev/nsgo"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/tsx/compiler"
	tsxui "github.com/nsgo-dev/nsgo/tsx/ui"
)

//go:embed App.tsx Controls.tsx Platforms.tsx WorkbenchPanels.tsx assets/logo.png nsgo.yaml theme.yaml
var sources embed.FS

var renderBoard = compiler.App(sources, "App.tsx")

func init() {
	stop, err := core.ParseSVG([]byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/></svg>`))
	if err != nil {
		panic(err)
	}
	tsxui.Icons(map[string]func() *core.SVG{
		"sun": lucide.Sun, "moon": lucide.Moon, "settings": lucide.Settings,
		"help": lucide.CircleQuestionMark, "play": lucide.Play, "stop": func() *core.SVG { return stop },
		"music": lucide.Music2, "list-plus": lucide.ListPlus, "copy": lucide.Copy,
		"trash": lucide.Trash, "refresh": lucide.RefreshCw, "search": lucide.Search,
		"close": lucide.X, "loader": lucide.LoaderCircle, "down": lucide.ChevronDown,
		"up": lucide.ChevronUp, "ban": lucide.Ban, "list": lucide.ListMusic,
		"save": lucide.Save,
		"plus": lucide.Plus, "check": lucide.Check,
	})
}

func main() { nsgo.Run(Root, nsgo.WindowSize(1000, 680)) }

func Root(scope *core.Scope) core.Node {
	return boardRoot(scope, platformServices{})
}

func boardRoot(scope *core.Scope, services platformServices) core.Node {
	return boardRootWithUpdates(scope, services, appUpdatesEnabled())
}

func boardRootWithUpdates(scope *core.Scope, services platformServices, updatesEnabled bool) core.Node {
	board := newBoard(scope, services)
	board.updatesEnabled = updatesEnabled
	scope.ProvideHost(board.host)
	board.host.Handle("board.snapshot", func(call *core.HostCall) { call.Resolve(board.snapshot()) })
	for name, handle := range board.actions() {
		board.host.Handle(name, handle)
	}
	if board.settings.Platform != "" && !board.settingsInvalid {
		scope.Post(board.restoreSession)
	}
	return renderBoard(scope)
}

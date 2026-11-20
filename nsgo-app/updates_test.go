package main

import (
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestUpdateCheckInAbout(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		name := "ordinary package"
		if enabled {
			name = "signed package"
		}
		t.Run(name, func(t *testing.T) {
			fixtureDatabase(t)
			app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
				return boardRootWithUpdates(scope, platformServices{}, enabled)
			}, nsgotest.Size(1000, 780))
			app.Press("id:settings")
			app.Press("id:settings-about")
			if !enabled {
				app.WaitFor("id:updates-unavailable", time.Second)
				if app.Exists("id:check-update") || len(app.UpdateChecks) != 0 {
					t.Fatal("ordinary package offered automatic updates")
				}
				return
			}
			app.Update = func(bool) core.UpdateCheck { return core.UpdateCheck{Shown: true} }
			app.Press("id:check-update")
			app.WaitUntil(time.Second, func() bool { return len(app.UpdateChecks) == 1 })
			if app.UpdateChecks[0] || len(app.Alerts()) != 0 {
				t.Fatal("manual check did not delegate UI to the native updater")
			}
		})
	}
}

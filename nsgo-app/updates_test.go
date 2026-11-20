package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/sususongboard/nsgo-app/store"
)

func TestUpdateTestIdentityDoesNotAdoptExistingData(t *testing.T) {
	t.Setenv("SUSUSONGBOARD_DB", "")
	t.Setenv("SUSUSONGBOARD_TEST_DB", "")
	previous := manifest.ID
	manifest.ID = "com.sususongboard.nsgo.updatetest"
	t.Cleanup(func() { manifest.ID = previous })
	root := t.TempDir()
	directory := filepath.Join(root, manifest.ID)
	legacy := filepath.Join(root, "com.sususongboard.app")
	for _, path := range []string{directory, legacy} {
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(store.DatabasePath(legacy), []byte("do not adopt"), 0600); err != nil {
		t.Fatal(err)
	}
	path, create, pinned, err := selectBoardDatabase(directory, filepath.Join(directory, databaseSelectionFilename))
	resolved, resolveErr := filepath.EvalSymlinks(directory)
	if err != nil || resolveErr != nil || !create || pinned || filepath.Dir(path) != resolved {
		t.Fatalf("test app selected legacy data: %q, create=%t, pinned=%t, err=%v", path, create, pinned, err)
	}
	if credentialServiceFor(manifest.ID) == credentialServiceFor(previous) {
		t.Fatal("update test shares the regular credential service")
	}
}

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

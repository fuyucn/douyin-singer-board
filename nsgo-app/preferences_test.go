package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/sususongboard/nsgo-app/platform/adapter"
	"github.com/sususongboard/nsgo-app/store"
)

func TestSettingsDirectoryHasLifetimeExclusiveLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), preferencesFilename)
	first, err := acquireSettingsLock(path)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := acquireSettingsLock(path); err == nil {
		second.Close()
		t.Fatal("second writer acquired live settings directory")
	}
	first.Close()
	second, err := acquireSettingsLock(path)
	if err != nil {
		t.Fatal("lock did not release with its owner")
	}
	second.Close()
}

func TestFailedWriteGuardPersistenceBlocksPlatformMutation(t *testing.T) {
	path := fixtureDatabase(t)
	mock := &mockPlatforms{credentials: map[string]string{}}
	var board *boardState
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
		board = newBoard(scope, mock.services())
		return core.Text{Content: "disk error test"}
	})
	before := savedSQLiteSettings(t)
	reader, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	readTx, err := reader.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer readTx.Rollback()
	var original string
	if err := readTx.QueryRow("SELECT data FROM nsgo_board_settings WHERE id=1").Scan(&original); err != nil {
		t.Fatal(err)
	}
	app.Post(func() {
		board.settings.Platform = adapter.NetEase
		board.account = session{Token: "TEST_ONLY", User: "account"}
		board.verified = true
		board.playlists = []playlist{{ID: 11, Name: "Target"}}
		board.settings.Targets[adapter.NetEase] = playlistBinding{ID: 11, Name: "Target", Account: "account"}
		song, _ := board.matcher.AddManual("Test song")
		board.syncSong(song, track{Key: "track1", Name: "Test song"}, false)
	})
	app.Settle()
	mock.mu.Lock()
	count := len(mock.methods)
	mock.mu.Unlock()
	if count != 0 || board.busy {
		t.Fatal("remote write was sent without a durable write guard")
	}
	if err := readTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if after := savedSQLiteSettings(t); after != before {
		t.Fatal("failed SQLite commit changed saved settings")
	}
}

func execSQLite(t *testing.T, path, statement string) {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(statement); err != nil {
		t.Fatal(err)
	}
}

func TestUnreadableOrInvalidPreferencesCannotBeOverwritten(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(map[bool]string{false: "directory", true: "invalid-json"}[corrupt], func(t *testing.T) {
			fixtureDatabase(t)
			path := filepath.Join(os.Getenv("SUSUSONGBOARD_SETTINGS_DIR"), preferencesFilename)
			if corrupt {
				if err := os.WriteFile(path, []byte("broken"), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			app := nsgotest.Start(t, Root, nsgotest.Size(1000, 780))
			app.Clear("id:sing-prefix")
			app.Type("id:sing-prefix", "[song]")
			app.Advance(500 * time.Millisecond)
			app.WaitFor("text:已阻止覆盖", time.Second)
			info, err := os.Stat(path)
			if err != nil || info.IsDir() == corrupt {
				t.Fatal("unreadable settings were replaced")
			}
		})
	}
}

func TestConfirmedGuardIsPresentOnDiskBeforeSending(t *testing.T) {
	path := fixtureDatabase(t)
	mock := &mockPlatforms{credentials: map[string]string{}}
	services := mock.services()
	base := services.call
	verified := make(chan bool, 1)
	services.call = func(ctx context.Context, id, operation string, input, output any) error {
		if operation == "addTrack" {
			data, err := querySQLiteSettings(path)
			var settings boardSettings
			if err == nil {
				err = json.Unmarshal([]byte(data), &settings)
			}
			verified <- err == nil && len(settings.Unconfirmed) == 1 && strings.Contains(data, "track1")
		}
		return base(ctx, id, operation, input, output)
	}
	var board *boardState
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
		board = newBoard(scope, services)
		return core.Text{Content: "write ordering"}
	})
	app.Post(func() {
		board.settings.Platform = adapter.NetEase
		board.account = session{Token: "TEST_ONLY", User: "account"}
		board.verified = true
		board.playlists = []playlist{{ID: 11, Name: "Target"}}
		board.settings.Targets[adapter.NetEase] = playlistBinding{ID: 11, Name: "Target", Account: "account"}
		song, _ := board.matcher.AddManual("Test song")
		board.syncSong(song, track{Name: "Test song", Key: "track1"}, false)
	})
	app.WaitUntil(time.Second, func() bool { return len(board.played) == 1 })
	select {
	case valid := <-verified:
		if !valid {
			t.Fatal("guard did not reach disk before request")
		}
	default:
		t.Fatal("platform mutation not observed")
	}
	var saved boardSettings
	if err := json.Unmarshal([]byte(savedSQLiteSettings(t)), &saved); err != nil || len(saved.Unconfirmed) != 0 {
		t.Fatal("confirmed write guard was not cleared in SQLite")
	}
}

func TestSQLiteJSONMigrationRetainsBindingsAndWriteGuards(t *testing.T) {
	path := fixtureDatabase(t)
	settings := boardSettings{
		Rules:       rules{Room: "987654321", Template: "[song]"},
		Blacklist:   []blacklistEntry{{Kind: "song", Name: "Test song", Artist: "Test artist", CreatedAt: 100}},
		Platform:    adapter.NetEase,
		Targets:     map[string]playlistBinding{adapter.NetEase: {ID: 11, Name: "Target", Account: "account"}},
		Unconfirmed: map[string]string{writeKey(adapter.NetEase, "account", 11, "track1"): "Test song"},
		ShowLogs:    true,
	}
	original := seedJSONPreferences(t, settings)
	app, scope, board := startSettingsTest(t)
	if board.settingsInvalid || !reflect.DeepEqual(board.settings, settings) {
		t.Fatal("JSON settings did not take precedence on first migration")
	}
	updated := settings
	updated.Rules.Room = "321654987"
	app.Post(func() { board.save(updated) })
	app.Settle()
	preferences := filepath.Join(os.Getenv("SUSUSONGBOARD_SETTINGS_DIR"), preferencesFilename)
	unchanged, err := os.ReadFile(preferences)
	if err != nil || string(unchanged) != string(original) {
		t.Fatal("old JSON changed during migration")
	}
	app.Post(scope.Dispose)
	app.Settle()
	if data, err := querySQLiteSettings(path); err != nil || !strings.Contains(data, updated.Rules.Room) {
		t.Fatal("SQLite update was not committed")
	}
	_, _, reopened := startSettingsTest(t)
	if reopened.settingsInvalid || !reflect.DeepEqual(reopened.settings, updated) {
		t.Fatal("reopening the app reimported stale JSON")
	}
}

func TestSQLiteMigrationBacksUpCommittedWAL(t *testing.T) {
	path := fixtureDatabase(t)
	writer, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	_, err = writer.Exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE config SET room_id='987654321'; INSERT INTO blacklist VALUES(1,'song','WAL entry',42)")
	if err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(path + "-wal"); err != nil || info.Size() == 0 {
		t.Fatal("fixture did not write a WAL")
	}
	_, _, board := startSettingsTest(t)
	if board.settingsInvalid || board.settings.Rules.Room != "987654321" || !reflect.DeepEqual(board.settings.Blacklist, []blacklistEntry{{Kind: "song", Name: "WAL entry", CreatedAt: 42}}) {
		t.Fatal("migration lost legacy WAL data")
	}
	backups, err := filepath.Glob(filepath.Join(filepath.Dir(path), "sqlite-backups", "pre-nsgo-*", filepath.Base(path)))
	if err != nil || len(backups) != 1 {
		t.Fatal("expected one pre-migration backup")
	}
	backup, err := store.LoadConfig(backups[0])
	if err != nil || backup.RoomID != "987654321" || backup.BlacklistMeta["song:WAL entry"] != 42 {
		t.Fatal("backup does not contain committed WAL changes")
	}
	db, err := sql.Open("sqlite", backups[0])
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var tables int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_schema WHERE name='nsgo_board_settings'").Scan(&tables); err != nil || tables != 0 {
		t.Fatal("backup is not from before migration")
	}
}

func TestSQLiteFreshDatabaseIsPinnedAndNotRecreatedIfLost(t *testing.T) {
	t.Setenv("SUSUSONGBOARD_DB", "")
	t.Setenv("SUSUSONGBOARD_TEST_DB", "")
	directory := filepath.Join(t.TempDir(), "com.sususongboard.nsgo")
	t.Setenv("SUSUSONGBOARD_SETTINGS_DIR", directory)
	path := store.DatabasePath(directory)
	app, scope, board := startSettingsTest(t)
	if board.settingsInvalid {
		t.Fatal("fresh database could not be opened")
	}
	app.Post(func() {
		settings := board.settings
		settings.Rules.Room = "456789123"
		board.save(settings)
		scope.Dispose()
	})
	app.Settle()
	legacyDir := filepath.Join(filepath.Dir(directory), "com.sususongboard.app")
	if err := os.Mkdir(legacyDir, 0700); err != nil {
		t.Fatal(err)
	}
	legacy := store.DatabasePath(legacyDir)
	execSQLite(t, legacy, "CREATE TABLE legacy_data (id INTEGER PRIMARY KEY)")
	app, scope, reopened := startSettingsTest(t)
	if reopened.settingsInvalid || reopened.settings.Rules.Room != "456789123" {
		t.Fatal("application switched to a later-discovered database")
	}
	app.Post(scope.Dispose)
	app.Settle()
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	_, _, missing := startSettingsTest(t)
	if !missing.settingsInvalid {
		t.Fatal("application fell back from a missing database")
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("application created a replacement database")
	}
}

func TestSQLiteInvalidDatabaseIsNotOverwritten(t *testing.T) {
	for _, statement := range []string{
		"UPDATE nsgo_board_settings SET version=99",
		"UPDATE nsgo_board_settings SET data='null'",
		"DELETE FROM nsgo_board_settings",
	} {
		t.Run(statement, func(t *testing.T) {
			path := fixtureDatabase(t)
			seedJSONPreferences(t, boardSettings{Rules: rules{Template: "[song]"}})
			app, scope, _ := startSettingsTest(t)
			app.Post(scope.Dispose)
			app.Settle()
			execSQLite(t, path, statement)
			app, _, board := startSettingsTest(t)
			if !board.settingsInvalid {
				t.Fatal("invalid or missing SQLite row triggered reimport")
			}
			app.Post(func() { board.save(board.settings) })
			app.Settle()
			if !strings.Contains(board.notice, "已阻止覆盖") {
				t.Fatal("invalid SQLite settings did not block saving")
			}
		})
	}
	t.Run("corrupt-file", func(t *testing.T) {
		path := fixtureDatabase(t)
		const broken = "not a SQLite database"
		if err := os.WriteFile(path, []byte(broken), 0600); err != nil {
			t.Fatal(err)
		}
		_, _, board := startSettingsTest(t)
		if !board.settingsInvalid {
			t.Fatal("corrupt database was accepted")
		}
		if data, err := os.ReadFile(path); err != nil || string(data) != broken {
			t.Fatal("corrupt database was modified")
		}
	})
}

func TestSQLiteDatabaseLockSpansSettingsDirectories(t *testing.T) {
	fixtureDatabase(t)
	app, scope, board := startSettingsTest(t)
	if board.settingsInvalid {
		t.Fatal("primary writer could not start")
	}
	t.Setenv("SUSUSONGBOARD_SETTINGS_DIR", t.TempDir())
	_, _, second := startSettingsTest(t)
	if !second.settingsInvalid {
		t.Fatal("second settings directory acquired the same database")
	}
	app.Post(scope.Dispose)
	app.Settle()
	_, _, reopened := startSettingsTest(t)
	if reopened.settingsInvalid {
		t.Fatal("database lock was not released after disposal")
	}
}

func TestSQLiteOverrideCannotResetTheSelectedDatabase(t *testing.T) {
	path := fixtureDatabase(t)
	seedJSONPreferences(t, boardSettings{Rules: rules{Template: "[song]"}})
	app, scope, board := startSettingsTest(t)
	if board.settingsInvalid {
		t.Fatal("initial override could not be opened")
	}
	app.Post(scope.Dispose)
	app.Settle()
	other := store.DatabasePath(t.TempDir())
	execSQLite(t, other, "CREATE TABLE legacy_data (id INTEGER PRIMARY KEY)")
	t.Setenv("SUSUSONGBOARD_DB", other)
	_, _, switched := startSettingsTest(t)
	if !switched.settingsInvalid {
		t.Fatal("a different override bypassed the binding")
	}
	t.Setenv("SUSUSONGBOARD_DB", path)
	execSQLite(t, path, "DROP TABLE nsgo_board_settings")
	_, _, restored := startSettingsTest(t)
	if !restored.settingsInvalid {
		t.Fatal("a legacy-only copy triggered stale JSON reimport")
	}
}

func TestSQLiteFailedBackupPreventsMigration(t *testing.T) {
	path := fixtureDatabase(t)
	if err := os.WriteFile(filepath.Join(filepath.Dir(path), "sqlite-backups"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	_, _, board := startSettingsTest(t)
	if !board.settingsInvalid {
		t.Fatal("migration proceeded despite the backup failure")
	}
	if _, err := querySQLiteSettings(path); err == nil {
		t.Fatal("settings table was created without a backup")
	}
	if config, err := store.LoadConfig(path); err != nil || config.RoomID != "123456789" {
		t.Fatal("backup failure changed legacy data")
	}
}

func TestSQLiteFreshInitializationCanRetryAfterFailedMigration(t *testing.T) {
	t.Setenv("SUSUSONGBOARD_DB", "")
	t.Setenv("SUSUSONGBOARD_TEST_DB", "")
	directory := t.TempDir()
	t.Setenv("SUSUSONGBOARD_SETTINGS_DIR", directory)
	preferences := filepath.Join(directory, preferencesFilename)
	if err := os.WriteFile(preferences, []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	_, _, blocked := startSettingsTest(t)
	if !blocked.settingsInvalid {
		t.Fatal("invalid JSON was accepted")
	}
	if _, err := os.Stat(store.DatabasePath(directory)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("failed migration published an unusable database")
	}
	seedJSONPreferences(t, boardSettings{Rules: rules{Template: "[song]", Room: "987654321"}})
	_, _, recovered := startSettingsTest(t)
	if recovered.settingsInvalid || recovered.settings.Rules.Room != "987654321" {
		t.Fatal("corrected preferences did not migrate on retry")
	}
}

func TestSQLiteDatabaseHardLinksAreRejected(t *testing.T) {
	path := fixtureDatabase(t)
	alias := filepath.Join(filepath.Dir(path), "alias.db")
	if err := os.Link(path, alias); err != nil {
		t.Skipf("fixture does not support hard links: %v", err)
	}
	_, _, board := startSettingsTest(t)
	if !board.settingsInvalid {
		t.Fatal("multiply linked database could acquire independent writer locks")
	}
}

func startSettingsTest(t *testing.T) (*nsgotest.App, *core.Scope, *boardState) {
	t.Helper()
	var root *core.Scope
	var board *boardState
	mock := &mockPlatforms{credentials: map[string]string{}}
	app := nsgotest.Start(t, func(scope *core.Scope) core.Node {
		root = scope
		board = newBoard(scope, mock.services())
		return core.Text{Content: "SQLite settings test"}
	})
	return app, root, board
}

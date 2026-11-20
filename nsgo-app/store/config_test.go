package store

import (
	"database/sql"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestLoadConfigReadsExistingSQLiteWithoutWriting(t *testing.T) {
	path := filepath.Join(t.TempDir(), databaseName)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("CREATE TABLE config (id INTEGER PRIMARY KEY, room_id TEXT, sing_prefix TEXT, fans_level INTEGER, sing_cd INTEGER, cooldown_seconds INTEGER, max_songs_per_user INTEGER, target_playlist_name TEXT, target_playlist_id INTEGER, kugou_enabled INTEGER); " +
		"INSERT INTO config VALUES (1, '123456789', '点歌[space][song]', 4, 60, 1800, 3, 'Playlist', 42, 1); " +
		"CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); " +
		"INSERT INTO settings VALUES ('keep', 'unchanged')")
	if err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	got, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.RoomID != "123456789" || got.SingPrefix != "点歌[space][song]" || got.FansLevel != 4 || got.SingCooldown != 60 || got.TargetPlaylistID != 42 || !got.KugouEnabled {
		t.Fatalf("unexpected config: %#v", got)
	}
	readOnly, err := sql.Open("sqlite", (&url.URL{Scheme: "file", Path: path}).String()+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer readOnly.Close()
	var settings string
	if err := readOnly.QueryRow("SELECT value FROM settings WHERE key = 'keep'").Scan(&settings); err != nil {
		t.Fatal(err)
	}
	if settings != "unchanged" {
		t.Fatalf("existing setting changed to %q", settings)
	}
}

func TestWriteConfigMakesVerifiedSnapshotAndRoundTripsBlacklist(t *testing.T) {
	path := filepath.Join(t.TempDir(), databaseName)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("CREATE TABLE config (id INTEGER PRIMARY KEY, room_id TEXT, sing_prefix TEXT, fans_level INTEGER, sing_cd INTEGER, cooldown_seconds INTEGER, max_songs_per_user INTEGER, target_playlist_name TEXT, target_playlist_id INTEGER, kugou_enabled INTEGER, extra TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL DEFAULT 0); " +
		"INSERT INTO config VALUES (1, '123456789', '[song]', 0, 0, 1800, 3, '', 0, 0, '{\"preserved\":\"keep\",\"blacklist_meta\":{\"song:blocked\":123}}', 0); " +
		"CREATE TABLE blacklist (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_type TEXT NOT NULL CHECK (entry_type IN ('song','singer')), name TEXT NOT NULL, created_at INTEGER, UNIQUE(entry_type,name)); " +
		"INSERT INTO blacklist(entry_type,name,created_at) VALUES ('song','blocked',123)")
	if err != nil {
		db.Close()
		t.Fatal(err)
	}
	db.Close()
	config, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if config.SingPrefix != "[song]" || len(config.BlacklistSongs) != 1 || config.BlacklistSongs[0] != "blocked" {
		t.Fatalf("initial config=%#v", config)
	}
	config.RoomID = "987654321"
	config.BlacklistSongs = []string{"new block"}
	config.BlacklistSingers = []string{"blocked singer"}
	config.BlacklistMeta["song:new block"] = 456
	backup, err := WriteConfig(path, config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(backup); err != nil {
		t.Fatalf("backup missing: %v", err)
	}
	backupConfig, err := LoadConfig(backup)
	if err != nil {
		t.Fatalf("load pre-write snapshot: %v", err)
	}
	if backupConfig.RoomID != "123456789" || len(backupConfig.BlacklistSongs) != 1 || backupConfig.BlacklistSongs[0] != "blocked" {
		t.Fatalf("snapshot did not retain pre-write values: %#v", backupConfig)
	}
	after, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if after.RoomID != "987654321" || after.SingPrefix != "[song]" || len(after.BlacklistSongs) != 1 || after.BlacklistSongs[0] != "new block" || len(after.BlacklistSingers) != 1 || after.BlacklistMeta["song:new block"] != 456 {
		t.Fatalf("written config failed to round-trip: %#v", after)
	}
	check, err := sql.Open("sqlite", (&url.URL{Scheme: "file", Path: path}).String()+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var preserved string
	if err := check.QueryRow("SELECT json_extract(extra,'$.preserved') FROM config WHERE id=1").Scan(&preserved); err != nil {
		t.Fatal(err)
	}
	if preserved != "keep" {
		t.Fatalf("unknown config key was lost: %q", preserved)
	}
}

func TestResolveDatabasePathPrefersExistingAppDatabase(t *testing.T) {
	root := t.TempDir()
	legacyDir := filepath.Join(root, "com.sususongboard.app")
	testDir := filepath.Join(root, "com.sususongboard.nsgo")
	if err := os.MkdirAll(legacyDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(testDir, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(legacyDir, databaseName)
	if err := os.WriteFile(legacy, []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := ResolveDatabasePath(testDir); got != legacy {
		t.Fatalf("resolved database = %q, want legacy path %q", got, legacy)
	}
}

func TestResolveDatabasePathFallsBackToTestAppData(t *testing.T) {
	testDir := filepath.Join(t.TempDir(), "com.sususongboard.nsgo")
	if got := ResolveDatabasePath(testDir); got != DatabasePath(testDir) {
		t.Fatalf("resolved database = %q, want test path %q", got, DatabasePath(testDir))
	}
}

func TestSQLiteURIFormatsWindowsDrivePath(t *testing.T) {
	got := sqliteURI("C:\\Users\\uoeqnbeq\\AppData\\Roaming\\com.sususongboard.app\\sususongboard.db", "windows")
	want := "file:///C:/Users/uoeqnbeq/AppData/Roaming/com.sususongboard.app/sususongboard.db"
	if got != want {
		t.Fatalf("sqlite URI = %q, want %q", got, want)
	}
}

func TestConfiguredExistingAppDatabaseReadOnly(t *testing.T) {
	path := os.Getenv("SUSUSONGBOARD_DB")
	if path == "" {
		t.Skip("set SUSUSONGBOARD_DB to read the existing database without modifying it")
	}
	config, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if config.RoomID == "" {
		t.Fatal("existing config did not contain a room ID")
	}
}

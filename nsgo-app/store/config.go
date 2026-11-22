package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	_ "modernc.org/sqlite"
	modernsqlite "modernc.org/sqlite"
)

const databaseName = "sususongboard.db"

type Config struct {
	RoomID           string
	SingPrefix       string
	FansLevel        int
	SingCooldown     int
	CooldownSeconds  int
	MaxSongsPerUser  int
	TargetPlaylist   string
	TargetPlaylistID int64
	KugouEnabled     bool
	ActivePlugin     string
	BlacklistSongs   []string
	BlacklistSingers []string
	BlacklistMeta    map[string]int64
	Extra            map[string]json.RawMessage
}

func DefaultConfig() Config {
	return Config{SingPrefix: "点歌[space][song]", CooldownSeconds: 1800, MaxSongsPerUser: 3}
}

func DatabasePath(dataDir string) string {
	return filepath.Join(dataDir, databaseName)
}

func ResolveDatabasePath(dataDir string) string {
	legacy := filepath.Join(filepath.Dir(dataDir), "com.sususongboard.app", databaseName)
	if info, err := os.Stat(legacy); err == nil && info.Mode().IsRegular() {
		return legacy
	}
	return DatabasePath(dataDir)
}

func LoadConfig(path string) (Config, error) {
	if path == "" {
		return Config{}, errors.New("NSGo did not provide an app data directory")
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return Config{}, fmt.Errorf("resolve database path: %w", err)
	}
	uri := sqliteURI(absolute, runtime.GOOS) + "?mode=ro&_pragma=busy_timeout(5000)"
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		return Config{}, fmt.Errorf("open SQLite database: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	var config Config
	var roomID, singPrefix, targetPlaylist sql.NullString
	var extra string
	var fansLevel, singCooldown, cooldownSeconds, maxSongs sql.NullInt64
	var targetPlaylistID, kugouEnabled sql.NullInt64
	configColumns, err := tableColumns(db, "config")
	if err != nil {
		return Config{}, err
	}
	query := "SELECT room_id, sing_prefix, fans_level, sing_cd, cooldown_seconds, max_songs_per_user, target_playlist_name, target_playlist_id, kugou_enabled"
	if configColumns["extra"] {
		query += ", extra"
	}
	query += " FROM config WHERE id=1"
	destinations := []any{&roomID, &singPrefix, &fansLevel, &singCooldown, &cooldownSeconds, &maxSongs, &targetPlaylist, &targetPlaylistID, &kugouEnabled}
	if configColumns["extra"] {
		destinations = append(destinations, &extra)
	}
	err = db.QueryRow(query).Scan(
		destinations...)
	if err != nil {
		return Config{}, fmt.Errorf("read existing config row: %w", err)
	}
	config = DefaultConfig()
	config.RoomID = roomID.String
	if singPrefix.Valid && singPrefix.String != "" {
		config.SingPrefix = singPrefix.String
	}
	config.FansLevel = int(fansLevel.Int64)
	config.SingCooldown = int(singCooldown.Int64)
	if cooldownSeconds.Valid {
		config.CooldownSeconds = int(cooldownSeconds.Int64)
	}
	if maxSongs.Valid {
		config.MaxSongsPerUser = int(maxSongs.Int64)
	}
	config.TargetPlaylist = targetPlaylist.String
	config.TargetPlaylistID = targetPlaylistID.Int64
	config.KugouEnabled = kugouEnabled.Int64 != 0
	if configColumns["active_plugin"] {
		var active sql.NullString
		if err := db.QueryRow("SELECT active_plugin FROM config WHERE id=1").Scan(&active); err != nil {
			return Config{}, fmt.Errorf("read selected platform: %w", err)
		}
		config.ActivePlugin = active.String
	} else if config.KugouEnabled {
		config.ActivePlugin = "kugou-web"
	}
	switch config.ActivePlugin {
	case "kugou":
		config.ActivePlugin = "kugou-web"
	case "netease":
		config.ActivePlugin = "netease-web"
	}
	blacklists, err := readBlacklist(db)
	if err != nil {
		return Config{}, err
	}
	config.BlacklistSongs = blacklists.Songs
	config.BlacklistSingers = blacklists.Singers
	config.BlacklistMeta = blacklists.Meta
	mergeExtra(extra, &config)
	return config, nil
}

type Blacklist struct {
	Songs   []string
	Singers []string
	Meta    map[string]int64
}

func readBlacklist(db *sql.DB) (Blacklist, error) {
	var exists bool
	if err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='blacklist')").Scan(&exists); err != nil {
		return Blacklist{}, fmt.Errorf("check SQLite blacklist table: %w", err)
	}
	if !exists {
		return Blacklist{Meta: map[string]int64{}}, nil
	}
	known, err := tableColumns(db, "blacklist")
	if err != nil {
		return Blacklist{}, fmt.Errorf("read SQLite blacklist schema: %w", err)
	}
	if known["entry_type"] && known["name"] {
		if !known["created_at"] {
			return Blacklist{}, errors.New("SQLite blacklist schema is missing created_at")
		}
	} else if known["song_name"] {
		return readLegacyBlacklist(db, known)
	} else {
		return Blacklist{}, errors.New("SQLite blacklist schema is unsupported")
	}
	rows, err := db.Query("SELECT entry_type, name, created_at FROM blacklist ORDER BY id")
	if err != nil {
		return Blacklist{}, fmt.Errorf("read SQLite blacklist: %w", err)
	}
	defer rows.Close()
	out := Blacklist{Meta: make(map[string]int64)}
	for rows.Next() {
		var kind string
		var name string
		var createdAt sql.NullInt64
		if err := rows.Scan(&kind, &name, &createdAt); err != nil {
			return Blacklist{}, fmt.Errorf("read SQLite blacklist row: %w", err)
		}
		switch kind {
		case "song":
			out.Songs = append(out.Songs, name)
		case "singer":
			out.Singers = append(out.Singers, name)
		default:
			return Blacklist{}, fmt.Errorf("unsupported SQLite blacklist type %q", kind)
		}
		if createdAt.Valid {
			out.Meta[kind+":"+name] = createdAt.Int64
		}
	}
	if err := rows.Err(); err != nil {
		return Blacklist{}, fmt.Errorf("read SQLite blacklist: %w", err)
	}
	return out, nil
}

func tableColumns(db *sql.DB, table string) (map[string]bool, error) {
	if table != "config" && table != "blacklist" {
		return nil, fmt.Errorf("unsupported schema table %q", table)
	}
	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := map[string]bool{}
	for rows.Next() {
		var cid, notnull, primary int
		var name, kind string
		var defaultValue sql.NullString
		if err := rows.Scan(&cid, &name, &kind, &notnull, &defaultValue, &primary); err != nil {
			return nil, err
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return columns, nil
}

func readLegacyBlacklist(db *sql.DB, columns map[string]bool) (Blacklist, error) {
	var result Blacklist
	for _, item := range []struct {
		column, kind string
		dest         *[]string
	}{{"song_name", "song", &result.Songs}, {"singer", "singer", &result.Singers}} {
		if !columns[item.column] {
			continue
		}
		rows, err := db.Query("SELECT " + item.column + " FROM blacklist WHERE " + item.column + " IS NOT NULL AND " + item.column + " <> ''")
		if err != nil {
			return Blacklist{}, fmt.Errorf("read legacy %s blacklist: %w", item.kind, err)
		}
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				rows.Close()
				return Blacklist{}, err
			}
			*item.dest = append(*item.dest, name)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return Blacklist{}, err
		}
		rows.Close()
	}
	return result, nil
}

func mergeExtra(raw string, config *Config) {
	var values map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return
	}
	config.Extra = values
	for _, key := range []string{"blacklist", "blacklist_singers"} {
		var names []string
		if err := json.Unmarshal(values[key], &names); err == nil {
			if key == "blacklist" {
				config.BlacklistSongs = append([]string(nil), names...)
			} else {
				config.BlacklistSingers = append([]string(nil), names...)
			}
		}
	}
	var meta map[string]int64
	if err := json.Unmarshal(values["blacklist_meta"], &meta); err == nil {
		for key, createdAt := range meta {
			config.BlacklistMeta[key] = createdAt
		}
	}
}

type onlineBackuper interface {
	NewBackup(string) (*modernsqlite.Backup, error)
}

func cloneRawExtra(values map[string]json.RawMessage) map[string]json.RawMessage {
	cloned := make(map[string]json.RawMessage, len(values))
	for key, value := range values {
		cloned[key] = append(json.RawMessage(nil), value...)
	}
	return cloned
}

func WriteConfig(path string, config Config) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve database path: %w", err)
	}
	if _, err := os.Stat(abs); err != nil {
		return "", fmt.Errorf("refuse to create an unbacked replacement database: %w", err)
	}
	backup := filepath.Join(filepath.Dir(abs), "sqlite-backups", time.Now().UTC().Format("20060102T150405.000000000Z")+"-pre-nsgo-write.db")
	if err := os.MkdirAll(filepath.Dir(backup), 0o700); err != nil {
		return "", fmt.Errorf("create SQLite backup directory: %w", err)
	}
	source, err := sql.Open("sqlite", sqliteURI(abs, runtime.GOOS)+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		return "", fmt.Errorf("open backup source read-only: %w", err)
	}
	source.SetMaxOpenConns(1)
	if err := onlineBackup(source, backup); err != nil {
		source.Close()
		return "", err
	}
	if err := source.Close(); err != nil {
		return "", fmt.Errorf("close backup source: %w", err)
	}
	if err := verifyBackup(backup); err != nil {
		return "", err
	}
	db, err := sql.Open("sqlite", sqliteURI(abs, runtime.GOOS)+"?_pragma=busy_timeout(5000)")
	if err != nil {
		return "", fmt.Errorf("open SQLite writer: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if err := writeConfigTransaction(db, config); err != nil {
		return "", err
	}
	return backup, nil
}

func onlineBackup(db *sql.DB, backupPath string) error {
	connection, err := db.Conn(context.Background())
	if err != nil {
		return fmt.Errorf("acquire SQLite snapshot connection: %w", err)
	}
	defer connection.Close()
	err = connection.Raw(func(raw any) error {
		backuper, ok := raw.(onlineBackuper)
		if !ok {
			return errors.New("SQLite driver does not support online backup")
		}
		backup, err := backuper.NewBackup(backupPath)
		if err != nil {
			return err
		}
		finished := false
		defer func() {
			if !finished {
				_ = backup.Finish()
			}
		}()
		for more := true; more; {
			more, err = backup.Step(-1)
			if err != nil {
				return err
			}
		}
		finished = true
		return backup.Finish()
	})
	if err != nil {
		return fmt.Errorf("create SQLite snapshot before write: %w", err)
	}
	return nil
}

func verifyBackup(path string) error {
	db, err := sql.Open("sqlite", sqliteURI(path, runtime.GOOS)+"?mode=ro")
	if err != nil {
		return fmt.Errorf("open SQLite snapshot for verification: %w", err)
	}
	defer db.Close()
	var roomID string
	if err := db.QueryRow("SELECT room_id FROM config WHERE id=1").Scan(&roomID); err != nil {
		return fmt.Errorf("verify SQLite snapshot: %w", err)
	}
	return nil
}

func VerifyConfig(path string, expected Config) error {
	actual, err := LoadConfig(path)
	if err != nil {
		return fmt.Errorf("re-read saved SQLite config: %w", err)
	}
	if actual.RoomID != expected.RoomID || actual.SingPrefix != expected.SingPrefix || actual.FansLevel != expected.FansLevel || actual.SingCooldown != expected.SingCooldown || actual.MaxSongsPerUser != expected.MaxSongsPerUser || actual.CooldownSeconds != expected.CooldownSeconds || actual.TargetPlaylist != expected.TargetPlaylist || actual.TargetPlaylistID != expected.TargetPlaylistID || actual.KugouEnabled != expected.KugouEnabled {
		return errors.New("saved SQLite config differs from requested values")
	}
	if !equalStrings(actual.BlacklistSongs, expected.BlacklistSongs) || !equalStrings(actual.BlacklistSingers, expected.BlacklistSingers) || !equalInt64Map(actual.BlacklistMeta, expected.BlacklistMeta) {
		return errors.New("saved SQLite blacklist differs from requested values")
	}
	return nil
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
func equalInt64Map(a, b map[string]int64) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func writeConfigTransaction(db *sql.DB, config Config) error {
	extra := cloneRawExtra(config.Extra)
	for key, value := range map[string]any{"blacklist": config.BlacklistSongs, "blacklist_singers": config.BlacklistSingers, "blacklist_meta": config.BlacklistMeta} {
		encoded, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("encode %s: %w", key, err)
		}
		extra[key] = encoded
	}
	encoded, err := json.Marshal(extra)
	if err != nil {
		return fmt.Errorf("encode config extra: %w", err)
	}
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin config transaction: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.Exec("UPDATE config SET room_id=?, sing_prefix=?, fans_level=?, sing_cd=?, cooldown_seconds=?, max_songs_per_user=?, target_playlist_name=?, target_playlist_id=?, kugou_enabled=?, extra=?, updated_at=? WHERE id=1", config.RoomID, config.SingPrefix, config.FansLevel, config.SingCooldown, config.CooldownSeconds, config.MaxSongsPerUser, config.TargetPlaylist, config.TargetPlaylistID, boolToInt(config.KugouEnabled), string(encoded), time.Now().Unix())
	if err != nil {
		return fmt.Errorf("update config row: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return fmt.Errorf("expected one config row updated, got %d: %v", rows, err)
	}
	if _, err := tx.Exec("DELETE FROM blacklist"); err != nil {
		return fmt.Errorf("replace blacklist: %w", err)
	}
	for _, entry := range []struct {
		kind  string
		names []string
	}{{"song", config.BlacklistSongs}, {"singer", config.BlacklistSingers}} {
		for _, name := range entry.names {
			var created any
			if value := config.BlacklistMeta[entry.kind+":"+name]; value != 0 {
				created = value
			}
			if _, err := tx.Exec("INSERT INTO blacklist(entry_type, name, created_at) VALUES(?, ?, ?)", entry.kind, name, created); err != nil {
				return fmt.Errorf("write blacklist row: %w", err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit SQLite config write: %w", err)
	}
	return nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func sqliteURI(path, goos string) string {
	if goos == "windows" {
		path = strings.ReplaceAll(filepath.Clean(path), "\\", "/")
		if !strings.HasPrefix(path, "/") {
			path = "/" + path
		}
	}
	return (&url.URL{Scheme: "file", Path: path}).String()
}

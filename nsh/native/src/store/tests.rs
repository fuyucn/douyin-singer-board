use super::*;
use tempfile::TempDir;

/// The Tauri application's schema, as its sqlx migrations left it.
fn legacy_fixture(dir: &Path) -> Connection {
    let conn = Connection::open(dir.join(DB_FILE)).unwrap();
    conn.execute_batch(
        "
        CREATE TABLE config (id INTEGER PRIMARY KEY, room_id TEXT, sing_prefix TEXT,
            fans_level INTEGER, sing_cd INTEGER, target_playlist_name TEXT,
            target_playlist_id INTEGER, cooldown_seconds INTEGER,
            max_songs_per_user INTEGER, kugou_enabled INTEGER);
        INSERT INTO config VALUES(1, 'legacy-room', '', 0, 0, 'Legacy playlist', 27, 1800, 3, 1);
        CREATE TABLE blacklist (id INTEGER PRIMARY KEY, entry_type TEXT, song_name TEXT,
            singer_name TEXT, created_at INTEGER);
        INSERT INTO blacklist VALUES(1, 'song', 'Test song', '', 123),
            (2, 'singer', '', 'Test singer', 456);
        CREATE TABLE kugou_session (id INTEGER PRIMARY KEY, token TEXT, userid TEXT,
            dfid TEXT, refreshed_at INTEGER);
        INSERT INTO kugou_session VALUES(1, 'fixture-token', 'fixture-user', 'fixture-dfid', 1000);
        CREATE TABLE _sqlx_migrations (version INTEGER PRIMARY KEY, checksum BLOB);
        INSERT INTO _sqlx_migrations VALUES(1, X'010203');
        CREATE TABLE history (id INTEGER PRIMARY KEY, msg_id TEXT, song_name TEXT);
        INSERT INTO history VALUES(1, 'msg-1', 'A song');
        ",
    )
    .unwrap();
    conn
}

fn config(room: &str) -> String {
    json!({ "room_id": room }).to_string()
}

fn table_columns(conn: &Connection, table: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .unwrap();
    stmt.query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .map(|r| r.unwrap())
        .collect()
}

#[test]
fn fresh_database_uses_the_app_schema_and_round_trips_config() {
    let dir = TempDir::new().unwrap();
    let mut store = Store::open(dir.path().to_str().unwrap()).unwrap();
    assert_eq!(store.get("board.config").unwrap(), None);
    let full = json!({
        "room_id": "app-room",
        "sing_prefix": "点歌[space][song]",
        "fans_level": 1,
        "sing_cd": 5,
        "cooldown_seconds": 1800,
        "max_songs_per_user": 4,
        "target_playlist_name": "测试4",
        "target_playlist_id": 27,
        "kugou_enabled": true,
        "blacklist": ["晴天", "夜曲"],
        "blacklist_singers": ["周杰伦"],
        "blacklist_meta": { "song:晴天": 1794000000_i64 },
        "auto_sync": false,
        "active_plugin": "kugou",
        "config_version": 2,
        "future_field": "kept"
    })
    .to_string();
    store
        .set_many(
            &json!({ "board.config": full, "board.theme": "dark" }).to_string(),
        )
        .unwrap();
    drop(store);
    let reopened = Store::open(dir.path().to_str().unwrap()).unwrap();
    let raw = reopened.get("board.config").unwrap().unwrap();
    let parsed: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed["room_id"], "app-room");
    assert_eq!(parsed["kugou_enabled"], true);
    assert_eq!(parsed["target_playlist_id"], 27);
    assert_eq!(parsed["blacklist"][0], "晴天");
    assert_eq!(parsed["blacklist_singers"][0], "周杰伦");
    assert_eq!(parsed["blacklist_meta"]["song:晴天"], 1794000000_i64);
    // Unknown keys survive in `extra`, so a new field needs no migration.
    assert_eq!(parsed["future_field"], "kept");
    assert_eq!(reopened.get("board.theme").unwrap().as_deref(), Some("dark"));

    let conn = &reopened.conn;
    let songs: i64 = conn
        .query_row(
            "SELECT count(*) FROM blacklist WHERE entry_type = 'song'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(songs, 2);
    let created: Option<i64> = conn
        .query_row(
            "SELECT created_at FROM blacklist WHERE name = '晴天'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(created, Some(1794000000));
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        conn.query_row("SELECT value FROM meta WHERE key = 'schema'", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        SCHEMA_VERSION
    );
}

#[test]
fn legacy_database_is_imported_once_and_replaced() {
    let dir = TempDir::new().unwrap();
    let legacy = legacy_fixture(dir.path());
    legacy
        .execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
             UPDATE config SET room_id='wal-room';",
        )
        .unwrap();
    let old_json =
        json!({"board.config": config("stale-json"), "legacyMigrationDone": "old-marker"})
            .to_string();
    fs::write(dir.path().join("storage.json"), &old_json).unwrap();

    let store = Store::open(dir.path().to_str().unwrap()).unwrap();
    let raw = store.get("board.config").unwrap().unwrap();
    let parsed: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed["room_id"], "wal-room");
    assert_eq!(parsed["target_playlist_id"], 27);
    assert_eq!(parsed["blacklist"][0], "Test song");
    assert_eq!(parsed["blacklist_singers"][0], "Test singer");
    assert_eq!(parsed["blacklist_meta"]["song:Test song"], 123);
    assert!(
        store
            .get("kugou.session")
            .unwrap()
            .unwrap()
            .contains("fixture-token")
    );
    assert_eq!(
        store.get(SOURCE_KEY).unwrap().as_deref(),
        Some("tauri-sqlite")
    );
    assert!(
        store
            .get("legacy.nshStorageBackup.0")
            .unwrap()
            .unwrap()
            .contains("stale-json")
    );

    // The file is now ours: the legacy tables are gone from the live database.
    assert_eq!(
        table_columns(&store.conn, "config"),
        vec![
            "id",
            "room_id",
            "sing_prefix",
            "fans_level",
            "sing_cd",
            "cooldown_seconds",
            "max_songs_per_user",
            "target_playlist_name",
            "target_playlist_id",
            "kugou_enabled",
            "auto_sync",
            "active_plugin",
            "config_version",
            "extra",
            "updated_at",
        ]
    );
    assert!(!table_exists(&store.conn, "_sqlx_migrations").unwrap());
    assert!(!table_exists(&store.conn, "history").unwrap());

    // The snapshot keeps what the old file held, WAL included.
    let backup = fs::read_dir(dir.path().join("sqlite-backups"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.extension().is_some_and(|x| x == "db"))
        .unwrap();
    let snapshot = Connection::open(backup).unwrap();
    assert_eq!(
        snapshot
            .query_row("SELECT room_id FROM config", [], |r| r.get::<_, String>(0))
            .unwrap(),
        "wal-room"
    );
    assert_eq!(
        snapshot
            .query_row("SELECT count(*) FROM history", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    // Source JSON is preserved byte for byte.
    assert_eq!(
        fs::read_to_string(dir.path().join("storage.json")).unwrap(),
        old_json
    );
}

#[test]
fn reopening_after_the_import_uses_only_the_app_schema() {
    let dir = TempDir::new().unwrap();
    drop(legacy_fixture(dir.path()));
    let mut store = Store::open(dir.path().to_str().unwrap()).unwrap();
    store
        .set_many(&json!({"board.config": config("edited-room")}).to_string())
        .unwrap();
    store.remove("kugou.session").unwrap();
    drop(store);
    let store = Store::open(dir.path().to_str().unwrap()).unwrap();
    assert!(
        store
            .get("board.config")
            .unwrap()
            .unwrap()
            .contains("edited-room")
    );
    assert_eq!(store.get("kugou.session").unwrap(), None);
    assert_eq!(
        fs::read_dir(dir.path().join("sqlite-backups"))
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn json_fallback_survives_reopen_without_touching_the_source() {
    let dir = TempDir::new().unwrap();
    let source = json!({"board.config": config("json-room"), "board.theme": "dark"}).to_string();
    fs::write(dir.path().join("storage.json"), &source).unwrap();
    let store = Store::open(dir.path().to_str().unwrap()).unwrap();
    assert!(
        store
            .get("board.config")
            .unwrap()
            .unwrap()
            .contains("json-room")
    );
    assert_eq!(
        store.get(SOURCE_KEY).unwrap().as_deref(),
        Some("nsh-storage")
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("storage.json")).unwrap(),
        source
    );
}

#[test]
fn failed_batch_keeps_all_previous_values() {
    let dir = TempDir::new().unwrap();
    let mut store = Store::open(dir.path().to_str().unwrap()).unwrap();
    store
        .set_many(&json!({"board.config": config("before"), "board.theme": "light"}).to_string())
        .unwrap();
    store
        .conn
        .execute_batch(
            "CREATE TRIGGER refuse_config BEFORE UPDATE ON config
             BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
        )
        .unwrap();
    assert!(
        store
            .set_many(&json!({"board.config": config("after"), "board.theme": "dark"}).to_string())
            .is_err()
    );
    assert!(
        store
            .get("board.config")
            .unwrap()
            .unwrap()
            .contains("before")
    );
    assert_eq!(store.get("board.theme").unwrap().as_deref(), Some("light"));
}

#[test]
fn corrupt_json_blocks_import_without_creating_a_database() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("storage.json"), "{broken").unwrap();
    assert!(Store::open(dir.path().to_str().unwrap()).is_err());
    assert!(!dir.path().join(DB_FILE).exists());
}

#[test]
fn unreadable_legacy_database_is_archived_not_deleted() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join(DB_FILE), b"not a sqlite database").unwrap();
    let store = Store::open(dir.path().to_str().unwrap()).unwrap();
    let archived = fs::read_dir(dir.path())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .find(|name| name.starts_with("sususongboard.db.unreadable-"))
        .expect("the unreadable file must be archived");
    assert!(dir.path().join(archived).exists());
    assert!(dir.path().join(DB_FILE).exists());
    assert_eq!(store.get("board.config").unwrap(), None);
}

#[test]
fn memory_stores_are_isolated() {
    let mut first = Store::open("").unwrap();
    first
        .set_many(&json!({"board.config": config("first")}).to_string())
        .unwrap();
    assert_eq!(Store::open("").unwrap().get("board.config").unwrap(), None);
}

#[test]
#[ignore = "requires an explicitly supplied offline SQLite snapshot"]
fn migrate_offline_snapshot_without_modifying_the_source() {
    let source = std::env::var("SQLITE_OFFLINE_SNAPSHOT").expect("set SQLITE_OFFLINE_SNAPSHOT");
    let before = fs::read(&source).unwrap();
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join(DB_FILE), &before).unwrap();
    let legacy = Connection::open(dir.path().join(DB_FILE)).unwrap();
    let expected = tauri_entries(&legacy)
        .unwrap()
        .expect("snapshot must contain config");
    let history_count: i64 = legacy
        .query_row("SELECT count(*) FROM history", [], |r| r.get(0))
        .unwrap();
    drop(legacy);
    let store = Store::open(dir.path().to_str().unwrap()).unwrap();
    for (key, value) in &expected {
        let actual = store.get(key).unwrap().unwrap();
        if key == "board.config" {
            let a: Value = serde_json::from_str(&actual).unwrap();
            let e: Value = serde_json::from_str(value).unwrap();
            assert_eq!(a["room_id"], e["room_id"]);
            assert_eq!(
                a["target_playlist_id"].as_f64(),
                e["target_playlist_id"].as_f64()
            );
            assert_eq!(a["blacklist"], e["blacklist"]);
            assert_eq!(a["blacklist_singers"], e["blacklist_singers"]);
        } else {
            assert_eq!(actual, *value);
        }
    }
    // Everything the Tauri app kept outside the app's schema lives in the
    // snapshot, not in the live file.
    let backup = fs::read_dir(dir.path().join("sqlite-backups"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.extension().is_some_and(|x| x == "db"))
        .unwrap();
    let snapshot = Connection::open(backup).unwrap();
    assert_eq!(
        snapshot
            .query_row("SELECT count(*) FROM history", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        history_count
    );
    assert_eq!(fs::read(&source).unwrap(), before);
}

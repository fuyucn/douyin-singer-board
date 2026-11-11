//! The app's own SQLite database.
//!
//! On first launch the store copies what the Tauri application kept (its
//! `config`, `blacklist` and `kugou_session` tables, or a previous NSH
//! `nsh_kv` export, or `storage.json`) into its own schema, verifies the
//! copy, snapshots the old file into `sqlite-backups/`, and only then takes
//! its place. After that the old file is never opened again: this schema is
//! the only store, and `storage.json` is no longer read or written.
//!
//! The documents Board reads are still JSON strings — `board.config`,
//! `board.theme`, `kugou.session` — so the TSX side is unchanged; here they
//! are normalized into tables: one `config` row, one `blacklist` row per
//! entry, one `kugou_session` row, and `settings` for everything else.

use rusqlite::{Connection, OpenFlags, OptionalExtension, params, types::ValueRef};
use serde_json::{Map, Value, json};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

type Entries = BTreeMap<String, String>;
type Result<T> = std::result::Result<T, String>;

const DB_FILE: &str = "sususongboard.db";
const TEMP_FILE: &str = "sususongboard.db.nsh-new";
const SCHEMA_VERSION: &str = "nsh-1";
const MARKER: &str = "sqliteMigrationDone";
const SOURCE_KEY: &str = "sqliteMigrationSource";

/// The app's tables. `config` is one row because the app has one room;
/// `blacklist` is one row per entry so it can be queried; `settings` keeps
/// the remaining string keys (theme, migration markers, leftovers).
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    room_id TEXT,
    sing_prefix TEXT,
    fans_level INTEGER,
    sing_cd INTEGER,
    cooldown_seconds INTEGER,
    max_songs_per_user INTEGER,
    target_playlist_name TEXT,
    target_playlist_id INTEGER,
    kugou_enabled INTEGER,
    auto_sync INTEGER,
    active_plugin TEXT,
    config_version INTEGER,
    extra TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('song','singer')),
    name TEXT NOT NULL,
    created_at INTEGER,
    UNIQUE (entry_type, name)
);
CREATE TABLE IF NOT EXISTS kugou_session (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token TEXT NOT NULL,
    userid TEXT NOT NULL,
    dfid TEXT,
    nickname TEXT,
    refreshed_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
PRAGMA user_version = 1;
";

/// Keys `config` keeps in columns; every other key is preserved in `extra`.
const CONFIG_COLUMNS: [&str; 12] = [
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
];

pub(super) struct Store {
    conn: Connection,
}

impl Store {
    pub(super) fn open(data_dir: &str) -> Result<Self> {
        if data_dir.is_empty() {
            let conn = Connection::open_in_memory().map_err(error)?;
            conn.execute_batch(SCHEMA).map_err(error)?;
            return Ok(Self { conn });
        }
        let dir = Path::new(data_dir);
        fs::create_dir_all(dir).map_err(error)?;
        let path = dir.join(DB_FILE);
        let temp = dir.join(TEMP_FILE);

        // A swap that stopped between its renames: the temporary file is the
        // verified copy, so finishing it is always the safe direction.
        if temp.exists() {
            if !path.exists() || !is_ours(&path)? {
                install(&temp, &path)?;
            } else {
                fs::remove_file(&temp).map_err(error)?;
            }
        }

        if path.exists() && is_ours(&path)? {
            let conn = Connection::open(&path).map_err(error)?;
            tune(&conn)?;
            if let Some(raw) = read_document(&conn, "board.config")? {
                validate_config(&raw)?;
            }
            return Ok(Self { conn });
        }

        let existed = path.exists();
        let parent = dir.parent().ok_or("app data directory has no parent")?;
        let alternate = parent.join("com.fuyucn.sususongboard").join(DB_FILE);
        let mut entries: Option<Entries> = None;
        let mut source = "fresh";
        let mut alternate_exists = false;
        let mut legacy_readable = false;

        if existed {
            match read_legacy(&path) {
                Ok(Some((legacy, kind))) => {
                    legacy_readable = true;
                    entries = Some(legacy);
                    source = kind;
                }
                Ok(None) => legacy_readable = true,
                // An unreadable file is archived below instead of failing startup.
                Err(_) => {}
            }
        }
        if entries.is_none() && alternate.exists() && alternate != path {
            if let Ok(Some((legacy, kind))) = read_legacy(&alternate) {
                entries = Some(legacy);
                source = kind;
                alternate_exists = true;
            }
        }

        let mut json_sources = Vec::new();
        for candidate in [
            dir.join("storage.json"),
            parent.join("com.sususongboard.nsh/storage.json"),
        ] {
            match fs::read(&candidate) {
                Ok(bytes) => json_sources.push((candidate, bytes)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(error(e)),
            }
        }

        if let Some(data) = entries.as_mut() {
            // Keep stale NSH edits without letting them win over the database.
            for (i, (_, bytes)) in json_sources.iter().enumerate() {
                data.insert(
                    format!("legacy.nshStorageBackup.{i}"),
                    String::from_utf8(bytes.clone()).map_err(error)?,
                );
            }
        } else {
            for (_, bytes) in &json_sources {
                let data: Entries = serde_json::from_slice(bytes).map_err(error)?;
                if let Some(raw) = data.get("board.config") {
                    validate_config(raw)?;
                    entries = Some(data);
                    source = "nsh-storage";
                    break;
                }
            }
        }
        let imported_any = entries.is_some();
        let mut data = entries.take().unwrap_or_default();
        if let Some(raw) = data.get("board.config") {
            validate_config(raw)?;
        }

        if existed || alternate_exists || !json_sources.is_empty() {
            let backup_dir = dir.join("sqlite-backups");
            fs::create_dir_all(&backup_dir).map_err(error)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&backup_dir, fs::Permissions::from_mode(0o700))
                    .map_err(error)?;
            }
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(error)?
                .as_millis();
            if existed && legacy_readable {
                snapshot(&path, &backup_dir.join(format!("{stamp}-tauri.db")))?;
            }
            if alternate_exists {
                snapshot(&alternate, &backup_dir.join(format!("{stamp}-alternate-tauri.db")))?;
            }
            for (i, (_, bytes)) in json_sources.iter().enumerate() {
                write_new(&backup_dir.join(format!("{stamp}-storage-{i}.json")), bytes)?;
            }
        }

        data.insert(MARKER.into(), SCHEMA_VERSION.into());
        data.insert(SOURCE_KEY.into(), source.into());
        // Build the replacement next to the old file, verify it, then swap.
        if let Err(e) = write_database(&temp, &data) {
            let _ = fs::remove_file(&temp);
            return Err(e);
        }
        if existed && !imported_any && source == "fresh" {
            // An unreadable database is not overwritten: it is archived first.
            archive(&path)?;
        }
        install(&temp, &path)?;

        let conn = Connection::open(&path).map_err(error)?;
        tune(&conn)?;
        if let Some(raw) = read_document(&conn, "board.config")? {
            validate_config(&raw)?;
        }
        Ok(Self { conn })
    }

    pub(super) fn get(&self, key: &str) -> Result<Option<String>> {
        read_document(&self.conn, key)
    }

    pub(super) fn set_many(&mut self, entries_json: &str) -> Result<()> {
        let entries: Entries = serde_json::from_str(entries_json).map_err(error)?;
        if let Some(raw) = entries.get("board.config") {
            validate_config(raw)?;
        }
        write_documents(&mut self.conn, &entries)
    }

    pub(super) fn remove(&mut self, key: &str) -> Result<()> {
        let tx = self.conn.transaction().map_err(error)?;
        match key {
            "board.config" => {
                tx.execute("DELETE FROM config", []).map_err(error)?;
                tx.execute("DELETE FROM blacklist", []).map_err(error)?;
            }
            "kugou.session" => {
                tx.execute("DELETE FROM kugou_session", []).map_err(error)?;
                tx.execute("DELETE FROM settings WHERE key = ?1", params![key])
                    .map_err(error)?;
            }
            _ => {
                tx.execute("DELETE FROM settings WHERE key = ?1", params![key])
                    .map_err(error)?;
            }
        }
        tx.commit().map_err(error)
    }

    pub(super) fn export_json(&self) -> Result<String> {
        serde_json::to_string(&read_all(&self.conn)?).map_err(error)
    }
}

fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn tune(conn: &Connection) -> Result<()> {
    conn.busy_timeout(Duration::from_secs(5)).map_err(error)?;
    conn.execute_batch("PRAGMA synchronous = FULL;").map_err(error)?;
    Ok(())
}

fn validate_config(raw: &str) -> Result<()> {
    let config: Value = serde_json::from_str(raw).map_err(error)?;
    if !config.is_object() || !config["room_id"].is_string() {
        return Err("board.config must be an object with a string room_id".into());
    }
    Ok(())
}

fn is_ours(path: &Path) -> Result<bool> {
    match meta_schema(path) {
        Ok(value) => Ok(value.as_deref() == Some(SCHEMA_VERSION)),
        Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::NotADatabase => {
            Ok(false)
        }
        Err(e) => Err(error(e)),
    }
}

fn meta_schema(path: &Path) -> rusqlite::Result<Option<String>> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    if !table_exists_raw(&conn, "meta")? {
        return Ok(None);
    }
    conn.query_row("SELECT value FROM meta WHERE key = 'schema'", [], |r| {
        r.get::<_, String>(0)
    })
    .optional()
}

fn table_exists_raw(conn: &Connection, name: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |r| r.get(0),
    )
}

fn read_legacy(path: &Path) -> Result<Option<(Entries, &'static str)>> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(error)?;
    tune(&conn)?;
    if let Some(legacy) = tauri_entries(&conn)? {
        return Ok(Some((legacy, "tauri-sqlite")));
    }
    if table_exists(&conn, "nsh_kv")? {
        return Ok(Some((read_kv(&conn)?, "nsh-kv")));
    }
    Ok(None)
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [name],
        |r| r.get(0),
    )
    .map_err(error)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(error)?;
    file.write_all(bytes).map_err(error)?;
    file.sync_all().map_err(error)
}

fn stamp() -> Result<u128> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(error)?
        .as_millis())
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Copies a database, WAL pages included, through SQLite's backup API.
fn snapshot(source: &Path, dest: &Path) -> Result<()> {
    let conn = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(error)?;
    tune(&conn)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dest)
        .map_err(error)?;
    conn.backup(rusqlite::DatabaseName::Main, dest, None)
        .map_err(error)
}

/// Moves an unreadable legacy file aside instead of deleting it.
fn archive(path: &Path) -> Result<()> {
    let aside = path.with_file_name(format!("{DB_FILE}.unreadable-{}", stamp()?));
    fs::rename(path, &aside).map_err(error)
}

/// Replaces `path` with the verified `temp` database, keeping the old file
/// only until the rename has happened.
fn install(temp: &Path, path: &Path) -> Result<()> {
    let aside = path.with_file_name(format!("{DB_FILE}.legacy-{}", stamp()?));
    let moved = if path.exists() {
        fs::rename(path, &aside).map_err(error)?;
        true
    } else {
        false
    };
    if let Err(e) = fs::rename(temp, path) {
        if moved {
            let _ = fs::rename(&aside, path);
        }
        return Err(error(e));
    }
    if moved {
        fs::remove_file(&aside).map_err(error)?;
    }
    for suffix in ["-wal", "-shm"] {
        let sibling = path.with_file_name(format!("{DB_FILE}{suffix}"));
        if sibling.exists() {
            fs::remove_file(sibling).map_err(error)?;
        }
    }
    Ok(())
}

/// Creates the app's database at `path`, imports `entries`, and proves the
/// copy before anyone swaps it in.
fn write_database(path: &Path, entries: &Entries) -> Result<()> {
    if path.exists() {
        fs::remove_file(path).map_err(error)?;
    }
    let mut conn = Connection::open(path).map_err(error)?;
    tune(&conn)?;
    conn.execute_batch(SCHEMA).map_err(error)?;
    write_documents(&mut conn, entries)?;
    let mut meta = vec![
        ("schema", SCHEMA_VERSION.to_string()),
        (
            "importSource",
            entries.get(SOURCE_KEY).cloned().unwrap_or_default(),
        ),
        ("importedAt", now_seconds().to_string()),
    ];
    if let Some(version) = entries.get("legacy.schemaVersion") {
        meta.push(("legacySchemaVersion", version.clone()));
    }
    for (key, value) in meta {
        conn.execute(
            "INSERT INTO meta(key,value) VALUES(?1,?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )
        .map_err(error)?;
    }

    // Verify: the room id and the blacklist rows must survive the copy.
    if let Some(raw) = entries.get("board.config") {
        let written = read_document(&conn, "board.config")?
            .ok_or("imported board.config is missing")?;
        validate_config(&written)?;
        let expected: Value = serde_json::from_str(raw).map_err(error)?;
        let actual: Value = serde_json::from_str(&written).map_err(error)?;
        if actual["room_id"] != expected["room_id"] {
            return Err("imported room_id does not match the source".into());
        }
        let expected_rows =
            json_array_len(&expected["blacklist"]) + json_array_len(&expected["blacklist_singers"]);
        let actual_rows: i64 = conn
            .query_row("SELECT count(*) FROM blacklist", [], |r| r.get(0))
            .map_err(error)?;
        if actual_rows as usize != expected_rows {
            return Err("imported blacklist does not match the source".into());
        }
    }
    drop(conn);
    Ok(())
}

fn json_array_len(value: &Value) -> usize {
    value.as_array().map(|a| a.len()).unwrap_or(0)
}

fn read_document(conn: &Connection, key: &str) -> Result<Option<String>> {
    match key {
        "board.config" => read_config(conn),
        "kugou.session" => match read_session(conn)? {
            Some(session) => Ok(Some(session)),
            // A session that was never a JSON object stays an opaque string.
            None => settings_row(conn, key),
        },
        _ => conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get::<_, String>(0)
            })
            .optional()
            .map_err(error),
    }
}

fn read_all(conn: &Connection) -> Result<Entries> {
    let mut entries = Entries::new();
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings ORDER BY key")
        .map_err(error)?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(error)?;
    for row in rows {
        let (key, value) = row.map_err(error)?;
        entries.insert(key, value);
    }
    if let Some(config) = read_config(conn)? {
        entries.insert("board.config".into(), config);
    }
    if let Some(session) = read_document(conn, "kugou.session")? {
        entries.insert("kugou.session".into(), session);
    }
    Ok(entries)
}

fn write_documents(conn: &mut Connection, entries: &Entries) -> Result<()> {
    let tx = conn.transaction().map_err(error)?;
    for (key, value) in entries {
        match key.as_str() {
            "board.config" => {
                validate_config(value)?;
                write_config(&tx, value)?;
            }
            "kugou.session" => {
                if session_object(value) {
                    write_session(&tx, value)?;
                    tx.execute("DELETE FROM settings WHERE key = ?1", params![key])
                        .map_err(error)?;
                } else {
                    tx.execute("DELETE FROM kugou_session", []).map_err(error)?;
                    tx.execute(
                        "INSERT INTO settings(key,value) VALUES(?1,?2)
                         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        params![key, value],
                    )
                    .map_err(error)?;
                }
            }
            _ => {
                tx.execute(
                    "INSERT INTO settings(key,value) VALUES(?1,?2)
                     ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params![key, value],
                )
                .map_err(error)?;
            }
        }
    }
    tx.commit().map_err(error)
}

fn write_config(conn: &Connection, raw: &str) -> Result<()> {
    let value: Value = serde_json::from_str(raw).map_err(error)?;
    let object = value
        .as_object()
        .ok_or("board.config must be a JSON object")?;
    let mut extra = Map::new();
    let mut songs: Vec<String> = Vec::new();
    let mut singers: Vec<String> = Vec::new();
    let mut meta = Map::new();
    for (key, value) in object {
        match key.as_str() {
            "blacklist" => songs = names(value),
            "blacklist_singers" => singers = names(value),
            "blacklist_meta" => meta = value.as_object().cloned().unwrap_or_default(),
            name if CONFIG_COLUMNS.contains(&name) => {}
            _ => {
                extra.insert(key.clone(), value.clone());
            }
        }
    }
    if !meta.is_empty() {
        extra.insert("blacklist_meta".into(), Value::Object(meta.clone()));
    }
    conn.execute(
        "INSERT INTO config(id, room_id, sing_prefix, fans_level, sing_cd, cooldown_seconds,
             max_songs_per_user, target_playlist_name, target_playlist_id, kugou_enabled,
             auto_sync, active_plugin, config_version, extra, updated_at)
         VALUES(1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
             room_id=excluded.room_id, sing_prefix=excluded.sing_prefix,
             fans_level=excluded.fans_level, sing_cd=excluded.sing_cd,
             cooldown_seconds=excluded.cooldown_seconds,
             max_songs_per_user=excluded.max_songs_per_user,
             target_playlist_name=excluded.target_playlist_name,
             target_playlist_id=excluded.target_playlist_id,
             kugou_enabled=excluded.kugou_enabled, auto_sync=excluded.auto_sync,
             active_plugin=excluded.active_plugin, config_version=excluded.config_version,
             extra=excluded.extra, updated_at=excluded.updated_at",
        params![
            text(object.get("room_id")),
            text(object.get("sing_prefix")),
            number(object.get("fans_level")),
            number(object.get("sing_cd")),
            number(object.get("cooldown_seconds")),
            number(object.get("max_songs_per_user")),
            text(object.get("target_playlist_name")),
            number(object.get("target_playlist_id")),
            boolean(object.get("kugou_enabled")),
            boolean(object.get("auto_sync")),
            text(object.get("active_plugin")),
            number(object.get("config_version")),
            Value::Object(extra).to_string(),
            now_seconds(),
        ],
    )
    .map_err(error)?;

    conn.execute("DELETE FROM blacklist", []).map_err(error)?;
    for (kind, list) in [("song", &songs), ("singer", &singers)] {
        for name in list {
            conn.execute(
                "INSERT OR IGNORE INTO blacklist(entry_type, name, created_at) VALUES(?1, ?2, ?3)",
                params![kind, name, meta.get(&format!("{kind}:{name}")).and_then(|v| v.as_i64())],
            )
            .map_err(error)?;
        }
    }
    Ok(())
}

fn read_config(conn: &Connection) -> Result<Option<String>> {
    let row = conn
        .query_row(
            "SELECT room_id, sing_prefix, fans_level, sing_cd, cooldown_seconds,
                    max_songs_per_user, target_playlist_name, target_playlist_id,
                    kugou_enabled, auto_sync, active_plugin, config_version, extra
             FROM config WHERE id = 1",
            [],
            |row| {
                let mut values = Vec::new();
                for i in 0..13 {
                    values.push(reference_value(&row.get_ref(i)?));
                }
                Ok(values)
            },
        )
        .optional()
        .map_err(error)?;
    let Some(values) = row else {
        return Ok(None);
    };
    let extra: Map<String, Value> = values[12]
        .as_str()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    let mut object = extra;
    for (i, key) in CONFIG_COLUMNS.iter().enumerate() {
        let value = &values[i];
        if value.is_null() {
            continue;
        }
        // Booleans are stored as 0/1 integers, numbers and text as themselves.
        let value = match *key {
            "kugou_enabled" | "auto_sync" => Value::Bool(value.as_i64().unwrap_or(0) != 0),
            _ => value.clone(),
        };
        object.insert((*key).to_string(), value);
    }
    let mut songs = Vec::new();
    let mut singers = Vec::new();
    let mut meta = Map::new();
    let mut stmt = conn
        .prepare("SELECT entry_type, name, created_at FROM blacklist ORDER BY id")
        .map_err(error)?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(error)?;
    for row in rows {
        let (kind, name, created_at) = row.map_err(error)?;
        let list = if kind == "song" {
            &mut songs
        } else {
            &mut singers
        };
        list.push(Value::String(name.clone()));
        if let Some(at) = created_at {
            meta.insert(format!("{kind}:{name}"), json!(at));
        }
    }
    object.insert("blacklist".into(), Value::Array(songs));
    object.insert("blacklist_singers".into(), Value::Array(singers));
    if !meta.is_empty() {
        object.insert("blacklist_meta".into(), Value::Object(meta));
    }
    Ok(Some(Value::Object(object).to_string()))
}

fn settings_row(conn: &Connection, key: &str) -> Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .map_err(error)
}

fn session_object(raw: &str) -> bool {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|v| {
            let object = v.as_object()?;
            Some(object.get("token").and_then(|t| t.as_str()).is_some()
                && object.get("userid").and_then(|u| u.as_str()).is_some())
        })
        .unwrap_or(false)
}

fn write_session(conn: &Connection, raw: &str) -> Result<()> {
    let value: Value = serde_json::from_str(raw).map_err(error)?;
    let Some(object) = value.as_object() else {
        return Err("kugou.session must be a JSON object".into());
    };
    let token = object
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or("kugou.session has no token")?;
    let userid = object
        .get("userid")
        .and_then(|v| v.as_str())
        .ok_or("kugou.session has no userid")?;
    conn.execute(
        "INSERT INTO kugou_session(id, token, userid, dfid, nickname, refreshed_at)
         VALUES(1, ?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET token=excluded.token, userid=excluded.userid,
             dfid=excluded.dfid, nickname=excluded.nickname, refreshed_at=excluded.refreshed_at",
        params![
            token,
            userid,
            text(object.get("dfid")),
            text(object.get("nickname")),
            number(object.get("refreshed_at")),
        ],
    )
    .map(|_| ())
    .map_err(error)
}

fn read_session(conn: &Connection) -> Result<Option<String>> {
    let row = conn
        .query_row(
            "SELECT token, userid, dfid, nickname FROM kugou_session WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(error)?;
    let Some((token, userid, dfid, nickname)) = row else {
        return Ok(None);
    };
    let mut object = Map::new();
    object.insert("token".into(), Value::String(token));
    object.insert("userid".into(), Value::String(userid.clone()));
    object.insert(
        "dfid".into(),
        Value::String(dfid.unwrap_or_else(|| "-".to_string())),
    );
    object.insert(
        "nickname".into(),
        Value::String(nickname.unwrap_or(userid)),
    );
    Ok(Some(Value::Object(object).to_string()))
}

fn reference_value(value: &ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(n) => json!(*n),
        ValueRef::Real(n) => json!(*n),
        ValueRef::Text(s) => json!(std::str::from_utf8(s).unwrap_or_default()),
        ValueRef::Blob(s) => json!(s),
    }
}

fn names(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn text(value: Option<&Value>) -> Option<String> {
    // "" is a value ("no platform selected"), so only a missing or non-string
    // key becomes NULL.
    value.and_then(|v| v.as_str()).map(str::to_string)
}

fn number(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|n| n as i64))
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
}

fn boolean(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    value
        .as_bool()
        .map(|b| if b { 1 } else { 0 })
        .or_else(|| value.as_i64())
}

fn read_kv(conn: &Connection) -> Result<Entries> {
    let mut entries = Entries::new();
    let mut stmt = conn
        .prepare("SELECT key, value FROM nsh_kv ORDER BY key")
        .map_err(error)?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(error)?;
    for row in rows {
        let (key, value) = row.map_err(error)?;
        entries.insert(key, value);
    }
    Ok(entries)
}

fn rows(conn: &Connection, table: &str) -> Result<Vec<Value>> {
    if !table_exists(conn, table)? {
        return Ok(vec![]);
    }
    // Only internal, fixed table names reach this helper.
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
        .map_err(error)?;
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut cursor = stmt.query([]).map_err(error)?;
    let mut output = Vec::new();
    while let Some(row) = cursor.next().map_err(error)? {
        let mut object = Map::new();
        for (i, name) in columns.iter().enumerate() {
            object.insert(name.clone(), reference_value(&row.get_ref(i).map_err(error)?));
        }
        output.push(Value::Object(object));
    }
    Ok(output)
}

fn string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn legacy_number(value: &Value, default: f64) -> f64 {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .filter(|n| n.is_finite())
        .unwrap_or(default)
}

/// Reads the Tauri application's tables into the app's documents.
fn tauri_entries(conn: &Connection) -> Result<Option<Entries>> {
    let configs = rows(conn, "config")?;
    let Some(cfg) = configs.first() else {
        return Ok(None);
    };
    let mut songs = Vec::new();
    let mut singers = Vec::new();
    let mut meta = Map::new();
    for row in rows(conn, "blacklist")? {
        let kind = string(&row["entry_type"]);
        let name = string(&row[if kind == "song" {
            "song_name"
        } else {
            "singer_name"
        }]);
        if name.is_empty() || (kind != "song" && kind != "singer") {
            continue;
        }
        let list = if kind == "song" {
            &mut songs
        } else {
            &mut singers
        };
        if !list.contains(&name) {
            list.push(name.clone());
        }
        meta.insert(
            format!("{kind}:{name}"),
            json!(legacy_number(&row["created_at"], 0.0) as i64),
        );
    }
    let enabled = cfg.get("kugou_enabled").is_none()
        || legacy_number(&cfg["kugou_enabled"], 0.0) != 0.0;
    let prefix = string(&cfg["sing_prefix"]);
    let config = json!({
        "room_id": string(&cfg["room_id"]),
        "sing_prefix": if prefix.is_empty() { "点歌[space][song]".to_string() } else { prefix },
        "fans_level": legacy_number(&cfg["fans_level"], 0.0),
        "sing_cd": legacy_number(&cfg["sing_cd"], 0.0),
        "cooldown_seconds": legacy_number(&cfg["cooldown_seconds"], 1800.0),
        "max_songs_per_user": legacy_number(&cfg["max_songs_per_user"], 3.0),
        "target_playlist_name": string(&cfg["target_playlist_name"]),
        "target_playlist_id": legacy_number(&cfg["target_playlist_id"], 0.0),
        "kugou_enabled": enabled,
        "active_plugin": if enabled { "kugou" } else { "" },
        "blacklist": songs,
        "blacklist_singers": singers,
        "blacklist_meta": meta,
        "auto_sync": false,
        "config_version": 2
    });
    let mut entries = Entries::from([
        ("board.config".to_string(), config.to_string()),
        ("board.theme".to_string(), "system".to_string()),
    ]);
    if let Some(session) = rows(conn, "kugou_session")?.first() {
        let token = string(&session["token"]);
        let userid = string(&session["userid"]);
        if !token.is_empty() && !userid.is_empty() {
            let dfid = string(&session["dfid"]);
            entries.insert(
                "kugou.session".to_string(),
                json!({
                    "token": token,
                    "userid": userid,
                    "dfid": if dfid.is_empty() { "-".to_string() } else { dfid },
                    "nickname": userid
                })
                .to_string(),
            );
        }
    }
    Ok(Some(entries))
}

#[cfg(test)]
mod tests;

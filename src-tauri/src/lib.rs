mod kugou;
mod kugou_api;
mod sidecar;

use std::sync::Arc;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

const DB_NAME: &str = "sqlite:sususongboard.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init: config + history",
            sql: "
                CREATE TABLE config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    room_id TEXT NOT NULL DEFAULT '',
                    sing_prefix TEXT NOT NULL DEFAULT '点歌[space][song]',
                    fans_level INTEGER NOT NULL DEFAULT 0,
                    sing_cd INTEGER NOT NULL DEFAULT 60
                );
                INSERT OR IGNORE INTO config (id) VALUES (1);

                CREATE TABLE history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    msg_id TEXT NOT NULL UNIQUE,
                    uid TEXT NOT NULL,
                    uname TEXT NOT NULL,
                    song_name TEXT NOT NULL,
                    raw_msg TEXT NOT NULL,
                    medal_level INTEGER NOT NULL DEFAULT 0,
                    medal_name TEXT NOT NULL DEFAULT '',
                    send_time INTEGER NOT NULL,
                    session_id TEXT NOT NULL
                );
                CREATE INDEX idx_history_session ON history(session_id);
                CREATE INDEX idx_history_send_time ON history(send_time DESC);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "kugou session (token / userid / dfid + refresh marker)",
            sql: "
                CREATE TABLE kugou_session (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    token TEXT NOT NULL DEFAULT '',
                    userid TEXT NOT NULL DEFAULT '',
                    dfid TEXT NOT NULL DEFAULT '',
                    refreshed_at INTEGER NOT NULL DEFAULT 0
                );
                INSERT OR IGNORE INTO kugou_session (id) VALUES (1);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "config: target_playlist_name + target_playlist_id (auto-add destination)",
            sql: "
                ALTER TABLE config ADD COLUMN target_playlist_name TEXT NOT NULL DEFAULT '';
                ALTER TABLE config ADD COLUMN target_playlist_id INTEGER NOT NULL DEFAULT 0;
            ",
            kind: MigrationKind::Up,
        },
    ]
}

#[tauri::command]
fn show_window(window: tauri::WebviewWindow) {
    let _ = window.show();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_NAME, migrations())
                .build(),
        )
        .setup(|app| {
            let handle = Arc::new(sidecar::SidecarHandle::new());
            app.manage(handle.clone());

            let app_handle = app.handle().clone();
            let handle_spawn = handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = handle_spawn.spawn(app_handle.clone()).await {
                    eprintln!("[tauri] sidecar spawn failed: {}", e);
                }
            });

            let kugou_api_handle = Arc::new(kugou_api::KugouApiHandle::new());
            app.manage(kugou_api_handle.clone());

            let app_handle_kg = app.handle().clone();
            let kugou_spawn = kugou_api_handle.clone();
            let handle_notify = handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = kugou_spawn.spawn(app_handle_kg.clone()).await {
                    eprintln!("[tauri] kugou-api spawn failed: {}", e);
                    return;
                }
                // Tell sidecar the kugou-api pid so it can kill it on watchdog exit.
                if let Some(pid) = kugou_api::get_pid() {
                    let cmd = serde_json::json!({ "cmd": "set_companion_pid", "pid": pid });
                    if let Err(e) = handle_notify.send(cmd).await {
                        eprintln!("[tauri] set_companion_pid failed: {e}");
                    }
                }
            });

            // Kill all child processes when the main window is destroyed.
            // Covers Alt+F4, taskbar close, OS shutdown on Windows where
            // kill_on_drop is unreliable.
            let win = app.get_webview_window("main").unwrap();
            let handle_exit = handle.clone();
            let kugou_exit = kugou_api_handle.clone();
            let win_clone = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Prevent the default close so we can do cleanup first.
                    api.prevent_close();
                    let h = handle_exit.clone();
                    let k = kugou_exit.clone();
                    let w = win_clone.clone();
                    tauri::async_runtime::spawn(async move {
                        // 1. Send stop to sidecar — disconnects live room and stops autoSync.
                        let _ = h.send(serde_json::json!({ "cmd": "stop" })).await;
                        // 2. Brief grace period for sidecar to disconnect cleanly.
                        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                        // 3. Kill both child process trees.
                        h.kill().await;
                        k.kill().await;
                        // 4. Now actually close the window.
                        let _ = w.close();
                    });
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sidecar::sidecar_send,
            kugou::kugou_search,
            kugou_api::kugou_api_request,
            show_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

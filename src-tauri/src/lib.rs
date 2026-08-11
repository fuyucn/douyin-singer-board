mod douyin;
mod kugou;
mod kugou_api;
mod sidecar;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_updater::UpdaterExt;

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
        Migration {
            version: 4,
            description: "config: cooldown_seconds (song dedup window)",
            sql: "
                ALTER TABLE config ADD COLUMN cooldown_seconds INTEGER NOT NULL DEFAULT 1800;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "telemetry: opt-in event tracking (default off)",
            sql: "
                CREATE TABLE telemetry_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts INTEGER NOT NULL,
                    event TEXT NOT NULL,
                    props_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX idx_tel_ts ON telemetry_events(ts);

                CREATE TABLE telemetry_config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    opt_in INTEGER NOT NULL DEFAULT 0,
                    device_id TEXT NOT NULL DEFAULT ''
                );
                INSERT OR IGNORE INTO telemetry_config (id) VALUES (1);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description:
                "config: max_songs_per_user (per-user per-session request limit, 0=unlimited)",
            sql: "
                ALTER TABLE config ADD COLUMN max_songs_per_user INTEGER NOT NULL DEFAULT 3;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "config: kugou_enabled (master switch, default off)",
            sql: "
                ALTER TABLE config ADD COLUMN kugou_enabled INTEGER NOT NULL DEFAULT 0;
            ",
            kind: MigrationKind::Up,
        },
    ]
}

#[tauri::command]
fn show_window(window: tauri::WebviewWindow) {
    let _ = window.show();
}

/// Download and install the update described by `manifest_url` (a URL pointing
/// to a Tauri `latest.json` manifest).  Emits `updater://progress` events
/// during download, then returns when installation is complete (caller should
/// then prompt the user to restart).
#[tauri::command]
async fn install_app_update(app: tauri::AppHandle, manifest_url: String) -> Result<(), String> {
    let url: url::Url = manifest_url
        .parse()
        .map_err(|e: url::ParseError| e.to_string())?;

    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;

    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(update) = update {
        let app_progress = app.clone();
        update
            .download_and_install(
                move |chunk_length, content_length| {
                    let _ = app_progress.emit(
                        "updater://progress",
                        serde_json::json!({
                            "downloaded": chunk_length,
                            "total": content_length
                        }),
                    );
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Restart the application to apply a pending update (macOS / NSIS-installed).
#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

/// Start or stop the kugou-api HTTP server hosted inside the Node sidecar.
#[tauri::command]
async fn kugou_set_enabled(
    app: tauri::AppHandle,
    enabled: bool,
    kugou: tauri::State<'_, kugou_api::KugouApiState>,
    sidecar: tauri::State<'_, sidecar::SidecarState>,
) -> Result<(), String> {
    if enabled {
        kugou.spawn(app.clone(), sidecar.inner()).await?;
        Ok(())
    } else {
        kugou.kill(sidecar.inner()).await
    }
}

/// Download the new portable exe into the same directory as the current exe,
/// saved as `SUSUSongBoard_new.exe`.  Returns Ok when the download is complete.
/// The user then manually launches the new exe from that folder.
#[tauri::command]
async fn install_portable_update(app: tauri::AppHandle, exe_url: String) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, exe_url);
        return Err("install_portable_update is only available on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use futures_util::StreamExt;

        let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let dir = current_exe
            .parent()
            .ok_or_else(|| "cannot determine exe directory".to_string())?;
        // Use the filename from the URL (e.g. SUSUSongBoard-Windows-x64-0.0.39-85.exe)
        // so the downloaded file is clearly identified by version.
        let file_name = exe_url
            .rsplit('/')
            .next()
            .filter(|s| s.ends_with(".exe"))
            .unwrap_or("SUSUSongBoard_new.exe");
        let new_exe = dir.join(file_name);

        // Stream-download directly into the same directory.
        let client = reqwest::Client::new();
        let response = client
            .get(&exe_url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let total_size = response.content_length();
        let mut downloaded: u64 = 0;
        let mut buf: Vec<u8> = Vec::new();
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            downloaded += chunk.len() as u64;
            buf.extend_from_slice(&chunk);
            let _ = app.emit(
                "updater://progress",
                serde_json::json!({ "downloaded": downloaded, "total": total_size }),
            );
        }

        std::fs::write(&new_exe, &buf).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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

            // Kill all child processes when the main window is destroyed.
            // Covers Alt+F4, taskbar close, OS shutdown on Windows where
            // kill_on_drop is unreliable. The kugou server lives inside the
            // sidecar, so only the cached port needs clearing here.
            let win = app.get_webview_window("main").unwrap();
            let handle_exit = handle.clone();
            let kugou_exit = kugou_api_handle.clone();
            let win_clone = win.clone();
            // Prevent re-entering cleanup when w.close() fires a second CloseRequested.
            let closing = Arc::new(AtomicBool::new(false));
            win.on_window_event(move |event| {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        // Second CloseRequested comes from our own w.close() — let it through.
                        if closing.swap(true, Ordering::SeqCst) {
                            return;
                        }
                        api.prevent_close();
                        let h = handle_exit.clone();
                        let k = kugou_exit.clone();
                        let w = win_clone.clone();
                        tauri::async_runtime::spawn(async move {
                            // 1. Stop sidecar — disconnects live room + stops autoSync.
                            let _ = h.send(serde_json::json!({ "cmd": "stop" })).await;
                            // 2. Grace period for clean disconnect.
                            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                            // 3. Forget the kugou port, then kill the sidecar
                            // (which stops the in-process kugou server).
                            k.reset().await;
                            h.kill().await;
                            // 4. Now close the window.
                            let _ = w.close();
                        });
                    }
                    tauri::WindowEvent::Destroyed => {
                        // Fallback: OS force-kill or crash — still kill child processes.
                        let h = handle_exit.clone();
                        let k = kugou_exit.clone();
                        tauri::async_runtime::spawn(async move {
                            k.reset().await;
                            h.kill().await;
                        });
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sidecar::sidecar_send,
            sidecar::sidecar_wait_ready,
            sidecar::sidecar_respawn,
            kugou_set_enabled,
            kugou::kugou_search,
            kugou_api::kugou_api_request,
            douyin::douyin_room_info,
            show_window,
            install_app_update,
            install_portable_update,
            relaunch_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

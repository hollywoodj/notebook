use std::path::PathBuf;

use notebook_api::ServerConfig;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .map(|p| p.join("notebook.db"))
                .unwrap_or_else(|_| PathBuf::from("notebook.db"));

            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
                rt.block_on(async {
                    notebook_api::init_tracing();
                    let _ = notebook_api::run(ServerConfig {
                        host: "127.0.0.1".into(),
                        port: 8799,
                        db_path: Some(db_path.to_string_lossy().to_string()),
                    })
                    .await;
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

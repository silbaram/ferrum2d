mod placement_document;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            placement_document::load_placement_scene_document,
            placement_document::save_placement_scene_document,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Ferrum2D placement viewer desktop app");
}

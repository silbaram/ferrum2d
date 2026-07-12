mod placement_document;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(placement_document::PlacementAssetRegistry::default())
        .register_uri_scheme_protocol("ferrum-asset", |context, request| {
            placement_document::placement_asset_protocol_response(context, request)
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            placement_document::inspect_placement_asset_folder,
            placement_document::load_placement_project_folder,
            placement_document::load_placement_scene_document,
            placement_document::save_placement_agent_handoff,
            placement_document::save_placement_scene_document,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Ferrum2D placement viewer desktop app");
}

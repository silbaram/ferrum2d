// The headless library exposes no app entry point; its private storage is exercised by tests.
#[cfg_attr(not(feature = "desktop"), allow(dead_code))]
mod placement_document;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(feature = "desktop")]
pub fn run() {
    tauri::Builder::default()
        .manage(placement_document::PlacementAssetRegistry::default())
        .manage(placement_document::PlacementWriteRegistry::default())
        .register_uri_scheme_protocol("ferrum-asset", |context, request| {
            placement_document::placement_asset_protocol_response(context, request)
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            placement_document::inspect_placement_asset_folder,
            placement_document::load_placement_project_folder,
            placement_document::load_placement_scene_document,
            placement_document::load_placement_aseprite_assets,
            placement_document::load_placement_tile_assets,
            placement_document::save_placement_tile_assets,
            placement_document::save_placement_aseprite_assets,
            placement_document::load_placement_normal_assets,
            placement_document::save_placement_normal_assets,
            placement_document::save_placement_agent_handoff,
            placement_document::save_placement_scene_document,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Ferrum2D placement viewer desktop app");
}

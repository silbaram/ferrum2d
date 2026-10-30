// The headless library exposes no app entry point; its private storage is exercised by tests.
#[cfg_attr(not(feature = "desktop"), allow(dead_code))]
mod placement_document;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(feature = "desktop")]
pub fn run() {
    use tauri::Manager;
    tauri::Builder::default()
        .manage(placement_document::PlacementAssetRegistry::default())
        .manage(placement_document::PlacementWriteRegistry::default())
        .manage(placement_document::updates::UpdateState::default())
        .register_uri_scheme_protocol("ferrum-asset", |context, request| {
            placement_document::placement_asset_protocol_response(context, request)
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .state::<placement_document::updates::UpdateState>()
                    .is_busy()
                {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            placement_document::updates::placement_update_info,
            placement_document::updates::check_placement_project_update,
            placement_document::updates::apply_placement_project_update,
            placement_document::updates::check_placement_viewer_update,
            placement_document::updates::apply_placement_viewer_update,
            placement_document::updates::restart_placement_viewer_after_update,
            placement_document::updates::open_placement_release_page,
            placement_document::inspect_placement_asset_folder,
            placement_document::load_placement_project_folder,
            placement_document::load_placement_scene_document,
            placement_document::list_placement_project_scenes,
            placement_document::load_placement_aseprite_assets,
            placement_document::load_placement_pixel_assets,
            placement_document::save_placement_pixel_assets,
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

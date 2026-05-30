use super::*;

#[test]
fn tilemap_appends_static_tile_render_commands() {
    let mut tilemap = Tilemap::default();
    tilemap.set_tile_definition(1, 7, 0.25, 0.0, 0.5, 0.25, 0.8, 0.7, 0.6, 1.0);
    tilemap.set_layer(0, 2, 1, 32.0, 16.0, 10.0, 20.0, false, vec![1, 0]);
    let camera = Camera2D::new(320.0, 240.0);
    let mut commands = Vec::new();

    tilemap.append_render_commands(&camera, &mut commands);

    assert_eq!(commands.len(), 1);
    let command = commands[0];
    assert_eq!(command.texture_id, 7.0);
    assert_eq!(command.width, 32.0);
    assert_eq!(command.height, 16.0);
    assert_eq!(command.u0, 0.25);
    assert_eq!(command.v1, 0.25);
    assert_eq!(command.r, 0.8);
    assert!((command.x - 10.0).abs() < 0.01);
    assert!((command.y - 20.0).abs() < 0.01);
}

#[test]
fn undefined_tiles_are_skipped() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 3, 1, 16.0, 16.0, 0.0, 0.0, false, vec![0, 2, 0]);
    let camera = Camera2D::new(320.0, 240.0);
    let mut commands = Vec::new();

    tilemap.append_render_commands(&camera, &mut commands);

    assert!(commands.is_empty());
}

#[test]
fn tilemap_render_commands_are_limited_to_camera_viewport() {
    let mut tilemap = Tilemap::default();
    tilemap.set_tile_definition(1, 7, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_layer(0, 100, 1, 16.0, 16.0, 0.0, 0.0, false, vec![1; 100]);
    let mut camera = Camera2D::new(32.0, 16.0);
    camera.x = 24.0;
    camera.y = 8.0;
    let mut commands = Vec::new();

    tilemap.append_render_commands(&camera, &mut commands);

    assert_eq!(commands.len(), 3);
    assert_eq!(commands[0].x, -8.0);
    assert_eq!(commands[1].x, 8.0);
    assert_eq!(commands[2].x, 24.0);
}

#[test]
fn tilemap_buckets_visible_layer_commands_by_texture() {
    let mut tilemap = Tilemap::default();
    tilemap.set_tile_definition(1, 1, 0.0, 0.0, 0.25, 0.25, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_tile_definition(2, 2, 0.25, 0.0, 0.5, 0.25, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_tile_definition(3, 1, 0.5, 0.0, 0.75, 0.25, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_layer(0, 5, 1, 16.0, 16.0, 0.0, 0.0, false, vec![1, 2, 3, 2, 1]);
    let camera = Camera2D::new(160.0, 32.0);
    let mut commands = Vec::new();

    tilemap.append_render_commands(&camera, &mut commands);

    assert_eq!(
        commands
            .iter()
            .map(|command| command.texture_id as u32)
            .collect::<Vec<_>>(),
        vec![1, 1, 1, 2, 2]
    );
}

#[test]
fn tilemap_texture_bucketing_preserves_layer_boundaries() {
    let mut tilemap = Tilemap::default();
    tilemap.set_tile_definition(1, 1, 0.0, 0.0, 0.25, 0.25, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_tile_definition(2, 2, 0.25, 0.0, 0.5, 0.25, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_tile_definition(3, 3, 0.5, 0.0, 0.75, 0.25, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_layer(0, 3, 1, 16.0, 16.0, 0.0, 0.0, false, vec![2, 1, 2]);
    tilemap.set_layer(1, 1, 1, 16.0, 16.0, 0.0, 16.0, false, vec![3]);
    let camera = Camera2D::new(160.0, 64.0);
    let mut commands = Vec::new();

    tilemap.append_render_commands(&camera, &mut commands);

    assert_eq!(
        commands
            .iter()
            .map(|command| command.texture_id as u32)
            .collect::<Vec<_>>(),
        vec![1, 2, 2, 3]
    );
}

#[test]
fn tilemap_render_commands_skip_layers_outside_camera_viewport() {
    let mut tilemap = Tilemap::default();
    tilemap.set_tile_definition(1, 7, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_layer(0, 4, 1, 16.0, 16.0, 1000.0, 0.0, false, vec![1; 4]);
    let camera = Camera2D::new(32.0, 16.0);
    let mut commands = Vec::new();

    tilemap.append_render_commands(&camera, &mut commands);

    assert!(commands.is_empty());
}

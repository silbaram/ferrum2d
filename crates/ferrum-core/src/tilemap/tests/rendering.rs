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

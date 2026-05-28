use super::*;

#[test]
fn particle_preset_api_spawns_and_appends_render_commands_after_entities() {
    let mut engine = Engine::new();
    engine.build_render_commands();
    let entity_command_count = engine.render_commands.len();

    engine.set_particle_seed(7);
    engine.set_particle_preset(
        0, 77, 0.0, 0.0, 1.0, 1.0, 1, 1.0, 1.0, 0.0, 0.0, 6.0, 6.0, 2.0, 2.0, 1.0, 0.5, 0.25, 1.0,
        1.0, 0.5, 0.25, 0.5, 0.0, 0.0, 0.0,
    );

    let spawned = engine.spawn_particle_burst(0, engine.camera_x(), engine.camera_y());
    engine.build_render_commands();

    assert_eq!(spawned, 1);
    assert_eq!(engine.particle_count(), 1);
    assert_eq!(engine.render_commands.len(), entity_command_count + 1);
    let command = engine.render_commands.last().unwrap();
    assert_eq!(command.texture_id, 77.0);
    assert_eq!(command.width, 6.0);
    assert_eq!(command.height, 6.0);
    assert_eq!(command.u0, 0.0);
    assert_eq!(command.v0, 0.0);
    assert_eq!(command.u1, 1.0);
    assert_eq!(command.v1, 1.0);
    assert_eq!(command.r, 1.0);
    assert_eq!(command.a, 1.0);
}

#[test]
fn particle_api_reports_missing_preset_and_updates_lifetime() {
    let mut engine = Engine::new();

    assert_eq!(engine.spawn_particle_burst(0, 0.0, 0.0), 0);
    engine.set_particle_preset(
        0, 77, 0.0, 0.0, 1.0, 1.0, 2, 0.05, 0.05, 0.0, 0.0, 4.0, 4.0, 4.0, 4.0, 1.0, 1.0, 1.0, 1.0,
        1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0,
    );

    assert_eq!(engine.spawn_particle_burst(0, 0.0, 0.0), 2);
    assert_eq!(engine.particle_capacity(), 512);
    assert_eq!(engine.particle_count(), 2);

    engine.update(0.1);

    assert_eq!(engine.particle_count(), 0);
    engine.clear_particles();
    engine.clear_particle_presets();
    assert_eq!(engine.spawn_particle_burst(0, 0.0, 0.0), 0);
}

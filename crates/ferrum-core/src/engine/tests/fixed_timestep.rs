use super::*;

#[test]
fn fixed_timestep_is_opt_in_and_reports_steps() {
    let mut engine = Engine::new();

    engine.update(0.25);

    assert!(!engine.fixed_timestep_enabled());
    assert_eq!(engine.physics_fixed_steps(), 0);

    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
    engine.update(0.25);

    assert!(engine.fixed_timestep_enabled());
    assert_eq!(engine.physics_fixed_steps(), 2);
    assert!((engine.fixed_timestep_alpha() - 0.5).abs() < 0.01);
    assert!((engine.fixed_timestep_consumed_seconds() - 0.2).abs() < 0.01);
}

#[test]
fn fixed_timestep_waits_until_accumulator_reaches_step() {
    let mut engine = Engine::new();
    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);

    engine.update(0.05);

    assert_eq!(engine.physics_fixed_steps(), 0);
    assert!((engine.fixed_timestep_alpha() - 0.5).abs() < 0.01);
    assert!(engine.collision_events.is_empty());
}

#[test]
fn fixed_timestep_latches_action_input_until_next_step() {
    let mut engine = Engine::new();
    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);

    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update(0.05);
    assert_eq!(engine.physics_fixed_steps(), 0);
    assert_eq!(engine.game_state_code(), 0);

    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
    engine.update(0.05);

    assert_eq!(engine.physics_fixed_steps(), 1);
    assert_eq!(engine.game_state_code(), 1);
}

#[test]
fn gameplay_authoring_setters_do_not_reset_fixed_timestep_history() {
    let mut engine = Engine::new();
    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
    let enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

    engine.update(0.05);
    assert_eq!(engine.physics_fixed_steps(), 0);
    assert!((engine.fixed_timestep_alpha() - 0.5).abs() < 0.01);

    assert!(engine.set_gameplay_health(enemy.id, enemy.generation, 3.0));
    assert!((engine.fixed_timestep_alpha() - 0.5).abs() < 0.01);

    engine.update(0.05);
    assert_eq!(engine.physics_fixed_steps(), 1);
}

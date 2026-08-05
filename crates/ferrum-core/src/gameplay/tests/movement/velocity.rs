use super::*;

#[test]
fn topdown_input_velocity_normalizes_direction_and_applies_speed() {
    let velocity = topdown_input_velocity(
        InputState {
            w: 1,
            d: 1,
            ..InputState::default()
        },
        10.0,
    );
    let expected = std::f32::consts::FRAC_1_SQRT_2 * 10.0;
    assert!((velocity.vx - expected).abs() < 0.0001);
    assert!((velocity.vy + expected).abs() < 0.0001);
    assert_eq!(
        topdown_input_velocity(InputState::default(), 10.0),
        Velocity::default(),
    );
}

#[test]
fn apply_topdown_input_movement_uses_pattern_speed_or_default() {
    let mut world = World::default();
    let player = world.spawn_player(0.0, 0.0, 1);
    let input = InputState {
        d: 1,
        ..InputState::default()
    };

    assert_eq!(
        apply_topdown_input_movement(&mut world, player.id as usize, input, 120.0),
        MovementPatternApplication::Applied,
    );
    assert_eq!(
        world.velocity(player),
        Some(Velocity { vx: 120.0, vy: 0.0 }),
    );

    world.set_movement_pattern(player, MovementPattern::TopdownInput { speed: 200.0 });
    assert_eq!(
        apply_topdown_input_movement(&mut world, player.id as usize, input, 120.0),
        MovementPatternApplication::Applied,
    );
    assert_eq!(
        world.velocity(player),
        Some(Velocity { vx: 200.0, vy: 0.0 }),
    );
    assert_eq!(
        apply_topdown_input_movement(&mut world, 99_999, input, 120.0),
        MovementPatternApplication::Unsupported,
    );
}

#[test]
fn run_topdown_input_movement_system_checks_entity_generation() {
    let mut world = World::default();
    let player = world.spawn_player(0.0, 0.0, 1);
    let input = InputState {
        d: 1,
        ..InputState::default()
    };

    assert_eq!(
        run_topdown_input_movement_system(&mut world, player, input, 120.0),
        MovementPatternApplication::Applied,
    );
    assert_eq!(
        world.velocity(player),
        Some(Velocity { vx: 120.0, vy: 0.0 }),
    );

    let stale_player = Entity {
        generation: player.generation + 1,
        ..player
    };
    world.set_velocity(player, Velocity { vx: 3.0, vy: 4.0 });
    assert_eq!(
        run_topdown_input_movement_system(&mut world, stale_player, input, 120.0),
        MovementPatternApplication::Unsupported,
    );
    assert_eq!(world.velocity(player), Some(Velocity { vx: 3.0, vy: 4.0 }),);

    world.despawn(player);
    assert!(!world.is_alive_index(player.id as usize));
    assert_eq!(
        run_topdown_input_movement_system(&mut world, player, input, 120.0),
        MovementPatternApplication::Unsupported,
    );
}

#[test]
fn topdown_input_movement_phase_config_applies_input_snapshot() {
    let mut world = World::default();
    let player = world.spawn_player(0.0, 0.0, 1);
    let config = TopdownInputMovementPhaseConfig {
        entity: player,
        input: FrameInputSnapshot::current_only(InputState {
            d: 1,
            ..InputState::default()
        }),
        default_speed: 120.0,
    };

    assert_eq!(
        apply_topdown_input_movement_phase(&mut world, config),
        MovementPatternApplication::Applied,
    );
    assert_eq!(
        world.velocity(player),
        Some(Velocity { vx: 120.0, vy: 0.0 }),
    );

    let stale_config = TopdownInputMovementPhaseConfig {
        entity: Entity {
            generation: player.generation + 1,
            ..player
        },
        ..config
    };
    world.set_velocity(player, Velocity { vx: 3.0, vy: 4.0 });
    assert_eq!(
        apply_topdown_input_movement_phase(&mut world, stale_config),
        MovementPatternApplication::Unsupported,
    );
    assert_eq!(world.velocity(player), Some(Velocity { vx: 3.0, vy: 4.0 }),);
}

#[test]
fn frame_input_snapshot_keeps_current_and_previous_inputs() {
    let current = InputState {
        d: 1,
        mouse_x: 10.0,
        ..InputState::default()
    };
    let previous = InputState {
        mouse_left: 1,
        mouse_y: 20.0,
        ..InputState::default()
    };

    assert_eq!(
        FrameInputSnapshot::new(current, previous),
        FrameInputSnapshot { current, previous },
    );
    assert_eq!(
        FrameInputSnapshot::current_only(current),
        FrameInputSnapshot {
            current,
            previous: current,
        },
    );
}

#[test]
fn run_topdown_input_movement_system_uses_default_for_non_topdown_pattern() {
    let mut world = World::default();
    let player = world.spawn_player(0.0, 0.0, 1);
    world.set_movement_pattern(player, MovementPattern::Linear { vx: 3.0, vy: 4.0 });
    let input = InputState {
        d: 1,
        ..InputState::default()
    };

    assert_eq!(
        run_topdown_input_movement_system(&mut world, player, input, 120.0),
        MovementPatternApplication::Applied,
    );
    assert_eq!(
        world.velocity(player),
        Some(Velocity { vx: 120.0, vy: 0.0 }),
    );
}

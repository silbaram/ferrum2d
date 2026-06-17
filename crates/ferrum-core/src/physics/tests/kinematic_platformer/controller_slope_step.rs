use super::*;

#[test]
fn platformer_controller_snaps_up_walkable_slope() {
    let mut world = World::default();
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        9.0,
        CollisionLayer::Player,
        true,
        1.0,
        1.0,
    );
    let slopes = [SlopeSegment::new(0.0, 10.0, 10.0, 5.0)];

    let result = PhysicsSystem::move_platformer_controller_with_slopes(
        &mut world,
        &slopes,
        mover,
        PlatformerControllerInput::new(1.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_horizontal_speed(5.0)
            .with_gravity(0.0)
            .with_slope_config(SlopeConfig::new(0.5, 3.0)),
        1.0,
    );

    assert!(result.ground_before.is_some());
    assert!(result.grounded);
    assert_eq!(result.velocity, Velocity { vx: 5.0, vy: 0.0 });
    assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 6.5 }));
    let ground_after = result
        .ground_after
        .expect("slope should count as controller ground");
    assert_eq!(ground_after.entity, None);
    assert_eq!(ground_after.tile_layer_index, None);
    assert!(ground_after.normal_y > GROUND_NORMAL_Y_MIN);
}

#[test]
fn platformer_controller_slope_snap_preserves_horizontal_velocity_policy() {
    let mut world = World::default();
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        9.0,
        CollisionLayer::Player,
        true,
        1.0,
        1.0,
    );
    let slopes = [SlopeSegment::new(0.0, 10.0, 10.0, 5.0)];

    let result = PhysicsSystem::move_platformer_controller_with_slopes(
        &mut world,
        &slopes,
        mover,
        PlatformerControllerInput::new(1.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_horizontal_speed(5.0)
            .with_gravity(0.0)
            .with_slope_config(SlopeConfig::new(0.5, 3.0)),
        1.0,
    );

    let movement = result.movement;
    let moved_x = movement.end.x - movement.start.x;
    let moved_y = movement.end.y - movement.start.y;
    let path_length = (moved_x * moved_x + moved_y * moved_y).sqrt();

    assert_eq!(result.velocity, Velocity { vx: 5.0, vy: 0.0 });
    assert!((moved_x - 5.0).abs() < 0.001);
    assert!((moved_y + 2.5).abs() < 0.001);
    assert!(
        path_length > result.velocity.vx.abs(),
        "current slope snap preserves horizontal velocity while adding vertical snap, path_length={path_length}"
    );
}

#[test]
fn platformer_controller_snaps_down_walkable_slope() {
    let mut world = World::default();
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        4.0,
        CollisionLayer::Player,
        true,
        1.0,
        1.0,
    );
    let slopes = [SlopeSegment::new(0.0, 5.0, 10.0, 10.0)];

    let result = PhysicsSystem::move_platformer_controller_with_slopes(
        &mut world,
        &slopes,
        mover,
        PlatformerControllerInput::new(1.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_horizontal_speed(5.0)
            .with_gravity(0.0)
            .with_slope_config(SlopeConfig::new(0.5, 3.0)),
        1.0,
    );

    assert!(result.grounded);
    assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 6.5 }));
    assert_eq!(result.velocity, Velocity { vx: 5.0, vy: 0.0 });
}

#[test]
fn platformer_controller_respects_slope_limits_and_downhill_opt_out() {
    let mut steep_world = World::default();
    let steep_mover = spawn_kinematic_body_with_size(
        &mut steep_world,
        0.0,
        9.0,
        CollisionLayer::Player,
        true,
        1.0,
        1.0,
    );
    let steep_slopes = [SlopeSegment::new(0.0, 10.0, 1.0, 0.0)];

    let steep_result = PhysicsSystem::move_platformer_controller_with_slopes(
        &mut steep_world,
        &steep_slopes,
        steep_mover,
        PlatformerControllerInput::new(1.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_horizontal_speed(1.0)
            .with_gravity(0.0)
            .with_slope_config(SlopeConfig::new(0.5, 20.0)),
        1.0,
    );

    assert!(!steep_result.grounded);
    assert_eq!(
        steep_world.transform(steep_mover),
        Some(Transform2D { x: 1.0, y: 9.0 })
    );

    let mut downhill_world = World::default();
    let downhill_mover = spawn_kinematic_body_with_size(
        &mut downhill_world,
        0.0,
        4.0,
        CollisionLayer::Player,
        true,
        1.0,
        1.0,
    );
    let downhill_slopes = [SlopeSegment::new(0.0, 5.0, 10.0, 10.0)];

    let downhill_result = PhysicsSystem::move_platformer_controller_with_slopes(
        &mut downhill_world,
        &downhill_slopes,
        downhill_mover,
        PlatformerControllerInput::new(1.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_horizontal_speed(5.0)
            .with_gravity(0.0)
            .with_slope_config(SlopeConfig::new(0.5, 3.0).with_downhill_snap(false)),
        1.0,
    );

    assert!(!downhill_result.grounded);
    assert_eq!(
        downhill_world.transform(downhill_mover),
        Some(Transform2D { x: 5.0, y: 4.0 })
    );
}

#[test]
fn platformer_controller_jump_does_not_apply_step_offset() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
    let floor = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        20.0,
        CollisionLayer::Wall,
        false,
        40.0,
        5.0,
    );
    let step = spawn_kinematic_body_with_size(
        &mut world,
        9.0,
        13.0,
        CollisionLayer::Wall,
        false,
        2.0,
        2.0,
    );

    let result = PhysicsSystem::move_platformer_controller(
        &mut world,
        mover,
        PlatformerControllerInput::new(1.0, true),
        platformer_test_config(CollisionMask::WALL)
            .with_gravity(0.0)
            .with_step_offset(5.0),
        1.0,
    );

    assert_eq!(result.ground_before.and_then(|hit| hit.entity), Some(floor));
    assert!(result.jumped);
    assert_eq!(result.movement.last_hit, Some(step));
    assert!(result.movement.blocked_x);
    assert_eq!(result.ground_after, None);
}

#[test]
fn platformer_controller_steps_over_low_obstacle() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
    let floor = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        20.0,
        CollisionLayer::Wall,
        false,
        40.0,
        5.0,
    );
    let step = spawn_kinematic_body_with_size(
        &mut world,
        9.0,
        13.0,
        CollisionLayer::Wall,
        false,
        2.0,
        2.0,
    );

    let result = PhysicsSystem::move_platformer_controller(
        &mut world,
        mover,
        PlatformerControllerInput::new(1.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_gravity(0.0)
            .with_step_offset(5.0),
        1.0,
    );

    assert_eq!(result.ground_before.and_then(|hit| hit.entity), Some(floor));
    assert_eq!(result.ground_after.and_then(|hit| hit.entity), Some(step));
    assert!(!result.movement.blocked_x);
    assert!(result.grounded);
    assert_eq!(result.velocity, Velocity { vx: 8.0, vy: 0.0 });
    assert_eq!(world.transform(mover), Some(Transform2D { x: 8.0, y: 6.0 }));
}

#[test]
fn platformer_controller_skips_step_offset_for_tall_blocking_entity() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
    let floor = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        20.0,
        CollisionLayer::Wall,
        false,
        40.0,
        5.0,
    );
    let wall = spawn_kinematic_body_with_size(
        &mut world,
        9.0,
        10.0,
        CollisionLayer::Wall,
        false,
        2.0,
        10.0,
    );
    let mut counters = PhysicsCounters::default();

    let result = PhysicsSystem::move_platformer_controller_with_counters(
        &mut world,
        mover,
        PlatformerControllerInput::new(1.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_gravity(0.0)
            .with_step_offset(5.0),
        1.0,
        &mut counters,
    );

    assert_eq!(result.ground_before.and_then(|hit| hit.entity), Some(floor));
    assert_eq!(result.movement.last_hit, Some(wall));
    assert!(result.movement.blocked_x);
    assert_eq!(counters.kinematic_moves, 1);
}

#[test]
fn platformer_controller_steps_over_low_tilemap_obstacle() {
    let mut world = World::default();
    let mut tilemap = Tilemap::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
    let floor = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        20.0,
        CollisionLayer::Wall,
        false,
        40.0,
        5.0,
    );
    tilemap.set_layer(0, 1, 1, 4.0, 4.0, 7.0, 11.0, true, vec![1]);

    let result = PhysicsSystem::move_platformer_controller_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        PlatformerControllerInput::new(1.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_gravity(0.0)
            .with_step_offset(5.0),
        1.0,
    );

    assert_eq!(result.ground_before.and_then(|hit| hit.entity), Some(floor));
    assert_eq!(result.ground_after.and_then(|hit| hit.tile_index), Some(0));
    assert!(!result.movement.blocked_x);
    assert!(result.grounded);
    assert_eq!(result.velocity, Velocity { vx: 8.0, vy: 0.0 });
    assert_eq!(world.transform(mover), Some(Transform2D { x: 8.0, y: 6.0 }));
}

#[test]
fn platformer_controller_with_tilemap_snaps_up_slope_tile() {
    let mut world = World::default();
    let mut tilemap = Tilemap::default();
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        0.0,
        9.0,
        CollisionLayer::Player,
        true,
        1.0,
        1.0,
    );
    tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);
    tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);

    let result = PhysicsSystem::move_platformer_controller_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        PlatformerControllerInput::new(1.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_horizontal_speed(5.0)
            .with_gravity(0.0)
            .with_slope_config(SlopeConfig::new(0.8, 5.0)),
        1.0,
    );

    assert_eq!(result.ground_before.and_then(|hit| hit.tile_index), Some(0));
    assert_eq!(result.ground_after.and_then(|hit| hit.tile_index), Some(0));
    assert!(result.grounded);
    assert!(!result.movement.blocked_x);
    assert_eq!(result.velocity, Velocity { vx: 5.0, vy: 0.0 });
    assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 4.0 }));
}

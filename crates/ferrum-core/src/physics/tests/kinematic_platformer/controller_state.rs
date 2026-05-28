use super::*;

#[test]
fn platformer_controller_applies_horizontal_input_and_gravity() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);

    let result = PhysicsSystem::move_platformer_controller(
        &mut world,
        mover,
        PlatformerControllerInput::new(2.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_gravity(10.0)
            .with_jump_speed(30.0),
        0.5,
    );

    assert!(!result.jumped);
    assert!(!result.grounded);
    assert_eq!(result.velocity, Velocity { vx: 8.0, vy: 5.0 });
    assert_eq!(world.transform(mover), Some(Transform2D { x: 4.0, y: 2.5 }));
    assert_eq!(world.velocity(mover), Some(result.velocity));
}

#[test]
fn platformer_controller_jumps_only_when_grounded() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
    let ground = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

    let result = PhysicsSystem::move_platformer_controller(
        &mut world,
        mover,
        PlatformerControllerInput::new(0.0, true),
        platformer_test_config(CollisionMask::WALL),
        0.5,
    );

    assert_eq!(
        result.ground_before.and_then(|hit| hit.entity),
        Some(ground)
    );
    assert!(result.jumped);
    assert!(!result.grounded);
    assert_eq!(result.velocity, Velocity { vx: 0.0, vy: -12.0 });
    assert_eq!(world.transform(mover), Some(Transform2D { x: 0.0, y: 4.0 }));

    world.set_transform(mover, Transform2D { x: 0.0, y: 0.0 });
    world.set_velocity(mover, Velocity::default());
    let airborne_result = PhysicsSystem::move_platformer_controller(
        &mut world,
        mover,
        PlatformerControllerInput::new(0.0, true),
        platformer_test_config(CollisionMask::WALL),
        0.5,
    );

    assert!(!airborne_result.jumped);
    assert_eq!(airborne_result.velocity, Velocity { vx: 0.0, vy: 10.0 });
}

#[test]
fn platformer_controller_state_allows_coyote_jump() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
    let ground = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);
    let mut state = PlatformerControllerState::new();
    let config = platformer_test_config(CollisionMask::WALL)
        .with_coyote_time_seconds(0.1)
        .with_gravity(10.0);

    let grounded_result = PhysicsSystem::move_platformer_controller_with_state(
        &mut world,
        mover,
        PlatformerControllerInput::new(0.0, false),
        config,
        0.016,
        &mut state,
    );
    assert!(grounded_result.grounded);
    assert_eq!(state.coyote_time_remaining, 0.1);

    world.despawn(ground);
    let coyote_result = PhysicsSystem::move_platformer_controller_with_state(
        &mut world,
        mover,
        PlatformerControllerInput::new(0.0, true),
        config,
        0.016,
        &mut state,
    );

    assert_eq!(coyote_result.ground_before, None);
    assert!(coyote_result.jumped);
    assert!(!coyote_result.grounded);
    assert_eq!(coyote_result.velocity.vy, -12.0);
    assert_eq!(state.coyote_time_remaining, 0.0);
    assert_eq!(state.jump_buffer_remaining, 0.0);
}

#[test]
fn platformer_controller_state_buffers_jump_until_landing() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let ground = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);
    world.set_velocity(mover, Velocity { vx: 0.0, vy: 20.0 });
    let mut state = PlatformerControllerState::new();

    let result = PhysicsSystem::move_platformer_controller_with_state(
        &mut world,
        mover,
        PlatformerControllerInput::new(0.0, true),
        platformer_test_config(CollisionMask::WALL)
            .with_gravity(0.0)
            .with_jump_buffer_seconds(0.2),
        1.0,
        &mut state,
    );

    assert_eq!(result.ground_before, None);
    assert_eq!(result.ground_after.and_then(|hit| hit.entity), Some(ground));
    assert!(result.jumped);
    assert!(!result.grounded);
    assert_eq!(result.velocity, Velocity { vx: 0.0, vy: -12.0 });
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 0.0, y: 10.0 })
    );
    assert_eq!(state.jump_buffer_remaining, 0.0);
}

#[test]
fn platformer_controller_lands_and_clears_downward_velocity() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let ground = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

    let result = PhysicsSystem::move_platformer_controller(
        &mut world,
        mover,
        PlatformerControllerInput::new(0.0, false),
        platformer_test_config(CollisionMask::WALL),
        1.0,
    );

    assert_eq!(result.ground_before, None);
    assert_eq!(result.ground_after.and_then(|hit| hit.entity), Some(ground));
    assert!(result.grounded);
    assert!(result.movement.blocked_y);
    assert_eq!(result.velocity, Velocity::default());
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 0.0, y: 10.0 })
    );
}

#[test]
fn platformer_controller_respects_one_way_platform_config() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

    let result = PhysicsSystem::move_platformer_controller(
        &mut world,
        mover,
        PlatformerControllerInput::new(0.0, false),
        platformer_test_config(CollisionMask::WALL)
            .with_one_way_platforms(OneWayPlatformConfig::new(CollisionMask::WALL)),
        1.0,
    );

    assert_eq!(
        result.ground_after.and_then(|hit| hit.entity),
        Some(platform)
    );
    assert!(result.grounded);
    assert!(result.movement.blocked_y);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 0.0, y: 10.0 })
    );
}

#[test]
fn platformer_controller_with_tilemap_lands_on_tile_obstacle() {
    let mut world = World::default();
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 2, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1]);
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        5.0,
        0.0,
        CollisionLayer::Player,
        true,
        2.0,
        2.0,
    );

    let result = PhysicsSystem::move_platformer_controller_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        PlatformerControllerInput::new(0.0, false),
        platformer_test_config(CollisionMask::WALL),
        1.0,
    );

    assert_eq!(result.ground_after.and_then(|hit| hit.tile_index), Some(1));
    assert!(result.grounded);
    assert!(result.movement.blocked_y);
    assert_eq!(result.velocity, Velocity::default());
    assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 8.0 }));
}

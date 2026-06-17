use super::*;

fn hd2d_config() -> Hd2dKinematicControllerConfig {
    Hd2dKinematicControllerConfig::new(CollisionMask::WALL, 4)
        .with_step_height(4.0)
        .with_drop_height(4.0)
}

fn spawn_hd2d_mover(world: &mut World, x: f32, y: f32, elevation: f32) -> Entity {
    let mover =
        spawn_kinematic_body_with_size(world, x, y, CollisionLayer::Player, false, 1.0, 1.0);
    assert!(world.set_height_span(
        mover,
        HeightSpan::new(PhysicsFloorId::DEFAULT, elevation, 16.0).unwrap()
    ));
    mover
}

#[test]
fn hd2d_controller_interpolates_ramp_elevation() {
    let mut world = World::default();
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);
    set_nonblocking_ramp_tile(
        &mut tilemap,
        1,
        PhysicsFloorId::DEFAULT.0,
        0.0,
        Hd2dRampAxis::X,
        0.0,
        8.0,
    );
    let mover = spawn_hd2d_mover(&mut world, 0.0, 5.0, 0.0);

    let result = PhysicsSystem::move_hd2d_kinematic_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 5.0, vy: 0.0 },
        hd2d_config().with_step_height(8.0),
    );

    assert!(!result.blocked_by_step);
    assert!(result.stepped_up);
    assert!((result.elevation_delta - 4.0).abs() < 0.001);
    assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 5.0 }));
    let span = world.height_span(mover).unwrap();
    assert!((span.elevation - 4.0).abs() < 0.001);
}

#[test]
fn hd2d_controller_steps_up_within_limit() {
    let mut world = World::default();
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);
    set_nonblocking_flat_tile(&mut tilemap, 1, PhysicsFloorId::DEFAULT.0, 0.0, 0.0);
    set_nonblocking_flat_tile(&mut tilemap, 2, PhysicsFloorId::DEFAULT.0, 3.0, 0.0);
    let mover = spawn_hd2d_mover(&mut world, 5.0, 5.0, 0.0);

    let result = PhysicsSystem::move_hd2d_kinematic_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 10.0, vy: 0.0 },
        hd2d_config(),
    );

    assert!(result.stepped_up);
    assert!(!result.blocked_by_step);
    assert!((world.height_span(mover).unwrap().elevation - 3.0).abs() < 0.001);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 15.0, y: 5.0 })
    );
}

#[test]
fn hd2d_controller_blocks_step_above_limit() {
    let mut world = World::default();
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);
    set_nonblocking_flat_tile(&mut tilemap, 1, PhysicsFloorId::DEFAULT.0, 0.0, 0.0);
    set_nonblocking_flat_tile(&mut tilemap, 2, PhysicsFloorId::DEFAULT.0, 10.0, 0.0);
    let mover = spawn_hd2d_mover(&mut world, 5.0, 5.0, 0.0);

    let result = PhysicsSystem::move_hd2d_kinematic_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 10.0, vy: 0.0 },
        hd2d_config(),
    );

    assert!(result.blocked_by_step);
    assert!(!result.stepped_up);
    assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 5.0 }));
    assert_eq!(world.height_span(mover).unwrap().elevation, 0.0);
}

#[test]
fn hd2d_controller_blocks_ledge_drop_until_opt_in() {
    let mut blocked_world = World::default();
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);
    set_nonblocking_flat_tile(&mut tilemap, 1, PhysicsFloorId::DEFAULT.0, 8.0, 0.0);
    assert!(tilemap.set_tile_height_span_definition(2, PhysicsFloorId::DEFAULT.0, 0.0, 0.0));
    assert!(tilemap.set_tile_hd2d_definition(
        2,
        Hd2dTileKind::Ledge.code(),
        false,
        false,
        false,
        0.0,
        false,
        0,
        0.0,
        0.0,
    ));
    let blocked_mover = spawn_hd2d_mover(&mut blocked_world, 5.0, 5.0, 8.0);

    let blocked = PhysicsSystem::move_hd2d_kinematic_with_tilemap(
        &mut blocked_world,
        &tilemap,
        blocked_mover,
        Velocity { vx: 10.0, vy: 0.0 },
        Hd2dKinematicControllerConfig::new(CollisionMask::WALL, 4)
            .with_step_height(8.0)
            .with_drop_height(8.0),
    );

    assert!(blocked.blocked_by_drop);
    assert_eq!(
        blocked_world.transform(blocked_mover),
        Some(Transform2D { x: 5.0, y: 5.0 })
    );

    let mut allowed_world = World::default();
    let allowed_mover = spawn_hd2d_mover(&mut allowed_world, 5.0, 5.0, 8.0);
    let allowed = PhysicsSystem::move_hd2d_kinematic_with_tilemap(
        &mut allowed_world,
        &tilemap,
        allowed_mover,
        Velocity { vx: 10.0, vy: 0.0 },
        Hd2dKinematicControllerConfig::new(CollisionMask::WALL, 4)
            .with_step_height(8.0)
            .with_drop_height(8.0)
            .with_ledge_drop(true),
    );

    assert!(!allowed.blocked_by_drop);
    assert!(allowed.stepped_down);
    assert!((allowed_world.height_span(allowed_mover).unwrap().elevation).abs() < 0.001);
    assert_eq!(
        allowed_world.transform(allowed_mover),
        Some(Transform2D { x: 15.0, y: 5.0 })
    );
}

#[test]
fn hd2d_controller_passes_under_bridge_on_other_floor() {
    let mut world = World::default();
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);
    assert!(tilemap.set_tile_height_span_definition(1, 1, 16.0, 4.0));
    assert!(tilemap.set_tile_hd2d_definition(
        1,
        Hd2dTileKind::Bridge.code(),
        false,
        false,
        false,
        4.0,
        false,
        0,
        0.0,
        0.0,
    ));
    let mover = spawn_hd2d_mover(&mut world, 0.0, 5.0, 0.0);

    let result = PhysicsSystem::move_hd2d_kinematic_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 20.0, vy: 0.0 },
        hd2d_config(),
    );

    assert!(result.passed_under_bridge);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 20.0, y: 5.0 })
    );
    assert_eq!(
        world.height_span(mover).unwrap().floor,
        PhysicsFloorId::DEFAULT
    );
}

#[test]
fn hd2d_controller_current_bridge_pass_through_uses_fixed_samples() {
    let mut world = World::default();
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 20, 1, 1.0, 10.0, 0.0, 0.0, true, {
        let mut tiles = vec![0; 20];
        tiles[3] = 1;
        tiles
    });
    assert!(tilemap.set_tile_height_span_definition(1, 1, 16.0, 4.0));
    assert!(tilemap.set_tile_hd2d_definition(
        1,
        Hd2dTileKind::Bridge.code(),
        false,
        false,
        false,
        4.0,
        false,
        0,
        0.0,
        0.0,
    ));
    let mover = spawn_hd2d_mover(&mut world, 0.0, 5.0, 0.0);

    let result = PhysicsSystem::move_hd2d_kinematic_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 20.0, vy: 0.0 },
        hd2d_config(),
    );

    assert!(!result.passed_under_bridge);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 20.0, y: 5.0 })
    );
    assert_eq!(world.height_span(mover).unwrap().elevation, 0.0);
}

#[test]
fn hd2d_controller_ignores_solid_tile_on_other_floor() {
    let mut world = World::default();
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);
    assert!(tilemap.set_tile_height_span_definition(1, 1, 16.0, 4.0));
    let mover = spawn_hd2d_mover(&mut world, 0.0, 5.0, 0.0);

    let result = PhysicsSystem::move_hd2d_kinematic_with_tilemap(
        &mut world,
        &tilemap,
        mover,
        Velocity { vx: 20.0, vy: 0.0 },
        hd2d_config(),
    );

    assert_eq!(result.movement.hit_count, 0);
    assert_eq!(
        world.transform(mover),
        Some(Transform2D { x: 20.0, y: 5.0 })
    );
}

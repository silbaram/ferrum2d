use super::*;

#[test]
fn ground_probe_with_tilemap_detects_one_way_tile() {
    let mut world = World::default();
    let tilemap = single_one_way_tilemap();
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        5.0,
        -2.0,
        CollisionLayer::Player,
        true,
        1.0,
        1.0,
    );

    let hit =
        PhysicsSystem::ground_probe_with_tilemap(&world, &tilemap, mover, 2.0, CollisionMask::WALL)
            .expect("one-way tile should count as ground from above");

    assert_eq!(hit.entity, None);
    assert_eq!(hit.tile_layer_index, Some(0));
    assert_eq!(hit.tile_index, Some(0));
    assert!((hit.distance - 1.0).abs() < 0.01);
    assert!(hit.normal_y >= GROUND_NORMAL_Y_MIN);
}

#[test]
fn ground_probe_detects_solid_entity_below() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let ground = spawn_kinematic_body(&mut world, 0.0, 12.0, CollisionLayer::Enemy, false);

    let hit = PhysicsSystem::ground_probe(&world, mover, 4.0, CollisionMask::ENEMY)
        .expect("ground below should be detected");

    assert_eq!(hit.entity, Some(ground));
    assert_eq!(hit.tile_layer_index, None);
    assert_eq!(hit.tile_index, None);
    assert!((hit.distance - 2.0).abs() < 0.01);
    assert_eq!(hit.normal_x, 0.0);
    assert_eq!(hit.normal_y, 1.0);
}

#[test]
fn ground_probe_detects_touching_solid_entity() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let ground = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Enemy, false);

    let hit = PhysicsSystem::ground_probe(&world, mover, 1.0, CollisionMask::ENEMY)
        .expect("touching ground should be detected");

    assert_eq!(hit.entity, Some(ground));
    assert_eq!(hit.distance, 0.0);
    assert_eq!(hit.normal_y, 1.0);
}

#[test]
fn ground_probe_remains_stable_around_touching_solid_entity() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    let ground = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Enemy, false);

    for (y, expected_distance) in [(0.0, 0.0), (-0.001, 0.001), (0.001, 0.0)] {
        world.set_transform(mover, Transform2D { x: 0.0, y });
        let hit = PhysicsSystem::ground_probe(&world, mover, 0.05, CollisionMask::ENEMY)
            .expect("ground probe should not flicker around a touching contact");

        assert_eq!(hit.entity, Some(ground));
        assert!(
            (hit.distance - expected_distance).abs() < 0.0001,
            "ground probe should report stable distance near contact at y={y}, got {hit:?}"
        );
        assert_eq!(hit.normal_y, 1.0);
    }
}

#[test]
fn ground_probe_with_tilemap_detects_tile_obstacle() {
    let mut world = World::default();
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 2, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1]);
    let mover = spawn_kinematic_body_with_size(
        &mut world,
        5.0,
        4.0,
        CollisionLayer::Player,
        true,
        2.0,
        2.0,
    );

    let hit = PhysicsSystem::ground_probe_with_tilemap(
        &world,
        &tilemap,
        mover,
        5.0,
        CollisionMask::ENEMY,
    )
    .expect("tile obstacle below should be detected");

    assert_eq!(hit.entity, None);
    assert_eq!(hit.tile_layer_index, Some(0));
    assert_eq!(hit.tile_index, Some(1));
    assert!((hit.distance - 4.0).abs() < 0.01);
    assert_eq!(hit.normal_y, 1.0);

    world.set_transform(mover, Transform2D { x: 5.0, y: 8.0 });
    let touching_hit = PhysicsSystem::ground_probe_with_tilemap(
        &world,
        &tilemap,
        mover,
        1.0,
        CollisionMask::ENEMY,
    )
    .expect("touching tile obstacle should be detected");

    assert_eq!(touching_hit.tile_layer_index, Some(0));
    assert_eq!(touching_hit.tile_index, Some(1));
    assert_eq!(touching_hit.distance, 0.0);
}

#[test]
fn ground_probe_ignores_triggers_side_contacts_and_invalid_distance() {
    let mut world = World::default();
    let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
    spawn_kinematic_body(&mut world, 0.0, 12.0, CollisionLayer::Enemy, true);
    spawn_kinematic_body(&mut world, 12.0, 0.0, CollisionLayer::Enemy, false);

    assert!(PhysicsSystem::ground_probe(&world, mover, 20.0, CollisionMask::ENEMY).is_none());
    assert!(PhysicsSystem::ground_probe(&world, mover, 0.0, CollisionMask::ENEMY).is_none());
    assert!(PhysicsSystem::ground_probe(&world, mover, f32::NAN, CollisionMask::ENEMY).is_none());
}

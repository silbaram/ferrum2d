use super::*;

#[test]
fn collision_layers_resolve_player_overlap() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, true, vec![1]);
    let mut world = World::default();
    let player = world.spawn_player(20.0, 16.0, 0);

    tilemap.resolve_dynamic_collisions(&mut world);

    let transform = world.transforms[player.id as usize].unwrap();
    assert_eq!(transform.x, 50.0);
    assert_eq!(transform.y, 16.0);
}

#[test]
fn collision_resolution_updates_physics_counters() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, true, vec![1]);
    let mut world = World::default();
    world.spawn_player(20.0, 16.0, 0);
    let mut counters = PhysicsCounters::default();

    tilemap.resolve_dynamic_collisions_with_counters(&mut world, &mut counters);

    assert_eq!(counters.kinematic_moves, 1);
    assert!(counters.kinematic_hits > 0);
    assert_eq!(counters.kinematic_tile_hits, counters.kinematic_hits);
    assert!(counters.tile_candidate_checks > 0);
}

#[test]
fn non_collision_layers_do_not_block_player() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1]);
    let mut world = World::default();
    let player = world.spawn_player(20.0, 16.0, 0);

    tilemap.resolve_dynamic_collisions(&mut world);

    assert_eq!(
        world.transforms[player.id as usize],
        Some(Transform2D { x: 20.0, y: 16.0 })
    );
}

#[test]
fn dynamic_resolution_preserves_flattened_tile_order_across_chunk_boundary() {
    let mut tilemap = Tilemap::default();
    let mut tiles = vec![0; 34];
    tiles[16] = 1;
    tiles[17] = 1;
    tilemap.set_layer(0, 17, 2, 10.0, 10.0, 0.0, 0.0, true, tiles);

    let mut world = World::default();
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x: 85.0, y: 10.0 });
    world.set_aabb_collider(entity, test_collider(85.0, 10.0));
    let mut counters = PhysicsCounters::default();

    tilemap.resolve_dynamic_collisions_with_counters(&mut world, &mut counters);

    let transform = world.transforms[entity.id as usize].unwrap();
    assert_eq!(transform.x, 85.0);
    assert_eq!(transform.y, 30.0);
    assert_eq!(counters.tile_candidate_checks, 3);
    assert_eq!(counters.kinematic_tile_hits, 2);
}

#[test]
fn one_way_tile_at_chunk_boundary_preserves_sweep_semantics() {
    let mut tilemap = Tilemap::default();
    let mut tiles = vec![0; 17];
    tiles[16] = 1;
    tilemap.set_layer(0, 17, 1, 10.0, 10.0, 0.0, 0.0, true, tiles);
    tilemap.set_tile_one_way_platform(1);

    let mut downward_stats = TilemapSweepStats::default();
    let downward_hit = tilemap
        .swept_aabb_contact(
            Transform2D { x: 165.0, y: -2.0 },
            test_collider(1.0, 1.0),
            Velocity { vx: 0.0, vy: 10.0 },
            &mut downward_stats,
        )
        .expect("one-way boundary tile should block downward movement");
    assert_eq!(downward_hit.tile_index, 16);
    assert_eq!(downward_stats.candidate_tiles, 1);

    let mut upward_stats = TilemapSweepStats::default();
    assert!(tilemap
        .swept_aabb_contact(
            Transform2D { x: 165.0, y: 12.0 },
            test_collider(1.0, 1.0),
            Velocity { vx: 0.0, vy: -10.0 },
            &mut upward_stats,
        )
        .is_none());
    assert_eq!(upward_stats.candidate_tiles, 1);

    let shape_hits = tilemap.shape_cast_aabb_obstacles(
        Transform2D { x: 165.0, y: -2.0 },
        test_collider(1.0, 1.0),
        Velocity { vx: 0.0, vy: 1.0 },
        10.0,
    );
    assert_eq!(shape_hits.len(), 1);
    assert_eq!(shape_hits[0].tile_index, 16);
}

#[test]
fn collision_resolution_checks_merged_rect_once() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 1]);
    let mut world = World::default();
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x: 9.0, y: 5.0 });
    world.set_aabb_collider(entity, test_collider(2.0, 2.0));
    let mut counters = PhysicsCounters::default();

    tilemap.resolve_dynamic_collisions_with_counters(&mut world, &mut counters);

    assert_eq!(counters.tile_candidate_checks, 2);
    assert_eq!(counters.kinematic_tile_hits, 1);
}

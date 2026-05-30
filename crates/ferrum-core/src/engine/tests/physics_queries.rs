use super::*;

#[test]
fn engine_query_point_bodies_writes_bulk_result_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    let first_enemy = spawn_test_body(&mut engine.world, 10.0, 0.0, CollisionLayer::Enemy);
    let second_enemy = spawn_test_body(&mut engine.world, 12.0, 0.0, CollisionLayer::Enemy);
    spawn_test_body(&mut engine.world, 40.0, 0.0, CollisionLayer::Enemy);

    let hit_count = engine.query_point_bodies(11.0, 0.0, CollisionMask::ENEMY.bits);

    assert_eq!(hit_count, 2);
    assert_eq!(engine.physics_query_hit_len(), 2);
    assert_eq!(
        engine.physics_query_hits,
        vec![
            PhysicsQueryEntityHit::from_entity(first_enemy),
            PhysicsQueryEntityHit::from_entity(second_enemy),
        ]
    );
    assert_eq!(
        engine.physics_query_hit_ptr(),
        engine.physics_query_hits.as_ptr()
    );

    let hit_count = engine.query_point_bodies(0.0, 0.0, CollisionMask::ENEMY.bits);

    assert_eq!(hit_count, 0);
    assert_eq!(engine.physics_query_hit_len(), 0);
}

#[test]
fn engine_query_aabb_and_circle_bodies_write_bulk_results_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    let player = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
    let enemy = spawn_test_body(&mut engine.world, 20.0, 0.0, CollisionLayer::Enemy);
    spawn_test_body(&mut engine.world, 60.0, 0.0, CollisionLayer::Enemy);

    let aabb_count = engine.query_aabb_bodies(10.0, 0.0, 6.0, 6.0, CollisionMask::ALL.bits);

    assert_eq!(aabb_count, 2);
    assert_eq!(
        engine.physics_query_hits,
        vec![
            PhysicsQueryEntityHit::from_entity(player),
            PhysicsQueryEntityHit::from_entity(enemy),
        ]
    );

    let circle_count = engine.query_circle_bodies(20.0, 0.0, 1.0, CollisionMask::ENEMY.bits);

    assert_eq!(circle_count, 1);
    assert_eq!(
        engine.physics_query_hits,
        vec![PhysicsQueryEntityHit::from_entity(enemy)]
    );

    let invalid_count = engine.query_aabb_bodies(10.0, 0.0, 0.0, 6.0, CollisionMask::ALL.bits);

    assert_eq!(invalid_count, 0);
    assert!(engine.physics_query_hits.is_empty());
}

#[test]
fn engine_query_advanced_shape_bodies_write_bulk_results_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    let first_enemy = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Enemy);
    let second_enemy = spawn_test_body(&mut engine.world, 12.0, 0.0, CollisionLayer::Enemy);
    spawn_test_body(&mut engine.world, 40.0, 0.0, CollisionLayer::Enemy);

    let oriented_count =
        engine.query_oriented_box_bodies(6.0, 0.0, 12.0, 6.0, 0.0, CollisionMask::ENEMY.bits);

    assert_eq!(oriented_count, 2);
    assert_eq!(
        engine.physics_query_hits,
        vec![
            PhysicsQueryEntityHit::from_entity(first_enemy),
            PhysicsQueryEntityHit::from_entity(second_enemy),
        ]
    );

    let capsule_count =
        engine.query_capsule_bodies(-2.0, 0.0, 14.0, 0.0, 1.0, CollisionMask::ENEMY.bits);

    assert_eq!(capsule_count, 2);
    assert_eq!(
        engine.physics_query_hits,
        vec![
            PhysicsQueryEntityHit::from_entity(first_enemy),
            PhysicsQueryEntityHit::from_entity(second_enemy),
        ]
    );

    let polygon_count = engine.query_convex_polygon_bodies(
        vec![-6.0, -6.0, 18.0, -6.0, 18.0, 6.0, -6.0, 6.0],
        CollisionMask::ENEMY.bits,
    );

    assert_eq!(polygon_count, 2);
    assert_eq!(
        engine.physics_query_hits,
        vec![
            PhysicsQueryEntityHit::from_entity(first_enemy),
            PhysicsQueryEntityHit::from_entity(second_enemy),
        ]
    );

    let invalid_count = engine
        .query_convex_polygon_bodies(vec![0.0, 0.0, 1.0, 0.0, 0.0], CollisionMask::ENEMY.bits);

    assert_eq!(invalid_count, 0);
    assert!(engine.physics_query_hits.is_empty());
}

#[test]
fn engine_raycast_and_segment_cast_bodies_write_bulk_results_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    let first_enemy = spawn_test_body(&mut engine.world, 20.0, 0.0, CollisionLayer::Enemy);
    let second_enemy = spawn_test_body(&mut engine.world, 40.0, 0.0, CollisionLayer::Enemy);
    spawn_test_body(&mut engine.world, 60.0, 0.0, CollisionLayer::Player);

    let raycast_count = engine.raycast_bodies(0.0, 0.0, 1.0, 0.0, 100.0, CollisionMask::ENEMY.bits);

    assert_eq!(raycast_count, 2);
    assert_eq!(engine.physics_raycast_hit_len(), 2);
    assert_eq!(
        engine.physics_raycast_hits,
        vec![
            PhysicsRaycastBodyHit {
                entity_id: first_enemy.id,
                entity_generation: first_enemy.generation,
                distance: 15.0,
                point_x: 15.0,
                point_y: 0.0,
                normal_x: -1.0,
                normal_y: 0.0,
            },
            PhysicsRaycastBodyHit {
                entity_id: second_enemy.id,
                entity_generation: second_enemy.generation,
                distance: 35.0,
                point_x: 35.0,
                point_y: 0.0,
                normal_x: -1.0,
                normal_y: 0.0,
            },
        ]
    );
    assert_eq!(
        engine.physics_raycast_hit_ptr(),
        engine.physics_raycast_hits.as_ptr()
    );

    let segment_count = engine.segment_cast_bodies(0.0, 0.0, 30.0, 0.0, CollisionMask::ENEMY.bits);

    assert_eq!(segment_count, 1);
    assert_eq!(
        engine.physics_raycast_hits,
        vec![PhysicsRaycastBodyHit {
            entity_id: first_enemy.id,
            entity_generation: first_enemy.generation,
            distance: 15.0,
            point_x: 15.0,
            point_y: 0.0,
            normal_x: -1.0,
            normal_y: 0.0,
        }]
    );

    let invalid_count = engine.raycast_bodies(0.0, 0.0, 0.0, 0.0, 100.0, CollisionMask::ENEMY.bits);

    assert_eq!(invalid_count, 0);
    assert!(engine.physics_raycast_hits.is_empty());
}

#[test]
fn engine_raycast_and_segment_cast_tile_obstacles_write_bulk_results_for_wasm() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tilemap_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

    let raycast_count = engine.raycast_tile_obstacles(0.0, 5.0, 1.0, 0.0, 40.0);

    assert_eq!(raycast_count, 1);
    assert_eq!(engine.physics_tile_shape_cast_hit_len(), 1);
    assert_eq!(
        engine.physics_tile_shape_cast_hits,
        vec![PhysicsTileShapeCastHit {
            tile_layer_index: 2,
            tile_index: 1,
            distance: 10.0,
            point_x: 10.0,
            point_y: 5.0,
            normal_x: -1.0,
            normal_y: 0.0,
        }]
    );
    assert_eq!(
        engine.physics_tile_shape_cast_hit_ptr(),
        engine.physics_tile_shape_cast_hits.as_ptr()
    );

    let segment_count = engine.segment_cast_tile_obstacles(0.0, 5.0, 9.0, 5.0);

    assert_eq!(segment_count, 0);
    assert!(engine.physics_tile_shape_cast_hits.is_empty());

    let segment_count = engine.segment_cast_tile_obstacles(0.0, 5.0, 10.0, 5.0);

    assert_eq!(segment_count, 1);
    assert_eq!(engine.physics_tile_shape_cast_hits[0].distance, 10.0);

    let invalid_count = engine.raycast_tile_obstacles(0.0, 5.0, 0.0, 0.0, 40.0);

    assert_eq!(invalid_count, 0);
    assert!(engine.physics_tile_shape_cast_hits.is_empty());
}

#[test]
fn engine_physics_queries_reuse_scratch_buffers_across_calls() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    for index in 0..24 {
        spawn_test_body(
            &mut engine.world,
            index as f32 * 10.0,
            0.0,
            CollisionLayer::Enemy,
        );
    }

    let query_count = engine.query_aabb_bodies(115.0, 0.0, 130.0, 8.0, CollisionMask::ENEMY.bits);
    assert_eq!(query_count, 24);
    let query_capacity = engine.physics_aabb_query_scratch.capacity();
    let query_scratch_ptr = engine.physics_aabb_query_scratch.as_ptr();
    let query_result_ptr = engine.physics_query_hit_ptr();

    let empty_query_count =
        engine.query_aabb_bodies(1000.0, 1000.0, 8.0, 8.0, CollisionMask::ENEMY.bits);
    assert_eq!(empty_query_count, 0);
    assert_eq!(engine.physics_aabb_query_scratch.capacity(), query_capacity);
    assert_eq!(
        engine.physics_aabb_query_scratch.as_ptr(),
        query_scratch_ptr
    );
    assert_eq!(engine.physics_query_hit_ptr(), query_result_ptr);

    let raycast_count =
        engine.raycast_bodies(-20.0, 0.0, 1.0, 0.0, 280.0, CollisionMask::ENEMY.bits);
    assert_eq!(raycast_count, 24);
    let raycast_capacity = engine.physics_raycast_scratch.capacity();
    let raycast_scratch_ptr = engine.physics_raycast_scratch.as_ptr();
    let raycast_result_ptr = engine.physics_raycast_hit_ptr();

    let empty_raycast_count =
        engine.raycast_bodies(-20.0, 100.0, 1.0, 0.0, 280.0, CollisionMask::ENEMY.bits);
    assert_eq!(empty_raycast_count, 0);
    assert_eq!(engine.physics_raycast_scratch.capacity(), raycast_capacity);
    assert_eq!(engine.physics_raycast_scratch.as_ptr(), raycast_scratch_ptr);
    assert_eq!(engine.physics_raycast_hit_ptr(), raycast_result_ptr);

    engine.clear_shooter_tilemap();
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    let mut tile_data = Vec::with_capacity(48);
    for index in 0..48 {
        tile_data.push(if index % 2 == 0 { 1 } else { 0 });
    }
    engine.set_shooter_tilemap_layer(0, 48, 1, 10.0, 10.0, 0.0, 0.0, true, tile_data);

    let tile_count = engine.raycast_tile_obstacles(-5.0, 5.0, 1.0, 0.0, 500.0);
    assert_eq!(tile_count, 24);
    let tile_capacity = engine.physics_tile_shape_cast_scratch.capacity();
    let tile_scratch_ptr = engine.physics_tile_shape_cast_scratch.as_ptr();
    let tile_result_ptr = engine.physics_tile_shape_cast_hit_ptr();

    let empty_tile_count = engine.raycast_tile_obstacles(-5.0, 100.0, 1.0, 0.0, 500.0);
    assert_eq!(empty_tile_count, 0);
    assert_eq!(
        engine.physics_tile_shape_cast_scratch.capacity(),
        tile_capacity
    );
    assert_eq!(
        engine.physics_tile_shape_cast_scratch.as_ptr(),
        tile_scratch_ptr
    );
    assert_eq!(engine.physics_tile_shape_cast_hit_ptr(), tile_result_ptr);
}

#[test]
fn engine_shape_cast_bodies_write_bulk_results_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();
    let first_enemy = spawn_test_body(&mut engine.world, 20.0, 0.0, CollisionLayer::Enemy);
    let second_enemy = spawn_test_body(&mut engine.world, 40.0, 0.0, CollisionLayer::Enemy);
    spawn_test_body(&mut engine.world, 60.0, 0.0, CollisionLayer::Player);

    let aabb_count = engine.shape_cast_aabb_bodies(
        0.0,
        0.0,
        2.0,
        2.0,
        1.0,
        0.0,
        100.0,
        CollisionMask::ENEMY.bits,
    );

    assert_eq!(aabb_count, 2);
    assert_eq!(
        engine.physics_raycast_hits,
        vec![
            PhysicsRaycastBodyHit {
                entity_id: first_enemy.id,
                entity_generation: first_enemy.generation,
                distance: 13.0,
                point_x: 13.0,
                point_y: 0.0,
                normal_x: -1.0,
                normal_y: 0.0,
            },
            PhysicsRaycastBodyHit {
                entity_id: second_enemy.id,
                entity_generation: second_enemy.generation,
                distance: 33.0,
                point_x: 33.0,
                point_y: 0.0,
                normal_x: -1.0,
                normal_y: 0.0,
            },
        ]
    );

    let circle_count =
        engine.shape_cast_circle_bodies(0.0, 0.0, 2.0, 1.0, 0.0, 100.0, CollisionMask::ENEMY.bits);

    assert_eq!(circle_count, 2);
    assert_eq!(engine.physics_raycast_hits[0].entity_id, first_enemy.id);
    assert!((engine.physics_raycast_hits[0].distance - 13.0).abs() < 0.01);

    let oriented_count = engine.shape_cast_oriented_box_bodies(
        0.0,
        0.0,
        2.0,
        2.0,
        0.0,
        1.0,
        0.0,
        100.0,
        CollisionMask::ENEMY.bits,
    );

    assert_eq!(oriented_count, 2);
    assert_eq!(engine.physics_raycast_hits[0].entity_id, first_enemy.id);
    assert!((engine.physics_raycast_hits[0].distance - 13.0).abs() < 0.01);

    let capsule_count = engine.shape_cast_capsule_bodies(
        0.0,
        -2.0,
        0.0,
        2.0,
        1.0,
        1.0,
        0.0,
        100.0,
        CollisionMask::ENEMY.bits,
    );

    assert_eq!(capsule_count, 2);
    assert_eq!(engine.physics_raycast_hits[0].entity_id, first_enemy.id);
    assert!((engine.physics_raycast_hits[0].distance - 14.0).abs() < 0.01);

    let polygon_count = engine.shape_cast_convex_polygon_bodies(
        vec![-2.0, -2.0, 2.0, -2.0, 2.0, 2.0, -2.0, 2.0],
        1.0,
        0.0,
        100.0,
        CollisionMask::ENEMY.bits,
    );

    assert_eq!(polygon_count, 2);
    assert_eq!(engine.physics_raycast_hits[0].entity_id, first_enemy.id);
    assert!((engine.physics_raycast_hits[0].distance - 13.0).abs() < 0.01);

    let invalid_count = engine.shape_cast_convex_polygon_bodies(
        vec![0.0, 0.0, 1.0, 0.0, 0.0],
        1.0,
        0.0,
        100.0,
        CollisionMask::ENEMY.bits,
    );

    assert_eq!(invalid_count, 0);
    assert!(engine.physics_raycast_hits.is_empty());
}

#[test]
fn engine_query_nearest_tile_obstacle_stores_scalar_result_for_wasm() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tilemap_layer(2, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1]);

    assert!(engine.query_nearest_tile_obstacle(0.0, 5.0, 20.0));

    assert_eq!(engine.physics_query_tile_layer_index(), 2);
    assert_eq!(engine.physics_query_tile_index(), 1);
    assert_eq!(engine.physics_query_point_x(), 10.0);
    assert_eq!(engine.physics_query_point_y(), 5.0);
    assert_eq!(engine.physics_query_distance(), 10.0);

    assert!(!engine.query_nearest_tile_obstacle(0.0, 5.0, 5.0));
    assert_eq!(engine.physics_query_tile_layer_index(), 0);
    assert_eq!(engine.physics_query_tile_index(), 0);
}

#[test]
fn engine_tile_obstacle_height_span_queries_write_filtered_wasm_results() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tile(2, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    assert!(engine.set_shooter_tile_height_span(1, 1, 0.0, 8.0));
    assert!(engine.set_shooter_tile_height_span(2, 2, 0.0, 8.0));
    engine.set_shooter_tilemap_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);

    assert!(engine.query_nearest_tile_obstacle_with_height_span(0.0, 5.0, 40.0, 2, 0.0, 8.0));
    assert_eq!(engine.physics_query_tile_index(), 1);

    let raycast_count =
        engine.raycast_tile_obstacles_with_height_span(0.0, 5.0, 1.0, 0.0, 40.0, 2, 0.0, 8.0);
    assert_eq!(raycast_count, 1);
    assert_eq!(engine.physics_tile_shape_cast_hits[0].tile_index, 1);

    let segment_count =
        engine.segment_cast_tile_obstacles_with_height_span(0.0, 5.0, 30.0, 5.0, 2, 0.0, 8.0);
    assert_eq!(segment_count, 1);
    assert_eq!(engine.physics_tile_shape_cast_hits[0].tile_index, 1);

    let shape_count = engine.shape_cast_aabb_tile_obstacles_with_height_span(
        0.0, 5.0, 1.0, 1.0, 1.0, 0.0, 40.0, 2, 0.0, 8.0,
    );
    assert_eq!(shape_count, 1);
    assert_eq!(engine.physics_tile_shape_cast_hits[0].tile_index, 1);

    let contact_count = engine
        .query_aabb_tile_obstacle_contacts_with_height_span(10.0, 5.0, 12.0, 2.0, 2, 0.0, 8.0);
    assert_eq!(contact_count, 1);
    assert_eq!(engine.physics_tile_contact_hits[0].tile_index, 1);

    let manifold_count = engine
        .query_aabb_tile_obstacle_manifolds_with_height_span(10.0, 5.0, 12.0, 2.0, 2, 0.0, 8.0);
    assert_eq!(manifold_count, 1);
    assert_eq!(engine.physics_tile_manifold_hits[0].tile_index, 1);
}

#[test]
fn engine_tile_obstacle_height_span_queries_clear_results_on_invalid_filter() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    assert!(engine.set_shooter_tile_height_span(1, 1, 0.0, 8.0));
    engine.set_shooter_tilemap_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);

    assert!(engine.query_nearest_tile_obstacle_with_height_span(0.0, 5.0, 40.0, 1, 0.0, 8.0));
    assert!(!engine.query_nearest_tile_obstacle_with_height_span(0.0, 5.0, 40.0, 1, f32::NAN, 8.0));
    assert_eq!(engine.physics_query_tile_index(), 0);

    assert_eq!(
        engine.raycast_tile_obstacles_with_height_span(0.0, 5.0, 1.0, 0.0, 40.0, 1, 0.0, 8.0),
        1
    );
    assert_eq!(
        engine.raycast_tile_obstacles_with_height_span(0.0, 5.0, 1.0, 0.0, 40.0, 1, 0.0, -1.0),
        0
    );
    assert!(engine.physics_tile_shape_cast_hits.is_empty());

    assert_eq!(
        engine.query_aabb_tile_obstacle_contacts_with_height_span(5.0, 5.0, 6.0, 2.0, 1, 0.0, 8.0),
        1
    );
    assert_eq!(
        engine.query_aabb_tile_obstacle_contacts_with_height_span(5.0, 5.0, 6.0, 2.0, 1, 0.0, -1.0),
        0
    );
    assert!(engine.physics_tile_contact_hits.is_empty());

    assert_eq!(
        engine.query_aabb_tile_obstacle_manifolds_with_height_span(5.0, 5.0, 6.0, 2.0, 1, 0.0, 8.0),
        1
    );
    assert_eq!(
        engine
            .query_aabb_tile_obstacle_manifolds_with_height_span(5.0, 5.0, 6.0, 2.0, 1, 0.0, -1.0),
        0
    );
    assert!(engine.physics_tile_manifold_hits.is_empty());
}

#[test]
fn engine_shape_cast_aabb_tile_obstacles_write_bulk_results_for_wasm() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tilemap_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

    let count = engine.shape_cast_aabb_tile_obstacles(0.0, 5.0, 1.0, 1.0, 1.0, 0.0, 40.0);

    assert_eq!(count, 1);
    assert_eq!(engine.physics_tile_shape_cast_hit_len(), 1);
    assert_eq!(
        engine.physics_tile_shape_cast_hits,
        vec![PhysicsTileShapeCastHit {
            tile_layer_index: 2,
            tile_index: 1,
            distance: 9.0,
            point_x: 9.0,
            point_y: 5.0,
            normal_x: -1.0,
            normal_y: 0.0,
        }]
    );
    assert_eq!(
        engine.physics_tile_shape_cast_hit_ptr(),
        engine.physics_tile_shape_cast_hits.as_ptr()
    );

    let invalid_count = engine.shape_cast_aabb_tile_obstacles(0.0, 5.0, 1.0, 1.0, 0.0, 0.0, 40.0);

    assert_eq!(invalid_count, 0);
    assert!(engine.physics_tile_shape_cast_hits.is_empty());
}

#[test]
fn engine_shape_cast_aabb_tile_obstacles_respects_one_way_platforms() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tile_one_way_platform(1);
    engine.set_shooter_tilemap_layer(0, 1, 1, 10.0, 10.0, 0.0, 10.0, true, vec![1]);

    let downward_count = engine.shape_cast_aabb_tile_obstacles(5.0, 0.0, 1.0, 1.0, 0.0, 1.0, 30.0);

    assert_eq!(downward_count, 1);
    assert_eq!(
        engine.physics_tile_shape_cast_hits,
        vec![PhysicsTileShapeCastHit {
            tile_layer_index: 0,
            tile_index: 0,
            distance: 9.0,
            point_x: 5.0,
            point_y: 9.0,
            normal_x: 0.0,
            normal_y: -1.0,
        }]
    );

    let upward_count = engine.shape_cast_aabb_tile_obstacles(5.0, 24.0, 1.0, 1.0, 0.0, -1.0, 30.0);

    assert_eq!(upward_count, 0);
    assert!(engine.physics_tile_shape_cast_hits.is_empty());
}

#[test]
fn engine_query_aabb_tile_obstacle_contacts_write_bulk_results_for_wasm() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tilemap_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

    let count = engine.query_aabb_tile_obstacle_contacts(9.0, 5.0, 2.0, 2.0);

    assert_eq!(count, 1);
    assert_eq!(engine.physics_tile_contact_hit_len(), 1);
    assert_eq!(
        engine.physics_tile_contact_hits,
        vec![PhysicsTileContactHit {
            tile_layer_index: 2,
            tile_index: 1,
            normal_x: -1.0,
            normal_y: 0.0,
            penetration: 1.0,
            point_x: 11.0,
            point_y: 5.0,
        }]
    );
    assert_eq!(
        engine.physics_tile_contact_hit_ptr(),
        engine.physics_tile_contact_hits.as_ptr()
    );

    let invalid_count = engine.query_aabb_tile_obstacle_contacts(9.0, 5.0, -1.0, 2.0);

    assert_eq!(invalid_count, 0);
    assert!(engine.physics_tile_contact_hits.is_empty());
}

#[test]
fn engine_query_aabb_tile_obstacle_manifolds_write_bulk_results_for_wasm() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tilemap_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

    let count = engine.query_aabb_tile_obstacle_manifolds(9.0, 5.0, 2.0, 2.0);

    assert_eq!(count, 1);
    assert_eq!(engine.physics_tile_manifold_hit_len(), 1);
    assert_eq!(
        engine.physics_tile_manifold_hits,
        vec![PhysicsTileManifoldHit {
            tile_layer_index: 2,
            tile_index: 1,
            point_count: 2,
            normal_x: -1.0,
            normal_y: 0.0,
            penetration: 1.0,
            point0_x: 11.0,
            point0_y: 3.0,
            point0_penetration: 1.0,
            point1_x: 11.0,
            point1_y: 7.0,
            point1_penetration: 1.0,
        }]
    );
    assert_eq!(
        engine.physics_tile_manifold_hit_ptr(),
        engine.physics_tile_manifold_hits.as_ptr()
    );

    let invalid_count = engine.query_aabb_tile_obstacle_manifolds(9.0, 5.0, -1.0, 2.0);

    assert_eq!(invalid_count, 0);
    assert!(engine.physics_tile_manifold_hits.is_empty());
}

#[test]
fn engine_set_shooter_tilemap_tile_refreshes_wasm_tile_obstacle_query() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tilemap_layer(2, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 0]);

    assert!(engine.query_nearest_tile_obstacle(5.0, 5.0, 0.0));

    assert!(engine.set_shooter_tilemap_tile(2, 0, 0, 0));
    assert!(!engine.query_nearest_tile_obstacle(5.0, 5.0, 0.0));

    assert!(engine.set_shooter_tilemap_tile(2, 1, 0, 1));
    assert!(engine.query_nearest_tile_obstacle(0.0, 5.0, 100.0));
    assert_eq!(engine.physics_query_tile_layer_index(), 2);
    assert_eq!(engine.physics_query_tile_index(), 1);

    assert!(!engine.set_shooter_tilemap_tile(2, 1, 0, 1));
    assert!(!engine.set_shooter_tilemap_tile(2, 2, 0, 1));
    assert!(!engine.set_shooter_tilemap_tile(3, 0, 0, 1));
}

#[test]
fn engine_tilemap_rect_edit_can_enforce_rebuild_budget_for_wasm() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tilemap_layer(0, 40, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1; 40]);

    assert!(!engine.set_shooter_tilemap_tiles_rect_with_rebuild_budget(0, 15, 0, 2, 1, 0, 1));
    assert!(engine.query_nearest_tile_obstacle(155.0, 5.0, 0.0));

    assert!(engine.set_shooter_tilemap_tiles_rect_with_rebuild_budget(0, 15, 0, 2, 1, 0, 2));
    assert!(!engine.query_nearest_tile_obstacle(155.0, 5.0, 0.0));
    assert!(engine.query_nearest_tile_obstacle(175.0, 5.0, 0.0));
}

#[test]
fn engine_query_tilemap_navigation_waypoint_stores_scalar_result_for_wasm() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tilemap_layer(
        0,
        3,
        3,
        10.0,
        10.0,
        0.0,
        0.0,
        true,
        vec![0, 1, 0, 0, 1, 0, 0, 0, 0],
    );

    assert!(engine.query_tilemap_navigation_waypoint(5.0, 5.0, 25.0, 5.0));
    assert_eq!(engine.physics_query_point_x(), 5.0);
    assert_eq!(engine.physics_query_point_y(), 15.0);
    assert!((engine.physics_query_distance() - 10.0).abs() < 0.001);

    assert!(!engine.query_tilemap_navigation_waypoint(15.0, 5.0, 25.0, 5.0));
    assert_eq!(engine.physics_query_point_x(), 0.0);
    assert_eq!(engine.physics_query_point_y(), 0.0);
}

#[test]
fn engine_query_tilemap_navigation_path_exposes_buffer_and_debug_lines() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tilemap_layer(0, 3, 2, 10.0, 10.0, 0.0, 0.0, true, vec![0; 6]);
    assert!(engine.set_shooter_tilemap_navigation_cost(0, 1, 0, 20));

    assert!(engine.query_tilemap_navigation_path(5.0, 5.0, 25.0, 5.0));

    assert_eq!(engine.tilemap_navigation_path_point_len(), 4);
    let points = unsafe {
        std::slice::from_raw_parts(
            engine.tilemap_navigation_path_point_ptr(),
            engine.tilemap_navigation_path_point_len() * 5,
        )
    };
    assert_eq!(
        points,
        &[
            5.0, 15.0, 0.0, 0.0, 0.0, 15.0, 15.0, 0.0, 0.0, 0.0, 25.0, 15.0, 0.0, 0.0, 0.0, 25.0,
            5.0, 0.0, 0.0, 0.0,
        ]
    );
    assert_eq!(engine.tilemap_navigation_debug_line_len(), 4);
    assert_eq!(engine.physics_query_point_x(), 5.0);
    assert_eq!(engine.physics_query_point_y(), 15.0);
    assert!((engine.physics_query_distance() - 40.0).abs() < 0.001);

    assert!(!engine.query_tilemap_navigation_path(-5.0, -5.0, 25.0, 5.0));
    assert_eq!(engine.tilemap_navigation_path_point_len(), 0);
    assert_eq!(engine.tilemap_navigation_debug_line_len(), 0);
}

#[test]
fn engine_query_tilemap_navigation_with_height_span_filters_obstacles() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tilemap_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);
    assert!(engine.set_shooter_tile_height_span(1, 1, 0.0, 8.0));

    assert!(!engine.query_tilemap_navigation_path(5.0, 5.0, 25.0, 5.0));
    assert!(
        !engine.query_tilemap_navigation_path_with_height_span(5.0, 5.0, 25.0, 5.0, 1, 0.0, 8.0)
    );
    assert!(
        engine.query_tilemap_navigation_waypoint_with_height_span(5.0, 5.0, 25.0, 5.0, 2, 0.0, 8.0)
    );
    assert_eq!(engine.physics_query_point_x(), 15.0);
    assert_eq!(engine.physics_query_point_y(), 5.0);

    assert!(engine.query_tilemap_navigation_path_with_height_span(5.0, 5.0, 25.0, 5.0, 2, 0.0, 8.0));
    assert_eq!(engine.tilemap_navigation_path_point_len(), 2);
    let points = unsafe {
        std::slice::from_raw_parts(
            engine.tilemap_navigation_path_point_ptr(),
            engine.tilemap_navigation_path_point_len() * 5,
        )
    };
    assert_eq!(
        points,
        &[15.0, 5.0, 2.0, 0.0, 8.0, 25.0, 5.0, 2.0, 0.0, 8.0]
    );

    assert!(
        !engine.query_tilemap_navigation_path_with_height_span(5.0, 5.0, 25.0, 5.0, 2, 0.0, -1.0)
    );
    assert_eq!(engine.tilemap_navigation_path_point_len(), 0);
    assert_eq!(engine.tilemap_navigation_debug_line_len(), 0);
}

#[test]
fn engine_set_shooter_tile_hd2d_metadata_updates_navigation_obstacles() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tilemap_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);

    assert!(!engine.query_tilemap_navigation_path(5.0, 5.0, 25.0, 5.0));
    assert!(
        engine.set_shooter_tile_hd2d_metadata(1, 4, false, false, false, 0.0, false, 0, 0.0, 0.0)
    );
    assert!(engine.query_tilemap_navigation_path(5.0, 5.0, 25.0, 5.0));
    assert_eq!(engine.tilemap_navigation_path_point_len(), 2);

    assert!(
        !engine.set_shooter_tile_hd2d_metadata(1, 2, false, false, false, 0.0, false, 0, 0.0, 8.0)
    );
}

#[test]
fn engine_query_tilemap_navigation_between_height_spans_uses_bridge_portal() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.set_shooter_tilemap_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);
    assert!(
        engine.set_shooter_tile_hd2d_metadata(1, 4, false, false, false, 0.0, false, 0, 0.0, 0.0)
    );
    assert!(engine.set_shooter_tile_bridge_portal(1, 1, 2, 0.0, 12.0, 2));

    assert!(engine.query_tilemap_navigation_path_between_height_spans(
        5.0, 5.0, 25.0, 5.0, 1, 0.0, 8.0, 2, 12.0, 8.0
    ));
    assert_eq!(engine.tilemap_navigation_path_point_len(), 3);
    let points = unsafe {
        std::slice::from_raw_parts(
            engine.tilemap_navigation_path_point_ptr(),
            engine.tilemap_navigation_path_point_len() * 5,
        )
    };
    assert_eq!(
        points,
        &[15.0, 5.0, 1.0, 0.0, 8.0, 15.0, 5.0, 2.0, 12.0, 8.0, 25.0, 5.0, 2.0, 12.0, 8.0,]
    );
}

#[test]
fn engine_set_shooter_tilemap_tiles_rect_refreshes_queries_and_render_commands() {
    let mut engine = Engine::new();
    engine.clear_shooter_tilemap();
    engine.camera.x = 15.0;
    engine.camera.y = 5.0;
    engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    engine.set_shooter_tilemap_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 1, 1]);

    engine.build_render_commands();
    assert_eq!(
        engine
            .render_commands
            .iter()
            .filter(|command| command.texture_id == 9.0)
            .count(),
        3
    );
    assert!(engine.query_nearest_tile_obstacle(5.0, 5.0, 0.0));

    assert!(engine.set_shooter_tilemap_tiles_rect(2, 0, 0, 2, 1, 0));

    assert!(!engine.query_nearest_tile_obstacle(5.0, 5.0, 0.0));
    assert!(engine.query_nearest_tile_obstacle(25.0, 5.0, 0.0));
    assert_eq!(engine.physics_query_tile_layer_index(), 2);
    assert_eq!(engine.physics_query_tile_index(), 2);

    engine.build_render_commands();
    assert_eq!(
        engine
            .render_commands
            .iter()
            .filter(|command| command.texture_id == 9.0)
            .count(),
        1
    );

    assert!(!engine.set_shooter_tilemap_tiles_rect(2, 0, 0, 2, 1, 0));
    assert!(!engine.set_shooter_tilemap_tiles_rect(2, 0, 0, 0, 1, 1));
    assert!(!engine.set_shooter_tilemap_tiles_rect(2, 2, 0, 2, 1, 1));
    assert!(!engine.set_shooter_tilemap_tiles_rect(3, 0, 0, 1, 1, 1));
}

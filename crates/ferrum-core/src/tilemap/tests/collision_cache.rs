use super::*;

#[test]
fn collision_candidate_range_only_covers_overlapping_tiles() {
    let layer = TilemapLayer::from_values(10, 10, 10.0, 10.0, 0.0, 0.0, true, Vec::new()).unwrap();

    let range = layer
        .candidate_tile_range_for_bounds(AabbBounds::from_transform(
            Transform2D { x: 25.0, y: 15.0 },
            test_collider(4.0, 4.0),
        ))
        .unwrap();

    assert_eq!(
        range,
        TileRange {
            min_column: 2,
            max_column: 2,
            min_row: 1,
            max_row: 1,
        }
    );
}

#[test]
fn collision_rects_merge_adjacent_solid_tile_runs() {
    let layer = TilemapLayer::from_values(
        3,
        3,
        10.0,
        10.0,
        0.0,
        0.0,
        true,
        vec![1, 1, 0, 1, 1, 0, 0, 1, 1],
    )
    .unwrap();

    let rects = build_collision_rects_for_layer(&layer, &[], &[]);

    assert_eq!(
        rects,
        vec![
            TileCollisionRect {
                tile_index: 0,
                min_column: 0,
                min_row: 0,
                columns: 2,
                rows: 2,
            },
            TileCollisionRect {
                tile_index: 7,
                min_column: 1,
                min_row: 2,
                columns: 2,
                rows: 1,
            },
        ]
    );
}

#[test]
fn collision_rect_candidate_visitor_uses_chunk_ranges_without_duplicates() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 40, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1; 40]);

    let mut middle_chunk_tiles = Vec::new();
    tilemap.visit_collision_rect_candidates(
        0,
        TileRange {
            min_column: 20,
            max_column: 20,
            min_row: 0,
            max_row: 0,
        },
        |rect| {
            middle_chunk_tiles.push(rect.tile_index);
            true
        },
    );
    assert_eq!(middle_chunk_tiles, vec![16]);

    let mut boundary_tiles = Vec::new();
    tilemap.visit_collision_rect_candidates(
        0,
        TileRange {
            min_column: 15,
            max_column: 16,
            min_row: 0,
            max_row: 0,
        },
        |rect| {
            boundary_tiles.push(rect.tile_index);
            true
        },
    );
    assert_eq!(boundary_tiles, vec![0, 16]);
}

#[test]
fn cross_chunk_solid_queries_return_chunk_local_rects_without_duplicates() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 17, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1; 17]);

    let raycast_hits = tilemap.raycast_obstacles(
        Transform2D { x: -10.0, y: 5.0 },
        Velocity { vx: 1.0, vy: 0.0 },
        200.0,
    );
    assert_eq!(
        raycast_hits
            .iter()
            .map(|hit| hit.tile_index)
            .collect::<Vec<_>>(),
        vec![0, 16]
    );

    let shape_hits = tilemap.shape_cast_aabb_obstacles(
        Transform2D { x: -5.0, y: 5.0 },
        test_collider(1.0, 1.0),
        Velocity { vx: 1.0, vy: 0.0 },
        200.0,
    );
    assert_eq!(
        shape_hits
            .iter()
            .map(|hit| hit.tile_index)
            .collect::<Vec<_>>(),
        vec![0, 16]
    );

    let contact_hits =
        tilemap.aabb_obstacle_contacts(Transform2D { x: 160.0, y: 5.0 }, test_collider(1.0, 1.0));
    assert_eq!(
        contact_hits
            .iter()
            .map(|hit| hit.tile_index)
            .collect::<Vec<_>>(),
        vec![0, 16]
    );

    let nearest = tilemap
        .nearest_collision_obstacle(Transform2D { x: 160.0, y: 5.0 }, 0.0)
        .expect("chunk boundary point should resolve to the containing chunk-local rect");
    assert_eq!(nearest.tile_index, 16);
}

#[test]
fn cross_chunk_sweeps_count_chunk_local_rect_candidates_once() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 17, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1; 17]);
    let mut stats = TilemapSweepStats::default();

    let hit = tilemap
        .swept_aabb_contact(
            Transform2D { x: -5.0, y: 5.0 },
            test_collider(1.0, 1.0),
            Velocity { vx: 200.0, vy: 0.0 },
            &mut stats,
        )
        .expect("sweep should hit the first chunk-local solid rect");

    assert_eq!(hit.tile_index, 0);
    assert_eq!(stats.candidate_tiles, 2);
}

#[test]
fn slope_tiles_sample_surface_and_skip_solid_collision_merge() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);

    let mut stats = TilemapSweepStats::default();
    assert!(tilemap
        .swept_aabb_contact(
            Transform2D { x: -5.0, y: 5.0 },
            test_collider(1.0, 1.0),
            Velocity { vx: 10.0, vy: 0.0 },
            &mut stats,
        )
        .is_some());

    tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);

    let hit = tilemap
        .slope_ground_hit(5.0, 7.0, SlopeConfig::new(0.8, 3.0), true, false)
        .expect("slope tile should report nearby surface");

    assert_eq!(hit.layer_index, 0);
    assert_eq!(hit.tile_index, 0);
    assert!((hit.surface.y - 5.0).abs() < 0.01);
    assert!((hit.vertical_delta + 2.0).abs() < 0.01);
    assert!(hit.surface.normal_y > TILE_GROUND_NORMAL_Y_MIN);

    let mut slope_stats = TilemapSweepStats::default();
    assert!(tilemap
        .swept_aabb_contact(
            Transform2D { x: -5.0, y: 5.0 },
            test_collider(1.0, 1.0),
            Velocity { vx: 10.0, vy: 0.0 },
            &mut slope_stats,
        )
        .is_none());
    assert_eq!(slope_stats.candidate_tiles, 0);
}

#[test]
fn one_way_tiles_block_only_downward_sweeps_and_skip_solid_collision_merge() {
    let layer = TilemapLayer::from_values(1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]).unwrap();
    let one_way_definitions = vec![false, true];
    let rects = build_collision_rects_for_layer(&layer, &[], &one_way_definitions);

    assert!(rects.is_empty());

    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);
    tilemap.set_tile_one_way_platform(1);

    let mut downward_stats = TilemapSweepStats::default();
    let downward_hit = tilemap
        .swept_aabb_contact(
            Transform2D { x: 5.0, y: -2.0 },
            test_collider(1.0, 1.0),
            Velocity { vx: 0.0, vy: 10.0 },
            &mut downward_stats,
        )
        .expect("one-way tile should block downward movement from above");

    assert_eq!(downward_hit.layer_index, 0);
    assert_eq!(downward_hit.tile_index, 0);
    assert!(downward_hit.contact.normal_y >= TILE_GROUND_NORMAL_Y_MIN);
    assert_eq!(downward_stats.candidate_tiles, 1);

    let mut upward_stats = TilemapSweepStats::default();
    assert!(tilemap
        .swept_aabb_contact(
            Transform2D { x: 5.0, y: 12.0 },
            test_collider(1.0, 1.0),
            Velocity { vx: 0.0, vy: -10.0 },
            &mut upward_stats,
        )
        .is_none());
    assert_eq!(upward_stats.candidate_tiles, 1);

    let mut side_stats = TilemapSweepStats::default();
    assert!(tilemap
        .swept_aabb_contact(
            Transform2D { x: -2.0, y: 5.0 },
            test_collider(1.0, 1.0),
            Velocity { vx: 10.0, vy: 0.0 },
            &mut side_stats,
        )
        .is_none());
    assert_eq!(side_stats.candidate_tiles, 1);
}

#[test]
fn set_tile_refreshes_collision_cache_for_tile_queries_and_sweeps() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 0]);

    let initial_hit = tilemap
        .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
        .expect("initial solid tile should be cached as an obstacle");
    assert_eq!(initial_hit.tile_index, 0);

    assert!(tilemap.set_tile(0, 0, 0, 0));
    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
        .is_none());

    assert!(tilemap.set_tile(0, 1, 0, 1));
    let refreshed_hit = tilemap
        .nearest_collision_obstacle(Transform2D { x: 0.0, y: 5.0 }, 100.0)
        .expect("new solid tile should be visible to nearest obstacle queries");
    assert_eq!(refreshed_hit.tile_index, 1);
    assert_eq!(refreshed_hit.point_x, 10.0);
    assert_eq!(refreshed_hit.point_y, 5.0);

    let mut stats = TilemapSweepStats::default();
    let sweep_hit = tilemap
        .swept_aabb_contact(
            Transform2D { x: 0.0, y: 5.0 },
            test_collider(2.0, 2.0),
            Velocity { vx: 20.0, vy: 0.0 },
            &mut stats,
        )
        .expect("new solid tile should be visible to swept movement");
    assert_eq!(sweep_hit.tile_index, 1);
    assert!(stats.candidate_tiles > 0);

    assert!(!tilemap.set_tile(0, 1, 0, 1));
    assert!(!tilemap.set_tile(0, 2, 0, 1));
    assert!(!tilemap.set_tile(4, 0, 0, 1));
}

#[test]
fn set_tiles_rect_refreshes_collision_cache_and_render_commands() {
    let mut tilemap = Tilemap::default();
    tilemap.set_tile_definition(1, 7, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_layer(0, 4, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 1, 1, 0]);
    let camera = Camera2D::new(320.0, 240.0);
    let mut commands = Vec::new();

    tilemap.append_render_commands(&camera, &mut commands);
    assert_eq!(commands.len(), 3);
    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
        .is_some());

    assert!(tilemap.set_tiles_rect(0, 0, 0, 2, 1, 0));

    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
        .is_none());
    let remaining_hit = tilemap
        .nearest_collision_obstacle(Transform2D { x: 25.0, y: 5.0 }, 0.0)
        .expect("remaining solid tile should still be cached as an obstacle");
    assert_eq!(remaining_hit.tile_index, 2);

    commands.clear();
    tilemap.append_render_commands(&camera, &mut commands);
    assert_eq!(commands.len(), 1);
    assert!((commands[0].x - 20.0).abs() < 0.01);

    let mut stats = TilemapSweepStats::default();
    let sweep_hit = tilemap
        .swept_aabb_contact(
            Transform2D { x: 15.0, y: 5.0 },
            test_collider(1.0, 1.0),
            Velocity { vx: 20.0, vy: 0.0 },
            &mut stats,
        )
        .expect("rect edit should leave remaining solid tiles in swept collision cache");
    assert_eq!(sweep_hit.tile_index, 2);
    assert!(stats.candidate_tiles > 0);

    assert!(!tilemap.set_tiles_rect(0, 0, 0, 2, 1, 0));
    assert!(!tilemap.set_tiles_rect(0, 0, 0, 0, 1, 1));
    assert!(!tilemap.set_tiles_rect(0, 3, 0, 2, 1, 1));
    assert!(!tilemap.set_tiles_rect(4, 0, 0, 1, 1, 1));
}

#[test]
fn invalid_layer_authoring_leaves_existing_layer_and_cache_unchanged() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 0]);

    assert_eq!(tilemap.collision_cache_last_rebuilt_chunks(0), 1);
    assert_eq!(tilemap.collision_cache_total_rebuilt_chunks(0), 1);
    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
        .is_some());

    tilemap.set_layer(0, 0, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0]);

    assert_eq!(tilemap.collision_cache_last_rebuilt_chunks(0), 1);
    assert_eq!(tilemap.collision_cache_total_rebuilt_chunks(0), 1);
    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
        .is_some());
}

#[test]
fn non_collision_layer_tile_edit_updates_render_data_without_cache_rebuild() {
    let mut tilemap = Tilemap::default();
    tilemap.set_tile_definition(1, 7, 0.0, 0.0, 0.5, 0.5, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_tile_definition(2, 8, 0.5, 0.0, 1.0, 0.5, 1.0, 1.0, 1.0, 1.0);
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, false, vec![1, 0]);
    let camera = Camera2D::new(320.0, 240.0);
    let mut commands = Vec::new();

    tilemap.append_render_commands(&camera, &mut commands);
    assert_eq!(commands.len(), 1);
    assert_eq!(tilemap.collision_cache_last_rebuilt_chunks(0), 0);
    assert_eq!(tilemap.collision_cache_total_rebuilt_chunks(0), 0);

    assert!(tilemap.set_tile(0, 1, 0, 2));

    commands.clear();
    tilemap.append_render_commands(&camera, &mut commands);
    assert_eq!(commands.len(), 2);
    assert!(commands.iter().any(|command| command.texture_id == 8.0));
    assert_eq!(tilemap.collision_cache_last_rebuilt_chunks(0), 0);
    assert_eq!(tilemap.collision_cache_total_rebuilt_chunks(0), 0);
}

#[test]
fn set_tiles_rect_rebuilds_only_dirty_collision_chunks() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 40, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1; 40]);

    assert_eq!(tilemap.collision_cache_last_rebuilt_chunks(0), 3);
    assert_eq!(tilemap.collision_cache_total_rebuilt_chunks(0), 3);

    assert!(tilemap.set_tiles_rect(0, 4, 0, 2, 1, 0));
    assert_eq!(tilemap.collision_cache_last_rebuilt_chunks(0), 1);
    assert_eq!(tilemap.collision_cache_total_rebuilt_chunks(0), 4);
    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 305.0, y: 5.0 }, 0.0)
        .is_some());

    assert!(!tilemap.set_tiles_rect_with_rebuild_budget(0, 15, 0, 2, 1, 0, 1));
    assert_eq!(tilemap.collision_cache_last_rebuilt_chunks(0), 1);
    assert_eq!(tilemap.collision_cache_total_rebuilt_chunks(0), 4);
    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 155.0, y: 5.0 }, 0.0)
        .is_some());

    assert!(tilemap.set_tiles_rect_with_rebuild_budget(0, 15, 0, 2, 1, 0, 2));
    assert_eq!(tilemap.collision_cache_last_rebuilt_chunks(0), 2);
    assert_eq!(tilemap.collision_cache_total_rebuilt_chunks(0), 6);
    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 155.0, y: 5.0 }, 0.0)
        .is_none());
    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 165.0, y: 5.0 }, 0.0)
        .is_none());
    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 175.0, y: 5.0 }, 0.0)
        .is_some());
}

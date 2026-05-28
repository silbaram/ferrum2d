use super::*;

#[test]
fn nearest_collision_obstacle_returns_nearest_merged_rect() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 4, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1, 0]);

    let hit = tilemap
        .nearest_collision_obstacle(Transform2D { x: 0.0, y: 5.0 }, 100.0)
        .expect("nearest tile obstacle should be found");

    assert_eq!(hit.layer_index, 0);
    assert_eq!(hit.tile_index, 1);
    assert!((hit.distance - 10.0).abs() < 0.01);
    assert_eq!(hit.point_x, 10.0);
    assert_eq!(hit.point_y, 5.0);
}

#[test]
fn nearest_collision_obstacle_returns_zero_inside_obstacle() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);

    let hit = tilemap
        .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 0.0)
        .expect("point inside obstacle should hit at distance zero");

    assert_eq!(hit.layer_index, 0);
    assert_eq!(hit.tile_index, 0);
    assert_eq!(hit.distance, 0.0);
    assert_eq!(hit.point_x, 5.0);
    assert_eq!(hit.point_y, 5.0);
}

#[test]
fn nearest_collision_obstacle_uses_layer_and_tile_tie_break() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(2, 1, 1, 10.0, 10.0, 20.0, 0.0, true, vec![1]);
    tilemap.set_layer(1, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);

    let hit = tilemap
        .nearest_collision_obstacle(Transform2D { x: 15.0, y: 5.0 }, 20.0)
        .expect("nearest tie should be resolved by layer index");

    assert_eq!(hit.layer_index, 1);
    assert_eq!(hit.tile_index, 0);
    assert_eq!(hit.distance, 5.0);
}

#[test]
fn nearest_collision_obstacle_ignores_non_collision_and_max_distance_misses() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, false, vec![1]);

    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 5.0, y: 5.0 }, 100.0)
        .is_none());

    tilemap.set_layer(1, 1, 1, 10.0, 10.0, 20.0, 0.0, true, vec![1]);

    assert!(tilemap
        .nearest_collision_obstacle(Transform2D { x: 0.0, y: 5.0 }, 5.0)
        .is_none());
    assert!(tilemap
        .nearest_collision_obstacle(
            Transform2D {
                x: f32::NAN,
                y: 5.0,
            },
            100.0,
        )
        .is_none());
}

#[test]
fn raycast_obstacles_returns_merged_solid_rect_hits() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(2, 4, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1, 1]);

    let hits = tilemap.raycast_obstacles(
        Transform2D { x: 0.0, y: 5.0 },
        Velocity { vx: 1.0, vy: 0.0 },
        50.0,
    );

    assert_eq!(
        hits,
        vec![TilemapShapeCastHit {
            layer_index: 2,
            tile_index: 1,
            distance: 10.0,
            point_x: 10.0,
            point_y: 5.0,
            normal_x: -1.0,
            normal_y: 0.0,
        }]
    );
}

#[test]
fn raycast_obstacles_reports_zero_when_origin_is_inside_obstacle() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);

    let hits = tilemap.raycast_obstacles(
        Transform2D { x: 5.0, y: 5.0 },
        Velocity { vx: 1.0, vy: 0.0 },
        0.0,
    );

    assert_eq!(
        hits,
        vec![TilemapShapeCastHit {
            layer_index: 0,
            tile_index: 0,
            distance: 0.0,
            point_x: 5.0,
            point_y: 5.0,
            normal_x: 0.0,
            normal_y: 0.0,
        }]
    );
}

#[test]
fn segment_cast_obstacles_limits_hits_to_segment_endpoints() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1]);

    assert!(tilemap
        .segment_cast_obstacles(
            Transform2D { x: 0.0, y: 5.0 },
            Transform2D { x: 9.0, y: 5.0 }
        )
        .is_empty());

    let hits = tilemap.segment_cast_obstacles(
        Transform2D { x: 0.0, y: 5.0 },
        Transform2D { x: 10.0, y: 5.0 },
    );

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].distance, 10.0);
    assert_eq!(hits[0].tile_index, 1);
}

#[test]
fn raycast_obstacles_skip_non_solid_metadata_and_clear_invalid_queries() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);
    tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);
    tilemap.set_tile_one_way_platform(2);

    assert!(tilemap
        .raycast_obstacles(
            Transform2D { x: 0.0, y: 5.0 },
            Velocity { vx: 1.0, vy: 0.0 },
            30.0
        )
        .is_empty());

    let mut hits = vec![TilemapShapeCastHit {
        layer_index: 0,
        tile_index: 0,
        distance: 0.0,
        point_x: 0.0,
        point_y: 0.0,
        normal_x: 0.0,
        normal_y: 0.0,
    }];
    tilemap.raycast_obstacles_into(
        Transform2D { x: 0.0, y: 5.0 },
        Velocity { vx: 0.0, vy: 0.0 },
        30.0,
        &mut hits,
    );

    assert!(hits.is_empty());
}

#[test]
fn swept_aabb_contact_finds_nearest_solid_tile() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);
    let mut stats = TilemapSweepStats::default();

    let hit = tilemap
        .swept_aabb_contact(
            Transform2D { x: 0.0, y: 5.0 },
            test_collider(2.0, 2.0),
            Velocity { vx: 20.0, vy: 0.0 },
            &mut stats,
        )
        .unwrap();

    assert_eq!(hit.layer_index, 0);
    assert_eq!(hit.tile_index, 1);
    assert!((hit.contact.time - 0.4).abs() < 0.01);
    assert_eq!(hit.contact.normal_x, 1.0);
    assert_eq!(hit.contact.normal_y, 0.0);
    assert!(stats.candidate_tiles > 0);
}

#[test]
fn swept_aabb_contact_checks_merged_rect_once() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 1]);
    let mut stats = TilemapSweepStats::default();

    let hit = tilemap
        .swept_aabb_contact(
            Transform2D { x: -5.0, y: 5.0 },
            test_collider(2.0, 2.0),
            Velocity { vx: 30.0, vy: 0.0 },
            &mut stats,
        )
        .unwrap();

    assert_eq!(hit.layer_index, 0);
    assert_eq!(hit.tile_index, 0);
    assert_eq!(stats.candidate_tiles, 1);
    assert!((hit.contact.time - 0.1).abs() < 0.01);
}

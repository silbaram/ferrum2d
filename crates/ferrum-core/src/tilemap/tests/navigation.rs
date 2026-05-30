use super::*;

#[test]
fn navigation_waypoint_uses_collision_layer_path() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(
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

    let waypoint = tilemap
        .navigation_waypoint(
            Transform2D { x: 5.0, y: 5.0 },
            Transform2D { x: 25.0, y: 5.0 },
        )
        .unwrap();

    assert_eq!(waypoint, Transform2D { x: 5.0, y: 15.0 });
}

#[test]
fn navigation_waypoint_with_scratch_reuses_buffers_and_resets_dirty_cells() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(
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
    let mut scratch = TilemapNavigationScratch::default();

    let waypoint = tilemap
        .navigation_waypoint_with_scratch(
            Transform2D { x: 5.0, y: 5.0 },
            Transform2D { x: 25.0, y: 5.0 },
            &mut scratch,
        )
        .unwrap();
    let came_from_capacity = scratch.came_from.capacity();
    let g_scores_capacity = scratch.g_scores.capacity();
    let open_capacity = scratch.open.capacity();

    assert_eq!(waypoint, Transform2D { x: 5.0, y: 15.0 });
    assert!(scratch.visited.is_empty());
    assert!(scratch.came_from.iter().all(|cell| *cell == UNVISITED_CELL));
    assert!(scratch.g_scores.iter().all(|score| *score == u32::MAX));

    let waypoint = tilemap
        .navigation_waypoint_with_scratch(
            Transform2D { x: 5.0, y: 5.0 },
            Transform2D { x: 25.0, y: 5.0 },
            &mut scratch,
        )
        .unwrap();

    assert_eq!(waypoint, Transform2D { x: 5.0, y: 15.0 });
    assert_eq!(scratch.came_from.capacity(), came_from_capacity);
    assert_eq!(scratch.g_scores.capacity(), g_scores_capacity);
    assert_eq!(scratch.open.capacity(), open_capacity);
}

#[test]
fn navigation_path_returns_all_waypoints_after_start() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 3, 2, 10.0, 10.0, 0.0, 0.0, true, vec![0; 6]);
    assert!(tilemap.set_navigation_cost(0, 1, 0, 20));

    let path = tilemap
        .navigation_path(
            Transform2D { x: 5.0, y: 5.0 },
            Transform2D { x: 25.0, y: 5.0 },
        )
        .unwrap();

    assert_eq!(
        path,
        vec![
            Transform2D { x: 5.0, y: 15.0 },
            Transform2D { x: 15.0, y: 15.0 },
            Transform2D { x: 25.0, y: 15.0 },
            Transform2D { x: 25.0, y: 5.0 },
        ]
    );
}

#[test]
fn navigation_path_uses_exact_goal_when_start_and_goal_share_cell() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 0]);

    let path = tilemap
        .navigation_path(
            Transform2D { x: 2.0, y: 2.0 },
            Transform2D { x: 8.0, y: 8.0 },
        )
        .unwrap();

    assert_eq!(path, vec![Transform2D { x: 8.0, y: 8.0 }]);
}

#[test]
fn navigation_path_with_height_span_filters_blocking_tiles() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);
    assert!(tilemap.set_tile_height_span_definition(1, 1, 0.0, 8.0));

    let from = Transform2D { x: 5.0, y: 5.0 };
    let to = Transform2D { x: 25.0, y: 5.0 };
    assert_eq!(tilemap.navigation_path(from, to), None);
    assert_eq!(
        tilemap.navigation_path_with_height_span(
            from,
            to,
            HeightSpan::new(PhysicsFloorId(1), 0.0, 8.0).unwrap()
        ),
        None
    );

    let path = tilemap
        .navigation_path_with_height_span(
            from,
            to,
            HeightSpan::new(PhysicsFloorId(2), 0.0, 8.0).unwrap(),
        )
        .unwrap();

    assert_eq!(
        path,
        vec![
            Transform2D { x: 15.0, y: 5.0 },
            Transform2D { x: 25.0, y: 5.0 },
        ]
    );
}

#[test]
fn navigation_waypoint_with_height_span_treats_legacy_obstacles_as_non_blocking() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);

    let waypoint = tilemap
        .navigation_waypoint_with_height_span(
            Transform2D { x: 5.0, y: 5.0 },
            Transform2D { x: 25.0, y: 5.0 },
            HeightSpan::new(PhysicsFloorId(1), 0.0, 8.0).unwrap(),
        )
        .unwrap();

    assert_eq!(waypoint, Transform2D { x: 15.0, y: 5.0 });
}

#[test]
fn navigation_path_treats_non_blocking_hd2d_tiles_as_walkable() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);

    assert_eq!(
        tilemap.navigation_path(
            Transform2D { x: 5.0, y: 5.0 },
            Transform2D { x: 25.0, y: 5.0 }
        ),
        None
    );

    assert!(tilemap.set_tile_hd2d_definition(
        1,
        Hd2dTileKind::Bridge.code(),
        false,
        false,
        false,
        0.0,
        false,
        0,
        0.0,
        0.0,
    ));

    let path = tilemap
        .navigation_path(
            Transform2D { x: 5.0, y: 5.0 },
            Transform2D { x: 25.0, y: 5.0 },
        )
        .unwrap();

    assert_eq!(
        path,
        vec![
            Transform2D { x: 15.0, y: 5.0 },
            Transform2D { x: 25.0, y: 5.0 },
        ]
    );
}

#[test]
fn navigation_path_between_height_spans_uses_bridge_portal_floor_edge() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);
    assert!(tilemap.set_tile_hd2d_definition(
        1,
        Hd2dTileKind::Bridge.code(),
        false,
        false,
        false,
        0.0,
        false,
        0,
        0.0,
        0.0,
    ));
    assert!(tilemap.set_tile_bridge_portal_definition(1, 1, 2, 0.0, 12.0, 2));

    let path = tilemap
        .navigation_path_between_height_spans(
            Transform2D { x: 5.0, y: 5.0 },
            Transform2D { x: 25.0, y: 5.0 },
            HeightSpan::new(PhysicsFloorId(1), 0.0, 8.0).unwrap(),
            HeightSpan::new(PhysicsFloorId(2), 12.0, 8.0).unwrap(),
        )
        .unwrap();

    assert_eq!(
        path,
        vec![
            TilemapNavigationPathPoint {
                x: 15.0,
                y: 5.0,
                floor: PhysicsFloorId(1),
                elevation: 0.0,
                height: 8.0,
            },
            TilemapNavigationPathPoint {
                x: 15.0,
                y: 5.0,
                floor: PhysicsFloorId(2),
                elevation: 12.0,
                height: 8.0,
            },
            TilemapNavigationPathPoint {
                x: 25.0,
                y: 5.0,
                floor: PhysicsFloorId(2),
                elevation: 12.0,
                height: 8.0,
            },
        ]
    );
}

#[test]
fn navigation_waypoint_is_none_without_collision_layer() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, false, vec![0, 0]);

    assert_eq!(
        tilemap.navigation_waypoint(
            Transform2D { x: 5.0, y: 5.0 },
            Transform2D { x: 15.0, y: 5.0 },
        ),
        None
    );
}

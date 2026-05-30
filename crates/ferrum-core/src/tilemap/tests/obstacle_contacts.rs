use super::*;

#[test]
fn aabb_obstacle_contacts_return_merged_solid_overlap() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

    let hits =
        tilemap.aabb_obstacle_contacts(Transform2D { x: 9.0, y: 5.0 }, test_collider(2.0, 2.0));

    assert_eq!(
        hits,
        vec![TilemapContactHit {
            layer_index: 2,
            tile_index: 1,
            normal_x: -1.0,
            normal_y: 0.0,
            penetration: 1.0,
            point_x: 11.0,
            point_y: 5.0,
        }]
    );
}

#[test]
fn explicit_height_span_filters_tile_obstacle_contacts_and_manifolds() {
    let mut tilemap = Tilemap::default();
    assert!(tilemap.set_tile_height_span_definition(1, 1, 0.0, 8.0));
    assert!(tilemap.set_tile_height_span_definition(2, 2, 0.0, 8.0));
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);
    let query_span = HeightSpan::new(PhysicsFloorId(2), 0.0, 8.0);

    let mut contacts = Vec::new();
    tilemap.aabb_obstacle_contacts_with_height_span_into(
        Transform2D { x: 10.0, y: 5.0 },
        test_collider(12.0, 2.0),
        query_span,
        &mut contacts,
    );
    assert_eq!(contacts.len(), 1);
    assert_eq!(contacts[0].tile_index, 1);

    let mut manifolds = Vec::new();
    tilemap.aabb_obstacle_manifolds_with_height_span_into(
        Transform2D { x: 10.0, y: 5.0 },
        test_collider(12.0, 2.0),
        query_span,
        &mut manifolds,
    );
    assert_eq!(manifolds.len(), 1);
    assert_eq!(manifolds[0].tile_index, 1);
}

#[test]
fn aabb_obstacle_contacts_skip_non_solid_tile_metadata_and_clear_invalid_queries() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);
    tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);
    tilemap.set_tile_one_way_platform(2);

    assert!(tilemap
        .aabb_obstacle_contacts(Transform2D { x: 10.0, y: 5.0 }, test_collider(12.0, 2.0))
        .is_empty());

    let mut hits = vec![TilemapContactHit {
        layer_index: 0,
        tile_index: 0,
        normal_x: 0.0,
        normal_y: 0.0,
        penetration: 0.0,
        point_x: 0.0,
        point_y: 0.0,
    }];
    tilemap.aabb_obstacle_contacts_into(
        Transform2D { x: 10.0, y: 5.0 },
        test_collider(-1.0, 2.0),
        &mut hits,
    );

    assert!(hits.is_empty());
}

#[test]
fn aabb_obstacle_manifolds_return_two_face_points() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

    let hits =
        tilemap.aabb_obstacle_manifolds(Transform2D { x: 9.0, y: 5.0 }, test_collider(2.0, 2.0));

    assert_eq!(
        hits,
        vec![TilemapContactManifoldHit {
            layer_index: 2,
            tile_index: 1,
            point_count: 2,
            normal_x: -1.0,
            normal_y: 0.0,
            penetration: 1.0,
            points: [
                TilemapContactPoint {
                    point_x: 11.0,
                    point_y: 3.0,
                    penetration: 1.0,
                },
                TilemapContactPoint {
                    point_x: 11.0,
                    point_y: 7.0,
                    penetration: 1.0,
                },
            ],
        }]
    );
}

#[test]
fn aabb_obstacle_manifolds_skip_non_solid_metadata_and_clear_invalid_queries() {
    let mut tilemap = Tilemap::default();
    tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 2]);
    tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);
    tilemap.set_tile_one_way_platform(2);

    assert!(tilemap
        .aabb_obstacle_manifolds(Transform2D { x: 10.0, y: 5.0 }, test_collider(12.0, 2.0))
        .is_empty());

    let mut hits = vec![TilemapContactManifoldHit {
        layer_index: 0,
        tile_index: 0,
        point_count: 1,
        normal_x: 0.0,
        normal_y: 0.0,
        penetration: 0.0,
        points: [TilemapContactPoint::default(); MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
    }];
    tilemap.aabb_obstacle_manifolds_into(
        Transform2D { x: 10.0, y: 5.0 },
        test_collider(-1.0, 2.0),
        &mut hits,
    );

    assert!(hits.is_empty());
}

use super::*;

fn world(space: Space) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap()
}
fn fixed(position: [f32; 3]) -> BodyDesc {
    BodyDesc {
        kind: BodyKind::Fixed,
        pose: Pose {
            position,
            ..Pose::default()
        },
        ..BodyDesc::default()
    }
}
fn close(a: f32, b: f32) {
    assert!((a - b).abs() < 0.0002, "{a} != {b}");
}

#[test]
fn multi_sweep_reports_rotated_target_surface_geometry_sorted_before_limiting() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut w = world(space);
        let far = w
            .create_body(
                fixed([8.0, 0.0, 0.0]),
                ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            )
            .unwrap();
        let mut target = fixed([5.0, 0.0, 0.0]);
        let q = std::f32::consts::FRAC_1_SQRT_2;
        target.pose.rotation = [0.0, 0.0, q, q];
        let near = w
            .create_body(
                target,
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.5, 1.0, 2.0],
                }),
            )
            .unwrap();
        w.create_body(
            fixed([3.0, 3.0, 0.0]),
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        )
        .unwrap();
        let mut hits = Vec::new();
        let shape = Shape::Sphere { radius: 0.25 };
        assert!(w
            .sweep_all(
                &shape,
                Pose::default(),
                [10.0, 0.0, 0.0],
                &QueryFilter::default(),
                &mut hits,
                1
            )
            .unwrap());
        assert_eq!(hits[0].target.body, near);
        close(hits[0].fraction, 0.375);
        close(hits[0].point[0], 4.0);
        // GJK witnesses are approximate along the face; keep tighter TOI/normal checks.
        assert!(hits[0].point[1].abs() < 0.0005, "{:?}", hits[0]);
        close(hits[0].normal[0], -1.0);
        close(hits[0].normal[1], 0.0);
        assert!(!hits[0].initial_overlap);
        assert!(!w
            .sweep_all(
                &shape,
                Pose::default(),
                [10.0, 0.0, 0.0],
                &QueryFilter::default(),
                &mut hits,
                8
            )
            .unwrap());
        assert_eq!(
            hits.iter().map(|h| h.target.body).collect::<Vec<_>>(),
            [near, far]
        );
        close(hits[1].fraction, 0.725);
        w.set_pose(
            near,
            Pose {
                position: [0.0; 3],
                ..Pose::default()
            },
        )
        .unwrap();
        w.sweep_all(
            &shape,
            Pose::default(),
            [0.0; 3],
            &QueryFilter::default(),
            &mut hits,
            8,
        )
        .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].target.body, near);
        assert!(hits[0].initial_overlap);
        let closest = w
            .sweep(&shape, Pose::default(), [0.0; 3], &QueryFilter::default())
            .unwrap()
            .unwrap();
        assert_eq!(closest, hits[0]);
        assert!(hits[0]
            .point
            .iter()
            .chain(&hits[0].normal)
            .all(|v| v.is_finite()));
    }
}

#[test]
fn zero_width_query_boxes_do_not_relax_physical_collider_validation() {
    let mut w = world(Space::PlanarXy);
    let body = w
        .create_body(
            fixed([5.0, 0.0, 0.0]),
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            }),
        )
        .unwrap();
    for half_extents in [
        [0.0, 0.0, 0.0],
        [0.0, 0.0, 0.5],
        [0.0, 1.0, 0.5],
        [1.0, 0.0, 0.5],
    ] {
        let query = Shape::Box { half_extents };
        assert_eq!(
            w.create_body(fixed([0.0; 3]), ColliderDesc::new(query.clone())),
            Err(PhysicsError::InvalidCollider)
        );
        let mut overlaps = Vec::new();
        w.overlap(
            &query,
            Pose {
                position: [5.0, 0.0, 0.0],
                ..Pose::default()
            },
            &QueryFilter::default(),
            &mut overlaps,
            8,
        )
        .unwrap();
        assert_eq!(overlaps.len(), 1);
        assert_eq!(overlaps[0].body, body);
        let mut hits = Vec::new();
        w.sweep_all(
            &query,
            Pose::default(),
            [10.0, 0.0, 0.0],
            &QueryFilter::default(),
            &mut hits,
            8,
        )
        .unwrap();
        assert_eq!(hits.len(), 1);
        close(hits[0].fraction, (4.5 - half_extents[0]) / 10.0);
        close(hits[0].normal[0], -1.0);
        let saved = hits.clone();
        assert_eq!(
            w.sweep_all(
                &query,
                Pose {
                    rotation: [f32::NAN; 4],
                    ..Pose::default()
                },
                [10.0, 0.0, 0.0],
                &QueryFilter::default(),
                &mut hits,
                8
            ),
            Err(PhysicsError::InvalidQuery)
        );
        assert_eq!(hits, saved);
        assert_eq!(
            w.sweep_all(
                &query,
                Pose::default(),
                [f32::NAN, 0.0, 0.0],
                &QueryFilter::default(),
                &mut hits,
                8
            ),
            Err(PhysicsError::InvalidQuery)
        );
        assert_eq!(hits, saved);
        assert_eq!(
            w.sweep_all(
                &query,
                Pose::default(),
                [10.0, 0.0, 1.0],
                &QueryFilter::default(),
                &mut hits,
                8
            ),
            Err(PhysicsError::OutOfPlane)
        );
        assert_eq!(hits, saved);
        assert_eq!(
            w.sweep_all(
                &query,
                Pose::default(),
                [10.0, 0.0, 0.0],
                &QueryFilter::default(),
                &mut hits,
                0
            ),
            Err(PhysicsError::InvalidQuery)
        );
        assert_eq!(hits, saved);
    }
}

#[test]
fn all_sweeps_and_projections_use_actual_mesh_heightfield_and_compound_surfaces() {
    for terrain in [
        Shape::TriangleMesh {
            vertices: vec![
                [-2.0, 0.0, -2.0],
                [2.0, 0.0, -2.0],
                [2.0, 0.0, 2.0],
                [-2.0, 0.0, 2.0],
            ],
            triangles: vec![[0, 2, 1], [0, 3, 2]],
        },
        Shape::Heightfield {
            rows: 2,
            columns: 2,
            heights: vec![0.0; 4],
            size: [4.0, 4.0],
        },
        Shape::Compound {
            parts: vec![ShapePart {
                shape: Shape::Box {
                    half_extents: [2.0, 0.5, 2.0],
                },
                pose: Pose {
                    position: [0.0, -0.5, 0.0],
                    ..Pose::default()
                },
            }],
        },
    ] {
        let mut w = world(Space::Spatial);
        let body = w
            .create_body(fixed([0.0; 3]), ColliderDesc::new(terrain))
            .unwrap();
        let mut sweeps = Vec::new();
        w.sweep_all(
            &Shape::Sphere { radius: 0.5 },
            Pose {
                position: [0.0, 2.0, 0.0],
                ..Pose::default()
            },
            [0.0, -4.0, 0.0],
            &QueryFilter::default(),
            &mut sweeps,
            8,
        )
        .unwrap();
        assert_eq!(sweeps.len(), 1);
        assert_eq!(sweeps[0].target.body, body);
        close(sweeps[0].fraction, 0.375);
        close(sweeps[0].point[1], 0.0);
        close(sweeps[0].normal[1], 1.0);
        let mut points = Vec::new();
        w.project_point_all(
            [0.0, 2.0, 0.0],
            3.0,
            &QueryFilter::default(),
            &mut points,
            8,
        )
        .unwrap();
        assert_eq!(points.len(), 1);
        close(points[0].distance, 2.0);
        assert_eq!(points[0].point, [0.0; 3]);
        w.project_point_all(
            [3.0, 0.0, 0.0],
            0.5,
            &QueryFilter::default(),
            &mut points,
            8,
        )
        .unwrap();
        assert!(points.is_empty());
    }
}

#[test]
fn nearest_points_preserve_distance_bounds_filters_edits_and_output_on_errors() {
    let mut w = world(Space::Spatial);
    let far = w
        .create_body(
            fixed([5.0, 0.0, 0.0]),
            ColliderDesc::new(Shape::Sphere { radius: 1.0 }),
        )
        .unwrap();
    let near = w
        .create_body(
            fixed([2.0, 0.0, 0.0]),
            ColliderDesc {
                category: 8,
                mask: 0,
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 1.0 })
            },
        )
        .unwrap();
    let mut filter = QueryFilter {
        respect_target_mask: false,
        include_sensors: true,
        ..QueryFilter::default()
    };
    let mut points = Vec::new();
    assert!(w
        .project_point_all([0.0; 3], 10.0, &filter, &mut points, 1)
        .unwrap());
    assert_eq!(points[0].target.body, near);
    assert_eq!(points[0].point, [1.0, 0.0, 0.0]);
    close(points[0].distance, 1.0);
    assert!(!points[0].is_inside);
    w.project_point_all([0.0; 3], 0.999, &filter, &mut points, 8)
        .unwrap();
    assert!(points.is_empty());
    w.project_point_all([0.0; 3], 1.0, &filter, &mut points, 8)
        .unwrap();
    assert_eq!(points.len(), 1);
    filter.exclude_body = Some(near);
    w.project_point_all([0.0; 3], 10.0, &filter, &mut points, 8)
        .unwrap();
    assert_eq!(points[0].target.body, far);
    filter.exclude_body = None;
    w.set_pose(near, Pose::default()).unwrap();
    w.project_point_all([0.0; 3], 0.0, &filter, &mut points, 8)
        .unwrap();
    assert_eq!(points[0].target.body, near);
    assert_eq!(points[0].point, [0.0; 3]);
    assert!(points[0].is_inside);
    let prior = points.clone();
    for distance in [-1.0, f32::NAN, f32::INFINITY] {
        assert_eq!(
            w.project_point_all([0.0; 3], distance, &filter, &mut points, 8),
            Err(PhysicsError::InvalidQuery)
        );
        assert_eq!(points, prior);
    }
    w.remove_body(near).unwrap();
    filter.exclude_body = Some(near);
    assert_eq!(
        w.project_point_all([0.0; 3], 10.0, &filter, &mut points, 8),
        Err(PhysicsError::StaleBody)
    );
    assert_eq!(points, prior);
}

#[test]
fn overlap_limits_select_identity_order_instead_of_bvh_traversal() {
    let mut w = world(Space::Spatial);
    let mut expected = Vec::new();
    for x in [3.0, -3.0, 0.0, 2.0, -1.0] {
        let body = w
            .create_body(
                fixed([x, 0.0, 0.0]),
                ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            )
            .unwrap();
        expected.push(w.collider_ids(body).unwrap().next().unwrap());
    }
    expected.sort_unstable();
    let mut out = Vec::new();
    assert!(w
        .overlap(
            &Shape::Sphere { radius: 5.0 },
            Pose::default(),
            &QueryFilter::default(),
            &mut out,
            2
        )
        .unwrap());
    assert_eq!(
        out.iter().map(|h| h.collider).collect::<Vec<_>>(),
        expected[..2]
    );
}

//! Native Platformer query regressions.
use super::*;
use crate::physics3d::{BodyDesc, BodyKind, BodyOptions, ColliderDesc, Space, WorldConfig};

fn world() -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap()
}
fn cube(x: f32, y: f32) -> ColliderDesc {
    ColliderDesc::new(Shape::Box {
        half_extents: [x, y, x.hypot(y) + 1.],
    })
}
fn body(w: &mut PhysicsWorld3d, kind: BodyKind, xy: [f32; 2], desc: ColliderDesc) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: Pose {
                position: [xy[0], xy[1], 0.],
                ..Default::default()
            },
            ..Default::default()
        },
        desc,
    )
    .unwrap()
}
fn close(a: f32, b: f32) {
    assert!((a - b).abs() < 0.001, "actual={a}, expected={b}");
}
fn cast(
    w: &mut PhysicsWorld3d,
    source: BodyId,
    offset: [f32; 3],
    delta: [f32; 3],
) -> Option<SweepHit> {
    w.sweep_planar_platformer(source, offset, delta, u32::MAX, 0, None)
        .unwrap()
        .0
}

#[test]
fn planar_platformer_ground_cast_preserves_native_state_and_queued_input() {
    let mut w = world();
    let source = body(&mut w, BodyKind::KinematicVelocity, [0., 0.], cube(0.5, 1.));
    let floor = body(&mut w, BodyKind::Fixed, [0., 5.], cube(10., 1.));
    let dynamic = body(&mut w, BodyKind::Dynamic, [100., 100.], cube(1., 1.));
    w.set_velocity(source, [2., 3., 0.], [0., 0., 1.]).unwrap();
    w.set_planar_rotation(source, 4. * std::f64::consts::PI)
        .unwrap();
    w.add_force(dynamic, [3., 4., 0.], [0., 0., 2.]).unwrap();
    w.refresh_queries();
    let before = w.capture_snapshot().unwrap();
    let (hit, candidates) = w
        .probe_planar_platformer_ground(source, [0.; 3], 10., u32::MAX, 0, None)
        .unwrap();
    let hit = hit.unwrap();
    assert_eq!(hit.target.body, floor);
    close(hit.fraction, 0.3);
    close(hit.normal[1], -1.);
    assert!(candidates > 0);
    assert_eq!(
        w.probe_planar_platformer_ground(source, [0.; 3], 10., u32::MAX, 0, None)
            .unwrap()
            .0,
        Some(hit)
    );
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn planar_platformer_touching_surfaces_allow_tangent_and_departure() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.5, 0.5),
    );
    body(&mut w, BodyKind::Fixed, [0., 1.], cube(10., 0.5));
    assert!(cast(&mut w, source, [0.; 3], [3., 0., 0.]).is_none());
    assert!(cast(&mut w, source, [0.; 3], [0., -3., 0.]).is_none());
    let down = cast(&mut w, source, [0.; 3], [0., 3., 0.]).unwrap();
    close(down.fraction, 0.);
    close(down.normal[1], -1.);
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.5, 0.5),
    );
    body(&mut w, BodyKind::Fixed, [0., -1.], cube(10., 0.5));
    assert!(cast(&mut w, source, [0.; 3], [0., 3., 0.]).is_none());
    let up = cast(&mut w, source, [0.; 3], [0., -3., 0.]).unwrap();
    close(up.fraction, 0.);
    close(up.normal[1], 1.);
}

#[test]
fn planar_platformer_one_way_only_blocks_downward_motion_from_above() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.5, 0.5),
    );
    let mut platform = cube(3., 1.);
    platform.category = 2;
    let target = body(&mut w, BodyKind::Fixed, [0., 3.], platform);
    let down = w
        .sweep_planar_platformer(source, [0.; 3], [0., 4., 0.], u32::MAX, 2, None)
        .unwrap()
        .0
        .unwrap();
    assert_eq!(down.target.body, target);
    close(down.fraction, 1.5 / 4.);
    close(down.normal[1], -1.);
    for (offset, delta) in [
        ([0., 5., 0.], [0., -6., 0.]),
        ([0., 4., 0.], [0., 2., 0.]),
        ([-5., 3., 0.], [10., 0., 0.]),
        ([0., 3., 0.], [4., 4., 0.]),
    ] {
        assert!(
            w.sweep_planar_platformer(source, offset, delta, u32::MAX, 2, None)
                .unwrap()
                .0
                .is_none(),
            "{offset:?} {delta:?}"
        );
    }
    assert!(w
        .sweep_planar_platformer(source, [0., 5., 0.], [0., -6., 0.], u32::MAX, 0, None)
        .unwrap()
        .0
        .is_some());
}

#[test]
fn planar_platformer_one_way_is_selected_per_fixture() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.5, 0.5),
    );
    let mut one_way = cube(3., 1.);
    one_way.category = 2;
    let target = body(&mut w, BodyKind::Fixed, [0., 3.], one_way);
    let mut solid = cube(0.5, 1.);
    solid.category = 8;
    solid.pose.position = [5., 0., 0.];
    let solid_id = w.add_collider(target, solid).unwrap();
    let hit = w
        .sweep_planar_platformer(source, [5., 5., 0.], [0., -3., 0.], u32::MAX, 2, None)
        .unwrap()
        .0
        .unwrap();
    assert_eq!(hit.target.collider, solid_id);
    close(hit.fraction, 0.5 / 3.);
    close(hit.normal[1], 1.);
}

#[test]
fn planar_platformer_ground_probe_filters_side_contacts_before_closest_reduction() {
    for wall_x in [0.9, 1.] {
        let mut w = world();
        let source = body(
            &mut w,
            BodyKind::KinematicVelocity,
            [0., 0.],
            cube(0.5, 0.5),
        );
        let side = body(&mut w, BodyKind::Fixed, [wall_x, 0.], cube(0.5, 5.));
        let floor = body(&mut w, BodyKind::Fixed, [0., 3.], cube(10., 0.5));
        let ground = w
            .probe_planar_platformer_ground(source, [0.; 3], 4., u32::MAX, 0, None)
            .unwrap()
            .0
            .unwrap();
        assert_eq!(ground.target.body, floor);
        close(ground.fraction, 0.5);
        close(ground.normal[1], -1.);
        let generic = cast(&mut w, source, [0.; 3], [0., 4., 0.]).unwrap();
        assert_eq!(generic.target.body, if wall_x < 1. { side } else { floor });
    }
}

#[test]
fn planar_platformer_carry_can_exclude_support_but_still_hits_other_solids() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.5, 0.5),
    );
    let support = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 1.],
        cube(10., 0.5),
    );
    let wall = body(&mut w, BodyKind::Fixed, [4., 0.], cube(0.5, 5.));
    assert_eq!(
        cast(&mut w, source, [0.; 3], [8., 2., 0.])
            .unwrap()
            .target
            .body,
        support
    );
    let hit = w
        .sweep_planar_platformer(source, [0.; 3], [8., 2., 0.], u32::MAX, 0, Some(support))
        .unwrap()
        .0
        .unwrap();
    assert_eq!(hit.target.body, wall);
    close(hit.fraction, 3. / 8.);
}

#[test]
fn planar_platformer_offset_convex_fixtures_and_bounds_use_native_geometry() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
    );
    let mut capsule = ColliderDesc::new(Shape::Capsule {
        half_height: 0.75,
        radius: 0.25,
    });
    capsule.pose.position = [2., 0., 0.];
    capsule.pose.rotation = [
        0.,
        0.,
        std::f32::consts::FRAC_1_SQRT_2,
        std::f32::consts::FRAC_1_SQRT_2,
    ];
    w.add_collider(source, capsule).unwrap();
    let mut sensor = cube(50., 50.);
    sensor.sensor = true;
    w.add_collider(source, sensor).unwrap();
    let target = body(&mut w, BodyKind::Fixed, [4., 0.], cube(0.25, 4.));
    let before = w.body_state(source).unwrap();
    let hit = cast(&mut w, source, [0.5, 0., 0.], [4., 0., 0.]).unwrap();
    assert_eq!(hit.target.body, target);
    close(hit.fraction, 0.0625);
    let bounds = w.planar_platformer_bounds(source, [0.5, 0., 0.]).unwrap();
    for (a, b) in bounds.into_iter().zip([0.25, -0.25, 3.5, 0.25]) {
        close(a, b);
    }
    assert_eq!(
        w.planar_platformer_bounds(target, [0.; 3]).unwrap(),
        [3.75, -4., 4.25, 4.]
    );
    assert_eq!(w.body_state(source).unwrap(), before);
}

#[test]
fn planar_platformer_gap_and_equal_fraction_fixture_order_remain_exact() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.25, 0.25),
    );
    let mut upper = cube(0.25, 0.25);
    upper.pose.position = [0., -2., 0.];
    let target = body(&mut w, BodyKind::Fixed, [4., 0.], upper);
    let mut lower = cube(0.25, 0.25);
    lower.pose.position = [0., 2., 0.];
    w.add_collider(target, lower).unwrap();
    assert!(cast(&mut w, source, [0.; 3], [8., 0., 0.]).is_none());
    let first = w.add_collider(target, cube(0.25, 0.25)).unwrap();
    w.add_collider(target, cube(0.25, 0.25)).unwrap();
    w.add_collider(source, cube(0.25, 0.25)).unwrap();
    let expected = cast(&mut w, source, [0.; 3], [8., 0., 0.]).unwrap();
    assert_eq!(expected.target.collider, first);
    close(expected.fraction, 3.5 / 8.);
    for _ in 0..3 {
        assert_eq!(
            cast(&mut w, source, [0.; 3], [8., 0., 0.]),
            Some(expected.clone())
        );
    }
}

#[test]
fn planar_platformer_mutual_masks_sensor_disabled_and_span_filters_are_applied() {
    let mut w = world();
    let mut desc = cube(0.5, 0.5);
    desc.category = 2;
    desc.mask = 8;
    let source = body(&mut w, BodyKind::KinematicVelocity, [0., 0.], desc);
    let span = PlanarCollisionSpan {
        floor: 0,
        elevation: 0.,
        height: 1.,
    };
    w.set_planar_collision_span(source, Some(span)).unwrap();
    for excluded in 0..7 {
        let mut desc = cube(0.5, 0.5);
        desc.category = if excluded == 0 { 4 } else { 8 };
        desc.mask = if excluded == 1 { 0 } else { 2 };
        desc.sensor = excluded == 2;
        let target = body(&mut w, BodyKind::Fixed, [4., 0.], desc);
        if excluded == 3 {
            let id = w.collider_ids(target).unwrap().next().unwrap();
            w.backend
                .colliders
                .get_mut(native_collider(id))
                .unwrap()
                .set_enabled(false);
        }
        if excluded == 6 {
            let mut options = BodyOptions::from(&BodyDesc {
                kind: BodyKind::Fixed,
                ..Default::default()
            });
            options.enabled = false;
            w.set_body_options(target, &options).unwrap();
        }
        w.set_planar_collision_span(
            target,
            Some(PlanarCollisionSpan {
                floor: u32::from(excluded == 4),
                elevation: if excluded == 5 { 2. } else { 0. },
                height: 1.,
            }),
        )
        .unwrap();
    }
    assert!(cast(&mut w, source, [0.; 3], [8., 0., 0.]).is_none());
    let mut desc = cube(0.5, 0.5);
    desc.category = 8;
    desc.mask = 2;
    let target = body(&mut w, BodyKind::Fixed, [4., 0.], desc);
    w.set_planar_collision_span(target, Some(span)).unwrap();
    assert_eq!(
        cast(&mut w, source, [0.; 3], [8., 0., 0.])
            .unwrap()
            .target
            .body,
        target
    );
    assert!(w
        .sweep_planar_platformer(source, [0.; 3], [8., 0., 0.], 4, 0, None)
        .unwrap()
        .0
        .is_none());
}

#[test]
fn planar_platformer_rejects_bad_space_source_offsets_and_stale_exclusion() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.5, 0.5),
    );
    for (offset, motion) in [
        ([f32::NAN, 0., 0.], [1., 0., 0.]),
        ([0., 0., 1.], [1., 0., 0.]),
        ([0.; 3], [1., 0., 1.]),
        ([0.; 3], [f32::INFINITY, 0., 0.]),
    ] {
        assert_eq!(
            w.sweep_planar_platformer(source, offset, motion, u32::MAX, 0, None),
            Err(PhysicsError::InvalidQuery)
        );
    }
    assert_eq!(
        w.probe_planar_platformer_ground(source, [0.; 3], -1., u32::MAX, 0, None),
        Err(PhysicsError::InvalidQuery)
    );
    assert!(w
        .probe_planar_platformer_ground(source, [0.; 3], 0., u32::MAX, 0, None)
        .unwrap()
        .0
        .is_none());
    let stale = body(&mut w, BodyKind::Fixed, [4., 0.], cube(0.5, 0.5));
    w.remove_body(stale).unwrap();
    assert_eq!(
        w.sweep_planar_platformer(source, [0.; 3], [1., 0., 0.], u32::MAX, 0, Some(stale)),
        Err(PhysicsError::StaleBody)
    );
    let fixed = body(&mut w, BodyKind::Fixed, [5., 0.], cube(0.5, 0.5));
    assert_eq!(
        w.sweep_planar_platformer(fixed, [0.; 3], [1., 0., 0.], u32::MAX, 0, None),
        Err(PhysicsError::WrongBodyKind)
    );
    let empty = w
        .create_body_without_collider(BodyDesc {
            kind: BodyKind::KinematicVelocity,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        w.sweep_planar_platformer(empty, [0.; 3], [1., 0., 0.], u32::MAX, 0, None),
        Err(PhysicsError::UnsupportedShape)
    );
    assert_eq!(
        w.planar_platformer_bounds(empty, [0.; 3]),
        Err(PhysicsError::UnsupportedShape)
    );
    let mut spatial = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    assert_eq!(
        spatial.sweep_planar_platformer(source, [0.; 3], [1., 0., 0.], u32::MAX, 0, None),
        Err(PhysicsError::InvalidQuery)
    );
}

#[test]
fn planar_platformer_default_floor_keeps_small_diagonal_steps_and_horizontal_slides_exact() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        length_unit: 100.,
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    let mut player_desc = cube(14., 18.);
    player_desc.category = 1;
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [96., 574.],
        player_desc,
    );
    let mut floor_desc = cube(600., 24.);
    floor_desc.category = 8;
    let floor = body(&mut w, BodyKind::Fixed, [600., 616.], floor_desc);
    let mut x = 96.;
    let mut y = 574.;
    for _ in 0..25 {
        w.set_pose(
            source,
            Pose {
                position: [x, y, 0.],
                ..Default::default()
            },
        )
        .unwrap();
        let (hit, _) = w
            .sweep_planar_platformer(source, [0.; 3], [2.1, 0.09, 0.], 10, 2, None)
            .unwrap();
        let hit = hit.unwrap();
        assert_eq!(hit.target.body, floor);
        assert_eq!(hit.fraction, 0.);
        assert_eq!(hit.normal, [0., -1., 0.]);
        assert_eq!(hit.point[1], 592.);
        y += 0.09 * hit.fraction;
        assert!(w
            .sweep_planar_platformer(source, [0.; 3], [2.1, 0., 0.], 10, 2, None)
            .unwrap()
            .0
            .is_none());
        x += 2.1;
        assert_eq!(y, 574.);
    }
    close(x, 148.5);
    // Deep initial overlap is still a hit instead of a silent tangent departure.
    assert!(w
        .sweep_planar_platformer(source, [0., 0.09, 0.], [2.1, 0., 0.], 10, 2, None)
        .unwrap()
        .0
        .is_some());
}

#[test]
fn planar_platformer_real_small_and_large_box_rotations_keep_exact_convex_casts() {
    for angle in [0.001_f32, 0.2, std::f32::consts::FRAC_PI_4] {
        let mut w = world();
        let source = body(&mut w, BodyKind::KinematicVelocity, [0., 0.], cube(2., 0.1));
        w.set_planar_rotation(source, f64::from(angle)).unwrap();
        let floor = body(&mut w, BodyKind::Fixed, [0., 1.], cube(0.01, 0.1));
        let bounds = w.planar_platformer_bounds(source, [0.; 3]).unwrap();
        let aabb_fraction = ((0.9 - bounds[3]) / 2.).max(0.);
        let source_id = w.collider_ids(source).unwrap().next().unwrap();
        let target_id = w.collider_ids(floor).unwrap().next().unwrap();
        let reference = {
            let a = &w.backend.colliders[native_collider(source_id)];
            let b = &w.backend.colliders[native_collider(target_id)];
            rapier3d::parry::query::cast_shapes(
                b.position(),
                rp::Vector::ZERO,
                b.shape(),
                a.position(),
                rp::Vector::from([0., 2., 0.]),
                a.shape(),
                rapier3d::parry::query::ShapeCastOptions {
                    max_time_of_impact: 1.,
                    target_distance: 0.,
                    stop_at_penetration: true,
                    compute_impact_geometry_on_penetration: true,
                },
            )
            .unwrap()
            .unwrap()
            .time_of_impact
        };
        let hit = cast(&mut w, source, [0.; 3], [0., 2., 0.]).unwrap();
        assert_eq!(hit.fraction.to_bits(), reference.to_bits());
        let expected = (0.9 - (0.01 * angle.tan() + 0.1 / angle.cos())) / 2.;
        assert_eq!(hit.target.body, floor);
        assert!(
            (hit.fraction - expected).abs() < 0.0001,
            "angle={angle} actual={} expected={expected}",
            hit.fraction
        );
        assert!(
            hit.fraction > aabb_fraction + 0.0001,
            "real rotation must not use an enclosing AABB: angle={angle}"
        );
    }
}

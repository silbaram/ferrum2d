use super::*;
use crate::physics3d::{BodyDesc, BodyKind, BodyOptions, ColliderDesc, Space, WorldConfig};

fn world() -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap()
}

fn cube(x: f32, y: f32) -> ColliderDesc {
    ColliderDesc::new(Shape::Box {
        half_extents: [x, y, x.hypot(y) + 1.],
    })
}

fn body(w: &mut PhysicsWorld3d, kind: BodyKind, xy: [f32; 2], shape: ColliderDesc) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: Pose {
                position: [xy[0], xy[1], 0.],
                ..Default::default()
            },
            ..Default::default()
        },
        shape,
    )
    .unwrap()
}

fn close(a: f32, b: f32) {
    assert!((a - b).abs() < 0.001, "actual={a}, expected={b}");
}

#[test]
fn planar_target_fast_cast_uses_selected_body_and_preserves_state() {
    let mut w = world();
    let source = body(&mut w, BodyKind::KinematicVelocity, [0., 0.], cube(1., 1.));
    let selected = body(&mut w, BodyKind::Fixed, [50., 0.], cube(5., 5.));
    body(&mut w, BodyKind::Fixed, [10., 0.], cube(5., 5.));
    w.set_velocity(source, [100., 0., 0.], [0., 0., 2.])
        .unwrap();
    w.set_planar_rotation(source, 4. * std::f64::consts::PI)
        .unwrap();
    let dynamic = body(&mut w, BodyKind::Dynamic, [100., 100.], cube(0.5, 0.5));
    w.add_force(dynamic, [3., 4., 0.], [0., 0., 1.]).unwrap();
    w.refresh_queries();
    let before = w.capture_snapshot().unwrap();
    let hit = w
        .sweep_planar_body_against(source, selected, [100., 0., 0.])
        .unwrap()
        .unwrap();
    assert_eq!(hit.target.body, selected);
    close(hit.fraction, 0.44);
    close(hit.normal[0], -1.);
    close(hit.normal[1], 0.);
    close(hit.point[0], 45.);
    assert!(!hit.initial_overlap);
    assert_eq!(
        w.sweep_planar_body_against(source, selected, [100., 0., 0.])
            .unwrap(),
        Some(hit)
    );
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn planar_target_rotated_offset_secondary_source_fixture_is_exact() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
    );
    let mut extra = ColliderDesc::new(Shape::Capsule {
        half_height: 0.75,
        radius: 0.25,
    });
    extra.pose.position = [2., 0., 0.];
    extra.pose.rotation = [
        0.,
        0.,
        std::f32::consts::FRAC_1_SQRT_2,
        std::f32::consts::FRAC_1_SQRT_2,
    ];
    w.add_collider(source, extra).unwrap();
    let target = body(&mut w, BodyKind::Fixed, [4., 0.], cube(0.25, 4.));
    let hit = w
        .sweep_planar_body_against(source, target, [4., 0., 0.])
        .unwrap()
        .unwrap();
    close(hit.fraction, 0.1875);
    close(hit.normal[0], -1.);
    close(hit.point[0], 3.75);
}

#[test]
fn planar_target_compound_target_gap_and_secondary_target_are_not_bounds_casts() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.25, 0.25),
    );
    let mut upper = cube(0.25, 0.25);
    upper.pose.position = [0., 1., 0.];
    let target = body(&mut w, BodyKind::Fixed, [4., 0.], upper);
    let mut lower = cube(0.25, 0.25);
    lower.pose.position = [0., -1., 0.];
    w.add_collider(target, lower).unwrap();
    assert!(w
        .sweep_planar_body_against(source, target, [8., 0., 0.])
        .unwrap()
        .is_none());
    let mut center = cube(0.25, 0.25);
    center.pose.position = [-1., 0., 0.];
    let center_id = w.add_collider(target, center).unwrap();
    let hit = w
        .sweep_planar_body_against(source, target, [8., 0., 0.])
        .unwrap()
        .unwrap();
    close(hit.fraction, 2.5 / 8.);
    assert_eq!(hit.target.collider, center_id);
}

#[test]
fn planar_target_mutual_masks_disabled_sensors_and_spans_filter_each_pair() {
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
    for excluded in 0..6 {
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
        w.set_planar_collision_span(
            target,
            Some(PlanarCollisionSpan {
                floor: u32::from(excluded == 4),
                elevation: if excluded == 5 { 2. } else { 0. },
                height: 1.,
            }),
        )
        .unwrap();
        assert!(
            w.sweep_planar_body_against(source, target, [8., 0., 0.])
                .unwrap()
                .is_none(),
            "excluded={excluded}"
        );
    }
    let mut desc = cube(0.5, 0.5);
    desc.category = 8;
    desc.mask = 2;
    let target = body(&mut w, BodyKind::Fixed, [4., 0.], desc);
    w.set_planar_collision_span(target, Some(span)).unwrap();
    assert!(w
        .sweep_planar_body_against(source, target, [8., 0., 0.])
        .unwrap()
        .is_some());
    let mut sensor_source = cube(10., 10.);
    sensor_source.sensor = true;
    w.add_collider(source, sensor_source).unwrap();
    close(
        w.sweep_planar_body_against(source, target, [8., 0., 0.])
            .unwrap()
            .unwrap()
            .fraction,
        3. / 8.,
    );
}

#[test]
fn planar_target_ties_are_stable_and_target_velocity_is_not_relative_motion() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.5, 0.5),
    );
    w.add_collider(source, cube(0.5, 0.5)).unwrap();
    let target = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [4., 0.],
        cube(0.5, 0.5),
    );
    let first = w.collider_ids(target).unwrap().next().unwrap();
    w.add_collider(target, cube(0.5, 0.5)).unwrap();
    w.set_velocity(target, [1000., 0., 0.], [0.; 3]).unwrap();
    let expected = w
        .sweep_planar_body_against(source, target, [8., 0., 0.])
        .unwrap()
        .unwrap();
    assert_eq!(expected.target.collider, first);
    close(expected.fraction, 3. / 8.);
    for _ in 0..3 {
        assert_eq!(
            w.sweep_planar_body_against(source, target, [8., 0., 0.])
                .unwrap(),
            Some(expected.clone())
        );
    }
}

#[test]
fn planar_target_stationary_and_moving_initial_overlap_return_zero() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.5, 0.5),
    );
    let target = body(&mut w, BodyKind::Fixed, [0.8, 0.], cube(0.5, 0.5));
    for motion in [[0.; 3], [3., 0., 0.], [-3., 0., 0.]] {
        let hit = w
            .sweep_planar_body_against(source, target, motion)
            .unwrap()
            .unwrap();
        close(hit.fraction, 0.);
        assert!(hit.initial_overlap);
        close(hit.normal[0], -1.);
        close(hit.normal[1], 0.);
    }
    w.set_pose(
        target,
        Pose {
            position: [4., 0., 0.],
            ..Default::default()
        },
    )
    .unwrap();
    assert!(w
        .sweep_planar_body_against(source, target, [0.; 3])
        .unwrap()
        .is_none());
    assert!(w
        .sweep_planar_body_against(source, source, [1., 0., 0.])
        .unwrap()
        .is_none());
}

#[test]
fn planar_target_touching_surface_allows_departure_and_stops_inward_motion() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.5, 0.5),
    );
    let target = body(&mut w, BodyKind::Fixed, [1., 0.], cube(0.5, 0.5));
    assert!(w
        .sweep_planar_body_against(source, target, [-2., 0., 0.])
        .unwrap()
        .is_none());
    let inward = w
        .sweep_planar_body_against(source, target, [2., 0., 0.])
        .unwrap()
        .unwrap();
    close(inward.fraction, 0.);
    close(inward.normal[0], -1.);
}

#[test]
fn planar_target_invalid_id_kind_space_and_motion_reject_without_success() {
    let mut w = world();
    let source = body(
        &mut w,
        BodyKind::KinematicVelocity,
        [0., 0.],
        cube(0.5, 0.5),
    );
    let target = body(&mut w, BodyKind::Fixed, [4., 0.], cube(0.5, 0.5));
    for motion in [[f32::NAN, 0., 0.], [1., 0., 1.], [1e7, 0., 0.]] {
        assert_eq!(
            w.sweep_planar_body_against(source, target, motion),
            Err(PhysicsError::InvalidQuery)
        );
    }
    assert_eq!(
        w.sweep_planar_body_against(target, source, [1., 0., 0.]),
        Err(PhysicsError::WrongBodyKind)
    );
    let mut options = BodyOptions::from(&BodyDesc {
        kind: BodyKind::KinematicVelocity,
        ..Default::default()
    });
    options.enabled = false;
    w.set_body_options(source, &options).unwrap();
    assert_eq!(
        w.sweep_planar_body_against(source, target, [1., 0., 0.]),
        Err(PhysicsError::WrongBodyKind)
    );
    options.enabled = true;
    w.set_body_options(source, &options).unwrap();
    w.remove_body(target).unwrap();
    assert_eq!(
        w.sweep_planar_body_against(source, target, [1., 0., 0.]),
        Err(PhysicsError::StaleBody)
    );
    w.remove_body(source).unwrap();
    assert_eq!(
        w.sweep_planar_body_against(source, source, [1., 0., 0.]),
        Err(PhysicsError::StaleBody)
    );
    let mut spatial = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    assert_eq!(
        spatial.sweep_planar_body_against(source, target, [1., 0., 0.]),
        Err(PhysicsError::InvalidQuery)
    );
}

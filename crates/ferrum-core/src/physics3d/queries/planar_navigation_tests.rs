use super::*;
use crate::physics3d::{BodyDesc, BodyKind, BodyOptions, ColliderDesc, WorldConfig};

fn world() -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space: crate::physics3d::Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap()
}

fn body(
    world: &mut PhysicsWorld3d,
    kind: BodyKind,
    position: [f32; 3],
    collider: ColliderDesc,
) -> BodyId {
    world
        .create_body(
            BodyDesc {
                kind,
                pose: Pose {
                    position,
                    ..Default::default()
                },
                ..Default::default()
            },
            collider,
        )
        .unwrap()
}

fn cube(x: f32, y: f32) -> ColliderDesc {
    ColliderDesc::new(Shape::Box {
        half_extents: [x, y, 0.5],
    })
}

fn cast(world: &mut PhysicsWorld3d, source: BodyId, motion: [f32; 3]) -> Option<SweepHit> {
    world
        .sweep_planar_navigation_body(source, motion, u32::MAX)
        .unwrap()
        .0
}

fn close(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() < 0.001,
        "actual={actual}, expected={expected}"
    );
}

fn recovery_box(x: f32, y: f32) -> ColliderDesc {
    ColliderDesc::new(Shape::Box {
        half_extents: [x, y, x.hypot(y) + 1.],
    })
}

#[test]
fn planar_controller_recovery_stationary_actor_inside_wall_is_planned_without_mutation() {
    let mut world = world();
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [20., 16., 0.],
        recovery_box(18., 18.),
    );
    body(
        &mut world,
        BodyKind::Fixed,
        [16., 16., 0.],
        recovery_box(16., 16.),
    );
    world
        .set_velocity(source, [3., 2., 0.], [0., 0., 1.])
        .unwrap();
    world
        .set_planar_rotation(source, 4. * std::f64::consts::PI)
        .unwrap();
    let before = world.body_state(source).unwrap();
    let angle = world.planar_rotation(source).unwrap();
    let stats = world.step_statistics();
    let (offset, candidates) = world
        .planar_navigation_recovery_translation(source, u32::MAX)
        .unwrap();
    close(offset[0], 30.);
    close(offset[1], 0.);
    assert_eq!(offset[2], 0.);
    assert!(candidates > 0);
    assert!(
        world
            .planar_navigation_destination_is_clear(source, offset, None, u32::MAX)
            .unwrap()
            .0
    );
    assert_eq!(world.body_state(source).unwrap(), before);
    assert_eq!(world.planar_rotation(source).unwrap(), angle);
    assert_eq!(world.step_statistics(), stats);
    assert_eq!(
        world
            .planar_navigation_recovery_translation(source, u32::MAX)
            .unwrap(),
        (offset, candidates)
    );
}

#[test]
fn planar_controller_recovery_uses_rotated_offset_secondary_fixture() {
    let mut world = world();
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
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
    world.add_collider(source, capsule).unwrap();
    body(
        &mut world,
        BodyKind::Fixed,
        [2.8, 0., 0.],
        recovery_box(0.25, 4.),
    );
    let (offset, _) = world
        .planar_navigation_recovery_translation(source, u32::MAX)
        .unwrap();
    close(offset[0], -0.45);
    close(offset[1], 0.);
    assert!(
        world
            .planar_navigation_destination_is_clear(source, offset, None, u32::MAX)
            .unwrap()
            .0
    );
}

#[test]
fn planar_controller_recovery_filters_masks_sensors_disabled_and_height() {
    let mut world = world();
    let mut desc = recovery_box(0.5, 0.5);
    desc.category = 2;
    desc.mask = 8;
    let source = body(&mut world, BodyKind::KinematicVelocity, [0.; 3], desc);
    let span = PlanarCollisionSpan {
        floor: 0,
        elevation: 0.,
        height: 1.,
    };
    world.set_planar_collision_span(source, Some(span)).unwrap();
    for kind in 0..6 {
        let mut desc = recovery_box(0.5, 0.5);
        desc.category = if kind == 0 { 4 } else { 8 };
        desc.mask = if kind == 1 { 0 } else { 2 };
        desc.sensor = kind == 2;
        let target = body(&mut world, BodyKind::Fixed, [0.6, 0., 0.], desc);
        if kind == 3 {
            world
                .set_body_options(
                    target,
                    &BodyOptions {
                        kind: BodyKind::Fixed,
                        enabled: false,
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        world
            .set_planar_collision_span(
                target,
                Some(PlanarCollisionSpan {
                    floor: if kind == 4 { 9 } else { 0 },
                    elevation: if kind == 5 { 5. } else { 0. },
                    ..span
                }),
            )
            .unwrap();
    }
    assert_eq!(
        world
            .planar_navigation_recovery_translation(source, u32::MAX)
            .unwrap()
            .0,
        [0.; 3]
    );
    let mut desc = recovery_box(0.5, 0.5);
    desc.category = 8;
    desc.mask = 2;
    body(&mut world, BodyKind::Fixed, [0.6, 0., 0.], desc);
    assert_eq!(
        world
            .planar_navigation_recovery_translation(source, 4)
            .unwrap()
            .0,
        [0.; 3]
    );
    close(
        world
            .planar_navigation_recovery_translation(source, 8)
            .unwrap()
            .0[0],
        -0.4,
    );
}

#[test]
fn planar_controller_recovery_checks_every_fixture_and_preserves_compound_gap() {
    let mut world = world();
    let mut first = recovery_box(0.25, 0.25);
    first.pose.position = [0., 2., 0.];
    let source = body(&mut world, BodyKind::KinematicVelocity, [0.; 3], first);
    let mut second = recovery_box(0.25, 0.25);
    second.pose.position = [0., -2., 0.];
    world.add_collider(source, second).unwrap();
    body(&mut world, BodyKind::Fixed, [0.; 3], recovery_box(0.5, 0.5));
    let mut sensor = recovery_box(1., 1.);
    sensor.sensor = true;
    world.add_collider(source, sensor).unwrap();
    assert_eq!(
        world
            .planar_navigation_recovery_translation(source, u32::MAX)
            .unwrap()
            .0,
        [0.; 3]
    );
}

#[test]
fn planar_controller_recovery_rejects_over_budget_plan_without_partial_motion() {
    let mut world = world();
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        recovery_box(1., 0.5),
    );
    for x in (-1..=17).step_by(2) {
        body(
            &mut world,
            BodyKind::Fixed,
            [x as f32, 0., 0.],
            recovery_box(1., 100.),
        );
    }
    let before = world.body_state(source).unwrap();
    assert_eq!(
        world.planar_navigation_recovery_translation(source, u32::MAX),
        Err(PhysicsError::InvalidQuery)
    );
    assert_eq!(world.body_state(source).unwrap(), before);
    assert_eq!(
        world.planar_navigation_recovery_translation(source, u32::MAX),
        Err(PhysicsError::InvalidQuery)
    );
}

#[test]
fn planar_controller_geometry_circle_uses_round_source_instead_of_its_bounds() {
    let mut world = world();
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
    );
    let target = body(
        &mut world,
        BodyKind::Fixed,
        [2., 0.8, 0.],
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
    );
    let hit = cast(&mut world, source, [4., 0., 0.]).unwrap();
    assert_eq!(hit.target.body, target);
    close(hit.fraction, 0.35);
    assert!(hit.normal[0] < -0.5 && hit.normal[1] < -0.7);
}

#[test]
fn planar_controller_geometry_rotated_offset_capsule_uses_native_pose() {
    let mut world = world();
    let mut capsule = ColliderDesc::new(Shape::Capsule {
        half_height: 0.75,
        radius: 0.25,
    });
    capsule.pose.position = [0.5, 0., 0.];
    capsule.pose.rotation = [
        0.,
        0.,
        std::f32::consts::FRAC_1_SQRT_2,
        std::f32::consts::FRAC_1_SQRT_2,
    ];
    let source = body(&mut world, BodyKind::KinematicVelocity, [0.; 3], capsule);
    body(&mut world, BodyKind::Fixed, [3., 0., 0.], cube(0.25, 4.));
    close(
        cast(&mut world, source, [4., 0., 0.]).unwrap().fraction,
        0.3125,
    );
}

#[test]
fn planar_controller_geometry_rotated_box_does_not_use_unrotated_extents() {
    let mut world = world();
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        cube(1., 0.25),
    );
    world
        .set_planar_rotation(source, std::f64::consts::FRAC_PI_2)
        .unwrap();
    body(&mut world, BodyKind::Fixed, [3., 0., 0.], cube(0.25, 4.));
    close(
        cast(&mut world, source, [4., 0., 0.]).unwrap().fraction,
        0.625,
    );
}

#[test]
fn planar_controller_geometry_convex_polygon_uses_its_sides() {
    let mut world = world();
    let mut points = Vec::new();
    for z in [-0.25, 0.25] {
        for [x, y] in [[0.5, 0.], [0., 0.5], [-0.5, 0.], [0., -0.5]] {
            points.push([x, y, z]);
        }
    }
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        ColliderDesc::new(Shape::ConvexHull { points }),
    );
    body(
        &mut world,
        BodyKind::Fixed,
        [2., 0.8, 0.],
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
    );
    close(
        cast(&mut world, source, [4., 0., 0.]).unwrap().fraction,
        (2. - (0.5 + std::f32::consts::FRAC_1_SQRT_2 - 0.8)) / 4.,
    );
}

#[test]
fn planar_controller_geometry_secondary_fixture_determines_first_collision() {
    let mut world = world();
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
    );
    let mut second = cube(0.25, 0.25);
    second.pose.position = [2., 0., 0.];
    world.add_collider(source, second).unwrap();
    body(&mut world, BodyKind::Fixed, [4., 0., 0.], cube(0.25, 4.));
    close(
        cast(&mut world, source, [4., 0., 0.]).unwrap().fraction,
        0.375,
    );
}

#[test]
fn planar_controller_geometry_compound_gap_is_not_filled_by_body_bounds() {
    let mut world = world();
    let mut first = cube(0.25, 0.25);
    first.pose.position = [0., 2., 0.];
    let source = body(&mut world, BodyKind::KinematicVelocity, [0.; 3], first);
    let mut second = cube(0.25, 0.25);
    second.pose.position = [0., -2., 0.];
    world.add_collider(source, second).unwrap();
    body(&mut world, BodyKind::Fixed, [2., 0., 0.], cube(0.5, 0.5));
    assert!(cast(&mut world, source, [4., 0., 0.]).is_none());
    assert!(
        world
            .planar_navigation_destination_is_clear(source, [2., 0., 0.], None, u32::MAX)
            .unwrap()
            .0
    );
}

#[test]
fn planar_controller_geometry_source_fixture_filtering_ignores_sensor_disabled_and_masked_parts() {
    let mut world = world();
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        cube(0.25, 0.25),
    );
    let mut sensor = cube(0.25, 0.25);
    sensor.sensor = true;
    sensor.pose.position = [4., 0., 0.];
    world.add_collider(source, sensor).unwrap();
    let mut disabled = cube(0.25, 0.25);
    disabled.pose.position = [3., 0., 0.];
    let disabled = world.add_collider(source, disabled).unwrap();
    world
        .backend
        .colliders
        .get_mut(native_collider(disabled))
        .unwrap()
        .set_enabled(false);
    let mut masked = cube(0.25, 0.25);
    masked.pose.position = [2., 0., 0.];
    masked.mask = 0;
    world.add_collider(source, masked).unwrap();
    body(&mut world, BodyKind::Fixed, [6., 0., 0.], cube(0.25, 4.));
    close(
        cast(&mut world, source, [8., 0., 0.]).unwrap().fraction,
        0.6875,
    );
}

#[test]
fn planar_controller_geometry_filters_targets_per_fixture_groups_and_height() {
    let mut world = world();
    let mut source_desc = cube(0.25, 0.25);
    source_desc.category = 2;
    source_desc.mask = 8;
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        source_desc,
    );
    let span = PlanarCollisionSpan {
        floor: 0,
        elevation: 0.,
        height: 1.,
    };
    world.set_planar_collision_span(source, Some(span)).unwrap();
    let mut real = None;
    for (x, kind) in [(1., 0), (2., 1), (3., 2), (4., 3), (5., 4), (7., 5)] {
        let mut desc = cube(0.25, 4.);
        desc.category = if kind == 0 { 4 } else { 8 };
        desc.mask = if kind == 1 { 0 } else { 2 };
        desc.sensor = kind == 2;
        let target = body(&mut world, BodyKind::Fixed, [x, 0., 0.], desc);
        if kind == 3 {
            world
                .set_body_options(
                    target,
                    &BodyOptions {
                        kind: BodyKind::Fixed,
                        enabled: false,
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        world
            .set_planar_collision_span(
                target,
                Some(PlanarCollisionSpan {
                    floor: if kind == 4 { 9 } else { 0 },
                    ..span
                }),
            )
            .unwrap();
        if kind == 5 {
            real = Some(target);
        }
    }
    let hit = cast(&mut world, source, [10., 0., 0.]).unwrap();
    assert_eq!(Some(hit.target.body), real);
    close(hit.fraction, 0.65);
    assert!(world
        .sweep_planar_navigation_body(source, [10., 0., 0.], 4)
        .unwrap()
        .0
        .is_none());
}

#[test]
fn planar_controller_geometry_ties_use_source_identity_after_handle_reuse() {
    let mut world = world();
    let mut left = cube(0.25, 0.25);
    left.pose.position = [0., 2., 0.];
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        left.clone(),
    );
    let old = world.collider_ids(source).unwrap().next().unwrap();
    let mut bottom = cube(0.25, 0.25);
    bottom.pose.position = [2., 0., 0.];
    let higher = world.add_collider(source, bottom).unwrap();
    world.remove_collider(old).unwrap();
    let lower = world.add_collider(source, left).unwrap();
    assert!(lower < higher);
    assert_eq!(world.collider_ids(source).unwrap().next().unwrap(), higher);
    body(&mut world, BodyKind::Fixed, [4., 4., 0.], cube(1., 1.));
    let hit = cast(&mut world, source, [4., 4., 0.]).unwrap();
    close(hit.fraction, 0.6875);
    assert!(
        hit.normal[0] < -0.9 && hit.normal[1].abs() < 0.01,
        "{hit:?}"
    );
}

#[test]
fn planar_controller_geometry_changed_span_checks_secondary_fixture_destination() {
    let mut world = world();
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        cube(0.25, 0.25),
    );
    let mut second = cube(0.25, 0.25);
    second.pose.position = [2., 0., 0.];
    world.add_collider(source, second).unwrap();
    let target = body(&mut world, BodyKind::Fixed, [4., 0., 0.], cube(0.25, 0.25));
    let old = PlanarCollisionSpan {
        floor: 0,
        elevation: 0.,
        height: 1.,
    };
    let next = PlanarCollisionSpan {
        floor: 1,
        elevation: 3.,
        height: 1.,
    };
    world.set_planar_collision_span(source, Some(old)).unwrap();
    world.set_planar_collision_span(target, Some(next)).unwrap();
    assert!(
        world
            .planar_navigation_destination_is_clear(source, [2., 0., 0.], Some(old), u32::MAX)
            .unwrap()
            .0
    );
    assert!(
        !world
            .planar_navigation_destination_is_clear(source, [2., 0., 0.], Some(next), u32::MAX)
            .unwrap()
            .0
    );
}

#[test]
fn planar_controller_geometry_rejects_empty_nonsolid_nonconvex_wrong_kind_and_bad_offset() {
    let mut world = world();
    let empty = world
        .create_body_without_collider(BodyDesc {
            kind: BodyKind::KinematicVelocity,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(
        world.validate_planar_controller_source(empty),
        Err(PhysicsError::UnsupportedShape)
    );
    let mut sensor = cube(0.25, 0.25);
    sensor.sensor = true;
    let source = body(&mut world, BodyKind::KinematicVelocity, [0.; 3], sensor);
    assert_eq!(
        world.sweep_planar_navigation_body(source, [0.; 3], u32::MAX),
        Err(PhysicsError::UnsupportedShape)
    );
    let mesh = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        ColliderDesc::new(Shape::TriangleMesh {
            vertices: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]],
            triangles: vec![[0, 1, 2]],
        }),
    );
    assert_eq!(
        world.validate_planar_controller_source(mesh),
        Err(PhysicsError::UnsupportedShape)
    );
    let fixed = body(&mut world, BodyKind::Fixed, [10., 0., 0.], cube(0.25, 0.25));
    assert_eq!(
        world.validate_planar_controller_source(fixed),
        Err(PhysicsError::WrongBodyKind)
    );
    let solid = world.add_collider(source, cube(0.25, 0.25)).unwrap();
    world
        .backend
        .colliders
        .get_mut(native_collider(solid))
        .unwrap()
        .set_enabled(false);
    assert_eq!(
        world.validate_planar_controller_source(source),
        Err(PhysicsError::UnsupportedShape)
    );
    assert_eq!(
        world.planar_navigation_destination_is_clear(source, [0., 0., 1.], None, u32::MAX),
        Err(PhysicsError::InvalidQuery)
    );
}

#[test]
fn planar_controller_geometry_queries_preserve_clock_pose_velocity_angle_and_other_pending_input() {
    let mut world = world();
    let source = body(
        &mut world,
        BodyKind::KinematicVelocity,
        [0.; 3],
        ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
    );
    world
        .set_velocity(source, [3., 2., 0.], [0., 0., 1.])
        .unwrap();
    world
        .set_planar_rotation(source, 4. * std::f64::consts::PI)
        .unwrap();
    let state = world.body_state(source).unwrap();
    let angle = world.planar_rotation(source).unwrap();
    let stats = world.step_statistics();
    let moving = body(
        &mut world,
        BodyKind::KinematicPosition,
        [20., 0., 0.],
        cube(0.25, 0.25),
    );
    world
        .set_kinematic_target(
            moving,
            Pose {
                position: [20., 1., 0.],
                ..Default::default()
            },
        )
        .unwrap();
    let dynamic = body(&mut world, BodyKind::Dynamic, [40., 0., 0.], cube(0.5, 0.5));
    world.add_force(dynamic, [10., 0., 0.], [0.; 3]).unwrap();
    for _ in 0..3 {
        assert!(cast(&mut world, source, [1., 0., 0.]).is_none());
        assert!(
            world
                .planar_navigation_destination_is_clear(source, [1., 0., 0.], None, u32::MAX)
                .unwrap()
                .0
        );
        assert_eq!(world.body_state(source).unwrap(), state);
        assert_eq!(world.planar_rotation(source).unwrap(), angle);
        assert_eq!(world.step_statistics(), stats);
        assert_eq!(world.body_state(dynamic).unwrap().linear_velocity, [0.; 3]);
        assert_eq!(
            world.body_state(moving).unwrap().pose.position,
            [20., 0., 0.]
        );
    }
    world.step();
    assert!(world.body_state(dynamic).unwrap().linear_velocity[0] > 0.09);
    close(world.body_state(moving).unwrap().pose.position[1], 1.);
}

#![cfg(feature = "dim3")]
use super::*;
use crate::prelude::{ColliderBuilder, PhysicsWorld, RigidBodyBuilder};
use parry::shape::SharedShape;
fn rotation(axis: Vector, angle: Real) -> crate::math::Rotation {
    crate::math::Rotation::from_scaled_axis(axis * angle)
}
fn shapes() -> Vec<SharedShape> {
    vec![
        SharedShape::cuboid(2.0, 0.025, 0.1),
        SharedShape::ball(0.2),
        SharedShape::capsule_y(1.5, 0.05),
        SharedShape::compound(vec![
            (
                Pose::from_translation(Vector::new(2.0, -1.0, 0.5)),
                SharedShape::ball(0.15),
            ),
            (
                Pose::from_parts(Vector::new(-0.5, 1.0, 0.0), rotation(Vector::Z, 0.3)),
                SharedShape::cuboid(1.0, 0.04, 0.1),
            ),
        ]),
    ]
}
fn contains_aabb(bounds: Aabb, other: Aabb) -> bool {
    (0..3).all(|i| bounds.mins[i] <= other.mins[i] && bounds.maxs[i] >= other.maxs[i])
}
#[test]
fn angular_bounds_zero_rotation_keeps_original_linear_aabb_bits() {
    for shape in shapes() {
        for offset in [Vector::ZERO, Vector::new(8.0, -3.0, 1.0)] {
            let start = Pose::from_parts(Vector::new(2.0, 7.0, -4.0), rotation(Vector::Y, 0.4));
            let end = Pose::from_parts(Vector::new(9.0, -2.0, 8.0), start.rotation);
            let old = shape.compute_aabb(&start).merged(&shape.compute_aabb(&end));
            let actual = rotational_swept_aabb(shape.as_ref(), &start, &end, offset, 0.0);
            for (a, b) in actual
                .mins
                .to_array()
                .into_iter()
                .chain(actual.maxs.to_array())
                .zip(old.mins.to_array().into_iter().chain(old.maxs.to_array()))
            {
                assert_eq!(a.to_bits(), b.to_bits());
            }
        }
    }
}
#[test]
fn angular_bounds_cover_actual_nlerp_and_constant_angular_models_with_offsets_and_winding() {
    for shape in shapes() {
        for axis in [Vector::Z, Vector::new(1.0, 2.0, -3.0).normalize()] {
            for angle in [
                1.0e-5,
                0.03,
                0.4,
                core::f32::consts::FRAC_PI_4,
                3.13,
                core::f32::consts::PI,
                core::f32::consts::TAU,
                10.0 * core::f32::consts::TAU,
            ] {
                for direction in [-1.0, 1.0] {
                    let signed = angle * direction;
                    let start =
                        Pose::from_parts(Vector::new(1.0, -2.0, 3.0), rotation(Vector::Y, 0.31));
                    let pivot = Vector::new(4.0, -3.0, 2.0);
                    let translation = Vector::new(0.7, -0.3, 0.2);
                    let motion =
                        NonlinearRigidMotion::new(start, pivot, translation, axis * signed);
                    let end = motion.position_at_time(1.0);
                    let bounds =
                        rotational_swept_aabb(shape.as_ref(), &start, &end, pivot, angle as f64);
                    let sweep = Sweep::from_poses(&start, &end, pivot);
                    for i in 0..=256 {
                        let t = i as Real / 256.0;
                        for at in [sweep.transform_at(t), motion.position_at_time(t)] {
                            let sample = shape.compute_aabb(&at);
                            assert!(
                                contains_aabb(bounds, sample),
                                "angle={signed} t={t} bounds={bounds:?} sample={sample:?}"
                            );
                        }
                    }
                }
            }
        }
    }
}
#[test]
fn angular_bounds_nlerp_timing_stays_conservative_with_large_com_translation() {
    let shape = SharedShape::cuboid(4.0, 0.01, 0.02);
    let pivot = Vector::new(-9.0, 2.0, 4.0);
    let start = Pose::identity();
    let motion = NonlinearRigidMotion::new(
        start,
        pivot,
        Vector::new(10_000.0, -5000.0, 7000.0),
        Vector::Z * 3.13,
    );
    let end = motion.position_at_time(1.0);
    let bounds = rotational_swept_aabb(shape.as_ref(), &start, &end, pivot, 3.13);
    let sweep = Sweep::from_poses(&start, &end, pivot);
    for i in 0..=4096 {
        assert!(contains_aabb(
            bounds,
            shape.compute_aabb(&sweep.transform_at(i as Real / 4096.0))
        ));
    }
}
#[test]
fn angular_bounds_phase_uses_current_prediction_and_accepted_velocity_without_stale_max() {
    let mut body = RigidBodyBuilder::dynamic().angvel(Vector::Z * 2.0).build();
    body.ccd_vels.angvel = Vector::Z * 900.0;
    let dt = 0.1;
    assert_eq!(
        MotionSource::Predicted.angular_distance(&body, dt),
        2.0f64 * dt as f64
    );
    body.vels.angvel = Vector::ZERO;
    assert_eq!(MotionSource::Predicted.angular_distance(&body, dt), 0.0);
    body.vels.angvel = Vector::Z * 900.0;
    body.ccd_vels.angvel = Vector::ZERO;
    assert_eq!(MotionSource::Solved.angular_distance(&body, dt), 0.0);
}
fn independent_world(limit: usize) -> PhysicsWorld {
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    world.integration_parameters.dt = 0.1;
    world.integration_parameters.max_ccd_substeps = 1;
    world.ccd_solver.set_diagnostic_limit(limit);
    let body = world.bodies.insert(
        RigidBodyBuilder::dynamic()
            .rotation(Vector::Z * -core::f32::consts::FRAC_PI_8)
            .angvel(Vector::Z * (core::f32::consts::FRAC_PI_4 / 0.1))
            .ccd_enabled(true)
            .can_sleep(false),
    );
    world.colliders.insert_with_parent(
        ColliderBuilder::cuboid(2.0, 0.025, 0.1),
        body,
        &mut world.bodies,
    );
    let fixed = world
        .bodies
        .insert(RigidBodyBuilder::fixed().translation(Vector::X * 1.99));
    world
        .colliders
        .insert_with_parent(ColliderBuilder::ball(0.015), fixed, &mut world.bodies);
    world.step();
    world
}
#[test]
fn angular_bounds_independent_vendor_consumer_clamps_mid_tip_and_one_below_observation_limit() {
    let a = independent_world(1);
    let b = independent_world(0);
    assert_eq!(a.ccd_solver.diagnostics().clamped_bodies, 1);
    assert_eq!(b.ccd_solver.diagnostics().clamped_bodies, 1);
    assert_eq!(a.ccd_solver.diagnostics().clamps.len(), 1);
    assert_eq!(b.ccd_solver.diagnostics().clamps.len(), 0);
    assert_eq!(b.ccd_solver.diagnostics().dropped, 1);
    for ((_, x), (_, y)) in a.bodies.iter().zip(b.bodies.iter()) {
        assert_eq!(x.position(), y.position());
        assert_eq!(x.linvel(), y.linvel());
        assert_eq!(x.angvel(), y.angvel());
    }
}
#[test]
fn angular_bounds_small_angle_long_offset_shape_does_not_use_full_pivot_cube() {
    let shape = SharedShape::cuboid(100.0, 0.02, 0.02);
    let start = Pose::identity();
    let pivot = Vector::new(-1000.0, 0.0, 0.0);
    for angle in [0.001, 0.01, 0.05] {
        let motion = NonlinearRigidMotion::new(start, pivot, Vector::ZERO, Vector::Z * angle);
        let end = motion.position_at_time(1.0);
        let old = shape.compute_aabb(&start).merged(&shape.compute_aabb(&end));
        let actual = rotational_swept_aabb(shape.as_ref(), &start, &end, pivot, angle as f64);
        let full =
            rotational_swept_aabb(shape.as_ref(), &start, &end, pivot, core::f64::consts::TAU);
        let volume = |a: Aabb| {
            let e = a.maxs - a.mins;
            e.x as f64 * e.y as f64 * e.z as f64
        };
        assert!(volume(actual) < volume(full) * 0.001);
        assert!(contains_aabb(actual, old));
        std::eprintln!(
            "ANGULAR_BOUND_COST angle={angle} old_volume={} new_volume={} full_pivot_volume={}",
            volume(old),
            volume(actual),
            volume(full)
        );
    }
}

#[test]
fn angular_bounds_fast_rotation_winding_uses_pivot_without_blessing_endpoint_narrowphase() {
    let mut body = RigidBodyBuilder::dynamic()
        .angvel(Vector::Z * (core::f32::consts::TAU / 0.1))
        .allow_fast_rotation(true)
        .build();
    body.ccd_vels.angvel = Vector::ZERO;
    let angle = MotionSource::Solved.angular_distance(&body, 0.1);
    assert!(angle.is_infinite());
    let shape = SharedShape::cuboid(2.0, 0.025, 0.1);
    let bounds = rotational_swept_aabb(
        shape.as_ref(),
        &Pose::identity(),
        &Pose::identity(),
        Vector::ZERO,
        angle,
    );
    let motion = NonlinearRigidMotion::new(
        Pose::identity(),
        Vector::ZERO,
        Vector::ZERO,
        Vector::Z * core::f32::consts::TAU,
    );
    for i in 0..=512 {
        assert!(contains_aabb(
            bounds,
            shape.compute_aabb(&motion.position_at_time(i as Real / 512.0))
        ));
    }
    body.vels.angvel = Vector::ZERO;
    assert_eq!(MotionSource::Solved.angular_distance(&body, 0.1), 0.0);
    assert_eq!(
        rotational_swept_aabb(
            shape.as_ref(),
            &Pose::identity(),
            &Pose::identity(),
            Vector::ZERO,
            0.0
        ),
        shape.compute_aabb(&Pose::identity())
    );
}

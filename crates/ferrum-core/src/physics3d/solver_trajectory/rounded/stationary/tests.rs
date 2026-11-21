use super::*;
use crate::physics3d::solver_trajectory::{
    cast_full_shapes_policy_coverage, certified_separation, leaf_contact, rounded, Curve, Domain,
    Kernel,
};

fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}

fn motion(curve: Curve) -> ShapeMotion {
    ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}

fn side_pair() -> (ShapeMotion, rp::Cuboid, ShapeMotion, rp::Capsule) {
    let wall = motion(Curve::Constant {
        pose: rp::Pose::from_translation(-rp::Vector::X),
        start_time: 0.,
        end_time: 1.,
    });
    let character = motion(Curve::Integrated(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::invalid(),
            Domain::new(0., 1.).unwrap(),
            1.,
            rp::Pose::from_translation(rp::Vector::new(-0.49, 0., 0.)),
            rp::Vector::ZERO,
            rp::Vector::ZERO,
        )
        .unwrap(),
    ));
    (
        wall,
        rp::Cuboid::new(rp::Vector::new(0.25, 2., 5.)),
        character,
        rp::Capsule::new(rp::Vector::Y * -0.25, rp::Vector::Y * 0.25, 0.25),
    )
}

#[test]
fn stationary_skin_reuses_the_selected_full_shape_bound() {
    let (a, sa, b, sb) = side_pair();
    let skin = 0.01;
    let left = leaf_contact(&a.pose(0.), &sa, &b.pose(0.), &sb, &mut work()).unwrap();
    let initial =
        rounded::initial_support_allowances(a, &sa, b, &sb, left.normal1, 0., &mut work()).unwrap();
    let selected = initial.noninward_stability;
    assert!(selected > 0. && selected < initial.geometry && selected < left.dist);
    assert!(left.dist <= skin);
    let mut separated = work();
    assert!(certified_separation(
        a,
        &sa,
        b,
        &sb,
        left.normal1,
        0.,
        1.,
        selected,
        &mut separated
    )
    .unwrap());
    let mut reused = work();
    assert!(retains_initial_band(a, &sa, b, &sb, 0., 1., &mut reused).unwrap());
    assert!(reused.used < separated.used);

    let result =
        cast_full_shapes_policy_coverage(a, &sa, b, &sb, 0., 1., skin, 1e-6, &mut work(), true)
            .unwrap();
    assert!(result.hit.is_none());
    assert!(!result.strictly_clear_start);
    let strict =
        cast_full_shapes_policy_coverage(a, &sa, b, &sb, 0., 1., skin, 1e-6, &mut work(), false)
            .unwrap();
    let hit = strict.hit.unwrap();
    assert_eq!((hit.safe_time, hit.hit_time), (0., 0.));
    assert_eq!(hit.contact.dist.to_bits(), left.dist.to_bits());
}

#[test]
fn stationary_band_requires_complete_original_clock_and_no_pose_change() {
    let (a, sa, b, sb) = side_pair();
    assert_eq!(
        retains_initial_band(a, &sa, b, &sb, 0., 1_f64.next_up(), &mut work()),
        Err(TrajectoryError::InvalidTime)
    );
    assert_eq!(
        retains_initial_band(a, &sa, b, &sb, 0_f64.next_down(), 1., &mut work()),
        Err(TrajectoryError::InvalidTime)
    );
    let moving = motion(Curve::Integrated(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::invalid(),
            Domain::new(0., 1.).unwrap(),
            1.,
            b.pose(0.),
            rp::Vector::X,
            rp::Vector::ZERO,
        )
        .unwrap(),
    ));
    assert!(!retains_initial_band(a, &sa, moving, &sb, 0., 1., &mut work()).unwrap());
    let zero_sign_change = motion(Curve::Integrated(
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::invalid(),
            Domain::new(0., 1.).unwrap(),
            1.,
            rp::Pose::from_translation(rp::Vector::new(-0.49, -0., 0.)),
            rp::Vector::ZERO,
            rp::Vector::ZERO,
        )
        .unwrap(),
    ));
    assert!(!retains_initial_band(a, &sa, zero_sign_change, &sb, 0., 1., &mut work()).unwrap());
}

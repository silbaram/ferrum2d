use super::*;
use crate::physics3d::solver_trajectory::{Domain, Kernel};

fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}

fn source(index: u32, role: Role, pose: rp::Pose, start: Time, end: Time) -> ColliderTrajectory {
    let body = rp::RigidBodyHandle::from_raw_parts(index, 0);
    ColliderTrajectory {
        collider: rp::ColliderHandle::from_raw_parts(index, 0),
        parent: Some(body),
        role,
        motion: ShapeMotion {
            curve: Curve::Integrated(
                Kernel::from_velocity_seconds(
                    body,
                    Domain::new(start, end).unwrap(),
                    0.1,
                    pose,
                    rp::Vector::ZERO,
                    rp::Vector::ZERO,
                )
                .unwrap(),
            ),
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        },
        bounds: Aabb::new(rp::Vector::ZERO, rp::Vector::ZERO),
        sensor: false,
    }
}

#[test]
fn original_stationary_skin_result_reuses_only_the_same_current_tick_geometry() {
    let wall = rp::Cuboid::new(rp::Vector::new(0.25, 2., 5.));
    let capsule = rp::Capsule::new(rp::Vector::Y * -0.25, rp::Vector::Y * 0.25, 0.25);
    let wall_pose = rp::Pose::from_translation(rp::Vector::new(-1., 0., 0.));
    let capsule_pose = rp::Pose::from_translation(rp::Vector::new(-0.49, 0., 0.));
    let actor = Role::Character(BodyId {
        slot: 1,
        generation: 0,
    });
    let a = source(0, Role::Fixed, wall_pose, 0., 1.);
    let b = source(1, actor, capsule_pose, 0., 1.);
    let skin = 0.01;
    let mut cache = BoundsCache::default();
    let layout = BoundsCache::layout(1 << 20, 2, cache.retained_bytes().unwrap()).unwrap();
    cache.prepare_epoch(layout, &mut work()).unwrap();
    assert!(cache.retained_bytes().unwrap() <= layout.reserved());
    let mem = cache.stationary().unwrap();
    let mut original = work();
    let cast = solver_trajectory::cast_full_shapes_policy_reusing(
        a.motion,
        &wall,
        b.motion,
        &capsule,
        0.,
        1.,
        skin,
        1e-6,
        &mut original,
        true,
        None,
    )
    .unwrap();
    assert!(cast.hit.is_none());
    assert!(!cast.strictly_clear_start);
    let old = mem
        .candidate(&a, &wall, &b, &capsule, 0., 1., skin, &mut work())
        .unwrap()
        .unwrap();
    assert!(old.reused.is_none());
    mem.remember(old, &cast, &mut work()).unwrap();

    let a = source(0, Role::Fixed, wall_pose, 2., 3.);
    let b = source(1, actor, capsule_pose, 2., 3.);
    let mut warm = work();
    let warm_cast = mem
        .candidate(&a, &wall, &b, &capsule, 2., 3., skin, &mut warm)
        .unwrap()
        .unwrap()
        .reused
        .unwrap();
    assert_eq!(warm_cast.strictly_clear_start, cast.strictly_clear_start);
    assert!(warm_cast.hit.is_none() && warm.used < original.used);
    assert!(mem
        .candidate(&a, &wall, &b, &capsule, 2., 3., skin.next_up(), &mut work())
        .unwrap()
        .unwrap()
        .reused
        .is_none());
    assert!(mem
        .candidate(
            &a,
            &wall,
            &b,
            &capsule,
            2.,
            3_f64.next_up(),
            skin,
            &mut work()
        )
        .unwrap()
        .is_none());
    let recycled = ColliderTrajectory {
        collider: rp::ColliderHandle::from_raw_parts(1, 1),
        ..b
    };
    assert!(mem
        .candidate(&a, &wall, &recycled, &capsule, 2., 3., skin, &mut work())
        .unwrap()
        .unwrap()
        .reused
        .is_none());
    let resized = rp::Capsule::new(capsule.segment.a, capsule.segment.b, 0.3);
    assert!(mem
        .candidate(&a, &wall, &b, &resized, 2., 3., skin, &mut work())
        .unwrap()
        .unwrap()
        .reused
        .is_none());
    cache.invalidate();
    assert!(cache.stationary().is_none());
    cache.prepare_epoch(layout, &mut work()).unwrap();
    assert!(cache
        .stationary()
        .unwrap()
        .candidate(&a, &wall, &b, &capsule, 2., 3., skin, &mut work())
        .unwrap()
        .unwrap()
        .reused
        .is_none());
}

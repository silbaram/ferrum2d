use super::*;
use crate::physics3d::{
    solver_trajectory::{Curve, Domain, Kernel, ShapeMotion},
    world::native_id,
    BodyDesc, BodyKind, ColliderDesc, PhysicsError, Pose, QueryFilter, Shape, WorldConfig,
};

const H: Time = 1. / 64.;
fn fixture() -> (PhysicsWorld3d, rp::RigidBodyHandle) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: H as f32,
        ..Default::default()
    })
    .unwrap();
    let body = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 1. / 128. }),
        )
        .unwrap();
    world.set_step_motion_enabled(true);
    world.begin_fixed_step().unwrap();
    (world, native_id(body))
}
fn constant() -> ShapeMotion {
    ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::IDENTITY,
            start_time: 0.,
            end_time: H,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn add_exact(
    world: &mut PhysicsWorld3d,
    body: rp::RigidBodyHandle,
    motion: ShapeMotion,
    from: Time,
    to: Time,
) {
    let start = &world.step_motion.starts[0];
    let mut row = target_motion(
        start,
        rp::Vector::ZERO,
        motion.curve.com_pose(from),
        motion.curve.com_pose(to),
        from / H,
        to / H,
    );
    row.exact = Some(exact::Segment {
        owner: body,
        motion,
        start_time: from,
        end_time: to,
    });
    world.step_motion.segments.push(row);
    world.step_motion.elapsed = to / H;
}
fn copy_capture(capture: &StepMotion) -> StepMotion {
    postcard::from_bytes(&postcard::to_allocvec(capture).unwrap()).unwrap()
}
fn work(used: u64, limit: u64) -> Work {
    Work { used, limit }
}

#[test]
fn saved_finish_borrows_the_actual_tick_ledger_without_resetting_or_changing_credit() {
    let (mut world, body) = fixture();
    world.force_character_motion_proof();
    add_exact(&mut world, body, constant(), 0., H);
    let mut shared = world.saved_motion_proof_work();
    shared.charge(37).unwrap();
    let limit = shared.limit;
    world.commit_saved_motion_proof_work(shared).unwrap();
    let bytes = crate::checkpoint_codec::encode(&world.backend.bodies).unwrap();
    let credit = world.actual_motion_completed_time();
    world.finish_fixed_step();
    let after = world.saved_motion_proof_work();
    assert!(after.used > 37);
    assert_eq!(after.limit, limit);
    assert_eq!(world.actual_motion_completed_time(), credit);
    assert_eq!(
        crate::checkpoint_codec::encode(&world.backend.bodies).unwrap(),
        bytes
    );
    assert!(world.step_motion.ready);
    let before = after.used;
    for invalid in [
        work(before - 1, limit),
        work(before, limit - 1),
        work(limit + 1, limit),
    ] {
        assert!(world.commit_saved_motion_proof_work(invalid).is_err());
        assert_eq!(world.saved_motion_proof_work().used, before);
    }
    world.end_backend_motion_tick();
    assert_eq!(world.saved_motion_proof_work().used, before);
    world.begin_backend_motion_tick();
    assert_eq!(world.saved_motion_proof_work().used, 0);
}

#[test]
fn exact_and_one_below_capture_work_preserve_partial_tree_failure_and_cold_bytes() {
    let (mut world, body) = fixture();
    add_exact(&mut world, body, constant(), 0., H * 0.5);
    add_exact(&mut world, body, constant(), H * 0.5, H);
    let original = copy_capture(&world.step_motion);
    let mut reference = copy_capture(&original);
    let mut ample = work(41, 32 * 1024 * 1024);
    reference.finish(&world.backend.colliders, &mut ample);
    assert!(reference.ready && !reference.exact_failed);
    let required = ample.used;
    let mut exact = copy_capture(&original);
    let mut exact_work = work(41, required);
    exact.finish(&world.backend.colliders, &mut exact_work);
    assert_eq!(exact_work.used, required);
    assert_eq!(
        postcard::to_allocvec(&exact).unwrap(),
        postcard::to_allocvec(&reference).unwrap()
    );
    let mut below = copy_capture(&original);
    let mut short = work(41, required - 1);
    below.finish(&world.backend.colliders, &mut short);
    assert!(below.exact_failed && !below.ready);
    assert!(short.used >= 41 && short.used <= short.limit);
    // First bound was inserted; the rejected second bound cannot leave the
    // tree structurally invalid or turn the missing leaf into a no-hit result.
    assert_eq!(below.bvh.leaf_count(), 1);
    below.validate_saved_payload().unwrap();
    world.step_motion = below;
    let mut hits = Vec::new();
    assert_eq!(
        world.sweep_step_motion(
            &Shape::Sphere { radius: 0.001 },
            Pose::default(),
            [0.; 3],
            &QueryFilter::default(),
            &mut hits,
            8
        ),
        Err(PhysicsError::InvalidQuery)
    );
    let snapshot = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
    assert_eq!(
        snapshot.encoded_bytes(),
        restored.capture_snapshot().unwrap().encoded_bytes()
    );
    assert_eq!(
        restored.sweep_step_motion(
            &Shape::Sphere { radius: 0.001 },
            Pose::default(),
            [0.; 3],
            &QueryFilter::default(),
            &mut hits,
            8
        ),
        Err(PhysicsError::InvalidQuery)
    );
    // The unavailable observation is not a new tick failure policy: subsequent
    // real ticks replace it normally and replay preserves the same bytes.
    for _ in 0..6 {
        world.step_checked().unwrap();
        restored.step_checked().unwrap();
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}

#[test]
fn exhausted_finish_keeps_old_tree_unchanged_and_capture_unavailable() {
    let (mut world, body) = fixture();
    add_exact(&mut world, body, constant(), 0., H);
    let mut enough = work(0, 32 * 1024 * 1024);
    world
        .step_motion
        .finish(&world.backend.colliders, &mut enough);
    assert!(world.step_motion.ready);
    let tree = postcard::to_allocvec(&world.step_motion.bvh).unwrap();
    let mut exhausted = work(97, 97);
    world
        .step_motion
        .finish(&world.backend.colliders, &mut exhausted);
    assert_eq!(exhausted.used, 97);
    assert_eq!(postcard::to_allocvec(&world.step_motion.bvh).unwrap(), tree);
    assert!(world.step_motion.exact_failed && !world.step_motion.ready);
    world.step_motion.validate_saved_payload().unwrap();
}

#[test]
fn cancellation_interior_is_in_saved_bvh_even_when_original_endpoints_are_equal() {
    let (mut world, body) = fixture();
    let carrier = Kernel::from_velocity(
        body,
        Domain::new(0., H).unwrap(),
        rp::Pose::from_translation(rp::Vector::X * 524_288.),
        rp::Vector::X * 16.,
        rp::Vector::ZERO,
    )
    .unwrap();
    let motion = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::ZERO,
            offset: rp::Vector::X * -524_288.,
            linear_velocity: rp::Vector::X * -16.,
            rotation: rp::Rotation::IDENTITY,
        },
        ..constant()
    };
    assert_eq!(motion.pose(0.).translation, motion.pose(H).translation);
    let middle = motion.pose(H / 8.).translation;
    assert_eq!(middle.x, -1. / 32.);
    add_exact(&mut world, body, motion, 0., H);
    let source = crate::checkpoint_codec::encode(&(motion, &world.backend.bodies)).unwrap();
    let mut budget = world.saved_motion_proof_work();
    world.finish_step_motion(&mut budget);
    world.commit_saved_motion_proof_work(budget).unwrap();
    assert!(world.step_motion.ready);
    let bounds = Aabb::from_half_extents(middle, rp::Vector::splat(1. / 1024.));
    assert_eq!(
        world
            .step_motion
            .bvh
            .intersect_aabb(&bounds)
            .collect::<Vec<_>>(),
        vec![0]
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&(motion, &world.backend.bodies)).unwrap(),
        source
    );
    let snapshot = world.capture_snapshot().unwrap();
    let restored = PhysicsWorld3d::from_snapshot(&snapshot).unwrap();
    assert_eq!(
        snapshot.encoded_bytes(),
        restored.capture_snapshot().unwrap().encoded_bytes()
    );
    assert_eq!(
        restored
            .step_motion
            .bvh
            .intersect_aabb(&bounds)
            .collect::<Vec<_>>(),
        vec![0]
    );
}

#[test]
fn disabled_legacy_and_singleton_endpoint_paths_keep_their_existing_scope() {
    let (mut world, body) = fixture();
    let start = &world.step_motion.starts[0];
    let row = target_motion(
        start,
        rp::Vector::ZERO,
        rp::Pose::IDENTITY,
        rp::Pose::from_translation(rp::Vector::X),
        0.,
        1.,
    );
    let legacy_bounds = motion_bounds(world.backend.colliders[row.collider].shape(), &row.motion);
    world.step_motion.segments.push(row);
    add_exact(&mut world, body, constant(), H, H);
    world.step_motion.enabled = false;
    let source = postcard::to_allocvec(&world.step_motion).unwrap();
    let mut disabled_work = work(0, 0);
    world.finish_step_motion(&mut disabled_work);
    assert_eq!(disabled_work.used, 0);
    assert_eq!(postcard::to_allocvec(&world.step_motion).unwrap(), source);
    world.step_motion.enabled = true;
    let mut budget = world.saved_motion_proof_work();
    world.finish_step_motion(&mut budget);
    world.commit_saved_motion_proof_work(budget).unwrap();
    assert!(world.step_motion.ready);
    assert_eq!(
        world.step_motion.bvh.leaf_node(0).unwrap().aabb(),
        legacy_bounds
    );
    let last = &world.step_motion.segments[1];
    let exact = last.exact.as_ref().unwrap();
    assert_eq!(exact.start_time, exact.end_time);
    assert_eq!(
        world.step_motion.bvh.leaf_node(1).unwrap().aabb(),
        exact
            .motion
            .bounds(
                world.backend.colliders[last.collider].shape(),
                H,
                H,
                &mut work(0, 32 * 1024 * 1024)
            )
            .unwrap()
    );
    world.step_motion.validate_saved_payload().unwrap();
}

#[test]
fn interpolated_capture_has_its_own_work_allowance() {
    let (mut world, _) = fixture();
    let mut proof = world.saved_motion_proof_work();
    proof.used = proof.limit;
    world.commit_saved_motion_proof_work(proof).unwrap();
    world.finish_fixed_step();
    assert!(world.step_motion.ready);
    assert_eq!(world.saved_motion_proof_work().used, proof.limit);
}

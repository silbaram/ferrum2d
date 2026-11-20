use super::*;
use crate::physics3d::solver_trajectory::{cast, leaf_contact, Domain, Kernel, SeparationAxes};

fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
fn motion(curve: Curve) -> ShapeMotion {
    ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn fixed(center: rp::Vector) -> ShapeMotion {
    motion(Curve::Constant {
        pose: rp::Pose::from_translation(center),
        start_time: 0.,
        end_time: 0.025,
    })
}
fn original_fixture(inward: bool) -> (ShapeMotion, rp::SharedShape, ShapeMotion) {
    let q = rp::Rotation::from_rotation_y(1.1);
    let direction = rp::Vector::new(0.6, 0., 0.8);
    let start = rp::Pose::from_rotation(q);
    let v = rp::Vector::Y * 0.1
        + if inward {
            direction * 0.2
        } else {
            rp::Vector::ZERO
        };
    let native = Kernel::from_velocity(
        rp::RigidBodyHandle::invalid(),
        Domain::new(0., f64::from(0.025_f32)).unwrap(),
        start,
        v,
        rp::Vector::ZERO,
    )
    .unwrap();
    let a = motion(Curve::Integrated(native));
    let b = motion(Curve::Constant {
        pose: rp::Pose::from_parts(direction * 0.5101, q),
        start_time: 0.,
        end_time: 0.025,
    });
    (a, rp::SharedShape::capsule_y(0.25, 0.25), b)
}
fn prepare<'a>(
    a: ShapeMotion,
    sa: &'a dyn rp::Shape,
    b: ShapeMotion,
    sb: &'a dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
) -> (Context<'a>, Frames, Frames) {
    let mut fa = frames(a.curve, start, end, &mut work()).unwrap().unwrap();
    let mut fb = frames(b.curve, start, end, &mut work()).unwrap().unwrap();
    fa.shape(a);
    fb.shape(b);
    (
        Context {
            a,
            sa,
            b,
            sb,
            start,
            end,
            clearance,
        },
        fa,
        fb,
    )
}
fn contact_bits(c: rapier3d::parry::query::Contact) -> ([u32; 3], [u32; 3], [u32; 3], u32) {
    (
        c.point1.to_array().map(f32::to_bits),
        c.point2.to_array().map(f32::to_bits),
        c.normal1.to_array().map(f32::to_bits),
        c.dist.to_bits(),
    )
}

#[test]
fn yaw_capsule_pair_preserves_the_shared_clock_and_rejects_inward_motion() {
    let domain = Domain::new(0.07500000111758709, 0.10000000149011612).unwrap();
    let end = 0.09999953922213634;
    let cap = rp::Capsule::new_y(0.25, 0.25);
    let actor = |id, x, z, vx, vz| {
        motion(Curve::Integrated(
            Kernel::from_velocity_seconds(
                rp::RigidBodyHandle::from_raw_parts(id, 0),
                domain,
                0.025,
                rp::Pose::from_parts(
                    rp::Vector::new(x, 0., z),
                    rp::Rotation::from_rotation_y(0.3),
                ),
                rp::Vector::new(vx, 0., vz),
                rp::Vector::ZERO,
            )
            .unwrap(),
        ))
    };
    let a = actor(1, -3.1191652, 0.964871, -28.851048, 8.924677);
    for (vx, clear) in [(-33.532196, true), (-33.54, false)] {
        let b = actor(0, -2.5149148, 0.7779542, vx, 10.372723);
        let contact = leaf_contact(&a.pose(end), &cap, &b.pose(end), &cap, &mut work()).unwrap();
        assert_eq!(contact.dist > 0.01, clear);
        for (left, right) in [(a, b), (b, a)] {
            let (context, fa, fb) = prepare(left, &cap, right, &cap, domain.start, end, 0.01);
            assert_eq!(
                capsule_separation(context, &fa, &fb, &mut work()).unwrap(),
                clear
            );
        }
    }
    let mut retimed = a;
    let Curve::Integrated(ref mut k) = retimed.curve else {
        unreachable!()
    };
    k.domain.end += 0.001;
    assert!(
        shared_yaw_capsule_centers(a, retimed, rp::Vector::X, domain.start, end, &mut work(),)
            .unwrap()
            .is_none()
    );
}

#[test]
fn observed_capsule_endpoint_normal_is_not_a_full_segment_plane_but_core_feature_is() {
    let (a, shape, b) = original_fixture(true);
    let start = 0.0003906531259417534;
    let end = 0.0003906532190740109;
    let original = postcard::to_allocvec(&(a, b)).unwrap();
    let (context, fa, fb) = prepare(a, shape.as_ref(), b, shape.as_ref(), start, end, 0.01);
    let noisy = rp::Vector::new(0.6, -7.6606215e-5, 0.8000001);
    let contact = leaf_contact(
        &a.pose(start),
        shape.as_ref(),
        &b.pose(start),
        shape.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(contact.dist > 0.01);
    // The Y component pays the entire two-segment support length, rather
    // than only the nearly coincident GJK endpoint witness difference.
    assert!(!super::super::separated(
        &fa,
        shape.as_ref(),
        &fb,
        shape.as_ref(),
        noisy,
        0.01,
        &mut work()
    )
    .unwrap());
    assert!(capsule_separation(context, &fa, &fb, &mut work()).unwrap());
    assert!(
        crate::physics3d::solver_trajectory::rounded::output::separated(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            noisy,
            start,
            end,
            0.01,
            &mut work()
        )
        .unwrap()
    );
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), original);
}

#[test]
fn original_tangent_no_hit_and_inward_real_bracket_keep_skin_and_native_query_bits() {
    for inward in [false, true] {
        let (a, shape, b) = original_fixture(inward);
        let before = postcard::to_allocvec(&(a, b)).unwrap();
        let original = contact_bits(
            leaf_contact(
                &a.pose(0.),
                shape.as_ref(),
                &b.pose(0.),
                shape.as_ref(),
                &mut work(),
            )
            .unwrap(),
        );
        let hit = cast(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            0.,
            0.025,
            0.01,
            1e-6,
            &mut work(),
        )
        .unwrap();
        if inward {
            let hit = hit.expect("the original capsule advances through the unchanged skin");
            assert!(hit.safe_time <= hit.hit_time && hit.hit_time > 0.);
            assert!(hit.hit_time - hit.safe_time <= 1e-6);
            assert!(hit.contact.dist <= 0.01);
        } else {
            assert!(hit.is_none());
        }
        assert_eq!(
            contact_bits(
                leaf_contact(
                    &a.pose(0.),
                    shape.as_ref(),
                    &b.pose(0.),
                    shape.as_ref(),
                    &mut work()
                )
                .unwrap()
            ),
            original
        );
        assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
    }
}

#[test]
fn nonparallel_and_zero_length_cores_are_only_candidates_and_real_overlap_is_not_clear() {
    let a = fixed(rp::Vector::ZERO);
    let b = fixed(rp::Vector::Z);
    let first = rp::SharedShape::capsule_y(0.25, 0.125);
    let second = rp::SharedShape::capsule_x(0.2, 0.1);
    let (context, fa, fb) = prepare(a, first.as_ref(), b, second.as_ref(), 0., 0.025, 0.01);
    assert!(capsule_separation(context, &fa, &fb, &mut work()).unwrap());
    let (context, fa, fb) = prepare(a, first.as_ref(), a, second.as_ref(), 0., 0.025, 0.01);
    assert!(!capsule_separation(context, &fa, &fb, &mut work()).unwrap());
    let hit = cast(
        a,
        first.as_ref(),
        a,
        second.as_ref(),
        0.,
        0.025,
        0.01,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(hit.hit_time, 0.);
    let point = rp::SharedShape::capsule_y(0., 0.125);
    let (context, fa, fb) = prepare(a, point.as_ref(), b, point.as_ref(), 0., 0.025, 0.01);
    assert!(capsule_separation(context, &fa, &fb, &mut work()).unwrap());
    let (context, fa, fb) = prepare(a, point.as_ref(), a, point.as_ref(), 0., 0.025, 0.01);
    assert!(!capsule_separation(context, &fa, &fb, &mut work()).unwrap());
}

#[test]
fn closest_core_at_the_start_does_not_certify_a_later_rotating_crossing() {
    let a = motion(Curve::Integrated(
        Kernel::from_velocity(
            rp::RigidBodyHandle::invalid(),
            Domain::new(0., f64::from(0.025_f32)).unwrap(),
            rp::Pose::IDENTITY,
            rp::Vector::ZERO,
            rp::Vector::Z * 30.,
        )
        .unwrap(),
    ));
    let b = fixed(rp::Vector::new(0.45, 0., 0.));
    let shape = rp::SharedShape::capsule_y(0.6, 0.05);
    let (context, fa, fb) = prepare(a, shape.as_ref(), b, shape.as_ref(), 0., 0.025, 0.01);
    assert!(!capsule_separation(context, &fa, &fb, &mut work()).unwrap());
    // Actual original Native endpoint overlaps. The start-feature direction
    // is insufficient: only the full time/shape proof is authoritative.
    let contact = leaf_contact(
        &a.pose(0.025),
        shape.as_ref(),
        &b.pose(0.025),
        shape.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(contact.dist < 0.01);
}

#[test]
fn shared_work_is_prepaid_exactly_without_reset_and_failures_leave_source_bytes_unchanged() {
    let (a, shape, b) = original_fixture(false);
    let (context, fa, fb) = prepare(a, shape.as_ref(), b, shape.as_ref(), 0., 0.025, 0.01);
    let original = postcard::to_allocvec(&(a, b)).unwrap();
    let mut measured = Work { used: 23, ..work() };
    assert!(capsule_separation(context, &fa, &fb, &mut measured).unwrap());
    let required = measured.used;
    let mut exact = Work {
        used: 23,
        limit: required,
    };
    assert!(capsule_separation(context, &fa, &fb, &mut exact).unwrap());
    assert_eq!(exact.used, required);
    let mut below = Work {
        used: 23,
        limit: required - 1,
    };
    assert_eq!(
        capsule_separation(context, &fa, &fb, &mut below),
        Err(TrajectoryError::WorkLimit)
    );
    let mut no_candidate = Work {
        used: 23,
        limit: 23 + CANDIDATE_WORK - 1,
    };
    assert_eq!(
        capsule_separation(context, &fa, &fb, &mut no_candidate),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(no_candidate.used, 23);
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), original);
}

#[test]
fn earlier_cheap_proof_and_non_capsule_owners_do_not_pay_the_new_phase_or_expand_axes() {
    let a = fixed(rp::Vector::ZERO);
    let b = fixed(rp::Vector::Z * 2.);
    let shape = rp::SharedShape::capsule_y(0.25, 0.125);
    let mut axes = SeparationAxes::single(rp::Vector::Z);
    let mut cache = AxisCache::new(a, shape.as_ref(), b, shape.as_ref(), 0., 0.025, 0.01);
    assert!(
        crate::physics3d::solver_trajectory::rounded::output::separated_cached(
            0,
            &mut work(),
            &mut axes,
            &mut cache
        )
        .unwrap()
    );
    assert!(cache.face.is_none() && !cache.support_done);
    assert_eq!(axes.len, 1);
    let ball = rp::SharedShape::ball(0.125);
    let (context, fa, fb) = prepare(a, ball.as_ref(), b, ball.as_ref(), 0., 0.025, 0.01);
    let mut exhausted = Work {
        used: 23,
        limit: 23,
    };
    assert!(!capsule_separation(context, &fa, &fb, &mut exhausted).unwrap());
    assert_eq!(exhausted.used, 23);
}

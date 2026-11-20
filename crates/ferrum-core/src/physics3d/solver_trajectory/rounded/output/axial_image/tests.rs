use super::*;
use crate::physics3d::solver_trajectory::{cast, leaf_contact, Domain};

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

fn recorded_stair() -> (ShapeMotion, rp::SharedShape, ShapeMotion, rp::SharedShape) {
    // Original first rejected stair window: preserve the exact F32 source,
    // physical integration dt, observer labels and separate logical domain.
    let vector = |bits: [u32; 3]| rp::Vector::from_array(bits.map(f32::from_bits));
    let mut kernel = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(3, 0),
        Domain::new(0.008333333767950535, 0.012500000651925802).unwrap(),
        f32::from_bits(0x3b888889),
        rp::Pose::from_translation(vector([0x3f2783a6, 0x3f6ba762, 0xb63c6942])),
        vector([0x3c4a07ff, 0xba8bafff, 0xba819fbb]),
        rp::Vector::ZERO,
    )
    .unwrap();
    kernel.native.motion.start_time = f32::from_bits(0x3c088889);
    kernel.native.motion.end_time = f32::from_bits(0x3c4cccce);
    assert_eq!(
        kernel
            .native
            .motion
            .end
            .translation
            .to_array()
            .map(f32::to_bits),
        [0x3f278704, 0x3f6ba718, 0xb6e8789c]
    );
    (
        motion(Curve::Integrated(kernel)),
        rp::SharedShape::capsule_y(0.5, 0.4),
        motion(Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::new(1.5, 0.1, 0.)),
            start_time: kernel.domain.start,
            end_time: kernel.domain.end,
        }),
        rp::SharedShape::cuboid(0.5, 0.1, 2.),
    )
}

fn prepared<'a>(
    a: ShapeMotion,
    sa: &'a dyn rp::Shape,
    b: ShapeMotion,
    sb: &'a dyn rp::Shape,
) -> (Context<'a>, PreparedFrames<'a>) {
    let context = Context {
        a,
        sa,
        b,
        sb,
        start: 0.008608214509418843,
        end: 0.008608246298564382,
        clearance: 0.01,
    };
    let prepared = prepare(context, &mut work()).unwrap().unwrap();
    (context, prepared)
}

fn contact(
    a: rp::Pose,
    sa: &dyn rp::Shape,
    b: rp::Pose,
    sb: &dyn rp::Shape,
) -> rapier3d::parry::query::Contact {
    leaf_contact(&a, sa, &b, sb, &mut work()).unwrap()
}

#[test]
fn recorded_stair_tangent_image_matches_every_original_f32_leaf_and_closes_the_window() {
    let (a, sa, b, sb) = recorded_stair();
    let before = postcard::to_allocvec(&(a, b)).unwrap();
    let (ctx, p) = prepared(a, sa.as_ref(), b, sb.as_ref());
    assert!(poses(&p.a, &mut work()).unwrap().is_none());
    let (mut actor, range) = representative(&p.a, Some(2)).unwrap();
    assert!(range.image().is_none());
    let box_pose = representative(&p.b, None).unwrap().0;
    let original = contact(a.pose(ctx.start), ctx.sa, b.pose(ctx.start), ctx.sb);
    assert_eq!(original.dist.to_bits(), 0.010000011_f32.to_bits());
    let mut count = 0;
    let mut z = range.lo;
    loop {
        actor.translation.z = z;
        let actual = contact(actor, ctx.sa, box_pose, ctx.sb);
        assert_eq!(actual.dist.to_bits(), original.dist.to_bits());
        assert_eq!(
            actual.normal1.to_array().map(f32::to_bits),
            original.normal1.to_array().map(f32::to_bits)
        );
        assert_eq!(actual.point1.z, actual.point2.z);
        count += 1;
        if z.to_bits() == range.hi.to_bits() {
            break;
        }
        assert!(count < 1024, "this is an exhaustive finite output oracle");
        z = z.next_up();
    }
    assert!(count > 2);
    let mut charged = work();
    assert_eq!(
        Cache::default().clear(&p.a, ctx.sa, &p.b, ctx.sb, ctx.clearance, &mut charged),
        Ok(Some(true))
    );
    assert!(charged.used < count * (14 * 256 + 128));
    // Native's tangent-family predicate above is invariant, but its local
    // radius offset rounds differently from the original real world radius.
    // Keep that predicate oracle; it cannot certify this whole shape clear.
    let capsule = ctx.sa.as_capsule().unwrap();
    let cuboid = ctx.sb.as_cuboid().unwrap();
    let core = a.pose(ctx.start) * capsule.segment.a;
    let local = rp::Vector::new(-0.5, 0.1, core.z);
    assert!(local.abs().cmple(cuboid.half_extents).all());
    let point = b.pose(ctx.start) * local;
    let squared = core
        .to_array()
        .into_iter()
        .zip(point.to_array())
        .map(|(c, p)| (f64::from(c) - f64::from(p)).powi(2))
        .sum::<f64>();
    assert!(squared < (f64::from(capsule.radius) + f64::from(ctx.clearance)).powi(2));
    let mut search = work();
    let hit = cast(
        a,
        ctx.sa,
        b,
        ctx.sb,
        ctx.start,
        ctx.end,
        ctx.clearance,
        4.166667455507422e-9,
        &mut search,
    )
    .unwrap()
    .expect("the original world-radius shape touches despite the Native-only clear predicate");
    assert_eq!(hit.safe_time, ctx.start);
    assert_eq!(hit.hit_time, ctx.start);
    assert!(hit.contact.dist < ctx.clearance);
    assert!(hit.contact.normal1.is_finite());
    assert!(hit.contact.point1.is_finite() && hit.contact.point2.is_finite());
    assert!(search.used < search.limit);
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
}

fn frame(translation: Translation) -> Frames {
    let mut out = Frames::new();
    out.push(Frame {
        translation,
        rotation: Quaternion::IDENTITY,
    })
    .unwrap();
    out
}

#[test]
fn all_axial_permutations_and_both_query_orders_keep_original_distance_and_closed_skin() {
    for axis in 0..3 {
        for free in 0..3 {
            if free == axis {
                continue;
            }
            for side in [-1., 1.] {
                let mut endpoint = rp::Vector::ZERO;
                endpoint[axis] = 0.25;
                let capsule = rp::SharedShape::capsule(-endpoint, endpoint, 0.125);
                let box_shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
                let fb = frame(exact_vector(rp::Vector::ZERO));
                let mut translation = exact_vector(rp::Vector::ZERO);
                translation[axis] = Float::exact(side);
                translation[free] = Float::span(-0.25, 0.25);
                let fc = frame(translation);
                let (mut cp, _) = representative(&fc, Some(free)).unwrap();
                let expected =
                    contact(rp::Pose::IDENTITY, box_shape.as_ref(), cp, capsule.as_ref());
                assert!(expected.dist > 0.);
                for step in 0..=32 {
                    cp.translation[free] = -0.25 + step as f32 / 64.;
                    let actual =
                        contact(rp::Pose::IDENTITY, box_shape.as_ref(), cp, capsule.as_ref());
                    assert_eq!(actual.dist.to_bits(), expected.dist.to_bits());
                }
                for reversed in [false, true] {
                    let (a, sa, b, sb) = if reversed {
                        (&fc, capsule.as_ref(), &fb, box_shape.as_ref())
                    } else {
                        (&fb, box_shape.as_ref(), &fc, capsule.as_ref())
                    };
                    for margin in [
                        expected.dist.next_down(),
                        expected.dist,
                        expected.dist.next_up(),
                    ] {
                        assert_eq!(
                            Cache::default().clear(a, sa, b, sb, margin, &mut work()),
                            Ok(Some(expected.dist > margin))
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn finite_slab_and_singleton_admission_declines_every_unproved_pose_dimension() {
    let capsule = rp::SharedShape::capsule_y(0.25, 0.125);
    let box_shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let box_pose = frame(exact_vector(rp::Vector::ZERO));
    let mut translation = exact_vector(rp::Vector::Y);
    translation[2] = Float::span(-0.25, 0.25);
    for change in 0..8 {
        let mut fc = frame(translation);
        let mut fb = frame(exact_vector(rp::Vector::ZERO));
        match change {
            0 => fc.values[0].translation[2] = Float::span(-0.25, 0.5_f32.next_up()),
            1 => fc.values[0].translation[0] = Float::span(0., f32::from_bits(1)),
            2 => fc.values[0].rotation = Quaternion::exact(rp::Rotation::from_rotation_y(0.001)),
            3 => fb.values[0].rotation = Quaternion::exact(rp::Rotation::from_rotation_x(0.001)),
            4 => fb.values[0].translation[2] = Float::exact(0.25),
            5 => fc.values[0].translation[1] = Float::exact(0.5),
            6 => fc.values[0].rotation.exact = None,
            7 => fc.len = 0,
            _ => unreachable!(),
        }
        assert_eq!(
            Cache::default().clear(
                &fb,
                box_shape.as_ref(),
                &fc,
                capsule.as_ref(),
                0.01,
                &mut work()
            ),
            Ok(None),
            "unproved case {change}"
        );
    }
    let non_axial = rp::SharedShape::capsule(
        rp::Vector::new(-0.1, -0.25, 0.),
        rp::Vector::new(0.1, 0.25, 0.),
        0.125,
    );
    let fc = frame(translation);
    assert_eq!(
        Cache::default().clear(
            &box_pose,
            box_shape.as_ref(),
            &fc,
            non_axial.as_ref(),
            0.01,
            &mut work()
        ),
        Ok(None)
    );
    let ball = rp::SharedShape::ball(0.125);
    assert_eq!(
        Cache::default().clear(
            &box_pose,
            box_shape.as_ref(),
            &fc,
            ball.as_ref(),
            0.01,
            &mut work()
        ),
        Ok(None)
    );
}

#[test]
fn exact_shared_budget_and_failure_atomicity_keep_original_motion_and_cache_unpublished() {
    let (a, sa, b, sb) = recorded_stair();
    let before = postcard::to_allocvec(&(a, b)).unwrap();
    let (ctx, p) = prepared(a, sa.as_ref(), b, sb.as_ref());
    let mut measured = Work { used: 37, ..work() };
    let result = Cache::default()
        .clear(&p.a, ctx.sa, &p.b, ctx.sb, ctx.clearance, &mut measured)
        .unwrap();
    let mut exact = Work {
        used: 37,
        limit: measured.used,
    };
    let mut cache = Cache::default();
    assert_eq!(
        cache.clear(&p.a, ctx.sa, &p.b, ctx.sb, ctx.clearance, &mut exact),
        Ok(result)
    );
    assert_eq!(exact.used, measured.used);
    exact.limit += 1;
    assert_eq!(
        cache.clear(&p.a, ctx.sa, &p.b, ctx.sb, ctx.clearance, &mut exact),
        Ok(result)
    );
    assert_eq!(exact.used, measured.used + 1);
    for (used, limit) in [(37, measured.used - 1), (37, 37), (u64::MAX, u64::MAX)] {
        let mut rejected = Work { used, limit };
        let mut cache = Cache::default();
        assert_eq!(
            cache.clear(&p.a, ctx.sa, &p.b, ctx.sb, ctx.clearance, &mut rejected),
            Err(TrajectoryError::WorkLimit)
        );
        assert!(cache.result.is_none());
    }
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), before);
    assert!(!std::mem::needs_drop::<Cache>());
}

#[test]
fn actual_equality_is_a_hit_and_an_inward_non_singleton_curve_uses_the_original_search() {
    let capsule = rp::SharedShape::capsule_y(0.25, 0.125);
    let box_shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let domain = Domain::new(0., 1.).unwrap();
    let actor = motion(Curve::Integrated(
        Kernel::from_velocity(
            rp::RigidBodyHandle::invalid(),
            domain,
            rp::Pose::from_translation(rp::Vector::Y),
            rp::Vector::new(0., -0.2, 0.125),
            rp::Vector::ZERO,
        )
        .unwrap(),
    ));
    let ground = motion(Curve::Constant {
        pose: rp::Pose::IDENTITY,
        start_time: 0.,
        end_time: 1.,
    });
    let before = postcard::to_allocvec(&(actor, ground)).unwrap();
    let context = Context {
        a: actor,
        sa: capsule.as_ref(),
        b: ground,
        sb: box_shape.as_ref(),
        start: 0.,
        end: 1.,
        clearance: 0.01,
    };
    let p = prepare(context, &mut work()).unwrap().unwrap();
    assert_eq!(
        Cache::default().clear(
            &p.a,
            context.sa,
            &p.b,
            context.sb,
            context.clearance,
            &mut work()
        ),
        Ok(None)
    );
    let initial = contact(actor.pose(0.), context.sa, ground.pose(0.), context.sb);
    let equality = cast(
        actor,
        context.sa,
        ground,
        context.sb,
        0.,
        1.,
        initial.dist,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(equality.hit_time, 0.);
    assert_eq!(equality.contact.dist.to_bits(), initial.dist.to_bits());
    let hit = cast(
        actor,
        context.sa,
        ground,
        context.sb,
        0.,
        1.,
        context.clearance,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(hit.safe_time < hit.hit_time && hit.hit_time > 0.);
    assert!(hit.hit_time - hit.safe_time <= 1e-6);
    assert!(hit.contact.dist <= context.clearance);
    assert_eq!(postcard::to_allocvec(&(actor, ground)).unwrap(), before);
}

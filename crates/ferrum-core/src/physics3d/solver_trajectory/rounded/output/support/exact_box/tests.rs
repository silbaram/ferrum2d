use super::*;
use crate::physics3d::solver_trajectory::{cast_full_shapes_policy, leaf_contact, Domain};

const START: Time = 0.04899999767919063;
const END: Time = 0.04900101794303979;
const SAFE: Time = 0.049000001664596296;
const CELL: Time = 0.04900004930264834;
const H: f32 = 1.0202639e-6;
fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}

#[test]
fn fixed_triangle_support_bounds_a_capsule_moving_along_either_winding() {
    let h = 0.004166667_f32;
    let end = f64::from(h);
    let domain = Domain::new(0., end).unwrap();
    let fixed = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::IDENTITY,
            start_time: 0.,
            end_time: end,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let capsule = rp::Capsule::new_y(0.5, 0.4);
    let a = rp::Vector::new(0., 0., -2.);
    let b = rp::Vector::new(0., 0., 2.);
    let c = rp::Vector::new(4., 2., 2.);
    let normal = rp::Vector::new(-0.5, 1., 0.).normalize();
    for triangle in [rp::Triangle::new(a, b, c), rp::Triangle::new(a, c, b)] {
        for (x, height, vx, vy, clear) in [
            (-0.072434485, 0.9221787, 1.6213255, 0.8104777, true),
            (-0.072434485, 0.92217, 1.6213255, 0.8104777, false),
            (0.022075603, 0.9694318, 1.6128883, 0.80644417, true),
            (0.022075603, 0.9694318, 1.6128883, 0.8, false),
        ] {
            let kernel = Kernel::from_velocity_seconds(
                rp::RigidBodyHandle::from_raw_parts(0, 0),
                domain,
                h,
                rp::Pose::from_translation(rp::Vector::new(x, height, -1.7876147e-6)),
                rp::Vector::new(vx, vy, 0.),
                rp::Vector::ZERO,
            )
            .unwrap();
            let actor = ShapeMotion {
                curve: Curve::Integrated(kernel),
                ..fixed
            };
            let mut cache = super::super::super::AxisCache::new(
                fixed, &triangle, actor, &capsule, 0., end, 0.01,
            );
            assert_eq!(
                super::super::super::ramp_capsule_separated(&mut cache, normal, &mut work())
                    .unwrap(),
                clear
            );
        }
    }
}

#[test]
fn rounded_world_coordinates_keep_clearance_when_both_additions_round() {
    let point = -rp::Vector::Y * 0.5;
    let inward = rp::Vector::new(1., -2., 0.);
    let radius = 0.4_f32;
    let limit = -f64::from(0.01_f32) * 5_f64.sqrt();
    let start = f32::from_bits(0x3feb200d);
    let y = f32::from_bits(0x3ff03caf);
    let inside_skin = f32::from_bits(start.to_bits() + 8);
    for (x, clear) in [(start, true), (start.next_up(), true), (inside_skin, false)] {
        let pose = rp::Vector::new(x, y, 0.);
        if !clear {
            let offset = inward.normalize() * radius.next_down();
            assert!(offset.as_dvec3().length() <= f64::from(radius));
            assert!((pose + (point + offset)).as_dvec3().dot(inward.as_dvec3()) >= limit);
        }
        let error = std::array::from_fn(|i| {
            Value::input(Float::exact(pose[i]))
                .add(Value::local(point[i], radius))
                .error
        });
        let result = rounded_cap_projection(
            pose.to_array(),
            point,
            radius,
            inward,
            limit,
            error,
            CapQuery::Plane,
            &mut work(),
        )
        .unwrap();
        assert_eq!(matches!(result, CapPlane::Below), clear);
    }
}

#[test]
fn ramp_capsule_support_distinguishes_adjacent_translation_cells() {
    let normal = rp::Vector::new(1., -10., 0.);
    let point = rp::Vector::new(0., -0.5, 0.);
    let radius = 0.25;
    let limit = -10. - f64::from(0.01_f32) * 101_f64.sqrt();
    let clear = rp::Vector::new(0.5068911, 1.811986, 0.);
    let touch = rp::Vector::new(clear.x.next_up(), clear.y, 0.);
    let local_error = std::array::from_fn(|i| {
        Value::input(Float::exact(clear[i]))
            .add(Value::local(point[i], radius))
            .error
    });
    assert!(matches!(
        rounded_cap_projection(
            clear.to_array(),
            point,
            radius,
            normal,
            limit,
            local_error,
            CapQuery::Plane,
            &mut work(),
        )
        .unwrap(),
        CapPlane::Below
    ));
    let point =
        rounded_cap_plane_witness(touch, point, radius, normal, limit, |_| true, &mut work())
            .unwrap()
            .unwrap();
    assert!(point.as_dvec3().dot(normal.as_dvec3()) >= limit);
}

#[test]
fn rounded_cap_clears_the_ramp_crest_by_its_finite_edge_distance() {
    let hull = rp::ConvexPolyhedron::from_convex_hull(&[
        rp::Vector::new(-1., -1., -10.),
        rp::Vector::new(-1., -1., 10.),
        rp::Vector::new(-1., 0., -10.),
        rp::Vector::new(-1., 0., 10.),
        rp::Vector::new(1., -1., -10.),
        rp::Vector::new(1., -1., 10.),
        rp::Vector::new(1., 1., -10.),
        rp::Vector::new(1., 1., 10.),
    ])
    .unwrap();
    let hull_pose = rp::Pose::from_translation(rp::Vector::new(2., 0., 0.));
    let crest = rp::Vector::new(3., 1., 0.);
    let capsule = rp::Capsule::new_y(0.5, 0.25);
    let clear = rp::Vector::new(2.933246, 1.7512846, 0.);
    let touching = rp::Vector::new(clear.x, clear.y.next_down(), 0.);
    let inward = (crest - (clear + capsule.segment.a)).normalize();
    let separated = |translation| {
        rounded_cap_edge_separated(
            &hull,
            hull_pose,
            crest,
            &capsule,
            [translation; 2],
            inward,
            0.01,
            &mut work(),
        )
        .unwrap()
    };
    assert!(separated(clear));
    assert!(!separated(touching));
}

struct Fixture {
    actor: ShapeMotion,
    dynamic: ShapeMotion,
    capsule: rp::SharedShape,
    cuboid: rp::SharedShape,
}
fn recorded() -> Fixture {
    let domain = Domain::new(START, END).unwrap();
    let own = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        H,
        rp::Pose::from_translation(rp::Vector::new(-2.9206275e-8, 0., 0.09799999)),
        rp::Vector::new(-4.933114, 0., 2.),
        rp::Vector::ZERO,
    )
    .unwrap();
    let donor = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        domain,
        H,
        rp::Pose::from_translation(rp::Vector::new(0.51, 0., 0.)),
        rp::Vector::new(-5.066886, 0., 0.),
        rp::Vector::new(0., 1.3650212, 2.3841858e-7),
    )
    .unwrap();
    let mut hybrid = own;
    hybrid.native.motion.start.translation.x = donor.native.motion.start.translation.x;
    hybrid.native.motion.end.translation.x = donor.native.motion.end.translation.x;
    hybrid.native.linear_velocity.x = donor.native.linear_velocity.x;
    let actor = ShapeMotion {
        curve: Curve::Anchored {
            carrier: hybrid,
            anchor: rp::Vector::new(-0.51, 0., 0.),
            offset: rp::Vector::new(f32::from_bits(0xb3542bbc), 0., 0.),
            linear_velocity: rp::Vector::new(f32::from_bits(0x3e08fb80), 0., 0.),
            rotation: rp::Rotation::IDENTITY,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    assert_eq!(
        actor
            .curve
            .com_pose(SAFE)
            .translation
            .to_array()
            .map(f32::to_bits),
        Curve::Integrated(own)
            .com_pose(SAFE)
            .translation
            .to_array()
            .map(f32::to_bits)
    );
    Fixture {
        actor,
        dynamic: ShapeMotion {
            curve: Curve::Integrated(donor),
            ..actor
        },
        capsule: rp::SharedShape::capsule_y(0.25, 0.25),
        cuboid: rp::SharedShape::cuboid(0.25, 1., 1.),
    }
}
fn context(f: &Fixture, start: Time, end: Time) -> Context<'_> {
    Context {
        a: f.actor,
        sa: f.capsule.as_ref(),
        b: f.dynamic,
        sb: f.cuboid.as_ref(),
        start,
        end,
        clearance: 0.01,
    }
}
fn proof(
    context: Context<'_>,
    normal: rp::Vector,
    budget: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Some(p) = super::super::super::prepare(context, budget)? else {
        return Ok(false);
    };
    separated(context, &p.a, &p.pa, &p.b, &p.pb, normal, budget)
}

#[test]
fn c85_finite_full_future_uses_complete_zero_radius_box_slabs_with_original_budget() {
    let f = recorded();
    let before =
        crate::checkpoint_codec::encode(&(f.actor, f.dynamic, &f.capsule, &f.cuboid)).unwrap();
    let ctx = context(&f, CELL, CELL.next_up());
    let native = leaf_contact(
        &f.actor.pose(CELL),
        f.capsule.as_ref(),
        &f.dynamic.pose(CELL),
        f.cuboid.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(native.dist > 0.01);
    let prepared = super::super::super::prepare(ctx, &mut work())
        .unwrap()
        .unwrap();
    let mut old_axes = super::super::super::super::super::SeparationAxes::single(native.normal1);
    super::super::projection_ranges(
        &prepared.a,
        &prepared.pa,
        &prepared.b,
        &prepared.pb,
        &mut old_axes.values[..1],
        0.01,
        &mut work(),
    )
    .unwrap();
    assert_eq!(old_axes.values[0].full_support, Some(false));
    let mut budget = work();
    assert!(proof(ctx, native.normal1, &mut budget).unwrap());
    let price = budget.used;
    for allowance in [price, price - 1] {
        let result = proof(
            ctx,
            native.normal1,
            &mut Work {
                used: 137,
                limit: 137 + allowance,
            },
        );
        if allowance == price {
            assert!(result.unwrap());
        } else {
            assert_eq!(result, Err(TrajectoryError::WorkLimit));
        }
    }
    // C86 actual later failing interval. This same dual gains one exact
    // dyadic weight; it must retain the complete original real world radius.
    let later = context(&f, 0.04900005061523565, 0.04900005061523571);
    let contact = leaf_contact(
        &f.actor.pose(later.start),
        f.capsule.as_ref(),
        &f.dynamic.pose(later.start),
        f.cuboid.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(contact.dist > 0.01);
    let p = super::super::super::prepare(later, &mut work())
        .unwrap()
        .unwrap();
    let norm = super::super::super::super::dot(contact.normal1, contact.normal1).sqrt();
    let mut weights_work = work();
    let projection = CapsuleProjection::prepare(
        &p.a,
        f.capsule.as_capsule().unwrap(),
        contact.normal1,
        norm,
        &mut weights_work,
    )
    .unwrap()
    .unwrap();
    let old = projection
        .upper(&ORIGINAL_WEIGHTS, &mut weights_work)
        .unwrap()
        .unwrap();
    assert_eq!(
        weights_work.used, 3584,
        "original 512 hull + two 256 world-core + five 512 visits"
    );
    assert_eq!(1. - NEAR_POLE_WEIGHT, 1. / 65536.);
    let before_weight = weights_work.used;
    let tighter = projection
        .upper(&[NEAR_POLE_WEIGHT], &mut weights_work)
        .unwrap()
        .unwrap();
    assert_eq!(weights_work.used - before_weight, 512);
    assert!(tighter < old);
    assert!(tighter >= projection.world_upper);
    assert_eq!(
        projection.upper(
            &[NEAR_POLE_WEIGHT],
            &mut Work {
                used: 31,
                limit: 31 + 511
            }
        ),
        Err(TrajectoryError::WorkLimit)
    );
    let mut later_work = work();
    assert!(proof(later, contact.normal1, &mut later_work).unwrap());
    for limit in [later_work.used, later_work.used - 1] {
        let found = proof(
            later,
            contact.normal1,
            &mut Work {
                used: 73,
                limit: 73 + limit,
            },
        );
        if limit == later_work.used {
            assert!(found.unwrap());
        } else {
            assert_eq!(found, Err(TrajectoryError::WorkLimit));
        }
    }
    let reversed = Context {
        a: f.dynamic,
        sa: f.cuboid.as_ref(),
        b: f.actor,
        sb: f.capsule.as_ref(),
        ..ctx
    };
    assert!(proof(reversed, -native.normal1, &mut work()).unwrap());
    // This is the actual whole candidate caller, not a sampled or single-cell
    // substitute. Same original A/B, clocks, selected skin, budget and tolerance.
    let mut future = Work {
        used: 1_000_000,
        ..work()
    };
    assert!(cast_full_shapes_policy(
        f.actor,
        f.capsule.as_ref(),
        f.dynamic,
        f.cuboid.as_ref(),
        SAFE,
        END,
        0.01,
        f64::from(H * 1e-6),
        &mut future,
        true
    )
    .unwrap()
    .is_none());
    assert!(future.used < future.limit);
    assert_eq!(
        crate::checkpoint_codec::encode(&(f.actor, f.dynamic, &f.capsule, &f.cuboid)).unwrap(),
        before
    );
}

#[test]
fn zero_radius_support_keeps_true_contact_full_box_radius_and_typed_failure_boundaries() {
    let mut f = recorded();
    let Curve::Anchored { offset, .. } = &mut f.actor.curve else {
        unreachable!()
    };
    offset.x += 0.001;
    let ctx = context(&f, CELL, CELL.next_up());
    let native = leaf_contact(
        &f.actor.pose(CELL),
        f.capsule.as_ref(),
        &f.dynamic.pose(CELL),
        f.cuboid.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(native.dist < 0.01);
    assert!(!proof(ctx, native.normal1, &mut work()).unwrap());
    assert!(cast_full_shapes_policy(
        f.actor,
        f.capsule.as_ref(),
        f.dynamic,
        f.cuboid.as_ref(),
        CELL,
        CELL.next_up(),
        0.01,
        f64::from(H * 1e-6),
        &mut work(),
        false
    )
    .unwrap()
    .is_some());
    let f = recorded();
    let prepared = super::super::super::prepare(context(&f, CELL, CELL.next_up()), &mut work())
        .unwrap()
        .unwrap();
    // Every closed slab is a whole represented input range. A near-face proof
    // alone cannot certify its full complement, nor omit the original radius.
    let half = rp::Vector::new(0.25, 1., 1.);
    let full = box_upper(&prepared.b, [-half, half], -rp::Vector::X, &mut work())
        .unwrap()
        .unwrap();
    let mut near = [-half, half];
    near[1].x = -half.x * 0.5;
    let local = box_upper(&prepared.b, near, -rp::Vector::X, &mut work())
        .unwrap()
        .unwrap();
    assert!(local <= full);
    let original =
        crate::checkpoint_codec::encode(&(f.actor, f.dynamic, &f.capsule, &f.cuboid)).unwrap();
    let mut empty = Work {
        used: 19,
        limit: 19,
    };
    assert_eq!(
        proof(context(&f, CELL, CELL.next_up()), rp::Vector::X, &mut empty),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(empty.used, 19);
    let radius = f.capsule.as_capsule().unwrap().radius;
    let frame = union(&prepared.a);
    assert!(
        capsule_upper(
            &prepared.a,
            f.capsule.as_capsule().unwrap(),
            rp::Vector::X,
            Bound::exact(1.),
            &mut work()
        )
        .unwrap()
        .unwrap()
            >= f64::from(frame.translation[0].hi) + f64::from(radius)
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&(f.actor, f.dynamic, &f.capsule, &f.cuboid)).unwrap(),
        original
    );
    let projection = CapsuleProjection::prepare(
        &prepared.a,
        f.capsule.as_capsule().unwrap(),
        rp::Vector::X,
        Bound::exact(1.),
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(
        projection
            .upper(&[NEAR_POLE_WEIGHT], &mut work())
            .unwrap()
            .unwrap()
            >= f64::from(frame.translation[0].hi) + f64::from(radius)
    );
    // A rotated box can put the true supporting face in the nominally
    // "remaining" slab. Proving the near quarter alone would accept a real
    // contact; the complete partition must still reject it.
    let box_shape = rp::SharedShape::cuboid(1., 1., 1.);
    let cap_shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let motion = |pose| ShapeMotion {
        curve: Curve::Constant {
            pose,
            start_time: 0.,
            end_time: 1.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let box_motion = motion(rp::Pose::from_parts(
        rp::Vector::ZERO,
        rp::Rotation::from_xyzw(0., 0., 1., 0.),
    ));
    let cap_motion = motion(rp::Pose::from_translation(rp::Vector::new(1.25, 0., 0.)));
    let ctx = Context {
        a: box_motion,
        sa: box_shape.as_ref(),
        b: cap_motion,
        sb: cap_shape.as_ref(),
        start: 0.,
        end: 1.,
        clearance: 0.01,
    };
    let p = super::super::super::prepare(ctx, &mut work())
        .unwrap()
        .unwrap();
    let half = rp::Vector::ONE;
    let mut near = [-half, half];
    near[0].x = 0.5;
    assert!(
        box_upper(&p.a, near, rp::Vector::X, &mut work())
            .unwrap()
            .unwrap()
            < 0.
    );
    assert!(!separated(ctx, &p.a, &p.pa, &p.b, &p.pb, rp::Vector::X, &mut work()).unwrap());
    assert!(!separated(
        ctx,
        &Frames::new(),
        &p.pa,
        &p.b,
        &p.pb,
        rp::Vector::X,
        &mut work()
    )
    .unwrap());
    // No change to the actual point API or its signed-zero behavior follows
    // from the support-only RN(p+0) numeric identity.
    assert_eq!((-0_f32 + 0_f32).to_bits(), 0);
    assert_eq!((-0_f32).to_bits(), 0x8000_0000);
}

#[test]
fn actual_c89_static_cells_require_strict_complete_support_and_preserve_input_bytes() {
    let f = recorded();
    let before =
        crate::checkpoint_codec::encode(&(f.actor, f.dynamic, &f.capsule, &f.cuboid)).unwrap();
    let pa = ToiProxy::from_shape(f.capsule.as_ref()).unwrap();
    let pb = ToiProxy::from_shape(f.cuboid.as_ref()).unwrap();
    for time in [CELL, 0.049000050615234825, 0.04900005061523577] {
        let a = f.actor.pose(time);
        let b = f.dynamic.pose(time);
        let native =
            leaf_contact(&a, f.capsule.as_ref(), &b, f.cuboid.as_ref(), &mut work()).unwrap();
        assert!(native.dist > 0.01);
        let mut budget = work();
        assert!(strict_static(
            &a,
            f.capsule.as_ref(),
            &pa,
            &b,
            f.cuboid.as_ref(),
            &pb,
            native.normal1,
            0.01,
            &mut budget
        )
        .unwrap());
        let price = budget.used;
        for allowance in [price, price - 1] {
            let found = strict_static(
                &a,
                f.capsule.as_ref(),
                &pa,
                &b,
                f.cuboid.as_ref(),
                &pb,
                native.normal1,
                0.01,
                &mut Work {
                    used: 37,
                    limit: 37 + allowance,
                },
            );
            if allowance == price {
                assert!(found.unwrap());
            } else {
                assert_eq!(found, Err(TrajectoryError::WorkLimit));
            }
        }
        assert!(
            super::super::super::initial_support::native_clear_static_eligible(
                &a,
                f.capsule.as_ref(),
                &b,
                f.cuboid.as_ref(),
                native.normal1,
                0.01,
                &mut work()
            )
            .unwrap()
        );
    }
    // Closed equality and genuine contact cannot gain a strict-pose-cell token.
    let cuboid = rp::SharedShape::cuboid(0.25, 1., 1.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let pa = ToiProxy::from_shape(cuboid.as_ref()).unwrap();
    let pb = ToiProxy::from_shape(capsule.as_ref()).unwrap();
    for x in [0.5, 0.49] {
        assert!(!strict_static(
            &rp::Pose::IDENTITY,
            cuboid.as_ref(),
            &pa,
            &rp::Pose::from_translation(rp::Vector::new(x, 0., 0.)),
            capsule.as_ref(),
            &pb,
            rp::Vector::X,
            0.,
            &mut work()
        )
        .unwrap());
    }
    let unsupported = rp::SharedShape::capsule_y(0.25, 0.25);
    let p = ToiProxy::from_shape(unsupported.as_ref()).unwrap();
    let mut empty = Work {
        used: 11,
        limit: 11,
    };
    assert!(!strict_static(
        &rp::Pose::IDENTITY,
        unsupported.as_ref(),
        &p,
        &rp::Pose::IDENTITY,
        unsupported.as_ref(),
        &p,
        rp::Vector::X,
        0.01,
        &mut empty
    )
    .unwrap());
    assert_eq!(empty.used, 11);
    assert_eq!(
        crate::checkpoint_codec::encode(&(f.actor, f.dynamic, &f.capsule, &f.cuboid)).unwrap(),
        before
    );
}

#[test]
fn ramp_capsule_odd_output_cell_distinguishes_one_ulp_of_inward_motion() {
    let normal = rp::Vector::new(1., -2., 0.);
    let point = rp::Vector::new(0., -0.5, 0.);
    let radius = 0.4_f32;
    let limit = -f64::from(0.01_f32) * 5_f64.sqrt();
    let clear = rp::Vector::new(f32::from_bits(0x3f4f5fda), f32::from_bits(0x3fae849e), 0.);
    let check = |translation: rp::Vector| {
        let error = std::array::from_fn(|i| {
            Value::input(Float::exact(translation[i]))
                .add(Value::local(point[i], radius))
                .error
        });
        matches!(
            rounded_cap_projection(
                translation.to_array(),
                point,
                radius,
                normal,
                limit,
                error,
                CapQuery::Plane,
                &mut work(),
            )
            .unwrap(),
            CapPlane::Below
        )
    };
    let adjacent = rp::Vector::new(clear.x.next_up(), clear.y, 0.);
    assert!(check(clear));
    assert!(check(adjacent));
    let inward = rp::Vector::new(adjacent.x.next_up(), clear.y, 0.);
    // This off-pole surface point rounds into the skin on the third pose.
    let r = f64::from(radius);
    let x = r / 5_f64.sqrt() + 0.00002;
    let y = -(r * r - x * x).sqrt();
    let sample = inward + rp::Vector::new(x as f32, (f64::from(point.y) + y) as f32, 0.);
    assert!(sample.as_dvec3().dot(normal.as_dvec3()) > limit);
    assert!(!check(inward));
}

#[test]
fn village_sloped_ramp_edge_meets_the_capsule_after_a_clear_prefix() {
    let start = 0.0234375;
    let end = 0.03125;
    let domain = Domain::new(start, end).unwrap();
    let hull = rp::ConvexPolyhedron::from_convex_hull(&[
        rp::Vector::new(-32., 12., 24.),
        rp::Vector::new(32., -12., 24.),
        rp::Vector::new(32., -12., -24.),
        rp::Vector::new(-32., 12., -24.),
        rp::Vector::new(-32., -12., 24.),
        rp::Vector::new(-32., -12., -24.),
    ])
    .unwrap();
    let ramp = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::new(-48., 12., 186.)),
            start_time: start,
            end_time: end,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let cap = ShapeMotion {
        curve: Curve::Integrated(
            Kernel::from_velocity_seconds(
                rp::RigidBodyHandle::invalid(),
                domain,
                0.0078125,
                rp::Pose::from_translation(rp::Vector::new(-27.629335, 6.7694902, 156.40083)),
                rp::Vector::new(16.19159, 0.5198364, 1.9458008),
                rp::Vector::ZERO,
            )
            .unwrap(),
        ),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let capsule = rp::Capsule::new_y(1., 5.);
    let cast = |end, margin, reverse| {
        let (a, sa, b, sb): (_, &dyn rp::Shape, _, &dyn rp::Shape) = if reverse {
            (cap, &capsule, ramp, &hull)
        } else {
            (ramp, &hull, cap, &capsule)
        };
        cast_full_shapes_policy(
            a,
            sa,
            b,
            sb,
            start,
            end,
            margin,
            7.8125e-9,
            &mut work(),
            true,
        )
        .unwrap()
    };
    for reverse in [false, true] {
        assert!(cast(0.028554439544677734, 0.75, reverse).is_none());
        assert!(cast(end, 0.74, reverse).is_none());
        let hit = cast(end, 0.75, reverse).unwrap();
        assert!((0.02858570..0.02858573).contains(&hit.hit_time));
        assert!(hit.hit_time - hit.safe_time <= 7.8125e-9);
        assert!(hit.contact.dist <= 0.75);
        let contact = if reverse {
            hit.contact.flipped()
        } else {
            hit.contact
        };
        let edge_point = contact.point1.as_dvec3();
        assert_eq!(edge_point.z, 162.);
        assert_eq!(3. * (edge_point.x + 16.) + 8. * edge_point.y, 0.);
        assert!((contact.point2.as_dvec3() - edge_point).length() <= 0.75);
    }
}

use super::*;
use crate::physics3d::solver_trajectory::{self, Domain};

const SAFE: Time = 0.00013647079671130768;
const HIT: Time = 0.0001364946385695731;
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
pub(super) fn fixture() -> (
    ShapeMotion,
    ShapeMotion,
    ShapeMotion,
    rp::SharedShape,
    rp::SharedShape,
) {
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        Domain::new(0., f64::from(0.025_f32)).unwrap(),
        0.025,
        rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
        rp::Vector::new(0., -7.3886794e-9, 0.),
        rp::Vector::new(-2.7500596e-10, 2., -5.5276894e-9),
    )
    .unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let old = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(0.9999944, 0.09986183, 2.9802322e-6),
            offset: rp::Vector::new(5.6028366e-6, 0.51013815, -2.9802322e-6),
            linear_velocity: rp::Vector::new(0., -3.1974423e-14, 0.),
            rotation: rp::Rotation::IDENTITY,
        },
        ..a
    };
    let Curve::Anchored {
        carrier,
        anchor,
        offset,
        rotation,
        ..
    } = old.curve
    else {
        unreachable!()
    };
    let changed = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor,
            offset,
            rotation,
            linear_velocity: rp::Vector::new(0., f32::from_bits(0x3964_fc98), 0.),
        },
        ..old
    };
    (
        a,
        old,
        changed,
        rp::SharedShape::cuboid(2., 0.1, 2.),
        rp::SharedShape::capsule_y(0.25, 0.25),
    )
}

#[test]
fn identical_actual_safe_pose_has_identical_allowance_despite_different_relative_polynomials() {
    let (a, old, changed, sa, sb) = fixture();
    assert_eq!(
        old.pose(SAFE).translation.to_array().map(f32::to_bits),
        changed.pose(SAFE).translation.to_array().map(f32::to_bits)
    );
    assert_eq!(
        old.pose(SAFE).rotation.to_array().map(f32::to_bits),
        changed.pose(SAFE).rotation.to_array().map(f32::to_bits)
    );
    let axis = a.pose(SAFE).rotation * rp::Vector::Y;
    let x = initial_support_clearance(a, sa.as_ref(), old, sb.as_ref(), axis, SAFE, &mut work())
        .unwrap();
    let y = initial_support_clearance(
        a,
        sa.as_ref(),
        changed,
        sb.as_ref(),
        axis,
        SAFE,
        &mut work(),
    )
    .unwrap();
    assert_eq!(x.to_bits(), y.to_bits());
    assert!(x <= 0.51_f32 - 0.5 && x > 0.);
    let old_poly =
        old_polynomial(a, sa.as_ref(), old, sb.as_ref(), axis, SAFE, &mut work()).unwrap();
    let new_poly = old_polynomial(
        a,
        sa.as_ref(),
        changed,
        sb.as_ref(),
        axis,
        SAFE,
        &mut work(),
    )
    .unwrap();
    assert!(new_poly > 0.01 && old_poly < 0.01);
    let constant = ShapeMotion {
        curve: Curve::Constant {
            pose: changed.curve.com_pose(SAFE),
            start_time: 0.,
            end_time: f64::from(0.025_f32),
        },
        ..changed
    };
    assert_eq!(
        initial_support_clearance(
            a,
            sa.as_ref(),
            constant,
            sb.as_ref(),
            axis,
            SAFE,
            &mut work()
        )
        .unwrap()
        .to_bits(),
        y.to_bits()
    );
    let before = postcard::to_allocvec(&(a, old, changed)).unwrap();
    let margin = 0.01;
    // The Native witness is identical for both representations of the pose.
    let native_old = solver_trajectory::leaf_contact(
        &a.pose(SAFE),
        sa.as_ref(),
        &old.pose(SAFE),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    let native_changed = solver_trajectory::leaf_contact(
        &a.pose(SAFE),
        sa.as_ref(),
        &changed.pose(SAFE),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert_eq!(native_old.dist.to_bits(), native_changed.dist.to_bits());
    assert_eq!(
        native_old.point1.to_array().map(f32::to_bits),
        native_changed.point1.to_array().map(f32::to_bits)
    );
    assert_eq!(
        native_old.point2.to_array().map(f32::to_bits),
        native_changed.point2.to_array().map(f32::to_bits)
    );
    let box_pose = a.pose(SAFE);
    let capsule = sb.as_capsule().unwrap();
    let core = changed.pose(SAFE) * capsule.segment.a;
    // This local point is on the original box's top face. Its represented
    // world X and Z coincide with the capsule's lower segment endpoint, so
    // the axial distance minus the real radius proves contact within skin.
    let half = sa.as_cuboid().unwrap().half_extents;
    let local = rp::Vector::new(1., half.y, f32::from_bits(0x30d3_fffa));
    assert!(local.abs().cmple(half).all());
    let point = box_pose * local;
    assert_eq!(point.x.to_bits(), core.x.to_bits());
    assert_eq!(point.z.to_bits(), core.z.to_bits());
    let gap = f64::from(core.y) - f64::from(point.y) - f64::from(capsule.radius);
    assert_eq!(gap, f64::from(f32::from_bits(0x3c23_d700)));
    assert!(gap > 0. && gap < f64::from(margin));
    assert!(native_changed.dist > 0. && native_changed.dist < margin);

    let strict = solver_trajectory::cast_full_shapes(
        a,
        sa.as_ref(),
        changed,
        sb.as_ref(),
        SAFE,
        f64::from(0.025_f32),
        margin,
        2.5e-8,
        &mut work(),
    )
    .unwrap()
    .expect("original world point proves a strict initial contact");
    assert_eq!(strict.safe_time, SAFE);
    assert_eq!(strict.hit_time, SAFE);
    // Independent clear/inside controls retain the original full shapes and
    // actual safe pose rotations. A meaningful skin/4 displacement is followed
    // by the original full-leaf predicate, never an assumption about one ULP.
    let control_end = f64::from(0.025_f32);
    let fixed_a = ShapeMotion {
        curve: Curve::Constant {
            pose: a.curve.com_pose(SAFE),
            start_time: SAFE,
            end_time: control_end,
        },
        ..a
    };
    for (shift, inside) in [(margin / 4., false), (-margin / 4., true)] {
        let mut pose = changed.curve.com_pose(SAFE);
        pose.translation += rp::Vector::Y * shift;
        let control = ShapeMotion {
            curve: Curve::Constant {
                pose,
                start_time: SAFE,
                end_time: control_end,
            },
            ..changed
        };
        let native = solver_trajectory::leaf_contact(
            &fixed_a.pose(SAFE),
            sa.as_ref(),
            &control.pose(SAFE),
            sb.as_ref(),
            &mut work(),
        )
        .unwrap();
        let strict = solver_trajectory::cast_full_shapes(
            fixed_a,
            sa.as_ref(),
            control,
            sb.as_ref(),
            SAFE,
            control_end,
            margin,
            2.5e-8,
            &mut work(),
        )
        .unwrap();
        if inside {
            assert!(
                native.dist > 0. && native.dist < margin,
                "actual inside control: {native:?}"
            );
            let strict =
                strict.expect("actual positive-gap inside-skin shape is a strict initial contact");
            assert_eq!(strict.safe_time, SAFE);
            assert_eq!(strict.hit_time, SAFE);
        } else {
            assert!(native.dist > margin, "actual outside control: {native:?}");
            assert!(strict.is_none());
        }
    }
    assert!(solver_trajectory::cast_full_shapes_policy(
        a,
        sa.as_ref(),
        changed,
        sb.as_ref(),
        SAFE,
        f64::from(0.025_f32),
        margin,
        2.5e-8,
        &mut work(),
        true
    )
    .unwrap()
    .is_none());
    assert_eq!(postcard::to_allocvec(&(a, old, changed)).unwrap(), before);
    assert!(changed.pose(HIT).translation.y > old.pose(HIT).translation.y);
}

#[test]
fn static_initial_support_preserves_local_com_nonunit_quaternion_and_both_radius_graphs() {
    let (a, _, _, sa, sb) = fixture();
    for (position, q) in [
        (rp::Vector::new(0., 0.51, 0.), rp::Rotation::IDENTITY),
        (
            rp::Vector::new(8192., 8192., 0.),
            rp::Rotation::from_xyzw(0., 0., 0.70710677, 0.70710677),
        ),
        (
            rp::Vector::new(2., 3., 4.),
            rp::Rotation::from_xyzw(0., 0.25, 0., 1.),
        ),
    ] {
        let domain = Domain::new(5., 6.).unwrap();
        let k = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::invalid(),
            domain,
            0.25,
            rp::Pose::from_parts(position, q),
            rp::Vector::ZERO,
            rp::Vector::ZERO,
        )
        .unwrap();
        let b = ShapeMotion {
            curve: Curve::Integrated(k),
            local_center: rp::Vector::new(0.1, 0.2, 0.3),
            local_pose: rp::Pose::from_translation(rp::Vector::new(0.2, 0.3, 0.4)),
        };
        let constant = ShapeMotion {
            curve: Curve::Constant {
                pose: k.native.motion.start,
                start_time: 5.,
                end_time: 6.,
            },
            ..b
        };
        let aa = ShapeMotion {
            curve: Curve::Constant {
                pose: a.pose(0.),
                start_time: 5.,
                end_time: 6.,
            },
            ..a
        };
        let x = initial_support_clearance(
            aa,
            sa.as_ref(),
            b,
            sb.as_ref(),
            rp::Vector::Y,
            5.,
            &mut work(),
        )
        .unwrap();
        let y = initial_support_clearance(
            aa,
            sa.as_ref(),
            constant,
            sb.as_ref(),
            rp::Vector::Y,
            5.,
            &mut work(),
        )
        .unwrap();
        assert_eq!(x.to_bits(), y.to_bits());
        assert_eq!(
            b.pose(5.).rotation.to_array().map(f32::to_bits),
            constant.pose(5.).rotation.to_array().map(f32::to_bits)
        );
    }
}

#[test]
fn initial_closed_zero_overlap_positive_and_exact_work_remain_explicit() {
    let base = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::IDENTITY,
            start_time: 0.,
            end_time: 1.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let sa = rp::SharedShape::cuboid(2., 0.5, 2.);
    let sb = rp::SharedShape::capsule_y(0.25, 0.25);
    for y in [1_f32, 1_f32.next_up(), 1_f32.next_down()] {
        let b = ShapeMotion {
            curve: Curve::Constant {
                pose: rp::Pose::from_translation(rp::Vector::new(0., y, 0.)),
                start_time: 0.,
                end_time: 1.,
            },
            ..base
        };
        let mut measured = work();
        let gap = initial_support_clearance(
            base,
            sa.as_ref(),
            b,
            sb.as_ref(),
            rp::Vector::Y,
            0.,
            &mut measured,
        )
        .unwrap();
        assert_eq!(gap, y - 1.);
        assert_eq!(
            initial_support_clearance(
                base,
                sa.as_ref(),
                b,
                sb.as_ref(),
                rp::Vector::Y,
                0.,
                &mut Work {
                    used: 0,
                    limit: measured.used
                }
            )
            .unwrap()
            .to_bits(),
            gap.to_bits()
        );
        assert_eq!(
            initial_support_clearance(
                base,
                sa.as_ref(),
                b,
                sb.as_ref(),
                rp::Vector::Y,
                0.,
                &mut Work {
                    used: 0,
                    limit: measured.used - 1
                }
            ),
            Err(TrajectoryError::WorkLimit)
        );
    }
    // Curve::Constant explicitly permits instantaneous placement. It has
    // the same closed margin and exact admission as the interval expression.
    let instant_a = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::IDENTITY,
            start_time: 0.,
            end_time: 0.,
        },
        ..base
    };
    let instant_b = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::Y),
            start_time: 0.,
            end_time: 0.,
        },
        ..base
    };
    let mut instant_work = work();
    assert_eq!(
        initial_support_clearance(
            instant_a,
            sa.as_ref(),
            instant_b,
            sb.as_ref(),
            rp::Vector::Y,
            0.,
            &mut instant_work,
        )
        .unwrap(),
        0.
    );
    assert_eq!(
        initial_support_clearance(
            instant_a,
            sa.as_ref(),
            instant_b,
            sb.as_ref(),
            rp::Vector::Y,
            0.,
            &mut Work {
                used: 0,
                limit: instant_work.used,
            },
        )
        .unwrap(),
        0.
    );
    assert_eq!(
        initial_support_clearance(
            instant_a,
            sa.as_ref(),
            instant_b,
            sb.as_ref(),
            rp::Vector::Y,
            0.,
            &mut Work {
                used: 0,
                limit: instant_work.used - 1,
            },
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(
        initial_support_clearance(
            base,
            sa.as_ref(),
            base,
            sb.as_ref(),
            rp::Vector::Y,
            2.,
            &mut work()
        ),
        Err(TrajectoryError::InvalidTime)
    );
    assert_eq!(
        initial_support_clearance(
            base,
            sa.as_ref(),
            base,
            sb.as_ref(),
            rp::Vector::ZERO,
            0.,
            &mut work()
        ),
        Err(TrajectoryError::NonFinite)
    );
}

// Frozen previous policy, test-only comparison; not a second production path.
#[allow(clippy::too_many_arguments)]
fn old_polynomial(
    a: ShapeMotion,
    shape_a: &dyn rp::Shape,
    b: ShapeMotion,
    shape_b: &dyn rp::Shape,
    normal: rp::Vector,
    time: Time,
    work: &mut Work,
) -> Result<f32, TrajectoryError> {
    let pa = ToiProxy::from_shape(shape_a).ok_or(TrajectoryError::UnsupportedShape)?;
    let pb = ToiProxy::from_shape(shape_b).ok_or(TrajectoryError::UnsupportedShape)?;
    let ma = a.polynomial(time, time)?;
    let mb = b.polynomial(time, time)?;
    let mut axes = [rp::Vector::ZERO; 13];
    axes[0] = normal;
    let mut count = 1;
    for (motion, shape) in [(a, shape_a), (b, shape_b)] {
        if shape.as_cuboid().is_none() {
            continue;
        }
        for local in [
            rp::Vector::X,
            -rp::Vector::X,
            rp::Vector::Y,
            -rp::Vector::Y,
            rp::Vector::Z,
            -rp::Vector::Z,
        ] {
            axes[count] = motion.pose(time).rotation * local;
            count += 1;
        }
    }
    let mut best = f64::NEG_INFINITY;
    for axis in &axes[..count] {
        let Some(axis) = axis.try_normalize() else {
            return Err(TrajectoryError::NonFinite);
        };
        work.charge(1)?;
        let mut hi = f64::NEG_INFINITY;
        let mut lo = f64::INFINITY;
        for &p in pa.points() {
            work.charge(128)?;
            hi = hi.max(
                ma.project(a.local_pose * p - a.local_center, axis, ma.center)[0]
                    / ma.denominator[0],
            );
        }
        for &p in pb.points() {
            work.charge(128)?;
            lo = lo.min(
                mb.project(b.local_pose * p - b.local_center, axis, ma.center)[0]
                    / mb.denominator[0],
            );
        }
        let length = solver_trajectory::dot3(
            axis.to_array().map(f64::from),
            axis.to_array().map(f64::from),
        )
        .sqrt();
        let mut gap = (lo - hi) / length - f64::from(pa.radius) - f64::from(pb.radius);
        let qa = a.pose(time);
        let qb = b.pose(time);
        if qa.rotation.length_squared() != 1. || qb.rotation.length_squared() != 1. {
            work.charge(
                u64::try_from(pa.points().len() + pb.points().len())
                    .map_err(|_| TrajectoryError::WorkLimit)?
                    .checked_mul(128)
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            let project = |p: rp::Vector| {
                solver_trajectory::dot3(p.to_array().map(f64::from), axis.to_array().map(f64::from))
            };
            let hi = pa
                .points()
                .iter()
                .map(|&p| project(qa * p))
                .fold(f64::NEG_INFINITY, f64::max);
            let lo = pb
                .points()
                .iter()
                .map(|&p| project(qb * p))
                .fold(f64::INFINITY, f64::min);
            gap = gap.min((lo - hi) / length - f64::from(pa.radius) - f64::from(pb.radius));
        }
        best = best.max(gap);
    }
    if !best.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let value = best as f32;
    if !value.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    Ok(if f64::from(value) > best {
        f32::from_bits(if value > 0. {
            value.to_bits() - 1
        } else {
            value.to_bits() + 1
        })
    } else {
        value
    })
}

#[test]
fn oblique_local_ball_cube_does_not_become_a_large_initial_penetration_allowance() {
    let q = rp::Rotation::from_rotation_z(0.6) * rp::Rotation::from_rotation_y(0.3);
    let normal = q * rp::Vector::Y;
    let floor = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_rotation(q),
            start_time: 0.,
            end_time: f64::from(0.1_f32),
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let rider = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_parts(normal, q),
            start_time: 0.,
            end_time: f64::from(0.1_f32),
        },
        ..floor
    };
    let sa = rp::SharedShape::cuboid(2., 0.5, 2.);
    let sb = rp::SharedShape::capsule_y(0.25, 0.25);
    let a = ToiProxy::from_shape(sa.as_ref()).unwrap();
    let b = ToiProxy::from_shape(sb.as_ref()).unwrap();
    let mut hi = f64::NEG_INFINITY;
    let mut lo = f64::INFINITY;
    for &p in a.points() {
        hi = hi.max(
            project(Frame::exact(floor.pose(0.)).full_point(p, a.radius), normal)
                .unwrap()
                .hi,
        )
    }
    for &p in b.points() {
        lo = lo.min(
            project(Frame::exact(rider.pose(0.)).full_point(p, b.radius), normal)
                .unwrap()
                .lo,
        )
    }
    let cube_gap = (lo - hi) / (super::super::super::dot(normal, normal).hi.sqrt());
    assert!(cube_gap < -f64::from(b.radius) * 0.25);
    let allowance = initial_support_clearance(
        floor,
        sa.as_ref(),
        rider,
        sb.as_ref(),
        normal,
        0.,
        &mut work(),
    )
    .unwrap();
    // Reuse the original public skin as an inward control, not a widened
    // acceptance tolerance. The source cube permits much more than this.
    let skin = crate::physics3d::CharacterConfig::default().skin_width;
    assert!(allowance > -skin);
    let positive = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_parts(normal * (1. + skin * 0.5), q),
            start_time: 0.,
            end_time: f64::from(0.1_f32),
        },
        ..rider
    };
    let actual_positive = solver_trajectory::leaf_contact(
        &floor.pose(0.),
        sa.as_ref(),
        &positive.pose(0.),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    let positive_allowance = initial_support_clearance(
        floor,
        sa.as_ref(),
        positive,
        sb.as_ref(),
        normal,
        0.,
        &mut work(),
    )
    .unwrap();
    assert!(actual_positive.dist > 0. && actual_positive.dist < skin);
    assert!(positive_allowance > 0. && positive_allowance <= actual_positive.dist);
    let domain = Domain::new(0., f64::from(0.1_f32)).unwrap();
    let moving = ShapeMotion {
        curve: Curve::Integrated(
            Kernel::from_velocity_seconds(
                rp::RigidBodyHandle::invalid(),
                domain,
                0.1,
                rider.curve.com_pose(0.),
                -normal * (skin / 0.1),
                rp::Vector::ZERO,
            )
            .unwrap(),
        ),
        ..rider
    };
    let endpoint = solver_trajectory::leaf_contact(
        &floor.pose(domain.end),
        sa.as_ref(),
        &moving.pose(domain.end),
        sb.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert!(endpoint.dist < 0.);
    let hit = solver_trajectory::cast_full_shapes_policy(
        floor,
        sa.as_ref(),
        moving,
        sb.as_ref(),
        0.,
        domain.end,
        skin,
        1e-7,
        &mut work(),
        true,
    )
    .unwrap()
    .expect("real inward shape remains a contact");
    assert_eq!(hit.hit_time, 0.);
}

#[test]
fn partial_numeric_cloud_ranges_are_not_an_initial_allowance() {
    let mut frames = Frames::new();
    frames.values[0] = Frame::exact(rp::Pose::IDENTITY);
    frames.len = 1;
    let a = ToiProxy::from_array([rp::Vector::ZERO], 0.25);
    let bad = [rp::Vector::X * 3., rp::Vector::new(f32::NAN, 0., 0.)];
    let b = ToiProxy::from_points(&bad, 0.25);
    let mut axes = [crate::physics3d::solver_trajectory::SeparationAxis::EMPTY];
    axes[0].normal = rp::Vector::X;
    let complete =
        support::projection_ranges(&frames, &a, &frames, &b, &mut axes, 0., &mut work()).unwrap();
    assert!(!complete);
    assert_eq!(axes[0].full_support, Some(false));
    assert!(axes[0].lower.is_finite() && axes[0].upper.is_finite());
    // Even an implementation that left a finite first-point bound cannot
    // qualify it: the result channel is explicitly incomplete, not a gap bool.
    assert!(complete.then_some((axes[0].lower, axes[0].upper)).is_none());
    assert_eq!(
        support::projection_ranges(
            &frames,
            &a,
            &frames,
            &b,
            &mut axes,
            0.,
            &mut Work { used: 0, limit: 1 }
        ),
        Err(TrajectoryError::WorkLimit)
    );
}

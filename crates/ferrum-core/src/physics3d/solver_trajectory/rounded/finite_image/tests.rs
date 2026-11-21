use super::*;
use crate::physics3d::solver_trajectory::{Domain, Kernel};

fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
fn motion(position: rp::Vector) -> ShapeMotion {
    ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(position),
            start_time: 0.,
            end_time: 1.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn context<'a>(
    a: ShapeMotion,
    sa: &'a dyn rp::Shape,
    b: ShapeMotion,
    sb: &'a dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
) -> Context<'a> {
    Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    }
}
fn reference_axis(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<Option<bool>, TrajectoryError> {
    let mut axes = super::super::super::SeparationAxes::single(normal);
    let mut cache = super::super::AxisCache::new(
        context.a,
        context.sa,
        context.b,
        context.sb,
        context.start,
        context.end,
        context.clearance,
    );
    reference(0, work, &mut axes, &mut cache).map(Some)
}

// Frozen pre-cache source08fd. This oracle preserves its complete operation
// order; only the leaf path is qualified for this test-only child module.
#[allow(clippy::too_many_arguments)]
fn reference(
    index: usize,
    work: &mut Work,
    axes: &mut crate::physics3d::solver_trajectory::SeparationAxes,
    cache: &mut AxisCache<'_>,
) -> Result<bool, TrajectoryError> {
    let output::Context {
        a,
        sa: shape_a,
        b,
        sb: shape_b,
        start,
        end,
        clearance,
    } = cache.context();
    let normal = axes.values[index].normal;
    // The original ball query has two different radius-subtraction graphs.
    // Avoid the older ideal plane/linear shortcuts even when the entire
    // parameter image is finite; output checks both graphs or every leaf.
    if shape_a.as_ball().is_some() && shape_b.as_ball().is_some() {
        return output::separated_cached(index, work, axes, cache);
    }
    // Fixed parameter census before any original native pose evaluation. No
    // heap scratch, force integration, query callback or persistent state.
    work.charge(128)?;
    let (Some(ia), Some(ib)) = (
        Image::complete(a.curve, start, end, work)?,
        Image::complete(b.curve, start, end, work)?,
    ) else {
        return if output::separated_cached(index, work, axes, cache)? {
            Ok(true)
        } else {
            linear_separated(a, shape_a, b, shape_b, normal, start, end, clearance, work)
        };
    };
    let pa = ToiProxy::from_shape(shape_a).ok_or(TrajectoryError::UnsupportedShape)?;
    let pb = ToiProxy::from_shape(shape_b).ok_or(TrajectoryError::UnsupportedShape)?;
    let visits = pa
        .points()
        .len()
        .checked_mul(ia.len())
        .and_then(|v| v.checked_mul(if pa.radius > 0. { 1024 } else { 64 }))
        .and_then(|v| {
            pb.points()
                .len()
                .checked_mul(ib.len())
                .and_then(|n| n.checked_mul(if pb.radius > 0. { 1024 } else { 64 }))
                .and_then(|n| v.checked_add(n))
        })
        .ok_or(TrajectoryError::WorkLimit)?;
    let charge = (ia.len() + ib.len())
        .checked_mul(128)
        .and_then(|n| visits.checked_add(n))
        .and_then(|v| v.checked_add(64))
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(u64::try_from(charge).map_err(|_| TrajectoryError::WorkLimit)?)?;
    let poses_a = ia.poses(a)?;
    let poses_b = ib.poses(b)?;
    let mut upper_a = f64::NEG_INFINITY;
    let mut lower_b = f64::INFINITY;
    let mut upper_by_pose = [f64::NEG_INFINITY; 4];
    let mut lower_by_pose = [f64::INFINITY; 4];
    for (index, pose) in poses_a.values[..poses_a.len].iter().enumerate() {
        for &point in pa.points() {
            let Some(bound) = output::full_projection(*pose, *pose, point, pa.radius, normal)
            else {
                return Ok(false);
            };
            upper_a = upper_a.max(bound.hi);
            upper_by_pose[index] = upper_by_pose[index].max(bound.hi);
        }
    }
    for (index, pose) in poses_b.values[..poses_b.len].iter().enumerate() {
        for &point in pb.points() {
            let Some(bound) = output::full_projection(*pose, *pose, point, pb.radius, normal)
            else {
                return Ok(false);
            };
            lower_b = lower_b.min(bound.lo);
            lower_by_pose[index] = lower_by_pose[index].min(bound.lo);
        }
    }
    let norm2 = dot(normal, normal);
    if norm2.lo <= 0. || !norm2.hi.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let norm = norm2.sqrt();
    // Each point already includes both original radius interpretations.
    let radius = Bound::exact(f64::from(clearance)).mul(norm);
    let gap = Bound::exact(lower_b)
        .sub(Bound::exact(upper_a))
        .sub(radius)
        .lo;
    if !gap.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if gap >= 0. {
        return Ok(true);
    }
    if let Some(pairs) = common_phase::pairs(&ia, &ib) {
        work.charge(pairs.len as u64)?;
        // Every reachable common-input tuple has its own whole-shape
        // enclosure. Its nonnegative plane can refute a noisy leaf witness,
        // just like the original union support, without async cross-pairs.
        if pairs.values[..pairs.len].iter().all(|&(a_index, b_index)| {
            Bound::exact(lower_by_pose[b_index])
                .sub(Bound::exact(upper_by_pose[a_index]))
                .sub(radius)
                .lo
                >= 0.
        }) {
            return Ok(true);
        }
        for &(a_index, b_index) in &pairs.values[..pairs.len] {
            let contact = crate::physics3d::solver_trajectory::leaf_contact(
                &poses_a.values[a_index],
                shape_a,
                &poses_b.values[b_index],
                shape_b,
                work,
            )?;
            if !contact.dist.is_finite()
                || !contact.normal1.is_finite()
                || !contact.point1.is_finite()
                || !contact.point2.is_finite()
            {
                return Err(TrajectoryError::NonFinite);
            }
            if contact.dist <= clearance {
                return Ok(false);
            }
        }
        return Ok(true);
    }
    // A common separating axis can fail for the union of two differently
    // oriented rounded poses, although each *possible* full-shape query is
    // outside the original clearance. Exhaust every pair in the finite image.
    // This uses the same authoritative predicate as cast_policy's hit test;
    // unlike endpoint sampling there is no unvisited kernel parameter output.
    let pairs = poses_a
        .len
        .checked_mul(poses_b.len)
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(u64::try_from(pairs).map_err(|_| TrajectoryError::WorkLimit)?)?;
    for pose_a in &poses_a.values[..poses_a.len] {
        for pose_b in &poses_b.values[..poses_b.len] {
            // leaf_contact precharges its original support-query bound before
            // every full-shape query. No query or row is published to callers.
            let contact = crate::physics3d::solver_trajectory::leaf_contact(
                pose_a, shape_a, pose_b, shape_b, work,
            )?;
            if !contact.dist.is_finite()
                || !contact.normal1.is_finite()
                || !contact.point1.is_finite()
                || !contact.point2.is_finite()
            {
                return Err(TrajectoryError::NonFinite);
            }
            if contact.dist <= clearance {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

#[test]
fn immutable_interval_cache_matches_original_supported_leaf_pairs_and_keeps_bytes() {
    let points = [
        rp::Vector::new(-0.25, -0.25, -0.25),
        rp::Vector::new(0.25, -0.25, -0.25),
        rp::Vector::new(0., 0.25, -0.25),
        rp::Vector::new(0., 0., 0.25),
    ];
    let shapes = [
        rp::SharedShape::ball(0.25),
        rp::SharedShape::capsule_y(0.25, 0.25),
        rp::SharedShape::cuboid(0.25, 0.25, 0.25),
        rp::SharedShape::segment(-rp::Vector::Y * 0.25, rp::Vector::Y * 0.25),
        rp::SharedShape::triangle(points[0], points[1], points[2]),
        rp::SharedShape::convex_hull(&points).unwrap(),
        rp::SharedShape::round_cuboid(0.2, 0.2, 0.2, 0.05),
        rp::SharedShape::round_triangle(points[0], points[1], points[2], 0.05),
        rp::SharedShape::round_convex_hull(&points, 0.05).unwrap(),
    ];
    for sa in &shapes {
        for sb in &shapes {
            // Ball/Ball keeps its separate graph-aware production guard.
            if sa.as_ball().is_some() && sb.as_ball().is_some() {
                continue;
            }
            let a = motion(rp::Vector::ZERO);
            let b = motion(rp::Vector::X * 3.);
            let source = postcard::to_allocvec(&(a, b)).unwrap();
            let ctx = context(a, sa.as_ref(), b, sb.as_ref(), 0., 1., 0.01);
            let mut cached = Cache::new(ctx);
            let mut actual = work();
            let mut original = work();
            for normal in [rp::Vector::Y, rp::Vector::Z, rp::Vector::X, -rp::Vector::Y] {
                assert_eq!(
                    cached.separated(normal, &mut actual),
                    reference_axis(ctx, normal, &mut original),
                    "{:?}/{:?}",
                    sa.shape_type(),
                    sb.shape_type()
                );
            }
            assert!(
                actual.used < original.used,
                "executed immutable image work is not repeated for {:?}/{:?}: cached={} reference={}", sa.shape_type(), sb.shape_type(), actual.used, original.used
            );
            if cached.prepared.as_ref().unwrap().query_result == Some(Some(true)) {
                let mut hit = Work { used: 0, limit: 1 };
                assert_eq!(cached.separated(rp::Vector::X, &mut hit), Ok(Some(true)));
                assert_eq!(hit.used, 1);
                assert_eq!(
                    cached.separated(rp::Vector::ZERO, &mut work()),
                    Err(TrajectoryError::NonFinite)
                );
            }
            assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), source);
        }
    }
    assert!(!std::mem::needs_drop::<Cache<'static>>());
}

#[test]
fn cached_contact_does_not_override_a_later_original_closed_support_plane() {
    let sa = rp::SharedShape::cuboid(0.25, 0.25, 0.25);
    let sb = rp::SharedShape::ball(0.25);
    let ctx = context(
        motion(rp::Vector::ZERO),
        sa.as_ref(),
        motion(rp::Vector::X * 0.5),
        sb.as_ref(),
        0.,
        1.,
        0.,
    );
    let mut cache = Cache::new(ctx);
    let mut used = work();
    assert_eq!(
        cache.separated(rp::Vector::Y, &mut used).unwrap(),
        Some(false)
    );
    assert_eq!(
        cache.prepared.as_ref().unwrap().query_result,
        Some(Some(false))
    );
    assert_eq!(
        cache.separated(rp::Vector::X, &mut used).unwrap(),
        Some(true)
    );
    assert_eq!(
        reference_axis(ctx, rp::Vector::X, &mut work()).unwrap(),
        Some(true)
    );
    assert_eq!(
        cache.prepared.as_ref().unwrap().query_result,
        Some(Some(false))
    );
}

#[test]
fn common_input_and_collapsed_images_keep_the_original_provenance() {
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let h = 0.03125_f32;
    let kernel = |slot, x, v| {
        Kernel::from_velocity(
            rp::RigidBodyHandle::from_raw_parts(slot, 0),
            Domain::new(0., Time::from(h)).unwrap(),
            rp::Pose::from_translation(rp::Vector::X * x),
            rp::Vector::X * v,
            rp::Vector::ZERO,
        )
        .unwrap()
    };
    let at = 0.0078125_f32;
    let boundary = (f64::from(at) + f64::from(at.next_up())) * 0.5;
    let a = ShapeMotion {
        curve: Curve::Integrated(kernel(0, 0., 1.)),
        ..motion(rp::Vector::ZERO)
    };
    let b = ShapeMotion {
        curve: Curve::Integrated(kernel(1, 0.5, 1.)),
        ..motion(rp::Vector::ZERO)
    };
    let ctx = context(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        boundary.next_down(),
        boundary.next_up(),
        0.01,
    );
    let mut cache = Cache::new(ctx);
    assert_eq!(
        cache.separated(rp::Vector::Y, &mut work()),
        reference_axis(ctx, rp::Vector::Y, &mut work())
    );
    let prepared = cache.prepared.as_ref().unwrap();
    assert!(prepared.ia.input_interval.is_some());
    assert!(common_phase::pairs(&prepared.ia, &prepared.ib).is_some());

    let a = ShapeMotion {
        curve: Curve::Integrated(kernel(0, 0., 0.)),
        ..a
    };
    let b = ShapeMotion {
        curve: Curve::Integrated(kernel(1, 0.5, 0.)),
        ..b
    };
    let ctx = context(
        a,
        shape.as_ref(),
        b,
        shape.as_ref(),
        0.,
        Time::from(h),
        0.01,
    );
    let mut cache = Cache::new(ctx);
    assert_eq!(
        cache.separated(rp::Vector::Y, &mut work()),
        reference_axis(ctx, rp::Vector::Y, &mut work())
    );
    let prepared = cache.prepared.as_ref().unwrap();
    assert!(prepared.ia.input_interval.is_none() && prepared.ib.input_interval.is_none());
    assert!(common_phase::pairs(&prepared.ia, &prepared.ib).is_none());
}

#[test]
fn declined_image_and_failed_work_never_become_a_partial_clear_certificate() {
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let original = Kernel::from_velocity(
        rp::RigidBodyHandle::invalid(),
        Domain::new(0., 1.).unwrap(),
        rp::Pose::IDENTITY,
        rp::Vector::ZERO,
        rp::Vector::Y,
    )
    .unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(original),
        ..motion(rp::Vector::ZERO)
    };
    let ctx = context(
        a,
        shape.as_ref(),
        motion(rp::Vector::X),
        shape.as_ref(),
        0.,
        1.,
        0.01,
    );
    let mut cache = Cache::new(ctx);
    let mut used = work();
    assert_eq!(cache.separated(rp::Vector::X, &mut used).unwrap(), None);
    let first = used.used;
    assert_eq!(cache.separated(rp::Vector::Y, &mut used).unwrap(), None);
    assert_eq!(used.used - first, 1);
    assert!(cache.prepared.is_none());

    let a = motion(rp::Vector::ZERO);
    let b = motion(rp::Vector::X * 0.25);
    let ctx = context(a, shape.as_ref(), b, shape.as_ref(), 0., 1., 0.01);
    let source = postcard::to_allocvec(&(a, b)).unwrap();
    let mut measured = work();
    measured.used = 17;
    let result = Cache::new(ctx)
        .separated(rp::Vector::Y, &mut measured)
        .unwrap();
    let mut exact = Work {
        used: 17,
        limit: measured.used,
    };
    assert_eq!(
        Cache::new(ctx)
            .separated(rp::Vector::Y, &mut exact)
            .unwrap(),
        result
    );
    let mut below = Work {
        used: 17,
        limit: measured.used - 1,
    };
    let mut cache = Cache::new(ctx);
    assert_eq!(
        cache.separated(rp::Vector::Y, &mut below),
        Err(TrajectoryError::WorkLimit)
    );
    assert!(cache
        .prepared
        .as_ref()
        .is_none_or(|p| p.query_result.is_none()));
    assert_eq!(postcard::to_allocvec(&(a, b)).unwrap(), source);

    let mut cache = Cache::new(ctx);
    let mut used = work();
    assert_eq!(
        cache.separated(rp::Vector::Y, &mut used).unwrap(),
        Some(false)
    );
    let first = used.used;
    let axis_price = cache.prepared.as_ref().unwrap().axis_work;
    assert_eq!(
        cache.separated(rp::Vector::Z, &mut used).unwrap(),
        Some(false)
    );
    assert_eq!(used.used - first, 1 + axis_price);
}

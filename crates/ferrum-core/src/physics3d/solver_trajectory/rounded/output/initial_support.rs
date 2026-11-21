//! Static full-shape support and a distinct noninward existing-contact band.
//! Geometry uses actual pose bits only. The policy band measures those same
//! F32 translation cells; it neither changes shape distance nor physical input.
use super::*;
const MAX_AXES: usize = 13;

#[derive(Clone, Copy)]
pub(in crate::physics3d::solver_trajectory) struct InitialSupportAllowance {
    pub geometry: f32,
    pub noninward_stability: f32,
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn initial_support_clearance(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    time: Time,
    work: &mut Work,
) -> Result<f32, TrajectoryError> {
    Ok(measure(a, sa, b, sb, normal, time, work, false)?.geometry)
}

#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn initial_support_allowances(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    time: Time,
    work: &mut Work,
) -> Result<InitialSupportAllowance, TrajectoryError> {
    measure(a, sa, b, sb, normal, time, work, true)
}

// The full RN cell's larger half is the outward-facing adjacent spacing / 2.
// abs handles either signed binade edge. Zero includes subnormal half-spacing;
// MAX uses its finite predecessor spacing up to the original overflow tie.
fn cell_half(value: f32) -> Result<f64, TrajectoryError> {
    if !value.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let magnitude = value.abs();
    let next = magnitude.next_up();
    Ok(if next.is_finite() {
        (f64::from(next) - f64::from(magnitude)) * 0.5
    } else {
        (f64::from(magnitude) - f64::from(magnitude.next_down())) * 0.5
    })
}
fn translation_cells(poses: [rp::Pose; 2]) -> Result<[f64; 3], TrajectoryError> {
    let mut result = [0.; 3];
    for (axis, value) in result.iter_mut().enumerate() {
        *value = Bound::exact(cell_half(poses[0].translation[axis])?)
            .add(Bound::exact(cell_half(poses[1].translation[axis])?))
            .hi;
    }
    Ok(result)
}
fn normal_cell_projection(
    cells: [f64; 3],
    axis: rp::Vector,
    norm: Bound,
) -> Result<f64, TrajectoryError> {
    let mut sum = Bound::exact(0.);
    for (cell, coordinate) in cells.into_iter().zip(axis.to_array()) {
        sum = sum.add(Bound::exact(cell).mul(Bound::exact(f64::from(coordinate).abs())));
    }
    if !sum.finite() || !norm.finite() || norm.lo <= 0. {
        return Err(TrajectoryError::NonFinite);
    }
    let hi = if norm.is_exact(1.) {
        sum.hi
    } else {
        (sum.hi / norm.lo).next_up()
    };
    if !hi.is_finite() || hi < 0. {
        return Err(TrajectoryError::NonFinite);
    }
    Ok(hi)
}
fn floor_f32(value: f64) -> Result<f32, TrajectoryError> {
    let rounded = value as f32;
    if !value.is_finite() || !rounded.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    Ok(if f64::from(rounded) > value {
        rounded.next_down()
    } else {
        rounded
    })
}

#[allow(clippy::too_many_arguments)]
fn measure(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    time: Time,
    work: &mut Work,
    stability: bool,
) -> Result<InitialSupportAllowance, TrajectoryError> {
    work.charge(512)?;
    for curve in [a.curve, b.curve] {
        let (start, end) = curve.times();
        if !time.is_finite()
            || !start.is_finite()
            || !end.is_finite()
            || end < start
            || (end == start && !matches!(curve, Curve::Constant { .. }))
            || !(end - start).is_finite()
            || time < start
            || time > end
        {
            return Err(TrajectoryError::InvalidTime);
        }
    }
    let poses = [a.pose(time), b.pose(time)];
    if let Some(projection) = cardinal_projection(poses, sa, sb, normal, stability, work)? {
        return Ok(projection);
    }
    let projection = if let Some(projection) =
        project_cardinal_static(poses, sa, sb, normal, work, stability)?
    {
        projection
    } else {
        let (pa, pb, count) = admit(poses, sa, sb, normal, work, stability)?;
        project_static(poses, sa, sb, &pa, &pb, normal, count, work, stability)?
    };
    let geometry = floor_f32(projection.signed_lower)?;
    // Preserve the original zero/negative overlap exactly; only a positive
    // existing gap has a finite nonnegative stability band.
    let noninward_stability = if geometry <= 0. {
        geometry
    } else {
        floor_f32(projection.noninward_lower.max(0.))?
    };
    Ok(InitialSupportAllowance {
        geometry,
        noninward_stability,
    })
}

/// The complete static projection contains six cardinal directions and the
/// provided contact axis. Omitting any other cuboid vertices is safe only
/// when that extra axis is cardinal as well and both rotations are identity.
fn cardinal_box_capsule<'a>(
    poses: [rp::Pose; 2],
    sa: &'a dyn rp::Shape,
    sb: &'a dyn rp::Shape,
    normal: rp::Vector,
) -> Option<(usize, &'a rp::Cuboid, &'a rp::Capsule)> {
    let normal = normal.abs();
    if normal != rp::Vector::X && normal != rp::Vector::Y && normal != rp::Vector::Z {
        return None;
    }
    if poses
        .iter()
        .any(|p| !p.is_finite() || p.rotation != rp::Rotation::IDENTITY)
    {
        return None;
    }
    if let (Some(cube), Some(cap)) = (sa.as_cuboid(), sb.as_capsule()) {
        Some((0, cube, cap))
    } else {
        Some((1, sb.as_cuboid()?, sa.as_capsule()?))
    }
}

/// Two opposite cuboid vertices have exactly the same coordinate hull as all
/// eight. They attain both endpoints of every projection used here, and
/// preserve the per-coordinate F32 error ledger of the complete cloud.
fn cardinal_box_proxy(
    poses: [rp::Pose; 2],
    sa: &dyn rp::Shape,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
) -> Option<(usize, ToiProxy<'static>)> {
    let (index, cube, _) = cardinal_box_capsule(poses, sa, sb, normal)?;
    let half = cube.half_extents;
    if !half.is_finite() || half.min_element() <= 0. {
        return None;
    }
    Some((index, ToiProxy::from_array([-half, half], 0.)))
}

/// For aligned boxes and capsules the general projection visits only the six
/// cardinal directions (the contact axis is a duplicate). Bound its result
/// from both sides. The original rounded full hull gives the lower endpoint;
/// the actual rounded core with its real radius limits every valid support
/// certificate from above. Return only when the original F32 policy output
/// is unambiguous, including the independent noninward translation band.
fn cardinal_projection(
    poses: [rp::Pose; 2],
    sa: &dyn rp::Shape,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    stability: bool,
    work: &mut Work,
) -> Result<Option<InitialSupportAllowance>, TrajectoryError> {
    let Some((best, stable)) = cardinal_bounds(poses, sa, sb, normal, stability, work)? else {
        return Ok(None);
    };
    let geometry = floor_f32(best[0])?;
    let noninward_stability = floor_f32(stable[0])?;
    Ok((geometry.to_bits() == floor_f32(best[1])?.to_bits()
        && noninward_stability.to_bits() == floor_f32(stable[1])?.to_bits())
    .then_some(InitialSupportAllowance {
        geometry,
        noninward_stability,
    }))
}

type CardinalBounds = ([f64; 2], [f64; 2]);

fn cardinal_bounds(
    poses: [rp::Pose; 2],
    sa: &dyn rp::Shape,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    stability: bool,
    work: &mut Work,
) -> Result<Option<CardinalBounds>, TrajectoryError> {
    let Some((index, cube, cap)) = cardinal_box_capsule(poses, sa, sb, normal) else {
        return Ok(None);
    };
    let cube_pose = poses[index];
    let cap_pose = poses[1 - index];
    work.charge(768)?;
    if !cube.half_extents.is_finite()
        || cube.half_extents.min_element() < 0.
        || !cap.segment.a.is_finite()
        || !cap.segment.b.is_finite()
        || !cap.radius.is_finite()
        || cap.radius < 0.
    {
        return Ok(None);
    }
    let cells = if stability {
        translation_cells(poses)?
    } else {
        [0.; 3]
    };
    let mut best = [f64::NEG_INFINITY; 2];
    let mut stable = best;
    for (i, cell) in cells.into_iter().enumerate() {
        for sign in [-1., 1.] {
            let local = (sign * cap.segment.a[i]).min(sign * cap.segment.b[i]);
            let center = sign * cap_pose.translation[i];
            let core = center + local;
            let world = real_float_sum(core, -cap.radius);
            let pole = center + (local - cap.radius);
            let face = sign * cube_pose.translation[i] + cube.half_extents[i];
            if !world.finite() || !pole.is_finite() || !face.is_finite() {
                return Ok(None);
            }
            let rounded_world = floor_f32(world.lo)?;
            let coarse = f64::from(rounded_world.min(pole));
            let gaps = [
                Bound::exact(coarse).sub(Bound::exact(f64::from(face))).lo,
                Bound::exact(world.hi).sub(Bound::exact(f64::from(face))).hi,
            ];
            for (j, gap) in gaps.into_iter().enumerate() {
                best[j] = best[j].max(gap);
                let adjusted = if gap > 0. {
                    let d = Bound::exact(gap).sub(Bound::exact(cell));
                    (if j == 0 { d.lo } else { d.hi }).max(0.)
                } else {
                    gap
                };
                stable[j] = stable[j].max(adjusted);
            }
        }
    }
    Ok(Some((best, stable)))
}

// A missing projection is distinct from a signed geometric lower bound. Zero
// cannot represent unavailable proof when the selected margin is negative.
struct StaticProjection {
    signed_lower: f64,
    noninward_lower: f64,
}

/// Run the same original support calculation along scalar coordinates for
/// known identity Box/Capsule poses. The general fallback remains authoritative
/// when either signed bound cannot be evaluated by this specialization.
fn project_cardinal_static(
    poses: [rp::Pose; 2],
    sa: &dyn rp::Shape,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    work: &mut Work,
    stability: bool,
) -> Result<Option<StaticProjection>, TrajectoryError> {
    let Some((index, cube, capsule)) = cardinal_box_capsule(poses, sa, sb, normal) else {
        return Ok(None);
    };
    let half = cube.half_extents;
    if !half.is_finite()
        || half.min_element() <= 0.
        || !capsule.radius.is_finite()
        || capsule.radius <= 0.
        || !capsule.segment.a.is_finite()
        || !capsule.segment.b.is_finite()
    {
        return Ok(None);
    }
    work.charge(1024 + if stability { 256 } else { 0 })?;
    let cells = if stability {
        translation_cells(poses)?
    } else {
        [0.; 3]
    };
    let Some(cube) =
        support::static_cardinal_ranges(poses[index].translation, [-half, half], 0., work)?
    else {
        return Ok(None);
    };
    let Some(capsule) = support::static_cardinal_ranges(
        poses[1 - index].translation,
        [capsule.segment.a, capsule.segment.b],
        capsule.radius,
        work,
    )?
    else {
        return Ok(None);
    };
    let ([coarse_a, tight_a], [coarse_b, tight_b]) = if index == 0 {
        (cube, capsule)
    } else {
        (capsule, cube)
    };
    let mut best = f64::NEG_INFINITY;
    let mut stable = best;
    for axis in [
        normal,
        rp::Vector::X,
        -rp::Vector::X,
        rp::Vector::Y,
        -rp::Vector::Y,
        rp::Vector::Z,
        -rp::Vector::Z,
    ] {
        let i = if axis.x != 0. {
            0
        } else if axis.y != 0. {
            1
        } else {
            2
        };
        let gap = |a: Bound, b: Bound| {
            let (lower, upper) = if axis[i] > 0. {
                (b.lo, a.hi)
            } else {
                (-b.hi, -a.lo)
            };
            Bound::exact(lower).sub(Bound::exact(upper)).lo
        };
        let normalized = gap(coarse_a[i], coarse_b[i]).max(gap(tight_a[i], tight_b[i]));
        best = best.max(normalized);
        let adjusted = if stability && normalized > 0. {
            Bound::exact(normalized)
                .sub(Bound::exact(cells[i]))
                .lo
                .max(0.)
        } else {
            normalized
        };
        stable = stable.max(adjusted);
    }
    Ok(Some(StaticProjection {
        signed_lower: best,
        noninward_lower: stable,
    }))
}

fn admit<'a>(
    poses: [rp::Pose; 2],
    sa: &'a dyn rp::Shape,
    sb: &'a dyn rp::Shape,
    normal: rp::Vector,
    work: &mut Work,
    stability: bool,
) -> Result<(ToiProxy<'a>, ToiProxy<'a>, usize), TrajectoryError> {
    let mut pa = ToiProxy::from_shape(sa).ok_or(TrajectoryError::UnsupportedShape)?;
    let mut pb = ToiProxy::from_shape(sb).ok_or(TrajectoryError::UnsupportedShape)?;
    if let Some((index, proxy)) = cardinal_box_proxy(poses, sa, sb, normal) {
        if index == 0 {
            pa = proxy;
        } else {
            pb = proxy;
        }
    }
    if !pa.radius.is_finite() || pa.radius < 0. || !pb.radius.is_finite() || pb.radius < 0. {
        return Err(TrajectoryError::NonFinite);
    }
    let count =
        1 + 6 * (usize::from(sa.as_cuboid().is_some()) + usize::from(sb.as_cuboid().is_some()));
    let points = pa
        .points()
        .len()
        .checked_add(pb.points().len())
        .ok_or(TrajectoryError::WorkLimit)?;
    let transform = |p: &ToiProxy<'_>| -> Option<usize> {
        p.points()
            .len()
            .checked_mul(if p.radius > 0. { 1024 } else { 128 })
    };
    // Existing full-plane point-transform units and batched support's 64 per
    // point/axis dot. All visits/transform/normal work precede the first pose
    // evaluation or cloud traversal. This is logical work, not CPU/RSS.
    let cost = transform(&pa)
        .and_then(|n| n.checked_add(transform(&pb)?))
        .and_then(|n| points.checked_mul(count)?.checked_mul(64)?.checked_add(n))
        .and_then(|n| count.checked_mul(256)?.checked_add(n))
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(u64::try_from(cost).map_err(|_| TrajectoryError::WorkLimit)?)?;
    if stability {
        // Six represented translation cells and one projection per original
        // axis. Admit all new visits before pose/cell arithmetic, same Work.
        work.charge(256 + 64 * count as u64)?;
    }
    Ok((pa, pb, count))
}

#[allow(clippy::too_many_arguments)]
fn project_static(
    poses: [rp::Pose; 2],
    sa: &dyn rp::Shape,
    sb: &dyn rp::Shape,
    pa: &ToiProxy<'_>,
    pb: &ToiProxy<'_>,
    normal: rp::Vector,
    count: usize,
    work: &mut Work,
    stability: bool,
) -> Result<StaticProjection, TrajectoryError> {
    if poses.iter().any(|p| !p.is_finite()) {
        return Err(TrajectoryError::NonFinite);
    }
    let cells = if stability {
        Some(translation_cells(poses)?)
    } else {
        None
    };
    let mut axes = [rp::Vector::ZERO; MAX_AXES];
    axes[0] = normal;
    let mut len = 1;
    for (pose, shape) in poses.into_iter().zip([sa, sb]) {
        if shape.as_cuboid().is_none() {
            continue;
        }
        for axis in [
            rp::Vector::X,
            -rp::Vector::X,
            rp::Vector::Y,
            -rp::Vector::Y,
            rp::Vector::Z,
            -rp::Vector::Z,
        ] {
            axes[len] = pose.rotation * axis;
            len += 1;
        }
    }
    debug_assert_eq!(len, count);
    for axis in &mut axes[..len] {
        *axis = axis.try_normalize().ok_or(TrajectoryError::NonFinite)?;
    }
    let mut upper = [f64::NEG_INFINITY; MAX_AXES];
    let mut lower = [f64::INFINITY; MAX_AXES];
    for (pose, proxy, is_a) in [(poses[0], pa, true), (poses[1], pb, false)] {
        // No normalization or rearrangement: pose already contains the exact
        // COM.prepend(-local_center)*local_pose F32 output.
        let frame = Frame::exact(pose);
        for &vertex in proxy.points() {
            let point = frame.full_point(vertex, proxy.radius);
            for (i, &axis) in axes[..len].iter().enumerate() {
                let projection = project(point, axis).ok_or(TrajectoryError::NonFinite)?;
                if is_a {
                    upper[i] = upper[i].max(projection.hi)
                } else {
                    lower[i] = lower[i].min(projection.lo)
                }
            }
        }
    }
    // A coordinate cube is a valid enclosure but can lose most of a rotated
    // ball's correlation. A loose negative bound must not become new overlap
    // authority. Intersect its per-axis gap with the existing Euclidean-radius
    // plus original-F32-error support bound, using exactly the same static
    // actual poses. Neither bound assumes an exactly unit quaternion.
    let mut tight = [crate::physics3d::solver_trajectory::SeparationAxis::EMPTY; MAX_AXES];
    for (slot, &normal) in tight[..len].iter_mut().zip(&axes[..len]) {
        slot.normal = normal;
    }
    let static_frames = |pose| {
        let mut frames = Frames::new();
        frames.values[0] = Frame::exact(pose);
        frames.len = 1;
        frames
    };
    let complete = support::projection_ranges(
        &static_frames(poses[0]),
        pa,
        &static_frames(poses[1]),
        pb,
        &mut tight[..len],
        0.,
        work,
    )?;
    let mut best = f64::NEG_INFINITY;
    let mut stable = f64::NEG_INFINITY;
    for (i, &axis) in axes[..len].iter().enumerate() {
        let norm2 = super::super::dot(axis, axis);
        if !norm2.finite() || norm2.lo <= 0. {
            return Err(TrajectoryError::NonFinite);
        }
        let norm = norm2.sqrt();
        if !norm.finite() || norm.lo <= 0. {
            return Err(TrajectoryError::NonFinite);
        }
        let mut gap = Bound::exact(lower[i]).sub(Bound::exact(upper[i])).lo;
        if complete && tight[i].lower.is_finite() && tight[i].upper.is_finite() {
            gap = gap.max(
                Bound::exact(tight[i].lower)
                    .sub(Bound::exact(tight[i].upper))
                    .lo,
            );
        }
        if !gap.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let normalized = if norm.is_exact(1.) || gap == 0. {
            gap
        } else {
            // Positive and negative quotients need opposite norm endpoints.
            (gap / if gap > 0. { norm.hi } else { norm.lo }).next_down()
        };
        if !normalized.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        best = best.max(normalized);
        // This policy band is separate from the full-shape geometric lower
        // bound above. It never adds overlap authority to a nonnegative gap.
        let noninward = if let Some(cells) = cells {
            if normalized > 0. {
                Bound::exact(normalized)
                    .sub(Bound::exact(normal_cell_projection(cells, axis, norm)?))
                    .lo
                    .max(0.)
            } else {
                normalized
            }
        } else {
            normalized
        };
        stable = stable.max(noninward);
    }
    if best < 0. && (pa.radius > 0. || pb.radius > 0.) && !complete {
        // A failed tight projection is not permission to reinterpret the
        // rotated local cube's excess radius as existing penetration.
        return Err(TrajectoryError::Unresolved);
    }
    Ok(StaticProjection {
        signed_lower: best,
        noninward_lower: stable,
    })
}

/// Original complete signed static support at already evaluated collider poses.
/// No COM/local transform, normalization, contact query or time traversal is
/// repeated. Missing tight proof is not a zero-distance geometric bound.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d) fn static_signed_support_lower(
    pose_a: &rp::Pose,
    sa: &dyn rp::Shape,
    pose_b: &rp::Pose,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<Option<f64>, TrajectoryError> {
    work.charge(512)?;
    let poses = [*pose_a, *pose_b];
    if let Some(projection) = project_cardinal_static(poses, sa, sb, normal, work, false)? {
        return Ok(Some(projection.signed_lower));
    }
    let (pa, pb, count) = match admit(poses, sa, sb, normal, work, false) {
        Ok(admitted) => admitted,
        Err(TrajectoryError::UnsupportedShape) => return Ok(None),
        Err(error) => return Err(error),
    };
    match project_static(poses, sa, sb, &pa, &pb, normal, count, work, false) {
        Ok(projection) => Ok(Some(projection.signed_lower)),
        Err(TrajectoryError::Unresolved) => Ok(None),
        Err(error) => Err(error),
    }
}

/// Zero-radius leaves keep the original Native-only image predicate. Rounded
/// leaves also require the existing complete signed static lower bound;
/// failing to find a positive point witness can never prove NoHit.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn native_clear_static_eligible(
    pose_a: &rp::Pose,
    sa: &dyn rp::Shape,
    pose_b: &rp::Pose,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if !world_radius_pair(sa, sb) {
        return Ok(true);
    }
    let (Some(pa), Some(pb)) = (ToiProxy::from_shape(sa), ToiProxy::from_shape(sb)) else {
        return Ok(false);
    };
    native_clear_static_eligible_with_proxies(
        pose_a, sa, &pa, pose_b, sb, &pb, normal, clearance, work,
    )
}

// Finite images already own the original proxy clouds. Reuse them and try
// the original exact-pose full-point plane before the tight signed 13-axis
// fallback. Every visited transform is still admitted at its original price.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory::rounded) fn native_clear_static_eligible_with_proxies(
    pose_a: &rp::Pose,
    sa: &dyn rp::Shape,
    pa: &ToiProxy<'_>,
    pose_b: &rp::Pose,
    sb: &dyn rp::Shape,
    pb: &ToiProxy<'_>,
    normal: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if pa.radius == 0. && pb.radius == 0. {
        return Ok(true);
    }
    if !clearance.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if let Some(([lower, upper], _)) =
        cardinal_bounds([*pose_a, *pose_b], sa, sb, normal, false, work)?
    {
        if lower > f64::from(clearance) {
            return Ok(true);
        }
        if upper <= f64::from(clearance) {
            // Neither the original full-point plane nor its signed support
            // refinement can exceed this upper bound. The strict cuboid
            // feature check can still supply an independent certificate.
            return super::support::exact_box_strict_static(
                pose_a, sa, pa, pose_b, sb, pb, normal, clearance, work,
            );
        }
    }
    let cardinal = cardinal_box_proxy([*pose_a, *pose_b], sa, sb, normal);
    let (plane_a, plane_b) = match &cardinal {
        Some((0, proxy)) => (proxy, pb),
        Some((1, proxy)) => (pa, proxy),
        _ => (pa, pb),
    };
    let transform_cost = |proxy: &ToiProxy<'_>| {
        proxy
            .points()
            .len()
            .checked_mul(if proxy.radius > 0. { 1024 } else { 128 })
    };
    let cost = transform_cost(plane_a)
        .and_then(|a| a.checked_add(transform_cost(plane_b)?))
        .and_then(|n| n.checked_add(256))
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(u64::try_from(cost).map_err(|_| TrajectoryError::WorkLimit)?)?;
    if !clearance.is_finite()
        || !pa.radius.is_finite()
        || pa.radius < 0.
        || !pb.radius.is_finite()
        || pb.radius < 0.
    {
        return Err(TrajectoryError::NonFinite);
    }
    let norm2 = super::super::dot(normal, normal);
    if !norm2.finite() || norm2.lo <= 0. {
        return Err(TrajectoryError::NonFinite);
    }
    let norm = norm2.sqrt();
    let mut upper = f64::NEG_INFINITY;
    let mut lower = f64::INFINITY;
    let mut complete = true;
    for &point in plane_a.points() {
        if let Some(value) = full_projection(*pose_a, *pose_a, point, plane_a.radius, normal) {
            upper = upper.max(value.hi);
        } else {
            complete = false;
            break;
        }
    }
    if complete {
        for &point in plane_b.points() {
            if let Some(value) = full_projection(*pose_b, *pose_b, point, plane_b.radius, normal) {
                lower = lower.min(value.lo);
            } else {
                complete = false;
                break;
            }
        }
    }
    let margin = Bound::exact(f64::from(clearance)).mul(norm);
    if complete
        && upper.is_finite()
        && lower.is_finite()
        && margin.finite()
        && Bound::exact(lower).sub(Bound::exact(upper)).sub(margin).lo > 0.
    {
        return Ok(true);
    }
    if static_signed_support_lower(pose_a, sa, pose_b, sb, normal, work)?
        .is_some_and(|lower| lower > f64::from(clearance))
    {
        return Ok(true);
    }
    // Native-clear alone is not full-world separation. Only after both older
    // complete bounds failed, try the tighter *strict* whole-shape support at
    // these already evaluated collider poses. Allowance values are untouched.
    super::support::exact_box_strict_static(pose_a, sa, pa, pose_b, sb, pb, normal, clearance, work)
}

pub(in crate::physics3d::solver_trajectory) fn world_radius_pair(
    sa: &dyn rp::Shape,
    sb: &dyn rp::Shape,
) -> bool {
    [sa, sb]
        .into_iter()
        .any(|shape| ToiProxy::from_shape(shape).is_some_and(|proxy| proxy.radius > 0.))
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod stability_tests;

#[cfg(test)]
mod signed_tests;

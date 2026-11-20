//! Broad-phase enclosures of the original F32 motion graph, not endpoint
//! spheres. This child shares the existing complete frame arithmetic; it
//! neither changes a Native pose nor allocates a replacement shape.
use super::*;
use rapier3d::parry::{
    bounding_volume::{Aabb, BoundingVolume},
    shape::TypedShape,
};

// Same finite subdivision depth as the chronological cast. Only unresolved
// intervals occupy this fixed stack; no heap/capacity or persistent data exists.
const MAX_DEPTH: u8 = 48;
const STACK: usize = MAX_DEPTH as usize + 1;
#[derive(Clone, Copy)]
struct Interval {
    start: Time,
    end: Time,
    depth: u8,
}
#[derive(Clone, Copy)]
struct Hull {
    core: Translation,
    radius: f32,
}

fn include(hull: &mut Option<Translation>, point: rp::Vector) -> Result<(), TrajectoryError> {
    if !point.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let point = exact_vector(point);
    *hull = Some(match *hull {
        None => point,
        Some(old) => union(old, point),
    });
    Ok(())
}
fn union(a: Translation, b: Translation) -> Translation {
    std::array::from_fn(|i| union_axis(a[i], b[i]))
}
fn union_axis(a: Float, b: Float) -> Float {
    Float::span(
        if a.lo.total_cmp(&b.lo).is_le() {
            a.lo
        } else {
            b.lo
        },
        if a.hi.total_cmp(&b.hi).is_ge() {
            a.hi
        } else {
            b.hi
        },
    )
}
fn hull(shape: &dyn rp::Shape, work: &mut Work) -> Result<Hull, TrajectoryError> {
    work.charge(32)?;
    let mut core = None;
    let radius = match shape.as_typed_shape() {
        TypedShape::TriMesh(mesh) => {
            // A triangle borrows these exact source vertices. Including also
            // unreferenced vertices is conservative and avoids index/BVH scans.
            work.charge(
                (mesh.vertices().len() as u64)
                    .checked_mul(8)
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            for &point in mesh.vertices() {
                include(&mut core, point)?;
            }
            0.
        }
        TypedShape::HeightField(field) => {
            // The iterator may skip many removed cells before yielding: prepay
            // the complete cell domain before constructing/visiting it. The
            // generated triangles retain original grid/scale F32 operations.
            let cells = field
                .nrows()
                .checked_mul(field.ncols())
                .and_then(|n| n.checked_mul(96))
                .ok_or(TrajectoryError::WorkLimit)?;
            work.charge(u64::try_from(cells).map_err(|_| TrajectoryError::WorkLimit)?)?;
            for triangle in field.triangles() {
                for point in [triangle.a, triangle.b, triangle.c] {
                    include(&mut core, point)?;
                }
            }
            // An entirely removed field has no geometry. Any finite box is
            // an enclosure; retain its original finite extent rather than
            // inventing an infinite box or marking the shape unsupported.
            if core.is_none() {
                let empty = shape.compute_local_aabb();
                include(&mut core, empty.mins)?;
                include(&mut core, empty.maxs)?;
            }
            0.
        }
        _ => {
            let proxy = ToiProxy::from_shape(shape).ok_or(TrajectoryError::UnsupportedShape)?;
            work.charge(
                (proxy.points().len() as u64)
                    .checked_mul(8)
                    .ok_or(TrajectoryError::WorkLimit)?,
            )?;
            for &point in proxy.points() {
                include(&mut core, point)?;
            }
            proxy.radius
        }
    };
    if !radius.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if radius < 0. {
        return Err(TrajectoryError::InvalidReference);
    }
    Ok(Hull {
        core: core.ok_or(TrajectoryError::InvalidReference)?,
        radius,
    })
}

fn full_hull(frame: Frame, hull: Hull) -> Translation {
    // A hull of the *whole* core cloud includes every convex interior point.
    // Transforming only its original vertices would not bound F32 roundoff
    // at an interior point. Original scalar operations consume interval inputs.
    let core = frame.point_range(hull.core);
    if hull.radius == 0. {
        return core;
    }
    let local = hull
        .core
        .map(|v| Float::span(v.lo - hull.radius, v.hi + hull.radius));
    let local = frame.point_range(local);
    let world = core.map(|v| world_radius_range(v, hull.radius));
    if local.iter().chain(&world).any(|v| !v.finite()) {
        return [Float::exact(f32::NAN); 3];
    }
    union(local, world)
}
fn child(frame: Frame, local: rp::Pose) -> Frame {
    Frame {
        translation: add(frame.translation, frame.rotation.vector(local.translation)),
        rotation: frame.rotation.compose(local.rotation),
    }
}
/// With an identity orientation the rounded point transform is a monotone
/// addition on each axis. The stored and interior translation ranges can
/// therefore be merged before transforming the hull, including its two
/// distinct radius constructions.
fn translated_bounds(
    frames: &[Frame],
    motion: ShapeMotion,
    hull: Hull,
    work: &mut Work,
) -> Result<Option<Aabb>, TrajectoryError> {
    if motion.local_pose.rotation != rp::Rotation::IDENTITY
        || frames.is_empty()
        || !frames
            .iter()
            .all(|f| f.rotation.exact == Some(rp::Rotation::IDENTITY))
    {
        return Ok(None);
    }
    work.charge(128 + 48 * frames.len() as u64)?;
    let mut translation = frames[0].translation;
    for frame in &frames[1..] {
        translation = union(translation, frame.translation);
    }
    let translation = Frame {
        translation,
        rotation: Quaternion::IDENTITY,
    }
    .shape(motion)
    .translation;
    translated_hull(translation, hull, work)
}

fn translated_hull(
    translation: Translation,
    hull: Hull,
    work: &mut Work,
) -> Result<Option<Aabb>, TrajectoryError> {
    let core = add(hull.core, translation);
    let mut extent = core;
    if hull.radius != 0. {
        work.charge(96)?;
        for i in 0..3 {
            let world = world_radius_range(core[i], hull.radius);
            if !world.finite() {
                return Ok(None);
            }
            if hull.core[i].lo == 0. && hull.core[i].hi == 0. {
                // Adding the radius locally here is just RN(T ± r); the
                // directed world-scalar enclosure already includes that result.
                extent[i] = world;
            } else {
                work.charge(32)?;
                let local =
                    Float::span(hull.core[i].lo - hull.radius, hull.core[i].hi + hull.radius)
                        .add(translation[i]);
                if !local.finite() {
                    return Ok(None);
                }
                extent[i] = union_axis(local, world);
            }
        }
    }
    Ok(extent.iter().all(|r| r.finite()).then(|| {
        Aabb::new(
            rp::Vector::from_array(extent.map(|r| r.lo)),
            rp::Vector::from_array(extent.map(|r| r.hi)),
        )
    }))
}

/// Closed form of `translated_bounds` for two common primitive hulls. Each
/// Native endpoint is a separate branch. The open physical interval is the
/// monotone F32 product followed by the original F32 sum on each axis.
pub(in crate::physics3d) fn straight_primitive_bounds(
    motion: ShapeMotion,
    shape: &dyn rp::Shape,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<Aabb>, TrajectoryError> {
    let identity = rp::Rotation::IDENTITY.to_array().map(f32::to_bits);
    let (from, to) = motion.curve.times();
    if !(from.is_finite() && to.is_finite() && from <= start && start < end && end <= to)
        || motion.local_pose.rotation.to_array().map(f32::to_bits) != identity
    {
        return Ok(None);
    }
    let (core, radius) = match shape.as_typed_shape() {
        TypedShape::Cuboid(s) if s.half_extents.is_finite() => {
            (s.half_extents.to_array().map(|v| Float::span(-v, v)), 0.)
        }
        TypedShape::Capsule(s)
            if s.segment.a.is_finite()
                && s.segment.b.is_finite()
                && s.radius.is_finite()
                && s.radius >= 0. =>
        {
            (
                std::array::from_fn(|i| Float::span(s.segment.a[i], s.segment.b[i])),
                s.radius,
            )
        }
        _ => return Ok(None),
    };
    let translation = match motion.curve {
        Curve::Constant { pose, .. } if pose.rotation.to_array().map(f32::to_bits) == identity => {
            work.charge(16)?;
            exact_vector(pose.translation)
        }
        Curve::Integrated(k) if k.has_identity_orientation() => {
            work.charge(64)?;
            let h = k.native.integration_seconds;
            let lo = k.local_delta(start);
            let hi = k.local_delta(end);
            if !(h.is_finite() && h > 0. && lo.is_finite() && hi.is_finite() && lo <= hi) {
                return Ok(None);
            }
            let first = lo.max(f32::from_bits(1));
            let last = hi.min(h.next_down());
            let mut range = None;
            if first <= last {
                let origin = k.native.motion.start.translation;
                let v = k.native.linear_velocity;
                let a = origin + v * first;
                let b = origin + v * last;
                if !a.is_finite() || !b.is_finite() {
                    return Ok(None);
                }
                range = Some(std::array::from_fn(|i| Float::span(a[i], b[i])));
            }
            for (include, p) in [
                (lo <= 0., k.native.motion.start),
                (hi >= h, k.native.motion.end),
            ] {
                if include {
                    if !p.translation.is_finite() {
                        return Ok(None);
                    }
                    let p = exact_vector(p.translation);
                    range = Some(range.map_or(p, |r| union(r, p)));
                }
            }
            let Some(range) = range else { return Ok(None) };
            range
        }
        _ => return Ok(None),
    };
    // Keep the original quaternion application even for signed-zero local
    // components. Pose offsets are two successive F32 additions.
    work.charge(48)?;
    let q = rp::Rotation::IDENTITY;
    let translation = add(
        add(translation, exact_vector(q * -motion.local_center)),
        exact_vector(q * motion.local_pose.translation),
    );
    translated_hull(translation, Hull { core, radius }, work)
}

fn charge_frame(
    frame: Frame,
    part: Option<rp::Pose>,
    hull: Hull,
    work: &mut Work,
) -> Result<(), TrajectoryError> {
    // Reuse the existing output phase model: shape-frame preparation is
    // 128/exact or 1024/bounded-q; the whole core hull is one interval vector
    // (128), or the existing two full-radius graphs (1024). These are logical
    // visit/phase units, not scalar-instruction or elapsed-time upper bounds.
    let frame_cost = if frame.rotation.exact.is_some() {
        128
    } else {
        1024
    };
    let hull_cost = if hull.radius == 0. { 128 } else { 1024 };
    let copies = if part.is_some() { 2 } else { 1 };
    work.charge(copies * (frame_cost + hull_cost))
}

fn frame_bounds(
    frame: Frame,
    motion: ShapeMotion,
    part: Option<rp::Pose>,
    hull: Hull,
) -> Option<Aabb> {
    let transformed = if let Some(local) = part {
        // Full Core leaf traversal composes local poses first. Native
        // compound traversal can compose the world shape pose first. F32
        // association is observable, so enclose both original arrangements.
        let leaf = ShapeMotion {
            local_pose: motion.local_pose * local,
            ..motion
        };
        union(
            full_hull(frame.shape(leaf), hull),
            full_hull(child(frame.shape(motion), local), hull),
        )
    } else {
        full_hull(frame.shape(motion), hull)
    };
    if transformed.iter().any(|v| !v.finite()) {
        return None;
    }
    Some(Aabb::new(
        rp::Vector::from_array(transformed.map(|v| v.lo)),
        rp::Vector::from_array(transformed.map(|v| v.hi)),
    ))
}
fn merge(out: &mut Option<Aabb>, value: Aabb) {
    *out = Some(out.map_or(value, |old| old.merged(&value)));
}
fn leaf_bounds(
    motion: ShapeMotion,
    part: Option<rp::Pose>,
    hull: Hull,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Aabb, TrajectoryError> {
    work.charge(STACK as u64)?;
    let empty = Interval {
        start: 0.,
        end: 0.,
        depth: 0,
    };
    let mut pending = [empty; STACK];
    pending[0] = Interval {
        start,
        end,
        depth: 0,
    };
    let mut count = 1;
    let mut out = None;
    while count > 0 {
        work.charge(1)?;
        count -= 1;
        let interval = pending[count];
        let mut current = None;
        let complete = if interval.start == interval.end {
            // This is a singleton *input domain*, not an endpoint sample used
            // to certify an interval. Keep its original Native branch exactly.
            // Direct com_pose evaluation precedes the existing frame/point
            // phase prices; a singleton is one real Native parameter value.
            work.charge(1024)?;
            let frame = Frame::exact(motion.curve.com_pose(interval.start));
            charge_frame(frame, part, hull, work)?;
            current = frame_bounds(frame, motion, part, hull);
            current.is_some()
        } else if let Some(frames) = frames(motion.curve, interval.start, interval.end, work)? {
            if part.is_none() {
                if let Some(bounds) =
                    translated_bounds(&frames.values[..frames.len], motion, hull, work)?
                {
                    merge(&mut out, bounds);
                    continue;
                }
            }
            let mut valid = true;
            for &frame in &frames.values[..frames.len] {
                charge_frame(frame, part, hull, work)?;
                if let Some(bounds) = frame_bounds(frame, motion, part, hull) {
                    merge(&mut current, bounds);
                } else {
                    valid = false;
                    break;
                }
            }
            valid && current.is_some()
        } else {
            false
        };
        if complete {
            merge(&mut out, current.ok_or(TrajectoryError::InvalidReference)?);
            continue;
        }
        if interval.start == interval.end {
            return Err(TrajectoryError::NonFinite);
        }
        let middle = interval.start + (interval.end - interval.start) * 0.5;
        if interval.depth == MAX_DEPTH
            || middle <= interval.start
            || middle >= interval.end
            || count.checked_add(2).is_none_or(|n| n > pending.len())
        {
            // A failed certificate is never interpreted as a missing shape.
            // Fixed depth/frontier and the shared ledger bound all work.
            return Err(TrajectoryError::WorkLimit);
        }
        pending[count] = Interval {
            start: middle,
            depth: interval.depth + 1,
            ..interval
        };
        pending[count + 1] = Interval {
            end: middle,
            depth: interval.depth + 1,
            ..interval
        };
        count += 2;
    }
    out.ok_or(TrajectoryError::InvalidReference)
}

pub(in crate::physics3d::solver_trajectory) fn whole_bounds(
    motion: ShapeMotion,
    shape: &dyn rp::Shape,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Aabb, TrajectoryError> {
    work.charge(1)?;
    let (from, to) = motion.curve.times();
    if !start.is_finite()
        || !end.is_finite()
        || !from.is_finite()
        || !to.is_finite()
        || from > to
        || start < from
        || end > to
        || start > end
    {
        return Err(TrajectoryError::InvalidTime);
    }
    if let Some(bounds) = straight_primitive_bounds(motion, shape, start, end, work)? {
        return Ok(bounds);
    }
    if let TypedShape::Compound(compound) = shape.as_typed_shape() {
        work.charge(
            (compound.shapes().len() as u64)
                .checked_mul(128)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        let mut out = None;
        for (local, part) in compound.shapes() {
            // Same admitted full-leaf scope as leaves(): convex non-nested
            // parts only. No filtering/BVH candidate can hide a real leaf.
            if ToiProxy::from_shape(part.as_ref()).is_none() {
                return Err(TrajectoryError::UnsupportedShape);
            }
            let hull = hull(part.as_ref(), work)?;
            merge(
                &mut out,
                leaf_bounds(motion, Some(*local), hull, start, end, work)?,
            );
        }
        out.ok_or(TrajectoryError::InvalidReference)
    } else {
        let hull = hull(shape, work)?;
        leaf_bounds(motion, None, hull, start, end, work)
    }
}

#[cfg(test)]
mod tests;

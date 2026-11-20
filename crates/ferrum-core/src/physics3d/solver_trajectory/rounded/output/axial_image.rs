//! Exact finite Box/Capsule leaf predicate with one irrelevant tangent input.
//!
//! This is a query-equivalence certificate, not an ideal support-plane or a
//! sample of time. Complete original F32 frames must fix every other pose
//! coordinate. Identity rotations, a zero box tangent origin and an entirely
//! internal tangent slab make that coordinate cancel exactly in the original
//! finite endpoint/edge query. No witness or contact is published here.
use super::*;

#[derive(Default)]
pub(super) struct Cache {
    result: Option<Option<bool>>,
}

impl Cache {
    pub(super) fn clear(
        &mut self,
        a: &Frames,
        sa: &dyn rp::Shape,
        b: &Frames,
        sb: &dyn rp::Shape,
        clearance: f32,
        work: &mut Work,
    ) -> Result<Option<bool>, TrajectoryError> {
        work.charge(1)?;
        if let Some(value) = self.result {
            return Ok(value);
        }
        let value = certificate(a, sa, b, sb, clearance, work)?;
        // A failed traversal/query never installs a partial certificate.
        self.result = Some(value);
        Ok(value)
    }
}

fn identity(q: &Quaternion) -> bool {
    q.exact.is_some_and(|q| {
        q.to_array().map(f32::to_bits) == rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
    })
}

/// A representative of a *proved complete frame image*. Only `free` may vary;
/// every other scalar output must have the same original F32 bits throughout.
fn representative(frames: &Frames, free: Option<usize>) -> Option<(rp::Pose, Float)> {
    if frames.len == 0 {
        return None;
    }
    let first = frames.values[0];
    let translation = rp::Vector::from_array(first.translation.map(|r| r.lo));
    let mut range = free.map_or(Float::ZERO, |i| first.translation[i]);
    for frame in &frames.values[..frames.len] {
        if !identity(&frame.rotation) || frame.translation.iter().any(|r| !r.finite()) {
            return None;
        }
        for (axis, r) in frame.translation.iter().enumerate() {
            if Some(axis) == free {
                if r.lo.total_cmp(&range.lo).is_lt() {
                    range.lo = r.lo;
                }
                if r.hi.total_cmp(&range.hi).is_gt() {
                    range.hi = r.hi;
                }
            } else if r.lo.to_bits() != r.hi.to_bits()
                || r.lo.to_bits() != translation[axis].to_bits()
            {
                return None;
            }
        }
    }
    let mut pose = rp::Pose::from_translation(translation);
    if let Some(axis) = free {
        pose.translation[axis] = range.lo;
    }
    Some((pose, range))
}

fn segment_axis(capsule: &rapier3d::parry::shape::Capsule) -> Option<usize> {
    let a = capsule.segment.a;
    let b = capsule.segment.b;
    let axis = (0..3).find(|&i| a[i] != 0. || b[i] != 0.)?;
    // The original interpolate(a,b,t) is monotone and remains between these
    // symmetric endpoints: doubling finite h is exact in binary arithmetic.
    (a.is_finite()
        && b.is_finite()
        && (b - a).is_finite()
        && a[axis] < 0.
        && b[axis] == -a[axis]
        && (0..3).all(|i| i == axis || a[i] == 0. && b[i] == 0.))
    .then_some(axis)
}

/// Every reconstructed capsule point is no closer in the fixed coordinates
/// than one of its endpoints. The free-coordinate projection returns that same
/// coordinate verbatim, so it contributes zero to every original squared gap.
/// Original Closest::add visits endpoints first and uses strict `<`; a later
/// rounded edge tie cannot replace the chosen endpoint. Its normal, radius
/// offset and final positive F32 dot-distance therefore ignore the free input.
fn endpoint_slab(
    box_pose: rp::Pose,
    cuboid: &rapier3d::parry::shape::Cuboid,
    capsule_pose: rp::Pose,
    capsule: &rapier3d::parry::shape::Capsule,
    axis: usize,
) -> bool {
    let a = capsule_pose * capsule.segment.a;
    let b = capsule_pose * capsule.segment.b;
    let relative = box_pose.inv_mul(&capsule_pose);
    let ra = relative * capsule.segment.a;
    let rb = relative * capsule.segment.b;
    // intersects_box and project deliberately use different original F32
    // association. Prove both, rather than repairing a relative transform.
    let inv = box_pose.inverse();
    let qa = inv * a;
    let qb = inv * b;
    if !a.is_finite()
        || !b.is_finite()
        || !relative.is_finite()
        || !ra.is_finite()
        || !rb.is_finite()
        || !qa.is_finite()
        || !qb.is_finite()
    {
        return false;
    }
    let h = cuboid.half_extents[axis];
    let mut point = rp::Vector::ZERO;
    point[axis] = h;
    let high = (box_pose * point)[axis];
    point[axis] = -h;
    let low = (box_pose * point)[axis];
    let above =
        a[axis].min(b[axis]) > high && ra[axis].min(rb[axis]) > h && qa[axis].min(qb[axis]) > h;
    let below =
        a[axis].max(b[axis]) < low && ra[axis].max(rb[axis]) < -h && qa[axis].max(qb[axis]) < -h;
    (above || below)
        && (0..8).all(|i| {
            let vertex = rp::Vector::from_array(std::array::from_fn(|axis| {
                if i & (1 << axis) == 0 {
                    -cuboid.half_extents[axis]
                } else {
                    cuboid.half_extents[axis]
                }
            }));
            (box_pose * vertex).is_finite()
        })
}

fn certificate(
    a: &Frames,
    sa: &dyn rp::Shape,
    b: &Frames,
    sb: &dyn rp::Shape,
    clearance: f32,
    work: &mut Work,
) -> Result<Option<bool>, TrajectoryError> {
    work.charge(64)?;
    if !clearance.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if clearance < 0. {
        return Ok(None);
    }
    let (box_frames, cuboid, capsule_frames, capsule, capsule_first) =
        if let (Some(cuboid), Some(capsule)) = (sa.as_cuboid(), sb.as_capsule()) {
            (a, cuboid, b, capsule, false)
        } else if let (Some(capsule), Some(cuboid)) = (sa.as_capsule(), sb.as_cuboid()) {
            (b, cuboid, a, capsule, true)
        } else {
            return Ok(None);
        };
    let Some(axis) = segment_axis(capsule) else {
        return Ok(None);
    };
    if !cuboid.half_extents.is_finite()
        || !(cuboid.half_extents * 2.).is_finite()
        || cuboid.half_extents.min_element() <= 0.
        || !capsule.radius.is_finite()
        || capsule.radius < 0.
    {
        return Ok(None);
    }
    // Fixed three-coordinate/frame classification, endpoint/vertex arithmetic;
    // original leaf_contact charges its own full finite-query traversal below.
    let frames = u64::try_from(a.len + b.len).map_err(|_| TrajectoryError::WorkLimit)?;
    work.charge(
        frames
            .checked_mul(3 * 128)
            .and_then(|v| v.checked_add(3 * 1024))
            .ok_or(TrajectoryError::WorkLimit)?,
    )?;
    let Some((box_pose, _)) = representative(box_frames, None) else {
        return Ok(None);
    };
    for free in 0..3 {
        if free == axis || box_pose.translation[free] != 0. {
            continue;
        }
        let Some((capsule_pose, range)) = representative(capsule_frames, Some(free)) else {
            continue;
        };
        // The finite native pose-image stage already covers <=2 outputs. Only
        // collapse an otherwise unbounded tangent image; never replace it.
        if range.image().is_some()
            || range.lo < -cuboid.half_extents[free]
            || range.hi > cuboid.half_extents[free]
            || !endpoint_slab(box_pose, cuboid, capsule_pose, capsule, axis)
        {
            continue;
        }
        let (pa, pb) = if capsule_first {
            (capsule_pose, box_pose)
        } else {
            (box_pose, capsule_pose)
        };
        let contact = super::super::super::leaf_contact(&pa, sa, &pb, sb, work)?;
        if !contact.dist.is_finite()
            || !contact.point1.is_finite()
            || !contact.point2.is_finite()
            || !contact.normal1.is_finite()
            || !contact.normal2.is_finite()
        {
            return Err(TrajectoryError::NonFinite);
        }
        if contact.normal1[free] != 0.
            || contact.normal2[free] != 0.
            || contact.point1[free] != contact.point2[free]
        {
            return Ok(None);
        }
        // This is the original full-radius F32 predicate, including its final
        // local witness -> world point -> dot graph. Equality remains a hit.
        return Ok(Some(contact.dist > clearance));
    }
    Ok(None)
}

#[cfg(test)]
mod tests;

//! Reuse a strict point support only when the full original pose is invariant.
use super::super::{world_contact, ShapeMotion, Time, TrajectoryError, Work};
use rapier3d::prelude as rp;

// The caller has already selected the original positive existing-contact
// margin and checked both the Native distance and geometric support against it.
pub(in crate::physics3d::solver_trajectory) fn retains_initial_band(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let is_rounded = |shape: &dyn rp::Shape| {
        shape
            .as_capsule()
            .is_some_and(|capsule| capsule.radius > 0.)
    };
    if !((sa.as_cuboid().is_some() && is_rounded(sb))
        || (sb.as_cuboid().is_some() && is_rounded(sa)))
    {
        return Ok(false);
    }
    work.charge(64)?;
    if !a.is_fixed_axis_aligned() || !b.is_fixed_axis_aligned() {
        return Ok(false);
    }
    world_contact::validate_interval(a, b, start, end, work)?;
    Ok(true)
}

#[cfg(test)]
mod tests;

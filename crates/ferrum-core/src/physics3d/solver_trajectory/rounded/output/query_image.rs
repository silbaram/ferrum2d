//! Complete original leaf-query result for one fixed output frame image.
//! Coordinate Cartesian poses are kept distinct from the finite input image.
//! No failed traversal is installed, and callers retain original support/error
//! masking order after a false/unavailable image or a typed query error.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Error {
    // Original pose/pair reservations propagate before any query refutation.
    Preparation(TrajectoryError),
    // Only the original native leaf result may be refuted by full support.
    Leaf(TrajectoryError),
}

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
    ) -> Result<Option<bool>, Error> {
        work.charge(1).map_err(Error::Preparation)?;
        if let Some(result) = self.result {
            return Ok(result);
        }
        let result = clear(a, sa, b, sb, clearance, work)?;
        self.result = Some(result);
        Ok(result)
    }
}
fn clear(
    a: &Frames,
    sa: &dyn rp::Shape,
    b: &Frames,
    sb: &dyn rp::Shape,
    clearance: f32,
    work: &mut Work,
) -> Result<Option<bool>, Error> {
    let (Some(va), Some(vb)) = (
        poses(a, work).map_err(Error::Preparation)?,
        poses(b, work).map_err(Error::Preparation)?,
    ) else {
        return Ok(None);
    };
    work.charge((va.len * vb.len) as u64)
        .map_err(Error::Preparation)?;
    let mut static_clear = true;
    for pose_a in &va.values[..va.len] {
        for pose_b in &vb.values[..vb.len] {
            let contact = super::super::super::leaf_contact(pose_a, sa, pose_b, sb, work)
                .map_err(Error::Leaf)?;
            if !contact.dist.is_finite()
                || !contact.normal1.is_finite()
                || !contact.point1.is_finite()
                || !contact.point2.is_finite()
            {
                return Err(Error::Leaf(TrajectoryError::NonFinite));
            }
            if contact.dist <= clearance {
                return Ok(Some(false));
            }
            if static_clear {
                static_clear = super::native_clear_static_eligible(
                    pose_a,
                    sa,
                    pose_b,
                    sb,
                    contact.normal1,
                    clearance,
                    work,
                )
                .map_err(Error::Preparation)?;
            }
        }
    }
    // An unproved static bound is unavailable, not an original Native hit.
    // The owner must still try its original whole-shape support fallback.
    Ok(static_clear.then_some(true))
}

#[cfg(test)]
mod tests;

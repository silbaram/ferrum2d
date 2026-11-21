//! Full scalar-bit/capacity equality, not hashes or PartialEq (NaNs/signed0).
use super::*;
pub(super) fn equal(a: Root<'_>, b: Root<'_>, budget: &mut Budget) -> Result<bool> {
    budget.compare(1, 16)?;
    match (a, b) {
        (Root::Route(a), Root::Route(b)) => {
            if a.len() != b.len() {
                return Ok(false);
            }
            let n = a.len();
            budget.compare(
                (n as u64).checked_mul(8).ok_or(Error::Work)?,
                n.checked_mul(64).ok_or(Error::CompareBytes)?,
            )?;
            Ok(a.iter().zip(b.iter()).all(|(a, b)| {
                a.surface == b.surface
                    && a.pose
                        .position
                        .iter()
                        .zip(b.pose.position.iter())
                        .chain(a.pose.rotation.iter().zip(b.pose.rotation.iter()))
                        .all(|(a, b)| a.to_bits() == b.to_bits())
            }))
        }
        (Root::Clips(a), Root::Clips(b)) => {
            if a.len() != b.len() {
                return Ok(false);
            }
            budget.work((a.len() as u64).checked_mul(32).ok_or(Error::Work)?)?;
            for (a, b) in a.iter().zip(b.iter()) {
                let (aw, ab) = a.file_alias_compare_cost().ok_or(Error::CompareBytes)?;
                let (bw, bb) = b.file_alias_compare_cost().ok_or(Error::CompareBytes)?;
                budget.compare(
                    aw.checked_add(bw).ok_or(Error::Work)?,
                    ab.checked_add(bb).ok_or(Error::CompareBytes)?,
                )?;
                if !a.file_alias_value_eq(b) {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        _ => Ok(false),
    }
}

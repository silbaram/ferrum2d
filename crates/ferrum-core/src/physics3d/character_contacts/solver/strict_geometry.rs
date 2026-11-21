//! One bounded representable proposal after geometry's ordinary strict solve.
//!
//! The strongest normal coordinate may be blocked by another simultaneous row.
//! A rounded normal update can then repeat without crossing the other velocity
//! coordinate's F32 spacing. Try the original coordinate axes of the first
//! violated row from the same unmodified base vector. If the first single-body
//! neighbor leaves the rounded residual unchanged, try one further value on
//! that axis. Every original F32 row must be non-inward together.
use super::*;
use crate::physics3d::solver_trajectory::{TrajectoryError, Work};

const MAX_ATTEMPTS: usize = 3;

fn charge(work: &mut Work, count: usize, fixed: u64) -> Result<(), TrajectoryError> {
    let amount = u64::try_from(count)
        .ok()
        .and_then(|n| n.checked_mul(4))
        .and_then(|n| n.checked_add(fixed))
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(amount)
}

fn feasible(actors: &[Actor], contacts: &[Constraint]) -> Result<bool, TrajectoryError> {
    let mut result = true;
    for row in contacts {
        let value = residual(row, actors);
        if !value.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        result &= value <= 0.;
    }
    Ok(result)
}

/// Only actual geometry with carry provenance calls this optional fallback.
/// Untagged/physical solve, tolerance, impulses and all subsequent full-curve
/// approval remain unchanged. A false/error never commits a partial proposal.
pub(in crate::physics3d::character_contacts) fn adjacent_feasible(
    actors: &mut [Actor],
    contacts: &[Constraint],
    planar: bool,
    carry_rows: &[Option<rp::Vector>],
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if carry_rows.len() != contacts.len() {
        return Err(TrajectoryError::InvalidReference);
    }
    charge(work, actors.len(), 16)?;
    charge(work, contacts.len(), 16)?;
    if actors
        .iter()
        .any(|a| !a.velocity.is_finite() || !a.carry.is_finite())
        || carry_rows.iter().flatten().any(|v| !v.is_finite())
    {
        return Err(TrajectoryError::NonFinite);
    }
    if planar && actors.iter().any(|a| a.velocity.z != 0.) {
        return Ok(false);
    }
    let mut first = None;
    for (index, row) in contacts.iter().enumerate() {
        if row.a >= actors.len() || row.b.is_some_and(|b| b >= actors.len() || b == row.a) {
            return Err(TrajectoryError::InvalidReference);
        }
        if !row.normal.is_finite() || !row.velocity.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let value = residual(row, actors);
        if !value.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        if value > 0. && first.is_none() {
            first = Some((index, value));
        }
    }
    let Some((index, original_residual)) = first else {
        return Ok(true);
    };
    let row = &contacts[index];
    let before_a = actors[row.a].velocity;
    let before_b = row.b.map(|b| actors[b].velocity);
    let mut same_residual = [false; MAX_ATTEMPTS];
    for next_beyond_neighbor in [false, true] {
        for (axis, retry) in same_residual.iter_mut().enumerate() {
            if (next_beyond_neighbor && !*retry) || row.normal[axis] == 0. || planar && axis == 2 {
                continue;
            }
            // Admission includes a full row census, candidate arithmetic and the
            // existing transport attribution, before mutating even local actors.
            charge(work, contacts.len(), 256)?;
            let positive = row.normal[axis] > 0.;
            let mut candidate_a = before_a;
            candidate_a[axis] = if positive {
                before_a[axis].next_up()
            } else {
                before_a[axis].next_down()
            };
            if next_beyond_neighbor {
                candidate_a[axis] = if positive {
                    candidate_a[axis].next_up()
                } else {
                    candidate_a[axis].next_down()
                };
            }
            let candidate_b = before_b.map(|before| {
                let mut value = before;
                value[axis] = if positive {
                    before[axis].next_down()
                } else {
                    before[axis].next_up()
                };
                value
            });
            if !candidate_a.is_finite() || candidate_b.is_some_and(|v| !v.is_finite()) {
                continue;
            }
            let delta = candidate_a - before_a;
            if let (Some(before), Some(candidate)) = (before_b, candidate_b) {
                // Carry attribution and the existing fair pair policy describe
                // equal/opposite corrections. Unequal ULP sizes are not permission
                // to invent a new pair or transport model in this fallback.
                if delta != before - candidate {
                    continue;
                }
            }
            actors[row.a].velocity = candidate_a;
            if let (Some(b), Some(candidate)) = (row.b, candidate_b) {
                actors[b].velocity = candidate;
            }
            let accepted = feasible(actors, contacts);
            *retry = row.b.is_none() && residual(row, actors) == original_residual;
            if !matches!(accepted, Ok(true)) {
                actors[row.a].velocity = before_a;
                if let (Some(b), Some(before)) = (row.b, before_b) {
                    actors[b].velocity = before;
                }
                accepted?;
                continue;
            }
            if let Some(surface) = carry_rows[index] {
                let carry_a = actors[row.a].carry;
                let carry_b = row.b.map(|b| actors[b].carry);
                if transport_correction(actors, row, delta, surface).is_err() {
                    actors[row.a].velocity = before_a;
                    actors[row.a].carry = carry_a;
                    if let (Some(b), Some(before), Some(carry)) = (row.b, before_b, carry_b) {
                        actors[b].velocity = before;
                        actors[b].carry = carry;
                    }
                    return Err(TrajectoryError::NonFinite);
                }
            }
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests;

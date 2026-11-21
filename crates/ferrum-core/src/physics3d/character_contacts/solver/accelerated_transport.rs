//! Carry attribution for the existing simultaneous CG correction.
//!
//! The authoritative total candidate and every physical impulse stay unchanged.
//! Allocate only a signed portion of each actual virtual row impulse: zero for
//! a physical row, otherwise between zero and that row's CG impulse. Solving the
//! bounded row system together lets a peer pass its donor's carry to a wall.
use super::*;

fn passes(actors: usize) -> usize {
    actors.saturating_mul(64).min(4096)
}

/// Admit only work that is about to execute, using the same tick ledger. The
/// original solver preflight already reserved product/body backing; this helper
/// has no new buffers and does not reserve its worst-case passes in advance.
fn charge(
    work: &mut Work,
    actors: usize,
    rows: usize,
    actor_cost: u64,
    row_cost: u64,
) -> Result<(), TrajectoryError> {
    let amount = u64::try_from(actors)
        .ok()
        .and_then(|n| n.checked_mul(actor_cost))
        .and_then(|n| {
            u64::try_from(rows)
                .ok()
                .and_then(|r| r.checked_mul(row_cost))
                .and_then(|r| n.checked_add(r))
        })
        .and_then(|n| n.checked_add(16))
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(amount)
}

fn candidate(
    row: &Constraint,
    normal: [f64; 3],
    surface: rp::Vector,
    body: &[[f64; 3]],
    previous: f64,
    cap: f64,
) -> Result<f64, ()> {
    let other = row.b.map_or(surface.to_array().map(f64::from), |b| body[b]);
    let error = -(0..3)
        .map(|axis| normal[axis] * (body[row.a][axis] - other[axis]))
        .sum::<f64>();
    let denom = normal.iter().map(|n| n * n).sum::<f64>() * if row.b.is_some() { 2. } else { 1. };
    if !error.is_finite() || !denom.is_finite() || denom == 0. || !cap.is_finite() {
        return Err(());
    }
    let next = previous + error / denom;
    if !next.is_finite() {
        return Err(());
    }
    Ok(next.clamp(cap.min(0.), cap.max(0.)))
}

/// False declines the optional accelerator, without changing actors. The caller
/// continues its original bounded PGS; an unsettled tag is never committed with
/// an accelerated total. Untagged solve does not call this helper.
pub(super) fn solve(
    actors: &mut [Actor],
    contacts: &[Constraint],
    planar: bool,
    tags: &[Option<rp::Vector>],
    all_transport: bool,
    s: &mut Scratch,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    charge(work, actors.len(), contacts.len(), 8, 8)?;
    // This identity was captured at solve entry, before rounded PGS updates.
    // It is false for genuine own input, physical rows and pure pushers.
    if all_transport {
        for (a, &v) in actors.iter_mut().zip(&s.candidate) {
            a.carry = v;
        }
        return Ok(true);
    }
    s.product.fill(0.);
    for _ in 0..passes(actors.len()) {
        charge(work, actors.len(), contacts.len(), 8, 48)?;
        // Rebuild from the immutable incoming tags and accumulated signed row
        // contributions, avoiding drift from repeated F32 carry += operations.
        super::transpose(contacts, planar, &s.product, &mut s.body);
        for (body, a) in s.body.iter_mut().zip(actors.iter()) {
            for (value, initial) in body.iter_mut().zip(a.carry.to_array()) {
                *value += f64::from(initial);
            }
        }
        let mut changed = false;
        for (i, (row, tag)) in contacts.iter().zip(tags).enumerate() {
            let Some(surface) = *tag else { continue };
            if s.impulse[i] == 0. {
                continue;
            }
            let n = super::normal(row, planar);
            let next = candidate(row, n, surface, &s.body, s.product[i], s.impulse[i])
                .map_err(|()| TrajectoryError::NonFinite)?;
            let delta = next - s.product[i];
            changed |= next != s.product[i];
            s.product[i] = next;
            for (axis, normal) in n.into_iter().enumerate() {
                s.body[row.a][axis] += normal * delta;
                if let Some(b) = row.b {
                    s.body[b][axis] -= normal * delta;
                }
            }
        }
        if changed {
            continue;
        }
        charge(work, actors.len(), contacts.len(), 16, 8)?;
        // Check every cast before committing even local tags. The caller's
        // original F32 total candidate remains untouched throughout this solve.
        super::transpose(contacts, planar, &s.product, &mut s.body);
        if actors.iter().zip(&s.body).any(|(a, d)| {
            !(a.carry + rp::Vector::new(d[0] as f32, d[1] as f32, d[2] as f32)).is_finite()
        }) {
            return Err(TrajectoryError::NonFinite);
        }
        for (a, d) in actors.iter_mut().zip(&s.body) {
            a.carry += rp::Vector::new(d[0] as f32, d[1] as f32, d[2] as f32);
        }
        return Ok(true);
    }
    Ok(false)
}

#[cfg(test)]
mod tests;

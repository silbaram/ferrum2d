//! Projected contact sweeps with a matrix-free acceleration for long capsule chains.
use super::{contact_tolerance, motion_tolerance, residual, Actor, Constraint};
use crate::physics3d::solver_trajectory::{TrajectoryError, Work};
use rapier3d::prelude as rp;
mod accelerated_transport;
mod strict_geometry;
pub(super) use strict_geometry::adjacent_feasible;
#[derive(Default)]
pub(super) struct Scratch {
    residual: Vec<f64>,
    direction: Vec<f64>,
    product: Vec<f64>,
    impulse: Vec<f64>,
    body: Vec<[f64; 3]>,
    candidate: Vec<rp::Vector>,
}
impl Scratch {
    /// Preflight all existing velocity-solver buffers for the actual-interval
    /// planner. Ordinary controller execution retains its existing call path.
    pub(super) fn try_reserve(
        &mut self,
        actors: usize,
        contacts: usize,
    ) -> Result<(), std::collections::TryReserveError> {
        for values in [
            &mut self.residual,
            &mut self.direction,
            &mut self.product,
            &mut self.impulse,
        ] {
            values.try_reserve(contacts.saturating_sub(values.len()))?;
        }
        self.body
            .try_reserve(actors.saturating_sub(self.body.len()))?;
        self.candidate
            .try_reserve(actors.saturating_sub(self.candidate.len()))?;
        Ok(())
    }
}
pub(super) fn solve(
    actors: &mut [Actor],
    contacts: &[Constraint],
    planar: bool,
    tolerance: f32,
    scratch: &mut Scratch,
) -> bool {
    // The established untagged path has no carry bookkeeping failure source.
    solve_impl(actors, contacts, planar, tolerance, scratch, None, None).unwrap_or(false)
}

/// Actual-interval untagged use shares the tick ledger. The established
/// ordinary controller wrapper above retains its unmetered arithmetic path.
pub(super) fn solve_metered(
    actors: &mut [Actor],
    contacts: &[Constraint],
    planar: bool,
    tolerance: f32,
    scratch: &mut Scratch,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    solve_impl(
        actors,
        contacts,
        planar,
        tolerance,
        scratch,
        None,
        Some(work),
    )
}

/// Admission only; no solver value, branch, cap or floating operation changes.
fn charge(work: &mut Option<&mut Work>, count: usize, price: u64) -> Result<(), TrajectoryError> {
    if let Some(work) = work.as_deref_mut() {
        let amount = u64::try_from(count)
            .ok()
            .and_then(|n| n.checked_mul(price))
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(amount)?;
    }
    Ok(())
}

pub(super) fn solve_tagged(
    actors: &mut [Actor],
    contacts: &[Constraint],
    planar: bool,
    tolerance: f32,
    scratch: &mut Scratch,
    carry_rows: &[Option<rp::Vector>],
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if carry_rows.len() != contacts.len() {
        return Err(TrajectoryError::InvalidReference);
    }
    // Capture the semantic identity before any PGS rounding can perturb the
    // tags. Physical rows and non-carry affine drivers cannot establish it.
    let mut all_transport = true;
    for actor in actors.iter() {
        work.charge(4)?;
        if actor.carry != actor.velocity {
            all_transport = false;
            break;
        }
    }
    if all_transport {
        for (contact, tag) in contacts.iter().zip(carry_rows) {
            work.charge(4)?;
            if *tag != Some(contact.velocity) {
                all_transport = false;
                break;
            }
        }
    }
    let result = solve_impl(
        actors,
        contacts,
        planar,
        tolerance,
        scratch,
        Some((carry_rows, all_transport)),
        Some(&mut *work),
    );
    if matches!(&result, Ok(true)) && all_transport {
        work.charge(actors.len() as u64)?;
        for a in actors {
            a.carry = a.velocity;
        }
    }
    result
}

/// Attribute an actual virtual normal correction from the row-relative
/// transport, not either actor in isolation. A carried actor can transfer that
/// contribution to its peer. Opposing authored input is retained: carrier
/// closing motion pays first, up to the actual row correction. A pure pusher
/// surface has zero attributed transport even though its full velocity remains
/// the authoritative affine constraint target.
fn transport_correction(
    actors: &mut [Actor],
    c: &Constraint,
    delta: rp::Vector,
    surface_carry: rp::Vector,
) -> Result<(), ()> {
    let amount = delta.length();
    if !amount.is_finite() || !surface_carry.is_finite() {
        return Err(());
    }
    if amount == 0. {
        return Ok(());
    }
    let direction = delta / amount;
    let other = c.b.map_or(surface_carry, |b| actors[b].carry);
    let relative = actors[c.a].carry - other;
    let closing = -relative.dot(direction);
    let relative_correction = amount * if c.b.is_some() { 2. } else { 1. };
    if !direction.is_finite()
        || !relative.is_finite()
        || !closing.is_finite()
        || !relative_correction.is_finite()
    {
        return Err(());
    }
    let fraction = (closing.max(0.) / relative_correction).min(1.);
    let transport = delta * fraction;
    actors[c.a].carry += transport;
    if let Some(b) = c.b {
        actors[b].carry -= transport;
    }
    if !actors[c.a].carry.is_finite() || c.b.is_some_and(|b| !actors[b].carry.is_finite()) {
        return Err(());
    }
    Ok(())
}

fn solve_impl(
    actors: &mut [Actor],
    contacts: &[Constraint],
    planar: bool,
    tolerance: f32,
    scratch: &mut Scratch,
    carry_rows: Option<(&[Option<rp::Vector>], bool)>,
    mut work: Option<&mut Work>,
) -> Result<bool, TrajectoryError> {
    for pass in 0..(64 * actors.len()).min(4096) {
        for (row, c) in contacts.iter().enumerate() {
            // The original PGS price 3/row splits into relaxation2 and
            // convergence1. Short-circuit/early failures pay only visits made.
            charge(&mut work, 1, 2)?;
            actors[c.a].iterations += 1;
            if let Some(j) = c.b {
                actors[j].iterations += 1;
            }
            let error = residual(c, actors);
            if error <= contact_tolerance(c, actors, tolerance) * 0.25 {
                continue;
            }
            let mut n = c.normal;
            if planar {
                n.z = 0.0;
            }
            let denom = n.length_squared() * if c.b.is_some() { 2.0 } else { 1.0 };
            if denom < 1.0e-8 {
                return Ok(false);
            }
            let delta = n * (error / denom);
            actors[c.a].velocity += delta;
            if let Some(j) = c.b {
                actors[j].velocity -= delta;
            }
            if let Some(surface) = carry_rows.and_then(|(rows, _)| rows[row]) {
                // Original tagged allowance8 covers at most two reactions.
                charge(&mut work, 1, 4)?;
                transport_correction(actors, c, delta, surface)
                    .map_err(|()| TrajectoryError::NonFinite)?;
            }
            if carry_rows.is_some() && tolerance == 0. && residual(c, actors) > 0. {
                // A sub-ULP inward remainder can round the arithmetic update
                // back to the same F32. Propose the adjacent representable
                // value along the strongest plane axis; every original row is
                // checked again before this geometry-only plan is returned.
                let axis = if n.x.abs() >= n.y.abs() && n.x.abs() >= n.z.abs() {
                    0
                } else if n.y.abs() >= n.z.abs() {
                    1
                } else {
                    2
                };
                let before = actors[c.a].velocity;
                let v = &mut actors[c.a].velocity[axis];
                *v = if n[axis] > 0. {
                    v.next_up()
                } else {
                    v.next_down()
                };
                if let Some(b) = c.b {
                    let v = &mut actors[b].velocity[axis];
                    *v = if n[axis] > 0. {
                        v.next_down()
                    } else {
                        v.next_up()
                    };
                }
                if let Some(surface) = carry_rows.and_then(|(rows, _)| rows[row]) {
                    charge(&mut work, 1, 4)?;
                    let adjacent = actors[c.a].velocity - before;
                    transport_correction(actors, c, adjacent, surface)
                        .map_err(|()| TrajectoryError::NonFinite)?;
                }
            }
        }
        let mut feasible = true;
        for c in contacts {
            charge(&mut work, 1, 1)?;
            let non_inward = residual(c, actors) <= contact_tolerance(c, actors, tolerance) * 0.5;
            if !non_inward {
                feasible = false;
                break;
            }
        }
        if feasible {
            return Ok(true);
        }
        // PGS diffuses a prescribed velocity down a long chain slowly. Solve the
        // current active equalities without building a dense actor-pair matrix.
        // Accept only nonnegative impulses and a feasible, finite final velocity.
        if pass == 7
            && accelerate(
                actors,
                contacts,
                planar,
                tolerance,
                scratch,
                carry_rows,
                work.as_deref_mut(),
            )?
        {
            return Ok(true);
        }
    }
    Ok(false)
}
fn normal(c: &Constraint, planar: bool) -> [f64; 3] {
    [
        f64::from(c.normal.x),
        f64::from(c.normal.y),
        if planar { 0.0 } else { f64::from(c.normal.z) },
    ]
}
fn transpose(contacts: &[Constraint], planar: bool, input: &[f64], bodies: &mut [[f64; 3]]) {
    bodies.fill([0.0; 3]);
    for (c, &impulse) in contacts.iter().zip(input) {
        let n = normal(c, planar);
        for axis in 0..3 {
            bodies[c.a][axis] += n[axis] * impulse;
            if let Some(b) = c.b {
                bodies[b][axis] -= n[axis] * impulse;
            }
        }
    }
}
fn accelerate(
    actors: &mut [Actor],
    contacts: &[Constraint],
    planar: bool,
    tolerance: f32,
    s: &mut Scratch,
    carry_rows: Option<(&[Option<rp::Vector>], bool)>,
    mut work: Option<&mut Work>,
) -> Result<bool, TrajectoryError> {
    let count = contacts.len();
    // Four scalar row buffers plus the actor product are touched on entry;
    // none is visited if PGS converges before the optional accelerator.
    charge(&mut work, count, 4)?;
    charge(&mut work, actors.len(), 1)?;
    s.residual.clear();
    s.residual
        .extend(contacts.iter().map(|c| f64::from(residual(c, actors))));
    s.direction.clone_from(&s.residual);
    s.product.resize(count, 0.0);
    s.impulse.clear();
    s.impulse.resize(count, 0.0);
    s.body.resize(actors.len(), [0.0; 3]);
    let mut squared = s.residual.iter().map(|r| r * r).sum::<f64>();
    let mut converged = false;
    for _ in 0..count.saturating_mul(2).min(4096) {
        // Same original CG iteration unit: 4*rows + actors. No unused
        // iteration is reserved, and all stages remain in the original order.
        charge(&mut work, count, 4)?;
        charge(&mut work, actors.len(), 1)?;
        transpose(contacts, planar, &s.direction, &mut s.body);
        for (c, out) in contacts.iter().zip(&mut s.product) {
            actors[c.a].iterations += 2;
            if let Some(b) = c.b {
                actors[b].iterations += 2;
            }
            let n = normal(c, planar);
            *out = (0..3)
                .map(|axis| n[axis] * (s.body[c.a][axis] - c.b.map_or(0.0, |b| s.body[b][axis])))
                .sum();
        }
        let denominator = s
            .direction
            .iter()
            .zip(&s.product)
            .map(|(p, ap)| p * ap)
            .sum::<f64>();
        let norm = s.direction.iter().map(|p| p * p).sum::<f64>();
        // Do not amplify near-dependent geometric normals or an inconsistent
        // squeeze into an arbitrarily large sideways escape.
        if !denominator.is_finite() || denominator <= norm * 1.0e-6 {
            return Ok(false);
        }
        let alpha = squared / denominator;
        for (((lambda, r), p), ap) in s
            .impulse
            .iter_mut()
            .zip(&mut s.residual)
            .zip(&s.direction)
            .zip(&s.product)
        {
            *lambda += alpha * p;
            *r -= alpha * ap;
        }
        if s.residual
            .iter()
            .zip(contacts)
            .all(|(r, c)| r.abs() <= f64::from(contact_tolerance(c, actors, tolerance)) * 0.125)
        {
            converged = true;
            break;
        }
        let next = s.residual.iter().map(|r| r * r).sum::<f64>();
        let beta = next / squared;
        for (p, r) in s.direction.iter_mut().zip(&s.residual) {
            *p = r + beta * *p;
        }
        squared = next;
    }
    if !converged {
        return Ok(false);
    }
    for impulse in &s.impulse {
        charge(&mut work, 1, 1)?;
        if !impulse.is_finite() || *impulse < -f64::from(tolerance) {
            return Ok(false);
        }
    }
    charge(&mut work, count, 1)?;
    charge(&mut work, actors.len(), 1)?;
    transpose(contacts, planar, &s.impulse, &mut s.body);
    s.candidate.clear();
    s.candidate
        .extend(actors.iter().zip(&s.body).map(|(a, delta)| {
            a.velocity + rp::Vector::new(delta[0] as f32, delta[1] as f32, delta[2] as f32)
        }));
    for candidate in &s.candidate {
        charge(&mut work, 1, 1)?;
        if !candidate.is_finite() {
            return Ok(false);
        }
    }
    for c in contacts {
        charge(&mut work, 1, 1)?;
        if -c
            .normal
            .dot(s.candidate[c.a] - c.b.map_or(c.velocity, |b| s.candidate[b]))
            > motion_tolerance(
                s.candidate[c.a],
                c.b.map_or(c.velocity, |b| s.candidate[b]),
                tolerance,
            ) * 0.5
        {
            return Ok(false);
        }
    }
    if let Some((rows, all_transport)) = carry_rows {
        // These row impulses are simultaneous. A single sequential attribution
        // loses downstream transport (pair -> wall -> pair). Do not publish the
        // accelerated total until its bounded coupled provenance has settled.
        let work = work
            .as_deref_mut()
            .ok_or(TrajectoryError::InvalidReference)?;
        if !accelerated_transport::solve(actors, contacts, planar, rows, all_transport, s, work)? {
            return Ok(false);
        }
    }
    charge(&mut work, actors.len(), 1)?;
    for (a, v) in actors.iter_mut().zip(&s.candidate) {
        a.velocity = *v;
    }
    Ok(true)
}

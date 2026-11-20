//! Reuse the existing fair crowd velocity solve at an actual backend interval.
//! This helper plans velocities only: no body, input, force, jump or clock write.
use super::{Actor, Constraint};
use crate::physics3d::{
    solver_trajectory::{TrajectoryError, Work},
    BodyId,
};
use rapier3d::prelude as rp;

#[derive(Clone, Copy)]
pub(in crate::physics3d) struct Row {
    pub a: usize,
    pub b: Option<usize>,
    pub normal: rp::Vector,
    pub velocity: rp::Vector,
}

#[derive(Default)]
pub(in crate::physics3d) struct Scratch {
    actors: Vec<Actor>,
    contacts: Vec<Constraint>,
    solver: super::solver::Scratch,
}
impl Scratch {
    pub fn solve(
        &mut self,
        values: &mut [(BodyId, rp::Vector)],
        rows: &[Row],
        planar: bool,
        work: &mut Work,
        max_scratch: usize,
    ) -> Result<usize, TrajectoryError> {
        self.solve_impl(values, rows, planar, work, max_scratch, None)?
            .ok_or(TrajectoryError::Unresolved)
    }

    /// Geometry-only output. None is an infeasible ordinary row solve; an Err
    /// from representable-value polishing stays a checked error, not a stop.
    // Carry provenance, row inputs and shared admission stay explicit at this private seam.
    #[allow(clippy::too_many_arguments)]
    pub fn solve_with_carry(
        &mut self,
        values: &mut [(BodyId, rp::Vector)],
        carry: &[rp::Vector],
        carry_rows: &[Option<rp::Vector>],
        rows: &[Row],
        planar: bool,
        work: &mut Work,
        max_scratch: usize,
    ) -> Result<Option<usize>, TrajectoryError> {
        if carry.len() != values.len() || carry_rows.len() != rows.len() {
            return Err(TrajectoryError::InvalidReference);
        }
        self.solve_impl(
            values,
            rows,
            planar,
            work,
            max_scratch,
            Some((carry, carry_rows)),
        )
    }

    /// Read only after solve_with_carry returned Some, in the input body order.
    pub fn solved_carry(&self) -> impl ExactSizeIterator<Item = (BodyId, rp::Vector)> + '_ {
        self.actors.iter().map(|a| (a.id, a.carry))
    }

    fn solve_impl(
        &mut self,
        values: &mut [(BodyId, rp::Vector)],
        rows: &[Row],
        planar: bool,
        work: &mut Work,
        max_scratch: usize,
        carry: Option<(&[rp::Vector], &[Option<rp::Vector>])>,
    ) -> Result<Option<usize>, TrajectoryError> {
        let n = values.len();
        let r = rows.len();
        let bytes = n
            .checked_mul(
                std::mem::size_of::<Actor>()
                    + 3 * std::mem::size_of::<f64>()
                    + std::mem::size_of::<rp::Vector>(),
            )
            .and_then(|b| {
                r.checked_mul(std::mem::size_of::<Constraint>() + 4 * std::mem::size_of::<f64>())
                    .and_then(|c| b.checked_add(c))
            })
            .ok_or(TrajectoryError::WorkLimit)?;
        if bytes > max_scratch {
            return Err(TrajectoryError::WorkLimit);
        }
        // Solver sweeps/accelerations are admitted at their actual visits.
        // Keep only the constructor's linear input inventory here.
        if let Some((values, tags)) = carry {
            work.charge(
                u64::try_from(n.checked_add(r).ok_or(TrajectoryError::WorkLimit)?)
                    .map_err(|_| TrajectoryError::WorkLimit)?,
            )?;
            if values.iter().any(|v| !v.is_finite())
                || tags.iter().flatten().any(|v| !v.is_finite())
            {
                return Err(TrajectoryError::NonFinite);
            }
        }
        work.charge(
            u64::try_from(n.checked_add(r).ok_or(TrajectoryError::WorkLimit)?)
                .map_err(|_| TrajectoryError::WorkLimit)?,
        )?;
        self.actors
            .try_reserve(n.saturating_sub(self.actors.len()))
            .map_err(|_| TrajectoryError::WorkLimit)?;
        self.contacts
            .try_reserve(r.saturating_sub(self.contacts.len()))
            .map_err(|_| TrajectoryError::WorkLimit)?;
        self.solver
            .try_reserve(n, r)
            .map_err(|_| TrajectoryError::WorkLimit)?;
        self.actors.clear();
        self.contacts.clear();
        let mut all_transport = carry.is_some();
        for (index, &(id, velocity)) in values.iter().enumerate() {
            let attributed = carry.map_or(rp::Vector::ZERO, |(values, _)| values[index]);
            all_transport &= attributed == velocity;
            self.actors.push(Actor {
                id,
                collider: rp::ColliderHandle::invalid(),
                velocity,
                applied: rp::Vector::ZERO,
                carry: attributed,
                applied_carry: rp::Vector::ZERO,
                previous_velocity: velocity,
                out: Default::default(),
                pair_casts: 0,
                pair_contacts: 0,
                pair_failures: 0,
                iterations: 0,
                limited: false,
                blocked_by_character: false,
            });
        }
        for (index, row) in rows.iter().enumerate() {
            all_transport &= carry.is_some_and(|(_, tags)| tags[index] == Some(row.velocity));
            if row.a >= n
                || row.b.is_some_and(|b| b >= n || b == row.a)
                || !row.normal.is_finite()
                || !row.velocity.is_finite()
            {
                return Err(TrajectoryError::NonFinite);
            }
            self.contacts.push(Constraint {
                a: row.a,
                b: row.b,
                target: rp::ColliderHandle::invalid(),
                source: rp::ColliderHandle::invalid(),
                normal: row.normal,
                velocity: row.velocity,
            });
        }
        let feasible = if let Some((_, tags)) = carry {
            super::solver::solve_tagged(
                &mut self.actors,
                &self.contacts,
                planar,
                1e-6,
                &mut self.solver,
                tags,
                work,
            )?
        } else {
            super::solver::solve_metered(
                &mut self.actors,
                &self.contacts,
                planar,
                1e-6,
                &mut self.solver,
                work,
            )?
        };
        if !feasible {
            return Ok(None);
        }
        if let Some((_, tags)) = carry {
            let mut inward = false;
            for contact in &self.contacts {
                work.charge(1)?;
                if super::residual(contact, &self.actors) > 0. {
                    inward = true;
                    break;
                }
            }
            if inward {
                // Construct a non-inward F32 proposal for the strict continuous
                // guard, without changing the established physical tolerance.
                if let Some((values, tags)) = carry {
                    work.charge(
                        u64::try_from(n.checked_add(r).ok_or(TrajectoryError::WorkLimit)?)
                            .map_err(|_| TrajectoryError::WorkLimit)?,
                    )?;
                    if values.iter().any(|v| !v.is_finite())
                        || tags.iter().flatten().any(|v| !v.is_finite())
                    {
                        return Err(TrajectoryError::NonFinite);
                    }
                }
                let exact = super::solver::solve_tagged(
                    &mut self.actors,
                    &self.contacts,
                    planar,
                    0.,
                    &mut self.solver,
                    tags,
                    work,
                )?;
                let mut strict = exact;
                if exact {
                    for contact in &self.contacts {
                        work.charge(1)?;
                        let non_inward = super::residual(contact, &self.actors) <= 0.;
                        if !non_inward {
                            strict = false;
                            break;
                        }
                    }
                }
                if !strict
                    && !super::solver::adjacent_feasible(
                        &mut self.actors,
                        &self.contacts,
                        planar,
                        tags,
                        work,
                    )?
                {
                    return Err(TrajectoryError::Unresolved);
                }
            }
        }
        // A wholly transported canonical input remains wholly transport after
        // PGS/CG/representable polishing. Preserve that exact identity instead
        // of deriving it from already rounded intermediate tag updates.
        if all_transport {
            work.charge(self.actors.len() as u64)?;
            for actor in &mut self.actors {
                actor.carry = actor.velocity;
            }
        }
        // Commit the local plan only after the complete existing solver has
        // produced a finite feasible vector. No partial output on failure.
        for actor in &self.actors {
            work.charge(1)?;
            if !actor.velocity.is_finite() || !actor.carry.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
        }
        // Admit the complete non-fallible caller write before its first value.
        work.charge(values.len() as u64)?;
        for (value, actor) in values.iter_mut().zip(&self.actors) {
            value.1 = actor.velocity;
        }
        Ok(Some(bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn values(n: usize) -> Vec<(BodyId, rp::Vector)> {
        (0..n)
            .map(|i| {
                (
                    BodyId {
                        slot: i as u32,
                        generation: 0,
                    },
                    if i == 0 {
                        rp::Vector::X * n as f32
                    } else {
                        rp::Vector::ZERO
                    },
                )
            })
            .collect()
    }
    fn rows(n: usize) -> Vec<Row> {
        (0..n - 1)
            .map(|i| Row {
                a: i,
                b: Some(i + 1),
                normal: -rp::Vector::X,
                velocity: rp::Vector::ZERO,
            })
            .collect()
    }
    #[test]
    fn actual_control_rows_keep_fair64_chain_and_exact_work_budget() {
        let initial = values(64);
        let rows = rows(64);
        let mut actual = initial.clone();
        let mut work = Work {
            used: 0,
            limit: 1 << 24,
        };
        let bytes = Scratch::default()
            .solve(&mut actual, &rows, true, &mut work, 1 << 20)
            .unwrap();
        let sum: f32 = actual.iter().map(|v| v.1.x).sum();
        assert!((sum - 64.).abs() < 1e-4);
        assert!(actual
            .iter()
            .all(|v| (v.1.x - 1.).abs() < 1e-4 && v.1.y == 0. && v.1.z == 0.));
        let mut exact = initial.clone();
        let mut quota = Work {
            used: 0,
            limit: work.used,
        };
        assert_eq!(
            Scratch::default()
                .solve(&mut exact, &rows, true, &mut quota, bytes)
                .unwrap(),
            bytes
        );
        assert_eq!(exact, actual);
        let mut short = initial.clone();
        let mut quota = Work {
            used: 0,
            limit: work.used - 1,
        };
        assert_eq!(
            Scratch::default().solve(&mut short, &rows, true, &mut quota, bytes),
            Err(TrajectoryError::WorkLimit)
        );
        assert_eq!(short, initial);
        let mut quota = Work {
            used: 0,
            limit: work.used,
        };
        assert_eq!(
            Scratch::default().solve(&mut short, &rows, true, &mut quota, bytes - 1),
            Err(TrajectoryError::WorkLimit)
        );
        assert_eq!(short, initial);
    }
    #[test]
    fn inconsistent_actual_control_plan_never_partly_replaces_source_velocities() {
        let mut actual = values(1);
        let before = actual.clone();
        let rows = [
            Row {
                a: 0,
                b: None,
                normal: rp::Vector::X,
                velocity: rp::Vector::X,
            },
            Row {
                a: 0,
                b: None,
                normal: -rp::Vector::X,
                velocity: -rp::Vector::X,
            },
        ];
        let mut work = Work {
            used: 0,
            limit: 1 << 24,
        };
        assert_eq!(
            Scratch::default().solve(&mut actual, &rows, true, &mut work, 1 << 20),
            Err(TrajectoryError::Unresolved)
        );
        assert_eq!(actual, before);
    }
}

#[cfg(test)]
mod carry_tests {
    use super::*;
    fn run(
        initial: &[rp::Vector],
        carry: &[rp::Vector],
        rows: &[Row],
        tags: &[Option<rp::Vector>],
    ) -> (Vec<(BodyId, rp::Vector)>, Vec<rp::Vector>, u64, usize) {
        let mut values: Vec<_> = initial
            .iter()
            .enumerate()
            .map(|(i, &v)| {
                (
                    BodyId {
                        slot: i as u32,
                        generation: 0,
                    },
                    v,
                )
            })
            .collect();
        let mut work = Work {
            used: 0,
            limit: 1 << 25,
        };
        let mut s = Scratch::default();
        let bytes = s
            .solve_with_carry(&mut values, carry, tags, rows, false, &mut work, 1 << 20)
            .unwrap()
            .unwrap();
        (
            values,
            s.solved_carry().map(|v| v.1).collect(),
            work.used,
            bytes,
        )
    }
    #[test]
    fn virtual_relative_transport_crosses_a_pair_and_opposing_intent_stays_immutable() {
        let pair = [Row {
            a: 0,
            b: Some(1),
            normal: -rp::Vector::X,
            velocity: rp::Vector::ZERO,
        }];
        let (v, c, _, _) = run(
            &[rp::Vector::X * 2., rp::Vector::ZERO],
            &[rp::Vector::X * 2., rp::Vector::ZERO],
            &pair,
            &[Some(rp::Vector::ZERO)],
        );
        assert_eq!(
            v.iter().map(|v| v.1).collect::<Vec<_>>(),
            [rp::Vector::X; 2]
        );
        assert_eq!(c, [rp::Vector::X; 2]);
        let wall = [Row {
            a: 0,
            b: None,
            normal: -rp::Vector::X,
            velocity: rp::Vector::ZERO,
        }];
        let (v, c, used, bytes) = run(
            &[rp::Vector::X],
            &[rp::Vector::X * 2.],
            &wall,
            &[Some(rp::Vector::ZERO)],
        );
        assert_eq!(v[0].1, rp::Vector::ZERO);
        assert_eq!(c, [rp::Vector::X]);
        // free -1 plus remaining carry +1 is the accepted total zero. This
        // decomposition is report-only; rebuilding after driver0 uses free -1.
        let mut original = vec![(v[0].0, rp::Vector::X)];
        let before = original.clone();
        assert_eq!(
            Scratch::default().solve_with_carry(
                &mut original,
                &[rp::Vector::X * 2.],
                &[Some(rp::Vector::ZERO)],
                &wall,
                false,
                &mut Work {
                    used: 0,
                    limit: used - 1
                },
                bytes
            ),
            Err(TrajectoryError::WorkLimit)
        );
        assert_eq!(original, before);
        let mut exact = before.clone();
        let mut work = Work {
            used: 0,
            limit: used,
        };
        Scratch::default()
            .solve_with_carry(
                &mut exact,
                &[rp::Vector::X * 2.],
                &[Some(rp::Vector::ZERO)],
                &wall,
                false,
                &mut work,
                bytes,
            )
            .unwrap()
            .unwrap();
        assert_eq!(exact, v);
    }
    #[test]
    fn independent_normal_transport_does_not_absorb_real_upward_or_pusher_motion() {
        let rows = [
            Row {
                a: 0,
                b: None,
                normal: rp::Vector::Y,
                velocity: rp::Vector::ZERO,
            },
            Row {
                a: 0,
                b: None,
                normal: rp::Vector::X,
                velocity: rp::Vector::X * 3.,
            },
        ];
        let initial = rp::Vector::Y * (-0.125);
        let (v, c, _, _) = run(
            &[initial],
            &[initial],
            &rows,
            &[Some(rp::Vector::ZERO), None],
        );
        assert_eq!(v[0].1, rp::Vector::X * 3.);
        assert_eq!(c, [rp::Vector::ZERO]);
        let (v, c, _, _) = run(
            &[rp::Vector::ZERO],
            &[rp::Vector::ZERO],
            &rows[1..],
            &[Some(rp::Vector::ZERO)],
        );
        assert_eq!(v[0].1, rp::Vector::X * 3.);
        assert_eq!(c, [rp::Vector::ZERO]);
        let rising = [Row {
            a: 0,
            b: None,
            normal: rp::Vector::Y,
            velocity: rp::Vector::Y * 0.5,
        }];
        let (v, c, _, _) = run(&[rp::Vector::ZERO], &[rp::Vector::ZERO], &rising, &[None]);
        assert_eq!(v[0].1, rp::Vector::Y * 0.5);
        assert_eq!(c, [rp::Vector::ZERO]);
    }
    #[test]
    fn geometry_rows_polish_a_sub_ulp_inward_remainder_without_changing_physical_solver() {
        let target = -9.380261e-6;
        let row = [Row {
            a: 0,
            b: None,
            normal: rp::Vector::Y,
            velocity: rp::Vector::Y * target,
        }];
        let initial = rp::Vector::Y * (-9.380281e-6);
        let (v, _, _, _) = run(
            &[initial],
            &[rp::Vector::ZERO],
            &row,
            &[Some(rp::Vector::ZERO)],
        );
        assert!(v[0].1.y >= target);
        let mut physical = vec![(v[0].0, initial)];
        Scratch::default()
            .solve(
                &mut physical,
                &row,
                false,
                &mut Work {
                    used: 0,
                    limit: 1 << 25,
                },
                1 << 20,
            )
            .unwrap();
        assert_eq!(physical[0].1, initial);
    }
    #[test]
    fn finite_tag_input_with_overflowing_relative_transport_is_rejected_atomically() {
        let id = |slot| BodyId {
            slot,
            generation: 0,
        };
        let mut values = vec![(id(0), rp::Vector::X * 2.), (id(1), rp::Vector::ZERO)];
        let before = values.clone();
        let row = [Row {
            a: 0,
            b: Some(1),
            normal: -rp::Vector::X,
            velocity: rp::Vector::ZERO,
        }];
        assert_eq!(
            Scratch::default().solve_with_carry(
                &mut values,
                &[rp::Vector::X * f32::MAX, -rp::Vector::X * f32::MAX],
                &[Some(rp::Vector::ZERO)],
                &row,
                false,
                &mut Work {
                    used: 0,
                    limit: 1 << 25
                },
                1 << 20
            ),
            Err(TrajectoryError::NonFinite)
        );
        assert_eq!(values, before);
    }
}

#[cfg(test)]
mod work_tests;

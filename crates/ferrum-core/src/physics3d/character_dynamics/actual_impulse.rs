//! Read-only finite-mass response plan at actual center-of-mass poses.
//! The backend has already integrated forces. This helper consumes none again.
use super::{accelerated, Node};
use crate::physics3d::{
    solver_trajectory::{TrajectoryError, Work},
    world::native_id,
    BodyId,
};
use rapier3d::prelude as rp;

#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d) enum MassPolicy {
    Native,
    Character(f32),
}
#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d) struct Participant {
    pub body: BodyId,
    pub pose: rp::Pose,
    pub linear_velocity: rp::Vector,
    pub angular_velocity: rp::Vector,
    pub mass: MassPolicy,
}
#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d) struct Row {
    pub a: usize,
    pub b: Option<usize>,
    pub point: rp::Vector,
    pub normal: rp::Vector,
    pub target_velocity: rp::Vector,
    pub minimum_velocity: f32,
}
#[derive(Default)]
pub(in crate::physics3d) struct Scratch {
    nodes: Vec<Node>,
    rows: Vec<super::Row>,
    accelerated: accelerated::Scratch,
}

impl Scratch {
    /// Actual normal impulses in the input row order, without allocation.
    /// Read only after `solve` returned Ok; a failed solve has no published result.
    /// Repeated physical solves start their own row impulses at zero. Callers
    /// accumulate only accepted physical increments, never geometry projections.
    pub fn solved_row_impulses(&self) -> impl ExactSizeIterator<Item = f32> + '_ {
        self.rows.iter().map(|row| row.impulse)
    }

    /// Row-net impulse contributions using the exact cached inverse masses
    /// (including native axis locks/planar) of the immediately preceding Ok
    /// solve. This is allocation-free attribution metadata, not a replacement
    /// for the actual sequential F32 participant velocity difference.
    pub fn solved_row_linear_contributions(
        &self,
    ) -> impl ExactSizeIterator<Item = (BodyId, rp::Vector, Option<(BodyId, rp::Vector)>)> + '_
    {
        self.rows.iter().map(|row| {
            let impulse = row.normal * row.impulse;
            let a = &self.nodes[row.a];
            (
                a.id,
                impulse * a.inv_mass,
                row.b.map(|index| {
                    let b = &self.nodes[index];
                    (b.id, (-impulse) * b.inv_mass)
                }),
            )
        })
    }

    /// Publish only velocities after every row has a finite feasible solution.
    /// Scratch is a conservative requested-layout bound, not a process RSS cap.
    pub fn solve(
        &mut self,
        bodies: &rp::RigidBodySet,
        values: &mut [Participant],
        rows: &[Row],
        planar: bool,
        work: &mut Work,
        max_scratch: usize,
    ) -> Result<usize, TrajectoryError> {
        let n = values.len();
        let r = rows.len();
        let scratch = n
            .checked_mul(std::mem::size_of::<Node>() + 4 * std::mem::size_of::<rp::Vector>())
            .and_then(|a| {
                r.checked_mul(
                    std::mem::size_of::<super::Row>() + 1 + 4 * std::mem::size_of::<f64>(),
                )
                .and_then(|b| a.checked_add(b))
            })
            .ok_or(TrajectoryError::WorkLimit)?;
        if scratch > max_scratch {
            return Err(TrajectoryError::WorkLimit);
        }
        let acceleration_work = r
            .checked_mul(2)
            .map(|i| i.min(4096))
            .and_then(|i| {
                r.checked_mul(8)
                    .and_then(|j| j.checked_add(n))
                    .and_then(|j| i.checked_mul(j))
            })
            .ok_or(TrajectoryError::WorkLimit)?;
        let allowance = r
            .checked_mul(64 * 8)
            .and_then(|p| p.checked_add(acceleration_work))
            .and_then(|w| w.checked_add(n).and_then(|w| w.checked_add(r)))
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(u64::try_from(allowance).map_err(|_| TrajectoryError::WorkLimit)?)?;
        self.nodes
            .try_reserve(n.saturating_sub(self.nodes.len()))
            .map_err(|_| TrajectoryError::WorkLimit)?;
        self.rows
            .try_reserve(r.saturating_sub(self.rows.len()))
            .map_err(|_| TrajectoryError::WorkLimit)?;
        self.accelerated
            .try_reserve(n, r)
            .map_err(|_| TrajectoryError::WorkLimit)?;
        self.nodes.clear();
        self.rows.clear();
        let mut previous = None;
        for p in values.iter() {
            if previous.is_some_and(|id| id >= p.body) {
                return Err(TrajectoryError::InvalidReference);
            }
            previous = Some(p.body);
            if !p.pose.is_finite()
                || !p.linear_velocity.is_finite()
                || !p.angular_velocity.is_finite()
                || (p.pose.rotation.length_squared() - 1.).abs() > 1e-5
            {
                return Err(TrajectoryError::NonFinite);
            }
            let body = bodies
                .get(native_id(p.body))
                .ok_or(TrajectoryError::InvalidReference)?;
            if !body.is_enabled() {
                return Err(TrajectoryError::InvalidReference);
            }
            let m = body.mass_properties();
            let character = matches!(p.mass, MassPolicy::Character(_));
            let (mut inv_mass, mut inv_inertia) = match p.mass {
                MassPolicy::Character(mass) if mass.is_finite() && mass > 0. => {
                    (rp::Vector::splat(1. / mass), rp::AngularInertia::zero())
                }
                MassPolicy::Character(_) => return Err(TrajectoryError::NonFinite),
                MassPolicy::Native if body.is_dynamic() => (
                    rp::Vector::splat(m.local_mprops.inv_mass),
                    m.local_mprops.world_inv_inertia(&p.pose.rotation),
                ),
                MassPolicy::Native => (rp::Vector::ZERO, rp::AngularInertia::zero()),
            };
            let locks = body.locked_axes();
            if locks.contains(rp::LockedAxes::TRANSLATION_LOCKED_X) {
                inv_mass.x = 0.;
            }
            if locks.contains(rp::LockedAxes::TRANSLATION_LOCKED_Y) {
                inv_mass.y = 0.;
            }
            if planar || locks.contains(rp::LockedAxes::TRANSLATION_LOCKED_Z) {
                inv_mass.z = 0.;
            }
            if locks.contains(rp::LockedAxes::ROTATION_LOCKED_X) {
                inv_inertia.m11 = 0.;
                inv_inertia.m12 = 0.;
                inv_inertia.m13 = 0.;
            }
            if locks.contains(rp::LockedAxes::ROTATION_LOCKED_Y) {
                inv_inertia.m22 = 0.;
                inv_inertia.m12 = 0.;
                inv_inertia.m23 = 0.;
            }
            if locks.contains(rp::LockedAxes::ROTATION_LOCKED_Z) {
                inv_inertia.m33 = 0.;
                inv_inertia.m13 = 0.;
                inv_inertia.m23 = 0.;
            }
            self.nodes.push(Node {
                id: p.body,
                character,
                linear: p.linear_velocity,
                angular: p.angular_velocity,
                initial_linear: p.linear_velocity,
                initial_angular: p.angular_velocity,
                inv_mass,
                inv_inertia,
                center: p.pose.translation,
                visits: 0,
                limited: false,
                native_contact: false,
                support_reaction: rp::Vector::ZERO,
            });
        }
        for row in rows {
            if row.a >= n
                || row.b.is_some_and(|b| b >= n || b == row.a)
                || !row.normal.is_finite()
                || (row.normal.length_squared() - 1.).abs() > 1e-5
                || !row.point.is_finite()
                || !row.target_velocity.is_finite()
                || !row.minimum_velocity.is_finite()
            {
                return Err(TrajectoryError::NonFinite);
            }
            self.rows.push(super::Row {
                a: row.a,
                b: row.b,
                point: row.point,
                normal: row.normal,
                target_velocity: row.target_velocity,
                minimum_velocity: row.minimum_velocity,
                impulse: 0.,
                pair: None,
            });
        }
        if !super::solve_rows(
            &mut self.nodes,
            &mut self.rows,
            &mut self.accelerated,
            || {
                work.charge(
                    u64::try_from(acceleration_work).map_err(|_| TrajectoryError::WorkLimit)?,
                )
            },
        )? {
            return Err(TrajectoryError::Unresolved);
        }
        if self
            .nodes
            .iter()
            .any(|n| !n.linear.is_finite() || !n.angular.is_finite())
        {
            return Err(TrajectoryError::NonFinite);
        }
        for (p, n) in values.iter_mut().zip(&self.nodes) {
            p.linear_velocity = n.linear;
            p.angular_velocity = n.angular;
        }
        Ok(scratch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (rp::RigidBodySet, [Participant; 2]) {
        let mut bodies = rp::RigidBodySet::new();
        let a = bodies.insert(rp::RigidBodyBuilder::dynamic().additional_mass(2.).build());
        let b = bodies.insert(rp::RigidBodyBuilder::dynamic().additional_mass(3.).build());
        // Builder additional mass is pending until the native mass update.
        // The response seam runs after that update in the backend barrier.
        let colliders = rp::ColliderSet::new();
        for body in [a, b] {
            bodies[body].recompute_mass_properties_from_colliders(&colliders);
        }
        assert_eq!(bodies[a].mass(), 2.);
        assert_eq!(bodies[b].mass(), 3.);
        let participant = |body: rp::RigidBodyHandle, velocity: rp::Vector| {
            let (slot, generation) = body.into_raw_parts();
            Participant {
                body: BodyId { slot, generation },
                pose: rp::Pose::default(),
                linear_velocity: velocity,
                angular_velocity: rp::Vector::ZERO,
                mass: MassPolicy::Native,
            }
        };
        (
            bodies,
            [
                participant(a, rp::Vector::X * 5.),
                participant(b, rp::Vector::ZERO),
            ],
        )
    }
    #[test]
    fn centered_capsule_push_shares_both_contact_impulses_without_spinning_the_crate() {
        let (mut bodies, mut initial) = fixture();
        initial[0].mass = MassPolicy::Character(2.);
        initial[0].linear_velocity = rp::Vector::X * 100.;
        initial[1].pose.translation = rp::Vector::X;
        let target = &mut bodies[native_id(initial[1].body)];
        target.set_additional_mass_properties(
            rp::MassProperties::from_cuboid(1., rp::Vector::new(0.25, 1., 1.)),
            false,
        );
        target.recompute_mass_properties_from_colliders(&rp::ColliderSet::new());
        assert_eq!(target.mass(), 2.);
        for height in [-0.25, 0.25] {
            let rows = [height, -height].map(|y| Row {
                a: 0,
                b: Some(1),
                point: rp::Vector::new(0.745, y, 0.),
                normal: -rp::Vector::X,
                target_velocity: rp::Vector::ZERO,
                minimum_velocity: 0.,
            });
            let solve = |values: &mut [Participant], rows: &[Row]| {
                let mut scratch = Scratch::default();
                let mut work = Work {
                    used: 0,
                    limit: u64::MAX,
                };
                scratch
                    .solve(&bodies, values, rows, false, &mut work, usize::MAX)
                    .unwrap();
                scratch.solved_row_impulses().collect::<Vec<_>>()
            };
            let mut values = initial;
            assert_eq!(solve(&mut values, &rows), [50., 50.]);
            for value in values {
                assert_eq!(value.linear_velocity, rp::Vector::X * 50.);
                assert_eq!(value.angular_velocity, rp::Vector::ZERO);
            }
            // The capsule and crate now have no relative speed. The wall load
            // must nevertheless propagate through both endpoints of their patch.
            let mut backed = rows.to_vec();
            for y in [-1., 1.] {
                for z in [-1., 1.] {
                    backed.push(Row {
                        a: 1,
                        b: None,
                        point: rp::Vector::new(1.25, y, z),
                        ..rows[0]
                    });
                }
            }
            assert_eq!(solve(&mut values, &backed), [50.; 6]);
            for value in values {
                assert_eq!(value.linear_velocity, rp::Vector::ZERO);
                assert_eq!(value.angular_velocity, rp::Vector::ZERO);
            }
        }
    }

    #[test]
    fn actual_finite_plan_preserves_momentum_and_exact_budgets() {
        let (bodies, initial) = fixture();
        let mut values = initial;
        let rows = [Row {
            a: 0,
            b: Some(1),
            point: rp::Vector::ZERO,
            normal: -rp::Vector::X,
            target_velocity: rp::Vector::ZERO,
            minimum_velocity: 0.,
        }];
        let source = postcard::to_allocvec(&bodies).unwrap();
        let mut work = Work {
            used: 0,
            limit: u64::MAX,
        };
        let bytes = Scratch::default()
            .solve(&bodies, &mut values, &rows, false, &mut work, usize::MAX)
            .unwrap();
        assert!((values[0].linear_velocity.x - 2.).abs() < 1e-5);
        assert!((values[1].linear_velocity.x - 2.).abs() < 1e-5);
        assert_eq!(source, postcard::to_allocvec(&bodies).unwrap());
        let mut exact = initial;
        let mut quota = Work {
            used: 0,
            limit: work.used,
        };
        assert_eq!(
            Scratch::default().solve(&bodies, &mut exact, &rows, false, &mut quota, bytes),
            Ok(bytes)
        );
        assert_eq!(values[0].linear_velocity, exact[0].linear_velocity);
        for (limit, scratch) in [(work.used - 1, bytes), (work.used, bytes - 1)] {
            let mut untouched = initial;
            let mut quota = Work { used: 0, limit };
            assert_eq!(
                Scratch::default().solve(
                    &bodies,
                    &mut untouched,
                    &rows,
                    false,
                    &mut quota,
                    scratch
                ),
                Err(TrajectoryError::WorkLimit)
            );
            assert_eq!(untouched[0].linear_velocity, initial[0].linear_velocity);
        }
    }

    #[test]
    fn actual_solved_row_impulses_match_momentum_and_reads_preserve_results() {
        let (bodies, mut values) = fixture();
        let raw = postcard::to_allocvec(&bodies).unwrap();
        let rows = [
            Row {
                a: 0,
                b: Some(1),
                point: rp::Vector::ZERO,
                normal: -rp::Vector::X,
                target_velocity: rp::Vector::ZERO,
                minimum_velocity: 0.,
            },
            Row {
                a: 0,
                b: None,
                point: rp::Vector::ZERO,
                normal: rp::Vector::Y,
                target_velocity: rp::Vector::ZERO,
                minimum_velocity: 0.,
            },
        ];
        let mut scratch = Scratch::default();
        scratch
            .solve(
                &bodies,
                &mut values,
                &rows,
                false,
                &mut Work {
                    used: 0,
                    limit: u64::MAX,
                },
                usize::MAX,
            )
            .unwrap();
        let before = values;
        let impulses: Vec<_> = scratch.solved_row_impulses().collect();
        assert_eq!(scratch.solved_row_impulses().len(), rows.len());
        assert_eq!(impulses.len(), 2);
        assert_eq!(impulses[1], 0.);
        assert!((impulses[0] - 6.).abs() < 1e-5);
        assert!((impulses[0] - 2. * (5. - values[0].linear_velocity.x)).abs() < 1e-5);
        assert!((impulses[0] - 3. * values[1].linear_velocity.x).abs() < 1e-5);
        assert_eq!(scratch.solved_row_impulses().collect::<Vec<_>>(), impulses);
        for (a, b) in values.iter().zip(&before) {
            assert_eq!(a.linear_velocity, b.linear_velocity);
            assert_eq!(a.angular_velocity, b.angular_velocity);
        }
        assert_eq!(postcard::to_allocvec(&bodies).unwrap(), raw);
    }
}

#[cfg(test)]
mod seed_tests;

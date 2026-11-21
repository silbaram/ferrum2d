//! Stage native CCD's transient sensor crossings from accepted actual curves.
//! All geometry and end-pose checks finish before the caller publishes bodies;
//! only a fully committed pipeline pass may flush the resulting event pairs.
use super::actual_scene::{self, BodyTrajectory, ColliderTrajectory};
use crate::physics3d::{
    character::CharacterRuntime,
    contact_policy::ContactPolicies,
    motion_trace::AcceptedCurve,
    solver_trajectory::{self, Curve, ShapeMotion, Time, TrajectoryError, Work},
    BodyId,
};
use rapier3d::prelude as rp;
use std::collections::BTreeMap;
const MAX: usize = 1 << 20;
#[derive(Clone, Copy)]
struct Pair {
    a: rp::ColliderHandle,
    b: rp::ColliderHandle,
    initial: bool,
    final_overlap: bool,
}
#[derive(Default)]
pub(in crate::physics3d) struct Scratch {
    curves: Vec<AcceptedCurve>,
    cuts: Vec<Time>,
    trajectories: Vec<BodyTrajectory>,
    pairs: Vec<Pair>,
    scene: actual_scene::Scratch,
    ready: bool,
}
fn identity(h: rp::RigidBodyHandle) -> BodyId {
    let (slot, generation) = h.into_raw_parts();
    BodyId { slot, generation }
}
fn reserve<T>(v: &mut Vec<T>, n: usize) -> Result<(), TrajectoryError> {
    if n > MAX {
        return Err(TrajectoryError::WorkLimit);
    }
    v.try_reserve(n.saturating_sub(v.len()))
        .map_err(|_| TrajectoryError::WorkLimit)
}
fn overlap(
    a: &rp::Collider,
    pa: rp::Pose,
    b: &rp::Collider,
    pb: rp::Pose,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let motion = |pose| ShapeMotion {
        curve: Curve::Constant {
            pose,
            start_time: 0.,
            end_time: 0.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let mut found = false;
    solver_trajectory::contacts_full_shapes(
        motion(pa),
        a.shape(),
        motion(pb),
        b.shape(),
        0.,
        0.,
        work,
        &mut |_, _, _, _| {
            found = true;
            Ok(())
        },
    )?;
    Ok(found)
}
fn pose(
    c: &rp::Collider,
    bodies: &rp::RigidBodySet,
    ends: Option<&[(BodyId, rp::Pose)]>,
) -> Result<rp::Pose, TrajectoryError> {
    let Some(parent) = c.parent() else {
        return Ok(*c.position());
    };
    let body = bodies
        .get(parent)
        .ok_or(TrajectoryError::InvalidReference)?;
    let origin = match ends {
        None => *body.position(),
        Some(ends) => ends
            .binary_search_by_key(&identity(parent), |v| v.0)
            .ok()
            .map_or(*body.position(), |i| ends[i].1),
    };
    Ok(origin * c.position_wrt_parent().copied().unwrap_or_default())
}
impl Scratch {
    pub fn begin_pass(&mut self) {
        self.pairs.clear();
        self.ready = false;
    }
    pub fn crossings(&self) -> impl Iterator<Item = (rp::ColliderHandle, rp::ColliderHandle)> + '_ {
        self.pairs
            .iter()
            .filter(|p| self.ready && !p.initial && !p.final_overlap)
            .map(|p| (p.a, p.b))
    }
    /// `final_origins` is Some only at the native context's exact last interval.
    /// It contains sorted actual planned body-origin poses, including authored
    /// position targets only when the native writeback will really retain them.
    #[allow(clippy::too_many_arguments)]
    pub fn plan_interval(
        &mut self,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        policies: &ContactPolicies,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        accepted: &[AcceptedCurve],
        start: Time,
        end: Time,
        final_origins: Option<&[(BodyId, rp::Pose)]>,
        work: &mut Work,
        max_scratch: usize,
        eligible: &impl Fn(&ColliderTrajectory, &ColliderTrajectory) -> bool,
    ) -> Result<(), TrajectoryError> {
        self.ready = false;
        let n = accepted.len();
        let cuts = n
            .checked_mul(2)
            .and_then(|v| v.checked_add(2))
            .ok_or(TrajectoryError::WorkLimit)?;
        let bytes = n
            .checked_mul(
                std::mem::size_of::<AcceptedCurve>() + std::mem::size_of::<BodyTrajectory>(),
            )
            .and_then(|v| {
                cuts.checked_mul(std::mem::size_of::<Time>())
                    .and_then(|a| v.checked_add(a))
            })
            .and_then(|v| {
                self.pairs
                    .len()
                    .checked_mul(std::mem::size_of::<Pair>())
                    .and_then(|a| v.checked_add(a))
            })
            .ok_or(TrajectoryError::WorkLimit)?;
        if bytes > max_scratch || n > MAX || cuts > MAX {
            return Err(TrajectoryError::WorkLimit);
        }
        let log = if cuts == 0 {
            0
        } else {
            usize::BITS - cuts.leading_zeros()
        };
        work.charge(
            (cuts as u64)
                .checked_mul(16 * (u64::from(log) + 1))
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        reserve(&mut self.curves, n)?;
        reserve(&mut self.cuts, cuts)?;
        reserve(&mut self.trajectories, n)?;
        self.curves.clear();
        self.cuts.clear();
        self.trajectories.clear();
        self.curves.extend_from_slice(accepted);
        self.cuts.extend([start, end]);
        for curve in &self.curves {
            if !curve.start_time.is_finite()
                || !curve.end_time.is_finite()
                || curve.start_time < start
                || curve.end_time > end
                || curve.end_time < curve.start_time
            {
                return Err(TrajectoryError::InvalidTime);
            }
            self.cuts.extend([curve.start_time, curve.end_time]);
        }
        self.curves.sort_unstable_by(|a, b| {
            a.body
                .into_raw_parts()
                .cmp(&b.body.into_raw_parts())
                .then(a.start_time.total_cmp(&b.start_time))
                .then(a.end_time.total_cmp(&b.end_time))
        });
        self.cuts.sort_unstable_by(Time::total_cmp);
        self.cuts.dedup();
        for pair in self.cuts.windows(2) {
            let from = pair[0];
            let until = pair[1];
            if from == until {
                continue;
            }
            self.trajectories.clear();
            let mut i = 0;
            while i < self.curves.len() {
                let body = self.curves[i].body;
                let mut selected = None;
                while i < self.curves.len() && self.curves[i].body == body {
                    work.charge(1)?;
                    let row = self.curves[i];
                    if row.start_time <= from && row.end_time >= until {
                        selected = Some(row.curve);
                    }
                    i += 1;
                }
                self.trajectories.push(BodyTrajectory {
                    body,
                    curve: selected.ok_or(TrajectoryError::MissingBodyMotion)?,
                });
            }
            self.scene.prepare(
                bodies,
                colliders,
                &self.trajectories,
                characters,
                from,
                until,
                max_scratch - bytes,
                work,
            )?;
            let pairs = &mut self.pairs;
            self.scene.sensor_hits(
                colliders,
                policies,
                from,
                until,
                work,
                eligible,
                &mut |a, b, _, work| {
                    let (a, b) = if a.collider.into_raw_parts() < b.collider.into_raw_parts() {
                        (a.collider, b.collider)
                    } else {
                        (b.collider, a.collider)
                    };
                    let key = (a.into_raw_parts(), b.into_raw_parts());
                    work.charge((usize::BITS as u64 + 1) + (pairs.len() as u64))?;
                    match pairs.binary_search_by_key(&key, |p| {
                        (p.a.into_raw_parts(), p.b.into_raw_parts())
                    }) {
                        Ok(_) => {}
                        Err(index) => {
                            let count = pairs
                                .len()
                                .checked_add(1)
                                .ok_or(TrajectoryError::WorkLimit)?;
                            if bytes
                                .checked_add(count * std::mem::size_of::<Pair>())
                                .is_none_or(|n| n > max_scratch)
                            {
                                return Err(TrajectoryError::WorkLimit);
                            }
                            reserve(pairs, count)?;
                            let ca = colliders.get(a).ok_or(TrajectoryError::InvalidReference)?;
                            let cb = colliders.get(b).ok_or(TrajectoryError::InvalidReference)?;
                            let initial = overlap(
                                ca,
                                pose(ca, bodies, None)?,
                                cb,
                                pose(cb, bodies, None)?,
                                work,
                            )?;
                            pairs.insert(
                                index,
                                Pair {
                                    a,
                                    b,
                                    initial,
                                    final_overlap: false,
                                },
                            );
                        }
                    }
                    Ok(())
                },
            )?;
        }
        if let Some(ends) = final_origins {
            work.charge(ends.len() as u64)?;
            if ends.windows(2).any(|p| p[0].0 >= p[1].0) || ends.iter().any(|p| !p.1.is_finite()) {
                return Err(TrajectoryError::InvalidReference);
            }
            for pair in &mut self.pairs {
                let ca = colliders
                    .get(pair.a)
                    .ok_or(TrajectoryError::InvalidReference)?;
                let cb = colliders
                    .get(pair.b)
                    .ok_or(TrajectoryError::InvalidReference)?;
                pair.final_overlap = overlap(
                    ca,
                    pose(ca, bodies, Some(ends))?,
                    cb,
                    pose(cb, bodies, Some(ends))?,
                    work,
                )?;
            }
            self.ready = true;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::{
        world::native_id, BodyDesc, BodyKind, ColliderDesc, PhysicsWorld3d, Pose, Shape,
        SolverSettings, WorldConfig,
    };
    #[test]
    fn rotating_actual_sensor_crossing_is_staged_with_no_endpoint_overlap_or_source_mutation() {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            step_seconds: 0.1,
            solver: SolverSettings {
                velocity_iterations: 1,
                ..SolverSettings::default()
            },
            ..WorldConfig::default()
        })
        .unwrap();
        let bar = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicVelocity,
                    angular_velocity: [0., 0., 80.],
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [2., 0.025, 0.1],
                }),
            )
            .unwrap();
        let body = &world.backend.bodies[native_id(bar)];
        let mut accepted = Vec::new();
        let n = world.backend.integration_parameters.num_solver_iterations;
        let duration = f64::from(world.backend.integration_parameters.dt);
        body.visit_kinematic_motion(
            native_id(bar),
            &world.backend.integration_parameters,
            1,
            |m| {
                let i = accepted.len();
                let domain = crate::physics3d::solver_trajectory::Domain {
                    start: duration * i as Time / n as Time,
                    end: duration * (i + 1) as Time / n as Time,
                };
                accepted.push(AcceptedCurve {
                    body: native_id(bar),
                    curve: Curve::Integrated(
                        crate::physics3d::solver_trajectory::Kernel::from_native(m, domain)
                            .unwrap(),
                    ),
                    start_time: domain.start,
                    end_time: domain.end,
                })
            },
        );
        // Velocity sweeps do not change the native integration cadence. Keep
        // every actual kernel interval, including its original COM rounding.
        assert_eq!(
            accepted.len(),
            world.backend.integration_parameters.num_solver_iterations
        );
        assert_eq!(accepted.first().unwrap().start_time, 0.);
        assert_eq!(accepted.last().unwrap().end_time, duration);
        for pair in accepted.windows(2) {
            assert_eq!(pair[0].end_time, pair[1].start_time);
        }
        let end = accepted
            .last()
            .unwrap()
            .curve
            .com_pose(duration)
            .prepend_translation(-body.local_center_of_mass());
        // The native speed cap remains active. Place the sensor inside the
        // actual capped arc instead of assuming the authored 80 rad/s survives.
        let middle = accepted[accepted.len() / 2];
        let middle_time = middle.start_time + (middle.end_time - middle.start_time) * 0.5;
        let middle_pose = middle
            .curve
            .com_pose(middle_time)
            .prepend_translation(-body.local_center_of_mass());
        let sensor_position = middle_pose * rp::Vector::new(1.5, 0., 0.);
        let sensor = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position: sensor_position.to_array(),
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    sensor: true,
                    ..ColliderDesc::new(Shape::Sphere { radius: 0.1 })
                },
            )
            .unwrap();
        let bar_collider =
            &world.backend.colliders[world.backend.bodies[native_id(bar)].colliders()[0]];
        let sensor_collider =
            &world.backend.colliders[world.backend.bodies[native_id(sensor)].colliders()[0]];
        let mut fixture_work = Work {
            used: 0,
            limit: u64::MAX,
        };
        for endpoint in [*bar_collider.position(), end] {
            assert!(!overlap(
                bar_collider,
                endpoint,
                sensor_collider,
                *sensor_collider.position(),
                &mut fixture_work,
            )
            .unwrap());
        }
        assert!(overlap(
            bar_collider,
            middle_pose,
            sensor_collider,
            *sensor_collider.position(),
            &mut fixture_work,
        )
        .unwrap());
        let final_origins = [(bar, end)];
        let before = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
        let mut scratch = Scratch::default();
        let mut work = Work {
            used: 0,
            limit: u64::MAX,
        };
        scratch.begin_pass();
        scratch
            .plan_interval(
                &world.backend.bodies,
                &world.backend.colliders,
                &world.contact_policies,
                &world.characters,
                &accepted,
                0.,
                duration,
                Some(&final_origins),
                &mut work,
                1 << 20,
                &|_, _| true,
            )
            .unwrap();
        assert_eq!(scratch.crossings().count(), 1);
        assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), before);
        let mut exact = Scratch::default();
        exact.begin_pass();
        let mut quota = Work {
            used: 0,
            limit: work.used,
        };
        exact
            .plan_interval(
                &world.backend.bodies,
                &world.backend.colliders,
                &world.contact_policies,
                &world.characters,
                &accepted,
                0.,
                duration,
                Some(&final_origins),
                &mut quota,
                1 << 20,
                &|_, _| true,
            )
            .unwrap();
        assert_eq!(
            exact.crossings().collect::<Vec<_>>(),
            scratch.crossings().collect::<Vec<_>>()
        );
        let mut short = Scratch::default();
        short.begin_pass();
        let mut quota = Work {
            used: 0,
            limit: work.used - 1,
        };
        assert_eq!(
            short.plan_interval(
                &world.backend.bodies,
                &world.backend.colliders,
                &world.contact_policies,
                &world.characters,
                &accepted,
                0.,
                duration,
                Some(&final_origins),
                &mut quota,
                1 << 20,
                &|_, _| true
            ),
            Err(TrajectoryError::WorkLimit)
        );
        assert_eq!(short.crossings().count(), 0);
        assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), before);
    }
}

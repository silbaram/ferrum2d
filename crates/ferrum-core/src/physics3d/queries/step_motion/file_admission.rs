//! Cold validation of the completed-step query observation owner.
//! Stale handles/history remain observations; no current-world equality, query,
//! cache rebuild or shape normalization is performed here.
use super::*;
use crate::physics3d::{
    motion_work::Work,
    snapshot::PhysicsSnapshotError,
    solver_trajectory::{Curve, Domain, Kernel},
};

const MAX_SEGMENTS: usize = 1 << 20;
const MAX_WORK: u64 = 128 * 1024 * 1024;
const SEGMENT_WORK: u64 = 512;
fn rotation(q: rp::Rotation) -> bool {
    q.is_finite() && (q.length_squared() - 1.).abs() <= 1e-5
}
fn pose(p: rp::Pose) -> bool {
    p.translation.is_finite() && rotation(p.rotation)
}
fn integration(kernel: Kernel) -> bool {
    if Domain::new(kernel.domain.start, kernel.domain.end).is_err()
        || kernel.domain.start < 0.
        || kernel.domain.duration() <= 0.
        || Kernel::from_native(kernel.native, kernel.domain).is_err()
    {
        return false;
    }
    let m = kernel.native;
    if !m.motion.start_time.is_finite()
        || !m.motion.end_time.is_finite()
        || m.motion.start_time < 0.
        || m.motion.end_time <= m.motion.start_time
        || !m.integration_seconds.is_finite()
        || m.integration_seconds <= 0.
        || !m.linear_velocity.is_finite()
        || !m.angular_velocity.is_finite()
        || !pose(m.motion.start)
        || !pose(m.motion.end)
    {
        return false;
    }
    rapier3d::pipeline::SolverBodyIntegration::from_velocity(
        m.motion.body,
        0.,
        m.integration_seconds,
        m.motion.start,
        m.linear_velocity,
        m.angular_velocity,
    )
    .is_some_and(|actual| actual.motion.end == m.motion.end)
}
fn curve(c: Curve) -> bool {
    match c {
        Curve::Integrated(m) => integration(m),
        Curve::Constant {
            pose: p,
            start_time,
            end_time,
        } => {
            pose(p)
                && start_time.is_finite()
                && end_time.is_finite()
                && start_time >= 0.
                && end_time >= start_time
                && (end_time - start_time).is_finite()
        }
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation: q,
        } => {
            integration(carrier)
                && anchor.is_finite()
                && offset.is_finite()
                && linear_velocity.is_finite()
                && rotation(q)
        }
        Curve::Ccd {
            sweep,
            start_time,
            end_time,
        } => {
            sweep.local_center.is_finite()
                && sweep.c1.is_finite()
                && sweep.c2.is_finite()
                && rotation(sweep.q1)
                && rotation(sweep.q2)
                && start_time.is_finite()
                && end_time.is_finite()
                && start_time >= 0.
                && end_time > start_time
                && (end_time - start_time).is_finite()
        }
    }
}
impl StepMotion {
    pub(in crate::physics3d) fn validate_saved_payload(&self) -> Result<(), PhysicsSnapshotError> {
        self.validate_saved_payload_with_limit(MAX_WORK).map(|_| ())
    }
    fn validate_saved_payload_with_limit(&self, limit: u64) -> Result<u64, PhysicsSnapshotError> {
        let invalid = || PhysicsSnapshotError::InvalidState;
        let capacity = || PhysicsSnapshotError::Capacity;
        if self.segments.len() > MAX_SEGMENTS
            || self.starts.len() > MAX_SEGMENTS
            || self.leaves > MAX_SEGMENTS
        {
            return Err(capacity());
        }
        let mut work = Work { used: 0, limit };
        let charge = self
            .segments
            .len()
            .checked_mul(SEGMENT_WORK as usize)
            .and_then(|n| {
                self.starts
                    .len()
                    .checked_mul(32)
                    .and_then(|m| m.checked_add(n))
            })
            .and_then(|n| n.checked_add(16))
            .ok_or_else(capacity)?;
        work.charge(charge as u64).map_err(|_| capacity())?;
        if !self.elapsed.is_finite()
            || !(0. ..=1.).contains(&self.elapsed)
            || self.ready
                && (!self.enabled || self.exact_failed || self.leaves != self.segments.len())
        {
            return Err(invalid());
        }
        if self
            .starts
            .windows(2)
            .any(|p| p[0].collider.into_raw_parts() >= p[1].collider.into_raw_parts())
        {
            return Err(invalid());
        }
        for start in &self.starts {
            if !pose(start.pose) || !pose(start.local_pose) {
                return Err(invalid());
            }
        }
        for segment in &self.segments {
            if !segment.start_fraction.is_finite()
                || !segment.end_fraction.is_finite()
                || segment.start_fraction < 0.
                || segment.end_fraction < segment.start_fraction
                || segment.end_fraction > 1.
                || !pose(segment.motion.start)
                || !segment.motion.local_center.is_finite()
                || !segment.motion.linvel.is_finite()
                || !segment.motion.angvel.is_finite()
            {
                return Err(invalid());
            }
            if let Some(exact) = &segment.exact {
                let m = exact.motion;
                let key = segment.collider.into_raw_parts();
                let start = self
                    .starts
                    .binary_search_by_key(&key, |s| s.collider.into_raw_parts())
                    .ok()
                    .map(|i| &self.starts[i])
                    .ok_or_else(invalid)?;
                if exact.owner != start.body
                    || m.local_pose != start.local_pose
                    || matches!(m.curve,Curve::Integrated(integration) if integration.native.motion.body!=exact.owner)
                {
                    return Err(invalid());
                }
                let (from, to) = m.curve.times();
                if !curve(m.curve)
                    || !pose(m.local_pose)
                    || !m.local_center.is_finite()
                    || !exact.start_time.is_finite()
                    || !exact.end_time.is_finite()
                    || exact.start_time < from
                    || exact.end_time > to
                    || exact.end_time < exact.start_time
                    || !pose(m.pose(exact.start_time))
                    || !pose(m.pose(exact.end_time))
                {
                    return Err(invalid());
                }
            }
        }
        if self.ready {
            if self.bvh.leaf_count() as usize != self.segments.len() {
                return Err(invalid());
            }
            // Bvh's owner decoder already validates its topology and unique
            // leaf mappings. This owner validates its semantic segment indices.
            // Charge the full topology via requested storage before traversal.
            work.charge(self.bvh.total_memory_size() as u64)
                .map_err(|_| capacity())?;
            for id in self.bvh.leaves(|_| true) {
                if id as usize >= self.segments.len() {
                    return Err(invalid());
                }
            }
        }
        Ok(work.used)
    }
}

#[cfg(test)]
impl StepMotion {
    pub(in crate::physics3d) fn test_corrupt_actual_domain(&mut self) {
        let exact = self
            .segments
            .iter_mut()
            .find_map(|s| s.exact.as_mut())
            .expect("actual rotating path");
        exact.end_time = exact.motion.curve.times().1 + 1.;
    }

    pub(in crate::physics3d) fn test_corrupt_precise_payload(&mut self, case: usize) {
        use crate::physics3d::solver_trajectory::Time;
        if case == 0 {
            self.elapsed = Time::NAN;
            return;
        }
        if case == 1 {
            self.elapsed = 1.0_f64.next_up();
            return;
        }
        let segment = self
            .segments
            .iter_mut()
            .find(|segment| {
                segment
                    .exact
                    .as_ref()
                    .is_some_and(|exact| matches!(exact.motion.curve, Curve::Integrated(_)))
            })
            .expect("actual captured native kernel");
        match case {
            2 => segment.start_fraction = -Time::EPSILON,
            3 => segment.end_fraction = 1.0_f64.next_up(),
            _ => {
                let exact = segment.exact.as_mut().unwrap();
                match case {
                    4 => exact.start_time = Time::NAN,
                    5 => exact.end_time = exact.motion.curve.times().1.next_up(),
                    12 => exact.motion.local_center.x = f32::NAN,
                    13 => exact.motion.local_pose.translation.x = f32::NAN,
                    _ => {
                        let Curve::Integrated(mut kernel) = exact.motion.curve else {
                            unreachable!("selected an actual native kernel");
                        };
                        match case {
                            6 => kernel.domain.start = Time::NAN,
                            7 => kernel.domain.end = kernel.domain.start,
                            8 => kernel.domain.end = Time::INFINITY,
                            9 => kernel.native.integration_seconds = f32::NAN,
                            10 => {
                                kernel.native.motion.end_time = kernel.native.motion.start_time;
                            }
                            11 => {
                                kernel.native.motion.start.rotation =
                                    rp::Rotation::from_xyzw(0., 0., 0., 2.);
                            }
                            14 => kernel.native.linear_velocity.x = f32::NAN,
                            15 => {
                                exact.motion.curve = Curve::Anchored {
                                    carrier: kernel,
                                    anchor: rp::Vector::splat(f32::NAN),
                                    offset: rp::Vector::ZERO,
                                    linear_velocity: rp::Vector::ZERO,
                                    rotation: rp::Rotation::IDENTITY,
                                };
                                return;
                            }
                            _ => unreachable!(),
                        }
                        exact.motion.curve = Curve::Integrated(kernel);
                    }
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, WorldConfig};

    #[test]
    fn completed_kernel_cold_codec_keeps_precise_domain_separate_from_physical_dt() {
        let native = rapier3d::pipeline::SolverBodyIntegration::from_velocity(
            rp::RigidBodyHandle::invalid(),
            0.,
            0.003,
            rp::Pose::IDENTITY,
            rp::Vector::X,
            rp::Vector::Y,
        )
        .unwrap();
        let start = 0.009_f64.next_up();
        let domain = Domain::new(start, start + 0.003_f64.next_down()).unwrap();
        let kernel = Kernel::from_native(native, domain).unwrap();
        assert_ne!(
            domain.duration().to_bits(),
            f64::from(native.integration_seconds).to_bits()
        );
        assert!(integration(kernel));
        let curve = Curve::Anchored {
            carrier: kernel,
            anchor: rp::Vector::X * 0.2,
            offset: rp::Vector::ZERO,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        };
        assert!(super::curve(curve));
        let bytes = crate::checkpoint_codec::encode(&curve).unwrap();
        let restored: Curve = crate::checkpoint_codec::decode(&bytes).unwrap();
        assert!(super::curve(restored));
        let Curve::Anchored { carrier, .. } = restored else {
            unreachable!();
        };
        assert_eq!(carrier.domain.start.to_bits(), domain.start.to_bits());
        assert_eq!(carrier.domain.end.to_bits(), domain.end.to_bits());
        assert_eq!(
            postcard::to_allocvec(&carrier.native).unwrap(),
            postcard::to_allocvec(&native).unwrap()
        );
        assert_eq!(crate::checkpoint_codec::encode(&restored).unwrap(), bytes);
    }

    #[test]
    fn completed_actual_paths_have_exact_cold_work_without_mutating_source() {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            step_seconds: 0.037,
            ..WorldConfig::default()
        })
        .unwrap();
        world.force_character_motion_proof();
        world.set_step_motion_enabled(true);
        world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicVelocity,
                    angular_velocity: [0., 0., 40.],
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [2., 0.025, 0.1],
                }),
            )
            .unwrap();
        world.step();
        let before = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
        let work = world
            .step_motion
            .validate_saved_payload_with_limit(u64::MAX)
            .unwrap();
        assert_eq!(
            world.step_motion.validate_saved_payload_with_limit(work),
            Ok(work)
        );
        assert_eq!(
            world
                .step_motion
                .validate_saved_payload_with_limit(work - 1),
            Err(PhysicsSnapshotError::Capacity)
        );
        assert_eq!(before, world.capture_snapshot().unwrap().encoded_bytes());
        assert!(world.step_motion.segments.iter().any(|s| s.exact.is_some()));
    }
}

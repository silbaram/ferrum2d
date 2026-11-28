//! Cold validation of the completed-step query observation owner.
//! Stale handles/history remain observations; no current-world equality, query,
//! cache rebuild or shape normalization is performed here.
use super::*;
use crate::physics3d::{motion_work::Work, snapshot::PhysicsSnapshotError};

const MAX_SEGMENTS: usize = 1 << 20;
const MAX_WORK: u64 = 128 * 1024 * 1024;
const SEGMENT_WORK: u64 = 512;
fn rotation(q: rp::Rotation) -> bool {
    q.is_finite() && (q.length_squared() - 1.).abs() <= 1e-5
}
fn pose(p: rp::Pose) -> bool {
    p.translation.is_finite() && rotation(p.rotation)
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
            || self.ready && (!self.enabled || self.leaves != self.segments.len())
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
    pub(in crate::physics3d) fn test_corrupt_precise_payload(&mut self, case: usize) {
        if case == 0 {
            self.elapsed = Time::NAN;
            return;
        }
        if case == 1 {
            self.elapsed = 1.0_f64.next_up();
            return;
        }
        let segment = self.segments.first_mut().expect("completed capture");
        match case {
            2 => segment.start_fraction = -Time::EPSILON,
            3 => segment.end_fraction = 1.0_f64.next_up(),
            4 => segment.motion.local_center.x = f32::NAN,
            5 => segment.motion.start.translation.x = f32::NAN,
            6 => segment.motion.linvel.x = f32::NAN,
            7 => segment.motion.angvel.y = f32::NAN,
            _ => unreachable!(),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, WorldConfig};

    #[test]
    fn completed_interpolation_has_bounded_cold_work_without_mutating_source() {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            step_seconds: 0.037,
            ..WorldConfig::default()
        })
        .unwrap();
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
        assert!(world.step_motion.ready);
    }
}

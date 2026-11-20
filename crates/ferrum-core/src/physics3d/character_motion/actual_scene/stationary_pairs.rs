//! Tick-local original NoHit results for two unchanged primitive shape frames.
use super::{bounds_cache::ShapeKey, *};
use std::cell::RefCell;

const WAYS: usize = 4;
const MAX_SLOTS: usize = 128;

#[derive(Clone, Copy, PartialEq, Eq)]
struct Side {
    collider: rp::ColliderHandle,
    parent: Option<rp::RigidBodyHandle>,
    role: Role,
    shape: ShapeKey,
    com: [u32; 7],
    local_center: [u32; 3],
    local_pose: [u32; 7],
}

impl Side {
    fn make(
        source: &ColliderTrajectory,
        shape: &dyn rp::Shape,
        start: Time,
        end: Time,
    ) -> Option<Self> {
        fn bits(pose: rp::Pose) -> [u32; 7] {
            let [x, y, z] = pose.translation.to_array();
            let [i, j, k, w] = pose.rotation.to_array();
            [x, y, z, i, j, k, w].map(f32::to_bits)
        }
        let motion = source.motion;
        let (from, to) = motion.curve.times();
        if !from.is_finite()
            || !to.is_finite()
            || !(to - from).is_finite()
            || from > start
            || end > to
            || !motion.local_center.is_finite()
            || !motion.local_pose.is_finite()
        {
            return None;
        }
        if let Curve::Integrated(kernel) = motion.curve {
            // Cold/invalid derivative scales must not be hidden by the
            // unchanged endpoint check or by a cached zero-rate policy.
            solver_trajectory::Kernel::from_native(kernel.native, kernel.domain).ok()?;
        }
        Some(Self {
            collider: source.collider,
            parent: source.parent,
            role: source.role,
            shape: ShapeKey::of(shape)?,
            com: bits(solver_trajectory::constant_pose(motion.curve)?),
            local_center: motion.local_center.to_array().map(f32::to_bits),
            local_pose: bits(motion.local_pose),
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Key {
    a: Side,
    b: Side,
    clearance: u32,
}

#[derive(Clone, Copy)]
struct Entry {
    key: Key,
    strictly_clear_start: bool,
}

pub(super) struct Candidate {
    key: Key,
    pub(super) reused: Option<solver_trajectory::CastCoverage>,
}

#[derive(Default)]
pub(super) struct StationaryPairs {
    slots: RefCell<Vec<Option<Entry>>>,
}

impl StationaryPairs {
    pub(super) fn slots_for(colliders: usize, available: usize) -> usize {
        let desired = (colliders * 2).min(MAX_SLOTS);
        let count = desired.min(available / Self::slot_bytes());
        count / WAYS * WAYS
    }

    pub(super) const fn slot_bytes() -> usize {
        std::mem::size_of::<Option<Entry>>()
    }

    pub(super) fn bytes(&self) -> usize {
        self.slots.borrow().capacity() * Self::slot_bytes()
    }

    pub(super) fn prepare(&mut self, count: usize, available: usize) {
        let slots = self.slots.get_mut();
        if slots.capacity() * Self::slot_bytes() > available || slots.capacity() < count {
            *slots = Vec::new();
        }
        slots.clear();
        if slots.try_reserve_exact(count).is_ok()
            && slots.capacity() * Self::slot_bytes() <= available
        {
            slots.resize(count, None);
        } else {
            *slots = Vec::new();
        }
    }

    fn bucket(key: Key, slots: usize) -> std::ops::Range<usize> {
        let (a, _) = key.a.collider.into_raw_parts();
        let (b, _) = key.b.collider.into_raw_parts();
        let hash = u64::from(a).wrapping_mul(49) ^ u64::from(b).wrapping_mul(131);
        let from = (hash as usize % (slots / WAYS)) * WAYS;
        from..from + WAYS
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn candidate(
        &self,
        a: &ColliderTrajectory,
        sa: &dyn rp::Shape,
        b: &ColliderTrajectory,
        sb: &dyn rp::Shape,
        start: Time,
        end: Time,
        clearance: f32,
        work: &mut Work,
    ) -> Result<Option<Candidate>, TrajectoryError> {
        let slots = self.slots.borrow();
        let zero_rate = |curve| {
            matches!(curve, Curve::Constant { .. })
                || matches!(curve, Curve::Integrated(k)
                    if k.native.linear_velocity == rp::Vector::ZERO
                        && k.native.angular_velocity == rp::Vector::ZERO)
        };
        // This owner only serves the existing allow_existing=true solid cast.
        // Never share instantaneous queries or results from moving/sensor pairs.
        if slots.len() < WAYS
            || a.sensor
            || b.sensor
            || !start.is_finite()
            || !end.is_finite()
            || start >= end
            || !(end - start).is_finite()
            || !clearance.is_finite()
            || clearance < 0.
            || !zero_rate(a.motion.curve)
            || !zero_rate(b.motion.curve)
        {
            return Ok(None);
        }
        const CHECK_WORK: u64 = 256;
        if work.limit.saturating_sub(work.used) < CHECK_WORK {
            return Ok(None);
        }
        work.charge(CHECK_WORK)?;
        let (Some(a), Some(b)) = (Side::make(a, sa, start, end), Side::make(b, sb, start, end))
        else {
            return Ok(None);
        };
        let key = Key {
            a,
            b,
            clearance: clearance.to_bits(),
        };
        let reused = slots[Self::bucket(key, slots.len())]
            .iter()
            .flatten()
            .find(|entry| entry.key == key)
            .map(|entry| solver_trajectory::CastCoverage {
                hit: None,
                strictly_clear_start: entry.strictly_clear_start,
                // This is a result for the current complete stationary
                // request, rather than a narrowed in-context prefix.
                reused: false,
            });
        Ok(Some(Candidate { key, reused }))
    }

    pub(super) fn remember(
        &self,
        candidate: Candidate,
        cast: &solver_trajectory::CastCoverage,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        if candidate.reused.is_some() || cast.hit.is_some() || cast.reused {
            return Ok(());
        }
        let mut slots = self.slots.borrow_mut();
        let price = Self::slot_bytes() as u64;
        if work.limit.saturating_sub(work.used) < price {
            return Ok(());
        }
        work.charge(price)?;
        let bucket = Self::bucket(candidate.key, slots.len());
        let index = bucket
            .clone()
            .find(|&index| {
                slots[index].is_none_or(|entry| {
                    entry.key.a.collider == candidate.key.a.collider
                        && entry.key.b.collider == candidate.key.b.collider
                })
            })
            .unwrap_or(bucket.start);
        slots[index] = Some(Entry {
            key: candidate.key,
            strictly_clear_start: cast.strictly_clear_start,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests;

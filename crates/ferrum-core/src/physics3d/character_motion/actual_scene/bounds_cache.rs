//! Tick-local copies of already certified whole-curve primitive AABBs.
//! No contact, filter result, sampled trajectory or geometric approximation is
//! stored. A miss always executes the original fallible whole-shape bounds.
use super::stationary_pairs::StationaryPairs;
use super::*;

const MAX_BUCKETS: usize = 64;
const WAYS: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ShapeKey {
    Ball(u32),
    Box([u32; 3]),
    Capsule([u32; 7]),
}
impl ShapeKey {
    pub(super) fn of(shape: &dyn rp::Shape) -> Option<Self> {
        use rapier3d::parry::shape::TypedShape;
        match shape.as_typed_shape() {
            TypedShape::Ball(s) if s.radius.is_finite() => Some(Self::Ball(s.radius.to_bits())),
            TypedShape::Cuboid(s) if s.half_extents.is_finite() => {
                Some(Self::Box(s.half_extents.to_array().map(f32::to_bits)))
            }
            TypedShape::Capsule(s)
                if s.segment.a.is_finite() && s.segment.b.is_finite() && s.radius.is_finite() =>
            {
                let a = s.segment.a.to_array();
                let b = s.segment.b.to_array();
                Some(Self::Capsule(
                    [a[0], a[1], a[2], b[0], b[1], b[2], s.radius].map(f32::to_bits),
                ))
            }
            _ => None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Header {
    collider: rp::ColliderHandle,
    kind: u8,
    clock: [u64; 3],
}
impl Header {
    fn of(source: &ColliderTrajectory) -> Option<Self> {
        let (kind, kernel) = match source.motion.curve {
            Curve::Constant { .. } => (0, None),
            Curve::Integrated(kernel) => (1, Some(kernel)),
            Curve::Anchored { carrier, .. } => (2, Some(carrier)),
            Curve::Ccd { .. } => return None,
        };
        Some(Self {
            collider: source.collider,
            kind,
            clock: kernel.map_or([0; 3], |kernel| {
                [
                    kernel.domain.start.to_bits(),
                    kernel.domain.end.to_bits(),
                    u64::from(kernel.native.integration_seconds.to_bits()),
                ]
            }),
        })
    }
}

#[derive(Clone, Copy)]
struct Entry {
    header: Header,
    shape: ShapeKey,
    source: ColliderTrajectory,
    start: Time,
    end: Time,
}

#[derive(Clone, Copy)]
pub(in crate::physics3d::character_motion) struct Layout {
    buckets: usize,
    slots: usize,
    stationary_slots: usize,
    reserved: usize,
}
impl Layout {
    pub(in crate::physics3d::character_motion) fn reserved(self) -> usize {
        self.reserved
    }
}

#[derive(Default)]
pub(in crate::physics3d::character_motion) struct BoundsCache {
    slots: Vec<Option<Entry>>,
    stationary: StationaryPairs,
    valid: bool,
    buckets: usize,
    replacement: usize,
    #[cfg(test)]
    hits: usize,
    #[cfg(test)]
    misses: usize,
    #[cfg(test)]
    old_backing_before_growth: usize,
}
impl BoundsCache {
    /// Partition the original derived scratch bound, never grow it. Small
    /// layouts disable payload storage; the fixed new owner metadata is still
    /// included. At most one eighth is reserved for the optional memo.
    pub(in crate::physics3d::character_motion) fn layout(
        full: usize,
        colliders: usize,
        retained: usize,
    ) -> Result<Layout, TrajectoryError> {
        let metadata = std::mem::size_of::<Self>();
        if full < metadata {
            return Err(TrajectoryError::WorkLimit);
        }
        // Four ways retain clock variants, not an unbounded collider census.
        // A larger scene keeps its original path instead of guaranteed table
        // churn; this is an optional memo limit, never a physics/shape limit.
        let mut buckets = if colliders > MAX_BUCKETS {
            0
        } else {
            colliders.max(1).next_power_of_two()
        };
        let size = std::mem::size_of::<Option<Entry>>();
        while buckets > 0 && metadata + buckets * WAYS * size > full / 8 {
            buckets /= 2;
        }
        let slots = buckets * WAYS;
        let bounds_bytes = metadata + slots * size;
        // Keep the original whole-shape bucket count. Only the remaining
        // optional partition can fund stationary pair results.
        let stationary_slots =
            StationaryPairs::slots_for(buckets, (full / 8).saturating_sub(bounds_bytes));
        let reserved =
            (bounds_bytes + stationary_slots * StationaryPairs::slot_bytes()).max(retained);
        if reserved > full {
            return Err(TrajectoryError::WorkLimit);
        }
        Ok(Layout {
            buckets,
            slots,
            stationary_slots,
            reserved,
        })
    }
    pub(in crate::physics3d::character_motion) fn invalidate(&mut self) {
        self.valid = false;
    }
    pub(super) fn stationary(&self) -> Option<&StationaryPairs> {
        self.valid.then_some(&self.stationary)
    }
    pub(in crate::physics3d::character_motion) fn retained_bytes(
        &self,
    ) -> Result<usize, TrajectoryError> {
        self.slots
            .capacity()
            .checked_mul(std::mem::size_of::<Option<Entry>>())
            .and_then(|n| n.checked_add(self.stationary.bytes()))
            .and_then(|n| n.checked_add(std::mem::size_of::<Self>()))
            .ok_or(TrajectoryError::WorkLimit)
    }

    /// Called at Native setup, with the tick's existing used/MAX ledger.
    /// Native retries retain their epoch; begin_tick alone invalidates it.
    pub(in crate::physics3d::character_motion) fn prepare_epoch(
        &mut self,
        layout: Layout,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        work.charge(8)?;
        if self.valid && self.buckets == layout.buckets && self.slots.len() == layout.slots {
            if self.retained_bytes()? > layout.reserved {
                return Err(TrajectoryError::WorkLimit);
            }
            return Ok(());
        }
        let item = std::mem::size_of::<Option<Entry>>();
        let old_bytes = self
            .slots
            .capacity()
            .checked_mul(item)
            .ok_or(TrajectoryError::WorkLimit)?;
        let payload = layout.reserved - std::mem::size_of::<Self>();
        let stationary_bytes = layout.stationary_slots * StationaryPairs::slot_bytes();
        let price = std::mem::size_of::<Self>() + layout.slots * item + stationary_bytes;
        work.charge(u64::try_from(price).map_err(|_| TrajectoryError::WorkLimit)?)?;
        self.valid = false;
        // Both optional caches share the existing backing partition. Discard
        // incompatible stationary storage before either table can grow.
        if self.stationary.bytes() > stationary_bytes {
            self.stationary = StationaryPairs::default();
        }
        let bounds_payload = payload - stationary_bytes;
        // Discard the old request before a larger one: max(old,new) is the
        // partition, not old+new. This is not an allocator/RSS bound.
        if old_bytes > bounds_payload || self.slots.capacity() < layout.slots {
            self.slots = Vec::new();
        }
        self.slots.clear();
        #[cfg(test)]
        if self.slots.capacity() < layout.slots {
            self.old_backing_before_growth = self.slots.capacity() * item;
        }
        self.slots
            .try_reserve_exact(layout.slots)
            .map_err(|_| TrajectoryError::WorkLimit)?;
        if self
            .slots
            .capacity()
            .checked_mul(item)
            .ok_or(TrajectoryError::WorkLimit)?
            > bounds_payload
        {
            self.slots = Vec::new();
            return Err(TrajectoryError::WorkLimit);
        }
        self.slots.resize(layout.slots, None);
        self.stationary
            .prepare(layout.stationary_slots, stationary_bytes);
        self.buckets = layout.buckets;
        self.replacement = 0;
        self.valid = true;
        #[cfg(test)]
        {
            self.hits = 0;
            self.misses = 0;
        }
        Ok(())
    }
    #[cfg(test)]
    pub(in crate::physics3d::character_motion) fn diagnostics(&self) -> (usize, usize, usize) {
        (
            self.hits,
            self.misses,
            std::mem::size_of::<Self>()
                + self.slots.capacity() * std::mem::size_of::<Option<Entry>>()
                + self.stationary.bytes(),
        )
    }

    fn same_source(old: &ColliderTrajectory, new: &ColliderTrajectory) -> bool {
        old.collider == new.collider
            && old.parent == new.parent
            && old.role == new.role
            && old.sensor == new.sensor
            && pair_queries::vector(old.motion.local_center, new.motion.local_center)
            && pair_queries::pose(old.motion.local_pose, new.motion.local_pose)
            && pair_queries::curve(old.motion.curve, new.motion.curve)
    }

    /// Read only a matching complete result, before constructing a cast.
    /// The primitive geometry, source, and requested Native window all match.
    pub(super) fn prepared(
        &self,
        source: &ColliderTrajectory,
        shape: &dyn rp::Shape,
        start: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<Option<Aabb>, TrajectoryError> {
        if let Some(bounds) =
            solver_trajectory::straight_primitive_bounds(source.motion, shape, start, end, work)?
        {
            return Ok(Some(bounds));
        }
        if !self.valid || self.buckets == 0 {
            return Ok(None);
        }
        work.charge(64)?;
        let (Some(key), Some(header)) = (ShapeKey::of(shape), Header::of(source)) else {
            return Ok(None);
        };
        let from = source.collider.into_raw_parts().0 as usize % self.buckets * WAYS;
        for entry in self.slots[from..from + WAYS].iter().flatten() {
            if entry.header != header
                || entry.shape != key
                || entry.start.to_bits() != start.to_bits()
                || entry.end.to_bits() != end.to_bits()
            {
                continue;
            }
            work.charge(if matches!(source.motion.curve, Curve::Constant { .. }) {
                128
            } else {
                512
            })?;
            if Self::same_source(&entry.source, source) {
                return Ok(Some(entry.source.bounds));
            }
        }
        Ok(None)
    }

    /// The input record's placeholder AABB is never inspected as proof.
    /// Only a successful original bounds result can be installed in an entry.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn bounds(
        &mut self,
        source: &ColliderTrajectory,
        shape: &dyn rp::Shape,
        start: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<Aabb, TrajectoryError> {
        // Building these complete bounds costs less than comparing or copying
        // a cached integration record. Keep the table for other geometries.
        if let Some(bounds) =
            solver_trajectory::straight_primitive_bounds(source.motion, shape, start, end, work)?
        {
            return Ok(bounds);
        }
        let (lo, hi) = source.motion.curve.times();
        if !self.valid
            || self.buckets == 0
            || !start.is_finite()
            || !end.is_finite()
            || start >= end
            || !lo.is_finite()
            || !hi.is_finite()
            || lo > start
            || hi < end
        {
            return source.motion.bounds(shape, start, end, work);
        }
        work.charge(64)?; // fixed primitive/header descriptor and four cheap slots
        let Some(key) = ShapeKey::of(shape) else {
            return source.motion.bounds(shape, start, end, work);
        };
        // The geometry key can ignore clock labels only after the original
        // domain check and a bitwise proof of both endpoints and the sole
        // interior pose. A miss still runs the original bound computation.
        let mut stationary = None;
        if matches!(source.motion.curve, Curve::Integrated(k)
            if k.native.linear_velocity == rp::Vector::ZERO
                && k.native.angular_velocity == rp::Vector::ZERO)
        {
            work.charge(256)?;
            if let Some(pose) = solver_trajectory::constant_pose(source.motion.curve) {
                let mut record = *source;
                record.motion.curve = Curve::Constant {
                    pose,
                    start_time: start,
                    end_time: end,
                };
                stationary = Some(record);
            }
        }
        let key_source = stationary.as_ref().unwrap_or(source);
        let Some(header) = Header::of(key_source) else {
            return source.motion.bounds(shape, start, end, work);
        };
        let bucket = source.collider.into_raw_parts().0 as usize % self.buckets;
        let from = bucket * WAYS;
        let constant = matches!(key_source.motion.curve, Curve::Constant { .. });
        let mut selected = None;
        let mut empty = None;
        for index in from..from + WAYS {
            let Some(entry) = self.slots[index].as_ref() else {
                empty.get_or_insert(index);
                continue;
            };
            if entry.header != header {
                continue;
            }
            selected = Some(index);
            let range = constant
                || (start.to_bits() == entry.start.to_bits()
                    && end.to_bits() == entry.end.to_bits());
            if entry.shape != key || !range {
                continue;
            }
            // Header, shape and time mismatches did not read the original
            // expression. Constant sources only compare their frames and one
            // pose, while the moving case also compares its integration data.
            work.charge(if constant { 128 } else { 512 })?;
            if Self::same_source(&entry.source, key_source) {
                #[cfg(test)]
                {
                    self.hits += 1;
                }
                return Ok(entry.source.bounds);
            }
        }
        #[cfg(test)]
        {
            self.misses += 1;
        }
        let bounds = source.motion.bounds(shape, start, end, work)?;
        // Fixed slot only: no allocation, eviction/destructor or future query.
        // Admission occurs before copying a complete successful certificate.
        work.charge((std::mem::size_of::<Entry>() + 32) as u64)?;
        let index = selected.or(empty).unwrap_or_else(|| {
            let index = from + self.replacement % WAYS;
            self.replacement = (self.replacement + 1) % WAYS;
            index
        });
        let mut stored = *key_source;
        stored.bounds = bounds;
        self.slots[index] = Some(Entry {
            header,
            shape: key,
            source: stored,
            start,
            end,
        });
        Ok(bounds)
    }
}

#[cfg(test)]
mod tests;

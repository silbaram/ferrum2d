//! Moving-only tick-local preparation. No contact, target, filter, skin or
//! signed target-dependent normal is cached. Eviction only recomputes work.
use super::*;
use rapier3d::parry::{
    bounding_volume::{Aabb, BoundingVolume},
    query::sweep_toi::ToiProxy,
};
const SLOTS: usize = 8;
#[derive(Clone, Copy)]
pub(super) struct Source<'a> {
    pub collider: &'a rp::Collider,
    pub bodies: &'a rp::RigidBodySet,
    pub tracks: &'a [AcceptedCurve],
    pub clamps: &'a [SolverCcdClamp],
    pub domain: Domain,
}
#[derive(Clone, Copy, PartialEq, Eq)]
struct Key {
    piece: usize,
    start: u64,
    end: u64,
}
#[derive(Clone, Copy)]
pub(super) struct Endpoints {
    pub aabb: Aabb,
    pub end: rp::Pose,
    axes: Option<[rp::Vector; 3]>,
}
#[derive(Clone, Copy)]
struct Entry {
    key: Key,
    gross: Aabb,
    endpoints: Option<Endpoints>,
}
pub(super) struct Moving<'a> {
    source: Source<'a>,
    points: Option<usize>,
    slots: [Option<Entry>; SLOTS],
    next: usize,
}
impl<'a> Moving<'a> {
    pub fn new(source: Source<'a>, work: &mut Work) -> Result<Self, TrajectoryError> {
        // Fixed stack storage, no capacity/allocator request or persistent
        // state. Pay its initialization plus the original point census first.
        work.charge(std::mem::size_of::<Self>() as u64 + 32)?;
        let points = ToiProxy::from_shape(source.collider.shape()).map(|p| p.points().len());
        Ok(Self {
            source,
            points,
            slots: [None; SLOTS],
            next: 0,
        })
    }
    pub fn source(&self) -> Source<'a> {
        self.source
    }
    pub fn gross(
        &mut self,
        piece: usize,
        motion: ShapeMotion,
        start: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<(Aabb, Option<usize>), TrajectoryError> {
        // The source is immutable for this moving-collider scope. The ordinal
        // denotes the same original Kernel-prefix/Constant-suffix every call;
        // a different clipped interval (until/first hit) must miss by bits.
        work.charge(SLOTS as u64)?;
        let key = Key {
            piece,
            start: start.to_bits(),
            end: end.to_bits(),
        };
        if let Some(index) = self
            .slots
            .iter()
            .position(|v| v.is_some_and(|v| v.key == key))
        {
            return Ok((
                self.slots[index]
                    .ok_or(TrajectoryError::InvalidReference)?
                    .gross,
                Some(index),
            ));
        }
        let Some(points) = self.points else {
            return Ok((
                motion.bounds(self.source.collider.shape(), start, end, work)?,
                None,
            ));
        };
        // Retain A31's miss/census guard. The complete F32 bound now charges
        // its own actual hull/frame work through this same tick ledger; a
        // cache hit runs neither preparation nor a second bound query.
        work.charge(
            (points as u64)
                .checked_mul(4)
                .and_then(|n| n.checked_add(64))
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        let gross = motion.bounds(self.source.collider.shape(), start, end, work)?;
        let index = self.next;
        self.next = (self.next + 1) % SLOTS;
        self.slots[index] = Some(Entry {
            key,
            gross,
            endpoints: None,
        });
        Ok((gross, Some(index)))
    }
    pub fn endpoints(
        &mut self,
        index: usize,
        motion: ShapeMotion,
        start: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<Endpoints, TrajectoryError> {
        let entry = self.slots[index]
            .as_mut()
            .ok_or(TrajectoryError::InvalidReference)?;
        if entry.key.start != start.to_bits() || entry.key.end != end.to_bits() {
            return Err(TrajectoryError::InvalidTime);
        }
        if let Some(value) = entry.endpoints {
            return Ok(value);
        }
        let points = self.points.ok_or(TrajectoryError::UnsupportedShape)?;
        work.charge(
            (points as u64)
                .checked_mul(16)
                .and_then(|n| n.checked_add(16))
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        let first = motion.pose(start);
        let last = motion.pose(end);
        let shape = self.source.collider.shape();
        let value = Endpoints {
            aabb: shape
                .compute_aabb(&first)
                .merged(&shape.compute_aabb(&last)),
            end: last,
            axes: None,
        };
        entry.endpoints = Some(value);
        Ok(value)
    }
    pub fn axes(
        &mut self,
        index: usize,
        work: &mut Work,
    ) -> Result<[rp::Vector; 3], TrajectoryError> {
        let endpoints = self.slots[index]
            .as_mut()
            .and_then(|v| v.endpoints.as_mut())
            .ok_or(TrajectoryError::InvalidReference)?;
        if let Some(axes) = endpoints.axes {
            return Ok(axes);
        }
        // Only reached after the original world-axis proofs and a nominated
        // end-face candidate. No future-axis work is pulled before them.
        work.charge(128)?;
        let axes =
            [rp::Vector::X, rp::Vector::Y, rp::Vector::Z].map(|n| endpoints.end.rotation * n);
        if axes.iter().any(|n| !n.is_finite()) {
            return Err(TrajectoryError::NonFinite);
        }
        endpoints.axes = Some(axes);
        Ok(axes)
    }
}

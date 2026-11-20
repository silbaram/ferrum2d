// Ferrum2D file-only cold extension; see FERRUM-PATCHES.md.
//! Cold, value-preserving SharedShape alias proofs for Ferrum's file sidecar.
//! Only seven actual built-in concrete types are accepted, never a custom Shape
//! that can impersonate a TypedShape. No ordinary shape Serde behavior changes.

use super::SharedShape;
use alloc::{sync::Arc, vec::Vec};
use core::{fmt, mem::size_of};
use serde::Serialize;

mod encoding;

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub max_work: u64,
    pub max_scratch_bytes: usize,
    pub max_compare_bytes: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Usage {
    pub work: u64,
    pub scratch_bytes: usize,
    pub compare_bytes: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    WorkLimit,
    ScratchLimit,
    CompareLimit,
    Allocation,
    UnsupportedShape,
    Encoding,
    DifferentValue,
    StaleProof,
    ParentNotUnique,
    ChildIndex,
}

impl fmt::Display for Error {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(out, "shape alias: {self:?}")
    }
}
impl core::error::Error for Error {}
impl serde::ser::Error for Error {
    fn custom<T: fmt::Display>(_: T) -> Self {
        Self::Encoding
    }
}

pub struct Budget {
    limits: Limits,
    usage: Usage,
}
impl Budget {
    pub fn new(limits: Limits) -> Self {
        Self {
            limits,
            usage: Usage::default(),
        }
    }
    pub fn usage(&self) -> Usage {
        self.usage
    }
    pub fn work(&mut self, amount: usize) -> Result<(), Error> {
        let next = self
            .usage
            .work
            .checked_add(u64::try_from(amount).map_err(|_| Error::WorkLimit)?)
            .ok_or(Error::WorkLimit)?;
        if next > self.limits.max_work {
            return Err(Error::WorkLimit);
        }
        self.usage.work = next;
        Ok(())
    }
    fn scratch(&mut self, bytes: usize) -> Result<(), Error> {
        let next = self
            .usage
            .scratch_bytes
            .checked_add(bytes)
            .ok_or(Error::ScratchLimit)?;
        if next > self.limits.max_scratch_bytes {
            return Err(Error::ScratchLimit);
        }
        self.usage.scratch_bytes = next;
        Ok(())
    }
    fn compared(&mut self, bytes: usize) -> Result<(), Error> {
        let next = self
            .usage
            .compare_bytes
            .checked_add(bytes)
            .ok_or(Error::CompareLimit)?;
        if next > self.limits.max_compare_bytes {
            return Err(Error::CompareLimit);
        }
        self.work(bytes)?;
        self.usage.compare_bytes = next;
        Ok(())
    }
    pub fn vector<T>(&mut self, count: usize) -> Result<Vec<T>, Error> {
        self.work(count)?;
        self.scratch(
            count
                .checked_mul(size_of::<T>())
                .ok_or(Error::ScratchLimit)?,
        )?;
        let mut output = Vec::new();
        output
            .try_reserve_exact(count)
            .map_err(|_| Error::Allocation)?;
        Ok(output)
    }
    fn append(&mut self, output: &mut Vec<u8>, bytes: &[u8]) -> Result<(), Error> {
        // All encoding bytes are charged before their copy or allocation.
        self.compared(bytes.len())?;
        let needed = output
            .len()
            .checked_add(bytes.len())
            .ok_or(Error::ScratchLimit)?;
        if needed > output.capacity() {
            let capacity = needed.max(output.capacity().saturating_mul(2)).max(32);
            self.scratch(capacity - output.capacity())?;
            output
                .try_reserve_exact(capacity - output.len())
                .map_err(|_| Error::Allocation)?;
        }
        output.extend_from_slice(bytes);
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Ball,
    Cuboid,
    Capsule,
    Convex,
    TriMesh,
    HeightField,
    Compound,
}

/// This uses Any downcasts, not the overridable Shape::as_typed_shape tag.
pub fn kind(shape: &SharedShape) -> Result<Kind, Error> {
    if shape.as_ball().is_some() {
        Ok(Kind::Ball)
    } else if shape.as_cuboid().is_some() {
        Ok(Kind::Cuboid)
    } else if shape.as_capsule().is_some() {
        Ok(Kind::Capsule)
    } else if shape.as_convex_polyhedron().is_some() {
        Ok(Kind::Convex)
    } else if shape.as_trimesh().is_some() {
        Ok(Kind::TriMesh)
    } else if shape.as_heightfield().is_some() {
        Ok(Kind::HeightField)
    } else if shape.as_compound().is_some() {
        Ok(Kind::Compound)
    } else {
        Err(Error::UnsupportedShape)
    }
}

pub fn convex(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::Ball | Kind::Cuboid | Kind::Capsule | Kind::Convex
    )
}

fn supported(shape: &SharedShape, budget: &mut Budget) -> Result<(), Error> {
    budget.work(1)?;
    if kind(shape)? == Kind::Compound {
        let children = shape.as_compound().ok_or(Error::UnsupportedShape)?.shapes();
        budget.work(children.len())?;
        for (_, child) in children {
            if !convex(kind(child)?) {
                return Err(Error::UnsupportedShape);
            }
        }
    }
    Ok(())
}

/// Exact typed Serde-event bytes, including float bits, field names and stored
/// BVH/flags/topology. Neither hashes nor PartialEq are a value proof. This
/// encoding is temporary, not a file format or ordinary memory Serde replacement.
pub fn equal_value(a: &SharedShape, b: &SharedShape, budget: &mut Budget) -> Result<(), Error> {
    supported(a, budget)?;
    supported(b, budget)?;
    if kind(a)? != kind(b)? {
        return Err(Error::DifferentValue);
    }
    let encode = |shape: &SharedShape, budget: &mut Budget| -> Result<Vec<u8>, Error> {
        let mut encoder = encoding::Encoder::new(budget);
        shape.serialize(&mut encoder)?;
        Ok(encoder.finish())
    };
    let left = encode(a, budget)?;
    let right = encode(b, budget)?;
    budget.compared(left.len().min(right.len()))?;
    if left != right {
        return Err(Error::DifferentValue);
    }
    Ok(())
}

/// Unforgeable equality proof. Strong refs pin both immutable built-in values.
/// Any safe COW edit changes the target Arc identity and invalidates this token.
pub struct EquivalentShape {
    expected: SharedShape,
    replacement: SharedShape,
}

impl EquivalentShape {
    pub fn prepare(
        expected: &SharedShape,
        replacement: &SharedShape,
        budget: &mut Budget,
    ) -> Result<Self, Error> {
        equal_value(expected, replacement, budget)?;
        Ok(Self {
            expected: expected.clone(),
            replacement: replacement.clone(),
        })
    }
    pub fn apply(self, target: &mut SharedShape) -> Result<(), Error> {
        if !Arc::ptr_eq(&self.expected.0, &target.0) {
            return Err(Error::StaleProof);
        }
        *target = self.replacement;
        Ok(())
    }
}

/// The parent must be unique: do not clone/rebuild a Compound or mutate shared
/// backing behind other readers. The child proof preserves all geometric value,
/// so stored child poses/BVH/flags/pseudo-normals stay valid and untouched.
pub fn rebind_child(
    parent: &mut SharedShape,
    index: usize,
    proof: EquivalentShape,
) -> Result<(), Error> {
    let compound = Arc::get_mut(&mut parent.0)
        .and_then(|shape| shape.as_compound_mut())
        .ok_or(Error::ParentNotUnique)?;
    compound.rebind_saved_child(index, proof)
}

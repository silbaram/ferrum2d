//! Ferrum cold workspace/manifold correspondence, after shape/BVH storage admission.
//! Generic vendor Serde is unchanged. Stored history is never rebuilt or reordered.
use super::{ContactManifold, ContactManifoldsWorkspace, TypedWorkspaceData};
use crate::bounding_volume::Aabb;
use crate::math::Pose;
use crate::partitioning::BvhNode;
use crate::shape::{Shape, TriMeshFlags};
use alloc::vec::Vec;
use core::fmt;

#[doc(hidden)]
#[derive(Copy, Clone, Debug)]
pub struct StoredWorkspaceLimits {
    pub max_work: usize,
    pub max_scratch_bytes: usize,
}
#[doc(hidden)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct StoredWorkspaceUsage {
    pub work: usize,
    pub scratch_bytes: usize,
}
#[doc(hidden)]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum StoredWorkspaceError {
    WorkLimit,
    ScratchLimit,
    Allocation,
    Unsupported,
    Context,
    ManifoldIndex,
    Timestamp,
    ManifoldOwner,
    ManifoldPose,
    Aabb,
    Interferences,
}
impl fmt::Display for StoredWorkspaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "invalid stored contact workspace: {self:?}")
    }
}
impl core::error::Error for StoredWorkspaceError {}
type Error = StoredWorkspaceError;
struct Budget {
    work: usize,
    scratch: usize,
}
impl Budget {
    fn charge(&mut self, count: usize) -> Result<(), Error> {
        self.work = self.work.checked_sub(count).ok_or(Error::WorkLimit)?;
        Ok(())
    }
    fn scratch<T>(&mut self, count: usize) -> Result<Vec<T>, Error> {
        self.charge(count)?;
        self.scratch = self
            .scratch
            .checked_sub(
                count
                    .checked_mul(size_of::<T>())
                    .ok_or(Error::ScratchLimit)?,
            )
            .ok_or(Error::ScratchLimit)?;
        let mut result = Vec::new();
        result
            .try_reserve_exact(count)
            .map_err(|_| Error::Allocation)?;
        Ok(result)
    }
}
#[derive(Copy, Clone, PartialEq, Eq)]
enum Kind {
    TriMesh,
    Heightfield,
    HeightfieldComposite,
    CompositeComposite,
    Composite,
}
fn supported(shape: &dyn Shape) -> bool {
    shape.as_ball().is_some()
        || shape.as_cuboid().is_some()
        || shape.as_capsule().is_some()
        || shape.as_convex_polyhedron().is_some()
        || shape.as_trimesh().is_some()
        || shape.as_heightfield().is_some()
        || shape.as_compound().is_some()
}
fn kind(a: &dyn Shape, b: &dyn Shape) -> Result<Option<Kind>, Error> {
    if !supported(a) || !supported(b) {
        return Err(Error::Unsupported);
    }
    let (ca, cb) = (
        a.as_composite_shape().is_some(),
        b.as_composite_shape().is_some(),
    );
    if ca && cb {
        return Ok(Some(Kind::CompositeComposite));
    }
    if let Some(mesh) = a.as_trimesh().or_else(|| b.as_trimesh()) {
        return Ok(Some(if mesh.flags().contains(TriMeshFlags::DEFORMABLE) {
            Kind::Composite
        } else {
            Kind::TriMesh
        }));
    }
    if a.as_heightfield().is_some() || b.as_heightfield().is_some() {
        return Ok(Some(if ca || cb {
            Kind::HeightfieldComposite
        } else {
            Kind::Heightfield
        }));
    }
    Ok((ca || cb).then_some(Kind::Composite))
}
fn valid_leaf(shape: &dyn Shape, id: u32, pose: Option<&Pose>) -> Result<(), Error> {
    if let Some(compound) = shape.as_compound() {
        let (expected, _) = compound
            .shapes()
            .get(id as usize)
            .ok_or(Error::ManifoldOwner)?;
        if !pose.is_some_and(|value| {
            value.translation == expected.translation && value.rotation == expected.rotation
        }) {
            return Err(Error::ManifoldPose);
        }
    } else if let Some(mesh) = shape.as_trimesh() {
        if id as usize >= mesh.num_triangles() {
            return Err(Error::ManifoldOwner);
        }
        if pose.is_some() {
            return Err(Error::ManifoldPose);
        }
    } else if let Some(heightfield) = shape.as_heightfield() {
        let count = heightfield
            .nrows()
            .checked_mul(heightfield.ncols())
            .and_then(|n| n.checked_mul(2))
            .ok_or(Error::Context)?;
        if id as usize >= count || heightfield.triangle_at_id(id).is_none() {
            return Err(Error::ManifoldOwner);
        }
        if pose.is_some() {
            return Err(Error::ManifoldPose);
        }
    } else if id != 0 {
        return Err(Error::ManifoldOwner);
    } else if pose.is_some() {
        return Err(Error::ManifoldPose);
    }
    Ok(())
}
fn context_manifold<M, C>(
    m: &ContactManifold<M, C>,
    context: Option<(&dyn Shape, &dyn Shape)>,
    decomposed: [bool; 2],
) -> Result<(), Error> {
    if let Some((a, b)) = context {
        for (shape, id, pose, leaf) in [
            (a, m.subshape1, m.subshape_pos1(), decomposed[0]),
            (b, m.subshape2, m.subshape_pos2(), decomposed[1]),
        ] {
            if leaf {
                valid_leaf(shape, id, pose)?;
            } else if id != 0 {
                return Err(Error::ManifoldOwner);
            } else if pose.is_some() {
                return Err(Error::ManifoldPose);
            }
        }
    }
    Ok(())
}
fn mapping<M, C>(
    values: impl Iterator<Item = ((u32, u32), usize, bool)>,
    metadata: (usize, usize, bool),
    manifolds: &[ContactManifold<M, C>],
    context: Option<(&dyn Shape, &dyn Shape)>,
    mut directions: u8,
    both_decomposed: bool,
    budget: &mut Budget,
) -> Result<(), Error> {
    let (capacity, len, timestamp) = metadata;
    budget.charge(capacity)?;
    budget.charge(len)?;
    budget.charge(manifolds.len())?;
    if len != manifolds.len() {
        return Err(Error::ManifoldIndex);
    }
    let mut seen = budget.scratch::<u8>(manifolds.len())?;
    seen.resize(manifolds.len(), 0);
    let decomposed = if both_decomposed {
        [true, true]
    } else {
        [directions & 1 != 0, directions & 2 != 0]
    };
    for (key, index, stamp) in values {
        if stamp != timestamp {
            return Err(Error::Timestamp);
        }
        let m = manifolds.get(index).ok_or(Error::ManifoldIndex)?;
        if seen[index] != 0 {
            return Err(Error::ManifoldIndex);
        }
        seen[index] = 1;
        let mut possible = 0;
        if (m.subshape1, m.subshape2) == key {
            possible |= 1;
        }
        if (m.subshape2, m.subshape1) == key {
            possible |= 2;
        }
        directions &= possible;
        if directions == 0 {
            return Err(Error::ManifoldOwner);
        }
        context_manifold(m, context, decomposed)?;
    }
    Ok(())
}
fn direction(context: Option<(&dyn Shape, &dyn Shape)>, heightfield: bool) -> u8 {
    match context {
        None => 3,
        Some((a, _)) => {
            if if heightfield {
                a.as_heightfield().is_some()
            } else {
                a.as_composite_shape().is_some()
            } {
                1
            } else {
                2
            }
        }
    }
}

/// Validates the supported five cache kinds and raw manifold correspondence.
/// `context=None` means a known pending SHAPE change will discard the old
/// workspace before reuse; its internal history is checked without comparing
/// old keys/poses to the replacement geometry. Shapes/BVHs must already have
/// passed their own structural/ready-bounds checks. No general allocator proof.
#[doc(hidden)]
pub fn validate_stored_contact_workspace<M, C>(
    workspace: &ContactManifoldsWorkspace,
    manifolds: &[ContactManifold<M, C>],
    context: Option<(&dyn Shape, &dyn Shape)>,
    limits: StoredWorkspaceLimits,
) -> Result<StoredWorkspaceUsage, Error> {
    let mut budget = Budget {
        work: limits.max_work,
        scratch: limits.max_scratch_bytes,
    };
    use TypedWorkspaceData as W;
    let data = workspace.0.as_typed_workspace_data();
    let actual = match data {
        W::TriMeshShapeContactManifoldsWorkspace(_) => Kind::TriMesh,
        W::HeightfieldShapeContactManifoldsWorkspace(_) => Kind::Heightfield,
        W::HeightfieldCompositeShapeContactManifoldsWorkspace(_) => Kind::HeightfieldComposite,
        W::CompositeShapeCompositeShapeContactManifoldsWorkspace(_) => Kind::CompositeComposite,
        W::CompositeShapeShapeContactManifoldsWorkspace(_) => Kind::Composite,
        _ => return Err(Error::Unsupported),
    };
    if let Some((a, b)) = context {
        if kind(a, b)? != Some(actual) {
            return Err(Error::Context);
        }
    }
    match data {
        W::TriMeshShapeContactManifoldsWorkspace(value) => {
            let (ids, aabb, old) = value.stored_records();
            budget.charge(ids.len())?;
            budget.charge(old.len())?;
            budget.charge(manifolds.len())?;
            if !old.is_empty() || ids.len() != manifolds.len() {
                return Err(Error::Interferences);
            }
            if *aabb == Aabb::new_invalid() {
                if !ids.is_empty() {
                    return Err(Error::Aabb);
                }
                return Ok(StoredWorkspaceUsage {
                    work: limits.max_work - budget.work,
                    scratch_bytes: limits.max_scratch_bytes - budget.scratch,
                });
            } else if !aabb.mins.is_finite()
                || !aabb.maxs.is_finite()
                || !aabb.mins.cmple(aabb.maxs).all()
            {
                return Err(Error::Aabb);
            }
            let mut directions = direction(context, false);
            let decomposed = [directions & 1 != 0, directions & 2 != 0];
            let mesh = context
                .map(|(a, b)| {
                    a.as_trimesh()
                        .or_else(|| b.as_trimesh())
                        .ok_or(Error::Context)
                })
                .transpose()?;
            let mut seen = if let Some(mesh) = mesh {
                // One direct, validated leaf lookup per actual triangle avoids
                // an implicit SmallVec traversal allocation or attacker hashing.
                budget.charge(mesh.num_triangles())?;
                let mut flags = budget.scratch::<u8>(mesh.num_triangles())?;
                flags.resize(mesh.num_triangles(), 0);
                flags
            } else {
                Vec::new()
            };
            // With pending geometry, use fallible sorted scratch only to check
            // uniqueness; it never reorders the saved interference/manifold rows.
            let mut pending_ids = if mesh.is_none() {
                budget.scratch::<u32>(ids.len())?
            } else {
                Vec::new()
            };
            for (&id, m) in ids.iter().zip(manifolds) {
                let mut possible = 0;
                if (m.subshape1, m.subshape2) == (id, 0) {
                    possible |= 1;
                }
                if (m.subshape2, m.subshape1) == (id, 0) {
                    possible |= 2;
                }
                directions &= possible;
                if directions == 0 {
                    return Err(Error::ManifoldOwner);
                }
                context_manifold(m, context, decomposed)?;
                if let Some(mesh) = mesh {
                    let flag = seen.get_mut(id as usize).ok_or(Error::Interferences)?;
                    if *flag != 0 {
                        return Err(Error::Interferences);
                    }
                    *flag = 1;
                    if id as usize >= mesh.num_triangles() {
                        return Err(Error::Interferences);
                    }
                } else {
                    pending_ids.push(id);
                }
            }
            if let Some(mesh) = mesh {
                if *aabb != Aabb::new_invalid() {
                    let query = BvhNode::leaf(*aabb, 0);
                    for (id, &present) in seen.iter().enumerate() {
                        let leaf = mesh.bvh().leaf_node(id as u32).ok_or(Error::Context)?;
                        if leaf.intersects(&query) != (present != 0) {
                            return Err(Error::Interferences);
                        }
                    }
                }
            } else {
                let rounds = (usize::BITS - ids.len().max(1).leading_zeros()) as usize;
                budget.charge(ids.len().checked_mul(rounds + 1).ok_or(Error::WorkLimit)?)?;
                pending_ids.sort_unstable();
                if pending_ids.windows(2).any(|p| p[0] == p[1]) {
                    return Err(Error::Interferences);
                }
            }
        }
        W::HeightfieldShapeContactManifoldsWorkspace(value) => {
            let (capacity, len, stamp, values) = value.stored_records();
            mapping(
                values.map(|(k, i, t)| ((k, 0), i, t)),
                (capacity, len, stamp),
                manifolds,
                context,
                direction(context, true),
                false,
                &mut budget,
            )?;
        }
        W::CompositeShapeShapeContactManifoldsWorkspace(value) => {
            let (capacity, len, stamp, values) = value.stored_records();
            mapping(
                values.map(|(k, i, t)| ((k, 0), i, t)),
                (capacity, len, stamp),
                manifolds,
                context,
                direction(context, false),
                false,
                &mut budget,
            )?;
        }
        W::CompositeShapeCompositeShapeContactManifoldsWorkspace(value) => {
            let (capacity, len, stamp, values) = value.stored_records();
            mapping(
                values,
                (capacity, len, stamp),
                manifolds,
                context,
                1,
                true,
                &mut budget,
            )?;
        }
        W::HeightfieldCompositeShapeContactManifoldsWorkspace(value) => {
            let (capacity, len, stamp, values) = value.stored_records();
            mapping(
                values,
                (capacity, len, stamp),
                manifolds,
                context,
                direction(context, true),
                true,
                &mut budget,
            )?;
        }
        _ => return Err(Error::Unsupported),
    }
    Ok(StoredWorkspaceUsage {
        work: limits.max_work - budget.work,
        scratch_bytes: limits.max_scratch_bytes - budget.scratch,
    })
}

/// Cold root-manifold checks for a pair with no persistent query workspace.
/// Empty registered/filtered pairs are valid. After an actual convex query,
/// exactly one root manifold may remain. A known pending SHAPE replacement
/// keeps its previous history until the producer consumes/reset it next step.
#[doc(hidden)]
pub fn validate_stored_contact_manifolds_without_workspace<M, C>(
    manifolds: &[ContactManifold<M, C>],
    context: Option<(&dyn Shape, &dyn Shape)>,
    limits: StoredWorkspaceLimits,
) -> Result<StoredWorkspaceUsage, Error> {
    let mut budget = Budget {
        work: limits.max_work,
        scratch: limits.max_scratch_bytes,
    };
    budget.charge(manifolds.len())?;
    if let Some((a, b)) = context {
        let expected = kind(a, b)?;
        if !manifolds.is_empty() {
            if expected.is_some() || manifolds.len() != 1 {
                return Err(Error::Context);
            }
            context_manifold(&manifolds[0], context, [false, false])?;
        }
    }
    Ok(StoredWorkspaceUsage {
        work: limits.max_work - budget.work,
        scratch_bytes: 0,
    })
}

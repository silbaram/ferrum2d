// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
//! An undo record for the rigid pipeline's externally observable preparation
//! state. A rejected zero-time step may have updated these fields before its
//! staged velocity proposal was rejected. Shape and slot owners never move.
use crate::alloc_prelude::*;
use crate::dynamics::*;
use crate::geometry::*;
use crate::math::{Real, Vector};
use crate::pipeline::PhysicsWorld;
use core::mem::size_of;
use parry::mass_properties::MassProperties;

struct BodyCredit {
    handle: RigidBodyHandle,
    ids: RigidBodyIds,
    pos: RigidBodyPosition,
    vels: RigidBodyVelocity<Real>,
    ccd_vels: RigidBodyVelocity<Real>,
    ccd: RigidBodyCcd,
    forces: RigidBodyForces,
    activation: RigidBodyActivation,
    changes: RigidBodyChanges,
    enabled: bool,
    world_com: Vector,
    effective_inv_mass: Vector,
    world_inertia: crate::math::AngularInertia,
    local_mprops: MassProperties,
    max_extent: Real,
}

struct ColliderCredit {
    handle: ColliderHandle,
    pos: ColliderPosition,
    flags: ColliderFlags,
    changes: ColliderChanges,
}

/// Reusable fixed-size rows for mutable rigid state and exact input queues.
/// No shape, collider membership, material, or arena allocation is copied.
#[derive(Default)]
pub struct RigidStepCredit {
    broad: BroadStepCredit,
    bodies: Vec<BodyCredit>,
    colliders: Vec<ColliderCredit>,
    modified_bodies: Vec<RigidBodyHandle>,
    modified_colliders: Vec<ColliderHandle>,
    removed_colliders: Vec<ColliderHandle>,
}

fn reserve<T>(rows: &mut Vec<T>, len: usize) -> Option<()> {
    rows.clear();
    rows.try_reserve_exact(len).ok()
}

impl RigidStepCredit {
    /// Visiting these sparse slots precedes the separate byte admission.
    pub fn sizing_visits(world: &PhysicsWorld) -> Option<usize> {
        BroadStepCredit::initial_visits(&world.broad_phase)
    }

    /// Release outdated backing first. Reusing an array of the same size allocates nothing.
    pub fn trim_and_size(&mut self, world: &PhysicsWorld) -> Option<usize> {
        fn trim<T>(rows: &mut Vec<T>, len: usize) {
            if rows.capacity() > len {
                *rows = Vec::new();
            }
        }
        trim(&mut self.bodies, world.bodies.len());
        trim(&mut self.colliders, world.colliders.len());
        trim(
            &mut self.modified_bodies,
            world.bodies.modified_bodies.len(),
        );
        trim(
            &mut self.modified_colliders,
            world.colliders.modified_colliders.len(),
        );
        trim(
            &mut self.removed_colliders,
            world.colliders.removed_colliders.len(),
        );
        Self::bytes(
            self.broad.trim_and_size(&world.broad_phase)?,
            world.bodies.len(),
            world.colliders.len(),
            world.bodies.modified_bodies.len(),
            world.colliders.modified_colliders.len(),
            world.colliders.removed_colliders.len(),
        )
    }

    /// Check actual backing capacities after the fallible reservations.
    pub fn retained_bytes(&self) -> Option<usize> {
        Self::bytes(
            self.broad.retained()?,
            self.bodies.capacity(),
            self.colliders.capacity(),
            self.modified_bodies.capacity(),
            self.modified_colliders.capacity(),
            self.removed_colliders.capacity(),
        )
    }

    fn bytes(
        broad: usize,
        bodies: usize,
        colliders: usize,
        modified_bodies: usize,
        modified_colliders: usize,
        removed_colliders: usize,
    ) -> Option<usize> {
        [
            broad,
            bodies.checked_mul(size_of::<BodyCredit>())?,
            colliders.checked_mul(size_of::<ColliderCredit>())?,
            modified_bodies.checked_mul(size_of::<RigidBodyHandle>())?,
            modified_colliders
                .checked_add(removed_colliders)?
                .checked_mul(size_of::<ColliderHandle>())?,
        ]
        .into_iter()
        .try_fold(0usize, usize::checked_add)
    }

    /// Capture after admitting the byte cost; each vector can be reused on the next tick.
    pub fn capture(&mut self, world: &PhysicsWorld) -> Option<()> {
        self.broad.capture(&world.broad_phase)?;
        reserve(&mut self.bodies, world.bodies.len())?;
        reserve(&mut self.colliders, world.colliders.len())?;
        reserve(
            &mut self.modified_bodies,
            world.bodies.modified_bodies.len(),
        )?;
        reserve(
            &mut self.modified_colliders,
            world.colliders.modified_colliders.len(),
        )?;
        reserve(
            &mut self.removed_colliders,
            world.colliders.removed_colliders.len(),
        )?;
        self.modified_bodies
            .extend_from_slice(&world.bodies.modified_bodies);
        self.modified_colliders
            .extend_from_slice(&world.colliders.modified_colliders);
        self.removed_colliders
            .extend_from_slice(&world.colliders.removed_colliders);
        self.bodies
            .extend(world.bodies.iter().map(|(handle, b)| BodyCredit {
                handle,
                ids: b.ids,
                pos: b.pos,
                vels: b.vels,
                ccd_vels: b.ccd_vels,
                ccd: b.ccd,
                forces: b.forces,
                activation: b.activation,
                changes: b.changes,
                enabled: b.enabled,
                world_com: b.mprops.world_com,
                effective_inv_mass: b.mprops.effective_inv_mass,
                world_inertia: b.mprops.effective_world_inv_inertia,
                local_mprops: b.mprops.local_mprops,
                max_extent: b.mprops.max_extent,
            }));
        self.colliders
            .extend(world.colliders.iter().map(|(handle, c)| ColliderCredit {
                handle,
                pos: c.pos,
                flags: c.flags,
                changes: c.changes,
            }));
        Some(())
    }

    /// Return to the saved frame without re-registering unchanged objects as user edits.
    pub fn restore(&mut self, world: &mut PhysicsWorld) {
        self.broad.restore(&mut world.broad_phase);
        for row in &self.bodies {
            let b = world.bodies.index_mut_internal(row.handle);
            b.ids = row.ids;
            b.pos = row.pos;
            b.vels = row.vels;
            b.ccd_vels = row.ccd_vels;
            b.ccd = row.ccd;
            b.forces = row.forces;
            b.activation = row.activation;
            b.changes = row.changes;
            b.enabled = row.enabled;
            b.mprops.world_com = row.world_com;
            b.mprops.effective_inv_mass = row.effective_inv_mass;
            b.mprops.effective_world_inv_inertia = row.world_inertia;
            b.mprops.local_mprops = row.local_mprops;
            b.mprops.max_extent = row.max_extent;
        }
        for row in &self.colliders {
            let c = world.colliders.index_mut_internal(row.handle);
            c.pos = row.pos;
            c.flags = row.flags;
            c.changes = row.changes;
        }
        world
            .bodies
            .modified_bodies
            .swap_entries(&mut self.modified_bodies);
        world
            .colliders
            .modified_colliders
            .swap_entries(&mut self.modified_colliders);
        core::mem::swap(
            &mut world.colliders.removed_colliders,
            &mut self.removed_colliders,
        );
    }
}

impl PhysicsWorld {
    /// Temporary sorted-reference storage and hash-table visits required by graph capture.
    pub fn rigid_step_graph_sort_cost(&self) -> Option<(usize, usize)> {
        let (len, capacity) = self.islands.persistent_joint_link_counts();
        let bytes = len.checked_mul(size_of::<(usize, usize)>())?;
        let levels = (usize::BITS - len.leading_zeros()) as usize;
        let work = capacity
            .checked_mul(2)?
            .checked_add(len.checked_mul(levels + 1)?)?;
        Some((bytes, work))
    }
}

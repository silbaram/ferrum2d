use super::events::{collider_id, collider_ref};
use super::geometry::collider_builder;
use super::world::native_id;
use super::{
    BodyId, BodyKind, ColliderDesc, ColliderId, ColliderRef, PhysicsError, PhysicsWorld3d,
};
use rapier3d::prelude as rp;

pub(super) fn native_collider(id: ColliderId) -> rp::ColliderHandle {
    rp::ColliderHandle::from_raw_parts(id.slot, id.generation)
}

fn body_kind(body: &rp::RigidBody) -> Result<BodyKind, PhysicsError> {
    Ok(match body.body_type() {
        rp::RigidBodyType::Fixed => BodyKind::Fixed,
        rp::RigidBodyType::Dynamic => BodyKind::Dynamic,
        rp::RigidBodyType::KinematicPositionBased => BodyKind::KinematicPosition,
        rp::RigidBodyType::KinematicVelocityBased => BodyKind::KinematicVelocity,
        rp::RigidBodyType::SoftFrame => return Err(PhysicsError::WrongBodyKind),
    })
}

impl PhysicsWorld3d {
    /// Effective groups of a live, enabled fixture on an enabled body.
    pub(crate) fn enabled_collider_groups(
        &self,
        id: ColliderId,
    ) -> Result<Option<(u32, u32)>, PhysicsError> {
        let collider = self
            .backend
            .colliders
            .get(native_collider(id))
            .ok_or(PhysicsError::StaleCollider)?;
        if !collider.is_enabled()
            || collider.parent().is_some_and(|body| {
                self.backend
                    .bodies
                    .get(body)
                    .is_none_or(|b| !b.is_enabled())
            })
        {
            return Ok(None);
        }
        let groups = collider.collision_groups();
        Ok(Some((groups.memberships.bits(), groups.filter.bits())))
    }

    /// Reads the body's integration kind without exposing backend handles.
    pub fn body_kind(&self, id: BodyId) -> Result<BodyKind, PhysicsError> {
        body_kind(
            self.backend
                .bodies
                .get(native_id(id))
                .ok_or(PhysicsError::StaleBody)?,
        )
    }

    /// Membership category bits of the actual fixture, including secondary fixtures.
    pub(crate) fn collider_category(&self, id: ColliderId) -> Result<u32, PhysicsError> {
        Ok(self
            .backend
            .colliders
            .get(native_collider(id))
            .ok_or(PhysicsError::StaleCollider)?
            .collision_groups()
            .memberships
            .bits())
    }

    /// Total live colliders, including multiple colliders attached to one body.
    pub fn collider_count(&self) -> usize {
        self.backend.colliders.len()
    }

    /// Iterates a body's current collider identities without allocating a new list.
    pub fn collider_ids(
        &self,
        body: BodyId,
    ) -> Result<impl Iterator<Item = ColliderId> + '_, PhysicsError> {
        let body = self
            .backend
            .bodies
            .get(native_id(body))
            .ok_or(PhysicsError::StaleBody)?;
        Ok(body.colliders().iter().copied().map(collider_id))
    }

    /// Returns a collider's owner and sensor status, rejecting removed generations.
    pub fn collider_owner(&self, id: ColliderId) -> Result<ColliderRef, PhysicsError> {
        let handle = native_collider(id);
        self.backend
            .colliders
            .get(handle)
            .and_then(|collider| collider_ref(handle, collider))
            .ok_or(PhysicsError::StaleCollider)
    }

    /// Adds a separately identifiable collider to a body. At most 64 are allowed per body.
    /// Mass properties are updated before the next impulse, without requiring a step.
    pub fn add_collider(
        &mut self,
        body: BodyId,
        desc: ColliderDesc,
    ) -> Result<ColliderId, PhysicsError> {
        if self.characters.contains_key(&body) && !desc.sensor {
            return Err(PhysicsError::CharacterControlled);
        }
        let handle = native_id(body);
        let body = self
            .backend
            .bodies
            .get(handle)
            .ok_or(PhysicsError::StaleBody)?;
        if self.collider_count() >= self.config.max_colliders || body.colliders().len() >= 64 {
            return Err(PhysicsError::CapacityExceeded);
        }
        let collider = collider_builder(&desc, body_kind(body)?, self.config.space)?;
        let id = self.backend.insert_collider(collider, Some(handle));
        let (slot, generation) = handle.into_raw_parts();
        self.contact_policies
            .set_surface(collider_id(id), desc.surface_velocity);
        self.contact_policies
            .set_correction(collider_id(id), desc.contact_correction);
        if let Some(c) = self.backend.colliders.get_mut(id) {
            c.set_active_hooks(
                self.contact_policies
                    .flags(BodyId { slot, generation }, collider_id(id)),
            );
        }
        self.refresh_mass(handle);
        self.query_updates.push(id);
        Ok(collider_id(id))
    }

    /// Removes one collider, retaining its owner and invalidating only this collider identity.
    /// The body may remain without geometry; it then has no collider-derived mass.
    pub fn remove_collider(&mut self, id: ColliderId) -> Result<(), PhysicsError> {
        let owner = self.collider_owner(id)?;
        if self
            .characters
            .get(&owner.body)
            .is_some_and(|r| r.collider == id)
        {
            return Err(PhysicsError::CharacterControlled);
        }
        for runtime in self.characters.values_mut() {
            if runtime
                .state
                .ground
                .is_some_and(|ground| ground.collider == id)
            {
                runtime.state.grounded = false;
                runtime.state.ground = None;
            }
        }
        self.events.remove_collider(id);
        self.contact_policies.one_way.remove(&id);
        self.contact_policies.surfaces.remove(&id);
        self.contact_policies.corrections.remove(&id);
        self.collider_shape_revisions.remove(&id);
        self.backend.remove_collider(native_collider(id));
        self.refresh_mass(native_id(owner.body));
        Ok(())
    }

    /// Replaces geometry, local pose, material and filtering while preserving the identity.
    /// Validation completes before any mutation. Queries see the new geometry immediately.
    pub fn update_collider(
        &mut self,
        id: ColliderId,
        desc: ColliderDesc,
    ) -> Result<(), PhysicsError> {
        self.validate_character_collider(id, &desc)?;
        let owner = self.collider_owner(id)?;
        let body = self
            .backend
            .bodies
            .get(native_id(owner.body))
            .ok_or(PhysicsError::StaleBody)?;
        let replacement = collider_builder(&desc, body_kind(body)?, self.config.space)?.build();
        // Replacing even numerically identical geometry used to change its Arc
        // identity. Preserve that invalidation contract with a serializable stamp.
        // Check exhaustion before touching geometry, mass, support or dirty queues.
        let shape_revision = self
            .collider_shape_revisions
            .get(&id)
            .copied()
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(PhysicsError::CapacityExceeded)?;
        let world_pose = body.position() * replacement.position();
        let collider = self
            .backend
            .colliders
            .get_mut(native_collider(id))
            .ok_or(PhysicsError::StaleCollider)?;
        collider.set_shape(replacement.shared_shape().clone());
        self.collider_shape_revisions.insert(id, shape_revision);
        collider.set_position_wrt_parent(*replacement.position());
        collider.set_position(world_pose);
        collider.set_density(desc.density);
        collider.set_friction(replacement.friction());
        collider.set_friction_combine_rule(replacement.friction_combine_rule());
        collider.set_restitution(desc.restitution);
        collider.set_restitution_combine_rule(replacement.restitution_combine_rule());
        collider.set_sensor(desc.sensor);
        collider.set_collision_groups(replacement.collision_groups());
        collider.set_active_collision_types(replacement.active_collision_types());
        self.contact_policies.set_surface(id, desc.surface_velocity);
        self.contact_policies
            .set_correction(id, desc.contact_correction);
        collider.set_active_hooks(self.contact_policies.flags(owner.body, id));
        self.refresh_mass(native_id(owner.body));
        self.query_updates.push(native_collider(id));
        self.invalidate_character_support(None, Some(id));
        if let Some(runtime) = self.characters.get_mut(&owner.body) {
            if runtime.collider == id {
                runtime.state.grounded = false;
                runtime.state.ground = None;
            }
        }
        Ok(())
    }

    fn refresh_mass(&mut self, id: rp::RigidBodyHandle) {
        if let Some(body) = self.backend.bodies.get_mut(id) {
            body.recompute_mass_properties_from_colliders(&self.backend.colliders);
            body.wake_up(true);
        }
    }
}

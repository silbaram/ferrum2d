use crate::components::{AngularVelocity, RigidBodyType, Rotation2D, Transform2D, Velocity};
use crate::entity::Entity;

use super::super::{
    Engine, PHYSICS_BODY_SNAPSHOT_FLAG_BODY_ENABLED, PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_ENABLED,
    PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_MATERIAL_OVERRIDE,
    PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_TRIGGER, PHYSICS_BODY_SNAPSHOT_FLAG_SLEEPING,
    PHYSICS_BODY_SNAPSHOT_U32_BODY_TYPE, PHYSICS_BODY_SNAPSHOT_U32_COLLIDER_TYPE,
    PHYSICS_BODY_SNAPSHOT_U32_ENTITY_GENERATION, PHYSICS_BODY_SNAPSHOT_U32_ENTITY_ID,
    PHYSICS_BODY_SNAPSHOT_U32_FLAGS, PHYSICS_COLLIDER_TYPE_NONE,
};
use super::snapshot_types::PhysicsEntitySnapshot;

impl Engine {
    pub(in crate::engine) fn store_physics_entity_snapshot(&mut self, entity: Entity) -> bool {
        let Some(transform) = self.world.transform(entity) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let Some(body) = self.world.rigid_body(entity) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let velocity = self.world.velocity(entity).unwrap_or_default();
        let rotation = self.world.rotation(entity).unwrap_or_default();
        let angular_velocity = self.world.angular_velocity(entity).unwrap_or_default();
        let (
            collider_type,
            collider_enabled,
            collider_is_trigger,
            collider_offset_x,
            collider_offset_y,
        ) = self.physics_collider_snapshot(entity);
        let (collider_material_override, collider_material) =
            self.physics_collider_material_snapshot(entity, body.material);
        self.physics_entity_snapshot = PhysicsEntitySnapshot {
            entity_id: entity.id,
            entity_generation: entity.generation,
            x: transform.x,
            y: transform.y,
            velocity_x: velocity.vx,
            velocity_y: velocity.vy,
            rotation_radians: rotation.radians,
            angular_velocity_radians_per_second: angular_velocity.radians_per_second,
            body_type: Self::rigid_body_type_code(body.body_type),
            body_enabled: body.enabled,
            is_sleeping: body.is_sleeping,
            collider_type,
            collider_enabled,
            collider_is_trigger,
            collider_offset_x,
            collider_offset_y,
            collider_material_override,
            collider_restitution: collider_material.restitution,
            collider_friction: collider_material.friction,
            collider_surface_velocity_x: collider_material.surface_velocity.vx,
            collider_surface_velocity_y: collider_material.surface_velocity.vy,
            collider_density: collider_material.density,
            collider_contact_baumgarte_bias_scale: collider_material.contact_baumgarte_bias_scale,
            collider_max_contact_baumgarte_bias_velocity_scale: collider_material
                .max_contact_baumgarte_bias_velocity_scale,
            collider_contact_position_correction_scale: collider_material
                .contact_position_correction_scale,
            collider_contact_position_correction_slop_scale: collider_material
                .contact_position_correction_slop_scale,
            mass: body.mass,
            inverse_mass: body.inverse_mass,
            inertia: body.inertia,
            inverse_inertia: body.inverse_inertia,
            gravity_scale: body.gravity_scale,
            linear_damping: body.linear_damping,
            angular_damping: body.angular_damping,
            restitution: body.material.restitution,
            friction: body.material.friction,
            surface_velocity_x: body.material.surface_velocity.vx,
            surface_velocity_y: body.material.surface_velocity.vy,
            density: body.material.density,
            contact_baumgarte_bias_scale: body.material.contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale: body
                .material
                .max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale: body.material.contact_position_correction_scale,
            contact_position_correction_slop_scale: body
                .material
                .contact_position_correction_slop_scale,
        };
        true
    }

    pub(in crate::engine) fn append_physics_body_snapshot_bulk(
        snapshot: PhysicsEntitySnapshot,
        floats: &mut Vec<f32>,
        u32s: &mut Vec<u32>,
    ) {
        u32s.extend_from_slice(&[
            snapshot.entity_id,
            snapshot.entity_generation,
            snapshot.body_type,
            snapshot.collider_type,
            Self::physics_body_snapshot_flags(snapshot),
        ]);
        floats.extend_from_slice(&[
            snapshot.x,
            snapshot.y,
            snapshot.velocity_x,
            snapshot.velocity_y,
            snapshot.rotation_radians,
            snapshot.angular_velocity_radians_per_second,
            snapshot.mass,
            snapshot.inertia,
            snapshot.gravity_scale,
            snapshot.linear_damping,
            snapshot.angular_damping,
            snapshot.restitution,
            snapshot.friction,
            snapshot.surface_velocity_x,
            snapshot.surface_velocity_y,
            snapshot.density,
            snapshot.contact_baumgarte_bias_scale,
            snapshot.max_contact_baumgarte_bias_velocity_scale,
            snapshot.contact_position_correction_scale,
            snapshot.contact_position_correction_slop_scale,
            snapshot.collider_offset_x,
            snapshot.collider_offset_y,
            snapshot.collider_restitution,
            snapshot.collider_friction,
            snapshot.collider_surface_velocity_x,
            snapshot.collider_surface_velocity_y,
            snapshot.collider_density,
            snapshot.collider_contact_baumgarte_bias_scale,
            snapshot.collider_max_contact_baumgarte_bias_velocity_scale,
            snapshot.collider_contact_position_correction_scale,
            snapshot.collider_contact_position_correction_slop_scale,
        ]);
    }

    fn physics_body_snapshot_flags(snapshot: PhysicsEntitySnapshot) -> u32 {
        let mut flags = 0;
        if snapshot.body_enabled {
            flags |= PHYSICS_BODY_SNAPSHOT_FLAG_BODY_ENABLED;
        }
        if snapshot.is_sleeping {
            flags |= PHYSICS_BODY_SNAPSHOT_FLAG_SLEEPING;
        }
        if snapshot.collider_enabled {
            flags |= PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_ENABLED;
        }
        if snapshot.collider_is_trigger {
            flags |= PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_TRIGGER;
        }
        if snapshot.collider_material_override {
            flags |= PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_MATERIAL_OVERRIDE;
        }
        flags
    }

    pub(in crate::engine) fn restore_physics_body_snapshot_entry(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        floats: &[f32],
        u32s: &[u32],
    ) -> bool {
        if u32s[PHYSICS_BODY_SNAPSHOT_U32_ENTITY_ID] != entity_id
            || u32s[PHYSICS_BODY_SNAPSHOT_U32_ENTITY_GENERATION] != entity_generation
        {
            return false;
        }
        let Some(body_type) =
            Self::rigid_body_type_from_code(u32s[PHYSICS_BODY_SNAPSHOT_U32_BODY_TYPE])
        else {
            return false;
        };
        let flags = u32s[PHYSICS_BODY_SNAPSHOT_U32_FLAGS];
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        let Some(mut body) = self.world.rigid_body(entity) else {
            return false;
        };
        if body.body_type != body_type {
            return false;
        }
        if !Self::valid_transform(floats[0], floats[1])
            || !Self::valid_transform(floats[2], floats[3])
            || !floats[4].is_finite()
            || !floats[5].is_finite()
            || !floats[8].is_finite()
            || !Self::valid_non_negative(floats[9])
            || !Self::valid_non_negative(floats[10])
            || !Self::valid_transform(floats[20], floats[21])
            || !Self::valid_physics_material_parts(
                floats[11], floats[12], floats[13], floats[14], floats[15], floats[16], floats[17],
                floats[18], floats[19],
            )
            || !Self::valid_physics_material_parts(
                floats[22], floats[23], floats[24], floats[25], floats[26], floats[27], floats[28],
                floats[29], floats[30],
            )
        {
            return false;
        }
        if body.body_type == RigidBodyType::Dynamic
            && (!Self::valid_positive(floats[6]) || !Self::valid_positive(floats[7]))
        {
            return false;
        }

        self.world.set_transform(
            entity,
            Transform2D {
                x: floats[0],
                y: floats[1],
            },
        );
        self.world.set_velocity(
            entity,
            Velocity {
                vx: floats[2],
                vy: floats[3],
            },
        );
        self.world
            .set_rotation(entity, Rotation2D { radians: floats[4] });
        self.world.set_angular_velocity(
            entity,
            AngularVelocity {
                radians_per_second: floats[5],
            },
        );

        body.enabled = flags & PHYSICS_BODY_SNAPSHOT_FLAG_BODY_ENABLED != 0;
        body.is_sleeping = flags & PHYSICS_BODY_SNAPSHOT_FLAG_SLEEPING != 0;
        body.sleep_timer_seconds = 0.0;
        body.force = Velocity::default();
        body.impulse = Velocity::default();
        body.torque = 0.0;
        body.angular_impulse = 0.0;
        if body.body_type == RigidBodyType::Dynamic {
            body.mass = floats[6];
            body.inverse_mass = 1.0 / floats[6];
            body.inertia = floats[7];
            body.inverse_inertia = 1.0 / floats[7];
        }
        body.gravity_scale = floats[8];
        body.linear_damping = floats[9];
        body.angular_damping = floats[10];
        body.material = Self::physics_material_from_parts(
            floats[11], floats[12], floats[13], floats[14], floats[15], floats[16], floats[17],
            floats[18], floats[19],
        );
        self.world.set_rigid_body(entity, body);

        let collider_type = u32s[PHYSICS_BODY_SNAPSHOT_U32_COLLIDER_TYPE];
        if self.physics_collider_snapshot(entity).0 != collider_type {
            return false;
        }
        if collider_type != PHYSICS_COLLIDER_TYPE_NONE {
            if !self.set_physics_collider_offset_for_entity(entity, floats[20], floats[21])
                || !self.set_physics_collider_enabled_for_entity(
                    entity,
                    flags & PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_ENABLED != 0,
                )
            {
                return false;
            }
            if flags & PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_MATERIAL_OVERRIDE != 0 {
                let material = Self::physics_material_from_parts(
                    floats[22], floats[23], floats[24], floats[25], floats[26], floats[27],
                    floats[28], floats[29], floats[30],
                );
                if !self.set_physics_collider_material_for_entity(entity, material) {
                    return false;
                }
            } else if !self.clear_physics_collider_material_for_entity(entity) {
                return false;
            }
        }
        self.store_physics_entity_snapshot(entity)
    }
}

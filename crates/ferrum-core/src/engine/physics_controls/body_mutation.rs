use wasm_bindgen::prelude::*;

use crate::components::{
    valid_positive_mass_property, AngularVelocity, HeightSpan, PhysicsFloorId, RigidBodyType,
    Rotation2D, Transform2D, Velocity,
};

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn despawn_physics_entity(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.despawn(entity);
        self.clear_physics_history();
        true
    }

    pub fn set_physics_body_position(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        x: f32,
        y: f32,
    ) -> bool {
        if !Self::valid_transform(x, y) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        self.world.set_transform(entity, Transform2D { x, y });
        self.store_physics_entity_snapshot(entity)
    }

    pub fn set_physics_body_velocity(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        velocity_x: f32,
        velocity_y: f32,
    ) -> bool {
        if !Self::valid_transform(velocity_x, velocity_y) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        self.world.set_velocity(
            entity,
            Velocity {
                vx: velocity_x,
                vy: velocity_y,
            },
        );
        self.store_physics_entity_snapshot(entity)
    }

    pub fn set_physics_body_rotation(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        rotation_radians: f32,
    ) -> bool {
        if !rotation_radians.is_finite() {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        self.world.set_rotation(
            entity,
            Rotation2D {
                radians: rotation_radians,
            },
        );
        self.store_physics_entity_snapshot(entity)
    }

    pub fn set_physics_body_angular_velocity(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        radians_per_second: f32,
    ) -> bool {
        if !radians_per_second.is_finite() {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        self.world
            .set_angular_velocity(entity, AngularVelocity { radians_per_second });
        self.store_physics_entity_snapshot(entity)
    }

    pub fn set_physics_body_height_span(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        floor_id: u32,
        elevation: f32,
        height: f32,
    ) -> bool {
        let Some(span) = HeightSpan::new(PhysicsFloorId(floor_id), elevation, height) else {
            return false;
        };
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        self.world.set_height_span(entity, span)
    }

    pub fn clear_physics_body_height_span(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        self.world.clear_height_span(entity)
    }

    pub fn physics_body_has_height_span(&self, entity_id: u32, entity_generation: u32) -> bool {
        self.entity_from_handle(entity_id, entity_generation)
            .and_then(|entity| self.world.height_span(entity))
            .is_some()
    }

    pub fn physics_body_floor_id(&self, entity_id: u32, entity_generation: u32) -> u32 {
        self.entity_from_handle(entity_id, entity_generation)
            .and_then(|entity| self.world.height_span(entity))
            .map(|span| span.floor.0)
            .unwrap_or(0)
    }

    pub fn physics_body_elevation(&self, entity_id: u32, entity_generation: u32) -> f32 {
        self.entity_from_handle(entity_id, entity_generation)
            .and_then(|entity| self.world.height_span(entity))
            .map(|span| span.elevation)
            .unwrap_or(0.0)
    }

    pub fn physics_body_height(&self, entity_id: u32, entity_generation: u32) -> f32 {
        self.entity_from_handle(entity_id, entity_generation)
            .and_then(|entity| self.world.height_span(entity))
            .map(|span| span.height)
            .unwrap_or(0.0)
    }

    pub fn set_physics_body_enabled(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        enabled: bool,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        let Some(mut body) = self.world.rigid_body(entity) else {
            return false;
        };
        body.enabled = enabled;
        if !enabled {
            body.force = Velocity::default();
            body.impulse = Velocity::default();
            body.torque = 0.0;
            body.angular_impulse = 0.0;
            body.is_sleeping = false;
            body.sleep_timer_seconds = 0.0;
        }
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    pub fn set_physics_body_tuning(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        gravity_scale: f32,
        linear_damping: f32,
        angular_damping: f32,
    ) -> bool {
        if !gravity_scale.is_finite()
            || !Self::valid_non_negative(linear_damping)
            || !Self::valid_non_negative(angular_damping)
        {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        let Some(mut body) = self.world.rigid_body(entity) else {
            return false;
        };
        body.gravity_scale = gravity_scale;
        body.linear_damping = linear_damping;
        body.angular_damping = angular_damping;
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    pub fn set_physics_body_mass_properties(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        mass: f32,
        inertia: f32,
    ) -> bool {
        if !valid_positive_mass_property(mass) || !valid_positive_mass_property(inertia) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        let Some(mut body) = self.world.rigid_body(entity) else {
            return false;
        };
        if body.body_type != RigidBodyType::Dynamic {
            return false;
        }
        body.mass = mass;
        body.inverse_mass = 1.0 / mass;
        body.inertia = inertia;
        body.inverse_inertia = 1.0 / inertia;
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_physics_body_material(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        restitution: f32,
        friction: f32,
        surface_velocity_x: f32,
        surface_velocity_y: f32,
        density: f32,
        contact_baumgarte_bias_scale: f32,
        max_contact_baumgarte_bias_velocity_scale: f32,
        contact_position_correction_scale: f32,
        contact_position_correction_slop_scale: f32,
    ) -> bool {
        if !Self::valid_physics_material_parts(
            restitution,
            friction,
            surface_velocity_x,
            surface_velocity_y,
            density,
            contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale,
            contact_position_correction_slop_scale,
        ) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        let Some(mut body) = self.world.rigid_body(entity) else {
            return false;
        };
        let material = Self::physics_material_from_parts(
            restitution,
            friction,
            surface_velocity_x,
            surface_velocity_y,
            density,
            contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale,
            contact_position_correction_slop_scale,
        );
        body.material = material;
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    pub fn apply_physics_body_force(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        force_x: f32,
        force_y: f32,
    ) -> bool {
        if !Self::valid_transform(force_x, force_y) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        self.world.apply_force(
            entity,
            Velocity {
                vx: force_x,
                vy: force_y,
            },
        );
        self.store_physics_entity_snapshot(entity)
    }

    pub fn apply_physics_body_impulse(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        impulse_x: f32,
        impulse_y: f32,
    ) -> bool {
        if !Self::valid_transform(impulse_x, impulse_y) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        self.world.apply_impulse(
            entity,
            Velocity {
                vx: impulse_x,
                vy: impulse_y,
            },
        );
        self.store_physics_entity_snapshot(entity)
    }

    pub fn apply_physics_body_torque(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        torque: f32,
    ) -> bool {
        if !torque.is_finite() {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        self.world.apply_torque(entity, torque);
        self.store_physics_entity_snapshot(entity)
    }

    pub fn apply_physics_body_angular_impulse(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        angular_impulse: f32,
    ) -> bool {
        if !angular_impulse.is_finite() {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        self.world.apply_angular_impulse(entity, angular_impulse);
        self.store_physics_entity_snapshot(entity)
    }
}

use wasm_bindgen::prelude::*;

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn physics_query_entity_id(&self) -> u32 {
        self.physics_query_result.entity_id
    }

    pub fn physics_query_entity_generation(&self) -> u32 {
        self.physics_query_result.entity_generation
    }

    pub fn physics_query_tile_layer_index(&self) -> u32 {
        self.physics_query_result.tile_layer_index
    }

    pub fn physics_query_tile_index(&self) -> u32 {
        self.physics_query_result.tile_index
    }

    pub fn physics_query_point_x(&self) -> f32 {
        self.physics_query_result.point_x
    }

    pub fn physics_query_point_y(&self) -> f32 {
        self.physics_query_result.point_y
    }

    pub fn physics_query_distance(&self) -> f32 {
        self.physics_query_result.distance
    }

    pub fn physics_entity_id(&self) -> u32 {
        self.physics_entity_snapshot.entity_id
    }

    pub fn physics_entity_generation(&self) -> u32 {
        self.physics_entity_snapshot.entity_generation
    }

    pub fn physics_entity_x(&self) -> f32 {
        self.physics_entity_snapshot.x
    }

    pub fn physics_entity_y(&self) -> f32 {
        self.physics_entity_snapshot.y
    }

    pub fn physics_entity_velocity_x(&self) -> f32 {
        self.physics_entity_snapshot.velocity_x
    }

    pub fn physics_entity_velocity_y(&self) -> f32 {
        self.physics_entity_snapshot.velocity_y
    }

    pub fn physics_entity_rotation_radians(&self) -> f32 {
        self.physics_entity_snapshot.rotation_radians
    }

    pub fn physics_entity_angular_velocity_radians_per_second(&self) -> f32 {
        self.physics_entity_snapshot
            .angular_velocity_radians_per_second
    }

    pub fn physics_entity_body_type(&self) -> u32 {
        self.physics_entity_snapshot.body_type
    }

    pub fn physics_entity_body_enabled(&self) -> bool {
        self.physics_entity_snapshot.body_enabled
    }

    pub fn physics_entity_is_sleeping(&self) -> bool {
        self.physics_entity_snapshot.is_sleeping
    }

    pub fn physics_entity_collider_type(&self) -> u32 {
        self.physics_entity_snapshot.collider_type
    }

    pub fn physics_entity_collider_enabled(&self) -> bool {
        self.physics_entity_snapshot.collider_enabled
    }

    pub fn physics_entity_collider_is_trigger(&self) -> bool {
        self.physics_entity_snapshot.collider_is_trigger
    }

    pub fn physics_entity_collider_offset_x(&self) -> f32 {
        self.physics_entity_snapshot.collider_offset_x
    }

    pub fn physics_entity_collider_offset_y(&self) -> f32 {
        self.physics_entity_snapshot.collider_offset_y
    }

    pub fn physics_entity_collider_material_override(&self) -> bool {
        self.physics_entity_snapshot.collider_material_override
    }

    pub fn physics_entity_collider_restitution(&self) -> f32 {
        self.physics_entity_snapshot.collider_restitution
    }

    pub fn physics_entity_collider_friction(&self) -> f32 {
        self.physics_entity_snapshot.collider_friction
    }

    pub fn physics_entity_collider_surface_velocity_x(&self) -> f32 {
        self.physics_entity_snapshot.collider_surface_velocity_x
    }

    pub fn physics_entity_collider_surface_velocity_y(&self) -> f32 {
        self.physics_entity_snapshot.collider_surface_velocity_y
    }

    pub fn physics_entity_collider_density(&self) -> f32 {
        self.physics_entity_snapshot.collider_density
    }

    pub fn physics_entity_collider_contact_baumgarte_bias_scale(&self) -> f32 {
        self.physics_entity_snapshot
            .collider_contact_baumgarte_bias_scale
    }

    pub fn physics_entity_collider_max_contact_baumgarte_bias_velocity_scale(&self) -> f32 {
        self.physics_entity_snapshot
            .collider_max_contact_baumgarte_bias_velocity_scale
    }

    pub fn physics_entity_collider_contact_position_correction_scale(&self) -> f32 {
        self.physics_entity_snapshot
            .collider_contact_position_correction_scale
    }

    pub fn physics_entity_collider_contact_position_correction_slop_scale(&self) -> f32 {
        self.physics_entity_snapshot
            .collider_contact_position_correction_slop_scale
    }

    pub fn physics_entity_mass(&self) -> f32 {
        self.physics_entity_snapshot.mass
    }

    pub fn physics_entity_inverse_mass(&self) -> f32 {
        self.physics_entity_snapshot.inverse_mass
    }

    pub fn physics_entity_inertia(&self) -> f32 {
        self.physics_entity_snapshot.inertia
    }

    pub fn physics_entity_inverse_inertia(&self) -> f32 {
        self.physics_entity_snapshot.inverse_inertia
    }

    pub fn physics_entity_gravity_scale(&self) -> f32 {
        self.physics_entity_snapshot.gravity_scale
    }

    pub fn physics_entity_linear_damping(&self) -> f32 {
        self.physics_entity_snapshot.linear_damping
    }

    pub fn physics_entity_angular_damping(&self) -> f32 {
        self.physics_entity_snapshot.angular_damping
    }

    pub fn physics_entity_restitution(&self) -> f32 {
        self.physics_entity_snapshot.restitution
    }

    pub fn physics_entity_friction(&self) -> f32 {
        self.physics_entity_snapshot.friction
    }

    pub fn physics_entity_surface_velocity_x(&self) -> f32 {
        self.physics_entity_snapshot.surface_velocity_x
    }

    pub fn physics_entity_surface_velocity_y(&self) -> f32 {
        self.physics_entity_snapshot.surface_velocity_y
    }

    pub fn physics_entity_density(&self) -> f32 {
        self.physics_entity_snapshot.density
    }

    pub fn physics_entity_contact_baumgarte_bias_scale(&self) -> f32 {
        self.physics_entity_snapshot.contact_baumgarte_bias_scale
    }

    pub fn physics_entity_max_contact_baumgarte_bias_velocity_scale(&self) -> f32 {
        self.physics_entity_snapshot
            .max_contact_baumgarte_bias_velocity_scale
    }

    pub fn physics_entity_contact_position_correction_scale(&self) -> f32 {
        self.physics_entity_snapshot
            .contact_position_correction_scale
    }

    pub fn physics_entity_contact_position_correction_slop_scale(&self) -> f32 {
        self.physics_entity_snapshot
            .contact_position_correction_slop_scale
    }

    pub fn physics_body_collider_index(&self) -> u32 {
        self.physics_body_collider_snapshot.collider_index
    }

    pub fn physics_body_collider_type(&self) -> u32 {
        self.physics_body_collider_snapshot.collider_type
    }

    pub fn physics_body_collider_enabled(&self) -> bool {
        self.physics_body_collider_snapshot.collider_enabled
    }

    pub fn physics_body_collider_is_trigger(&self) -> bool {
        self.physics_body_collider_snapshot.collider_is_trigger
    }

    pub fn physics_body_collider_offset_x(&self) -> f32 {
        self.physics_body_collider_snapshot.collider_offset_x
    }

    pub fn physics_body_collider_offset_y(&self) -> f32 {
        self.physics_body_collider_snapshot.collider_offset_y
    }

    pub fn physics_body_collider_material_override(&self) -> bool {
        self.physics_body_collider_snapshot
            .collider_material_override
    }

    pub fn physics_body_collider_restitution(&self) -> f32 {
        self.physics_body_collider_snapshot.collider_restitution
    }

    pub fn physics_body_collider_friction(&self) -> f32 {
        self.physics_body_collider_snapshot.collider_friction
    }

    pub fn physics_body_collider_surface_velocity_x(&self) -> f32 {
        self.physics_body_collider_snapshot
            .collider_surface_velocity_x
    }

    pub fn physics_body_collider_surface_velocity_y(&self) -> f32 {
        self.physics_body_collider_snapshot
            .collider_surface_velocity_y
    }

    pub fn physics_body_collider_density(&self) -> f32 {
        self.physics_body_collider_snapshot.collider_density
    }

    pub fn physics_body_collider_contact_baumgarte_bias_scale(&self) -> f32 {
        self.physics_body_collider_snapshot
            .collider_contact_baumgarte_bias_scale
    }

    pub fn physics_body_collider_max_contact_baumgarte_bias_velocity_scale(&self) -> f32 {
        self.physics_body_collider_snapshot
            .collider_max_contact_baumgarte_bias_velocity_scale
    }

    pub fn physics_body_collider_contact_position_correction_scale(&self) -> f32 {
        self.physics_body_collider_snapshot
            .collider_contact_position_correction_scale
    }

    pub fn physics_body_collider_contact_position_correction_slop_scale(&self) -> f32 {
        self.physics_body_collider_snapshot
            .collider_contact_position_correction_slop_scale
    }

    pub fn physics_body_collider_category_bits(&self) -> u32 {
        self.physics_body_collider_snapshot.collider_category_bits
    }

    pub fn physics_body_collider_mask_bits(&self) -> u32 {
        self.physics_body_collider_snapshot.collider_mask_bits
    }
}

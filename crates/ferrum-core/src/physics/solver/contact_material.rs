use crate::collision::ColliderKey;
use crate::components::PhysicsMaterial;
use crate::physics::math::finite_velocity;
use crate::world::World;

pub(super) fn contact_material_for_collider(world: &World, key: ColliderKey) -> PhysicsMaterial {
    world
        .compound_collider_ref_at(key.entity_index, key.collider_index)
        .and_then(|collider| collider.material())
        .or_else(|| world.collider_material_at(key.entity_index))
        .or_else(|| {
            world
                .rigid_bodies
                .get(key.entity_index)
                .copied()
                .flatten()
                .map(|body| body.material)
        })
        .map(sanitize_physics_material)
        .unwrap_or_default()
}

pub(super) fn sanitize_physics_material(material: PhysicsMaterial) -> PhysicsMaterial {
    PhysicsMaterial {
        restitution: if material.restitution.is_finite() && material.restitution >= 0.0 {
            material.restitution.min(1.0)
        } else {
            PhysicsMaterial::DEFAULT_RESTITUTION
        },
        friction: if material.friction.is_finite() && material.friction >= 0.0 {
            material.friction
        } else {
            PhysicsMaterial::DEFAULT_FRICTION
        },
        surface_velocity: finite_velocity(material.surface_velocity),
        density: if material.density.is_finite() && material.density > 0.0 {
            material.density
        } else {
            PhysicsMaterial::DEFAULT_DENSITY
        },
        contact_baumgarte_bias_scale: if material.contact_baumgarte_bias_scale.is_finite()
            && material.contact_baumgarte_bias_scale >= 0.0
        {
            material.contact_baumgarte_bias_scale
        } else {
            PhysicsMaterial::DEFAULT_CONTACT_BAUMGARTE_BIAS_SCALE
        },
        max_contact_baumgarte_bias_velocity_scale: if material
            .max_contact_baumgarte_bias_velocity_scale
            .is_finite()
            && material.max_contact_baumgarte_bias_velocity_scale >= 0.0
        {
            material.max_contact_baumgarte_bias_velocity_scale
        } else {
            PhysicsMaterial::DEFAULT_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY_SCALE
        },
        contact_position_correction_scale: if material.contact_position_correction_scale.is_finite()
            && material.contact_position_correction_scale >= 0.0
        {
            material.contact_position_correction_scale
        } else {
            PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SCALE
        },
        contact_position_correction_slop_scale: if material
            .contact_position_correction_slop_scale
            .is_finite()
            && material.contact_position_correction_slop_scale >= 0.0
        {
            material.contact_position_correction_slop_scale
        } else {
            PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SLOP_SCALE
        },
    }
}

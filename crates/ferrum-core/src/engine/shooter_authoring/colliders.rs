use wasm_bindgen::prelude::*;

use crate::world::{EntityTemplateCollider, EntityTemplateColliderShape};

use super::super::scenes::ActiveScene;
use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_prefab_collider(
        &mut self,
        prefab: u32,
        half_width: f32,
        half_height: f32,
        offset_x: f32,
        offset_y: f32,
        enabled: bool,
        is_trigger: bool,
        has_material: bool,
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
        if !Self::valid_positive(half_width)
            || !Self::valid_positive(half_height)
            || !Self::valid_transform(offset_x, offset_y)
            || (has_material
                && !Self::valid_physics_material_parts(
                    restitution,
                    friction,
                    surface_velocity_x,
                    surface_velocity_y,
                    density,
                    contact_baumgarte_bias_scale,
                    max_contact_baumgarte_bias_velocity_scale,
                    contact_position_correction_scale,
                    contact_position_correction_slop_scale,
                ))
        {
            return false;
        }

        let material = has_material.then(|| {
            Self::physics_material_from_parts(
                restitution,
                friction,
                surface_velocity_x,
                surface_velocity_y,
                density,
                contact_baumgarte_bias_scale,
                max_contact_baumgarte_bias_velocity_scale,
                contact_position_correction_scale,
                contact_position_correction_slop_scale,
            )
        });
        self.active_scene = ActiveScene::Shooter;
        let applied = self.scene.set_prefab_collider(
            &mut self.world,
            prefab,
            EntityTemplateCollider::aabb(
                half_width,
                half_height,
                offset_x,
                offset_y,
                enabled,
                is_trigger,
                material,
            ),
        );
        if applied {
            self.clear_physics_history();
        }
        applied
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_prefab_circle_collider(
        &mut self,
        prefab: u32,
        radius: f32,
        offset_x: f32,
        offset_y: f32,
        enabled: bool,
        is_trigger: bool,
        has_material: bool,
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
        if !Self::valid_positive(radius)
            || !Self::valid_transform(offset_x, offset_y)
            || (has_material
                && !Self::valid_physics_material_parts(
                    restitution,
                    friction,
                    surface_velocity_x,
                    surface_velocity_y,
                    density,
                    contact_baumgarte_bias_scale,
                    max_contact_baumgarte_bias_velocity_scale,
                    contact_position_correction_scale,
                    contact_position_correction_slop_scale,
                ))
        {
            return false;
        }

        self.set_shooter_prefab_shape_collider(
            prefab,
            EntityTemplateColliderShape::Circle { radius },
            offset_x,
            offset_y,
            enabled,
            is_trigger,
            has_material,
            restitution,
            friction,
            surface_velocity_x,
            surface_velocity_y,
            density,
            contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale,
            contact_position_correction_slop_scale,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_prefab_capsule_collider(
        &mut self,
        prefab: u32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        offset_x: f32,
        offset_y: f32,
        enabled: bool,
        is_trigger: bool,
        has_material: bool,
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
        if !Self::valid_transform(start_x, start_y)
            || !Self::valid_transform(end_x, end_y)
            || !Self::valid_positive(radius)
            || !Self::valid_transform(offset_x, offset_y)
            || (has_material
                && !Self::valid_physics_material_parts(
                    restitution,
                    friction,
                    surface_velocity_x,
                    surface_velocity_y,
                    density,
                    contact_baumgarte_bias_scale,
                    max_contact_baumgarte_bias_velocity_scale,
                    contact_position_correction_scale,
                    contact_position_correction_slop_scale,
                ))
        {
            return false;
        }

        self.set_shooter_prefab_shape_collider(
            prefab,
            EntityTemplateColliderShape::Capsule {
                start_x,
                start_y,
                end_x,
                end_y,
                radius,
            },
            offset_x,
            offset_y,
            enabled,
            is_trigger,
            has_material,
            restitution,
            friction,
            surface_velocity_x,
            surface_velocity_y,
            density,
            contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale,
            contact_position_correction_slop_scale,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_prefab_oriented_box_collider(
        &mut self,
        prefab: u32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        offset_x: f32,
        offset_y: f32,
        enabled: bool,
        is_trigger: bool,
        has_material: bool,
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
        if !Self::valid_positive(half_width)
            || !Self::valid_positive(half_height)
            || !rotation_radians.is_finite()
            || !Self::valid_transform(offset_x, offset_y)
            || (has_material
                && !Self::valid_physics_material_parts(
                    restitution,
                    friction,
                    surface_velocity_x,
                    surface_velocity_y,
                    density,
                    contact_baumgarte_bias_scale,
                    max_contact_baumgarte_bias_velocity_scale,
                    contact_position_correction_scale,
                    contact_position_correction_slop_scale,
                ))
        {
            return false;
        }

        self.set_shooter_prefab_shape_collider(
            prefab,
            EntityTemplateColliderShape::OrientedBox {
                half_width,
                half_height,
                rotation_radians,
            },
            offset_x,
            offset_y,
            enabled,
            is_trigger,
            has_material,
            restitution,
            friction,
            surface_velocity_x,
            surface_velocity_y,
            density,
            contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale,
            contact_position_correction_slop_scale,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_prefab_convex_polygon_collider(
        &mut self,
        prefab: u32,
        vertex_values: Vec<f32>,
        rotation_radians: f32,
        offset_x: f32,
        offset_y: f32,
        enabled: bool,
        is_trigger: bool,
        has_material: bool,
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
        if !rotation_radians.is_finite()
            || !Self::valid_transform(offset_x, offset_y)
            || (has_material
                && !Self::valid_physics_material_parts(
                    restitution,
                    friction,
                    surface_velocity_x,
                    surface_velocity_y,
                    density,
                    contact_baumgarte_bias_scale,
                    max_contact_baumgarte_bias_velocity_scale,
                    contact_position_correction_scale,
                    contact_position_correction_slop_scale,
                ))
        {
            return false;
        }
        let Some((vertices, vertex_count)) = Self::convex_polygon_vertices(&vertex_values) else {
            return false;
        };

        self.set_shooter_prefab_shape_collider(
            prefab,
            EntityTemplateColliderShape::ConvexPolygon {
                vertices,
                vertex_count,
                rotation_radians,
            },
            offset_x,
            offset_y,
            enabled,
            is_trigger,
            has_material,
            restitution,
            friction,
            surface_velocity_x,
            surface_velocity_y,
            density,
            contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale,
            contact_position_correction_slop_scale,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn set_shooter_prefab_shape_collider(
        &mut self,
        prefab: u32,
        shape: EntityTemplateColliderShape,
        offset_x: f32,
        offset_y: f32,
        enabled: bool,
        is_trigger: bool,
        has_material: bool,
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
        let material = has_material.then(|| {
            Self::physics_material_from_parts(
                restitution,
                friction,
                surface_velocity_x,
                surface_velocity_y,
                density,
                contact_baumgarte_bias_scale,
                max_contact_baumgarte_bias_velocity_scale,
                contact_position_correction_scale,
                contact_position_correction_slop_scale,
            )
        });
        self.active_scene = ActiveScene::Shooter;
        let applied = self.scene.set_prefab_collider(
            &mut self.world,
            prefab,
            EntityTemplateCollider {
                shape,
                half_width: 0.0,
                half_height: 0.0,
                offset_x,
                offset_y,
                enabled,
                is_trigger,
                material,
            },
        );
        if applied {
            self.clear_physics_history();
        }
        applied
    }
}

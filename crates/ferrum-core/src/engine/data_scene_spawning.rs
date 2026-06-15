use wasm_bindgen::prelude::*;

use crate::components::{CollisionLayer, SpriteAnimation, SpriteFrame, Transform2D};
use crate::entity::Entity;
use crate::world::{
    EntityTemplate, EntityTemplateCollider, EntityTemplateColliderShape, PrefabEntitySpawnRequest,
    PrefabSpriteTint,
};

use super::{
    Engine, SceneMode, PHYSICS_COLLIDER_TYPE_AABB, PHYSICS_COLLIDER_TYPE_CAPSULE,
    PHYSICS_COLLIDER_TYPE_CIRCLE, PHYSICS_COLLIDER_TYPE_CONVEX_POLYGON, PHYSICS_COLLIDER_TYPE_EDGE,
    PHYSICS_COLLIDER_TYPE_NONE, PHYSICS_COLLIDER_TYPE_ORIENTED_BOX, PHYSICS_LAYER_BULLET,
    PHYSICS_LAYER_ENEMY, PHYSICS_LAYER_PICKUP, PHYSICS_LAYER_PLAYER, PHYSICS_LAYER_WALL,
};

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn spawn_data_scene_entity(
        &mut self,
        x: f32,
        y: f32,
        texture_id: u32,
        sprite_width: f32,
        sprite_height: f32,
        frame_u0: f32,
        frame_v0: f32,
        frame_u1: f32,
        frame_v1: f32,
        animation_frame_count: u32,
        animation_fps: f32,
        layer: u32,
        collider_type: u32,
        collider_offset_x: f32,
        collider_offset_y: f32,
        collider_enabled: bool,
        collider_is_trigger: bool,
        collider_half_width: f32,
        collider_half_height: f32,
        collider_radius: f32,
        collider_start_x: f32,
        collider_start_y: f32,
        collider_end_x: f32,
        collider_end_y: f32,
        collider_rotation_radians: f32,
        collider_vertices: Vec<f32>,
    ) -> bool {
        if self.scene_mode != SceneMode::Data
            || !Self::valid_transform(x, y)
            || !Self::valid_positive(sprite_width)
            || !Self::valid_positive(sprite_height)
        {
            self.clear_data_scene_entity_handle();
            return false;
        }

        let Some(frame) = SpriteFrame::from_values(frame_u0, frame_v0, frame_u1, frame_v1) else {
            self.clear_data_scene_entity_handle();
            return false;
        };
        let Some(animation) =
            Self::data_scene_sprite_animation(animation_frame_count, animation_fps)
        else {
            self.clear_data_scene_entity_handle();
            return false;
        };
        let Some(collision_layer) = Self::data_scene_collision_layer_from_code(layer) else {
            self.clear_data_scene_entity_handle();
            return false;
        };
        let Some(collider_shape) = Self::data_scene_collider_shape(
            collider_type,
            collider_half_width,
            collider_half_height,
            collider_radius,
            collider_start_x,
            collider_start_y,
            collider_end_x,
            collider_end_y,
            collider_rotation_radians,
            &collider_vertices,
        ) else {
            self.clear_data_scene_entity_handle();
            return false;
        };
        if collider_shape.is_some()
            && (!Self::valid_transform(collider_offset_x, collider_offset_y)
                || !collider_rotation_radians.is_finite())
        {
            self.clear_data_scene_entity_handle();
            return false;
        }

        let mut template = EntityTemplate::new(sprite_width, sprite_height)
            .with_frame(sprite_width, sprite_height, frame)
            .with_sprite_animation(animation);
        if let Some(shape) = collider_shape {
            template = template.with_collider(EntityTemplateCollider {
                shape,
                half_width: collider_half_width,
                half_height: collider_half_height,
                offset_x: collider_offset_x,
                offset_y: collider_offset_y,
                enabled: collider_enabled,
                is_trigger: collider_is_trigger,
                material: None,
            });
        }

        let entity = self
            .world
            .spawn_prefab_entity_from_request(PrefabEntitySpawnRequest {
                transform: Transform2D { x, y },
                velocity: None,
                texture_id,
                template,
                layer: collision_layer,
                sprite_tint: PrefabSpriteTint::PLAYER,
                lifetime_seconds: None,
                projectile_policy: None,
                gameplay_faction: None,
                damage: None,
                health: None,
                score_reward: None,
                player_marker: false,
            });
        if collider_type == PHYSICS_COLLIDER_TYPE_NONE {
            self.world.clear_collider(entity);
        }
        self.data_scene_entity = Some(entity);
        true
    }

    pub fn data_scene_entity_id(&self) -> u32 {
        self.data_scene_entity_handle()
            .map(|entity| entity.id)
            .unwrap_or(u32::MAX)
    }

    pub fn data_scene_entity_generation(&self) -> u32 {
        self.data_scene_entity_handle()
            .map(|entity| entity.generation)
            .unwrap_or(0)
    }
}

impl Engine {
    pub(in crate::engine) fn clear_data_scene_entity_handle(&mut self) {
        self.data_scene_entity = None;
    }

    fn data_scene_entity_handle(&self) -> Option<Entity> {
        let entity = self.data_scene_entity?;
        self.world.is_current_entity(entity).then_some(entity)
    }

    fn data_scene_sprite_animation(
        frame_count: u32,
        frames_per_second: f32,
    ) -> Option<Option<SpriteAnimation>> {
        if frame_count <= 1 {
            return Some(None);
        }
        if !Self::valid_positive(frames_per_second) {
            return None;
        }
        SpriteAnimation::horizontal(frame_count, frames_per_second).map(Some)
    }

    const fn data_scene_collision_layer_from_code(code: u32) -> Option<CollisionLayer> {
        match code {
            PHYSICS_LAYER_PLAYER => Some(CollisionLayer::Player),
            PHYSICS_LAYER_ENEMY => Some(CollisionLayer::Enemy),
            PHYSICS_LAYER_BULLET => Some(CollisionLayer::Bullet),
            PHYSICS_LAYER_WALL => Some(CollisionLayer::Wall),
            PHYSICS_LAYER_PICKUP => Some(CollisionLayer::Pickup),
            _ => None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn data_scene_collider_shape(
        collider_type: u32,
        half_width: f32,
        half_height: f32,
        radius: f32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        rotation_radians: f32,
        vertex_values: &[f32],
    ) -> Option<Option<EntityTemplateColliderShape>> {
        match collider_type {
            PHYSICS_COLLIDER_TYPE_NONE => Some(None),
            PHYSICS_COLLIDER_TYPE_AABB => {
                if !Self::valid_positive(half_width) || !Self::valid_positive(half_height) {
                    return None;
                }
                Some(Some(EntityTemplateColliderShape::Aabb {
                    half_width,
                    half_height,
                }))
            }
            PHYSICS_COLLIDER_TYPE_CIRCLE => {
                if !Self::valid_positive(radius) {
                    return None;
                }
                Some(Some(EntityTemplateColliderShape::Circle { radius }))
            }
            PHYSICS_COLLIDER_TYPE_CAPSULE => {
                if !Self::valid_transform(start_x, start_y)
                    || !Self::valid_transform(end_x, end_y)
                    || !Self::valid_positive(radius)
                {
                    return None;
                }
                Some(Some(EntityTemplateColliderShape::Capsule {
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                    radius,
                }))
            }
            PHYSICS_COLLIDER_TYPE_ORIENTED_BOX => {
                if !Self::valid_positive(half_width)
                    || !Self::valid_positive(half_height)
                    || !rotation_radians.is_finite()
                {
                    return None;
                }
                Some(Some(EntityTemplateColliderShape::OrientedBox {
                    half_width,
                    half_height,
                    rotation_radians,
                }))
            }
            PHYSICS_COLLIDER_TYPE_CONVEX_POLYGON => {
                if !rotation_radians.is_finite() {
                    return None;
                }
                let (vertices, vertex_count) = Self::convex_polygon_vertices(vertex_values)?;
                Some(Some(EntityTemplateColliderShape::ConvexPolygon {
                    vertices,
                    vertex_count,
                    rotation_radians,
                }))
            }
            PHYSICS_COLLIDER_TYPE_EDGE => {
                if !Self::valid_edge(start_x, start_y, end_x, end_y) {
                    return None;
                }
                Some(Some(EntityTemplateColliderShape::Edge {
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                }))
            }
            _ => None,
        }
    }
}

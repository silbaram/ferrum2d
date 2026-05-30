use super::collision_cache::{build_collision_rects_for_layer, TileCollisionRect};
use super::*;
use crate::camera::Camera2D;
use crate::collision::AabbBounds;
use crate::components::{
    AabbCollider, CollisionLayer, HeightSpan, PhysicsFloorId, Transform2D, Velocity,
};
use crate::physics::{PhysicsCounters, SlopeConfig};
use crate::world::World;

mod collision_cache;
mod dynamic_resolution;
mod navigation;
mod obstacle_contacts;
mod obstacle_queries;
mod rendering;

fn test_collider(half_width: f32, half_height: f32) -> AabbCollider {
    AabbCollider {
        half_width,
        half_height,
        offset_x: 0.0,
        offset_y: 0.0,
        enabled: true,
        is_trigger: true,
        layer: CollisionLayer::Player,
    }
}

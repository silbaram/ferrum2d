use wasm_bindgen::prelude::*;

pub mod audio_event;
pub(crate) mod breakout_scene;
pub mod camera;
pub mod collision;
pub mod collision_event;
pub mod components;
pub mod engine;
pub mod entity;
pub mod game_state;
pub mod input;
pub mod physics;
pub(crate) mod platformer_scene;
pub mod render_command;
pub(crate) mod shooter_scene;
pub mod tilemap;
pub mod world;

pub use audio_event::AudioEvent;
pub use camera::{Camera2D, CameraPreset, CameraPresetConfig};
pub use collision::{
    AabbBounds, AabbContact, AabbQueryHit, CircleQueryHit, CollisionContact, CollisionPair,
    CollisionQueryShape, CollisionSystem, NearestBodyQueryHit, PhysicsDebugLine, PointQueryHit,
    RaycastHit, ShapeCastHit, ShapeQueryHit, SweptAabbContactHit, SweptAabbHit,
};
pub use collision_event::{
    CollisionEvent, CollisionEventCounts, CollisionEventTracker, COLLISION_EVENT_ENTER,
    COLLISION_EVENT_EXIT, COLLISION_EVENT_HIT, COLLISION_EVENT_STAY,
};
pub use components::{
    AabbCollider, CircleCollider, CollisionFilter, CollisionLayer, CollisionMask, Sprite,
    SpriteAnimation, SpriteAnimationKind, SpriteAnimationState, SpriteFrame, Transform2D, Velocity,
};
pub use engine::Engine;
pub use entity::Entity;
pub use game_state::GameState;
pub use input::InputState;
pub use physics::{
    FixedTimestep, FixedTimestepConfig, FixedTimestepUpdate, GroundProbeHit, KinematicMoveResult,
    MovingPlatformCarryConfig, OneWayPlatformConfig, PhysicsBounds, PhysicsCounters, PhysicsSystem,
    PlatformerControllerConfig, PlatformerControllerInput, PlatformerControllerResult,
    PlatformerControllerState,
};
pub use render_command::SpriteRenderCommand;
pub use tilemap::{TileDefinition, Tilemap, TilemapLayer, TilemapNearestObstacleHit};
pub use world::{EntityTemplate, World};

#[wasm_bindgen]
pub fn sprite_render_command_floats() -> usize {
    std::mem::size_of::<SpriteRenderCommand>() / std::mem::size_of::<f32>()
}

#[wasm_bindgen]
pub fn sprite_render_command_bytes() -> usize {
    std::mem::size_of::<SpriteRenderCommand>()
}

#[wasm_bindgen]
pub fn audio_event_floats() -> usize {
    std::mem::size_of::<AudioEvent>() / std::mem::size_of::<f32>()
}

#[wasm_bindgen]
pub fn audio_event_bytes() -> usize {
    std::mem::size_of::<AudioEvent>()
}

#[wasm_bindgen]
pub fn collision_event_u32s() -> usize {
    std::mem::size_of::<CollisionEvent>() / std::mem::size_of::<u32>()
}

#[wasm_bindgen]
pub fn collision_event_bytes() -> usize {
    std::mem::size_of::<CollisionEvent>()
}

#[wasm_bindgen]
pub fn physics_debug_line_floats() -> usize {
    std::mem::size_of::<PhysicsDebugLine>() / std::mem::size_of::<f32>()
}

#[wasm_bindgen]
pub fn physics_debug_line_bytes() -> usize {
    std::mem::size_of::<PhysicsDebugLine>()
}

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}

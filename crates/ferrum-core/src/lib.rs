use wasm_bindgen::prelude::*;

pub mod audio_event;
pub(crate) mod breakout_scene;
pub mod camera;
pub mod collision;
pub mod collision_event;
pub mod components;
pub mod effect_event;
pub mod engine;
pub mod entity;
pub mod game_state;
pub(crate) mod gameplay;
pub mod gameplay_event;
pub mod input;
pub mod particles;
pub mod physics;
pub(crate) mod platformer_scene;
pub mod render_command;
pub(crate) mod shooter_scene;
pub mod tilemap;
pub(crate) mod tweens;
pub mod world;

pub use audio_event::AudioEvent;
pub use camera::{Camera2D, CameraPreset, CameraPresetConfig};
pub use collision::{
    AabbBounds, AabbContact, AabbQueryHit, CircleQueryHit, CollisionContact, CollisionContactPoint,
    CollisionManifold, CollisionPair, CollisionQueryShape, CollisionSystem, NearestBodyQueryHit,
    PhysicsDebugLine, PointQueryHit, RaycastHit, ShapeCastHit, ShapeQueryHit, SweptAabbContactHit,
    SweptAabbHit, MAX_COLLISION_MANIFOLD_POINTS,
};
pub use collision_event::{
    CollisionEvent, CollisionEventCounts, CollisionEventTracker, CollisionPairCounts,
    COLLISION_EVENT_ENTER, COLLISION_EVENT_EXIT, COLLISION_EVENT_HIT, COLLISION_EVENT_STAY,
    COLLISION_EVENT_TRIGGER_ENTER, COLLISION_EVENT_TRIGGER_EXIT, COLLISION_EVENT_TRIGGER_STAY,
};
pub use components::{
    AabbCollider, AngularVelocity, CapsuleCollider, ChainCollider, CircleCollider, CollisionFilter,
    CollisionLayer, CollisionMask, ConvexPolygonCollider, DistanceJoint, DistanceJointId,
    GearJoint, GearJointId, HeightSpan, OrientedBoxCollider, PhysicsFloorId, PhysicsMaterial,
    PrismaticJoint, PrismaticJointId, PulleyJoint, PulleyJointId, RevoluteJoint, RevoluteJointId,
    RigidBody, RigidBodyCcdDebugHit, RigidBodyType, RigidContactImpulse, RopeJoint, RopeJointId,
    Rotation2D, SpringJoint, SpringJointId, Sprite, SpriteAnimation, SpriteAnimationFrameSequence,
    SpriteAnimationKind, SpriteAnimationState, SpriteFrame, Transform2D, Velocity, WeldJoint,
    WeldJointId, MAX_CHAIN_COLLIDER_VERTICES, MAX_CONVEX_POLYGON_VERTICES,
    MAX_SPRITE_ANIMATION_FRAMES,
};
pub use effect_event::EffectEvent;
pub use engine::{
    Engine, PhysicsBodyContactHit, PhysicsBodyManifoldHit, PhysicsQueryEntityHit,
    PhysicsRaycastBodyHit, PhysicsRigidContactImpulseHit, PhysicsTileContactHit,
    PhysicsTileManifoldHit, PhysicsTileShapeCastHit,
};
use engine::{FrameTelemetry, FRAME_TELEMETRY_F64S};
pub use entity::Entity;
pub use game_state::GameState;
pub use gameplay_event::{
    GameplayEvent, GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT, GAMEPLAY_ACTION_FAILURE_COOLING_DOWN,
    GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING, GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
    GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM, GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
    GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
    GAMEPLAY_EVENT_ACTION_FAILED, GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED,
    GAMEPLAY_EVENT_COLLISION_DAMAGE, GAMEPLAY_EVENT_COLLISION_DESPAWN,
    GAMEPLAY_EVENT_FLAG_CONSUMED_THIS_FRAME, GAMEPLAY_EVENT_FLAG_ONCE,
    GAMEPLAY_EVENT_FLAG_TARGET_REMOVED, GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED,
    GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED, GAMEPLAY_EVENT_INTERACTION,
    GAMEPLAY_EVENT_PICKUP_COLLECTED, GAMEPLAY_EVENT_PREFAB_SPAWNED,
    GAMEPLAY_EVENT_PRESENTATION_EFFECT, GAMEPLAY_EVENT_TILE_IMPACT,
    GAMEPLAY_EVENT_TILE_IMPACT_LAYER_MASK, GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT,
    GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_MASK, GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X,
    GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_Y, GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NONE,
    GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X, GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_Y,
    GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT, GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK,
    GAMEPLAY_EVENT_TIMER,
};
pub use input::InputState;
pub use particles::{Particle, ParticlePreset, ParticleRange, ParticleSystem};
pub use physics::{
    FixedTimestep, FixedTimestepConfig, FixedTimestepUpdate, GroundProbeHit,
    Hd2dKinematicControllerConfig, Hd2dKinematicMoveResult, KinematicMoveResult,
    MovingPlatformCarryConfig, OneWayPlatformConfig, PhysicsBounds, PhysicsCounters, PhysicsSystem,
    PlatformerControllerConfig, PlatformerControllerInput, PlatformerControllerResult,
    PlatformerControllerState, RigidBodyIslandStats, RigidBodyStepConfig, RigidBodyStepStats,
    SlopeConfig, SlopeSegment, SlopeSurfaceHit,
};
pub use render_command::SpriteRenderCommand;
pub use tilemap::{
    Hd2dBridgePortalDefinition, Hd2dRampAxis, Hd2dRampDefinition, Hd2dTileDefinition, Hd2dTileKind,
    TileDefinition, TileSlopeDefinition, Tilemap, TilemapContactHit, TilemapContactManifoldHit,
    TilemapContactPoint, TilemapHd2dSurfaceHit, TilemapLayer, TilemapNavigationPathPoint,
    TilemapNearestObstacleHit, TilemapShapeCastHit, MAX_TILEMAP_CONTACT_MANIFOLD_POINTS,
};
pub use world::{EntityTemplate, EntityTemplateCollider, EntityTemplateColliderShape, World};

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
pub fn gameplay_event_u32s() -> usize {
    std::mem::size_of::<GameplayEvent>() / std::mem::size_of::<u32>()
}

#[wasm_bindgen]
pub fn gameplay_event_bytes() -> usize {
    std::mem::size_of::<GameplayEvent>()
}

#[wasm_bindgen]
pub fn effect_event_bytes() -> usize {
    std::mem::size_of::<EffectEvent>()
}

#[wasm_bindgen]
pub fn frame_telemetry_f64s() -> usize {
    FRAME_TELEMETRY_F64S
}

#[wasm_bindgen]
pub fn frame_telemetry_bytes() -> usize {
    std::mem::size_of::<FrameTelemetry>()
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
pub fn physics_query_hit_u32s() -> usize {
    std::mem::size_of::<PhysicsQueryEntityHit>() / std::mem::size_of::<u32>()
}

#[wasm_bindgen]
pub fn physics_query_hit_bytes() -> usize {
    std::mem::size_of::<PhysicsQueryEntityHit>()
}

#[wasm_bindgen]
pub fn physics_raycast_hit_bytes() -> usize {
    std::mem::size_of::<PhysicsRaycastBodyHit>()
}

#[wasm_bindgen]
pub fn physics_tile_shape_cast_hit_bytes() -> usize {
    std::mem::size_of::<PhysicsTileShapeCastHit>()
}

#[wasm_bindgen]
pub fn physics_tile_contact_hit_bytes() -> usize {
    std::mem::size_of::<PhysicsTileContactHit>()
}

#[wasm_bindgen]
pub fn physics_tile_manifold_hit_bytes() -> usize {
    std::mem::size_of::<PhysicsTileManifoldHit>()
}

#[wasm_bindgen]
pub fn physics_body_contact_hit_bytes() -> usize {
    std::mem::size_of::<PhysicsBodyContactHit>()
}

#[wasm_bindgen]
pub fn physics_body_manifold_hit_bytes() -> usize {
    std::mem::size_of::<PhysicsBodyManifoldHit>()
}

#[wasm_bindgen]
pub fn physics_rigid_contact_impulse_hit_bytes() -> usize {
    std::mem::size_of::<PhysicsRigidContactImpulseHit>()
}

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}

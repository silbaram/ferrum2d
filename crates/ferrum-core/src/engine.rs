use wasm_bindgen::prelude::*;

use crate::camera::Camera2D;
use crate::collision::{
    AabbQueryHit, CircleQueryHit, CollisionContact, CollisionManifold, CollisionScratch,
    PointQueryHit, RaycastHit, ShapeCastHit, ShapeQueryHit, PHYSICS_DEBUG_DEFAULT,
};
use crate::collision_event::{CollisionEventCounts, CollisionEventTracker};
use crate::input::{InputActionRegistry, InputState};
use crate::particles::{ParticlePreset, ParticleSystem};
use crate::physics::{
    FixedTimestep, FixedTimestepUpdate, PhysicsCounters, RigidBodyStepConfig, RigidBodyStepScratch,
    RigidBodyStepStats,
};
use crate::shooter_scene::{
    SHOOTER_SNAPSHOT_ENTITY_FLOATS, SHOOTER_SNAPSHOT_ENTITY_U32S, SHOOTER_SNAPSHOT_HEADER_FLOATS,
    SHOOTER_SNAPSHOT_HEADER_U32S,
};
use crate::tilemap::{
    Tilemap, TilemapContactHit, TilemapContactManifoldHit, TilemapNavigationScratch,
    TilemapShapeCastHit,
};
use crate::tweens::TweenSystem;
use crate::world::World;

mod fixed_step;
mod frame_buffers;
mod gameplay_authoring;
mod input_actions;
mod particle_controls;
mod physics_abi;
mod physics_authoring;
mod physics_bridge;
mod physics_collider_controls;
mod physics_controls;
mod physics_joint_controls;
mod physics_queries;
mod rendering;
mod runtime;
mod scene_controls;
mod scenes;
mod shooter_authoring;
mod snapshots;
mod telemetry;
mod tilemap_api;
mod viewport_controls;
use fixed_step::FixedTimestepInputLatch;
use frame_buffers::EngineFrameBuffers;
use gameplay_authoring::GameplayAuthoringSnapshot;
use physics_abi::{
    PHYSICS_BODY_SNAPSHOT_FLAG_BODY_ENABLED, PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_ENABLED,
    PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_MATERIAL_OVERRIDE,
    PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_TRIGGER, PHYSICS_BODY_SNAPSHOT_FLAG_SLEEPING,
    PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY, PHYSICS_BODY_SNAPSHOT_HANDLE_U32S,
    PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY, PHYSICS_BODY_SNAPSHOT_U32_BODY_TYPE,
    PHYSICS_BODY_SNAPSHOT_U32_COLLIDER_TYPE, PHYSICS_BODY_SNAPSHOT_U32_ENTITY_GENERATION,
    PHYSICS_BODY_SNAPSHOT_U32_ENTITY_ID, PHYSICS_BODY_SNAPSHOT_U32_FLAGS,
    PHYSICS_BODY_TYPE_DYNAMIC, PHYSICS_BODY_TYPE_KINEMATIC, PHYSICS_BODY_TYPE_STATIC,
    PHYSICS_COLLIDER_TYPE_AABB, PHYSICS_COLLIDER_TYPE_CAPSULE, PHYSICS_COLLIDER_TYPE_CHAIN,
    PHYSICS_COLLIDER_TYPE_CIRCLE, PHYSICS_COLLIDER_TYPE_CONVEX_POLYGON, PHYSICS_COLLIDER_TYPE_EDGE,
    PHYSICS_COLLIDER_TYPE_NONE, PHYSICS_COLLIDER_TYPE_ORIENTED_BOX, PHYSICS_EDGE_BODY_RADIUS,
    PHYSICS_JOINT_DISTANCE, PHYSICS_JOINT_GEAR, PHYSICS_JOINT_PRISMATIC, PHYSICS_JOINT_PULLEY,
    PHYSICS_JOINT_REVOLUTE, PHYSICS_JOINT_ROPE, PHYSICS_JOINT_SPRING, PHYSICS_JOINT_WELD,
    PHYSICS_LAYER_BULLET, PHYSICS_LAYER_ENEMY, PHYSICS_LAYER_PICKUP, PHYSICS_LAYER_PLAYER,
    PHYSICS_LAYER_WALL,
};
use physics_bridge::{
    PhysicsBodyColliderSnapshot, PhysicsEntitySnapshot, PhysicsJointSnapshot, PhysicsQueryResult,
};
pub use physics_bridge::{
    PhysicsBodyContactHit, PhysicsBodyManifoldHit, PhysicsQueryEntityHit, PhysicsRaycastBodyHit,
    PhysicsRigidContactImpulseHit, PhysicsTileContactHit, PhysicsTileManifoldHit,
    PhysicsTileShapeCastHit,
};
use scenes::{BuiltInSceneSlots, DataSceneRuntime, SceneMode};
pub(crate) use telemetry::frame_stats::{FrameTelemetry, FRAME_TELEMETRY_F64S};

const DEFAULT_VIEWPORT_WIDTH: f32 = 800.0;
const DEFAULT_VIEWPORT_HEIGHT: f32 = 480.0;
const MAX_PARTICLE_PRESETS: usize = 256;
const TILEMAP_NAVIGATION_DEBUG_COLOR: [f32; 4] = [0.1, 0.75, 1.0, 1.0];
const TILEMAP_NAVIGATION_PATH_POINT_FLOATS: usize = 5;

#[wasm_bindgen]
pub struct Engine {
    elapsed_seconds: f64,
    input: InputState,
    input_actions: InputActionRegistry,
    previous_input_sample: InputState,
    fixed_timestep_input_latch: FixedTimestepInputLatch,
    scene_mode: SceneMode,
    scenes: BuiltInSceneSlots,
    data_scene: DataSceneRuntime,
    camera: Camera2D,
    world: World,
    gameplay_authoring_snapshot: Option<GameplayAuthoringSnapshot>,
    tilemap: Tilemap,
    particles: ParticleSystem,
    tweens: TweenSystem,
    particle_presets: Vec<Option<ParticlePreset>>,
    shooter_hit_particle_preset: Option<u32>,
    frame_buffers: EngineFrameBuffers,
    tilemap_navigation_scratch: TilemapNavigationScratch,
    physics_debug_collision_scratch: CollisionScratch,
    physics_debug_lines_enabled: bool,
    collision_lifecycle_events_enabled: bool,
    physics_debug_line_flags: u32,
    collision_event_tracker: CollisionEventTracker,
    collision_event_counts: CollisionEventCounts,
    physics_counters: PhysicsCounters,
    physics_query_result: PhysicsQueryResult,
    physics_query_hits: Vec<PhysicsQueryEntityHit>,
    physics_raycast_hits: Vec<PhysicsRaycastBodyHit>,
    physics_tile_shape_cast_hits: Vec<PhysicsTileShapeCastHit>,
    physics_tile_contact_hits: Vec<PhysicsTileContactHit>,
    physics_tile_manifold_hits: Vec<PhysicsTileManifoldHit>,
    physics_body_contact_hits: Vec<PhysicsBodyContactHit>,
    physics_body_manifold_hits: Vec<PhysicsBodyManifoldHit>,
    physics_rigid_contact_impulse_hits: Vec<PhysicsRigidContactImpulseHit>,
    physics_collision_query_scratch: CollisionScratch,
    physics_point_query_scratch: Vec<PointQueryHit>,
    physics_aabb_query_scratch: Vec<AabbQueryHit>,
    physics_circle_query_scratch: Vec<CircleQueryHit>,
    physics_shape_query_scratch: Vec<ShapeQueryHit>,
    physics_raycast_scratch: Vec<RaycastHit>,
    physics_shape_cast_scratch: Vec<ShapeCastHit>,
    physics_body_contact_scratch: Vec<CollisionContact>,
    physics_body_manifold_scratch: Vec<CollisionManifold>,
    physics_tile_shape_cast_scratch: Vec<TilemapShapeCastHit>,
    physics_tile_contact_scratch: Vec<TilemapContactHit>,
    physics_tile_manifold_scratch: Vec<TilemapContactManifoldHit>,
    physics_entity_snapshot: PhysicsEntitySnapshot,
    physics_body_collider_snapshot: PhysicsBodyColliderSnapshot,
    physics_joint_snapshot: PhysicsJointSnapshot,
    physics_body_snapshot_floats: Vec<f32>,
    physics_body_snapshot_u32s: Vec<u32>,
    shooter_snapshot_header_floats: Vec<f32>,
    shooter_snapshot_header_u32s: Vec<u32>,
    shooter_snapshot_entity_floats: Vec<f32>,
    shooter_snapshot_entity_u32s: Vec<u32>,
    rigid_body_step_stats: RigidBodyStepStats,
    rigid_body_frame_stats: RigidBodyFrameStats,
    rigid_body_step_scratch: RigidBodyStepScratch,
    hd2d_kinematic_elevation_delta: f32,
    hd2d_kinematic_flags: u32,
    hd2d_kinematic_hit_count: u32,
    auto_rigid_body_step_enabled: bool,
    auto_rigid_body_step_config: RigidBodyStepConfig,
    fixed_timestep: FixedTimestep,
    fixed_timestep_enabled: bool,
    last_fixed_update: FixedTimestepUpdate,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut engine = Self {
            elapsed_seconds: 0.0,
            input: InputState::default(),
            input_actions: InputActionRegistry::default(),
            previous_input_sample: InputState::default(),
            fixed_timestep_input_latch: FixedTimestepInputLatch::default(),
            scene_mode: SceneMode::BuiltIn,
            scenes: BuiltInSceneSlots::new(),
            data_scene: DataSceneRuntime::new(),
            camera: Camera2D::new(DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT),
            world: World::default(),
            gameplay_authoring_snapshot: None,
            tilemap: Tilemap::default(),
            particles: ParticleSystem::new(),
            tweens: TweenSystem::new(),
            particle_presets: Vec::new(),
            shooter_hit_particle_preset: None,
            frame_buffers: EngineFrameBuffers::new(),
            tilemap_navigation_scratch: TilemapNavigationScratch::default(),
            physics_debug_collision_scratch: CollisionScratch::default(),
            physics_debug_lines_enabled: false,
            collision_lifecycle_events_enabled: false,
            physics_debug_line_flags: PHYSICS_DEBUG_DEFAULT,
            collision_event_tracker: CollisionEventTracker::default(),
            collision_event_counts: CollisionEventCounts::default(),
            physics_counters: PhysicsCounters::default(),
            physics_query_result: PhysicsQueryResult::default(),
            physics_query_hits: Vec::with_capacity(32),
            physics_raycast_hits: Vec::with_capacity(16),
            physics_tile_shape_cast_hits: Vec::with_capacity(16),
            physics_tile_contact_hits: Vec::with_capacity(16),
            physics_tile_manifold_hits: Vec::with_capacity(16),
            physics_body_contact_hits: Vec::with_capacity(16),
            physics_body_manifold_hits: Vec::with_capacity(16),
            physics_rigid_contact_impulse_hits: Vec::with_capacity(16),
            physics_collision_query_scratch: CollisionScratch::default(),
            physics_point_query_scratch: Vec::with_capacity(16),
            physics_aabb_query_scratch: Vec::with_capacity(16),
            physics_circle_query_scratch: Vec::with_capacity(16),
            physics_shape_query_scratch: Vec::with_capacity(16),
            physics_raycast_scratch: Vec::with_capacity(16),
            physics_shape_cast_scratch: Vec::with_capacity(16),
            physics_body_contact_scratch: Vec::with_capacity(16),
            physics_body_manifold_scratch: Vec::with_capacity(16),
            physics_tile_shape_cast_scratch: Vec::with_capacity(16),
            physics_tile_contact_scratch: Vec::with_capacity(16),
            physics_tile_manifold_scratch: Vec::with_capacity(16),
            physics_entity_snapshot: PhysicsEntitySnapshot::default(),
            physics_body_collider_snapshot: PhysicsBodyColliderSnapshot::default(),
            physics_joint_snapshot: PhysicsJointSnapshot::default(),
            physics_body_snapshot_floats: Vec::with_capacity(PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY),
            physics_body_snapshot_u32s: Vec::with_capacity(PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY),
            shooter_snapshot_header_floats: Vec::with_capacity(SHOOTER_SNAPSHOT_HEADER_FLOATS),
            shooter_snapshot_header_u32s: Vec::with_capacity(SHOOTER_SNAPSHOT_HEADER_U32S),
            shooter_snapshot_entity_floats: Vec::with_capacity(SHOOTER_SNAPSHOT_ENTITY_FLOATS * 16),
            shooter_snapshot_entity_u32s: Vec::with_capacity(SHOOTER_SNAPSHOT_ENTITY_U32S * 16),
            rigid_body_step_stats: RigidBodyStepStats::default(),
            rigid_body_frame_stats: RigidBodyFrameStats::default(),
            rigid_body_step_scratch: RigidBodyStepScratch::default(),
            hd2d_kinematic_elevation_delta: 0.0,
            hd2d_kinematic_flags: 0,
            hd2d_kinematic_hit_count: 0,
            auto_rigid_body_step_enabled: false,
            auto_rigid_body_step_config: RigidBodyStepConfig::default(),
            fixed_timestep: FixedTimestep::default(),
            fixed_timestep_enabled: false,
            last_fixed_update: FixedTimestepUpdate::default(),
        };
        engine.reset_to_title();
        engine.write_frame_telemetry();
        engine
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct RigidBodyFrameStats {
    ccd_checks: u32,
    ccd_hits: u32,
    sleeping_bodies: u32,
    broken_joints: u32,
}

impl RigidBodyFrameStats {
    fn record_step(&mut self, stats: RigidBodyStepStats) {
        self.ccd_checks = self.ccd_checks.saturating_add(stats.ccd_checks);
        self.ccd_hits = self.ccd_hits.saturating_add(stats.ccd_hits);
        self.sleeping_bodies = self.sleeping_bodies.saturating_add(stats.sleeping_bodies);
        self.broken_joints = self.broken_joints.saturating_add(stats.broken_joints);
    }
}

impl Engine {
    pub(in crate::engine) fn clear_rigid_body_frame_stats(&mut self) {
        self.rigid_body_frame_stats = RigidBodyFrameStats::default();
    }

    pub(in crate::engine) fn record_rigid_body_step_stats(&mut self, stats: RigidBodyStepStats) {
        self.rigid_body_step_stats = stats;
        self.rigid_body_frame_stats.record_step(stats);
    }
}

#[cfg(test)]
mod tests;

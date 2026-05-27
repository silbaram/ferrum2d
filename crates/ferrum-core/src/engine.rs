use wasm_bindgen::prelude::*;

use crate::audio_event::AudioEvent;
use crate::breakout_scene::{
    breakout_brick_hit_particle_preset, BreakoutParticleBurstSink, BreakoutScene,
};
use crate::camera::{Camera2D, CameraPresetConfig};
use crate::collision::{
    AabbBounds, CollisionContact, CollisionManifold, CollisionQueryShape, CollisionSystem,
    PhysicsDebugLine, RaycastHit, ShapeCastHit, PHYSICS_DEBUG_DEFAULT,
};
use crate::collision_event::{CollisionEvent, CollisionEventCounts, CollisionEventTracker};
use crate::components::{
    AabbCollider, AngularVelocity, CapsuleCollider, ChainCollider, CircleCollider, CollisionFilter,
    CollisionLayer, CollisionMask, CompoundCollider, CompoundColliderShape, ConvexPolygonCollider,
    DistanceJoint, DistanceJointId, EdgeCollider, GearJoint, GearJointId, OrientedBoxCollider,
    PhysicsMaterial, PrismaticJoint, PrismaticJointId, PulleyJoint, PulleyJointId, RevoluteJoint,
    RevoluteJointId, RigidBody, RigidBodyType, RigidContactImpulse, RopeJoint, RopeJointId,
    Rotation2D, SpringJoint, SpringJointId, SpriteFrame, Transform2D, Velocity, WeldJoint,
    WeldJointId, MAX_CHAIN_COLLIDER_VERTICES, MAX_CONVEX_POLYGON_VERTICES,
};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::input::InputState;
use crate::particles::{ParticlePreset, ParticleRange, ParticleSystem};
use crate::physics::{
    FixedTimestep, FixedTimestepConfig, FixedTimestepUpdate, PhysicsCounters, PhysicsSystem,
    RigidBodyStepConfig, RigidBodyStepStats,
};
use crate::platformer_scene::{
    platformer_landing_dust_particle_preset, PlatformerParticleBurstSink, PlatformerScene,
};
use crate::render_command::{SpriteRenderCommand, SPRITE_EFFECT_NONE};
use crate::shooter_scene::{
    EnemyBehavior, EnemySpawnPattern, ParticleBurstSink, ShooterAudioPolicy, ShooterConfig,
    ShooterEntitySnapshot, ShooterScene, ShooterSceneSnapshot, ShooterWaveConfig, TweenSink,
    SHOOTER_SNAPSHOT_ENTITY_FLOATS, SHOOTER_SNAPSHOT_ENTITY_U32S, SHOOTER_SNAPSHOT_HEADER_FLOATS,
    SHOOTER_SNAPSHOT_HEADER_U32S,
};
use crate::tilemap::{
    Tilemap, TilemapContactHit, TilemapContactManifoldHit, TilemapNavigationScratch,
    TilemapShapeCastHit,
};
use crate::tweens::TweenSystem;
use crate::world::{EntityTemplateCollider, EntityTemplateColliderShape, World};

const DEFAULT_VIEWPORT_WIDTH: f32 = 800.0;
const DEFAULT_VIEWPORT_HEIGHT: f32 = 480.0;
const MAX_PARTICLE_PRESETS: usize = 256;
const TILEMAP_NAVIGATION_DEBUG_COLOR: [f32; 4] = [0.1, 0.75, 1.0, 1.0];
const PHYSICS_BODY_TYPE_STATIC: u32 = 0;
const PHYSICS_BODY_TYPE_KINEMATIC: u32 = 1;
const PHYSICS_BODY_TYPE_DYNAMIC: u32 = 2;
const PHYSICS_COLLIDER_TYPE_NONE: u32 = 0;
const PHYSICS_COLLIDER_TYPE_AABB: u32 = 1;
const PHYSICS_COLLIDER_TYPE_CIRCLE: u32 = 2;
const PHYSICS_COLLIDER_TYPE_CAPSULE: u32 = 3;
const PHYSICS_COLLIDER_TYPE_ORIENTED_BOX: u32 = 4;
const PHYSICS_COLLIDER_TYPE_CONVEX_POLYGON: u32 = 5;
const PHYSICS_COLLIDER_TYPE_EDGE: u32 = 6;
const PHYSICS_COLLIDER_TYPE_CHAIN: u32 = 7;
const PHYSICS_EDGE_BODY_RADIUS: f32 = 0.0001;
const PHYSICS_LAYER_PLAYER: u32 = 0;
const PHYSICS_LAYER_ENEMY: u32 = 1;
const PHYSICS_LAYER_BULLET: u32 = 2;
const PHYSICS_LAYER_WALL: u32 = 3;
const PHYSICS_JOINT_DISTANCE: u32 = 0;
const PHYSICS_JOINT_ROPE: u32 = 1;
const PHYSICS_JOINT_SPRING: u32 = 2;
const PHYSICS_JOINT_REVOLUTE: u32 = 3;
const PHYSICS_JOINT_PRISMATIC: u32 = 4;
const PHYSICS_JOINT_GEAR: u32 = 5;
const PHYSICS_JOINT_WELD: u32 = 6;
const PHYSICS_JOINT_PULLEY: u32 = 7;
const PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY: usize = 31;
const PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY: usize = 5;
const PHYSICS_BODY_SNAPSHOT_HANDLE_U32S: usize = 2;
const PHYSICS_BODY_SNAPSHOT_U32_ENTITY_ID: usize = 0;
const PHYSICS_BODY_SNAPSHOT_U32_ENTITY_GENERATION: usize = 1;
const PHYSICS_BODY_SNAPSHOT_U32_BODY_TYPE: usize = 2;
const PHYSICS_BODY_SNAPSHOT_U32_COLLIDER_TYPE: usize = 3;
const PHYSICS_BODY_SNAPSHOT_U32_FLAGS: usize = 4;
const PHYSICS_BODY_SNAPSHOT_FLAG_BODY_ENABLED: u32 = 1 << 0;
const PHYSICS_BODY_SNAPSHOT_FLAG_SLEEPING: u32 = 1 << 1;
const PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_ENABLED: u32 = 1 << 2;
const PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_TRIGGER: u32 = 1 << 3;
const PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_MATERIAL_OVERRIDE: u32 = 1 << 4;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum ActiveScene {
    #[default]
    Shooter,
    Breakout,
    Platformer,
}

#[derive(Clone, Copy, Debug, Default)]
struct FixedTimestepInputLatch {
    space: bool,
    enter: bool,
    mouse_left: bool,
}

impl FixedTimestepInputLatch {
    fn observe(&mut self, previous: InputState, current: InputState) {
        self.space |= current.space == 1 && previous.space == 0;
        self.enter |= current.enter == 1 && previous.enter == 0;
        self.mouse_left |= current.mouse_left == 1 && previous.mouse_left == 0;
    }

    fn apply_to(self, mut input: InputState) -> InputState {
        input.space = input.space.max(u8::from(self.space));
        input.enter = input.enter.max(u8::from(self.enter));
        input.mouse_left = input.mouse_left.max(u8::from(self.mouse_left));
        input
    }

    fn clear(&mut self) {
        *self = Self::default();
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct PhysicsQueryResult {
    entity_id: u32,
    entity_generation: u32,
    tile_layer_index: u32,
    tile_index: u32,
    point_x: f32,
    point_y: f32,
    distance: f32,
}

#[derive(Clone, Copy, Debug, Default)]
struct PhysicsEntitySnapshot {
    entity_id: u32,
    entity_generation: u32,
    x: f32,
    y: f32,
    velocity_x: f32,
    velocity_y: f32,
    rotation_radians: f32,
    angular_velocity_radians_per_second: f32,
    body_type: u32,
    body_enabled: bool,
    is_sleeping: bool,
    collider_type: u32,
    collider_enabled: bool,
    collider_is_trigger: bool,
    collider_offset_x: f32,
    collider_offset_y: f32,
    collider_material_override: bool,
    collider_restitution: f32,
    collider_friction: f32,
    collider_surface_velocity_x: f32,
    collider_surface_velocity_y: f32,
    collider_density: f32,
    collider_contact_baumgarte_bias_scale: f32,
    collider_max_contact_baumgarte_bias_velocity_scale: f32,
    collider_contact_position_correction_scale: f32,
    collider_contact_position_correction_slop_scale: f32,
    mass: f32,
    inverse_mass: f32,
    inertia: f32,
    inverse_inertia: f32,
    gravity_scale: f32,
    linear_damping: f32,
    angular_damping: f32,
    restitution: f32,
    friction: f32,
    surface_velocity_x: f32,
    surface_velocity_y: f32,
    density: f32,
    contact_baumgarte_bias_scale: f32,
    max_contact_baumgarte_bias_velocity_scale: f32,
    contact_position_correction_scale: f32,
    contact_position_correction_slop_scale: f32,
}

#[derive(Clone, Copy, Debug, Default)]
struct PhysicsBodyColliderSnapshot {
    collider_index: u32,
    collider_type: u32,
    collider_enabled: bool,
    collider_is_trigger: bool,
    collider_offset_x: f32,
    collider_offset_y: f32,
    collider_material_override: bool,
    collider_restitution: f32,
    collider_friction: f32,
    collider_surface_velocity_x: f32,
    collider_surface_velocity_y: f32,
    collider_density: f32,
    collider_contact_baumgarte_bias_scale: f32,
    collider_max_contact_baumgarte_bias_velocity_scale: f32,
    collider_contact_position_correction_scale: f32,
    collider_contact_position_correction_slop_scale: f32,
    collider_category_bits: u32,
    collider_mask_bits: u32,
}

#[derive(Clone, Copy, Debug, Default)]
struct PhysicsJointSnapshot {
    joint_type: u32,
    joint_index: u32,
    joint_generation: u32,
    entity_a_id: u32,
    entity_a_generation: u32,
    entity_b_id: u32,
    entity_b_generation: u32,
    rest_length: f32,
    max_length: f32,
    ratio: f32,
    reference_angle: f32,
    break_distance: f32,
    break_angle: f32,
    stiffness: f32,
    damping: f32,
    angular_stiffness: f32,
    angular_damping: f32,
    local_anchor_a_x: f32,
    local_anchor_a_y: f32,
    local_anchor_b_x: f32,
    local_anchor_b_y: f32,
    local_axis_a_x: f32,
    local_axis_a_y: f32,
    ground_anchor_a_x: f32,
    ground_anchor_a_y: f32,
    ground_anchor_b_x: f32,
    ground_anchor_b_y: f32,
    limit_enabled: bool,
    lower_angle: f32,
    upper_angle: f32,
    lower_translation: f32,
    upper_translation: f32,
    motor_enabled: bool,
    motor_speed: f32,
    max_motor_force: f32,
    max_motor_torque: f32,
    enabled: bool,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PhysicsQueryEntityHit {
    pub entity_id: u32,
    pub entity_generation: u32,
}

impl PhysicsQueryEntityHit {
    fn from_entity(entity: Entity) -> Self {
        Self {
            entity_id: entity.id,
            entity_generation: entity.generation,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsRaycastBodyHit {
    pub entity_id: u32,
    pub entity_generation: u32,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

impl PhysicsRaycastBodyHit {
    fn from_raycast_hit(hit: RaycastHit) -> Self {
        Self {
            entity_id: hit.entity.id,
            entity_generation: hit.entity.generation,
            distance: hit.distance,
            point_x: hit.point_x,
            point_y: hit.point_y,
            normal_x: hit.normal_x,
            normal_y: hit.normal_y,
        }
    }

    fn from_shape_cast_hit(hit: ShapeCastHit) -> Self {
        Self {
            entity_id: hit.entity.id,
            entity_generation: hit.entity.generation,
            distance: hit.distance,
            point_x: hit.point_x,
            point_y: hit.point_y,
            normal_x: hit.normal_x,
            normal_y: hit.normal_y,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsTileShapeCastHit {
    pub tile_layer_index: u32,
    pub tile_index: u32,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

impl PhysicsTileShapeCastHit {
    fn from_tilemap_shape_cast_hit(hit: TilemapShapeCastHit) -> Self {
        Self {
            tile_layer_index: u32::try_from(hit.layer_index).unwrap_or(u32::MAX),
            tile_index: u32::try_from(hit.tile_index).unwrap_or(u32::MAX),
            distance: hit.distance,
            point_x: hit.point_x,
            point_y: hit.point_y,
            normal_x: hit.normal_x,
            normal_y: hit.normal_y,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsTileContactHit {
    pub tile_layer_index: u32,
    pub tile_index: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point_x: f32,
    pub point_y: f32,
}

impl PhysicsTileContactHit {
    fn from_tilemap_contact_hit(hit: TilemapContactHit) -> Self {
        Self {
            tile_layer_index: u32::try_from(hit.layer_index).unwrap_or(u32::MAX),
            tile_index: u32::try_from(hit.tile_index).unwrap_or(u32::MAX),
            normal_x: hit.normal_x,
            normal_y: hit.normal_y,
            penetration: hit.penetration,
            point_x: hit.point_x,
            point_y: hit.point_y,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsTileManifoldHit {
    pub tile_layer_index: u32,
    pub tile_index: u32,
    pub point_count: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point0_x: f32,
    pub point0_y: f32,
    pub point0_penetration: f32,
    pub point1_x: f32,
    pub point1_y: f32,
    pub point1_penetration: f32,
}

impl PhysicsTileManifoldHit {
    fn from_tilemap_contact_manifold_hit(hit: TilemapContactManifoldHit) -> Self {
        Self {
            tile_layer_index: u32::try_from(hit.layer_index).unwrap_or(u32::MAX),
            tile_index: u32::try_from(hit.tile_index).unwrap_or(u32::MAX),
            point_count: hit.point_count,
            normal_x: hit.normal_x,
            normal_y: hit.normal_y,
            penetration: hit.penetration,
            point0_x: hit.points[0].point_x,
            point0_y: hit.points[0].point_y,
            point0_penetration: hit.points[0].penetration,
            point1_x: hit.points[1].point_x,
            point1_y: hit.points[1].point_y,
            point1_penetration: hit.points[1].penetration,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsBodyContactHit {
    pub a_entity_id: u32,
    pub a_entity_generation: u32,
    pub b_entity_id: u32,
    pub b_entity_generation: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point_x: f32,
    pub point_y: f32,
}

impl PhysicsBodyContactHit {
    fn from_collision_contact(contact: CollisionContact) -> Self {
        Self {
            a_entity_id: contact.pair.a.id,
            a_entity_generation: contact.pair.a.generation,
            b_entity_id: contact.pair.b.id,
            b_entity_generation: contact.pair.b.generation,
            normal_x: contact.normal_x,
            normal_y: contact.normal_y,
            penetration: contact.penetration,
            point_x: contact.point_x,
            point_y: contact.point_y,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsBodyManifoldHit {
    pub a_entity_id: u32,
    pub a_entity_generation: u32,
    pub b_entity_id: u32,
    pub b_entity_generation: u32,
    pub point_count: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point0_x: f32,
    pub point0_y: f32,
    pub point0_penetration: f32,
    pub point1_x: f32,
    pub point1_y: f32,
    pub point1_penetration: f32,
}

impl PhysicsBodyManifoldHit {
    fn from_collision_manifold(manifold: CollisionManifold) -> Self {
        Self {
            a_entity_id: manifold.pair.a.id,
            a_entity_generation: manifold.pair.a.generation,
            b_entity_id: manifold.pair.b.id,
            b_entity_generation: manifold.pair.b.generation,
            point_count: manifold.point_count,
            normal_x: manifold.normal_x,
            normal_y: manifold.normal_y,
            penetration: manifold.penetration,
            point0_x: manifold.points[0].point_x,
            point0_y: manifold.points[0].point_y,
            point0_penetration: manifold.points[0].penetration,
            point1_x: manifold.points[1].point_x,
            point1_y: manifold.points[1].point_y,
            point1_penetration: manifold.points[1].penetration,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsRigidContactImpulseHit {
    pub a_entity_id: u32,
    pub a_entity_generation: u32,
    pub b_entity_id: u32,
    pub b_entity_generation: u32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub normal_impulse: f32,
    pub tangent_impulse: f32,
}

impl PhysicsRigidContactImpulseHit {
    fn from_rigid_contact_impulse(impulse: RigidContactImpulse) -> Self {
        Self {
            a_entity_id: impulse.entity_a.id,
            a_entity_generation: impulse.entity_a.generation,
            b_entity_id: impulse.entity_b.id,
            b_entity_generation: impulse.entity_b.generation,
            point_x: impulse.point_x,
            point_y: impulse.point_y,
            normal_x: impulse.normal_x,
            normal_y: impulse.normal_y,
            normal_impulse: impulse.normal_impulse,
            tangent_impulse: impulse.tangent_impulse,
        }
    }
}

#[wasm_bindgen]
pub struct Engine {
    elapsed_seconds: f64,
    input: InputState,
    previous_input_sample: InputState,
    fixed_timestep_input_latch: FixedTimestepInputLatch,
    scene: ShooterScene,
    breakout_scene: BreakoutScene,
    platformer_scene: PlatformerScene,
    active_scene: ActiveScene,
    camera: Camera2D,
    world: World,
    tilemap: Tilemap,
    particles: ParticleSystem,
    tweens: TweenSystem,
    particle_presets: Vec<Option<ParticlePreset>>,
    shooter_hit_particle_preset: Option<u32>,
    render_commands: Vec<SpriteRenderCommand>,
    audio_events: Vec<AudioEvent>,
    collision_events: Vec<CollisionEvent>,
    physics_debug_lines: Vec<PhysicsDebugLine>,
    tilemap_navigation_path_points: Vec<f32>,
    tilemap_navigation_debug_lines: Vec<PhysicsDebugLine>,
    tilemap_navigation_scratch: TilemapNavigationScratch,
    physics_debug_lines_enabled: bool,
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
            previous_input_sample: InputState::default(),
            fixed_timestep_input_latch: FixedTimestepInputLatch::default(),
            scene: ShooterScene::new(),
            breakout_scene: BreakoutScene::new(),
            platformer_scene: PlatformerScene::new(),
            active_scene: ActiveScene::Shooter,
            camera: Camera2D::new(DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT),
            world: World::default(),
            tilemap: Tilemap::default(),
            particles: ParticleSystem::new(),
            tweens: TweenSystem::new(),
            particle_presets: Vec::new(),
            shooter_hit_particle_preset: None,
            render_commands: Vec::with_capacity(256),
            audio_events: Vec::with_capacity(16),
            collision_events: Vec::with_capacity(128),
            physics_debug_lines: Vec::with_capacity(64),
            tilemap_navigation_path_points: Vec::with_capacity(32),
            tilemap_navigation_debug_lines: Vec::with_capacity(16),
            tilemap_navigation_scratch: TilemapNavigationScratch::default(),
            physics_debug_lines_enabled: false,
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
            auto_rigid_body_step_enabled: false,
            auto_rigid_body_step_config: RigidBodyStepConfig::default(),
            fixed_timestep: FixedTimestep::default(),
            fixed_timestep_enabled: false,
            last_fixed_update: FixedTimestepUpdate::default(),
        };
        engine.reset_to_title();
        engine
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_input(
        &mut self,
        w: bool,
        a: bool,
        s: bool,
        d: bool,
        space: bool,
        enter: bool,
        mouse_left: bool,
        mouse_x: f32,
        mouse_y: f32,
    ) {
        let input = InputState {
            w: u8::from(w),
            a: u8::from(a),
            s: u8::from(s),
            d: u8::from(d),
            space: u8::from(space),
            enter: u8::from(enter),
            mouse_left: u8::from(mouse_left),
            mouse_x,
            mouse_y,
        };
        self.observe_input_sample(input);
        self.input = input;
    }

    pub fn set_texture_ids(&mut self, player: u32, enemy: u32, bullet: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene
            .set_texture_ids(&mut self.world, player, enemy, bullet);
    }

    pub fn set_sound_ids(&mut self, shoot: u32, hit: u32, game_over: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_sound_ids(shoot, hit, game_over);
    }

    pub fn use_breakout_scene(&mut self) {
        self.active_scene = ActiveScene::Breakout;
        self.tilemap.clear();
        self.particles.clear();
        self.tweens.clear();
        self.breakout_scene
            .reset_to_title(&mut self.world, &mut self.camera);
        self.clear_physics_history();
    }

    pub fn use_platformer_scene(&mut self) {
        self.active_scene = ActiveScene::Platformer;
        self.tilemap.clear();
        self.particles.clear();
        self.tweens.clear();
        self.platformer_scene
            .reset_to_title(&mut self.world, &mut self.camera);
        self.clear_physics_history();
    }

    pub fn clear_shooter_tilemap(&mut self) {
        self.active_scene = ActiveScene::Shooter;
        self.tilemap.clear();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_tile(
        &mut self,
        tile_id: u32,
        texture_id: u32,
        u0: f32,
        v0: f32,
        u1: f32,
        v1: f32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.tilemap
            .set_tile_definition(tile_id, texture_id, u0, v0, u1, v1, r, g, b, a);
    }

    pub fn set_shooter_tile_slope(
        &mut self,
        tile_id: u32,
        local_x0: f32,
        local_y0: f32,
        local_x1: f32,
        local_y1: f32,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.tilemap
            .set_tile_slope_definition(tile_id, local_x0, local_y0, local_x1, local_y1);
    }

    pub fn set_shooter_tile_one_way_platform(&mut self, tile_id: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.tilemap.set_tile_one_way_platform(tile_id);
    }

    pub fn clear_shooter_tile_one_way_platform(&mut self, tile_id: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.tilemap.clear_tile_one_way_platform(tile_id);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_tilemap_layer(
        &mut self,
        index: u32,
        columns: u32,
        rows: u32,
        tile_width: f32,
        tile_height: f32,
        origin_x: f32,
        origin_y: f32,
        collision: bool,
        tiles: Vec<u32>,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.tilemap.set_layer(
            index,
            columns,
            rows,
            tile_width,
            tile_height,
            origin_x,
            origin_y,
            collision,
            tiles,
        );
    }

    pub fn set_shooter_tilemap_tile(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        tile_id: u32,
    ) -> bool {
        self.active_scene = ActiveScene::Shooter;
        self.tilemap.set_tile(layer_index, column, row, tile_id)
    }

    pub fn set_shooter_tilemap_tiles_rect(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        width: u32,
        height: u32,
        tile_id: u32,
    ) -> bool {
        self.active_scene = ActiveScene::Shooter;
        self.tilemap
            .set_tiles_rect(layer_index, column, row, width, height, tile_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_tilemap_tiles_rect_with_rebuild_budget(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        width: u32,
        height: u32,
        tile_id: u32,
        max_rebuilt_chunks: u32,
    ) -> bool {
        self.active_scene = ActiveScene::Shooter;
        self.tilemap.set_tiles_rect_with_rebuild_budget(
            layer_index,
            column,
            row,
            width,
            height,
            tile_id,
            max_rebuilt_chunks,
        )
    }

    pub fn set_shooter_tilemap_navigation_cost(
        &mut self,
        layer_index: u32,
        column: u32,
        row: u32,
        cost: u32,
    ) -> bool {
        self.active_scene = ActiveScene::Shooter;
        self.tilemap
            .set_navigation_cost(layer_index, column, row, cost)
    }

    pub fn query_tilemap_navigation_waypoint(
        &mut self,
        from_x: f32,
        from_y: f32,
        to_x: f32,
        to_y: f32,
    ) -> bool {
        let Some(waypoint) = self.tilemap.navigation_waypoint_with_scratch(
            Transform2D {
                x: from_x,
                y: from_y,
            },
            Transform2D { x: to_x, y: to_y },
            &mut self.tilemap_navigation_scratch,
        ) else {
            self.physics_query_result = PhysicsQueryResult::default();
            return false;
        };

        self.physics_query_result = PhysicsQueryResult {
            entity_id: 0,
            entity_generation: 0,
            tile_layer_index: 0,
            tile_index: 0,
            point_x: waypoint.x,
            point_y: waypoint.y,
            distance: ((waypoint.x - from_x).powi(2) + (waypoint.y - from_y).powi(2)).sqrt(),
        };
        true
    }

    pub fn query_tilemap_navigation_path(
        &mut self,
        from_x: f32,
        from_y: f32,
        to_x: f32,
        to_y: f32,
    ) -> bool {
        let from = Transform2D {
            x: from_x,
            y: from_y,
        };
        let Some(path) = self.tilemap.navigation_path_with_scratch(
            from,
            Transform2D { x: to_x, y: to_y },
            &mut self.tilemap_navigation_scratch,
        ) else {
            self.physics_query_result = PhysicsQueryResult::default();
            self.tilemap_navigation_path_points.clear();
            self.tilemap_navigation_debug_lines.clear();
            return false;
        };

        let (first, distance) = Self::store_tilemap_navigation_path(
            &mut self.tilemap_navigation_path_points,
            &mut self.tilemap_navigation_debug_lines,
            from,
            path,
        );
        self.physics_query_result = PhysicsQueryResult {
            entity_id: 0,
            entity_generation: 0,
            tile_layer_index: 0,
            tile_index: 0,
            point_x: first.x,
            point_y: first.y,
            distance,
        };
        true
    }

    pub fn clear_shooter_waves(&mut self) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.clear_wave_configs();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_wave(
        &mut self,
        index: u32,
        duration: f32,
        spawn_interval: f32,
        enemy_count: u32,
        enemy_speed: f32,
        enemy_behavior: u32,
        enemy_spawn_pattern: u32,
        enemy_health: f32,
        score_reward: u32,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_wave_config(
            index,
            ShooterWaveConfig::from_values(
                duration,
                spawn_interval,
                enemy_count,
                enemy_speed,
                EnemyBehavior::from_code(enemy_behavior),
                EnemySpawnPattern::from_code(enemy_spawn_pattern),
                enemy_health,
                score_reward,
            ),
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_audio_policy(
        &mut self,
        shoot_volume: f32,
        shoot_pitch: f32,
        hit_volume: f32,
        hit_pitch: f32,
        game_over_volume: f32,
        game_over_pitch: f32,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_audio_policy(ShooterAudioPolicy::from_values(
            shoot_volume,
            shoot_pitch,
            hit_volume,
            hit_pitch,
            game_over_volume,
            game_over_pitch,
        ));
    }

    pub fn set_viewport_size(&mut self, width: f32, height: f32) {
        self.camera.set_viewport_size(width, height);
        match self.active_scene {
            ActiveScene::Shooter => self
                .scene
                .update_camera_follow(&self.world, &mut self.camera),
            ActiveScene::Breakout => self.breakout_scene.update_camera(&mut self.camera),
            ActiveScene::Platformer => self
                .platformer_scene
                .update_camera(&self.world, &mut self.camera),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_config(
        &mut self,
        world_width: f32,
        world_height: f32,
        player_speed: f32,
        enemy_speed: f32,
        enemy_spawn_interval: f32,
        bullet_speed: f32,
        fire_cooldown: f32,
        bullet_lifetime: f32,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_config(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            ShooterConfig::from_values(
                world_width,
                world_height,
                player_speed,
                enemy_speed,
                enemy_spawn_interval,
                bullet_speed,
                fire_cooldown,
                bullet_lifetime,
            ),
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_prefabs(
        &mut self,
        player_width: f32,
        player_height: f32,
        enemy_width: f32,
        enemy_height: f32,
        bullet_width: f32,
        bullet_height: f32,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_prefabs(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            player_width,
            player_height,
            enemy_width,
            enemy_height,
            bullet_width,
            bullet_height,
        );
        self.clear_physics_history();
    }

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

    pub fn set_shooter_behavior(&mut self, enemy_behavior: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_enemy_behavior(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            EnemyBehavior::from_code(enemy_behavior),
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_spawn_pattern(&mut self, enemy_spawn_pattern: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_enemy_spawn_pattern(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            EnemySpawnPattern::from_code(enemy_spawn_pattern),
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_combat(&mut self, enemy_health: f32, bullet_damage: f32, score_reward: u32) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_combat(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            enemy_health,
            bullet_damage,
            score_reward,
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_camera_preset(
        &mut self,
        preset: u32,
        dead_zone_width: f32,
        dead_zone_height: f32,
        look_ahead_distance: f32,
        shake_amplitude: f32,
        shake_frequency: f32,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_camera_preset(
            &self.world,
            &mut self.camera,
            CameraPresetConfig::from_values(
                preset,
                dead_zone_width,
                dead_zone_height,
                look_ahead_distance,
                shake_amplitude,
                shake_frequency,
            ),
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_atlas_frame(
        &mut self,
        prefab: u32,
        texture_id: u32,
        width: f32,
        height: f32,
        u0: f32,
        v0: f32,
        u1: f32,
        v1: f32,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_atlas_frame(
            &mut self.world,
            prefab,
            texture_id,
            width,
            height,
            u0,
            v0,
            u1,
            v1,
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_atlas_animation(
        &mut self,
        prefab: u32,
        texture_id: u32,
        width: f32,
        height: f32,
        idle_fps: f32,
        idle_frames: Vec<f32>,
        move_fps: f32,
        move_frames: Vec<f32>,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_atlas_animation(
            &mut self.world,
            prefab,
            texture_id,
            width,
            height,
            idle_fps,
            &idle_frames,
            move_fps,
            &move_frames,
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_animations(
        &mut self,
        player_columns: u32,
        player_rows: u32,
        player_idle_row: u32,
        player_idle_frames: u32,
        player_idle_fps: f32,
        player_move_row: u32,
        player_move_frames: u32,
        player_move_fps: f32,
        enemy_columns: u32,
        enemy_rows: u32,
        enemy_idle_row: u32,
        enemy_idle_frames: u32,
        enemy_idle_fps: f32,
        enemy_move_row: u32,
        enemy_move_frames: u32,
        enemy_move_fps: f32,
        bullet_columns: u32,
        bullet_rows: u32,
        bullet_idle_row: u32,
        bullet_idle_frames: u32,
        bullet_idle_fps: f32,
        bullet_move_row: u32,
        bullet_move_frames: u32,
        bullet_move_fps: f32,
    ) {
        self.active_scene = ActiveScene::Shooter;
        self.scene.set_animation_states(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            player_columns,
            player_rows,
            player_idle_row,
            player_idle_frames,
            player_idle_fps,
            player_move_row,
            player_move_frames,
            player_move_fps,
            enemy_columns,
            enemy_rows,
            enemy_idle_row,
            enemy_idle_frames,
            enemy_idle_fps,
            enemy_move_row,
            enemy_move_frames,
            enemy_move_fps,
            bullet_columns,
            bullet_rows,
            bullet_idle_row,
            bullet_idle_frames,
            bullet_idle_fps,
            bullet_move_row,
            bullet_move_frames,
            bullet_move_fps,
        );
        self.clear_physics_history();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_resolved_config(
        &mut self,
        world_width: f32,
        world_height: f32,
        player_speed: f32,
        enemy_speed: f32,
        enemy_spawn_interval: f32,
        bullet_speed: f32,
        fire_cooldown: f32,
        bullet_lifetime: f32,
        player_width: f32,
        player_height: f32,
        enemy_width: f32,
        enemy_height: f32,
        bullet_width: f32,
        bullet_height: f32,
        player_animation_frame_count: u32,
        player_animation_fps: f32,
        enemy_animation_frame_count: u32,
        enemy_animation_fps: f32,
        bullet_animation_frame_count: u32,
        bullet_animation_fps: f32,
        enemy_behavior: u32,
        enemy_spawn_pattern: u32,
        enemy_health: f32,
        bullet_damage: f32,
        score_reward: u32,
        orbit_radius: f32,
        orbit_radial_band: f32,
    ) {
        self.active_scene = ActiveScene::Shooter;
        let config = ShooterConfig::from_values(
            world_width,
            world_height,
            player_speed,
            enemy_speed,
            enemy_spawn_interval,
            bullet_speed,
            fire_cooldown,
            bullet_lifetime,
        )
        .with_prefabs(
            player_width,
            player_height,
            enemy_width,
            enemy_height,
            bullet_width,
            bullet_height,
        )
        .with_animations(
            player_animation_frame_count,
            player_animation_fps,
            enemy_animation_frame_count,
            enemy_animation_fps,
            bullet_animation_frame_count,
            bullet_animation_fps,
        )
        .with_enemy_behavior(EnemyBehavior::from_code(enemy_behavior))
        .with_enemy_spawn_pattern(EnemySpawnPattern::from_code(enemy_spawn_pattern))
        .with_combat(enemy_health, bullet_damage, score_reward)
        .with_orbit(orbit_radius, orbit_radial_band);

        self.scene.set_config(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            config,
        );
        self.clear_physics_history();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_particle_preset(
        &mut self,
        preset_id: u32,
        texture_id: u32,
        u0: f32,
        v0: f32,
        u1: f32,
        v1: f32,
        burst_count: u32,
        lifetime_min: f32,
        lifetime_max: f32,
        speed_min: f32,
        speed_max: f32,
        start_size_min: f32,
        start_size_max: f32,
        end_size_min: f32,
        end_size_max: f32,
        start_r: f32,
        start_g: f32,
        start_b: f32,
        start_a: f32,
        end_r: f32,
        end_g: f32,
        end_b: f32,
        end_a: f32,
        acceleration_x: f32,
        acceleration_y: f32,
        damping: f32,
    ) {
        let preset_index = preset_id as usize;
        if preset_index >= MAX_PARTICLE_PRESETS {
            return;
        }
        let Some(frame) = SpriteFrame::from_values(u0, v0, u1, v1) else {
            return;
        };

        if preset_index >= self.particle_presets.len() {
            self.particle_presets.resize(preset_index + 1, None);
        }
        self.particle_presets[preset_index] = Some(ParticlePreset {
            texture_id,
            frame,
            burst_count,
            lifetime_seconds: ParticleRange::new(lifetime_min, lifetime_max),
            speed: ParticleRange::new(speed_min, speed_max),
            start_size: ParticleRange::new(start_size_min, start_size_max),
            end_size: ParticleRange::new(end_size_min, end_size_max),
            start_color: [start_r, start_g, start_b, start_a],
            end_color: [end_r, end_g, end_b, end_a],
            acceleration_x,
            acceleration_y,
            damping,
        });
    }

    pub fn clear_particle_presets(&mut self) {
        self.particle_presets.clear();
        self.shooter_hit_particle_preset = None;
    }

    pub fn set_shooter_hit_particle_preset(&mut self, preset_id: u32) {
        if preset_id as usize >= MAX_PARTICLE_PRESETS {
            return;
        }
        self.shooter_hit_particle_preset = Some(preset_id);
    }

    pub fn clear_shooter_hit_particle_preset(&mut self) {
        self.shooter_hit_particle_preset = None;
    }

    pub fn set_particle_seed(&mut self, seed: u32) {
        self.particles.set_seed(seed);
    }

    pub fn spawn_particle_burst(&mut self, preset_id: u32, x: f32, y: f32) -> usize {
        let Some(Some(preset)) = self.particle_presets.get(preset_id as usize) else {
            return 0;
        };
        self.particles.spawn_burst(*preset, x, y)
    }

    pub fn clear_particles(&mut self) {
        self.particles.clear();
    }

    pub fn particle_count(&self) -> usize {
        self.particles.particle_count()
    }

    pub fn particle_capacity(&self) -> usize {
        self.particles.capacity()
    }

    pub fn update(&mut self, delta: f64) {
        self.elapsed_seconds += delta;
        self.clear_physics_frame();
        if self.fixed_timestep_enabled {
            let update = self.fixed_timestep.advance(delta as f32);
            self.last_fixed_update = update;
            self.physics_counters.record_fixed_update(update);
            let step_seconds = self.fixed_timestep.config().step_seconds;
            for step_index in 0..update.steps {
                let input = self.fixed_step_input(step_index == 0);
                self.tweens.update(&mut self.world, step_seconds);
                self.update_scene(step_seconds, input);
                self.step_auto_rigid_bodies(step_seconds);
                if step_index == 0 {
                    self.fixed_timestep_input_latch.clear();
                }
                self.record_collision_events();
            }
        } else {
            self.last_fixed_update = FixedTimestepUpdate::default();
            self.tweens.update(&mut self.world, delta as f32);
            self.update_scene(delta as f32, self.input);
            self.step_auto_rigid_bodies(delta as f32);
            self.record_collision_events();
        }
        self.particles.update(delta as f32);
        self.build_physics_debug_lines();
        self.build_render_commands();
    }

    pub fn set_physics_debug_lines_enabled(&mut self, enabled: bool) {
        self.physics_debug_lines_enabled = enabled;
        if !enabled {
            self.physics_debug_lines.clear();
        }
    }

    pub fn set_physics_debug_line_flags(&mut self, flags: u32) {
        self.physics_debug_line_flags = flags;
        if flags == 0 {
            self.physics_debug_lines.clear();
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_aabb_body(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y)
            || !Self::valid_positive(half_width)
            || !Self::valid_positive(half_height)
        {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some(body) = Self::rigid_body_for_aabb(
            body_type,
            mass_or_density,
            use_density,
            half_width,
            half_height,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_aabb_collider(
            entity,
            AabbCollider::new(
                half_width,
                half_height,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_circle_body(
        &mut self,
        x: f32,
        y: f32,
        radius: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y) || !Self::valid_positive(radius) {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some(body) = Self::rigid_body_for_circle(
            body_type,
            mass_or_density,
            use_density,
            radius,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_circle_collider(
            entity,
            CircleCollider::new(radius, is_trigger, Self::collision_layer_from_code(layer))
                .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_capsule_body(
        &mut self,
        x: f32,
        y: f32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y)
            || !Self::valid_transform(start_x, start_y)
            || !Self::valid_transform(end_x, end_y)
            || !Self::valid_positive(radius)
        {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some(body) = Self::rigid_body_for_capsule(
            body_type,
            mass_or_density,
            use_density,
            start_x,
            start_y,
            end_x,
            end_y,
            radius,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_capsule_collider(
            entity,
            CapsuleCollider::new(
                start_x,
                start_y,
                end_x,
                end_y,
                radius,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_edge_body(
        &mut self,
        x: f32,
        y: f32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y) || !Self::valid_edge(start_x, start_y, end_x, end_y) {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some(body) = Self::rigid_body_for_edge(
            body_type,
            mass_or_density,
            use_density,
            start_x,
            start_y,
            end_x,
            end_y,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_edge_collider(
            entity,
            EdgeCollider::new(
                start_x,
                start_y,
                end_x,
                end_y,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_chain_body(
        &mut self,
        x: f32,
        y: f32,
        vertex_values: Vec<f32>,
        looped: bool,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y) {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some((vertices, vertex_count)) = Self::chain_vertices(&vertex_values, looped) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let Some(body) = Self::rigid_body_for_chain(
            body_type,
            mass_or_density,
            use_density,
            vertices,
            vertex_count,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_chain_collider(
            entity,
            ChainCollider::new(
                vertices,
                vertex_count,
                looped,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_oriented_box_body(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y)
            || !Self::valid_positive(half_width)
            || !Self::valid_positive(half_height)
            || !rotation_radians.is_finite()
        {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some(body) = Self::rigid_body_for_oriented_box(
            body_type,
            mass_or_density,
            use_density,
            half_width,
            half_height,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_oriented_box_collider(
            entity,
            OrientedBoxCollider::new(
                half_width,
                half_height,
                rotation_radians,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_convex_polygon_body(
        &mut self,
        x: f32,
        y: f32,
        vertex_values: Vec<f32>,
        rotation_radians: f32,
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
        body_enabled: bool,
        can_sleep: bool,
    ) -> bool {
        if !Self::valid_transform(x, y) || !rotation_radians.is_finite() {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        }
        let Some((vertices, vertex_count)) = Self::convex_polygon_vertices(&vertex_values) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let Some(body) = Self::rigid_body_for_convex_polygon(
            body_type,
            mass_or_density,
            use_density,
            vertices,
            vertex_count,
            body_enabled,
            can_sleep,
        ) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        let entity = self.world.spawn_entity();
        self.world.set_transform(entity, Transform2D { x, y });
        self.world.set_convex_polygon_collider(
            entity,
            ConvexPolygonCollider::new(
                vertices,
                vertex_count,
                is_trigger,
                Self::collision_layer_from_code(layer),
            )
            .with_rotation(rotation_radians)
            .with_enabled(collider_enabled),
        );
        self.world.set_collision_filter(
            entity,
            CollisionFilter::new(
                CollisionMask::from_bits(category_bits),
                CollisionMask::from_bits(mask_bits),
            ),
        );
        self.world.set_rigid_body(entity, body);
        self.store_physics_entity_snapshot(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_aabb_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        half_width: f32,
        half_height: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_positive(half_width)
            || !Self::valid_positive(half_height)
            || !Self::valid_transform(offset_x, offset_y)
        {
            return false;
        }
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::Aabb(
                AabbCollider::new(
                    half_width,
                    half_height,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_circle_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        radius: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_positive(radius) || !Self::valid_transform(offset_x, offset_y) {
            return false;
        }
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::Circle(
                CircleCollider::new(radius, is_trigger, Self::collision_layer_from_code(layer))
                    .with_offset(offset_x, offset_y)
                    .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_capsule_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_transform(start_x, start_y)
            || !Self::valid_transform(end_x, end_y)
            || !Self::valid_positive(radius)
            || !Self::valid_transform(offset_x, offset_y)
        {
            return false;
        }
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::Capsule(
                CapsuleCollider::new(
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                    radius,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_edge_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_edge(start_x, start_y, end_x, end_y)
            || !Self::valid_transform(offset_x, offset_y)
        {
            return false;
        }
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::Edge(
                EdgeCollider::new(
                    start_x,
                    start_y,
                    end_x,
                    end_y,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_chain_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        vertex_values: Vec<f32>,
        looped: bool,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_transform(offset_x, offset_y) {
            return false;
        }
        let Some((vertices, vertex_count)) = Self::chain_vertices(&vertex_values, looped) else {
            return false;
        };
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::Chain(
                ChainCollider::new(
                    vertices,
                    vertex_count,
                    looped,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_oriented_box_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !Self::valid_positive(half_width)
            || !Self::valid_positive(half_height)
            || !rotation_radians.is_finite()
            || !Self::valid_transform(offset_x, offset_y)
        {
            return false;
        }
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::OrientedBox(
                OrientedBoxCollider::new(
                    half_width,
                    half_height,
                    rotation_radians,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_physics_convex_polygon_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        vertex_values: Vec<f32>,
        rotation_radians: f32,
        offset_x: f32,
        offset_y: f32,
        layer: u32,
        category_bits: u32,
        mask_bits: u32,
        is_trigger: bool,
        collider_enabled: bool,
    ) -> bool {
        if !rotation_radians.is_finite() || !Self::valid_transform(offset_x, offset_y) {
            return false;
        }
        let Some((vertices, vertex_count)) = Self::convex_polygon_vertices(&vertex_values) else {
            return false;
        };
        self.add_physics_compound_collider(
            entity_id,
            entity_generation,
            CompoundColliderShape::ConvexPolygon(
                ConvexPolygonCollider::new(
                    vertices,
                    vertex_count,
                    is_trigger,
                    Self::collision_layer_from_code(layer),
                )
                .with_rotation(rotation_radians)
                .with_offset(offset_x, offset_y)
                .with_enabled(collider_enabled),
            ),
            category_bits,
            mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_physics_compound_collider_material(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        collider_index: u32,
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
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        let material = PhysicsMaterial {
            restitution,
            friction,
            surface_velocity: Velocity {
                vx: surface_velocity_x,
                vy: surface_velocity_y,
            },
            density,
            contact_baumgarte_bias_scale,
            max_contact_baumgarte_bias_velocity_scale,
            contact_position_correction_scale,
            contact_position_correction_slop_scale,
        };
        if !Self::valid_physics_material_parts(
            material.restitution,
            material.friction,
            material.surface_velocity.vx,
            material.surface_velocity.vy,
            material.density,
            material.contact_baumgarte_bias_scale,
            material.max_contact_baumgarte_bias_velocity_scale,
            material.contact_position_correction_scale,
            material.contact_position_correction_slop_scale,
        ) {
            return false;
        }
        if !self
            .world
            .set_compound_collider_material(entity, collider_index, material)
        {
            return false;
        }
        self.store_physics_entity_snapshot(entity)
    }

    pub fn physics_body_collider_count(&self, entity_id: u32, entity_generation: u32) -> u32 {
        self.entity_from_handle(entity_id, entity_generation)
            .map(|entity| self.world.compound_collider_count(entity) as u32)
            .unwrap_or(0)
    }

    pub fn query_physics_body_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        collider_index: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            self.physics_body_collider_snapshot = PhysicsBodyColliderSnapshot::default();
            return false;
        };
        let Some(snapshot) = self.physics_body_collider_snapshot(entity, collider_index) else {
            self.physics_body_collider_snapshot = PhysicsBodyColliderSnapshot::default();
            return false;
        };
        self.physics_body_collider_snapshot = snapshot;
        true
    }

    pub fn query_physics_entity(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        self.store_physics_entity_snapshot(entity)
    }

    pub fn physics_body_snapshot_floats_per_body(&self) -> usize {
        PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY
    }

    pub fn physics_body_snapshot_u32s_per_body(&self) -> usize {
        PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY
    }

    pub fn physics_body_snapshot_float_ptr(&self) -> *const f32 {
        self.physics_body_snapshot_floats.as_ptr()
    }

    pub fn physics_body_snapshot_float_len(&self) -> usize {
        self.physics_body_snapshot_floats.len()
    }

    pub fn physics_body_snapshot_u32_ptr(&self) -> *const u32 {
        self.physics_body_snapshot_u32s.as_ptr()
    }

    pub fn physics_body_snapshot_u32_len(&self) -> usize {
        self.physics_body_snapshot_u32s.len()
    }

    pub fn shooter_snapshot_header_floats(&self) -> usize {
        SHOOTER_SNAPSHOT_HEADER_FLOATS
    }

    pub fn shooter_snapshot_header_u32s(&self) -> usize {
        SHOOTER_SNAPSHOT_HEADER_U32S
    }

    pub fn shooter_snapshot_entity_floats(&self) -> usize {
        SHOOTER_SNAPSHOT_ENTITY_FLOATS
    }

    pub fn shooter_snapshot_entity_u32s(&self) -> usize {
        SHOOTER_SNAPSHOT_ENTITY_U32S
    }

    pub fn shooter_snapshot_header_float_ptr(&self) -> *const f32 {
        self.shooter_snapshot_header_floats.as_ptr()
    }

    pub fn shooter_snapshot_header_float_len(&self) -> usize {
        self.shooter_snapshot_header_floats.len()
    }

    pub fn shooter_snapshot_header_u32_ptr(&self) -> *const u32 {
        self.shooter_snapshot_header_u32s.as_ptr()
    }

    pub fn shooter_snapshot_header_u32_len(&self) -> usize {
        self.shooter_snapshot_header_u32s.len()
    }

    pub fn shooter_snapshot_entity_float_ptr(&self) -> *const f32 {
        self.shooter_snapshot_entity_floats.as_ptr()
    }

    pub fn shooter_snapshot_entity_float_len(&self) -> usize {
        self.shooter_snapshot_entity_floats.len()
    }

    pub fn shooter_snapshot_entity_u32_ptr(&self) -> *const u32 {
        self.shooter_snapshot_entity_u32s.as_ptr()
    }

    pub fn shooter_snapshot_entity_u32_len(&self) -> usize {
        self.shooter_snapshot_entity_u32s.len()
    }

    pub fn capture_shooter_snapshot(&mut self) -> bool {
        if self.active_scene != ActiveScene::Shooter {
            self.shooter_snapshot_header_floats.clear();
            self.shooter_snapshot_header_u32s.clear();
            self.shooter_snapshot_entity_floats.clear();
            self.shooter_snapshot_entity_u32s.clear();
            return false;
        }
        let snapshot = self.scene.snapshot(&self.world, &self.camera);
        self.store_shooter_snapshot(&snapshot);
        true
    }

    pub fn restore_shooter_snapshot(
        &mut self,
        header_floats: Vec<f32>,
        header_u32s: Vec<u32>,
        entity_floats: Vec<f32>,
        entity_u32s: Vec<u32>,
    ) -> bool {
        if header_floats.len() != SHOOTER_SNAPSHOT_HEADER_FLOATS
            || header_u32s.len() != SHOOTER_SNAPSHOT_HEADER_U32S
            || !entity_floats
                .len()
                .is_multiple_of(SHOOTER_SNAPSHOT_ENTITY_FLOATS)
            || !entity_u32s
                .len()
                .is_multiple_of(SHOOTER_SNAPSHOT_ENTITY_U32S)
            || entity_floats.len() / SHOOTER_SNAPSHOT_ENTITY_FLOATS
                != entity_u32s.len() / SHOOTER_SNAPSHOT_ENTITY_U32S
        {
            return false;
        }

        let mut snapshot = ShooterSceneSnapshot {
            header_floats: [0.0; SHOOTER_SNAPSHOT_HEADER_FLOATS],
            header_u32s: [0; SHOOTER_SNAPSHOT_HEADER_U32S],
            entities: Vec::with_capacity(entity_u32s.len() / SHOOTER_SNAPSHOT_ENTITY_U32S),
        };
        snapshot.header_floats.copy_from_slice(&header_floats);
        snapshot.header_u32s.copy_from_slice(&header_u32s);
        for (floats, u32s) in entity_floats
            .chunks_exact(SHOOTER_SNAPSHOT_ENTITY_FLOATS)
            .zip(entity_u32s.chunks_exact(SHOOTER_SNAPSHOT_ENTITY_U32S))
        {
            let mut entity = ShooterEntitySnapshot {
                floats: [0.0; SHOOTER_SNAPSHOT_ENTITY_FLOATS],
                u32s: [0; SHOOTER_SNAPSHOT_ENTITY_U32S],
            };
            entity.floats.copy_from_slice(floats);
            entity.u32s.copy_from_slice(u32s);
            snapshot.entities.push(entity);
        }

        let restored = self.scene.restore_snapshot(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            &snapshot,
        );
        if restored {
            self.active_scene = ActiveScene::Shooter;
            self.particles.clear();
            self.tweens.clear();
            self.clear_physics_history();
        }
        restored
    }

    pub fn capture_physics_body_snapshot_bulk(&mut self, handles: Vec<u32>) -> bool {
        if !handles
            .len()
            .is_multiple_of(PHYSICS_BODY_SNAPSHOT_HANDLE_U32S)
        {
            self.physics_body_snapshot_floats.clear();
            self.physics_body_snapshot_u32s.clear();
            return false;
        }
        let body_count = handles.len() / PHYSICS_BODY_SNAPSHOT_HANDLE_U32S;
        let mut snapshots = Vec::with_capacity(body_count);
        for chunk in handles.chunks_exact(PHYSICS_BODY_SNAPSHOT_HANDLE_U32S) {
            let Some(entity) = self.entity_from_handle(chunk[0], chunk[1]) else {
                self.physics_body_snapshot_floats.clear();
                self.physics_body_snapshot_u32s.clear();
                return false;
            };
            if !self.store_physics_entity_snapshot(entity) {
                self.physics_body_snapshot_floats.clear();
                self.physics_body_snapshot_u32s.clear();
                return false;
            }
            snapshots.push(self.physics_entity_snapshot);
        }
        self.physics_body_snapshot_floats.clear();
        self.physics_body_snapshot_u32s.clear();
        self.physics_body_snapshot_floats
            .reserve(body_count * PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY);
        self.physics_body_snapshot_u32s
            .reserve(body_count * PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY);
        for snapshot in snapshots {
            Self::append_physics_body_snapshot_bulk(
                snapshot,
                &mut self.physics_body_snapshot_floats,
                &mut self.physics_body_snapshot_u32s,
            );
        }
        true
    }

    pub fn restore_physics_body_snapshot_bulk(
        &mut self,
        handles: Vec<u32>,
        floats: Vec<f32>,
        u32s: Vec<u32>,
    ) -> bool {
        if !handles
            .len()
            .is_multiple_of(PHYSICS_BODY_SNAPSHOT_HANDLE_U32S)
            || !floats
                .len()
                .is_multiple_of(PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY)
            || !u32s
                .len()
                .is_multiple_of(PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY)
        {
            return false;
        }
        let body_count = handles.len() / PHYSICS_BODY_SNAPSHOT_HANDLE_U32S;
        if floats.len() / PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY != body_count
            || u32s.len() / PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY != body_count
        {
            return false;
        }
        for index in 0..body_count {
            let handle_offset = index * PHYSICS_BODY_SNAPSHOT_HANDLE_U32S;
            let float_offset = index * PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY;
            let u32_offset = index * PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY;
            if !self.restore_physics_body_snapshot_entry(
                handles[handle_offset],
                handles[handle_offset + 1],
                &floats[float_offset..float_offset + PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY],
                &u32s[u32_offset..u32_offset + PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY],
            ) {
                return false;
            }
        }
        true
    }

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

    pub fn set_physics_collider_offset(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        offset_x: f32,
        offset_y: f32,
    ) -> bool {
        if !Self::valid_transform(offset_x, offset_y) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if let Some(collider) = self.world.collider(entity) {
            self.world
                .set_aabb_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.circle_collider(entity) {
            self.world
                .set_circle_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.oriented_box_collider(entity) {
            self.world
                .set_oriented_box_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.capsule_collider(entity) {
            self.world
                .set_capsule_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.edge_collider(entity) {
            self.world
                .set_edge_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.chain_collider(entity) {
            self.world
                .set_chain_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.convex_polygon_collider(entity) {
            self.world
                .set_convex_polygon_collider(entity, collider.with_offset(offset_x, offset_y));
            return self.store_physics_entity_snapshot(entity);
        }
        false
    }

    pub fn set_physics_collider_enabled(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        enabled: bool,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if let Some(collider) = self.world.collider(entity) {
            self.world
                .set_aabb_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.circle_collider(entity) {
            self.world
                .set_circle_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.oriented_box_collider(entity) {
            self.world
                .set_oriented_box_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.capsule_collider(entity) {
            self.world
                .set_capsule_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.edge_collider(entity) {
            self.world
                .set_edge_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.chain_collider(entity) {
            self.world
                .set_chain_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        if let Some(collider) = self.world.convex_polygon_collider(entity) {
            self.world
                .set_convex_polygon_collider(entity, collider.with_enabled(enabled));
            return self.store_physics_entity_snapshot(entity);
        }
        false
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
        if !Self::valid_positive(mass) || !Self::valid_positive(inertia) {
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

    #[allow(clippy::too_many_arguments)]
    pub fn set_physics_collider_material(
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
        if self.world.rigid_body(entity).is_none() || !self.has_physics_collider(entity) {
            return false;
        }
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
        self.world.set_collider_material(entity, material);
        self.store_physics_entity_snapshot(entity)
    }

    pub fn clear_physics_collider_material(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() || !self.has_physics_collider(entity) {
            return false;
        }
        self.world.clear_collider_material(entity);
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

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_distance_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        rest_length: f32,
        stiffness: f32,
        damping: f32,
        break_distance: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_non_negative(rest_length)
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_distance)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = DistanceJoint::new(entity_a, entity_b, rest_length)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_distance(break_distance)
            .with_enabled(enabled);
        let id = self.world.add_distance_joint(joint);
        self.store_distance_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_rope_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        max_length: f32,
        stiffness: f32,
        damping: f32,
        break_distance: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_non_negative(max_length)
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_distance)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = RopeJoint::new(entity_a, entity_b, max_length)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_distance(break_distance)
            .with_enabled(enabled);
        let id = self.world.add_rope_joint(joint);
        self.store_rope_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_spring_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        rest_length: f32,
        stiffness: f32,
        damping: f32,
        break_distance: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_non_negative(rest_length)
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_distance)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = SpringJoint::new(entity_a, entity_b, rest_length)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_distance(break_distance)
            .with_enabled(enabled);
        let id = self.world.add_spring_joint(joint);
        self.store_spring_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_pulley_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        ground_anchor_a_x: f32,
        ground_anchor_a_y: f32,
        ground_anchor_b_x: f32,
        ground_anchor_b_y: f32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        rest_length: f32,
        ratio: f32,
        stiffness: f32,
        damping: f32,
        break_distance: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(ground_anchor_a_x, ground_anchor_a_y)
            || !Self::valid_transform(ground_anchor_b_x, ground_anchor_b_y)
            || !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !Self::valid_non_negative(rest_length)
            || !Self::valid_positive(ratio)
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_distance)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = PulleyJoint::new(entity_a, entity_b, rest_length)
            .with_ground_anchor_a(ground_anchor_a_x, ground_anchor_a_y)
            .with_ground_anchor_b(ground_anchor_b_x, ground_anchor_b_y)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_ratio(ratio)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_distance(break_distance)
            .with_enabled(enabled);
        let id = self.world.add_pulley_joint(joint);
        self.store_pulley_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_revolute_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        stiffness: f32,
        damping: f32,
        break_distance: f32,
        limit_enabled: bool,
        lower_angle: f32,
        upper_angle: f32,
        motor_enabled: bool,
        motor_speed: f32,
        max_motor_torque: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_distance)
            || !lower_angle.is_finite()
            || !upper_angle.is_finite()
            || !motor_speed.is_finite()
            || !Self::valid_non_negative(max_motor_torque)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = RevoluteJoint::new(entity_a, entity_b)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_distance(break_distance)
            .with_angle_limits(lower_angle, upper_angle)
            .with_angle_limit_enabled(limit_enabled)
            .with_motor(motor_speed, max_motor_torque)
            .with_motor_enabled(motor_enabled)
            .with_enabled(enabled);
        let id = self.world.add_revolute_joint(joint);
        self.store_revolute_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_prismatic_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        local_axis_a_x: f32,
        local_axis_a_y: f32,
        reference_angle: f32,
        stiffness: f32,
        damping: f32,
        angular_stiffness: f32,
        angular_damping: f32,
        break_distance: f32,
        limit_enabled: bool,
        lower_translation: f32,
        upper_translation: f32,
        motor_enabled: bool,
        motor_speed: f32,
        max_motor_force: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !Self::valid_transform(local_axis_a_x, local_axis_a_y)
            || !reference_angle.is_finite()
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_unit_interval(angular_stiffness)
            || !Self::valid_unit_interval(angular_damping)
            || !Self::valid_break_limit(break_distance)
            || !lower_translation.is_finite()
            || !upper_translation.is_finite()
            || !motor_speed.is_finite()
            || !Self::valid_non_negative(max_motor_force)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = PrismaticJoint::new(entity_a, entity_b)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_local_axis_a(local_axis_a_x, local_axis_a_y)
            .with_reference_angle(reference_angle)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_angular_stiffness(angular_stiffness)
            .with_angular_damping(angular_damping)
            .with_break_distance(break_distance)
            .with_translation_limits(lower_translation, upper_translation)
            .with_translation_limit_enabled(limit_enabled)
            .with_motor(motor_speed, max_motor_force)
            .with_motor_enabled(motor_enabled)
            .with_enabled(enabled);
        let id = self.world.add_prismatic_joint(joint);
        self.store_prismatic_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_weld_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        local_anchor_a_x: f32,
        local_anchor_a_y: f32,
        local_anchor_b_x: f32,
        local_anchor_b_y: f32,
        reference_angle: f32,
        stiffness: f32,
        damping: f32,
        angular_stiffness: f32,
        angular_damping: f32,
        break_distance: f32,
        break_angle: f32,
        enabled: bool,
    ) -> bool {
        if !Self::valid_transform(local_anchor_a_x, local_anchor_a_y)
            || !Self::valid_transform(local_anchor_b_x, local_anchor_b_y)
            || !reference_angle.is_finite()
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_unit_interval(angular_stiffness)
            || !Self::valid_unit_interval(angular_damping)
            || !Self::valid_break_limit(break_distance)
            || !Self::valid_break_limit(break_angle)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = WeldJoint::new(entity_a, entity_b)
            .with_local_anchor_a(local_anchor_a_x, local_anchor_a_y)
            .with_local_anchor_b(local_anchor_b_x, local_anchor_b_y)
            .with_reference_angle(reference_angle)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_angular_stiffness(angular_stiffness)
            .with_angular_damping(angular_damping)
            .with_break_distance(break_distance)
            .with_break_angle(break_angle)
            .with_enabled(enabled);
        let id = self.world.add_weld_joint(joint);
        self.store_weld_joint_snapshot(id, joint)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn spawn_physics_gear_joint(
        &mut self,
        entity_a_id: u32,
        entity_a_generation: u32,
        entity_b_id: u32,
        entity_b_generation: u32,
        ratio: f32,
        reference_angle: f32,
        stiffness: f32,
        damping: f32,
        break_angle: f32,
        enabled: bool,
    ) -> bool {
        if !ratio.is_finite()
            || !reference_angle.is_finite()
            || !Self::valid_unit_interval(stiffness)
            || !Self::valid_unit_interval(damping)
            || !Self::valid_break_limit(break_angle)
        {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        }
        let Some(entity_a) = self.entity_from_handle(entity_a_id, entity_a_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let Some(entity_b) = self.entity_from_handle(entity_b_id, entity_b_generation) else {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            return false;
        };
        let joint = GearJoint::new(entity_a, entity_b, ratio)
            .with_reference_angle(reference_angle)
            .with_stiffness(stiffness)
            .with_damping(damping)
            .with_break_angle(break_angle)
            .with_enabled(enabled);
        let id = self.world.add_gear_joint(joint);
        self.store_gear_joint_snapshot(id, joint)
    }

    pub fn query_physics_joint(
        &mut self,
        joint_type: u32,
        joint_index: u32,
        joint_generation: u32,
    ) -> bool {
        let found = match joint_type {
            PHYSICS_JOINT_DISTANCE => self
                .world
                .distance_joint(DistanceJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_distance_joint_snapshot(
                        DistanceJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_ROPE => self
                .world
                .rope_joint(RopeJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_rope_joint_snapshot(
                        RopeJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_SPRING => self
                .world
                .spring_joint(SpringJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_spring_joint_snapshot(
                        SpringJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_PULLEY => self
                .world
                .pulley_joint(PulleyJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_pulley_joint_snapshot(
                        PulleyJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_REVOLUTE => self
                .world
                .revolute_joint(RevoluteJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_revolute_joint_snapshot(
                        RevoluteJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_PRISMATIC => self
                .world
                .prismatic_joint(PrismaticJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_prismatic_joint_snapshot(
                        PrismaticJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_WELD => self
                .world
                .weld_joint(WeldJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_weld_joint_snapshot(
                        WeldJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_GEAR => self
                .world
                .gear_joint(GearJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_gear_joint_snapshot(
                        GearJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            _ => None,
        };
        found.unwrap_or_else(|| {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            false
        })
    }

    pub fn clear_physics_joint(
        &mut self,
        joint_type: u32,
        joint_index: u32,
        joint_generation: u32,
    ) -> bool {
        let cleared = match joint_type {
            PHYSICS_JOINT_DISTANCE => self
                .world
                .clear_distance_joint(DistanceJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_ROPE => self
                .world
                .clear_rope_joint(RopeJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_SPRING => self
                .world
                .clear_spring_joint(SpringJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_PULLEY => self
                .world
                .clear_pulley_joint(PulleyJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_REVOLUTE => self
                .world
                .clear_revolute_joint(RevoluteJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_PRISMATIC => self
                .world
                .clear_prismatic_joint(PrismaticJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_WELD => self
                .world
                .clear_weld_joint(WeldJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            PHYSICS_JOINT_GEAR => self
                .world
                .clear_gear_joint(GearJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .is_some(),
            _ => false,
        };
        if cleared {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
        }
        cleared
    }

    pub fn set_physics_joint_enabled(
        &mut self,
        joint_type: u32,
        joint_index: u32,
        joint_generation: u32,
        enabled: bool,
    ) -> bool {
        match joint_type {
            PHYSICS_JOINT_DISTANCE => {
                let id = DistanceJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.distance_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_distance_joint(id, joint);
                self.store_distance_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_ROPE => {
                let id = RopeJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.rope_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_rope_joint(id, joint);
                self.store_rope_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_SPRING => {
                let id = SpringJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.spring_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_spring_joint(id, joint);
                self.store_spring_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_PULLEY => {
                let id = PulleyJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.pulley_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_pulley_joint(id, joint);
                self.store_pulley_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_REVOLUTE => {
                let id = RevoluteJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.revolute_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_revolute_joint(id, joint);
                self.store_revolute_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_PRISMATIC => {
                let id = PrismaticJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.prismatic_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_prismatic_joint(id, joint);
                self.store_prismatic_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_WELD => {
                let id = WeldJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.weld_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_weld_joint(id, joint);
                self.store_weld_joint_snapshot(id, joint)
            }
            PHYSICS_JOINT_GEAR => {
                let id = GearJointId {
                    index: joint_index,
                    generation: joint_generation,
                };
                let Some(mut joint) = self.world.gear_joint(id) else {
                    self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                    return false;
                };
                joint.enabled = enabled;
                self.world.set_gear_joint(id, joint);
                self.store_gear_joint_snapshot(id, joint)
            }
            _ => {
                self.physics_joint_snapshot = PhysicsJointSnapshot::default();
                false
            }
        }
    }

    pub fn query_nearest_body(
        &mut self,
        x: f32,
        y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> bool {
        let Some(hit) = CollisionSystem::nearest_body_query(
            &self.world,
            Transform2D { x, y },
            max_distance,
            CollisionMask::from_bits(query_mask_bits),
        ) else {
            self.physics_query_result = PhysicsQueryResult::default();
            return false;
        };

        self.physics_query_result = PhysicsQueryResult {
            entity_id: hit.entity.id,
            entity_generation: hit.entity.generation,
            tile_layer_index: 0,
            tile_index: 0,
            point_x: hit.point_x,
            point_y: hit.point_y,
            distance: hit.distance,
        };
        true
    }

    pub fn query_nearest_tile_obstacle(&mut self, x: f32, y: f32, max_distance: f32) -> bool {
        let Some(hit) = self
            .tilemap
            .nearest_collision_obstacle(Transform2D { x, y }, max_distance)
        else {
            self.physics_query_result = PhysicsQueryResult::default();
            return false;
        };

        self.physics_query_result = PhysicsQueryResult {
            entity_id: 0,
            entity_generation: 0,
            tile_layer_index: u32::try_from(hit.layer_index).unwrap_or(u32::MAX),
            tile_index: u32::try_from(hit.tile_index).unwrap_or(u32::MAX),
            point_x: hit.point_x,
            point_y: hit.point_y,
            distance: hit.distance,
        };
        true
    }

    pub fn query_body_contacts(&mut self, category_a_bits: u32, category_b_bits: u32) -> u32 {
        let contacts = CollisionSystem::build_mask_contacts(
            &self.world,
            CollisionMask::from_bits(category_a_bits),
            CollisionMask::from_bits(category_b_bits),
        );
        self.store_physics_body_contacts(contacts)
    }

    pub fn query_body_manifolds(&mut self, category_a_bits: u32, category_b_bits: u32) -> u32 {
        let manifolds = CollisionSystem::build_mask_manifolds(
            &self.world,
            CollisionMask::from_bits(category_a_bits),
            CollisionMask::from_bits(category_b_bits),
        );
        self.store_physics_body_manifolds(manifolds)
    }

    pub fn step_rigid_bodies(&mut self, delta_seconds: f32) {
        self.rigid_body_step_stats =
            PhysicsSystem::step_rigid_bodies(&mut self.world, delta_seconds);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn configure_auto_rigid_body_step(
        &mut self,
        enabled: bool,
        gravity_x: f32,
        gravity_y: f32,
        velocity_iterations: u32,
        position_iterations: u32,
        position_correction_percent: f32,
        position_correction_slop: f32,
        restitution_velocity_threshold: f32,
        contact_baumgarte_bias_factor: f32,
        max_contact_baumgarte_bias_velocity: f32,
        contact_split_impulse: bool,
    ) {
        self.auto_rigid_body_step_enabled = enabled;
        self.auto_rigid_body_step_config = RigidBodyStepConfig {
            gravity: Velocity {
                vx: gravity_x,
                vy: gravity_y,
            },
            velocity_iterations,
            position_iterations,
            position_correction_percent,
            position_correction_slop,
            restitution_velocity_threshold,
            contact_baumgarte_bias_factor,
            max_contact_baumgarte_bias_velocity,
            contact_split_impulse,
        };
        if !enabled {
            self.rigid_body_step_stats = RigidBodyStepStats::default();
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn step_rigid_bodies_with_config(
        &mut self,
        delta_seconds: f32,
        gravity_x: f32,
        gravity_y: f32,
        velocity_iterations: u32,
        position_iterations: u32,
        position_correction_percent: f32,
        position_correction_slop: f32,
        restitution_velocity_threshold: f32,
        contact_baumgarte_bias_factor: f32,
        max_contact_baumgarte_bias_velocity: f32,
        contact_split_impulse: bool,
    ) {
        self.rigid_body_step_stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut self.world,
            delta_seconds,
            RigidBodyStepConfig {
                gravity: Velocity {
                    vx: gravity_x,
                    vy: gravity_y,
                },
                velocity_iterations,
                position_iterations,
                position_correction_percent,
                position_correction_slop,
                restitution_velocity_threshold,
                contact_baumgarte_bias_factor,
                max_contact_baumgarte_bias_velocity,
                contact_split_impulse,
            },
        );
    }

    pub fn query_rigid_contact_impulses(&mut self) -> u32 {
        self.physics_rigid_contact_impulse_hits.clear();
        self.physics_rigid_contact_impulse_hits.extend(
            self.world
                .rigid_contact_impulses()
                .map(PhysicsRigidContactImpulseHit::from_rigid_contact_impulse),
        );
        u32::try_from(self.physics_rigid_contact_impulse_hits.len()).unwrap_or(u32::MAX)
    }

    pub fn query_point_bodies(&mut self, x: f32, y: f32, query_mask_bits: u32) -> u32 {
        let hits = CollisionSystem::point_query(
            &self.world,
            Transform2D { x, y },
            CollisionMask::from_bits(query_mask_bits),
        );
        self.store_physics_query_entities(hits.into_iter().map(|hit| hit.entity))
    }

    pub fn query_aabb_bodies(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        query_mask_bits: u32,
    ) -> u32 {
        let Some(bounds) = AabbBounds::from_center(Transform2D { x, y }, half_width, half_height)
        else {
            self.physics_query_hits.clear();
            return 0;
        };
        let hits = CollisionSystem::aabb_query(
            &self.world,
            bounds,
            CollisionMask::from_bits(query_mask_bits),
        );
        self.store_physics_query_entities(hits.into_iter().map(|hit| hit.entity))
    }

    pub fn query_circle_bodies(
        &mut self,
        x: f32,
        y: f32,
        radius: f32,
        query_mask_bits: u32,
    ) -> u32 {
        let hits = CollisionSystem::circle_query(
            &self.world,
            Transform2D { x, y },
            radius,
            CollisionMask::from_bits(query_mask_bits),
        );
        self.store_physics_query_entities(hits.into_iter().map(|hit| hit.entity))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn query_oriented_box_bodies(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        query_mask_bits: u32,
    ) -> u32 {
        self.store_physics_shape_query_entities(
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x, y },
                half_width,
                half_height,
                rotation_radians,
            },
            query_mask_bits,
        )
    }

    pub fn query_capsule_bodies(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        query_mask_bits: u32,
    ) -> u32 {
        self.store_physics_shape_query_entities(
            CollisionQueryShape::Capsule {
                start: Transform2D {
                    x: start_x,
                    y: start_y,
                },
                end: Transform2D { x: end_x, y: end_y },
                radius,
            },
            query_mask_bits,
        )
    }

    pub fn query_convex_polygon_bodies(
        &mut self,
        vertex_values: Vec<f32>,
        query_mask_bits: u32,
    ) -> u32 {
        let Some(shape) = Self::convex_polygon_query_shape(&vertex_values) else {
            self.physics_query_hits.clear();
            return 0;
        };
        self.store_physics_shape_query_entities(shape, query_mask_bits)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn raycast_bodies(
        &mut self,
        origin_x: f32,
        origin_y: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        let hits = CollisionSystem::raycast_all(
            &self.world,
            Transform2D {
                x: origin_x,
                y: origin_y,
            },
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            CollisionMask::from_bits(query_mask_bits),
        );
        self.store_physics_raycast_hits(hits)
    }

    pub fn segment_cast_bodies(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        query_mask_bits: u32,
    ) -> u32 {
        let hits = CollisionSystem::segment_cast_all(
            &self.world,
            Transform2D {
                x: start_x,
                y: start_y,
            },
            Transform2D { x: end_x, y: end_y },
            CollisionMask::from_bits(query_mask_bits),
        );
        self.store_physics_raycast_hits(hits)
    }

    pub fn raycast_tile_obstacles(
        &mut self,
        origin_x: f32,
        origin_y: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
    ) -> u32 {
        let hits = self.tilemap.raycast_obstacles(
            Transform2D {
                x: origin_x,
                y: origin_y,
            },
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
        );
        self.store_physics_tile_shape_cast_hits(hits)
    }

    pub fn segment_cast_tile_obstacles(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
    ) -> u32 {
        let hits = self.tilemap.segment_cast_obstacles(
            Transform2D {
                x: start_x,
                y: start_y,
            },
            Transform2D { x: end_x, y: end_y },
        );
        self.store_physics_tile_shape_cast_hits(hits)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_aabb_bodies(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        let Some(bounds) = AabbBounds::from_center(Transform2D { x, y }, half_width, half_height)
        else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        self.store_physics_shape_cast_hits(
            CollisionQueryShape::Aabb(bounds),
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_circle_bodies(
        &mut self,
        x: f32,
        y: f32,
        radius: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        self.store_physics_shape_cast_hits(
            CollisionQueryShape::Circle {
                center: Transform2D { x, y },
                radius,
            },
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_oriented_box_bodies(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        self.store_physics_shape_cast_hits(
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x, y },
                half_width,
                half_height,
                rotation_radians,
            },
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_capsule_bodies(
        &mut self,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        self.store_physics_shape_cast_hits(
            CollisionQueryShape::Capsule {
                start: Transform2D {
                    x: start_x,
                    y: start_y,
                },
                end: Transform2D { x: end_x, y: end_y },
                radius,
            },
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_convex_polygon_bodies(
        &mut self,
        vertex_values: Vec<f32>,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        let Some(shape) = Self::convex_polygon_query_shape(&vertex_values) else {
            self.physics_raycast_hits.clear();
            return 0;
        };
        self.store_physics_shape_cast_hits(
            shape,
            direction_x,
            direction_y,
            max_distance,
            query_mask_bits,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn shape_cast_aabb_tile_obstacles(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
    ) -> u32 {
        let collider = AabbCollider::new(half_width, half_height, false, CollisionLayer::Player);
        let hits = self.tilemap.shape_cast_aabb_obstacles(
            Transform2D { x, y },
            collider,
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
        );
        self.store_physics_tile_shape_cast_hits(hits)
    }

    pub fn query_aabb_tile_obstacle_contacts(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
    ) -> u32 {
        let collider = AabbCollider::new(half_width, half_height, false, CollisionLayer::Player);
        let hits = self
            .tilemap
            .aabb_obstacle_contacts(Transform2D { x, y }, collider);
        self.store_physics_tile_contact_hits(hits)
    }

    pub fn query_aabb_tile_obstacle_manifolds(
        &mut self,
        x: f32,
        y: f32,
        half_width: f32,
        half_height: f32,
    ) -> u32 {
        let collider = AabbCollider::new(half_width, half_height, false, CollisionLayer::Player);
        let hits = self
            .tilemap
            .aabb_obstacle_manifolds(Transform2D { x, y }, collider);
        self.store_physics_tile_manifold_hits(hits)
    }

    pub fn physics_query_hit_ptr(&self) -> *const PhysicsQueryEntityHit {
        self.physics_query_hits.as_ptr()
    }

    pub fn physics_query_hit_len(&self) -> usize {
        self.physics_query_hits.len()
    }

    pub fn physics_raycast_hit_ptr(&self) -> *const PhysicsRaycastBodyHit {
        self.physics_raycast_hits.as_ptr()
    }

    pub fn physics_raycast_hit_len(&self) -> usize {
        self.physics_raycast_hits.len()
    }

    pub fn physics_tile_shape_cast_hit_ptr(&self) -> *const PhysicsTileShapeCastHit {
        self.physics_tile_shape_cast_hits.as_ptr()
    }

    pub fn physics_tile_shape_cast_hit_len(&self) -> usize {
        self.physics_tile_shape_cast_hits.len()
    }

    pub fn physics_tile_contact_hit_ptr(&self) -> *const PhysicsTileContactHit {
        self.physics_tile_contact_hits.as_ptr()
    }

    pub fn physics_tile_contact_hit_len(&self) -> usize {
        self.physics_tile_contact_hits.len()
    }

    pub fn physics_tile_manifold_hit_ptr(&self) -> *const PhysicsTileManifoldHit {
        self.physics_tile_manifold_hits.as_ptr()
    }

    pub fn physics_tile_manifold_hit_len(&self) -> usize {
        self.physics_tile_manifold_hits.len()
    }

    pub fn physics_body_contact_hit_ptr(&self) -> *const PhysicsBodyContactHit {
        self.physics_body_contact_hits.as_ptr()
    }

    pub fn physics_body_contact_hit_len(&self) -> usize {
        self.physics_body_contact_hits.len()
    }

    pub fn physics_body_manifold_hit_ptr(&self) -> *const PhysicsBodyManifoldHit {
        self.physics_body_manifold_hits.as_ptr()
    }

    pub fn physics_body_manifold_hit_len(&self) -> usize {
        self.physics_body_manifold_hits.len()
    }

    pub fn physics_rigid_contact_impulse_hit_ptr(&self) -> *const PhysicsRigidContactImpulseHit {
        self.physics_rigid_contact_impulse_hits.as_ptr()
    }

    pub fn physics_rigid_contact_impulse_hit_len(&self) -> usize {
        self.physics_rigid_contact_impulse_hits.len()
    }

    pub fn physics_query_entity_id(&self) -> u32 {
        self.physics_query_result.entity_id
    }

    pub fn physics_query_entity_generation(&self) -> u32 {
        self.physics_query_result.entity_generation
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

    pub fn physics_joint_type(&self) -> u32 {
        self.physics_joint_snapshot.joint_type
    }

    pub fn physics_joint_index(&self) -> u32 {
        self.physics_joint_snapshot.joint_index
    }

    pub fn physics_joint_generation(&self) -> u32 {
        self.physics_joint_snapshot.joint_generation
    }

    pub fn physics_joint_entity_a_id(&self) -> u32 {
        self.physics_joint_snapshot.entity_a_id
    }

    pub fn physics_joint_entity_a_generation(&self) -> u32 {
        self.physics_joint_snapshot.entity_a_generation
    }

    pub fn physics_joint_entity_b_id(&self) -> u32 {
        self.physics_joint_snapshot.entity_b_id
    }

    pub fn physics_joint_entity_b_generation(&self) -> u32 {
        self.physics_joint_snapshot.entity_b_generation
    }

    pub fn physics_joint_rest_length(&self) -> f32 {
        self.physics_joint_snapshot.rest_length
    }

    pub fn physics_joint_max_length(&self) -> f32 {
        self.physics_joint_snapshot.max_length
    }

    pub fn physics_joint_ratio(&self) -> f32 {
        self.physics_joint_snapshot.ratio
    }

    pub fn physics_joint_reference_angle(&self) -> f32 {
        self.physics_joint_snapshot.reference_angle
    }

    pub fn physics_joint_break_distance(&self) -> f32 {
        self.physics_joint_snapshot.break_distance
    }

    pub fn physics_joint_break_angle(&self) -> f32 {
        self.physics_joint_snapshot.break_angle
    }

    pub fn physics_joint_stiffness(&self) -> f32 {
        self.physics_joint_snapshot.stiffness
    }

    pub fn physics_joint_damping(&self) -> f32 {
        self.physics_joint_snapshot.damping
    }

    pub fn physics_joint_angular_stiffness(&self) -> f32 {
        self.physics_joint_snapshot.angular_stiffness
    }

    pub fn physics_joint_angular_damping(&self) -> f32 {
        self.physics_joint_snapshot.angular_damping
    }

    pub fn physics_joint_local_anchor_a_x(&self) -> f32 {
        self.physics_joint_snapshot.local_anchor_a_x
    }

    pub fn physics_joint_local_anchor_a_y(&self) -> f32 {
        self.physics_joint_snapshot.local_anchor_a_y
    }

    pub fn physics_joint_local_anchor_b_x(&self) -> f32 {
        self.physics_joint_snapshot.local_anchor_b_x
    }

    pub fn physics_joint_local_anchor_b_y(&self) -> f32 {
        self.physics_joint_snapshot.local_anchor_b_y
    }

    pub fn physics_joint_local_axis_a_x(&self) -> f32 {
        self.physics_joint_snapshot.local_axis_a_x
    }

    pub fn physics_joint_local_axis_a_y(&self) -> f32 {
        self.physics_joint_snapshot.local_axis_a_y
    }

    pub fn physics_joint_ground_anchor_a_x(&self) -> f32 {
        self.physics_joint_snapshot.ground_anchor_a_x
    }

    pub fn physics_joint_ground_anchor_a_y(&self) -> f32 {
        self.physics_joint_snapshot.ground_anchor_a_y
    }

    pub fn physics_joint_ground_anchor_b_x(&self) -> f32 {
        self.physics_joint_snapshot.ground_anchor_b_x
    }

    pub fn physics_joint_ground_anchor_b_y(&self) -> f32 {
        self.physics_joint_snapshot.ground_anchor_b_y
    }

    pub fn physics_joint_limit_enabled(&self) -> bool {
        self.physics_joint_snapshot.limit_enabled
    }

    pub fn physics_joint_lower_angle(&self) -> f32 {
        self.physics_joint_snapshot.lower_angle
    }

    pub fn physics_joint_upper_angle(&self) -> f32 {
        self.physics_joint_snapshot.upper_angle
    }

    pub fn physics_joint_lower_translation(&self) -> f32 {
        self.physics_joint_snapshot.lower_translation
    }

    pub fn physics_joint_upper_translation(&self) -> f32 {
        self.physics_joint_snapshot.upper_translation
    }

    pub fn physics_joint_motor_enabled(&self) -> bool {
        self.physics_joint_snapshot.motor_enabled
    }

    pub fn physics_joint_motor_speed(&self) -> f32 {
        self.physics_joint_snapshot.motor_speed
    }

    pub fn physics_joint_max_motor_force(&self) -> f32 {
        self.physics_joint_snapshot.max_motor_force
    }

    pub fn physics_joint_max_motor_torque(&self) -> f32 {
        self.physics_joint_snapshot.max_motor_torque
    }

    pub fn physics_joint_enabled(&self) -> bool {
        self.physics_joint_snapshot.enabled
    }

    pub fn physics_query_tile_layer_index(&self) -> u32 {
        self.physics_query_result.tile_layer_index
    }

    pub fn physics_query_tile_index(&self) -> u32 {
        self.physics_query_result.tile_index
    }

    pub fn rigid_body_step_substeps(&self) -> u32 {
        self.rigid_body_step_stats.substeps
    }

    pub fn rigid_body_step_dynamic_bodies(&self) -> u32 {
        self.rigid_body_step_stats.dynamic_bodies
    }

    pub fn rigid_body_step_angular_bodies(&self) -> u32 {
        self.rigid_body_step_stats.angular_bodies
    }

    pub fn rigid_body_step_island_count(&self) -> u32 {
        self.rigid_body_step_stats.island_count
    }

    pub fn rigid_body_step_island_bodies(&self) -> u32 {
        self.rigid_body_step_stats.island_bodies
    }

    pub fn rigid_body_step_active_islands(&self) -> u32 {
        self.rigid_body_step_stats.active_islands
    }

    pub fn rigid_body_step_sleeping_islands(&self) -> u32 {
        self.rigid_body_step_stats.sleeping_islands
    }

    pub fn rigid_body_step_largest_island_bodies(&self) -> u32 {
        self.rigid_body_step_stats.largest_island_bodies
    }

    pub fn rigid_body_step_contact_checks(&self) -> u32 {
        self.rigid_body_step_stats.contact_checks
    }

    pub fn rigid_body_step_velocity_impulses(&self) -> u32 {
        self.rigid_body_step_stats.velocity_impulses
    }

    pub fn rigid_body_step_contact_block_solves(&self) -> u32 {
        self.rigid_body_step_stats.contact_block_solves
    }

    pub fn rigid_body_step_baumgarte_velocity_biases(&self) -> u32 {
        self.rigid_body_step_stats.baumgarte_velocity_biases
    }

    pub fn rigid_body_step_split_velocity_impulses(&self) -> u32 {
        self.rigid_body_step_stats.split_velocity_impulses
    }

    pub fn rigid_body_step_restitution_velocity_threshold_skips(&self) -> u32 {
        self.rigid_body_step_stats
            .restitution_velocity_threshold_skips
    }

    pub fn rigid_body_step_warm_start_impulses(&self) -> u32 {
        self.rigid_body_step_stats.warm_start_impulses
    }

    pub fn rigid_body_step_contact_cache_entries(&self) -> u32 {
        self.rigid_body_step_stats.contact_cache_entries
    }

    pub fn rigid_body_step_sleeping_bodies(&self) -> u32 {
        self.rigid_body_step_stats.sleeping_bodies
    }

    pub fn rigid_body_step_bodies_put_to_sleep(&self) -> u32 {
        self.rigid_body_step_stats.bodies_put_to_sleep
    }

    pub fn rigid_body_step_bodies_woken(&self) -> u32 {
        self.rigid_body_step_stats.bodies_woken
    }

    pub fn rigid_body_step_islands_woken(&self) -> u32 {
        self.rigid_body_step_stats.islands_woken
    }

    pub fn rigid_body_step_islands_put_to_sleep(&self) -> u32 {
        self.rigid_body_step_stats.islands_put_to_sleep
    }

    pub fn rigid_body_step_ccd_checks(&self) -> u32 {
        self.rigid_body_step_stats.ccd_checks
    }

    pub fn rigid_body_step_ccd_hits(&self) -> u32 {
        self.rigid_body_step_stats.ccd_hits
    }

    pub fn rigid_body_step_position_corrections(&self) -> u32 {
        self.rigid_body_step_stats.position_corrections
    }

    pub fn rigid_body_step_split_position_corrections(&self) -> u32 {
        self.rigid_body_step_stats.split_position_corrections
    }

    pub fn rigid_body_step_constraint_velocity_corrections(&self) -> u32 {
        self.rigid_body_step_stats.constraint_velocity_corrections
    }

    pub fn rigid_body_step_constraint_position_corrections(&self) -> u32 {
        self.rigid_body_step_stats.constraint_position_corrections
    }

    pub fn rigid_body_step_broken_joints(&self) -> u32 {
        self.rigid_body_step_stats.broken_joints
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

    pub fn configure_fixed_timestep(
        &mut self,
        enabled: bool,
        step_seconds: f32,
        max_frame_seconds: f32,
        max_steps_per_update: u32,
    ) {
        let was_enabled = self.fixed_timestep_enabled;
        self.fixed_timestep_enabled = enabled;
        self.fixed_timestep = FixedTimestep::new(FixedTimestepConfig {
            step_seconds,
            max_frame_seconds,
            max_steps_per_update,
        });
        self.last_fixed_update = FixedTimestepUpdate::default();
        if !enabled || !was_enabled {
            self.fixed_timestep_input_latch.clear();
            self.previous_input_sample = self.input;
        }
    }

    pub fn fixed_timestep_enabled(&self) -> bool {
        self.fixed_timestep_enabled
    }

    pub fn fixed_timestep_alpha(&self) -> f32 {
        self.last_fixed_update.alpha
    }

    pub fn fixed_timestep_consumed_seconds(&self) -> f32 {
        self.last_fixed_update.consumed_seconds
    }

    pub fn fixed_timestep_dropped_seconds(&self) -> f32 {
        self.last_fixed_update.dropped_seconds
    }

    pub fn physics_fixed_steps(&self) -> u32 {
        self.physics_counters.fixed_steps
    }

    pub fn physics_kinematic_moves(&self) -> u32 {
        self.physics_counters.kinematic_moves
    }

    pub fn physics_kinematic_hits(&self) -> u32 {
        self.physics_counters.kinematic_hits
    }

    pub fn physics_kinematic_entity_hits(&self) -> u32 {
        self.physics_counters.kinematic_entity_hits
    }

    pub fn physics_kinematic_tile_hits(&self) -> u32 {
        self.physics_counters.kinematic_tile_hits
    }

    pub fn physics_solid_candidate_checks(&self) -> u32 {
        self.physics_counters.solid_candidate_checks
    }

    pub fn physics_tile_candidate_checks(&self) -> u32 {
        self.physics_counters.tile_candidate_checks
    }

    pub fn physics_collision_pairs(&self) -> u32 {
        self.physics_counters.collision_pairs
    }

    pub fn physics_collision_solid_pairs(&self) -> u32 {
        self.physics_counters.collision_solid_pairs
    }

    pub fn physics_collision_trigger_pairs(&self) -> u32 {
        self.physics_counters.collision_trigger_pairs
    }

    pub fn collision_event_ptr(&self) -> *const CollisionEvent {
        self.collision_events.as_ptr()
    }

    pub fn collision_event_len(&self) -> usize {
        self.collision_events.len()
    }

    pub fn collision_enter_count(&self) -> u32 {
        self.collision_event_counts.enter
    }

    pub fn collision_stay_count(&self) -> u32 {
        self.collision_event_counts.stay
    }

    pub fn collision_exit_count(&self) -> u32 {
        self.collision_event_counts.exit
    }

    pub fn collision_hit_count(&self) -> u32 {
        self.collision_event_counts.hit
    }

    pub fn collision_trigger_enter_count(&self) -> u32 {
        self.collision_event_counts.trigger_enter
    }

    pub fn collision_trigger_stay_count(&self) -> u32 {
        self.collision_event_counts.trigger_stay
    }

    pub fn collision_trigger_exit_count(&self) -> u32 {
        self.collision_event_counts.trigger_exit
    }

    pub fn physics_debug_line_ptr(&self) -> *const PhysicsDebugLine {
        self.physics_debug_lines.as_ptr()
    }

    pub fn physics_debug_line_len(&self) -> usize {
        self.physics_debug_lines.len()
    }

    pub fn tilemap_navigation_path_point_ptr(&self) -> *const f32 {
        self.tilemap_navigation_path_points.as_ptr()
    }

    pub fn tilemap_navigation_path_point_len(&self) -> usize {
        self.tilemap_navigation_path_points.len() / 2
    }

    pub fn tilemap_navigation_debug_line_ptr(&self) -> *const PhysicsDebugLine {
        self.tilemap_navigation_debug_lines.as_ptr()
    }

    pub fn tilemap_navigation_debug_line_len(&self) -> usize {
        self.tilemap_navigation_debug_lines.len()
    }

    pub fn time(&self) -> f64 {
        self.elapsed_seconds
    }

    pub fn render_command_ptr(&self) -> *const SpriteRenderCommand {
        self.render_commands.as_ptr()
    }

    pub fn render_command_len(&self) -> usize {
        self.render_commands.len()
    }

    pub fn audio_event_ptr(&self) -> *const AudioEvent {
        self.audio_events.as_ptr()
    }

    pub fn audio_event_len(&self) -> usize {
        self.audio_events.len()
    }

    pub fn clear_events(&mut self) {
        self.clear_audio_events();
    }

    pub fn clear_audio_events(&mut self) {
        self.audio_events.clear();
    }

    pub fn score(&self) -> u32 {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.score(),
            ActiveScene::Breakout => self.breakout_scene.score(),
            ActiveScene::Platformer => self.platformer_scene.score(),
        }
    }

    pub fn entity_count(&self) -> usize {
        self.world.alive_count()
    }

    pub fn game_state(&self) -> u32 {
        self.game_state_code()
    }

    pub fn game_state_code(&self) -> u32 {
        let game_state = match self.active_scene {
            ActiveScene::Shooter => self.scene.game_state(),
            ActiveScene::Breakout => self.breakout_scene.game_state(),
            ActiveScene::Platformer => self.platformer_scene.game_state(),
        };
        match game_state {
            GameState::Title => 0,
            GameState::Playing => 1,
            GameState::GameOver => 2,
        }
    }

    pub fn sprite_count(&self) -> usize {
        self.render_commands.len()
    }

    pub fn camera_x(&self) -> f32 {
        self.camera.x
    }

    pub fn camera_y(&self) -> f32 {
        self.camera.y
    }

    pub fn reset_game(&mut self) {
        match self.active_scene {
            ActiveScene::Shooter => {
                self.scene
                    .reset_playing(&mut self.world, &mut self.camera, &mut self.audio_events);
            }
            ActiveScene::Breakout => self
                .breakout_scene
                .reset_playing(&mut self.world, &mut self.camera),
            ActiveScene::Platformer => self
                .platformer_scene
                .reset_playing(&mut self.world, &mut self.camera),
        }
        self.particles.clear();
        self.tweens.clear();
        self.clear_physics_history();
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    fn store_physics_query_entities<I>(&mut self, entities: I) -> u32
    where
        I: IntoIterator<Item = Entity>,
    {
        self.physics_query_hits.clear();
        self.physics_query_hits
            .extend(entities.into_iter().map(PhysicsQueryEntityHit::from_entity));
        u32::try_from(self.physics_query_hits.len()).unwrap_or(u32::MAX)
    }

    fn store_physics_raycast_hits<I>(&mut self, hits: I) -> u32
    where
        I: IntoIterator<Item = RaycastHit>,
    {
        self.physics_raycast_hits.clear();
        self.physics_raycast_hits.extend(
            hits.into_iter()
                .map(PhysicsRaycastBodyHit::from_raycast_hit),
        );
        u32::try_from(self.physics_raycast_hits.len()).unwrap_or(u32::MAX)
    }

    fn store_physics_shape_cast_hits(
        &mut self,
        shape: CollisionQueryShape,
        direction_x: f32,
        direction_y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> u32 {
        let hits = CollisionSystem::shape_cast_all(
            &self.world,
            shape,
            Velocity {
                vx: direction_x,
                vy: direction_y,
            },
            max_distance,
            CollisionMask::from_bits(query_mask_bits),
        );
        self.physics_raycast_hits.clear();
        self.physics_raycast_hits.extend(
            hits.into_iter()
                .map(PhysicsRaycastBodyHit::from_shape_cast_hit),
        );
        u32::try_from(self.physics_raycast_hits.len()).unwrap_or(u32::MAX)
    }

    fn store_physics_tile_shape_cast_hits<I>(&mut self, hits: I) -> u32
    where
        I: IntoIterator<Item = TilemapShapeCastHit>,
    {
        self.physics_tile_shape_cast_hits.clear();
        self.physics_tile_shape_cast_hits.extend(
            hits.into_iter()
                .map(PhysicsTileShapeCastHit::from_tilemap_shape_cast_hit),
        );
        u32::try_from(self.physics_tile_shape_cast_hits.len()).unwrap_or(u32::MAX)
    }

    fn store_physics_tile_contact_hits<I>(&mut self, hits: I) -> u32
    where
        I: IntoIterator<Item = TilemapContactHit>,
    {
        self.physics_tile_contact_hits.clear();
        self.physics_tile_contact_hits.extend(
            hits.into_iter()
                .map(PhysicsTileContactHit::from_tilemap_contact_hit),
        );
        u32::try_from(self.physics_tile_contact_hits.len()).unwrap_or(u32::MAX)
    }

    fn store_physics_tile_manifold_hits<I>(&mut self, hits: I) -> u32
    where
        I: IntoIterator<Item = TilemapContactManifoldHit>,
    {
        self.physics_tile_manifold_hits.clear();
        self.physics_tile_manifold_hits.extend(
            hits.into_iter()
                .map(PhysicsTileManifoldHit::from_tilemap_contact_manifold_hit),
        );
        u32::try_from(self.physics_tile_manifold_hits.len()).unwrap_or(u32::MAX)
    }

    fn store_physics_body_contacts<I>(&mut self, contacts: I) -> u32
    where
        I: IntoIterator<Item = CollisionContact>,
    {
        self.physics_body_contact_hits.clear();
        self.physics_body_contact_hits.extend(
            contacts
                .into_iter()
                .map(PhysicsBodyContactHit::from_collision_contact),
        );
        u32::try_from(self.physics_body_contact_hits.len()).unwrap_or(u32::MAX)
    }

    fn store_physics_body_manifolds<I>(&mut self, manifolds: I) -> u32
    where
        I: IntoIterator<Item = CollisionManifold>,
    {
        self.physics_body_manifold_hits.clear();
        self.physics_body_manifold_hits.extend(
            manifolds
                .into_iter()
                .map(PhysicsBodyManifoldHit::from_collision_manifold),
        );
        u32::try_from(self.physics_body_manifold_hits.len()).unwrap_or(u32::MAX)
    }

    fn store_physics_shape_query_entities(
        &mut self,
        shape: CollisionQueryShape,
        query_mask_bits: u32,
    ) -> u32 {
        let hits = CollisionSystem::shape_query(
            &self.world,
            shape,
            CollisionMask::from_bits(query_mask_bits),
        );
        self.store_physics_query_entities(hits.into_iter().map(|hit| hit.entity))
    }

    fn entity_from_handle(&self, entity_id: u32, entity_generation: u32) -> Option<Entity> {
        let index = entity_id as usize;
        if index < self.world.alive.len()
            && self.world.alive[index]
            && self.world.generations[index] == entity_generation
        {
            Some(Entity {
                id: entity_id,
                generation: entity_generation,
            })
        } else {
            None
        }
    }

    fn physics_body_collider_snapshot(
        &self,
        entity: Entity,
        collider_index: u32,
    ) -> Option<PhysicsBodyColliderSnapshot> {
        let body = self.world.rigid_body(entity)?;
        let entity_index = entity.id as usize;
        let collider = self
            .world
            .compound_collider_at(entity_index, collider_index as usize)?;
        let filter = self
            .world
            .compound_collision_filter_at(entity_index, collider_index as usize)
            .unwrap_or_else(|| CollisionFilter::from_layer(collider.layer()));
        let material_override = collider.material.is_some();
        let material = collider.material.unwrap_or(body.material);
        let (
            collider_type,
            collider_enabled,
            collider_is_trigger,
            collider_offset_x,
            collider_offset_y,
        ) = Self::compound_collider_state(collider);
        Some(PhysicsBodyColliderSnapshot {
            collider_index,
            collider_type,
            collider_enabled,
            collider_is_trigger,
            collider_offset_x,
            collider_offset_y,
            collider_material_override: material_override,
            collider_restitution: material.restitution,
            collider_friction: material.friction,
            collider_surface_velocity_x: material.surface_velocity.vx,
            collider_surface_velocity_y: material.surface_velocity.vy,
            collider_density: material.density,
            collider_contact_baumgarte_bias_scale: material.contact_baumgarte_bias_scale,
            collider_max_contact_baumgarte_bias_velocity_scale: material
                .max_contact_baumgarte_bias_velocity_scale,
            collider_contact_position_correction_scale: material.contact_position_correction_scale,
            collider_contact_position_correction_slop_scale: material
                .contact_position_correction_slop_scale,
            collider_category_bits: filter.category.bits,
            collider_mask_bits: filter.mask.bits,
        })
    }

    fn compound_collider_state(collider: CompoundCollider) -> (u32, bool, bool, f32, f32) {
        match collider.shape {
            CompoundColliderShape::Aabb(collider) => (
                PHYSICS_COLLIDER_TYPE_AABB,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShape::Circle(collider) => (
                PHYSICS_COLLIDER_TYPE_CIRCLE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShape::Capsule(collider) => (
                PHYSICS_COLLIDER_TYPE_CAPSULE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShape::Edge(collider) => (
                PHYSICS_COLLIDER_TYPE_EDGE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShape::Chain(collider) => (
                PHYSICS_COLLIDER_TYPE_CHAIN,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShape::OrientedBox(collider) => (
                PHYSICS_COLLIDER_TYPE_ORIENTED_BOX,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
            CompoundColliderShape::ConvexPolygon(collider) => (
                PHYSICS_COLLIDER_TYPE_CONVEX_POLYGON,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            ),
        }
    }

    fn physics_collider_snapshot(&self, entity: Entity) -> (u32, bool, bool, f32, f32) {
        if let Some(collider) = self.world.collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_AABB,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.circle_collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_CIRCLE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.capsule_collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_CAPSULE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.edge_collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_EDGE,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.chain_collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_CHAIN,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.oriented_box_collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_ORIENTED_BOX,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        if let Some(collider) = self.world.convex_polygon_collider(entity) {
            return (
                PHYSICS_COLLIDER_TYPE_CONVEX_POLYGON,
                collider.enabled,
                collider.is_trigger,
                collider.offset_x,
                collider.offset_y,
            );
        }
        (PHYSICS_COLLIDER_TYPE_NONE, false, false, 0.0, 0.0)
    }

    fn has_physics_collider(&self, entity: Entity) -> bool {
        self.physics_collider_snapshot(entity).0 != PHYSICS_COLLIDER_TYPE_NONE
    }

    fn physics_collider_material_snapshot(
        &self,
        entity: Entity,
        body_material: PhysicsMaterial,
    ) -> (bool, PhysicsMaterial) {
        match self.world.collider_material(entity) {
            Some(material) => (true, material),
            None => (false, body_material),
        }
    }

    fn add_physics_compound_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        shape: CompoundColliderShape,
        category_bits: u32,
        mask_bits: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() {
            return false;
        }
        let collider = CompoundCollider::new(shape).with_filter(CollisionFilter::new(
            CollisionMask::from_bits(category_bits),
            CollisionMask::from_bits(mask_bits),
        ));
        if self.world.add_compound_collider(entity, collider).is_none() {
            return false;
        }
        self.store_physics_entity_snapshot(entity)
    }

    fn store_shooter_snapshot(&mut self, snapshot: &ShooterSceneSnapshot) {
        self.shooter_snapshot_header_floats.clear();
        self.shooter_snapshot_header_u32s.clear();
        self.shooter_snapshot_entity_floats.clear();
        self.shooter_snapshot_entity_u32s.clear();

        self.shooter_snapshot_header_floats
            .extend_from_slice(&snapshot.header_floats);
        self.shooter_snapshot_header_u32s
            .extend_from_slice(&snapshot.header_u32s);
        self.shooter_snapshot_entity_floats
            .reserve(snapshot.entities.len() * SHOOTER_SNAPSHOT_ENTITY_FLOATS);
        self.shooter_snapshot_entity_u32s
            .reserve(snapshot.entities.len() * SHOOTER_SNAPSHOT_ENTITY_U32S);
        for entity in &snapshot.entities {
            self.shooter_snapshot_entity_floats
                .extend_from_slice(&entity.floats);
            self.shooter_snapshot_entity_u32s
                .extend_from_slice(&entity.u32s);
        }
    }

    fn store_physics_entity_snapshot(&mut self, entity: Entity) -> bool {
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

    fn append_physics_body_snapshot_bulk(
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

    fn restore_physics_body_snapshot_entry(
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
            if !self.set_physics_collider_offset(
                entity_id,
                entity_generation,
                floats[20],
                floats[21],
            ) || !self.set_physics_collider_enabled(
                entity_id,
                entity_generation,
                flags & PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_ENABLED != 0,
            ) {
                return false;
            }
            if flags & PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_MATERIAL_OVERRIDE != 0 {
                if !self.set_physics_collider_material(
                    entity_id,
                    entity_generation,
                    floats[22],
                    floats[23],
                    floats[24],
                    floats[25],
                    floats[26],
                    floats[27],
                    floats[28],
                    floats[29],
                    floats[30],
                ) {
                    return false;
                }
            } else if !self.clear_physics_collider_material(entity_id, entity_generation) {
                return false;
            }
        }
        self.store_physics_entity_snapshot(entity)
    }

    fn joint_snapshot_base(
        joint_type: u32,
        joint_index: u32,
        joint_generation: u32,
        entity_a: Entity,
        entity_b: Entity,
        enabled: bool,
    ) -> PhysicsJointSnapshot {
        PhysicsJointSnapshot {
            joint_type,
            joint_index,
            joint_generation,
            entity_a_id: entity_a.id,
            entity_a_generation: entity_a.generation,
            entity_b_id: entity_b.id,
            entity_b_generation: entity_b.generation,
            enabled,
            ..PhysicsJointSnapshot::default()
        }
    }

    fn store_distance_joint_snapshot(&mut self, id: DistanceJointId, joint: DistanceJoint) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            rest_length: joint.rest_length,
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_DISTANCE,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    fn store_rope_joint_snapshot(&mut self, id: RopeJointId, joint: RopeJoint) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            max_length: joint.max_length,
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_ROPE,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    fn store_spring_joint_snapshot(&mut self, id: SpringJointId, joint: SpringJoint) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            rest_length: joint.rest_length,
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_SPRING,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    fn store_pulley_joint_snapshot(&mut self, id: PulleyJointId, joint: PulleyJoint) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            rest_length: joint.rest_length,
            ratio: joint.ratio,
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            ground_anchor_a_x: joint.ground_anchor_a_x,
            ground_anchor_a_y: joint.ground_anchor_a_y,
            ground_anchor_b_x: joint.ground_anchor_b_x,
            ground_anchor_b_y: joint.ground_anchor_b_y,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_PULLEY,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    fn store_revolute_joint_snapshot(&mut self, id: RevoluteJointId, joint: RevoluteJoint) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            limit_enabled: joint.limit_enabled,
            lower_angle: joint.lower_angle,
            upper_angle: joint.upper_angle,
            motor_enabled: joint.motor_enabled,
            motor_speed: joint.motor_speed,
            max_motor_torque: joint.max_motor_torque,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_REVOLUTE,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    fn store_prismatic_joint_snapshot(
        &mut self,
        id: PrismaticJointId,
        joint: PrismaticJoint,
    ) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            reference_angle: joint.reference_angle,
            break_distance: joint.break_distance,
            stiffness: joint.stiffness,
            damping: joint.damping,
            angular_stiffness: joint.angular_stiffness,
            angular_damping: joint.angular_damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            local_axis_a_x: joint.local_axis_a_x,
            local_axis_a_y: joint.local_axis_a_y,
            limit_enabled: joint.limit_enabled,
            lower_translation: joint.lower_translation,
            upper_translation: joint.upper_translation,
            motor_enabled: joint.motor_enabled,
            motor_speed: joint.motor_speed,
            max_motor_force: joint.max_motor_force,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_PRISMATIC,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    fn store_weld_joint_snapshot(&mut self, id: WeldJointId, joint: WeldJoint) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            reference_angle: joint.reference_angle,
            break_distance: joint.break_distance,
            break_angle: joint.break_angle,
            stiffness: joint.stiffness,
            damping: joint.damping,
            angular_stiffness: joint.angular_stiffness,
            angular_damping: joint.angular_damping,
            local_anchor_a_x: joint.local_anchor_a_x,
            local_anchor_a_y: joint.local_anchor_a_y,
            local_anchor_b_x: joint.local_anchor_b_x,
            local_anchor_b_y: joint.local_anchor_b_y,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_WELD,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    fn store_gear_joint_snapshot(&mut self, id: GearJointId, joint: GearJoint) -> bool {
        self.physics_joint_snapshot = PhysicsJointSnapshot {
            ratio: joint.ratio,
            reference_angle: joint.reference_angle,
            break_angle: joint.break_angle,
            stiffness: joint.stiffness,
            damping: joint.damping,
            ..Self::joint_snapshot_base(
                PHYSICS_JOINT_GEAR,
                id.index,
                id.generation,
                joint.entity_a,
                joint.entity_b,
                joint.enabled,
            )
        };
        true
    }

    fn rigid_body_type_from_code(code: u32) -> Option<RigidBodyType> {
        match code {
            PHYSICS_BODY_TYPE_STATIC => Some(RigidBodyType::Static),
            PHYSICS_BODY_TYPE_KINEMATIC => Some(RigidBodyType::Kinematic),
            PHYSICS_BODY_TYPE_DYNAMIC => Some(RigidBodyType::Dynamic),
            _ => None,
        }
    }

    const fn rigid_body_type_code(body_type: RigidBodyType) -> u32 {
        match body_type {
            RigidBodyType::Static => PHYSICS_BODY_TYPE_STATIC,
            RigidBodyType::Kinematic => PHYSICS_BODY_TYPE_KINEMATIC,
            RigidBodyType::Dynamic => PHYSICS_BODY_TYPE_DYNAMIC,
        }
    }

    const fn collision_layer_from_code(code: u32) -> CollisionLayer {
        match code {
            PHYSICS_LAYER_ENEMY => CollisionLayer::Enemy,
            PHYSICS_LAYER_BULLET => CollisionLayer::Bullet,
            PHYSICS_LAYER_WALL => CollisionLayer::Wall,
            PHYSICS_LAYER_PLAYER => CollisionLayer::Player,
            _ => CollisionLayer::Player,
        }
    }

    fn rigid_body_for_aabb(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        half_width: f32,
        half_height: f32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                let width = half_width * 2.0;
                let height = half_height * 2.0;
                if use_density {
                    RigidBody::dynamic_box_with_density(mass_or_density, width, height)
                } else {
                    RigidBody::dynamic_box(mass_or_density, width, height)
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    fn rigid_body_for_circle(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        radius: f32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                if use_density {
                    RigidBody::dynamic_circle_with_density(mass_or_density, radius)
                } else {
                    RigidBody::dynamic_circle(mass_or_density, radius)
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    #[allow(clippy::too_many_arguments)]
    fn rigid_body_for_capsule(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                if use_density {
                    RigidBody::dynamic_capsule_with_density(
                        mass_or_density,
                        start_x,
                        start_y,
                        end_x,
                        end_y,
                        radius,
                    )
                } else {
                    RigidBody::dynamic_capsule(
                        mass_or_density,
                        start_x,
                        start_y,
                        end_x,
                        end_y,
                        radius,
                    )
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    #[allow(clippy::too_many_arguments)]
    fn rigid_body_for_edge(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                if use_density {
                    RigidBody::dynamic_capsule_with_density(
                        mass_or_density,
                        start_x,
                        start_y,
                        end_x,
                        end_y,
                        PHYSICS_EDGE_BODY_RADIUS,
                    )
                } else {
                    RigidBody::dynamic_capsule(
                        mass_or_density,
                        start_x,
                        start_y,
                        end_x,
                        end_y,
                        PHYSICS_EDGE_BODY_RADIUS,
                    )
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    fn rigid_body_for_chain(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        vertices: [Transform2D; MAX_CHAIN_COLLIDER_VERTICES],
        _vertex_count: u32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                let first = vertices[0];
                let second = vertices[1];
                if use_density {
                    RigidBody::dynamic_capsule_with_density(
                        mass_or_density,
                        first.x,
                        first.y,
                        second.x,
                        second.y,
                        PHYSICS_EDGE_BODY_RADIUS,
                    )
                } else {
                    RigidBody::dynamic_capsule(
                        mass_or_density,
                        first.x,
                        first.y,
                        second.x,
                        second.y,
                        PHYSICS_EDGE_BODY_RADIUS,
                    )
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    fn rigid_body_for_oriented_box(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        half_width: f32,
        half_height: f32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                if use_density {
                    RigidBody::dynamic_oriented_box_with_density(
                        mass_or_density,
                        half_width,
                        half_height,
                    )
                } else {
                    RigidBody::dynamic_oriented_box(mass_or_density, half_width, half_height)
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    fn rigid_body_for_convex_polygon(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: u32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                if use_density {
                    RigidBody::dynamic_convex_polygon_with_density(
                        mass_or_density,
                        vertices,
                        vertex_count,
                    )
                } else {
                    RigidBody::dynamic_convex_polygon(mass_or_density, vertices, vertex_count)
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    fn convex_polygon_vertices(
        vertex_values: &[f32],
    ) -> Option<([Transform2D; MAX_CONVEX_POLYGON_VERTICES], u32)> {
        if !vertex_values.len().is_multiple_of(2) {
            return None;
        }
        let vertex_count = vertex_values.len() / 2;
        if !(3..=MAX_CONVEX_POLYGON_VERTICES).contains(&vertex_count) {
            return None;
        }

        let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
        for (index, coords) in vertex_values.chunks_exact(2).enumerate() {
            if !Self::valid_transform(coords[0], coords[1]) {
                return None;
            }
            vertices[index] = Transform2D {
                x: coords[0],
                y: coords[1],
            };
        }

        Some((vertices, vertex_count as u32))
    }

    fn chain_vertices(
        vertex_values: &[f32],
        looped: bool,
    ) -> Option<([Transform2D; MAX_CHAIN_COLLIDER_VERTICES], u32)> {
        if !vertex_values.len().is_multiple_of(2) {
            return None;
        }
        let vertex_count = vertex_values.len() / 2;
        if !(2..=MAX_CHAIN_COLLIDER_VERTICES).contains(&vertex_count) {
            return None;
        }

        let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CHAIN_COLLIDER_VERTICES];
        for (index, coords) in vertex_values.chunks_exact(2).enumerate() {
            if !Self::valid_transform(coords[0], coords[1]) {
                return None;
            }
            vertices[index] = Transform2D {
                x: coords[0],
                y: coords[1],
            };
            if index > 0
                && !Self::valid_edge(
                    vertices[index - 1].x,
                    vertices[index - 1].y,
                    vertices[index].x,
                    vertices[index].y,
                )
            {
                return None;
            }
        }

        if looped
            && vertex_count > 2
            && vertices[vertex_count - 1] != vertices[0]
            && !Self::valid_edge(
                vertices[vertex_count - 1].x,
                vertices[vertex_count - 1].y,
                vertices[0].x,
                vertices[0].y,
            )
        {
            return None;
        }

        Some((vertices, vertex_count as u32))
    }

    const fn valid_transform(x: f32, y: f32) -> bool {
        x.is_finite() && y.is_finite()
    }

    const fn valid_positive(value: f32) -> bool {
        value.is_finite() && value > 0.0
    }

    const fn valid_edge(start_x: f32, start_y: f32, end_x: f32, end_y: f32) -> bool {
        if !Self::valid_transform(start_x, start_y) || !Self::valid_transform(end_x, end_y) {
            return false;
        }
        let dx = end_x - start_x;
        let dy = end_y - start_y;
        dx * dx + dy * dy > PHYSICS_EDGE_BODY_RADIUS * PHYSICS_EDGE_BODY_RADIUS
    }

    const fn valid_non_negative(value: f32) -> bool {
        value.is_finite() && value >= 0.0
    }

    const fn valid_unit_interval(value: f32) -> bool {
        value.is_finite() && value >= 0.0 && value <= 1.0
    }

    const fn valid_break_limit(value: f32) -> bool {
        value.is_infinite() && value.is_sign_positive() || value.is_finite() && value >= 0.0
    }

    #[allow(clippy::too_many_arguments)]
    const fn valid_physics_material_parts(
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
        Self::valid_non_negative(restitution)
            && Self::valid_non_negative(friction)
            && Self::valid_transform(surface_velocity_x, surface_velocity_y)
            && Self::valid_positive(density)
            && Self::valid_non_negative(contact_baumgarte_bias_scale)
            && Self::valid_non_negative(max_contact_baumgarte_bias_velocity_scale)
            && Self::valid_non_negative(contact_position_correction_scale)
            && Self::valid_non_negative(contact_position_correction_slop_scale)
    }

    #[allow(clippy::too_many_arguments)]
    const fn physics_material_from_parts(
        restitution: f32,
        friction: f32,
        surface_velocity_x: f32,
        surface_velocity_y: f32,
        density: f32,
        contact_baumgarte_bias_scale: f32,
        max_contact_baumgarte_bias_velocity_scale: f32,
        contact_position_correction_scale: f32,
        contact_position_correction_slop_scale: f32,
    ) -> PhysicsMaterial {
        PhysicsMaterial::new(restitution, friction)
            .with_surface_velocity(Velocity {
                vx: surface_velocity_x,
                vy: surface_velocity_y,
            })
            .with_density(density)
            .with_contact_baumgarte_bias_scale(contact_baumgarte_bias_scale)
            .with_max_contact_baumgarte_bias_velocity_scale(
                max_contact_baumgarte_bias_velocity_scale,
            )
            .with_contact_position_correction_scale(contact_position_correction_scale)
            .with_contact_position_correction_slop_scale(contact_position_correction_slop_scale)
    }

    fn convex_polygon_query_shape(vertex_values: &[f32]) -> Option<CollisionQueryShape> {
        if !vertex_values.len().is_multiple_of(2) {
            return None;
        }
        let vertex_count = vertex_values.len() / 2;
        if !(3..=MAX_CONVEX_POLYGON_VERTICES).contains(&vertex_count) {
            return None;
        }

        let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
        for (index, coords) in vertex_values.chunks_exact(2).enumerate() {
            vertices[index] = Transform2D {
                x: coords[0],
                y: coords[1],
            };
        }

        Some(CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count: vertex_count as u32,
        })
    }

    fn reset_to_title(&mut self) {
        match self.active_scene {
            ActiveScene::Shooter => {
                self.scene.reset_to_title(
                    &mut self.world,
                    &mut self.camera,
                    &mut self.audio_events,
                );
            }
            ActiveScene::Breakout => self
                .breakout_scene
                .reset_to_title(&mut self.world, &mut self.camera),
            ActiveScene::Platformer => self
                .platformer_scene
                .reset_to_title(&mut self.world, &mut self.camera),
        }
        self.particles.clear();
        self.tweens.clear();
        self.clear_physics_history();
    }

    fn update_scene(&mut self, delta: f32, input: InputState) {
        match self.active_scene {
            ActiveScene::Shooter => {
                let hit_particle_preset = self
                    .shooter_hit_particle_preset
                    .and_then(|preset_id| self.particle_presets.get(preset_id as usize))
                    .and_then(|preset| *preset);
                let hit_particles = hit_particle_preset
                    .map(|preset| ParticleBurstSink::new(&mut self.particles, preset));
                let hit_tweens = Some(TweenSink::new(&mut self.tweens));
                self.scene.update_with_counters(
                    &mut self.world,
                    &mut self.camera,
                    input,
                    &mut self.audio_events,
                    &self.tilemap,
                    delta,
                    &mut self.physics_counters,
                    &mut self.collision_events,
                    &mut self.collision_event_counts,
                    hit_particles,
                    hit_tweens,
                );
            }
            ActiveScene::Breakout => {
                let mut hit_particles = BreakoutParticleBurstSink::new(
                    &mut self.particles,
                    breakout_brick_hit_particle_preset(),
                );
                self.breakout_scene.update(
                    &mut self.world,
                    &mut self.camera,
                    input,
                    delta,
                    &mut self.collision_events,
                    &mut self.collision_event_counts,
                    Some(&mut hit_particles),
                );
            }
            ActiveScene::Platformer => {
                let mut landing_particles = PlatformerParticleBurstSink::new(
                    &mut self.particles,
                    platformer_landing_dust_particle_preset(),
                );
                self.platformer_scene.update(
                    &mut self.world,
                    &mut self.camera,
                    input,
                    delta,
                    &mut self.physics_counters,
                    Some(&mut landing_particles),
                );
            }
        }
    }

    fn clear_physics_frame(&mut self) {
        self.physics_counters.clear();
        self.collision_events.clear();
        self.collision_event_counts.clear();
        self.physics_debug_lines.clear();
        self.world.clear_rigid_body_ccd_debug_hits();
    }

    fn clear_physics_history(&mut self) {
        self.collision_event_tracker.clear();
        self.collision_events.clear();
        self.collision_event_counts.clear();
        self.physics_debug_lines.clear();
        self.world.clear_rigid_body_ccd_debug_hits();
        self.fixed_timestep.reset();
        self.rigid_body_step_stats = RigidBodyStepStats::default();
        self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
        self.physics_body_collider_snapshot = PhysicsBodyColliderSnapshot::default();
        self.physics_joint_snapshot = PhysicsJointSnapshot::default();
        self.last_fixed_update = FixedTimestepUpdate::default();
        self.fixed_timestep_input_latch.clear();
        self.previous_input_sample = self.input;
    }

    fn step_auto_rigid_bodies(&mut self, delta_seconds: f32) {
        if !self.auto_rigid_body_step_enabled {
            return;
        }
        self.rigid_body_step_stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut self.world,
            delta_seconds,
            self.auto_rigid_body_step_config,
        );
    }

    fn record_collision_events(&mut self) {
        let counts = self
            .collision_event_tracker
            .update(&self.world, &mut self.collision_events);
        let pair_counts = self.collision_event_tracker.current_pair_counts();
        self.physics_counters.collision_pairs = self
            .physics_counters
            .collision_pairs
            .saturating_add(pair_counts.total);
        self.physics_counters.collision_solid_pairs = self
            .physics_counters
            .collision_solid_pairs
            .saturating_add(pair_counts.solid);
        self.physics_counters.collision_trigger_pairs = self
            .physics_counters
            .collision_trigger_pairs
            .saturating_add(pair_counts.trigger);
        self.collision_event_counts.add(counts);
    }

    fn build_physics_debug_lines(&mut self) {
        if !self.physics_debug_lines_enabled || self.physics_debug_line_flags == 0 {
            self.physics_debug_lines.clear();
            return;
        }
        CollisionSystem::build_physics_debug_lines_with_flags_into(
            &self.world,
            16.0,
            self.physics_debug_line_flags,
            &mut self.physics_debug_lines,
        );
    }

    fn store_tilemap_navigation_path(
        tilemap_navigation_path_points: &mut Vec<f32>,
        tilemap_navigation_debug_lines: &mut Vec<PhysicsDebugLine>,
        from: Transform2D,
        path: &[Transform2D],
    ) -> (Transform2D, f32) {
        tilemap_navigation_path_points.clear();
        tilemap_navigation_debug_lines.clear();

        let mut previous = from;
        let mut distance = 0.0;
        for point in path.iter().copied() {
            tilemap_navigation_path_points.push(point.x);
            tilemap_navigation_path_points.push(point.y);
            distance += ((point.x - previous.x).powi(2) + (point.y - previous.y).powi(2)).sqrt();
            tilemap_navigation_debug_lines.push(PhysicsDebugLine {
                x0: previous.x,
                y0: previous.y,
                x1: point.x,
                y1: point.y,
                r: TILEMAP_NAVIGATION_DEBUG_COLOR[0],
                g: TILEMAP_NAVIGATION_DEBUG_COLOR[1],
                b: TILEMAP_NAVIGATION_DEBUG_COLOR[2],
                a: TILEMAP_NAVIGATION_DEBUG_COLOR[3],
            });
            previous = point;
        }

        (path.first().copied().unwrap_or(from), distance)
    }

    fn observe_input_sample(&mut self, input: InputState) {
        if self.fixed_timestep_enabled {
            self.fixed_timestep_input_latch
                .observe(self.previous_input_sample, input);
        }
        self.previous_input_sample = input;
    }

    fn fixed_step_input(&self, is_first_step: bool) -> InputState {
        if is_first_step {
            self.fixed_timestep_input_latch.apply_to(self.input)
        } else {
            self.input
        }
    }

    fn build_render_commands(&mut self) {
        self.render_commands.clear();
        self.tilemap
            .append_render_commands(&self.camera, &mut self.render_commands);
        for i in 0..self.world.transforms.len() {
            if !self.world.alive[i] {
                continue;
            }
            if let (Some(t), Some(s)) = (self.world.transforms[i], self.world.sprites[i]) {
                let screen = self.camera.world_to_screen(t);
                self.render_commands.push(SpriteRenderCommand {
                    x: screen.x - s.width * 0.5,
                    y: screen.y - s.height * 0.5,
                    width: s.width,
                    height: s.height,
                    u0: s.u0,
                    v0: s.v0,
                    u1: s.u1,
                    v1: s.v1,
                    r: s.r,
                    g: s.g,
                    b: s.b,
                    a: s.a,
                    texture_id: s.texture_id as f32,
                    effect_flags: SPRITE_EFFECT_NONE,
                });
            }
        }
        self.particles
            .append_render_commands(&self.camera, &mut self.render_commands);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collision_event::{
        COLLISION_EVENT_ENTER, COLLISION_EVENT_EXIT, COLLISION_EVENT_HIT, COLLISION_EVENT_STAY,
        COLLISION_EVENT_TRIGGER_ENTER, COLLISION_EVENT_TRIGGER_EXIT, COLLISION_EVENT_TRIGGER_STAY,
    };
    use crate::components::{
        AabbCollider, CollisionFilter, CollisionLayer, CollisionMask, RigidBody, Transform2D,
        Velocity,
    };
    use crate::physics::PhysicsSystem;
    use crate::shooter_scene::DEFAULT_TEXTURE_ID;

    fn count_layer(engine: &Engine, layer: CollisionLayer) -> usize {
        engine
            .world
            .alive
            .iter()
            .enumerate()
            .filter(|(idx, alive)| {
                **alive && engine.world.colliders[*idx].is_some_and(|c| c.layer == layer)
            })
            .count()
    }

    fn find_layer(engine: &Engine, layer: CollisionLayer) -> crate::entity::Entity {
        engine
            .world
            .alive
            .iter()
            .enumerate()
            .find_map(|(idx, alive)| {
                if *alive
                    && engine.world.colliders[idx].is_some_and(|collider| collider.layer == layer)
                {
                    Some(crate::entity::Entity {
                        id: idx as u32,
                        generation: engine.world.generations[idx],
                    })
                } else {
                    None
                }
            })
            .expect("scene should contain requested collision layer")
    }

    fn find_lowest_layer(engine: &Engine, layer: CollisionLayer) -> crate::entity::Entity {
        engine
            .world
            .alive
            .iter()
            .enumerate()
            .filter_map(|(idx, alive)| {
                let transform = engine.world.transforms[idx]?;
                if *alive
                    && engine.world.colliders[idx].is_some_and(|collider| collider.layer == layer)
                {
                    Some((
                        transform.y,
                        crate::entity::Entity {
                            id: idx as u32,
                            generation: engine.world.generations[idx],
                        },
                    ))
                } else {
                    None
                }
            })
            .max_by(|(left_y, _), (right_y, _)| left_y.total_cmp(right_y))
            .map(|(_, entity)| entity)
            .expect("scene should contain requested collision layer")
    }

    fn set_test_particle_preset(
        engine: &mut Engine,
        preset_id: u32,
        texture_id: u32,
        burst_count: u32,
        lifetime_seconds: f32,
    ) {
        engine.set_particle_preset(
            preset_id,
            texture_id,
            0.0,
            0.0,
            1.0,
            1.0,
            burst_count,
            lifetime_seconds,
            lifetime_seconds,
            0.0,
            0.0,
            6.0,
            6.0,
            6.0,
            6.0,
            1.0,
            0.8,
            0.2,
            1.0,
            1.0,
            0.2,
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
        );
    }

    #[test]
    fn reset_game_clears_score_and_recreates_player() {
        let mut engine = Engine::new();
        engine.scene.update(
            &mut engine.world,
            &mut engine.camera,
            InputState {
                space: 1,
                ..InputState::default()
            },
            &mut engine.audio_events,
            &Tilemap::default(),
            0.016,
        );
        engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

        engine.reset_game();

        assert_eq!(engine.score(), 0);
        assert!(engine.world.player.is_some());
        assert_eq!(count_layer(&engine, CollisionLayer::Player), 1);
        assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 0);
    }

    #[test]
    fn engine_can_switch_to_breakout_scene() {
        let mut engine = Engine::new();

        engine.use_breakout_scene();
        engine.update(0.016);

        assert_eq!(engine.game_state(), 0);
        assert_eq!(engine.score(), 0);
        assert_eq!(engine.entity_count(), 55);
        assert_eq!(engine.sprite_count(), 55);

        engine.set_input(false, false, false, false, false, true, false, 0.0, 0.0);
        engine.update(0.016);

        assert_eq!(engine.game_state(), 1);
        assert_eq!(count_layer(&engine, CollisionLayer::Wall), 3);
    }

    #[test]
    fn breakout_brick_hit_spawns_default_particle_burst() {
        let mut engine = Engine::new();
        engine.use_breakout_scene();
        engine.reset_game();
        let ball = find_layer(&engine, CollisionLayer::Bullet);
        let brick = find_lowest_layer(&engine, CollisionLayer::Enemy);
        let brick_transform =
            engine.world.transforms[brick.id as usize].expect("brick has transform");
        let brick_collider = engine.world.colliders[brick.id as usize].expect("brick has collider");
        let ball_collider = engine.world.colliders[ball.id as usize].expect("ball has collider");
        engine.world.transforms[ball.id as usize] = Some(Transform2D {
            x: brick_transform.x,
            y: brick_transform.y + brick_collider.half_height + ball_collider.half_height + 1.0,
        });
        engine.world.velocities[ball.id as usize] = Some(crate::components::Velocity {
            vx: 0.0,
            vy: -285.0,
        });

        engine.update(0.1);

        assert_eq!(engine.collision_hit_count(), 1);
        assert_eq!(engine.particle_count(), 10);
        assert!(!engine.world.alive[brick.id as usize]);
        assert!(engine.render_commands.len() > engine.entity_count());
        assert!(engine
            .render_commands
            .iter()
            .any(|command| command.width < 10.0));
    }

    #[test]
    fn engine_can_switch_to_platformer_scene() {
        let mut engine = Engine::new();

        engine.use_platformer_scene();
        engine.update(0.016);

        assert_eq!(engine.game_state(), 0);
        assert_eq!(engine.score(), 0);
        assert_eq!(engine.entity_count(), 8);
        assert_eq!(engine.sprite_count(), 8);
        assert_eq!(count_layer(&engine, CollisionLayer::Wall), 6);
        assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);

        engine.set_input(false, false, false, false, false, true, false, 0.0, 0.0);
        engine.update(0.016);
        engine.set_input(false, false, false, true, false, false, false, 0.0, 0.0);
        engine.update(0.25);

        assert_eq!(engine.game_state(), 1);
        assert!(engine.physics_kinematic_moves() > 0);
    }

    #[test]
    fn platformer_landing_spawns_default_dust_burst() {
        let mut engine = Engine::new();
        engine.use_platformer_scene();
        engine.reset_game();
        let player = find_layer(&engine, CollisionLayer::Player);
        engine.world.set_transform(
            player,
            Transform2D {
                x: 96.0,
                y: 640.0 - 48.0 - 36.0 * 0.5 - 18.0,
            },
        );
        engine
            .world
            .set_velocity(player, crate::components::Velocity { vx: 0.0, vy: 220.0 });

        engine.update(0.1);

        assert_eq!(engine.particle_count(), 12);
        assert!(engine.render_commands.len() > engine.entity_count());
        assert!(engine
            .render_commands
            .iter()
            .any(|command| command.width < 9.0));
    }

    #[test]
    fn player_render_command_uses_centered_transform() {
        let mut engine = Engine::new();
        engine.build_render_commands();

        let command = engine.render_commands[0];
        assert!((command.x - 382.0).abs() < 0.01);
        assert!((command.y - 222.0).abs() < 0.01);
    }

    #[test]
    fn camera_follows_player_and_offsets_render_commands() {
        let mut engine = Engine::new();
        engine.set_viewport_size(400.0, 240.0);
        let player = engine.world.player.unwrap();
        engine.world.transforms[player.id as usize] = Some(Transform2D {
            x: 1000.0,
            y: 600.0,
        });

        engine
            .scene
            .update_camera_follow(&engine.world, &mut engine.camera);
        engine.build_render_commands();

        assert_eq!(engine.camera_x(), 1000.0);
        assert_eq!(engine.camera_y(), 600.0);
        let command = engine.render_commands[0];
        assert!((command.x - 182.0).abs() < 0.01);
        assert!((command.y - 102.0).abs() < 0.01);
    }

    #[test]
    fn fixed_timestep_is_opt_in_and_reports_steps() {
        let mut engine = Engine::new();

        engine.update(0.25);

        assert!(!engine.fixed_timestep_enabled());
        assert_eq!(engine.physics_fixed_steps(), 0);

        engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
        engine.update(0.25);

        assert!(engine.fixed_timestep_enabled());
        assert_eq!(engine.physics_fixed_steps(), 2);
        assert!((engine.fixed_timestep_alpha() - 0.5).abs() < 0.01);
        assert!((engine.fixed_timestep_consumed_seconds() - 0.2).abs() < 0.01);
    }

    #[test]
    fn fixed_timestep_waits_until_accumulator_reaches_step() {
        let mut engine = Engine::new();
        engine.configure_fixed_timestep(true, 0.1, 1.0, 4);

        engine.update(0.05);

        assert_eq!(engine.physics_fixed_steps(), 0);
        assert!((engine.fixed_timestep_alpha() - 0.5).abs() < 0.01);
        assert!(engine.collision_events.is_empty());
    }

    #[test]
    fn fixed_timestep_latches_action_input_until_next_step() {
        let mut engine = Engine::new();
        engine.configure_fixed_timestep(true, 0.1, 1.0, 4);

        engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
        engine.update(0.05);
        assert_eq!(engine.physics_fixed_steps(), 0);
        assert_eq!(engine.game_state_code(), 0);

        engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
        engine.update(0.05);

        assert_eq!(engine.physics_fixed_steps(), 1);
        assert_eq!(engine.game_state_code(), 1);
    }

    #[test]
    fn engine_collision_events_report_enter_stay_and_exit() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let a = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        let b = spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);

        engine.update(0.016);
        assert_eq!(engine.collision_enter_count(), 1);
        assert_eq!(engine.collision_event_len(), 1);
        assert_eq!(engine.physics_collision_pairs(), 1);
        assert_eq!(engine.physics_collision_solid_pairs(), 1);
        assert_eq!(engine.physics_collision_trigger_pairs(), 0);
        assert_eq!(engine.collision_events[0].kind, COLLISION_EVENT_ENTER);

        engine.update(0.016);
        assert_eq!(engine.collision_stay_count(), 1);
        assert_eq!(engine.collision_events[0].kind, COLLISION_EVENT_STAY);

        engine
            .world
            .set_transform(b, Transform2D { x: 40.0, y: 0.0 });
        engine.update(0.016);
        assert_eq!(engine.collision_exit_count(), 1);
        assert_eq!(engine.physics_collision_pairs(), 0);
        assert_eq!(engine.physics_collision_solid_pairs(), 0);
        assert_eq!(engine.physics_collision_trigger_pairs(), 0);
        assert_eq!(engine.collision_events[0].kind, COLLISION_EVENT_EXIT);
        assert_eq!(engine.collision_events[0].a_id, a.id.min(b.id));
    }

    #[test]
    fn engine_collision_events_report_trigger_lifecycle_counts() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let sensor =
            spawn_test_body_with_trigger(&mut engine.world, 0.0, 0.0, CollisionLayer::Player, true);
        let actor = spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);

        engine.update(0.016);
        assert_eq!(engine.collision_enter_count(), 0);
        assert_eq!(engine.collision_trigger_enter_count(), 1);
        assert_eq!(engine.physics_collision_pairs(), 1);
        assert_eq!(engine.physics_collision_solid_pairs(), 0);
        assert_eq!(engine.physics_collision_trigger_pairs(), 1);
        assert_eq!(
            engine.collision_events[0].kind,
            COLLISION_EVENT_TRIGGER_ENTER
        );

        engine.update(0.016);
        assert_eq!(engine.collision_stay_count(), 0);
        assert_eq!(engine.collision_trigger_stay_count(), 1);
        assert_eq!(
            engine.collision_events[0].kind,
            COLLISION_EVENT_TRIGGER_STAY
        );

        engine
            .world
            .set_transform(actor, Transform2D { x: 40.0, y: 0.0 });
        engine.update(0.016);
        assert_eq!(engine.collision_exit_count(), 0);
        assert_eq!(engine.collision_trigger_exit_count(), 1);
        assert_eq!(engine.physics_collision_pairs(), 0);
        assert_eq!(engine.physics_collision_solid_pairs(), 0);
        assert_eq!(engine.physics_collision_trigger_pairs(), 0);
        assert_eq!(
            engine.collision_events[0].kind,
            COLLISION_EVENT_TRIGGER_EXIT
        );
        assert_eq!(engine.collision_events[0].a_id, sensor.id.min(actor.id));
    }

    #[test]
    fn physics_debug_lines_are_opt_in_and_report_broadphase_and_contacts() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);

        engine.update(0.016);
        assert_eq!(engine.physics_debug_line_len(), 0);

        engine.set_physics_debug_lines_enabled(true);
        engine.update(0.016);

        assert_eq!(engine.physics_debug_line_len(), 11);
        assert_eq!(engine.physics_debug_lines[0].x0, -5.0);
        assert_eq!(engine.physics_debug_lines[0].x1, 5.0);
        assert_eq!(engine.physics_debug_lines[8].x0, 5.0);
        assert_eq!(engine.physics_debug_lines[8].x1, 21.0);
        assert_eq!(engine.physics_debug_lines[9].y0, 0.0);
        assert_eq!(engine.physics_debug_lines[10].x0, 5.0);
        assert_eq!(engine.physics_debug_lines[10].y0, -3.0);

        engine.set_physics_debug_lines_enabled(false);
        assert_eq!(engine.physics_debug_line_len(), 0);
    }

    #[test]
    fn physics_debug_lines_report_ccd_hit_markers() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let mover = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        engine
            .world
            .set_rigid_body(mover, RigidBody::dynamic(1.0).with_sleeping_enabled(false));
        engine
            .world
            .set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
        let wall = spawn_test_body(&mut engine.world, 50.0, 0.0, CollisionLayer::Wall);
        engine.world.set_rigid_body(wall, RigidBody::static_body());
        engine.set_physics_debug_line_flags(crate::collision::PHYSICS_DEBUG_CCD);
        engine.set_physics_debug_lines_enabled(true);

        engine.step_rigid_bodies_with_config(1.0, 0.0, 0.0, 1, 1, 1.0, 0.0, 1.0, 0.2, 120.0, false);
        engine.build_physics_debug_lines();

        assert_eq!(engine.rigid_body_step_ccd_hits(), 1);
        assert_eq!(engine.physics_debug_line_len(), 3);
        assert!((engine.physics_debug_lines[0].x0 - 41.0).abs() < 0.001);
        assert!((engine.physics_debug_lines[0].x1 - 49.0).abs() < 0.001);
        assert_eq!(engine.physics_debug_lines[0].y0, 0.0);
        assert!((engine.physics_debug_lines[1].y0 + 4.0).abs() < 0.001);
        assert!((engine.physics_debug_lines[1].y1 - 4.0).abs() < 0.001);
        assert!((engine.physics_debug_lines[2].x0 - 45.0).abs() < 0.001);
        assert!((engine.physics_debug_lines[2].x1 - 57.0).abs() < 0.001);
    }

    #[test]
    fn physics_debug_line_abi_matches_float_buffer() {
        assert_eq!(crate::physics_debug_line_floats(), 8);
        assert_eq!(crate::physics_debug_line_bytes(), 32);
    }

    #[test]
    fn physics_raycast_hit_abi_matches_mixed_buffer() {
        assert_eq!(crate::physics_raycast_hit_bytes(), 28);
    }

    #[test]
    fn physics_tile_shape_cast_hit_abi_matches_mixed_buffer() {
        assert_eq!(crate::physics_tile_shape_cast_hit_bytes(), 28);
        assert_eq!(crate::physics_tile_contact_hit_bytes(), 28);
        assert_eq!(crate::physics_tile_manifold_hit_bytes(), 48);
    }

    #[test]
    fn physics_body_contact_and_manifold_hit_abi_matches_mixed_buffer() {
        assert_eq!(crate::physics_body_contact_hit_bytes(), 36);
        assert_eq!(crate::physics_body_manifold_hit_bytes(), 56);
    }

    #[test]
    fn physics_rigid_contact_impulse_hit_abi_matches_mixed_buffer() {
        assert_eq!(crate::physics_rigid_contact_impulse_hit_bytes(), 40);
    }

    #[test]
    fn engine_query_nearest_body_stores_scalar_result_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        let enemy = spawn_test_body(&mut engine.world, 20.0, 0.0, CollisionLayer::Enemy);

        assert!(engine.query_nearest_body(0.0, 0.0, 100.0, CollisionMask::ENEMY.bits));

        assert_eq!(engine.physics_query_entity_id(), enemy.id);
        assert_eq!(engine.physics_query_entity_generation(), enemy.generation);
        assert_eq!(engine.physics_query_point_x(), 15.0);
        assert_eq!(engine.physics_query_point_y(), 0.0);
        assert_eq!(engine.physics_query_distance(), 15.0);

        assert!(!engine.query_nearest_body(0.0, 0.0, 1.0, CollisionMask::ENEMY.bits));
        assert_eq!(engine.physics_query_entity_id(), 0);
        assert_eq!(engine.physics_query_distance(), 0.0);
    }

    #[test]
    fn engine_query_body_contacts_and_manifolds_write_bulk_results_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let player = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        let enemy = spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Enemy);
        spawn_test_body(&mut engine.world, 40.0, 0.0, CollisionLayer::Enemy);

        let contact_count =
            engine.query_body_contacts(CollisionMask::PLAYER.bits, CollisionMask::ENEMY.bits);

        assert_eq!(contact_count, 1);
        assert_eq!(engine.physics_body_contact_hit_len(), 1);
        assert_eq!(
            engine.physics_body_contact_hits,
            vec![PhysicsBodyContactHit {
                a_entity_id: player.id,
                a_entity_generation: player.generation,
                b_entity_id: enemy.id,
                b_entity_generation: enemy.generation,
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 2.0,
                point_x: 5.0,
                point_y: 0.0,
            }]
        );
        assert_eq!(
            engine.physics_body_contact_hit_ptr(),
            engine.physics_body_contact_hits.as_ptr()
        );

        let manifold_count =
            engine.query_body_manifolds(CollisionMask::ENEMY.bits, CollisionMask::PLAYER.bits);

        assert_eq!(manifold_count, 1);
        assert_eq!(engine.physics_body_manifold_hit_len(), 1);
        assert_eq!(engine.physics_body_manifold_hits[0].a_entity_id, enemy.id);
        assert_eq!(engine.physics_body_manifold_hits[0].b_entity_id, player.id);
        assert_eq!(engine.physics_body_manifold_hits[0].point_count, 2);
        assert_eq!(
            engine.physics_body_manifold_hit_ptr(),
            engine.physics_body_manifold_hits.as_ptr()
        );

        let miss_count =
            engine.query_body_contacts(CollisionMask::BULLET.bits, CollisionMask::ENEMY.bits);

        assert_eq!(miss_count, 0);
        assert!(engine.physics_body_contact_hits.is_empty());
    }

    #[test]
    fn engine_query_rigid_contact_impulses_writes_bulk_results_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let body = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        let ground = spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Wall);
        engine.world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 10.0, 10.0).with_sleeping_enabled(false),
        );
        engine
            .world
            .set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
        engine
            .world
            .set_rigid_body(ground, RigidBody::static_body());

        let stats = PhysicsSystem::step_rigid_bodies(&mut engine.world, 1.0 / 60.0);
        let impulse_count = engine.query_rigid_contact_impulses();

        assert_eq!(impulse_count, stats.contact_cache_entries);
        assert_eq!(
            engine.physics_rigid_contact_impulse_hit_len(),
            impulse_count as usize
        );
        assert_eq!(
            engine.physics_rigid_contact_impulse_hit_ptr(),
            engine.physics_rigid_contact_impulse_hits.as_ptr()
        );
        assert!(engine
            .physics_rigid_contact_impulse_hits
            .iter()
            .any(|hit| hit.a_entity_id == body.id
                && hit.a_entity_generation == body.generation
                && hit.b_entity_id == ground.id
                && hit.b_entity_generation == ground.generation
                && hit.normal_impulse > 0.0));
    }

    #[test]
    fn engine_step_rigid_bodies_exposes_stats_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let body = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        let ground = spawn_test_body(&mut engine.world, 8.0, 0.0, CollisionLayer::Wall);
        engine.world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 10.0, 10.0).with_sleeping_enabled(false),
        );
        engine
            .world
            .set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
        engine
            .world
            .set_rigid_body(ground, RigidBody::static_body());

        engine.step_rigid_bodies(1.0 / 60.0);

        assert_eq!(engine.rigid_body_step_substeps(), 1);
        assert_eq!(engine.rigid_body_step_dynamic_bodies(), 1);
        assert!(engine.rigid_body_step_contact_checks() > 0);
        assert!(engine.rigid_body_step_velocity_impulses() > 0);
        assert_eq!(
            engine.query_rigid_contact_impulses(),
            engine.rigid_body_step_contact_cache_entries()
        );
    }

    #[test]
    fn engine_step_rigid_bodies_with_config_uses_wasm_options() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let body = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        engine
            .world
            .set_rigid_body(body, RigidBody::dynamic(1.0).with_sleeping_enabled(false));

        engine
            .step_rigid_bodies_with_config(0.5, 10.0, 0.0, 1, 1, 0.8, 0.01, 1.0, 0.2, 120.0, false);

        let velocity = engine
            .world
            .velocity(body)
            .expect("rigid body should have a velocity component");
        assert!(velocity.vx > 0.0);
        assert_eq!(engine.rigid_body_step_substeps(), 1);
        assert_eq!(engine.rigid_body_step_dynamic_bodies(), 1);
        assert_eq!(engine.rigid_body_step_contact_checks(), 0);
    }

    #[test]
    fn engine_auto_rigid_body_step_runs_inside_update() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let body = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        engine
            .world
            .set_rigid_body(body, RigidBody::dynamic(1.0).with_sleeping_enabled(false));

        engine.configure_auto_rigid_body_step(
            true, 0.0, 20.0, 1, 1, 0.8, 0.01, 1.0, 0.2, 120.0, false,
        );
        engine.update(0.5);

        let velocity = engine
            .world
            .velocity(body)
            .expect("auto-stepped rigid body should keep velocity");
        assert!(velocity.vy > 0.0);
        assert_eq!(engine.rigid_body_step_substeps(), 1);
        assert_eq!(engine.rigid_body_step_dynamic_bodies(), 1);

        engine.configure_auto_rigid_body_step(
            false, 0.0, 20.0, 1, 1, 0.8, 0.01, 1.0, 0.2, 120.0, false,
        );
        assert_eq!(engine.rigid_body_step_dynamic_bodies(), 0);
    }

    #[test]
    fn engine_spawn_physics_aabb_body_authoring_steps_and_queries_snapshot() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();

        assert!(engine.spawn_physics_aabb_body(
            0.0,
            0.0,
            5.0,
            5.0,
            PHYSICS_BODY_TYPE_DYNAMIC,
            1.0,
            true,
            PHYSICS_LAYER_PLAYER,
            CollisionMask::PLAYER.bits,
            CollisionMask::WALL.bits,
            false,
            true,
            true,
            false,
        ));
        let body_id = engine.physics_entity_id();
        let body_generation = engine.physics_entity_generation();
        assert_eq!(engine.physics_entity_body_type(), PHYSICS_BODY_TYPE_DYNAMIC);
        assert!(engine.set_physics_body_velocity(body_id, body_generation, 10.0, 0.0));

        assert!(engine.spawn_physics_aabb_body(
            8.0,
            0.0,
            5.0,
            5.0,
            PHYSICS_BODY_TYPE_STATIC,
            1.0,
            true,
            PHYSICS_LAYER_WALL,
            CollisionMask::WALL.bits,
            CollisionMask::PLAYER.bits,
            false,
            true,
            true,
            false,
        ));

        engine.step_rigid_bodies(1.0 / 60.0);

        assert_eq!(engine.rigid_body_step_dynamic_bodies(), 1);
        assert!(engine.rigid_body_step_contact_checks() > 0);
        assert!(engine.rigid_body_step_velocity_impulses() > 0);
        assert!(engine.query_physics_entity(body_id, body_generation));
        assert_eq!(engine.physics_entity_id(), body_id);
        assert_eq!(engine.physics_entity_generation(), body_generation);
        assert!(engine.physics_entity_velocity_x() < 10.0);
    }

    #[test]
    fn engine_queries_compound_collider_snapshot_for_replay_state() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();

        assert!(engine.spawn_physics_aabb_body(
            0.0,
            0.0,
            5.0,
            5.0,
            PHYSICS_BODY_TYPE_DYNAMIC,
            1.0,
            true,
            PHYSICS_LAYER_PLAYER,
            CollisionMask::PLAYER.bits,
            CollisionMask::WALL.bits,
            false,
            true,
            true,
            false,
        ));
        let body_id = engine.physics_entity_id();
        let body_generation = engine.physics_entity_generation();
        assert_eq!(
            engine.physics_body_collider_count(body_id, body_generation),
            1
        );

        assert!(engine.add_physics_circle_collider(
            body_id,
            body_generation,
            3.0,
            1.0,
            2.0,
            PHYSICS_LAYER_ENEMY,
            CollisionMask::ENEMY.bits,
            CollisionMask::PLAYER.bits,
            true,
            false,
        ));
        assert_eq!(
            engine.physics_body_collider_count(body_id, body_generation),
            2
        );
        assert!(engine.set_physics_compound_collider_material(
            body_id,
            body_generation,
            1,
            0.25,
            0.75,
            2.0,
            -1.0,
            1.5,
            0.5,
            0.4,
            0.3,
            0.2,
        ));

        assert!(engine.query_physics_body_collider(body_id, body_generation, 1));
        assert_eq!(engine.physics_body_collider_index(), 1);
        assert_eq!(
            engine.physics_body_collider_type(),
            PHYSICS_COLLIDER_TYPE_CIRCLE
        );
        assert!(!engine.physics_body_collider_enabled());
        assert!(engine.physics_body_collider_is_trigger());
        assert!((engine.physics_body_collider_offset_x() - 1.0).abs() < 0.0001);
        assert!((engine.physics_body_collider_offset_y() - 2.0).abs() < 0.0001);
        assert!(engine.physics_body_collider_material_override());
        assert!((engine.physics_body_collider_restitution() - 0.25).abs() < 0.0001);
        assert!((engine.physics_body_collider_friction() - 0.75).abs() < 0.0001);
        assert!((engine.physics_body_collider_surface_velocity_x() - 2.0).abs() < 0.0001);
        assert!((engine.physics_body_collider_surface_velocity_y() + 1.0).abs() < 0.0001);
        assert!((engine.physics_body_collider_density() - 1.5).abs() < 0.0001);
        assert!((engine.physics_body_collider_contact_baumgarte_bias_scale() - 0.5).abs() < 0.0001);
        assert!(
            (engine.physics_body_collider_max_contact_baumgarte_bias_velocity_scale() - 0.4).abs()
                < 0.0001
        );
        assert!(
            (engine.physics_body_collider_contact_position_correction_scale() - 0.3).abs() < 0.0001
        );
        assert!(
            (engine.physics_body_collider_contact_position_correction_slop_scale() - 0.2).abs()
                < 0.0001
        );
        assert_eq!(
            engine.physics_body_collider_category_bits(),
            CollisionMask::ENEMY.bits
        );
        assert_eq!(
            engine.physics_body_collider_mask_bits(),
            CollisionMask::PLAYER.bits
        );
        assert!(!engine.query_physics_body_collider(body_id, body_generation, 2));
    }

    #[test]
    fn engine_spawn_physics_body_shapes_and_controls_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();

        assert!(engine.spawn_physics_circle_body(
            0.0,
            0.0,
            4.0,
            PHYSICS_BODY_TYPE_DYNAMIC,
            1.0,
            true,
            PHYSICS_LAYER_PLAYER,
            CollisionMask::PLAYER.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        let circle_id = engine.physics_entity_id();
        let circle_generation = engine.physics_entity_generation();
        assert!(engine.set_physics_body_position(circle_id, circle_generation, 2.0, -3.0));
        assert!(engine.set_physics_collider_offset(circle_id, circle_generation, 1.0, 0.0));
        assert!(engine.set_physics_collider_enabled(circle_id, circle_generation, false));
        assert!(engine.query_physics_entity(circle_id, circle_generation));
        assert!((engine.physics_entity_x() - 2.0).abs() < 0.0001);
        assert!((engine.physics_entity_y() + 3.0).abs() < 0.0001);
        assert_eq!(
            engine.physics_entity_collider_type(),
            PHYSICS_COLLIDER_TYPE_CIRCLE
        );
        assert!(!engine.physics_entity_collider_enabled());
        assert!(!engine.physics_entity_collider_is_trigger());
        assert!((engine.physics_entity_collider_offset_x() - 1.0).abs() < 0.0001);
        assert!(engine.physics_entity_collider_offset_y().abs() < 0.0001);
        assert!(engine.set_physics_collider_enabled(circle_id, circle_generation, true));
        assert!(engine.set_physics_body_tuning(circle_id, circle_generation, 0.0, 0.0, 0.0));
        assert!(engine.set_physics_body_material(
            circle_id,
            circle_generation,
            0.1,
            0.5,
            1.0,
            -2.0,
            1.25,
            0.8,
            0.9,
            0.7,
            0.6,
        ));
        assert!(engine.set_physics_body_tuning(circle_id, circle_generation, 0.5, 0.2, 0.3));
        assert!(engine.set_physics_body_mass_properties(circle_id, circle_generation, 2.5, 7.5,));
        assert!(!engine.set_physics_body_mass_properties(circle_id, circle_generation, 0.0, 7.5,));
        assert!(engine.query_physics_entity(circle_id, circle_generation));
        assert!((engine.physics_entity_mass() - 2.5).abs() < 0.0001);
        assert!((engine.physics_entity_inverse_mass() - 0.4).abs() < 0.0001);
        assert!((engine.physics_entity_inertia() - 7.5).abs() < 0.0001);
        assert!((engine.physics_entity_inverse_inertia() - (1.0 / 7.5)).abs() < 0.0001);
        assert!((engine.physics_entity_gravity_scale() - 0.5).abs() < 0.0001);
        assert!((engine.physics_entity_linear_damping() - 0.2).abs() < 0.0001);
        assert!((engine.physics_entity_angular_damping() - 0.3).abs() < 0.0001);
        assert!((engine.physics_entity_restitution() - 0.1).abs() < 0.0001);
        assert!((engine.physics_entity_friction() - 0.5).abs() < 0.0001);
        assert!((engine.physics_entity_surface_velocity_x() - 1.0).abs() < 0.0001);
        assert!((engine.physics_entity_surface_velocity_y() + 2.0).abs() < 0.0001);
        assert!((engine.physics_entity_density() - 1.25).abs() < 0.0001);
        assert!((engine.physics_entity_contact_baumgarte_bias_scale() - 0.8).abs() < 0.0001);
        assert!(
            (engine.physics_entity_max_contact_baumgarte_bias_velocity_scale() - 0.9).abs()
                < 0.0001
        );
        assert!((engine.physics_entity_contact_position_correction_scale() - 0.7).abs() < 0.0001);
        assert!(
            (engine.physics_entity_contact_position_correction_slop_scale() - 0.6).abs() < 0.0001
        );
        assert!(!engine.physics_entity_collider_material_override());
        assert!((engine.physics_entity_collider_restitution() - 0.1).abs() < 0.0001);
        assert!((engine.physics_entity_collider_friction() - 0.5).abs() < 0.0001);
        assert!(engine.set_physics_collider_material(
            circle_id,
            circle_generation,
            0.2,
            0.6,
            -3.0,
            4.0,
            1.75,
            0.4,
            0.3,
            0.2,
            0.1,
        ));
        assert!(!engine.set_physics_collider_material(
            circle_id,
            circle_generation,
            f32::NAN,
            0.6,
            -3.0,
            4.0,
            1.75,
            0.4,
            0.3,
            0.2,
            0.1,
        ));
        assert!(engine.query_physics_entity(circle_id, circle_generation));
        assert!(engine.physics_entity_collider_material_override());
        assert!((engine.physics_entity_collider_restitution() - 0.2).abs() < 0.0001);
        assert!((engine.physics_entity_collider_friction() - 0.6).abs() < 0.0001);
        assert!((engine.physics_entity_collider_surface_velocity_x() + 3.0).abs() < 0.0001);
        assert!((engine.physics_entity_collider_surface_velocity_y() - 4.0).abs() < 0.0001);
        assert!((engine.physics_entity_collider_density() - 1.75).abs() < 0.0001);
        assert!(
            (engine.physics_entity_collider_contact_baumgarte_bias_scale() - 0.4).abs() < 0.0001
        );
        assert!(
            (engine.physics_entity_collider_max_contact_baumgarte_bias_velocity_scale() - 0.3)
                .abs()
                < 0.0001
        );
        assert!(
            (engine.physics_entity_collider_contact_position_correction_scale() - 0.2).abs()
                < 0.0001
        );
        assert!(
            (engine.physics_entity_collider_contact_position_correction_slop_scale() - 0.1).abs()
                < 0.0001
        );
        assert!(engine.clear_physics_collider_material(circle_id, circle_generation));
        assert!(engine.query_physics_entity(circle_id, circle_generation));
        assert!(!engine.physics_entity_collider_material_override());
        assert!((engine.physics_entity_collider_restitution() - 0.1).abs() < 0.0001);
        assert!((engine.physics_entity_collider_friction() - 0.5).abs() < 0.0001);
        assert!(engine.apply_physics_body_impulse(circle_id, circle_generation, 4.0, 0.0));
        assert!(engine.apply_physics_body_angular_impulse(circle_id, circle_generation, 2.0));

        assert!(engine.spawn_physics_capsule_body(
            20.0,
            0.0,
            -4.0,
            0.0,
            4.0,
            0.0,
            2.0,
            PHYSICS_BODY_TYPE_KINEMATIC,
            1.0,
            true,
            PHYSICS_LAYER_ENEMY,
            CollisionMask::ENEMY.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        assert!(engine.spawn_physics_edge_body(
            30.0,
            0.0,
            -5.0,
            0.0,
            5.0,
            0.0,
            PHYSICS_BODY_TYPE_STATIC,
            1.0,
            true,
            PHYSICS_LAYER_WALL,
            CollisionMask::WALL.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        let edge_id = engine.physics_entity_id();
        let edge_generation = engine.physics_entity_generation();
        assert_eq!(
            engine.physics_entity_collider_type(),
            PHYSICS_COLLIDER_TYPE_EDGE
        );
        assert!(engine.set_physics_collider_offset(edge_id, edge_generation, 0.0, 1.0));
        assert!(engine.query_physics_entity(edge_id, edge_generation));
        assert!((engine.physics_entity_collider_offset_y() - 1.0).abs() < 0.0001);
        assert!(!engine.spawn_physics_edge_body(
            30.0,
            0.0,
            1.0,
            1.0,
            1.0,
            1.0,
            PHYSICS_BODY_TYPE_STATIC,
            1.0,
            true,
            PHYSICS_LAYER_WALL,
            CollisionMask::WALL.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        assert!(engine.spawn_physics_chain_body(
            35.0,
            0.0,
            vec![0.0, 0.0, 8.0, 0.0, 8.0, 8.0],
            false,
            PHYSICS_BODY_TYPE_STATIC,
            1.0,
            true,
            PHYSICS_LAYER_WALL,
            CollisionMask::WALL.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        assert_eq!(
            engine.physics_entity_collider_type(),
            PHYSICS_COLLIDER_TYPE_CHAIN
        );
        let chain_id = engine.physics_entity_id();
        let chain_generation = engine.physics_entity_generation();
        assert!(engine.set_physics_collider_offset(chain_id, chain_generation, 0.0, 2.0));
        assert!(engine.query_physics_entity(chain_id, chain_generation));
        assert!((engine.physics_entity_collider_offset_y() - 2.0).abs() < 0.0001);
        assert!(!engine.spawn_physics_chain_body(
            35.0,
            0.0,
            vec![0.0, 0.0, 0.0, 0.0],
            false,
            PHYSICS_BODY_TYPE_STATIC,
            1.0,
            true,
            PHYSICS_LAYER_WALL,
            CollisionMask::WALL.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        assert!(engine.spawn_physics_oriented_box_body(
            40.0,
            0.0,
            5.0,
            3.0,
            0.25,
            PHYSICS_BODY_TYPE_STATIC,
            1.0,
            true,
            PHYSICS_LAYER_WALL,
            CollisionMask::WALL.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        assert!(engine.spawn_physics_convex_polygon_body(
            60.0,
            0.0,
            vec![-4.0, -4.0, 4.0, -4.0, 0.0, 4.0],
            0.0,
            PHYSICS_BODY_TYPE_DYNAMIC,
            1.0,
            true,
            PHYSICS_LAYER_BULLET,
            CollisionMask::BULLET.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        assert!(!engine.spawn_physics_convex_polygon_body(
            0.0,
            0.0,
            vec![0.0, 0.0, 1.0],
            0.0,
            PHYSICS_BODY_TYPE_DYNAMIC,
            1.0,
            true,
            PHYSICS_LAYER_PLAYER,
            CollisionMask::PLAYER.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));

        engine.step_rigid_bodies(0.25);

        assert!(engine.query_physics_entity(circle_id, circle_generation));
        assert!(engine.physics_entity_velocity_x() > 0.0);
        assert!(engine.physics_entity_angular_velocity_radians_per_second() > 0.0);
        assert!(engine.set_physics_body_enabled(circle_id, circle_generation, false));
        assert!(engine.query_physics_entity(circle_id, circle_generation));
        assert!(!engine.physics_entity_body_enabled());
        assert!(engine.despawn_physics_entity(circle_id, circle_generation));
        assert!(!engine.query_physics_entity(circle_id, circle_generation));
    }

    #[test]
    fn engine_captures_and_restores_builtin_shooter_snapshot() {
        let mut engine = Engine::new();
        engine.set_input(false, false, false, false, false, true, false, 0.0, 0.0);
        engine.update(0.016);
        engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);

        let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
        let bullet = engine
            .world
            .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        engine.world.damages[bullet.id as usize] = Some(1.0);
        engine.update(0.016);
        assert_eq!(engine.score(), 1);
        assert!(!engine.world.alive[enemy.id as usize]);

        let saved_enemy = engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);
        let saved_bullet = engine
            .world
            .spawn_bullet(120.0, 100.0, 12.0, 0.0, DEFAULT_TEXTURE_ID);
        assert!(engine.world.alive[saved_enemy.id as usize]);
        assert!(engine.world.alive[saved_bullet.id as usize]);
        let saved_entity_count = engine.entity_count();
        engine.camera.x = 320.0;
        engine.camera.y = 240.0;

        assert!(engine.capture_shooter_snapshot());
        assert_eq!(
            engine.shooter_snapshot_header_float_len(),
            engine.shooter_snapshot_header_floats()
        );
        assert_eq!(
            engine.shooter_snapshot_header_u32_len(),
            engine.shooter_snapshot_header_u32s()
        );
        assert!(engine.shooter_snapshot_entity_float_len() >= SHOOTER_SNAPSHOT_ENTITY_FLOATS);
        let header_floats = engine.shooter_snapshot_header_floats.clone();
        let header_u32s = engine.shooter_snapshot_header_u32s.clone();
        let entity_floats = engine.shooter_snapshot_entity_floats.clone();
        let entity_u32s = engine.shooter_snapshot_entity_u32s.clone();

        engine.reset_game();
        assert_eq!(engine.score(), 0);
        set_test_particle_preset(&mut engine, 0, DEFAULT_TEXTURE_ID, 2, 1.0);
        assert_eq!(engine.spawn_particle_burst(0, 100.0, 100.0), 2);
        assert_eq!(engine.particle_count(), 2);
        assert!(engine.restore_shooter_snapshot(
            header_floats,
            header_u32s,
            entity_floats,
            entity_u32s
        ));

        assert_eq!(engine.score(), 1);
        assert_eq!(engine.game_state(), 1);
        assert_eq!(engine.entity_count(), saved_entity_count);
        assert_eq!(engine.camera_x(), 320.0);
        assert_eq!(engine.camera_y(), 240.0);
        assert_eq!(engine.particle_count(), 0);
        assert!(engine
            .world
            .transforms
            .iter()
            .flatten()
            .any(|transform| (transform.x - 100.0).abs() < 0.001));
        assert!(engine
            .world
            .velocities
            .iter()
            .flatten()
            .any(|velocity| (velocity.vx - 12.0).abs() < 0.001));
    }

    #[test]
    fn shooter_snapshot_capture_does_not_switch_non_shooter_scene() {
        let mut engine = Engine::new();
        engine.use_platformer_scene();
        let entity_count = engine.entity_count();

        assert_eq!(engine.active_scene, ActiveScene::Platformer);
        assert!(!engine.capture_shooter_snapshot());

        assert_eq!(engine.active_scene, ActiveScene::Platformer);
        assert_eq!(engine.entity_count(), entity_count);
        assert_eq!(engine.shooter_snapshot_header_float_len(), 0);
        assert_eq!(engine.shooter_snapshot_header_u32_len(), 0);
        assert_eq!(engine.shooter_snapshot_entity_float_len(), 0);
        assert_eq!(engine.shooter_snapshot_entity_u32_len(), 0);
    }

    #[test]
    fn failed_shooter_snapshot_restore_preserves_active_scene() {
        let mut engine = Engine::new();
        engine.use_platformer_scene();
        let entity_count = engine.entity_count();
        let mut header_u32s = vec![0; SHOOTER_SNAPSHOT_HEADER_U32S];
        header_u32s[0] = crate::shooter_scene::SHOOTER_SNAPSHOT_VERSION;

        assert_eq!(engine.active_scene, ActiveScene::Platformer);
        assert!(!engine.restore_shooter_snapshot(
            vec![0.0; SHOOTER_SNAPSHOT_HEADER_FLOATS],
            header_u32s,
            Vec::new(),
            Vec::new(),
        ));

        assert_eq!(engine.active_scene, ActiveScene::Platformer);
        assert_eq!(engine.entity_count(), entity_count);
    }

    #[test]
    fn engine_captures_and_restores_physics_body_snapshot_bulk() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();

        assert!(engine.spawn_physics_aabb_body(
            0.0,
            0.0,
            5.0,
            6.0,
            PHYSICS_BODY_TYPE_DYNAMIC,
            1.0,
            true,
            PHYSICS_LAYER_PLAYER,
            CollisionMask::PLAYER.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        let body_id = engine.physics_entity_id();
        let body_generation = engine.physics_entity_generation();
        assert!(engine.set_physics_body_velocity(body_id, body_generation, 3.0, -2.0));
        assert!(engine.set_physics_body_rotation(body_id, body_generation, 0.25));
        assert!(engine.set_physics_body_angular_velocity(body_id, body_generation, 1.5));
        assert!(engine.set_physics_body_mass_properties(body_id, body_generation, 2.0, 5.0));
        assert!(engine.set_physics_body_tuning(body_id, body_generation, 0.75, 0.1, 0.2));
        assert!(engine.set_physics_body_material(
            body_id,
            body_generation,
            0.2,
            0.6,
            1.0,
            -1.0,
            1.25,
            0.8,
            0.9,
            0.7,
            0.6,
        ));
        assert!(engine.set_physics_collider_offset(body_id, body_generation, 1.5, -2.5));
        assert!(engine.set_physics_collider_material(
            body_id,
            body_generation,
            0.3,
            0.7,
            -2.0,
            3.0,
            1.5,
            0.5,
            0.4,
            0.3,
            0.2,
        ));

        assert!(engine.capture_physics_body_snapshot_bulk(vec![body_id, body_generation]));
        assert_eq!(
            engine.physics_body_snapshot_float_len(),
            engine.physics_body_snapshot_floats_per_body()
        );
        assert_eq!(
            engine.physics_body_snapshot_u32_len(),
            engine.physics_body_snapshot_u32s_per_body()
        );
        let floats = engine.physics_body_snapshot_floats.clone();
        let u32s = engine.physics_body_snapshot_u32s.clone();

        assert!(engine.set_physics_body_position(body_id, body_generation, 20.0, 30.0));
        assert!(engine.set_physics_body_velocity(body_id, body_generation, -8.0, 9.0));
        assert!(engine.set_physics_body_rotation(body_id, body_generation, -1.0));
        assert!(engine.set_physics_body_angular_velocity(body_id, body_generation, -4.0));
        assert!(engine.set_physics_body_mass_properties(body_id, body_generation, 4.0, 8.0));
        assert!(engine.set_physics_body_tuning(body_id, body_generation, 0.25, 0.4, 0.5));
        assert!(engine.clear_physics_collider_material(body_id, body_generation));
        assert!(engine.set_physics_collider_offset(body_id, body_generation, -5.0, 6.0));

        assert!(engine.restore_physics_body_snapshot_bulk(
            vec![body_id, body_generation],
            floats,
            u32s,
        ));
        assert!(engine.query_physics_entity(body_id, body_generation));
        assert!((engine.physics_entity_x()).abs() < 0.0001);
        assert!((engine.physics_entity_y()).abs() < 0.0001);
        assert!((engine.physics_entity_velocity_x() - 3.0).abs() < 0.0001);
        assert!((engine.physics_entity_velocity_y() + 2.0).abs() < 0.0001);
        assert!((engine.physics_entity_rotation_radians() - 0.25).abs() < 0.0001);
        assert!((engine.physics_entity_angular_velocity_radians_per_second() - 1.5).abs() < 0.0001);
        assert!((engine.physics_entity_mass() - 2.0).abs() < 0.0001);
        assert!((engine.physics_entity_inertia() - 5.0).abs() < 0.0001);
        assert!((engine.physics_entity_gravity_scale() - 0.75).abs() < 0.0001);
        assert!((engine.physics_entity_linear_damping() - 0.1).abs() < 0.0001);
        assert!((engine.physics_entity_angular_damping() - 0.2).abs() < 0.0001);
        assert!((engine.physics_entity_collider_offset_x() - 1.5).abs() < 0.0001);
        assert!((engine.physics_entity_collider_offset_y() + 2.5).abs() < 0.0001);
        assert!(engine.physics_entity_collider_material_override());
        assert!((engine.physics_entity_collider_friction() - 0.7).abs() < 0.0001);

        assert!(!engine.capture_physics_body_snapshot_bulk(vec![body_id]));
        assert!(!engine.restore_physics_body_snapshot_bulk(
            vec![body_id, body_generation],
            vec![0.0],
            vec![0],
        ));
    }

    #[test]
    fn engine_spawn_physics_joints_and_controls_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();

        assert!(engine.spawn_physics_aabb_body(
            0.0,
            0.0,
            2.0,
            2.0,
            PHYSICS_BODY_TYPE_DYNAMIC,
            1.0,
            false,
            PHYSICS_LAYER_PLAYER,
            CollisionMask::PLAYER.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        let entity_a_id = engine.physics_entity_id();
        let entity_a_generation = engine.physics_entity_generation();
        assert!(engine.spawn_physics_aabb_body(
            20.0,
            0.0,
            2.0,
            2.0,
            PHYSICS_BODY_TYPE_DYNAMIC,
            1.0,
            false,
            PHYSICS_LAYER_ENEMY,
            CollisionMask::ENEMY.bits,
            CollisionMask::ALL.bits,
            false,
            true,
            true,
            false,
        ));
        let entity_b_id = engine.physics_entity_id();
        let entity_b_generation = engine.physics_entity_generation();

        assert!(engine.spawn_physics_distance_joint(
            entity_a_id,
            entity_a_generation,
            entity_b_id,
            entity_b_generation,
            10.0,
            1.0,
            0.25,
            f32::INFINITY,
            true,
        ));
        let distance_index = engine.physics_joint_index();
        let distance_generation = engine.physics_joint_generation();
        assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_DISTANCE);
        assert_eq!(engine.physics_joint_entity_a_id(), entity_a_id);
        assert_eq!(engine.physics_joint_entity_b_id(), entity_b_id);
        assert_eq!(engine.physics_joint_rest_length(), 10.0);
        assert_eq!(engine.physics_joint_damping(), 0.25);
        assert!(engine.physics_joint_enabled());

        engine.step_rigid_bodies(1.0 / 60.0);
        assert!(engine.rigid_body_step_constraint_position_corrections() > 0);

        assert!(engine.set_physics_joint_enabled(
            PHYSICS_JOINT_DISTANCE,
            distance_index,
            distance_generation,
            false,
        ));
        assert!(!engine.physics_joint_enabled());
        assert!(engine.query_physics_joint(
            PHYSICS_JOINT_DISTANCE,
            distance_index,
            distance_generation,
        ));
        assert!(!engine.physics_joint_enabled());

        assert!(engine.spawn_physics_rope_joint(
            entity_a_id,
            entity_a_generation,
            entity_b_id,
            entity_b_generation,
            12.0,
            0.5,
            0.1,
            4.0,
            true,
        ));
        assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_ROPE);
        assert_eq!(engine.physics_joint_max_length(), 12.0);
        assert_eq!(engine.physics_joint_break_distance(), 4.0);

        assert!(engine.spawn_physics_spring_joint(
            entity_a_id,
            entity_a_generation,
            entity_b_id,
            entity_b_generation,
            8.0,
            0.75,
            0.5,
            f32::INFINITY,
            true,
        ));
        assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_SPRING);
        assert_eq!(engine.physics_joint_rest_length(), 8.0);
        assert_eq!(engine.physics_joint_stiffness(), 0.75);

        assert!(engine.spawn_physics_pulley_joint(
            entity_a_id,
            entity_a_generation,
            entity_b_id,
            entity_b_generation,
            -4.0,
            10.0,
            24.0,
            10.0,
            0.0,
            0.0,
            0.0,
            0.0,
            30.0,
            2.0,
            0.8,
            0.25,
            5.0,
            true,
        ));
        assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_PULLEY);
        assert_eq!(engine.physics_joint_rest_length(), 30.0);
        assert_eq!(engine.physics_joint_ratio(), 2.0);
        assert_eq!(engine.physics_joint_ground_anchor_a_x(), -4.0);
        assert_eq!(engine.physics_joint_ground_anchor_b_y(), 10.0);
        assert_eq!(engine.physics_joint_break_distance(), 5.0);

        assert!(engine.spawn_physics_revolute_joint(
            entity_a_id,
            entity_a_generation,
            entity_b_id,
            entity_b_generation,
            -1.0,
            0.0,
            1.0,
            0.0,
            0.8,
            0.6,
            5.0,
            true,
            -0.5,
            0.5,
            true,
            1.5,
            3.0,
            true,
        ));
        assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_REVOLUTE);
        assert_eq!(engine.physics_joint_local_anchor_a_x(), -1.0);
        assert!(engine.physics_joint_limit_enabled());
        assert!(engine.physics_joint_motor_enabled());
        assert_eq!(engine.physics_joint_max_motor_torque(), 3.0);

        assert!(engine.spawn_physics_prismatic_joint(
            entity_a_id,
            entity_a_generation,
            entity_b_id,
            entity_b_generation,
            0.0,
            0.0,
            0.0,
            0.0,
            1.0,
            0.0,
            0.25,
            0.9,
            0.4,
            0.7,
            0.3,
            6.0,
            true,
            -2.0,
            2.0,
            true,
            4.0,
            5.0,
            true,
        ));
        assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_PRISMATIC);
        assert_eq!(engine.physics_joint_reference_angle(), 0.25);
        assert_eq!(engine.physics_joint_local_axis_a_x(), 1.0);
        assert_eq!(engine.physics_joint_angular_stiffness(), 0.7);
        assert_eq!(engine.physics_joint_max_motor_force(), 5.0);

        assert!(engine.spawn_physics_gear_joint(
            entity_a_id,
            entity_a_generation,
            entity_b_id,
            entity_b_generation,
            2.0,
            0.5,
            0.8,
            0.2,
            1.5,
            true,
        ));
        assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_GEAR);
        assert_eq!(engine.physics_joint_ratio(), 2.0);
        assert_eq!(engine.physics_joint_reference_angle(), 0.5);
        assert_eq!(engine.physics_joint_break_angle(), 1.5);

        assert!(engine.clear_physics_joint(
            PHYSICS_JOINT_DISTANCE,
            distance_index,
            distance_generation,
        ));
        assert!(!engine.query_physics_joint(
            PHYSICS_JOINT_DISTANCE,
            distance_index,
            distance_generation,
        ));
        assert!(!engine.spawn_physics_distance_joint(
            entity_a_id,
            entity_a_generation,
            999,
            0,
            10.0,
            1.0,
            0.0,
            f32::INFINITY,
            true,
        ));
    }

    #[test]
    fn engine_query_point_bodies_writes_bulk_result_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        let first_enemy = spawn_test_body(&mut engine.world, 10.0, 0.0, CollisionLayer::Enemy);
        let second_enemy = spawn_test_body(&mut engine.world, 12.0, 0.0, CollisionLayer::Enemy);
        spawn_test_body(&mut engine.world, 40.0, 0.0, CollisionLayer::Enemy);

        let hit_count = engine.query_point_bodies(11.0, 0.0, CollisionMask::ENEMY.bits);

        assert_eq!(hit_count, 2);
        assert_eq!(engine.physics_query_hit_len(), 2);
        assert_eq!(
            engine.physics_query_hits,
            vec![
                PhysicsQueryEntityHit::from_entity(first_enemy),
                PhysicsQueryEntityHit::from_entity(second_enemy),
            ]
        );
        assert_eq!(
            engine.physics_query_hit_ptr(),
            engine.physics_query_hits.as_ptr()
        );

        let hit_count = engine.query_point_bodies(0.0, 0.0, CollisionMask::ENEMY.bits);

        assert_eq!(hit_count, 0);
        assert_eq!(engine.physics_query_hit_len(), 0);
    }

    #[test]
    fn engine_query_aabb_and_circle_bodies_write_bulk_results_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let player = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Player);
        let enemy = spawn_test_body(&mut engine.world, 20.0, 0.0, CollisionLayer::Enemy);
        spawn_test_body(&mut engine.world, 60.0, 0.0, CollisionLayer::Enemy);

        let aabb_count = engine.query_aabb_bodies(10.0, 0.0, 6.0, 6.0, CollisionMask::ALL.bits);

        assert_eq!(aabb_count, 2);
        assert_eq!(
            engine.physics_query_hits,
            vec![
                PhysicsQueryEntityHit::from_entity(player),
                PhysicsQueryEntityHit::from_entity(enemy),
            ]
        );

        let circle_count = engine.query_circle_bodies(20.0, 0.0, 1.0, CollisionMask::ENEMY.bits);

        assert_eq!(circle_count, 1);
        assert_eq!(
            engine.physics_query_hits,
            vec![PhysicsQueryEntityHit::from_entity(enemy)]
        );

        let invalid_count = engine.query_aabb_bodies(10.0, 0.0, 0.0, 6.0, CollisionMask::ALL.bits);

        assert_eq!(invalid_count, 0);
        assert!(engine.physics_query_hits.is_empty());
    }

    #[test]
    fn engine_query_advanced_shape_bodies_write_bulk_results_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let first_enemy = spawn_test_body(&mut engine.world, 0.0, 0.0, CollisionLayer::Enemy);
        let second_enemy = spawn_test_body(&mut engine.world, 12.0, 0.0, CollisionLayer::Enemy);
        spawn_test_body(&mut engine.world, 40.0, 0.0, CollisionLayer::Enemy);

        let oriented_count =
            engine.query_oriented_box_bodies(6.0, 0.0, 12.0, 6.0, 0.0, CollisionMask::ENEMY.bits);

        assert_eq!(oriented_count, 2);
        assert_eq!(
            engine.physics_query_hits,
            vec![
                PhysicsQueryEntityHit::from_entity(first_enemy),
                PhysicsQueryEntityHit::from_entity(second_enemy),
            ]
        );

        let capsule_count =
            engine.query_capsule_bodies(-2.0, 0.0, 14.0, 0.0, 1.0, CollisionMask::ENEMY.bits);

        assert_eq!(capsule_count, 2);
        assert_eq!(
            engine.physics_query_hits,
            vec![
                PhysicsQueryEntityHit::from_entity(first_enemy),
                PhysicsQueryEntityHit::from_entity(second_enemy),
            ]
        );

        let polygon_count = engine.query_convex_polygon_bodies(
            vec![-6.0, -6.0, 18.0, -6.0, 18.0, 6.0, -6.0, 6.0],
            CollisionMask::ENEMY.bits,
        );

        assert_eq!(polygon_count, 2);
        assert_eq!(
            engine.physics_query_hits,
            vec![
                PhysicsQueryEntityHit::from_entity(first_enemy),
                PhysicsQueryEntityHit::from_entity(second_enemy),
            ]
        );

        let invalid_count = engine
            .query_convex_polygon_bodies(vec![0.0, 0.0, 1.0, 0.0, 0.0], CollisionMask::ENEMY.bits);

        assert_eq!(invalid_count, 0);
        assert!(engine.physics_query_hits.is_empty());
    }

    #[test]
    fn engine_raycast_and_segment_cast_bodies_write_bulk_results_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let first_enemy = spawn_test_body(&mut engine.world, 20.0, 0.0, CollisionLayer::Enemy);
        let second_enemy = spawn_test_body(&mut engine.world, 40.0, 0.0, CollisionLayer::Enemy);
        spawn_test_body(&mut engine.world, 60.0, 0.0, CollisionLayer::Player);

        let raycast_count =
            engine.raycast_bodies(0.0, 0.0, 1.0, 0.0, 100.0, CollisionMask::ENEMY.bits);

        assert_eq!(raycast_count, 2);
        assert_eq!(engine.physics_raycast_hit_len(), 2);
        assert_eq!(
            engine.physics_raycast_hits,
            vec![
                PhysicsRaycastBodyHit {
                    entity_id: first_enemy.id,
                    entity_generation: first_enemy.generation,
                    distance: 15.0,
                    point_x: 15.0,
                    point_y: 0.0,
                    normal_x: -1.0,
                    normal_y: 0.0,
                },
                PhysicsRaycastBodyHit {
                    entity_id: second_enemy.id,
                    entity_generation: second_enemy.generation,
                    distance: 35.0,
                    point_x: 35.0,
                    point_y: 0.0,
                    normal_x: -1.0,
                    normal_y: 0.0,
                },
            ]
        );
        assert_eq!(
            engine.physics_raycast_hit_ptr(),
            engine.physics_raycast_hits.as_ptr()
        );

        let segment_count =
            engine.segment_cast_bodies(0.0, 0.0, 30.0, 0.0, CollisionMask::ENEMY.bits);

        assert_eq!(segment_count, 1);
        assert_eq!(
            engine.physics_raycast_hits,
            vec![PhysicsRaycastBodyHit {
                entity_id: first_enemy.id,
                entity_generation: first_enemy.generation,
                distance: 15.0,
                point_x: 15.0,
                point_y: 0.0,
                normal_x: -1.0,
                normal_y: 0.0,
            }]
        );

        let invalid_count =
            engine.raycast_bodies(0.0, 0.0, 0.0, 0.0, 100.0, CollisionMask::ENEMY.bits);

        assert_eq!(invalid_count, 0);
        assert!(engine.physics_raycast_hits.is_empty());
    }

    #[test]
    fn engine_raycast_and_segment_cast_tile_obstacles_write_bulk_results_for_wasm() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        engine.set_shooter_tilemap_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

        let raycast_count = engine.raycast_tile_obstacles(0.0, 5.0, 1.0, 0.0, 40.0);

        assert_eq!(raycast_count, 1);
        assert_eq!(engine.physics_tile_shape_cast_hit_len(), 1);
        assert_eq!(
            engine.physics_tile_shape_cast_hits,
            vec![PhysicsTileShapeCastHit {
                tile_layer_index: 2,
                tile_index: 1,
                distance: 10.0,
                point_x: 10.0,
                point_y: 5.0,
                normal_x: -1.0,
                normal_y: 0.0,
            }]
        );
        assert_eq!(
            engine.physics_tile_shape_cast_hit_ptr(),
            engine.physics_tile_shape_cast_hits.as_ptr()
        );

        let segment_count = engine.segment_cast_tile_obstacles(0.0, 5.0, 9.0, 5.0);

        assert_eq!(segment_count, 0);
        assert!(engine.physics_tile_shape_cast_hits.is_empty());

        let segment_count = engine.segment_cast_tile_obstacles(0.0, 5.0, 10.0, 5.0);

        assert_eq!(segment_count, 1);
        assert_eq!(engine.physics_tile_shape_cast_hits[0].distance, 10.0);

        let invalid_count = engine.raycast_tile_obstacles(0.0, 5.0, 0.0, 0.0, 40.0);

        assert_eq!(invalid_count, 0);
        assert!(engine.physics_tile_shape_cast_hits.is_empty());
    }

    #[test]
    fn engine_shape_cast_bodies_write_bulk_results_for_wasm() {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.clear_physics_history();
        let first_enemy = spawn_test_body(&mut engine.world, 20.0, 0.0, CollisionLayer::Enemy);
        let second_enemy = spawn_test_body(&mut engine.world, 40.0, 0.0, CollisionLayer::Enemy);
        spawn_test_body(&mut engine.world, 60.0, 0.0, CollisionLayer::Player);

        let aabb_count = engine.shape_cast_aabb_bodies(
            0.0,
            0.0,
            2.0,
            2.0,
            1.0,
            0.0,
            100.0,
            CollisionMask::ENEMY.bits,
        );

        assert_eq!(aabb_count, 2);
        assert_eq!(
            engine.physics_raycast_hits,
            vec![
                PhysicsRaycastBodyHit {
                    entity_id: first_enemy.id,
                    entity_generation: first_enemy.generation,
                    distance: 13.0,
                    point_x: 13.0,
                    point_y: 0.0,
                    normal_x: -1.0,
                    normal_y: 0.0,
                },
                PhysicsRaycastBodyHit {
                    entity_id: second_enemy.id,
                    entity_generation: second_enemy.generation,
                    distance: 33.0,
                    point_x: 33.0,
                    point_y: 0.0,
                    normal_x: -1.0,
                    normal_y: 0.0,
                },
            ]
        );

        let circle_count = engine.shape_cast_circle_bodies(
            0.0,
            0.0,
            2.0,
            1.0,
            0.0,
            100.0,
            CollisionMask::ENEMY.bits,
        );

        assert_eq!(circle_count, 2);
        assert_eq!(engine.physics_raycast_hits[0].entity_id, first_enemy.id);
        assert!((engine.physics_raycast_hits[0].distance - 13.0).abs() < 0.01);

        let oriented_count = engine.shape_cast_oriented_box_bodies(
            0.0,
            0.0,
            2.0,
            2.0,
            0.0,
            1.0,
            0.0,
            100.0,
            CollisionMask::ENEMY.bits,
        );

        assert_eq!(oriented_count, 2);
        assert_eq!(engine.physics_raycast_hits[0].entity_id, first_enemy.id);
        assert!((engine.physics_raycast_hits[0].distance - 13.0).abs() < 0.01);

        let capsule_count = engine.shape_cast_capsule_bodies(
            0.0,
            -2.0,
            0.0,
            2.0,
            1.0,
            1.0,
            0.0,
            100.0,
            CollisionMask::ENEMY.bits,
        );

        assert_eq!(capsule_count, 2);
        assert_eq!(engine.physics_raycast_hits[0].entity_id, first_enemy.id);
        assert!((engine.physics_raycast_hits[0].distance - 14.0).abs() < 0.01);

        let polygon_count = engine.shape_cast_convex_polygon_bodies(
            vec![-2.0, -2.0, 2.0, -2.0, 2.0, 2.0, -2.0, 2.0],
            1.0,
            0.0,
            100.0,
            CollisionMask::ENEMY.bits,
        );

        assert_eq!(polygon_count, 2);
        assert_eq!(engine.physics_raycast_hits[0].entity_id, first_enemy.id);
        assert!((engine.physics_raycast_hits[0].distance - 13.0).abs() < 0.01);

        let invalid_count = engine.shape_cast_convex_polygon_bodies(
            vec![0.0, 0.0, 1.0, 0.0, 0.0],
            1.0,
            0.0,
            100.0,
            CollisionMask::ENEMY.bits,
        );

        assert_eq!(invalid_count, 0);
        assert!(engine.physics_raycast_hits.is_empty());
    }

    #[test]
    fn engine_query_nearest_tile_obstacle_stores_scalar_result_for_wasm() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        engine.set_shooter_tilemap_layer(2, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1]);

        assert!(engine.query_nearest_tile_obstacle(0.0, 5.0, 20.0));

        assert_eq!(engine.physics_query_tile_layer_index(), 2);
        assert_eq!(engine.physics_query_tile_index(), 1);
        assert_eq!(engine.physics_query_point_x(), 10.0);
        assert_eq!(engine.physics_query_point_y(), 5.0);
        assert_eq!(engine.physics_query_distance(), 10.0);

        assert!(!engine.query_nearest_tile_obstacle(0.0, 5.0, 5.0));
        assert_eq!(engine.physics_query_tile_layer_index(), 0);
        assert_eq!(engine.physics_query_tile_index(), 0);
    }

    #[test]
    fn engine_shape_cast_aabb_tile_obstacles_write_bulk_results_for_wasm() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        engine.set_shooter_tilemap_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

        let count = engine.shape_cast_aabb_tile_obstacles(0.0, 5.0, 1.0, 1.0, 1.0, 0.0, 40.0);

        assert_eq!(count, 1);
        assert_eq!(engine.physics_tile_shape_cast_hit_len(), 1);
        assert_eq!(
            engine.physics_tile_shape_cast_hits,
            vec![PhysicsTileShapeCastHit {
                tile_layer_index: 2,
                tile_index: 1,
                distance: 9.0,
                point_x: 9.0,
                point_y: 5.0,
                normal_x: -1.0,
                normal_y: 0.0,
            }]
        );
        assert_eq!(
            engine.physics_tile_shape_cast_hit_ptr(),
            engine.physics_tile_shape_cast_hits.as_ptr()
        );

        let invalid_count =
            engine.shape_cast_aabb_tile_obstacles(0.0, 5.0, 1.0, 1.0, 0.0, 0.0, 40.0);

        assert_eq!(invalid_count, 0);
        assert!(engine.physics_tile_shape_cast_hits.is_empty());
    }

    #[test]
    fn engine_shape_cast_aabb_tile_obstacles_respects_one_way_platforms() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        engine.set_shooter_tile_one_way_platform(1);
        engine.set_shooter_tilemap_layer(0, 1, 1, 10.0, 10.0, 0.0, 10.0, true, vec![1]);

        let downward_count =
            engine.shape_cast_aabb_tile_obstacles(5.0, 0.0, 1.0, 1.0, 0.0, 1.0, 30.0);

        assert_eq!(downward_count, 1);
        assert_eq!(
            engine.physics_tile_shape_cast_hits,
            vec![PhysicsTileShapeCastHit {
                tile_layer_index: 0,
                tile_index: 0,
                distance: 9.0,
                point_x: 5.0,
                point_y: 9.0,
                normal_x: 0.0,
                normal_y: -1.0,
            }]
        );

        let upward_count =
            engine.shape_cast_aabb_tile_obstacles(5.0, 24.0, 1.0, 1.0, 0.0, -1.0, 30.0);

        assert_eq!(upward_count, 0);
        assert!(engine.physics_tile_shape_cast_hits.is_empty());
    }

    #[test]
    fn engine_query_aabb_tile_obstacle_contacts_write_bulk_results_for_wasm() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        engine.set_shooter_tilemap_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

        let count = engine.query_aabb_tile_obstacle_contacts(9.0, 5.0, 2.0, 2.0);

        assert_eq!(count, 1);
        assert_eq!(engine.physics_tile_contact_hit_len(), 1);
        assert_eq!(
            engine.physics_tile_contact_hits,
            vec![PhysicsTileContactHit {
                tile_layer_index: 2,
                tile_index: 1,
                normal_x: -1.0,
                normal_y: 0.0,
                penetration: 1.0,
                point_x: 11.0,
                point_y: 5.0,
            }]
        );
        assert_eq!(
            engine.physics_tile_contact_hit_ptr(),
            engine.physics_tile_contact_hits.as_ptr()
        );

        let invalid_count = engine.query_aabb_tile_obstacle_contacts(9.0, 5.0, -1.0, 2.0);

        assert_eq!(invalid_count, 0);
        assert!(engine.physics_tile_contact_hits.is_empty());
    }

    #[test]
    fn engine_query_aabb_tile_obstacle_manifolds_write_bulk_results_for_wasm() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        engine.set_shooter_tilemap_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 1]);

        let count = engine.query_aabb_tile_obstacle_manifolds(9.0, 5.0, 2.0, 2.0);

        assert_eq!(count, 1);
        assert_eq!(engine.physics_tile_manifold_hit_len(), 1);
        assert_eq!(
            engine.physics_tile_manifold_hits,
            vec![PhysicsTileManifoldHit {
                tile_layer_index: 2,
                tile_index: 1,
                point_count: 2,
                normal_x: -1.0,
                normal_y: 0.0,
                penetration: 1.0,
                point0_x: 11.0,
                point0_y: 3.0,
                point0_penetration: 1.0,
                point1_x: 11.0,
                point1_y: 7.0,
                point1_penetration: 1.0,
            }]
        );
        assert_eq!(
            engine.physics_tile_manifold_hit_ptr(),
            engine.physics_tile_manifold_hits.as_ptr()
        );

        let invalid_count = engine.query_aabb_tile_obstacle_manifolds(9.0, 5.0, -1.0, 2.0);

        assert_eq!(invalid_count, 0);
        assert!(engine.physics_tile_manifold_hits.is_empty());
    }

    #[test]
    fn engine_set_shooter_tilemap_tile_refreshes_wasm_tile_obstacle_query() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tilemap_layer(2, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 0]);

        assert!(engine.query_nearest_tile_obstacle(5.0, 5.0, 0.0));

        assert!(engine.set_shooter_tilemap_tile(2, 0, 0, 0));
        assert!(!engine.query_nearest_tile_obstacle(5.0, 5.0, 0.0));

        assert!(engine.set_shooter_tilemap_tile(2, 1, 0, 1));
        assert!(engine.query_nearest_tile_obstacle(0.0, 5.0, 100.0));
        assert_eq!(engine.physics_query_tile_layer_index(), 2);
        assert_eq!(engine.physics_query_tile_index(), 1);

        assert!(!engine.set_shooter_tilemap_tile(2, 1, 0, 1));
        assert!(!engine.set_shooter_tilemap_tile(2, 2, 0, 1));
        assert!(!engine.set_shooter_tilemap_tile(3, 0, 0, 1));
    }

    #[test]
    fn engine_tilemap_rect_edit_can_enforce_rebuild_budget_for_wasm() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tilemap_layer(0, 40, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1; 40]);

        assert!(!engine.set_shooter_tilemap_tiles_rect_with_rebuild_budget(0, 15, 0, 2, 1, 0, 1));
        assert!(engine.query_nearest_tile_obstacle(155.0, 5.0, 0.0));

        assert!(engine.set_shooter_tilemap_tiles_rect_with_rebuild_budget(0, 15, 0, 2, 1, 0, 2));
        assert!(!engine.query_nearest_tile_obstacle(155.0, 5.0, 0.0));
        assert!(engine.query_nearest_tile_obstacle(175.0, 5.0, 0.0));
    }

    #[test]
    fn engine_query_tilemap_navigation_waypoint_stores_scalar_result_for_wasm() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tilemap_layer(
            0,
            3,
            3,
            10.0,
            10.0,
            0.0,
            0.0,
            true,
            vec![0, 1, 0, 0, 1, 0, 0, 0, 0],
        );

        assert!(engine.query_tilemap_navigation_waypoint(5.0, 5.0, 25.0, 5.0));
        assert_eq!(engine.physics_query_point_x(), 5.0);
        assert_eq!(engine.physics_query_point_y(), 15.0);
        assert!((engine.physics_query_distance() - 10.0).abs() < 0.001);

        assert!(!engine.query_tilemap_navigation_waypoint(15.0, 5.0, 25.0, 5.0));
        assert_eq!(engine.physics_query_point_x(), 0.0);
        assert_eq!(engine.physics_query_point_y(), 0.0);
    }

    #[test]
    fn engine_query_tilemap_navigation_path_exposes_buffer_and_debug_lines() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tilemap_layer(0, 3, 2, 10.0, 10.0, 0.0, 0.0, true, vec![0; 6]);
        assert!(engine.set_shooter_tilemap_navigation_cost(0, 1, 0, 20));

        assert!(engine.query_tilemap_navigation_path(5.0, 5.0, 25.0, 5.0));

        assert_eq!(engine.tilemap_navigation_path_point_len(), 4);
        let points = unsafe {
            std::slice::from_raw_parts(
                engine.tilemap_navigation_path_point_ptr(),
                engine.tilemap_navigation_path_point_len() * 2,
            )
        };
        assert_eq!(points, &[5.0, 15.0, 15.0, 15.0, 25.0, 15.0, 25.0, 5.0]);
        assert_eq!(engine.tilemap_navigation_debug_line_len(), 4);
        assert_eq!(engine.physics_query_point_x(), 5.0);
        assert_eq!(engine.physics_query_point_y(), 15.0);
        assert!((engine.physics_query_distance() - 40.0).abs() < 0.001);

        assert!(!engine.query_tilemap_navigation_path(-5.0, -5.0, 25.0, 5.0));
        assert_eq!(engine.tilemap_navigation_path_point_len(), 0);
        assert_eq!(engine.tilemap_navigation_debug_line_len(), 0);
    }

    #[test]
    fn engine_set_shooter_tilemap_tiles_rect_refreshes_queries_and_render_commands() {
        let mut engine = Engine::new();
        engine.clear_shooter_tilemap();
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        engine.set_shooter_tilemap_layer(2, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1, 1, 1]);

        engine.build_render_commands();
        assert_eq!(
            engine
                .render_commands
                .iter()
                .filter(|command| command.texture_id == 9.0)
                .count(),
            3
        );
        assert!(engine.query_nearest_tile_obstacle(5.0, 5.0, 0.0));

        assert!(engine.set_shooter_tilemap_tiles_rect(2, 0, 0, 2, 1, 0));

        assert!(!engine.query_nearest_tile_obstacle(5.0, 5.0, 0.0));
        assert!(engine.query_nearest_tile_obstacle(25.0, 5.0, 0.0));
        assert_eq!(engine.physics_query_tile_layer_index(), 2);
        assert_eq!(engine.physics_query_tile_index(), 2);

        engine.build_render_commands();
        assert_eq!(
            engine
                .render_commands
                .iter()
                .filter(|command| command.texture_id == 9.0)
                .count(),
            1
        );

        assert!(!engine.set_shooter_tilemap_tiles_rect(2, 0, 0, 2, 1, 0));
        assert!(!engine.set_shooter_tilemap_tiles_rect(2, 0, 0, 0, 1, 1));
        assert!(!engine.set_shooter_tilemap_tiles_rect(2, 2, 0, 2, 1, 1));
        assert!(!engine.set_shooter_tilemap_tiles_rect(3, 0, 0, 1, 1, 1));
    }

    #[test]
    fn engine_collision_events_include_shooter_hit_before_despawn() {
        let mut engine = Engine::new();
        engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
        engine.update(0.016);
        engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
        let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
        let bullet = engine
            .world
            .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        engine.world.damages[bullet.id as usize] = Some(2.5);

        engine.update(0.016);

        assert_eq!(engine.collision_hit_count(), 1);
        let hit = engine
            .collision_events
            .iter()
            .find(|event| event.kind == COLLISION_EVENT_HIT)
            .expect("shooter hit should be recorded before despawn");
        assert_eq!(hit.a_id, bullet.id);
        assert_eq!(hit.a_generation, bullet.generation);
        assert_eq!(hit.b_id, enemy.id);
        assert_eq!(hit.b_generation, enemy.generation);
        assert_eq!(hit.damage(), 2.5);
    }

    #[test]
    fn shooter_hit_particle_preset_spawns_on_bullet_enemy_hit() {
        let mut engine = Engine::new();
        engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
        engine.update(0.016);
        engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
        set_test_particle_preset(&mut engine, 3, 88, 2, 1.0);
        engine.set_shooter_hit_particle_preset(3);
        let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
        let bullet = engine
            .world
            .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        engine.world.damages[bullet.id as usize] = Some(2.5);

        engine.update(0.016);

        assert_eq!(engine.collision_hit_count(), 1);
        assert_eq!(engine.particle_count(), 2);
        assert!(engine
            .render_commands
            .iter()
            .any(|command| command.texture_id == 88.0));
        assert!(!engine.world.alive[bullet.id as usize]);
        assert!(!engine.world.alive[enemy.id as usize]);
    }

    #[test]
    fn shooter_hit_particles_require_scene_preset_binding() {
        let mut engine = Engine::new();
        engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
        engine.update(0.016);
        engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
        set_test_particle_preset(&mut engine, 3, 88, 2, 1.0);
        let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
        let bullet = engine
            .world
            .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        engine.world.damages[bullet.id as usize] = Some(2.5);

        engine.update(0.016);

        assert_eq!(engine.collision_hit_count(), 1);
        assert_eq!(engine.particle_count(), 0);
        assert!(!engine.world.alive[enemy.id as usize]);
    }

    #[test]
    fn shooter_non_lethal_enemy_hit_starts_tint_tween() {
        let mut engine = Engine::new();
        engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
        engine.update(0.016);
        engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);

        let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
        let enemy_index = enemy.id as usize;
        engine.world.healths[enemy_index] = Some(2.0);
        let original = engine.world.sprites[enemy_index].unwrap();
        let bullet = engine
            .world
            .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        engine.world.damages[bullet.id as usize] = Some(1.0);

        engine.update(0.0);

        let flashed = engine.world.sprites[enemy_index].unwrap();
        assert!(engine.world.alive[enemy_index]);
        assert_eq!(engine.tweens.tween_count(), 1);
        assert!(flashed.r >= original.r);
        assert!(flashed.g > original.g);
        assert!(flashed.b > original.b);
        assert!(flashed.a > original.a);

        engine.update(0.2);

        let restored = engine.world.sprites[enemy_index].unwrap();
        assert_eq!(restored.r, original.r);
        assert_eq!(restored.g, original.g);
        assert_eq!(restored.b, original.b);
        assert_eq!(restored.a, original.a);
        assert_eq!(engine.tweens.tween_count(), 0);
    }

    #[test]
    fn shooter_lethal_enemy_hit_does_not_start_tint_tween() {
        let mut engine = Engine::new();
        engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
        engine.update(0.016);
        engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);

        let enemy = engine.world.spawn_enemy(500.0, 240.0, DEFAULT_TEXTURE_ID);
        let enemy_index = enemy.id as usize;
        engine.world.healths[enemy_index] = Some(1.0);
        let bullet = engine
            .world
            .spawn_bullet(500.0, 240.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
        engine.world.damages[bullet.id as usize] = Some(1.0);

        engine.update(0.0);

        assert!(!engine.world.alive[enemy_index]);
        assert_eq!(engine.tweens.tween_count(), 0);
    }

    #[test]
    fn collision_event_abi_includes_damage_payload_slot() {
        assert_eq!(crate::collision_event_u32s(), 6);
        assert_eq!(crate::collision_event_bytes(), 24);
    }

    #[test]
    fn configured_texture_ids_are_written_to_render_commands() {
        let mut engine = Engine::new();
        engine.set_texture_ids(1, 2, 3);
        engine.world.spawn_enemy(100.0, 100.0, 2);
        engine.world.spawn_bullet(120.0, 100.0, 0.0, 0.0, 3);
        engine.build_render_commands();

        let texture_ids: Vec<u32> = engine
            .render_commands
            .iter()
            .map(|command| command.texture_id as u32)
            .collect();
        assert!(texture_ids.contains(&1));
        assert!(texture_ids.contains(&2));
        assert!(texture_ids.contains(&3));
    }

    fn spawn_test_body(
        world: &mut World,
        x: f32,
        y: f32,
        layer: CollisionLayer,
    ) -> crate::entity::Entity {
        spawn_test_body_with_trigger(world, x, y, layer, false)
    }

    fn spawn_test_body_with_trigger(
        world: &mut World,
        x: f32,
        y: f32,
        layer: CollisionLayer,
        is_trigger: bool,
    ) -> crate::entity::Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_aabb_collider(
            entity,
            AabbCollider {
                half_width: 5.0,
                half_height: 5.0,
                offset_x: 0.0,
                offset_y: 0.0,
                enabled: true,
                is_trigger,
                layer,
            },
        );
        world.set_collision_filter(
            entity,
            CollisionFilter::new(layer.mask(), CollisionMask::ALL),
        );
        entity
    }

    #[test]
    fn resolved_shooter_config_applies_all_values_with_one_call() {
        let mut engine = Engine::new();

        engine.set_shooter_resolved_config(
            3200.0, 1800.0, 240.0, 120.0, 0.75, 640.0, 0.08, 2.4, 40.0, 44.0, 30.0, 34.0, 10.0,
            12.0, 4, 12.0, 3, 9.0, 2, 18.0, 2, 2, 4.0, 2.0, 9, 220.0, 18.0,
        );

        let config = engine.scene.config();
        assert_eq!(config.world_width, 3200.0);
        assert_eq!(config.world_height, 1800.0);
        assert_eq!(config.player_speed, 240.0);
        assert_eq!(config.enemy_speed, 120.0);
        assert_eq!(config.enemy_spawn_interval, 0.75);
        assert_eq!(config.bullet_speed, 640.0);
        assert_eq!(config.fire_cooldown, 0.08);
        assert_eq!(config.bullet_lifetime, 2.4);
        assert_eq!(config.player_template.sprite_width, 40.0);
        assert_eq!(config.player_template.sprite_height, 44.0);
        assert_eq!(config.enemy_template.sprite_width, 30.0);
        assert_eq!(config.enemy_template.sprite_height, 34.0);
        assert_eq!(config.bullet_template.sprite_width, 10.0);
        assert_eq!(config.bullet_template.sprite_height, 12.0);
        assert_eq!(
            config.player_template.animation.unwrap().idle.frame_count,
            4
        );
        assert_eq!(
            config
                .player_template
                .animation
                .unwrap()
                .idle
                .frames_per_second,
            12.0
        );
        assert_eq!(config.enemy_template.animation.unwrap().idle.frame_count, 3);
        assert_eq!(
            config
                .enemy_template
                .animation
                .unwrap()
                .idle
                .frames_per_second,
            9.0
        );
        assert_eq!(
            config.bullet_template.animation.unwrap().idle.frame_count,
            2
        );
        assert_eq!(
            config
                .bullet_template
                .animation
                .unwrap()
                .idle
                .frames_per_second,
            18.0
        );
        assert_eq!(config.enemy_behavior, EnemyBehavior::Static);
        assert_eq!(config.enemy_spawn_pattern, EnemySpawnPattern::Center);
        assert_eq!(config.enemy_health, 4.0);
        assert_eq!(config.bullet_damage, 2.0);
        assert_eq!(config.score_reward, 9);
        assert_eq!(config.orbit_radius, 220.0);
        assert_eq!(config.orbit_radial_band, 18.0);
    }

    #[test]
    fn shooter_prefab_collider_api_updates_template_and_existing_entities() {
        let mut engine = Engine::new();

        assert!(engine.set_shooter_prefab_collider(
            0, 12.0, 14.0, 2.0, -3.0, false, false, true, 0.2, 0.8, 2.0, 0.0, 1.4, 0.7, 0.6, 0.5,
            0.4,
        ));

        let config = engine.scene.config();
        assert_eq!(config.player_template.collider_half_width, 12.0);
        assert_eq!(config.player_template.collider_half_height, 14.0);
        assert_eq!(config.player_template.collider_offset_x, 2.0);
        assert_eq!(config.player_template.collider_offset_y, -3.0);
        assert!(!config.player_template.collider_enabled);
        assert!(!config.player_template.collider_is_trigger);
        let player = engine.world.player.unwrap();
        let collider = engine.world.colliders[player.id as usize].unwrap();
        assert_eq!(collider.half_width, 12.0);
        assert_eq!(collider.offset_x, 2.0);
        assert!(!collider.enabled);
        assert_eq!(
            engine.world.collider_material(player).unwrap().friction,
            0.8
        );

        assert!(!engine.set_shooter_prefab_collider(
            0,
            f32::NAN,
            14.0,
            2.0,
            -3.0,
            false,
            false,
            false,
            0.0,
            0.4,
            0.0,
            0.0,
            1.0,
            1.0,
            1.0,
            1.0,
            1.0,
        ));
        assert!(!engine.set_shooter_prefab_collider(
            99, 12.0, 14.0, 2.0, -3.0, false, false, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0,
            1.0,
        ));
    }

    #[test]
    fn shooter_prefab_shape_collider_apis_update_templates_and_entities() {
        let mut engine = Engine::new();

        assert!(engine.set_shooter_prefab_circle_collider(
            0, 11.0, 1.0, -2.0, true, true, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0,
        ));
        let player = engine.world.player.unwrap();
        let player_collider = engine.world.circle_colliders[player.id as usize].unwrap();
        assert_eq!(player_collider.radius, 11.0);
        assert_eq!(player_collider.offset_x, 1.0);
        assert_eq!(
            engine.world.collider_layer_at(player.id as usize),
            Some(CollisionLayer::Player)
        );

        assert!(engine.set_shooter_prefab_capsule_collider(
            1, -5.0, 0.0, 5.0, 0.0, 3.0, 0.0, 2.0, true, true, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0,
            1.0, 1.0, 1.0,
        ));
        let enemy = engine.world.spawn_enemy_from_template(
            100.0,
            100.0,
            DEFAULT_TEXTURE_ID,
            engine.scene.config().enemy_template,
            1.0,
            1,
        );
        assert_eq!(
            engine.world.capsule_colliders[enemy.id as usize]
                .unwrap()
                .radius,
            3.0
        );

        assert!(engine.set_shooter_prefab_oriented_box_collider(
            1, 7.0, 4.0, 0.3, 1.0, 1.0, true, false, false, 0.0, 0.4, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0,
            1.0,
        ));
        let enemy_collider = engine.world.oriented_box_colliders[enemy.id as usize].unwrap();
        assert_eq!(enemy_collider.half_width, 7.0);
        assert_eq!(enemy_collider.rotation_radians, 0.3);
        assert!(!enemy_collider.is_trigger);

        assert!(engine.set_shooter_prefab_convex_polygon_collider(
            2,
            vec![-2.0, -2.0, 2.0, -2.0, 0.0, 2.0],
            0.1,
            -1.0,
            0.5,
            true,
            true,
            false,
            0.0,
            0.4,
            0.0,
            0.0,
            1.0,
            1.0,
            1.0,
            1.0,
            1.0,
        ));
        let bullet = engine.world.spawn_bullet_from_template(
            Transform2D { x: 0.0, y: 0.0 },
            Velocity { vx: 0.0, vy: 0.0 },
            DEFAULT_TEXTURE_ID,
            1.0,
            engine.scene.config().bullet_template,
            1.0,
        );
        let polygon = engine.world.convex_polygon_colliders[bullet.id as usize].unwrap();
        assert_eq!(polygon.vertex_count, 3);
        assert_eq!(polygon.offset_x, -1.0);
        assert_eq!(polygon.rotation_radians, 0.1);

        assert!(!engine.set_shooter_prefab_circle_collider(
            0,
            f32::NAN,
            0.0,
            0.0,
            true,
            true,
            false,
            0.0,
            0.4,
            0.0,
            0.0,
            1.0,
            1.0,
            1.0,
            1.0,
            1.0,
        ));
        assert!(!engine.set_shooter_prefab_convex_polygon_collider(
            2,
            vec![0.0, 0.0, 1.0, 0.0],
            0.0,
            0.0,
            0.0,
            true,
            true,
            false,
            0.0,
            0.4,
            0.0,
            0.0,
            1.0,
            1.0,
            1.0,
            1.0,
            1.0,
        ));
    }

    #[test]
    fn camera_preset_applies_without_resetting_world() {
        let mut engine = Engine::new();
        engine.set_viewport_size(400.0, 240.0);
        let player = engine.world.player.unwrap();
        engine.world.transforms[player.id as usize] = Some(Transform2D {
            x: 1000.0,
            y: 600.0,
        });
        engine.world.spawn_enemy(100.0, 100.0, DEFAULT_TEXTURE_ID);

        engine.set_shooter_camera_preset(2, 160.0, 96.0, 80.0, 6.0, 8.0);

        assert_eq!(count_layer(&engine, CollisionLayer::Enemy), 1);
        assert_eq!(engine.camera_x(), 1000.0);
        assert_eq!(engine.camera_y(), 600.0);

        engine.world.velocities[player.id as usize] =
            Some(crate::components::Velocity { vx: 1.0, vy: 0.0 });
        engine
            .scene
            .update_camera_follow(&engine.world, &mut engine.camera);

        assert_eq!(engine.camera_x(), 1080.0);
        assert_eq!(engine.camera_y(), 600.0);
    }

    #[test]
    fn atlas_frame_updates_prefab_without_render_abi_change() {
        let mut engine = Engine::new();

        engine.set_shooter_atlas_frame(2, 9, 12.0, 10.0, 0.25, 0.5, 0.5, 0.75);
        engine.world.spawn_bullet_from_template(
            Transform2D { x: 120.0, y: 100.0 },
            crate::components::Velocity { vx: 0.0, vy: 0.0 },
            9,
            1.0,
            engine.scene.config().bullet_template,
            1.0,
        );
        engine.build_render_commands();

        let command = engine
            .render_commands
            .iter()
            .find(|command| command.texture_id == 9.0)
            .expect("bullet render command should use configured atlas texture");
        assert_eq!(command.width, 12.0);
        assert_eq!(command.height, 10.0);
        assert_eq!(command.u0, 0.25);
        assert_eq!(command.v0, 0.5);
        assert_eq!(command.u1, 0.5);
        assert_eq!(command.v1, 0.75);
        assert_eq!(
            command.effect_flags,
            crate::render_command::SPRITE_EFFECT_NONE
        );
        assert_eq!(crate::sprite_render_command_floats(), 14);
    }

    #[test]
    fn atlas_animation_updates_prefab_uvs_in_rust() {
        let mut engine = Engine::new();

        engine.set_shooter_atlas_animation(
            2,
            9,
            12.0,
            10.0,
            1.0,
            vec![0.0, 0.0, 0.25, 0.5],
            8.0,
            vec![0.0, 0.5, 0.25, 1.0, 0.25, 0.5, 0.5, 1.0],
        );
        engine.world.spawn_bullet_from_template(
            Transform2D { x: 120.0, y: 100.0 },
            crate::components::Velocity { vx: 10.0, vy: 0.0 },
            9,
            1.0,
            engine.scene.config().bullet_template,
            1.0,
        );
        engine.world.update(0.125);
        engine.build_render_commands();

        let command = engine
            .render_commands
            .iter()
            .find(|command| command.texture_id == 9.0)
            .expect("bullet render command should use configured atlas animation texture");
        assert_eq!(command.width, 12.0);
        assert_eq!(command.height, 10.0);
        assert_eq!(command.u0, 0.25);
        assert_eq!(command.v0, 0.5);
        assert_eq!(command.u1, 0.5);
        assert_eq!(command.v1, 1.0);
    }

    #[test]
    fn tilemap_render_commands_are_emitted_before_entities() {
        let mut engine = Engine::new();
        engine.set_viewport_size(1600.0, 960.0);
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 0.4, 0.5, 0.6, 0.7);
        engine.set_shooter_tilemap_layer(0, 2, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1, 0]);

        engine.build_render_commands();

        assert_eq!(engine.render_commands.len(), 2);
        let tile = engine.render_commands[0];
        assert_eq!(tile.texture_id, 9.0);
        assert_eq!(tile.width, 32.0);
        assert_eq!(tile.height, 32.0);
        assert_eq!(tile.r, 0.4);
        assert_eq!(tile.a, 0.7);
        assert!((tile.x - 0.0).abs() < 0.01);
        assert!((tile.y - 0.0).abs() < 0.01);

        let player = engine.render_commands[1];
        assert_eq!(player.texture_id, DEFAULT_TEXTURE_ID as f32);
    }

    #[test]
    fn clear_tilemap_removes_static_tile_render_commands() {
        let mut engine = Engine::new();
        engine.set_viewport_size(1600.0, 960.0);
        engine.set_shooter_tile(1, 9, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        engine.set_shooter_tilemap_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1]);

        engine.clear_shooter_tilemap();
        engine.build_render_commands();

        assert_eq!(engine.render_commands.len(), 1);
        assert_eq!(
            engine.render_commands[0].texture_id,
            DEFAULT_TEXTURE_ID as f32
        );
    }

    #[test]
    fn particle_preset_api_spawns_and_appends_render_commands_after_entities() {
        let mut engine = Engine::new();
        engine.build_render_commands();
        let entity_command_count = engine.render_commands.len();

        engine.set_particle_seed(7);
        engine.set_particle_preset(
            0, 77, 0.0, 0.0, 1.0, 1.0, 1, 1.0, 1.0, 0.0, 0.0, 6.0, 6.0, 2.0, 2.0, 1.0, 0.5, 0.25,
            1.0, 1.0, 0.5, 0.25, 0.5, 0.0, 0.0, 0.0,
        );

        let spawned = engine.spawn_particle_burst(0, engine.camera_x(), engine.camera_y());
        engine.build_render_commands();

        assert_eq!(spawned, 1);
        assert_eq!(engine.particle_count(), 1);
        assert_eq!(engine.render_commands.len(), entity_command_count + 1);
        let command = engine.render_commands.last().unwrap();
        assert_eq!(command.texture_id, 77.0);
        assert_eq!(command.width, 6.0);
        assert_eq!(command.height, 6.0);
        assert_eq!(command.u0, 0.0);
        assert_eq!(command.v0, 0.0);
        assert_eq!(command.u1, 1.0);
        assert_eq!(command.v1, 1.0);
        assert_eq!(command.r, 1.0);
        assert_eq!(command.a, 1.0);
    }

    #[test]
    fn particle_api_reports_missing_preset_and_updates_lifetime() {
        let mut engine = Engine::new();

        assert_eq!(engine.spawn_particle_burst(0, 0.0, 0.0), 0);
        engine.set_particle_preset(
            0, 77, 0.0, 0.0, 1.0, 1.0, 2, 0.05, 0.05, 0.0, 0.0, 4.0, 4.0, 4.0, 4.0, 1.0, 1.0, 1.0,
            1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0,
        );

        assert_eq!(engine.spawn_particle_burst(0, 0.0, 0.0), 2);
        assert_eq!(engine.particle_capacity(), 512);
        assert_eq!(engine.particle_count(), 2);

        engine.update(0.1);

        assert_eq!(engine.particle_count(), 0);
        engine.clear_particles();
        engine.clear_particle_presets();
        assert_eq!(engine.spawn_particle_burst(0, 0.0, 0.0), 0);
    }
}

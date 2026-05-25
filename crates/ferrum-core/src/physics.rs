use crate::collision::{
    collider_bounds, collider_shape, AabbBounds, ColliderCollisionContact, ColliderKey,
    ColliderPair as CollisionColliderPair, ColliderShapeRef, CollisionManifold, CollisionPair,
    CollisionSystem, SweptAabbContactHit,
};
use crate::components::{
    AabbCollider, AngularVelocity, CapsuleCollider, CollisionMask, ConvexPolygonCollider,
    DistanceJoint, DistanceJointId, EdgeCollider, GearJoint, GearJointId, PhysicsMaterial,
    PrismaticJoint, PrismaticJointId, PulleyJoint, PulleyJointId, RevoluteJoint, RevoluteJointId,
    RigidBody, RigidBodyCcdDebugHit, RigidBodyType, RigidContactImpulse, RopeJoint, RopeJointId,
    Rotation2D, SpringJoint, SpringJointId, Transform2D, Velocity, WeldJoint, WeldJointId,
    MAX_CONVEX_POLYGON_VERTICES,
};
use crate::entity::Entity;
use crate::tilemap::{Tilemap, TilemapSlopeGroundHit, TilemapSweepStats};
use crate::world::World;

const KINEMATIC_EPSILON: f32 = 0.0001;
const GROUND_NORMAL_Y_MIN: f32 = 0.5;
const MAX_KINEMATIC_ITERATIONS: u32 = 8;
const DEFAULT_PLATFORMER_HORIZONTAL_SPEED: f32 = 180.0;
const DEFAULT_PLATFORMER_GRAVITY: f32 = 900.0;
const DEFAULT_PLATFORMER_JUMP_SPEED: f32 = 360.0;
const DEFAULT_PLATFORMER_MAX_FALL_SPEED: f32 = 900.0;
const DEFAULT_PLATFORMER_GROUND_PROBE_DISTANCE: f32 = 2.0;
const DEFAULT_PLATFORMER_STEP_OFFSET: f32 = 0.0;
const DEFAULT_PLATFORMER_COYOTE_TIME_SECONDS: f32 = 0.0;
const DEFAULT_PLATFORMER_JUMP_BUFFER_SECONDS: f32 = 0.0;
const DEFAULT_FIXED_STEP_SECONDS: f32 = 1.0 / 60.0;
const DEFAULT_MAX_FRAME_SECONDS: f32 = 0.25;
const DEFAULT_MAX_FIXED_STEPS: u32 = 8;
const DEFAULT_RIGID_BODY_GRAVITY_Y: f32 = 980.0;
const DEFAULT_RIGID_BODY_VELOCITY_ITERATIONS: u32 = 6;
const DEFAULT_RIGID_BODY_POSITION_ITERATIONS: u32 = 3;
const MAX_RIGID_BODY_SUBSTEPS: u32 = 16;
const DEFAULT_POSITION_CORRECTION_PERCENT: f32 = 0.8;
const DEFAULT_POSITION_CORRECTION_SLOP: f32 = 0.01;
const DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR: f32 = 0.2;
const MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY: f32 = 120.0;
const DEFAULT_RESTITUTION_VELOCITY_THRESHOLD: f32 = 1.0;
const CONTACT_CACHE_POINT_MATCH_DISTANCE_SQUARED: f32 = 4.0;
const CONTACT_CACHE_NORMAL_DOT_MIN: f32 = 0.95;
const CONTACT_IMPULSE_EPSILON: f32 = 0.0001;
const DEFAULT_SLEEP_LINEAR_THRESHOLD: f32 = 0.05;
const DEFAULT_SLEEP_ANGULAR_THRESHOLD: f32 = 0.05;
const DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS: f32 = 0.5;
const MAX_RIGID_BODY_CCD_ITERATIONS: u32 = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhysicsBounds {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KinematicMoveResult {
    pub start: Transform2D,
    pub end: Transform2D,
    pub requested: Velocity,
    pub remaining: Velocity,
    pub hit_count: u32,
    pub blocked_x: bool,
    pub blocked_y: bool,
    pub last_hit: Option<Entity>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GroundProbeHit {
    pub entity: Option<Entity>,
    pub tile_layer_index: Option<usize>,
    pub tile_index: Option<usize>,
    pub distance: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SlopeSurfaceHit {
    pub x: f32,
    pub y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub t: f32,
    pub angle_radians: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SlopeSegment {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

impl SlopeSegment {
    pub const fn new(x0: f32, y0: f32, x1: f32, y1: f32) -> Self {
        Self { x0, y0, x1, y1 }
    }

    pub fn surface_at_x(self, x: f32) -> Option<SlopeSurfaceHit> {
        if !x.is_finite() {
            return None;
        }

        let dx = self.x1 - self.x0;
        let dy = self.y1 - self.y0;
        let length = self.length()?;
        let t = (x - self.x0) / dx;
        if !t.is_finite() || !(0.0..=1.0).contains(&t) {
            return None;
        }

        let y = self.y0 + dy * t;
        if !y.is_finite() {
            return None;
        }

        let (normal_x, normal_y) = upward_surface_normal(dx, dy, length);
        Some(SlopeSurfaceHit {
            x,
            y,
            normal_x,
            normal_y,
            t,
            angle_radians: dy.abs().atan2(dx.abs()),
        })
    }

    pub fn is_walkable(self, max_climb_angle_radians: f32) -> bool {
        max_climb_angle_radians.is_finite()
            && max_climb_angle_radians >= 0.0
            && self
                .angle_radians()
                .is_some_and(|angle| angle <= max_climb_angle_radians)
    }

    fn angle_radians(self) -> Option<f32> {
        let dx = self.x1 - self.x0;
        let dy = self.y1 - self.y0;
        self.length().map(|_| dy.abs().atan2(dx.abs()))
    }

    fn length(self) -> Option<f32> {
        if !self.x0.is_finite()
            || !self.y0.is_finite()
            || !self.x1.is_finite()
            || !self.y1.is_finite()
        {
            return None;
        }

        let dx = self.x1 - self.x0;
        let dy = self.y1 - self.y0;
        if dx.abs() <= KINEMATIC_EPSILON {
            return None;
        }

        let length = dx.hypot(dy);
        if length.is_finite() && length > KINEMATIC_EPSILON {
            Some(length)
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SlopeConfig {
    pub max_climb_angle_radians: f32,
    pub snap_distance: f32,
    pub allow_downhill_snap: bool,
}

impl SlopeConfig {
    pub const fn new(max_climb_angle_radians: f32, snap_distance: f32) -> Self {
        Self {
            max_climb_angle_radians,
            snap_distance,
            allow_downhill_snap: true,
        }
    }

    pub const fn disabled() -> Self {
        Self {
            max_climb_angle_radians: 0.0,
            snap_distance: 0.0,
            allow_downhill_snap: false,
        }
    }

    pub const fn with_downhill_snap(mut self, allow_downhill_snap: bool) -> Self {
        self.allow_downhill_snap = allow_downhill_snap;
        self
    }
}

impl Default for SlopeConfig {
    fn default() -> Self {
        Self::disabled()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OneWayPlatformConfig {
    pub platform_mask: CollisionMask,
}

impl OneWayPlatformConfig {
    pub const fn new(platform_mask: CollisionMask) -> Self {
        Self { platform_mask }
    }

    pub const fn disabled() -> Self {
        Self {
            platform_mask: CollisionMask::NONE,
        }
    }

    pub const fn is_enabled(self) -> bool {
        self.platform_mask.bits != 0
    }
}

impl Default for OneWayPlatformConfig {
    fn default() -> Self {
        Self::disabled()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MovingPlatformCarryConfig {
    pub platform: Entity,
    pub displacement: Velocity,
    pub probe_distance: f32,
    pub solid_mask: CollisionMask,
    pub one_way_platforms: OneWayPlatformConfig,
    pub max_iterations: u32,
}

impl MovingPlatformCarryConfig {
    pub const fn new(
        platform: Entity,
        displacement: Velocity,
        probe_distance: f32,
        solid_mask: CollisionMask,
        max_iterations: u32,
    ) -> Self {
        Self {
            platform,
            displacement,
            probe_distance,
            solid_mask,
            one_way_platforms: OneWayPlatformConfig::disabled(),
            max_iterations,
        }
    }

    pub const fn with_one_way_platforms(mut self, one_way_platforms: OneWayPlatformConfig) -> Self {
        self.one_way_platforms = one_way_platforms;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlatformerControllerInput {
    pub horizontal_axis: f32,
    pub jump_pressed: bool,
}

impl PlatformerControllerInput {
    pub const fn new(horizontal_axis: f32, jump_pressed: bool) -> Self {
        Self {
            horizontal_axis,
            jump_pressed,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlatformerControllerConfig {
    pub horizontal_speed: f32,
    pub gravity: f32,
    pub jump_speed: f32,
    pub max_fall_speed: f32,
    pub ground_probe_distance: f32,
    pub step_offset: f32,
    pub coyote_time_seconds: f32,
    pub jump_buffer_seconds: f32,
    pub slope: SlopeConfig,
    pub solid_mask: CollisionMask,
    pub one_way_platforms: OneWayPlatformConfig,
    pub max_iterations: u32,
}

impl PlatformerControllerConfig {
    pub const fn new(solid_mask: CollisionMask, max_iterations: u32) -> Self {
        Self {
            horizontal_speed: DEFAULT_PLATFORMER_HORIZONTAL_SPEED,
            gravity: DEFAULT_PLATFORMER_GRAVITY,
            jump_speed: DEFAULT_PLATFORMER_JUMP_SPEED,
            max_fall_speed: DEFAULT_PLATFORMER_MAX_FALL_SPEED,
            ground_probe_distance: DEFAULT_PLATFORMER_GROUND_PROBE_DISTANCE,
            step_offset: DEFAULT_PLATFORMER_STEP_OFFSET,
            coyote_time_seconds: DEFAULT_PLATFORMER_COYOTE_TIME_SECONDS,
            jump_buffer_seconds: DEFAULT_PLATFORMER_JUMP_BUFFER_SECONDS,
            slope: SlopeConfig::disabled(),
            solid_mask,
            one_way_platforms: OneWayPlatformConfig::disabled(),
            max_iterations,
        }
    }

    pub const fn with_horizontal_speed(mut self, horizontal_speed: f32) -> Self {
        self.horizontal_speed = horizontal_speed;
        self
    }

    pub const fn with_gravity(mut self, gravity: f32) -> Self {
        self.gravity = gravity;
        self
    }

    pub const fn with_jump_speed(mut self, jump_speed: f32) -> Self {
        self.jump_speed = jump_speed;
        self
    }

    pub const fn with_max_fall_speed(mut self, max_fall_speed: f32) -> Self {
        self.max_fall_speed = max_fall_speed;
        self
    }

    pub const fn with_ground_probe_distance(mut self, ground_probe_distance: f32) -> Self {
        self.ground_probe_distance = ground_probe_distance;
        self
    }

    pub const fn with_step_offset(mut self, step_offset: f32) -> Self {
        self.step_offset = step_offset;
        self
    }

    pub const fn with_coyote_time_seconds(mut self, coyote_time_seconds: f32) -> Self {
        self.coyote_time_seconds = coyote_time_seconds;
        self
    }

    pub const fn with_jump_buffer_seconds(mut self, jump_buffer_seconds: f32) -> Self {
        self.jump_buffer_seconds = jump_buffer_seconds;
        self
    }

    pub const fn with_slope_config(mut self, slope: SlopeConfig) -> Self {
        self.slope = slope;
        self
    }

    pub const fn with_one_way_platforms(mut self, one_way_platforms: OneWayPlatformConfig) -> Self {
        self.one_way_platforms = one_way_platforms;
        self
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PlatformerControllerState {
    pub coyote_time_remaining: f32,
    pub jump_buffer_remaining: f32,
}

impl PlatformerControllerState {
    pub const fn new() -> Self {
        Self {
            coyote_time_remaining: 0.0,
            jump_buffer_remaining: 0.0,
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlatformerControllerResult {
    pub movement: KinematicMoveResult,
    pub velocity: Velocity,
    pub ground_before: Option<GroundProbeHit>,
    pub ground_after: Option<GroundProbeHit>,
    pub jumped: bool,
    pub grounded: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FixedTimestepConfig {
    pub step_seconds: f32,
    pub max_frame_seconds: f32,
    pub max_steps_per_update: u32,
}

impl Default for FixedTimestepConfig {
    fn default() -> Self {
        Self {
            step_seconds: DEFAULT_FIXED_STEP_SECONDS,
            max_frame_seconds: DEFAULT_MAX_FRAME_SECONDS,
            max_steps_per_update: DEFAULT_MAX_FIXED_STEPS,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FixedTimestepUpdate {
    pub steps: u32,
    pub alpha: f32,
    pub consumed_seconds: f32,
    pub dropped_seconds: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FixedTimestep {
    config: FixedTimestepConfig,
    accumulated_seconds: f32,
    paused: bool,
}

impl Default for FixedTimestep {
    fn default() -> Self {
        Self::new(FixedTimestepConfig::default())
    }
}

impl FixedTimestep {
    pub fn new(config: FixedTimestepConfig) -> Self {
        Self {
            config: sanitize_fixed_timestep_config(config),
            accumulated_seconds: 0.0,
            paused: false,
        }
    }

    pub fn config(&self) -> FixedTimestepConfig {
        self.config
    }

    pub fn accumulated_seconds(&self) -> f32 {
        self.accumulated_seconds
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn pause(&mut self) {
        self.paused = true;
    }

    pub fn resume(&mut self) {
        self.paused = false;
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
    }

    pub fn reset(&mut self) {
        self.accumulated_seconds = 0.0;
    }

    pub fn advance(&mut self, delta_seconds: f32) -> FixedTimestepUpdate {
        if self.paused {
            return FixedTimestepUpdate {
                steps: 0,
                alpha: (self.accumulated_seconds / self.config.step_seconds).clamp(0.0, 1.0),
                consumed_seconds: 0.0,
                dropped_seconds: 0.0,
            };
        }

        let clamped_delta = if delta_seconds.is_finite() && delta_seconds > 0.0 {
            delta_seconds.min(self.config.max_frame_seconds)
        } else {
            0.0
        };
        let dropped_seconds = if delta_seconds.is_finite() && delta_seconds > clamped_delta {
            delta_seconds - clamped_delta
        } else {
            0.0
        };

        self.accumulated_seconds += clamped_delta;
        let mut steps = 0;
        while self.accumulated_seconds + KINEMATIC_EPSILON >= self.config.step_seconds
            && steps < self.config.max_steps_per_update
        {
            self.accumulated_seconds -= self.config.step_seconds;
            steps += 1;
        }

        let step_seconds = self.config.step_seconds;
        let mut accumulator_dropped = 0.0;
        if steps == self.config.max_steps_per_update
            && self.accumulated_seconds + KINEMATIC_EPSILON >= step_seconds
        {
            let accumulated_before_drop = self.accumulated_seconds;
            let kept = accumulated_before_drop % step_seconds;
            self.accumulated_seconds =
                if kept <= KINEMATIC_EPSILON || kept + KINEMATIC_EPSILON >= step_seconds {
                    0.0
                } else {
                    kept
                };
            accumulator_dropped = accumulated_before_drop - self.accumulated_seconds;
        }

        FixedTimestepUpdate {
            steps,
            alpha: (self.accumulated_seconds / self.config.step_seconds).clamp(0.0, 1.0),
            consumed_seconds: steps as f32 * self.config.step_seconds,
            dropped_seconds: dropped_seconds + accumulator_dropped,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PhysicsCounters {
    pub fixed_steps: u32,
    pub kinematic_moves: u32,
    pub kinematic_hits: u32,
    pub kinematic_entity_hits: u32,
    pub kinematic_tile_hits: u32,
    pub solid_candidate_checks: u32,
    pub tile_candidate_checks: u32,
    pub collision_pairs: u32,
    pub collision_solid_pairs: u32,
    pub collision_trigger_pairs: u32,
}

impl PhysicsCounters {
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    pub fn record_fixed_update(&mut self, update: FixedTimestepUpdate) {
        self.fixed_steps = self.fixed_steps.saturating_add(update.steps);
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RigidBodyStepConfig {
    pub gravity: Velocity,
    pub velocity_iterations: u32,
    pub position_iterations: u32,
    pub position_correction_percent: f32,
    pub position_correction_slop: f32,
    pub restitution_velocity_threshold: f32,
    pub contact_baumgarte_bias_factor: f32,
    pub max_contact_baumgarte_bias_velocity: f32,
    pub contact_split_impulse: bool,
}

impl Default for RigidBodyStepConfig {
    fn default() -> Self {
        Self {
            gravity: Velocity {
                vx: 0.0,
                vy: DEFAULT_RIGID_BODY_GRAVITY_Y,
            },
            velocity_iterations: DEFAULT_RIGID_BODY_VELOCITY_ITERATIONS,
            position_iterations: DEFAULT_RIGID_BODY_POSITION_ITERATIONS,
            position_correction_percent: DEFAULT_POSITION_CORRECTION_PERCENT,
            position_correction_slop: DEFAULT_POSITION_CORRECTION_SLOP,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RigidBodyStepStats {
    pub substeps: u32,
    pub dynamic_bodies: u32,
    pub angular_bodies: u32,
    pub island_count: u32,
    pub island_bodies: u32,
    pub active_islands: u32,
    pub sleeping_islands: u32,
    pub largest_island_bodies: u32,
    pub contact_checks: u32,
    pub velocity_impulses: u32,
    pub contact_block_solves: u32,
    pub baumgarte_velocity_biases: u32,
    pub split_velocity_impulses: u32,
    pub restitution_velocity_threshold_skips: u32,
    pub warm_start_impulses: u32,
    pub contact_cache_entries: u32,
    pub sleeping_bodies: u32,
    pub bodies_put_to_sleep: u32,
    pub bodies_woken: u32,
    pub islands_woken: u32,
    pub islands_put_to_sleep: u32,
    pub ccd_checks: u32,
    pub ccd_hits: u32,
    pub position_corrections: u32,
    pub split_position_corrections: u32,
    pub constraint_velocity_corrections: u32,
    pub constraint_position_corrections: u32,
    pub broken_joints: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RigidBodyIslandStats {
    pub island_count: u32,
    pub island_bodies: u32,
    pub active_islands: u32,
    pub sleeping_islands: u32,
    pub largest_island_bodies: u32,
}

#[derive(Default)]
pub struct PhysicsSystem;

#[derive(Clone, Copy, Debug)]
struct KinematicMoveSettings {
    solid_mask: CollisionMask,
    one_way_platforms: OneWayPlatformConfig,
    max_iterations: u32,
    ignored_entity: Option<Entity>,
}

impl KinematicMoveSettings {
    const fn new(
        solid_mask: CollisionMask,
        one_way_platforms: OneWayPlatformConfig,
        max_iterations: u32,
    ) -> Self {
        Self {
            solid_mask,
            one_way_platforms,
            max_iterations,
            ignored_entity: None,
        }
    }

    const fn ignoring_entity(mut self, entity: Entity) -> Self {
        self.ignored_entity = Some(entity);
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct RigidContactConstraint {
    pair: CollisionPair,
    collider_pair: CollisionColliderPair,
    point: Transform2D,
    normal: Velocity,
    penetration: f32,
    normal_impulse: f32,
    tangent_impulse: f32,
    split_normal_impulse: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct RigidContactMassContext {
    a_index: usize,
    b_index: usize,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
    inverse_inertia_a: f32,
    inverse_inertia_b: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct RigidContactSolveResult {
    applied_impulse: bool,
    used_baumgarte_bias: bool,
    skipped_restitution: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct RigidContactBlockSolveResult {
    applied_impulses: u32,
    used_baumgarte_biases: u32,
    skipped_restitutions: u32,
}

#[derive(Clone, Debug, PartialEq)]
struct RigidSplitImpulseState {
    linear_velocities: Vec<Velocity>,
    angular_velocities: Vec<f32>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct RigidContactBlockMatrix {
    k11: f32,
    k12: f32,
    k22: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct RigidBodyCcdHit {
    target_index: usize,
    target_dynamic: bool,
    time: f32,
    normal: Velocity,
    point: Transform2D,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct RigidBodyCcdDynamicTarget {
    start: Transform2D,
    velocity: Velocity,
}

#[derive(Clone, Copy, Debug)]
struct RigidBodyCcdQuery<'a> {
    moving_index: usize,
    start: Transform2D,
    shape: ColliderShapeRef,
    velocity: Velocity,
    delta_seconds: f32,
    integrated: &'a [bool],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RigidBodyAccumulatorMode {
    apply_impulses: bool,
    clear_forces: bool,
}

#[derive(Debug, Default)]
struct RigidBodyIslandGraph {
    node_for_entity: Vec<Option<usize>>,
    entity_indices: Vec<usize>,
    parents: Vec<usize>,
    sizes: Vec<u32>,
    active: Vec<bool>,
    sleeping: Vec<bool>,
}

#[derive(Debug, Default)]
struct RigidBodyIslandSchedule {
    root_for_entity: Vec<Option<usize>>,
    roots: Vec<usize>,
}

#[derive(Debug)]
struct RigidBodyConstraintBatch {
    contact_constraints: Vec<RigidContactConstraint>,
    island_schedule: RigidBodyIslandSchedule,
    split_impulses: Option<RigidSplitImpulseState>,
}

impl PhysicsSystem {
    pub fn step_rigid_bodies(world: &mut World, delta_seconds: f32) -> RigidBodyStepStats {
        Self::step_rigid_bodies_with_config(world, delta_seconds, RigidBodyStepConfig::default())
    }

    pub fn step_rigid_bodies_with_config(
        world: &mut World,
        delta_seconds: f32,
        config: RigidBodyStepConfig,
    ) -> RigidBodyStepStats {
        Self::step_rigid_bodies_substepped_with_config(world, delta_seconds, 1, config)
    }

    pub fn step_rigid_bodies_substepped(
        world: &mut World,
        delta_seconds: f32,
        substeps: u32,
    ) -> RigidBodyStepStats {
        Self::step_rigid_bodies_substepped_with_config(
            world,
            delta_seconds,
            substeps,
            RigidBodyStepConfig::default(),
        )
    }

    pub fn step_rigid_bodies_substepped_with_config(
        world: &mut World,
        delta_seconds: f32,
        substeps: u32,
        config: RigidBodyStepConfig,
    ) -> RigidBodyStepStats {
        world.clear_rigid_body_ccd_debug_hits();
        let delta_seconds = sanitize_delta_seconds(delta_seconds);
        if delta_seconds <= 0.0 {
            return RigidBodyStepStats::default();
        }

        let config = sanitize_rigid_body_step_config(config);
        let substeps = sanitize_rigid_body_substeps(substeps);
        let substep_seconds = delta_seconds / substeps as f32;
        let mut stats = RigidBodyStepStats {
            substeps,
            ..RigidBodyStepStats::default()
        };

        for substep_index in 0..substeps {
            let is_first_substep = substep_index == 0;
            let is_last_substep = substep_index + 1 == substeps;
            Self::step_rigid_bodies_once(
                world,
                substep_seconds,
                config,
                RigidBodyAccumulatorMode {
                    apply_impulses: is_first_substep,
                    clear_forces: is_last_substep,
                },
                &mut stats,
            );
        }

        let island_stats = Self::analyze_rigid_body_islands(world);
        stats.island_count = island_stats.island_count;
        stats.island_bodies = island_stats.island_bodies;
        stats.active_islands = island_stats.active_islands;
        stats.sleeping_islands = island_stats.sleeping_islands;
        stats.largest_island_bodies = island_stats.largest_island_bodies;

        stats
    }

    pub fn analyze_rigid_body_islands(world: &World) -> RigidBodyIslandStats {
        let mut graph = RigidBodyIslandGraph::from_world(world);
        union_contact_islands(world, &mut graph);
        union_joint_islands(world, &mut graph);
        graph.stats()
    }

    fn step_rigid_bodies_once(
        world: &mut World,
        delta_seconds: f32,
        config: RigidBodyStepConfig,
        accumulator_mode: RigidBodyAccumulatorMode,
        stats: &mut RigidBodyStepStats,
    ) {
        Self::integrate_rigid_body_step(world, delta_seconds, config, accumulator_mode, stats);
        wake_sleeping_rigid_body_islands(world, stats);
        let mut constraints = Self::prepare_rigid_body_constraints(world, config, stats);
        Self::solve_rigid_body_velocity_phase(
            world,
            delta_seconds,
            config,
            &mut constraints,
            stats,
        );
        Self::solve_rigid_body_position_phase(world, config, &constraints, stats);
        update_rigid_body_sleep_states(world, delta_seconds, stats);
    }

    fn integrate_rigid_body_step(
        world: &mut World,
        delta_seconds: f32,
        config: RigidBodyStepConfig,
        accumulator_mode: RigidBodyAccumulatorMode,
        stats: &mut RigidBodyStepStats,
    ) {
        integrate_rigid_body_velocities(
            world,
            delta_seconds,
            config.gravity,
            accumulator_mode,
            stats,
        );
        integrate_rigid_body_positions(world, delta_seconds, config, stats);
    }

    fn prepare_rigid_body_constraints(
        world: &mut World,
        config: RigidBodyStepConfig,
        stats: &mut RigidBodyStepStats,
    ) -> RigidBodyConstraintBatch {
        let contact_constraints = build_rigid_contact_constraints(world);
        let island_schedule =
            RigidBodyIslandSchedule::from_world_and_contacts(world, &contact_constraints);
        let split_impulses = config
            .contact_split_impulse
            .then(|| RigidSplitImpulseState::from_world(world));
        warm_start_rigid_contact_constraints(world, &contact_constraints, stats);
        RigidBodyConstraintBatch {
            contact_constraints,
            island_schedule,
            split_impulses,
        }
    }

    fn solve_rigid_body_velocity_phase(
        world: &mut World,
        delta_seconds: f32,
        config: RigidBodyStepConfig,
        constraints: &mut RigidBodyConstraintBatch,
        stats: &mut RigidBodyStepStats,
    ) {
        for _ in 0..config.velocity_iterations {
            for island_root in constraints.island_schedule.roots() {
                solve_prismatic_joint_velocity_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_weld_joint_velocity_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_revolute_joint_velocity_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_gear_joint_velocity_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_spring_joint_velocity_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_pulley_joint_velocity_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    delta_seconds,
                    config.velocity_iterations,
                    stats,
                );
                solve_distance_joint_velocity_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    stats,
                );
                solve_rope_joint_velocity_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    stats,
                );
                solve_rigid_body_velocity_contacts(
                    world,
                    &mut constraints.contact_constraints,
                    &constraints.island_schedule,
                    island_root,
                    config,
                    delta_seconds,
                    stats,
                );
                if let Some(split_impulses) = constraints.split_impulses.as_mut() {
                    solve_rigid_body_split_impulse_contacts(
                        world,
                        split_impulses,
                        &mut constraints.contact_constraints,
                        &constraints.island_schedule,
                        island_root,
                        config,
                        delta_seconds,
                        stats,
                    );
                }
            }
        }
        if let Some(split_impulses) = constraints.split_impulses.take() {
            split_impulses.apply_to_world(world, delta_seconds);
        }
        stats.contact_cache_entries =
            store_rigid_contact_impulses(world, &constraints.contact_constraints);
    }

    fn solve_rigid_body_position_phase(
        world: &mut World,
        config: RigidBodyStepConfig,
        constraints: &RigidBodyConstraintBatch,
        stats: &mut RigidBodyStepStats,
    ) {
        for _ in 0..config.position_iterations {
            for island_root in constraints.island_schedule.roots() {
                solve_prismatic_joint_position_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    stats,
                );
                solve_weld_joint_position_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    stats,
                );
                solve_revolute_joint_position_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    stats,
                );
                solve_gear_joint_position_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    stats,
                );
                solve_pulley_joint_position_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    stats,
                );
                solve_distance_joint_position_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    stats,
                );
                solve_rope_joint_position_constraints(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    stats,
                );
                solve_rigid_body_position_contacts(
                    world,
                    &constraints.island_schedule,
                    island_root,
                    config,
                    stats,
                );
            }
        }
    }

    pub fn integrate(world: &mut World, delta: f32) {
        for i in 0..world.transforms.len() {
            if !world.alive[i] {
                continue;
            }
            if let (Some(transform), Some(velocity)) =
                (world.transforms[i].as_mut(), world.velocities[i])
            {
                transform.x += velocity.vx * delta;
                transform.y += velocity.vy * delta;
            }
        }
    }

    pub fn clamp_entity_to_bounds(world: &mut World, entity: Entity, bounds: PhysicsBounds) {
        let i = entity.id as usize;
        if i >= world.alive.len() || !world.alive[i] || world.generations[i] != entity.generation {
            return;
        }
        let Some(shape) = collider_shape(world, i) else {
            return;
        };
        if let Some(transform) = world.transforms[i].as_mut() {
            let collider_bounds = collider_bounds(*transform, shape);
            let mut dx = 0.0;
            let mut dy = 0.0;
            if collider_bounds.max_x - collider_bounds.min_x > bounds.max_x - bounds.min_x {
                dx = (bounds.min_x + bounds.max_x - collider_bounds.min_x - collider_bounds.max_x)
                    * 0.5;
            } else if collider_bounds.min_x < bounds.min_x {
                dx = bounds.min_x - collider_bounds.min_x;
            } else if collider_bounds.max_x > bounds.max_x {
                dx = bounds.max_x - collider_bounds.max_x;
            }
            if collider_bounds.max_y - collider_bounds.min_y > bounds.max_y - bounds.min_y {
                dy = (bounds.min_y + bounds.max_y - collider_bounds.min_y - collider_bounds.max_y)
                    * 0.5;
            } else if collider_bounds.min_y < bounds.min_y {
                dy = bounds.min_y - collider_bounds.min_y;
            } else if collider_bounds.max_y > bounds.max_y {
                dy = bounds.max_y - collider_bounds.max_y;
            }
            transform.x += dx;
            transform.y += dy;
        }
    }

    pub fn move_and_slide(
        world: &mut World,
        entity: Entity,
        displacement: Velocity,
        solid_mask: CollisionMask,
        max_iterations: u32,
    ) -> KinematicMoveResult {
        move_and_slide_internal(
            world,
            None,
            entity,
            displacement,
            KinematicMoveSettings::new(solid_mask, OneWayPlatformConfig::default(), max_iterations),
            None,
        )
    }

    pub fn move_and_slide_with_tilemap(
        world: &mut World,
        tilemap: &Tilemap,
        entity: Entity,
        displacement: Velocity,
        solid_mask: CollisionMask,
        max_iterations: u32,
    ) -> KinematicMoveResult {
        move_and_slide_internal(
            world,
            Some(tilemap),
            entity,
            displacement,
            KinematicMoveSettings::new(solid_mask, OneWayPlatformConfig::default(), max_iterations),
            None,
        )
    }

    pub fn move_and_slide_with_tilemap_and_counters(
        world: &mut World,
        tilemap: &Tilemap,
        entity: Entity,
        displacement: Velocity,
        solid_mask: CollisionMask,
        max_iterations: u32,
        counters: &mut PhysicsCounters,
    ) -> KinematicMoveResult {
        move_and_slide_internal(
            world,
            Some(tilemap),
            entity,
            displacement,
            KinematicMoveSettings::new(solid_mask, OneWayPlatformConfig::default(), max_iterations),
            Some(counters),
        )
    }

    pub fn move_and_slide_with_one_way_platforms(
        world: &mut World,
        entity: Entity,
        displacement: Velocity,
        solid_mask: CollisionMask,
        one_way_platforms: OneWayPlatformConfig,
        max_iterations: u32,
    ) -> KinematicMoveResult {
        move_and_slide_internal(
            world,
            None,
            entity,
            displacement,
            KinematicMoveSettings::new(solid_mask, one_way_platforms, max_iterations),
            None,
        )
    }

    pub fn move_and_slide_with_tilemap_and_one_way_platforms(
        world: &mut World,
        tilemap: &Tilemap,
        entity: Entity,
        displacement: Velocity,
        solid_mask: CollisionMask,
        one_way_platforms: OneWayPlatformConfig,
        max_iterations: u32,
    ) -> KinematicMoveResult {
        move_and_slide_internal(
            world,
            Some(tilemap),
            entity,
            displacement,
            KinematicMoveSettings::new(solid_mask, one_way_platforms, max_iterations),
            None,
        )
    }

    pub fn ground_probe(
        world: &World,
        entity: Entity,
        probe_distance: f32,
        solid_mask: CollisionMask,
    ) -> Option<GroundProbeHit> {
        ground_probe_internal(world, None, entity, probe_distance, solid_mask)
    }

    pub fn ground_probe_with_tilemap(
        world: &World,
        tilemap: &Tilemap,
        entity: Entity,
        probe_distance: f32,
        solid_mask: CollisionMask,
    ) -> Option<GroundProbeHit> {
        ground_probe_internal(world, Some(tilemap), entity, probe_distance, solid_mask)
    }

    pub fn carry_moving_platform(
        world: &mut World,
        rider: Entity,
        config: MovingPlatformCarryConfig,
    ) -> Option<KinematicMoveResult> {
        carry_moving_platform_internal(world, None, rider, config)
    }

    pub fn carry_moving_platform_with_tilemap(
        world: &mut World,
        tilemap: &Tilemap,
        rider: Entity,
        config: MovingPlatformCarryConfig,
    ) -> Option<KinematicMoveResult> {
        carry_moving_platform_internal(world, Some(tilemap), rider, config)
    }

    pub fn move_platformer_controller(
        world: &mut World,
        entity: Entity,
        input: PlatformerControllerInput,
        config: PlatformerControllerConfig,
        delta_seconds: f32,
    ) -> PlatformerControllerResult {
        move_platformer_controller_internal(
            world,
            None,
            entity,
            input,
            config,
            delta_seconds,
            PlatformerControllerRuntime::default(),
        )
    }

    pub fn move_platformer_controller_with_state(
        world: &mut World,
        entity: Entity,
        input: PlatformerControllerInput,
        config: PlatformerControllerConfig,
        delta_seconds: f32,
        state: &mut PlatformerControllerState,
    ) -> PlatformerControllerResult {
        move_platformer_controller_internal(
            world,
            None,
            entity,
            input,
            config,
            delta_seconds,
            PlatformerControllerRuntime::new(Some(state), None),
        )
    }

    pub fn move_platformer_controller_with_slopes(
        world: &mut World,
        slopes: &[SlopeSegment],
        entity: Entity,
        input: PlatformerControllerInput,
        config: PlatformerControllerConfig,
        delta_seconds: f32,
    ) -> PlatformerControllerResult {
        move_platformer_controller_internal(
            world,
            None,
            entity,
            input,
            config,
            delta_seconds,
            PlatformerControllerRuntime::new_with_slopes(None, None, slopes),
        )
    }

    pub fn move_platformer_controller_with_counters(
        world: &mut World,
        entity: Entity,
        input: PlatformerControllerInput,
        config: PlatformerControllerConfig,
        delta_seconds: f32,
        counters: &mut PhysicsCounters,
    ) -> PlatformerControllerResult {
        move_platformer_controller_internal(
            world,
            None,
            entity,
            input,
            config,
            delta_seconds,
            PlatformerControllerRuntime::new(None, Some(counters)),
        )
    }

    pub fn move_platformer_controller_with_state_and_counters(
        world: &mut World,
        entity: Entity,
        input: PlatformerControllerInput,
        config: PlatformerControllerConfig,
        delta_seconds: f32,
        state: &mut PlatformerControllerState,
        counters: &mut PhysicsCounters,
    ) -> PlatformerControllerResult {
        move_platformer_controller_internal(
            world,
            None,
            entity,
            input,
            config,
            delta_seconds,
            PlatformerControllerRuntime::new(Some(state), Some(counters)),
        )
    }

    pub fn move_platformer_controller_with_tilemap(
        world: &mut World,
        tilemap: &Tilemap,
        entity: Entity,
        input: PlatformerControllerInput,
        config: PlatformerControllerConfig,
        delta_seconds: f32,
    ) -> PlatformerControllerResult {
        move_platformer_controller_internal(
            world,
            Some(tilemap),
            entity,
            input,
            config,
            delta_seconds,
            PlatformerControllerRuntime::default(),
        )
    }

    pub fn move_platformer_controller_with_tilemap_and_state(
        world: &mut World,
        tilemap: &Tilemap,
        entity: Entity,
        input: PlatformerControllerInput,
        config: PlatformerControllerConfig,
        delta_seconds: f32,
        state: &mut PlatformerControllerState,
    ) -> PlatformerControllerResult {
        move_platformer_controller_internal(
            world,
            Some(tilemap),
            entity,
            input,
            config,
            delta_seconds,
            PlatformerControllerRuntime::new(Some(state), None),
        )
    }

    pub fn move_platformer_controller_with_tilemap_and_counters(
        world: &mut World,
        tilemap: &Tilemap,
        entity: Entity,
        input: PlatformerControllerInput,
        config: PlatformerControllerConfig,
        delta_seconds: f32,
        counters: &mut PhysicsCounters,
    ) -> PlatformerControllerResult {
        move_platformer_controller_internal(
            world,
            Some(tilemap),
            entity,
            input,
            config,
            delta_seconds,
            PlatformerControllerRuntime::new(None, Some(counters)),
        )
    }
}

fn integrate_rigid_body_velocities(
    world: &mut World,
    delta_seconds: f32,
    gravity: Velocity,
    accumulator_mode: RigidBodyAccumulatorMode,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.rigid_bodies.len() {
        if !world.alive.get(index).copied().unwrap_or(false) {
            continue;
        }
        let Some(mut body) = world.rigid_bodies[index] else {
            continue;
        };
        if !body.enabled {
            clear_rigid_body_accumulators(&mut body);
            body.is_sleeping = false;
            body.sleep_timer_seconds = 0.0;
            world.rigid_bodies[index] = Some(body);
            continue;
        }
        if body.body_type != RigidBodyType::Dynamic {
            continue;
        }
        if body.is_sleeping && rigid_body_has_pending_wake_input(body) {
            body.is_sleeping = false;
            body.sleep_timer_seconds = 0.0;
            stats.bodies_woken = stats.bodies_woken.saturating_add(1);
        }
        if body.is_sleeping {
            world.rigid_bodies[index] = Some(body);
            continue;
        }
        let inverse_mass = sanitized_inverse_mass(body);
        if inverse_mass <= 0.0 {
            continue;
        }

        let mut velocity = world.velocities[index].unwrap_or_default();
        let mut angular_velocity = world.angular_velocities[index].unwrap_or_default();
        let impulse = if accumulator_mode.apply_impulses {
            body.impulse
        } else {
            Velocity::default()
        };
        velocity.vx += (gravity.vx * sanitized_gravity_scale(body) + body.force.vx * inverse_mass)
            * delta_seconds
            + impulse.vx * inverse_mass;
        velocity.vy += (gravity.vy * sanitized_gravity_scale(body) + body.force.vy * inverse_mass)
            * delta_seconds
            + impulse.vy * inverse_mass;

        let inverse_inertia = sanitized_inverse_inertia(body);
        if inverse_inertia > 0.0 {
            let angular_impulse = if accumulator_mode.apply_impulses {
                body.angular_impulse
            } else {
                0.0
            };
            angular_velocity.radians_per_second +=
                body.torque * inverse_inertia * delta_seconds + angular_impulse * inverse_inertia;
        }

        let damping = sanitized_linear_damping(body);
        if damping > 0.0 {
            let damping_factor = (1.0 - damping * delta_seconds).clamp(0.0, 1.0);
            velocity.vx *= damping_factor;
            velocity.vy *= damping_factor;
        }

        let angular_damping = sanitized_angular_damping(body);
        if angular_damping > 0.0 {
            let damping_factor = (1.0 - angular_damping * delta_seconds).clamp(0.0, 1.0);
            angular_velocity.radians_per_second *= damping_factor;
        }

        if accumulator_mode.clear_forces {
            body.force = Velocity::default();
            body.torque = 0.0;
        }
        if accumulator_mode.apply_impulses {
            body.impulse = Velocity::default();
            body.angular_impulse = 0.0;
        }
        world.velocities[index] = Some(finite_velocity(velocity));
        world.angular_velocities[index] = Some(finite_angular_velocity(angular_velocity));
        world.rigid_bodies[index] = Some(body);
        stats.dynamic_bodies = stats.dynamic_bodies.saturating_add(1);
        if inverse_inertia > 0.0 {
            stats.angular_bodies = stats.angular_bodies.saturating_add(1);
        }
    }
}

fn integrate_rigid_body_positions(
    world: &mut World,
    delta_seconds: f32,
    config: RigidBodyStepConfig,
    stats: &mut RigidBodyStepStats,
) {
    let mut integrated = vec![false; world.rigid_bodies.len()];
    for index in 0..world.rigid_bodies.len() {
        if integrated.get(index).copied().unwrap_or(false) {
            continue;
        }
        if !world.alive.get(index).copied().unwrap_or(false) {
            continue;
        }
        let Some(body) = world.rigid_bodies[index] else {
            continue;
        };
        if !body.enabled
            || body.is_sleeping
            || !matches!(
                body.body_type,
                RigidBodyType::Dynamic | RigidBodyType::Kinematic
            )
        {
            continue;
        }
        if body.body_type == RigidBodyType::Dynamic
            && integrate_dynamic_rigid_body_position_with_ccd(
                world,
                index,
                delta_seconds,
                config,
                &mut integrated,
                stats,
            )
        {
            integrated[index] = true;
            continue;
        }
        let Some(transform) = world.transforms[index].as_mut() else {
            continue;
        };
        let velocity = finite_velocity(world.velocities[index].unwrap_or_default());
        transform.x += velocity.vx * delta_seconds;
        transform.y += velocity.vy * delta_seconds;
        if let (Some(rotation), Some(angular_velocity)) = (
            world.rotations[index].as_mut(),
            world.angular_velocities[index].map(finite_angular_velocity),
        ) {
            rotation.radians = finite_rotation(Rotation2D {
                radians: rotation.radians + angular_velocity.radians_per_second * delta_seconds,
            })
            .radians;
        }
        integrated[index] = true;
    }
}

fn integrate_dynamic_rigid_body_position_with_ccd(
    world: &mut World,
    index: usize,
    delta_seconds: f32,
    config: RigidBodyStepConfig,
    integrated: &mut [bool],
    stats: &mut RigidBodyStepStats,
) -> bool {
    let Some(mut current_start) = world.transforms.get(index).copied().flatten() else {
        return false;
    };
    let Some(shape) = collider_shape(world, index) else {
        return false;
    };
    if shape.is_trigger() {
        return false;
    }
    let mut remaining_seconds = delta_seconds;
    let mut handled_ccd_hit = false;

    for _ in 0..MAX_RIGID_BODY_CCD_ITERATIONS {
        if remaining_seconds <= KINEMATIC_EPSILON {
            break;
        }
        let velocity = finite_velocity(world.velocities[index].unwrap_or_default());
        if velocity_len_squared(velocity) <= KINEMATIC_EPSILON * KINEMATIC_EPSILON {
            break;
        }
        let Some(hit) = earliest_rigid_body_ccd_hit(
            world,
            RigidBodyCcdQuery {
                moving_index: index,
                start: current_start,
                shape,
                velocity,
                delta_seconds: remaining_seconds,
                integrated,
            },
            stats,
        ) else {
            break;
        };

        let impact_seconds = remaining_seconds * hit.time.clamp(0.0, 1.0);
        let dynamic_target = hit
            .target_dynamic
            .then(|| rigid_body_ccd_dynamic_target(world, hit.target_index))
            .flatten();

        integrate_rigid_body_rotation(world, index, impact_seconds);
        current_start = Transform2D {
            x: current_start.x + velocity.vx * impact_seconds,
            y: current_start.y + velocity.vy * impact_seconds,
        };
        world.transforms[index] = Some(current_start);

        if let Some(target) = dynamic_target {
            wake_rigid_body_for_ccd_impact(world, hit.target_index, stats);
            integrate_rigid_body_rotation(world, hit.target_index, impact_seconds);
            world.transforms[hit.target_index] = Some(Transform2D {
                x: target.start.x + target.velocity.vx * impact_seconds,
                y: target.start.y + target.velocity.vy * impact_seconds,
            });
        }

        if apply_rigid_body_ccd_impact(world, index, hit, config) {
            stats.velocity_impulses = stats.velocity_impulses.saturating_add(1);
        }
        world.record_rigid_body_ccd_debug_hit(RigidBodyCcdDebugHit {
            moving_entity: entity_at_index(world, index),
            target_entity: entity_at_index(world, hit.target_index),
            time: hit.time,
            point_x: hit.point.x,
            point_y: hit.point.y,
            normal_x: hit.normal.vx,
            normal_y: hit.normal.vy,
        });
        stats.ccd_hits = stats.ccd_hits.saturating_add(1);
        handled_ccd_hit = true;

        remaining_seconds = (remaining_seconds - impact_seconds).max(0.0);
        if dynamic_target.is_some() {
            integrate_rigid_body_ccd_dynamic_target_remainder(
                world,
                hit.target_index,
                remaining_seconds,
                integrated,
            );
        }
    }

    if !handled_ccd_hit {
        return false;
    }

    let velocity_after_impact = finite_velocity(world.velocities[index].unwrap_or_default());
    if let Some(transform) = world.transforms[index].as_mut() {
        transform.x += velocity_after_impact.vx * remaining_seconds;
        transform.y += velocity_after_impact.vy * remaining_seconds;
    }
    integrate_rigid_body_rotation(world, index, remaining_seconds);
    true
}

fn rigid_body_ccd_dynamic_target(world: &World, index: usize) -> Option<RigidBodyCcdDynamicTarget> {
    let start = world.transforms.get(index).copied().flatten()?;
    let velocity = finite_velocity(
        world
            .velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    );
    Some(RigidBodyCcdDynamicTarget { start, velocity })
}

fn integrate_rigid_body_ccd_dynamic_target_remainder(
    world: &mut World,
    index: usize,
    remaining_seconds: f32,
    integrated: &mut [bool],
) {
    let target_velocity_after_impact = finite_velocity(world.velocities[index].unwrap_or_default());
    if let Some(target_transform) = world.transforms[index].as_mut() {
        target_transform.x += target_velocity_after_impact.vx * remaining_seconds;
        target_transform.y += target_velocity_after_impact.vy * remaining_seconds;
    }
    integrate_rigid_body_rotation(world, index, remaining_seconds);
    if let Some(target_integrated) = integrated.get_mut(index) {
        *target_integrated = true;
    }
}

fn wake_rigid_body_for_ccd_impact(world: &mut World, index: usize, stats: &mut RigidBodyStepStats) {
    let Some(mut body) = world.rigid_bodies.get(index).copied().flatten() else {
        return;
    };
    if body.body_type != RigidBodyType::Dynamic || !body.is_sleeping {
        return;
    }
    body.is_sleeping = false;
    body.sleep_timer_seconds = 0.0;
    if let Some(slot) = world.rigid_bodies.get_mut(index) {
        *slot = Some(body);
    }
    stats.bodies_woken = stats.bodies_woken.saturating_add(1);
}

fn integrate_rigid_body_rotation(world: &mut World, index: usize, delta_seconds: f32) {
    if delta_seconds <= 0.0 {
        return;
    }
    if let (Some(rotation), Some(angular_velocity)) = (
        world.rotations[index].as_mut(),
        world.angular_velocities[index].map(finite_angular_velocity),
    ) {
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians + angular_velocity.radians_per_second * delta_seconds,
        })
        .radians;
    }
}

fn earliest_rigid_body_ccd_hit(
    world: &World,
    query: RigidBodyCcdQuery<'_>,
    stats: &mut RigidBodyStepStats,
) -> Option<RigidBodyCcdHit> {
    let mut best = None;
    for target_index in 0..world.transforms.len() {
        if !rigid_body_ccd_target_allows(world, query.moving_index, target_index, query.integrated)
        {
            continue;
        }
        let Some(target_shape) = collider_shape(world, target_index) else {
            continue;
        };
        if target_shape.is_trigger() {
            continue;
        }
        let Some(target_transform) = world.transforms[target_index] else {
            continue;
        };
        if CollisionSystem::shapes_overlap(query.start, query.shape, target_transform, target_shape)
        {
            continue;
        }
        let target_velocity = finite_velocity(world.velocities[target_index].unwrap_or_default());
        stats.ccd_checks = stats.ccd_checks.saturating_add(1);
        let Some(contact) = CollisionSystem::swept_shape_contact(
            query.start,
            query.velocity,
            query.shape,
            target_transform,
            target_velocity,
            target_shape,
            query.delta_seconds,
        ) else {
            continue;
        };
        let normal = Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        };
        let relative_velocity = Velocity {
            vx: query.velocity.vx - target_velocity.vx,
            vy: query.velocity.vy - target_velocity.vy,
        };
        if dot_velocity(relative_velocity, normal) <= KINEMATIC_EPSILON {
            continue;
        }
        let time = contact.time.clamp(0.0, 1.0);
        let moving_at_impact = Transform2D {
            x: query.start.x + query.velocity.vx * query.delta_seconds * time,
            y: query.start.y + query.velocity.vy * query.delta_seconds * time,
        };
        let target_at_impact = Transform2D {
            x: target_transform.x + target_velocity.vx * query.delta_seconds * time,
            y: target_transform.y + target_velocity.vy * query.delta_seconds * time,
        };
        let hit = RigidBodyCcdHit {
            target_index,
            target_dynamic: world
                .rigid_bodies
                .get(target_index)
                .copied()
                .flatten()
                .is_some_and(|body| body.body_type == RigidBodyType::Dynamic),
            time,
            normal,
            point: rigid_body_ccd_contact_point(
                moving_at_impact,
                query.shape,
                target_at_impact,
                target_shape,
                normal,
            ),
        };
        update_rigid_body_ccd_hit(&mut best, hit);
    }
    best
}

fn rigid_body_ccd_target_allows(
    world: &World,
    moving_index: usize,
    target_index: usize,
    integrated: &[bool],
) -> bool {
    if moving_index == target_index || !world.alive.get(target_index).copied().unwrap_or(false) {
        return false;
    }
    if has_disabled_rigid_body(world, moving_index) || has_disabled_rigid_body(world, target_index)
    {
        return false;
    }
    if !rigid_contact_filter_allows(world, moving_index, target_index) {
        return false;
    }
    if let Some(body) = world.rigid_bodies.get(target_index).copied().flatten() {
        body.body_type != RigidBodyType::Dynamic
            || !integrated.get(target_index).copied().unwrap_or(false)
    } else {
        true
    }
}

fn rigid_contact_filter_allows(world: &World, a_index: usize, b_index: usize) -> bool {
    let Some(a_filter) = world.collision_filter_at(a_index) else {
        return false;
    };
    let Some(b_filter) = world.collision_filter_at(b_index) else {
        return false;
    };
    a_filter.can_collide_with(b_filter)
}

fn rigid_body_ccd_contact_point(
    moving_transform: Transform2D,
    moving_shape: ColliderShapeRef,
    target_transform: Transform2D,
    target_shape: ColliderShapeRef,
    normal: Velocity,
) -> Transform2D {
    match (moving_shape, target_shape) {
        (ColliderShapeRef::Aabb(moving_collider), ColliderShapeRef::Aabb(target_collider)) => {
            let moving_bounds = AabbBounds::from_transform(moving_transform, moving_collider);
            let target_bounds = AabbBounds::from_transform(target_transform, target_collider);
            let moving_center = moving_collider.center(moving_transform);
            if normal.vx != 0.0 {
                let min_y = moving_bounds.min_y.max(target_bounds.min_y);
                let max_y = moving_bounds.max_y.min(target_bounds.max_y);
                Transform2D {
                    x: moving_center.x + normal.vx * moving_collider.half_width,
                    y: (min_y + max_y) * 0.5,
                }
            } else {
                let min_x = moving_bounds.min_x.max(target_bounds.min_x);
                let max_x = moving_bounds.max_x.min(target_bounds.max_x);
                Transform2D {
                    x: (min_x + max_x) * 0.5,
                    y: moving_center.y + normal.vy * moving_collider.half_height,
                }
            }
        }
        (ColliderShapeRef::Circle(moving_collider), _) => {
            let center = moving_collider.center(moving_transform);
            Transform2D {
                x: center.x + normal.vx * moving_collider.radius,
                y: center.y + normal.vy * moving_collider.radius,
            }
        }
        (ColliderShapeRef::OrientedBox(moving_collider, moving_rotation), _) => {
            oriented_box_support_point(moving_transform, moving_collider, moving_rotation, normal)
        }
        (ColliderShapeRef::Aabb(moving_collider), ColliderShapeRef::Circle(target_collider)) => {
            let target_center = target_collider.center(target_transform);
            let moving_bounds = AabbBounds::from_transform(moving_transform, moving_collider);
            Transform2D {
                x: (target_center.x - normal.vx * target_collider.radius)
                    .clamp(moving_bounds.min_x, moving_bounds.max_x),
                y: (target_center.y - normal.vy * target_collider.radius)
                    .clamp(moving_bounds.min_y, moving_bounds.max_y),
            }
        }
        (ColliderShapeRef::Capsule(moving_collider), _) => {
            capsule_support_point(moving_transform, moving_collider, normal)
        }
        (ColliderShapeRef::Edge(moving_collider), _) => {
            edge_support_point(moving_transform, moving_collider, normal)
        }
        (ColliderShapeRef::ConvexPolygon(moving_collider, moving_rotation), _) => {
            convex_polygon_support_point(moving_transform, moving_collider, moving_rotation, normal)
        }
        (
            ColliderShapeRef::Aabb(moving_collider),
            ColliderShapeRef::Capsule(_)
            | ColliderShapeRef::Edge(_)
            | ColliderShapeRef::OrientedBox(_, _),
        ) => aabb_support_point(moving_transform, moving_collider, normal),
        (ColliderShapeRef::Aabb(moving_collider), ColliderShapeRef::ConvexPolygon(_, _)) => {
            aabb_support_point(moving_transform, moving_collider, normal)
        }
    }
}

fn aabb_support_point(
    transform: Transform2D,
    collider: AabbCollider,
    direction: Velocity,
) -> Transform2D {
    let center = collider.center(transform);
    Transform2D {
        x: center.x + support_axis_sign(direction.vx) * collider.half_width,
        y: center.y + support_axis_sign(direction.vy) * collider.half_height,
    }
}

fn oriented_box_support_point(
    transform: Transform2D,
    collider: crate::components::OrientedBoxCollider,
    rotation_radians: f32,
    direction: Velocity,
) -> Transform2D {
    let center = collider.center(transform);
    if !rotation_radians.is_finite()
        || !direction.vx.is_finite()
        || !direction.vy.is_finite()
        || collider.half_width <= 0.0
        || collider.half_height <= 0.0
    {
        return center;
    }

    let (sin, cos) = rotation_radians.sin_cos();
    let axis_x = Velocity { vx: cos, vy: sin };
    let axis_y = Velocity { vx: -sin, vy: cos };
    let x_sign = support_axis_sign(direction.vx * axis_x.vx + direction.vy * axis_x.vy);
    let y_sign = support_axis_sign(direction.vx * axis_y.vx + direction.vy * axis_y.vy);
    Transform2D {
        x: center.x
            + axis_x.vx * collider.half_width * x_sign
            + axis_y.vx * collider.half_height * y_sign,
        y: center.y
            + axis_x.vy * collider.half_width * x_sign
            + axis_y.vy * collider.half_height * y_sign,
    }
}

fn capsule_support_point(
    transform: Transform2D,
    collider: CapsuleCollider,
    direction: Velocity,
) -> Transform2D {
    let start = collider.start(transform);
    let end = collider.end(transform);
    let start_projection = start.x * direction.vx + start.y * direction.vy;
    let end_projection = end.x * direction.vx + end.y * direction.vy;
    let endpoint = if (start_projection - end_projection).abs() <= KINEMATIC_EPSILON {
        Transform2D {
            x: (start.x + end.x) * 0.5,
            y: (start.y + end.y) * 0.5,
        }
    } else if start_projection > end_projection {
        start
    } else {
        end
    };
    let (normal_x, normal_y) = normalized_direction(direction);
    Transform2D {
        x: endpoint.x + normal_x * collider.radius,
        y: endpoint.y + normal_y * collider.radius,
    }
}

fn edge_support_point(
    transform: Transform2D,
    collider: EdgeCollider,
    direction: Velocity,
) -> Transform2D {
    let start = collider.start(transform);
    let end = collider.end(transform);
    let start_projection = start.x * direction.vx + start.y * direction.vy;
    let end_projection = end.x * direction.vx + end.y * direction.vy;
    if (start_projection - end_projection).abs() <= KINEMATIC_EPSILON {
        Transform2D {
            x: (start.x + end.x) * 0.5,
            y: (start.y + end.y) * 0.5,
        }
    } else if start_projection > end_projection {
        start
    } else {
        end
    }
}

fn convex_polygon_support_point(
    transform: Transform2D,
    collider: ConvexPolygonCollider,
    rotation_radians: f32,
    direction: Velocity,
) -> Transform2D {
    let center = collider.center(transform);
    let vertex_count = collider.vertex_count as usize;
    if !(3..=MAX_CONVEX_POLYGON_VERTICES).contains(&vertex_count)
        || !rotation_radians.is_finite()
        || !direction.vx.is_finite()
        || !direction.vy.is_finite()
    {
        return center;
    }

    let (sin, cos) = rotation_radians.sin_cos();
    let mut best_projection = f32::NEG_INFINITY;
    let mut support_sum = Transform2D { x: 0.0, y: 0.0 };
    let mut support_count = 0;
    for vertex in &collider.vertices[..vertex_count] {
        if !vertex.x.is_finite() || !vertex.y.is_finite() {
            return center;
        }
        let point = Transform2D {
            x: center.x + vertex.x * cos - vertex.y * sin,
            y: center.y + vertex.x * sin + vertex.y * cos,
        };
        let projection = point.x * direction.vx + point.y * direction.vy;
        if projection > best_projection + KINEMATIC_EPSILON {
            best_projection = projection;
            support_sum = point;
            support_count = 1;
        } else if (projection - best_projection).abs() <= KINEMATIC_EPSILON {
            support_sum.x += point.x;
            support_sum.y += point.y;
            support_count += 1;
        }
    }

    if support_count == 0 {
        center
    } else {
        Transform2D {
            x: support_sum.x / support_count as f32,
            y: support_sum.y / support_count as f32,
        }
    }
}

fn normalized_direction(direction: Velocity) -> (f32, f32) {
    let length_squared = direction.vx * direction.vx + direction.vy * direction.vy;
    if length_squared <= KINEMATIC_EPSILON * KINEMATIC_EPSILON || !length_squared.is_finite() {
        return (1.0, 0.0);
    }
    let inv_length = length_squared.sqrt().recip();
    (direction.vx * inv_length, direction.vy * inv_length)
}

fn support_axis_sign(value: f32) -> f32 {
    if value > KINEMATIC_EPSILON {
        1.0
    } else if value < -KINEMATIC_EPSILON {
        -1.0
    } else {
        0.0
    }
}

fn update_rigid_body_ccd_hit(best: &mut Option<RigidBodyCcdHit>, next: RigidBodyCcdHit) {
    if best.is_none_or(|current| {
        next.time
            .total_cmp(&current.time)
            .then_with(|| next.target_index.cmp(&current.target_index))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

fn apply_rigid_body_ccd_impact(
    world: &mut World,
    moving_index: usize,
    hit: RigidBodyCcdHit,
    config: RigidBodyStepConfig,
) -> bool {
    let mut constraint = RigidContactConstraint {
        pair: CollisionPair {
            a: entity_at_index(world, moving_index),
            b: entity_at_index(world, hit.target_index),
        },
        collider_pair: CollisionColliderPair {
            a: ColliderKey {
                entity_index: moving_index,
                collider_index: 0,
                segment_index: 0,
            },
            b: ColliderKey {
                entity_index: hit.target_index,
                collider_index: 0,
                segment_index: 0,
            },
        },
        point: hit.point,
        normal: hit.normal,
        penetration: 0.0,
        normal_impulse: 0.0,
        tangent_impulse: 0.0,
        split_normal_impulse: 0.0,
    };
    solve_velocity_contact_constraint(world, &mut constraint, config, 1.0).applied_impulse
}

fn entity_at_index(world: &World, index: usize) -> Entity {
    Entity {
        id: index as u32,
        generation: world.generations[index],
    }
}

impl RigidBodyIslandGraph {
    fn from_world(world: &World) -> Self {
        let mut graph = Self {
            node_for_entity: vec![None; world.rigid_bodies.len()],
            ..Self::default()
        };

        for index in 0..world.rigid_bodies.len() {
            let Some(body) = rigid_body_island_candidate(world, index) else {
                continue;
            };
            let node = graph.parents.len();
            graph.node_for_entity[index] = Some(node);
            graph.entity_indices.push(index);
            graph.parents.push(node);
            graph.sizes.push(1);
            graph
                .active
                .push(body.body_type == RigidBodyType::Kinematic || !body.is_sleeping);
            graph
                .sleeping
                .push(body.body_type == RigidBodyType::Dynamic && body.is_sleeping);
        }

        graph
    }

    fn union_entities(&mut self, world: &World, a: Entity, b: Entity) -> bool {
        let Some(a_index) = valid_world_entity_index(world, a) else {
            return false;
        };
        let Some(b_index) = valid_world_entity_index(world, b) else {
            return false;
        };
        let Some(a_node) = self.node_for_entity.get(a_index).copied().flatten() else {
            return false;
        };
        let Some(b_node) = self.node_for_entity.get(b_index).copied().flatten() else {
            return false;
        };

        self.union_nodes(a_node, b_node)
    }

    fn union_nodes(&mut self, a: usize, b: usize) -> bool {
        let mut a_root = self.find_root(a);
        let mut b_root = self.find_root(b);
        if a_root == b_root {
            return false;
        }
        if self.sizes[a_root] < self.sizes[b_root] {
            std::mem::swap(&mut a_root, &mut b_root);
        }

        self.parents[b_root] = a_root;
        self.sizes[a_root] = self.sizes[a_root].saturating_add(self.sizes[b_root]);
        self.active[a_root] = self.active[a_root] || self.active[b_root];
        self.sleeping[a_root] = self.sleeping[a_root] || self.sleeping[b_root];
        true
    }

    fn find_root(&mut self, node: usize) -> usize {
        let parent = self.parents[node];
        if parent == node {
            node
        } else {
            let root = self.find_root(parent);
            self.parents[node] = root;
            root
        }
    }

    fn stats(&mut self) -> RigidBodyIslandStats {
        let mut seen_roots = vec![false; self.parents.len()];
        let mut stats = RigidBodyIslandStats::default();

        for node in 0..self.parents.len() {
            let root = self.find_root(node);
            if seen_roots[root] {
                continue;
            }
            seen_roots[root] = true;
            stats.island_count = stats.island_count.saturating_add(1);
            stats.island_bodies = stats.island_bodies.saturating_add(self.sizes[root]);
            stats.largest_island_bodies = stats.largest_island_bodies.max(self.sizes[root]);
            if self.active[root] {
                stats.active_islands = stats.active_islands.saturating_add(1);
            } else if self.sleeping[root] {
                stats.sleeping_islands = stats.sleeping_islands.saturating_add(1);
            }
        }

        stats
    }

    fn sleeping_body_indices_in_wake_source_islands(&mut self, world: &World) -> (Vec<usize>, u32) {
        let mut root_has_wake_source = vec![false; self.parents.len()];
        for node in 0..self.parents.len() {
            let root = self.find_root(node);
            let entity_index = self.entity_indices[node];
            if is_rigid_body_wake_source(world, entity_index) {
                root_has_wake_source[root] = true;
            }
        }

        let mut root_wakes_sleeping_body = vec![false; self.parents.len()];
        let mut body_indices = Vec::new();
        for node in 0..self.parents.len() {
            let root = self.find_root(node);
            if !root_has_wake_source[root] {
                continue;
            }
            let entity_index = self.entity_indices[node];
            if is_sleeping_dynamic_rigid_body(world, entity_index) {
                root_wakes_sleeping_body[root] = true;
                body_indices.push(entity_index);
            }
        }
        let islands_woken = root_wakes_sleeping_body
            .into_iter()
            .filter(|wakes_sleeping_body| *wakes_sleeping_body)
            .count() as u32;

        (body_indices, islands_woken)
    }

    fn body_indices_ready_for_island_sleep(&mut self, world: &World) -> (Vec<usize>, u32) {
        let mut root_can_sleep = vec![true; self.parents.len()];
        let mut root_has_candidate = vec![false; self.parents.len()];
        let mut node_is_candidate = vec![false; self.parents.len()];

        for (node, is_candidate) in node_is_candidate.iter_mut().enumerate() {
            let root = self.find_root(node);
            let entity_index = self.entity_indices[node];
            let Some(body) = world.rigid_bodies.get(entity_index).copied().flatten() else {
                root_can_sleep[root] = false;
                continue;
            };

            match body.body_type {
                RigidBodyType::Static => {
                    root_can_sleep[root] = false;
                }
                RigidBodyType::Kinematic => {
                    root_can_sleep[root] = false;
                }
                RigidBodyType::Dynamic => {
                    if !body.can_sleep {
                        root_can_sleep[root] = false;
                    } else if body.is_sleeping {
                        continue;
                    } else if rigid_body_is_ready_for_sleep(world, entity_index, body) {
                        root_has_candidate[root] = true;
                        *is_candidate = true;
                    } else {
                        root_can_sleep[root] = false;
                    }
                }
            }
        }

        let mut island_count = 0_u32;
        let mut seen_roots = vec![false; self.parents.len()];
        for node in 0..self.parents.len() {
            let root = self.find_root(node);
            if seen_roots[root] {
                continue;
            }
            seen_roots[root] = true;
            if root_can_sleep[root] && root_has_candidate[root] {
                island_count = island_count.saturating_add(1);
            }
        }

        let mut body_indices = Vec::new();
        for (node, is_candidate) in node_is_candidate.into_iter().enumerate() {
            if !is_candidate {
                continue;
            }
            let root = self.find_root(node);
            if root_can_sleep[root] {
                body_indices.push(self.entity_indices[node]);
            }
        }

        (body_indices, island_count)
    }
}

impl RigidBodyIslandSchedule {
    fn from_world_and_contacts(world: &World, contacts: &[RigidContactConstraint]) -> Self {
        let mut graph = RigidBodyIslandGraph::from_world(world);
        union_contact_constraint_islands(world, contacts, &mut graph);
        union_joint_islands(world, &mut graph);

        let mut schedule = Self {
            root_for_entity: vec![None; world.rigid_bodies.len()],
            ..Self::default()
        };
        let mut seen_roots = vec![false; graph.parents.len()];
        for node in 0..graph.parents.len() {
            let root = graph.find_root(node);
            let entity_index = graph.entity_indices[node];
            if let Some(slot) = schedule.root_for_entity.get_mut(entity_index) {
                *slot = Some(root);
            }
            if !seen_roots[root] {
                seen_roots[root] = true;
                schedule.roots.push(root);
            }
        }

        schedule
    }

    fn roots(&self) -> impl Iterator<Item = usize> + '_ {
        self.roots.iter().copied()
    }

    fn contact_in_island(&self, contact: &RigidContactConstraint, island_root: usize) -> bool {
        self.pair_in_island(contact.pair, island_root)
    }

    fn pair_in_island(&self, pair: CollisionPair, island_root: usize) -> bool {
        self.pair_indices_in_island(pair.a.id as usize, pair.b.id as usize, island_root)
    }

    fn joint_in_island(&self, entity_a: Entity, entity_b: Entity, island_root: usize) -> bool {
        self.pair_indices_in_island(entity_a.id as usize, entity_b.id as usize, island_root)
    }

    fn pair_indices_in_island(&self, a_index: usize, b_index: usize, island_root: usize) -> bool {
        self.root_for_pair_indices(a_index, b_index)
            .is_some_and(|root| root == island_root)
    }

    fn root_for_pair_indices(&self, a_index: usize, b_index: usize) -> Option<usize> {
        match (self.entity_root(a_index), self.entity_root(b_index)) {
            (Some(a_root), Some(b_root)) if a_root == b_root => Some(a_root),
            (Some(a_root), None) => Some(a_root),
            (None, Some(b_root)) => Some(b_root),
            _ => None,
        }
    }

    fn entity_root(&self, index: usize) -> Option<usize> {
        self.root_for_entity.get(index).copied().flatten()
    }
}

fn rigid_body_island_candidate(world: &World, index: usize) -> Option<RigidBody> {
    if !world.alive.get(index).copied().unwrap_or(false) {
        return None;
    }
    let body = world.rigid_bodies.get(index).copied().flatten()?;
    (body.enabled
        && matches!(
            body.body_type,
            RigidBodyType::Dynamic | RigidBodyType::Kinematic
        ))
    .then_some(body)
}

fn union_contact_islands(world: &World, graph: &mut RigidBodyIslandGraph) {
    for manifold in CollisionSystem::build_rigid_manifolds(world) {
        let a_index = manifold.pair.a.id as usize;
        let b_index = manifold.pair.b.id as usize;
        if should_solve_rigid_contact(world, a_index, b_index) {
            graph.union_entities(world, manifold.pair.a, manifold.pair.b);
        }
    }
}

fn union_contact_constraint_islands(
    world: &World,
    contacts: &[RigidContactConstraint],
    graph: &mut RigidBodyIslandGraph,
) {
    for contact in contacts {
        graph.union_entities(world, contact.pair.a, contact.pair.b);
    }
}

fn union_joint_islands(world: &World, graph: &mut RigidBodyIslandGraph) {
    for joint in world.distance_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.rope_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.spring_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.pulley_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.revolute_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.prismatic_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.weld_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
    for joint in world.gear_joints.iter().copied().flatten() {
        union_enabled_joint_island(world, graph, joint.enabled, joint.entity_a, joint.entity_b);
    }
}

fn union_enabled_joint_island(
    world: &World,
    graph: &mut RigidBodyIslandGraph,
    enabled: bool,
    entity_a: Entity,
    entity_b: Entity,
) {
    if enabled && entity_a != entity_b {
        graph.union_entities(world, entity_a, entity_b);
    }
}

fn wake_sleeping_rigid_body_islands(world: &mut World, stats: &mut RigidBodyStepStats) {
    let mut graph = RigidBodyIslandGraph::from_world(world);
    union_contact_islands(world, &mut graph);
    union_joint_islands(world, &mut graph);
    let (body_indices, islands_woken) = graph.sleeping_body_indices_in_wake_source_islands(world);

    let mut bodies_woken = 0_u32;
    for index in body_indices {
        if wake_sleeping_rigid_body_at(world, index) {
            bodies_woken = bodies_woken.saturating_add(1);
        }
    }
    if bodies_woken > 0 {
        stats.bodies_woken = stats.bodies_woken.saturating_add(bodies_woken);
        stats.islands_woken = stats.islands_woken.saturating_add(islands_woken);
    }
}

fn update_rigid_body_sleep_states(
    world: &mut World,
    delta_seconds: f32,
    stats: &mut RigidBodyStepStats,
) {
    update_rigid_body_sleep_timers(world, delta_seconds, stats);
    put_ready_rigid_body_islands_to_sleep(world, stats);
    stats.sleeping_bodies = stats
        .sleeping_bodies
        .saturating_add(count_sleeping_dynamic_rigid_bodies(world));
}

fn update_rigid_body_sleep_timers(
    world: &mut World,
    delta_seconds: f32,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.rigid_bodies.len() {
        if !world.alive.get(index).copied().unwrap_or(false) {
            continue;
        }
        let Some(mut body) = world.rigid_bodies[index] else {
            continue;
        };
        if !body.enabled {
            body.sleep_timer_seconds = 0.0;
            body.is_sleeping = false;
            world.rigid_bodies[index] = Some(body);
            continue;
        }
        if body.body_type != RigidBodyType::Dynamic {
            body.sleep_timer_seconds = 0.0;
            body.is_sleeping = false;
            world.rigid_bodies[index] = Some(body);
            continue;
        }
        if !body.can_sleep {
            if body.is_sleeping {
                body.is_sleeping = false;
                stats.bodies_woken = stats.bodies_woken.saturating_add(1);
            }
            body.sleep_timer_seconds = 0.0;
            world.rigid_bodies[index] = Some(body);
            continue;
        }
        if body.is_sleeping {
            world.rigid_bodies[index] = Some(body);
            continue;
        }

        let velocity = finite_velocity(world.velocities[index].unwrap_or_default());
        let angular_velocity = finite_angular_velocity(
            world
                .angular_velocities
                .get(index)
                .copied()
                .flatten()
                .unwrap_or_default(),
        );
        if rigid_body_is_below_sleep_thresholds(velocity, angular_velocity) {
            body.sleep_timer_seconds =
                sanitize_non_negative(body.sleep_timer_seconds + delta_seconds)
                    .min(DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS);
        } else {
            body.sleep_timer_seconds = 0.0;
        }
        world.rigid_bodies[index] = Some(body);
    }
}

fn put_ready_rigid_body_islands_to_sleep(world: &mut World, stats: &mut RigidBodyStepStats) {
    let mut graph = RigidBodyIslandGraph::from_world(world);
    union_contact_islands(world, &mut graph);
    union_joint_islands(world, &mut graph);
    let (body_indices, islands_put_to_sleep) = graph.body_indices_ready_for_island_sleep(world);

    let mut bodies_put_to_sleep = 0_u32;
    for index in body_indices {
        if put_rigid_body_to_sleep_at(world, index) {
            bodies_put_to_sleep = bodies_put_to_sleep.saturating_add(1);
        }
    }

    if bodies_put_to_sleep > 0 {
        stats.bodies_put_to_sleep = stats
            .bodies_put_to_sleep
            .saturating_add(bodies_put_to_sleep);
        stats.islands_put_to_sleep = stats
            .islands_put_to_sleep
            .saturating_add(islands_put_to_sleep);
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct DistanceJointConstraintContext {
    a_index: usize,
    b_index: usize,
    normal: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
    inverse_mass_sum: f32,
    error: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct RopeJointConstraintContext {
    a_index: usize,
    b_index: usize,
    normal: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
    inverse_mass_sum: f32,
    error: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct SpringJointConstraintContext {
    a_index: usize,
    b_index: usize,
    normal: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
    inverse_mass_sum: f32,
    error: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PulleyJointConstraintContext {
    a_index: usize,
    b_index: usize,
    anchor_a: Transform2D,
    anchor_b: Transform2D,
    radius_a: Velocity,
    radius_b: Velocity,
    normal_a: Velocity,
    normal_b: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
    inverse_inertia_a: f32,
    inverse_inertia_b: f32,
    ratio: f32,
    error: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct RevoluteJointConstraintContext {
    a_index: usize,
    b_index: usize,
    anchor_a: Transform2D,
    anchor_b: Transform2D,
    radius_a: Velocity,
    radius_b: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
    inverse_inertia_a: f32,
    inverse_inertia_b: f32,
    relative_angle: f32,
    error: Velocity,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PrismaticJointConstraintContext {
    a_index: usize,
    b_index: usize,
    anchor_a: Transform2D,
    anchor_b: Transform2D,
    radius_a: Velocity,
    radius_b: Velocity,
    axis: Velocity,
    perpendicular: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
    inverse_inertia_a: f32,
    inverse_inertia_b: f32,
    translation: f32,
    linear_error: f32,
    angular_error: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct GearJointConstraintContext {
    a_index: usize,
    b_index: usize,
    inverse_inertia_a: f32,
    inverse_inertia_b: f32,
    ratio: f32,
    error: f32,
}

fn solve_prismatic_joint_velocity_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.prismatic_joints.len() {
        let Some(joint) = world.prismatic_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if prismatic_joint_should_break(world, joint) {
            if clear_prismatic_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_prismatic_joint_velocity_constraint(
            world,
            joint,
            delta_seconds,
            velocity_iterations,
        ) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

fn solve_prismatic_joint_position_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.prismatic_joints.len() {
        let Some(joint) = world.prismatic_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if prismatic_joint_should_break(world, joint) {
            if clear_prismatic_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_prismatic_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

fn solve_prismatic_joint_velocity_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, PrismaticJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, PrismaticJoint::DEFAULT_DAMPING);
    let angular_stiffness = sanitize_unit_interval(
        joint.angular_stiffness,
        PrismaticJoint::DEFAULT_ANGULAR_STIFFNESS,
    );
    let angular_damping = sanitize_unit_interval(
        joint.angular_damping,
        PrismaticJoint::DEFAULT_ANGULAR_DAMPING,
    );

    let mut applied = false;
    if (stiffness > 0.0 || damping > 0.0)
        && solve_prismatic_joint_linear_velocity_constraint(
            world,
            joint,
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }
    if (stiffness > 0.0 || damping > 0.0)
        && solve_prismatic_joint_limit_velocity_constraint(
            world,
            joint,
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }
    if solve_prismatic_joint_motor_velocity_constraint(
        world,
        joint,
        delta_seconds,
        velocity_iterations,
    ) {
        applied = true;
    }
    if (angular_stiffness > 0.0 || angular_damping > 0.0)
        && solve_prismatic_joint_angular_velocity_constraint(
            world,
            joint,
            delta_seconds,
            velocity_iterations,
            angular_stiffness,
            angular_damping,
        )
    {
        applied = true;
    }

    applied
}

fn solve_prismatic_joint_position_constraint(world: &mut World, joint: PrismaticJoint) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, PrismaticJoint::DEFAULT_STIFFNESS);
    let angular_stiffness = sanitize_unit_interval(
        joint.angular_stiffness,
        PrismaticJoint::DEFAULT_ANGULAR_STIFFNESS,
    );

    let mut applied = false;
    if stiffness > 0.0 && solve_prismatic_joint_linear_position_constraint(world, joint, stiffness)
    {
        applied = true;
    }
    if stiffness > 0.0 && solve_prismatic_joint_limit_position_constraint(world, joint, stiffness) {
        applied = true;
    }
    if angular_stiffness > 0.0
        && solve_prismatic_joint_angular_position_constraint(world, joint, angular_stiffness)
    {
        applied = true;
    }

    applied
}

fn solve_prismatic_joint_linear_velocity_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
    stiffness: f32,
    damping: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let denominator = prismatic_joint_axis_denominator(&context, context.perpendicular);
    if denominator <= 0.0 {
        return false;
    }

    let relative_velocity = prismatic_joint_relative_anchor_velocity(world, context);
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = context.linear_error * stiffness / (delta_seconds * iteration_count);
    let damping_velocity = dot_velocity(relative_velocity, context.perpendicular) * damping;
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -correction_velocity / denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_anchor_impulse(
        world,
        context,
        Velocity {
            vx: context.perpendicular.vx * impulse_magnitude,
            vy: context.perpendicular.vy * impulse_magnitude,
        },
    );
    true
}

fn solve_prismatic_joint_limit_velocity_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
    stiffness: f32,
    damping: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some(limit_error) = prismatic_joint_limit_error(context, joint) else {
        return false;
    };
    let denominator = prismatic_joint_axis_denominator(&context, context.axis);
    if denominator <= 0.0 {
        return false;
    }

    let relative_velocity = prismatic_joint_relative_anchor_velocity(world, context);
    let relative_velocity_along_axis = dot_velocity(relative_velocity, context.axis);
    let damping_velocity = if limit_error < 0.0 {
        relative_velocity_along_axis.min(0.0) * damping
    } else {
        relative_velocity_along_axis.max(0.0) * damping
    };
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = limit_error * stiffness / (delta_seconds * iteration_count);
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -correction_velocity / denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_anchor_impulse(
        world,
        context,
        Velocity {
            vx: context.axis.vx * impulse_magnitude,
            vy: context.axis.vy * impulse_magnitude,
        },
    );
    true
}

fn solve_prismatic_joint_motor_velocity_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some((motor_speed, max_motor_force)) =
        prismatic_joint_motor_config(context, joint, delta_seconds, velocity_iterations)
    else {
        return false;
    };
    let denominator = prismatic_joint_axis_denominator(&context, context.axis);
    if denominator <= 0.0 {
        return false;
    }

    let relative_velocity = prismatic_joint_relative_anchor_velocity(world, context);
    let relative_velocity_along_axis = dot_velocity(relative_velocity, context.axis);
    let correction_velocity = relative_velocity_along_axis - motor_speed;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let max_impulse_magnitude = max_motor_force * delta_seconds / velocity_iterations.max(1) as f32;
    if max_impulse_magnitude <= KINEMATIC_EPSILON {
        return false;
    }
    let impulse_magnitude =
        (-correction_velocity / denominator).clamp(-max_impulse_magnitude, max_impulse_magnitude);
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_anchor_impulse(
        world,
        context,
        Velocity {
            vx: context.axis.vx * impulse_magnitude,
            vy: context.axis.vy * impulse_magnitude,
        },
    );
    true
}

fn solve_prismatic_joint_angular_velocity_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
    stiffness: f32,
    damping: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let denominator = context.inverse_inertia_a + context.inverse_inertia_b;
    if denominator <= 0.0 {
        return false;
    }

    let relative_angular_velocity = prismatic_joint_relative_angular_velocity(world, context);
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = context.angular_error * stiffness / (delta_seconds * iteration_count);
    let damping_velocity = relative_angular_velocity * damping;
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let angular_impulse = -correction_velocity / denominator;
    if !angular_impulse.is_finite() || angular_impulse.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_angular_impulse(world, context, angular_impulse);
    true
}

fn solve_prismatic_joint_linear_position_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    stiffness: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    if context.linear_error.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    let denominator = prismatic_joint_axis_denominator(&context, context.perpendicular);
    if denominator <= 0.0 {
        return false;
    }

    let correction_magnitude = context.linear_error * stiffness / denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_anchor_position_correction(
        world,
        context,
        Velocity {
            vx: -context.perpendicular.vx * correction_magnitude,
            vy: -context.perpendicular.vy * correction_magnitude,
        },
    );
    true
}

fn solve_prismatic_joint_limit_position_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    stiffness: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some(limit_error) = prismatic_joint_limit_error(context, joint) else {
        return false;
    };
    if limit_error.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    let denominator = prismatic_joint_axis_denominator(&context, context.axis);
    if denominator <= 0.0 {
        return false;
    }

    let correction_magnitude = limit_error * stiffness / denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_anchor_position_correction(
        world,
        context,
        Velocity {
            vx: -context.axis.vx * correction_magnitude,
            vy: -context.axis.vy * correction_magnitude,
        },
    );
    true
}

fn solve_prismatic_joint_angular_position_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    stiffness: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    if context.angular_error.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    let denominator = context.inverse_inertia_a + context.inverse_inertia_b;
    if denominator <= 0.0 {
        return false;
    }

    let correction_magnitude = context.angular_error * stiffness / denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_prismatic_joint_angular_position_correction(world, context, -correction_magnitude);
    true
}

fn prismatic_joint_constraint_context(
    world: &World,
    joint: PrismaticJoint,
) -> Option<PrismaticJointConstraintContext> {
    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let transform_a = world.transforms.get(a_index).copied().flatten()?;
    let transform_b = world.transforms.get(b_index).copied().flatten()?;
    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    let inverse_inertia_a = rigid_body_inverse_inertia(world, a_index);
    let inverse_inertia_b = rigid_body_inverse_inertia(world, b_index);
    if inverse_mass_a + inverse_mass_b + inverse_inertia_a + inverse_inertia_b <= 0.0 {
        return None;
    }

    let radius_a = revolute_joint_world_radius(
        world,
        a_index,
        joint.local_anchor_a_x,
        joint.local_anchor_a_y,
    );
    let radius_b = revolute_joint_world_radius(
        world,
        b_index,
        joint.local_anchor_b_x,
        joint.local_anchor_b_y,
    );
    let anchor_a = Transform2D {
        x: transform_a.x + radius_a.vx,
        y: transform_a.y + radius_a.vy,
    };
    let anchor_b = Transform2D {
        x: transform_b.x + radius_b.vx,
        y: transform_b.y + radius_b.vy,
    };
    let axis =
        prismatic_joint_world_axis(world, a_index, joint.local_axis_a_x, joint.local_axis_a_y);
    let perpendicular = Velocity {
        vx: -axis.vy,
        vy: axis.vx,
    };
    let error = Velocity {
        vx: anchor_b.x - anchor_a.x,
        vy: anchor_b.y - anchor_a.y,
    };
    let translation = dot_velocity(error, axis);
    let linear_error = dot_velocity(error, perpendicular);
    let rotation_a = world
        .rotations
        .get(a_index)
        .copied()
        .flatten()
        .map(finite_rotation)
        .unwrap_or_default();
    let rotation_b = world
        .rotations
        .get(b_index)
        .copied()
        .flatten()
        .map(finite_rotation)
        .unwrap_or_default();
    let angular_error = normalize_angle_radians(
        rotation_b.radians - rotation_a.radians - sanitize_finite(joint.reference_angle),
    );
    if !translation.is_finite() || !linear_error.is_finite() || !angular_error.is_finite() {
        return None;
    }

    Some(PrismaticJointConstraintContext {
        a_index,
        b_index,
        anchor_a,
        anchor_b,
        radius_a,
        radius_b,
        axis,
        perpendicular,
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a,
        inverse_inertia_b,
        translation,
        linear_error,
        angular_error,
    })
}

fn prismatic_joint_should_break(world: &World, joint: PrismaticJoint) -> bool {
    let Some(break_distance) = sanitize_prismatic_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    context.linear_error.abs() > break_distance + KINEMATIC_EPSILON
}

fn sanitize_prismatic_joint_break_distance(break_distance: f32) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

fn clear_prismatic_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.prismatic_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_prismatic_joint(PrismaticJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

fn solve_weld_joint_velocity_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.weld_joints.len() {
        let Some(joint) = world.weld_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if weld_joint_should_break(world, joint) {
            if clear_weld_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_weld_joint_velocity_constraint(world, joint, delta_seconds, velocity_iterations) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

fn solve_weld_joint_position_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.weld_joints.len() {
        let Some(joint) = world.weld_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if weld_joint_should_break(world, joint) {
            if clear_weld_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_weld_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

fn solve_weld_joint_velocity_constraint(
    world: &mut World,
    joint: WeldJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let prismatic = prismatic_joint_from_weld_joint(joint);
    let stiffness = sanitize_unit_interval(joint.stiffness, WeldJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, WeldJoint::DEFAULT_DAMPING);
    let angular_stiffness = sanitize_unit_interval(
        joint.angular_stiffness,
        WeldJoint::DEFAULT_ANGULAR_STIFFNESS,
    );
    let angular_damping =
        sanitize_unit_interval(joint.angular_damping, WeldJoint::DEFAULT_ANGULAR_DAMPING);

    let mut applied = false;
    if (angular_stiffness > 0.0 || angular_damping > 0.0)
        && solve_prismatic_joint_angular_velocity_constraint(
            world,
            prismatic,
            delta_seconds,
            velocity_iterations,
            angular_stiffness,
            angular_damping,
        )
    {
        applied = true;
    }
    if (stiffness > 0.0 || damping > 0.0)
        && solve_prismatic_joint_linear_velocity_constraint(
            world,
            prismatic,
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }
    if (stiffness > 0.0 || damping > 0.0)
        && solve_prismatic_joint_limit_velocity_constraint(
            world,
            prismatic,
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }

    applied
}

fn solve_weld_joint_position_constraint(world: &mut World, joint: WeldJoint) -> bool {
    let prismatic = prismatic_joint_from_weld_joint(joint);
    let stiffness = sanitize_unit_interval(joint.stiffness, WeldJoint::DEFAULT_STIFFNESS);
    let angular_stiffness = sanitize_unit_interval(
        joint.angular_stiffness,
        WeldJoint::DEFAULT_ANGULAR_STIFFNESS,
    );

    let mut applied = false;
    if angular_stiffness > 0.0
        && solve_prismatic_joint_angular_position_constraint(world, prismatic, angular_stiffness)
    {
        applied = true;
    }
    if stiffness > 0.0 && solve_weld_joint_anchor_position_constraint(world, prismatic, stiffness) {
        applied = true;
    }

    applied
}

fn prismatic_joint_from_weld_joint(joint: WeldJoint) -> PrismaticJoint {
    PrismaticJoint::new(joint.entity_a, joint.entity_b)
        .with_local_anchor_a(joint.local_anchor_a_x, joint.local_anchor_a_y)
        .with_local_anchor_b(joint.local_anchor_b_x, joint.local_anchor_b_y)
        .with_local_axis_a(1.0, 0.0)
        .with_reference_angle(joint.reference_angle)
        .with_stiffness(joint.stiffness)
        .with_damping(joint.damping)
        .with_angular_stiffness(joint.angular_stiffness)
        .with_angular_damping(joint.angular_damping)
        .with_translation_limits(0.0, 0.0)
        .with_enabled(joint.enabled)
}

fn weld_joint_should_break(world: &World, joint: WeldJoint) -> bool {
    let prismatic = prismatic_joint_from_weld_joint(joint);
    let Some(context) = prismatic_joint_constraint_context(world, prismatic) else {
        return false;
    };
    if sanitize_weld_joint_break_limit(joint.break_distance).is_some_and(|break_distance| {
        context.linear_error.hypot(context.translation) > break_distance + KINEMATIC_EPSILON
    }) {
        return true;
    }
    sanitize_weld_joint_break_limit(joint.break_angle)
        .is_some_and(|break_angle| context.angular_error.abs() > break_angle + KINEMATIC_EPSILON)
}

fn sanitize_weld_joint_break_limit(break_limit: f32) -> Option<f32> {
    (break_limit.is_finite() && break_limit >= 0.0).then_some(break_limit)
}

fn solve_weld_joint_anchor_position_constraint(
    world: &mut World,
    joint: PrismaticJoint,
    stiffness: f32,
) -> bool {
    let Some(context) = prismatic_joint_constraint_context(world, joint) else {
        return false;
    };
    let error = Velocity {
        vx: context.anchor_b.x - context.anchor_a.x,
        vy: context.anchor_b.y - context.anchor_a.y,
    };
    if velocity_len_squared(error) <= KINEMATIC_EPSILON * KINEMATIC_EPSILON {
        return false;
    }
    let denominator = context.inverse_mass_a + context.inverse_mass_b;
    if denominator <= 0.0 {
        return false;
    }

    let impulse = Velocity {
        vx: -error.vx * stiffness / denominator,
        vy: -error.vy * stiffness / denominator,
    };
    if !impulse.vx.is_finite()
        || !impulse.vy.is_finite()
        || velocity_len_squared(impulse) <= KINEMATIC_EPSILON * KINEMATIC_EPSILON
    {
        return false;
    }

    apply_weld_joint_anchor_position_correction(world, context, impulse);
    true
}

fn apply_weld_joint_anchor_position_correction(
    world: &mut World,
    context: PrismaticJointConstraintContext,
    impulse: Velocity,
) {
    if context.inverse_mass_a > 0.0 {
        if let Some(transform) = world.transforms[context.a_index].as_mut() {
            transform.x -= impulse.vx * context.inverse_mass_a;
            transform.y -= impulse.vy * context.inverse_mass_a;
        }
    }
    if context.inverse_mass_b > 0.0 {
        if let Some(transform) = world.transforms[context.b_index].as_mut() {
            transform.x += impulse.vx * context.inverse_mass_b;
            transform.y += impulse.vy * context.inverse_mass_b;
        }
    }
}

fn clear_weld_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.weld_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_weld_joint(WeldJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

fn solve_revolute_joint_velocity_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.revolute_joints.len() {
        let Some(joint) = world.revolute_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if revolute_joint_should_break(world, joint) {
            if clear_revolute_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_revolute_joint_velocity_constraint(
            world,
            joint,
            delta_seconds,
            velocity_iterations,
        ) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

fn solve_revolute_joint_position_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.revolute_joints.len() {
        let Some(joint) = world.revolute_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if revolute_joint_should_break(world, joint) {
            if clear_revolute_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_revolute_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

fn solve_revolute_joint_velocity_constraint(
    world: &mut World,
    joint: RevoluteJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, RevoluteJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, RevoluteJoint::DEFAULT_DAMPING);

    let mut applied = false;
    if (stiffness > 0.0 || damping > 0.0)
        && solve_revolute_joint_velocity_axis(
            world,
            joint,
            Velocity { vx: 1.0, vy: 0.0 },
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }
    if (stiffness > 0.0 || damping > 0.0)
        && solve_revolute_joint_velocity_axis(
            world,
            joint,
            Velocity { vx: 0.0, vy: 1.0 },
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }
    if (stiffness > 0.0 || damping > 0.0)
        && solve_revolute_joint_limit_velocity_constraint(
            world,
            joint,
            delta_seconds,
            velocity_iterations,
            stiffness,
            damping,
        )
    {
        applied = true;
    }
    if solve_revolute_joint_motor_velocity_constraint(
        world,
        joint,
        delta_seconds,
        velocity_iterations,
    ) {
        applied = true;
    }

    applied
}

fn solve_revolute_joint_position_constraint(world: &mut World, joint: RevoluteJoint) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, RevoluteJoint::DEFAULT_STIFFNESS);

    let mut applied = false;
    if stiffness > 0.0
        && solve_revolute_joint_position_axis(
            world,
            joint,
            Velocity { vx: 1.0, vy: 0.0 },
            stiffness,
        )
    {
        applied = true;
    }
    if stiffness > 0.0
        && solve_revolute_joint_position_axis(
            world,
            joint,
            Velocity { vx: 0.0, vy: 1.0 },
            stiffness,
        )
    {
        applied = true;
    }
    if stiffness > 0.0 && solve_revolute_joint_limit_position_constraint(world, joint, stiffness) {
        applied = true;
    }

    applied
}

fn solve_revolute_joint_velocity_axis(
    world: &mut World,
    joint: RevoluteJoint,
    axis: Velocity,
    delta_seconds: f32,
    velocity_iterations: u32,
    stiffness: f32,
    damping: f32,
) -> bool {
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    let denominator = revolute_joint_axis_denominator(&context, axis);
    if denominator <= 0.0 {
        return false;
    }

    let relative_velocity = relative_anchor_velocity(world, context);
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity =
        dot_velocity(context.error, axis) * stiffness / (delta_seconds * iteration_count);
    let damping_velocity = dot_velocity(relative_velocity, axis) * damping;
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -correction_velocity / denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_revolute_joint_anchor_impulse(
        world,
        context,
        Velocity {
            vx: axis.vx * impulse_magnitude,
            vy: axis.vy * impulse_magnitude,
        },
    );
    true
}

fn solve_revolute_joint_limit_velocity_constraint(
    world: &mut World,
    joint: RevoluteJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
    stiffness: f32,
    damping: f32,
) -> bool {
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some(limit_error) = revolute_joint_limit_error(context, joint) else {
        return false;
    };
    let denominator = revolute_joint_angular_denominator(&context);
    if denominator <= 0.0 {
        return false;
    }

    let relative_angular_velocity = revolute_joint_relative_angular_velocity(world, context);
    let damping_velocity = if limit_error < 0.0 {
        relative_angular_velocity.min(0.0) * damping
    } else {
        relative_angular_velocity.max(0.0) * damping
    };
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = limit_error * stiffness / (delta_seconds * iteration_count);
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let angular_impulse = -correction_velocity / denominator;
    if !angular_impulse.is_finite() || angular_impulse.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_revolute_joint_angular_impulse(world, context, angular_impulse);
    true
}

fn solve_revolute_joint_motor_velocity_constraint(
    world: &mut World,
    joint: RevoluteJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some((motor_speed, max_motor_torque)) =
        revolute_joint_motor_config(context, joint, delta_seconds, velocity_iterations)
    else {
        return false;
    };
    let denominator = revolute_joint_angular_denominator(&context);
    if denominator <= 0.0 {
        return false;
    }

    let relative_angular_velocity = revolute_joint_relative_angular_velocity(world, context);
    let correction_velocity = relative_angular_velocity - motor_speed;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let max_impulse_magnitude =
        max_motor_torque * delta_seconds / velocity_iterations.max(1) as f32;
    if max_impulse_magnitude <= KINEMATIC_EPSILON {
        return false;
    }
    let angular_impulse =
        (-correction_velocity / denominator).clamp(-max_impulse_magnitude, max_impulse_magnitude);
    if !angular_impulse.is_finite() || angular_impulse.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_revolute_joint_angular_impulse(world, context, angular_impulse);
    true
}

fn solve_revolute_joint_position_axis(
    world: &mut World,
    joint: RevoluteJoint,
    axis: Velocity,
    stiffness: f32,
) -> bool {
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    let error_along_axis = dot_velocity(context.error, axis);
    if error_along_axis.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    let denominator = revolute_joint_axis_denominator(&context, axis);
    if denominator <= 0.0 {
        return false;
    }

    let correction_magnitude = error_along_axis * stiffness / denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_revolute_joint_anchor_position_correction(
        world,
        context,
        Velocity {
            vx: -axis.vx * correction_magnitude,
            vy: -axis.vy * correction_magnitude,
        },
    );
    true
}

fn solve_revolute_joint_limit_position_constraint(
    world: &mut World,
    joint: RevoluteJoint,
    stiffness: f32,
) -> bool {
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    let Some(limit_error) = revolute_joint_limit_error(context, joint) else {
        return false;
    };
    let denominator = revolute_joint_angular_denominator(&context);
    if denominator <= 0.0 {
        return false;
    }

    let correction_magnitude = limit_error * stiffness / denominator;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_revolute_joint_angular_position_correction(world, context, -correction_magnitude);
    true
}

fn revolute_joint_constraint_context(
    world: &World,
    joint: RevoluteJoint,
) -> Option<RevoluteJointConstraintContext> {
    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let transform_a = world.transforms.get(a_index).copied().flatten()?;
    let transform_b = world.transforms.get(b_index).copied().flatten()?;
    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    let inverse_inertia_a = rigid_body_inverse_inertia(world, a_index);
    let inverse_inertia_b = rigid_body_inverse_inertia(world, b_index);
    if inverse_mass_a + inverse_mass_b + inverse_inertia_a + inverse_inertia_b <= 0.0 {
        return None;
    }

    let radius_a = revolute_joint_world_radius(
        world,
        a_index,
        joint.local_anchor_a_x,
        joint.local_anchor_a_y,
    );
    let radius_b = revolute_joint_world_radius(
        world,
        b_index,
        joint.local_anchor_b_x,
        joint.local_anchor_b_y,
    );
    let anchor_a = Transform2D {
        x: transform_a.x + radius_a.vx,
        y: transform_a.y + radius_a.vy,
    };
    let anchor_b = Transform2D {
        x: transform_b.x + radius_b.vx,
        y: transform_b.y + radius_b.vy,
    };
    let error = Velocity {
        vx: anchor_b.x - anchor_a.x,
        vy: anchor_b.y - anchor_a.y,
    };
    let rotation_a = world
        .rotations
        .get(a_index)
        .copied()
        .flatten()
        .map(finite_rotation)
        .unwrap_or_default();
    let rotation_b = world
        .rotations
        .get(b_index)
        .copied()
        .flatten()
        .map(finite_rotation)
        .unwrap_or_default();
    let relative_angle = normalize_angle_radians(rotation_b.radians - rotation_a.radians);
    if !error.vx.is_finite() || !error.vy.is_finite() || !relative_angle.is_finite() {
        return None;
    }

    Some(RevoluteJointConstraintContext {
        a_index,
        b_index,
        anchor_a,
        anchor_b,
        radius_a,
        radius_b,
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a,
        inverse_inertia_b,
        relative_angle,
        error,
    })
}

fn revolute_joint_should_break(world: &World, joint: RevoluteJoint) -> bool {
    let Some(break_distance) = sanitize_revolute_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = revolute_joint_constraint_context(world, joint) else {
        return false;
    };
    context.error.vx.hypot(context.error.vy) > break_distance + KINEMATIC_EPSILON
}

fn sanitize_revolute_joint_break_distance(break_distance: f32) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

fn clear_revolute_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.revolute_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_revolute_joint(RevoluteJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

fn solve_gear_joint_velocity_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.gear_joints.len() {
        let Some(joint) = world.gear_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if gear_joint_should_break(world, joint) {
            if clear_gear_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_gear_joint_velocity_constraint(world, joint, delta_seconds, velocity_iterations) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

fn solve_gear_joint_position_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.gear_joints.len() {
        let Some(joint) = world.gear_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if gear_joint_should_break(world, joint) {
            if clear_gear_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_gear_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

fn solve_gear_joint_velocity_constraint(
    world: &mut World,
    joint: GearJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, GearJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, GearJoint::DEFAULT_DAMPING);
    if stiffness <= 0.0 && damping <= 0.0 {
        return false;
    }
    let Some(context) = gear_joint_constraint_context(world, joint, false) else {
        return false;
    };
    let denominator = gear_joint_angular_denominator(context);
    if denominator <= 0.0 {
        return false;
    }

    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = if stiffness > 0.0 && delta_seconds > 0.0 {
        context.error * stiffness / (delta_seconds * iteration_count)
    } else {
        0.0
    };
    let damping_velocity = gear_joint_relative_angular_velocity(world, context) * damping;
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let angular_impulse = -correction_velocity / denominator;
    if !angular_impulse.is_finite() || angular_impulse.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_gear_joint_angular_impulse(world, context, angular_impulse);
    true
}

fn solve_gear_joint_position_constraint(world: &mut World, joint: GearJoint) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, GearJoint::DEFAULT_STIFFNESS);
    if stiffness <= 0.0 {
        return false;
    }
    let Some(context) = gear_joint_constraint_context(world, joint, true) else {
        return false;
    };
    let denominator = gear_joint_angular_denominator(context);
    if denominator <= 0.0 {
        return false;
    }

    let angular_impulse = -context.error * stiffness / denominator;
    if !angular_impulse.is_finite() || angular_impulse.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_gear_joint_angular_position_correction(world, context, angular_impulse);
    true
}

fn gear_joint_constraint_context(
    world: &World,
    joint: GearJoint,
    require_position_error: bool,
) -> Option<GearJointConstraintContext> {
    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let inverse_inertia_a = rigid_body_inverse_inertia(world, a_index);
    let inverse_inertia_b = rigid_body_inverse_inertia(world, b_index);
    let ratio = sanitize_gear_joint_ratio(joint.ratio);
    let denominator = inverse_inertia_a * ratio * ratio + inverse_inertia_b;
    if denominator <= 0.0 {
        return None;
    }

    let rotation_a = world
        .rotations
        .get(a_index)
        .copied()
        .flatten()
        .map(finite_rotation)
        .unwrap_or_default();
    let rotation_b = world
        .rotations
        .get(b_index)
        .copied()
        .flatten()
        .map(finite_rotation)
        .unwrap_or_default();
    let reference_angle = sanitize_finite(joint.reference_angle);
    let error = rotation_b.radians + ratio * rotation_a.radians - reference_angle;
    if !error.is_finite() || (require_position_error && error.abs() <= KINEMATIC_EPSILON) {
        return None;
    }

    Some(GearJointConstraintContext {
        a_index,
        b_index,
        inverse_inertia_a,
        inverse_inertia_b,
        ratio,
        error,
    })
}

fn gear_joint_should_break(world: &World, joint: GearJoint) -> bool {
    let Some(break_angle) = sanitize_gear_joint_break_angle(joint.break_angle) else {
        return false;
    };
    let Some(context) = gear_joint_constraint_context(world, joint, false) else {
        return false;
    };
    context.error.abs() > break_angle + KINEMATIC_EPSILON
}

fn sanitize_gear_joint_break_angle(break_angle: f32) -> Option<f32> {
    (break_angle.is_finite() && break_angle >= 0.0).then_some(break_angle)
}

fn clear_gear_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.gear_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_gear_joint(GearJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

fn solve_distance_joint_velocity_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.distance_joints.len() {
        let Some(joint) = world.distance_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if distance_joint_should_break(world, joint) {
            if clear_distance_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_distance_joint_velocity_constraint(world, joint) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

fn solve_distance_joint_position_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.distance_joints.len() {
        let Some(joint) = world.distance_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if distance_joint_should_break(world, joint) {
            if clear_distance_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_distance_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

fn solve_distance_joint_velocity_constraint(world: &mut World, joint: DistanceJoint) -> bool {
    let damping = sanitize_unit_interval(joint.damping, DistanceJoint::DEFAULT_DAMPING);
    if damping <= 0.0 {
        return false;
    }
    let Some(context) = distance_joint_constraint_context(world, joint, false) else {
        return false;
    };

    let velocity_a = world.velocities[context.a_index].unwrap_or_default();
    let velocity_b = world.velocities[context.b_index].unwrap_or_default();
    let relative_velocity = Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    };
    let velocity_along_axis = dot_velocity(relative_velocity, context.normal);
    if velocity_along_axis.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -velocity_along_axis * damping / context.inverse_mass_sum;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    apply_contact_impulse(
        world,
        context.a_index,
        context.b_index,
        Velocity {
            vx: context.normal.vx * impulse_magnitude,
            vy: context.normal.vy * impulse_magnitude,
        },
        context.inverse_mass_a,
        context.inverse_mass_b,
    );
    true
}

fn solve_distance_joint_position_constraint(world: &mut World, joint: DistanceJoint) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, DistanceJoint::DEFAULT_STIFFNESS);
    if stiffness <= 0.0 {
        return false;
    }
    let Some(context) = distance_joint_constraint_context(world, joint, true) else {
        return false;
    };

    let correction_magnitude = context.error * stiffness / context.inverse_mass_sum;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    if context.inverse_mass_a > 0.0 {
        if let Some(transform) = world.transforms[context.a_index].as_mut() {
            transform.x += context.normal.vx * correction_magnitude * context.inverse_mass_a;
            transform.y += context.normal.vy * correction_magnitude * context.inverse_mass_a;
        }
    }
    if context.inverse_mass_b > 0.0 {
        if let Some(transform) = world.transforms[context.b_index].as_mut() {
            transform.x -= context.normal.vx * correction_magnitude * context.inverse_mass_b;
            transform.y -= context.normal.vy * correction_magnitude * context.inverse_mass_b;
        }
    }
    true
}

fn distance_joint_constraint_context(
    world: &World,
    joint: DistanceJoint,
    require_position_error: bool,
) -> Option<DistanceJointConstraintContext> {
    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let transform_a = world.transforms.get(a_index).copied().flatten()?;
    let transform_b = world.transforms.get(b_index).copied().flatten()?;
    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    let inverse_mass_sum = inverse_mass_a + inverse_mass_b;
    if inverse_mass_sum <= 0.0 {
        return None;
    }

    let dx = transform_b.x - transform_a.x;
    let dy = transform_b.y - transform_a.y;
    let length = dx.hypot(dy);
    if !length.is_finite() {
        return None;
    }
    let rest_length = sanitize_distance_joint_rest_length(joint.rest_length);
    let error = length - rest_length;
    if !error.is_finite() || (require_position_error && error.abs() <= KINEMATIC_EPSILON) {
        return None;
    }

    let normal = if length > KINEMATIC_EPSILON {
        Velocity {
            vx: dx / length,
            vy: dy / length,
        }
    } else if rest_length > KINEMATIC_EPSILON {
        Velocity { vx: 1.0, vy: 0.0 }
    } else {
        return None;
    };

    Some(DistanceJointConstraintContext {
        a_index,
        b_index,
        normal,
        inverse_mass_a,
        inverse_mass_b,
        inverse_mass_sum,
        error,
    })
}

fn distance_joint_should_break(world: &World, joint: DistanceJoint) -> bool {
    let Some(break_distance) = sanitize_distance_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = distance_joint_constraint_context(world, joint, false) else {
        return false;
    };
    context.error.abs() > break_distance + KINEMATIC_EPSILON
}

fn sanitize_distance_joint_break_distance(break_distance: f32) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

fn clear_distance_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.distance_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_distance_joint(DistanceJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

fn solve_spring_joint_velocity_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.spring_joints.len() {
        let Some(joint) = world.spring_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if spring_joint_should_break(world, joint) {
            if clear_spring_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_spring_joint_velocity_constraint(world, joint, delta_seconds, velocity_iterations)
        {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

fn solve_spring_joint_velocity_constraint(
    world: &mut World,
    joint: SpringJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, SpringJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, SpringJoint::DEFAULT_DAMPING);
    if stiffness <= 0.0 && damping <= 0.0 {
        return false;
    }
    let Some(context) = spring_joint_constraint_context(world, joint) else {
        return false;
    };

    let velocity_a = world.velocities[context.a_index].unwrap_or_default();
    let velocity_b = world.velocities[context.b_index].unwrap_or_default();
    let relative_velocity = Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    };
    let velocity_along_axis = dot_velocity(relative_velocity, context.normal);
    let iteration_count = velocity_iterations.max(1) as f32;
    let spring_velocity = context.error * stiffness / (delta_seconds * iteration_count);
    let damping_velocity = velocity_along_axis * damping;
    let correction_velocity = spring_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -correction_velocity / context.inverse_mass_sum;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    apply_contact_impulse(
        world,
        context.a_index,
        context.b_index,
        Velocity {
            vx: context.normal.vx * impulse_magnitude,
            vy: context.normal.vy * impulse_magnitude,
        },
        context.inverse_mass_a,
        context.inverse_mass_b,
    );
    true
}

fn spring_joint_constraint_context(
    world: &World,
    joint: SpringJoint,
) -> Option<SpringJointConstraintContext> {
    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let transform_a = world.transforms.get(a_index).copied().flatten()?;
    let transform_b = world.transforms.get(b_index).copied().flatten()?;
    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    let inverse_mass_sum = inverse_mass_a + inverse_mass_b;
    if inverse_mass_sum <= 0.0 {
        return None;
    }

    let dx = transform_b.x - transform_a.x;
    let dy = transform_b.y - transform_a.y;
    let length = dx.hypot(dy);
    if !length.is_finite() {
        return None;
    }
    let rest_length = sanitize_spring_joint_rest_length(joint.rest_length);
    let error = length - rest_length;
    if !error.is_finite() {
        return None;
    }

    let normal = if length > KINEMATIC_EPSILON {
        Velocity {
            vx: dx / length,
            vy: dy / length,
        }
    } else if rest_length > KINEMATIC_EPSILON {
        Velocity { vx: 1.0, vy: 0.0 }
    } else {
        return None;
    };

    Some(SpringJointConstraintContext {
        a_index,
        b_index,
        normal,
        inverse_mass_a,
        inverse_mass_b,
        inverse_mass_sum,
        error,
    })
}

fn spring_joint_should_break(world: &World, joint: SpringJoint) -> bool {
    let Some(break_distance) = sanitize_spring_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = spring_joint_constraint_context(world, joint) else {
        return false;
    };
    context.error.abs() > break_distance + KINEMATIC_EPSILON
}

fn sanitize_spring_joint_break_distance(break_distance: f32) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

fn clear_spring_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.spring_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_spring_joint(SpringJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

fn solve_pulley_joint_velocity_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    delta_seconds: f32,
    velocity_iterations: u32,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.pulley_joints.len() {
        let Some(joint) = world.pulley_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if pulley_joint_should_break(world, joint) {
            if clear_pulley_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_pulley_joint_velocity_constraint(world, joint, delta_seconds, velocity_iterations)
        {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

fn solve_pulley_joint_position_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.pulley_joints.len() {
        let Some(joint) = world.pulley_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if pulley_joint_should_break(world, joint) {
            if clear_pulley_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_pulley_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

fn solve_pulley_joint_velocity_constraint(
    world: &mut World,
    joint: PulleyJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, PulleyJoint::DEFAULT_STIFFNESS);
    let damping = sanitize_unit_interval(joint.damping, PulleyJoint::DEFAULT_DAMPING);
    if stiffness <= 0.0 && damping <= 0.0 {
        return false;
    }
    let Some(context) = pulley_joint_constraint_context(world, joint, false) else {
        return false;
    };
    let denominator = pulley_joint_denominator(context);
    if denominator <= 0.0 {
        return false;
    }

    let relative_velocity = pulley_joint_constraint_velocity(world, context);
    let iteration_count = velocity_iterations.max(1) as f32;
    let bias_velocity = if stiffness > 0.0 && delta_seconds > 0.0 {
        context.error * stiffness / (delta_seconds * iteration_count)
    } else {
        0.0
    };
    let damping_velocity = relative_velocity * damping;
    let correction_velocity = bias_velocity + damping_velocity;
    if !correction_velocity.is_finite() || correction_velocity.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -correction_velocity / denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_pulley_joint_anchor_impulse(world, context, impulse_magnitude);
    true
}

fn solve_pulley_joint_position_constraint(world: &mut World, joint: PulleyJoint) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, PulleyJoint::DEFAULT_STIFFNESS);
    if stiffness <= 0.0 {
        return false;
    }
    let Some(context) = pulley_joint_constraint_context(world, joint, true) else {
        return false;
    };
    let denominator = pulley_joint_denominator(context);
    if denominator <= 0.0 {
        return false;
    }

    let impulse_magnitude = -context.error * stiffness / denominator;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }

    apply_pulley_joint_anchor_position_correction(world, context, impulse_magnitude);
    true
}

fn pulley_joint_constraint_context(
    world: &World,
    joint: PulleyJoint,
    require_position_error: bool,
) -> Option<PulleyJointConstraintContext> {
    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let transform_a = world.transforms.get(a_index).copied().flatten()?;
    let transform_b = world.transforms.get(b_index).copied().flatten()?;
    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    let inverse_inertia_a = rigid_body_inverse_inertia(world, a_index);
    let inverse_inertia_b = rigid_body_inverse_inertia(world, b_index);
    if inverse_mass_a + inverse_mass_b + inverse_inertia_a + inverse_inertia_b <= 0.0 {
        return None;
    }

    let radius_a = revolute_joint_world_radius(
        world,
        a_index,
        joint.local_anchor_a_x,
        joint.local_anchor_a_y,
    );
    let radius_b = revolute_joint_world_radius(
        world,
        b_index,
        joint.local_anchor_b_x,
        joint.local_anchor_b_y,
    );
    let anchor_a = Transform2D {
        x: transform_a.x + radius_a.vx,
        y: transform_a.y + radius_a.vy,
    };
    let anchor_b = Transform2D {
        x: transform_b.x + radius_b.vx,
        y: transform_b.y + radius_b.vy,
    };
    let ground_anchor_a = Transform2D {
        x: sanitize_finite(joint.ground_anchor_a_x),
        y: sanitize_finite(joint.ground_anchor_a_y),
    };
    let ground_anchor_b = Transform2D {
        x: sanitize_finite(joint.ground_anchor_b_x),
        y: sanitize_finite(joint.ground_anchor_b_y),
    };
    let delta_a = Velocity {
        vx: anchor_a.x - ground_anchor_a.x,
        vy: anchor_a.y - ground_anchor_a.y,
    };
    let delta_b = Velocity {
        vx: anchor_b.x - ground_anchor_b.x,
        vy: anchor_b.y - ground_anchor_b.y,
    };
    let length_a = delta_a.vx.hypot(delta_a.vy);
    let length_b = delta_b.vx.hypot(delta_b.vy);
    if !length_a.is_finite() || !length_b.is_finite() {
        return None;
    }
    let ratio = sanitize_pulley_joint_ratio(joint.ratio);
    let rest_length = sanitize_pulley_joint_rest_length(joint.rest_length);
    let error = length_a + ratio * length_b - rest_length;
    if !error.is_finite() || (require_position_error && error.abs() <= KINEMATIC_EPSILON) {
        return None;
    }

    Some(PulleyJointConstraintContext {
        a_index,
        b_index,
        anchor_a,
        anchor_b,
        radius_a,
        radius_b,
        normal_a: normalized_pulley_segment(delta_a),
        normal_b: normalized_pulley_segment(delta_b),
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a,
        inverse_inertia_b,
        ratio,
        error,
    })
}

fn pulley_joint_constraint_velocity(world: &World, context: PulleyJointConstraintContext) -> f32 {
    let velocity_a = anchor_velocity(world, context.a_index, context.anchor_a);
    let velocity_b = anchor_velocity(world, context.b_index, context.anchor_b);
    dot_velocity(velocity_a, context.normal_a)
        + context.ratio * dot_velocity(velocity_b, context.normal_b)
}

fn pulley_joint_denominator(context: PulleyJointConstraintContext) -> f32 {
    let radius_a_cross_normal = cross_velocity(context.radius_a, context.normal_a);
    let radius_b_cross_normal = cross_velocity(context.radius_b, context.normal_b);
    let effective_mass_a = context.inverse_mass_a
        + context.inverse_inertia_a * radius_a_cross_normal * radius_a_cross_normal;
    let effective_mass_b = context.inverse_mass_b
        + context.inverse_inertia_b * radius_b_cross_normal * radius_b_cross_normal;
    effective_mass_a + context.ratio * context.ratio * effective_mass_b
}

fn normalized_pulley_segment(segment: Velocity) -> Velocity {
    let length_squared = velocity_len_squared(segment);
    if length_squared <= KINEMATIC_EPSILON * KINEMATIC_EPSILON {
        return Velocity { vx: 1.0, vy: 0.0 };
    }

    let length = length_squared.sqrt();
    Velocity {
        vx: segment.vx / length,
        vy: segment.vy / length,
    }
}

fn pulley_joint_should_break(world: &World, joint: PulleyJoint) -> bool {
    let Some(break_distance) = sanitize_pulley_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = pulley_joint_constraint_context(world, joint, false) else {
        return false;
    };
    context.error.abs() > break_distance + KINEMATIC_EPSILON
}

fn sanitize_pulley_joint_break_distance(break_distance: f32) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

fn clear_pulley_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.pulley_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_pulley_joint(PulleyJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

fn solve_rope_joint_velocity_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.rope_joints.len() {
        let Some(joint) = world.rope_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if rope_joint_should_break(world, joint) {
            if clear_rope_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_rope_joint_velocity_constraint(world, joint) {
            stats.constraint_velocity_corrections =
                stats.constraint_velocity_corrections.saturating_add(1);
        }
    }
}

fn solve_rope_joint_position_constraints(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    stats: &mut RigidBodyStepStats,
) {
    for index in 0..world.rope_joints.len() {
        let Some(joint) = world.rope_joints[index] else {
            continue;
        };
        if !island_schedule.joint_in_island(joint.entity_a, joint.entity_b, island_root) {
            continue;
        }
        if rope_joint_should_break(world, joint) {
            if clear_rope_joint_at_index(world, index) {
                stats.broken_joints = stats.broken_joints.saturating_add(1);
            }
            continue;
        }
        if solve_rope_joint_position_constraint(world, joint) {
            stats.constraint_position_corrections =
                stats.constraint_position_corrections.saturating_add(1);
        }
    }
}

fn solve_rope_joint_velocity_constraint(world: &mut World, joint: RopeJoint) -> bool {
    let damping = sanitize_unit_interval(joint.damping, RopeJoint::DEFAULT_DAMPING);
    if damping <= 0.0 {
        return false;
    }
    let Some(context) = rope_joint_constraint_context(world, joint, false) else {
        return false;
    };

    let velocity_a = world.velocities[context.a_index].unwrap_or_default();
    let velocity_b = world.velocities[context.b_index].unwrap_or_default();
    let relative_velocity = Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    };
    let velocity_along_axis = dot_velocity(relative_velocity, context.normal);
    if velocity_along_axis <= KINEMATIC_EPSILON {
        return false;
    }

    let impulse_magnitude = -velocity_along_axis * damping / context.inverse_mass_sum;
    if !impulse_magnitude.is_finite() || impulse_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    apply_contact_impulse(
        world,
        context.a_index,
        context.b_index,
        Velocity {
            vx: context.normal.vx * impulse_magnitude,
            vy: context.normal.vy * impulse_magnitude,
        },
        context.inverse_mass_a,
        context.inverse_mass_b,
    );
    true
}

fn solve_rope_joint_position_constraint(world: &mut World, joint: RopeJoint) -> bool {
    let stiffness = sanitize_unit_interval(joint.stiffness, RopeJoint::DEFAULT_STIFFNESS);
    if stiffness <= 0.0 {
        return false;
    }
    let Some(context) = rope_joint_constraint_context(world, joint, true) else {
        return false;
    };

    let correction_magnitude = context.error * stiffness / context.inverse_mass_sum;
    if !correction_magnitude.is_finite() || correction_magnitude.abs() <= KINEMATIC_EPSILON {
        return false;
    }
    if context.inverse_mass_a > 0.0 {
        if let Some(transform) = world.transforms[context.a_index].as_mut() {
            transform.x += context.normal.vx * correction_magnitude * context.inverse_mass_a;
            transform.y += context.normal.vy * correction_magnitude * context.inverse_mass_a;
        }
    }
    if context.inverse_mass_b > 0.0 {
        if let Some(transform) = world.transforms[context.b_index].as_mut() {
            transform.x -= context.normal.vx * correction_magnitude * context.inverse_mass_b;
            transform.y -= context.normal.vy * correction_magnitude * context.inverse_mass_b;
        }
    }
    true
}

fn rope_joint_constraint_context(
    world: &World,
    joint: RopeJoint,
    require_position_error: bool,
) -> Option<RopeJointConstraintContext> {
    if !joint.enabled || joint.entity_a == joint.entity_b {
        return None;
    }
    let a_index = valid_world_entity_index(world, joint.entity_a)?;
    let b_index = valid_world_entity_index(world, joint.entity_b)?;
    let transform_a = world.transforms.get(a_index).copied().flatten()?;
    let transform_b = world.transforms.get(b_index).copied().flatten()?;
    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    let inverse_mass_sum = inverse_mass_a + inverse_mass_b;
    if inverse_mass_sum <= 0.0 {
        return None;
    }

    let dx = transform_b.x - transform_a.x;
    let dy = transform_b.y - transform_a.y;
    let length = dx.hypot(dy);
    if !length.is_finite() || length <= KINEMATIC_EPSILON {
        return None;
    }
    let max_length = sanitize_rope_joint_max_length(joint.max_length);
    let error = length - max_length;
    if !error.is_finite()
        || (require_position_error && error <= KINEMATIC_EPSILON)
        || (!require_position_error && error < -KINEMATIC_EPSILON)
    {
        return None;
    }

    Some(RopeJointConstraintContext {
        a_index,
        b_index,
        normal: Velocity {
            vx: dx / length,
            vy: dy / length,
        },
        inverse_mass_a,
        inverse_mass_b,
        inverse_mass_sum,
        error,
    })
}

fn rope_joint_should_break(world: &World, joint: RopeJoint) -> bool {
    let Some(break_distance) = sanitize_rope_joint_break_distance(joint.break_distance) else {
        return false;
    };
    let Some(context) = rope_joint_constraint_context(world, joint, false) else {
        return false;
    };
    context.error > break_distance + KINEMATIC_EPSILON
}

fn sanitize_rope_joint_break_distance(break_distance: f32) -> Option<f32> {
    (break_distance.is_finite() && break_distance >= 0.0).then_some(break_distance)
}

fn clear_rope_joint_at_index(world: &mut World, index: usize) -> bool {
    let Some(generation) = world.rope_joint_generations.get(index).copied() else {
        return false;
    };
    world
        .clear_rope_joint(RopeJointId {
            index: index as u32,
            generation,
        })
        .is_some()
}

fn build_rigid_contact_constraints(world: &World) -> Vec<RigidContactConstraint> {
    let mut constraints = Vec::new();
    for collider_manifold in CollisionSystem::build_rigid_collider_manifolds(world) {
        let manifold = collider_manifold.manifold;
        let a_index = manifold.pair.a.id as usize;
        let b_index = manifold.pair.b.id as usize;
        if !should_solve_rigid_contact(world, a_index, b_index) {
            continue;
        }
        for point in collider_manifold.points() {
            let (normal_impulse, tangent_impulse) =
                cached_contact_impulse_for_point(world, manifold, point.point_x, point.point_y)
                    .unwrap_or_default();
            constraints.push(RigidContactConstraint {
                pair: manifold.pair,
                collider_pair: collider_manifold.collider_pair,
                point: Transform2D {
                    x: point.point_x,
                    y: point.point_y,
                },
                normal: Velocity {
                    vx: manifold.normal_x,
                    vy: manifold.normal_y,
                },
                penetration: sanitize_non_negative(point.penetration),
                normal_impulse,
                tangent_impulse,
                split_normal_impulse: 0.0,
            });
        }
    }
    constraints
}

fn cached_contact_impulse_for_point(
    world: &World,
    manifold: CollisionManifold,
    point_x: f32,
    point_y: f32,
) -> Option<(f32, f32)> {
    world
        .rigid_contact_impulses
        .iter()
        .copied()
        .find(|entry| {
            entry.entity_a == manifold.pair.a
                && entry.entity_b == manifold.pair.b
                && entry.normal_x * manifold.normal_x + entry.normal_y * manifold.normal_y
                    >= CONTACT_CACHE_NORMAL_DOT_MIN
                && contact_cache_point_matches(*entry, point_x, point_y)
        })
        .map(|entry| (entry.normal_impulse.max(0.0), entry.tangent_impulse))
}

fn contact_cache_point_matches(entry: RigidContactImpulse, point_x: f32, point_y: f32) -> bool {
    let dx = entry.point_x - point_x;
    let dy = entry.point_y - point_y;
    dx * dx + dy * dy <= CONTACT_CACHE_POINT_MATCH_DISTANCE_SQUARED
}

fn warm_start_rigid_contact_constraints(
    world: &mut World,
    constraints: &[RigidContactConstraint],
    stats: &mut RigidBodyStepStats,
) {
    for constraint in constraints {
        if constraint.normal_impulse.abs() <= CONTACT_IMPULSE_EPSILON
            && constraint.tangent_impulse.abs() <= CONTACT_IMPULSE_EPSILON
        {
            continue;
        }

        let a_index = constraint.pair.a.id as usize;
        let b_index = constraint.pair.b.id as usize;
        if !should_solve_rigid_contact(world, a_index, b_index) {
            continue;
        }
        let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
        let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
        let inverse_inertia_a = rigid_body_inverse_inertia(world, a_index);
        let inverse_inertia_b = rigid_body_inverse_inertia(world, b_index);
        if inverse_mass_a + inverse_mass_b <= 0.0 {
            continue;
        }

        let normal = finite_velocity(constraint.normal);
        let tangent = contact_constraint_tangent(normal);
        apply_contact_impulse_at_point(
            world,
            a_index,
            b_index,
            finite_transform(constraint.point),
            Velocity {
                vx: normal.vx * constraint.normal_impulse + tangent.vx * constraint.tangent_impulse,
                vy: normal.vy * constraint.normal_impulse + tangent.vy * constraint.tangent_impulse,
            },
            inverse_mass_a,
            inverse_mass_b,
            inverse_inertia_a,
            inverse_inertia_b,
        );
        stats.warm_start_impulses = stats.warm_start_impulses.saturating_add(1);
    }
}

fn store_rigid_contact_impulses(world: &mut World, constraints: &[RigidContactConstraint]) -> u32 {
    world.rigid_contact_impulses.clear();
    for constraint in constraints {
        if constraint.normal_impulse.abs() <= CONTACT_IMPULSE_EPSILON
            && constraint.tangent_impulse.abs() <= CONTACT_IMPULSE_EPSILON
        {
            continue;
        }
        world.rigid_contact_impulses.push(RigidContactImpulse {
            entity_a: constraint.pair.a,
            entity_b: constraint.pair.b,
            point_x: constraint.point.x,
            point_y: constraint.point.y,
            normal_x: constraint.normal.vx,
            normal_y: constraint.normal.vy,
            normal_impulse: constraint.normal_impulse.max(0.0),
            tangent_impulse: constraint.tangent_impulse,
        });
    }
    world.rigid_contact_impulses.len() as u32
}

fn solve_rigid_body_velocity_contacts(
    world: &mut World,
    constraints: &mut [RigidContactConstraint],
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
    stats: &mut RigidBodyStepStats,
) {
    let mut index = 0;
    while index < constraints.len() {
        if !island_schedule.contact_in_island(&constraints[index], island_root) {
            index += 1;
            continue;
        }
        if index + 1 < constraints.len()
            && island_schedule.contact_in_island(&constraints[index + 1], island_root)
            && rigid_contact_constraints_can_block_solve(
                &constraints[index],
                &constraints[index + 1],
            )
        {
            let result = {
                let (_, remaining) = constraints.split_at_mut(index);
                let (block, _) = remaining.split_at_mut(2);
                let (first, second) = block.split_at_mut(1);
                solve_velocity_contact_block(
                    world,
                    &mut first[0],
                    &mut second[0],
                    config,
                    delta_seconds,
                )
            };
            if let Some(result) = result {
                stats.contact_checks = stats.contact_checks.saturating_add(2);
                if result.applied_impulses > 0 {
                    stats.contact_block_solves = stats.contact_block_solves.saturating_add(1);
                    stats.velocity_impulses = stats
                        .velocity_impulses
                        .saturating_add(result.applied_impulses);
                }
                stats.baumgarte_velocity_biases = stats
                    .baumgarte_velocity_biases
                    .saturating_add(result.used_baumgarte_biases);
                stats.restitution_velocity_threshold_skips = stats
                    .restitution_velocity_threshold_skips
                    .saturating_add(result.skipped_restitutions);

                let tangent_impulses = {
                    let (_, remaining) = constraints.split_at_mut(index);
                    let (block, _) = remaining.split_at_mut(2);
                    let mut tangent_impulses = 0_u32;
                    for constraint in block {
                        if solve_tangent_contact_constraint(world, constraint) {
                            tangent_impulses = tangent_impulses.saturating_add(1);
                        }
                    }
                    tangent_impulses
                };
                stats.velocity_impulses = stats.velocity_impulses.saturating_add(tangent_impulses);
                index += 2;
                continue;
            }
        }

        let constraint = &mut constraints[index];
        stats.contact_checks = stats.contact_checks.saturating_add(1);
        let result = solve_velocity_contact_constraint(world, constraint, config, delta_seconds);
        if result.applied_impulse {
            stats.velocity_impulses = stats.velocity_impulses.saturating_add(1);
        }
        if result.used_baumgarte_bias {
            stats.baumgarte_velocity_biases = stats.baumgarte_velocity_biases.saturating_add(1);
        }
        if result.skipped_restitution {
            stats.restitution_velocity_threshold_skips =
                stats.restitution_velocity_threshold_skips.saturating_add(1);
        }
        index += 1;
    }
}

#[allow(clippy::too_many_arguments)]
fn solve_rigid_body_split_impulse_contacts(
    world: &World,
    split_impulses: &mut RigidSplitImpulseState,
    constraints: &mut [RigidContactConstraint],
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
    stats: &mut RigidBodyStepStats,
) {
    for constraint in constraints
        .iter_mut()
        .filter(|constraint| island_schedule.contact_in_island(constraint, island_root))
    {
        if solve_split_impulse_contact_constraint(
            world,
            split_impulses,
            constraint,
            config,
            delta_seconds,
        ) {
            stats.split_velocity_impulses = stats.split_velocity_impulses.saturating_add(1);
        }
    }
}

fn solve_rigid_body_position_contacts(
    world: &mut World,
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    config: RigidBodyStepConfig,
    stats: &mut RigidBodyStepStats,
) {
    for contact in CollisionSystem::build_rigid_collider_contacts(world) {
        if !island_schedule.pair_in_island(contact.contact.pair, island_root) {
            continue;
        }
        stats.contact_checks = stats.contact_checks.saturating_add(1);
        if solve_position_contact(world, contact, config) {
            stats.position_corrections = stats.position_corrections.saturating_add(1);
            stats.split_position_corrections = stats.split_position_corrections.saturating_add(1);
        }
    }
}

fn solve_velocity_contact_constraint(
    world: &mut World,
    constraint: &mut RigidContactConstraint,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
) -> RigidContactSolveResult {
    let mut result = solve_normal_contact_constraint(world, constraint, config, delta_seconds);
    if solve_tangent_contact_constraint(world, constraint) {
        result.applied_impulse = true;
    }
    result
}

fn solve_normal_contact_constraint(
    world: &mut World,
    constraint: &mut RigidContactConstraint,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
) -> RigidContactSolveResult {
    let a_index = constraint.pair.a.id as usize;
    let b_index = constraint.pair.b.id as usize;
    let Some(context) = rigid_contact_mass_context(world, a_index, b_index) else {
        return RigidContactSolveResult::default();
    };

    let point = finite_transform(constraint.point);
    let normal = finite_velocity(constraint.normal);
    let relative_velocity = relative_contact_velocity(world, a_index, b_index, point);
    let velocity_along_normal = dot_velocity(relative_velocity, normal);

    let material_a = contact_material_for_collider(world, constraint.collider_pair.a);
    let material_b = contact_material_for_collider(world, constraint.collider_pair.b);
    let material_restitution = material_a.restitution.min(material_b.restitution);
    let restitution = contact_restitution(
        material_restitution,
        velocity_along_normal,
        config.restitution_velocity_threshold,
    );
    let normal_denominator = contact_impulse_denominator(
        world,
        context.a_index,
        context.b_index,
        point,
        normal,
        context.inverse_mass_a,
        context.inverse_mass_b,
        context.inverse_inertia_a,
        context.inverse_inertia_b,
    );
    if normal_denominator <= 0.0 {
        return RigidContactSolveResult::default();
    }
    let baumgarte_bias = contact_velocity_baumgarte_bias(
        constraint.penetration,
        config,
        material_a,
        material_b,
        delta_seconds,
        velocity_along_normal,
    );
    let normal_impulse_delta =
        (baumgarte_bias - (1.0 + restitution) * velocity_along_normal) / normal_denominator;
    if !normal_impulse_delta.is_finite() {
        return RigidContactSolveResult::default();
    }
    let old_normal_impulse = constraint.normal_impulse.max(0.0);
    constraint.normal_impulse = (old_normal_impulse + normal_impulse_delta).max(0.0);
    let applied_normal_impulse_delta = constraint.normal_impulse - old_normal_impulse;
    let applied_normal_impulse = applied_normal_impulse_delta.abs() > CONTACT_IMPULSE_EPSILON;
    let result = RigidContactSolveResult {
        applied_impulse: applied_normal_impulse,
        used_baumgarte_bias: baumgarte_bias > CONTACT_IMPULSE_EPSILON && applied_normal_impulse,
        skipped_restitution: contact_restitution_threshold_skipped(
            material_restitution,
            velocity_along_normal,
            config.restitution_velocity_threshold,
        ),
    };

    if applied_normal_impulse {
        apply_contact_impulse_at_point(
            world,
            context.a_index,
            context.b_index,
            point,
            Velocity {
                vx: normal.vx * applied_normal_impulse_delta,
                vy: normal.vy * applied_normal_impulse_delta,
            },
            context.inverse_mass_a,
            context.inverse_mass_b,
            context.inverse_inertia_a,
            context.inverse_inertia_b,
        );
    }

    result
}

fn solve_split_impulse_contact_constraint(
    world: &World,
    split_impulses: &mut RigidSplitImpulseState,
    constraint: &mut RigidContactConstraint,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
) -> bool {
    let a_index = constraint.pair.a.id as usize;
    let b_index = constraint.pair.b.id as usize;
    let Some(context) = rigid_contact_mass_context(world, a_index, b_index) else {
        return false;
    };

    let point = finite_transform(constraint.point);
    let normal = finite_velocity(constraint.normal);
    let relative_velocity =
        split_impulses.relative_contact_velocity(world, context.a_index, context.b_index, point);
    let velocity_along_normal = dot_velocity(relative_velocity, normal);
    let material_a = contact_material_for_collider(world, constraint.collider_pair.a);
    let material_b = contact_material_for_collider(world, constraint.collider_pair.b);
    let split_bias = contact_baumgarte_bias_velocity(
        constraint.penetration,
        config,
        material_a,
        material_b,
        delta_seconds,
        velocity_along_normal,
    );
    if split_bias <= CONTACT_IMPULSE_EPSILON {
        return false;
    }

    let normal_denominator = contact_impulse_denominator(
        world,
        context.a_index,
        context.b_index,
        point,
        normal,
        context.inverse_mass_a,
        context.inverse_mass_b,
        context.inverse_inertia_a,
        context.inverse_inertia_b,
    );
    if normal_denominator <= 0.0 {
        return false;
    }

    let impulse_delta = (split_bias - velocity_along_normal) / normal_denominator;
    if !impulse_delta.is_finite() {
        return false;
    }
    let old_impulse = constraint.split_normal_impulse.max(0.0);
    constraint.split_normal_impulse = (old_impulse + impulse_delta).max(0.0);
    let applied_impulse = constraint.split_normal_impulse - old_impulse;
    if applied_impulse.abs() <= CONTACT_IMPULSE_EPSILON {
        return false;
    }

    split_impulses.apply_contact_impulse_at_point(
        world,
        context.a_index,
        context.b_index,
        point,
        Velocity {
            vx: normal.vx * applied_impulse,
            vy: normal.vy * applied_impulse,
        },
        context.inverse_mass_a,
        context.inverse_mass_b,
        context.inverse_inertia_a,
        context.inverse_inertia_b,
    );
    true
}

fn solve_tangent_contact_constraint(
    world: &mut World,
    constraint: &mut RigidContactConstraint,
) -> bool {
    let a_index = constraint.pair.a.id as usize;
    let b_index = constraint.pair.b.id as usize;
    let Some(context) = rigid_contact_mass_context(world, a_index, b_index) else {
        return false;
    };

    let point = finite_transform(constraint.point);
    let normal = finite_velocity(constraint.normal);
    let material_a = contact_material_for_collider(world, constraint.collider_pair.a);
    let material_b = contact_material_for_collider(world, constraint.collider_pair.b);
    let relative_velocity = relative_contact_velocity(world, a_index, b_index, point);
    let tangent = contact_constraint_tangent(normal);
    let friction = (material_a.friction * material_b.friction).sqrt();
    let tangent_denominator = contact_impulse_denominator(
        world,
        context.a_index,
        context.b_index,
        point,
        tangent,
        context.inverse_mass_a,
        context.inverse_mass_b,
        context.inverse_inertia_a,
        context.inverse_inertia_b,
    );
    if tangent_denominator <= 0.0 {
        return false;
    }
    let target_tangent_velocity = contact_surface_velocity(material_a, material_b, tangent);
    let tangent_impulse_delta =
        -(dot_velocity(relative_velocity, tangent) - target_tangent_velocity) / tangent_denominator;
    if !tangent_impulse_delta.is_finite() {
        return false;
    }
    let max_friction = constraint.normal_impulse * friction;
    let old_tangent_impulse = constraint.tangent_impulse;
    constraint.tangent_impulse =
        (old_tangent_impulse + tangent_impulse_delta).clamp(-max_friction, max_friction);
    let applied_tangent_impulse = constraint.tangent_impulse - old_tangent_impulse;
    if applied_tangent_impulse.abs() > CONTACT_IMPULSE_EPSILON {
        apply_contact_impulse_at_point(
            world,
            context.a_index,
            context.b_index,
            point,
            Velocity {
                vx: tangent.vx * applied_tangent_impulse,
                vy: tangent.vy * applied_tangent_impulse,
            },
            context.inverse_mass_a,
            context.inverse_mass_b,
            context.inverse_inertia_a,
            context.inverse_inertia_b,
        );
        return true;
    }

    false
}

fn solve_velocity_contact_block(
    world: &mut World,
    first: &mut RigidContactConstraint,
    second: &mut RigidContactConstraint,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
) -> Option<RigidContactBlockSolveResult> {
    if !rigid_contact_constraints_can_block_solve(first, second) {
        return None;
    }

    let a_index = first.pair.a.id as usize;
    let b_index = first.pair.b.id as usize;
    let context = rigid_contact_mass_context(world, a_index, b_index)?;
    let normal = finite_velocity(first.normal);
    let point_a = finite_transform(first.point);
    let point_b = finite_transform(second.point);
    let matrix = contact_normal_block_matrix(world, context, point_a, point_b, normal)?;

    let velocity_a = dot_velocity(
        relative_contact_velocity(world, context.a_index, context.b_index, point_a),
        normal,
    );
    let velocity_b = dot_velocity(
        relative_contact_velocity(world, context.a_index, context.b_index, point_b),
        normal,
    );
    let material_a = contact_material_for_collider(world, first.collider_pair.a);
    let material_b = contact_material_for_collider(world, first.collider_pair.b);
    let restitution = material_a.restitution.min(material_b.restitution);
    let baumgarte_bias_a = contact_velocity_baumgarte_bias(
        first.penetration,
        config,
        material_a,
        material_b,
        delta_seconds,
        velocity_a,
    );
    let baumgarte_bias_b = contact_velocity_baumgarte_bias(
        second.penetration,
        config,
        material_a,
        material_b,
        delta_seconds,
        velocity_b,
    );
    let target_a = baumgarte_bias_a
        - contact_restitution(
            restitution,
            velocity_a,
            config.restitution_velocity_threshold,
        ) * velocity_a;
    let target_b = baumgarte_bias_b
        - contact_restitution(
            restitution,
            velocity_b,
            config.restitution_velocity_threshold,
        ) * velocity_b;
    let old_impulse_a = first.normal_impulse.max(0.0);
    let old_impulse_b = second.normal_impulse.max(0.0);
    let rhs_a = target_a - velocity_a + matrix.k11 * old_impulse_a + matrix.k12 * old_impulse_b;
    let rhs_b = target_b - velocity_b + matrix.k12 * old_impulse_a + matrix.k22 * old_impulse_b;
    let determinant = matrix.k11 * matrix.k22 - matrix.k12 * matrix.k12;
    if !determinant.is_finite() || determinant <= CONTACT_IMPULSE_EPSILON {
        return None;
    }

    let solved_impulse_a = (matrix.k22 * rhs_a - matrix.k12 * rhs_b) / determinant;
    let solved_impulse_b = (matrix.k11 * rhs_b - matrix.k12 * rhs_a) / determinant;
    if !solved_impulse_a.is_finite()
        || !solved_impulse_b.is_finite()
        || solved_impulse_a < -CONTACT_IMPULSE_EPSILON
        || solved_impulse_b < -CONTACT_IMPULSE_EPSILON
    {
        return None;
    }

    let solved_impulse_a = solved_impulse_a.max(0.0);
    let solved_impulse_b = solved_impulse_b.max(0.0);
    let impulse_delta_a = solved_impulse_a - old_impulse_a;
    let impulse_delta_b = solved_impulse_b - old_impulse_b;
    let mut result = RigidContactBlockSolveResult {
        skipped_restitutions: contact_restitution_threshold_skipped(
            restitution,
            velocity_a,
            config.restitution_velocity_threshold,
        ) as u32
            + contact_restitution_threshold_skipped(
                restitution,
                velocity_b,
                config.restitution_velocity_threshold,
            ) as u32,
        ..RigidContactBlockSolveResult::default()
    };

    if impulse_delta_a.abs() > CONTACT_IMPULSE_EPSILON {
        apply_contact_impulse_at_point(
            world,
            context.a_index,
            context.b_index,
            point_a,
            Velocity {
                vx: normal.vx * impulse_delta_a,
                vy: normal.vy * impulse_delta_a,
            },
            context.inverse_mass_a,
            context.inverse_mass_b,
            context.inverse_inertia_a,
            context.inverse_inertia_b,
        );
        result.applied_impulses = result.applied_impulses.saturating_add(1);
        if baumgarte_bias_a > CONTACT_IMPULSE_EPSILON {
            result.used_baumgarte_biases = result.used_baumgarte_biases.saturating_add(1);
        }
    }
    if impulse_delta_b.abs() > CONTACT_IMPULSE_EPSILON {
        apply_contact_impulse_at_point(
            world,
            context.a_index,
            context.b_index,
            point_b,
            Velocity {
                vx: normal.vx * impulse_delta_b,
                vy: normal.vy * impulse_delta_b,
            },
            context.inverse_mass_a,
            context.inverse_mass_b,
            context.inverse_inertia_a,
            context.inverse_inertia_b,
        );
        result.applied_impulses = result.applied_impulses.saturating_add(1);
        if baumgarte_bias_b > CONTACT_IMPULSE_EPSILON {
            result.used_baumgarte_biases = result.used_baumgarte_biases.saturating_add(1);
        }
    }

    first.normal_impulse = solved_impulse_a;
    second.normal_impulse = solved_impulse_b;
    Some(result)
}

fn rigid_contact_constraints_can_block_solve(
    first: &RigidContactConstraint,
    second: &RigidContactConstraint,
) -> bool {
    first.pair == second.pair
        && first.collider_pair == second.collider_pair
        && dot_velocity(
            finite_velocity(first.normal),
            finite_velocity(second.normal),
        ) >= CONTACT_CACHE_NORMAL_DOT_MIN
}

fn rigid_contact_mass_context(
    world: &World,
    a_index: usize,
    b_index: usize,
) -> Option<RigidContactMassContext> {
    if !should_solve_rigid_contact(world, a_index, b_index) {
        return None;
    }

    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    if inverse_mass_a + inverse_mass_b <= 0.0 {
        return None;
    }

    Some(RigidContactMassContext {
        a_index,
        b_index,
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a: rigid_body_inverse_inertia(world, a_index),
        inverse_inertia_b: rigid_body_inverse_inertia(world, b_index),
    })
}

fn contact_normal_block_matrix(
    world: &World,
    context: RigidContactMassContext,
    point_a: Transform2D,
    point_b: Transform2D,
    normal: Velocity,
) -> Option<RigidContactBlockMatrix> {
    let radius_a1 = contact_radius(world, context.a_index, point_a);
    let radius_a2 = contact_radius(world, context.a_index, point_b);
    let radius_b1 = contact_radius(world, context.b_index, point_a);
    let radius_b2 = contact_radius(world, context.b_index, point_b);
    let radius_a1_cross_normal = cross_velocity(radius_a1, normal);
    let radius_a2_cross_normal = cross_velocity(radius_a2, normal);
    let radius_b1_cross_normal = cross_velocity(radius_b1, normal);
    let radius_b2_cross_normal = cross_velocity(radius_b2, normal);
    let inverse_mass_sum = context.inverse_mass_a + context.inverse_mass_b;
    let matrix = RigidContactBlockMatrix {
        k11: inverse_mass_sum
            + context.inverse_inertia_a * radius_a1_cross_normal * radius_a1_cross_normal
            + context.inverse_inertia_b * radius_b1_cross_normal * radius_b1_cross_normal,
        k12: inverse_mass_sum
            + context.inverse_inertia_a * radius_a1_cross_normal * radius_a2_cross_normal
            + context.inverse_inertia_b * radius_b1_cross_normal * radius_b2_cross_normal,
        k22: inverse_mass_sum
            + context.inverse_inertia_a * radius_a2_cross_normal * radius_a2_cross_normal
            + context.inverse_inertia_b * radius_b2_cross_normal * radius_b2_cross_normal,
    };

    (matrix.k11.is_finite()
        && matrix.k12.is_finite()
        && matrix.k22.is_finite()
        && matrix.k11 > 0.0
        && matrix.k22 > 0.0)
        .then_some(matrix)
}

fn contact_velocity_baumgarte_bias(
    penetration: f32,
    config: RigidBodyStepConfig,
    material_a: PhysicsMaterial,
    material_b: PhysicsMaterial,
    delta_seconds: f32,
    velocity_along_normal: f32,
) -> f32 {
    if config.contact_split_impulse {
        0.0
    } else {
        contact_baumgarte_bias_velocity(
            penetration,
            config,
            material_a,
            material_b,
            delta_seconds,
            velocity_along_normal,
        )
    }
}

fn contact_baumgarte_bias_velocity(
    penetration: f32,
    config: RigidBodyStepConfig,
    material_a: PhysicsMaterial,
    material_b: PhysicsMaterial,
    delta_seconds: f32,
    velocity_along_normal: f32,
) -> f32 {
    if !penetration.is_finite()
        || !delta_seconds.is_finite()
        || !velocity_along_normal.is_finite()
        || delta_seconds <= 0.0
        || velocity_along_normal < -CONTACT_IMPULSE_EPSILON
    {
        return 0.0;
    }

    let bias_scale = material_a
        .contact_baumgarte_bias_scale
        .min(material_b.contact_baumgarte_bias_scale);
    let max_velocity_scale = material_a
        .max_contact_baumgarte_bias_velocity_scale
        .min(material_b.max_contact_baumgarte_bias_velocity_scale);
    if bias_scale <= 0.0 || max_velocity_scale <= 0.0 {
        return 0.0;
    }

    let corrected_penetration =
        sanitize_non_negative(penetration - config.position_correction_slop);
    if corrected_penetration <= 0.0 {
        return 0.0;
    }

    (corrected_penetration * config.contact_baumgarte_bias_factor * bias_scale / delta_seconds)
        .clamp(
            0.0,
            config.max_contact_baumgarte_bias_velocity * max_velocity_scale,
        )
}

fn contact_restitution(
    restitution: f32,
    velocity_along_normal: f32,
    velocity_threshold: f32,
) -> f32 {
    if restitution <= 0.0 || !velocity_along_normal.is_finite() {
        return 0.0;
    }

    if velocity_along_normal < -sanitize_non_negative(velocity_threshold) {
        restitution
    } else {
        0.0
    }
}

fn contact_restitution_threshold_skipped(
    restitution: f32,
    velocity_along_normal: f32,
    velocity_threshold: f32,
) -> bool {
    let velocity_threshold = sanitize_non_negative(velocity_threshold);
    restitution > 0.0
        && velocity_along_normal.is_finite()
        && velocity_threshold > CONTACT_IMPULSE_EPSILON
        && (-velocity_threshold..-CONTACT_IMPULSE_EPSILON).contains(&velocity_along_normal)
}

fn solve_position_contact(
    world: &mut World,
    collider_contact: ColliderCollisionContact,
    config: RigidBodyStepConfig,
) -> bool {
    let contact = collider_contact.contact;
    let a_index = contact.pair.a.id as usize;
    let b_index = contact.pair.b.id as usize;
    if !should_solve_rigid_contact(world, a_index, b_index) {
        return false;
    }

    let inverse_mass_a = rigid_body_inverse_mass(world, a_index);
    let inverse_mass_b = rigid_body_inverse_mass(world, b_index);
    let inverse_inertia_a = rigid_body_inverse_inertia(world, a_index);
    let inverse_inertia_b = rigid_body_inverse_inertia(world, b_index);
    let inverse_mass_sum = inverse_mass_a + inverse_mass_b;
    if inverse_mass_sum <= 0.0 {
        return false;
    }

    let point = finite_transform(Transform2D {
        x: contact.point_x,
        y: contact.point_y,
    });
    let normal = finite_velocity(Velocity {
        vx: contact.normal_x,
        vy: contact.normal_y,
    });
    let position_denominator = contact_impulse_denominator(
        world,
        a_index,
        b_index,
        point,
        normal,
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a,
        inverse_inertia_b,
    );
    if position_denominator <= 0.0 {
        return false;
    }

    let material_a = contact_material_for_collider(world, collider_contact.collider_pair.a);
    let material_b = contact_material_for_collider(world, collider_contact.collider_pair.b);
    let correction_scale = material_a
        .contact_position_correction_scale
        .min(material_b.contact_position_correction_scale);
    if correction_scale <= 0.0 {
        return false;
    }
    let correction_slop_scale = material_a
        .contact_position_correction_slop_scale
        .min(material_b.contact_position_correction_slop_scale);
    let position_correction_slop = config.position_correction_slop * correction_slop_scale;

    let correction_magnitude = ((contact.penetration - position_correction_slop).max(0.0)
        / position_denominator)
        * config.position_correction_percent
        * correction_scale;
    if !correction_magnitude.is_finite() || correction_magnitude <= 0.0 {
        return false;
    }
    let correction = Velocity {
        vx: normal.vx * correction_magnitude,
        vy: normal.vy * correction_magnitude,
    };
    apply_contact_position_impulse_at_point(
        world,
        a_index,
        b_index,
        point,
        correction,
        inverse_mass_a,
        inverse_mass_b,
        inverse_inertia_a,
        inverse_inertia_b,
    );
    true
}

fn move_and_slide_internal(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    displacement: Velocity,
    settings: KinematicMoveSettings,
    mut counters: Option<&mut PhysicsCounters>,
) -> KinematicMoveResult {
    if let Some(counters) = counters.as_deref_mut() {
        counters.kinematic_moves = counters.kinematic_moves.saturating_add(1);
    }
    let start = world.transform(entity).unwrap_or_default();
    let Some(collider) = world.collider(entity) else {
        let end = Transform2D {
            x: start.x + displacement.vx,
            y: start.y + displacement.vy,
        };
        world.set_transform(entity, end);
        return KinematicMoveResult {
            start,
            end,
            requested: displacement,
            remaining: Velocity::default(),
            hit_count: 0,
            blocked_x: false,
            blocked_y: false,
            last_hit: None,
        };
    };
    if !collider.enabled {
        let end = Transform2D {
            x: start.x + displacement.vx,
            y: start.y + displacement.vy,
        };
        world.set_transform(entity, end);
        return KinematicMoveResult {
            start,
            end,
            requested: displacement,
            remaining: Velocity::default(),
            hit_count: 0,
            blocked_x: false,
            blocked_y: false,
            last_hit: None,
        };
    }

    let mut position = start;
    let mut remaining = finite_velocity(displacement);
    let iterations = settings.max_iterations.min(MAX_KINEMATIC_ITERATIONS);
    let mut hit_count = 0;
    let mut blocked_x = false;
    let mut blocked_y = false;
    let mut last_hit = None;

    if iterations == 0 {
        position.x += remaining.vx;
        position.y += remaining.vy;
        world.set_transform(entity, position);
        return KinematicMoveResult {
            start,
            end: position,
            requested: displacement,
            remaining: Velocity::default(),
            hit_count,
            blocked_x,
            blocked_y,
            last_hit,
        };
    }

    for _ in 0..iterations {
        if velocity_len_squared(remaining) <= KINEMATIC_EPSILON * KINEMATIC_EPSILON {
            remaining = Velocity::default();
            break;
        }

        let Some(hit) = earliest_solid_hit(
            KinematicSweep {
                world,
                tilemap,
                entity,
                position,
                collider,
                remaining,
                solid_mask: settings.solid_mask,
                one_way_platforms: settings.one_way_platforms,
                ignored_entity: settings.ignored_entity,
            },
            counters.as_deref_mut(),
        ) else {
            position.x += remaining.vx;
            position.y += remaining.vy;
            remaining = Velocity::default();
            break;
        };

        let travel = hit.contact.time.clamp(0.0, 1.0);
        position.x += remaining.vx * travel;
        position.y += remaining.vy * travel;
        hit_count += 1;
        if let Some(counters) = counters.as_deref_mut() {
            counters.kinematic_hits = counters.kinematic_hits.saturating_add(1);
            if hit.entity.is_some() {
                counters.kinematic_entity_hits = counters.kinematic_entity_hits.saturating_add(1);
            } else {
                counters.kinematic_tile_hits = counters.kinematic_tile_hits.saturating_add(1);
            }
        }
        blocked_x |= hit.contact.normal_x != 0.0;
        blocked_y |= hit.contact.normal_y != 0.0;
        last_hit = hit.entity;

        let time_left = 1.0 - travel;
        let mut slide = Velocity {
            vx: remaining.vx * time_left,
            vy: remaining.vy * time_left,
        };
        let into_normal = slide.vx * hit.contact.normal_x + slide.vy * hit.contact.normal_y;
        if into_normal > 0.0 {
            slide.vx -= hit.contact.normal_x * into_normal;
            slide.vy -= hit.contact.normal_y * into_normal;
        }
        remaining = slide;
    }

    world.set_transform(entity, position);
    KinematicMoveResult {
        start,
        end: position,
        requested: displacement,
        remaining,
        hit_count,
        blocked_x,
        blocked_y,
        last_hit,
    }
}

#[derive(Clone, Copy)]
struct StepOffsetSettings {
    enabled: bool,
    offset: f32,
    ground_probe_distance: f32,
    solid_mask: CollisionMask,
}

impl StepOffsetSettings {
    const fn disabled() -> Self {
        Self {
            enabled: false,
            offset: 0.0,
            ground_probe_distance: 0.0,
            solid_mask: CollisionMask::NONE,
        }
    }

    fn should_attempt(self, movement: KinematicMoveResult, displacement: Velocity) -> bool {
        self.enabled
            && self.offset > 0.0
            && movement.blocked_x
            && displacement.vx.abs() > KINEMATIC_EPSILON
            && displacement.vy >= -KINEMATIC_EPSILON
    }
}

fn move_with_optional_step_offset(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    displacement: Velocity,
    settings: KinematicMoveSettings,
    step: StepOffsetSettings,
    mut counters: Option<&mut PhysicsCounters>,
) -> KinematicMoveResult {
    let normal = move_and_slide_internal(
        world,
        tilemap,
        entity,
        displacement,
        settings,
        counters.as_deref_mut(),
    );
    if !step.should_attempt(normal, displacement) {
        return normal;
    }

    let normal_end = normal.end;
    world.set_transform(entity, normal.start);

    let step_up = move_and_slide_internal(
        world,
        tilemap,
        entity,
        Velocity {
            vx: 0.0,
            vy: -step.offset,
        },
        settings,
        counters.as_deref_mut(),
    );
    if step_up.blocked_y {
        world.set_transform(entity, normal_end);
        return normal;
    }

    let step_across = move_and_slide_internal(
        world,
        tilemap,
        entity,
        Velocity {
            vx: displacement.vx,
            vy: 0.0,
        },
        settings,
        counters.as_deref_mut(),
    );
    if step_across.blocked_x {
        world.set_transform(entity, normal_end);
        return normal;
    }

    let step_down = move_and_slide_internal(
        world,
        tilemap,
        entity,
        Velocity {
            vx: 0.0,
            vy: step.offset + step.ground_probe_distance,
        },
        settings,
        counters,
    );
    if ground_probe_internal(
        world,
        tilemap,
        entity,
        step.ground_probe_distance,
        step.solid_mask,
    )
    .is_none()
    {
        world.set_transform(entity, normal_end);
        return normal;
    }

    let end = world.transform(entity).unwrap_or(step_down.end);
    KinematicMoveResult {
        start: normal.start,
        end,
        requested: displacement,
        remaining: Velocity::default(),
        hit_count: step_up
            .hit_count
            .saturating_add(step_across.hit_count)
            .saturating_add(step_down.hit_count),
        blocked_x: false,
        blocked_y: step_down.blocked_y,
        last_hit: step_down
            .last_hit
            .or(step_across.last_hit)
            .or(step_up.last_hit),
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct SlopeGroundHit {
    surface: SlopeSurfaceHit,
    vertical_delta: f32,
    distance: f32,
    tile_layer_index: Option<usize>,
    tile_index: Option<usize>,
}

impl SlopeGroundHit {
    fn from_tilemap_hit(hit: TilemapSlopeGroundHit) -> Self {
        Self {
            surface: hit.surface,
            vertical_delta: hit.vertical_delta,
            distance: hit.distance,
            tile_layer_index: Some(hit.layer_index),
            tile_index: Some(hit.tile_index),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SlopeSnapDirection {
    allow_upward: bool,
    allow_downward: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct SlopeSnapSettings<'a> {
    tilemap: Option<&'a Tilemap>,
    slopes: &'a [SlopeSegment],
    slope: SlopeConfig,
    direction: SlopeSnapDirection,
}

fn move_with_optional_slope_snap(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    movement: KinematicMoveResult,
    settings: KinematicMoveSettings,
    slope_snap: SlopeSnapSettings<'_>,
    counters: Option<&mut PhysicsCounters>,
) -> KinematicMoveResult {
    let Some(hit) = slope_ground_hit(
        world,
        slope_snap.tilemap,
        entity,
        slope_snap.slopes,
        slope_snap.slope,
        slope_snap.direction.allow_upward,
        slope_snap.direction.allow_downward,
    ) else {
        return movement;
    };
    if hit.vertical_delta.abs() <= KINEMATIC_EPSILON {
        return movement;
    }

    let snap_start = world.transform(entity).unwrap_or(movement.end);
    let snap_movement = move_and_slide_internal(
        world,
        tilemap,
        entity,
        Velocity {
            vx: 0.0,
            vy: hit.vertical_delta,
        },
        settings,
        counters,
    );
    if hit.vertical_delta < -KINEMATIC_EPSILON && snap_movement.blocked_y {
        world.set_transform(entity, snap_start);
        return movement;
    }

    KinematicMoveResult {
        start: movement.start,
        end: world.transform(entity).unwrap_or(snap_movement.end),
        requested: movement.requested,
        remaining: snap_movement.remaining,
        hit_count: movement.hit_count.saturating_add(snap_movement.hit_count),
        blocked_x: movement.blocked_x,
        blocked_y: movement.blocked_y || snap_movement.blocked_y,
        last_hit: snap_movement.last_hit.or(movement.last_hit),
    }
}

#[derive(Clone, Copy, Debug)]
struct KinematicHit {
    entity: Option<Entity>,
    contact: SweptAabbContactHit,
}

#[derive(Clone, Copy)]
struct KinematicSweep<'a> {
    world: &'a World,
    tilemap: Option<&'a Tilemap>,
    entity: Entity,
    position: Transform2D,
    collider: AabbCollider,
    remaining: Velocity,
    solid_mask: CollisionMask,
    one_way_platforms: OneWayPlatformConfig,
    ignored_entity: Option<Entity>,
}

fn earliest_solid_hit(
    sweep: KinematicSweep<'_>,
    mut counters: Option<&mut PhysicsCounters>,
) -> Option<KinematicHit> {
    let KinematicSweep {
        world,
        tilemap,
        entity,
        position,
        collider,
        remaining,
        solid_mask,
        one_way_platforms,
        ignored_entity,
    } = sweep;
    let moving_index = entity.id as usize;
    let mut best: Option<KinematicHit> = None;

    for target_index in 0..world.transforms.len() {
        if target_index == moving_index || !world.alive.get(target_index).copied().unwrap_or(false)
        {
            continue;
        }
        if ignored_entity.is_some_and(|entity| {
            entity.id as usize == target_index
                && world.generations[target_index] == entity.generation
        }) {
            continue;
        }
        let Some(target_collider) = world.colliders[target_index] else {
            continue;
        };
        if !target_collider.enabled {
            continue;
        }
        if let Some(counters) = counters.as_deref_mut() {
            counters.solid_candidate_checks = counters.solid_candidate_checks.saturating_add(1);
        }
        if target_collider.is_trigger
            || !solid_filter_allows(world, moving_index, target_index, solid_mask)
        {
            continue;
        }
        let Some(target_transform) = world.transforms[target_index] else {
            continue;
        };
        let Some(contact) = CollisionSystem::swept_aabb_contact(
            position,
            remaining,
            collider,
            target_transform,
            Velocity::default(),
            target_collider,
            1.0,
        ) else {
            continue;
        };
        let is_one_way_platform =
            is_one_way_platform_candidate(world, target_index, one_way_platforms);
        if is_one_way_platform
            && !one_way_platform_contact_blocks(
                position,
                collider,
                remaining,
                target_transform,
                target_collider,
                contact,
            )
        {
            continue;
        }
        if contact.time <= KINEMATIC_EPSILON
            && CollisionSystem::aabb_contact(position, collider, target_transform, target_collider)
                .is_none()
            && !is_one_way_platform
        {
            continue;
        }
        let into_normal = remaining.vx * contact.normal_x + remaining.vy * contact.normal_y;
        if contact.time <= KINEMATIC_EPSILON && into_normal <= 0.0 {
            continue;
        }
        if best.is_none_or(|hit| contact.time < hit.contact.time) {
            best = Some(KinematicHit {
                entity: Some(Entity {
                    id: target_index as u32,
                    generation: world.generations[target_index],
                }),
                contact,
            });
        }
    }

    if let Some(tilemap) = tilemap {
        let mut stats = TilemapSweepStats::default();
        if let Some(hit) = tilemap.swept_aabb_contact(position, collider, remaining, &mut stats) {
            if let Some(counters) = counters.as_deref_mut() {
                counters.tile_candidate_checks = counters
                    .tile_candidate_checks
                    .saturating_add(stats.candidate_tiles);
            }
            if best.is_none_or(|best_hit| hit.contact.time < best_hit.contact.time) {
                best = Some(KinematicHit {
                    entity: None,
                    contact: hit.contact,
                });
            }
        } else if let Some(counters) = counters {
            counters.tile_candidate_checks = counters
                .tile_candidate_checks
                .saturating_add(stats.candidate_tiles);
        }
    }

    best
}

fn carry_moving_platform_internal(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    rider: Entity,
    config: MovingPlatformCarryConfig,
) -> Option<KinematicMoveResult> {
    let ground = ground_probe_internal(
        world,
        tilemap,
        rider,
        config.probe_distance,
        config.solid_mask,
    )?;
    if ground.entity != Some(config.platform) {
        return None;
    }

    Some(move_and_slide_internal(
        world,
        tilemap,
        rider,
        config.displacement,
        KinematicMoveSettings::new(
            config.solid_mask,
            config.one_way_platforms,
            config.max_iterations,
        )
        .ignoring_entity(config.platform),
        None,
    ))
}

#[derive(Default)]
struct PlatformerControllerRuntime<'a> {
    state: Option<&'a mut PlatformerControllerState>,
    counters: Option<&'a mut PhysicsCounters>,
    slopes: &'a [SlopeSegment],
}

impl<'a> PlatformerControllerRuntime<'a> {
    fn new(
        state: Option<&'a mut PlatformerControllerState>,
        counters: Option<&'a mut PhysicsCounters>,
    ) -> Self {
        Self::new_with_slopes(state, counters, &[])
    }

    fn new_with_slopes(
        state: Option<&'a mut PlatformerControllerState>,
        counters: Option<&'a mut PhysicsCounters>,
        slopes: &'a [SlopeSegment],
    ) -> Self {
        Self {
            state,
            counters,
            slopes,
        }
    }
}

fn move_platformer_controller_internal(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    input: PlatformerControllerInput,
    config: PlatformerControllerConfig,
    delta_seconds: f32,
    runtime: PlatformerControllerRuntime<'_>,
) -> PlatformerControllerResult {
    let PlatformerControllerRuntime {
        mut state,
        mut counters,
        slopes,
    } = runtime;
    let config = sanitize_platformer_controller_config(config);
    let delta_seconds = sanitize_delta_seconds(delta_seconds);
    let ground_before_probe = ground_probe_internal(
        world,
        tilemap,
        entity,
        config.ground_probe_distance,
        config.solid_mask,
    );
    let slope_before = slope_ground_hit(
        world,
        tilemap,
        entity,
        slopes,
        config.slope,
        true,
        config.slope.allow_downhill_snap,
    );
    let ground_before = merge_slope_ground_hit(ground_before_probe, slope_before);
    let mut velocity = finite_velocity(world.velocity(entity).unwrap_or_default());
    velocity.vx = sanitize_horizontal_axis(input.horizontal_axis) * config.horizontal_speed;

    let mut wants_jump = input.jump_pressed;
    let mut can_jump = ground_before.is_some();
    if let Some(controller_state) = &mut state {
        if ground_before.is_some() {
            controller_state.coyote_time_remaining = config.coyote_time_seconds;
        } else {
            controller_state.coyote_time_remaining =
                subtract_timer(controller_state.coyote_time_remaining, delta_seconds);
        }

        if input.jump_pressed {
            controller_state.jump_buffer_remaining = config.jump_buffer_seconds;
        } else {
            controller_state.jump_buffer_remaining =
                subtract_timer(controller_state.jump_buffer_remaining, delta_seconds);
        }

        wants_jump |= controller_state.jump_buffer_remaining > 0.0;
        can_jump |= controller_state.coyote_time_remaining > 0.0;
    }

    let mut jumped = wants_jump && can_jump;
    if jumped {
        velocity.vy = -config.jump_speed;
        clear_controller_jump_timers(&mut state);
    } else {
        if ground_before.is_some() && velocity.vy > 0.0 {
            velocity.vy = 0.0;
        }
        velocity.vy = (velocity.vy + config.gravity * delta_seconds).min(config.max_fall_speed);
    }

    let movement_settings = KinematicMoveSettings::new(
        config.solid_mask,
        config.one_way_platforms,
        config.max_iterations,
    );
    let mut movement = move_with_optional_step_offset(
        world,
        tilemap,
        entity,
        Velocity {
            vx: velocity.vx * delta_seconds,
            vy: velocity.vy * delta_seconds,
        },
        movement_settings,
        if !jumped && ground_before.is_some() {
            StepOffsetSettings {
                enabled: true,
                offset: config.step_offset,
                ground_probe_distance: config.ground_probe_distance,
                solid_mask: config.solid_mask,
            }
        } else {
            StepOffsetSettings::disabled()
        },
        counters.as_deref_mut(),
    );
    if !jumped {
        let allow_upward_snap = ground_before.is_some();
        let allow_downward_snap = config.slope.allow_downhill_snap
            && (ground_before.is_some() || velocity.vy >= -KINEMATIC_EPSILON);
        movement = move_with_optional_slope_snap(
            world,
            tilemap,
            entity,
            movement,
            movement_settings,
            SlopeSnapSettings {
                tilemap,
                slopes,
                slope: config.slope,
                direction: SlopeSnapDirection {
                    allow_upward: allow_upward_snap,
                    allow_downward: allow_downward_snap,
                },
            },
            counters,
        );
    }
    if movement.blocked_y {
        velocity.vy = 0.0;
    }

    let ground_after_probe = ground_probe_internal(
        world,
        tilemap,
        entity,
        config.ground_probe_distance,
        config.solid_mask,
    );
    let slope_after = slope_ground_hit(
        world,
        tilemap,
        entity,
        slopes,
        config.slope,
        true,
        config.slope.allow_downhill_snap,
    );
    let ground_after = merge_slope_ground_hit(ground_after_probe, slope_after);
    if !jumped
        && state
            .as_ref()
            .is_some_and(|controller_state| controller_state.jump_buffer_remaining > 0.0)
        && ground_after.is_some()
    {
        jumped = true;
        velocity.vy = -config.jump_speed;
        clear_controller_jump_timers(&mut state);
    } else if ground_after.is_some() && velocity.vy > 0.0 {
        velocity.vy = 0.0;
    }
    if !jumped {
        if let Some(controller_state) = &mut state {
            if ground_after.is_some() {
                controller_state.coyote_time_remaining = config.coyote_time_seconds;
            }
        }
    }
    world.set_velocity(entity, velocity);

    PlatformerControllerResult {
        movement,
        velocity,
        ground_before,
        ground_after,
        jumped,
        grounded: ground_after.is_some() && !jumped,
    }
}

fn slope_ground_hit(
    world: &World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    slopes: &[SlopeSegment],
    slope: SlopeConfig,
    allow_upward: bool,
    allow_downward: bool,
) -> Option<SlopeGroundHit> {
    if !is_slope_config_enabled(slope) || (slopes.is_empty() && tilemap.is_none()) {
        return None;
    }

    let transform = world.transform(entity)?;
    let collider = world.collider(entity)?;
    if !collider.enabled {
        return None;
    }
    let center = collider.center(transform);
    let bottom_y = center.y + collider.half_height;
    let mut best = None;

    for segment in slopes {
        let Some(surface) = segment.surface_at_x(center.x) else {
            continue;
        };
        if surface.angle_radians > slope.max_climb_angle_radians {
            continue;
        }

        let vertical_delta = surface.y - bottom_y;
        if vertical_delta < -KINEMATIC_EPSILON && !allow_upward {
            continue;
        }
        if vertical_delta > KINEMATIC_EPSILON && !allow_downward {
            continue;
        }

        let distance = vertical_delta.abs();
        if distance > slope.snap_distance + KINEMATIC_EPSILON {
            continue;
        }

        let hit = SlopeGroundHit {
            surface,
            vertical_delta,
            distance,
            tile_layer_index: None,
            tile_index: None,
        };
        update_slope_ground_hit(&mut best, hit);
    }

    if let Some(tilemap) = tilemap {
        if let Some(hit) =
            tilemap.slope_ground_hit(center.x, bottom_y, slope, allow_upward, allow_downward)
        {
            update_slope_ground_hit(&mut best, SlopeGroundHit::from_tilemap_hit(hit));
        }
    }

    best
}

fn merge_slope_ground_hit(
    ground: Option<GroundProbeHit>,
    slope: Option<SlopeGroundHit>,
) -> Option<GroundProbeHit> {
    let Some(slope) = slope else {
        return ground;
    };
    let slope_hit = GroundProbeHit {
        entity: None,
        tile_layer_index: slope.tile_layer_index,
        tile_index: slope.tile_index,
        distance: slope.distance,
        normal_x: slope.surface.normal_x,
        normal_y: slope.surface.normal_y,
    };
    if ground.is_none_or(|current| slope_hit.distance < current.distance) {
        Some(slope_hit)
    } else {
        ground
    }
}

fn update_slope_ground_hit(best: &mut Option<SlopeGroundHit>, next: SlopeGroundHit) {
    if best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| slope_ground_source_key(next).cmp(&slope_ground_source_key(current)))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

fn slope_ground_source_key(hit: SlopeGroundHit) -> (u8, usize, usize) {
    if let (Some(layer_index), Some(tile_index)) = (hit.tile_layer_index, hit.tile_index) {
        (1, layer_index, tile_index)
    } else {
        (0, usize::MAX, usize::MAX)
    }
}

fn ground_probe_internal(
    world: &World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    probe_distance: f32,
    solid_mask: CollisionMask,
) -> Option<GroundProbeHit> {
    if !is_valid_probe_distance(probe_distance) {
        return None;
    }
    let start = world.transform(entity)?;
    let collider = world.collider(entity)?;
    if !collider.enabled {
        return None;
    }
    let moving_index = entity.id as usize;
    let displacement = Velocity {
        vx: 0.0,
        vy: probe_distance,
    };
    let mut best = None;

    for target_index in 0..world.transforms.len() {
        if target_index == moving_index || !world.alive.get(target_index).copied().unwrap_or(false)
        {
            continue;
        }
        let Some(target_collider) = world.colliders[target_index] else {
            continue;
        };
        if !target_collider.enabled
            || target_collider.is_trigger
            || !solid_filter_allows(world, moving_index, target_index, solid_mask)
        {
            continue;
        }
        let Some(target_transform) = world.transforms[target_index] else {
            continue;
        };
        let Some(contact) = CollisionSystem::swept_aabb_contact(
            start,
            displacement,
            collider,
            target_transform,
            Velocity::default(),
            target_collider,
            1.0,
        ) else {
            continue;
        };
        if !is_ground_normal(contact.normal_y) {
            continue;
        }
        let into_normal = displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
        if contact.time <= KINEMATIC_EPSILON && into_normal <= 0.0 {
            continue;
        }
        update_ground_probe_hit(
            &mut best,
            GroundProbeHit {
                entity: Some(Entity {
                    id: target_index as u32,
                    generation: world.generations[target_index],
                }),
                tile_layer_index: None,
                tile_index: None,
                distance: probe_distance * contact.time.clamp(0.0, 1.0),
                normal_x: contact.normal_x,
                normal_y: contact.normal_y,
            },
        );
    }

    if let Some(tilemap) = tilemap {
        if let Some(hit) = tilemap.ground_probe_contact(start, collider, probe_distance) {
            update_ground_probe_hit(
                &mut best,
                GroundProbeHit {
                    entity: None,
                    tile_layer_index: Some(hit.layer_index),
                    tile_index: Some(hit.tile_index),
                    distance: probe_distance * hit.contact.time.clamp(0.0, 1.0),
                    normal_x: hit.contact.normal_x,
                    normal_y: hit.contact.normal_y,
                },
            );
        }
    }

    best
}

fn upward_surface_normal(dx: f32, dy: f32, length: f32) -> (f32, f32) {
    let normal_x = -dy / length;
    let normal_y = dx / length;
    if normal_y >= 0.0 {
        (normal_x, normal_y)
    } else {
        (-normal_x, -normal_y)
    }
}

fn sanitize_fixed_timestep_config(config: FixedTimestepConfig) -> FixedTimestepConfig {
    let default = FixedTimestepConfig::default();
    FixedTimestepConfig {
        step_seconds: if config.step_seconds.is_finite() && config.step_seconds > 0.0 {
            config.step_seconds
        } else {
            default.step_seconds
        },
        max_frame_seconds: if config.max_frame_seconds.is_finite() && config.max_frame_seconds > 0.0
        {
            config.max_frame_seconds
        } else {
            default.max_frame_seconds
        },
        max_steps_per_update: config.max_steps_per_update.max(1),
    }
}

fn sanitize_rigid_body_step_config(config: RigidBodyStepConfig) -> RigidBodyStepConfig {
    let default = RigidBodyStepConfig::default();
    RigidBodyStepConfig {
        gravity: finite_velocity(config.gravity),
        velocity_iterations: config.velocity_iterations.clamp(1, 32),
        position_iterations: config.position_iterations.clamp(1, 32),
        position_correction_percent: if config.position_correction_percent.is_finite()
            && config.position_correction_percent >= 0.0
        {
            config.position_correction_percent.min(1.0)
        } else {
            default.position_correction_percent
        },
        position_correction_slop: sanitize_non_negative(config.position_correction_slop),
        restitution_velocity_threshold: if config.restitution_velocity_threshold.is_finite()
            && config.restitution_velocity_threshold >= 0.0
        {
            config.restitution_velocity_threshold
        } else {
            default.restitution_velocity_threshold
        },
        contact_baumgarte_bias_factor: if config.contact_baumgarte_bias_factor.is_finite()
            && config.contact_baumgarte_bias_factor >= 0.0
        {
            config.contact_baumgarte_bias_factor.min(1.0)
        } else {
            default.contact_baumgarte_bias_factor
        },
        max_contact_baumgarte_bias_velocity: if config
            .max_contact_baumgarte_bias_velocity
            .is_finite()
            && config.max_contact_baumgarte_bias_velocity >= 0.0
        {
            config.max_contact_baumgarte_bias_velocity
        } else {
            default.max_contact_baumgarte_bias_velocity
        },
        contact_split_impulse: config.contact_split_impulse,
    }
}

fn sanitize_rigid_body_substeps(substeps: u32) -> u32 {
    substeps.clamp(1, MAX_RIGID_BODY_SUBSTEPS)
}

fn sanitize_distance_joint_rest_length(rest_length: f32) -> f32 {
    sanitize_non_negative(rest_length)
}

fn sanitize_rope_joint_max_length(max_length: f32) -> f32 {
    sanitize_non_negative(max_length)
}

fn sanitize_spring_joint_rest_length(rest_length: f32) -> f32 {
    sanitize_non_negative(rest_length)
}

fn sanitize_pulley_joint_rest_length(rest_length: f32) -> f32 {
    sanitize_non_negative(rest_length)
}

fn sanitize_unit_interval(value: f32, default: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        default
    }
}

fn sanitize_gear_joint_ratio(ratio: f32) -> f32 {
    if ratio.is_finite() {
        ratio
    } else {
        GearJoint::DEFAULT_RATIO
    }
}

fn sanitize_pulley_joint_ratio(ratio: f32) -> f32 {
    if ratio.is_finite() && ratio > KINEMATIC_EPSILON {
        ratio
    } else {
        PulleyJoint::DEFAULT_RATIO
    }
}

fn should_solve_rigid_contact(world: &World, a_index: usize, b_index: usize) -> bool {
    if is_trigger_collider(world, a_index) || is_trigger_collider(world, b_index) {
        return false;
    }
    if has_disabled_rigid_body(world, a_index) || has_disabled_rigid_body(world, b_index) {
        return false;
    }
    rigid_body_inverse_mass(world, a_index) > 0.0 || rigid_body_inverse_mass(world, b_index) > 0.0
}

fn clear_rigid_body_accumulators(body: &mut RigidBody) {
    body.force = Velocity::default();
    body.impulse = Velocity::default();
    body.torque = 0.0;
    body.angular_impulse = 0.0;
}

fn rigid_body_has_pending_wake_input(body: RigidBody) -> bool {
    body.force.vx != 0.0
        || body.force.vy != 0.0
        || body.impulse.vx != 0.0
        || body.impulse.vy != 0.0
        || body.torque != 0.0
        || body.angular_impulse != 0.0
}

fn wake_sleeping_rigid_body_at(world: &mut World, index: usize) -> bool {
    let Some(mut body) = world.rigid_bodies.get(index).copied().flatten() else {
        return false;
    };
    if !body.enabled || body.body_type != RigidBodyType::Dynamic || !body.is_sleeping {
        return false;
    }
    body.is_sleeping = false;
    body.sleep_timer_seconds = 0.0;
    world.rigid_bodies[index] = Some(body);
    true
}

fn put_rigid_body_to_sleep_at(world: &mut World, index: usize) -> bool {
    let Some(mut body) = world.rigid_bodies.get(index).copied().flatten() else {
        return false;
    };
    if !body.enabled || body.body_type != RigidBodyType::Dynamic || body.is_sleeping {
        return false;
    }
    body.is_sleeping = true;
    body.sleep_timer_seconds = DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS;
    world.velocities[index] = Some(Velocity::default());
    world.angular_velocities[index] = Some(AngularVelocity::default());
    world.rigid_bodies[index] = Some(body);
    true
}

fn is_sleeping_dynamic_rigid_body(world: &World, index: usize) -> bool {
    world
        .rigid_bodies
        .get(index)
        .copied()
        .flatten()
        .is_some_and(|body| {
            body.enabled && body.body_type == RigidBodyType::Dynamic && body.is_sleeping
        })
}

fn count_sleeping_dynamic_rigid_bodies(world: &World) -> u32 {
    world
        .rigid_bodies
        .iter()
        .enumerate()
        .filter(|(index, _)| world.alive.get(*index).copied().unwrap_or(false))
        .filter(|(index, _)| is_sleeping_dynamic_rigid_body(world, *index))
        .count() as u32
}

fn is_rigid_body_wake_source(world: &World, index: usize) -> bool {
    let Some(body) = world.rigid_bodies.get(index).copied().flatten() else {
        return false;
    };
    if !body.enabled {
        return false;
    }
    match body.body_type {
        RigidBodyType::Dynamic => {
            if body.is_sleeping {
                return false;
            }
        }
        RigidBodyType::Kinematic => {}
        RigidBodyType::Static => return false,
    }

    let velocity = finite_velocity(
        world
            .velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    );
    let angular_velocity = finite_angular_velocity(
        world
            .angular_velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    );
    !rigid_body_is_below_sleep_thresholds(velocity, angular_velocity)
}

fn rigid_body_is_ready_for_sleep(world: &World, index: usize, body: RigidBody) -> bool {
    if !body.enabled
        || body.body_type != RigidBodyType::Dynamic
        || !body.can_sleep
        || body.is_sleeping
        || body.sleep_timer_seconds < DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS
    {
        return false;
    }

    let velocity = finite_velocity(
        world
            .velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    );
    let angular_velocity = finite_angular_velocity(
        world
            .angular_velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    );
    rigid_body_is_below_sleep_thresholds(velocity, angular_velocity)
}

fn rigid_body_is_below_sleep_thresholds(
    velocity: Velocity,
    angular_velocity: AngularVelocity,
) -> bool {
    velocity_len_squared(velocity)
        <= DEFAULT_SLEEP_LINEAR_THRESHOLD * DEFAULT_SLEEP_LINEAR_THRESHOLD
        && angular_velocity.radians_per_second.abs() <= DEFAULT_SLEEP_ANGULAR_THRESHOLD
}

fn is_trigger_collider(world: &World, index: usize) -> bool {
    world
        .colliders
        .get(index)
        .copied()
        .flatten()
        .is_some_and(|collider| collider.is_trigger)
        || world
            .circle_colliders
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|collider| collider.is_trigger)
        || world
            .capsule_colliders
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|collider| collider.is_trigger)
}

fn valid_world_entity_index(world: &World, entity: Entity) -> Option<usize> {
    let index = entity.id as usize;
    (index < world.alive.len()
        && world.alive[index]
        && world.generations[index] == entity.generation)
        .then_some(index)
}

fn has_disabled_rigid_body(world: &World, index: usize) -> bool {
    world
        .rigid_bodies
        .get(index)
        .copied()
        .flatten()
        .is_some_and(|body| !body.enabled)
}

fn rigid_body_inverse_mass(world: &World, index: usize) -> f32 {
    world
        .rigid_bodies
        .get(index)
        .copied()
        .flatten()
        .map(sanitized_inverse_mass)
        .unwrap_or(0.0)
}

fn rigid_body_inverse_inertia(world: &World, index: usize) -> f32 {
    world
        .rigid_bodies
        .get(index)
        .copied()
        .flatten()
        .map(sanitized_inverse_inertia)
        .unwrap_or(0.0)
}

fn sanitized_inverse_mass(body: RigidBody) -> f32 {
    if !body.enabled
        || body.body_type != RigidBodyType::Dynamic
        || body.is_sleeping
        || !body.inverse_mass.is_finite()
        || body.inverse_mass <= 0.0
    {
        0.0
    } else {
        body.inverse_mass
    }
}

fn sanitized_inverse_inertia(body: RigidBody) -> f32 {
    if !body.enabled
        || body.body_type != RigidBodyType::Dynamic
        || body.is_sleeping
        || !body.inverse_inertia.is_finite()
        || body.inverse_inertia <= 0.0
    {
        0.0
    } else {
        body.inverse_inertia
    }
}

fn contact_material_for_collider(world: &World, key: ColliderKey) -> PhysicsMaterial {
    world
        .compound_collider_at(key.entity_index, key.collider_index)
        .and_then(|collider| collider.material)
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

fn sanitize_physics_material(material: PhysicsMaterial) -> PhysicsMaterial {
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

fn contact_surface_velocity(
    material_a: PhysicsMaterial,
    material_b: PhysicsMaterial,
    tangent: Velocity,
) -> f32 {
    dot_velocity(
        Velocity {
            vx: material_a.surface_velocity.vx - material_b.surface_velocity.vx,
            vy: material_a.surface_velocity.vy - material_b.surface_velocity.vy,
        },
        tangent,
    )
}

fn sanitized_gravity_scale(body: RigidBody) -> f32 {
    if body.gravity_scale.is_finite() {
        body.gravity_scale
    } else {
        1.0
    }
}

fn sanitized_linear_damping(body: RigidBody) -> f32 {
    sanitize_non_negative(body.linear_damping)
}

fn sanitized_angular_damping(body: RigidBody) -> f32 {
    sanitize_non_negative(body.angular_damping)
}

fn dot_velocity(a: Velocity, b: Velocity) -> f32 {
    a.vx * b.vx + a.vy * b.vy
}

fn revolute_joint_world_radius(
    world: &World,
    index: usize,
    local_anchor_x: f32,
    local_anchor_y: f32,
) -> Velocity {
    let rotation = world
        .rotations
        .get(index)
        .copied()
        .flatten()
        .map(finite_rotation)
        .unwrap_or_default();
    rotate_velocity(
        Velocity {
            vx: sanitize_finite(local_anchor_x),
            vy: sanitize_finite(local_anchor_y),
        },
        rotation.radians,
    )
}

fn prismatic_joint_world_axis(
    world: &World,
    index: usize,
    local_axis_x: f32,
    local_axis_y: f32,
) -> Velocity {
    let local_axis = normalized_prismatic_joint_axis(local_axis_x, local_axis_y);
    let rotation = world
        .rotations
        .get(index)
        .copied()
        .flatten()
        .map(finite_rotation)
        .unwrap_or_default();
    let axis = rotate_velocity(local_axis, rotation.radians);
    normalized_prismatic_joint_axis(axis.vx, axis.vy)
}

fn normalized_prismatic_joint_axis(axis_x: f32, axis_y: f32) -> Velocity {
    let axis = Velocity {
        vx: sanitize_finite(axis_x),
        vy: sanitize_finite(axis_y),
    };
    let length_squared = velocity_len_squared(axis);
    if length_squared <= KINEMATIC_EPSILON * KINEMATIC_EPSILON {
        return Velocity { vx: 1.0, vy: 0.0 };
    }

    let length = length_squared.sqrt();
    Velocity {
        vx: axis.vx / length,
        vy: axis.vy / length,
    }
}

fn prismatic_joint_translation_limits(joint: PrismaticJoint) -> Option<(f32, f32)> {
    if !joint.limit_enabled {
        return None;
    }

    let lower_translation = sanitize_finite(joint.lower_translation);
    let upper_translation = sanitize_finite(joint.upper_translation);
    if lower_translation <= upper_translation {
        Some((lower_translation, upper_translation))
    } else {
        Some((upper_translation, lower_translation))
    }
}

fn revolute_joint_angle_limits(joint: RevoluteJoint) -> Option<(f32, f32)> {
    if !joint.limit_enabled {
        return None;
    }

    let lower_angle = normalize_angle_radians(joint.lower_angle);
    let upper_angle = normalize_angle_radians(joint.upper_angle);
    if lower_angle <= upper_angle {
        Some((lower_angle, upper_angle))
    } else {
        Some((upper_angle, lower_angle))
    }
}

fn revolute_joint_limit_error(
    context: RevoluteJointConstraintContext,
    joint: RevoluteJoint,
) -> Option<f32> {
    let (lower_angle, upper_angle) = revolute_joint_angle_limits(joint)?;
    if context.relative_angle < lower_angle {
        Some(context.relative_angle - lower_angle)
    } else if context.relative_angle > upper_angle {
        Some(context.relative_angle - upper_angle)
    } else {
        None
    }
}

fn revolute_joint_motor_config(
    context: RevoluteJointConstraintContext,
    joint: RevoluteJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> Option<(f32, f32)> {
    if !joint.motor_enabled || delta_seconds <= 0.0 || velocity_iterations == 0 {
        return None;
    }

    let motor_speed = sanitize_finite(joint.motor_speed);
    let max_motor_torque = sanitize_non_negative(joint.max_motor_torque);
    if max_motor_torque <= 0.0 || !revolute_joint_motor_allows_velocity(context, joint, motor_speed)
    {
        return None;
    }

    Some((motor_speed, max_motor_torque))
}

fn revolute_joint_motor_allows_velocity(
    context: RevoluteJointConstraintContext,
    joint: RevoluteJoint,
    motor_speed: f32,
) -> bool {
    let Some((lower_angle, upper_angle)) = revolute_joint_angle_limits(joint) else {
        return true;
    };
    if motor_speed > 0.0 && context.relative_angle >= upper_angle - KINEMATIC_EPSILON {
        return false;
    }
    if motor_speed < 0.0 && context.relative_angle <= lower_angle + KINEMATIC_EPSILON {
        return false;
    }
    true
}

fn prismatic_joint_limit_error(
    context: PrismaticJointConstraintContext,
    joint: PrismaticJoint,
) -> Option<f32> {
    let (lower_translation, upper_translation) = prismatic_joint_translation_limits(joint)?;
    if context.translation < lower_translation {
        Some(context.translation - lower_translation)
    } else if context.translation > upper_translation {
        Some(context.translation - upper_translation)
    } else {
        None
    }
}

fn prismatic_joint_motor_config(
    context: PrismaticJointConstraintContext,
    joint: PrismaticJoint,
    delta_seconds: f32,
    velocity_iterations: u32,
) -> Option<(f32, f32)> {
    if !joint.motor_enabled || delta_seconds <= 0.0 || velocity_iterations == 0 {
        return None;
    }

    let motor_speed = sanitize_finite(joint.motor_speed);
    let max_motor_force = sanitize_non_negative(joint.max_motor_force);
    if max_motor_force <= 0.0 || !prismatic_joint_motor_allows_velocity(context, joint, motor_speed)
    {
        return None;
    }

    Some((motor_speed, max_motor_force))
}

fn prismatic_joint_motor_allows_velocity(
    context: PrismaticJointConstraintContext,
    joint: PrismaticJoint,
    motor_speed: f32,
) -> bool {
    let Some((lower_translation, upper_translation)) = prismatic_joint_translation_limits(joint)
    else {
        return true;
    };
    if motor_speed > 0.0 && context.translation >= upper_translation - KINEMATIC_EPSILON {
        return false;
    }
    if motor_speed < 0.0 && context.translation <= lower_translation + KINEMATIC_EPSILON {
        return false;
    }
    true
}

fn normalize_angle_radians(radians: f32) -> f32 {
    const PI: f32 = std::f32::consts::PI;
    const TAU: f32 = std::f32::consts::PI * 2.0;
    (sanitize_finite(radians) + PI).rem_euclid(TAU) - PI
}

fn rotate_velocity(velocity: Velocity, radians: f32) -> Velocity {
    let radians = sanitize_finite(radians);
    let (sin, cos) = radians.sin_cos();
    Velocity {
        vx: velocity.vx * cos - velocity.vy * sin,
        vy: velocity.vx * sin + velocity.vy * cos,
    }
}

fn revolute_joint_axis_denominator(
    context: &RevoluteJointConstraintContext,
    axis: Velocity,
) -> f32 {
    let radius_a_cross_axis = cross_velocity(context.radius_a, axis);
    let radius_b_cross_axis = cross_velocity(context.radius_b, axis);
    context.inverse_mass_a
        + context.inverse_mass_b
        + context.inverse_inertia_a * radius_a_cross_axis * radius_a_cross_axis
        + context.inverse_inertia_b * radius_b_cross_axis * radius_b_cross_axis
}

fn revolute_joint_angular_denominator(context: &RevoluteJointConstraintContext) -> f32 {
    context.inverse_inertia_a + context.inverse_inertia_b
}

fn prismatic_joint_axis_denominator(
    context: &PrismaticJointConstraintContext,
    axis: Velocity,
) -> f32 {
    let radius_a_cross_axis = cross_velocity(context.radius_a, axis);
    let radius_b_cross_axis = cross_velocity(context.radius_b, axis);
    context.inverse_mass_a
        + context.inverse_mass_b
        + context.inverse_inertia_a * radius_a_cross_axis * radius_a_cross_axis
        + context.inverse_inertia_b * radius_b_cross_axis * radius_b_cross_axis
}

fn gear_joint_angular_denominator(context: GearJointConstraintContext) -> f32 {
    context.inverse_inertia_a * context.ratio * context.ratio + context.inverse_inertia_b
}

fn relative_anchor_velocity(world: &World, context: RevoluteJointConstraintContext) -> Velocity {
    let velocity_a = anchor_velocity(world, context.a_index, context.anchor_a);
    let velocity_b = anchor_velocity(world, context.b_index, context.anchor_b);
    Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    }
}

fn prismatic_joint_relative_anchor_velocity(
    world: &World,
    context: PrismaticJointConstraintContext,
) -> Velocity {
    let velocity_a = anchor_velocity(world, context.a_index, context.anchor_a);
    let velocity_b = anchor_velocity(world, context.b_index, context.anchor_b);
    Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    }
}

fn revolute_joint_relative_angular_velocity(
    world: &World,
    context: RevoluteJointConstraintContext,
) -> f32 {
    let angular_velocity_a = world
        .angular_velocities
        .get(context.a_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    let angular_velocity_b = world
        .angular_velocities
        .get(context.b_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    angular_velocity_b.radians_per_second - angular_velocity_a.radians_per_second
}

fn prismatic_joint_relative_angular_velocity(
    world: &World,
    context: PrismaticJointConstraintContext,
) -> f32 {
    let angular_velocity_a = world
        .angular_velocities
        .get(context.a_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    let angular_velocity_b = world
        .angular_velocities
        .get(context.b_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    angular_velocity_b.radians_per_second - angular_velocity_a.radians_per_second
}

fn gear_joint_relative_angular_velocity(world: &World, context: GearJointConstraintContext) -> f32 {
    let angular_velocity_a = world
        .angular_velocities
        .get(context.a_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    let angular_velocity_b = world
        .angular_velocities
        .get(context.b_index)
        .copied()
        .flatten()
        .map(finite_angular_velocity)
        .unwrap_or_default();
    angular_velocity_b.radians_per_second + context.ratio * angular_velocity_a.radians_per_second
}

fn anchor_velocity(world: &World, index: usize, anchor: Transform2D) -> Velocity {
    contact_point_velocity(world, index, anchor)
}

fn contact_constraint_tangent(normal: Velocity) -> Velocity {
    Velocity {
        vx: -normal.vy,
        vy: normal.vx,
    }
}

fn relative_contact_velocity(
    world: &World,
    a_index: usize,
    b_index: usize,
    point: Transform2D,
) -> Velocity {
    let velocity_a = contact_point_velocity(world, a_index, point);
    let velocity_b = contact_point_velocity(world, b_index, point);
    Velocity {
        vx: velocity_b.vx - velocity_a.vx,
        vy: velocity_b.vy - velocity_a.vy,
    }
}

fn contact_point_velocity(world: &World, index: usize, point: Transform2D) -> Velocity {
    let linear_velocity = finite_velocity(world.velocities[index].unwrap_or_default());
    let angular_velocity = finite_angular_velocity(
        world
            .angular_velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    )
    .radians_per_second;
    let transform = world
        .transforms
        .get(index)
        .copied()
        .flatten()
        .unwrap_or_default();
    let radius = Velocity {
        vx: point.x - transform.x,
        vy: point.y - transform.y,
    };
    let angular_velocity_at_point = cross_scalar_velocity(angular_velocity, radius);
    Velocity {
        vx: linear_velocity.vx + angular_velocity_at_point.vx,
        vy: linear_velocity.vy + angular_velocity_at_point.vy,
    }
}

impl RigidSplitImpulseState {
    fn from_world(world: &World) -> Self {
        Self {
            linear_velocities: vec![Velocity::default(); world.transforms.len()],
            angular_velocities: vec![0.0; world.transforms.len()],
        }
    }

    fn relative_contact_velocity(
        &self,
        world: &World,
        a_index: usize,
        b_index: usize,
        point: Transform2D,
    ) -> Velocity {
        let velocity_a = self.contact_point_velocity(world, a_index, point);
        let velocity_b = self.contact_point_velocity(world, b_index, point);
        Velocity {
            vx: velocity_b.vx - velocity_a.vx,
            vy: velocity_b.vy - velocity_a.vy,
        }
    }

    fn contact_point_velocity(&self, world: &World, index: usize, point: Transform2D) -> Velocity {
        let linear_velocity = self
            .linear_velocities
            .get(index)
            .copied()
            .unwrap_or_default();
        let angular_velocity = self.angular_velocities.get(index).copied().unwrap_or(0.0);
        let radius = contact_radius(world, index, point);
        let angular_velocity_at_point = cross_scalar_velocity(angular_velocity, radius);
        Velocity {
            vx: linear_velocity.vx + angular_velocity_at_point.vx,
            vy: linear_velocity.vy + angular_velocity_at_point.vy,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_contact_impulse_at_point(
        &mut self,
        world: &World,
        a_index: usize,
        b_index: usize,
        point: Transform2D,
        impulse: Velocity,
        inverse_mass_a: f32,
        inverse_mass_b: f32,
        inverse_inertia_a: f32,
        inverse_inertia_b: f32,
    ) {
        if inverse_mass_a > 0.0 {
            if let Some(velocity) = self.linear_velocities.get_mut(a_index) {
                velocity.vx -= impulse.vx * inverse_mass_a;
                velocity.vy -= impulse.vy * inverse_mass_a;
                *velocity = finite_velocity(*velocity);
            }
        }
        if inverse_mass_b > 0.0 {
            if let Some(velocity) = self.linear_velocities.get_mut(b_index) {
                velocity.vx += impulse.vx * inverse_mass_b;
                velocity.vy += impulse.vy * inverse_mass_b;
                *velocity = finite_velocity(*velocity);
            }
        }

        let radius_a = contact_radius(world, a_index, point);
        let radius_b = contact_radius(world, b_index, point);
        if inverse_inertia_a > 0.0 {
            if let Some(angular_velocity) = self.angular_velocities.get_mut(a_index) {
                *angular_velocity = sanitize_finite(
                    *angular_velocity - cross_velocity(radius_a, impulse) * inverse_inertia_a,
                );
            }
        }
        if inverse_inertia_b > 0.0 {
            if let Some(angular_velocity) = self.angular_velocities.get_mut(b_index) {
                *angular_velocity = sanitize_finite(
                    *angular_velocity + cross_velocity(radius_b, impulse) * inverse_inertia_b,
                );
            }
        }
    }

    fn apply_to_world(self, world: &mut World, delta_seconds: f32) {
        if !delta_seconds.is_finite() || delta_seconds <= 0.0 {
            return;
        }

        for (index, split_velocity) in self.linear_velocities.into_iter().enumerate() {
            if velocity_len_squared(split_velocity)
                > CONTACT_IMPULSE_EPSILON * CONTACT_IMPULSE_EPSILON
            {
                if let Some(transform) = world.transforms.get_mut(index).and_then(Option::as_mut) {
                    *transform = finite_transform(Transform2D {
                        x: transform.x + split_velocity.vx * delta_seconds,
                        y: transform.y + split_velocity.vy * delta_seconds,
                    });
                }
            }
        }

        for (index, split_angular_velocity) in self.angular_velocities.into_iter().enumerate() {
            if split_angular_velocity.abs() > CONTACT_IMPULSE_EPSILON {
                let rotation = world.rotations[index].get_or_insert_with(Rotation2D::default);
                rotation.radians = finite_rotation(Rotation2D {
                    radians: rotation.radians + split_angular_velocity * delta_seconds,
                })
                .radians;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn contact_impulse_denominator(
    world: &World,
    a_index: usize,
    b_index: usize,
    point: Transform2D,
    direction: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
    inverse_inertia_a: f32,
    inverse_inertia_b: f32,
) -> f32 {
    let radius_a = contact_radius(world, a_index, point);
    let radius_b = contact_radius(world, b_index, point);
    let radius_a_cross_direction = cross_velocity(radius_a, direction);
    let radius_b_cross_direction = cross_velocity(radius_b, direction);
    inverse_mass_a
        + inverse_mass_b
        + inverse_inertia_a * radius_a_cross_direction * radius_a_cross_direction
        + inverse_inertia_b * radius_b_cross_direction * radius_b_cross_direction
}

fn contact_radius(world: &World, index: usize, point: Transform2D) -> Velocity {
    let transform = world
        .transforms
        .get(index)
        .copied()
        .flatten()
        .unwrap_or_default();
    Velocity {
        vx: point.x - transform.x,
        vy: point.y - transform.y,
    }
}

fn cross_velocity(a: Velocity, b: Velocity) -> f32 {
    a.vx * b.vy - a.vy * b.vx
}

fn cross_scalar_velocity(scalar: f32, velocity: Velocity) -> Velocity {
    Velocity {
        vx: -scalar * velocity.vy,
        vy: scalar * velocity.vx,
    }
}

fn apply_contact_impulse(
    world: &mut World,
    a_index: usize,
    b_index: usize,
    impulse: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
) {
    if inverse_mass_a > 0.0 {
        let mut velocity = world.velocities[a_index].unwrap_or_default();
        velocity.vx -= impulse.vx * inverse_mass_a;
        velocity.vy -= impulse.vy * inverse_mass_a;
        world.velocities[a_index] = Some(finite_velocity(velocity));
    }
    if inverse_mass_b > 0.0 {
        let mut velocity = world.velocities[b_index].unwrap_or_default();
        velocity.vx += impulse.vx * inverse_mass_b;
        velocity.vy += impulse.vy * inverse_mass_b;
        world.velocities[b_index] = Some(finite_velocity(velocity));
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_contact_impulse_at_point(
    world: &mut World,
    a_index: usize,
    b_index: usize,
    point: Transform2D,
    impulse: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
    inverse_inertia_a: f32,
    inverse_inertia_b: f32,
) {
    apply_contact_impulse(
        world,
        a_index,
        b_index,
        impulse,
        inverse_mass_a,
        inverse_mass_b,
    );
    let radius_a = contact_radius(world, a_index, point);
    let radius_b = contact_radius(world, b_index, point);
    if inverse_inertia_a > 0.0 {
        let mut angular_velocity = world.angular_velocities[a_index].unwrap_or_default();
        angular_velocity.radians_per_second -=
            cross_velocity(radius_a, impulse) * inverse_inertia_a;
        world.angular_velocities[a_index] = Some(finite_angular_velocity(angular_velocity));
    }
    if inverse_inertia_b > 0.0 {
        let mut angular_velocity = world.angular_velocities[b_index].unwrap_or_default();
        angular_velocity.radians_per_second +=
            cross_velocity(radius_b, impulse) * inverse_inertia_b;
        world.angular_velocities[b_index] = Some(finite_angular_velocity(angular_velocity));
    }
}

#[allow(clippy::too_many_arguments)]
fn apply_contact_position_impulse_at_point(
    world: &mut World,
    a_index: usize,
    b_index: usize,
    point: Transform2D,
    impulse: Velocity,
    inverse_mass_a: f32,
    inverse_mass_b: f32,
    inverse_inertia_a: f32,
    inverse_inertia_b: f32,
) {
    let radius_a = contact_radius(world, a_index, point);
    let radius_b = contact_radius(world, b_index, point);
    if inverse_mass_a > 0.0 {
        if let Some(transform) = world.transforms[a_index].as_mut() {
            *transform = finite_transform(Transform2D {
                x: transform.x - impulse.vx * inverse_mass_a,
                y: transform.y - impulse.vy * inverse_mass_a,
            });
        }
    }
    if inverse_mass_b > 0.0 {
        if let Some(transform) = world.transforms[b_index].as_mut() {
            *transform = finite_transform(Transform2D {
                x: transform.x + impulse.vx * inverse_mass_b,
                y: transform.y + impulse.vy * inverse_mass_b,
            });
        }
    }
    if inverse_inertia_a > 0.0 {
        let rotation = world.rotations[a_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians - cross_velocity(radius_a, impulse) * inverse_inertia_a,
        })
        .radians;
    }
    if inverse_inertia_b > 0.0 {
        let rotation = world.rotations[b_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians + cross_velocity(radius_b, impulse) * inverse_inertia_b,
        })
        .radians;
    }
}

fn apply_revolute_joint_anchor_impulse(
    world: &mut World,
    context: RevoluteJointConstraintContext,
    impulse: Velocity,
) {
    apply_contact_impulse(
        world,
        context.a_index,
        context.b_index,
        impulse,
        context.inverse_mass_a,
        context.inverse_mass_b,
    );
    if context.inverse_inertia_a > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.a_index].unwrap_or_default();
        angular_velocity.radians_per_second -=
            cross_velocity(context.radius_a, impulse) * context.inverse_inertia_a;
        world.angular_velocities[context.a_index] = Some(finite_angular_velocity(angular_velocity));
    }
    if context.inverse_inertia_b > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.b_index].unwrap_or_default();
        angular_velocity.radians_per_second +=
            cross_velocity(context.radius_b, impulse) * context.inverse_inertia_b;
        world.angular_velocities[context.b_index] = Some(finite_angular_velocity(angular_velocity));
    }
}

fn apply_pulley_joint_anchor_impulse(
    world: &mut World,
    context: PulleyJointConstraintContext,
    impulse_magnitude: f32,
) {
    let impulse_a = Velocity {
        vx: context.normal_a.vx * impulse_magnitude,
        vy: context.normal_a.vy * impulse_magnitude,
    };
    let impulse_b = Velocity {
        vx: context.normal_b.vx * impulse_magnitude * context.ratio,
        vy: context.normal_b.vy * impulse_magnitude * context.ratio,
    };
    apply_single_body_anchor_impulse(
        world,
        context.a_index,
        context.radius_a,
        impulse_a,
        context.inverse_mass_a,
        context.inverse_inertia_a,
    );
    apply_single_body_anchor_impulse(
        world,
        context.b_index,
        context.radius_b,
        impulse_b,
        context.inverse_mass_b,
        context.inverse_inertia_b,
    );
}

fn apply_single_body_anchor_impulse(
    world: &mut World,
    index: usize,
    radius: Velocity,
    impulse: Velocity,
    inverse_mass: f32,
    inverse_inertia: f32,
) {
    if inverse_mass > 0.0 {
        let mut velocity = world.velocities[index].unwrap_or_default();
        velocity.vx += impulse.vx * inverse_mass;
        velocity.vy += impulse.vy * inverse_mass;
        world.velocities[index] = Some(finite_velocity(velocity));
    }
    if inverse_inertia > 0.0 {
        let mut angular_velocity = world.angular_velocities[index].unwrap_or_default();
        angular_velocity.radians_per_second += cross_velocity(radius, impulse) * inverse_inertia;
        world.angular_velocities[index] = Some(finite_angular_velocity(angular_velocity));
    }
}

fn apply_revolute_joint_angular_impulse(
    world: &mut World,
    context: RevoluteJointConstraintContext,
    angular_impulse: f32,
) {
    if context.inverse_inertia_a > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.a_index].unwrap_or_default();
        angular_velocity.radians_per_second -= angular_impulse * context.inverse_inertia_a;
        world.angular_velocities[context.a_index] = Some(finite_angular_velocity(angular_velocity));
    }
    if context.inverse_inertia_b > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.b_index].unwrap_or_default();
        angular_velocity.radians_per_second += angular_impulse * context.inverse_inertia_b;
        world.angular_velocities[context.b_index] = Some(finite_angular_velocity(angular_velocity));
    }
}

fn apply_prismatic_joint_anchor_impulse(
    world: &mut World,
    context: PrismaticJointConstraintContext,
    impulse: Velocity,
) {
    apply_contact_impulse(
        world,
        context.a_index,
        context.b_index,
        impulse,
        context.inverse_mass_a,
        context.inverse_mass_b,
    );
    if context.inverse_inertia_a > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.a_index].unwrap_or_default();
        angular_velocity.radians_per_second -=
            cross_velocity(context.radius_a, impulse) * context.inverse_inertia_a;
        world.angular_velocities[context.a_index] = Some(finite_angular_velocity(angular_velocity));
    }
    if context.inverse_inertia_b > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.b_index].unwrap_or_default();
        angular_velocity.radians_per_second +=
            cross_velocity(context.radius_b, impulse) * context.inverse_inertia_b;
        world.angular_velocities[context.b_index] = Some(finite_angular_velocity(angular_velocity));
    }
}

fn apply_prismatic_joint_angular_impulse(
    world: &mut World,
    context: PrismaticJointConstraintContext,
    angular_impulse: f32,
) {
    if context.inverse_inertia_a > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.a_index].unwrap_or_default();
        angular_velocity.radians_per_second -= angular_impulse * context.inverse_inertia_a;
        world.angular_velocities[context.a_index] = Some(finite_angular_velocity(angular_velocity));
    }
    if context.inverse_inertia_b > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.b_index].unwrap_or_default();
        angular_velocity.radians_per_second += angular_impulse * context.inverse_inertia_b;
        world.angular_velocities[context.b_index] = Some(finite_angular_velocity(angular_velocity));
    }
}

fn apply_gear_joint_angular_impulse(
    world: &mut World,
    context: GearJointConstraintContext,
    angular_impulse: f32,
) {
    if context.inverse_inertia_a > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.a_index].unwrap_or_default();
        angular_velocity.radians_per_second +=
            angular_impulse * context.ratio * context.inverse_inertia_a;
        world.angular_velocities[context.a_index] = Some(finite_angular_velocity(angular_velocity));
    }
    if context.inverse_inertia_b > 0.0 {
        let mut angular_velocity = world.angular_velocities[context.b_index].unwrap_or_default();
        angular_velocity.radians_per_second += angular_impulse * context.inverse_inertia_b;
        world.angular_velocities[context.b_index] = Some(finite_angular_velocity(angular_velocity));
    }
}

fn apply_revolute_joint_anchor_position_correction(
    world: &mut World,
    context: RevoluteJointConstraintContext,
    impulse: Velocity,
) {
    if context.inverse_mass_a > 0.0 {
        if let Some(transform) = world.transforms[context.a_index].as_mut() {
            transform.x -= impulse.vx * context.inverse_mass_a;
            transform.y -= impulse.vy * context.inverse_mass_a;
        }
    }
    if context.inverse_mass_b > 0.0 {
        if let Some(transform) = world.transforms[context.b_index].as_mut() {
            transform.x += impulse.vx * context.inverse_mass_b;
            transform.y += impulse.vy * context.inverse_mass_b;
        }
    }
    if context.inverse_inertia_a > 0.0 {
        let rotation = world.rotations[context.a_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians
                - cross_velocity(context.radius_a, impulse) * context.inverse_inertia_a,
        })
        .radians;
    }
    if context.inverse_inertia_b > 0.0 {
        let rotation = world.rotations[context.b_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians
                + cross_velocity(context.radius_b, impulse) * context.inverse_inertia_b,
        })
        .radians;
    }
}

fn apply_pulley_joint_anchor_position_correction(
    world: &mut World,
    context: PulleyJointConstraintContext,
    impulse_magnitude: f32,
) {
    let impulse_a = Velocity {
        vx: context.normal_a.vx * impulse_magnitude,
        vy: context.normal_a.vy * impulse_magnitude,
    };
    let impulse_b = Velocity {
        vx: context.normal_b.vx * impulse_magnitude * context.ratio,
        vy: context.normal_b.vy * impulse_magnitude * context.ratio,
    };
    apply_single_body_anchor_position_correction(
        world,
        context.a_index,
        context.radius_a,
        impulse_a,
        context.inverse_mass_a,
        context.inverse_inertia_a,
    );
    apply_single_body_anchor_position_correction(
        world,
        context.b_index,
        context.radius_b,
        impulse_b,
        context.inverse_mass_b,
        context.inverse_inertia_b,
    );
}

fn apply_single_body_anchor_position_correction(
    world: &mut World,
    index: usize,
    radius: Velocity,
    impulse: Velocity,
    inverse_mass: f32,
    inverse_inertia: f32,
) {
    if inverse_mass > 0.0 {
        if let Some(transform) = world.transforms[index].as_mut() {
            *transform = finite_transform(Transform2D {
                x: transform.x + impulse.vx * inverse_mass,
                y: transform.y + impulse.vy * inverse_mass,
            });
        }
    }
    if inverse_inertia > 0.0 {
        let rotation = world.rotations[index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians + cross_velocity(radius, impulse) * inverse_inertia,
        })
        .radians;
    }
}

fn apply_revolute_joint_angular_position_correction(
    world: &mut World,
    context: RevoluteJointConstraintContext,
    angular_impulse: f32,
) {
    if context.inverse_inertia_a > 0.0 {
        let rotation = world.rotations[context.a_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians - angular_impulse * context.inverse_inertia_a,
        })
        .radians;
    }
    if context.inverse_inertia_b > 0.0 {
        let rotation = world.rotations[context.b_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians + angular_impulse * context.inverse_inertia_b,
        })
        .radians;
    }
}

fn apply_prismatic_joint_anchor_position_correction(
    world: &mut World,
    context: PrismaticJointConstraintContext,
    impulse: Velocity,
) {
    if context.inverse_mass_a > 0.0 {
        if let Some(transform) = world.transforms[context.a_index].as_mut() {
            transform.x -= impulse.vx * context.inverse_mass_a;
            transform.y -= impulse.vy * context.inverse_mass_a;
        }
    }
    if context.inverse_mass_b > 0.0 {
        if let Some(transform) = world.transforms[context.b_index].as_mut() {
            transform.x += impulse.vx * context.inverse_mass_b;
            transform.y += impulse.vy * context.inverse_mass_b;
        }
    }
    if context.inverse_inertia_a > 0.0 {
        let rotation = world.rotations[context.a_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians
                - cross_velocity(context.radius_a, impulse) * context.inverse_inertia_a,
        })
        .radians;
    }
    if context.inverse_inertia_b > 0.0 {
        let rotation = world.rotations[context.b_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians
                + cross_velocity(context.radius_b, impulse) * context.inverse_inertia_b,
        })
        .radians;
    }
}

fn apply_prismatic_joint_angular_position_correction(
    world: &mut World,
    context: PrismaticJointConstraintContext,
    angular_impulse: f32,
) {
    if context.inverse_inertia_a > 0.0 {
        let rotation = world.rotations[context.a_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians - angular_impulse * context.inverse_inertia_a,
        })
        .radians;
    }
    if context.inverse_inertia_b > 0.0 {
        let rotation = world.rotations[context.b_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians + angular_impulse * context.inverse_inertia_b,
        })
        .radians;
    }
}

fn apply_gear_joint_angular_position_correction(
    world: &mut World,
    context: GearJointConstraintContext,
    angular_impulse: f32,
) {
    if context.inverse_inertia_a > 0.0 {
        let rotation = world.rotations[context.a_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians + angular_impulse * context.ratio * context.inverse_inertia_a,
        })
        .radians;
    }
    if context.inverse_inertia_b > 0.0 {
        let rotation = world.rotations[context.b_index].get_or_insert_with(Rotation2D::default);
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians + angular_impulse * context.inverse_inertia_b,
        })
        .radians;
    }
}

fn solid_filter_allows(
    world: &World,
    moving_index: usize,
    target_index: usize,
    solid_mask: CollisionMask,
) -> bool {
    let Some(target_filter) = world.collision_filter_at(target_index) else {
        return false;
    };
    if !target_filter.category.intersects(solid_mask) {
        return false;
    }
    let Some(moving_filter) = world.collision_filter_at(moving_index) else {
        return false;
    };
    moving_filter.can_collide_with(target_filter)
}

fn is_one_way_platform_candidate(
    world: &World,
    target_index: usize,
    one_way_platforms: OneWayPlatformConfig,
) -> bool {
    one_way_platforms.is_enabled()
        && world
            .collision_filter_at(target_index)
            .is_some_and(|filter| filter.category.intersects(one_way_platforms.platform_mask))
}

fn one_way_platform_contact_blocks(
    position: Transform2D,
    collider: AabbCollider,
    remaining: Velocity,
    target_transform: Transform2D,
    target_collider: AabbCollider,
    contact: SweptAabbContactHit,
) -> bool {
    if remaining.vy <= KINEMATIC_EPSILON || !is_ground_normal(contact.normal_y) {
        return false;
    }
    let mover_bottom = collider.center(position).y + collider.half_height;
    let platform_top = target_collider.center(target_transform).y - target_collider.half_height;
    mover_bottom <= platform_top + KINEMATIC_EPSILON
}

fn finite_velocity(velocity: Velocity) -> Velocity {
    Velocity {
        vx: if velocity.vx.is_finite() {
            velocity.vx
        } else {
            0.0
        },
        vy: if velocity.vy.is_finite() {
            velocity.vy
        } else {
            0.0
        },
    }
}

fn finite_transform(transform: Transform2D) -> Transform2D {
    Transform2D {
        x: if transform.x.is_finite() {
            transform.x
        } else {
            0.0
        },
        y: if transform.y.is_finite() {
            transform.y
        } else {
            0.0
        },
    }
}

fn sanitize_finite(value: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

fn finite_angular_velocity(angular_velocity: AngularVelocity) -> AngularVelocity {
    AngularVelocity {
        radians_per_second: if angular_velocity.radians_per_second.is_finite() {
            angular_velocity.radians_per_second
        } else {
            0.0
        },
    }
}

fn finite_rotation(rotation: Rotation2D) -> Rotation2D {
    Rotation2D {
        radians: if rotation.radians.is_finite() {
            rotation.radians
        } else {
            0.0
        },
    }
}

fn velocity_len_squared(velocity: Velocity) -> f32 {
    velocity.vx * velocity.vx + velocity.vy * velocity.vy
}

fn is_valid_probe_distance(probe_distance: f32) -> bool {
    probe_distance.is_finite() && probe_distance > 0.0
}

fn sanitize_delta_seconds(delta_seconds: f32) -> f32 {
    if delta_seconds.is_finite() && delta_seconds > 0.0 {
        delta_seconds
    } else {
        0.0
    }
}

fn sanitize_horizontal_axis(horizontal_axis: f32) -> f32 {
    if horizontal_axis.is_finite() {
        horizontal_axis.clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

fn sanitize_non_negative(value: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        0.0
    }
}

fn sanitize_slope_config(slope: SlopeConfig) -> SlopeConfig {
    if !slope.max_climb_angle_radians.is_finite() || slope.max_climb_angle_radians < 0.0 {
        return SlopeConfig::disabled();
    }
    SlopeConfig {
        max_climb_angle_radians: slope.max_climb_angle_radians,
        snap_distance: sanitize_non_negative(slope.snap_distance),
        allow_downhill_snap: slope.allow_downhill_snap,
    }
}

fn is_slope_config_enabled(slope: SlopeConfig) -> bool {
    slope.max_climb_angle_radians.is_finite()
        && slope.max_climb_angle_radians >= 0.0
        && slope.snap_distance > 0.0
}

fn subtract_timer(value: f32, delta_seconds: f32) -> f32 {
    sanitize_non_negative(value - delta_seconds)
}

fn clear_controller_jump_timers(state: &mut Option<&mut PlatformerControllerState>) {
    if let Some(controller_state) = state {
        controller_state.coyote_time_remaining = 0.0;
        controller_state.jump_buffer_remaining = 0.0;
    }
}

fn sanitize_platformer_controller_config(
    config: PlatformerControllerConfig,
) -> PlatformerControllerConfig {
    PlatformerControllerConfig {
        horizontal_speed: sanitize_non_negative(config.horizontal_speed),
        gravity: sanitize_non_negative(config.gravity),
        jump_speed: sanitize_non_negative(config.jump_speed),
        max_fall_speed: if config.max_fall_speed.is_finite() && config.max_fall_speed > 0.0 {
            config.max_fall_speed
        } else {
            f32::MAX
        },
        ground_probe_distance: if is_valid_probe_distance(config.ground_probe_distance) {
            config.ground_probe_distance
        } else {
            KINEMATIC_EPSILON
        },
        step_offset: sanitize_non_negative(config.step_offset),
        coyote_time_seconds: sanitize_non_negative(config.coyote_time_seconds),
        jump_buffer_seconds: sanitize_non_negative(config.jump_buffer_seconds),
        slope: sanitize_slope_config(config.slope),
        solid_mask: config.solid_mask,
        one_way_platforms: config.one_way_platforms,
        max_iterations: config.max_iterations,
    }
}

fn is_ground_normal(normal_y: f32) -> bool {
    normal_y >= GROUND_NORMAL_Y_MIN
}

fn update_ground_probe_hit(best: &mut Option<GroundProbeHit>, next: GroundProbeHit) {
    if best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| ground_probe_source_key(next).cmp(&ground_probe_source_key(current)))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

fn ground_probe_source_key(hit: GroundProbeHit) -> (u8, u32, u32, usize, usize) {
    if let Some(entity) = hit.entity {
        (0, entity.id, entity.generation, usize::MAX, usize::MAX)
    } else {
        (
            1,
            u32::MAX,
            u32::MAX,
            hit.tile_layer_index.unwrap_or(usize::MAX),
            hit.tile_index.unwrap_or(usize::MAX),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{
        AngularVelocity, CapsuleCollider, CircleCollider, CollisionFilter, CollisionLayer,
        CompoundCollider, CompoundColliderShape, ConvexPolygonCollider, DistanceJoint,
        OrientedBoxCollider, PhysicsMaterial, PrismaticJoint, RevoluteJoint, RigidBody, RopeJoint,
        Rotation2D, SpringJoint, Transform2D, Velocity, MAX_CONVEX_POLYGON_VERTICES,
    };
    use crate::tilemap::Tilemap;

    #[test]
    fn slope_segment_samples_surface_height_and_normal() {
        let slope = SlopeSegment::new(0.0, 10.0, 10.0, 5.0);

        let hit = slope
            .surface_at_x(5.0)
            .expect("surface point inside segment should be sampled");

        assert_eq!(hit.x, 5.0);
        assert!((hit.y - 7.5).abs() < 0.001);
        assert!((hit.t - 0.5).abs() < 0.001);
        assert!((hit.normal_x - 0.447).abs() < 0.001);
        assert!((hit.normal_y - 0.894).abs() < 0.001);
        assert!((hit.angle_radians - 0.464).abs() < 0.001);

        let reversed = SlopeSegment::new(10.0, 5.0, 0.0, 10.0);
        let reversed_hit = reversed
            .surface_at_x(5.0)
            .expect("reversed segment should use the same surface range");

        assert!((reversed_hit.y - hit.y).abs() < 0.001);
        assert!((reversed_hit.normal_x - hit.normal_x).abs() < 0.001);
        assert!((reversed_hit.normal_y - hit.normal_y).abs() < 0.001);
        assert!((reversed_hit.t - 0.5).abs() < 0.001);
    }

    #[test]
    fn slope_segment_rejects_invalid_or_out_of_range_samples() {
        assert!(SlopeSegment::new(0.0, 0.0, 0.0, 10.0)
            .surface_at_x(0.0)
            .is_none());
        assert!(SlopeSegment::new(0.0, 0.0, 10.0, 0.0)
            .surface_at_x(-0.1)
            .is_none());
        assert!(SlopeSegment::new(0.0, 0.0, 10.0, 0.0)
            .surface_at_x(10.1)
            .is_none());
        assert!(SlopeSegment::new(0.0, f32::NAN, 10.0, 0.0)
            .surface_at_x(5.0)
            .is_none());
        assert!(SlopeSegment::new(0.0, 0.0, 10.0, 0.0)
            .surface_at_x(f32::NAN)
            .is_none());
    }

    #[test]
    fn slope_segment_walkable_uses_max_angle() {
        let flat = SlopeSegment::new(0.0, 10.0, 10.0, 10.0);
        let gentle = SlopeSegment::new(0.0, 10.0, 10.0, 5.0);
        let steep = SlopeSegment::new(0.0, 10.0, 1.0, 0.0);

        assert!(flat.is_walkable(0.0));
        assert!(gentle.is_walkable(0.5));
        assert!(!gentle.is_walkable(0.4));
        assert!(!steep.is_walkable(0.5));
        assert!(!gentle.is_walkable(-0.1));
        assert!(!gentle.is_walkable(f32::NAN));
        assert!(!SlopeSegment::new(0.0, 0.0, 0.0, 10.0).is_walkable(1.0));
    }

    #[test]
    fn integrate_applies_velocity_to_alive_entities() {
        let mut world = World::default();
        let moving = world.spawn_entity();
        let despawned = world.spawn_entity();
        world.transforms[moving.id as usize] = Some(Transform2D { x: 2.0, y: 4.0 });
        world.velocities[moving.id as usize] = Some(Velocity { vx: 10.0, vy: -6.0 });
        world.transforms[despawned.id as usize] = Some(Transform2D { x: 1.0, y: 1.0 });
        world.velocities[despawned.id as usize] = Some(Velocity {
            vx: 100.0,
            vy: 100.0,
        });
        world.despawn(despawned);

        PhysicsSystem::integrate(&mut world, 0.5);

        assert_eq!(
            world.transforms[moving.id as usize],
            Some(Transform2D { x: 7.0, y: 1.0 })
        );
        assert_eq!(world.transforms[despawned.id as usize], None);
    }

    #[test]
    fn clamp_entity_to_bounds_uses_collider_extents() {
        let mut world = World::default();
        let player = world.spawn_player(-20.0, 200.0, 0);

        PhysicsSystem::clamp_entity_to_bounds(
            &mut world,
            player,
            PhysicsBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 800.0,
                max_y: 480.0,
            },
        );

        let transform = world.transforms[player.id as usize].unwrap();
        assert_eq!(transform.x, 18.0);
        assert_eq!(transform.y, 200.0);
    }

    #[test]
    fn clamp_entity_to_bounds_respects_collider_offset() {
        let mut world = World::default();
        let player = world.spawn_player(-20.0, 200.0, 0);
        world.set_aabb_collider(
            player,
            AabbCollider::new(10.0, 10.0, true, CollisionLayer::Player).with_offset(5.0, 8.0),
        );

        PhysicsSystem::clamp_entity_to_bounds(
            &mut world,
            player,
            PhysicsBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 100.0,
                max_y: 100.0,
            },
        );

        let transform = world.transforms[player.id as usize].unwrap();
        assert_eq!(transform.x, 5.0);
        assert_eq!(transform.y, 82.0);
    }

    #[test]
    fn clamp_entity_to_small_bounds_uses_axis_center() {
        let mut world = World::default();
        let player = world.spawn_player(20.0, 30.0, 0);

        PhysicsSystem::clamp_entity_to_bounds(
            &mut world,
            player,
            PhysicsBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 10.0,
                max_y: 12.0,
            },
        );

        let transform = world.transforms[player.id as usize].unwrap();
        assert_eq!(transform.x, 5.0);
        assert_eq!(transform.y, 6.0);
    }

    #[test]
    fn fixed_timestep_accumulates_and_reports_alpha() {
        let mut timestep = FixedTimestep::new(FixedTimestepConfig {
            step_seconds: 0.1,
            max_frame_seconds: 1.0,
            max_steps_per_update: 4,
        });

        let update = timestep.advance(0.25);

        assert_eq!(update.steps, 2);
        assert!((update.consumed_seconds - 0.2).abs() < 0.001);
        assert!((update.alpha - 0.5).abs() < 0.001);
        assert!((timestep.accumulated_seconds() - 0.05).abs() < 0.001);
        assert_eq!(update.dropped_seconds, 0.0);
    }

    #[test]
    fn fixed_timestep_clamps_frame_delta_and_reports_drop() {
        let mut timestep = FixedTimestep::new(FixedTimestepConfig {
            step_seconds: 0.1,
            max_frame_seconds: 0.2,
            max_steps_per_update: 8,
        });

        let update = timestep.advance(1.0);

        assert_eq!(update.steps, 2);
        assert!((update.dropped_seconds - 0.8).abs() < 0.001);
        assert!(timestep.accumulated_seconds().abs() < 0.001);
    }

    #[test]
    fn fixed_timestep_drops_backlog_after_step_cap() {
        let mut timestep = FixedTimestep::new(FixedTimestepConfig {
            step_seconds: 0.1,
            max_frame_seconds: 1.0,
            max_steps_per_update: 3,
        });

        let update = timestep.advance(0.75);

        assert_eq!(update.steps, 3);
        assert!(update.dropped_seconds > 0.39);
        assert!(update.alpha < 1.0);
    }

    #[test]
    fn fixed_timestep_pause_discards_delta_without_backlog() {
        let mut timestep = FixedTimestep::new(FixedTimestepConfig {
            step_seconds: 0.1,
            max_frame_seconds: 1.0,
            max_steps_per_update: 4,
        });

        let first = timestep.advance(0.05);
        assert_eq!(first.steps, 0);
        assert!((first.alpha - 0.5).abs() < 0.001);
        assert!(!timestep.is_paused());

        timestep.pause();
        assert!(timestep.is_paused());
        let paused = timestep.advance(1.0);
        assert_eq!(paused.steps, 0);
        assert_eq!(paused.consumed_seconds, 0.0);
        assert_eq!(paused.dropped_seconds, 0.0);
        assert!((paused.alpha - 0.5).abs() < 0.001);
        assert!((timestep.accumulated_seconds() - 0.05).abs() < 0.001);

        timestep.resume();
        assert!(!timestep.is_paused());
        let resumed = timestep.advance(0.05);
        assert_eq!(resumed.steps, 1);
        assert!((timestep.accumulated_seconds()).abs() < 0.001);

        timestep.set_paused(true);
        assert!(timestep.is_paused());
        timestep.set_paused(false);
        assert!(!timestep.is_paused());
    }

    #[test]
    fn rigid_body_step_integrates_force_impulse_gravity_and_damping() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic(2.0)
                .with_gravity_scale(1.0)
                .with_linear_damping(0.5),
        );
        world.apply_force(body, Velocity { vx: 4.0, vy: 0.0 });
        world.apply_impulse(body, Velocity { vx: 2.0, vy: 0.0 });

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity { vx: 0.0, vy: 10.0 },
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.dynamic_bodies, 1);
        assert_eq!(world.velocity(body), Some(Velocity { vx: 1.5, vy: 5.0 }));
        assert_eq!(world.transform(body), Some(Transform2D { x: 1.5, y: 5.0 }));
        let body_component = world.rigid_body(body).unwrap();
        assert_eq!(body_component.force, Velocity::default());
        assert_eq!(body_component.impulse, Velocity::default());
    }

    #[test]
    fn rigid_body_substeps_apply_forces_across_substeps_and_impulses_once() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
        world.set_rigid_body(body, RigidBody::dynamic(2.0).with_sleeping_enabled(false));
        world.set_rotation(body, Rotation2D { radians: 0.0 });
        world.apply_force(body, Velocity { vx: 4.0, vy: 0.0 });
        world.apply_impulse(body, Velocity { vx: 2.0, vy: 0.0 });
        world.apply_torque(body, 4.0);
        world.apply_angular_impulse(body, 2.0);

        let stats = PhysicsSystem::step_rigid_bodies_substepped_with_config(
            &mut world,
            1.0,
            4,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.substeps, 4);
        assert_eq!(stats.dynamic_bodies, 4);
        assert_eq!(stats.angular_bodies, 4);
        assert_eq!(world.velocity(body), Some(Velocity { vx: 3.0, vy: 0.0 }));
        assert_eq!(
            world.angular_velocity(body),
            Some(AngularVelocity {
                radians_per_second: 3.0
            })
        );
        assert_eq!(world.transform(body), Some(Transform2D { x: 2.25, y: 0.0 }));
        assert_eq!(world.rotation(body), Some(Rotation2D { radians: 2.25 }));
        let body_component = world.rigid_body(body).unwrap();
        assert_eq!(body_component.force, Velocity::default());
        assert_eq!(body_component.impulse, Velocity::default());
        assert_eq!(body_component.torque, 0.0);
        assert_eq!(body_component.angular_impulse, 0.0);
    }

    #[test]
    fn rigid_body_substeps_clamp_invalid_and_large_counts() {
        let mut zero_world = World::default();
        let zero_body = spawn_dynamic_body(&mut zero_world, 0.0, 0.0, 2.0);
        zero_world.set_rigid_body(
            zero_body,
            RigidBody::dynamic(1.0)
                .with_gravity_scale(0.0)
                .with_sleeping_enabled(false),
        );
        zero_world.set_velocity(zero_body, Velocity { vx: 1.0, vy: 0.0 });

        let zero_stats = PhysicsSystem::step_rigid_bodies_substepped(&mut zero_world, 1.0, 0);

        assert_eq!(zero_stats.substeps, 1);
        assert_eq!(
            zero_world.transform(zero_body),
            Some(Transform2D { x: 1.0, y: 0.0 })
        );

        let mut large_world = World::default();
        let large_body = spawn_dynamic_body(&mut large_world, 0.0, 0.0, 2.0);
        large_world.set_rigid_body(
            large_body,
            RigidBody::dynamic(1.0)
                .with_gravity_scale(0.0)
                .with_sleeping_enabled(false),
        );
        large_world.set_velocity(large_body, Velocity { vx: 1.0, vy: 0.0 });

        let large_stats = PhysicsSystem::step_rigid_bodies_substepped(&mut large_world, 1.0, 99);

        assert_eq!(large_stats.substeps, MAX_RIGID_BODY_SUBSTEPS);
        assert_eq!(large_stats.dynamic_bodies, MAX_RIGID_BODY_SUBSTEPS);
        assert_eq!(
            large_world.transform(large_body),
            Some(Transform2D { x: 1.0, y: 0.0 })
        );
    }

    #[test]
    fn rigid_body_island_stats_reports_active_and_sleeping_islands() {
        let mut world = World::default();
        spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
        let sleeping = spawn_dynamic_body(&mut world, 40.0, 0.0, 2.0);
        let static_body = spawn_dynamic_body(&mut world, 80.0, 0.0, 2.0);
        let disabled = spawn_dynamic_body(&mut world, 120.0, 0.0, 2.0);

        let mut sleeping_body = RigidBody::dynamic(1.0);
        sleeping_body.is_sleeping = true;
        sleeping_body.sleep_timer_seconds = 0.5;
        world.set_rigid_body(sleeping, sleeping_body);
        world.set_rigid_body(static_body, RigidBody::static_body());
        world.set_rigid_body(disabled, RigidBody::dynamic(1.0).with_enabled(false));

        assert_eq!(
            PhysicsSystem::analyze_rigid_body_islands(&world),
            RigidBodyIslandStats {
                island_count: 2,
                island_bodies: 2,
                active_islands: 1,
                sleeping_islands: 1,
                largest_island_bodies: 1,
            }
        );
    }

    #[test]
    fn rigid_body_island_stats_unions_contacts_and_enabled_joints() {
        let mut world = World::default();
        spawn_dynamic_body(&mut world, 0.0, 0.0, 5.0);
        spawn_dynamic_body(&mut world, 8.0, 0.0, 5.0);
        let joint_a = spawn_dynamic_body(&mut world, 40.0, 0.0, 2.0);
        let joint_b = spawn_dynamic_body(&mut world, 70.0, 0.0, 2.0);
        spawn_dynamic_body(&mut world, 110.0, 0.0, 2.0);
        world.add_distance_joint(DistanceJoint::new(joint_a, joint_b, 30.0));

        assert_eq!(
            PhysicsSystem::analyze_rigid_body_islands(&world),
            RigidBodyIslandStats {
                island_count: 3,
                island_bodies: 5,
                active_islands: 3,
                sleeping_islands: 0,
                largest_island_bodies: 2,
            }
        );
    }

    #[test]
    fn rigid_body_island_schedule_groups_contacts_and_joints() {
        let mut world = World::default();
        let contact_a = spawn_dynamic_body(&mut world, 0.0, 0.0, 5.0);
        let contact_b = spawn_dynamic_body(&mut world, 8.0, 0.0, 5.0);
        let static_contact_body = spawn_dynamic_body(&mut world, 40.0, 0.0, 2.0);
        let static_wall = spawn_kinematic_body(&mut world, 43.0, 0.0, CollisionLayer::Wall, false);
        world.set_rigid_body(static_wall, RigidBody::static_body());
        let joint_a = spawn_dynamic_body(&mut world, 80.0, 0.0, 2.0);
        let joint_b = spawn_dynamic_body(&mut world, 90.0, 0.0, 2.0);
        let isolated = spawn_dynamic_body(&mut world, 130.0, 0.0, 2.0);
        world.add_distance_joint(DistanceJoint::new(joint_a, joint_b, 10.0));

        let constraints = build_rigid_contact_constraints(&world);
        let schedule = RigidBodyIslandSchedule::from_world_and_contacts(&world, &constraints);
        let contact_root = schedule
            .root_for_pair_indices(contact_a.id as usize, contact_b.id as usize)
            .expect("overlapping dynamic bodies should share a contact island");
        let static_contact_root = schedule
            .root_for_pair_indices(static_contact_body.id as usize, static_wall.id as usize)
            .expect("dynamic-static contact should use the dynamic body island");
        let joint_root = schedule
            .root_for_pair_indices(joint_a.id as usize, joint_b.id as usize)
            .expect("joint-connected dynamic bodies should share an island");
        let isolated_root = schedule
            .entity_root(isolated.id as usize)
            .expect("enabled isolated dynamic body should still have an island root");

        assert_eq!(schedule.roots.len(), 4);
        assert_ne!(contact_root, static_contact_root);
        assert_ne!(contact_root, joint_root);
        assert_ne!(contact_root, isolated_root);
        assert!(schedule.pair_in_island(
            CollisionPair {
                a: contact_a,
                b: contact_b,
            },
            contact_root,
        ));
        assert!(schedule.joint_in_island(joint_a, joint_b, joint_root));
        assert!(schedule.pair_in_island(
            CollisionPair {
                a: static_contact_body,
                b: static_wall,
            },
            static_contact_root,
        ));
        assert!(!schedule.pair_in_island(
            CollisionPair {
                a: contact_a,
                b: contact_b,
            },
            joint_root,
        ));
    }

    #[test]
    fn rigid_body_step_solves_contacts_and_joints_across_islands() {
        let mut world = World::default();
        let contact_body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            contact_body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            1.4,
            CollisionLayer::Wall,
            false,
            4.0,
            0.5,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let joint_a = spawn_dynamic_body(&mut world, 40.0, 0.0, 1.0);
        let joint_b = spawn_dynamic_body(&mut world, 46.0, 0.0, 1.0);
        world.set_rigid_body(joint_a, RigidBody::static_body());
        world.set_rigid_body(
            joint_b,
            RigidBody::dynamic(1.0).with_sleeping_enabled(false),
        );
        world.add_distance_joint(DistanceJoint::new(joint_a, joint_b, 2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let contact_velocity = world.velocity(contact_body).unwrap();
        let joint_transform = world.transform(joint_b).unwrap();
        assert_eq!(stats.island_count, 2);
        assert!(stats.velocity_impulses > 0);
        assert!(stats.constraint_position_corrections > 0);
        assert!(
            contact_velocity.vy < 0.0,
            "contact island should solve normal impulse, got {contact_velocity:?}"
        );
        assert!(
            joint_transform.x < 46.0,
            "joint island should solve position correction independently, got {joint_transform:?}"
        );
    }

    #[test]
    fn rigid_body_step_reports_final_island_stats() {
        let mut world = World::default();
        spawn_dynamic_body(&mut world, 0.0, 0.0, 5.0);
        spawn_dynamic_body(&mut world, 8.0, 0.0, 5.0);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0 / 60.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.island_count, 1);
        assert_eq!(stats.island_bodies, 2);
        assert_eq!(stats.active_islands, 1);
        assert_eq!(stats.sleeping_islands, 0);
        assert_eq!(stats.largest_island_bodies, 2);
    }

    #[test]
    fn disabled_rigid_body_skips_integration_and_clears_accumulators() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
        let mut rigid_body = RigidBody::dynamic(2.0).with_enabled(false);
        rigid_body.force = Velocity { vx: 4.0, vy: 0.0 };
        rigid_body.impulse = Velocity { vx: 2.0, vy: 0.0 };
        rigid_body.torque = 6.0;
        rigid_body.angular_impulse = 3.0;
        world.set_rigid_body(body, rigid_body);
        world.set_velocity(body, Velocity { vx: 3.0, vy: 4.0 });
        world.set_angular_velocity(
            body,
            AngularVelocity {
                radians_per_second: 2.0,
            },
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity { vx: 0.0, vy: 10.0 },
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.dynamic_bodies, 0);
        assert_eq!(stats.angular_bodies, 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 0.0 }));
        assert_eq!(world.velocity(body), Some(Velocity { vx: 3.0, vy: 4.0 }));
        assert_eq!(
            world.angular_velocity(body),
            Some(AngularVelocity {
                radians_per_second: 2.0,
            })
        );
        let body_component = world.rigid_body(body).unwrap();
        assert_eq!(body_component.force, Velocity::default());
        assert_eq!(body_component.impulse, Velocity::default());
        assert_eq!(body_component.torque, 0.0);
        assert_eq!(body_component.angular_impulse, 0.0);
    }

    #[test]
    fn disabled_rigid_body_is_ignored_by_contact_solver() {
        let mut world = World::default();
        let disabled = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
        world.set_rigid_body(disabled, RigidBody::dynamic(1.0).with_enabled(false));
        let active = spawn_dynamic_body(&mut world, 1.0, 0.0, 2.0);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.velocity_impulses, 0);
        assert_eq!(stats.position_corrections, 0);
        assert_eq!(
            world.transform(disabled),
            Some(Transform2D { x: 0.0, y: 0.0 })
        );
        assert_eq!(
            world.transform(active),
            Some(Transform2D { x: 1.0, y: 0.0 })
        );
        assert_eq!(world.velocity(active), Some(Velocity::default()));
    }

    #[test]
    fn disabled_collider_is_ignored_by_rigid_body_contact_solver() {
        let mut world = World::default();
        let disabled = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
        world.set_aabb_collider(
            disabled,
            AabbCollider::new(2.0, 2.0, false, CollisionLayer::Player).with_enabled(false),
        );
        let active = spawn_dynamic_body(&mut world, 1.0, 0.0, 2.0);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.contact_checks, 0);
        assert_eq!(
            world.transform(disabled),
            Some(Transform2D { x: 0.0, y: 0.0 })
        );
        assert_eq!(
            world.transform(active),
            Some(Transform2D { x: 1.0, y: 0.0 })
        );
    }

    #[test]
    fn disabled_rigid_body_is_ignored_by_joint_solver() {
        let mut world = World::default();
        let anchor = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_enabled(false));
        let joint_id = world.add_distance_joint(DistanceJoint::new(anchor, body, 0.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(stats.broken_joints, 0);
        assert!(world.distance_joint(joint_id).is_some());
        assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
    }

    #[test]
    fn angular_body_step_integrates_torque_impulse_and_damping() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic(2.0)
                .with_inertia(2.0)
                .with_angular_damping(0.5),
        );
        world.apply_torque(body, 4.0);
        world.apply_angular_impulse(body, 2.0);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.dynamic_bodies, 1);
        assert_eq!(stats.angular_bodies, 1);
        assert_eq!(
            world.angular_velocity(body),
            Some(AngularVelocity {
                radians_per_second: 1.5,
            })
        );
        assert_eq!(world.rotation(body), Some(Rotation2D { radians: 1.5 }));
        let body_component = world.rigid_body(body).unwrap();
        assert_eq!(body_component.torque, 0.0);
        assert_eq!(body_component.angular_impulse, 0.0);
    }

    #[test]
    fn angular_body_step_integrates_kinematic_rotation_only() {
        let mut world = World::default();
        let body = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, false);
        world.set_rigid_body(body, RigidBody::kinematic());
        world.set_rotation(body, Rotation2D { radians: 1.0 });
        world.set_angular_velocity(
            body,
            AngularVelocity {
                radians_per_second: 3.0,
            },
        );
        world.apply_torque(body, 100.0);
        world.apply_angular_impulse(body, 100.0);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.5,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.dynamic_bodies, 0);
        assert_eq!(stats.angular_bodies, 0);
        assert_eq!(world.rotation(body), Some(Rotation2D { radians: 2.5 }));
        assert_eq!(
            world.angular_velocity(body),
            Some(AngularVelocity {
                radians_per_second: 3.0,
            })
        );
    }

    #[test]
    fn angular_body_step_ignores_static_and_invalid_inertia() {
        let mut world = World::default();
        let static_body = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
        world.set_rigid_body(static_body, RigidBody::static_body());
        world.set_rotation(static_body, Rotation2D { radians: 2.0 });
        world.set_angular_velocity(
            static_body,
            AngularVelocity {
                radians_per_second: 5.0,
            },
        );

        let invalid_body = spawn_dynamic_body(&mut world, 20.0, 0.0, 2.0);
        let mut invalid_rigid_body = RigidBody::dynamic(1.0);
        invalid_rigid_body.inverse_inertia = f32::NAN;
        invalid_rigid_body.angular_damping = f32::NAN;
        world.set_rigid_body(invalid_body, invalid_rigid_body);
        world.apply_torque(invalid_body, 10.0);
        world.apply_angular_impulse(invalid_body, 10.0);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.dynamic_bodies, 1);
        assert_eq!(stats.angular_bodies, 0);
        assert_eq!(
            world.rotation(static_body),
            Some(Rotation2D { radians: 2.0 })
        );
        assert_eq!(
            world.rotation(invalid_body),
            Some(Rotation2D { radians: 0.0 })
        );
        let invalid_rigid_body = world.rigid_body(invalid_body).unwrap();
        assert_eq!(invalid_rigid_body.torque, 0.0);
        assert_eq!(invalid_rigid_body.angular_impulse, 0.0);
    }

    #[test]
    fn angular_contact_response_uses_offset_contact_point() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 1.0, 2.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 4.0, 4.0)
                .with_inertia(1.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            8.0,
            0.0,
            CollisionLayer::Wall,
            false,
            2.0,
            2.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.5,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        let angular_velocity = world.angular_velocity(body).unwrap();
        assert!(stats.velocity_impulses > 0);
        assert!(velocity.vx < 10.0);
        assert!(velocity.vy.abs() < 0.001);
        assert!(
            angular_velocity.radians_per_second.abs() > 0.001,
            "expected offset manifold contact to create angular velocity, got {angular_velocity:?} with {velocity:?} and {stats:?}"
        );
    }

    #[test]
    fn rigid_body_split_position_correction_uses_contact_point_inertia() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 1.0, 2.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 4.0, 4.0)
                .with_inertia(1.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            3.0,
            -1.0,
            CollisionLayer::Wall,
            false,
            2.0,
            2.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        let rotation = world.rotation(body).unwrap_or_default();
        assert_eq!(stats.position_corrections, 1);
        assert_eq!(stats.split_position_corrections, 1);
        assert!(
            transform.x < -0.001,
            "split position correction should move dynamic body out of penetration, got {transform:?}"
        );
        assert!(
            rotation.radians < -0.001,
            "off-center contact point correction should rotate dynamic body through inverse inertia, got {rotation:?}"
        );
        assert_eq!(world.transform(wall), Some(Transform2D { x: 3.0, y: -1.0 }));
        assert_eq!(world.rotation(wall).unwrap_or_default().radians, 0.0);
    }

    #[test]
    fn rigid_body_split_position_correction_respects_material_scale() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
                PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_scale(0.0),
            ),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: 0.0,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.position_corrections, 0);
        assert_eq!(stats.split_position_corrections, 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 0.0 }));
        assert_eq!(world.velocity(body), Some(Velocity::default()));
    }

    #[test]
    fn rigid_body_split_position_correction_uses_collider_material_scale() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        world.set_collider_material(
            body,
            PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_scale(0.0),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: 0.0,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.position_corrections, 0);
        assert_eq!(stats.split_position_corrections, 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 0.0 }));
    }

    #[test]
    fn rigid_body_split_position_correction_sanitizes_invalid_material_scale() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
                PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_scale(f32::NAN),
            ),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: 0.0,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        assert_eq!(stats.position_corrections, 1);
        assert_eq!(stats.split_position_corrections, 1);
        assert!(
            transform.x < -0.001,
            "invalid material position correction scale should fall back to default, got {transform:?}"
        );
    }

    #[test]
    fn rigid_body_split_position_correction_respects_material_slop_scale() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
                PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_slop_scale(2.0),
            ),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(
                PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_slop_scale(2.0),
            ),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.25,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: 0.0,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.position_corrections, 0);
        assert_eq!(stats.split_position_corrections, 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 0.0 }));
    }

    #[test]
    fn rigid_body_split_position_correction_uses_collider_material_slop_scale() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
                PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_slop_scale(0.0),
            ),
        );
        world.set_collider_material(
            body,
            PhysicsMaterial::new(0.0, 0.0).with_contact_position_correction_slop_scale(1.0),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 1.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: 0.0,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.position_corrections, 0);
        assert_eq!(stats.split_position_corrections, 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 0.0 }));
    }

    #[test]
    fn rigid_body_split_position_correction_sanitizes_invalid_material_slop_scale() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
                PhysicsMaterial::new(0.0, 0.0)
                    .with_contact_position_correction_slop_scale(f32::NAN),
            ),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(
                PhysicsMaterial::new(0.0, 0.0)
                    .with_contact_position_correction_slop_scale(f32::NAN),
            ),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.25,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: 0.0,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        assert_eq!(stats.position_corrections, 1);
        assert_eq!(stats.split_position_corrections, 1);
        assert!(
            transform.x < -0.001,
            "invalid material position correction slop scale should fall back to default, got {transform:?}"
        );
    }

    #[test]
    fn rigid_body_step_warm_starts_persistent_contacts() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            2.0,
            CollisionLayer::Wall,
            false,
            8.0,
            1.0,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let config = RigidBodyStepConfig {
            gravity: Velocity { vx: 0.0, vy: 10.0 },
            velocity_iterations: 4,
            position_iterations: 1,
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        };
        let first = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.1, config);
        let second = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.1, config);

        assert_eq!(first.warm_start_impulses, 0);
        assert!(first.contact_cache_entries > 0);
        assert!(second.warm_start_impulses > 0);
        assert!(second.contact_cache_entries > 0);
    }

    #[test]
    fn rigid_body_step_exposes_post_solve_contact_impulses() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            2.0,
            CollisionLayer::Wall,
            false,
            8.0,
            1.0,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity { vx: 0.0, vy: 10.0 },
                velocity_iterations: 2,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let impulses: Vec<_> = world.rigid_contact_impulses().collect();
        assert_eq!(world.rigid_contact_impulse_count(), impulses.len());
        assert_eq!(stats.contact_cache_entries as usize, impulses.len());
        assert!(world.rigid_contact_impulse_at(impulses.len()).is_none());
        assert!(
            impulses.iter().any(|impulse| {
                impulse.entity_a == body && impulse.entity_b == ground
                    || impulse.entity_a == ground && impulse.entity_b == body
            }),
            "expected body/ground contact impulse, got {impulses:?}"
        );
        assert!(
            impulses
                .iter()
                .any(|impulse| impulse.normal_impulse > CONTACT_IMPULSE_EPSILON),
            "expected at least one positive normal impulse, got {impulses:?}"
        );
        for impulse in impulses {
            assert!(impulse.point_x.is_finite());
            assert!(impulse.point_y.is_finite());
            assert!(impulse.normal_x.is_finite());
            assert!(impulse.normal_y.is_finite());
            assert!(impulse.normal_impulse.is_finite());
            assert!(impulse.tangent_impulse.is_finite());
            assert!(impulse.normal_impulse >= 0.0);
        }
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_aabb_face_contact() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            1.4,
            CollisionLayer::Wall,
            false,
            4.0,
            0.5,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        let angular_velocity = world.angular_velocity(body).unwrap_or_default();
        assert_eq!(stats.contact_block_solves, 1);
        assert_eq!(stats.contact_cache_entries, 2);
        assert!(stats.velocity_impulses >= 2);
        assert!(
            velocity.vy < 0.0,
            "two-point block solve should create separating normal velocity, got {velocity:?}"
        );
        assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "symmetric two-point contact should not leave residual angular velocity, got {angular_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_aabb_circle_face_contact() {
        let mut world = World::default();
        let circle = spawn_dynamic_circle(&mut world, 0.0, 0.0, 1.0);
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            1.4,
            CollisionLayer::Wall,
            false,
            4.0,
            0.5,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        assert_circle_two_point_contact_block_solve(&mut world, circle);
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_capsule_circle_side_contact() {
        let mut world = World::default();
        let circle = spawn_dynamic_circle(&mut world, 0.0, 0.0, 1.0);
        let capsule = world.spawn_entity();
        world.set_transform(capsule, Transform2D { x: 0.0, y: 1.5 });
        world.set_capsule_collider(
            capsule,
            CapsuleCollider::new(-4.0, 0.0, 4.0, 0.0, 1.0, false, CollisionLayer::Wall),
        );
        world.set_collision_filter(
            capsule,
            CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            capsule,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        assert_circle_two_point_contact_block_solve(&mut world, circle);
    }

    #[test]
    fn rigid_body_contact_solver_handles_single_point_circle_circle_contact() {
        let mut world = World::default();
        let dynamic = spawn_dynamic_circle(&mut world, 0.0, 0.0, 1.0);
        let static_circle = world.spawn_entity();
        world.set_transform(static_circle, Transform2D { x: 1.5, y: 0.0 });
        world.set_circle_collider(
            static_circle,
            CircleCollider {
                radius: 1.0,
                offset_x: 0.0,
                offset_y: 0.0,
                enabled: true,
                is_trigger: false,
                layer: CollisionLayer::Wall,
            },
        );
        world.set_collision_filter(
            static_circle,
            CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            static_circle,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let manifolds = CollisionSystem::build_manifolds(&world);
        assert_eq!(manifolds.len(), 1);
        assert_eq!(manifolds[0].point_count, 1);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            contact_block_solver_test_config(),
        );

        let velocity = world.velocity(dynamic).unwrap();
        assert_eq!(stats.contact_block_solves, 0);
        assert_eq!(stats.contact_cache_entries, 1);
        assert!(stats.velocity_impulses >= 1);
        assert!(
            velocity.vx < 0.0,
            "single-point circle contact should create separating normal velocity, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_capsule_side_contact() {
        let mut world = World::default();
        let capsule = spawn_dynamic_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(-2.0, 0.0, 2.0, 0.0, 1.0, false, CollisionLayer::Player),
        );
        world.set_rigid_body(
            capsule,
            RigidBody::dynamic_capsule(1.0, -2.0, 0.0, 2.0, 0.0, 1.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            1.4,
            CollisionLayer::Wall,
            false,
            4.0,
            0.5,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(capsule).unwrap();
        let angular_velocity = world.angular_velocity(capsule).unwrap_or_default();
        assert_eq!(stats.contact_block_solves, 1);
        assert_eq!(stats.contact_cache_entries, 2);
        assert!(stats.velocity_impulses >= 2);
        assert!(
            velocity.vy < 0.0,
            "capsule side block solve should create separating normal velocity, got {velocity:?}"
        );
        assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "symmetric capsule side contact should not leave residual angular velocity, got {angular_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_capsule_endpoint_contact() {
        let mut world = World::default();
        let dynamic = spawn_dynamic_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(-3.0, 0.0, 3.0, 0.0, 1.0, false, CollisionLayer::Player),
        );
        world.set_rigid_body(
            dynamic,
            RigidBody::dynamic_capsule(1.0, -3.0, 0.0, 3.0, 0.0, 1.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let static_capsule = world.spawn_entity();
        world.set_transform(static_capsule, Transform2D { x: 0.0, y: 0.0 });
        world.set_capsule_collider(
            static_capsule,
            CapsuleCollider::new(-2.0, 1.5, 2.0, 1.55, 1.0, false, CollisionLayer::Wall),
        );
        world.set_collision_filter(
            static_capsule,
            CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            static_capsule,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(dynamic).unwrap();
        assert_eq!(stats.contact_block_solves, 1);
        assert_eq!(stats.contact_cache_entries, 2);
        assert!(stats.velocity_impulses >= 1);
        assert!(
            velocity.vy < 0.0,
            "capsule endpoint block solve should create separating normal velocity, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_oriented_box_face_contact() {
        let mut world = World::default();
        let body = spawn_dynamic_oriented_box(
            &mut world,
            0.0,
            0.0,
            OrientedBoxCollider::new(1.0, 1.0, 0.0, false, CollisionLayer::Player),
        );
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let ground = world.spawn_entity();
        world.set_transform(ground, Transform2D { x: 0.0, y: 1.4 });
        world.set_oriented_box_collider(
            ground,
            OrientedBoxCollider::new(4.0, 0.5, 0.0, false, CollisionLayer::Wall),
        );
        world.set_collision_filter(
            ground,
            CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        let angular_velocity = world.angular_velocity(body).unwrap_or_default();
        assert_eq!(stats.contact_block_solves, 1);
        assert_eq!(stats.contact_cache_entries, 2);
        assert!(stats.velocity_impulses >= 2);
        assert!(
            velocity.vy < 0.0,
            "oriented box block solve should create separating normal velocity, got {velocity:?}"
        );
        assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "symmetric oriented box contact should not leave residual angular velocity, got {angular_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_convex_polygon_face_contact() {
        let mut world = World::default();
        let collider =
            convex_polygon_collider(&[(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]);
        let body = spawn_static_convex_polygon(&mut world, 0.0, 0.0, collider);
        world.set_collision_filter(
            body,
            CollisionFilter::new(CollisionLayer::Player.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            body,
            RigidBody::dynamic_convex_polygon(1.0, collider.vertices, collider.vertex_count)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            1.4,
            CollisionLayer::Wall,
            false,
            4.0,
            0.5,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        let angular_velocity = world.angular_velocity(body).unwrap_or_default();
        assert_eq!(stats.contact_block_solves, 1);
        assert_eq!(stats.contact_cache_entries, 2);
        assert!(stats.velocity_impulses >= 2);
        assert!(
            velocity.vy < 0.0,
            "convex polygon block solve should create separating normal velocity, got {velocity:?}"
        );
        assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "symmetric convex polygon contact should not leave residual angular velocity, got {angular_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_convex_polygon_circle_face_contact() {
        let mut world = World::default();
        let circle = spawn_dynamic_circle(&mut world, 0.0, 0.0, 1.0);
        let ground = spawn_static_convex_polygon(
            &mut world,
            0.0,
            1.4,
            convex_polygon_collider(&[(-4.0, -0.5), (4.0, -0.5), (4.0, 0.5), (-4.0, 0.5)]),
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        assert_circle_two_point_contact_block_solve(&mut world, circle);
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_convex_polygon_capsule_side_contact() {
        let mut world = World::default();
        let capsule = spawn_dynamic_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(-2.0, 0.0, 2.0, 0.0, 1.0, false, CollisionLayer::Player),
        );
        world.set_rigid_body(
            capsule,
            RigidBody::dynamic_capsule(1.0, -2.0, 0.0, 2.0, 0.0, 1.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let ground = spawn_static_convex_polygon(
            &mut world,
            0.0,
            1.4,
            convex_polygon_collider(&[(-2.0, -0.5), (2.0, -0.5), (2.0, 0.5), (-2.0, 0.5)]),
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(capsule).unwrap();
        let angular_velocity = world.angular_velocity(capsule).unwrap_or_default();
        assert_eq!(stats.contact_block_solves, 1);
        assert_eq!(stats.contact_cache_entries, 2);
        assert!(stats.velocity_impulses >= 2);
        assert!(
            velocity.vy < 0.0,
            "convex polygon capsule block solve should create separating normal velocity, got {velocity:?}"
        );
        assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "symmetric convex polygon capsule contact should not leave residual angular velocity, got {angular_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_aabb_capsule_arc_clipped_contact() {
        let mut world = World::default();
        let capsule = spawn_dynamic_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(-8.0, 4.5, 8.0, 5.5, 1.0, false, CollisionLayer::Player),
        );
        world.set_rigid_body(
            capsule,
            RigidBody::dynamic_capsule(1.0, -8.0, 4.5, 8.0, 5.5, 1.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            0.0,
            CollisionLayer::Wall,
            false,
            5.0,
            5.0,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        assert_capsule_two_point_contact_block_solve(&mut world, capsule);
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_oriented_box_capsule_arc_clipped_contact()
    {
        let mut world = World::default();
        let rotation = 0.35;
        let start = rotated_test_point(-8.0, 4.5, rotation);
        let end = rotated_test_point(8.0, 5.5, rotation);
        let capsule = spawn_dynamic_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(
                start.x,
                start.y,
                end.x,
                end.y,
                1.0,
                false,
                CollisionLayer::Player,
            ),
        );
        world.set_rigid_body(
            capsule,
            RigidBody::dynamic_capsule(1.0, start.x, start.y, end.x, end.y, 1.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let ground = world.spawn_entity();
        world.set_transform(ground, Transform2D { x: 0.0, y: 0.0 });
        world.set_oriented_box_collider(
            ground,
            OrientedBoxCollider::new(5.0, 5.0, rotation, false, CollisionLayer::Wall),
        );
        world.set_collision_filter(
            ground,
            CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        assert_capsule_two_point_contact_block_solve(&mut world, capsule);
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_convex_polygon_capsule_arc_clipped_contact(
    ) {
        let mut world = World::default();
        let capsule = spawn_dynamic_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(-4.0, 0.6, 4.0, 1.4, 1.0, false, CollisionLayer::Player),
        );
        world.set_rigid_body(
            capsule,
            RigidBody::dynamic_capsule(1.0, -4.0, 0.6, 4.0, 1.4, 1.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let ground = spawn_static_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        assert_capsule_two_point_contact_block_solve(&mut world, capsule);
    }

    #[test]
    fn rigid_body_contact_block_solver_handles_two_point_capsule_curve_contact() {
        let mut world = World::default();
        let capsule = spawn_dynamic_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(-3.0, 0.0, 3.0, 0.0, 1.0, false, CollisionLayer::Player),
        );
        world.set_rigid_body(
            capsule,
            RigidBody::dynamic_capsule(1.0, -3.0, 0.0, 3.0, 0.0, 1.0)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        let static_capsule = world.spawn_entity();
        world.set_transform(static_capsule, Transform2D { x: 0.0, y: 0.0 });
        world.set_capsule_collider(
            static_capsule,
            CapsuleCollider::new(0.0, -3.0, 0.0, 3.0, 1.0, false, CollisionLayer::Wall),
        );
        world.set_collision_filter(
            static_capsule,
            CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            static_capsule,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        assert_capsule_two_point_contact_block_solve(&mut world, capsule);
    }

    #[test]
    fn rigid_body_contact_baumgarte_bias_separates_resting_overlap() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert!(stats.velocity_impulses > 0);
        assert!(stats.baumgarte_velocity_biases > 0);
        assert_eq!(stats.position_corrections, 0);
        assert!(
            velocity.vx < -0.001,
            "Baumgarte bias should create separating velocity for resting overlap, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_contact_split_impulse_corrects_overlap_without_velocity_bias() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 4,
                position_iterations: 0,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: true,
            },
        );

        let transform = world.transform(body).unwrap();
        let velocity = world.velocity(body).unwrap();
        assert_eq!(stats.position_corrections, 0);
        assert_eq!(stats.baumgarte_velocity_biases, 0);
        assert!(stats.split_velocity_impulses > 0);
        assert!(
            transform.x < -0.001,
            "split impulse should correct overlap through transform only, got {transform:?}"
        );
        assert!(
            velocity.vx.abs() < 0.001 && velocity.vy.abs() < 0.001,
            "split impulse should not inject separating linear velocity, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_contact_baumgarte_bias_respects_position_slop() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 1.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.velocity_impulses, 0);
        assert_eq!(stats.baumgarte_velocity_biases, 0);
        assert_eq!(stats.position_corrections, 0);
        assert_eq!(world.velocity(body), Some(Velocity::default()));
    }

    #[test]
    fn rigid_body_contact_baumgarte_bias_can_be_disabled_per_step() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: 0.0,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.velocity_impulses, 0);
        assert_eq!(stats.baumgarte_velocity_biases, 0);
        assert_eq!(stats.position_corrections, 0);
        assert_eq!(world.velocity(body), Some(Velocity::default()));
    }

    #[test]
    fn rigid_body_contact_baumgarte_bias_respects_material_scale() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
                PhysicsMaterial::new(0.0, 0.0).with_contact_baumgarte_bias_scale(0.0),
            ),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.velocity_impulses, 0);
        assert_eq!(stats.baumgarte_velocity_biases, 0);
        assert_eq!(stats.position_corrections, 0);
        assert_eq!(world.velocity(body), Some(Velocity::default()));
    }

    #[test]
    fn rigid_body_contact_baumgarte_bias_respects_material_max_velocity_scale() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
                PhysicsMaterial::new(0.0, 0.0).with_max_contact_baumgarte_bias_velocity_scale(0.0),
            ),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.velocity_impulses, 0);
        assert_eq!(stats.baumgarte_velocity_biases, 0);
        assert_eq!(stats.position_corrections, 0);
        assert_eq!(world.velocity(body), Some(Velocity::default()));
    }

    #[test]
    fn rigid_body_contact_baumgarte_bias_sanitizes_invalid_config() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: f32::NAN,
                max_contact_baumgarte_bias_velocity: f32::NAN,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert!(stats.velocity_impulses > 0);
        assert!(stats.baumgarte_velocity_biases > 0);
        assert_eq!(stats.position_corrections, 0);
        assert!(
            velocity.vx < -0.001,
            "invalid Baumgarte config should fall back to default, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_contact_baumgarte_bias_sanitizes_invalid_material_scale() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(
                PhysicsMaterial::new(0.0, 0.0)
                    .with_contact_baumgarte_bias_scale(f32::NAN)
                    .with_max_contact_baumgarte_bias_velocity_scale(f32::NAN),
            ),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert!(stats.velocity_impulses > 0);
        assert!(stats.baumgarte_velocity_biases > 0);
        assert_eq!(stats.position_corrections, 0);
        assert!(
            velocity.vx < -0.001,
            "invalid material Baumgarte scale should fall back to default, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_puts_idle_dynamic_body_to_sleep() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic(1.0)
                .with_gravity_scale(0.0)
                .with_sleeping_enabled(true),
        );

        let config = RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        };
        let first = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.25, config);
        let second = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.25, config);
        let third = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.25, config);

        assert_eq!(first.bodies_put_to_sleep, 0);
        assert_eq!(second.bodies_put_to_sleep, 1);
        assert_eq!(second.sleeping_bodies, 1);
        assert_eq!(third.dynamic_bodies, 0);
        assert_eq!(third.sleeping_bodies, 1);
        let body_component = world.rigid_body(body).unwrap();
        assert!(body_component.is_sleeping);
        assert_eq!(world.velocity(body), Some(Velocity::default()));
        assert_eq!(
            world.angular_velocity(body),
            Some(AngularVelocity::default())
        );
    }

    #[test]
    fn rigid_body_island_sleep_puts_connected_idle_bodies_to_sleep_together() {
        let mut world = World::default();
        let left = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        let right = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
        for entity in [left, right] {
            world.set_rigid_body(
                entity,
                RigidBody::dynamic(1.0)
                    .with_gravity_scale(0.0)
                    .with_sleeping_enabled(true),
            );
        }
        world.add_distance_joint(DistanceJoint::new(left, right, 10.0));

        let config = RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        };
        let first = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.25, config);
        let second = PhysicsSystem::step_rigid_bodies_with_config(&mut world, 0.25, config);

        assert_eq!(first.bodies_put_to_sleep, 0);
        assert_eq!(first.islands_put_to_sleep, 0);
        assert_eq!(second.bodies_put_to_sleep, 2);
        assert_eq!(second.islands_put_to_sleep, 1);
        assert_eq!(second.sleeping_bodies, 2);
        assert_eq!(second.active_islands, 0);
        assert_eq!(second.sleeping_islands, 1);
        assert!(world.rigid_body(left).unwrap().is_sleeping);
        assert!(world.rigid_body(right).unwrap().is_sleeping);
    }

    #[test]
    fn rigid_body_island_sleep_waits_for_connected_active_body() {
        let mut world = World::default();
        let active = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        let idle = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
        for entity in [active, idle] {
            world.set_rigid_body(
                entity,
                RigidBody::dynamic(1.0)
                    .with_gravity_scale(0.0)
                    .with_sleeping_enabled(true),
            );
        }
        world.set_velocity(active, Velocity { vx: 10.0, vy: 0.0 });
        world.add_distance_joint(DistanceJoint::new(active, idle, 10.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.5,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.bodies_put_to_sleep, 0);
        assert_eq!(stats.islands_put_to_sleep, 0);
        assert_eq!(stats.sleeping_bodies, 0);
        assert!(!world.rigid_body(active).unwrap().is_sleeping);
        assert!(!world.rigid_body(idle).unwrap().is_sleeping);
        assert_eq!(
            world.rigid_body(idle).unwrap().sleep_timer_seconds,
            DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS
        );
    }

    #[test]
    fn rigid_body_impulse_wakes_sleeping_body() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        let mut rigid_body = RigidBody::dynamic(1.0);
        rigid_body.is_sleeping = true;
        rigid_body.sleep_timer_seconds = 0.5;
        world.set_rigid_body(body, rigid_body);

        world.apply_impulse(body, Velocity { vx: 2.0, vy: 0.0 });

        let body_component = world.rigid_body(body).unwrap();
        assert!(!body_component.is_sleeping);
        assert_eq!(body_component.sleep_timer_seconds, 0.0);
        assert_eq!(body_component.impulse, Velocity { vx: 2.0, vy: 0.0 });
    }

    #[test]
    fn rigid_body_contact_wakes_sleeping_dynamic_body() {
        let mut world = World::default();
        let active = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_velocity(active, Velocity { vx: 10.0, vy: 0.0 });
        world.set_rigid_body(active, RigidBody::dynamic(1.0));
        let sleeping = spawn_dynamic_body(&mut world, 2.0, 0.0, 1.0);
        let mut sleeping_body = RigidBody::dynamic(1.0);
        sleeping_body.is_sleeping = true;
        sleeping_body.sleep_timer_seconds = 0.5;
        world.set_rigid_body(sleeping, sleeping_body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.bodies_woken, 1);
        assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
    }

    #[test]
    fn rigid_body_island_wake_reaches_joint_connected_sleeping_bodies() {
        let mut world = World::default();
        let active = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        let sleeping_a = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
        let sleeping_b = spawn_dynamic_body(&mut world, 20.0, 0.0, 1.0);

        world.set_velocity(active, Velocity { vx: 10.0, vy: 0.0 });
        for entity in [sleeping_a, sleeping_b] {
            let mut body = RigidBody::dynamic(1.0);
            body.is_sleeping = true;
            body.sleep_timer_seconds = 0.5;
            world.set_rigid_body(entity, body);
        }
        world.add_distance_joint(DistanceJoint::new(active, sleeping_a, 10.0));
        world.add_distance_joint(DistanceJoint::new(sleeping_a, sleeping_b, 10.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.bodies_woken, 2);
        assert_eq!(stats.islands_woken, 1);
        assert!(!world.rigid_body(sleeping_a).unwrap().is_sleeping);
        assert!(!world.rigid_body(sleeping_b).unwrap().is_sleeping);
        assert_eq!(stats.active_islands, 1);
        assert_eq!(stats.sleeping_islands, 0);
    }

    #[test]
    fn rigid_body_island_wake_ignores_disabled_joints() {
        let mut world = World::default();
        let active = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        let sleeping = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);

        world.set_velocity(active, Velocity { vx: 10.0, vy: 0.0 });
        let mut sleeping_body = RigidBody::dynamic(1.0);
        sleeping_body.is_sleeping = true;
        sleeping_body.sleep_timer_seconds = 0.5;
        world.set_rigid_body(sleeping, sleeping_body);
        world.add_distance_joint(DistanceJoint::new(active, sleeping, 10.0).with_enabled(false));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.bodies_woken, 0);
        assert_eq!(stats.islands_woken, 0);
        assert!(world.rigid_body(sleeping).unwrap().is_sleeping);
        assert_eq!(stats.active_islands, 1);
        assert_eq!(stats.sleeping_islands, 1);
    }

    #[test]
    fn rigid_body_step_resolves_dynamic_static_collision_with_restitution() {
        let mut world = World::default();
        let ball = spawn_dynamic_body(&mut world, 0.0, 4.0, 1.0);
        world.set_velocity(ball, Velocity { vx: 0.0, vy: 20.0 });
        world.set_rigid_body(
            ball,
            RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.5, 0.0)),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            10.0,
            CollisionLayer::Wall,
            false,
            20.0,
            1.0,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.5, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.25,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 4,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.velocity_impulses > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert_eq!(stats.position_corrections, 0);
        let velocity = world.velocity(ball).unwrap();
        assert!(
            (velocity.vy + 10.0).abs() < 0.01,
            "velocity should bounce upward, got {velocity:?}"
        );
        let transform = world.transform(ball).unwrap();
        assert!(transform.y <= 8.0 + 0.01);
        assert_eq!(
            world.transform(ground),
            Some(Transform2D { x: 0.0, y: 10.0 })
        );
    }

    #[test]
    fn rigid_body_step_resolves_dynamic_capsule_static_aabb_contact() {
        let mut world = World::default();
        let capsule = spawn_dynamic_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(-2.0, 0.0, 2.0, 0.0, 1.0, false, CollisionLayer::Player),
        );
        world.set_velocity(capsule, Velocity { vx: 10.0, vy: 0.0 });
        world.set_rigid_body(
            capsule,
            RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            3.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            3.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.016,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(capsule).unwrap();
        let transform = world.transform(capsule).unwrap();
        assert!(stats.velocity_impulses > 0);
        assert_eq!(stats.ccd_hits, 0);
        assert!(
            velocity.vx <= 0.01,
            "capsule should stop against wall: {velocity:?}"
        );
        assert!(
            transform.x < 0.0,
            "position correction should separate capsule from wall: {transform:?}"
        );
    }

    #[test]
    fn rigid_body_step_resolves_dynamic_oriented_box_static_aabb_contact() {
        let mut world = World::default();
        let body = spawn_dynamic_oriented_box(
            &mut world,
            0.0,
            0.0,
            OrientedBoxCollider::new(1.0, 1.0, 0.0, false, CollisionLayer::Player),
        );
        world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            1.5,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            3.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.016,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        let transform = world.transform(body).unwrap();
        assert!(stats.velocity_impulses > 0);
        assert_eq!(stats.ccd_hits, 0);
        assert!(
            velocity.vx <= 0.01,
            "oriented box should stop against wall: {velocity:?}"
        );
        assert!(
            transform.x < 0.0,
            "position correction should separate oriented box from wall: {transform:?}"
        );
    }

    #[test]
    fn rigid_body_step_resolves_dynamic_aabb_static_convex_polygon_contact() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_static_convex_polygon(
            &mut world,
            1.5,
            0.0,
            convex_polygon_collider(&[(-1.0, -3.0), (1.0, -3.0), (1.0, 3.0), (-1.0, 3.0)]),
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.016,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        let transform = world.transform(body).unwrap();
        assert!(stats.velocity_impulses > 0);
        assert_eq!(stats.ccd_hits, 0);
        assert!(
            velocity.vx <= 0.01,
            "AABB body should stop against polygon wall: {velocity:?}"
        );
        assert!(
            transform.x < 0.0,
            "position correction should separate AABB from polygon wall: {transform:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_dynamic_aabb() {
        let mut world = World::default();
        let left = spawn_dynamic_body(&mut world, 0.0, 0.0, 0.5);
        let right = spawn_dynamic_body(&mut world, 10.0, 0.0, 0.5);
        world.set_velocity(left, Velocity { vx: 100.0, vy: 0.0 });
        world.set_velocity(
            right,
            Velocity {
                vx: -100.0,
                vy: 0.0,
            },
        );
        world.set_rigid_body(
            left,
            RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        world.set_rigid_body(
            right,
            RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let left_transform = world.transform(left).unwrap();
        let right_transform = world.transform(right).unwrap();
        assert!(
            left_transform.x <= right_transform.x - 1.0 + 0.001,
            "dynamic bodies should stop at or before contact, got left={left_transform:?}, right={right_transform:?}"
        );
        let left_velocity = world.velocity(left).unwrap();
        let right_velocity = world.velocity(right).unwrap();
        assert!(
            left_velocity.vx.abs() < 0.001 && right_velocity.vx.abs() < 0.001,
            "inelastic dynamic-dynamic CCD should stop equal-mass bodies, got left={left_velocity:?}, right={right_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_dynamic_dynamic_ccd_wakes_sleeping_target() {
        let mut world = World::default();
        let moving = spawn_dynamic_body(&mut world, 0.0, 0.0, 0.5);
        let sleeping = spawn_dynamic_body(&mut world, 10.0, 0.0, 0.5);
        world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            moving,
            RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let mut sleeping_body =
            RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0));
        sleeping_body.is_sleeping = true;
        sleeping_body.sleep_timer_seconds = 0.5;
        world.set_rigid_body(sleeping, sleeping_body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.2,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.ccd_hits, 1);
        assert_eq!(stats.bodies_woken, 1);
        assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
        let moving_velocity = world.velocity(moving).unwrap();
        let sleeping_velocity = world.velocity(sleeping).unwrap();
        assert!(
            (moving_velocity.vx - 50.0).abs() < 0.001
                && (sleeping_velocity.vx - 50.0).abs() < 0.001,
            "CCD impact should share velocity with the sleeping target, got moving={moving_velocity:?}, sleeping={sleeping_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_restitution_threshold_suppresses_low_speed_bounce() {
        let mut world = World::default();
        let ball = spawn_dynamic_body(&mut world, 0.0, 8.5, 1.0);
        world.set_velocity(ball, Velocity { vx: 0.0, vy: 0.5 });
        world.set_rigid_body(
            ball,
            RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            10.0,
            CollisionLayer::Wall,
            false,
            20.0,
            1.0,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(1.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.01,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.velocity_impulses > 0);
        assert!(stats.restitution_velocity_threshold_skips > 0);
        let velocity = world.velocity(ball).unwrap();
        assert!(
            velocity.vy.abs() < 0.001,
            "low-speed contact should stop without bounce, got {velocity:?}"
        );
        assert_eq!(
            world.transform(ground),
            Some(Transform2D { x: 0.0, y: 10.0 })
        );
    }

    #[test]
    fn rigid_body_restitution_threshold_can_be_disabled_per_step() {
        let mut world = World::default();
        let ball = spawn_dynamic_body(&mut world, 0.0, 8.5, 1.0);
        world.set_velocity(ball, Velocity { vx: 0.0, vy: 0.5 });
        world.set_rigid_body(
            ball,
            RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            10.0,
            CollisionLayer::Wall,
            false,
            20.0,
            1.0,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(1.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.01,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: 0.0,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.velocity_impulses > 0);
        assert_eq!(stats.restitution_velocity_threshold_skips, 0);
        let velocity = world.velocity(ball).unwrap();
        assert!(
            velocity.vy < -0.49,
            "disabled restitution threshold should allow low-speed bounce, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_restitution_threshold_sanitizes_invalid_config() {
        let mut world = World::default();
        let ball = spawn_dynamic_body(&mut world, 0.0, 8.5, 1.0);
        world.set_velocity(ball, Velocity { vx: 0.0, vy: 0.5 });
        world.set_rigid_body(
            ball,
            RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            10.0,
            CollisionLayer::Wall,
            false,
            20.0,
            1.0,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(1.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.01,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: f32::NAN,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.restitution_velocity_threshold_skips > 0);
        let velocity = world.velocity(ball).unwrap();
        assert!(
            velocity.vy.abs() < 0.001,
            "invalid restitution threshold should fall back to default, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_surface_velocity_drives_tangent_contact_impulse() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 10.0)),
        );
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            2.0,
            CollisionLayer::Wall,
            false,
            8.0,
            1.0,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(
                PhysicsMaterial::new(0.0, 10.0)
                    .with_surface_velocity(Velocity { vx: 30.0, vy: 0.0 }),
            ),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity { vx: 0.0, vy: 20.0 },
                velocity_iterations: 4,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert!(stats.velocity_impulses > 0);
        assert!(
            velocity.vx > 0.1,
            "surface velocity should push the dynamic body along the contact tangent, got {velocity:?}"
        );
    }

    #[test]
    fn collider_material_overrides_rigid_body_material_for_contacts() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        world.set_collider_material(body, PhysicsMaterial::new(0.0, 10.0));
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            2.0,
            CollisionLayer::Wall,
            false,
            8.0,
            1.0,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        world.set_collider_material(
            ground,
            PhysicsMaterial::new(0.0, 10.0).with_surface_velocity(Velocity { vx: 30.0, vy: 0.0 }),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity { vx: 0.0, vy: 20.0 },
                velocity_iterations: 4,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert!(stats.velocity_impulses > 0);
        assert!(
            velocity.vx > 0.1,
            "collider material should override body material in contact solving, got {velocity:?}"
        );
    }

    #[test]
    fn secondary_compound_collider_material_overrides_body_material_for_contacts() {
        let mut world = World::default();
        let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_rigid_body(
            body,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        assert_eq!(
            world.add_compound_collider(
                body,
                CompoundCollider::new(CompoundColliderShape::Aabb(
                    AabbCollider::new(1.0, 1.0, false, CollisionLayer::Player)
                        .with_offset(0.0, 2.0),
                ))
                .with_filter(CollisionFilter::new(
                    CollisionLayer::Player.mask(),
                    CollisionMask::ALL,
                )),
            ),
            Some(1)
        );
        assert!(world.set_compound_collider_material(body, 1, PhysicsMaterial::new(0.0, 10.0)));
        let ground = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            3.5,
            CollisionLayer::Wall,
            false,
            8.0,
            1.0,
        );
        world.set_rigid_body(
            ground,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        world.set_collider_material(
            ground,
            PhysicsMaterial::new(0.0, 10.0).with_surface_velocity(Velocity { vx: 30.0, vy: 0.0 }),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity { vx: 0.0, vy: 20.0 },
                velocity_iterations: 4,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert!(stats.velocity_impulses > 0);
        assert!(
            velocity.vx > 0.1,
            "secondary compound collider material should participate in contact solving, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_aabb() {
        let mut world = World::default();
        let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            mover,
            RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            50.0,
            0.0,
            CollisionLayer::Wall,
            false,
            5.0,
            5.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        let debug_hit = world
            .rigid_body_ccd_debug_hit_at(0)
            .expect("CCD impact should record a debug hit");
        assert_eq!(world.rigid_body_ccd_debug_hit_count(), 1);
        assert_eq!(debug_hit.moving_entity, mover);
        assert_eq!(debug_hit.target_entity, wall);
        assert!((debug_hit.point_x - 45.0).abs() < 0.001);
        assert!((debug_hit.point_y - 0.0).abs() < 0.001);
        assert!((debug_hit.normal_x - 1.0).abs() < 0.001);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 44.0).abs() < 0.001,
            "fast body should stop at first time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the CCD impact, got {velocity:?}"
        );
        assert_eq!(world.transform(wall), Some(Transform2D { x: 50.0, y: 0.0 }));
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_circle_against_aabb() {
        let mut world = World::default();
        let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_circle_collider(
            mover,
            crate::components::CircleCollider {
                radius: 1.0,
                offset_x: 0.0,
                offset_y: 0.0,
                enabled: true,
                is_trigger: false,
                layer: CollisionLayer::Player,
            },
        );
        world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            mover,
            RigidBody::dynamic_circle(1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            50.0,
            0.0,
            CollisionLayer::Wall,
            false,
            5.0,
            5.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 44.0).abs() < 0.001,
            "fast circle should stop at first time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the circle CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_aabb_against_circle() {
        let mut world = World::default();
        let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            mover,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let target = spawn_kinematic_body_with_size(
            &mut world,
            50.0,
            0.0,
            CollisionLayer::Wall,
            false,
            1.0,
            1.0,
        );
        world.set_circle_collider(
            target,
            crate::components::CircleCollider {
                radius: 1.0,
                offset_x: 0.0,
                offset_y: 0.0,
                enabled: true,
                is_trigger: false,
                layer: CollisionLayer::Wall,
            },
        );
        world.set_rigid_body(
            target,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 48.0).abs() < 0.001,
            "fast AABB should stop at circle time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the AABB/circle CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_capsule_against_aabb() {
        let mut world = World::default();
        let mover = spawn_dynamic_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(-2.0, 0.0, 2.0, 0.0, 1.0, false, CollisionLayer::Player),
        );
        world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            mover,
            RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            50.0,
            0.0,
            CollisionLayer::Wall,
            false,
            5.0,
            5.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 42.0).abs() < 0.001,
            "fast capsule should stop at first time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the capsule CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_aabb_against_capsule() {
        let mut world = World::default();
        let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            mover,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let target = world.spawn_entity();
        world.set_transform(target, Transform2D { x: 50.0, y: 0.0 });
        world.set_capsule_collider(
            target,
            CapsuleCollider::new(0.0, -4.0, 0.0, 4.0, 1.0, false, CollisionLayer::Wall),
        );
        world.set_collision_filter(
            target,
            CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            target,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 48.0).abs() < 0.001,
            "fast AABB should stop at capsule time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the AABB/capsule CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_oriented_box_against_aabb() {
        let mut world = World::default();
        let mover = spawn_dynamic_oriented_box(
            &mut world,
            0.0,
            0.0,
            OrientedBoxCollider::new(
                1.0,
                1.0,
                std::f32::consts::FRAC_PI_4,
                false,
                CollisionLayer::Player,
            ),
        );
        world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            mover,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            50.0,
            0.0,
            CollisionLayer::Wall,
            false,
            5.0,
            5.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let expected_x = 45.0 - 2.0_f32.sqrt();
        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - expected_x).abs() < 0.01,
            "fast oriented box should stop at first time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the oriented box CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_aabb_against_oriented_box() {
        let mut world = World::default();
        let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            mover,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_dynamic_oriented_box(
            &mut world,
            50.0,
            0.0,
            OrientedBoxCollider::new(5.0, 5.0, 0.0, false, CollisionLayer::Wall),
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 44.0).abs() < 0.001,
            "fast AABB should stop at oriented box time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the AABB/oriented-box CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_aabb_against_convex_polygon() {
        let mut world = World::default();
        let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_velocity(mover, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            mover,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let wall = spawn_static_convex_polygon(
            &mut world,
            50.0,
            0.0,
            convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 44.0).abs() < 0.001,
            "fast AABB should stop at convex polygon time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the AABB/polygon CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_convex_polygon_against_aabb() {
        let mut world = World::default();
        let mover = spawn_fast_dynamic_convex_polygon_ccd_mover(&mut world);
        let wall = spawn_kinematic_body_with_size(
            &mut world,
            50.0,
            0.0,
            CollisionLayer::Wall,
            false,
            5.0,
            5.0,
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 44.0).abs() < 0.001,
            "fast convex polygon should stop at AABB time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the polygon/AABB CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_convex_polygon_against_circle() {
        let mut world = World::default();
        let mover = spawn_fast_dynamic_convex_polygon_ccd_mover(&mut world);
        let target = world.spawn_entity();
        world.set_transform(target, Transform2D { x: 50.0, y: 0.0 });
        world.set_circle_collider(
            target,
            crate::components::CircleCollider {
                radius: 5.0,
                offset_x: 0.0,
                offset_y: 0.0,
                enabled: true,
                is_trigger: false,
                layer: CollisionLayer::Wall,
            },
        );
        world.set_collision_filter(
            target,
            CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            target,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 44.0).abs() < 0.001,
            "fast convex polygon should stop at circle time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the polygon/circle CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_convex_polygon_against_oriented_box() {
        let mut world = World::default();
        let mover = spawn_fast_dynamic_convex_polygon_ccd_mover(&mut world);
        let wall = spawn_dynamic_oriented_box(
            &mut world,
            50.0,
            0.0,
            OrientedBoxCollider::new(5.0, 5.0, 0.0, false, CollisionLayer::Wall),
        );
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 44.0).abs() < 0.001,
            "fast convex polygon should stop at oriented-box time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the polygon/oriented-box CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_uses_ccd_for_fast_dynamic_convex_polygon_against_capsule() {
        let mut world = World::default();
        let mover = spawn_fast_dynamic_convex_polygon_ccd_mover(&mut world);
        let target = world.spawn_entity();
        world.set_transform(target, Transform2D { x: 50.0, y: 0.0 });
        world.set_capsule_collider(
            target,
            CapsuleCollider::new(0.0, -4.0, 0.0, 4.0, 5.0, false, CollisionLayer::Wall),
        );
        world.set_collision_filter(
            target,
            CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            target,
            RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert!(stats.ccd_checks > 0);
        assert_eq!(stats.ccd_hits, 1);
        assert!(stats.velocity_impulses > 0);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 44.0).abs() < 0.001,
            "fast convex polygon should stop at capsule time of impact, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "normal velocity should be removed by the polygon/capsule CCD impact, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_convex_polygon_ccd_wakes_sleeping_polygon_target() {
        let mut world = World::default();
        let moving = spawn_dynamic_body(&mut world, 0.0, 0.0, 0.5);
        let sleeping = spawn_static_convex_polygon(
            &mut world,
            10.0,
            0.0,
            convex_polygon_collider(&[(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]),
        );
        world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            moving,
            RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let mut sleeping_body = RigidBody::dynamic_convex_polygon(
            1.0,
            convex_polygon_collider(&[(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]).vertices,
            4,
        )
        .with_material(PhysicsMaterial::new(0.0, 0.0));
        sleeping_body.is_sleeping = true;
        sleeping_body.sleep_timer_seconds = 0.5;
        world.set_rigid_body(sleeping, sleeping_body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.2,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.ccd_hits, 1);
        assert_eq!(stats.bodies_woken, 1);
        assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
        let moving_transform = world.transform(moving).unwrap();
        let sleeping_transform = world.transform(sleeping).unwrap();
        assert!(
            moving_transform.x <= sleeping_transform.x - 1.0 + 0.001,
            "polygon target CCD should keep bodies separated after impact, got moving={moving_transform:?}, sleeping={sleeping_transform:?}"
        );
        let moving_velocity = world.velocity(moving).unwrap();
        let sleeping_velocity = world.velocity(sleeping).unwrap();
        assert!(
            (moving_velocity.vx - 50.0).abs() < 0.001
                && (sleeping_velocity.vx - 50.0).abs() < 0.001,
            "polygon target CCD impact should share velocity with the sleeping target, got moving={moving_velocity:?}, sleeping={sleeping_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_oriented_box_ccd_wakes_sleeping_oriented_box_target() {
        let mut world = World::default();
        let moving = spawn_dynamic_oriented_box(
            &mut world,
            0.0,
            0.0,
            OrientedBoxCollider::new(0.5, 0.5, 0.0, false, CollisionLayer::Player),
        );
        let sleeping = spawn_dynamic_oriented_box(
            &mut world,
            10.0,
            0.0,
            OrientedBoxCollider::new(0.5, 0.5, 0.0, false, CollisionLayer::Player),
        );
        world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            moving,
            RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let mut sleeping_body =
            RigidBody::dynamic_box(1.0, 1.0, 1.0).with_material(PhysicsMaterial::new(0.0, 0.0));
        sleeping_body.is_sleeping = true;
        sleeping_body.sleep_timer_seconds = 0.5;
        world.set_rigid_body(sleeping, sleeping_body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.2,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.ccd_hits, 1);
        assert_eq!(stats.bodies_woken, 1);
        assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
        let moving_transform = world.transform(moving).unwrap();
        let sleeping_transform = world.transform(sleeping).unwrap();
        assert!(
            moving_transform.x <= sleeping_transform.x - 1.0 + 0.001,
            "oriented box CCD should keep targets separated after impact, got moving={moving_transform:?}, sleeping={sleeping_transform:?}"
        );
        let moving_velocity = world.velocity(moving).unwrap();
        let sleeping_velocity = world.velocity(sleeping).unwrap();
        assert!(
            (moving_velocity.vx - 50.0).abs() < 0.001
                && (sleeping_velocity.vx - 50.0).abs() < 0.001,
            "oriented box CCD impact should share velocity with the sleeping target, got moving={moving_velocity:?}, sleeping={sleeping_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_capsule_ccd_wakes_sleeping_capsule_target() {
        let mut world = World::default();
        let moving = spawn_dynamic_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(0.0, -0.5, 0.0, 0.5, 0.5, false, CollisionLayer::Player),
        );
        let sleeping = spawn_dynamic_capsule(
            &mut world,
            10.0,
            0.0,
            CapsuleCollider::new(0.0, -0.5, 0.0, 0.5, 0.5, false, CollisionLayer::Player),
        );
        world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            moving,
            RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let mut sleeping_body =
            RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(0.0, 0.0));
        sleeping_body.is_sleeping = true;
        sleeping_body.sleep_timer_seconds = 0.5;
        world.set_rigid_body(sleeping, sleeping_body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.2,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.ccd_hits, 1);
        assert_eq!(stats.bodies_woken, 1);
        assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
        let moving_transform = world.transform(moving).unwrap();
        let sleeping_transform = world.transform(sleeping).unwrap();
        assert!(
            moving_transform.x <= sleeping_transform.x - 1.0 + 0.001,
            "capsule CCD should keep targets separated after impact, got moving={moving_transform:?}, sleeping={sleeping_transform:?}"
        );
        let moving_velocity = world.velocity(moving).unwrap();
        let sleeping_velocity = world.velocity(sleeping).unwrap();
        assert!(
            (moving_velocity.vx - 50.0).abs() < 0.001
                && (sleeping_velocity.vx - 50.0).abs() < 0.001,
            "capsule CCD impact should share velocity with the sleeping target, got moving={moving_velocity:?}, sleeping={sleeping_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_ccd_repeats_for_remaining_step_time() {
        let mut world = World::default();
        let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        world.set_velocity(
            mover,
            Velocity {
                vx: 100.0,
                vy: 100.0,
            },
        );
        world.set_rigid_body(
            mover,
            RigidBody::dynamic_box(1.0, 2.0, 2.0).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let vertical_wall = spawn_kinematic_body_with_size(
            &mut world,
            50.0,
            40.0,
            CollisionLayer::Wall,
            false,
            5.0,
            100.0,
        );
        let horizontal_wall = spawn_kinematic_body_with_size(
            &mut world,
            40.0,
            70.0,
            CollisionLayer::Wall,
            false,
            100.0,
            5.0,
        );
        for wall in [vertical_wall, horizontal_wall] {
            world.set_rigid_body(
                wall,
                RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
            );
        }

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.ccd_hits, 2);
        let transform = world.transform(mover).unwrap();
        assert!(
            (transform.x - 44.0).abs() < 0.001 && (transform.y - 64.0).abs() < 0.001,
            "multi-TOI CCD should stop against both walls, got {transform:?}"
        );
        let velocity = world.velocity(mover).unwrap();
        assert!(
            velocity.vx.abs() < 0.001 && velocity.vy.abs() < 0.001,
            "both normal components should be removed after repeated CCD hits, got {velocity:?}"
        );
    }

    #[test]
    fn rigid_body_circle_ccd_wakes_sleeping_circle_target() {
        let mut world = World::default();
        let moving = spawn_dynamic_body(&mut world, 0.0, 0.0, 0.5);
        let sleeping = spawn_dynamic_body(&mut world, 10.0, 0.0, 0.5);
        for entity in [moving, sleeping] {
            world.set_circle_collider(
                entity,
                crate::components::CircleCollider {
                    radius: 0.5,
                    offset_x: 0.0,
                    offset_y: 0.0,
                    enabled: true,
                    is_trigger: false,
                    layer: CollisionLayer::Player,
                },
            );
        }
        world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            moving,
            RigidBody::dynamic_circle(1.0, 0.5).with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        let mut sleeping_body =
            RigidBody::dynamic_circle(1.0, 0.5).with_material(PhysicsMaterial::new(0.0, 0.0));
        sleeping_body.is_sleeping = true;
        sleeping_body.sleep_timer_seconds = 0.5;
        world.set_rigid_body(sleeping, sleeping_body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.2,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.ccd_hits, 1);
        assert_eq!(stats.bodies_woken, 1);
        assert!(!world.rigid_body(sleeping).unwrap().is_sleeping);
        let moving_transform = world.transform(moving).unwrap();
        let sleeping_transform = world.transform(sleeping).unwrap();
        assert!(
            moving_transform.x <= sleeping_transform.x - 1.0 + 0.001,
            "circle CCD should keep targets separated after impact, got moving={moving_transform:?}, sleeping={sleeping_transform:?}"
        );
        let moving_velocity = world.velocity(moving).unwrap();
        let sleeping_velocity = world.velocity(sleeping).unwrap();
        assert!(
            (moving_velocity.vx - 50.0).abs() < 0.001
                && (sleeping_velocity.vx - 50.0).abs() < 0.001,
            "circle CCD impact should share velocity with the sleeping target, got moving={moving_velocity:?}, sleeping={sleeping_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_splits_impulse_between_dynamic_bodies_by_mass() {
        let mut world = World::default();
        let left = spawn_dynamic_body(&mut world, -2.0, 0.0, 2.0);
        let right = spawn_dynamic_body(&mut world, 2.0, 0.0, 2.0);
        world.set_circle_collider(
            left,
            crate::components::CircleCollider {
                radius: 2.0,
                offset_x: 0.0,
                offset_y: 0.0,
                enabled: true,
                is_trigger: false,
                layer: CollisionLayer::Player,
            },
        );
        world.set_circle_collider(
            right,
            crate::components::CircleCollider {
                radius: 2.0,
                offset_x: 0.0,
                offset_y: 0.0,
                enabled: true,
                is_trigger: false,
                layer: CollisionLayer::Player,
            },
        );
        world.set_velocity(left, Velocity { vx: 10.0, vy: 0.0 });
        world.set_velocity(right, Velocity { vx: -2.0, vy: 0.0 });
        world.set_rigid_body(
            left,
            RigidBody::dynamic_circle(1.0, 2.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
        );
        world.set_rigid_body(
            right,
            RigidBody::dynamic_circle(3.0, 2.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
        );

        PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let left_velocity = world.velocity(left).unwrap();
        let right_velocity = world.velocity(right).unwrap();
        assert!(
            (left_velocity.vx + 8.0).abs() < 0.01,
            "left velocity changed to {left_velocity:?}, right velocity {right_velocity:?}"
        );
        assert!(
            (right_velocity.vx - 4.0).abs() < 0.01,
            "left velocity {left_velocity:?}, right velocity changed to {right_velocity:?}"
        );
    }

    #[test]
    fn rigid_body_step_ignores_trigger_contacts() {
        let mut world = World::default();
        let mover = spawn_dynamic_body(&mut world, 0.0, 0.0, 5.0);
        world.set_velocity(mover, Velocity { vx: 10.0, vy: 0.0 });
        world.set_rigid_body(mover, RigidBody::dynamic(1.0));
        spawn_kinematic_body(&mut world, 8.0, 0.0, CollisionLayer::Wall, true);

        PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            1.0,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 1.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(world.velocity(mover), Some(Velocity { vx: 10.0, vy: 0.0 }));
    }

    #[test]
    fn distance_joint_moves_dynamic_body_to_static_rest_length() {
        let mut world = World::default();
        let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_position_corrections, 1);
        assert_eq!(
            world.transform(anchor),
            Some(Transform2D { x: 0.0, y: 0.0 })
        );
        assert_eq!(world.transform(body), Some(Transform2D { x: 4.0, y: 0.0 }));
    }

    #[test]
    fn distance_joint_splits_position_correction_by_inverse_mass() {
        let mut world = World::default();
        let left = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
        let right = spawn_dynamic_body(&mut world, 8.0, 0.0, 1.0);
        world.set_rigid_body(left, RigidBody::dynamic(1.0));
        world.set_rigid_body(right, RigidBody::dynamic(3.0));
        world.add_distance_joint(DistanceJoint::new(left, right, 4.0));

        PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let left_transform = world.transform(left).unwrap();
        let right_transform = world.transform(right).unwrap();
        assert!((left_transform.x - 3.0).abs() < 0.001);
        assert!((right_transform.x - 7.0).abs() < 0.001);
        assert!((right_transform.x - left_transform.x - 4.0).abs() < 0.001);
    }

    #[test]
    fn distance_joint_damping_reduces_axis_relative_velocity() {
        let mut world = World::default();
        let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
        world.set_aabb_collider(
            anchor,
            AabbCollider::new(5.0, 5.0, true, CollisionLayer::Wall),
        );
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = spawn_dynamic_body(&mut world, 4.0, 0.0, 1.0);
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
        world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0).with_damping(1.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert_eq!(stats.constraint_velocity_corrections, 1);
        assert!(velocity.vx.abs() < 0.001);
        assert!(velocity.vy.abs() < 0.001);
    }

    #[test]
    fn distance_joint_breaks_when_error_exceeds_break_distance() {
        let mut world = World::default();
        let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 1);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.distance_joint_count(), 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
    }

    #[test]
    fn distance_joint_break_distance_allows_smaller_error() {
        let mut world = World::default();
        let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = spawn_dynamic_body(&mut world, 5.0, 0.0, 1.0);
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 0);
        assert_eq!(stats.constraint_position_corrections, 1);
        assert_eq!(world.distance_joint_count(), 1);
        assert_eq!(world.transform(body), Some(Transform2D { x: 4.0, y: 0.0 }));
    }

    #[test]
    fn distance_joint_skips_despawned_entities() {
        let mut world = World::default();
        let anchor = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Wall, false);
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = spawn_dynamic_body(&mut world, 10.0, 0.0, 1.0);
        world.add_distance_joint(DistanceJoint::new(anchor, body, 4.0));
        world.despawn(body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.distance_joint_count(), 1);
    }

    #[test]
    fn pulley_joint_moves_dynamic_body_to_weighted_rest_length() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_pulley_joint(
            PulleyJoint::new(anchor, body, 8.0)
                .with_ground_anchor_a(0.0, 0.0)
                .with_ground_anchor_b(0.0, 0.0)
                .with_ratio(2.0),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_position_corrections, 1);
        assert_eq!(
            world.transform(anchor),
            Some(Transform2D { x: 0.0, y: 0.0 })
        );
        let body_transform = world.transform(body).unwrap();
        assert!(
            (body_transform.x - 4.0).abs() < 0.001,
            "ratio 2 pulley should move the body to length 4, got {body_transform:?}"
        );
    }

    #[test]
    fn pulley_joint_breaks_when_weighted_length_error_exceeds_break_distance() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_pulley_joint(
            PulleyJoint::new(anchor, body, 4.0)
                .with_ground_anchor_a(0.0, 0.0)
                .with_ground_anchor_b(0.0, 0.0)
                .with_break_distance(2.0),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 1);
        assert_eq!(world.pulley_joint_count(), 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
    }

    #[test]
    fn rope_joint_clamps_dynamic_body_to_max_length() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_rope_joint(RopeJoint::new(anchor, body, 4.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_position_corrections, 1);
        assert_eq!(
            world.transform(anchor),
            Some(Transform2D { x: 0.0, y: 0.0 })
        );
        assert_eq!(world.transform(body), Some(Transform2D { x: 4.0, y: 0.0 }));
    }

    #[test]
    fn rope_joint_allows_slack_under_max_length() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 3.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_rope_joint(RopeJoint::new(anchor, body, 4.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 3.0, y: 0.0 }));
    }

    #[test]
    fn rope_joint_damping_reduces_separating_velocity_at_limit() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
        world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_rope_joint(RopeJoint::new(anchor, body, 4.0).with_damping(1.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert_eq!(stats.constraint_velocity_corrections, 1);
        assert!(velocity.vx.abs() < 0.001);
        assert!(velocity.vy.abs() < 0.001);
        assert_eq!(world.transform(body), Some(Transform2D { x: 4.0, y: 0.0 }));
    }

    #[test]
    fn rope_joint_breaks_when_extension_exceeds_break_distance() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_rope_joint(RopeJoint::new(anchor, body, 4.0).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 1);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.rope_joint_count(), 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
    }

    #[test]
    fn rope_joint_break_distance_allows_smaller_extension() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 5.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_rope_joint(RopeJoint::new(anchor, body, 4.0).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 0);
        assert_eq!(stats.constraint_position_corrections, 1);
        assert_eq!(world.rope_joint_count(), 1);
        assert_eq!(world.transform(body), Some(Transform2D { x: 4.0, y: 0.0 }));
    }

    #[test]
    fn rope_joint_break_distance_ignores_slack() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 2.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_rope_joint(RopeJoint::new(anchor, body, 4.0).with_break_distance(0.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.rope_joint_count(), 1);
        assert_eq!(world.transform(body), Some(Transform2D { x: 2.0, y: 0.0 }));
    }

    #[test]
    fn rope_joint_skips_despawned_entities() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_rope_joint(RopeJoint::new(anchor, body, 4.0));
        world.despawn(body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.rope_joint_count(), 1);
    }

    #[test]
    fn spring_joint_pulls_stretched_body_toward_rest_length() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_stiffness(0.5));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert_eq!(stats.constraint_velocity_corrections, 1);
        assert!(
            (velocity.vx + 30.0).abs() < 0.001,
            "stretched spring should pull body toward the anchor, got {velocity:?}"
        );
        assert!(velocity.vy.abs() < 0.001);
        assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
    }

    #[test]
    fn spring_joint_stiffness_is_split_across_velocity_iterations() {
        fn run_with_iterations(velocity_iterations: u32) -> (Velocity, RigidBodyStepStats) {
            let mut world = World::default();
            let anchor = world.spawn_entity();
            world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
            world.set_rigid_body(anchor, RigidBody::static_body());
            let body = world.spawn_entity();
            world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
            world.set_rigid_body(body, RigidBody::dynamic(1.0));
            world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_stiffness(0.5));

            let stats = PhysicsSystem::step_rigid_bodies_with_config(
                &mut world,
                0.1,
                RigidBodyStepConfig {
                    gravity: Velocity::default(),
                    velocity_iterations,
                    position_iterations: 1,
                    position_correction_percent: 0.0,
                    position_correction_slop: 0.0,
                    restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                    contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                    max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                    contact_split_impulse: false,
                },
            );

            (world.velocity(body).unwrap(), stats)
        }

        let (single_iteration_velocity, single_iteration_stats) = run_with_iterations(1);
        let (multi_iteration_velocity, multi_iteration_stats) = run_with_iterations(4);

        assert_eq!(single_iteration_stats.constraint_velocity_corrections, 1);
        assert_eq!(multi_iteration_stats.constraint_velocity_corrections, 4);
        assert!(
            (single_iteration_velocity.vx - multi_iteration_velocity.vx).abs() < 0.001,
            "spring stiffness should not scale with velocity iteration count: single={single_iteration_velocity:?}, multi={multi_iteration_velocity:?}"
        );
        assert!(
            (single_iteration_velocity.vy - multi_iteration_velocity.vy).abs() < 0.001,
            "spring stiffness should preserve axis velocity across iteration counts: single={single_iteration_velocity:?}, multi={multi_iteration_velocity:?}"
        );
    }

    #[test]
    fn spring_joint_pushes_compressed_body_away_from_rest_length() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 2.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_stiffness(0.5));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert_eq!(stats.constraint_velocity_corrections, 1);
        assert!(
            (velocity.vx - 10.0).abs() < 0.001,
            "compressed spring should push body away from the anchor, got {velocity:?}"
        );
        assert!(velocity.vy.abs() < 0.001);
    }

    #[test]
    fn spring_joint_damping_reduces_axis_relative_velocity_at_rest_length() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
        world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_spring_joint(
            SpringJoint::new(anchor, body, 4.0)
                .with_stiffness(0.0)
                .with_damping(0.5),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let velocity = world.velocity(body).unwrap();
        assert_eq!(stats.constraint_velocity_corrections, 1);
        assert!(
            (velocity.vx - 5.0).abs() < 0.001,
            "damped spring should reduce relative axis velocity, got {velocity:?}"
        );
        assert!(velocity.vy.abs() < 0.001);
    }

    #[test]
    fn spring_joint_breaks_when_stretch_error_exceeds_break_distance() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 1);
        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(world.spring_joint_count(), 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
    }

    #[test]
    fn spring_joint_breaks_when_compression_error_exceeds_break_distance() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 1.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 1);
        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(world.spring_joint_count(), 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 1.0, y: 0.0 }));
    }

    #[test]
    fn spring_joint_break_distance_allows_smaller_error() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 5.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 0);
        assert_eq!(stats.constraint_velocity_corrections, 1);
        assert_eq!(world.spring_joint_count(), 1);
    }

    #[test]
    fn spring_joint_skips_despawned_entities() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_spring_joint(SpringJoint::new(anchor, body, 4.0));
        world.despawn(body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.spring_joint_count(), 1);
    }

    #[test]
    fn revolute_joint_moves_dynamic_anchor_to_static_anchor() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_revolute_joint(RevoluteJoint::new(anchor, body));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        assert_eq!(stats.constraint_velocity_corrections, 1);
        assert_eq!(stats.constraint_position_corrections, 1);
        assert!(
            transform.x.abs() < 0.001,
            "revolute joint should pin body x to anchor, got {transform:?}"
        );
        assert!(
            transform.y.abs() < 0.001,
            "revolute joint should pin body y to anchor, got {transform:?}"
        );
    }

    #[test]
    fn revolute_joint_breaks_when_anchor_error_exceeds_break_distance() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_revolute_joint(RevoluteJoint::new(anchor, body).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 1);
        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.revolute_joint_count(), 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
    }

    #[test]
    fn revolute_joint_break_distance_allows_smaller_anchor_error() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 1.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_revolute_joint(RevoluteJoint::new(anchor, body).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 0);
        assert!(stats.constraint_velocity_corrections > 0);
        assert!(stats.constraint_position_corrections > 0);
        assert_eq!(world.revolute_joint_count(), 1);
    }

    #[test]
    fn revolute_joint_splits_position_correction_by_inverse_mass() {
        let mut world = World::default();
        let left = world.spawn_entity();
        world.set_transform(left, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(left, RigidBody::dynamic(1.0));
        let right = world.spawn_entity();
        world.set_transform(right, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(right, RigidBody::dynamic(1.0));
        world.add_revolute_joint(RevoluteJoint::new(left, right));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_position_corrections, 1);
        assert_eq!(world.transform(left), Some(Transform2D { x: 5.0, y: 0.0 }));
        assert_eq!(world.transform(right), Some(Transform2D { x: 5.0, y: 0.0 }));
    }

    #[test]
    fn revolute_joint_damping_reduces_off_center_anchor_velocity() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: 0.0 });
        world.set_angular_velocity(
            body,
            AngularVelocity {
                radians_per_second: 10.0,
            },
        );
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = RevoluteJoint::new(anchor, body)
            .with_local_anchor_b(1.0, 0.0)
            .with_stiffness(0.0)
            .with_damping(1.0);

        assert!(solve_revolute_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let velocity = world.velocity(body).unwrap();
        let angular_velocity = world.angular_velocity(body).unwrap();
        assert!(velocity.vx.abs() < 0.001);
        assert!(
            (velocity.vy + 5.0).abs() < 0.001,
            "anchor damping should add balancing linear velocity, got {velocity:?}"
        );
        assert!(
            (angular_velocity.radians_per_second - 5.0).abs() < 0.001,
            "anchor damping should reduce angular velocity, got {angular_velocity:?}"
        );
    }

    #[test]
    fn revolute_joint_position_constraint_uses_local_anchors_and_rotation() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = RevoluteJoint::new(anchor, body)
            .with_local_anchor_a(0.0, 1.0)
            .with_local_anchor_b(1.0, 0.0);
        let before_error = revolute_joint_constraint_context(&world, joint)
            .map(|context| velocity_len_squared(context.error))
            .unwrap();

        assert!(solve_revolute_joint_position_constraint(&mut world, joint));

        let after_error = revolute_joint_constraint_context(&world, joint)
            .map(|context| velocity_len_squared(context.error))
            .unwrap();
        let rotation = world.rotation(body).unwrap();
        assert!(
            after_error < before_error,
            "local anchor position correction should reduce anchor error: before={before_error}, after={after_error}"
        );
        assert!(
            rotation.radians > 0.0,
            "off-center correction should rotate the dynamic body, got {rotation:?}"
        );
    }

    #[test]
    fn revolute_joint_clamps_upper_angle_limit() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(anchor, Rotation2D { radians: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: 1.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = RevoluteJoint::new(anchor, body).with_angle_limits(-0.5, 0.5);

        assert!(solve_revolute_joint_position_constraint(&mut world, joint));

        let rotation = world.rotation(body).unwrap();
        assert!(
            (rotation.radians - 0.5).abs() < 0.001,
            "upper angle limit should clamp body rotation, got {rotation:?}"
        );
    }

    #[test]
    fn revolute_joint_clamps_lower_angle_limit() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(anchor, Rotation2D { radians: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: -1.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = RevoluteJoint::new(anchor, body).with_angle_limits(-0.5, 0.5);

        assert!(solve_revolute_joint_position_constraint(&mut world, joint));

        let rotation = world.rotation(body).unwrap();
        assert!(
            (rotation.radians + 0.5).abs() < 0.001,
            "lower angle limit should clamp body rotation, got {rotation:?}"
        );
    }

    #[test]
    fn revolute_joint_angle_limit_damping_reduces_outward_angular_velocity() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(anchor, Rotation2D { radians: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: 0.75 });
        world.set_angular_velocity(
            body,
            AngularVelocity {
                radians_per_second: 10.0,
            },
        );
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = RevoluteJoint::new(anchor, body)
            .with_angle_limits(-0.5, 0.5)
            .with_stiffness(0.0)
            .with_damping(1.0);

        assert!(solve_revolute_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let angular_velocity = world.angular_velocity(body).unwrap();
        assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "angle limit damping should remove outward angular velocity, got {angular_velocity:?}"
        );
    }

    #[test]
    fn revolute_joint_angle_limit_allows_inward_angular_velocity() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(anchor, Rotation2D { radians: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: 0.75 });
        world.set_angular_velocity(
            body,
            AngularVelocity {
                radians_per_second: -4.0,
            },
        );
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = RevoluteJoint::new(anchor, body)
            .with_angle_limits(-0.5, 0.5)
            .with_stiffness(0.0)
            .with_damping(1.0);

        assert!(!solve_revolute_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let angular_velocity = world.angular_velocity(body).unwrap();
        assert_eq!(
            angular_velocity,
            AngularVelocity {
                radians_per_second: -4.0,
            }
        );
    }

    #[test]
    fn revolute_joint_motor_drives_relative_angular_velocity() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(anchor, Rotation2D { radians: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = RevoluteJoint::new(anchor, body)
            .with_motor(5.0, 100.0)
            .with_stiffness(0.0)
            .with_damping(0.0);

        assert!(solve_revolute_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let angular_velocity = world.angular_velocity(body).unwrap();
        assert!(
            (angular_velocity.radians_per_second - 5.0).abs() < 0.001,
            "revolute motor should drive angular velocity to target speed, got {angular_velocity:?}"
        );
    }

    #[test]
    fn revolute_joint_motor_torque_limits_angular_impulse() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(anchor, Rotation2D { radians: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = RevoluteJoint::new(anchor, body)
            .with_motor(5.0, 10.0)
            .with_stiffness(0.0)
            .with_damping(0.0);

        assert!(solve_revolute_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let angular_velocity = world.angular_velocity(body).unwrap();
        assert!(
            (angular_velocity.radians_per_second - 1.0).abs() < 0.001,
            "max motor torque should clamp per-step angular impulse, got {angular_velocity:?}"
        );
    }

    #[test]
    fn revolute_joint_motor_respects_angle_limit_direction() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(anchor, Rotation2D { radians: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: 0.5 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let outward_joint = RevoluteJoint::new(anchor, body)
            .with_angle_limits(-0.5, 0.5)
            .with_motor(5.0, 100.0)
            .with_stiffness(0.0)
            .with_damping(0.0);

        assert!(!solve_revolute_joint_velocity_constraint(
            &mut world,
            outward_joint,
            0.1,
            1
        ));
        assert_eq!(
            world.angular_velocity(body),
            Some(AngularVelocity::default())
        );

        let inward_joint = RevoluteJoint::new(anchor, body)
            .with_angle_limits(-0.5, 0.5)
            .with_motor(-5.0, 100.0)
            .with_stiffness(0.0)
            .with_damping(0.0);

        assert!(solve_revolute_joint_velocity_constraint(
            &mut world,
            inward_joint,
            0.1,
            1
        ));
        let angular_velocity = world.angular_velocity(body).unwrap();
        assert!(
            (angular_velocity.radians_per_second + 5.0).abs() < 0.001,
            "revolute motor should allow inward angular velocity at upper limit, got {angular_velocity:?}"
        );
    }

    #[test]
    fn revolute_joint_skips_despawned_entities() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_revolute_joint(RevoluteJoint::new(anchor, body));
        world.despawn(body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.revolute_joint_count(), 1);
    }

    #[test]
    fn gear_joint_damping_enforces_angular_velocity_ratio() {
        let mut world = World::default();
        let gear_a = world.spawn_entity();
        world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
        world.set_angular_velocity(
            gear_a,
            AngularVelocity {
                radians_per_second: 3.0,
            },
        );
        world.set_rigid_body(gear_a, RigidBody::dynamic(1.0).with_inertia(1.0));
        let gear_b = world.spawn_entity();
        world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
        world.set_angular_velocity(
            gear_b,
            AngularVelocity {
                radians_per_second: 0.0,
            },
        );
        world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = GearJoint::new(gear_a, gear_b, 2.0)
            .with_stiffness(0.0)
            .with_damping(1.0);

        assert!(solve_gear_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let angular_velocity_a = world.angular_velocity(gear_a).unwrap().radians_per_second;
        let angular_velocity_b = world.angular_velocity(gear_b).unwrap().radians_per_second;
        assert!(
            (angular_velocity_b + 2.0 * angular_velocity_a).abs() < 0.001,
            "gear joint should enforce omega_b + ratio * omega_a = 0, got a={angular_velocity_a}, b={angular_velocity_b}"
        );
    }

    #[test]
    fn gear_joint_position_constraint_enforces_rotation_ratio() {
        let mut world = World::default();
        let gear_a = world.spawn_entity();
        world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_a, Rotation2D { radians: 0.25 });
        world.set_rigid_body(gear_a, RigidBody::static_body());
        let gear_b = world.spawn_entity();
        world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_b, Rotation2D { radians: 1.0 });
        world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = GearJoint::new(gear_a, gear_b, 2.0);

        assert!(solve_gear_joint_position_constraint(&mut world, joint));

        let rotation_b = world.rotation(gear_b).unwrap();
        assert!(
            (rotation_b.radians + 0.5).abs() < 0.001,
            "gear joint should rotate body B to satisfy theta_b + ratio * theta_a = reference, got {rotation_b:?}"
        );
    }

    #[test]
    fn gear_joint_reference_angle_preserves_rotation_offset() {
        let mut world = World::default();
        let gear_a = world.spawn_entity();
        world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_a, Rotation2D { radians: 0.25 });
        world.set_rigid_body(gear_a, RigidBody::static_body());
        let gear_b = world.spawn_entity();
        world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_b, Rotation2D { radians: 1.0 });
        world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = GearJoint::new(gear_a, gear_b, 2.0).with_reference_angle(1.5);

        assert!(!solve_gear_joint_position_constraint(&mut world, joint));
        assert_eq!(world.rotation(gear_b), Some(Rotation2D { radians: 1.0 }));
    }

    #[test]
    fn gear_joint_breaks_when_angle_error_exceeds_break_angle() {
        let mut world = World::default();
        let gear_a = world.spawn_entity();
        world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_a, Rotation2D { radians: 0.0 });
        world.set_rigid_body(gear_a, RigidBody::static_body());
        let gear_b = world.spawn_entity();
        world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_b, Rotation2D { radians: 3.0 });
        world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_gear_joint(GearJoint::new(gear_a, gear_b, 1.0).with_break_angle(1.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 1);
        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.gear_joint_count(), 0);
        assert_eq!(world.rotation(gear_b), Some(Rotation2D { radians: 3.0 }));
    }

    #[test]
    fn gear_joint_break_angle_allows_smaller_angle_error() {
        let mut world = World::default();
        let gear_a = world.spawn_entity();
        world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_a, Rotation2D { radians: 0.0 });
        world.set_rigid_body(gear_a, RigidBody::static_body());
        let gear_b = world.spawn_entity();
        world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_b, Rotation2D { radians: 0.5 });
        world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_gear_joint(GearJoint::new(gear_a, gear_b, 1.0).with_break_angle(1.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 0);
        assert!(stats.constraint_velocity_corrections > 0);
        assert!(stats.constraint_position_corrections > 0);
        assert_eq!(world.gear_joint_count(), 1);
    }

    #[test]
    fn gear_joint_break_angle_respects_reference_angle() {
        let mut world = World::default();
        let gear_a = world.spawn_entity();
        world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_a, Rotation2D { radians: 0.25 });
        world.set_rigid_body(gear_a, RigidBody::static_body());
        let gear_b = world.spawn_entity();
        world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_b, Rotation2D { radians: 1.0 });
        world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_gear_joint(
            GearJoint::new(gear_a, gear_b, 2.0)
                .with_reference_angle(1.5)
                .with_break_angle(0.1),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 0);
        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.gear_joint_count(), 1);
    }

    #[test]
    fn gear_joint_skips_despawned_entities() {
        let mut world = World::default();
        let gear_a = world.spawn_entity();
        world.set_transform(gear_a, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_a, Rotation2D { radians: 0.0 });
        world.set_rigid_body(gear_a, RigidBody::static_body());
        let gear_b = world.spawn_entity();
        world.set_transform(gear_b, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(gear_b, Rotation2D { radians: 1.0 });
        world.set_rigid_body(gear_b, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_gear_joint(GearJoint::new(gear_a, gear_b, 1.0));
        world.despawn(gear_b);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.gear_joint_count(), 1);
    }

    #[test]
    fn prismatic_joint_allows_axis_translation() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_prismatic_joint(PrismaticJoint::new(anchor, body));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert!(
            (transform.x - 10.0).abs() < 0.001,
            "slider should allow translation on local axis, got {transform:?}"
        );
        assert!(
            transform.y.abs() < 0.001,
            "slider should not add perpendicular drift, got {transform:?}"
        );
    }

    #[test]
    fn prismatic_joint_break_distance_allows_axis_translation() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_prismatic_joint(PrismaticJoint::new(anchor, body).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 0);
        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.prismatic_joint_count(), 1);
        assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
    }

    #[test]
    fn prismatic_joint_allows_translation_inside_limits() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 3.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_prismatic_joint(
            PrismaticJoint::new(anchor, body).with_translation_limits(-4.0, 4.0),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 3.0, y: 0.0 }));
    }

    #[test]
    fn prismatic_joint_clamps_upper_translation_limit() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_prismatic_joint(
            PrismaticJoint::new(anchor, body).with_translation_limits(-4.0, 4.0),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        assert_eq!(stats.constraint_velocity_corrections, 1);
        assert_eq!(stats.constraint_position_corrections, 1);
        assert!(
            (transform.x - 4.0).abs() < 0.001,
            "slider should clamp upper translation limit, got {transform:?}"
        );
        assert!(transform.y.abs() < 0.001);
    }

    #[test]
    fn prismatic_joint_clamps_lower_translation_limit() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: -10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_prismatic_joint(
            PrismaticJoint::new(anchor, body).with_translation_limits(-4.0, 4.0),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        assert_eq!(stats.constraint_velocity_corrections, 1);
        assert_eq!(stats.constraint_position_corrections, 1);
        assert!(
            (transform.x + 4.0).abs() < 0.001,
            "slider should clamp lower translation limit, got {transform:?}"
        );
        assert!(transform.y.abs() < 0.001);
    }

    #[test]
    fn prismatic_joint_translation_limit_uses_rotated_local_axis() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(
            anchor,
            Rotation2D {
                radians: std::f32::consts::FRAC_PI_2,
            },
        );
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 10.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_prismatic_joint(
            PrismaticJoint::new(anchor, body).with_translation_limits(-4.0, 4.0),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        assert_eq!(stats.constraint_position_corrections, 1);
        assert!(transform.x.abs() < 0.001);
        assert!(
            (transform.y - 4.0).abs() < 0.001,
            "rotated slider axis should clamp world y translation, got {transform:?}"
        );
    }

    #[test]
    fn prismatic_joint_corrects_perpendicular_drift() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 5.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_prismatic_joint(PrismaticJoint::new(anchor, body));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        assert_eq!(stats.constraint_velocity_corrections, 1);
        assert_eq!(stats.constraint_position_corrections, 1);
        assert!(
            (transform.x - 10.0).abs() < 0.001,
            "slider correction should preserve axis translation, got {transform:?}"
        );
        assert!(
            transform.y.abs() < 0.001,
            "slider should remove perpendicular drift, got {transform:?}"
        );
    }

    #[test]
    fn prismatic_joint_breaks_when_perpendicular_anchor_error_exceeds_break_distance() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 10.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_prismatic_joint(PrismaticJoint::new(anchor, body).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 1);
        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.prismatic_joint_count(), 0);
        assert_eq!(world.transform(body), Some(Transform2D { x: 0.0, y: 10.0 }));
    }

    #[test]
    fn prismatic_joint_break_distance_allows_smaller_perpendicular_anchor_error() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 1.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_prismatic_joint(PrismaticJoint::new(anchor, body).with_break_distance(2.0));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 0);
        assert!(stats.constraint_velocity_corrections > 0);
        assert!(stats.constraint_position_corrections > 0);
        assert_eq!(world.prismatic_joint_count(), 1);
    }

    #[test]
    fn prismatic_joint_local_axis_rotates_with_entity_a() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(
            anchor,
            Rotation2D {
                radians: std::f32::consts::FRAC_PI_2,
            },
        );
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 5.0, y: 10.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        world.add_prismatic_joint(PrismaticJoint::new(anchor, body));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        assert_eq!(stats.constraint_position_corrections, 1);
        assert!(
            transform.x.abs() < 0.001,
            "rotated local axis should constrain world x drift, got {transform:?}"
        );
        assert!(
            (transform.y - 10.0).abs() < 0.001,
            "rotated local axis should allow world y translation, got {transform:?}"
        );
    }

    #[test]
    fn prismatic_joint_locks_relative_angle() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(anchor, Rotation2D { radians: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: 0.5 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = PrismaticJoint::new(anchor, body).with_stiffness(0.0);

        assert!(solve_prismatic_joint_position_constraint(&mut world, joint));

        let rotation = world.rotation(body).unwrap();
        assert!(
            rotation.radians.abs() < 0.001,
            "slider should lock relative angle to reference angle, got {rotation:?}"
        );
    }

    #[test]
    fn prismatic_joint_limit_damping_reduces_outward_axis_velocity() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 6.0, y: 0.0 });
        world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = PrismaticJoint::new(anchor, body)
            .with_translation_limits(-4.0, 4.0)
            .with_stiffness(0.0)
            .with_damping(1.0)
            .with_angular_stiffness(0.0)
            .with_angular_damping(0.0);

        assert!(solve_prismatic_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let velocity = world.velocity(body).unwrap();
        assert!(
            velocity.vx.abs() < 0.001,
            "limit damping should remove outward axis velocity, got {velocity:?}"
        );
        assert!(velocity.vy.abs() < 0.001);
    }

    #[test]
    fn prismatic_joint_motor_drives_axis_velocity() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = PrismaticJoint::new(anchor, body)
            .with_motor(5.0, 100.0)
            .with_stiffness(0.0)
            .with_damping(0.0)
            .with_angular_stiffness(0.0)
            .with_angular_damping(0.0);

        assert!(solve_prismatic_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let velocity = world.velocity(body).unwrap();
        assert!(
            (velocity.vx - 5.0).abs() < 0.001,
            "slider motor should drive axis velocity to target speed, got {velocity:?}"
        );
        assert!(velocity.vy.abs() < 0.001);
    }

    #[test]
    fn prismatic_joint_motor_force_limits_axis_impulse() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = PrismaticJoint::new(anchor, body)
            .with_motor(5.0, 10.0)
            .with_stiffness(0.0)
            .with_damping(0.0)
            .with_angular_stiffness(0.0)
            .with_angular_damping(0.0);

        assert!(solve_prismatic_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let velocity = world.velocity(body).unwrap();
        assert!(
            (velocity.vx - 1.0).abs() < 0.001,
            "max motor force should clamp per-step axis impulse, got {velocity:?}"
        );
        assert!(velocity.vy.abs() < 0.001);
    }

    #[test]
    fn prismatic_joint_motor_uses_rotated_local_axis() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(
            anchor,
            Rotation2D {
                radians: std::f32::consts::FRAC_PI_2,
            },
        );
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = PrismaticJoint::new(anchor, body)
            .with_motor(5.0, 100.0)
            .with_stiffness(0.0)
            .with_damping(0.0)
            .with_angular_stiffness(0.0)
            .with_angular_damping(0.0);

        assert!(solve_prismatic_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let velocity = world.velocity(body).unwrap();
        assert!(velocity.vx.abs() < 0.001);
        assert!(
            (velocity.vy - 5.0).abs() < 0.001,
            "rotated slider motor should drive world y velocity, got {velocity:?}"
        );
    }

    #[test]
    fn prismatic_joint_motor_respects_translation_limit_direction() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let outward_joint = PrismaticJoint::new(anchor, body)
            .with_translation_limits(-4.0, 4.0)
            .with_motor(5.0, 100.0)
            .with_stiffness(0.0)
            .with_damping(0.0)
            .with_angular_stiffness(0.0)
            .with_angular_damping(0.0);

        assert!(!solve_prismatic_joint_velocity_constraint(
            &mut world,
            outward_joint,
            0.1,
            1
        ));
        assert_eq!(world.velocity(body), Some(Velocity::default()));

        let inward_joint = PrismaticJoint::new(anchor, body)
            .with_translation_limits(-4.0, 4.0)
            .with_motor(-5.0, 100.0)
            .with_stiffness(0.0)
            .with_damping(0.0)
            .with_angular_stiffness(0.0)
            .with_angular_damping(0.0);

        assert!(solve_prismatic_joint_velocity_constraint(
            &mut world,
            inward_joint,
            0.1,
            1
        ));
        let velocity = world.velocity(body).unwrap();
        assert!(
            (velocity.vx + 5.0).abs() < 0.001,
            "slider motor should allow inward velocity at upper limit, got {velocity:?}"
        );
    }

    #[test]
    fn prismatic_joint_damping_reduces_perpendicular_anchor_velocity() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_velocity(body, Velocity { vx: 0.0, vy: 10.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = PrismaticJoint::new(anchor, body)
            .with_stiffness(0.0)
            .with_damping(1.0)
            .with_angular_stiffness(0.0)
            .with_angular_damping(0.0);

        assert!(solve_prismatic_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let velocity = world.velocity(body).unwrap();
        assert!(velocity.vx.abs() < 0.001);
        assert!(
            velocity.vy.abs() < 0.001,
            "slider damping should remove perpendicular anchor velocity, got {velocity:?}"
        );
    }

    #[test]
    fn prismatic_joint_angular_damping_reduces_relative_angular_velocity() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 0.0, y: 0.0 });
        world.set_angular_velocity(
            body,
            AngularVelocity {
                radians_per_second: 10.0,
            },
        );
        world.set_rigid_body(body, RigidBody::dynamic(1.0).with_inertia(1.0));
        let joint = PrismaticJoint::new(anchor, body)
            .with_stiffness(0.0)
            .with_damping(0.0)
            .with_angular_stiffness(0.0)
            .with_angular_damping(1.0);

        assert!(solve_prismatic_joint_velocity_constraint(
            &mut world, joint, 0.1, 1
        ));

        let angular_velocity = world.angular_velocity(body).unwrap();
        assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "slider angular damping should remove relative angular velocity, got {angular_velocity:?}"
        );
    }

    #[test]
    fn prismatic_joint_skips_despawned_entities() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 5.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_prismatic_joint(PrismaticJoint::new(anchor, body));
        world.despawn(body);

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.constraint_velocity_corrections, 0);
        assert_eq!(stats.constraint_position_corrections, 0);
        assert_eq!(world.prismatic_joint_count(), 1);
    }

    #[test]
    fn weld_joint_locks_local_anchor_and_relative_angle() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(anchor, Rotation2D { radians: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());

        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 2.0 });
        world.set_rotation(body, Rotation2D { radians: 0.5 });
        world.set_rigid_body(body, RigidBody::dynamic_box(1.0, 2.0, 2.0));
        world.add_weld_joint(
            WeldJoint::new(anchor, body)
                .with_local_anchor_a(4.0, 0.0)
                .with_local_anchor_b(-4.0, 0.0)
                .with_reference_angle(0.0),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 4,
                position_iterations: 8,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        let transform = world.transform(body).unwrap();
        let rotation = world.rotation(body).unwrap_or_default();
        assert!(stats.constraint_position_corrections > 0);
        assert!(
            (transform.x - 8.0).abs() < 0.05 && transform.y.abs() < 0.05,
            "weld joint should preserve the authored local anchor offset, got {transform:?}"
        );
        assert!(
            rotation.radians.abs() < 0.05,
            "weld joint should lock relative angle, got {rotation:?}"
        );
    }

    #[test]
    fn weld_joint_breaks_on_linear_or_angular_error() {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rotation(anchor, Rotation2D { radians: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());

        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
        world.set_rotation(body, Rotation2D { radians: 2.0 });
        world.set_rigid_body(body, RigidBody::dynamic_box(1.0, 2.0, 2.0));
        world.add_weld_joint(
            WeldJoint::new(anchor, body)
                .with_break_distance(1.0)
                .with_break_angle(1.0),
        );

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: 1,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
            },
        );

        assert_eq!(stats.broken_joints, 1);
        assert_eq!(world.weld_joint_count(), 0);
    }

    #[test]
    fn move_and_slide_stops_at_solid_collider() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let wall = spawn_kinematic_body(&mut world, 20.0, 0.0, CollisionLayer::Enemy, false);

        let result = PhysicsSystem::move_and_slide(
            &mut world,
            mover,
            Velocity { vx: 30.0, vy: 0.0 },
            CollisionMask::ENEMY,
            4,
        );

        assert_eq!(result.hit_count, 1);
        assert_eq!(result.last_hit, Some(wall));
        assert!(result.blocked_x);
        assert!(!result.blocked_y);
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 10.0, y: 0.0 })
        );
    }

    #[test]
    fn move_and_slide_with_tilemap_stops_at_solid_tile() {
        let mut world = World::default();
        let tilemap = single_wall_tilemap();
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            5.0,
            CollisionLayer::Player,
            true,
            2.0,
            2.0,
        );

        let result = PhysicsSystem::move_and_slide_with_tilemap(
            &mut world,
            &tilemap,
            mover,
            Velocity { vx: 20.0, vy: 0.0 },
            CollisionMask::ENEMY,
            4,
        );

        assert_eq!(result.hit_count, 1);
        assert_eq!(result.last_hit, None);
        assert!(result.blocked_x);
        assert!(!result.blocked_y);
        let transform = world.transform(mover).unwrap();
        assert!((transform.x - 8.0).abs() < 0.01);
        assert!((transform.y - 5.0).abs() < 0.01);
    }

    #[test]
    fn move_and_slide_with_tilemap_and_counters_records_tile_hit() {
        let mut world = World::default();
        let tilemap = single_wall_tilemap();
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            5.0,
            CollisionLayer::Player,
            true,
            2.0,
            2.0,
        );
        let mut counters = PhysicsCounters::default();

        PhysicsSystem::move_and_slide_with_tilemap_and_counters(
            &mut world,
            &tilemap,
            mover,
            Velocity { vx: 20.0, vy: 0.0 },
            CollisionMask::ENEMY,
            4,
            &mut counters,
        );

        assert_eq!(counters.kinematic_moves, 1);
        assert_eq!(counters.kinematic_hits, 1);
        assert_eq!(counters.kinematic_entity_hits, 0);
        assert_eq!(counters.kinematic_tile_hits, 1);
        assert!(counters.tile_candidate_checks > 0);
    }

    #[test]
    fn move_and_slide_preserves_tangent_motion() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        spawn_kinematic_body(&mut world, 20.0, 0.0, CollisionLayer::Enemy, false);

        let result = PhysicsSystem::move_and_slide(
            &mut world,
            mover,
            Velocity { vx: 30.0, vy: 9.0 },
            CollisionMask::ENEMY,
            4,
        );

        assert_eq!(result.hit_count, 1);
        assert!(result.blocked_x);
        let transform = world.transform(mover).unwrap();
        assert!((transform.x - 10.0).abs() < 0.01);
        assert!((transform.y - 9.0).abs() < 0.01);
    }

    #[test]
    fn move_and_slide_ignores_trigger_colliders() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        spawn_kinematic_body(&mut world, 20.0, 0.0, CollisionLayer::Enemy, true);

        let result = PhysicsSystem::move_and_slide(
            &mut world,
            mover,
            Velocity { vx: 30.0, vy: 0.0 },
            CollisionMask::ENEMY,
            4,
        );

        assert_eq!(result.hit_count, 0);
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 30.0, y: 0.0 })
        );
    }

    #[test]
    fn move_and_slide_ignores_disabled_colliders() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let wall = spawn_kinematic_body(&mut world, 20.0, 0.0, CollisionLayer::Enemy, false);
        let wall_collider = world.collider(wall).unwrap().with_enabled(false);
        world.set_aabb_collider(wall, wall_collider);

        let result = PhysicsSystem::move_and_slide(
            &mut world,
            mover,
            Velocity { vx: 30.0, vy: 0.0 },
            CollisionMask::ENEMY,
            4,
        );

        assert_eq!(result.hit_count, 0);
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 30.0, y: 0.0 })
        );
    }

    #[test]
    fn move_and_slide_with_one_way_platforms_lands_from_above() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

        let result = PhysicsSystem::move_and_slide_with_one_way_platforms(
            &mut world,
            mover,
            Velocity { vx: 0.0, vy: 20.0 },
            CollisionMask::WALL,
            OneWayPlatformConfig::new(CollisionMask::WALL),
            4,
        );

        assert_eq!(result.hit_count, 1);
        assert_eq!(result.last_hit, Some(platform));
        assert!(result.blocked_y);
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 0.0, y: 10.0 })
        );
    }

    #[test]
    fn move_and_slide_with_one_way_platforms_blocks_touching_top() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
        let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

        let result = PhysicsSystem::move_and_slide_with_one_way_platforms(
            &mut world,
            mover,
            Velocity { vx: 8.0, vy: 6.0 },
            CollisionMask::WALL,
            OneWayPlatformConfig::new(CollisionMask::WALL),
            4,
        );

        assert_eq!(result.hit_count, 1);
        assert_eq!(result.last_hit, Some(platform));
        assert!(result.blocked_y);
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 8.0, y: 10.0 })
        );
    }

    #[test]
    fn move_and_slide_with_one_way_platforms_ignores_from_below_and_sides() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 30.0, CollisionLayer::Player, true);
        spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

        let upward_result = PhysicsSystem::move_and_slide_with_one_way_platforms(
            &mut world,
            mover,
            Velocity { vx: 0.0, vy: -20.0 },
            CollisionMask::WALL,
            OneWayPlatformConfig::new(CollisionMask::WALL),
            4,
        );

        assert_eq!(upward_result.hit_count, 0);
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 0.0, y: 10.0 })
        );

        world.set_transform(mover, Transform2D { x: 0.0, y: 20.0 });
        let side_result = PhysicsSystem::move_and_slide_with_one_way_platforms(
            &mut world,
            mover,
            Velocity { vx: 30.0, vy: 0.0 },
            CollisionMask::WALL,
            OneWayPlatformConfig::new(CollisionMask::WALL),
            4,
        );

        assert_eq!(side_result.hit_count, 0);
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 30.0, y: 20.0 })
        );
    }

    #[test]
    fn move_and_slide_with_one_way_platforms_keeps_other_solids_two_way() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 32.0, CollisionLayer::Player, true);
        let ceiling = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Enemy, false);

        let result = PhysicsSystem::move_and_slide_with_one_way_platforms(
            &mut world,
            mover,
            Velocity { vx: 0.0, vy: -20.0 },
            CollisionMask::ENEMY.union(CollisionMask::WALL),
            OneWayPlatformConfig::new(CollisionMask::WALL),
            4,
        );

        assert_eq!(result.hit_count, 1);
        assert_eq!(result.last_hit, Some(ceiling));
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 0.0, y: 30.0 })
        );
    }

    #[test]
    fn move_and_slide_with_tilemap_and_one_way_platforms_keeps_tiles_solid() {
        let mut world = World::default();
        let tilemap = single_wall_tilemap();
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            5.0,
            CollisionLayer::Player,
            true,
            2.0,
            2.0,
        );

        let result = PhysicsSystem::move_and_slide_with_tilemap_and_one_way_platforms(
            &mut world,
            &tilemap,
            mover,
            Velocity { vx: 20.0, vy: 0.0 },
            CollisionMask::WALL,
            OneWayPlatformConfig::new(CollisionMask::WALL),
            4,
        );

        assert_eq!(result.hit_count, 1);
        assert_eq!(result.last_hit, None);
        assert!(result.blocked_x);
        assert_eq!(world.transform(mover), Some(Transform2D { x: 8.0, y: 5.0 }));
    }

    #[test]
    fn move_and_slide_with_tilemap_lands_on_one_way_tile_from_above() {
        let mut world = World::default();
        let tilemap = single_one_way_tilemap();
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            5.0,
            -2.0,
            CollisionLayer::Player,
            true,
            1.0,
            1.0,
        );

        let result = PhysicsSystem::move_and_slide_with_tilemap(
            &mut world,
            &tilemap,
            mover,
            Velocity { vx: 0.0, vy: 10.0 },
            CollisionMask::WALL,
            4,
        );

        assert_eq!(result.hit_count, 1);
        assert_eq!(result.last_hit, None);
        assert!(result.blocked_y);
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 5.0, y: -1.0 })
        );
    }

    #[test]
    fn move_and_slide_with_tilemap_ignores_one_way_tile_from_below_and_sides() {
        let mut world = World::default();
        let tilemap = single_one_way_tilemap();
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            5.0,
            12.0,
            CollisionLayer::Player,
            true,
            1.0,
            1.0,
        );

        let upward_result = PhysicsSystem::move_and_slide_with_tilemap(
            &mut world,
            &tilemap,
            mover,
            Velocity { vx: 0.0, vy: -10.0 },
            CollisionMask::WALL,
            4,
        );

        assert_eq!(upward_result.hit_count, 0);
        assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 2.0 }));

        world.set_transform(mover, Transform2D { x: -2.0, y: 5.0 });
        let side_result = PhysicsSystem::move_and_slide_with_tilemap(
            &mut world,
            &tilemap,
            mover,
            Velocity { vx: 10.0, vy: 0.0 },
            CollisionMask::WALL,
            4,
        );

        assert_eq!(side_result.hit_count, 0);
        assert_eq!(world.transform(mover), Some(Transform2D { x: 8.0, y: 5.0 }));
    }

    #[test]
    fn ground_probe_with_tilemap_detects_one_way_tile() {
        let mut world = World::default();
        let tilemap = single_one_way_tilemap();
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            5.0,
            -2.0,
            CollisionLayer::Player,
            true,
            1.0,
            1.0,
        );

        let hit = PhysicsSystem::ground_probe_with_tilemap(
            &world,
            &tilemap,
            mover,
            2.0,
            CollisionMask::WALL,
        )
        .expect("one-way tile should count as ground from above");

        assert_eq!(hit.entity, None);
        assert_eq!(hit.tile_layer_index, Some(0));
        assert_eq!(hit.tile_index, Some(0));
        assert!((hit.distance - 1.0).abs() < 0.01);
        assert!(hit.normal_y >= GROUND_NORMAL_Y_MIN);
    }

    #[test]
    fn carry_moving_platform_moves_grounded_rider_by_platform_delta() {
        let mut world = World::default();
        let rider = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
        let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

        let result = PhysicsSystem::carry_moving_platform(
            &mut world,
            rider,
            MovingPlatformCarryConfig::new(
                platform,
                Velocity { vx: 6.0, vy: 0.0 },
                1.0,
                CollisionMask::WALL,
                4,
            ),
        )
        .expect("rider standing on platform should be carried");

        assert_eq!(result.hit_count, 0);
        assert_eq!(
            world.transform(rider),
            Some(Transform2D { x: 6.0, y: 10.0 })
        );
    }

    #[test]
    fn carry_moving_platform_returns_none_when_rider_is_not_on_platform() {
        let mut world = World::default();
        let rider = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

        let result = PhysicsSystem::carry_moving_platform(
            &mut world,
            rider,
            MovingPlatformCarryConfig::new(
                platform,
                Velocity { vx: 6.0, vy: 0.0 },
                1.0,
                CollisionMask::WALL,
                4,
            ),
        );

        assert!(result.is_none());
        assert_eq!(world.transform(rider), Some(Transform2D { x: 0.0, y: 0.0 }));
    }

    #[test]
    fn carry_moving_platform_respects_other_solid_colliders() {
        let mut world = World::default();
        let rider = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
        let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);
        let wall = spawn_kinematic_body(&mut world, 20.0, 10.0, CollisionLayer::Enemy, false);

        let result = PhysicsSystem::carry_moving_platform(
            &mut world,
            rider,
            MovingPlatformCarryConfig::new(
                platform,
                Velocity { vx: 30.0, vy: 0.0 },
                1.0,
                CollisionMask::WALL.union(CollisionMask::ENEMY),
                4,
            ),
        )
        .expect("rider should be carried until another solid blocks it");

        assert_eq!(result.hit_count, 1);
        assert_eq!(result.last_hit, Some(wall));
        assert!(result.blocked_x);
        assert_eq!(
            world.transform(rider),
            Some(Transform2D { x: 10.0, y: 10.0 })
        );
    }

    #[test]
    fn carry_moving_platform_with_tilemap_respects_tile_obstacles() {
        let mut world = World::default();
        let tilemap = single_wall_tilemap();
        let rider = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            5.0,
            CollisionLayer::Player,
            true,
            2.0,
            2.0,
        );
        let platform = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            10.0,
            CollisionLayer::Wall,
            false,
            5.0,
            3.0,
        );

        let result = PhysicsSystem::carry_moving_platform_with_tilemap(
            &mut world,
            &tilemap,
            rider,
            MovingPlatformCarryConfig::new(
                platform,
                Velocity { vx: 20.0, vy: 0.0 },
                1.0,
                CollisionMask::WALL,
                4,
            ),
        )
        .expect("rider should be carried until a tile obstacle blocks it");

        assert_eq!(result.hit_count, 1);
        assert_eq!(result.last_hit, None);
        assert!(result.blocked_x);
        assert_eq!(world.transform(rider), Some(Transform2D { x: 8.0, y: 5.0 }));
    }

    #[test]
    fn platformer_controller_snaps_up_walkable_slope() {
        let mut world = World::default();
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            9.0,
            CollisionLayer::Player,
            true,
            1.0,
            1.0,
        );
        let slopes = [SlopeSegment::new(0.0, 10.0, 10.0, 5.0)];

        let result = PhysicsSystem::move_platformer_controller_with_slopes(
            &mut world,
            &slopes,
            mover,
            PlatformerControllerInput::new(1.0, false),
            platformer_test_config(CollisionMask::WALL)
                .with_horizontal_speed(5.0)
                .with_gravity(0.0)
                .with_slope_config(SlopeConfig::new(0.5, 3.0)),
            1.0,
        );

        assert!(result.ground_before.is_some());
        assert!(result.grounded);
        assert_eq!(result.velocity, Velocity { vx: 5.0, vy: 0.0 });
        assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 6.5 }));
        let ground_after = result
            .ground_after
            .expect("slope should count as controller ground");
        assert_eq!(ground_after.entity, None);
        assert_eq!(ground_after.tile_layer_index, None);
        assert!(ground_after.normal_y > GROUND_NORMAL_Y_MIN);
    }

    #[test]
    fn platformer_controller_snaps_down_walkable_slope() {
        let mut world = World::default();
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            4.0,
            CollisionLayer::Player,
            true,
            1.0,
            1.0,
        );
        let slopes = [SlopeSegment::new(0.0, 5.0, 10.0, 10.0)];

        let result = PhysicsSystem::move_platformer_controller_with_slopes(
            &mut world,
            &slopes,
            mover,
            PlatformerControllerInput::new(1.0, false),
            platformer_test_config(CollisionMask::WALL)
                .with_horizontal_speed(5.0)
                .with_gravity(0.0)
                .with_slope_config(SlopeConfig::new(0.5, 3.0)),
            1.0,
        );

        assert!(result.grounded);
        assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 6.5 }));
        assert_eq!(result.velocity, Velocity { vx: 5.0, vy: 0.0 });
    }

    #[test]
    fn platformer_controller_respects_slope_limits_and_downhill_opt_out() {
        let mut steep_world = World::default();
        let steep_mover = spawn_kinematic_body_with_size(
            &mut steep_world,
            0.0,
            9.0,
            CollisionLayer::Player,
            true,
            1.0,
            1.0,
        );
        let steep_slopes = [SlopeSegment::new(0.0, 10.0, 1.0, 0.0)];

        let steep_result = PhysicsSystem::move_platformer_controller_with_slopes(
            &mut steep_world,
            &steep_slopes,
            steep_mover,
            PlatformerControllerInput::new(1.0, false),
            platformer_test_config(CollisionMask::WALL)
                .with_horizontal_speed(1.0)
                .with_gravity(0.0)
                .with_slope_config(SlopeConfig::new(0.5, 20.0)),
            1.0,
        );

        assert!(!steep_result.grounded);
        assert_eq!(
            steep_world.transform(steep_mover),
            Some(Transform2D { x: 1.0, y: 9.0 })
        );

        let mut downhill_world = World::default();
        let downhill_mover = spawn_kinematic_body_with_size(
            &mut downhill_world,
            0.0,
            4.0,
            CollisionLayer::Player,
            true,
            1.0,
            1.0,
        );
        let downhill_slopes = [SlopeSegment::new(0.0, 5.0, 10.0, 10.0)];

        let downhill_result = PhysicsSystem::move_platformer_controller_with_slopes(
            &mut downhill_world,
            &downhill_slopes,
            downhill_mover,
            PlatformerControllerInput::new(1.0, false),
            platformer_test_config(CollisionMask::WALL)
                .with_horizontal_speed(5.0)
                .with_gravity(0.0)
                .with_slope_config(SlopeConfig::new(0.5, 3.0).with_downhill_snap(false)),
            1.0,
        );

        assert!(!downhill_result.grounded);
        assert_eq!(
            downhill_world.transform(downhill_mover),
            Some(Transform2D { x: 5.0, y: 4.0 })
        );
    }

    #[test]
    fn platformer_controller_applies_horizontal_input_and_gravity() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);

        let result = PhysicsSystem::move_platformer_controller(
            &mut world,
            mover,
            PlatformerControllerInput::new(2.0, false),
            platformer_test_config(CollisionMask::WALL)
                .with_gravity(10.0)
                .with_jump_speed(30.0),
            0.5,
        );

        assert!(!result.jumped);
        assert!(!result.grounded);
        assert_eq!(result.velocity, Velocity { vx: 8.0, vy: 5.0 });
        assert_eq!(world.transform(mover), Some(Transform2D { x: 4.0, y: 2.5 }));
        assert_eq!(world.velocity(mover), Some(result.velocity));
    }

    #[test]
    fn platformer_controller_jumps_only_when_grounded() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
        let ground = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

        let result = PhysicsSystem::move_platformer_controller(
            &mut world,
            mover,
            PlatformerControllerInput::new(0.0, true),
            platformer_test_config(CollisionMask::WALL),
            0.5,
        );

        assert_eq!(
            result.ground_before.and_then(|hit| hit.entity),
            Some(ground)
        );
        assert!(result.jumped);
        assert!(!result.grounded);
        assert_eq!(result.velocity, Velocity { vx: 0.0, vy: -12.0 });
        assert_eq!(world.transform(mover), Some(Transform2D { x: 0.0, y: 4.0 }));

        world.set_transform(mover, Transform2D { x: 0.0, y: 0.0 });
        world.set_velocity(mover, Velocity::default());
        let airborne_result = PhysicsSystem::move_platformer_controller(
            &mut world,
            mover,
            PlatformerControllerInput::new(0.0, true),
            platformer_test_config(CollisionMask::WALL),
            0.5,
        );

        assert!(!airborne_result.jumped);
        assert_eq!(airborne_result.velocity, Velocity { vx: 0.0, vy: 10.0 });
    }

    #[test]
    fn platformer_controller_state_allows_coyote_jump() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
        let ground = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);
        let mut state = PlatformerControllerState::new();
        let config = platformer_test_config(CollisionMask::WALL)
            .with_coyote_time_seconds(0.1)
            .with_gravity(10.0);

        let grounded_result = PhysicsSystem::move_platformer_controller_with_state(
            &mut world,
            mover,
            PlatformerControllerInput::new(0.0, false),
            config,
            0.016,
            &mut state,
        );
        assert!(grounded_result.grounded);
        assert_eq!(state.coyote_time_remaining, 0.1);

        world.despawn(ground);
        let coyote_result = PhysicsSystem::move_platformer_controller_with_state(
            &mut world,
            mover,
            PlatformerControllerInput::new(0.0, true),
            config,
            0.016,
            &mut state,
        );

        assert_eq!(coyote_result.ground_before, None);
        assert!(coyote_result.jumped);
        assert!(!coyote_result.grounded);
        assert_eq!(coyote_result.velocity.vy, -12.0);
        assert_eq!(state.coyote_time_remaining, 0.0);
        assert_eq!(state.jump_buffer_remaining, 0.0);
    }

    #[test]
    fn platformer_controller_state_buffers_jump_until_landing() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let ground = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);
        world.set_velocity(mover, Velocity { vx: 0.0, vy: 20.0 });
        let mut state = PlatformerControllerState::new();

        let result = PhysicsSystem::move_platformer_controller_with_state(
            &mut world,
            mover,
            PlatformerControllerInput::new(0.0, true),
            platformer_test_config(CollisionMask::WALL)
                .with_gravity(0.0)
                .with_jump_buffer_seconds(0.2),
            1.0,
            &mut state,
        );

        assert_eq!(result.ground_before, None);
        assert_eq!(result.ground_after.and_then(|hit| hit.entity), Some(ground));
        assert!(result.jumped);
        assert!(!result.grounded);
        assert_eq!(result.velocity, Velocity { vx: 0.0, vy: -12.0 });
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 0.0, y: 10.0 })
        );
        assert_eq!(state.jump_buffer_remaining, 0.0);
    }

    #[test]
    fn platformer_controller_steps_over_low_obstacle() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
        let floor = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            20.0,
            CollisionLayer::Wall,
            false,
            40.0,
            5.0,
        );
        let step = spawn_kinematic_body_with_size(
            &mut world,
            9.0,
            13.0,
            CollisionLayer::Wall,
            false,
            2.0,
            2.0,
        );

        let result = PhysicsSystem::move_platformer_controller(
            &mut world,
            mover,
            PlatformerControllerInput::new(1.0, false),
            platformer_test_config(CollisionMask::WALL)
                .with_gravity(0.0)
                .with_step_offset(5.0),
            1.0,
        );

        assert_eq!(result.ground_before.and_then(|hit| hit.entity), Some(floor));
        assert_eq!(result.ground_after.and_then(|hit| hit.entity), Some(step));
        assert!(!result.movement.blocked_x);
        assert!(result.grounded);
        assert_eq!(result.velocity, Velocity { vx: 8.0, vy: 0.0 });
        assert_eq!(world.transform(mover), Some(Transform2D { x: 8.0, y: 6.0 }));
    }

    #[test]
    fn platformer_controller_steps_over_low_tilemap_obstacle() {
        let mut world = World::default();
        let mut tilemap = Tilemap::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Player, true);
        let floor = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            20.0,
            CollisionLayer::Wall,
            false,
            40.0,
            5.0,
        );
        tilemap.set_layer(0, 1, 1, 4.0, 4.0, 7.0, 11.0, true, vec![1]);

        let result = PhysicsSystem::move_platformer_controller_with_tilemap(
            &mut world,
            &tilemap,
            mover,
            PlatformerControllerInput::new(1.0, false),
            platformer_test_config(CollisionMask::WALL)
                .with_gravity(0.0)
                .with_step_offset(5.0),
            1.0,
        );

        assert_eq!(result.ground_before.and_then(|hit| hit.entity), Some(floor));
        assert_eq!(result.ground_after.and_then(|hit| hit.tile_index), Some(0));
        assert!(!result.movement.blocked_x);
        assert!(result.grounded);
        assert_eq!(result.velocity, Velocity { vx: 8.0, vy: 0.0 });
        assert_eq!(world.transform(mover), Some(Transform2D { x: 8.0, y: 6.0 }));
    }

    #[test]
    fn platformer_controller_with_tilemap_snaps_up_slope_tile() {
        let mut world = World::default();
        let mut tilemap = Tilemap::default();
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            0.0,
            9.0,
            CollisionLayer::Player,
            true,
            1.0,
            1.0,
        );
        tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);
        tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);

        let result = PhysicsSystem::move_platformer_controller_with_tilemap(
            &mut world,
            &tilemap,
            mover,
            PlatformerControllerInput::new(1.0, false),
            platformer_test_config(CollisionMask::WALL)
                .with_horizontal_speed(5.0)
                .with_gravity(0.0)
                .with_slope_config(SlopeConfig::new(0.8, 5.0)),
            1.0,
        );

        assert_eq!(result.ground_before.and_then(|hit| hit.tile_index), Some(0));
        assert_eq!(result.ground_after.and_then(|hit| hit.tile_index), Some(0));
        assert!(result.grounded);
        assert!(!result.movement.blocked_x);
        assert_eq!(result.velocity, Velocity { vx: 5.0, vy: 0.0 });
        assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 4.0 }));
    }

    #[test]
    fn platformer_controller_lands_and_clears_downward_velocity() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let ground = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

        let result = PhysicsSystem::move_platformer_controller(
            &mut world,
            mover,
            PlatformerControllerInput::new(0.0, false),
            platformer_test_config(CollisionMask::WALL),
            1.0,
        );

        assert_eq!(result.ground_before, None);
        assert_eq!(result.ground_after.and_then(|hit| hit.entity), Some(ground));
        assert!(result.grounded);
        assert!(result.movement.blocked_y);
        assert_eq!(result.velocity, Velocity::default());
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 0.0, y: 10.0 })
        );
    }

    #[test]
    fn platformer_controller_respects_one_way_platform_config() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let platform = spawn_kinematic_body(&mut world, 0.0, 20.0, CollisionLayer::Wall, false);

        let result = PhysicsSystem::move_platformer_controller(
            &mut world,
            mover,
            PlatformerControllerInput::new(0.0, false),
            platformer_test_config(CollisionMask::WALL)
                .with_one_way_platforms(OneWayPlatformConfig::new(CollisionMask::WALL)),
            1.0,
        );

        assert_eq!(
            result.ground_after.and_then(|hit| hit.entity),
            Some(platform)
        );
        assert!(result.grounded);
        assert!(result.movement.blocked_y);
        assert_eq!(
            world.transform(mover),
            Some(Transform2D { x: 0.0, y: 10.0 })
        );
    }

    #[test]
    fn platformer_controller_with_tilemap_lands_on_tile_obstacle() {
        let mut world = World::default();
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 2, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1]);
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            5.0,
            0.0,
            CollisionLayer::Player,
            true,
            2.0,
            2.0,
        );

        let result = PhysicsSystem::move_platformer_controller_with_tilemap(
            &mut world,
            &tilemap,
            mover,
            PlatformerControllerInput::new(0.0, false),
            platformer_test_config(CollisionMask::WALL),
            1.0,
        );

        assert_eq!(result.ground_after.and_then(|hit| hit.tile_index), Some(1));
        assert!(result.grounded);
        assert!(result.movement.blocked_y);
        assert_eq!(result.velocity, Velocity::default());
        assert_eq!(world.transform(mover), Some(Transform2D { x: 5.0, y: 8.0 }));
    }

    #[test]
    fn ground_probe_detects_solid_entity_below() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let ground = spawn_kinematic_body(&mut world, 0.0, 12.0, CollisionLayer::Enemy, false);

        let hit = PhysicsSystem::ground_probe(&world, mover, 4.0, CollisionMask::ENEMY)
            .expect("ground below should be detected");

        assert_eq!(hit.entity, Some(ground));
        assert_eq!(hit.tile_layer_index, None);
        assert_eq!(hit.tile_index, None);
        assert!((hit.distance - 2.0).abs() < 0.01);
        assert_eq!(hit.normal_x, 0.0);
        assert_eq!(hit.normal_y, 1.0);
    }

    #[test]
    fn ground_probe_detects_touching_solid_entity() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let ground = spawn_kinematic_body(&mut world, 0.0, 10.0, CollisionLayer::Enemy, false);

        let hit = PhysicsSystem::ground_probe(&world, mover, 1.0, CollisionMask::ENEMY)
            .expect("touching ground should be detected");

        assert_eq!(hit.entity, Some(ground));
        assert_eq!(hit.distance, 0.0);
        assert_eq!(hit.normal_y, 1.0);
    }

    #[test]
    fn ground_probe_with_tilemap_detects_tile_obstacle() {
        let mut world = World::default();
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 2, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1]);
        let mover = spawn_kinematic_body_with_size(
            &mut world,
            5.0,
            4.0,
            CollisionLayer::Player,
            true,
            2.0,
            2.0,
        );

        let hit = PhysicsSystem::ground_probe_with_tilemap(
            &world,
            &tilemap,
            mover,
            5.0,
            CollisionMask::ENEMY,
        )
        .expect("tile obstacle below should be detected");

        assert_eq!(hit.entity, None);
        assert_eq!(hit.tile_layer_index, Some(0));
        assert_eq!(hit.tile_index, Some(1));
        assert!((hit.distance - 4.0).abs() < 0.01);
        assert_eq!(hit.normal_y, 1.0);

        world.set_transform(mover, Transform2D { x: 5.0, y: 8.0 });
        let touching_hit = PhysicsSystem::ground_probe_with_tilemap(
            &world,
            &tilemap,
            mover,
            1.0,
            CollisionMask::ENEMY,
        )
        .expect("touching tile obstacle should be detected");

        assert_eq!(touching_hit.tile_layer_index, Some(0));
        assert_eq!(touching_hit.tile_index, Some(1));
        assert_eq!(touching_hit.distance, 0.0);
    }

    #[test]
    fn ground_probe_ignores_triggers_side_contacts_and_invalid_distance() {
        let mut world = World::default();
        let mover = spawn_kinematic_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        spawn_kinematic_body(&mut world, 0.0, 12.0, CollisionLayer::Enemy, true);
        spawn_kinematic_body(&mut world, 12.0, 0.0, CollisionLayer::Enemy, false);

        assert!(PhysicsSystem::ground_probe(&world, mover, 20.0, CollisionMask::ENEMY).is_none());
        assert!(PhysicsSystem::ground_probe(&world, mover, 0.0, CollisionMask::ENEMY).is_none());
        assert!(
            PhysicsSystem::ground_probe(&world, mover, f32::NAN, CollisionMask::ENEMY).is_none()
        );
    }

    fn assert_capsule_two_point_contact_block_solve(world: &mut World, capsule: Entity) {
        assert_body_two_point_contact_block_solve(world, capsule, "capsule");
    }

    fn assert_circle_two_point_contact_block_solve(world: &mut World, circle: Entity) {
        assert_body_two_point_contact_block_solve(world, circle, "circle");
    }

    fn assert_body_two_point_contact_block_solve(
        world: &mut World,
        body: Entity,
        body_label: &str,
    ) {
        let manifolds = CollisionSystem::build_manifolds(world);
        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(manifold.point_count, 2);
        assert!(
            manifold.pair.a == body || manifold.pair.b == body,
            "expected {body_label} to participate in two-point contact, got {manifold:?}"
        );

        let moving_normal_sign = if manifold.pair.a == body { -1.0 } else { 1.0 };
        let normal = Velocity {
            vx: manifold.normal_x,
            vy: manifold.normal_y,
        };
        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            world,
            0.1,
            contact_block_solver_test_config(),
        );

        let velocity = world.velocity(body).unwrap();
        let normal_velocity =
            moving_normal_sign * (velocity.vx * normal.vx + velocity.vy * normal.vy);
        assert_eq!(stats.contact_block_solves, 1);
        assert_eq!(stats.contact_cache_entries, 2);
        assert!(stats.velocity_impulses >= 2);
        assert!(
            normal_velocity > 0.0,
            "{body_label} two-point block solve should create separating normal velocity, got velocity={velocity:?}, normal={normal:?}, stats={stats:?}"
        );
    }

    fn contact_block_solver_test_config() -> RigidBodyStepConfig {
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        }
    }

    fn rotated_test_point(x: f32, y: f32, radians: f32) -> Transform2D {
        let (sin, cos) = radians.sin_cos();
        Transform2D {
            x: x * cos - y * sin,
            y: x * sin + y * cos,
        }
    }

    fn spawn_kinematic_body(
        world: &mut World,
        x: f32,
        y: f32,
        layer: CollisionLayer,
        is_trigger: bool,
    ) -> Entity {
        spawn_kinematic_body_with_size(world, x, y, layer, is_trigger, 5.0, 5.0)
    }

    fn spawn_dynamic_body(world: &mut World, x: f32, y: f32, half_extent: f32) -> Entity {
        let entity = spawn_kinematic_body_with_size(
            world,
            x,
            y,
            CollisionLayer::Player,
            false,
            half_extent,
            half_extent,
        );
        world.set_rigid_body(entity, RigidBody::dynamic(1.0));
        entity
    }

    fn spawn_dynamic_capsule(
        world: &mut World,
        x: f32,
        y: f32,
        collider: CapsuleCollider,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_capsule_collider(entity, collider);
        world.set_collision_filter(
            entity,
            CollisionFilter::new(CollisionLayer::Player.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(entity, RigidBody::dynamic(1.0));
        entity
    }

    fn spawn_dynamic_circle(world: &mut World, x: f32, y: f32, radius: f32) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_circle_collider(
            entity,
            CircleCollider {
                radius,
                offset_x: 0.0,
                offset_y: 0.0,
                enabled: true,
                is_trigger: false,
                layer: CollisionLayer::Player,
            },
        );
        world.set_collision_filter(
            entity,
            CollisionFilter::new(CollisionLayer::Player.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(
            entity,
            RigidBody::dynamic_circle(1.0, radius)
                .with_material(PhysicsMaterial::new(0.0, 0.0))
                .with_sleeping_enabled(false),
        );
        entity
    }

    fn spawn_dynamic_oriented_box(
        world: &mut World,
        x: f32,
        y: f32,
        collider: OrientedBoxCollider,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_oriented_box_collider(entity, collider);
        world.set_collision_filter(
            entity,
            CollisionFilter::new(collider.layer.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(entity, RigidBody::dynamic(1.0));
        entity
    }

    fn spawn_static_convex_polygon(
        world: &mut World,
        x: f32,
        y: f32,
        collider: ConvexPolygonCollider,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_convex_polygon_collider(entity, collider);
        world.set_collision_filter(
            entity,
            CollisionFilter::new(collider.layer.mask(), CollisionMask::ALL),
        );
        world.set_rigid_body(entity, RigidBody::static_body());
        entity
    }

    fn spawn_fast_dynamic_convex_polygon_ccd_mover(world: &mut World) -> Entity {
        let collider =
            convex_polygon_collider(&[(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]);
        let entity = spawn_static_convex_polygon(world, 0.0, 0.0, collider);
        world.set_collision_filter(
            entity,
            CollisionFilter::new(CollisionLayer::Player.mask(), CollisionMask::ALL),
        );
        world.set_velocity(entity, Velocity { vx: 100.0, vy: 0.0 });
        world.set_rigid_body(
            entity,
            RigidBody::dynamic_convex_polygon(1.0, collider.vertices, collider.vertex_count)
                .with_material(PhysicsMaterial::new(0.0, 0.0)),
        );
        entity
    }

    fn convex_polygon_collider(points: &[(f32, f32)]) -> ConvexPolygonCollider {
        let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
        for (index, (x, y)) in points.iter().copied().enumerate() {
            vertices[index] = Transform2D { x, y };
        }
        ConvexPolygonCollider::new(vertices, points.len() as u32, false, CollisionLayer::Wall)
    }

    fn platformer_test_config(solid_mask: CollisionMask) -> PlatformerControllerConfig {
        PlatformerControllerConfig::new(solid_mask, 4)
            .with_horizontal_speed(8.0)
            .with_gravity(20.0)
            .with_jump_speed(12.0)
            .with_max_fall_speed(100.0)
            .with_ground_probe_distance(1.0)
    }

    fn spawn_kinematic_body_with_size(
        world: &mut World,
        x: f32,
        y: f32,
        layer: CollisionLayer,
        is_trigger: bool,
        half_width: f32,
        half_height: f32,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_aabb_collider(
            entity,
            AabbCollider {
                half_width,
                half_height,
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

    fn single_wall_tilemap() -> Tilemap {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 3, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 1, 0]);
        tilemap
    }

    fn single_one_way_tilemap() -> Tilemap {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 10.0, 10.0, 0.0, 0.0, true, vec![1]);
        tilemap.set_tile_one_way_platform(1);
        tilemap
    }
}

use crate::collision::{CollisionSystem, SweptAabbContactHit};
use crate::components::{AabbCollider, CollisionMask, Transform2D, Velocity};
use crate::entity::Entity;
use crate::tilemap::{Tilemap, TilemapSweepStats};
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
        }
    }

    pub fn config(&self) -> FixedTimestepConfig {
        self.config
    }

    pub fn accumulated_seconds(&self) -> f32 {
        self.accumulated_seconds
    }

    pub fn reset(&mut self) {
        self.accumulated_seconds = 0.0;
    }

    pub fn advance(&mut self, delta_seconds: f32) -> FixedTimestepUpdate {
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
}

impl PhysicsCounters {
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    pub fn record_fixed_update(&mut self, update: FixedTimestepUpdate) {
        self.fixed_steps = self.fixed_steps.saturating_add(update.steps);
    }
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

impl PhysicsSystem {
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
        let Some(collider) = world.colliders[i] else {
            return;
        };
        if let Some(transform) = world.transforms[i].as_mut() {
            transform.x = clamp_axis(
                transform.x,
                bounds.min_x + collider.half_width,
                bounds.max_x - collider.half_width,
            );
            transform.y = clamp_axis(
                transform.y,
                bounds.min_y + collider.half_height,
                bounds.max_y - collider.half_height,
            );
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
}

impl<'a> PlatformerControllerRuntime<'a> {
    fn new(
        state: Option<&'a mut PlatformerControllerState>,
        counters: Option<&'a mut PhysicsCounters>,
    ) -> Self {
        Self { state, counters }
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
        counters,
    } = runtime;
    let config = sanitize_platformer_controller_config(config);
    let delta_seconds = sanitize_delta_seconds(delta_seconds);
    let ground_before = ground_probe_internal(
        world,
        tilemap,
        entity,
        config.ground_probe_distance,
        config.solid_mask,
    );
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

    let movement = move_with_optional_step_offset(
        world,
        tilemap,
        entity,
        Velocity {
            vx: velocity.vx * delta_seconds,
            vy: velocity.vy * delta_seconds,
        },
        KinematicMoveSettings::new(
            config.solid_mask,
            config.one_way_platforms,
            config.max_iterations,
        ),
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
        counters,
    );
    if movement.blocked_y {
        velocity.vy = 0.0;
    }

    let ground_after = ground_probe_internal(
        world,
        tilemap,
        entity,
        config.ground_probe_distance,
        config.solid_mask,
    );
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
        if target_collider.is_trigger
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
    let mover_bottom = position.y + collider.half_height;
    let platform_top = target_transform.y - target_collider.half_height;
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

fn clamp_axis(value: f32, min: f32, max: f32) -> f32 {
    if min <= max {
        value.clamp(min, max)
    } else {
        (min + max) * 0.5
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{CollisionFilter, CollisionLayer, Transform2D, Velocity};
    use crate::tilemap::Tilemap;

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

    fn spawn_kinematic_body(
        world: &mut World,
        x: f32,
        y: f32,
        layer: CollisionLayer,
        is_trigger: bool,
    ) -> Entity {
        spawn_kinematic_body_with_size(world, x, y, layer, is_trigger, 5.0, 5.0)
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
}

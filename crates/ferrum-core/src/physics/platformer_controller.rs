use crate::components::{CollisionMask, Transform2D, Velocity};
use crate::entity::Entity;
use crate::tilemap::Tilemap;
use crate::world::World;

use super::math::{finite_velocity, velocity_len_squared};
use super::{
    GroundProbeHit, KinematicMoveResult, KinematicMoveSettings, MovingPlatformCarryConfig,
    OneWayPlatformConfig, PhysicsCounters, PhysicsSystem, PlatformerControllerConfig,
    PlatformerControllerInput, PlatformerControllerResult, PlatformerControllerState, SlopeSegment,
    KINEMATIC_EPSILON, MAX_KINEMATIC_ITERATIONS,
};

mod bounds;
mod config;
mod controller;
mod ground_probe;
mod kinematic_sweep;
mod moving_platform;
mod slope_ground;
mod solid_filter;
mod step_offset;

use controller::{move_platformer_controller_internal, PlatformerControllerRuntime};
use ground_probe::ground_probe_internal;
use kinematic_sweep::{earliest_solid_hit, KinematicSweep};
use moving_platform::carry_moving_platform_internal;

impl PhysicsSystem {
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

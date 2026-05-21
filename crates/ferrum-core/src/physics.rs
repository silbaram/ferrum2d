use crate::collision::{CollisionSystem, SweptAabbContactHit};
use crate::components::{AabbCollider, CollisionMask, Transform2D, Velocity};
use crate::entity::Entity;
use crate::tilemap::{Tilemap, TilemapSweepStats};
use crate::world::World;

const KINEMATIC_EPSILON: f32 = 0.0001;
const MAX_KINEMATIC_ITERATIONS: u32 = 8;
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
            solid_mask,
            max_iterations,
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
            solid_mask,
            max_iterations,
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
            solid_mask,
            max_iterations,
            Some(counters),
        )
    }
}

fn move_and_slide_internal(
    world: &mut World,
    tilemap: Option<&Tilemap>,
    entity: Entity,
    displacement: Velocity,
    solid_mask: CollisionMask,
    max_iterations: u32,
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
    let iterations = max_iterations.min(MAX_KINEMATIC_ITERATIONS);
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
                solid_mask,
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
    } = sweep;
    let moving_index = entity.id as usize;
    let mut best: Option<KinematicHit> = None;

    for target_index in 0..world.transforms.len() {
        if target_index == moving_index || !world.alive.get(target_index).copied().unwrap_or(false)
        {
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
        if contact.time <= KINEMATIC_EPSILON
            && CollisionSystem::aabb_contact(position, collider, target_transform, target_collider)
                .is_none()
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

    fn spawn_kinematic_body(
        world: &mut World,
        x: f32,
        y: f32,
        layer: CollisionLayer,
        is_trigger: bool,
    ) -> Entity {
        spawn_kinematic_body_with_size(world, x, y, layer, is_trigger, 5.0, 5.0)
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

//! Native non-projectile actions. Deferred melee resolves after physics, before despawn commit.
use super::*;
use crate::collision::collider_segment_count_at;
use crate::components::gameplay::MeleeTarget;
use crate::components::{AabbCollider, RigidBodyType};
use crate::physics::{Hd2dKinematicControllerConfig, KinematicSweepScratch, PhysicsSystem};
use crate::spatial_scene::{CombatVelocityRequest, SpatialNavigation};
use crate::tilemap::{Tilemap, MAX_ACTION_DASH_BREAKPOINTS};

const FRAME_WORK: u64 = 1_000_000;
const MAX_ACTIONS: usize = 128;

#[wasm_bindgen]
impl Engine {
    /// Version 1 executes native Data Scene melee and dash actions, including checkpoint state.
    pub fn data_scene_combat_actions_version(&self) -> u32 {
        1
    }
}

#[derive(Clone, Copy)]
struct PendingMelee {
    prepared: PreparedAction,
    attack: MeleeAttackCoreData,
}
pub(super) struct CombatActions {
    pending_melee: Vec<PendingMelee>,
    melee_hits: Vec<(CircleQueryHit, Transform2D)>,
    dash_route: SpatialNavigation,
    flat_scratch: KinematicSweepScratch,
    flat_breaks: Vec<f64>,
    pub(super) work: u64,
    attempts: usize,
}
impl Default for CombatActions {
    fn default() -> Self {
        Self {
            pending_melee: Vec::with_capacity(MAX_ACTIONS),
            melee_hits: Vec::with_capacity(MAX_COMBAT_ENTITIES),
            dash_route: SpatialNavigation::default(),
            flat_scratch: KinematicSweepScratch::default(),
            flat_breaks: Vec::with_capacity(MAX_ACTION_DASH_BREAKPOINTS),
            work: 0,
            attempts: 0,
        }
    }
}
impl CombatActions {
    pub(super) fn begin_frame(&mut self) {
        self.pending_melee.clear();
        self.work = 0;
        self.attempts = 0;
    }
    pub(super) fn clear(&mut self) {
        self.pending_melee.clear();
        self.begin_frame();
    }
    pub(super) fn reserve(&mut self, work: u64) -> bool {
        if self.work.saturating_add(work) > FRAME_WORK {
            return false;
        }
        self.work += work;
        true
    }
    pub(super) fn attempt(&mut self) -> bool {
        if self.attempts == MAX_ACTIONS {
            return false;
        }
        self.attempts += 1;
        true
    }
    pub(super) fn tile_bound(&mut self, tilemap: &Tilemap) -> Option<u64> {
        // Bound and subdivision inspect layer metadata and perform clipping arithmetic.
        self.reserve(tilemap.action_layer_work_bound().saturating_mul(64))
            .then(|| tilemap.action_collision_work_bound())
    }
    // Charge the collider metadata scan before doing it. Include disabled segments conservatively.
    pub(super) fn geometry_bound(&mut self, world: &World) -> Option<(u64, u64)> {
        let scan = world.alive_indices().len() as u64;
        if !self.reserve(scan) {
            return None;
        }
        let mut segments = 0u64;
        let mut collider_visits = 0u64;
        for &index in world.alive_indices() {
            for collider in 0..world.compound_collider_count_at(index) {
                if !self.reserve(1) {
                    return None;
                }
                collider_visits = collider_visits.saturating_add(1);
                segments = segments
                    .saturating_add(collider_segment_count_at(world, index, collider) as u64);
            }
        }
        let preparation_visits = collider_visits.saturating_add(segments);
        let segments = segments.max(1);
        Some((
            segments,
            scan.saturating_add(preparation_visits)
                .saturating_add(segments.saturating_mul(u64::from(segments.ilog2()) + 1)),
        ))
    }
}
pub(super) fn uses_primary_input(pattern: ActionPattern) -> bool {
    matches!(
        pattern,
        ActionPattern::Projectile {
            aim: ActionAimSource::Input,
            ..
        } | ActionPattern::Dash {
            aim: ActionAimSource::Input,
            ..
        } | ActionPattern::Melee {
            target: MeleeTarget::Enemies,
            ..
        } | ActionPattern::SpawnPrefab { .. }
    )
}

impl DataSceneCombat {
    pub(super) fn action_capacity_failure(
        &mut self,
        prepared: PreparedAction,
        events: &mut Vec<GameplayEvent>,
    ) {
        self.capped();
        self.failure(
            events,
            prepared.entity,
            prepared.action_id,
            GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
        );
    }
    pub(super) fn queue_melee(
        &mut self,
        world: &World,
        prepared: PreparedAction,
        payload: MeleeActionPayload,
        input: bool,
        events: &mut Vec<GameplayEvent>,
    ) {
        let Some(at) = world.transform(prepared.entity) else {
            return;
        };
        let plan = if input {
            plan_input_melee_action(payload, at)
        } else {
            plan_melee_action(payload, prepared.entity, at, world.primary_actor_entity())
        };
        let plan = match plan {
            Ok(p) => p,
            Err(error) => {
                self.failure(
                    events,
                    prepared.entity,
                    prepared.action_id,
                    melee_action_plan_failure_reason(error),
                );
                return;
            }
        };
        if !self.actions.attempt()
            || self.actions.pending_melee.len() == MAX_ACTIONS
            || !self.actions.reserve(64)
        {
            self.action_capacity_failure(prepared, events);
            return;
        }
        self.actions.pending_melee.push(PendingMelee {
            prepared,
            attack: melee_attack_core_data_from_plan(
                prepared.entity,
                plan,
                world.height_span(prepared.entity),
            ),
        });
    }

    pub(super) fn resolve_melee(
        &mut self,
        world: &mut World,
        spatial: &SpatialScene,
        tilemap: &Tilemap,
        events: &mut Vec<GameplayEvent>,
    ) {
        for index in 0..self.actions.pending_melee.len() {
            let PendingMelee { prepared, attack } = self.actions.pending_melee[index];
            if !melee_attack_attacker_can_resolve(
                world,
                attack.attacker,
                attack.target,
                &self.marked,
            ) {
                continue;
            }
            let Some((geometry, preparation)) = self.actions.geometry_bound(world) else {
                self.action_capacity_failure(prepared, events);
                continue;
            };
            if !self
                .actions
                .reserve(preparation.saturating_add(geometry.saturating_mul(8)))
            {
                self.action_capacity_failure(prepared, events);
                continue;
            }
            let Some(filter) = world.collision_filter(attack.attacker) else {
                continue;
            };
            self.actions.melee_hits.clear();
            CollisionSystem::visit_circle_query_with_height_span_and_filter(
                world,
                attack.center,
                attack.range,
                melee_attack_query_mask(attack.target),
                attack.height_span,
                Some(filter),
                |hit, point| self.actions.melee_hits.push((hit, point)),
            );
            // Reserve the whole attack before cooldown/damage. Do not silently truncate targets.
            let Some(tile_work) = self
                .actions
                .tile_bound(tilemap)
                .zip(self.actions.tile_bound(&spatial.physics))
                .map(|(a, b)| a.saturating_add(b))
            else {
                self.action_capacity_failure(prepared, events);
                continue;
            };
            let per_hit = geometry
                .saturating_mul(32)
                .saturating_add(tile_work.saturating_mul(8))
                .saturating_add(32);
            if !self
                .actions
                .reserve(per_hit.saturating_mul(self.actions.melee_hits.len() as u64))
            {
                self.action_capacity_failure(prepared, events);
                continue;
            }
            if !commit_prepared_action(world, prepared) {
                continue;
            }
            for hit in 0..self.actions.melee_hits.len() {
                let (hit, point) = self.actions.melee_hits[hit];
                let target = hit.entity;
                if target == attack.attacker
                    || world.health(target).is_none()
                    || (attack.target == MeleeTarget::Player
                        && Some(target) != world.primary_actor_entity())
                    || !melee_attack_target_can_receive_hit(
                        world,
                        target,
                        attack.target,
                        &self.marked,
                    )
                {
                    continue;
                }
                if let Some(denial) =
                    faction_damage_denial(world, attack.attacker.id as usize, target.id as usize)
                {
                    self.event(
                        events,
                        GameplayEvent::faction_damage_denied(
                            denial.target,
                            denial.source,
                            denial.source_faction_id,
                            denial.target_faction_id,
                        ),
                    );
                    continue;
                }
                if !melee_line_clear(world, spatial, tilemap, attack, target, point) {
                    continue;
                }
                let Some(damage) = apply_default_collision_damage_hit(
                    world,
                    attack.attacker.id as usize,
                    target.id as usize,
                    attack.damage,
                    f32::MAX,
                    0,
                    false,
                    true,
                    &mut self.marked,
                    &mut self.pending,
                ) else {
                    continue;
                };
                self.stats[4] = self.stats[4].saturating_add(1);
                self.stats[5] = self.stats[5].saturating_add(u32::from(damage.killed));
                self.event(
                    events,
                    GameplayEvent::collision_damage(
                        target,
                        attack.attacker,
                        attack.damage,
                        damage.target_removed,
                    ),
                );
            }
        }
        self.actions.pending_melee.clear();
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn input_dash(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        input: &CombatInput<'_>,
        prepared: PreparedAction,
        payload: DashActionPayload,
        events: &mut Vec<GameplayEvent>,
        counters: &mut PhysicsCounters,
    ) {
        let Some(at) = world.transform(prepared.entity) else {
            return;
        };
        let direction = topdown_input_direction(input.snapshot.current);
        let aim = if direction != Velocity::default() {
            Some(Transform2D {
                x: at.x + direction.vx,
                y: at.y + direction.vy,
            })
        } else {
            input_dash_aim(world, spatial, prepared.entity, input)
        };
        let Some(aim) = aim else {
            self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
            );
            return;
        };
        match plan_input_dash_action_transform(payload, at, direction, aim) {
            Ok(target) => self.apply_dash(
                world,
                spatial,
                input.tilemap,
                prepared,
                target,
                events,
                counters,
            ),
            Err(error) => self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                dash_action_plan_failure_reason(error),
            ),
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn target_dash(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        tilemap: &Tilemap,
        prepared: PreparedAction,
        payload: DashActionPayload,
        events: &mut Vec<GameplayEvent>,
        counters: &mut PhysicsCounters,
    ) {
        let Some(at) = world.transform(prepared.entity) else {
            return;
        };
        let target = world
            .primary_actor_entity()
            .and_then(|e| world.transform(e).map(|p| (e, p)));
        match plan_dash_action_transform(payload, prepared.entity, at, target) {
            Ok(target) => {
                self.apply_dash(world, spatial, tilemap, prepared, target, events, counters)
            }
            Err(error) => self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                dash_action_plan_failure_reason(error),
            ),
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn apply_dash(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        tilemap: &Tilemap,
        prepared: PreparedAction,
        target: Transform2D,
        events: &mut Vec<GameplayEvent>,
        counters: &mut PhysicsCounters,
    ) {
        let actor = prepared.entity;
        if ![target.x, target.y].iter().all(|x| x.is_finite())
            || !world
                .rigid_body(actor)
                .is_some_and(|b| b.enabled && b.body_type == RigidBodyType::Kinematic)
            || world.compound_collider_count(actor) != 1
            || !world.collider(actor).is_some_and(|c| c.enabled)
            || spatial.attachments.contains(actor)
            || self.owns_projectile(actor)
        {
            self.failure(
                events,
                actor,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE,
            );
            return;
        }
        if !self.actions.attempt() {
            self.action_capacity_failure(prepared, events);
            return;
        }
        let Some((geometry, preparation)) = self.actions.geometry_bound(world) else {
            self.action_capacity_failure(prepared, events);
            return;
        };
        let from = world.transform(actor).unwrap();
        let span = world.height_span(actor);
        let velocity = world.velocity(actor).unwrap_or_default();
        let displacement = Velocity {
            vx: target.x - from.x,
            vy: target.y - from.y,
        };
        let (step, drop) = spatial
            .actor
            .filter(|a| a.0 == actor)
            .map_or_else(|| self.navigation.movement_limits(), |a| (a.2, a.3));
        if spatial.camera.is_some() {
            let movement = self.actions.dash_route.move_combat_velocity(
                spatial,
                world,
                counters,
                CombatVelocityRequest {
                    actor,
                    velocity: displacement,
                    delta: 1.,
                    step,
                    drop,
                    available: FRAME_WORK.saturating_sub(self.actions.work),
                    preparation_bound: preparation,
                    crowd: None,
                },
            );
            self.actions.work += movement.work;
            if !movement.motion_admitted {
                world.set_velocity(actor, velocity);
                self.action_capacity_failure(prepared, events);
                return;
            }
        } else {
            let Some(tile_work) = self.actions.tile_bound(tilemap) else {
                self.action_capacity_failure(prepared, events);
                return;
            };
            // Surface support is sampled at the collider center, including authored offsets.
            let collider = world.collider(actor).unwrap();
            if !self.actions.reserve(4096)
                || !tilemap.action_dash_breakpoints(
                    collider.center(from),
                    collider.center(target),
                    &mut self.actions.flat_breaks,
                )
            {
                self.action_capacity_failure(prepared, events);
                return;
            }
            let steps = (self.actions.flat_breaks.len() - 1) * 2;
            let work = preparation
                .saturating_add(geometry.saturating_mul(256))
                .saturating_add(tile_work.saturating_mul(64))
                .saturating_mul(steps as u64);
            if !self.actions.reserve(work) {
                self.action_capacity_failure(prepared, events);
                return;
            }
            let clear = PhysicsSystem::spatial_body_pose_is_clear(
                world,
                tilemap,
                actor,
                from,
                &mut self.actions.flat_scratch,
                Some(counters),
                CollisionMask::WALL,
            );
            if clear {
                for index in 0..steps {
                    let current = world.transform(actor).unwrap();
                    let interval = index / 2;
                    let a = self.actions.flat_breaks[interval];
                    let b = self.actions.flat_breaks[interval + 1];
                    let t = if index % 2 == 0 { (a + b) * 0.5 } else { b };
                    let next = Transform2D {
                        x: (f64::from(from.x) + (f64::from(target.x) - f64::from(from.x)) * t)
                            as f32,
                        y: (f64::from(from.y) + (f64::from(target.y) - f64::from(from.y)) * t)
                            as f32,
                    };
                    let result = PhysicsSystem::move_hd2d_kinematic_with_tilemap_and_scratch(
                        world,
                        tilemap,
                        actor,
                        Velocity {
                            vx: next.x - current.x,
                            vy: next.y - current.y,
                        },
                        Hd2dKinematicControllerConfig::new(CollisionMask::WALL, 8)
                            .with_step_height(step)
                            .with_drop_height(drop),
                        Some(counters),
                        &mut self.actions.flat_scratch,
                        true,
                    );
                    if result.blocked_by_step
                        || result.blocked_by_drop
                        || result.movement.blocked_x
                        || result.movement.blocked_y
                    {
                        break;
                    }
                }
            }
            if !PhysicsSystem::spatial_body_pose_is_clear(
                world,
                tilemap,
                actor,
                world.transform(actor).unwrap(),
                &mut self.actions.flat_scratch,
                Some(counters),
                CollisionMask::WALL,
            ) {
                world.set_transform(actor, from);
                if let Some(span) = span {
                    world.set_height_span(actor, span);
                } else {
                    world.clear_height_span(actor);
                }
            }
        }
        world.set_velocity(actor, velocity);
        if world.transform(actor) != Some(from) {
            commit_prepared_action(world, prepared);
        } else {
            self.failure(
                events,
                actor,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
            );
        }
    }
}

fn input_dash_aim(
    world: &World,
    spatial: &SpatialScene,
    source: Entity,
    input: &CombatInput<'_>,
) -> Option<Transform2D> {
    let pointer = [
        input.snapshot.current.mouse_x,
        input.snapshot.current.mouse_y,
    ];
    let viewport = [input.camera.viewport_width, input.camera.viewport_height];
    if spatial.camera.is_some() {
        let (span, style) = DataSceneCombat::projectile_pose(world, spatial, source)?;
        spatial.aim_on_plane(viewport, pointer, span.elevation + style.elevation)
    } else if pointer.iter().any(|v| !v.is_finite())
        || pointer[0] < 0.
        || pointer[1] < 0.
        || pointer[0] > viewport[0]
        || pointer[1] > viewport[1]
    {
        None
    } else {
        Some(input.camera.screen_to_world(Transform2D {
            x: pointer[0],
            y: pointer[1],
        }))
    }
}

fn melee_line_clear(
    world: &World,
    spatial: &SpatialScene,
    tilemap: &Tilemap,
    attack: MeleeAttackCoreData,
    target: Entity,
    at: Transform2D,
) -> bool {
    let direction = Velocity {
        vx: at.x - attack.center.x,
        vy: at.y - attack.center.y,
    };
    let length = direction.vx.hypot(direction.vy);
    if length <= 0.0001 {
        return true;
    }
    // Sight travels through the overlapping body interval, rather than touching the floor below.
    let sight = attack.height_span.and_then(|source| {
        let target = world.height_span(target)?;
        let low = f64::from(source.elevation.max(target.elevation));
        let high = f64::from(source.top().min(target.top()));
        HeightSpan::new(source.floor, ((low + high) * 0.5) as f32, 0.001)
    });
    if attack.height_span.is_some() && sight.is_none() {
        return false;
    }
    let wall = CollisionSystem::shape_cast_with_height_span(
        world,
        CollisionQueryShape::Circle {
            center: attack.center,
            radius: 0.001,
        },
        direction,
        length,
        CollisionMask::WALL,
        sight,
        Some(attack.attacker),
        world.collision_filter(attack.attacker),
    );
    let point = AabbCollider::new(0.001, 0.001, true, CollisionLayer::Bullet);
    wall.is_none()
        && tilemap
            .projectile_aabb_blocking_tile_hit(attack.center, direction, point, 1., sight)
            .is_none()
        && spatial
            .physics
            .projectile_aabb_blocking_tile_hit(attack.center, direction, point, 1., sight)
            .is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{CompoundCollider, CompoundColliderShape};

    #[test]
    fn combat_action_geometry_scan_charges_each_compound_before_inspection() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        for _ in 0..64 {
            world.add_compound_collider(
                entity,
                CompoundCollider::new(CompoundColliderShape::Aabb(AabbCollider::new(
                    1.,
                    1.,
                    false,
                    CollisionLayer::Wall,
                ))),
            );
        }
        let mut actions = CombatActions {
            work: FRAME_WORK - 8,
            ..CombatActions::default()
        };
        assert!(actions.geometry_bound(&world).is_none());
        assert_eq!(actions.work, FRAME_WORK);
        actions.begin_frame();
        assert_eq!(actions.geometry_bound(&world).unwrap().0, 64);
        assert_eq!(actions.work, 65);
        for _ in 0..MAX_ACTIONS {
            assert!(actions.attempt());
        }
        assert!(!actions.attempt());
        actions.begin_frame();
        assert!(actions.attempt());
    }
}

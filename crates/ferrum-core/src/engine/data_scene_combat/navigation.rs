//! Opt-in multi-floor chase. Routes are disposable caches; simulation poses remain in World.
use super::*;
use crate::collision::collider_segment_count_at;
use crate::components::gameplay::{MovementPattern, MovementTarget};
use crate::spatial_scene::{
    CombatCrowd, CombatNavigationRequest, CombatRouteKey, CombatVelocityRequest, SharedCombatRoute,
    SpatialMoveStatus, SpatialNavigation,
};

const FRAME_WORK: u64 = 1_000_000;
const SEARCH_WORK: u64 = 600_000;

#[derive(Clone, Copy)]
pub(super) struct Config {
    cell: f32,
    step: f32,
    drop: f32,
    interval: f32,
    radius: f32,
    agents: usize,
    avoidance: Option<f32>,
    precise_stop: bool,
    all_patterns: bool,
}
impl Config {
    fn decode(values: &[f32]) -> Option<Self> {
        if values.len() != 6
            || values.iter().any(|v| !v.is_finite())
            || values[0] <= 0.
            || values[0] > 4096.
            || !(0. ..=65536.).contains(&values[1])
            || !(0. ..=65536.).contains(&values[2])
            || !(0.05..=60.).contains(&values[3])
            || !(0. ..=4096.).contains(&values[4])
            || !(1. ..=64.).contains(&values[5])
            || values[5].fract() != 0.
        {
            return None;
        }
        Some(Self {
            cell: values[0],
            step: values[1],
            drop: values[2],
            interval: values[3],
            radius: values[4],
            agents: values[5] as usize,
            avoidance: None,
            precise_stop: false,
            all_patterns: false,
        })
    }
}
struct PendingSearch {
    entity: Entity,
    key: CombatRouteKey,
    source: (Transform2D, HeightSpan),
}
struct Agent {
    entity: Entity,
    target: Option<Entity>,
    goal: Transform2D,
    span: Option<HeightSpan>,
    speed: f32,
    cooldown: f32,
    revision: u32,
    route: SpatialNavigation,
    at_rest: Option<(Transform2D, HeightSpan)>,
    previous_velocity: Velocity,
    pattern: Option<MovementPattern>,
}
impl Agent {
    fn new(entity: Entity) -> Self {
        Self {
            entity,
            target: None,
            goal: Transform2D::default(),
            span: None,
            speed: 0.,
            cooldown: 0.,
            revision: 0,
            route: SpatialNavigation::default(),
            at_rest: None,
            previous_velocity: Velocity::default(),
            pattern: None,
        }
    }
}
#[derive(Default)]
pub(super) struct CombatNavigation {
    config: Option<Config>,
    agents: Vec<Agent>,
    scratch: SpatialNavigation,
    cursor: usize,
    used: u64,
    searched: bool,
    started: bool,
    // searches, failures, deferred, frame searches, last status, nodes, probes.
    stats: [u32; 7],
    bindings: std::collections::BTreeMap<(u32, u32), f32>,
    peers: Vec<Entity>,
    crowd_stats: [u32; 5],
    pending_search: Option<PendingSearch>,
    shared_routes: Vec<SharedCombatRoute>,
    // cache hits, slices, yields, cancellations, frame search work, peak job work.
    scheduler_stats: [u32; 6],
    job_work: u64,
}
fn chase(world: &World, entity: Entity) -> Option<(MovementTarget, f32)> {
    match world.movement_pattern(entity)? {
        MovementPattern::Chase { target, speed } if speed.is_finite() && speed > 0. => {
            Some((target, speed))
        }
        _ => None,
    }
}
fn targeted(world: &World, entity: Entity, all: bool) -> Option<(MovementTarget, f32)> {
    if all {
        if let Some(MovementPattern::SeekTarget { target, speed, .. }) =
            world.movement_pattern(entity)
        {
            return (speed.is_finite() && speed > 0.).then_some((target, speed));
        }
    }
    chase(world, entity)
}

fn eligible(world: &World, spatial: &SpatialScene, entity: Entity) -> bool {
    Some(entity) != world.primary_actor_entity()
        && !spatial.attachments.contains(entity)
        && SpatialNavigation::combat_supported(world, entity)
}
fn target(world: &World, source: Entity, query: MovementTarget) -> Option<Entity> {
    let valid = |entity: Entity| {
        entity != source
            && world.is_current_entity(entity)
            && world.transform(entity).is_some()
            && world.height_span(entity).is_some()
    };
    match query {
        MovementTarget::PrimaryActor | MovementTarget::NearestPrimaryActor => {
            world.primary_actor_entity().filter(|e| valid(*e))
        }
        MovementTarget::Entity(entity) => Some(entity).filter(|e| valid(*e)),
        _ => {
            let from = world.transform(source)?;
            let height = world.height_span(source)?.elevation;
            let mut best = None;
            let mut best_distance = f64::INFINITY;
            for &index in world.alive_indices() {
                let Some(entity) = world.entity_at_index(index).filter(|e| valid(*e)) else {
                    continue;
                };
                let matches = match query {
                    MovementTarget::NearestEnemy => {
                        world.collider_layer_at(index) == Some(CollisionLayer::Enemy)
                    }
                    MovementTarget::NearestLayer(layer) => {
                        world.collider_layer_at(index) == Some(layer)
                    }
                    MovementTarget::NearestFaction(id) => world
                        .gameplay_faction_at_index(index)
                        .is_some_and(|f| f.faction_id == id),
                    MovementTarget::NearestTag(id) => world
                        .gameplay_tags_at_index(index)
                        .is_some_and(|t| t.contains(id)),
                    _ => false,
                };
                if !matches {
                    continue;
                }
                let at = world.transform(entity).unwrap();
                let z = world.height_span(entity).unwrap().elevation;
                let distance = (f64::from(at.x) - f64::from(from.x)).powi(2)
                    + (f64::from(at.y) - f64::from(from.y)).powi(2)
                    + (f64::from(z) - f64::from(height)).powi(2);
                if distance < best_distance {
                    best = Some(entity);
                    best_distance = distance;
                }
            }
            best
        }
    }
}
impl CombatNavigation {
    pub(super) fn movement_limits(&self) -> (f32, f32) {
        self.config.map_or((1., 1.), |c| (c.step, c.drop))
    }
    pub(super) fn reset(&mut self) {
        let config = self.config;
        let bindings = std::mem::take(&mut self.bindings);
        *self = Self {
            config,
            bindings,
            ..Self::default()
        };
    }
    pub(super) fn begin_frame(&mut self) {
        self.used = 0;
        self.searched = false;
        self.started = false;
        self.stats[3] = 0;
        self.crowd_stats[3] = 0;
        self.crowd_stats[4] = 0;
        self.scheduler_stats[4] = 0;
    }
    pub(super) fn owns(&self, pattern: MovementPattern) -> bool {
        self.config.is_some_and(|c| {
            matches!(pattern, MovementPattern::Chase { .. })
                || c.all_patterns
                    && matches!(
                        pattern,
                        MovementPattern::Accelerate { .. } | MovementPattern::SeekTarget { .. }
                    )
        })
    }
    pub(super) fn actor_capacity(&self) -> usize {
        self.config.map_or(MAX_ACTORS, |config| config.agents)
    }
    fn defer(&mut self) {
        self.stats[2] = self.stats[2].saturating_add(1);
    }
    pub(super) fn step(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        delta: f32,
        counters: &mut PhysicsCounters,
        spawn_prefabs: &super::spawn_prefabs::SpawnPrefabs,
    ) {
        let Some(config) = self.config else {
            return;
        };
        if delta <= 0. || !delta.is_finite() {
            return;
        }
        if !self.started {
            self.cursor = self.cursor.wrapping_add(1);
            self.started = true;
        }
        self.agents.retain(|a| {
            world.movement_pattern(a.entity).is_some_and(|p| {
                matches!(p, MovementPattern::Chase { .. })
                    || config.all_patterns
                        && matches!(
                            p,
                            MovementPattern::Accelerate { .. } | MovementPattern::SeekTarget { .. }
                        )
            }) && eligible(world, spatial, a.entity)
        });
        for &index in world.alive_indices() {
            let Some(entity) = world.entity_at_index(index) else {
                continue;
            };
            if self.agents.len() < config.agents
                && world.movement_pattern(entity).is_some_and(|p| {
                    matches!(p, MovementPattern::Chase { .. })
                        || config.all_patterns
                            && matches!(
                                p,
                                MovementPattern::Accelerate { .. }
                                    | MovementPattern::SeekTarget { .. }
                            )
                })
                && eligible(world, spatial, entity)
                && !self.agents.iter().any(|a| a.entity == entity)
            {
                self.agents.push(Agent::new(entity));
            }
        }
        for agent in &mut self.agents {
            agent.previous_velocity = world.velocity(agent.entity).unwrap_or_default();
        }
        // Chase has no inertial state. Velocity-driven patterns keep their prior intent when deferred;
        // the combat wrapper stashes/zeros it before integration for every owned actor.
        for position in 0..world.alive_indices().len() {
            let index = world.alive_indices()[position];
            let Some(entity) = world.entity_at_index(index) else {
                continue;
            };
            if Some(entity) != world.primary_actor_entity()
                && matches!(
                    world.movement_pattern(entity),
                    Some(MovementPattern::Chase { .. })
                )
            {
                world.set_velocity(entity, Velocity::default());
            }
        }
        for agent in &mut self.agents {
            agent.cooldown = (agent.cooldown - delta).max(0.);
        }
        self.peers.clear();
        self.peers.extend(self.agents.iter().map(|a| a.entity));
        self.crowd_stats[0] = 0;
        let scan = world.alive_indices().len() as u64;
        if self.used.saturating_add(scan * 3) > FRAME_WORK {
            self.defer();
            return;
        }
        self.used += scan * 3;
        // Conservative query-preparation bound. Chains contribute every segment, even disabled ones.
        let mut proxies = 0u64;
        for &index in world.alive_indices() {
            for collider in 0..world.compound_collider_count_at(index) {
                if self.used == FRAME_WORK {
                    self.defer();
                    return;
                }
                self.used += 1;
                proxies = proxies
                    .saturating_add(collider_segment_count_at(world, index, collider) as u64);
            }
        }
        let proxies = proxies.max(1);
        let preparation = scan + proxies.saturating_mul(u64::from(proxies.ilog2()) + 1);
        let count = self.agents.len();
        if count == 0 {
            if self.pending_search.take().is_some() {
                self.scratch.cancel_combat_search();
                self.scheduler_stats[3] = self.scheduler_stats[3].saturating_add(1);
            }
            return;
        }
        if self
            .pending_search
            .as_ref()
            .is_some_and(|p| !self.agents.iter().any(|a| a.entity == p.entity))
        {
            self.pending_search = None;
            self.scratch.cancel_combat_search();
            self.scheduler_stats[3] = self.scheduler_stats[3].saturating_add(1);
        }
        let start = self
            .pending_search
            .as_ref()
            .and_then(|p| self.agents.iter().position(|a| a.entity == p.entity))
            .unwrap_or(self.cursor % count);
        for offset in 0..count {
            let index = (start + offset) % count;
            // Target selection and support queries are charged before execution.
            let query_cost = scan + (spatial.surfaces.len() as u64 + 1) * 12;
            if self.used.saturating_add(query_cost) > FRAME_WORK {
                self.defer();
                continue;
            }
            self.used += query_cost;
            if self.agents[index].route.status == SpatialMoveStatus::Blocked {
                self.shared_routes.clear();
            }
            let agent = &mut self.agents[index];
            if let Some(MovementPattern::Accelerate {
                acceleration_x,
                acceleration_y,
                max_speed,
            }) = world.movement_pattern(agent.entity)
            {
                if config.all_patterns {
                    if self
                        .pending_search
                        .as_ref()
                        .is_some_and(|p| p.entity == agent.entity)
                    {
                        self.pending_search = None;
                        self.scratch.cancel_combat_search();
                        self.scheduler_stats[3] = self.scheduler_stats[3].saturating_add(1);
                    }

                    let desired = crate::gameplay::velocity_with_acceleration_and_speed_cap(
                        agent.previous_velocity,
                        acceleration_x,
                        acceleration_y,
                        max_speed,
                    );
                    let movement = agent.route.move_combat_velocity(
                        spatial,
                        world,
                        counters,
                        CombatVelocityRequest {
                            actor: agent.entity,
                            velocity: desired,
                            delta,
                            step: config.step,
                            drop: config.drop,
                            available: FRAME_WORK.saturating_sub(self.used),
                            preparation_bound: preparation,
                            crowd: config.avoidance.map(|padding| CombatCrowd {
                                peers: &self.peers,
                                padding,
                            }),
                        },
                    );
                    self.used += movement.work;
                    self.crowd_stats[1] = self.crowd_stats[1].saturating_add(movement.yielded);
                    self.crowd_stats[2] =
                        self.crowd_stats[2].saturating_add(movement.neighbor_tests);
                    self.crowd_stats[3] =
                        self.crowd_stats[3].saturating_add(movement.neighbor_tests);
                    world.set_velocity(
                        agent.entity,
                        if movement.motion_admitted {
                            desired
                        } else {
                            agent.previous_velocity
                        },
                    );
                    agent.target = None;
                    agent.at_rest = None;
                    continue;
                }
            }
            let Some((query, speed)) = targeted(world, agent.entity, config.all_patterns) else {
                continue;
            };
            let Some(target) = target(world, agent.entity, query) else {
                if self
                    .pending_search
                    .as_ref()
                    .is_some_and(|p| p.entity == agent.entity)
                {
                    self.pending_search = None;
                    self.scratch.cancel_combat_search();
                    self.scheduler_stats[3] = self.scheduler_stats[3].saturating_add(1);
                }
                agent.route.invalidate_combat();
                agent.target = None;
                agent.cooldown = 0.;
                continue;
            };
            let radius = self
                .bindings
                .get(&(agent.entity.id, agent.entity.generation))
                .or_else(|| {
                    let source = spawn_prefabs.prototype_source(agent.entity)?;
                    self.bindings.get(&(source.id, source.generation))
                })
                .copied()
                .unwrap_or(config.radius);
            let goal = world.transform(target).unwrap();
            let span = world.height_span(target).unwrap();
            let source_pose = world
                .transform(agent.entity)
                .zip(world.height_span(agent.entity));
            let resting = agent.at_rest.is_some()
                && agent.at_rest == source_pose
                && agent.target == Some(target)
                && agent.goal == goal
                && agent.span == Some(span)
                && agent.revision == spatial.navigation_revision
                && agent.speed == speed;
            if config.precise_stop
                && (resting
                    || SpatialNavigation::combat_can_stop(
                        spatial,
                        world,
                        agent.entity,
                        goal,
                        span,
                        radius,
                    ))
            {
                if self
                    .pending_search
                    .as_ref()
                    .is_some_and(|p| p.entity == agent.entity)
                {
                    self.pending_search = None;
                    self.scratch.cancel_combat_search();
                    self.scheduler_stats[3] = self.scheduler_stats[3].saturating_add(1);
                }
                agent.route.stop_combat();
                world.set_velocity(agent.entity, Velocity::default());
                agent.target = Some(target);
                agent.pattern = world.movement_pattern(agent.entity);
                agent.goal = goal;
                agent.span = Some(span);
                agent.speed = speed;
                agent.revision = spatial.navigation_revision;
                agent.at_rest = source_pose;
                self.crowd_stats[0] += 1;
                continue;
            }
            agent.at_rest = None;
            let identity_changed = agent.pattern != world.movement_pattern(agent.entity)
                || agent.target != Some(target)
                || agent.span.is_none_or(|s| s.floor != span.floor)
                || agent.revision != spatial.navigation_revision
                || agent.speed != speed;
            let arrived_outside_radius = agent.route.status == SpatialMoveStatus::Arrived
                && world.transform(agent.entity).is_some_and(|at| {
                    (f64::from(at.x) - f64::from(goal.x)).hypot(f64::from(at.y) - f64::from(goal.y))
                        > f64::from(radius)
                });
            let moved = arrived_outside_radius
                || (f64::from(goal.x) - f64::from(agent.goal.x))
                    .hypot(f64::from(goal.y) - f64::from(agent.goal.y))
                    >= f64::from(config.cell * 0.5).min(f64::from(radius).max(0.001))
                || agent
                    .span
                    .is_some_and(|s| (s.elevation - span.elevation).abs() > 0.001);
            if identity_changed {
                agent.route.invalidate_combat();
                agent.cooldown = 0.;
            }
            let retry = !matches!(
                agent.route.status,
                SpatialMoveStatus::Moving | SpatialMoveStatus::Arrived
            );
            if identity_changed
                || agent.cooldown == 0. && (moved || retry || config.avoidance.is_some())
            {
                let agent = &mut self.agents[index];
                let refining =
                    agent.route.status == SpatialMoveStatus::Moving && !identity_changed && !moved;
                let supported_goal = SpatialNavigation::combat_goal_matches(
                    spatial,
                    world,
                    agent.entity,
                    goal,
                    span,
                );
                let mut request = CombatNavigationRequest {
                    actor: agent.entity,
                    goal,
                    floor: span.floor.0,
                    speed,
                    cell: config.cell,
                    radius,
                    precise_stop: config.precise_stop,
                    preserve_credit: refining,
                    crowd: config
                        .avoidance
                        .filter(|_| refining)
                        .map(|padding| CombatCrowd {
                            peers: &self.peers,
                            padding,
                        }),
                    step: config.step,
                    drop: config.drop,
                    work_limit: SEARCH_WORK.min(FRAME_WORK.saturating_sub(self.used)),
                    preparation_bound: preparation,
                };
                let key = CombatRouteKey::new(world, spatial, target, &request);
                let owning = self
                    .pending_search
                    .as_ref()
                    .is_some_and(|p| p.entity == agent.entity);
                let mut cancelled_owner = false;
                if owning
                    && self.pending_search.as_ref().is_some_and(|p| {
                        !supported_goal
                            || source_pose != Some(p.source)
                            || key.as_ref().is_none_or(|k| !p.key.continues(k))
                    })
                {
                    self.pending_search = None;
                    self.scratch.cancel_combat_search();
                    self.scheduler_stats[3] = self.scheduler_stats[3].saturating_add(1);
                    cancelled_owner = true;
                }
                if let Some(p) = self
                    .pending_search
                    .as_ref()
                    .filter(|p| p.entity == agent.entity)
                {
                    request.goal = p.key.goal();
                }
                // Reuse is a query, not a new A*: admit one connector under the same frame budget.
                let mut reused = false;
                if !refining && !owning && supported_goal {
                    if let Some(cached) = key
                        .as_ref()
                        .and_then(|k| self.shared_routes.iter().rev().find(|r| r.key == *k))
                    {
                        let (accepted, work) = agent
                            .route
                            .reuse_combat_route(cached, spatial, world, &request);
                        self.used += work;
                        request.work_limit = SEARCH_WORK.min(FRAME_WORK.saturating_sub(self.used));
                        reused = accepted;
                        if reused {
                            self.scheduler_stats[0] = self.scheduler_stats[0].saturating_add(1);
                        }
                    }
                }
                if reused {
                    agent.target = Some(target);
                    agent.pattern = world.movement_pattern(agent.entity);
                    agent.goal = goal;
                    agent.span = Some(span);
                    agent.speed = speed;
                    agent.revision = spatial.navigation_revision;
                    agent.cooldown = config.interval;
                } else if cancelled_owner
                    || self.searched
                    || self
                        .pending_search
                        .as_ref()
                        .is_some_and(|p| p.entity != agent.entity)
                {
                    self.defer();
                } else {
                    self.searched = true;
                    self.cursor = index;
                    self.stats[3] += 1;
                    let starting = !self.scratch.has_combat_search();
                    if starting {
                        self.stats[0] = self.stats[0].saturating_add(1);
                        self.job_work = 0;
                    }
                    if !refining {
                        agent.route.invalidate_combat();
                    }
                    let planned_goal = request.goal;
                    let result = supported_goal.then(|| {
                        if refining {
                            agent
                                .route
                                .plan_combat(&mut self.scratch, spatial, world, request)
                        } else {
                            agent.route.advance_combat_search(
                                &mut self.scratch,
                                spatial,
                                world,
                                request,
                            )
                        }
                    });
                    self.stats[4] = result.as_ref().map_or(4, |r| r.status);
                    self.stats[5] = result.as_ref().map_or(0, |r| r.nodes);
                    self.stats[6] = result.as_ref().map_or(0, |r| r.probes);
                    let work = result.as_ref().map_or(0, |r| r.work);
                    self.used += work;
                    self.job_work += work;
                    self.scheduler_stats[4] = self.scheduler_stats[4].saturating_add(work as u32);
                    self.scheduler_stats[5] = self.scheduler_stats[5].max(self.job_work as u32);
                    self.scheduler_stats[1] = self.scheduler_stats[1].saturating_add(1);
                    let neighbors = result.as_ref().map_or(0, |r| r.neighbors);
                    self.crowd_stats[2] = self.crowd_stats[2].saturating_add(neighbors);
                    self.crowd_stats[3] = self.crowd_stats[3].saturating_add(neighbors);
                    let pending = result.as_ref().is_some_and(|r| r.pending);
                    let accepted = result.as_ref().is_some_and(|r| r.accepted);
                    if pending {
                        self.scheduler_stats[2] = self.scheduler_stats[2].saturating_add(1);
                        if self.pending_search.is_none() {
                            if let Some((key, source)) = key.zip(source_pose) {
                                self.pending_search = Some(PendingSearch {
                                    entity: agent.entity,
                                    key,
                                    source,
                                });
                            }
                        }
                    } else {
                        let completed_key = self.pending_search.take().map(|p| p.key).or(key);
                        if accepted && !refining {
                            if let Some(key) = completed_key {
                                if self.shared_routes.len() == 8 {
                                    self.shared_routes.remove(0);
                                }
                                if let Some(shared) =
                                    agent.route.share_combat_route(key, spatial, world)
                                {
                                    self.shared_routes.push(shared);
                                }
                            }
                        }
                        if !accepted {
                            self.stats[1] = self.stats[1].saturating_add(1);
                        }
                    }
                    agent.target = Some(target);
                    agent.pattern = world.movement_pattern(agent.entity);
                    agent.goal = planned_goal;
                    agent.span = Some(span);
                    agent.speed = speed;
                    agent.revision = spatial.navigation_revision;
                    // A pending actor stays due. Existing routes and other actors still move.
                    agent.cooldown = if pending { 0. } else { config.interval };
                }
            }
            let agent = &mut self.agents[index];
            let before = world.transform(agent.entity).unwrap();
            let steering = match world.movement_pattern(agent.entity) {
                Some(MovementPattern::SeekTarget { turn_rate, .. }) if config.all_patterns => {
                    Some((agent.previous_velocity, turn_rate))
                }
                _ => None,
            };
            agent.route.set_combat_steering(steering);
            let movement = agent.route.update_combat(
                spatial,
                world,
                delta,
                counters,
                FRAME_WORK.saturating_sub(self.used),
                preparation,
                config
                    .avoidance
                    .map(|padding| CombatCrowd {
                        peers: &self.peers,
                        padding,
                    })
                    .or_else(|| {
                        steering.map(|_| CombatCrowd {
                            peers: &[],
                            padding: 0.,
                        })
                    }),
            );
            self.used += movement.work;
            if config.avoidance.is_some() {
                self.crowd_stats[1] = self.crowd_stats[1].saturating_add(movement.yielded);
                self.crowd_stats[2] = self.crowd_stats[2].saturating_add(movement.neighbor_tests);
                self.crowd_stats[3] = self.crowd_stats[3].saturating_add(movement.neighbor_tests);
                self.crowd_stats[4] = self.crowd_stats[4].saturating_add(movement.steered);
            }
            let after = world.transform(agent.entity).unwrap();
            if config.precise_stop && agent.route.status == SpatialMoveStatus::Arrived {
                agent.at_rest = world.height_span(agent.entity).map(|span| (after, span));
                self.crowd_stats[0] += 1;
            }
            if steering.is_some() {
                let intent = movement
                    .steering_velocity
                    .unwrap_or(agent.previous_velocity);
                // Velocity is the next steering intent, as for generic Seek/Accelerate.
                // Safe crowd detours live in the route; accumulated movement credit must
                // not feed back into momentum or erase sub-ULP intent in either axis.
                let velocity = if agent.route.status == SpatialMoveStatus::Arrived {
                    Velocity::default()
                } else {
                    intent
                };
                world.set_velocity(agent.entity, velocity);
                continue;
            }
            world.set_velocity(
                agent.entity,
                Velocity {
                    vx: ((f64::from(after.x) - f64::from(before.x)) / f64::from(delta))
                        .clamp(-f64::from(speed), f64::from(speed)) as f32,
                    vy: ((f64::from(after.y) - f64::from(before.y)) / f64::from(delta))
                        .clamp(-f64::from(speed), f64::from(speed)) as f32,
                },
            );
        }
    }
    fn diagnostics(&self) -> Vec<u32> {
        let moving = self
            .agents
            .iter()
            .filter(|a| a.route.status == SpatialMoveStatus::Moving)
            .count() as u32;
        let blocked = self
            .agents
            .iter()
            .filter(|a| {
                matches!(
                    a.route.status,
                    SpatialMoveStatus::Blocked
                        | SpatialMoveStatus::Cancelled
                        | SpatialMoveStatus::Idle
                )
            })
            .count() as u32;
        vec![
            1,
            u32::from(self.config.is_some()),
            self.agents.len() as u32,
            moving,
            blocked,
            self.stats[0],
            self.stats[1],
            self.stats[2],
            self.stats[3],
            self.used.min(u64::from(u32::MAX)) as u32,
            self.stats[4],
            self.stats[5],
            self.stats[6],
        ]
    }
}

#[wasm_bindgen]
impl Engine {
    pub fn data_scene_combat_navigation_version(&self) -> u32 {
        1
    }
    pub fn data_scene_combat_navigation_scheduler_version(&self) -> u32 {
        1
    }
    pub fn data_scene_combat_navigation_scheduler_stats(&self) -> Vec<u32> {
        let nav = &self.data_scene.gameplay.combat.navigation;
        let mut words = vec![
            1,
            u32::from(nav.config.is_some()),
            u32::from(nav.pending_search.is_some()),
            nav.shared_routes.len() as u32,
        ];
        words.extend_from_slice(&nav.scheduler_stats);
        words
    }
    pub fn data_scene_combat_navigation_stats(&self) -> Vec<u32> {
        self.data_scene.gameplay.combat.navigation.diagnostics()
    }
    /// v3 catalog plus six f32 values: cell, step, drop, repath interval, arrival radius, max agents.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_gameplay_v4(
        &mut self,
        has_actor: bool,
        id: u32,
        generation: u32,
        interaction: u32,
        combat: bool,
        metadata: &[u32],
        values: &[f32],
        bindings: &[u32],
        navigation: &[f32],
    ) -> bool {
        let Some(config) = Config::decode(navigation) else {
            return false;
        };
        if !combat || !has_actor || self.world.height_span(Entity { id, generation }).is_none() {
            return false;
        }
        let mut count = 0;
        for &index in self.world.alive_indices() {
            let Some(entity) = self.world.entity_at_index(index) else {
                continue;
            };
            if entity == (Entity { id, generation })
                || self.data_scene.gameplay.combat.owns_spawned_actor(entity)
                || self.data_scene.gameplay.combat.owns_projectile(entity)
            {
                continue;
            }
            if matches!(
                self.world.movement_pattern(entity),
                Some(MovementPattern::Chase { .. })
            ) {
                if !SpatialNavigation::combat_supported(&self.world, entity)
                    || self.spatial_scene.attachments.contains(entity)
                {
                    return false;
                }
                if let Some(MovementPattern::Chase {
                    target: MovementTarget::Entity(target),
                    ..
                }) = self.world.movement_pattern(entity)
                {
                    if self.world.height_span(target).is_none() {
                        return false;
                    }
                }
                count += 1;
            }
        }
        if count > config.agents
            || !self.configure_data_scene_gameplay_v3(
                has_actor,
                id,
                generation,
                interaction,
                combat,
                metadata,
                values,
                bindings,
            )
        {
            return false;
        }
        self.data_scene.gameplay.combat.navigation.config = Some(config);
        true
    }
}

#[wasm_bindgen]
impl Engine {
    pub fn data_scene_combat_crowd_version(&self) -> u32 {
        1
    }
    pub fn data_scene_combat_crowd_stats(&self) -> Vec<u32> {
        let nav = &self.data_scene.gameplay.combat.navigation;
        let mut result = vec![
            1,
            u32::from(nav.config.is_some_and(|c| c.avoidance.is_some())),
        ];
        result.extend_from_slice(&nav.crowd_stats);
        result
    }
    /// v4 plus optional avoidance padding (-1 disables), and source handle / stop-distance bindings.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_gameplay_v5(
        &mut self,
        has_actor: bool,
        id: u32,
        generation: u32,
        interaction: u32,
        combat: bool,
        metadata: &[u32],
        values: &[f32],
        bindings: &[u32],
        navigation: &[f32],
        agents: &[u32],
        distances: &[f32],
    ) -> bool {
        if navigation.len() != 7
            || !navigation[6].is_finite()
            || !(navigation[6] == -1. || (0. ..=4096.).contains(&navigation[6]))
            || !agents.len().is_multiple_of(2)
            || distances.len() != agents.len() / 2
            || distances.len() > 64
        {
            return false;
        }
        let mut stops = std::collections::BTreeMap::new();
        for (handle, &distance) in agents.chunks_exact(2).zip(distances) {
            let entity = Entity {
                id: handle[0],
                generation: handle[1],
            };
            if entity == (Entity { id, generation })
                || !distance.is_finite()
                || !(0. ..=4096.).contains(&distance)
                || !self.world.is_current_entity(entity)
                || self.data_scene.gameplay.combat.owns_projectile(entity)
                || self.data_scene.gameplay.combat.owns_spawned_actor(entity)
                || chase(&self.world, entity).is_none()
                || stops
                    .insert((entity.id, entity.generation), distance)
                    .is_some()
            {
                return false;
            }
        }
        if !self.configure_data_scene_gameplay_v4(
            has_actor,
            id,
            generation,
            interaction,
            combat,
            metadata,
            values,
            bindings,
            &navigation[..6],
        ) {
            return false;
        }
        let nav = &mut self.data_scene.gameplay.combat.navigation;
        if let Some(config) = &mut nav.config {
            config.avoidance = (navigation[6] >= 0.).then_some(navigation[6]);
            config.precise_stop = true;
        }
        nav.bindings = stops;
        true
    }
}

#[wasm_bindgen]
impl Engine {
    pub fn data_scene_combat_movement_version(&self) -> u32 {
        1
    }
    /// Additive opt-in for route seeking and budgeted velocity motion. flags bit0 enables all patterns.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_gameplay_v6(
        &mut self,
        has_actor: bool,
        id: u32,
        generation: u32,
        interaction: u32,
        combat: bool,
        metadata: &[u32],
        values: &[f32],
        bindings: &[u32],
        navigation: &[f32],
        agents: &[u32],
        distances: &[f32],
        flags: u32,
    ) -> bool {
        if flags > 1 || navigation.len() != 7 {
            return false;
        }
        if flags == 1 {
            let Some(config) = Config::decode(&navigation[..6]) else {
                return false;
            };
            let primary = Entity { id, generation };
            let mut count = 0;
            for &index in self.world.alive_indices() {
                let Some(entity) = self.world.entity_at_index(index) else {
                    continue;
                };
                if entity == primary
                    || self.data_scene.gameplay.combat.owns_spawned_actor(entity)
                    || self.data_scene.gameplay.combat.owns_projectile(entity)
                {
                    continue;
                }
                if let Some(pattern) = self.world.movement_pattern(entity) {
                    if matches!(
                        pattern,
                        MovementPattern::Chase { .. }
                            | MovementPattern::SeekTarget { .. }
                            | MovementPattern::Accelerate { .. }
                    ) {
                        count += 1;
                        if !SpatialNavigation::combat_supported(&self.world, entity)
                            || self.spatial_scene.attachments.contains(entity)
                            || self.data_scene.gameplay.combat.owns_projectile(entity)
                        {
                            return false;
                        }
                        if let MovementPattern::Chase {
                            target: MovementTarget::Entity(target),
                            ..
                        }
                        | MovementPattern::SeekTarget {
                            target: MovementTarget::Entity(target),
                            ..
                        } = pattern
                        {
                            if self.world.height_span(target).is_none() {
                                return false;
                            }
                        }
                    }
                }
            }
            if count > config.agents {
                return false;
            }
        }
        if !self.configure_data_scene_gameplay_v5(
            has_actor,
            id,
            generation,
            interaction,
            combat,
            metadata,
            values,
            bindings,
            navigation,
            agents,
            distances,
        ) {
            return false;
        }
        if let Some(config) = &mut self.data_scene.gameplay.combat.navigation.config {
            config.all_patterns = flags == 1;
        }
        true
    }
}

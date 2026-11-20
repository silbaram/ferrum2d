//! Native combat route scheduling. Fixed geometry guides planning; the shared
//! character tick still resolves moving bodies and every actual contact.
use super::spatial_actor::navigation::{search::Search, ActorNavigation, MotionProgress, Point};
use std::sync::Arc;
mod cache;
mod file_admission;
mod file_arcs;
pub(in crate::engine) use file_arcs::NativeRouteArcLocation;
mod crowd;
mod patterns;
use super::*;
use crate::components::gameplay::MovementPattern;
use crate::components::Velocity;
use crate::input::InputState;
use crate::spatial_scene::{SpatialMoveStatus, SpatialScene};
use crate::world::World;

const FRAME_WORK: u64 = 1_000_000;
const SLICE_WORK: u64 = 262_144;

#[derive(Clone, Copy)]
pub(in crate::engine) struct NativeNavigationConfig {
    pub cell: f32,
    pub step: f32,
    pub drop: f32,
    pub interval: f32,
    pub radius: f32,
    pub agents: usize,
    pub avoidance: Option<f32>,
    pub all_patterns: bool,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Agent {
    entity: Entity,
    target: Option<Entity>,
    #[serde(with = "crate::checkpoint_codec::array")]
    goal: [f32; 3],
    floor: u32,
    speed: f32,
    cooldown: f32,
    route: ActorNavigation,
    detour: Option<([f32; 2], f32)>,
    intent: Velocity,
    pattern: Option<MovementPattern>,
    last_pose: Option<Pose>,
    velocity_moving: bool,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
enum JobKind {
    Search,
    Connector(Arc<[Point]>),
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Pending {
    entity: Entity,
    job: Search,
    key: cache::Key,
    kind: JobKind,
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct NativeCombatNavigation {
    #[serde(with = "crate::checkpoint_codec::vector")]
    agents: Vec<Agent>,
    pending: Option<Pending>,
    cursor: usize,
    used: u64,
    advanced: bool,
    cache: cache::RouteCache,
    cache_hits: u32,
    searches: u32,
    failed: u32,
    deferred: u32,
    frame_searches: u32,
    slices: u32,
    yields: u32,
    cancelled: u32,
    request_status: u32,
    nodes: u32,
    probes: u32,
    peak_work: u32,
    frame_search_work: u32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    peers: Vec<crate::physics3d::CharacterCrowdPeer>,
    crowd_scratch: crate::physics3d::CharacterProbeScratch,
    // stopped, cumulative yields/tests, frame tests/steered motions.
    #[serde(with = "crate::checkpoint_codec::array")]
    crowd_stats: [u32; 5],
}
impl NativeCombatNavigation {
    pub(in crate::engine) fn begin_frame(&mut self) {
        self.used = 0;
        self.advanced = false;
        self.frame_searches = 0;
        self.frame_search_work = 0;
        self.crowd_stats[3] = 0;
        self.crowd_stats[4] = 0;
    }
    pub(in crate::engine) fn diagnostics(&self) -> Vec<u32> {
        let moving = self
            .agents
            .iter()
            .filter(|a| a.route.status == SpatialMoveStatus::Moving || a.velocity_moving)
            .count() as u32;
        vec![
            1,
            1,
            self.agents.len() as u32,
            moving,
            self.agents.len() as u32 - moving,
            self.searches,
            self.failed,
            self.deferred,
            self.frame_searches,
            self.used as u32,
            self.request_status,
            self.nodes,
            self.probes,
        ]
    }
    pub(in crate::engine) fn scheduler_stats(&self) -> Vec<u32> {
        vec![
            1,
            1,
            u32::from(self.pending.is_some()),
            self.cache.len() as u32,
            self.cache_hits,
            self.slices,
            self.yields,
            self.cancelled,
            self.frame_search_work,
            self.peak_work,
        ]
    }
    pub(in crate::engine) fn crowd_stats(&self, enabled: bool) -> Vec<u32> {
        let mut words = vec![1, u32::from(enabled)];
        words.extend_from_slice(&self.crowd_stats);
        words
    }
    fn charge(&mut self, n: u64) -> bool {
        if self.used.saturating_add(n) > FRAME_WORK {
            self.deferred = self.deferred.saturating_add(1);
            return false;
        }
        self.used += n;
        true
    }
    fn cancel(&mut self, entity: Entity) {
        if self.pending.as_ref().is_some_and(|p| p.entity == entity) {
            self.pending = None;
            self.cancelled = self.cancelled.saturating_add(1);
        }
    }
}
impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn observe_combat_navigation(
        &mut self,
        nav: &mut NativeCombatNavigation,
        scene: &SpatialScene,
    ) {
        for agent in &mut nav.agents {
            let Ok(body) = self.spatial_actor_body(agent.entity) else {
                agent.route.cancel();
                continue;
            };
            if let (Ok(state), Ok(character)) = (
                self.physics.body_state(body),
                self.physics.character_state(body),
            ) {
                agent.last_pose = Some(state.pose);
                agent.route.observe(
                    agent.entity,
                    state.pose,
                    character.grounded,
                    self.navigation_surface(scene, agent.entity).map(|s| s.0),
                    MotionProgress::TraveledDistance,
                );
            }
        }
    }
    pub(in crate::engine) fn release_combat_navigation(
        &mut self,
        nav: &mut NativeCombatNavigation,
    ) {
        for agent in &nav.agents {
            if let Ok(body) = self.spatial_actor_body(agent.entity) {
                let _ = self.physics.set_character_ground_velocity(body, [0.; 3]);
            }
        }
        *nav = NativeCombatNavigation::default();
    }
    pub(in crate::engine) fn native_navigation_available(&self) -> bool {
        self.physics.config().space == Space::Spatial
    }
    pub(in crate::engine) fn native_navigation_source(
        &self,
        entity: Entity,
        step: f32,
        drop: f32,
    ) -> bool {
        self.spatial_actor_settings_valid(entity, step, drop)
    }
    fn navigation_surface(&self, scene: &SpatialScene, entity: Entity) -> Option<(u32, u32)> {
        let body = self.bindings.get(&(entity.id, entity.generation))?.body;
        let ground = self.physics.character_state(body).ok()?.ground?;
        let UnifiedTerrainSource::SpatialSurface { id } = self.terrain.source(ground.collider)?
        else {
            return None;
        };
        scene
            .surfaces
            .iter()
            .find(|s| s.id == id)
            .map(|s| (s.id, s.floor))
    }
    pub(in crate::engine) fn step_combat_navigation(
        &mut self,
        nav: &mut NativeCombatNavigation,
        world: &World,
        scene: &SpatialScene,
        c: NativeNavigationConfig,
        radii: &BTreeMap<(u32, u32), f32>,
    ) {
        let dt = self.physics.config().step_seconds;
        nav.crowd_stats[0] = 0;
        for a in &mut nav.agents {
            a.velocity_moving = false;
        }
        let admission = world.alive_indices().len() as u64 * (c.agents as u64 + 3) + 1;
        if !nav.charge(admission) {
            for a in &nav.agents {
                if let Ok(body) = self.spatial_actor_body(a.entity) {
                    let _ = self.physics.set_character_ground_velocity(body, [0.; 3]);
                }
            }
            return;
        }
        let cache_ready =
            nav.charge(self.physics.collider_count() as u64 * 4 + scene.surfaces.len() as u64 + 9);
        let cache_changed = cache_ready && nav.cache.validate(&self.physics, scene, world);
        if (!cache_ready || cache_changed)
            && nav
                .pending
                .as_ref()
                .is_some_and(|p| matches!(p.kind, JobKind::Connector(_)))
        {
            if let Some(p) = nav.pending.take() {
                nav.cancelled = nav.cancelled.saturating_add(1);
                nav.agents
                    .iter_mut()
                    .filter(|a| a.entity == p.entity)
                    .for_each(|a| a.cooldown = 0.);
            }
        }
        // Capacity and actor ownership are checked again after runtime authoring changes.
        nav.agents.retain(|a| {
            let keep = world.is_current_entity(a.entity)
                && world
                    .movement_pattern(a.entity)
                    .is_some_and(|p| patterns::supported(p, c.all_patterns))
                && Some(a.entity) != world.primary_actor_entity()
                && scene.actor.map(|a| a.0) != Some(a.entity)
                && !scene.attachments.contains(a.entity)
                && self.native_navigation_source(a.entity, c.step, c.drop);
            if !keep && scene.actor.map(|a| a.0) != Some(a.entity) {
                if let Ok(body) = self.spatial_actor_body(a.entity) {
                    let _ = self.physics.set_character_ground_velocity(body, [0.; 3]);
                }
            }
            keep
        });
        for &index in world.alive_indices() {
            let Some(entity) = world.entity_at_index(index) else {
                continue;
            };
            if Some(entity) == world.primary_actor_entity()
                || scene.actor.map(|a| a.0) == Some(entity)
                || scene.attachments.contains(entity)
            {
                continue;
            }
            let eligible = world
                .movement_pattern(entity)
                .is_some_and(|p| patterns::supported(p, c.all_patterns));
            if eligible
                && !self.native_navigation_source(entity, c.step, c.drop)
                && self.owns_combat_movement(world, entity)
            {
                self.apply_combat_movement(world, entity, MovementPattern::Static);
            }
            if eligible
                && self.native_navigation_source(entity, c.step, c.drop)
                && !nav.agents.iter().any(|a| a.entity == entity)
            {
                if nav.agents.len() < c.agents {
                    nav.agents.push(Agent {
                        entity,
                        target: None,
                        goal: [0.; 3],
                        floor: 0,
                        speed: 0.,
                        cooldown: 0.,
                        route: ActorNavigation::default(),
                        detour: None,
                        intent: patterns::observed_velocity(self, entity),
                        pattern: None,
                        last_pose: None,
                        velocity_moving: false,
                    });
                } else if let Ok(body) = self.spatial_actor_body(entity) {
                    let _ = self.physics.set_character_ground_velocity(body, [0.; 3]);
                }
            }
        }
        if nav
            .pending
            .as_ref()
            .is_some_and(|p| !nav.agents.iter().any(|a| a.entity == p.entity))
        {
            nav.pending = None;
            nav.cancelled = nav.cancelled.saturating_add(1);
        }
        if nav.agents.is_empty() {
            return;
        }
        nav.peers.clear();
        // Frame-local metadata, in exactly the same order as observed peers.
        // The existing roster admission covers this bounded peer collection;
        // each Chase separately admits its N+8 target comparisons below.
        let mut peer_targets = [None; 64];
        if c.avoidance.is_some() {
            for agent in &nav.agents {
                if let Ok(body) = self.spatial_actor_body(agent.entity) {
                    if let Ok(state) = self.physics.character_state(body) {
                        if let Some(slot) = peer_targets.get_mut(nav.peers.len()) {
                            *slot =
                                crowd::cohort_target(agent, world.movement_pattern(agent.entity));
                        }
                        nav.peers.push(crate::physics3d::CharacterCrowdPeer {
                            body,
                            velocity: state.velocity,
                        });
                    }
                }
            }
        }
        let count = nav.agents.len();
        // Motion service rotates independently of the single A* job. A pending
        // search must not pin the same actors at the head of every crowded frame
        // and repeatedly spend the shared work budget before later peers run.
        let start = nav.cursor % count;
        for offset in 0..count {
            let i = (start + offset) % count;
            let entity = nav.agents[i].entity;
            let Ok(body) = self.spatial_actor_body(entity) else {
                nav.cancel(entity);
                continue;
            };
            let _ = self.physics.set_character_ground_velocity(body, [0.; 3]);
            if !nav.charge(world.alive_indices().len() as u64 + scene.surfaces.len() as u64 + 1) {
                continue;
            }
            let Some(pattern) = world.movement_pattern(entity) else {
                continue;
            };
            let state = match self.physics.body_state(body) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let teleported = nav.agents[i].last_pose.is_some_and(|p| p != state.pose);
            if nav.agents[i].pattern != Some(pattern) || teleported {
                nav.cancel(entity);
                nav.agents[i].route.cancel();
                nav.agents[i].detour = None;
                nav.agents[i].target = None;
                nav.agents[i].cooldown = 0.;
                nav.agents[i].pattern = Some(pattern);
                if teleported {
                    nav.agents[i].intent = patterns::observed_velocity(self, entity);
                }
            }
            if let MovementPattern::Accelerate {
                acceleration_x,
                acceleration_y,
                max_speed,
            } = pattern
            {
                patterns::accelerate(
                    self,
                    nav,
                    scene,
                    i,
                    c,
                    acceleration_x,
                    acceleration_y,
                    max_speed,
                );
                continue;
            }
            let Some((query, speed, steering)) = patterns::targeted(pattern) else {
                continue;
            };
            let radius = if matches!(pattern, MovementPattern::Chase { .. }) {
                radii
                    .get(&(entity.id, entity.generation))
                    .copied()
                    .unwrap_or(c.radius)
            } else {
                c.radius
            };
            if !speed.is_finite() || !(0. ..=1e6).contains(&speed) {
                nav.cancel(entity);
                nav.agents[i].route.cancel();
                nav.agents[i].intent = Velocity::default();
                continue;
            }
            let surface = self.navigation_surface(scene, entity);
            let grounded = self.physics.character_state(body).is_ok_and(|s| s.grounded);
            nav.agents[i].cooldown = (nav.agents[i].cooldown - dt).max(0.);
            let Some(target) = self.movement_target_entity(world, entity, query) else {
                nav.cancel(entity);
                nav.agents[i].route.cancel();
                nav.agents[i].target = None;
                nav.agents[i].intent = Velocity::default();
                continue;
            };
            let Some(position) = self.gameplay_position(world, target) else {
                continue;
            };
            let floor = self
                .navigation_surface(scene, target)
                .map(|s| s.1)
                .or_else(|| world.height_span(target).map(|s| s.floor.0))
                .unwrap_or(0);
            nav.cache.observe_target(target, position, floor);
            if nav.pending.as_ref().is_some_and(|p| {
                p.entity == entity
                    && matches!(p.kind, JobKind::Connector(_))
                    && (p.key.goal != position || p.key.floor != floor)
            }) {
                nav.cancel(entity);
                nav.agents[i].cooldown = 0.;
            }
            let identity = nav.agents[i].target != Some(target)
                || nav.agents[i].floor != floor
                || nav.agents[i].speed != speed;
            let changed = (position[0] - nav.agents[i].goal[0])
                .hypot(position[2] - nav.agents[i].goal[2])
                >= (c.cell * 0.5).min(radius.max(0.001))
                || (position[1] - nav.agents[i].goal[1]).abs() > 0.001;
            if identity {
                nav.cancel(entity);
                nav.agents[i].route.cancel();
                nav.agents[i].cooldown = 0.;
                nav.agents[i].detour = None;
            }
            if grounded
                && surface.is_some_and(|s| s.1 == floor)
                && (position[0] - state.pose.position[0])
                    .hypot(position[2] - state.pose.position[2])
                    <= radius
            {
                nav.cancel(entity);
                nav.agents[i].route.cancel();
                nav.agents[i].target = Some(target);
                nav.agents[i].detour = None;
                nav.agents[i].intent = Velocity::default();
                if c.avoidance.is_some() {
                    nav.crowd_stats[0] += 1;
                }
                continue;
            }
            let retry = nav.agents[i].route.status != SpatialMoveStatus::Moving;
            if grounded
                && !nav.advanced
                && (identity || nav.agents[i].cooldown == 0. && (retry || changed))
                && nav.pending.as_ref().is_none_or(|p| p.entity == entity)
            {
                if FRAME_WORK - nav.used < 4104 {
                    nav.deferred = nav.deferred.saturating_add(1);
                    continue;
                }
                if nav.pending.is_none() {
                    if let Err(error) = self.physics.set_character_traversal(body, c.step, c.drop) {
                        self.last_error = Some(error.into());
                        continue;
                    }
                    let profile = match self.physics.character_route_profile(body) {
                        Ok(p) => p,
                        Err(error) => {
                            self.last_error = Some(error.into());
                            continue;
                        }
                    };
                    let key = cache::Key {
                        target,
                        goal: position,
                        floor,
                        radius,
                        cell: c.cell,
                        profile,
                    };
                    let cached = cache_ready.then(|| nav.cache.find(&key)).flatten();
                    nav.agents[i].target = Some(target);
                    nav.agents[i].goal = position;
                    nav.agents[i].floor = floor;
                    nav.agents[i].speed = speed;
                    nav.agents[i].route.cancel();
                    let job = if let Some(points) = cached {
                        let preparation = points.len() as u64 * 2 + 8;
                        if FRAME_WORK - nav.used < preparation + 4104 {
                            nav.deferred = nav.deferred.saturating_add(1);
                            continue;
                        }
                        // Admit both nearest-waypoint traversal and any suffix
                        // materialization before visiting/copying cached points.
                        nav.charge(preparation);
                        let points = route_suffix(points, state.pose);
                        let Some(&first) = points.first() else {
                            continue;
                        };
                        Search::connector(self, scene, body, first, c.cell)
                            .map(|job| (job, JobKind::Connector(points)))
                    } else {
                        let dx = state.pose.position[0] - position[0];
                        let dz = state.pose.position[2] - position[2];
                        let length = dx.hypot(dz);
                        let scale = if length > 0. {
                            radius * 0.95 / length
                        } else {
                            0.
                        };
                        let seed = Pose {
                            position: [
                                position[0] + dx * scale,
                                state.pose.position[1],
                                position[2] + dz * scale,
                            ],
                            ..state.pose
                        };
                        nav.searches = nav.searches.saturating_add(1);
                        Search::new(self, scene, body, seed, floor, c.cell)
                            .map(|job| (job.fixed_geometry(), JobKind::Search))
                    };
                    match job {
                        Ok((job, kind)) => {
                            nav.pending = Some(Pending {
                                entity,
                                job,
                                key,
                                kind,
                            })
                        }
                        Err(code) => {
                            nav.request_status = code;
                            nav.failed = nav.failed.saturating_add(1);
                            nav.agents[i].cooldown = c.interval;
                            continue;
                        }
                    }
                }
                if let Some(mut pending) = nav.pending.take() {
                    nav.advanced = true;
                    if matches!(pending.kind, JobKind::Search) {
                        nav.frame_searches += 1;
                    }
                    let before = pending.job.work;
                    let result = pending.job.advance(
                        self,
                        scene,
                        SLICE_WORK.min(FRAME_WORK - nav.used - 4104),
                    );
                    let work = pending.job.work - before;
                    nav.used += work;
                    nav.frame_search_work += work as u32;
                    nav.nodes = pending.job.expanded;
                    nav.probes = pending.job.probes;
                    nav.peak_work = nav.peak_work.max(pending.job.work as u32);
                    nav.slices = nav.slices.saturating_add(1);
                    match result {
                        Ok(Some(points)) => {
                            let final_len = match &pending.kind {
                                JobKind::Search => points.len(),
                                JobKind::Connector(shared) => joined_len(&points, shared),
                            };
                            // The search slice reserved4104 for at most4096
                            // committed points. The connector and cached suffix
                            // must fit that same route/byte/cold-admission bound.
                            if final_len == 0 || final_len > 4096 {
                                if matches!(pending.kind, JobKind::Connector(_)) {
                                    nav.cache.remove(&pending.key);
                                }
                                nav.failed = nav.failed.saturating_add(1);
                                nav.request_status = 5;
                                nav.agents[i].cooldown = c.interval;
                                continue;
                            }
                            nav.charge(final_len as u64 + 8);
                            let shared = match pending.kind {
                                JobKind::Search => {
                                    let shared: Arc<[Point]> = points.into();
                                    if cache_ready
                                        && pending.key.goal == position
                                        && pending.key.floor == floor
                                    {
                                        nav.cache.store(pending.key, Arc::clone(&shared));
                                    }
                                    shared
                                }
                                JobKind::Connector(shared) => {
                                    let Some(joined) = join_route(points, shared) else {
                                        nav.failed = nav.failed.saturating_add(1);
                                        nav.request_status = 5;
                                        nav.agents[i].cooldown = c.interval;
                                        continue;
                                    };
                                    nav.cache_hits = nav.cache_hits.saturating_add(1);
                                    joined
                                }
                            };
                            let skin = self
                                .physics
                                .character_config(body)
                                .map_or(0.001, |c| c.skin_width * 0.1);
                            nav.agents[i].route = ActorNavigation::from_route(
                                entity, shared, speed, skin, skin, state.pose,
                            );
                            nav.agents[i].cooldown = c.interval;
                            nav.request_status = 1;
                        }
                        Ok(None) => {
                            nav.pending = Some(pending);
                            nav.yields = nav.yields.saturating_add(1);
                        }
                        Err(code) => {
                            if code == 8 {
                                nav.cancelled = nav.cancelled.saturating_add(1);
                            } else {
                                nav.failed = nav.failed.saturating_add(1);
                            }
                            // A failed join does not invalidate other valid source connectors.
                            // Remove this key so the actor retries a full A* after the interval.
                            if matches!(pending.kind, JobKind::Connector(_)) {
                                nav.cache.remove(&pending.key);
                            }
                            nav.request_status = if code == 8 { 0 } else { code };
                            nav.agents[i].cooldown = c.interval;
                        }
                    }
                }
            }
            // Intent/shortcut-target lookup is O(1). Actual shortcut and crowd
            // terrain probes separately admit their full geometry work.
            if nav.charge(1) {
                if steering.is_some() && grounded {
                    patterns::shortcut(self, nav, scene, i, c.cell);
                }
                let (velocity, following) =
                    nav.agents[i]
                        .route
                        .intent(entity, state.pose, InputState::default(), dt);
                if following {
                    let canonical = if let Some(rate) = steering {
                        patterns::seek_velocity(&nav.agents[i], state.pose, speed, rate, dt)
                    } else {
                        Velocity {
                            vx: velocity[0],
                            vy: -velocity[2],
                        }
                    };
                    let desired = [canonical.vx, 0., -canonical.vy];
                    let result = if steering.is_some() || c.avoidance.is_some() {
                        if steering.is_none() {
                            if let Some(cohort) = crowd::cohort_mask(nav, target, &peer_targets) {
                                crowd::steer_with_cohort(
                                    self,
                                    nav,
                                    scene,
                                    i,
                                    desired,
                                    c.cell,
                                    c.avoidance,
                                    false,
                                    None,
                                    cohort,
                                )
                            } else {
                                crowd::Motion::default()
                            }
                        } else {
                            crowd::steer(
                                self,
                                nav,
                                scene,
                                i,
                                desired,
                                c.cell,
                                c.avoidance,
                                true,
                                (grounded && surface.is_some_and(|s| s.1 == floor))
                                    .then_some((position, radius)),
                            )
                        }
                    } else {
                        crowd::Motion {
                            velocity: desired,
                            admitted: true,
                        }
                    };
                    if result.admitted {
                        nav.agents[i].intent = canonical;
                    }
                    let velocity = result.velocity;
                    nav.agents[i].route.replace_intent(velocity, dt);
                    if let Err(error) = self.physics.set_character_ground_velocity(body, velocity) {
                        self.last_error = Some(error.into());
                    }
                }
            }
        }
        // Existing cursor storage is also the fair motion-service cursor. All
        // peers get first service within count accepted scheduling ticks; no new
        // clock, queue, persistent field or independent solver is introduced.
        nav.cursor = (start + 1) % count;
    }
}

// Cached routes are value-preserving certified suffixes. Joining at a nearby
// waypoint avoids sending every later actor back to the first producer's origin.
fn route_suffix(points: Arc<[Point]>, pose: Pose) -> Arc<[Point]> {
    let mut first = 0;
    let mut nearest = f64::INFINITY;
    for (index, point) in points.iter().enumerate() {
        let distance = point
            .pose
            .position
            .iter()
            .zip(pose.position)
            .map(|(a, b)| (f64::from(*a) - f64::from(b)).powi(2))
            .sum::<f64>();
        if distance < nearest {
            first = index;
            nearest = distance;
        }
    }
    if first == 0 {
        points
    } else {
        Arc::from(&points[first..])
    }
}

fn same_point(a: &Point, b: &Point) -> bool {
    a.surface == b.surface
        && a.pose
            .position
            .into_iter()
            .chain(a.pose.rotation)
            .zip(b.pose.position.into_iter().chain(b.pose.rotation))
            .all(|(a, b)| a.to_bits() == b.to_bits())
}
fn join_skip(connector: &[Point], shared: &[Point]) -> usize {
    usize::from(
        connector
            .last()
            .zip(shared.first())
            .is_some_and(|(a, b)| same_point(a, b)),
    )
}
fn joined_len(connector: &[Point], shared: &[Point]) -> usize {
    connector.len() + shared.len() - join_skip(connector, shared)
}
fn join_route(mut connector: Vec<Point>, shared: Arc<[Point]>) -> Option<Arc<[Point]>> {
    if connector.is_empty() || shared.is_empty() || joined_len(&connector, &shared) > 4096 {
        return None;
    }
    if connector.len() == 1 && same_point(&connector[0], &shared[0]) {
        return Some(shared);
    }
    let skip = join_skip(&connector, &shared);
    connector.try_reserve_exact(shared.len() - skip).ok()?;
    connector.extend_from_slice(&shared[skip..]);
    Some(connector.into())
}

#[cfg(test)]
mod controller_admission_tests;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod dense_tests;

//! Bounded request-time A* and a scene-owned follower. All edge probes use native movement/collision.
use super::SpatialScene;
use crate::components::{
    CollisionMask, HeightSpan, PhysicsFloorId, RigidBodyType, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::input::InputState;
use crate::physics::{PhysicsCounters, PhysicsSystem, KINEMATIC_EPSILON};
use crate::world::World;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap};

mod crowd;
mod incremental;
mod steering;
mod velocity;
use crowd::CrowdMotion;
pub(crate) use crowd::{CombatCrowd, CombatNavigationStep};
pub(crate) use incremental::{CombatRouteKey, SharedCombatRoute};
pub(crate) use velocity::CombatVelocityRequest;

const MAX_NODES: usize = 4096;
const MAX_PROBES: u32 = 32768;
const MAX_WORK: u64 = 8_000_000;
const FRAME_WORK: u64 = 1_000_000;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
#[repr(u32)]
pub(crate) enum SpatialMoveStatus {
    #[default]
    Idle,
    Moving,
    Arrived,
    Blocked,
    Cancelled,
}
/// Cold diagnostic extension; existing six-word stats and movement status retain their layout.
#[derive(Clone, Copy, Default)]
#[repr(u32)]
enum RequestStatus {
    #[default]
    NotRequested,
    Accepted,
    InvalidRequest,
    UnsupportedActor,
    NoPath,
    NodeBudgetExceeded,
    ProbeBudgetExceeded,
    WorkBudgetExceeded,
    FrameBudgetExceeded,
}
#[derive(Clone, Copy)]
struct Waypoint {
    at: Transform2D,
    span: HeightSpan,
    surface: usize,
}
struct Node {
    pose: Waypoint,
    cell: Option<(i32, i32)>,
    cost: f64,
    parent: usize,
    closed: bool,
    auxiliary: bool,
}
#[derive(Clone, Copy)]
struct Open {
    index: usize,
    score: f64,
}
impl PartialEq for Open {
    fn eq(&self, other: &Self) -> bool {
        self.index == other.index && self.score.total_cmp(&other.score) == Ordering::Equal
    }
}
impl Eq for Open {}
impl PartialOrd for Open {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Open {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .score
            .total_cmp(&self.score)
            .then_with(|| other.index.cmp(&self.index))
    }
}
#[derive(Default)]
struct Search {
    nodes: Vec<Node>,
    cells: BTreeMap<(i32, i32), Vec<usize>>,
    open: BinaryHeap<Open>,
    probes: u32,
    work: u64,
    expanded: u32,
}

#[derive(Default)]
pub(crate) struct SpatialNavigation {
    pub status: SpatialMoveStatus,
    actor: Option<Entity>,
    points: Vec<Waypoint>,
    next: usize,
    planned: usize,
    speed: f32,
    radius: f32,
    cancel_on_input: bool,
    cell_size: f32,
    pending: f64,
    last: Option<(Transform2D, HeightSpan)>,
    last_motion: Option<(f64, f64)>,
    search: Search,
    searches: u32,
    request_status: RequestStatus,
    requests: u32,
    target_count: usize,
    preparation_work: u64,
    combat: bool,
    combat_step: f32,
    combat_drop: f32,
    work_limit: u64,
    frame_limit: u64,
    update_work: u64,
    precise_stop: bool,
    crowd_step: CombatNavigationStep,
    crowd_candidates: u32,
    crowd_detour: Option<((f64, f64), f64)>,
    search_peers: Vec<Entity>,
    search_padding: f32,
    search_neighbors: u32,
    job: Option<incremental::SearchJob>,
    steering: Option<(Velocity, f32)>,
}

/// Internal multi-actor request; the primary actor binding is never temporarily replaced.
pub(crate) struct CombatNavigationRequest<'a> {
    pub actor: Entity,
    pub goal: Transform2D,
    pub floor: u32,
    pub speed: f32,
    pub cell: f32,
    pub radius: f32,
    pub step: f32,
    pub drop: f32,
    pub work_limit: u64,
    pub preparation_bound: u64,
    pub precise_stop: bool,
    pub crowd: Option<CombatCrowd<'a>>,
    pub preserve_credit: bool,
}
pub(crate) struct CombatNavigationSearch {
    pub accepted: bool,
    pub pending: bool,
    pub work: u64,
    pub nodes: u32,
    pub probes: u32,
    pub status: u32,
    pub neighbors: u32,
}
fn distance(a: Transform2D, b: Transform2D) -> f64 {
    (f64::from(a.x) - f64::from(b.x)).hypot(f64::from(a.y) - f64::from(b.y))
}
fn motion_fits_credit(from: Transform2D, to: Transform2D, budget: f64) -> bool {
    let ulp = |a: f32, b: f32| {
        f64::from(
            (a.next_up() - a)
                .abs()
                .max((a - a.next_down()).abs())
                .max((b.next_up() - b).abs())
                .max((b - b.next_down()).abs()),
        )
    };
    let rounding = (ulp(from.x, to.x) + ulp(from.y, to.y)) * 2.;
    distance(from, to) <= budget + rounding.min(budget * 0.001)
}
fn supported(world: &World, actor: Entity, combat: bool) -> bool {
    world.is_current_entity(actor)
        && world
            .transform(actor)
            .is_some_and(|p| p.x.is_finite() && p.y.is_finite())
        && world.velocity(actor).is_some()
        && world
            .rigid_body(actor)
            .is_some_and(|b| b.enabled && b.body_type == RigidBodyType::Kinematic)
        && world.compound_collider_count(actor) == 1
        && world
            .collider(actor)
            .is_some_and(|c| c.enabled && (combat || !c.is_trigger))
        && world.height_span(actor).is_some()
}
fn pose(
    scene: &SpatialScene,
    world: &World,
    actor: Entity,
    at: Transform2D,
    floor: u32,
) -> Option<Waypoint> {
    let span = HeightSpan::new(PhysicsFloorId(floor), 0., world.height_span(actor)?.height)?;
    let center = world.collider(actor)?.center(at);
    let hit = scene.physics.hd2d_surface_at(center, Some(span))?;
    if hit.blocks_movement || !scene.surfaces.get(hit.layer_index)?.walkable {
        return None;
    }
    Some(Waypoint {
        at,
        span: HeightSpan::new(hit.floor, hit.elevation, span.height)?,
        surface: hit.layer_index,
    })
}
// A peer corner outside a narrow bridge may still need a waypoint just inside its edge.
// Choose a bounded same-floor projection; native edge probes remain authoritative.
fn crowd_corner_poses(
    scene: &SpatialScene,
    world: &World,
    actor: Entity,
    point: Transform2D,
    floor: u32,
    peer_surface: Option<usize>,
) -> [Option<Waypoint>; 2] {
    if let Some(p) = pose(scene, world, actor, point, floor) {
        return [Some(p), None];
    }
    let Some(collider) = world.collider(actor) else {
        return [None, None];
    };
    let center = collider.center(point);
    let mut nearest = None;
    let mut closest = f64::INFINITY;
    for surface in scene
        .surfaces
        .iter()
        .filter(|s| s.walkable && s.floor == floor)
    {
        let [x, y, width, depth] = surface.bounds;
        let low = [x, y];
        let high = [(x + width).next_down(), (y + depth).next_down()];
        if low[0] > high[0] || low[1] > high[1] {
            continue;
        }
        let (Some(px), Some(py)) = (
            projected_axis(center.x, collider.offset_x, low[0], high[0]),
            projected_axis(center.y, collider.offset_y, low[1], high[1]),
        ) else {
            continue;
        };
        let projected = Transform2D { x: px, y: py };
        let d = distance(point, projected);
        if d < closest {
            nearest = Some(projected);
            closest = d;
        }
    }
    let projected = nearest.and_then(|p| pose(scene, world, actor, p, floor));
    let adjacent = peer_surface.and_then(|from| {
        scene
            .surfaces
            .iter()
            .enumerate()
            .find(|(i, s)| {
                s.walkable
                    && s.floor != floor
                    && center.x >= s.bounds[0]
                    && center.x < s.bounds[0] + s.bounds[2]
                    && center.y >= s.bounds[1]
                    && center.y < s.bounds[1] + s.bounds[3]
                    && scene.navigation_surfaces_connected(from, *i)
            })
            .and_then(|(_, s)| pose(scene, world, actor, point, s.floor))
            .filter(|p| scene.navigation_surfaces_connected(from, p.surface))
    });
    [projected, adjacent]
}
// Subtracting a large collider offset can round back onto the excluded upper edge.
fn projected_axis(center: f32, offset: f32, low: f32, high: f32) -> Option<f32> {
    let mut at = center.clamp(low, high) - offset;
    for _ in 0..2 {
        let actual = at + offset;
        if actual.is_finite() && (low..=high).contains(&actual) {
            return Some(at);
        }
        at = if actual < low {
            at.next_up()
        } else {
            at.next_down()
        };
    }
    None
}
// The alive scan and target sort happen once per request/frame, never once per edge/substep.
fn preparation_work(world: &World, targets: usize) -> u64 {
    let targets = targets.max(1) as u64;
    (world.alive_indices().len() as u64)
        .saturating_add(targets.saturating_mul(u64::from(targets.ilog2()) + 1))
}
// Conservative nested sweeps/overlap/surface scans, including per-query candidate sorting.
fn work(scene: &SpatialScene, targets: usize, from: Transform2D, to: Transform2D) -> u64 {
    let cell = scene
        .surfaces
        .iter()
        .fold(f32::INFINITY, |m, s| m.min(s.bounds[2]).min(s.bounds[3]));
    let steps = ((to.x - from.x).abs().max((to.y - from.y).abs()) / (cell * 0.25))
        .ceil()
        .max(1.0);
    if !steps.is_finite() || steps > 128. {
        return MAX_WORK + 1;
    }
    let proxies = (targets + 1 + scene.surfaces.len()).max(1) as u64;
    (steps as u64)
        .saturating_mul(proxies)
        .saturating_mul(u64::from(proxies.ilog2()) + 1)
        .saturating_mul(64)
}
impl SpatialNavigation {
    fn solid_mask(&self) -> CollisionMask {
        if self.combat {
            CollisionMask::WALL
        } else {
            CollisionMask::ALL
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub fn plan(
        &mut self,
        scene: &mut SpatialScene,
        world: &mut World,
        goal: Transform2D,
        floor: u32,
        speed: f32,
        cell: f32,
        radius: f32,
        cancel_on_input: bool,
    ) -> bool {
        self.combat = false;
        self.search_peers.clear();
        self.precise_stop = false;
        self.work_limit = MAX_WORK;
        let Some((actor, _, step, drop)) = scene.actor else {
            self.begin_request();
            return false;
        };
        self.plan_actor(
            scene,
            world,
            actor,
            step,
            drop,
            goal,
            floor,
            speed,
            cell,
            radius,
            cancel_on_input,
        )
    }
    pub(crate) fn invalidate_combat(&mut self) {
        self.finish(SpatialMoveStatus::Cancelled);
    }
    pub(crate) fn stop_combat(&mut self) {
        self.finish(SpatialMoveStatus::Arrived);
    }
    pub(crate) fn combat_can_stop(
        scene: &SpatialScene,
        world: &World,
        actor: Entity,
        goal: Transform2D,
        span: HeightSpan,
        radius: f32,
    ) -> bool {
        let Some(at) = world.transform(actor) else {
            return false;
        };
        let Some(current) = world.height_span(actor) else {
            return false;
        };
        current.floor == span.floor
            && distance(at, goal) <= f64::from(radius)
            && pose(scene, world, actor, at, current.floor.0)
                .zip(pose(scene, world, actor, goal, span.floor.0))
                .is_some_and(|(a, b)| {
                    a.surface == b.surface && (b.span.elevation - span.elevation).abs() <= 0.001
                })
    }
    pub(crate) fn combat_supported(world: &World, actor: Entity) -> bool {
        supported(world, actor, true)
    }
    pub(crate) fn combat_goal_matches(
        scene: &SpatialScene,
        world: &World,
        actor: Entity,
        goal: Transform2D,
        span: HeightSpan,
    ) -> bool {
        pose(scene, world, actor, goal, span.floor.0)
            .is_some_and(|p| (p.span.elevation - span.elevation).abs() <= 0.001)
    }
    pub(crate) fn plan_combat(
        &mut self,
        scratch: &mut Self,
        scene: &mut SpatialScene,
        world: &mut World,
        request: CombatNavigationRequest<'_>,
    ) -> CombatNavigationSearch {
        let previous_credit = self.pending;
        self.combat = true;
        self.precise_stop = request.precise_stop;
        self.work_limit = request.work_limit;
        self.combat_step = request.step;
        self.combat_drop = request.drop;
        self.search_peers.clear();
        if let Some(crowd) = request.crowd {
            self.search_peers.extend_from_slice(crowd.peers);
            self.search_padding = crowd.padding;
        }
        std::mem::swap(&mut self.search, &mut scratch.search);
        let accepted = if request.preparation_bound > request.work_limit {
            self.begin_request();
            self.request_status = RequestStatus::FrameBudgetExceeded;
            false
        } else {
            self.plan_actor(
                scene,
                world,
                request.actor,
                request.step,
                request.drop,
                request.goal,
                request.floor,
                request.speed,
                request.cell,
                request.radius,
                false,
            )
        };
        if accepted && request.preserve_credit {
            self.pending = previous_credit;
        }
        let result = CombatNavigationSearch {
            accepted,
            pending: false,
            work: self.search.work,
            nodes: self.search.expanded,
            probes: self.search.probes,
            status: self.request_status as u32,
            neighbors: self.search_neighbors,
        };
        self.search_peers.clear();
        std::mem::swap(&mut self.search, &mut scratch.search);
        result
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn update_combat(
        &mut self,
        scene: &mut SpatialScene,
        world: &mut World,
        delta: f32,
        counters: &mut PhysicsCounters,
        available: u64,
        preparation_bound: u64,
        crowd: Option<CombatCrowd<'_>>,
    ) -> CombatNavigationStep {
        if self.status != SpatialMoveStatus::Moving || preparation_bound > available {
            return CombatNavigationStep::default();
        }
        let Some(actor) = self.actor else {
            return CombatNavigationStep::default();
        };
        self.frame_limit = available;
        let targets = scene.movement_scratch.begin_spatial_query(world, actor);
        self.target_count = targets;
        self.update(
            scene,
            world,
            InputState::default(),
            delta,
            counters,
            targets,
            crowd,
        );
        scene.movement_scratch.end_spatial_query();
        let mut result = std::mem::take(&mut self.crowd_step);
        result.work = self.update_work.max(preparation_work(world, targets));
        result
    }
    fn begin_request(&mut self) {
        self.request_status = RequestStatus::UnsupportedActor;
        self.requests = self.requests.saturating_add(1);
        self.target_count = 0;
        self.preparation_work = 0;
        self.search.nodes.clear();
        self.search.cells.clear();
        self.search.open.clear();
        self.search.probes = 0;
        self.search.work = 0;
        self.search.expanded = 0;
        self.search_neighbors = 0;
    }
    pub fn reject_unavailable_request(&mut self) {
        self.begin_request();
    }
    pub fn diagnostics(&self) -> Vec<u32> {
        vec![
            1,
            self.request_status as u32,
            self.requests,
            self.target_count as u32,
            self.preparation_work.min(u64::from(u32::MAX)) as u32,
        ]
    }
    pub fn cancel(&mut self) -> bool {
        if self.status != SpatialMoveStatus::Moving {
            return false;
        }
        self.finish(SpatialMoveStatus::Cancelled);
        true
    }
    fn finish(&mut self, status: SpatialMoveStatus) {
        self.status = status;
        self.actor = None;
        self.points.clear();
        self.next = 0;
        self.pending = 0.;
        self.crowd_detour = None;
    }
    pub fn animation_target(&self) -> Option<Transform2D> {
        (self.status == SpatialMoveStatus::Moving)
            .then(|| self.points.get(self.next).map(|p| p.at))
            .flatten()
    }
    pub fn animation_ended(&self) -> bool {
        matches!(
            self.status,
            SpatialMoveStatus::Arrived | SpatialMoveStatus::Blocked
        )
    }
    pub fn animation_last_motion(&self) -> Option<(f64, f64)> {
        self.last_motion
    }
    pub fn stats(&self) -> Vec<u32> {
        vec![
            self.search.expanded,
            self.search.probes,
            self.planned as u32,
            self.points.len().saturating_sub(self.next) as u32,
            self.searches,
            self.search.work as u32,
        ]
    }
    #[allow(clippy::too_many_arguments)]
    fn probe(
        &mut self,
        scene: &mut SpatialScene,
        world: &mut World,
        actor: Entity,
        from: Waypoint,
        to: Waypoint,
        step: f32,
        drop: f32,
    ) -> Result<bool, RequestStatus> {
        if !self.search_peers.is_empty() {
            let charge = self.search_peers.len() as u64 * 8;
            if self.search.work.saturating_add(charge) > self.work_limit {
                return Err(RequestStatus::WorkBudgetExceeded);
            }
            self.search.work += charge;
            if !(CombatCrowd {
                peers: &self.search_peers,
                padding: self.search_padding,
            })
            .permits(
                world,
                actor,
                (from.at, from.span),
                (to.at, to.span),
                &mut self.search_neighbors,
            ) {
                return Ok(false);
            }
        }
        if self.search.probes >= MAX_PROBES {
            return Err(RequestStatus::ProbeBudgetExceeded);
        }
        let scan = self.target_count as u64;
        if self.search.work.saturating_add(scan) > self.work_limit {
            return Err(RequestStatus::WorkBudgetExceeded);
        }
        self.search.work += scan;
        let nearby = scene
            .movement_scratch
            .begin_spatial_segment(world, actor, from.at, to.at);
        let charge = work(scene, nearby, from.at, to.at);
        if self.search.work.saturating_add(charge) > self.work_limit {
            return Err(RequestStatus::WorkBudgetExceeded);
        }
        self.search.probes += 1;
        self.search.work += charge;
        let collider = world
            .collider(actor)
            .ok_or(RequestStatus::UnsupportedActor)?;
        if !scene.navigation_edge_crosses_supports(
            from.surface,
            to.surface,
            collider.center(from.at),
            collider.center(to.at),
        ) {
            return Ok(false);
        }
        world.set_transform(actor, from.at);
        world.set_height_span(actor, from.span);
        if !PhysicsSystem::spatial_body_pose_is_clear(
            world,
            &scene.physics,
            actor,
            from.at,
            &mut scene.movement_scratch,
            None,
            self.solid_mask(),
        ) {
            return Ok(false);
        }
        let ok = scene.move_body_internal(
            world,
            actor,
            to.at.x - from.at.x,
            to.at.y - from.at.y,
            step,
            drop,
            None,
            false,
            self.combat,
        );
        let end = world
            .transform(actor)
            .ok_or(RequestStatus::UnsupportedActor)?;
        let span = world
            .height_span(actor)
            .ok_or(RequestStatus::UnsupportedActor)?;
        let clear =
            ok && PhysicsSystem::spatial_body_pose_is_clear(
                world,
                &scene.physics,
                actor,
                end,
                &mut scene.movement_scratch,
                None,
                self.solid_mask(),
            ) && distance(end, to.at) <= 0.0001
                && span.floor == to.span.floor
                && (span.elevation - to.span.elevation).abs() <= 0.001
                && pose(scene, world, actor, end, span.floor.0)
                    .is_some_and(|p| p.surface == to.surface);
        Ok(clear)
    }
    #[allow(clippy::too_many_arguments)]
    fn search(
        &mut self,
        scene: &mut SpatialScene,
        world: &mut World,
        actor: Entity,
        goal: Transform2D,
        floor: u32,
        cell: f32,
        step: f32,
        drop: f32,
        radius: f32,
    ) -> Result<Vec<Waypoint>, RequestStatus> {
        let original = world
            .transform(actor)
            .ok_or(RequestStatus::UnsupportedActor)?;
        let span = world
            .height_span(actor)
            .ok_or(RequestStatus::UnsupportedActor)?;
        let start =
            pose(scene, world, actor, original, span.floor.0).ok_or(RequestStatus::NoPath)?;
        if (start.span.elevation - span.elevation).abs() > 0.001 {
            return Err(RequestStatus::NoPath);
        }
        let goal = pose(scene, world, actor, goal, floor).ok_or(RequestStatus::NoPath)?;
        let arrival = if self.combat && self.precise_stop {
            f64::from(radius)
        } else {
            0.
        };
        let heuristic = |at| (distance(at, goal.at) - arrival).max(0.);
        if start.surface == goal.surface
            && self.probe(scene, world, actor, start, goal, step, drop)?
        {
            return Ok(vec![goal]);
        }
        let offset = world
            .collider(actor)
            .ok_or(RequestStatus::UnsupportedActor)?
            .center(original);
        let offset = Transform2D {
            x: offset.x - original.x,
            y: offset.y - original.y,
        };
        let origin =
            scene
                .surfaces
                .iter()
                .filter(|s| s.walkable)
                .fold([f64::INFINITY; 2], |m, s| {
                    [
                        m[0].min(f64::from(s.bounds[0])),
                        m[1].min(f64::from(s.bounds[1])),
                    ]
                });
        for index in 0..scene.surfaces.len() {
            let s = scene.surfaces[index];
            if !s.walkable {
                continue;
            }
            let bounds = s.bounds;
            let mut range = [0_i32; 4];
            for axis in 0..2 {
                let lo = ((f64::from(bounds[axis]) - origin[axis]) / f64::from(cell) - 0.5).ceil();
                let hi = ((f64::from(bounds[axis] + bounds[axis + 2]) - origin[axis])
                    / f64::from(cell)
                    - 0.5)
                    .ceil()
                    - 1.;
                if !lo.is_finite()
                    || !hi.is_finite()
                    || lo.abs() > f64::from(i32::MAX - 2)
                    || hi.abs() > f64::from(i32::MAX - 2)
                {
                    return Err(RequestStatus::NodeBudgetExceeded);
                }
                range[axis] = lo as i32;
                range[axis + 2] = hi as i32;
            }
            let count = (i64::from(range[2]) - i64::from(range[0]) + 1).max(0)
                * (i64::from(range[3]) - i64::from(range[1]) + 1).max(0);
            if count > MAX_NODES as i64
                || self.search.nodes.len().saturating_add(count as usize) > MAX_NODES
            {
                return Err(RequestStatus::NodeBudgetExceeded);
            }
            if self.combat {
                let charge = (count as u64).saturating_mul((scene.surfaces.len() as u64 + 1) * 4);
                if self.search.work.saturating_add(charge) > self.work_limit {
                    return Err(RequestStatus::WorkBudgetExceeded);
                }
                self.search.work += charge;
            }
            for y in range[1]..=range[3] {
                for x in range[0]..=range[2] {
                    let at = Transform2D {
                        x: (origin[0] + (f64::from(x) + 0.5) * f64::from(cell)) as f32 - offset.x,
                        y: (origin[1] + (f64::from(y) + 0.5) * f64::from(cell)) as f32 - offset.y,
                    };
                    let Some(p) = pose(scene, world, actor, at, s.floor) else {
                        continue;
                    };
                    if p.surface != index {
                        continue;
                    }
                    let i = self.search.nodes.len();
                    self.search.nodes.push(Node {
                        pose: p,
                        cell: Some((x, y)),
                        cost: f64::INFINITY,
                        parent: usize::MAX,
                        closed: false,
                        auxiliary: false,
                    });
                    self.search.cells.entry((x, y)).or_default().push(i);
                }
            }
        }
        // Goal-ring samples make a nonzero stop radius reachable even when the exact goal
        // center is occupied and the coarse grid has no clear point inside the small circle.
        if arrival > 0. && self.search.nodes.len() + 8 <= MAX_NODES {
            let charge = (scene.surfaces.len() as u64 + 1) * 32 + 128;
            if self.search.work.saturating_add(charge) <= self.work_limit {
                self.search.work += charge;
                let rounding = f64::from(
                    (goal.at.x.next_up() - goal.at.x)
                        .abs()
                        .max((goal.at.y.next_up() - goal.at.y).abs()),
                )
                .max(f64::from(KINEMATIC_EPSILON) * 4.);
                let inset = (arrival - rounding * 2.).max(0.);
                let d = std::f64::consts::FRAC_1_SQRT_2;
                for (x, y) in [
                    (1., 0.),
                    (-1., 0.),
                    (0., 1.),
                    (0., -1.),
                    (d, d),
                    (d, -d),
                    (-d, d),
                    (-d, -d),
                ] {
                    let point = Transform2D {
                        x: (f64::from(goal.at.x) + x * inset) as f32,
                        y: (f64::from(goal.at.y) + y * inset) as f32,
                    };
                    let Some(p) = pose(scene, world, actor, point, floor)
                        .filter(|p| p.surface == goal.surface)
                    else {
                        continue;
                    };
                    let x = ((f64::from(point.x) + f64::from(offset.x) - origin[0])
                        / f64::from(cell))
                    .floor();
                    let y = ((f64::from(point.y) + f64::from(offset.y) - origin[1])
                        / f64::from(cell))
                    .floor();
                    if x.abs() > f64::from(i32::MAX - 2) || y.abs() > f64::from(i32::MAX - 2) {
                        continue;
                    }
                    let key = (x as i32, y as i32);
                    let index = self.search.nodes.len();
                    self.search.nodes.push(Node {
                        pose: p,
                        cell: Some(key),
                        cost: f64::INFINITY,
                        parent: usize::MAX,
                        closed: false,
                        auxiliary: true,
                    });
                    self.search.cells.entry(key).or_default().push(index);
                }
            }
        }
        // Sparse peer corners let a coarse static grid represent narrow open gaps without
        // globally increasing grid density. They are optional, bounded by the same node/work cap.
        for position in 0..self.search_peers.len() {
            if self.search.nodes.len() + 8 > MAX_NODES {
                break;
            }
            let peer = self.search_peers[position];
            if peer == actor {
                continue;
            }
            let Some((other, at)) = world.collider(peer).zip(world.transform(peer)) else {
                continue;
            };
            let Some(peer_span) = world.height_span(peer) else {
                continue;
            };
            let Some(own) = world.collider(actor) else {
                continue;
            };
            let charge = (scene.surfaces.len() as u64 + 1)
                * (128 + scene.connections.len() as u64 * 16)
                + 256;
            if self.search.work.saturating_add(charge) > self.work_limit {
                break;
            }
            self.search.work += charge;
            let center = other.center(at);
            let peer_surface = pose(
                scene,
                world,
                actor,
                Transform2D {
                    x: center.x - offset.x,
                    y: center.y - offset.y,
                },
                peer_span.floor.0,
            )
            .map(|p| p.surface);
            let half = [
                f64::from(own.half_width)
                    + f64::from(other.half_width)
                    + f64::from(self.search_padding),
                f64::from(own.half_height)
                    + f64::from(other.half_height)
                    + f64::from(self.search_padding),
            ];
            for (sx, sy) in [(-1., -1.), (-1., 1.), (1., -1.), (1., 1.)] {
                let outside = |value: f64, sign: f64| {
                    let value = value as f32;
                    if sign > 0. {
                        value.next_up()
                    } else {
                        value.next_down()
                    }
                };
                let point = Transform2D {
                    x: outside(
                        f64::from(center.x) + sx * (half[0] + f64::from(KINEMATIC_EPSILON) * 2.)
                            - f64::from(offset.x),
                        sx,
                    ),
                    y: outside(
                        f64::from(center.y) + sy * (half[1] + f64::from(KINEMATIC_EPSILON) * 2.)
                            - f64::from(offset.y),
                        sy,
                    ),
                };
                if !point.x.is_finite() || !point.y.is_finite() {
                    continue;
                }
                for p in
                    crowd_corner_poses(scene, world, actor, point, peer_span.floor.0, peer_surface)
                        .into_iter()
                        .flatten()
                {
                    let point = p.at;
                    let x = ((f64::from(point.x) + f64::from(offset.x) - origin[0])
                        / f64::from(cell))
                    .floor();
                    let y = ((f64::from(point.y) + f64::from(offset.y) - origin[1])
                        / f64::from(cell))
                    .floor();
                    if x.abs() > f64::from(i32::MAX - 2) || y.abs() > f64::from(i32::MAX - 2) {
                        continue;
                    }
                    let key = (x as i32, y as i32);
                    let index = self.search.nodes.len();
                    self.search.nodes.push(Node {
                        pose: p,
                        cell: Some(key),
                        cost: f64::INFINITY,
                        parent: usize::MAX,
                        closed: false,
                        auxiliary: true,
                    });
                    self.search.cells.entry(key).or_default().push(index);
                }
            }
        }
        let start_index = self.search.nodes.len();
        let goal_index = start_index + 1;
        self.search.nodes.push(Node {
            pose: start,
            cell: None,
            cost: 0.,
            parent: usize::MAX,
            closed: false,
            auxiliary: false,
        });
        self.search.nodes.push(Node {
            pose: goal,
            cell: None,
            cost: f64::INFINITY,
            parent: usize::MAX,
            closed: false,
            auxiliary: false,
        });
        self.search.open.push(Open {
            index: start_index,
            score: heuristic(start.at),
        });
        let mut neighbors = Vec::new();
        while let Some(open) = self.search.open.pop() {
            if !self.search_peers.is_empty() {
                // Bound the added sparse-corner heap/cell lookups before enumerating edges.
                if self.search.work.saturating_add(128) > self.work_limit {
                    return Err(RequestStatus::WorkBudgetExceeded);
                }
                self.search.work += 128;
            }
            let i = open.index;
            if self.search.nodes[i].closed {
                continue;
            }
            if self.search.expanded >= MAX_NODES as u32 + 2 {
                return Err(RequestStatus::NodeBudgetExceeded);
            }
            self.search.nodes[i].closed = true;
            self.search.expanded += 1;
            let in_range = arrival > 0.
                && self.search.nodes[i].pose.surface == goal.surface
                && self.search.nodes[i].pose.span.floor == goal.span.floor
                && distance(self.search.nodes[i].pose.at, goal.at) <= arrival;
            if i == goal_index || in_range {
                let mut points = Vec::new();
                let mut at = i;
                while at != start_index {
                    points.push(self.search.nodes[at].pose);
                    at = self.search.nodes[at].parent;
                    if points.len() > MAX_NODES + 1 {
                        return Err(RequestStatus::NodeBudgetExceeded);
                    }
                }
                points.reverse();
                // Keep the real goal as the final radius center. The follower stops at the
                // reachable in-range point before considering the unswept remainder to the goal.
                if i != goal_index {
                    points.push(goal);
                }
                return Ok(points);
            }
            let from = self.search.nodes[i].pose;
            neighbors.clear();
            if let Some((x, y)) = self.search.nodes[i].cell {
                for ny in y - 1..=y + 1 {
                    for nx in x - 1..=x + 1 {
                        if let Some(ids) = self.search.cells.get(&(nx, ny)) {
                            if !self.search_peers.is_empty() {
                                let charge = ids.len() as u64 * 4;
                                if self.search.work.saturating_add(charge) > self.work_limit {
                                    return Err(RequestStatus::WorkBudgetExceeded);
                                }
                                self.search.work += charge;
                            }
                            for &id in ids {
                                if (nx - x).abs() + (ny - y).abs() == 1
                                    || self.search.nodes[i].auxiliary
                                    || self.search.nodes[id].auxiliary
                                {
                                    neighbors.push(id);
                                }
                            }
                        }
                    }
                }
            } else {
                let center = world
                    .collider(actor)
                    .ok_or(RequestStatus::UnsupportedActor)?
                    .center(from.at);
                let x = ((f64::from(center.x) - origin[0]) / f64::from(cell)).floor() as i32;
                let y = ((f64::from(center.y) - origin[1]) / f64::from(cell)).floor() as i32;
                for y in y - 1..=y + 1 {
                    for x in x - 1..=x + 1 {
                        if let Some(ids) = self.search.cells.get(&(x, y)) {
                            if !self.search_peers.is_empty() {
                                let charge = ids.len() as u64 * 4;
                                if self.search.work.saturating_add(charge) > self.work_limit {
                                    return Err(RequestStatus::WorkBudgetExceeded);
                                }
                                self.search.work += charge;
                            }
                            neighbors.extend_from_slice(ids);
                        }
                    }
                }
            }
            if from.surface == goal.surface && distance(from.at, goal.at) <= f64::from(cell) * 2. {
                neighbors.push(goal_index);
            }
            for &next in &neighbors {
                if self.search.nodes[next].closed {
                    continue;
                }
                let to = self.search.nodes[next].pose;
                if (i == start_index && from.surface != to.surface)
                    || !scene.navigation_surfaces_connected(from.surface, to.surface)
                {
                    continue;
                }
                let cost = self.search.nodes[i].cost + distance(from.at, to.at);
                if cost >= self.search.nodes[next].cost {
                    continue;
                }
                if !self.probe(scene, world, actor, from, to, step, drop)? {
                    continue;
                }
                self.search.nodes[next].cost = cost;
                self.search.nodes[next].parent = i;
                if self.search.open.len() >= MAX_PROBES as usize {
                    return Err(RequestStatus::ProbeBudgetExceeded);
                }
                self.search.open.push(Open {
                    index: next,
                    score: cost + heuristic(to.at),
                });
            }
        }
        Err(RequestStatus::NoPath)
    }
    #[allow(clippy::too_many_arguments)]
    fn plan_actor(
        &mut self,
        scene: &mut SpatialScene,
        world: &mut World,
        actor: Entity,
        step: f32,
        drop: f32,
        goal: Transform2D,
        floor: u32,
        speed: f32,
        cell: f32,
        radius: f32,
        cancel_on_input: bool,
    ) -> bool {
        self.begin_request();
        if !supported(world, actor, self.combat) {
            return false;
        }
        if ![goal.x, goal.y, speed, cell, radius]
            .iter()
            .all(|v| v.is_finite())
            || speed <= 0.
            || cell <= 0.
            || radius < 0.
            || floor > 65535
        {
            self.request_status = RequestStatus::InvalidRequest;
            return false;
        }
        let original = world.transform(actor).unwrap_or_default();
        self.target_count = scene.movement_scratch.begin_spatial_query(world, actor);
        self.preparation_work = preparation_work(world, self.target_count);
        self.search.work = self.preparation_work;
        // Admission includes preparation and at least one bounded follower step.
        if self
            .preparation_work
            .saturating_add(work(scene, self.target_count, original, original))
            > if self.combat {
                self.work_limit
            } else {
                FRAME_WORK
            }
        {
            scene.movement_scratch.end_spatial_query();
            self.request_status = RequestStatus::FrameBudgetExceeded;
            return false;
        }
        let span = world.height_span(actor).unwrap();
        let velocity = world.velocity(actor).unwrap();
        self.search.work = self.preparation_work;
        self.searches = self.searches.saturating_add(1);
        let result = self.search(scene, world, actor, goal, floor, cell, step, drop, radius);
        scene.movement_scratch.end_spatial_query();
        world.set_transform(actor, original);
        world.set_height_span(actor, span);
        world.set_velocity(actor, velocity);
        let points = match result {
            Ok(points) => points,
            Err(status) => {
                self.request_status = status;
                return false;
            }
        };
        self.request_status = RequestStatus::Accepted;
        self.points = points;
        self.next = 0;
        self.planned = self.points.len();
        self.actor = Some(actor);
        self.status = SpatialMoveStatus::Moving;
        self.speed = speed;
        self.cell_size = cell;
        self.radius = radius;
        self.cancel_on_input = cancel_on_input;
        self.pending = 0.;
        self.last = Some((original, span));
        self.last_motion = None;
        self.crowd_detour = None;
        true
    }
    /// true means this frame's spatial actor motion is owned here, including an arrival/blocked frame.
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &mut self,
        scene: &mut SpatialScene,
        world: &mut World,
        input: InputState,
        delta: f32,
        counters: &mut PhysicsCounters,
        target_count: usize,
        crowd: Option<CombatCrowd<'_>>,
    ) -> bool {
        self.last_motion = None;
        self.update_work = 0;
        self.crowd_step = CombatNavigationStep::default();
        self.crowd_candidates = 0;
        if self.status != SpatialMoveStatus::Moving {
            return false;
        }
        let Some(actor) = self.actor else {
            return false;
        };
        if !supported(world, actor, self.combat)
            || (!self.combat && scene.actor.map(|a| a.0) != Some(actor))
        {
            self.finish(SpatialMoveStatus::Cancelled);
            return false;
        }
        if self.cancel_on_input && (input.w != 0 || input.a != 0 || input.s != 0 || input.d != 0) {
            self.finish(SpatialMoveStatus::Cancelled);
            return false;
        }
        let mut at = world.transform(actor).unwrap();
        let span = world.height_span(actor).unwrap();
        if self.last != Some((at, span)) {
            self.finish(SpatialMoveStatus::Cancelled);
            return false;
        }
        if !delta.is_finite() || delta <= 0. {
            return true;
        }
        let (step, drop) = if self.combat {
            (self.combat_step, self.combat_drop)
        } else {
            let (_, _, step, drop) = scene.actor.unwrap();
            (step, drop)
        };
        let frame_limit = if self.combat {
            self.frame_limit
        } else {
            FRAME_WORK
        };
        let mut budget = self.pending + f64::from(self.speed) * f64::from(delta);
        let mut heading: Option<Velocity> = None;
        let prepared_work = preparation_work(world, target_count);
        let mut used = prepared_work;
        self.update_work = used;
        world.set_velocity(actor, Velocity::default());
        for _ in 0..64 {
            let Some(point) = self.points.get(self.next).copied() else {
                self.finish(SpatialMoveStatus::Arrived);
                return true;
            };
            let len = distance(at, point.at);
            let floor = world.height_span(actor).unwrap().floor;
            let final_point = self.next + 1 == self.points.len();
            if len
                <= if final_point {
                    f64::from(self.radius)
                } else if crowd.is_some() {
                    // Local detours need not converge on an occupied grid waypoint. The next
                    // segment still uses native sweep/gateway checks; only an adjacent connected
                    // support may bypass a non-final point, never the actual floor transition.
                    f64::from(self.cell_size)
                } else {
                    0.
                }
                && pose(scene, world, actor, at, floor.0).is_some_and(|p| {
                    (floor == point.span.floor && p.surface == point.surface)
                        || (crowd.is_some()
                            && !final_point
                            && scene.navigation_surfaces_connected(p.surface, point.surface))
                })
            {
                let shortcut = crowd.is_some() && !final_point && len > 0.;
                let clear = !shortcut
                    || self
                        .points
                        .get(self.next + 1)
                        .copied()
                        .zip(pose(scene, world, actor, at, floor.0))
                        .zip(crowd)
                        .is_some_and(|((next, current), crowd)| {
                            self.crowd_shortcut(
                                scene, world, actor, current, next, crowd, &mut used,
                            )
                        });
                self.update_work = used;
                if clear {
                    self.next += 1;
                    continue;
                }
            }
            if len == 0. {
                self.finish(SpatialMoveStatus::Blocked);
                return true;
            }
            if self.steering.is_some() && heading.is_none() {
                let charge = 128 + (scene.surfaces.len() as u64 + 1) * 8;
                if used.saturating_add(charge) > frame_limit {
                    break;
                }
                used += charge;
                self.update_work = used;
                let on_goal_support = final_point
                    && pose(scene, world, actor, at, floor.0).is_some_and(|p| {
                        p.surface == point.surface && p.span.floor == point.span.floor
                    });
                let velocity = self.seek_velocity(at, point, delta, on_goal_support);
                budget = self.pending
                    + f64::from(velocity.vx).hypot(f64::from(velocity.vy)) * f64::from(delta);
                heading = Some(velocity);
                self.crowd_step.steering_velocity = Some(velocity);
            }
            // A prior budget defer may leave credit even when this step's interpolated
            // intent is exactly zero. Keep that credit without normalizing 0/0.
            if heading.is_some_and(|v| v.vx == 0. && v.vy == 0.) {
                break;
            }
            if budget <= 0. {
                break;
            }
            let Some(current) = pose(scene, world, actor, at, floor.0) else {
                self.finish(SpatialMoveStatus::Blocked);
                return true;
            };
            let direction = heading
                .filter(|_| self.steering.is_some_and(|(_, rate)| rate < 1.))
                .map(|v| {
                    let norm = f64::from(v.vx).hypot(f64::from(v.vy));
                    (f64::from(v.vx) / norm, f64::from(v.vy) / norm)
                })
                .unwrap_or((
                    (f64::from(point.at.x) - f64::from(at.x)) / len,
                    (f64::from(point.at.y) - f64::from(at.y)) / len,
                ));
            let mut travel = budget.min(len).min(f64::from(self.cell_size));
            let stop_distance = (len - f64::from(self.radius)).max(0.);
            // A full grid edge may subdivide into two safe steps, while a shorter frame fragment
            // uses only one and exceeds maxStepHeight. Bound fragments by both supports' slope.
            for index in [current.surface, point.surface] {
                let surface = scene.surfaces[index];
                let (delta, extent) = if surface.ramp_x {
                    (
                        if self.steering.is_some() {
                            direction.0 * len
                        } else {
                            f64::from(point.at.x) - f64::from(at.x)
                        },
                        surface.bounds[2],
                    )
                } else {
                    (
                        if self.steering.is_some() {
                            direction.1 * len
                        } else {
                            f64::from(point.at.y) - f64::from(at.y)
                        },
                        surface.bounds[3],
                    )
                };
                let rise = (f64::from(surface.heights[1]) - f64::from(surface.heights[0]))
                    / f64::from(extent)
                    * delta
                    / len;
                if rise != 0. {
                    let allowance = if rise > 0. { step } else { drop };
                    travel = travel.min(
                        (f64::from(allowance) + f64::from(KINEMATIC_EPSILON) * 0.5) / rise.abs(),
                    );
                }
            }
            let dx = direction.0 * travel;
            let dy = direction.1 * travel;
            let bounded = |from: f32, to: f32, d: f64| {
                let d = d as f32;
                if d > 0. && from + d > to {
                    d.next_down()
                } else if d < 0. && from + d < to {
                    d.next_up()
                } else {
                    d
                }
            };
            let direct = self.steering.is_none_or(|(_, rate)| rate >= 1.);
            let dx = if direct {
                bounded(at.x, point.at.x, dx)
            } else {
                dx as f32
            };
            let dy = if direct {
                bounded(at.y, point.at.y, dy)
            } else {
                dy as f32
            };
            let target = Transform2D {
                x: at.x + dx,
                y: at.y + dy,
            };
            if target == at {
                // Do not let overlap avoidance discard a not-yet-representable movement credit.
                break;
            }
            if self.combat && self.precise_stop && !motion_fits_credit(at, target, budget) {
                break;
            }
            let target = if self.steering.is_some() {
                self.seek_stop_target(at, target, current)
            } else {
                target
            };
            let (target, stop_after_motion) = if let Some(crowd) = crowd {
                let result = self.crowd_motion(
                    scene,
                    world,
                    actor,
                    at,
                    target,
                    if final_point { stop_distance } else { len },
                    budget,
                    crowd,
                    counters,
                    &mut used,
                );
                self.update_work = used;
                match result {
                    CrowdMotion::Move(target, stop) => (target, stop),
                    CrowdMotion::Yield | CrowdMotion::Deferred => {
                        budget = 0.;
                        break;
                    }
                    CrowdMotion::Blocked => {
                        self.finish(SpatialMoveStatus::Blocked);
                        return true;
                    }
                }
            } else {
                if self.combat && self.precise_stop && self.radius > 0. {
                    if used.saturating_add(512) > frame_limit {
                        break;
                    }
                    used += 512;
                    self.update_work = used;
                }
                let (target, stop) = self.clip_combat_stop(at, target, current);
                if stop && target == at {
                    self.finish(SpatialMoveStatus::Arrived);
                    return true;
                }
                let before_segment = used;
                if used.saturating_add(target_count as u64) > frame_limit {
                    if before_segment == prepared_work && !self.combat {
                        self.finish(SpatialMoveStatus::Blocked);
                        return true;
                    }
                    break;
                }
                used += target_count as u64;
                self.update_work = used;
                let nearby = scene
                    .movement_scratch
                    .begin_spatial_segment(world, actor, at, target);
                let charge = work(scene, nearby, at, target);
                if used.saturating_add(charge) > frame_limit {
                    if before_segment == prepared_work && !self.combat {
                        self.finish(SpatialMoveStatus::Blocked);
                        return true;
                    }
                    break;
                }
                used += charge;
                self.update_work = used;
                (target, stop)
            };
            if stop_after_motion && target == at {
                self.finish(SpatialMoveStatus::Arrived);
                return true;
            }
            let dx = target.x - at.x;
            let dy = target.y - at.y;
            let before = at;
            let before_span = world.height_span(actor).unwrap();
            if !PhysicsSystem::spatial_body_pose_is_clear(
                world,
                &scene.physics,
                actor,
                at,
                &mut scene.movement_scratch,
                Some(counters),
                self.solid_mask(),
            ) {
                self.finish(SpatialMoveStatus::Blocked);
                return true;
            }
            self.crowd_step.motion_admitted = true;
            if !scene.move_body_internal(
                world,
                actor,
                dx,
                dy,
                step,
                drop,
                Some(counters),
                true,
                self.combat,
            ) {
                self.finish(SpatialMoveStatus::Blocked);
                return true;
            }
            at = world.transform(actor).unwrap();
            if let Some(crowd) = crowd {
                let actual_span = world.height_span(actor).unwrap();
                if !crowd.permits(
                    world,
                    actor,
                    (before, before_span),
                    (at, actual_span),
                    &mut self.crowd_step.neighbor_tests,
                ) {
                    world.set_transform(actor, before);
                    world.set_height_span(actor, before_span);
                    self.finish(SpatialMoveStatus::Blocked);
                    return true;
                }
            }
            let moved = (f64::from(at.x) - f64::from(before.x))
                .hypot(f64::from(at.y) - f64::from(before.y));
            if !PhysicsSystem::spatial_body_pose_is_clear(
                world,
                &scene.physics,
                actor,
                at,
                &mut scene.movement_scratch,
                Some(counters),
                self.solid_mask(),
            ) {
                world.set_transform(actor, before);
                world.set_height_span(actor, before_span);
                self.finish(SpatialMoveStatus::Blocked);
                return true;
            }
            if moved == 0. {
                // Accumulate sub-ULP credit; meaningful rejected movement is a blocker.
                if dx == 0. && dy == 0. || (at.x + dx == at.x && at.y + dy == at.y) {
                    break;
                }
                self.finish(SpatialMoveStatus::Blocked);
                return true;
            }
            self.last_motion = Some((
                f64::from(at.x) - f64::from(before.x),
                f64::from(at.y) - f64::from(before.y),
            ));
            budget -= moved;
            if (at.x - target.x).abs() > 0.0001 || (at.y - target.y).abs() > 0.0001 {
                self.finish(SpatialMoveStatus::Blocked);
                return true;
            }
            if stop_after_motion {
                let valid_goal = self.points.last().is_some_and(|g| {
                    let current = world.height_span(actor).unwrap();
                    current.floor == g.span.floor
                        && self::distance(at, g.at) <= f64::from(self.radius)
                        && pose(scene, world, actor, at, current.floor.0)
                            .is_some_and(|p| p.surface == g.surface)
                });
                self.finish(if valid_goal {
                    SpatialMoveStatus::Arrived
                } else {
                    SpatialMoveStatus::Blocked
                });
                return true;
            }
        }
        self.pending = if self.combat {
            budget.min(f64::from(self.cell_size))
        } else {
            budget
        };
        self.last = Some((at, world.height_span(actor).unwrap()));
        true
    }
}
impl SpatialScene {
    #[allow(clippy::too_many_arguments)]
    pub fn plan_navigation(
        &mut self,
        world: &mut World,
        goal: Transform2D,
        floor: u32,
        speed: f32,
        cell: f32,
        radius: f32,
        cancel_on_input: bool,
    ) -> bool {
        let mut navigation = std::mem::take(&mut self.navigation);
        let result = navigation.plan(
            self,
            world,
            goal,
            floor,
            speed,
            cell,
            radius,
            cancel_on_input,
        );
        self.navigation = navigation;
        result
    }
    pub fn update_navigation(
        &mut self,
        world: &mut World,
        input: InputState,
        delta: f32,
        counters: &mut PhysicsCounters,
    ) -> bool {
        let mut navigation = std::mem::take(&mut self.navigation);
        let targets = if navigation.status == SpatialMoveStatus::Moving {
            navigation
                .actor
                .map(|actor| self.movement_scratch.begin_spatial_query(world, actor))
        } else {
            None
        };
        let owns = navigation.update(
            self,
            world,
            input,
            delta,
            counters,
            targets.unwrap_or(0),
            None,
        );
        self.movement_scratch.end_spatial_query();
        self.navigation = navigation;
        owns
    }
}

#[cfg(test)]
mod projection_tests {
    use super::projected_axis;
    #[test]
    fn peer_boundary_projection_preserves_real_half_open_center_with_large_offsets() {
        for offset in [16., -16., 64., -64.] {
            for center in [-4., 0., 8., 12.] {
                let at = projected_axis(center, offset, 0., 8f32.next_down()).unwrap();
                assert!((0. ..8.).contains(&(at + offset)), "{offset} {center} {at}");
            }
        }
    }
}

//! Bounded request-time A* and a scene-owned follower. All edge probes use native movement/collision.
use super::SpatialScene;
use crate::components::{HeightSpan, PhysicsFloorId, RigidBodyType, Transform2D, Velocity};
use crate::entity::Entity;
use crate::input::InputState;
use crate::physics::{PhysicsCounters, PhysicsSystem};
use crate::world::World;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap};

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
}
fn distance(a: Transform2D, b: Transform2D) -> f64 {
    (f64::from(a.x) - f64::from(b.x)).hypot(f64::from(a.y) - f64::from(b.y))
}
fn supported(world: &World, actor: Entity) -> bool {
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
            .is_some_and(|c| c.enabled && !c.is_trigger)
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
// Conservative charge for nested substeps, 8-iteration sweeps, overlap probes and proxy sorting.
fn work(scene: &SpatialScene, world: &World, from: Transform2D, to: Transform2D) -> u64 {
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
    let proxies = (world.alive_indices().len() + scene.surfaces.len()).max(1) as u64;
    (steps as u64)
        .saturating_mul(proxies)
        .saturating_mul(u64::from(proxies.ilog2()) + 1)
        .saturating_mul(64)
}
impl SpatialNavigation {
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
    ) -> Option<bool> {
        let charge = work(scene, world, from.at, to.at);
        if self.search.probes >= MAX_PROBES || self.search.work.saturating_add(charge) > MAX_WORK {
            return None;
        }
        self.search.probes += 1;
        self.search.work += charge;
        world.set_transform(actor, from.at);
        world.set_height_span(actor, from.span);
        if !PhysicsSystem::spatial_body_pose_is_clear(
            world,
            &scene.physics,
            actor,
            from.at,
            &mut scene.movement_scratch,
            None,
        ) {
            return Some(false);
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
        );
        let end = world.transform(actor)?;
        let span = world.height_span(actor)?;
        Some(
            ok && PhysicsSystem::spatial_body_pose_is_clear(
                world,
                &scene.physics,
                actor,
                end,
                &mut scene.movement_scratch,
                None,
            ) && distance(end, to.at) <= 0.0001
                && span.floor == to.span.floor
                && (span.elevation - to.span.elevation).abs() <= 0.001
                && pose(scene, world, actor, end, span.floor.0)
                    .is_some_and(|p| p.surface == to.surface),
        )
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
    ) -> Option<Vec<Waypoint>> {
        let original = world.transform(actor)?;
        let span = world.height_span(actor)?;
        let start = pose(scene, world, actor, original, span.floor.0)?;
        if (start.span.elevation - span.elevation).abs() > 0.001 {
            return None;
        }
        let goal = pose(scene, world, actor, goal, floor)?;
        if start.surface == goal.surface
            && self.probe(scene, world, actor, start, goal, step, drop)?
        {
            return Some(vec![goal]);
        }
        let offset = world.collider(actor)?.center(original);
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
                    return None;
                }
                range[axis] = lo as i32;
                range[axis + 2] = hi as i32;
            }
            let count = (i64::from(range[2]) - i64::from(range[0]) + 1).max(0)
                * (i64::from(range[3]) - i64::from(range[1]) + 1).max(0);
            if count > MAX_NODES as i64
                || self.search.nodes.len().saturating_add(count as usize) > MAX_NODES
            {
                return None;
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
                    });
                    self.search.cells.entry((x, y)).or_default().push(i);
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
        });
        self.search.nodes.push(Node {
            pose: goal,
            cell: None,
            cost: f64::INFINITY,
            parent: usize::MAX,
            closed: false,
        });
        self.search.open.push(Open {
            index: start_index,
            score: distance(start.at, goal.at),
        });
        let mut neighbors = Vec::new();
        while let Some(open) = self.search.open.pop() {
            let i = open.index;
            if self.search.nodes[i].closed {
                continue;
            }
            if self.search.expanded >= MAX_NODES as u32 + 2 {
                return None;
            }
            self.search.nodes[i].closed = true;
            self.search.expanded += 1;
            if i == goal_index {
                let mut points = Vec::new();
                let mut at = i;
                while at != start_index {
                    points.push(self.search.nodes[at].pose);
                    at = self.search.nodes[at].parent;
                    if points.len() > MAX_NODES + 1 {
                        return None;
                    }
                }
                points.reverse();
                return Some(points);
            }
            let from = self.search.nodes[i].pose;
            neighbors.clear();
            if let Some((x, y)) = self.search.nodes[i].cell {
                for key in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)] {
                    if let Some(ids) = self.search.cells.get(&key) {
                        neighbors.extend_from_slice(ids);
                    }
                }
            } else {
                let center = world.collider(actor)?.center(from.at);
                let x = ((f64::from(center.x) - origin[0]) / f64::from(cell)).floor() as i32;
                let y = ((f64::from(center.y) - origin[1]) / f64::from(cell)).floor() as i32;
                for y in y - 1..=y + 1 {
                    for x in x - 1..=x + 1 {
                        if let Some(ids) = self.search.cells.get(&(x, y)) {
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
                    return None;
                }
                self.search.open.push(Open {
                    index: next,
                    score: cost + distance(to.at, goal.at),
                });
            }
        }
        None
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
        let Some((actor, _, step, drop)) = scene.actor else {
            return false;
        };
        if !supported(world, actor)
            || ![goal.x, goal.y, speed, cell, radius]
                .iter()
                .all(|v| v.is_finite())
            || speed <= 0.
            || cell <= 0.
            || radius < 0.
            || floor > 65535
        {
            return false;
        }
        let original = world.transform(actor).unwrap_or_default();
        // A route accepted here must be able to execute at least one bounded follower step.
        if work(scene, world, original, original) > FRAME_WORK {
            return false;
        }
        let span = world.height_span(actor).unwrap();
        let velocity = world.velocity(actor).unwrap();
        self.search.nodes.clear();
        self.search.cells.clear();
        self.search.open.clear();
        self.search.probes = 0;
        self.search.work = 0;
        self.search.expanded = 0;
        self.searches = self.searches.saturating_add(1);
        let result = self.search(scene, world, actor, goal, floor, cell, step, drop);
        world.set_transform(actor, original);
        world.set_height_span(actor, span);
        world.set_velocity(actor, velocity);
        let Some(points) = result else {
            return false;
        };
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
        true
    }
    /// true means this frame's spatial actor motion is owned here, including an arrival/blocked frame.
    pub fn update(
        &mut self,
        scene: &mut SpatialScene,
        world: &mut World,
        input: InputState,
        delta: f32,
        counters: &mut PhysicsCounters,
    ) -> bool {
        self.last_motion = None;
        if self.status != SpatialMoveStatus::Moving {
            return false;
        }
        let Some(actor) = self.actor else {
            return false;
        };
        if !supported(world, actor) || scene.actor.map(|a| a.0) != Some(actor) {
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
        let (_, _, step, drop) = scene.actor.unwrap();
        let mut budget = self.pending + f64::from(self.speed) * f64::from(delta);
        let mut used = 0_u64;
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
                } else {
                    0.
                }
                && floor == point.span.floor
                && pose(scene, world, actor, at, floor.0)
                    .is_some_and(|p| p.surface == point.surface)
            {
                self.next += 1;
                continue;
            }
            if len == 0. {
                self.finish(SpatialMoveStatus::Blocked);
                return true;
            }
            if budget <= 0. {
                break;
            }
            let distance = budget.min(len).min(f64::from(self.cell_size));
            let dx = (f64::from(point.at.x) - f64::from(at.x)) / len * distance;
            let dy = (f64::from(point.at.y) - f64::from(at.y)) / len * distance;
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
            let dx = bounded(at.x, point.at.x, dx);
            let dy = bounded(at.y, point.at.y, dy);
            let target = Transform2D {
                x: at.x + dx,
                y: at.y + dy,
            };
            let charge = work(scene, world, at, target);
            if used.saturating_add(charge) > FRAME_WORK {
                if used == 0 {
                    self.finish(SpatialMoveStatus::Blocked);
                    return true;
                }
                break;
            }
            used += charge;
            let before = at;
            let before_span = world.height_span(actor).unwrap();
            if !PhysicsSystem::spatial_body_pose_is_clear(
                world,
                &scene.physics,
                actor,
                at,
                &mut scene.movement_scratch,
                Some(counters),
            ) {
                self.finish(SpatialMoveStatus::Blocked);
                return true;
            }
            if !scene.move_body(world, actor, dx, dy, step, drop, Some(counters)) {
                self.finish(SpatialMoveStatus::Blocked);
                return true;
            }
            at = world.transform(actor).unwrap();
            let moved = (f64::from(at.x) - f64::from(before.x))
                .hypot(f64::from(at.y) - f64::from(before.y));
            if !PhysicsSystem::spatial_body_pose_is_clear(
                world,
                &scene.physics,
                actor,
                at,
                &mut scene.movement_scratch,
                Some(counters),
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
        }
        self.pending = budget;
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
        let owns = navigation.update(self, world, input, delta, counters);
        self.navigation = navigation;
        owns
    }
}

//! One scene-owned resumable static A* job and bounded, footprint-specific route reuse.
use super::*;
use crate::components::{AabbCollider, CollisionFilter};

pub(crate) const SEARCH_SLICE_WORK: u64 = 262_144;
const SEARCH_TOTAL_WORK: u64 = MAX_WORK;
const MAX_SLICE_WORK: u64 = 600_000;

#[derive(Clone, PartialEq)]
pub(crate) struct CombatRouteKey {
    target: Entity,
    goal: Transform2D,
    span: HeightSpan,
    collider: AabbCollider,
    filter: CollisionFilter,
    height: f32,
    cell: f32,
    radius: f32,
    step: f32,
    drop: f32,
    precise: bool,
    revision: u32,
}
impl CombatRouteKey {
    pub(crate) fn new(
        world: &World,
        scene: &SpatialScene,
        target: Entity,
        request: &CombatNavigationRequest<'_>,
    ) -> Option<Self> {
        Some(Self {
            target,
            goal: request.goal,
            span: world.height_span(target)?,
            collider: world.collider(request.actor)?,
            filter: world.collision_filter(request.actor)?,
            height: world.height_span(request.actor)?.height,
            cell: request.cell,
            radius: request.radius,
            step: request.step,
            drop: request.drop,
            precise: request.precise_stop,
            revision: scene.navigation_revision,
        })
    }
    pub(crate) fn continues(&self, next: &Self) -> bool {
        let mut next = next.clone();
        next.goal = self.goal;
        next == *self
    }
    pub(crate) fn goal(&self) -> Transform2D {
        self.goal
    }
}
pub(crate) struct SharedCombatRoute {
    pub key: CombatRouteKey,
    points: Vec<Waypoint>,
}
struct Grid {
    surface: usize,
    range: [i32; 4],
}
pub(super) struct SearchJob {
    original: (Transform2D, HeightSpan),
    start: Waypoint,
    goal: Waypoint,
    offset: Transform2D,
    origin: [f64; 2],
    grids: Vec<Grid>,
    grids_ready: bool,
    grid: usize,
    xy: Option<(i32, i32)>,
    ring: usize,
    direct: bool,
    initialized: bool,
    start_index: usize,
    goal_index: usize,
    edge: Option<(usize, Vec<usize>, usize)>,
    operations: u64,
    yielded: Option<u64>,
    large_slice: bool,
}
impl SearchJob {
    fn new(
        scene: &SpatialScene,
        world: &World,
        r: &CombatNavigationRequest<'_>,
    ) -> Result<Self, RequestStatus> {
        let original = world
            .transform(r.actor)
            .zip(world.height_span(r.actor))
            .ok_or(RequestStatus::UnsupportedActor)?;
        let start = pose(scene, world, r.actor, original.0, original.1.floor.0)
            .ok_or(RequestStatus::NoPath)?;
        if (start.span.elevation - original.1.elevation).abs() > 0.001 {
            return Err(RequestStatus::NoPath);
        }
        let goal = pose(scene, world, r.actor, r.goal, r.floor).ok_or(RequestStatus::NoPath)?;
        let center = world
            .collider(r.actor)
            .ok_or(RequestStatus::UnsupportedActor)?
            .center(original.0);
        let offset = Transform2D {
            x: center.x - original.0.x,
            y: center.y - original.0.y,
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
        Ok(Self {
            original,
            start,
            goal,
            offset,
            origin,
            grids: Vec::new(),
            grids_ready: false,
            grid: 0,
            xy: None,
            ring: 0,
            direct: false,
            initialized: false,
            start_index: 0,
            goal_index: 0,
            edge: None,
            operations: 0,
            yielded: None,
            large_slice: false,
        })
    }
    fn initialize_grids(
        &mut self,
        scene: &SpatialScene,
        r: &CombatNavigationRequest<'_>,
    ) -> Result<(), RequestStatus> {
        let mut grids = Vec::new();
        for (surface, s) in scene
            .surfaces
            .iter()
            .enumerate()
            .filter(|(_, s)| s.walkable)
        {
            let mut range = [0; 4];
            for axis in 0..2 {
                let lo = ((f64::from(s.bounds[axis]) - self.origin[axis]) / f64::from(r.cell)
                    - 0.5)
                    .ceil();
                let hi = ((f64::from(s.bounds[axis] + s.bounds[axis + 2]) - self.origin[axis])
                    / f64::from(r.cell)
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
            if count > MAX_NODES as i64 {
                return Err(RequestStatus::NodeBudgetExceeded);
            }
            if count > 0 {
                grids.push(Grid { surface, range });
            }
        }
        self.grids = grids;
        self.grids_ready = true;
        Ok(())
    }
    fn heuristic(&self, at: Transform2D, r: &CombatNavigationRequest<'_>) -> f64 {
        (distance(at, self.goal.at)
            - if r.precise_stop {
                f64::from(r.radius)
            } else {
                0.
            })
        .max(0.)
    }
}
impl SpatialNavigation {
    pub(crate) fn cancel_combat_search(&mut self) {
        self.job = None;
    }
    pub(crate) fn has_combat_search(&self) -> bool {
        self.job.is_some()
    }
    fn charge_slice(&mut self, charge: u64) -> Result<(), RequestStatus> {
        if self.search.work.saturating_add(charge) > self.work_limit {
            return Err(RequestStatus::WorkBudgetExceeded);
        }
        self.search.work += charge;
        Ok(())
    }
    fn push_search_node(
        &mut self,
        p: Waypoint,
        cell: Option<(i32, i32)>,
        auxiliary: bool,
        cost: f64,
    ) {
        let i = self.search.nodes.len();
        self.search.nodes.push(Node {
            pose: p,
            cell,
            cost,
            parent: usize::MAX,
            closed: false,
            auxiliary,
        });
        if let Some(key) = cell {
            self.search.cells.entry(key).or_default().push(i);
        }
    }
    fn advance_static_search(
        &mut self,
        job: &mut SearchJob,
        scene: &mut SpatialScene,
        world: &mut World,
        r: &CombatNavigationRequest<'_>,
    ) -> Result<Vec<Waypoint>, RequestStatus> {
        if !job.direct {
            if job.start.surface == job.goal.surface
                && self.probe(scene, world, r.actor, job.start, job.goal, r.step, r.drop)?
            {
                return Ok(vec![job.goal]);
            }
            job.direct = true;
            job.operations += 1;
        }
        if !job.grids_ready {
            self.charge_slice((scene.surfaces.len() as u64 + 1) * 16)?;
            job.initialize_grids(scene, r)?;
            job.operations += 1;
        }
        while job.grid < job.grids.len() {
            self.charge_slice((scene.surfaces.len() as u64 + 1) * 4 + 16)?;
            let grid = &job.grids[job.grid];
            let (x, y) = job.xy.unwrap_or((grid.range[0], grid.range[1]));
            let at = Transform2D {
                x: (job.origin[0] + (f64::from(x) + 0.5) * f64::from(r.cell)) as f32 - job.offset.x,
                y: (job.origin[1] + (f64::from(y) + 0.5) * f64::from(r.cell)) as f32 - job.offset.y,
            };
            if let Some(p) = pose(
                scene,
                world,
                r.actor,
                at,
                scene.surfaces[grid.surface].floor,
            )
            .filter(|p| p.surface == grid.surface)
            {
                if self.search.nodes.len() == MAX_NODES {
                    return Err(RequestStatus::NodeBudgetExceeded);
                }
                self.push_search_node(p, Some((x, y)), false, f64::INFINITY);
            }
            job.xy = if x < grid.range[2] {
                Some((x + 1, y))
            } else if y < grid.range[3] {
                Some((grid.range[0], y + 1))
            } else {
                job.grid += 1;
                None
            };
            job.operations += 1;
        }
        // Match the precise-stop ring used by synchronous crowd refinement.
        let directions = [
            (1., 0.),
            (-1., 0.),
            (0., 1.),
            (0., -1.),
            (
                std::f64::consts::FRAC_1_SQRT_2,
                std::f64::consts::FRAC_1_SQRT_2,
            ),
            (
                std::f64::consts::FRAC_1_SQRT_2,
                -std::f64::consts::FRAC_1_SQRT_2,
            ),
            (
                -std::f64::consts::FRAC_1_SQRT_2,
                std::f64::consts::FRAC_1_SQRT_2,
            ),
            (
                -std::f64::consts::FRAC_1_SQRT_2,
                -std::f64::consts::FRAC_1_SQRT_2,
            ),
        ];
        while r.precise_stop && r.radius > 0. && job.ring < 8 && self.search.nodes.len() < MAX_NODES
        {
            self.charge_slice((scene.surfaces.len() as u64 + 1) * 4 + 16)?;
            let rounding = f64::from(
                (job.goal.at.x.next_up() - job.goal.at.x)
                    .abs()
                    .max((job.goal.at.y.next_up() - job.goal.at.y).abs()),
            )
            .max(f64::from(KINEMATIC_EPSILON) * 4.);
            let inset = (f64::from(r.radius) - rounding * 2.).max(0.);
            let (dx, dy) = directions[job.ring];
            let point = Transform2D {
                x: (f64::from(job.goal.at.x) + dx * inset) as f32,
                y: (f64::from(job.goal.at.y) + dy * inset) as f32,
            };
            if let Some(p) = pose(scene, world, r.actor, point, r.floor)
                .filter(|p| p.surface == job.goal.surface)
            {
                let x = ((f64::from(point.x) + f64::from(job.offset.x) - job.origin[0])
                    / f64::from(r.cell))
                .floor();
                let y = ((f64::from(point.y) + f64::from(job.offset.y) - job.origin[1])
                    / f64::from(r.cell))
                .floor();
                if x.abs() <= f64::from(i32::MAX - 2) && y.abs() <= f64::from(i32::MAX - 2) {
                    self.push_search_node(p, Some((x as i32, y as i32)), true, f64::INFINITY);
                }
            }
            job.ring += 1;
            job.operations += 1;
        }
        if !job.initialized {
            job.start_index = self.search.nodes.len();
            job.goal_index = job.start_index + 1;
            self.push_search_node(job.start, None, false, 0.);
            self.push_search_node(job.goal, None, false, f64::INFINITY);
            self.search.open.push(Open {
                index: job.start_index,
                score: job.heuristic(job.start.at, r),
            });
            job.initialized = true;
            job.operations += 1;
        }
        loop {
            if job.edge.is_none() {
                self.charge_slice(128 + (scene.surfaces.len() as u64 + 1) * 36)?;
                let open = self.search.open.pop().ok_or(RequestStatus::NoPath)?;
                let i = open.index;
                if self.search.nodes[i].closed {
                    job.operations += 1;
                    continue;
                }
                if self.search.expanded >= MAX_NODES as u32 + 2 {
                    return Err(RequestStatus::NodeBudgetExceeded);
                }
                self.search.nodes[i].closed = true;
                self.search.expanded += 1;
                let from = self.search.nodes[i].pose;
                if i == job.goal_index
                    || r.precise_stop
                        && r.radius > 0.
                        && from.surface == job.goal.surface
                        && from.span.floor == job.goal.span.floor
                        && distance(from.at, job.goal.at) <= f64::from(r.radius)
                {
                    let mut points = Vec::new();
                    let mut at = i;
                    while at != job.start_index {
                        points.push(self.search.nodes[at].pose);
                        at = self.search.nodes[at].parent;
                        if points.len() > MAX_NODES + 1 {
                            return Err(RequestStatus::NodeBudgetExceeded);
                        }
                    }
                    points.reverse();
                    if i != job.goal_index {
                        points.push(job.goal);
                    }
                    return Ok(points);
                }
                let grid = self.search.nodes[i].cell;
                let (x, y) = grid.unwrap_or_else(|| {
                    let center = world
                        .collider(r.actor)
                        .map(|c| c.center(from.at))
                        .unwrap_or(from.at);
                    (
                        ((f64::from(center.x) - job.origin[0]) / f64::from(r.cell)).floor() as i32,
                        ((f64::from(center.y) - job.origin[1]) / f64::from(r.cell)).floor() as i32,
                    )
                });
                let mut neighbors = Vec::new();
                for ny in y - 1..=y + 1 {
                    for nx in x - 1..=x + 1 {
                        if let Some(ids) = self.search.cells.get(&(nx, ny)) {
                            for &id in ids {
                                if grid.is_none()
                                    || (nx - x).abs() + (ny - y).abs() == 1
                                    || self.search.nodes[i].auxiliary
                                    || self.search.nodes[id].auxiliary
                                {
                                    neighbors.push(id);
                                }
                            }
                        }
                    }
                }
                if from.surface == job.goal.surface
                    && distance(from.at, job.goal.at) <= f64::from(r.cell) * 2.
                {
                    neighbors.push(job.goal_index);
                }
                job.edge = Some((i, neighbors, 0));
                job.operations += 1;
            }
            let (i, neighbors, edge) = job.edge.as_mut().ok_or(RequestStatus::NoPath)?;
            if *edge >= neighbors.len() {
                job.edge = None;
                continue;
            }
            let next = neighbors[*edge];
            let from = self.search.nodes[*i].pose;
            let to = self.search.nodes[next].pose;
            let cost = self.search.nodes[*i].cost + distance(from.at, to.at);
            if !self.search.nodes[next].closed
                && !(*i == job.start_index && from.surface != to.surface)
                && scene.navigation_surfaces_connected(from.surface, to.surface)
                && cost < self.search.nodes[next].cost
                && self.probe(scene, world, r.actor, from, to, r.step, r.drop)?
            {
                if self.search.open.len() >= MAX_PROBES as usize {
                    return Err(RequestStatus::ProbeBudgetExceeded);
                }
                self.search.nodes[next].cost = cost;
                self.search.nodes[next].parent = *i;
                self.search.open.push(Open {
                    index: next,
                    score: cost + job.heuristic(to.at, r),
                });
            }
            if let Some((_, _, edge)) = job.edge.as_mut() {
                *edge += 1;
            }
            job.operations += 1;
        }
    }
    /// All query mutations are restored on acceptance, rejection, and every yield.
    pub(crate) fn advance_combat_search(
        &mut self,
        scratch: &mut Self,
        scene: &mut SpatialScene,
        world: &mut World,
        request: CombatNavigationRequest<'_>,
    ) -> CombatNavigationSearch {
        let s = scratch;
        let mut result = CombatNavigationSearch {
            accepted: false,
            pending: false,
            work: 0,
            nodes: 0,
            probes: 0,
            status: RequestStatus::UnsupportedActor as u32,
            neighbors: 0,
        };
        if !supported(world, request.actor, true) {
            s.job = None;
            return result;
        }
        let original = world
            .transform(request.actor)
            .zip(world.height_span(request.actor))
            .expect("supported actor has transform and height span");
        if s.job.as_ref().is_some_and(|j| j.original != original) {
            s.job = None;
        }
        let setup = (scene.surfaces.len() as u64 + 1) * 32 + 64;
        let admission = request
            .preparation_bound
            .saturating_add(setup)
            .saturating_add((scene.surfaces.len() as u64 + 1) * 16);
        let capacity =
            if s.job.as_ref().is_some_and(|j| j.large_slice) || admission > SEARCH_SLICE_WORK {
                MAX_SLICE_WORK
            } else {
                SEARCH_SLICE_WORK
            };
        let available = request.work_limit.min(capacity);
        if admission > available {
            result.status = RequestStatus::FrameBudgetExceeded as u32;
            if admission <= MAX_SLICE_WORK {
                result.pending = s.job.is_some();
            } else {
                s.job = None;
            }
            return result;
        }
        let fresh = s.job.is_none();
        if fresh {
            s.begin_request();
            s.combat = true;
            s.precise_stop = request.precise_stop;
            s.search.work = setup;
            match SearchJob::new(scene, world, &request) {
                Ok(mut job) => {
                    job.large_slice = capacity > SEARCH_SLICE_WORK;
                    s.job = Some(job);
                }
                Err(status) => {
                    result.status = status as u32;
                    result.work = setup;
                    return result;
                }
            }
        }
        let previous = if fresh { 0 } else { s.search.work };
        s.work_limit = SEARCH_TOTAL_WORK.min(previous.saturating_add(available));
        if s.search
            .work
            .saturating_add(request.preparation_bound)
            .saturating_add((scene.surfaces.len() as u64 + 1) * 16)
            > s.work_limit
        {
            s.job = None;
            result.status = RequestStatus::WorkBudgetExceeded as u32;
            result.work = s.search.work.saturating_sub(previous);
            return result;
        }
        s.target_count = scene
            .movement_scratch
            .begin_spatial_query(world, request.actor);
        let velocity = world.velocity(request.actor).unwrap_or_default();
        let prep =
            preparation_work(scene, world, s.target_count) + (scene.surfaces.len() as u64 + 1) * 16;
        let mut job = s.job.take().expect("job was initialized above");
        let outcome = s
            .charge_slice(prep)
            .and_then(|()| s.advance_static_search(&mut job, scene, world, &request));
        scene.movement_scratch.end_spatial_query();
        world.set_transform(request.actor, original.0);
        world.set_height_span(request.actor, original.1);
        world.set_velocity(request.actor, velocity);
        match outcome {
            Ok(points) => {
                self.install_combat_route(points, world, &request);
                result.accepted = true;
                result.status = RequestStatus::Accepted as u32;
            }
            Err(RequestStatus::WorkBudgetExceeded)
                if s.work_limit < SEARCH_TOTAL_WORK
                    && (job.yielded != Some(job.operations)
                        || !job.large_slice
                        || available < capacity) =>
            {
                if job.yielded == Some(job.operations) && available >= capacity {
                    job.large_slice = true;
                }
                job.yielded = Some(job.operations);
                s.job = Some(job);
                result.pending = true;
                result.status = RequestStatus::NotRequested as u32;
            }
            Err(status) => {
                result.status = if matches!(status, RequestStatus::WorkBudgetExceeded)
                    && s.work_limit < SEARCH_TOTAL_WORK
                {
                    RequestStatus::FrameBudgetExceeded as u32
                } else {
                    status as u32
                };
            }
        }
        result.work = s.search.work.saturating_sub(previous);
        result.nodes = s.search.expanded;
        result.probes = s.search.probes;
        result
    }
    fn install_combat_route(
        &mut self,
        points: Vec<Waypoint>,
        world: &World,
        r: &CombatNavigationRequest<'_>,
    ) {
        self.points = points;
        self.next = 0;
        self.planned = self.points.len();
        self.actor = Some(r.actor);
        self.status = SpatialMoveStatus::Moving;
        self.speed = r.speed;
        self.cell_size = r.cell;
        self.radius = r.radius;
        self.cancel_on_input = false;
        self.pending = 0.;
        self.last = world.transform(r.actor).zip(world.height_span(r.actor));
        self.last_motion = None;
        self.crowd_detour = None;
        self.combat = true;
        self.precise_stop = r.precise_stop;
        self.combat_step = r.step;
        self.combat_drop = r.drop;
    }
    pub(crate) fn share_combat_route(
        &self,
        key: CombatRouteKey,
        scene: &SpatialScene,
        world: &World,
    ) -> Option<SharedCombatRoute> {
        let actor = self.actor?;
        let (at, span) = self.last?;
        let start = pose(scene, world, actor, at, span.floor.0)?;
        let mut points = Vec::with_capacity(self.points.len() + 1);
        points.push(start);
        points.extend_from_slice(&self.points);
        Some(SharedCombatRoute { key, points })
    }
    /// Reuse only a short, same-support native connector; future edges remain checked by the follower.
    pub(crate) fn reuse_combat_route(
        &mut self,
        cached: &SharedCombatRoute,
        scene: &mut SpatialScene,
        world: &mut World,
        r: &CombatNavigationRequest<'_>,
    ) -> (bool, u64) {
        let scan = (cached.points.len() as u64) * 4 + (scene.surfaces.len() as u64 + 1) * 16;
        if r.preparation_bound.saturating_add(scan) > r.work_limit {
            return (false, 0);
        }
        let Some(original) = world.transform(r.actor).zip(world.height_span(r.actor)) else {
            return (false, scan);
        };
        let Some(start) = pose(scene, world, r.actor, original.0, original.1.floor.0)
            .filter(|p| (p.span.elevation - original.1.elevation).abs() <= 0.001)
        else {
            return (false, scan);
        };
        let nearest = cached
            .points
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                p.surface == start.surface
                    && p.span.floor == start.span.floor
                    && distance(p.at, start.at) <= f64::from(r.cell) * 2.
            })
            .min_by(|(_, a), (_, b)| distance(a.at, start.at).total_cmp(&distance(b.at, start.at)))
            .map(|(i, _)| i);
        let Some(i) = nearest else {
            return (false, scan);
        };
        if r.preparation_bound > r.work_limit {
            return (false, scan);
        }
        self.combat = true;
        self.search_peers.clear();
        self.work_limit = r.work_limit;
        self.search.work = 0;
        self.search.probes = 0;
        self.target_count = scene.movement_scratch.begin_spatial_query(world, r.actor);
        self.search.work = preparation_work(scene, world, self.target_count) + scan;
        let velocity = world.velocity(r.actor).unwrap_or_default();
        let accepted = self.search.work <= self.work_limit
            && self
                .probe(
                    scene,
                    world,
                    r.actor,
                    start,
                    cached.points[i],
                    r.step,
                    r.drop,
                )
                .unwrap_or(false);
        scene.movement_scratch.end_spatial_query();
        world.set_transform(r.actor, original.0);
        world.set_height_span(r.actor, original.1);
        world.set_velocity(r.actor, velocity);
        let used = self.search.work.min(r.work_limit);
        if accepted {
            self.install_combat_route(cached.points[i..].to_vec(), world, r);
        }
        (accepted, used)
    }
}

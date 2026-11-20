//! Resumable native A*. A slice resumes an edge at its next capsule probe rather
//! than redoing the search prefix. Exact native query inputs invalidate stale jobs.
use super::{distance, horizontal, Point};
use crate::engine::unified_physics::{UnifiedPhysicsRuntime, UnifiedTerrainSource};
use crate::physics3d::{
    BodyId, CharacterConfig, CharacterProbeScratch, CharacterQuerySnapshot, ColliderRef, Pose,
};
use crate::spatial_scene::SpatialScene;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap};

pub(super) const MAX_WORK: u64 = 8_000_000;
const MAX_NODES: usize = 4096;
const MAX_PROBES: u32 = 32768;
const MAX_OPEN: usize = MAX_NODES * 8;
const DIRECTIONS: [(i32, i32); 8] = [
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, -1),
    (0, 1),
    (1, -1),
    (1, 0),
    (1, 1),
];

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Node {
    point: Point,
    cost: f64,
    parent: Option<usize>,
    closed: bool,
    cell: (i32, i32),
}
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
struct Open {
    node: usize,
    score: f64,
}
impl PartialEq for Open {
    fn eq(&self, other: &Self) -> bool {
        self.node == other.node && self.score.total_cmp(&other.score) == Ordering::Equal
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
            .then(other.node.cmp(&self.node))
    }
}

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
enum Cursor {
    Goals {
        node: usize,
        next: usize,
    },
    Neighbors {
        node: usize,
        direction: usize,
        surface: usize,
    },
}
impl Cursor {
    fn phase(self) -> Phase {
        match self {
            Self::Goals { node, next } => Phase::GoalEdges { node, next },
            Self::Neighbors {
                node,
                direction,
                surface,
            } => Phase::Neighbors {
                node,
                direction,
                surface,
            },
        }
    }
}
#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
enum Destination {
    Goal {
        node: usize,
        point: Point,
    },
    Neighbor {
        node: usize,
        point: Point,
        cell: (i32, i32),
    },
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Edge {
    from: Point,
    to: Point,
    count: u32,
    segment: u32,
    corrections: u32,
    pose: Pose,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
enum Phase {
    Preparation,
    GoalSupports {
        next: usize,
    },
    Pop,
    GoalEdges {
        node: usize,
        next: usize,
    },
    Neighbors {
        node: usize,
        direction: usize,
        surface: usize,
    },
    Edge {
        edge: Edge,
        destination: Destination,
        next: Cursor,
    },
    Commit {
        accepted: bool,
        destination: Destination,
        next: Cursor,
    },
    Route {
        next: Option<usize>,
        #[serde(with = "crate::checkpoint_codec::vector")]
        points: Vec<Point>,
    },
    Reverse(Vec<Point>),
    Done,
}

/// One search owns its frontier and probe scratch. No frontier is copied between slices.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct Search {
    body: BodyId,
    config: CharacterConfig,
    support: ColliderRef,
    start: Point,
    seed: Pose,
    floor: u32,
    cell: f32,
    skin: f32,
    tolerance: f32,
    stride: f32,
    scene_revision: u32,
    target_count: usize,
    #[serde(with = "crate::checkpoint_codec::vector")]
    goals: Vec<Point>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    nodes: Vec<Node>,
    #[serde(with = "stored_frontier::known")]
    known: BTreeMap<(i32, i32, u32), usize>,
    #[serde(with = "stored_frontier::open")]
    open: BinaryHeap<Open>,
    phase: Phase,
    scratch: CharacterProbeScratch,
    snapshot: Option<CharacterQuerySnapshot>,
    fixed_only: bool,
    connector: Option<Point>,
    pub(in crate::engine) expanded: u32,
    pub(in crate::engine) probes: u32,
    pub(in crate::engine) work: u64,
}

impl Search {
    pub(in crate::engine) fn new(
        runtime: &UnifiedPhysicsRuntime,
        scene: &SpatialScene,
        body: BodyId,
        seed: Pose,
        floor: u32,
        cell: f32,
    ) -> Result<Self, u32> {
        if !cell.is_finite()
            || cell <= 0.
            || floor > 65535
            || seed
                .position
                .iter()
                .any(|v| !v.is_finite() || v.abs() > 1e6)
        {
            return Err(2);
        }
        let config = runtime.physics.character_config(body).map_err(|_| 3u32)?;
        let pose = runtime.physics.body_state(body).map_err(|_| 3u32)?.pose;
        let ground = runtime
            .physics
            .character_state(body)
            .map_err(|_| 3u32)?
            .ground
            .ok_or(3u32)?;
        let Some(UnifiedTerrainSource::SpatialSurface { id }) =
            runtime.terrain.source(ground.collider)
        else {
            return Err(3);
        };
        let start = Point { pose, surface: id };
        Ok(Self {
            body,
            config: config.clone(),
            support: ground,
            start,
            seed,
            floor,
            cell,
            skin: config.skin_width,
            tolerance: (config.skin_width * 0.1).max(runtime.physics.config().length_unit * 0.0001),
            stride: config.step_min_width.min(cell).max(config.skin_width * 2.),
            scene_revision: scene.revision,
            target_count: runtime.physics.collider_count(),
            goals: Vec::new(),
            nodes: vec![Node {
                point: start,
                cost: 0.,
                parent: None,
                closed: false,
                cell: (0, 0),
            }],
            known: BTreeMap::from([((0, 0, id), 0)]),
            open: BinaryHeap::new(),
            phase: Phase::Preparation,
            scratch: CharacterProbeScratch::default(),
            snapshot: None,
            fixed_only: false,
            connector: None,
            expanded: 0,
            probes: 0,
            work: 0,
        })
    }

    pub(in crate::engine) fn fixed_geometry(mut self) -> Self {
        self.fixed_only = true;
        self
    }
    /// Validate the join to a previously certified route using the same sliced edge checks.
    pub(in crate::engine) fn connector(
        runtime: &UnifiedPhysicsRuntime,
        scene: &SpatialScene,
        body: BodyId,
        point: Point,
        cell: f32,
    ) -> Result<Self, u32> {
        let floor = scene
            .surfaces
            .iter()
            .find(|s| s.id == point.surface)
            .ok_or(4u32)?
            .floor;
        let mut job = Self::new(runtime, scene, body, point.pose, floor, cell)?.fixed_geometry();
        job.connector = Some(point);
        Ok(job)
    }
    fn probe(
        &mut self,
        runtime: &mut UnifiedPhysicsRuntime,
        body: BodyId,
        pose: Pose,
        translation: [f32; 3],
        grounded: bool,
    ) -> Result<crate::physics3d::CharacterMotionProbe, crate::physics3d::PhysicsError> {
        if self.fixed_only {
            runtime.physics.probe_character_route(
                body,
                pose,
                translation,
                grounded,
                &mut self.scratch,
            )
        } else {
            runtime.physics.probe_character_motion(
                body,
                pose,
                translation,
                grounded,
                &mut self.scratch,
            )
        }
    }

    fn charge(&mut self, remaining: &mut u64, units: u64) -> Result<bool, u32> {
        if self.work.saturating_add(units) > MAX_WORK {
            return Err(7);
        }
        if units > *remaining {
            return Ok(false);
        }
        self.work += units;
        *remaining -= units;
        Ok(true)
    }
    fn probe_charge(&mut self, remaining: &mut u64, extra: u64) -> Result<bool, u32> {
        if self.probes >= MAX_PROBES {
            return Err(6);
        }
        if !self.charge(remaining, self.target_count as u64 + 1 + extra)? {
            return Ok(false);
        }
        self.probes += 1;
        Ok(true)
    }
    fn heuristic(&self, pose: Pose) -> f64 {
        self.goals
            .iter()
            .map(|g| distance(pose, g.pose))
            .fold(f64::INFINITY, f64::min)
    }

    // None means admission was deferred; Some(None) means no support at this point.
    fn support(
        &mut self,
        runtime: &mut UnifiedPhysicsRuntime,
        scene: &SpatialScene,
        seed: Pose,
        index: usize,
        remaining: &mut u64,
    ) -> Result<Option<Option<Point>>, u32> {
        let surface = &scene.surfaces[index];
        let [x, y, w, d] = surface.bounds;
        if !surface.walkable {
            return Ok(self.charge(remaining, 1)?.then_some(None));
        }
        // Admit support geometry before computing it. Only the actual query
        // increments probes; a deferred query never repeats a completed probe.
        if !self.charge(remaining, 1)? {
            return Ok(None);
        }
        let slope = (surface.heights[1] - surface.heights[0]) / if surface.ramp_x { w } else { d };
        let scale = slope.hypot(1.);
        let normal = if surface.ramp_x {
            [-slope / scale, 1. / scale, 0.]
        } else {
            [0., 1. / scale, slope / scale]
        };
        let (center, point) = runtime
            .physics
            .character_plane_support(self.body, seed, normal)
            .map_err(|_| 3u32)?;
        if center[0] < x || center[0] >= x + w || -center[2] < y || -center[2] >= y + d {
            return Ok(Some(None));
        }
        let offset = if surface.ramp_x {
            point[0] - x
        } else {
            -point[2] - y
        };
        let height = surface.heights[0] + offset * slope;
        if !self.probe_charge(remaining, 0)? {
            return Ok(None);
        }
        let pose = Pose {
            position: [
                seed.position[0],
                seed.position[1] + height - point[1] + self.skin * scale,
                seed.position[2],
            ],
            ..seed
        };
        let Ok(probe) = self.probe(runtime, self.body, pose, [0., -self.skin * 2., 0.], false)
        else {
            return Ok(Some(None));
        };
        if !probe.grounded
            || probe
                .ground
                .and_then(|g| runtime.terrain.source(g.collider))
                != Some(UnifiedTerrainSource::SpatialSurface { id: surface.id })
            || probe.sliding
            || probe.dropped_contacts != 0
            || horizontal(pose, probe.pose) > f64::from(self.skin) * 0.1
        {
            return Ok(Some(None));
        }
        Ok(Some(Some(Point {
            pose: probe.pose,
            surface: surface.id,
        })))
    }

    fn edge(&self, from: Point, to: Point) -> Result<Edge, u32> {
        let count = (horizontal(from.pose, to.pose) / f64::from(self.stride))
            .ceil()
            .max(1.);
        if count > f64::from(MAX_PROBES) {
            return Err(6);
        }
        Ok(Edge {
            from,
            to,
            count: count as u32,
            segment: 1,
            corrections: 0,
            pose: from.pose,
        })
    }
    fn advance_edge(
        &mut self,
        runtime: &mut UnifiedPhysicsRuntime,
        scene: &SpatialScene,
        edge: &mut Edge,
        remaining: &mut u64,
    ) -> Result<Option<bool>, u32> {
        while edge.segment <= edge.count {
            let f = edge.segment as f32 / edge.count as f32;
            let x = edge.from.pose.position[0]
                + (edge.to.pose.position[0] - edge.from.pose.position[0]) * f;
            let z = edge.from.pose.position[2]
                + (edge.to.pose.position[2] - edge.from.pose.position[2]) * f;
            let distance = (edge.pose.position[0] - x).hypot(edge.pose.position[2] - z);
            if distance <= self.tolerance {
                if !self.charge(remaining, 1)? {
                    return Ok(None);
                }
                edge.segment += 1;
                edge.corrections = 0;
                continue;
            }
            if edge.corrections == 16 {
                return Ok(Some(false));
            }
            if !self.probe_charge(remaining, scene.surfaces.len() as u64)? {
                return Ok(None);
            }
            let Ok(probe) = self.probe(
                runtime,
                self.body,
                edge.pose,
                [x - edge.pose.position[0], 0., z - edge.pose.position[2]],
                true,
            ) else {
                return Ok(Some(false));
            };
            let after = (probe.pose.position[0] - x).hypot(probe.pose.position[2] - z);
            if !probe.grounded || probe.sliding || probe.dropped_contacts != 0 || after >= distance
            {
                return Ok(Some(false));
            }
            let ground = probe
                .ground
                .and_then(|g| runtime.terrain.source(g.collider));
            if !scene.surfaces.iter().any(|s| {
                s.walkable && ground == Some(UnifiedTerrainSource::SpatialSurface { id: s.id })
            }) {
                return Ok(Some(false));
            }
            edge.pose = probe.pose;
            edge.corrections += 1;
        }
        Ok(Some(
            (edge.pose.position[1] - edge.to.pose.position[1]).abs() <= self.tolerance * 4.,
        ))
    }

    /// None is a real yield. All executed query/edge work is retained in this job.
    /// Geometry/config changes cancel the job before any cached edge is used.
    pub(in crate::engine) fn advance(
        &mut self,
        runtime: &mut UnifiedPhysicsRuntime,
        scene: &SpatialScene,
        limit: u64,
    ) -> Result<Option<Vec<Point>>, u32> {
        if matches!(self.phase, Phase::Done) {
            return Err(8);
        }
        if scene.revision != self.scene_revision
            || !self.fixed_only && runtime.physics.collider_count() != self.target_count
            || runtime.physics.character_config(self.body).ok() != Some(&self.config)
            || runtime.physics.body_state(self.body).ok().map(|s| s.pose) != Some(self.start.pose)
            || runtime
                .physics
                .character_state(self.body)
                .ok()
                .and_then(|s| s.ground)
                != Some(self.support)
        {
            self.phase = Phase::Done;
            return Err(8);
        }
        self.target_count = runtime.physics.collider_count();
        let mut remaining = limit;
        if self.snapshot.is_some() {
            let admitted = match self.charge(&mut remaining, self.target_count as u64 + 1) {
                Ok(admitted) => admitted,
                Err(error) => {
                    self.phase = Phase::Done;
                    return Err(error);
                }
            };
            if !admitted {
                return Ok(None);
            }
            if !self
                .snapshot
                .as_ref()
                .is_some_and(|snapshot| runtime.physics.character_query_snapshot_matches(snapshot))
            {
                self.phase = Phase::Done;
                return Err(8);
            }
        }
        let result = self.run(runtime, scene, &mut remaining);
        if !matches!(result, Ok(None)) {
            self.phase = Phase::Done;
        }
        result
    }

    fn run(
        &mut self,
        runtime: &mut UnifiedPhysicsRuntime,
        scene: &SpatialScene,
        remaining: &mut u64,
    ) -> Result<Option<Vec<Point>>, u32> {
        loop {
            let phase = std::mem::replace(&mut self.phase, Phase::Done);
            match phase {
                Phase::Preparation => {
                    if !self.charge(
                        remaining,
                        (self.target_count + scene.surfaces.len() + 1) as u64,
                    )? {
                        self.phase = Phase::Preparation;
                        return Ok(None);
                    }
                    self.phase = if let Some(point) = self.connector {
                        self.goals.push(point);
                        // A cached waypoint is a fixed goal, not a guarantee
                        // that the joining actor has a clear straight edge.
                        // Reuse the same bounded A* when the direct edge fails.
                        self.open.push(Open {
                            node: 0,
                            score: self.heuristic(self.start.pose),
                        });
                        Phase::Pop
                    } else {
                        Phase::GoalSupports { next: 0 }
                    };
                    self.snapshot = Some(
                        runtime
                            .physics
                            .capture_character_query_snapshot(self.body, self.fixed_only)
                            .map_err(|_| 3u32)?,
                    );
                }
                Phase::GoalSupports { next } => {
                    if next == scene.surfaces.len() {
                        if self.goals.is_empty() {
                            return Err(4);
                        }
                        if !self.charge(remaining, self.goals.len() as u64 + 1)? {
                            self.phase = Phase::GoalSupports { next };
                            return Ok(None);
                        }
                        self.open.push(Open {
                            node: 0,
                            score: self.heuristic(self.start.pose),
                        });
                        self.phase = Phase::Pop;
                        continue;
                    }
                    if scene.surfaces[next].floor != self.floor {
                        if !self.charge(remaining, 1)? {
                            self.phase = Phase::GoalSupports { next };
                            return Ok(None);
                        }
                    } else {
                        let Some(point) =
                            self.support(runtime, scene, self.seed, next, remaining)?
                        else {
                            self.phase = Phase::GoalSupports { next };
                            return Ok(None);
                        };
                        if let Some(point) = point {
                            self.goals.push(point);
                        }
                    }
                    self.phase = Phase::GoalSupports { next: next + 1 };
                }
                Phase::Pop => {
                    if !self.charge(remaining, 1)? {
                        self.phase = Phase::Pop;
                        return Ok(None);
                    }
                    let Some(entry) = self.open.pop() else {
                        return Err(4);
                    };
                    if self.nodes[entry.node].closed {
                        self.phase = Phase::Pop;
                        continue;
                    }
                    self.nodes[entry.node].closed = true;
                    self.expanded += 1;
                    self.phase = Phase::GoalEdges {
                        node: entry.node,
                        next: 0,
                    };
                }
                Phase::GoalEdges { node, next } => {
                    if next == self.goals.len() {
                        self.phase = Phase::Neighbors {
                            node,
                            direction: 0,
                            surface: 0,
                        };
                        continue;
                    }
                    if !self.charge(remaining, 1)? {
                        self.phase = Phase::GoalEdges { node, next };
                        return Ok(None);
                    }
                    let point = self.goals[next];
                    let edge = self.edge(self.nodes[node].point, point)?;
                    self.phase = Phase::Edge {
                        edge,
                        destination: Destination::Goal { node, point },
                        next: Cursor::Goals {
                            node,
                            next: next + 1,
                        },
                    };
                }
                Phase::Neighbors {
                    node,
                    direction,
                    surface,
                } => {
                    if direction == DIRECTIONS.len() {
                        self.phase = Phase::Pop;
                        continue;
                    }
                    if surface == scene.surfaces.len() {
                        self.phase = Phase::Neighbors {
                            node,
                            direction: direction + 1,
                            surface: 0,
                        };
                        continue;
                    }
                    let restore = Cursor::Neighbors {
                        node,
                        direction,
                        surface,
                    };
                    if !self.charge(remaining, 1)? {
                        self.phase = restore.phase();
                        return Ok(None);
                    }
                    let (cx, cz) = self.nodes[node].cell;
                    let (dx, dz) = DIRECTIONS[direction];
                    let next = Cursor::Neighbors {
                        node,
                        direction,
                        surface: surface + 1,
                    };
                    let (Some(nx), Some(nz)) = (cx.checked_add(dx), cz.checked_add(dz)) else {
                        self.phase = next.phase();
                        continue;
                    };
                    let at = Pose {
                        position: [
                            self.start.pose.position[0] + nx as f32 * self.cell,
                            self.start.pose.position[1],
                            self.start.pose.position[2] + nz as f32 * self.cell,
                        ],
                        ..self.start.pose
                    };
                    let key = (nx, nz, scene.surfaces[surface].id);
                    if at.position.iter().any(|v| !v.is_finite() || v.abs() > 1e6)
                        || self.known.get(&key).is_some_and(|&i| self.nodes[i].closed)
                    {
                        self.phase = next.phase();
                        continue;
                    }
                    let Some(point) = self.support(runtime, scene, at, surface, remaining)? else {
                        self.phase = restore.phase();
                        return Ok(None);
                    };
                    let Some(point) = point else {
                        self.phase = next.phase();
                        continue;
                    };
                    let edge = self.edge(self.nodes[node].point, point)?;
                    self.phase = Phase::Edge {
                        edge,
                        destination: Destination::Neighbor {
                            node,
                            point,
                            cell: (nx, nz),
                        },
                        next,
                    };
                }
                Phase::Edge {
                    mut edge,
                    destination,
                    next,
                } => {
                    let Some(accepted) = self.advance_edge(runtime, scene, &mut edge, remaining)?
                    else {
                        self.phase = Phase::Edge {
                            edge,
                            destination,
                            next,
                        };
                        return Ok(None);
                    };
                    self.phase = Phase::Commit {
                        accepted,
                        destination,
                        next,
                    };
                }
                Phase::Commit {
                    accepted,
                    destination,
                    next,
                } => {
                    if !accepted {
                        self.phase = next.phase();
                        continue;
                    }
                    if !self.charge(remaining, self.goals.len() as u64 + 1)? {
                        self.phase = Phase::Commit {
                            accepted,
                            destination,
                            next,
                        };
                        return Ok(None);
                    }
                    match destination {
                        Destination::Goal { node, point } => {
                            self.phase = Phase::Route {
                                next: Some(node),
                                points: vec![point],
                            }
                        }
                        Destination::Neighbor { node, point, cell } => {
                            let key = (cell.0, cell.1, point.surface);
                            let cost = self.nodes[node].cost
                                + distance(self.nodes[node].point.pose, point.pose);
                            let index = if let Some(&i) = self.known.get(&key) {
                                if cost >= self.nodes[i].cost {
                                    self.phase = next.phase();
                                    continue;
                                }
                                self.nodes[i].cost = cost;
                                self.nodes[i].parent = Some(node);
                                i
                            } else {
                                if self.nodes.len() >= MAX_NODES {
                                    return Err(5);
                                }
                                let i = self.nodes.len();
                                self.nodes.push(Node {
                                    point,
                                    cost,
                                    parent: Some(node),
                                    closed: false,
                                    cell,
                                });
                                self.known.insert(key, i);
                                i
                            };
                            if self.open.len() >= MAX_OPEN {
                                return Err(5);
                            }
                            self.open.push(Open {
                                node: index,
                                score: cost + self.heuristic(point.pose),
                            });
                            self.phase = next.phase();
                        }
                    }
                }
                Phase::Route { next, mut points } => {
                    if let Some(index) = next {
                        if !self.charge(remaining, 1)? {
                            self.phase = Phase::Route { next, points };
                            return Ok(None);
                        }
                        points.push(self.nodes[index].point);
                        self.phase = Phase::Route {
                            next: self.nodes[index].parent,
                            points,
                        };
                    } else {
                        self.phase = Phase::Reverse(points);
                    }
                }
                Phase::Reverse(mut points) => {
                    if !self.charge(remaining, points.len() as u64)? {
                        self.phase = Phase::Reverse(points);
                        return Ok(None);
                    }
                    points.reverse();
                    points.remove(0);
                    return Ok(Some(points));
                }
                Phase::Done => return Err(8),
            }
        }
    }
}

#[cfg(test)]
mod tests;

mod file_admission;
mod stored_frontier;

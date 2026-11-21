use super::*;
use crate::engine::file_controller_admission::{pose, Budget, Error, Owner, Result};
use crate::engine::unified_physics::spatial_actor::navigation::file_admission::point_valid;
impl Search {
    pub(in crate::engine) fn validate_file_controller(
        &self,
        scene: &SpatialScene,
        b: &mut Budget,
    ) -> Result {
        b.work(192)?;
        let n = self.nodes.len();
        b.require(
            n > 0
                && n <= MAX_NODES
                && self.open.len() <= MAX_OPEN
                && self.goals.len() <= 256
                && self.known.len() == n,
            Owner::Search,
            "counts",
            0,
        )?;
        b.require(
            self.config.saved_controller_config_valid()
                && pose(self.seed)
                && point_valid(self.start)
                && self.floor <= 65535
                && self.cell.is_finite()
                && self.cell > 0.
                && self.skin == self.config.skin_width
                && self.tolerance.is_finite()
                && self.tolerance > 0.
                && self.stride
                    == self
                        .config
                        .step_min_width
                        .min(self.cell)
                        .max(self.skin * 2.),
            Owner::Search,
            "configuration",
            0,
        )?;
        b.require(
            self.probes <= MAX_PROBES && self.expanded <= MAX_NODES as u32 && self.work <= MAX_WORK,
            Owner::Search,
            "work-counters",
            0,
        )?;
        b.work((n as u64) * 96 + (self.open.len() as u64) * 8 + (self.goals.len() as u64) * 16)?;
        for (i, p) in self.goals.iter().enumerate() {
            b.require(point_valid(*p), Owner::Search, "goal", i)?;
        }
        if let Some(p) = self.connector {
            b.require(
                point_valid(p) && self.fixed_only,
                Owner::Search,
                "connector",
                0,
            )?;
        }
        for (i, node) in self.nodes.iter().enumerate() {
            b.require(
                point_valid(node.point) && node.cost.is_finite() && node.cost >= 0.,
                Owner::Search,
                "node-numeric",
                i,
            )?;
            b.require(
                self.known
                    .get(&(node.cell.0, node.cell.1, node.point.surface))
                    == Some(&i),
                Owner::Search,
                "known-bijection",
                i,
            )?;
            b.require(
                if i == 0 {
                    node.parent.is_none()
                        && node.cost == 0.
                        && node.cell == (0, 0)
                        && node.point.pose == self.start.pose
                        && node.point.surface == self.start.surface
                } else {
                    node.parent.is_some_and(|p| {
                        p < n && p != i && self.nodes[p].closed && self.nodes[p].cost <= node.cost
                    })
                },
                Owner::Search,
                "parent",
                i,
            )?;
        }
        for (key, index) in &self.known {
            b.require(
                *index < n
                    && self.nodes[*index].cell == (key.0, key.1)
                    && self.nodes[*index].point.surface == key.2,
                Owner::Search,
                "known-index",
                *index,
            )?;
        }
        let mut colors = b.vector(n, 0u8)?;
        for i in 0..n {
            let mut at = Some(i);
            while let Some(index) = at {
                if colors[index] == 2 {
                    break;
                }
                b.require(colors[index] == 0, Owner::Search, "parent-cycle", index)?;
                colors[index] = 1;
                at = self.nodes[index].parent;
            }
            let mut at = Some(i);
            while let Some(index) = at {
                if colors[index] != 1 {
                    break;
                }
                colors[index] = 2;
                at = self.nodes[index].parent;
            }
        }
        b.require(
            self.nodes.iter().filter(|n| n.closed).count() == self.expanded as usize,
            Owner::Search,
            "closed-expanded",
            0,
        )?;
        for (i, e) in self.open.as_slice().iter().enumerate() {
            b.require(
                e.node < n
                    && e.score.is_finite()
                    && e.score >= 0.
                    && e.score >= self.nodes[e.node].cost
                    && (i == 0 || self.open.as_slice()[(i - 1) / 2] >= *e),
                Owner::Search,
                "open",
                i,
            )?;
        }
        if let Some(snapshot) = &self.snapshot {
            b.work(snapshot.saved_controller_work().ok_or(Error::Work)?)?;
            b.require(
                snapshot.saved_controller_payload_valid(
                    self.body,
                    &self.config,
                    self.start.pose,
                    self.fixed_only,
                ),
                Owner::Search,
                "query-snapshot",
                0,
            )?;
        } else {
            b.require(
                matches!(self.phase, Phase::Preparation | Phase::Done),
                Owner::Search,
                "snapshot-presence",
                0,
            )?;
        }
        let surfaces = if self.scene_revision == scene.revision {
            scene.surfaces.len().min(256)
        } else {
            256
        };
        let node = |index| index < n;
        let cursor = |c: Cursor| match c {
            Cursor::Goals { node: i, next } => node(i) && next <= self.goals.len(),
            Cursor::Neighbors {
                node: i,
                direction,
                surface,
            } => node(i) && direction <= 8 && surface <= surfaces,
        };
        let destination = |d: Destination| match d {
            Destination::Goal { node: i, point } | Destination::Neighbor { node: i, point, .. } => {
                node(i) && point_valid(point)
            }
        };
        let connection = |d: Destination, c: Cursor| match (d, c) {
            (Destination::Goal { node: a, point }, Cursor::Goals { node: z, next }) => {
                a == z
                    && next > 0
                    && self
                        .goals
                        .get(next - 1)
                        .is_some_and(|g| g.pose == point.pose && g.surface == point.surface)
            }
            (
                Destination::Neighbor {
                    node: a,
                    point,
                    cell,
                },
                Cursor::Neighbors {
                    node: z,
                    direction,
                    surface,
                },
            ) => {
                a == z
                    && direction < DIRECTIONS.len()
                    && surface > 0
                    && self.nodes.get(a).is_some_and(|from| {
                        let (dx, dz) = DIRECTIONS[direction];
                        from.cell.0.checked_add(dx) == Some(cell.0)
                            && from.cell.1.checked_add(dz) == Some(cell.1)
                    })
                    && (self.scene_revision != scene.revision
                        || scene
                            .surfaces
                            .get(surface - 1)
                            .is_some_and(|s| s.id == point.surface))
            }
            _ => false,
        };
        let points = |points: &[Point], b: &mut Budget| -> Result {
            b.work((points.len() as u64).checked_mul(16).ok_or(Error::Work)?)?;
            b.require(
                !points.is_empty() && points.len() <= n + 1,
                Owner::Search,
                "route-points",
                0,
            )?;
            for (i, p) in points.iter().enumerate() {
                b.require(point_valid(*p), Owner::Search, "route-point", i)?;
            }
            Ok(())
        };
        match &self.phase {
            Phase::Preparation => b.require(
                n == 1
                    && self.goals.is_empty()
                    && self.open.is_empty()
                    && self.snapshot.is_none()
                    && self.work == 0
                    && self.probes == 0
                    && self.expanded == 0,
                Owner::Search,
                "preparation-state",
                0,
            )?,
            Phase::Pop | Phase::Done => {}
            Phase::GoalSupports { next } => b.require(
                *next <= surfaces && self.goals.len() <= *next,
                Owner::Search,
                "goal-support-index",
                *next,
            )?,
            Phase::GoalEdges { node: i, next } => b.require(
                node(*i) && *next <= self.goals.len(),
                Owner::Search,
                "goal-edge-index",
                *i,
            )?,
            Phase::Neighbors {
                node: i,
                direction,
                surface,
            } => b.require(
                node(*i) && *direction <= 8 && *surface <= surfaces,
                Owner::Search,
                "neighbor-index",
                *i,
            )?,
            Phase::Edge {
                edge,
                destination: d,
                next,
            } => {
                b.work(64)?;
                b.require(
                    destination(*d) && cursor(*next) && connection(*d, *next),
                    Owner::Search,
                    "edge-state",
                    0,
                )?;
                let expected = (horizontal(edge.from.pose, edge.to.pose) / f64::from(self.stride))
                    .ceil()
                    .max(1.);
                b.require(
                    point_valid(edge.from)
                        && point_valid(edge.to)
                        && pose(edge.pose)
                        && edge.count >= 1
                        && edge.count <= MAX_PROBES
                        && expected == f64::from(edge.count)
                        && edge.segment >= 1
                        && edge.segment <= edge.count + 1
                        && edge.corrections <= 16,
                    Owner::Search,
                    "edge-progress",
                    0,
                )?;
                let (from, to) = match *d {
                    Destination::Goal { node: i, point }
                    | Destination::Neighbor { node: i, point, .. } => (self.nodes[i].point, point),
                };
                b.require(
                    edge.from.pose == from.pose
                        && edge.from.surface == from.surface
                        && edge.to.pose == to.pose
                        && edge.to.surface == to.surface,
                    Owner::Search,
                    "edge-endpoints",
                    0,
                )?;
            }
            Phase::Commit {
                destination: d,
                next,
                ..
            } => b.require(
                destination(*d) && cursor(*next) && connection(*d, *next),
                Owner::Search,
                "commit-state",
                0,
            )?,
            Phase::Route { next, points: p } => {
                b.require(
                    next.is_none_or(node),
                    Owner::Search,
                    "route-index",
                    next.unwrap_or(0),
                )?;
                points(p, b)?;
                b.work(n as u64)?; // Parent graph was certified acyclic above.
                let mut remaining = 0usize;
                let mut at = *next;
                while let Some(i) = at {
                    remaining += 1;
                    at = self.nodes[i].parent;
                }
                b.require(
                    p.len() + remaining <= n + 1 && (next.is_some() || p.len() >= 2),
                    Owner::Search,
                    "route-progress",
                    0,
                )?;
            }
            Phase::Reverse(p) => {
                points(p, b)?;
                b.require(p.len() >= 2, Owner::Search, "reverse-progress", 0)?;
            }
        }
        Ok(())
    }
    pub(in crate::engine) fn file_controller_job_matches(
        &self,
        cell: f32,
        floor: u32,
        connector: Option<Point>,
    ) -> bool {
        self.fixed_only
            && self.cell == cell
            && match (self.connector, connector) {
                (None, None) => self.floor == floor,
                (Some(a), Some(z)) => a.pose == z.pose && a.surface == z.surface,
                _ => false,
            }
    }
    pub(in crate::engine) fn file_controller_config(&self) -> &CharacterConfig {
        &self.config
    }
}

use super::super::file_combat_admission::waypoint;
use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
use crate::spatial_scene::file_admission::span;
impl CombatRouteKey {
    pub(crate) fn file_revision(&self) -> u32 {
        self.revision
    }
    pub(crate) fn validate_file_combat(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            target: _,
            goal: _,
            span: _,
            collider: _,
            filter: _,
            height: _,
            cell: _,
            radius: _,
            step: _,
            drop: _,
            precise: _,
            revision: _,
        } = self;
        b.work(32)?;
        require(
            finite(&[
                self.goal.x,
                self.goal.y,
                self.collider.half_width,
                self.collider.half_height,
                self.collider.offset_x,
                self.collider.offset_y,
                self.height,
                self.cell,
                self.radius,
                self.step,
                self.drop,
            ]) && span(self.span)
                && self.height >= 0.
                && self.cell > 0.
                && self.radius >= 0.
                && self.step >= 0.
                && self.drop >= 0.,
            "combat_key",
            "payload",
            0,
            Problem::Number,
        )
    }
}
impl SharedCombatRoute {
    pub(crate) fn validate_file_combat(
        &self,
        scene: &SpatialScene,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self { key: _, points: _ } = self;
        b.work(2)?;
        self.key.validate_file_combat(b)?;
        b.vector(&self.points)?;
        require(
            !self.points.is_empty() && self.points.len() <= MAX_NODES + 3,
            "shared_route",
            "length",
            0,
            Problem::Length,
        )?;
        let current = (self.key.revision == scene.navigation_revision).then_some(scene);
        for &p in &self.points {
            waypoint(p, current, b)?;
        }
        Ok(())
    }
}
impl SearchJob {
    pub(in crate::spatial_scene::navigation) fn file_source(&self) -> (Transform2D, HeightSpan) {
        self.original
    }
    pub(in crate::spatial_scene::navigation) fn validate_file_combat(
        &self,
        search: &Search,
        scene: Option<&SpatialScene>,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            original: _,
            start: _,
            goal: _,
            offset: _,
            origin: _,
            grids: _,
            grids_ready: _,
            grid: _,
            xy: _,
            ring: _,
            direct: _,
            initialized: _,
            start_index: _,
            goal_index: _,
            edge: _,
            operations: _,
            yielded: _,
            large_slice: _,
        } = self;
        b.work(40)?;
        b.vector(&self.grids)?;
        require(
            finite(&[
                self.original.0.x,
                self.original.0.y,
                self.offset.x,
                self.offset.y,
            ]) && span(self.original.1)
                && self.origin.iter().all(|v| v.is_finite()),
            "search_job",
            "coordinates",
            0,
            Problem::Number,
        )?;
        waypoint(self.start, scene, b)?;
        waypoint(self.goal, scene, b)?;
        require(
            self.grids.len() <= 256
                && self.grid <= self.grids.len()
                && self.ring <= 8
                && self.yielded.is_none_or(|v| v <= self.operations),
            "search_job",
            "progress",
            0,
            Problem::Range,
        )?;
        require(
            self.grids_ready || self.grids.is_empty() && self.grid == 0 && self.xy.is_none(),
            "search_job",
            "grids_ready",
            0,
            Problem::Layout,
        )?;
        b.product(self.grids.len(), 12)?;
        for (i, g) in self.grids.iter().enumerate() {
            let Grid {
                surface: _,
                range: _,
            } = g;
            let [x, y, x1, y1] = g.range;
            let n =
                (i64::from(x1) - i64::from(x) + 1).checked_mul(i64::from(y1) - i64::from(y) + 1);
            require(
                g.surface < 256
                    && x <= x1
                    && y <= y1
                    && g.range
                        .iter()
                        .all(|v| i64::from(*v).abs() <= i64::from(i32::MAX - 2))
                    && n.is_some_and(|n| (1..=MAX_NODES as i64).contains(&n))
                    && (i == 0 || self.grids[i - 1].surface < g.surface),
                "search_job",
                "grid",
                i,
                Problem::Layout,
            )?;
            if let Some(s) = scene {
                require(
                    s.surfaces.get(g.surface).is_some_and(|s| s.walkable),
                    "search_job",
                    "surface",
                    i,
                    Problem::Reference,
                )?;
            }
        }
        if let Some((x, y)) = self.xy {
            require(
                self.grids.get(self.grid).is_some_and(|g| {
                    x >= g.range[0] && x <= g.range[2] && y >= g.range[1] && y <= g.range[3]
                }),
                "search_job",
                "xy",
                0,
                Problem::Reference,
            )?;
        }
        if self.initialized {
            require(
                self.goal_index == self.start_index.saturating_add(1)
                    && self.goal_index < search.nodes.len()
                    && search.nodes[self.start_index].cell.is_none()
                    && search.nodes[self.goal_index].cell.is_none(),
                "search_job",
                "indices",
                0,
                Problem::Reference,
            )?;
        } else {
            require(
                self.start_index == 0 && self.goal_index == 0 && self.edge.is_none(),
                "search_job",
                "uninitialized",
                0,
                Problem::Layout,
            )?;
        }
        if let Some((from, neighbors, cursor)) = &self.edge {
            b.work(neighbors.len())?;
            require(
                *from < search.nodes.len()
                    && search.nodes[*from].closed
                    && *cursor <= neighbors.len()
                    && neighbors.len() <= MAX_NODES + 2,
                "search_job",
                "edge",
                0,
                Problem::Reference,
            )?;
            for (i, &to) in neighbors.iter().enumerate() {
                require(
                    to < search.nodes.len(),
                    "search_job",
                    "neighbor",
                    i,
                    Problem::Reference,
                )?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    impl SearchJob {
        pub(in crate::spatial_scene::navigation) fn corrupt_file_combat_fixture(&mut self) {
            self.grid = usize::MAX;
        }
    }
}

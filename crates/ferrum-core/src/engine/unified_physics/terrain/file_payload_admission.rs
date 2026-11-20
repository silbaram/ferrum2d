use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
use crate::physics3d::{BodyKind, BodyPrototype, PhysicsWorld3d};
impl Wanted {
    fn validate_file_payload(&self, physics: &PhysicsWorld3d, b: &mut Budget) -> Result<(), Error> {
        let Self {
            group: _,
            blocking: _,
            tile_columns: _,
            desc: _,
            layer: _,
            tile: _,
        } = self;
        let TerrainDesc {
            body: _,
            collider: _,
            span: _,
            one_way: _,
        } = &self.desc;
        b.work(19)?;
        require(
            self.group.valid(),
            "runtime_terrain",
            "group_key",
            0,
            Problem::Number,
        )?;
        require(
            self.blocking <= 7,
            "runtime_terrain",
            "blocking",
            0,
            Problem::Layout,
        )?;
        let space = physics.config().space;
        BodyPrototype::validate_file_body_desc(&self.desc.body, space, b)?;
        require(
            matches!(
                self.desc.body.kind,
                BodyKind::Fixed | BodyKind::KinematicPosition
            ),
            "runtime_terrain",
            "body_kind",
            0,
            Problem::Layout,
        )?;
        BodyPrototype::validate_file_collider_desc(&self.desc.collider, space, b)?;
        b.work(24)?;
        require(
            self.desc.span.is_none_or(|s| s.valid()),
            "runtime_terrain",
            "span",
            0,
            Problem::Number,
        )?;
        if let Some(p) = self.desc.one_way {
            require(
                p.point.iter().all(|v| v.is_finite() && v.abs() <= 1e6)
                    && finite(&p.normal)
                    && (p.normal.iter().map(|v| v * v).sum::<f32>() - 1.).abs() <= 1e-4,
                "runtime_terrain",
                "one_way",
                0,
                Problem::Number,
            )?;
        }
        Ok(())
    }
}
impl Terrain {
    pub(in crate::engine::unified_physics) fn validate_file_payload(
        &self,
        physics: &PhysicsWorld3d,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            groups: _,
            revision: _,
            pending_revision: _,
            pending_sources: _,
            pending_groups: _,
            pending: _,
            registered: _,
            by_collider: _,
        } = self;
        b.work(8)?;
        b.vector(&self.pending_sources)?;
        b.vector(&self.pending_groups)?;
        require(
            self.pending_sources.len() <= physics.config().max_colliders
                && self.pending_groups.len() <= physics.config().max_colliders,
            "runtime_terrain",
            "pending_lengths",
            0,
            Problem::Length,
        )?;
        b.product(self.pending_sources.len(), 12)?;
        b.product(self.pending_groups.len(), 9)?;
        b.product(self.groups.len(), 9)?;
        require(
            self.pending_sources.iter().all(|(_, g)| g.valid())
                && self.pending_groups.iter().all(|g| g.valid())
                && self.groups.keys().all(|g| g.valid()),
            "runtime_terrain",
            "group_history",
            0,
            Problem::Number,
        )?;
        require(
            self.groups.len() <= physics.config().max_bodies
                && self.registered.len() <= physics.config().max_colliders,
            "runtime_terrain",
            "counts",
            0,
            Problem::Length,
        )?;
        b.product(self.registered.len(), 6)?;
        b.product(self.by_collider.len(), 5)?;
        for r in self.registered.values() {
            let Registered {
                wanted: _,
                body: _,
                collider: _,
            } = r;
            r.wanted.validate_file_payload(physics, b)?;
        }
        if let Some(pending) = &self.pending {
            b.work(self.pending_sources.len() + self.pending_groups.len())?;
            require(
                self.pending_sources.windows(2).all(|w| w[0].0 < w[1].0)
                    && self.pending_groups.windows(2).all(|w| w[0] < w[1])
                    && self.pending_groups.len() <= physics.config().max_bodies,
                "runtime_terrain",
                "pending_order",
                0,
                Problem::Layout,
            )?;
            let mut groups = b.reserve::<Group>(self.pending_sources.len())?;
            for &(source, group) in &self.pending_sources {
                b.work((usize::BITS - pending.len().leading_zeros()) as usize)?;
                b.work((usize::BITS - self.registered.len().leading_zeros()) as usize)?;
                let w = pending
                    .get(&source)
                    .or_else(|| self.registered.get(&source).map(|r| &r.wanted));
                require(
                    w.is_some_and(|w| w.group == group && w.file_matches_origin(source)),
                    "runtime_terrain",
                    "pending_source",
                    0,
                    Problem::Layout,
                )?;
                groups.push(group);
            }
            b.sort(groups.len())?;
            groups.sort_unstable();
            groups.dedup();
            b.work(groups.len())?;
            require(
                groups == self.pending_groups,
                "runtime_terrain",
                "pending_groups",
                0,
                Problem::Layout,
            )?;
            b.product(pending.len(), 4)?;
            for (source, w) in pending {
                b.work((usize::BITS - self.pending_sources.len().leading_zeros()) as usize)?;
                require(
                    self.pending_sources
                        .binary_search_by_key(source, |(s, _)| *s)
                        .ok()
                        .is_some_and(|i| self.pending_sources[i].1 == w.group),
                    "runtime_terrain",
                    "change_source",
                    0,
                    Problem::Layout,
                )?;
                w.validate_file_payload(physics, b)?;
            }
        }
        // Revision dirtiness and stale wanted pose/shape are producer-owned history.
        Ok(())
    }
}

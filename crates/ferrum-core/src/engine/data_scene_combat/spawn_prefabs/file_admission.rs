use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
impl SpawnPrefabs {
    pub(in crate::engine) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            definitions: _,
            actors: _,
            lineage: _,
            next_serial: _,
            projectile_sources: _,
        } = self;
        b.work(5)?;
        b.vector(&self.definitions)?;
        b.vector(&self.actors)?;
        b.vector(&self.lineage)?;
        b.vector(&self.projectile_sources)?;
        require(
            self.definitions.len() <= MAX_ACTOR_PREFABS
                && self.actors.len() <= MAX_RECORDS
                && self.lineage.len() == MAX_COMBAT_ENTITIES
                && self.projectile_sources.len() <= MAX_PROJECTILES,
            "spawn_prefabs",
            "lengths",
            0,
            Problem::Length,
        )?;
        for (i, p) in self.definitions.iter().enumerate() {
            let ActorPrefab {
                id: _,
                prototype: _,
                billboard: _,
                physics: _,
                segments: _,
            } = p;
            b.work(5)?;
            require(
                p.id != 0 && (i == 0 || self.definitions[i - 1].id < p.id),
                "spawn_prefabs",
                "definitions",
                i,
                Problem::Order,
            )?;
            p.prototype.validate_file(b)?;
            b.work(16)?;
            require(
                p.billboard
                    .is_none_or(crate::spatial_scene::file_admission::billboard),
                "spawn_prefabs",
                "billboard",
                i,
                Problem::Number,
            )?;
            let native = p
                .physics
                .as_ref()
                .map_or(Ok(1), |v| v.validate_file_definition(b))?;
            let legacy = p.prototype.file_collision_work(b)?;
            require(
                p.segments == legacy.max(native),
                "spawn_prefabs",
                "segments",
                i,
                Problem::Layout,
            )?;
        }
        // Bounded binary-search catalog lookups are charged before each scan.
        b.product(self.actors.len(), 32)?;
        for (i, a) in self.actors.iter().enumerate() {
            let SpawnedActor {
                entity: _,
                serial: _,
                prefab: _,
                origin: _,
            } = a;
            require(
                (a.entity.id as usize) < MAX_COMBAT_ENTITIES
                    && a.serial > 0
                    && a.serial <= self.next_serial
                    && (i == 0 || self.actors[i - 1].serial < a.serial)
                    && self.definition(a.prefab).is_some()
                    && finite(&[a.origin.x, a.origin.y]),
                "spawn_prefabs",
                "actor",
                i,
                Problem::Reference,
            )?;
        }
        // A referenced dead actor can coexist with a newer generation at the same
        // arena index. Only each occupied lineage slot needs its own matching row.
        b.product(self.lineage.len(), self.actors.len().saturating_add(1))?;
        for (i, slot) in self.lineage.iter().enumerate() {
            if let Some((generation, prefab)) = slot {
                require(
                    self.actors.iter().any(|a| {
                        a.entity.id as usize == i
                            && a.entity.generation == *generation
                            && a.prefab == *prefab
                    }),
                    "spawn_prefabs",
                    "lineage",
                    i,
                    Problem::Reference,
                )?;
            }
        }
        b.product(self.projectile_sources.len(), 2)?;
        for (i, e) in self.projectile_sources.iter().enumerate() {
            require(
                i == 0
                    || (
                        self.projectile_sources[i - 1].id,
                        self.projectile_sources[i - 1].generation,
                    ) <= (e.id, e.generation),
                "spawn_prefabs",
                "projectile_sources",
                i,
                Problem::Order,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    impl SpawnPrefabs {
        pub(in crate::engine) fn corrupt_file_fixture(&mut self, case: u32) {
            match case {
                12 => self.definitions[0].segments = self.definitions[0].segments.wrapping_add(1),
                13 => self.definitions[0]
                    .prototype
                    .corrupt_file_prototype_fixture(),
                14 => self.lineage[0] = Some((u32::MAX, 1)),
                15 => self.definitions[0].id = 0,
                _ => unreachable!(),
            }
        }
    }
}

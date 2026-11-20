use super::*;
use crate::engine::file_data_gameplay_admission::unique_entities;
use crate::gameplay::file_admission::{self as f, finite, require, Budget, Error, Problem};
impl DataSceneCombat {
    pub(in crate::engine) fn validate_file(
        &self,
        world: &World,
        scene: &SpatialScene,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            enabled: _,
            queue: _,
            scratch: _,
            pairs: _,
            contacts: _,
            marked: _,
            pending: _,
            area_hits: _,
            projectiles: _,
            prefabs: _,
            navigation: _,
            actions: _,
            spawn_prefabs: _,
            moved_velocities: _,
            stats: _,
            checkpoint_authored: _,
        } = self;
        b.work(16)?;
        // Structural queue bounds are fixed by this owner; individual raw commands
        // can outlive actor deletion or intentionally report a missing action.
        self.queue
            .validate_file(b, MAX_TRIGGERS, true, f::action_command)?;
        let used = self
            .scratch
            .validate_file(world, b.remaining())
            .map_err(Error::from)?;
        b.nested(used)?;
        b.vector(&self.pairs)?;
        require(
            self.pairs.len() <= MAX_PAIRS,
            "data_combat",
            "pairs_len",
            0,
            Problem::Length,
        )?;
        b.product(self.pairs.len(), 4)?;
        for (i, p) in self.pairs.iter().enumerate() {
            require(
                p.a.id != p.b.id,
                "data_combat",
                "pair",
                i,
                Problem::Reference,
            )?;
        }
        self.contacts.validate_file(b, MAX_PAIRS, true)?;
        b.vector(&self.marked)?;
        b.vector(&self.pending)?;
        b.vector(&self.area_hits)?;
        b.vector(&self.projectiles)?;
        b.vector(&self.moved_velocities)?;
        b.vector(&self.checkpoint_authored)?;
        require(
            self.marked.len() == MAX_COMBAT_ENTITIES
                && self.pending.len() <= MAX_COMBAT_ENTITIES
                && self.area_hits.len() <= MAX_COMBAT_ENTITIES
                && self.projectiles.len() <= MAX_PROJECTILES
                && self.moved_velocities.len() <= MAX_ACTORS
                && self.checkpoint_authored.len() <= MAX_COMBAT_ENTITIES,
            "data_combat",
            "lengths",
            0,
            Problem::Length,
        )?;
        // marked/area_hits survive a frame or reconfiguration; pending/moved rows
        // are real stored staging and are checked even when disabled or stale.
        b.product(self.moved_velocities.len(), 4)?;
        for (i, (_, v)) in self.moved_velocities.iter().enumerate() {
            require(
                finite(&[v.vx, v.vy]),
                "data_combat",
                "moved_velocity",
                i,
                Problem::Number,
            )?;
        }
        b.product(self.projectiles.len(), 5)?;
        for (i, (shot, _, prefab)) in self.projectiles.iter().enumerate() {
            require(
                (shot.id as usize) < MAX_COMBAT_ENTITIES
                    && (*prefab == 0 || self.prefabs.get(*prefab).is_some()),
                "data_combat",
                "projectile",
                i,
                Problem::Reference,
            )?;
        }
        unique_entities(
            self.projectiles
                .iter()
                .map(|(e, _, _)| (e.id, e.generation)),
            b,
            "data_combat",
            "projectile_ids",
        )?;
        self.prefabs.validate_file(b)?;
        self.navigation.validate_file(scene, b)?;
        self.actions.validate_file(world, scene, b)?;
        self.spawn_prefabs.validate_file(b)?;
        b.work(9)?; // raw gauges and saturating counters: do not resample/recompute.
        unique_entities(
            self.checkpoint_authored.iter().map(|d| d.file_entity_key()),
            b,
            "data_combat",
            "authored_ids",
        )?;
        for definition in &self.checkpoint_authored {
            definition.validate_file(b)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    impl DataSceneCombat {
        pub(in crate::engine) fn corrupt_file_fixture(&mut self, case: u32) {
            let e = Entity {
                id: 0,
                generation: 0,
            };
            match case {
                0 => {
                    self.marked.pop();
                }
                1 => {
                    self.pairs.push(CollisionPair { a: e, b: e });
                }
                2 => self.moved_velocities.push((
                    e,
                    Velocity {
                        vx: f32::NAN,
                        vy: 0.,
                    },
                )),
                3 => {
                    self.projectiles.extend([(e, e, 0), (e, e, 0)]);
                }
                4..=8 => self.navigation.corrupt_file_fixture(case),
                9..=11 => self.actions.corrupt_file_fixture(case),
                12..=15 => self.spawn_prefabs.corrupt_file_fixture(case),
                16..=17 => self.checkpoint_authored[0].corrupt_file_fixture(case),
                19 => self.pending.resize(MAX_COMBAT_ENTITIES + 1, e),
                20 => self.prefabs.corrupt_file_fixture(case),
                _ => unreachable!(),
            }
        }
    }
}

use super::*;
use crate::engine::file_data_gameplay_admission::unique_entities;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
use crate::spatial_scene::file_admission::span;
impl CombatNavigation {
    pub(in crate::engine) fn validate_file(
        &self,
        scene: &SpatialScene,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            config: _,
            agents: _,
            scratch: _,
            cursor: _,
            used: _,
            searched: _,
            started: _,
            stats: _,
            bindings: _,
            peers: _,
            crowd_stats: _,
            pending_search: _,
            shared_routes: _,
            scheduler_stats: _,
            job_work: _,
            native: _,
        } = self;
        b.work(34)?;
        b.vector(&self.agents)?;
        b.vector(&self.peers)?;
        b.vector(&self.shared_routes)?;
        require(
            self.agents.len() <= 64
                && self.peers.len() <= 64
                && self.shared_routes.len() <= 8
                && self.bindings.len() <= 64,
            "combat_navigation",
            "lengths",
            0,
            Problem::Length,
        )?;
        if let Some(c) = self.config {
            let Config {
                cell: _,
                step: _,
                drop: _,
                interval: _,
                radius: _,
                agents: _,
                avoidance: _,
                precise_stop: _,
                all_patterns: _,
                native: _,
            } = c;
            b.work(12)?;
            require(
                finite(&[c.cell, c.step, c.drop, c.interval, c.radius])
                    && c.cell > 0.
                    && c.cell <= 4096.
                    && (0. ..=65536.).contains(&c.step)
                    && (0. ..=65536.).contains(&c.drop)
                    && (0.05..=60.).contains(&c.interval)
                    && (0. ..=4096.).contains(&c.radius)
                    && (1..=64).contains(&c.agents)
                    && c.avoidance
                        .is_none_or(|v| v.is_finite() && (0. ..=4096.).contains(&v)),
                "combat_navigation",
                "config",
                0,
                Problem::Number,
            )?;
        }
        unique_entities(
            self.agents
                .iter()
                .map(|a| (a.entity.id, a.entity.generation)),
            b,
            "combat_navigation",
            "agents",
        )?;
        for (i, a) in self.agents.iter().enumerate() {
            let Agent {
                entity: _,
                target: _,
                goal: _,
                span: _,
                speed: _,
                cooldown: _,
                revision: _,
                route: _,
                at_rest: _,
                previous_velocity: _,
                pattern: _,
            } = a;
            b.work(64)?;
            require(
                finite(&[
                    a.goal.x,
                    a.goal.y,
                    a.speed,
                    a.cooldown,
                    a.previous_velocity.vx,
                    a.previous_velocity.vy,
                ]) && a.speed >= 0.
                    && a.cooldown >= 0.
                    && a.span.is_none_or(span)
                    && a.at_rest
                        .is_none_or(|(p, h)| finite(&[p.x, p.y]) && span(h))
                    && a.pattern
                        .is_none_or(crate::components::gameplay::file_payload::movement),
                "combat_navigation",
                "agent",
                i,
                Problem::Number,
            )?;
            require(
                a.route.file_actor().is_none_or(|e| e == a.entity),
                "combat_navigation",
                "route_actor",
                i,
                Problem::Reference,
            )?;
            a.route.validate_file_combat(
                (a.revision == scene.navigation_revision).then_some(scene),
                b,
            )?;
        }
        b.product(self.bindings.len(), 4)?;
        for (i, (_, v)) in self.bindings.iter().enumerate() {
            require(
                v.is_finite() && (0. ..=4096.).contains(v),
                "combat_navigation",
                "binding",
                i,
                Problem::Number,
            )?;
        }
        b.product(self.peers.len(), 2)?;
        require(
            self.peers.len() == self.agents.len()
                && self
                    .peers
                    .iter()
                    .zip(&self.agents)
                    .all(|(p, a)| *p == a.entity),
            "combat_navigation",
            "peers",
            0,
            Problem::Reference,
        )?;
        // Peers and search owners can remain after an actor is removed and before a
        // budget-deferred cancellation. Never force them to the current World roster.
        let current = self
            .pending_search
            .as_ref()
            .is_some_and(|p| p.key.file_revision() == scene.navigation_revision)
            .then_some(scene);
        self.scratch.validate_file_combat(current, b)?;
        require(
            self.pending_search.is_some() == self.scratch.file_job_source().is_some(),
            "combat_navigation",
            "pending",
            0,
            Problem::Reference,
        )?;
        if let Some(p) = &self.pending_search {
            let PendingSearch {
                entity: _,
                key: _,
                source: _,
            } = p;
            b.work(10)?;
            p.key.validate_file_combat(b)?;
            require(
                finite(&[p.source.0.x, p.source.0.y])
                    && span(p.source.1)
                    && self.scratch.file_job_source() == Some(p.source),
                "combat_navigation",
                "pending_source",
                0,
                Problem::Reference,
            )?;
        }
        for route in &self.shared_routes {
            route.validate_file_combat(scene, b)?;
        }
        // NativeCombatNavigation has a separate controller owner guard; do not charge
        // or traverse its payload twice in the aggregate candidate allowance.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::persistence;
    use serde::ser::SerializeMap;
    struct Raw<'a, K, V>(&'a [(K, V)]);
    impl<K: serde::Serialize, V: serde::Serialize> serde::Serialize for Raw<'_, K, V> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let mut m = s.serialize_map(Some(self.0.len()))?;
            for (k, v) in self.0 {
                m.serialize_entry(k, v)?;
            }
            m.end()
        }
    }
    fn replace(original: &[u8], needle: &[u8], value: &[u8]) -> Vec<u8> {
        assert_eq!(needle.len(), value.len());
        let matches: Vec<_> = original[32..]
            .windows(needle.len())
            .enumerate()
            .filter_map(|(i, v)| (v == needle).then_some(i + 32))
            .collect();
        assert_eq!(matches.len(), 1);
        let mut out = original.to_vec();
        out[matches[0]..matches[0] + needle.len()].copy_from_slice(value);
        let mut crc = !0u32;
        for byte in &out[32..] {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
            }
        }
        out[24..28].copy_from_slice(&(!crc).to_le_bytes());
        out
    }
    fn damaged() -> (Vec<u8>, Vec<u8>) {
        let mut e = Engine::new();
        let nav = &mut e.data_scene.gameplay.combat.navigation;
        nav.bindings.insert((17, 23), 17.25);
        nav.bindings.insert((31, 47), 29.5);
        let canonical = crate::checkpoint_codec::encode(&nav.bindings).unwrap();
        let before = persistence::encode(&e).unwrap();
        let raw = crate::checkpoint_codec::encode(&Raw(&[
            ((17u32, 23u32), 17.25f32),
            ((17u32, 23u32), 29.5f32),
        ]))
        .unwrap();
        let malformed = replace(&before, &canonical[32..], &raw[32..]);
        (before, malformed)
    }
    #[test]
    fn file_data_gameplay_actual_engine_crc_map_duplicate_rejects_before_insertion() {
        let (before, malformed) = damaged();
        let preserved = malformed.clone();
        assert!(persistence::decode(&malformed).is_err());
        assert_eq!(malformed, preserved);
        assert_ne!(before, malformed);
        assert_eq!(
            persistence::encode(&persistence::decode(&before).unwrap()).unwrap(),
            before
        );
    }
}

#[cfg(test)]
mod damage {
    use super::*;
    impl CombatNavigation {
        pub(in crate::engine) fn corrupt_file_fixture(&mut self, case: u32) {
            match case {
                4 => self.config.as_mut().unwrap().cell = f32::NAN,
                5 => self.agents[0].goal.x = f32::NAN,
                6 => {
                    self.bindings.insert((1, 0), f32::NAN);
                }
                7..=8 => self.scratch.corrupt_file_combat_fixture(case),
                _ => unreachable!(),
            }
        }
    }
}

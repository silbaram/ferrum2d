use super::*;
use crate::components::gameplay::file_payload as payload;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
fn prepared(p: PreparedAction, dash: bool, b: &mut Budget) -> Result<(), Error> {
    b.work(32)?;
    require(
        p.action_id != 0
            && p.action_id == p.binding.action_id
            && p.kind.matches(p.binding.pattern)
            && matches!(
                (dash, p.binding.pattern),
                (true, ActionPattern::Dash { .. }) | (false, ActionPattern::Melee { .. })
            )
            && payload::action(p.binding.pattern)
            && payload::cooldown(p.binding.cooldown),
        "combat_actions",
        "prepared",
        0,
        Problem::Layout,
    )
}
impl CombatActions {
    pub(in crate::engine) fn validate_file(
        &self,
        world: &World,
        _scene: &SpatialScene,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            pending_dashes: _,
            pending_melee: _,
            melee_hits: _,
            native_melee_hits: _,
            dash_route: _,
            flat_scratch: _,
            flat_breaks: _,
            work: _,
            attempts: _,
        } = self;
        b.work(9)?;
        b.vector(&self.pending_dashes)?;
        b.vector(&self.pending_melee)?;
        b.vector(&self.melee_hits)?;
        b.vector(&self.native_melee_hits)?;
        b.vector(&self.flat_breaks)?;
        require(
            self.pending_dashes.len() <= MAX_ACTIONS
                && self.pending_melee.len() <= MAX_ACTIONS
                && self.attempts <= MAX_ACTIONS
                && self.melee_hits.len() <= MAX_COMBAT_ENTITIES
                && self.native_melee_hits.len() <= 131072
                && self.flat_breaks.len() <= MAX_ACTION_DASH_BREAKPOINTS,
            "combat_actions",
            "lengths",
            0,
            Problem::Length,
        )?;
        for p in &self.pending_dashes {
            prepared(p.prepared, true, b)?;
        }
        for p in &self.pending_melee {
            prepared(p.prepared, false, b)?;
            b.work(16)?;
            require(
                p.attack.attacker == p.prepared.entity
                    && finite(&[
                        p.attack.center.x,
                        p.attack.center.y,
                        p.attack.range,
                        p.attack.damage,
                    ])
                    && p.attack
                        .height_span
                        .is_none_or(crate::spatial_scene::file_admission::span)
                    && p.native_center.is_none_or(|v| finite(&v)),
                "combat_actions",
                "melee",
                0,
                Problem::Number,
            )?;
        }
        b.product(self.melee_hits.len(), 4)?;
        for (_, at) in &self.melee_hits {
            require(
                finite(&[at.x, at.y]),
                "combat_actions",
                "melee_hit",
                0,
                Problem::Number,
            )?;
        }
        // A native resolution may fail after prefix compaction; old suffix duplicates
        // and order are valid history. Fixture/entity liveness is checked on use.
        for h in &self.native_melee_hits {
            h.validate_file(b)?;
        }
        self.dash_route.validate_file_combat(None, b)?;
        b.nested(
            self.flat_scratch
                .validate_file(world, b.remaining())
                .map_err(Error::from)?,
        )?;
        b.work(self.flat_breaks.len())?;
        require(
            self.flat_breaks.is_empty()
                || self.flat_breaks.len() >= 2
                    && self.flat_breaks[0] == 0.
                    && self.flat_breaks.contains(&1.),
            "combat_actions",
            "breakpoints",
            0,
            Problem::Layout,
        )?;
        // Subdivision can return false before sort/dedup. Preserve that pending prefix.
        for (i, &v) in self.flat_breaks.iter().enumerate() {
            require(
                v.is_finite() && (0. ..=1.).contains(&v),
                "combat_actions",
                "breakpoint",
                i,
                Problem::Number,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    impl CombatActions {
        pub(in crate::engine) fn corrupt_file_fixture(&mut self, case: u32) {
            match case {
                9 => self.flat_breaks.extend([0., 1., f64::NAN]),
                10 => self.attempts = MAX_ACTIONS + 1,
                11 => self
                    .native_melee_hits
                    .push(NativeMeleeHit::invalid_file_fixture()),
                _ => unreachable!(),
            }
        }
    }
}

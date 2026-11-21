use super::*;
use crate::engine::file_builtin_scenes_admission::{
    entity, entity_history, finite, hit, require, Budget, Error, Problem, Usage,
};
use crate::gameplay::file_admission::action_command;
use crate::world::World;
impl ShooterScene {
    pub(crate) fn validate_file(&self, w: &World, b: &mut Budget) -> Result<(), Error> {
        let Self {
            score: _,
            fire_cooldown_seconds: _,
            enemy_spawn_timer: _,
            previous_space: _,
            previous_enter: _,
            previous_mouse_left: _,
            previous_input: _,
            game_state: _,
            spawn_index: _,
            texture_ids: _,
            sound_ids: _,
            config: _,
            waves: _,
            wave_action_triggers: _,
            active_wave_index: _,
            wave_elapsed_seconds: _,
            wave_spawned_count: _,
            camera_elapsed_seconds: _,
            navigation_targets: _,
            navigation_scratch: _,
            collision_scratch: _,
            collision_pairs: _,
            authored_collision_contacts: _,
            last_action_trigger_phase_result: _,
            last_spawn_flush_result: _,
            melee_hits: _,
            area_damage_hits: _,
            spawn_obstacle_contacts: _,
            action_triggers: _,
            action_trigger_commands: _,
            pending_spawns: _,
            spawn_commands: _,
            pending_melee_attacks: _,
            melee_attack_commands: _,
            pending_despawn: _,
            marked_for_despawn: _,
            bounced_projectiles_this_frame: _,
            last_collision_pair_stats: _,
        } = self;
        // Includes fixed input/config-id/counter/diagnostic array headers. Integer
        // counters and source wrapping/saturating histories are not recomputed.
        b.work(160)?;
        require(
            finite(&[
                self.fire_cooldown_seconds,
                self.enemy_spawn_timer,
                self.wave_elapsed_seconds,
                self.camera_elapsed_seconds,
                self.previous_input.mouse_x,
                self.previous_input.mouse_y,
            ]) && self.fire_cooldown_seconds >= 0.
                && self.wave_elapsed_seconds >= 0.
                && self.camera_elapsed_seconds >= 0.,
            "builtin_shooter",
            "timers_input",
            0,
            Problem::Number,
        )?;
        // Preserve raw u8 history from the direct (test-only) Scene producer;
        // the release Engine setter and snapshot-restore paths normalize separately.
        require(
            self.previous_space == self.previous_input.space
                && self.previous_enter == self.previous_input.enter
                && self.previous_mouse_left == self.previous_input.mouse_left,
            "builtin_shooter",
            "input_history",
            0,
            Problem::History,
        )?;
        self.config.validate_file(b)?;
        b.vector(&self.waves)?;
        b.vector(&self.wave_action_triggers)?;
        require(
            (self.waves.is_empty() && self.active_wave_index == 0
                || self.active_wave_index < self.waves.len())
                && self.wave_action_triggers.len() <= self.waves.len(),
            "builtin_shooter",
            "waves",
            0,
            Problem::Reference,
        )?;
        b.product(self.waves.len(), 8)?;
        for (i, v) in self.waves.iter().enumerate() {
            require(
                [v.duration, v.spawn_interval, v.enemy_speed, v.enemy_health]
                    .iter()
                    .all(|x| x.is_finite() && *x > 0.)
                    && v.enemy_count > 0
                    && v.score_reward > 0,
                "builtin_shooter",
                "wave",
                i,
                Problem::Number,
            )?;
        }
        for (i, v) in self.wave_action_triggers.iter().enumerate() {
            if let Some(v) = v {
                require(
                    v.action_id > 0 && entity_history(w, v.source),
                    "builtin_shooter",
                    "wave_trigger",
                    i,
                    Problem::Reference,
                )?;
            }
        }
        // Public legacy snapshot restore can retain any u32 wave_spawned_count;
        // do not tie that history to the current wave's configured enemy count.
        b.vector(&self.navigation_targets)?;
        require(
            self.navigation_targets.len() <= w.entity_capacity(),
            "builtin_shooter",
            "navigation_targets",
            0,
            Problem::Length,
        )?;
        for v in self.navigation_targets.iter().flatten() {
            v.validate_file(b)?;
        }
        let mut nav =
            crate::tilemap::file_admission::Budget::new(crate::tilemap::file_admission::Limits {
                max_work: b.remaining().max_work,
                max_scratch_bytes: b.remaining().max_scratch_bytes,
            });
        self.navigation_scratch.validate_file(&mut nav)?;
        b.nested(Usage {
            work: nav.usage.work,
            scratch_bytes: nav.usage.scratch_bytes,
        })?;
        let mut collision = crate::collision::file_scratch_admission::Budget::new(b.remaining());
        self.collision_scratch
            .validate_file_with_budget(&mut collision)
            .map_err(crate::gameplay::file_admission::Error::from)?;
        b.nested(collision.usage)?;
        b.vector(&self.collision_pairs)?;
        for (i, v) in self.collision_pairs.iter().enumerate() {
            require(
                v.a.id != v.b.id && entity_history(w, v.a) && entity_history(w, v.b),
                "builtin_shooter",
                "collision_pairs",
                i,
                Problem::Reference,
            )?;
        }
        self.authored_collision_contacts
            .validate_file(b, MAX_AUTHORED_COLLISION_CONTACTS, true)?;
        self.action_triggers
            .validate_file(b, 64, true, action_command)?;
        b.vector(&self.action_trigger_commands)?;
        for v in &self.action_trigger_commands {
            action_command(v, b)?;
        }
        for values in [&self.melee_hits, &self.area_damage_hits] {
            b.vector(values)?;
            for (i, h) in values.iter().enumerate() {
                entity(w, h.entity, "builtin_shooter", "query_hits", i)?;
            }
        }
        b.vector(&self.spawn_obstacle_contacts)?;
        for (i, v) in self.spawn_obstacle_contacts.iter().enumerate() {
            hit(v, b, "builtin_shooter", i)?;
        }
        for values in [&self.pending_spawns, &self.spawn_commands] {
            b.vector(values)?;
            require(
                values.len() <= 64,
                "builtin_shooter",
                "spawn_queue",
                0,
                Problem::Length,
            )?;
            for (i, v) in values.iter().enumerate() {
                v.validate_file(w, b, i)?;
            }
        }
        for values in [&self.pending_melee_attacks, &self.melee_attack_commands] {
            b.vector(values)?;
            for (i, v) in values.iter().enumerate() {
                b.work(12)?;
                require(
                    entity_history(w, v.attacker)
                        && finite(&[v.center.x, v.center.y, v.range, v.damage])
                        && v.height_span
                            .is_none_or(crate::collision::file_scratch_admission::span),
                    "builtin_shooter",
                    "melee_command",
                    i,
                    Problem::Number,
                )?;
            }
        }
        b.vector(&self.pending_despawn)?;
        b.vector(&self.marked_for_despawn)?;
        b.vector(&self.bounced_projectiles_this_frame)?;
        require(
            self.marked_for_despawn.len() <= w.entity_capacity()
                && self.bounced_projectiles_this_frame.len() <= w.entity_capacity(),
            "builtin_shooter",
            "entity_flags",
            0,
            Problem::Length,
        )?;
        for (i, &v) in self.pending_despawn.iter().enumerate() {
            entity(w, v, "builtin_shooter", "pending_despawn", i)?;
        }
        require(
            self.last_action_trigger_phase_result
                .last_prepared_dispatch_failure_reason_code
                .is_none_or(|v| {
                    v <= crate::gameplay_event::GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE
                }),
            "builtin_shooter",
            "failure_code",
            0,
            Problem::Range,
        )?;
        Ok(())
    }
}

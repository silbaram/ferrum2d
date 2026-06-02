use super::super::Engine;

use crate::gameplay_event::GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE;

pub(crate) const FRAME_TELEMETRY_ACTION_TRIGGER_ATTEMPTS: usize = 37;
pub(crate) const FRAME_TELEMETRY_ACTION_TRIGGER_FAILURES: usize = 38;
pub(crate) const FRAME_TELEMETRY_ACTION_TRIGGER_FAILURE_EVENTS_PUSHED: usize = 39;
pub(crate) const FRAME_TELEMETRY_ACTION_TRIGGER_COMMIT_SKIPS: usize = 40;
pub(crate) const FRAME_TELEMETRY_ACTION_LAST_PREPARED_TRIGGER_FAILURE_REASON_CODE: usize = 41;
pub(crate) const FRAME_TELEMETRY_ACTION_FAILURE_REASON_OFFSET: usize = 42;
const FRAME_TELEMETRY_BASE_F64S: usize = FRAME_TELEMETRY_ACTION_TRIGGER_ATTEMPTS;
pub(crate) const FRAME_TELEMETRY_ACTION_FAILURE_REASON_COUNT: usize =
    GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE as usize + 1;
pub(crate) const FRAME_TELEMETRY_SPAWN_FLUSH_COMMANDS_DRAINED: usize =
    FRAME_TELEMETRY_ACTION_FAILURE_REASON_OFFSET + FRAME_TELEMETRY_ACTION_FAILURE_REASON_COUNT;
pub(crate) const FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_SPAWNS: usize =
    FRAME_TELEMETRY_SPAWN_FLUSH_COMMANDS_DRAINED + 1;
pub(crate) const FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_ARCS_APPLIED: usize =
    FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_SPAWNS + 1;
pub(crate) const FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_SHOOT_AUDIO_EVENTS_PUSHED: usize =
    FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_ARCS_APPLIED + 1;
pub(crate) const FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNS: usize =
    FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_SHOOT_AUDIO_EVENTS_PUSHED + 1;
pub(crate) const FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_PAYLOADS: usize =
    FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNS + 1;
pub(crate) const FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_EVENTS_PUSHED: usize =
    FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_PAYLOADS + 1;
const FRAME_TELEMETRY_SPAWN_FLUSH_COUNT: usize = 7;
pub(crate) const FRAME_TELEMETRY_F64S: usize =
    FRAME_TELEMETRY_SPAWN_FLUSH_COMMANDS_DRAINED + FRAME_TELEMETRY_SPAWN_FLUSH_COUNT;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct FrameTelemetry {
    values: [f64; FRAME_TELEMETRY_F64S],
}

impl Default for FrameTelemetry {
    fn default() -> Self {
        Self {
            values: [0.0; FRAME_TELEMETRY_F64S],
        }
    }
}

impl FrameTelemetry {
    pub(crate) fn from_engine(engine: &Engine) -> Self {
        let player_height_span = engine
            .world
            .player
            .and_then(|player| engine.world.height_span(player));
        let mut values = [0.0; FRAME_TELEMETRY_F64S];
        values[..FRAME_TELEMETRY_BASE_F64S].copy_from_slice(&[
            engine.elapsed_seconds,
            engine.active_scene_score() as f64,
            engine.world.alive_count() as f64,
            engine.active_scene_game_state_code() as f64,
            engine.render_commands.len() as f64,
            engine.camera.x as f64,
            engine.camera.y as f64,
            if engine.fixed_timestep_enabled {
                1.0
            } else {
                0.0
            },
            engine.physics_counters.fixed_steps as f64,
            engine.last_fixed_update.alpha as f64,
            engine.last_fixed_update.consumed_seconds as f64,
            engine.last_fixed_update.dropped_seconds as f64,
            engine.physics_counters.kinematic_moves as f64,
            engine.physics_counters.kinematic_hits as f64,
            engine.physics_counters.kinematic_entity_hits as f64,
            engine.physics_counters.kinematic_tile_hits as f64,
            engine.physics_counters.solid_candidate_checks as f64,
            engine.physics_counters.tile_candidate_checks as f64,
            engine.physics_counters.hd2d_filtered_entity_candidates as f64,
            engine.physics_counters.hd2d_filtered_tile_candidates as f64,
            engine.physics_counters.collision_pairs as f64,
            engine.physics_counters.collision_solid_pairs as f64,
            engine.physics_counters.collision_trigger_pairs as f64,
            engine.collision_event_counts.enter as f64,
            engine.collision_event_counts.stay as f64,
            engine.collision_event_counts.exit as f64,
            engine.collision_event_counts.hit as f64,
            engine.collision_event_counts.trigger_enter as f64,
            engine.collision_event_counts.trigger_stay as f64,
            engine.collision_event_counts.trigger_exit as f64,
            engine.rigid_body_step_stats.ccd_checks as f64,
            engine.rigid_body_step_stats.ccd_hits as f64,
            engine.rigid_body_step_stats.sleeping_bodies as f64,
            engine.rigid_body_step_stats.broken_joints as f64,
            player_height_span.map_or(f64::NAN, |span| span.floor.0 as f64),
            player_height_span.map_or(f64::NAN, |span| span.elevation as f64),
            player_height_span.map_or(f64::NAN, |span| span.height as f64),
        ]);
        values[FRAME_TELEMETRY_ACTION_TRIGGER_ATTEMPTS] =
            engine.active_scene_action_trigger_attempts() as f64;
        values[FRAME_TELEMETRY_ACTION_TRIGGER_FAILURES] =
            engine.active_scene_action_trigger_failures() as f64;
        values[FRAME_TELEMETRY_ACTION_TRIGGER_FAILURE_EVENTS_PUSHED] =
            engine.active_scene_action_trigger_failure_events_pushed() as f64;
        values[FRAME_TELEMETRY_ACTION_TRIGGER_COMMIT_SKIPS] =
            engine.active_scene_action_trigger_commit_skips() as f64;
        values[FRAME_TELEMETRY_ACTION_LAST_PREPARED_TRIGGER_FAILURE_REASON_CODE] =
            engine.active_scene_last_prepared_action_trigger_failure_reason_code() as f64;
        for reason_code in 0..=GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE {
            values[FRAME_TELEMETRY_ACTION_FAILURE_REASON_OFFSET + reason_code as usize] =
                engine.active_scene_action_trigger_failure_count_for_reason(reason_code) as f64;
        }
        values[FRAME_TELEMETRY_SPAWN_FLUSH_COMMANDS_DRAINED] =
            engine.active_scene_spawn_flush_commands_drained() as f64;
        values[FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_SPAWNS] =
            engine.active_scene_spawn_flush_projectile_spawns() as f64;
        values[FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_ARCS_APPLIED] =
            engine.active_scene_spawn_flush_projectile_arcs_applied() as f64;
        values[FRAME_TELEMETRY_SPAWN_FLUSH_PROJECTILE_SHOOT_AUDIO_EVENTS_PUSHED] =
            engine.active_scene_spawn_flush_projectile_shoot_audio_events_pushed() as f64;
        values[FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNS] =
            engine.active_scene_spawn_flush_prefab_spawns() as f64;
        values[FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_PAYLOADS] =
            engine.active_scene_spawn_flush_prefab_spawned_payloads() as f64;
        values[FRAME_TELEMETRY_SPAWN_FLUSH_PREFAB_SPAWNED_EVENTS_PUSHED] =
            engine.active_scene_spawn_flush_prefab_spawned_events_pushed() as f64;
        Self { values }
    }

    pub(crate) fn as_ptr(&self) -> *const f64 {
        self.values.as_ptr()
    }
}

impl Engine {
    pub(in crate::engine) fn write_frame_telemetry(&mut self) {
        let telemetry = FrameTelemetry::from_engine(self);
        self.frame_telemetry = telemetry;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_telemetry_abi_is_plain_f64_buffer() {
        assert_eq!(
            std::mem::size_of::<FrameTelemetry>(),
            FRAME_TELEMETRY_F64S * std::mem::size_of::<f64>(),
        );
        assert_eq!(
            std::mem::align_of::<FrameTelemetry>(),
            std::mem::align_of::<f64>(),
        );
    }
}

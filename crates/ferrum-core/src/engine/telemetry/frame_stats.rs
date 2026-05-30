use super::super::Engine;

pub(crate) const FRAME_TELEMETRY_F64S: usize = 37;

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
        let values = [
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
        ];
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

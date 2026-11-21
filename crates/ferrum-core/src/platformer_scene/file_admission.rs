use super::*;
use crate::engine::file_builtin_scenes_admission::{
    entity, finite, require, Budget, Error, Problem,
};
impl PlatformerScene {
    pub(crate) fn validate_file(&self, w: &World, b: &mut Budget) -> Result<(), Error> {
        let Self {
            game_state: _,
            score: _,
            elapsed_play_seconds: _,
            player: _,
            moving_platform: _,
            controller_state: _,
            moving_platform_phase: _,
            jump_was_down: _,
            player_was_grounded: _,
        } = self;
        b.work(11)?;
        require(
            finite(&[
                self.elapsed_play_seconds,
                self.moving_platform_phase,
                self.controller_state.coyote_time_remaining,
                self.controller_state.jump_buffer_remaining,
            ]) && self.elapsed_play_seconds >= 0.
                && (0. ..=TAU).contains(&self.moving_platform_phase)
                && self.controller_state.coyote_time_remaining >= 0.
                && self.controller_state.jump_buffer_remaining >= 0.,
            "builtin_platformer",
            "timers",
            0,
            Problem::Number,
        )?;
        require(
            self.score == self.elapsed_play_seconds.floor() as u32,
            "builtin_platformer",
            "score_clock",
            0,
            Problem::History,
        )?;
        require(
            self.player.is_some() == self.moving_platform.is_some()
                && (self.player.is_none() || self.player != self.moving_platform),
            "builtin_platformer",
            "level_entities",
            0,
            Problem::Reference,
        )?;
        for (i, &e) in self.player.iter().chain(&self.moving_platform).enumerate() {
            entity(w, e, "builtin_platformer", "level_entities", i)?;
        }
        Ok(())
    }
}

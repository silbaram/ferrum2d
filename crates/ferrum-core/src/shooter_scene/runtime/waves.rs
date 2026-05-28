use crate::world::World;

use super::super::{EnemyBehavior, EnemySpawnPattern, ShooterScene, ShooterWaveConfig};

impl ShooterScene {
    pub(in crate::shooter_scene) fn tick_playing_timers(&mut self, delta: f32) {
        if self.fire_cooldown_seconds > 0.0 {
            self.fire_cooldown_seconds = (self.fire_cooldown_seconds - delta).max(0.0);
        }
        if self.enemy_spawn_timer > 0.0 {
            self.enemy_spawn_timer -= delta;
        }
        if !self.waves.is_empty() {
            self.wave_elapsed_seconds += delta.max(0.0);
        }
    }

    pub(in crate::shooter_scene) fn reset_wave_state(&mut self) {
        self.active_wave_index = 0;
        self.wave_elapsed_seconds = 0.0;
        self.wave_spawned_count = 0;
        self.enemy_spawn_timer = self.active_spawn_interval();
    }

    pub(in crate::shooter_scene) fn advance_wave_if_needed(&mut self) {
        let Some(wave) = self.active_wave() else {
            return;
        };
        if self.wave_elapsed_seconds < wave.duration && self.wave_spawned_count < wave.enemy_count {
            return;
        }

        self.active_wave_index = (self.active_wave_index + 1) % self.waves.len();
        self.wave_elapsed_seconds = 0.0;
        self.wave_spawned_count = 0;
        self.enemy_spawn_timer = self.active_spawn_interval();
    }

    fn active_wave(&self) -> Option<ShooterWaveConfig> {
        self.waves.get(self.active_wave_index).copied()
    }

    pub(in crate::shooter_scene) fn active_spawn_interval(&self) -> f32 {
        self.active_wave()
            .map(|wave| wave.spawn_interval)
            .unwrap_or(self.config.enemy_spawn_interval)
    }

    pub(in crate::shooter_scene) fn active_enemy_speed(&self) -> f32 {
        self.active_wave()
            .map(|wave| wave.enemy_speed)
            .unwrap_or(self.config.enemy_speed)
    }

    pub(in crate::shooter_scene) fn active_enemy_behavior(&self) -> EnemyBehavior {
        self.active_wave()
            .map(|wave| wave.enemy_behavior)
            .unwrap_or(self.config.enemy_behavior)
    }

    pub(in crate::shooter_scene) fn active_enemy_spawn_pattern(&self) -> EnemySpawnPattern {
        self.active_wave()
            .map(|wave| wave.enemy_spawn_pattern)
            .unwrap_or(self.config.enemy_spawn_pattern)
    }

    pub(in crate::shooter_scene) fn active_enemy_health(&self) -> f32 {
        self.active_wave()
            .map(|wave| wave.enemy_health)
            .unwrap_or(self.config.enemy_health)
    }

    pub(in crate::shooter_scene) fn active_score_reward(&self) -> u32 {
        self.active_wave()
            .map(|wave| wave.score_reward)
            .unwrap_or(self.config.score_reward)
    }

    pub(in crate::shooter_scene) fn active_wave_has_spawned_all_enemies(&self) -> bool {
        self.active_wave()
            .map(|wave| self.wave_spawned_count >= wave.enemy_count)
            .unwrap_or(false)
    }

    pub(in crate::shooter_scene) fn spawn_enemy_if_needed(&mut self, world: &mut World) {
        if self.enemy_spawn_timer > 0.0 {
            return;
        }
        if self.active_wave_has_spawned_all_enemies() {
            return;
        }
        self.enemy_spawn_timer = self.active_spawn_interval();
        let idx = self.spawn_index;
        self.spawn_index = self.spawn_index.wrapping_add(1);
        let (x, y) = self.enemy_spawn_position(idx);
        world.spawn_enemy_from_template(
            x,
            y,
            self.texture_ids.enemy,
            self.config.enemy_template,
            self.active_enemy_health(),
            self.active_score_reward(),
        );
        if !self.waves.is_empty() {
            self.wave_spawned_count = self.wave_spawned_count.saturating_add(1);
        }
    }

    pub(in crate::shooter_scene) fn enemy_spawn_position(&self, idx: u32) -> (f32, f32) {
        match self.active_enemy_spawn_pattern() {
            EnemySpawnPattern::Edge => self.edge_spawn_position(idx),
            EnemySpawnPattern::Corners => self.corner_spawn_position(idx),
            EnemySpawnPattern::Center => (
                self.config.world_width * 0.5,
                self.config.world_height * 0.5,
            ),
        }
    }

    pub(in crate::shooter_scene) fn edge_spawn_position(&self, idx: u32) -> (f32, f32) {
        let lane = (idx % 6) as f32;
        match idx % 4 {
            0 => (lane * (self.config.world_width / 5.0), 0.0),
            1 => (
                self.config.world_width,
                lane * (self.config.world_height / 5.0),
            ),
            2 => (
                lane * (self.config.world_width / 5.0),
                self.config.world_height,
            ),
            _ => (0.0, lane * (self.config.world_height / 5.0)),
        }
    }

    pub(in crate::shooter_scene) fn corner_spawn_position(&self, idx: u32) -> (f32, f32) {
        match idx % 4 {
            0 => (0.0, 0.0),
            1 => (self.config.world_width, 0.0),
            2 => (self.config.world_width, self.config.world_height),
            _ => (0.0, self.config.world_height),
        }
    }
}

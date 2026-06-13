use wasm_bindgen::prelude::*;

use crate::camera::CameraPresetConfig;
use crate::shooter_scene::{
    EnemyBehavior, EnemySpawnPattern, ShooterAudioPolicy, ShooterConfig,
    ShooterProjectileArcConfig, ShooterWaveConfig,
};

use super::Engine;

mod animation;
mod colliders;

#[wasm_bindgen]
impl Engine {
    pub fn clear_shooter_waves(&mut self) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.clear_wave_configs();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_wave(
        &mut self,
        index: u32,
        duration: f32,
        spawn_interval: f32,
        enemy_count: u32,
        enemy_speed: f32,
        enemy_behavior: u32,
        enemy_spawn_pattern: u32,
        enemy_health: f32,
        score_reward: u32,
    ) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_wave_config(
            index,
            ShooterWaveConfig::from_values(
                duration,
                spawn_interval,
                enemy_count,
                enemy_speed,
                EnemyBehavior::from_code(enemy_behavior),
                EnemySpawnPattern::from_code(enemy_spawn_pattern),
                enemy_health,
                score_reward,
            ),
        );
    }

    pub fn set_shooter_wave_action_trigger(
        &mut self,
        wave_index: u32,
        source_entity_id: u32,
        source_entity_generation: u32,
        action_id: u32,
    ) -> bool {
        self.activate_built_in_shooter_scene();
        let Some(source) = self.entity_from_handle(source_entity_id, source_entity_generation)
        else {
            return false;
        };
        self.scenes
            .shooter
            .set_wave_action_trigger(&self.world, wave_index, source, action_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_audio_policy(
        &mut self,
        shoot_volume: f32,
        shoot_pitch: f32,
        hit_volume: f32,
        hit_pitch: f32,
        game_over_volume: f32,
        game_over_pitch: f32,
    ) {
        self.activate_built_in_shooter_scene();
        self.scenes
            .shooter
            .set_audio_policy(ShooterAudioPolicy::from_values(
                shoot_volume,
                shoot_pitch,
                hit_volume,
                hit_pitch,
                game_over_volume,
                game_over_pitch,
            ));
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_config(
        &mut self,
        world_width: f32,
        world_height: f32,
        player_speed: f32,
        enemy_speed: f32,
        enemy_spawn_interval: f32,
        bullet_speed: f32,
        fire_cooldown: f32,
        bullet_lifetime: f32,
    ) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_config(
            &mut self.world,
            &mut self.camera,
            &mut self.frame_buffers.audio_events,
            ShooterConfig::from_values(
                world_width,
                world_height,
                player_speed,
                enemy_speed,
                enemy_spawn_interval,
                bullet_speed,
                fire_cooldown,
                bullet_lifetime,
            ),
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_prefabs(
        &mut self,
        player_width: f32,
        player_height: f32,
        enemy_width: f32,
        enemy_height: f32,
        bullet_width: f32,
        bullet_height: f32,
    ) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_prefabs(
            &mut self.world,
            &mut self.camera,
            &mut self.frame_buffers.audio_events,
            player_width,
            player_height,
            enemy_width,
            enemy_height,
            bullet_width,
            bullet_height,
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_behavior(&mut self, enemy_behavior: u32) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_enemy_behavior(
            &mut self.world,
            &mut self.camera,
            &mut self.frame_buffers.audio_events,
            EnemyBehavior::from_code(enemy_behavior),
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_spawn_pattern(&mut self, enemy_spawn_pattern: u32) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_enemy_spawn_pattern(
            &mut self.world,
            &mut self.camera,
            &mut self.frame_buffers.audio_events,
            EnemySpawnPattern::from_code(enemy_spawn_pattern),
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_combat(&mut self, enemy_health: f32, bullet_damage: f32, score_reward: u32) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_combat(
            &mut self.world,
            &mut self.camera,
            &mut self.frame_buffers.audio_events,
            enemy_health,
            bullet_damage,
            score_reward,
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_projectile_arc(
        &mut self,
        enabled: bool,
        launch_height: f32,
        z_velocity: f32,
        gravity: f32,
        hit_height: f32,
    ) {
        self.activate_built_in_shooter_scene();
        let config = self.scenes.shooter.config().with_projectile_arc(
            ShooterProjectileArcConfig::from_values(
                enabled,
                launch_height,
                z_velocity,
                gravity,
                hit_height,
            ),
        );
        self.scenes.shooter.set_config(
            &mut self.world,
            &mut self.camera,
            &mut self.frame_buffers.audio_events,
            config,
        );
        self.clear_physics_history();
    }

    pub fn set_shooter_camera_preset(
        &mut self,
        preset: u32,
        dead_zone_width: f32,
        dead_zone_height: f32,
        look_ahead_distance: f32,
        shake_amplitude: f32,
        shake_frequency: f32,
    ) {
        self.activate_built_in_shooter_scene();
        self.scenes.shooter.set_camera_preset(
            &self.world,
            &mut self.camera,
            CameraPresetConfig::from_values(
                preset,
                dead_zone_width,
                dead_zone_height,
                look_ahead_distance,
                shake_amplitude,
                shake_frequency,
            ),
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_shooter_resolved_config(
        &mut self,
        world_width: f32,
        world_height: f32,
        player_speed: f32,
        enemy_speed: f32,
        enemy_spawn_interval: f32,
        bullet_speed: f32,
        fire_cooldown: f32,
        bullet_lifetime: f32,
        player_width: f32,
        player_height: f32,
        enemy_width: f32,
        enemy_height: f32,
        bullet_width: f32,
        bullet_height: f32,
        player_animation_frame_count: u32,
        player_animation_fps: f32,
        enemy_animation_frame_count: u32,
        enemy_animation_fps: f32,
        bullet_animation_frame_count: u32,
        bullet_animation_fps: f32,
        enemy_behavior: u32,
        enemy_spawn_pattern: u32,
        enemy_health: f32,
        bullet_damage: f32,
        score_reward: u32,
        orbit_radius: f32,
        orbit_radial_band: f32,
    ) {
        self.activate_built_in_shooter_scene();
        let config = ShooterConfig::from_values(
            world_width,
            world_height,
            player_speed,
            enemy_speed,
            enemy_spawn_interval,
            bullet_speed,
            fire_cooldown,
            bullet_lifetime,
        )
        .with_prefabs(
            player_width,
            player_height,
            enemy_width,
            enemy_height,
            bullet_width,
            bullet_height,
        )
        .with_animations(
            player_animation_frame_count,
            player_animation_fps,
            enemy_animation_frame_count,
            enemy_animation_fps,
            bullet_animation_frame_count,
            bullet_animation_fps,
        )
        .with_enemy_behavior(EnemyBehavior::from_code(enemy_behavior))
        .with_enemy_spawn_pattern(EnemySpawnPattern::from_code(enemy_spawn_pattern))
        .with_combat(enemy_health, bullet_damage, score_reward)
        .with_orbit(orbit_radius, orbit_radial_band);

        self.scenes.shooter.set_config(
            &mut self.world,
            &mut self.camera,
            &mut self.frame_buffers.audio_events,
            config,
        );
        self.clear_physics_history();
    }
}

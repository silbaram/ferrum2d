use super::*;
use crate::engine::file_builtin_scenes_admission::{
    finite, require, template, Budget, Error, Problem,
};
impl ShooterConfig {
    pub(in crate::shooter_scene) fn validate_file(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            world_width: _,
            world_height: _,
            player_speed: _,
            enemy_speed: _,
            enemy_spawn_interval: _,
            bullet_speed: _,
            fire_cooldown: _,
            bullet_lifetime: _,
            player_template: _,
            enemy_template: _,
            bullet_template: _,
            enemy_behavior: _,
            enemy_spawn_pattern: _,
            enemy_health: _,
            bullet_damage: _,
            score_reward: _,
            orbit_radius: _,
            orbit_radial_band: _,
            projectile_arc: _,
            camera: _,
            audio_policy: _,
            prefab_registry: _,
        } = self;
        b.work(64)?;
        require(
            [
                self.world_width,
                self.world_height,
                self.player_speed,
                self.enemy_speed,
                self.enemy_spawn_interval,
                self.bullet_speed,
                self.fire_cooldown,
                self.bullet_lifetime,
                self.enemy_health,
                self.bullet_damage,
                self.orbit_radius,
            ]
            .iter()
            .all(|v| v.is_finite() && *v > 0.)
                && self.orbit_radial_band.is_finite()
                && self.orbit_radial_band >= 0.
                && self.score_reward > 0,
            "builtin_shooter",
            "config_numbers",
            0,
            Problem::Range,
        )?;
        for (i, v) in [
            &self.player_template,
            &self.enemy_template,
            &self.bullet_template,
        ]
        .into_iter()
        .enumerate()
        {
            template(v, b, "builtin_shooter", i)?;
        }
        let a = self.projectile_arc;
        require(
            finite(&[a.launch_height, a.z_velocity, a.gravity, a.hit_height])
                && a.launch_height >= 0.
                && a.gravity >= 0.
                && a.hit_height >= 0.,
            "builtin_shooter",
            "arc_config",
            0,
            Problem::Number,
        )?;
        let c = self.camera;
        require(
            finite(&[
                c.dead_zone_width,
                c.dead_zone_height,
                c.look_ahead_distance,
                c.shake_amplitude,
                c.shake_frequency,
            ]) && c.dead_zone_width >= 0.
                && c.dead_zone_height >= 0.
                && c.look_ahead_distance >= 0.
                && c.shake_amplitude >= 0.
                && c.shake_frequency > 0.,
            "builtin_shooter",
            "camera_config",
            0,
            Problem::Number,
        )?;
        let a = self.audio_policy;
        require(
            finite(&[
                a.shoot_volume,
                a.shoot_pitch,
                a.hit_volume,
                a.hit_pitch,
                a.game_over_volume,
                a.game_over_pitch,
            ]) && a.shoot_volume >= 0.
                && a.hit_volume >= 0.
                && a.game_over_volume >= 0.
                && a.shoot_pitch > 0.
                && a.hit_pitch > 0.
                && a.game_over_pitch > 0.,
            "builtin_shooter",
            "audio_config",
            0,
            Problem::Number,
        )?;
        // Typed Option presence is lost by the packed zero-row projection.
        // A Some{id:0, Player/all-zero bucket} must not impersonate None.
        b.work(self.prefab_registry.registrations.len())?;
        let mut empty_seen = false;
        for (i, row) in self.prefab_registry.registrations.iter().enumerate() {
            if let Some(row) = row {
                require(
                    !empty_seen && row.prefab_id > 0,
                    "builtin_shooter",
                    "typed_registry_presence",
                    i,
                    Problem::Layout,
                )?;
            } else {
                empty_seen = true;
            }
        }
        // Reuse the packed registry predicate with only the current remainder.
        // Fixed stack construction is precharged before any copy/scan.
        let mut nested = crate::engine::file_physics_output_admission::Budget::new(b.remaining());
        nested.work(GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_U32S)?;
        nested.fixed(GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_U32S * std::mem::size_of::<u32>())?;
        let mut words = [0; GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_U32S];
        require(
            self.prefab_registry.write_snapshot(&mut words),
            "builtin_shooter",
            "registry_layout",
            0,
            Problem::Length,
        )?;
        GameplayPrefabRegistry::validate_output_words(&words, &mut nested)?;
        b.nested(nested.usage())?;
        Ok(())
    }
}

#[cfg(test)]
impl GameplayPrefabRegistry {
    pub(in crate::shooter_scene) fn corrupt_builtin_file_fixture(&mut self, case: usize) {
        if case == 0 {
            self.registrations[1] = self.registrations[0];
        } else {
            self.registrations[0] = Some(GameplayPrefabRegistration {
                prefab_id: 0,
                kind: ShooterPrefabKind::Player,
                components: ShooterPrefabComponentBucket::player_config(),
            });
        }
    }
}

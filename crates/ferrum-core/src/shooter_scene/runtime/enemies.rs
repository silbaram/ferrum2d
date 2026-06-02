use crate::components::{CollisionLayer, Transform2D};
use crate::gameplay::{
    apply_layer_movement_pattern_phase, layer_movement_pattern_phase_config_with_default_fallback,
    tick_movement_navigation_targets, DefaultMovementPatternConfig,
    LayerMovementPatternDefaultFallbackConfig, LayerMovementPatternPhaseConfig,
    MovementNavigationPolicy,
};
use crate::tilemap::{Tilemap, TilemapNavigationScratch};
use crate::world::World;

use super::super::{
    ShooterScene, NAVIGATION_REPATH_INTERVAL, NAVIGATION_TARGET_REACHED_DISTANCE_SQUARED,
};

struct EnemyMovementPhaseContext<'a> {
    phase: LayerMovementPatternPhaseConfig,
    tilemap: &'a Tilemap,
    navigation_scratch: &'a mut TilemapNavigationScratch,
}

impl<'a> EnemyMovementPhaseContext<'a> {
    fn navigation_waypoint(&mut self, from: Transform2D, to: Transform2D) -> Option<Transform2D> {
        self.tilemap
            .navigation_waypoint_with_scratch(from, to, self.navigation_scratch)
    }
}

impl ShooterScene {
    pub(in crate::shooter_scene) fn apply_enemy_movement_phase(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        delta: f32,
    ) {
        tick_movement_navigation_targets(&mut self.navigation_targets, delta);
        let player_t = world
            .player_entity()
            .and_then(|player| world.transform(player));
        let speed = self.active_enemy_speed();
        let behavior = self.active_enemy_behavior();
        let mut context = EnemyMovementPhaseContext {
            phase: layer_movement_pattern_phase_config_with_default_fallback(
                LayerMovementPatternDefaultFallbackConfig {
                    layer: CollisionLayer::Enemy,
                    player_transform: player_t,
                    navigation_policy: MovementNavigationPolicy {
                        repath_interval_seconds: NAVIGATION_REPATH_INTERVAL,
                        reached_distance_squared: NAVIGATION_TARGET_REACHED_DISTANCE_SQUARED,
                    },
                    fallback: DefaultMovementPatternConfig {
                        kind: behavior.default_movement_pattern_kind(),
                        speed,
                        world_width: self.config.world_width,
                        world_height: self.config.world_height,
                        orbit_radius: self.config.orbit_radius,
                        orbit_radial_band: self.config.orbit_radial_band,
                    },
                },
            ),
            tilemap,
            navigation_scratch: &mut self.navigation_scratch,
        };
        let phase = context.phase;
        let navigation_targets = &mut self.navigation_targets;
        apply_layer_movement_pattern_phase(world, navigation_targets, phase, |from, to| {
            context.navigation_waypoint(from, to)
        });
    }

    #[cfg(test)]
    pub(in crate::shooter_scene) fn update_enemy_velocity(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        delta: f32,
    ) {
        self.apply_enemy_movement_phase(world, tilemap, delta);
    }
}

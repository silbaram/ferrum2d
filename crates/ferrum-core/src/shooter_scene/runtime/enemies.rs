use crate::components::{CollisionLayer, Transform2D, Velocity};
use crate::tilemap::Tilemap;
use crate::world::World;

use super::super::{
    has_reached_navigation_target, EnemyBehavior, ShooterScene, NAVIGATION_REPATH_INTERVAL,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::shooter_scene) struct NavigationTargetCache {
    generation: u32,
    target: Transform2D,
    remaining_seconds: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct EnemyNavigationSource {
    index: usize,
    generation: u32,
    transform: Transform2D,
}

impl ShooterScene {
    pub(in crate::shooter_scene) fn update_enemy_velocity(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        delta: f32,
    ) {
        self.tick_navigation_targets(delta);
        let player_t = world
            .player
            .and_then(|player| world.transforms[player.id as usize]);
        let speed = self.active_enemy_speed();
        let behavior = self.active_enemy_behavior();
        let alive_count = world.alive_indices().len();
        for alive_position in 0..alive_count {
            let i = world.alive_indices()[alive_position];
            if world.collider_layer_at(i) != Some(CollisionLayer::Enemy) {
                continue;
            }
            let Some(enemy_t) = world.transforms[i] else {
                continue;
            };
            world.velocities[i] = Some(self.enemy_velocity(
                EnemyNavigationSource {
                    index: i,
                    generation: world.generations[i],
                    transform: enemy_t,
                },
                player_t,
                tilemap,
                speed,
                behavior,
            ));
        }
    }

    fn enemy_velocity(
        &mut self,
        enemy: EnemyNavigationSource,
        player_t: Option<Transform2D>,
        tilemap: &Tilemap,
        speed: f32,
        behavior: EnemyBehavior,
    ) -> Velocity {
        match behavior {
            EnemyBehavior::Chase => {
                let Some(player_t) = player_t else {
                    return Velocity::default();
                };
                let target = self.navigation_target(enemy, player_t, tilemap);
                Self::velocity_toward(enemy.transform, target, speed)
            }
            EnemyBehavior::Drift => Self::velocity_toward(
                enemy.transform,
                Transform2D {
                    x: self.config.world_width * 0.5,
                    y: self.config.world_height * 0.5,
                },
                speed,
            ),
            EnemyBehavior::Static => Velocity::default(),
            EnemyBehavior::Orbit => {
                let Some(player_t) = player_t else {
                    return Velocity::default();
                };
                self.orbit_velocity(enemy.transform, player_t, speed)
            }
        }
    }

    pub(in crate::shooter_scene) fn orbit_velocity(
        &self,
        enemy_t: Transform2D,
        player_t: Transform2D,
        speed: f32,
    ) -> Velocity {
        let dx = enemy_t.x - player_t.x;
        let dy = enemy_t.y - player_t.y;
        let distance = (dx * dx + dy * dy).sqrt();
        if distance <= 0.0001 {
            return Velocity { vx: speed, vy: 0.0 };
        }

        let radial_x = dx / distance;
        let radial_y = dy / distance;
        let mut vx = -radial_y;
        let mut vy = radial_x;

        if distance < self.config.orbit_radius - self.config.orbit_radial_band {
            vx += radial_x;
            vy += radial_y;
        } else if distance > self.config.orbit_radius + self.config.orbit_radial_band {
            vx -= radial_x;
            vy -= radial_y;
        }

        let len = (vx * vx + vy * vy).sqrt();
        if len <= 0.0001 {
            return Velocity::default();
        }
        Velocity {
            vx: vx / len * speed,
            vy: vy / len * speed,
        }
    }

    fn tick_navigation_targets(&mut self, delta: f32) {
        let elapsed = delta.max(0.0);
        if elapsed <= 0.0 {
            return;
        }
        for cache in self.navigation_targets.iter_mut().flatten() {
            cache.remaining_seconds = (cache.remaining_seconds - elapsed).max(0.0);
        }
    }

    fn navigation_target(
        &mut self,
        enemy: EnemyNavigationSource,
        player_t: Transform2D,
        tilemap: &Tilemap,
    ) -> Transform2D {
        if enemy.index >= self.navigation_targets.len() {
            self.navigation_targets.resize(enemy.index + 1, None);
        }

        let cached_target = self.navigation_targets[enemy.index]
            .filter(|cache| {
                cache.generation == enemy.generation
                    && cache.remaining_seconds > 0.0
                    && !has_reached_navigation_target(enemy.transform, cache.target)
            })
            .map(|cache| cache.target);
        if let Some(target) = cached_target {
            return target;
        }

        let target = tilemap
            .navigation_waypoint_with_scratch(
                enemy.transform,
                player_t,
                &mut self.navigation_scratch,
            )
            .unwrap_or(player_t);
        self.navigation_targets[enemy.index] = Some(NavigationTargetCache {
            generation: enemy.generation,
            target,
            remaining_seconds: NAVIGATION_REPATH_INTERVAL,
        });
        target
    }

    fn velocity_toward(from: Transform2D, to: Transform2D, speed: f32) -> Velocity {
        let dx = to.x - from.x;
        let dy = to.y - from.y;
        let len = (dx * dx + dy * dy).sqrt();
        if len > 0.0001 {
            Velocity {
                vx: dx / len * speed,
                vy: dy / len * speed,
            }
        } else {
            Velocity::default()
        }
    }
}

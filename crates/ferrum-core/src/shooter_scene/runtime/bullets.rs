use crate::components::gameplay::MovementPattern;
use crate::components::CollisionLayer;
use crate::gameplay::{
    apply_layer_movement_pattern_with_navigation_batch_system, has_expired_lifetime, queue_despawn,
    run_lifetime_system, MovementNavigationPolicy,
};
use crate::world::World;

use super::super::ShooterScene;

impl ShooterScene {
    pub(in crate::shooter_scene) fn apply_projectile_movement_phase(&mut self, world: &mut World) {
        let player_transform = world
            .player_entity()
            .and_then(|player| world.transform(player));
        apply_layer_movement_pattern_with_navigation_batch_system(
            world,
            CollisionLayer::Bullet,
            player_transform,
            &mut self.navigation_targets,
            MovementNavigationPolicy {
                repath_interval_seconds: 0.0,
                reached_distance_squared: 0.0,
            },
            |world, entity_index| {
                let velocity = world.velocity_at_index_or_default(entity_index);
                MovementPattern::Linear {
                    vx: velocity.vx,
                    vy: velocity.vy,
                }
            },
            |_, _| None,
        );
    }

    pub(in crate::shooter_scene) fn update_bullets(&mut self, world: &mut World, delta: f32) {
        self.clear_pending_despawns();
        run_lifetime_system(world, delta, &mut self.pending_despawn);
        let alive_count = world.alive_indices().len();
        for alive_position in 0..alive_count {
            let i = world.alive_indices()[alive_position];
            world.update_projectile_arc_at(i, delta);
            if world.collider_layer_at(i) != Some(CollisionLayer::Bullet) {
                continue;
            }
            if has_expired_lifetime(world, i) {
                continue;
            }
            if let Some(t) = world.transform_at_index(i) {
                if t.x < -20.0
                    || t.x > self.config.world_width + 20.0
                    || t.y < -20.0
                    || t.y > self.config.world_height + 20.0
                {
                    queue_despawn(world, i, &mut self.pending_despawn);
                }
            }
        }
        self.despawn_pending(world);
    }
}

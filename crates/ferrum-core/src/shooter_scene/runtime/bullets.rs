use crate::components::CollisionLayer;
use crate::entity::Entity;
use crate::world::World;

use super::super::ShooterScene;

impl ShooterScene {
    pub(in crate::shooter_scene) fn update_bullets(&mut self, world: &mut World, delta: f32) {
        self.clear_pending_despawns();
        for i in 0..world.transforms.len() {
            if !world.alive[i] {
                continue;
            }
            if let Some(time_left) = world.bullet_lifetimes[i].as_mut() {
                *time_left -= delta;
            }
            if world.collider_layer_at(i) != Some(CollisionLayer::Bullet) {
                continue;
            }
            if world.bullet_lifetimes[i].is_some_and(|t| t <= 0.0) {
                self.pending_despawn.push(Entity {
                    id: i as u32,
                    generation: world.generations[i],
                });
                continue;
            }
            if let Some(t) = world.transforms[i] {
                if t.x < -20.0
                    || t.x > self.config.world_width + 20.0
                    || t.y < -20.0
                    || t.y > self.config.world_height + 20.0
                {
                    self.pending_despawn.push(Entity {
                        id: i as u32,
                        generation: world.generations[i],
                    });
                }
            }
        }
        self.despawn_pending(world);
    }
}

use crate::components::CollisionLayer;
use crate::gameplay::{has_expired_lifetime, queue_despawn, run_lifetime_system};
use crate::world::World;

use super::super::ShooterScene;

impl ShooterScene {
    pub(in crate::shooter_scene) fn update_bullets(&mut self, world: &mut World, delta: f32) {
        self.clear_pending_despawns();
        run_lifetime_system(world, delta, &mut self.pending_despawn);
        let alive_count = world.alive_indices().len();
        for alive_position in 0..alive_count {
            let i = world.alive_indices()[alive_position];
            if let Some(arc) = world.projectile_arcs[i].as_mut() {
                world.height_spans[i] = arc.update(delta);
            }
            if world.collider_layer_at(i) != Some(CollisionLayer::Bullet) {
                continue;
            }
            if has_expired_lifetime(world, i) {
                continue;
            }
            if let Some(t) = world.transforms[i] {
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

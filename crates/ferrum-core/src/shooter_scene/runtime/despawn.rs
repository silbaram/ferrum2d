use crate::world::World;

use super::super::ShooterScene;

impl ShooterScene {
    pub(in crate::shooter_scene) fn clear_pending_despawns(&mut self) {
        self.pending_despawn.clear();
    }

    pub(in crate::shooter_scene) fn despawn_pending(&mut self, world: &mut World) {
        for entity in self.pending_despawn.drain(..) {
            world.despawn(entity);
        }
    }
}

//! Catalog owner hooks; no authoring/render/navigation reconstruction.
use super::*;
use crate::world::sprite_playback::SpriteClip;
use std::sync::Arc;
#[derive(Clone, Copy, Debug)]
pub(in crate::engine) enum CatalogClipArcLocation {
    Projectile {
        index: usize,
    },
    Actor {
        index: usize,
        id: u32,
        source: Entity,
    },
}
impl DataSceneCombat {
    pub(in crate::engine) fn file_native_routes(
        &self,
    ) -> &crate::engine::unified_physics::NativeCombatNavigation {
        self.navigation.file_native_routes()
    }
    pub(in crate::engine) fn file_native_routes_mut(
        &mut self,
    ) -> &mut crate::engine::unified_physics::NativeCombatNavigation {
        self.navigation.file_native_routes_mut()
    }
    pub(in crate::engine) fn file_clip_scan_lengths(&self) -> [usize; 2] {
        [
            self.prefabs.definitions.len(),
            self.spawn_prefabs.definitions.len(),
        ]
    }
    pub(in crate::engine) fn visit_file_clip_arcs<'a, E>(
        &'a self,
        visit: &mut impl FnMut(CatalogClipArcLocation, &'a Arc<[SpriteClip]>) -> Result<(), E>,
    ) -> Result<(), E> {
        for (index, prefab) in self.prefabs.definitions.iter().enumerate() {
            if let Some(arc) = &prefab.animation {
                visit(CatalogClipArcLocation::Projectile { index }, arc)?;
            }
        }
        for (index, prefab) in self.spawn_prefabs.definitions.iter().enumerate() {
            if let Some(arc) = prefab.prototype.file_clip_arc() {
                visit(
                    CatalogClipArcLocation::Actor {
                        index,
                        id: prefab.id,
                        source: prefab.prototype.source,
                    },
                    arc,
                )?;
            }
        }
        Ok(())
    }
    /// Complete graph and all replacement values were checked before this walk.
    pub(in crate::engine) fn rebind_file_clip_arcs(
        &mut self,
        replace: &mut impl FnMut(&mut Arc<[SpriteClip]>),
    ) {
        for prefab in &mut self.prefabs.definitions {
            if let Some(arc) = &mut prefab.animation {
                replace(arc);
            }
        }
        for prefab in &mut self.spawn_prefabs.definitions {
            prefab.prototype.rebind_file_clip_arc(replace);
        }
    }
}

//! Shared native scene admission and cold authoring synchronization.
use super::*;
use crate::engine::scenes::ActiveScene;

impl Engine {
    pub(in crate::engine) fn is_built_in_shooter(&self) -> bool {
        self.scene_mode == SceneMode::BuiltIn && self.scenes.is_active(ActiveScene::Shooter)
    }
    pub(in crate::engine) fn is_built_in_breakout(&self) -> bool {
        self.scene_mode == SceneMode::BuiltIn && self.scenes.is_active(ActiveScene::Breakout)
    }
    pub(in crate::engine) fn is_built_in_platformer(&self) -> bool {
        self.scene_mode == SceneMode::BuiltIn && self.scenes.is_active(ActiveScene::Platformer)
    }
    pub(in crate::engine) fn has_native_platformer(&self) -> bool {
        self.is_built_in_platformer() && self.unified_physics.is_some()
    }
    pub(in crate::engine) fn has_native_shooter(&self) -> bool {
        self.is_built_in_shooter() && self.unified_physics.is_some()
    }
    pub(in crate::engine) fn has_native_breakout(&self) -> bool {
        self.is_built_in_breakout() && self.unified_physics.is_some()
    }
    pub(in crate::engine) fn has_native_built_in(&self) -> bool {
        self.has_native_shooter() || self.has_native_breakout() || self.has_native_platformer()
    }
    pub(in crate::engine) fn supports_unified_scene(&self, space: Space) -> bool {
        self.scene_mode == SceneMode::Data
            || (space == Space::PlanarXy
                && (self.is_built_in_shooter()
                    || self.is_built_in_breakout()
                    || self.is_built_in_platformer()))
    }
    pub(in crate::engine) fn refresh_native_built_in_owners(&mut self) {
        if self.has_native_breakout() {
            if let Some(runtime) = &mut self.unified_physics {
                runtime.breakout = Some(super::breakout::BreakoutBodies::from_scene(
                    self.scenes.breakout(),
                ));
            }
        }
        if self.has_native_platformer() {
            if let Some(profile) = self
                .unified_physics
                .as_mut()
                .and_then(|r| r.platformer.as_mut())
            {
                profile.refresh(self.scenes.platformer());
            }
        }
    }
    pub(in crate::engine) fn sync_native_built_in(&mut self) {
        self.refresh_native_built_in_owners();
        if let Some(runtime) = &mut self.unified_physics {
            if let Err(error) = runtime.prepare_query(
                &mut self.world,
                self.auto_rigid_body_step_config,
                &self.tilemap,
                &self.spatial_scene,
            ) {
                runtime.last_error.record(error);
            }
        }
    }
}

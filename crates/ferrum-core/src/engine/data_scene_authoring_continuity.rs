//! Optional cold authoring handoff. Playback and LOD selection remain native-owned.
use super::{Engine, SceneMode};
use crate::{spatial_scene::ModelLodContinuity, world::sprite_playback::SpritePlayback};
use std::collections::BTreeSet;
use wasm_bindgen::prelude::*;

const MAX_INSTANCES: usize = 10_000;

#[derive(Debug)]
struct InstanceState {
    animation: Option<SpritePlayback>,
    lod: Option<ModelLodContinuity>,
}
#[derive(Debug)]
struct Handoff {
    token: u32,
    epoch: u32,
    instances: Vec<InstanceState>,
}
#[derive(Debug, Default)]
pub(super) struct AuthoringContinuity {
    serial: u32,
    pending: Option<Handoff>,
}

#[wasm_bindgen]
impl Engine {
    /// Masks: bit 0 animation, bit 1 LOD. The caller matches stable authored IDs in bulk.
    pub fn begin_data_scene_authoring_continuity(&mut self, handles: &[u32], masks: &[u32]) -> u32 {
        if self.scene_mode != SceneMode::Data
            || self.authoring_continuity.pending.is_some()
            || !handles.len().is_multiple_of(2)
            || handles.len() / 2 != masks.len()
            || masks.len() > MAX_INSTANCES
            || masks.iter().any(|mask| mask & !3 != 0)
        {
            return 0;
        }
        let mut seen = BTreeSet::new();
        if handles.chunks_exact(2).any(|h| !seen.insert((h[0], h[1]))) {
            return 0;
        }
        let instances = handles
            .chunks_exact(2)
            .zip(masks)
            .map(|(h, mask)| {
                let entity = self.entity_from_handle(h[0], h[1]);
                InstanceState {
                    animation: entity
                        .filter(|_| mask & 1 != 0)
                        .and_then(|e| self.world.sprite_playbacks[e.id as usize].clone()),
                    lod: entity.filter(|_| mask & 2 != 0).and_then(|_| {
                        self.spatial_scene
                            .models
                            .capture_lod_continuity((h[0], h[1]))
                    }),
                }
            })
            .collect();
        self.authoring_continuity.serial = self.authoring_continuity.serial.wrapping_add(1).max(1);
        let token = self.authoring_continuity.serial;
        self.authoring_continuity.pending = Some(Handoff {
            token,
            epoch: self.data_scene_epoch(),
            instances,
        });
        token
    }

    /// A single use handoff after a complete authoring activation. Validate the whole batch first.
    pub fn finish_data_scene_authoring_continuity(&mut self, token: u32, handles: &[u32]) -> bool {
        let Some(pending) = self.authoring_continuity.pending.as_ref() else {
            return false;
        };
        if self.scene_mode != SceneMode::Data
            || token != pending.token
            || pending.epoch == self.data_scene_epoch()
            || handles.len() != pending.instances.len() * 2
        {
            return false;
        }
        let mut seen = BTreeSet::new();
        if handles
            .chunks_exact(2)
            .any(|h| !seen.insert((h[0], h[1])) || self.entity_from_handle(h[0], h[1]).is_none())
        {
            return false;
        }
        let Some(pending) = self.authoring_continuity.pending.take() else {
            return false;
        };
        for (h, state) in handles.chunks_exact(2).zip(pending.instances) {
            let index = h[0] as usize;
            if let (Some(previous), Some(current)) =
                (state.animation, self.world.sprite_playbacks[index].as_mut())
            {
                if previous.clips == current.clips {
                    *current = previous;
                    if let Some(sprite) = self.world.sprites[index].as_mut() {
                        current.write_sprite(sprite);
                    }
                }
            }
            if let Some(lod) = state.lod {
                self.spatial_scene
                    .models
                    .restore_lod_continuity((h[0], h[1]), &lod);
            }
        }
        self.spatial_scene.frame_active = false;
        true
    }

    /// Drop captured Arc references on both successful and failed cold authoring operations.
    pub fn cancel_data_scene_authoring_continuity(&mut self, token: u32) -> bool {
        if self
            .authoring_continuity
            .pending
            .as_ref()
            .is_none_or(|p| p.token != token)
        {
            return false;
        }
        self.authoring_continuity.pending = None;
        true
    }
}

//! Optional cold authoring handoff. Playback and LOD selection remain native-owned.
use super::{Engine, SceneMode};
use crate::{spatial_scene::ModelLodContinuity, world::sprite_playback::SpritePlayback};
use std::collections::BTreeSet;
use wasm_bindgen::prelude::*;

const MAX_INSTANCES: usize = 10_000;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct InstanceState {
    animation: Option<SpritePlayback>,
    lod: Option<ModelLodContinuity>,
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct Handoff {
    token: u32,
    epoch: u32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    instances: Vec<InstanceState>,
}
#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
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

impl AuthoringContinuity {
    pub(in crate::engine) fn file_clip_scan_len(&self) -> usize {
        self.pending.as_ref().map_or(0, |p| p.instances.len())
    }
    pub(in crate::engine) fn visit_file_clip_arcs<'a, E>(
        &'a self,
        visit: &mut impl FnMut(
            u32,
            u32,
            usize,
            &'a std::sync::Arc<[crate::world::sprite_playback::SpriteClip]>,
        ) -> Result<(), E>,
    ) -> Result<(), E> {
        if let Some(pending) = &self.pending {
            for (index, instance) in pending.instances.iter().enumerate() {
                if let Some(playback) = &instance.animation {
                    visit(pending.token, pending.epoch, index, &playback.clips)?;
                }
            }
        }
        Ok(())
    }
    /// Same-value backing only; handoff serial/token/epoch/LOD/order stay stored.
    pub(in crate::engine) fn rebind_file_clip_arcs(
        &mut self,
        replace: &mut impl FnMut(&mut std::sync::Arc<[crate::world::sprite_playback::SpriteClip]>),
    ) {
        if let Some(pending) = &mut self.pending {
            for instance in &mut pending.instances {
                if let Some(playback) = &mut instance.animation {
                    replace(&mut playback.clips);
                }
            }
        }
    }
}

impl AuthoringContinuity {
    pub(super) fn validate_file(
        &self,
        b: &mut crate::spatial_scene::file_admission::Budget,
    ) -> Result<(), crate::spatial_scene::file_admission::Error> {
        use crate::spatial_scene::file_admission::{require, Field, Problem};
        b.work(1)?;
        if let Some(pending) = &self.pending {
            require(
                pending.token != 0
                    && pending.token == self.serial
                    && pending.instances.len() <= MAX_INSTANCES,
                Field::Continuity,
                0,
                Problem::Reference,
            )?;
            b.work(pending.instances.len())?;
            for (i, state) in pending.instances.iter().enumerate() {
                if let Some(lod) = &state.lod {
                    lod.validate_file(b)?;
                }
                if let Some(v) = &state.animation {
                    require(
                        !v.clips.is_empty() && v.clips.len() <= 64,
                        Field::Continuity,
                        i,
                        Problem::Length,
                    )?;
                    b.work(v.clips.len())?;
                    b.product(v.clips.len(), v.clips.len())?;
                    let mut total = 0usize;
                    for (j, clip) in v.clips.iter().enumerate() {
                        for count in clip.saved_payload_lengths() {
                            b.product(count, 8)?;
                        }
                        total = total
                            .checked_add(clip.saved_payload_lengths()[0])
                            .ok_or(crate::spatial_scene::file_admission::Error::WorkLimit)?;
                        require(
                            total <= crate::world::sprite_playback::MAX_CLIP_TOTAL_FRAMES
                                && clip.admit_saved_payload().is_ok()
                                && !v.clips[..j].iter().any(|other| other.id == clip.id),
                            Field::Continuity,
                            i,
                            Problem::Range,
                        )?;
                    }
                    require(
                        v.active < v.clips.len() && v.elapsed.is_finite() && v.elapsed >= 0.,
                        Field::Continuity,
                        i,
                        Problem::Reference,
                    )?;
                    let clip = &v.clips[v.active];
                    let duration = clip.duration_seconds();
                    require(
                        duration.is_finite()
                            && duration > 0.
                            && if clip.looping {
                                v.elapsed < duration
                            } else {
                                v.elapsed <= duration
                            },
                        Field::Continuity,
                        i,
                        Problem::Range,
                    )?;
                }
            }
        }
        Ok(())
    }
}
#[cfg(test)]
impl AuthoringContinuity {
    pub(super) fn corrupt_file_fixture(&mut self, case: u32) {
        match case {
            0 => self.serial = 0,
            1 => {
                self.pending.as_mut().unwrap().instances[0]
                    .animation
                    .as_mut()
                    .unwrap()
                    .active = usize::MAX
            }
            2 => self.pending.as_mut().unwrap().instances[0]
                .lod
                .as_mut()
                .unwrap()
                .corrupt_file_fixture(),
            _ => unreachable!(),
        }
    }
}

// Borrowed cold facts. The stored handoff deliberately has no original handles.
impl AuthoringContinuity {
    pub(in crate::engine) fn file_roster_header(&self) -> Option<(u32, u32, u32, usize)> {
        self.pending
            .as_ref()
            .map(|p| (self.serial, p.token, p.epoch, p.instances.len()))
    }
    pub(in crate::engine) fn visit_file_roster_instances<E>(
        &self,
        visit: &mut impl FnMut(
            usize,
            Option<&SpritePlayback>,
            Option<&ModelLodContinuity>,
        ) -> Result<(), E>,
    ) -> Result<(), E> {
        if let Some(p) = &self.pending {
            for (i, state) in p.instances.iter().enumerate() {
                visit(i, state.animation.as_ref(), state.lod.as_ref())?;
            }
        }
        Ok(())
    }
}

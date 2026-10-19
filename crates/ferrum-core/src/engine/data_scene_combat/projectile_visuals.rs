//! Bounded projectile presentation. Immutable atlas definitions share the regular playback path.
use super::prefabs::{ProjectilePrefab, ProjectilePrefabConfig, MAX_PREFABS};
use super::*;
use crate::world::sprite_playback::{SpriteClip, SpritePlayback};
use std::sync::Arc;

pub(super) const PLAYBACK: usize = 26;
pub(super) const SHOT: usize = PLAYBACK + 6;

impl ProjectilePrefabConfig {
    pub(super) fn has_visuals(&self) -> bool {
        self.definitions
            .iter()
            .any(|p| p.animation.is_some() || p.align_velocity)
    }

    /// One metadata4/fps1 record per definition, plus at most32 UV frames per definition.
    fn configure_visuals(&mut self, metadata: &[u32], fps: &[f32], frames: &[f32]) -> Option<()> {
        if metadata.len() != self.definitions.len() * 4
            || fps.len() != self.definitions.len()
            || frames.len() > MAX_PREFABS * 32 * 4
        {
            return None;
        }
        let mut offset = 0;
        for (index, ((prefab, m), &fps)) in self
            .definitions
            .iter_mut()
            .zip(metadata.chunks_exact(4))
            .zip(fps)
            .enumerate()
        {
            if m[0] as usize != index + 1 || m[1] > 32 || m[2] > 1 || m[3] > 1 {
                return None;
            }
            prefab.align_velocity = m[3] != 0;
            if m[1] == 0 {
                if fps != 0. || m[2] != 0 {
                    return None;
                }
                continue;
            }
            if !fps.is_finite() || !(0.001..=1000.).contains(&fps) {
                return None;
            }
            let end = offset + m[1] as usize * 4;
            let mut sequence = Vec::with_capacity(m[1] as usize);
            for uv in frames.get(offset..end)?.chunks_exact(4) {
                if uv.iter().any(|v| !v.is_finite() || !(0.0..=1.).contains(v))
                    || uv[0] == uv[2]
                    || uv[1] == uv[3]
                {
                    return None;
                }
                sequence.push(SpriteFrame {
                    u0: uv[0],
                    v0: uv[1],
                    u1: uv[2],
                    v1: uv[3],
                });
            }
            if sequence.first()?.uv()
                != (
                    prefab.values[2],
                    prefab.values[3],
                    prefab.values[4],
                    prefab.values[5],
                )
            {
                return None;
            }
            prefab.animation = Some(Arc::from([SpriteClip {
                id: 0,
                frames: sequence,
                fps,
                looping: m[2] != 0,
            }]));
            offset = end;
        }
        (offset == frames.len()).then_some(())
    }
}

impl ProjectilePrefab {
    pub(super) fn playback(&self) -> Option<SpritePlayback> {
        Some(SpritePlayback {
            clips: Arc::clone(self.animation.as_ref()?),
            active: 0,
            elapsed: 0.,
            paused: false,
            flip_x: false,
            flip_y: false,
        })
    }

    /// Definition-dependent validation happens before any checkpoint commit.
    pub(super) fn record_playback(&self, record: &[f64]) -> Option<Option<SpritePlayback>> {
        let Some(mut playback) = self.playback() else {
            return (record.len() < SHOT || record[PLAYBACK..SHOT].iter().all(|&v| v == 0.))
                .then_some(None);
        };
        let v = record.get(PLAYBACK..SHOT)?;
        if v[0] != 1.
            || v[1] != 0.
            || !v[2].is_finite()
            || v[2] < 0.
            || v[3..].iter().any(|&v| v != 0. && v != 1.)
        {
            return None;
        }
        let clip = &playback.clips[0];
        let duration = clip.frames.len() as f64 / f64::from(clip.fps);
        if v[2] > duration || clip.looping && v[2] >= duration {
            return None;
        }
        playback.elapsed = v[2];
        playback.paused = v[3] == 1.;
        playback.flip_x = v[4] == 1.;
        playback.flip_y = v[5] == 1.;
        Some(Some(playback))
    }

    pub(super) fn playback_matches(
        &self,
        world: &World,
        shot: Entity,
        sprite: crate::components::Sprite,
    ) -> bool {
        match (&self.animation, &world.sprite_playbacks[shot.id as usize]) {
            (None, None) => true,
            (Some(clips), Some(playback)) if playback.clips == *clips && playback.active == 0 => {
                let mut record = [0.; SHOT];
                record[PLAYBACK..].copy_from_slice(&playback_values(Some(playback)));
                if self.record_playback(&record).is_none() {
                    return false;
                }
                let mut expected = sprite;
                playback.write_sprite(&mut expected);
                (expected.u0, expected.v0, expected.u1, expected.v1)
                    == (sprite.u0, sprite.v0, sprite.u1, sprite.v1)
            }
            _ => false,
        }
    }
}

pub(super) fn playback_values(playback: Option<&SpritePlayback>) -> [f64; 6] {
    playback.map_or([0.; 6], |p| {
        [
            1.,
            p.clips[p.active].id as f64,
            p.elapsed,
            f64::from(p.paused),
            f64::from(p.flip_x),
            f64::from(p.flip_y),
        ]
    })
}

impl DataSceneCombat {
    /// Render-derived orientation only: velocity/collider/World rotation remain unchanged.
    pub(in crate::engine) fn build_projectile_rotations(
        &self,
        world: &World,
        spatial: &mut SpatialScene,
        camera: &Camera2D,
    ) {
        spatial.runtime_sprite_rotations.clear();
        if !self.prefabs.has_visuals() {
            return;
        }
        spatial
            .runtime_billboards
            .sort_unstable_by_key(|(e, _)| (e.id, e.generation));
        let presented_camera = spatial.camera.and_then(|base| {
            spatial
                .presented_camera([base.parameters[10], base.parameters[11]])
                .map(|(camera, _)| camera)
        });
        for &(shot, _, prefab) in &self.projectiles {
            if !world.is_current_entity(shot)
                || !self.prefabs.get(prefab).is_some_and(|p| p.align_velocity)
            {
                continue;
            }
            let Some(velocity) = world.velocity(shot) else {
                continue;
            };
            let angle = if let Some(camera) = presented_camera {
                let Some(at) = world.transform(shot) else {
                    continue;
                };
                let elevation = world.height_span(shot).map_or(0., |span| span.elevation)
                    + spatial
                        .runtime_billboards
                        .binary_search_by_key(&(shot.id, shot.generation), |(e, _)| {
                            (e.id, e.generation)
                        })
                        .ok()
                        .map_or(0., |i| spatial.runtime_billboards[i].1.elevation);
                camera.billboard_velocity_rotation(at, elevation, velocity)
            } else if velocity.vx == 0. && velocity.vy == 0. {
                0.
            } else {
                (f64::from(velocity.vy) * f64::from(camera.ground_y_scale))
                    .atan2(f64::from(velocity.vx)) as f32
            };
            spatial.runtime_sprite_rotations.push((shot, angle));
        }
        spatial
            .runtime_sprite_rotations
            .sort_unstable_by_key(|(e, _)| (e.id, e.generation));
    }
}

#[wasm_bindgen]
impl Engine {
    /// Animated atlas and projected velocity orientation with semantic checkpoint v4.
    pub fn data_scene_projectile_visuals_version(&self) -> u32 {
        1
    }

    /// Cold catalog extension; all buffers are validated before reconfiguration.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_gameplay_v8(
        &mut self,
        has_actor: bool,
        id: u32,
        generation: u32,
        interaction: u32,
        combat: bool,
        metadata: &[u32],
        values: &[f32],
        bindings: &[u32],
        navigation: &[f32],
        agents: &[u32],
        distances: &[f32],
        flags: u32,
        actor_prefabs: &[u32],
        visual_metadata: &[u32],
        fps: &[f32],
        frames: &[f32],
    ) -> bool {
        let Some(mut config) =
            ProjectilePrefabConfig::decode(&self.world, metadata, values, bindings)
        else {
            return false;
        };
        if config
            .configure_visuals(visual_metadata, fps, frames)
            .is_none()
        {
            return false;
        }
        if !self.configure_data_scene_gameplay_v7(
            has_actor,
            id,
            generation,
            interaction,
            combat,
            metadata,
            values,
            bindings,
            navigation,
            agents,
            distances,
            flags,
            actor_prefabs,
        ) {
            return false;
        }
        self.spatial_scene
            .runtime_sprite_rotations
            .reserve(MAX_PROJECTILES);
        self.data_scene.gameplay.combat.prefabs = config;
        true
    }
}

//! Cold-path spatial progress: semantic camera + authored billboard poses, never GPU/handle identity in JSON.
use super::Engine;
use crate::components::{HeightSpan, PhysicsFloorId, Transform2D, Velocity};
use crate::entity::Entity;
use crate::spatial_scene::{SpatialCamera, SpatialScene};
use wasm_bindgen::prelude::*;

const CAMERA_VALUES: usize = 13; // enabled + 12 native camera parameters
const POSE_VALUES: usize = 8; // present, x, y, span present, floor, elevation, height, surface ID

#[derive(Debug)]
struct SpatialPose {
    at: Transform2D,
    span: Option<HeightSpan>,
}

struct SpatialProgress {
    camera: Option<SpatialCamera>,
    poses: Vec<Option<SpatialPose>>,
}

#[wasm_bindgen]
impl Engine {
    /// Environment v1 is validated before the existing atomic flag/animation/pose restore.
    #[allow(clippy::too_many_arguments)]
    pub fn restore_data_scene_progress_with_spatial_environment(
        &mut self,
        epoch: u32,
        handles: &[u32],
        states: &[u32],
        animations: &[f64],
        spatial: &[f64],
        environment: &[f32],
    ) -> bool {
        if (spatial.first() == Some(&0.) && !environment.is_empty())
            || !self.validate_data_scene_progress(handles, states)
        {
            return false;
        }
        let Some(next) = crate::spatial_scene::SpatialEnvironment::new(environment) else {
            return false;
        };
        let previous = std::mem::replace(&mut self.spatial_scene.environment, next);
        let removed = handles
            .chunks_exact(2)
            .zip(states)
            .filter(|(_, state)| **state == 0)
            .map(|(handle, _)| (handle[0], handle[1]))
            .collect();
        if !self
            .spatial_scene
            .shadow_budget_valid_after_removals(&self.world, &removed)
            || !self.restore_data_scene_progress_with_spatial(
                epoch, handles, states, animations, spatial,
            )
        {
            self.spatial_scene.environment = previous;
            return false;
        }
        true
    }
    /// Captures current native camera and poses in one owned numeric buffer, independent of the last render.
    pub fn capture_data_scene_spatial_progress(&self, epoch: u32, handles: &[u32]) -> Vec<f64> {
        if epoch == 0 || self.data_scene_epoch() != epoch || !handles.len().is_multiple_of(2) {
            return vec![];
        }
        let mut result = Vec::with_capacity(CAMERA_VALUES + handles.len() / 2 * POSE_VALUES);
        if let Some(camera) = self.spatial_scene.camera {
            result.push(1.0);
            result.extend(camera.parameters.map(f64::from));
        } else {
            result.extend([0.0; CAMERA_VALUES]);
        }
        for h in handles.chunks_exact(2) {
            let entity = Entity {
                id: h[0],
                generation: h[1],
            };
            if self.spatial_scene.camera.is_none()
                || !self.spatial_scene.bindings.contains_key(&(h[0], h[1]))
                || !self.world.is_current_entity(entity)
            {
                result.extend([0.0; POSE_VALUES]);
                continue;
            }
            let Some(at) = self.world.transform(entity) else {
                return vec![];
            };
            let span = self.world.height_span(entity);
            result.extend([
                1.0,
                f64::from(at.x),
                f64::from(at.y),
                f64::from(u8::from(span.is_some())),
                span.map_or(0.0, |s| f64::from(s.floor.0)),
                span.map_or(0.0, |s| f64::from(s.elevation)),
                span.map_or(0.0, |s| f64::from(s.height)),
                span.and_then(|s| self.spatial_scene.support_surface_id(at, s))
                    .map_or(0.0, f64::from),
            ]);
        }
        result
    }

    /// Validates saved geometry references before a destructive authoring activation.
    pub fn preflight_data_scene_spatial_progress(
        &self,
        terrain_values: &[f32],
        terrain_metadata: &[u32],
        values: &[f64],
    ) -> bool {
        let mut source = SpatialScene::default();
        source.configure_surfaces(terrain_values, terrain_metadata)
            && decode(
                &source,
                values,
                [self.camera.viewport_width, self.camera.viewport_height],
            )
            .is_some()
    }

    /// Validates flags, animation, poses, surface links and camera before any world mutation.
    pub fn restore_data_scene_progress_with_spatial(
        &mut self,
        epoch: u32,
        handles: &[u32],
        states: &[u32],
        animations: &[f64],
        spatial: &[f64],
    ) -> bool {
        if epoch == 0
            || self.data_scene_epoch() != epoch
            || !self.validate_data_scene_progress(handles, states)
            || (!animations.is_empty()
                && !self.validate_data_scene_animation_progress(handles, states, animations))
        {
            return false;
        }
        let Some(progress) = decode(
            &self.spatial_scene,
            spatial,
            [self.camera.viewport_width, self.camera.viewport_height],
        ) else {
            return false;
        };
        if progress
            .camera
            .as_ref()
            .is_some_and(|c| !self.spatial_scene.environment.camera_valid(c))
        {
            return false;
        }
        if progress.poses.len() != states.len() {
            return false;
        }
        for ((h, state), pose) in handles.chunks_exact(2).zip(states).zip(&progress.poses) {
            let entity = Entity {
                id: h[0],
                generation: h[1],
            };
            let bound = progress.camera.is_some()
                && self.spatial_scene.bindings.contains_key(&(h[0], h[1]));
            if pose.is_some() != (bound && *state != 0) {
                return false;
            }
            if let Some(pose) = pose {
                if (pose.span.is_some() && self.world.rigid_body(entity).is_none())
                    || (pose.span.is_none()
                        && self.spatial_scene.actor.is_some_and(|a| a.0 == entity))
                {
                    return false;
                }
            }
        }
        // Every operation below has been preflighted for this complete batch.
        for (h, pose) in handles.chunks_exact(2).zip(&progress.poses) {
            let Some(pose) = pose else {
                continue;
            };
            let entity = Entity {
                id: h[0],
                generation: h[1],
            };
            self.world.set_transform(entity, pose.at);
            match pose.span {
                Some(span) => {
                    self.world.set_height_span(entity, span);
                }
                None => {
                    self.world.clear_height_span(entity);
                }
            }
            self.world.set_velocity(entity, Velocity::default());
        }
        if progress.camera.is_some() {
            self.spatial_scene.camera = progress.camera;
        } else {
            self.spatial_scene.clear();
        }
        self.restore_data_scene_progress(epoch, handles, states);
        if !animations.is_empty() {
            self.apply_data_scene_animation_progress(handles, animations);
        }
        self.data_scene.movement.cancel();
        self.spatial_scene.navigation = Default::default();
        self.input = crate::input::InputState::default();
        self.clear_physics_history();
        self.frame_buffers.clear_scene_output();
        self.spatial_scene.billboards.clear();
        self.spatial_scene.terrain_draw_ranges.clear();
        self.spatial_scene.debug.reset();
        self.spatial_scene.frame_active = false;
        true
    }
}

fn decode(source: &SpatialScene, values: &[f64], viewport: [f32; 2]) -> Option<SpatialProgress> {
    if values.len() < CAMERA_VALUES || !(values.len() - CAMERA_VALUES).is_multiple_of(POSE_VALUES) {
        return None;
    }
    if values[..CAMERA_VALUES].iter().any(|v| !v.is_finite()) {
        return None;
    }
    let camera = match values[0] {
        0.0 if values[..CAMERA_VALUES].iter().all(|v| *v == 0.0) => None,
        1.0 => {
            let mut camera: [f32; 12] = std::array::from_fn(|i| values[i + 1] as f32);
            camera[10..12].copy_from_slice(&viewport);
            Some(SpatialCamera::new(&camera)?)
        }
        _ => return None,
    };
    let mut poses = Vec::with_capacity((values.len() - CAMERA_VALUES) / POSE_VALUES);
    for record in values[CAMERA_VALUES..].chunks_exact(POSE_VALUES) {
        if record[0] == 0.0 && record.iter().all(|v| *v == 0.0) {
            poses.push(None);
            continue;
        }
        if record[0] != 1.0 || camera.is_none() || record.iter().any(|v| !v.is_finite()) {
            return None;
        }
        let at = Transform2D {
            x: record[1] as f32,
            y: record[2] as f32,
        };
        if !at.x.is_finite() || !at.y.is_finite() {
            return None;
        }
        let span = match record[3] {
            0.0 if record[4..].iter().all(|v| *v == 0.0) => None,
            1.0 => {
                let span = HeightSpan::new(
                    PhysicsFloorId(integer(record[4], u32::MAX)?),
                    record[5] as f32,
                    record[6] as f32,
                )?;
                if !span.top().is_finite() {
                    return None;
                }
                let surface = integer(record[7], 65535)?;
                if surface != 0 && source.support_surface_id(at, span) != Some(surface) {
                    return None;
                }
                Some(span)
            }
            _ => return None,
        };
        poses.push(Some(SpatialPose { at, span }));
    }
    Some(SpatialProgress { camera, poses })
}

fn integer(value: f64, max: u32) -> Option<u32> {
    (value.is_finite() && value >= 0.0 && value <= f64::from(max) && value.fract() == 0.0)
        .then_some(value as u32)
}

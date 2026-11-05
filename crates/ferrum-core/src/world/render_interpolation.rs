use super::*;
use crate::components::RigidBodyType;

#[derive(Clone, Copy, PartialEq)]
struct Pose {
    entity: Entity,
    at: Transform2D,
    rotation: Rotation2D,
    height: Option<HeightSpan>,
}

#[derive(Clone, Default)]
pub(super) struct RenderHistory {
    before: Vec<Option<Pose>>,
    after: Vec<Option<Pose>>,
    alpha: Option<f32>,
    // Native/derived pose pairs validate generations and teleports without touching simulation.
    attachments: Vec<Option<(Pose, Pose)>>,
}

impl World {
    pub(crate) fn reset_render_interpolation(&mut self) {
        self.render_history.before.clear();
        self.render_history.after.clear();
        self.render_history.alpha = None;
        self.render_history.attachments.clear();
    }

    pub(crate) fn begin_render_interpolation_step(&mut self) {
        self.render_history
            .before
            .resize(self.transforms.len(), None);
        self.render_history.before.fill(None);
        for position in 0..self.alive_indices.len() {
            let i = self.alive_indices[position];
            if let Some(pose) = self.physics_render_pose(i) {
                self.render_history.before[i] = Some(pose);
            }
        }
    }

    pub(crate) fn end_render_interpolation_step(&mut self) {
        self.render_history
            .after
            .resize(self.transforms.len(), None);
        self.render_history.after.fill(None);
        for position in 0..self.alive_indices.len() {
            let i = self.alive_indices[position];
            if let Some(pose) = self.physics_render_pose(i) {
                self.render_history.after[i] = Some(pose);
            }
        }
    }

    pub(crate) fn set_render_interpolation_alpha(&mut self, alpha: Option<f32>) {
        self.render_history.attachments.clear();
        self.render_history.alpha = alpha.filter(|a| a.is_finite()).map(|a| a.clamp(0.0, 1.0));
    }

    pub(crate) fn begin_render_attachment_poses(&mut self) -> bool {
        self.render_history.attachments.clear();
        self.render_history.alpha.is_some()
    }

    pub(crate) fn set_render_attachment_pose(
        &mut self,
        entity: Entity,
        at: Transform2D,
        rotation: Rotation2D,
        height: Option<HeightSpan>,
    ) {
        let index = entity.id as usize;
        let Some(native) = self
            .current_render_pose(index)
            .filter(|p| p.entity == entity)
        else {
            return;
        };
        self.render_history
            .attachments
            .resize(self.transforms.len(), None);
        self.render_history.attachments[index] = Some((
            native,
            Pose {
                entity,
                at,
                rotation,
                height,
            },
        ));
    }

    fn physics_render_pose(&self, index: usize) -> Option<Pose> {
        let body = self.rigid_bodies.get(index).copied().flatten()?;
        if !body.enabled || body.body_type == RigidBodyType::Static {
            return None;
        }
        self.current_render_pose(index)
    }

    fn current_render_pose(&self, index: usize) -> Option<Pose> {
        Some(Pose {
            entity: self.entity_at_index(index)?,
            at: self.transform_at_index(index)?,
            rotation: self.rotation_at_index_or_default(index),
            height: self.height_span_at(index),
        })
    }

    fn interpolated_render_pose(&self, index: usize) -> Option<Pose> {
        let alpha = self.render_history.alpha?;
        if let Some((native, rendered)) = self
            .render_history
            .attachments
            .get(index)
            .copied()
            .flatten()
        {
            if self.current_render_pose(index)? == native {
                return Some(rendered);
            }
        }
        let before = self.render_history.before.get(index).copied().flatten()?;
        let after = self.render_history.after.get(index).copied().flatten()?;
        // Teleports, restores and recycled entity slots invalidate the sample.
        if before.entity != after.entity || self.physics_render_pose(index)? != after {
            return None;
        }
        let angle = (after.rotation.radians - before.rotation.radians + std::f32::consts::PI)
            .rem_euclid(std::f32::consts::TAU)
            - std::f32::consts::PI;
        Some(Pose {
            entity: after.entity,
            height: match (before.height, after.height) {
                (Some(a), Some(mut b)) if a.floor == b.floor => {
                    b.elevation = a.elevation + (b.elevation - a.elevation) * alpha;
                    Some(b)
                }
                (_, height) => height,
            },
            at: Transform2D {
                x: before.at.x + (after.at.x - before.at.x) * alpha,
                y: before.at.y + (after.at.y - before.at.y) * alpha,
            },
            rotation: Rotation2D {
                radians: before.rotation.radians + angle * alpha,
            },
        })
    }

    pub(crate) fn render_transform_at_index(&self, index: usize) -> Option<Transform2D> {
        self.interpolated_render_pose(index)
            .map(|p| p.at)
            .or_else(|| self.transform_at_index(index))
    }

    pub(crate) fn render_height_span_at(&self, index: usize) -> Option<HeightSpan> {
        self.interpolated_render_pose(index)
            .map_or_else(|| self.height_span_at(index), |p| p.height)
    }

    pub(crate) fn render_rotation_at_index(&self, index: usize) -> Rotation2D {
        self.interpolated_render_pose(index)
            .map(|p| p.rotation)
            .unwrap_or_else(|| self.rotation_at_index_or_default(index))
    }
}

//! Render-time view of explicit spatial bindings; native physics keeps pose ownership.
use super::UnifiedPhysicsRuntime;
use crate::{
    entity::Entity,
    physics3d::{Pose, Space},
};

impl UnifiedPhysicsRuntime {
    /// Use the complete current pose for native models, including translation, so
    /// a current quaternion never accompanies an interpolated projected position.
    /// Other presentation paths retain their existing interpolation semantics.
    pub(in crate::engine) fn spatial_model_pose(&self, entity: Entity) -> Option<Pose> {
        if self.physics.config().space != Space::Spatial {
            return None;
        }
        let binding = self.bindings.get(&(entity.id, entity.generation))?;
        if binding.legacy.is_some() {
            return None;
        }
        let mut pose = self.physics.body_state(binding.body).ok()?.pose;
        for (position, offset) in pose.position.iter_mut().zip(binding.render_offset) {
            *position += offset;
        }
        Some(pose)
    }
}

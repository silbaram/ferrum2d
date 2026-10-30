use wasm_bindgen::prelude::*;

use super::Engine;
use crate::entity::Entity;

pub(super) const MAX_AUDIO_POSES: usize = 65;

/// Independent audio presentation query ABI: four u32 words followed by four f32 words.
#[derive(Clone, Copy, Default)]
#[repr(C)]
pub(super) struct AudioPose {
    valid: u32,
    entity_id: u32,
    generation: u32,
    floor: u32,
    x: f32,
    y: f32,
    elevation: f32,
    yaw: f32,
}
const _: () = assert!(std::mem::size_of::<AudioPose>() == 32);
const _: () = assert!(std::mem::align_of::<AudioPose>() == 4);

#[wasm_bindgen]
impl Engine {
    /// Read-only simulation query; one output row per input handle, including stale handles.
    pub fn query_audio_poses(&mut self, handles: &[u32]) -> bool {
        self.frame_buffers.audio_poses.clear();
        if !handles.len().is_multiple_of(2) || handles.len() / 2 > MAX_AUDIO_POSES {
            return false;
        }
        for handle in handles.chunks_exact(2) {
            let entity = Entity {
                id: handle[0],
                generation: handle[1],
            };
            let mut pose = AudioPose {
                entity_id: entity.id,
                generation: entity.generation,
                ..AudioPose::default()
            };
            if let Some(at) = self.world.transform(entity) {
                let elevation = self.world.height_span(entity).map_or(0.0, |s| s.elevation);
                let yaw = self.world.rotation(entity).map_or(0.0, |r| r.radians);
                if at.x.is_finite() && at.y.is_finite() && elevation.is_finite() && yaw.is_finite()
                {
                    pose.valid = 1;
                    pose.floor = self.world.height_span(entity).map_or(0, |s| s.floor.0);
                    pose.x = at.x;
                    pose.y = at.y;
                    pose.elevation = elevation;
                    pose.yaw = yaw;
                }
            }
            self.frame_buffers.audio_poses.push(pose);
        }
        true
    }

    pub fn audio_pose_buffer_ptr(&self) -> *const u8 {
        self.frame_buffers.audio_poses.as_ptr().cast()
    }
    pub fn audio_pose_buffer_count(&self) -> usize {
        self.frame_buffers.audio_poses.len()
    }
    pub fn audio_pose_stride_words(&self) -> usize {
        8
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{HeightSpan, PhysicsFloorId, RigidBody, Rotation2D, Transform2D};

    #[test]
    fn bulk_audio_poses_preserve_order_height_generation_and_storage() {
        let mut engine = Engine::new();
        let a = engine.world.spawn_entity();
        let b = engine.world.spawn_entity();
        engine
            .world
            .set_transform(a, Transform2D { x: 12.0, y: -8.0 });
        engine
            .world
            .set_transform(b, Transform2D { x: 4.0, y: 6.0 });
        engine
            .world
            .set_height_span(a, HeightSpan::new(PhysicsFloorId(2), 64.0, 20.0).unwrap());
        engine.world.set_rotation(a, Rotation2D { radians: 0.5 });
        // Physics participation is independent of ambient audio presentation.
        engine
            .world
            .set_rigid_body(b, RigidBody::static_body().with_enabled(false));
        let pointer = engine.audio_pose_buffer_ptr();
        assert!(engine.query_audio_poses(&[a.id, a.generation, b.id, b.generation]));
        let p = &engine.frame_buffers.audio_poses[0];
        assert_eq!(
            (p.valid, p.floor, p.x, p.y, p.elevation, p.yaw),
            (1, 2, 12.0, -8.0, 64.0, 0.5)
        );
        engine.world.despawn(a);
        assert!(engine.query_audio_poses(&[a.id, a.generation, b.id, b.generation]));
        assert_eq!(engine.frame_buffers.audio_poses[0].valid, 0);
        assert_eq!(engine.frame_buffers.audio_poses[1].valid, 1);
        assert_eq!(engine.audio_pose_buffer_ptr(), pointer);
        assert!(engine.query_audio_poses(&vec![b.id; MAX_AUDIO_POSES * 2]));
        assert_eq!(engine.audio_pose_buffer_ptr(), pointer);
        assert!(!engine.query_audio_poses(&[1]));
        assert_eq!(engine.audio_pose_buffer_count(), 0);
        assert!(!engine.query_audio_poses(&vec![0; (MAX_AUDIO_POSES + 1) * 2]));
        assert_eq!(std::mem::offset_of!(AudioPose, x), 16);
    }
}

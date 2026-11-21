use super::{entity, validate_handles, vectors, Engine, UnifiedPhysicsError};
use crate::physics3d::{BodyId, PhysicsError, PhysicsWorld3d, Pose};
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy)]
enum Command {
    Pose,
    Target,
    Force,
    ClearForces,
    Impulse,
    Sleep,
    Wake,
}

fn pose(v: &[f32]) -> Pose {
    Pose {
        position: [v[0], v[1], v[2]],
        rotation: [v[3], v[4], v[5], v[6]],
    }
}

impl Command {
    fn decode(code: u32) -> Result<Self, String> {
        match code {
            0 => Ok(Self::Pose),
            1 => Ok(Self::Target),
            2 => Ok(Self::Force),
            3 => Ok(Self::ClearForces),
            4 => Ok(Self::Impulse),
            5 => Ok(Self::Sleep),
            6 => Ok(Self::Wake),
            _ => Err("Unknown unified physics body command".into()),
        }
    }
    fn stride(self) -> usize {
        match self {
            Self::Pose | Self::Target => 7,
            Self::Force | Self::Impulse => 6,
            Self::ClearForces | Self::Sleep | Self::Wake => 0,
        }
    }
    fn validate(self, world: &PhysicsWorld3d, id: BodyId, v: &[f32]) -> Result<(), PhysicsError> {
        match self {
            Self::Pose => world.validate_pose(id, pose(v)),
            Self::Target => world.validate_kinematic_target(id, pose(v)),
            Self::Force | Self::Impulse => {
                let (linear, angular) = vectors(v);
                world.validate_dynamic_motion(id, linear, angular)
            }
            Self::ClearForces => world.body_state(id).map(|_| ()),
            Self::Sleep | Self::Wake => world.validate_dynamic_body(id),
        }
    }
    fn apply(self, world: &mut PhysicsWorld3d, id: BodyId, v: &[f32]) -> Result<(), PhysicsError> {
        match self {
            Self::Pose => world.set_pose(id, pose(v)),
            Self::Target => world.set_kinematic_target(id, pose(v)),
            Self::Force => {
                let (force, torque) = vectors(v);
                world.add_force(id, force, torque)
            }
            Self::ClearForces => world.clear_forces(id),
            Self::Impulse => {
                let (linear, angular) = vectors(v);
                world.apply_impulse(id, linear)?;
                world.apply_torque_impulse(id, angular)
            }
            Self::Sleep => world.set_sleeping(id, true),
            Self::Wake => world.set_sleeping(id, false),
        }
    }
}

#[wasm_bindgen]
impl Engine {
    /// Version 1 body command layout, independent of body/state/character capabilities.
    pub fn unified_physics_command_version(&self) -> u32 {
        1
    }

    /// Atomic admission of homogeneous commands, at most 65536 id/generation rows.
    /// Codes: pose=0, kinematic target=1, force/torque=2, clear forces=3,
    /// linear/angular impulse=4, sleep=5, wake=6. Poses use seven f32s, dynamics six,
    /// clear/sleep/wake zero. Duplicate poses/targets use the last row; forces/impulses add.
    pub fn command_unified_physics_bodies(
        &mut self,
        code: u32,
        handles: &[u32],
        values: &[f32],
    ) -> Result<(), String> {
        let command = Command::decode(code)?;
        validate_handles(handles)?;
        let stride = command.stride();
        if values.len() != handles.len() / 2 * stride {
            return Err("Invalid unified physics body command row length".into());
        }
        let runtime = self
            .unified_physics
            .as_ref()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?;
        for (i, h) in handles.chunks_exact(2).enumerate() {
            let id = self.unified_body_id(entity(h)).map_err(|e| e.to_string())?;
            command
                .validate(&runtime.physics, id, &values[i * stride..(i + 1) * stride])
                .map_err(|e| e.to_string())?;
        }
        // Admission cannot change identity, kind, capsule configuration or locked axes.
        // No allocation proportional to the batch or entity-wise Web/Wasm calls are needed.
        for (i, h) in handles.chunks_exact(2).enumerate() {
            let e = entity(h);
            let id = self.unified_body_id(e).map_err(|e| e.to_string())?;
            let runtime = self
                .unified_physics
                .as_mut()
                .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?;
            command
                .apply(
                    &mut runtime.physics,
                    id,
                    &values[i * stride..(i + 1) * stride],
                )
                .map_err(|e| e.to_string())?;
            runtime
                .write_entity(&mut self.world, e)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

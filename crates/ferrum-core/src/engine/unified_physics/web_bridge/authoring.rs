use super::{shapes, Engine};
use crate::entity::Entity;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, ContactCorrection, Pose};
use wasm_bindgen::prelude::*;

pub(super) fn pose(values: &[f32]) -> Pose {
    Pose {
        position: [values[0], values[1], values[2]],
        rotation: [values[3], values[4], values[5], values[6]],
    }
}
pub(super) fn v3(values: &[f32]) -> [f32; 3] {
    [values[0], values[1], values[2]]
}

pub(super) fn body_kind(code: u32) -> Result<BodyKind, String> {
    match code {
        0 => Ok(BodyKind::Fixed),
        1 => Ok(BodyKind::Dynamic),
        2 => Ok(BodyKind::KinematicPosition),
        3 => Ok(BodyKind::KinematicVelocity),
        _ => Err("Invalid unified physics body kind".into()),
    }
}

/// Collider-only setup payload: flags/category/mask and pose/material/surface/correction.
pub(super) fn collider(
    metadata: &[u32],
    values: &[f32],
    shape_metadata: &[u32],
    shape_values: &[f32],
) -> Result<ColliderDesc, String> {
    if metadata.len() != 3
        || values.len() != 18
        || values.iter().any(|v| !v.is_finite())
        || metadata[0] & !7 != 0
        || (metadata[0] & 2 == 0
            && (metadata[0] & 4 != 0 || values[13..].iter().any(|v| *v != 0.0)))
    {
        return Err("Invalid unified physics collider payload".into());
    }
    Ok(ColliderDesc {
        pose: pose(values),
        density: values[7],
        friction: values[8],
        restitution: values[9],
        surface_velocity: v3(&values[10..]),
        sensor: metadata[0] & 1 != 0,
        category: metadata[1],
        mask: metadata[2],
        contact_correction: (metadata[0] & 2 != 0).then_some(ContactCorrection {
            velocity_rate: values[13],
            max_velocity: values[14],
            position_rate: values[15],
            position_slop: values[16],
            velocity_slop: values[17],
            split_impulse: metadata[0] & 4 != 0,
        }),
        shape: shapes::decode(shape_metadata, shape_values)?,
    })
}

pub(super) fn decode_body(
    metadata: &[u32],
    values: &[f32],
    shape_metadata: &[u32],
    shape_values: &[f32],
) -> Result<(BodyDesc, ColliderDesc, [f32; 3]), String> {
    if metadata.len() != 4
        || values.len() != 37
        || values.iter().any(|v| !v.is_finite())
        || metadata[1] & !31 != 0
        || (metadata[1] & 8 == 0
            && (metadata[1] & 16 != 0 || values[32..].iter().any(|v| *v != 0.0)))
    {
        return Err("Invalid unified physics body payload".into());
    }
    let kind = body_kind(metadata[0])?;
    let desc = BodyDesc {
        kind,
        pose: pose(values),
        linear_velocity: v3(&values[7..]),
        angular_velocity: v3(&values[10..]),
        gravity_scale: values[13],
        linear_damping: values[14],
        angular_damping: values[15],
        ccd: metadata[1] & 1 != 0,
        can_sleep: metadata[1] & 2 != 0,
    };
    let mut collider_values = [0.0; 18];
    collider_values[..13].copy_from_slice(&values[16..29]);
    collider_values[13..].copy_from_slice(&values[32..]);
    let collider = collider(
        &[metadata[1] >> 2, metadata[2], metadata[3]],
        &collider_values,
        shape_metadata,
        shape_values,
    )?;
    Ok((desc, collider, v3(&values[29..])))
}

#[wasm_bindgen]
impl Engine {
    /// Additive authoring capability; the version 1 world/state/velocity ABI is unchanged.
    pub fn unified_physics_authoring_version(&self) -> u32 {
        1
    }

    /// Setup-only body and one collider creation. Metadata: kind, flags, category, mask.
    /// Flags: CCD=1, sleep=2, sensor=4, explicit correction=8, split impulse=16.
    /// Values: body pose(7), velocity(6), gravity/damping(3), collider pose(7),
    /// density/friction/restitution(3), surface velocity(3), visual offset(3), correction(5).
    /// Shape codes 0..6: box, sphere, capsule, convex hull, mesh, heightfield, compound.
    pub fn spawn_unified_physics_body(
        &mut self,
        metadata: &[u32],
        values: &[f32],
        shape_metadata: &[u32],
        shape_values: &[f32],
    ) -> Result<Vec<u32>, String> {
        let (desc, collider, offset) = decode_body(metadata, values, shape_metadata, shape_values)?;
        self.create_unified_body(desc, collider, offset)
            .map(|e| vec![e.id, e.generation])
            .map_err(|e| e.to_string())
    }

    /// Removes the bound body, joints, controller and render/gameplay entity immediately.
    pub fn remove_unified_physics_body(&mut self, id: u32, generation: u32) -> Result<(), String> {
        self.remove_unified_body(Entity { id, generation })
            .map_err(|e| e.to_string())
    }
}

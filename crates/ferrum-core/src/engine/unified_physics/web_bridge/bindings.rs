use super::{authoring::decode_body, Engine};
use crate::entity::Entity;
use wasm_bindgen::prelude::*;
#[wasm_bindgen]
impl Engine {
    pub fn unified_physics_binding_version(&self) -> u32 {
        1
    }
    /// Same numeric body/shape descriptor as spawn; entity id/generation remain unchanged.
    pub fn bind_unified_physics_body(
        &mut self,
        handles: &[u32],
        metadata: &[u32],
        values: &[f32],
        shape_metadata: &[u32],
        shape_values: &[f32],
    ) -> Result<(), String> {
        if handles.len() != 2 {
            return Err("Unified binding requires one entity identity".into());
        }
        let (body, collider, offset) = decode_body(metadata, values, shape_metadata, shape_values)?;
        self.bind_unified_body(
            Entity {
                id: handles[0],
                generation: handles[1],
            },
            body,
            collider,
            offset,
        )
        .map_err(|e| e.to_string())
    }
    pub fn unbind_unified_physics_body(&mut self, id: u32, generation: u32) -> Result<(), String> {
        self.unbind_unified_body(Entity { id, generation })
            .map_err(|e| e.to_string())
    }
}
#[cfg(test)]
mod tests;

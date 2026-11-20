use super::{entity, validate_handles, Engine};
use crate::engine::unified_physics::{joint_stream::JointRecord, UnifiedPhysicsRuntime};
use crate::physics3d::{JointDesc, JointId};
use wasm_bindgen::prelude::*;
mod codec;

fn editable(r: &UnifiedPhysicsRuntime, id: JointId) -> Result<(), String> {
    r.physics.joint_desc(id).map_err(|e| e.to_string())?;
    if r.legacy_joints.values().any(|j| j.native == id) {
        return Err("Unified joint is owned by an authored component".into());
    }
    Ok(())
}
fn record(r: &UnifiedPhysicsRuntime, id: JointId) -> Result<JointRecord, String> {
    let d = r.physics.joint_desc(id).map_err(|e| e.to_string())?;
    let state = r.physics.joint_state(id).map_err(|e| e.to_string())?;
    let mut row = JointRecord::new(
        id,
        codec::kind_code(&d.kind),
        d.body_a,
        d.body_b,
        state,
        &r.entities_by_body,
    );
    row.flags |= (u32::from(d.enabled) << 2) | (u32::from(d.contacts_enabled) << 3);
    Ok(row)
}
impl Engine {
    fn decode_web_joint(
        &self,
        handles: &[u32],
        metadata: &[u32],
        values: &[f32],
    ) -> Result<JointDesc, String> {
        if handles.len() != 4 {
            return Err("Unified joint requires two entity id/generation pairs".into());
        }
        let a = self
            .unified_body_id(entity(handles))
            .map_err(|e| e.to_string())?;
        let b = self
            .unified_body_id(entity(&handles[2..]))
            .map_err(|e| e.to_string())?;
        codec::decode(a, b, metadata, values)
    }
}
#[wasm_bindgen]
impl Engine {
    pub fn unified_physics_joint_version(&self) -> u32 {
        1
    }
    /// Setup-only creation of any native joint kind. Handles are endpoint entity pairs.
    pub fn create_unified_physics_joint(
        &mut self,
        handles: &[u32],
        metadata: &[u32],
        values: &[f32],
    ) -> Result<Vec<u32>, String> {
        let desc = self.decode_web_joint(handles, metadata, values)?;
        let r = self
            .unified_physics
            .as_mut()
            .ok_or("Unified physics is not configured")?;
        let id = r.physics.create_joint(desc).map_err(|e| e.to_string())?;
        Ok(vec![id.slot, id.generation])
    }
    /// Full replacement, retaining joint identity and endpoints. Native validation is atomic.
    /// Authored component-owned joints must be changed through their source component.
    pub fn update_unified_physics_joint(
        &mut self,
        handles: &[u32],
        metadata: &[u32],
        values: &[f32],
    ) -> Result<(), String> {
        if handles.len() != 6 {
            return Err("Unified joint update requires joint and two entity identities".into());
        }
        let id = JointId {
            slot: handles[0],
            generation: handles[1],
        };
        let desc = self.decode_web_joint(&handles[2..], metadata, values)?;
        let r = self
            .unified_physics
            .as_mut()
            .ok_or("Unified physics is not configured")?;
        editable(r, id)?;
        r.physics.update_joint(id, desc).map_err(|e| e.to_string())
    }
    pub fn remove_unified_physics_joint(
        &mut self,
        slot: u32,
        generation: u32,
    ) -> Result<(), String> {
        let r = self
            .unified_physics
            .as_mut()
            .ok_or("Unified physics is not configured")?;
        let id = JointId { slot, generation };
        editable(r, id)?;
        r.physics.remove_joint(id).map_err(|e| e.to_string())?;
        r.joint_stream.capture(
            &mut r.physics,
            &r.entities_by_body,
            &mut r.native_joint_events,
        );
        Ok(())
    }
    /// No stepping or geometry synchronization. Explicit requests preserve order/duplicates,
    /// at most 65536 identities. `all` requires an empty input and returns every live joint.
    /// Any rejected identity clears the whole output, never a partially successful batch.
    pub fn query_unified_physics_joints(
        &mut self,
        handles: &[u32],
        all: bool,
    ) -> Result<(), String> {
        self.unified_physics_joints.states.clear();
        validate_handles(handles)?;
        if all && !handles.is_empty() {
            return Err("All-joint query requires empty handles".into());
        }
        let r = self
            .unified_physics
            .as_ref()
            .ok_or("Unified physics is not configured")?;
        if all {
            for id in r.physics.joint_ids() {
                self.unified_physics_joints.states.push(record(r, id)?);
            }
        } else {
            // Admission before filling reusable output preserves clear-on-error behavior.
            for h in handles.chunks_exact(2) {
                r.physics
                    .joint_state(JointId {
                        slot: h[0],
                        generation: h[1],
                    })
                    .map_err(|e| e.to_string())?;
            }
            for h in handles.chunks_exact(2) {
                self.unified_physics_joints.states.push(record(
                    r,
                    JointId {
                        slot: h[0],
                        generation: h[1],
                    },
                )?);
            }
        }
        Ok(())
    }
    /// Opt-in independent queue. Repeating the enabled state retains queued events.
    pub fn set_unified_physics_joint_events_enabled(
        &mut self,
        enabled: bool,
    ) -> Result<(), String> {
        let r = self
            .unified_physics
            .as_mut()
            .ok_or("Unified physics is not configured")?;
        r.joint_stream.capture(
            &mut r.physics,
            &r.entities_by_body,
            &mut r.native_joint_events,
        );
        r.joint_stream.set_enabled(enabled);
        Ok(())
    }
    /// Native break/removal events, preserving entity and body generations before retirement.
    /// This does not consume pending legacy diagnostics or step the world.
    pub fn drain_unified_physics_joint_events(&mut self) -> Result<(), String> {
        self.unified_physics_joints.events.clear();
        self.unified_physics_joints.dropped_native = 0;
        self.unified_physics_joints.dropped_events = 0;
        let r = self
            .unified_physics
            .as_mut()
            .ok_or("Unified physics is not configured")?;
        r.joint_stream.capture(
            &mut r.physics,
            &r.entities_by_body,
            &mut r.native_joint_events,
        );
        r.joint_stream.drain(&mut self.unified_physics_joints);
        Ok(())
    }
    pub fn unified_physics_joint_stride_words(&self) -> usize {
        14
    }
    pub fn unified_physics_joint_count(&self, events: bool) -> usize {
        if events {
            self.unified_physics_joints.events.len()
        } else {
            self.unified_physics_joints.states.len()
        }
    }
    pub fn unified_physics_joint_ptr(&self, events: bool) -> *const u32 {
        if events {
            self.unified_physics_joints.events.as_ptr().cast()
        } else {
            self.unified_physics_joints.states.as_ptr().cast()
        }
    }
    pub fn unified_physics_joint_dropped_native(&self) -> u32 {
        self.unified_physics_joints.dropped_native
    }
    pub fn unified_physics_joint_dropped_events(&self) -> u32 {
        self.unified_physics_joints.dropped_events
    }
}
#[cfg(test)]
mod tests;

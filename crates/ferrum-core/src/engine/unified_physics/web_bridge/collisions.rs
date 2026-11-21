use super::Engine;
use crate::engine::unified_physics::collision_stream::CollisionRecord;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    /// V1: 22 u32 words per collider transition or active pair. No per-pair JS calls.
    pub fn unified_physics_collision_version(&self) -> u32 {
        1
    }

    /// Opt-in bounded native collider stream, independent of entity lifecycle telemetry.
    /// Changing enabled state discards its queue; repeating the same state preserves it.
    /// Existing overlaps can be recovered with the active pair snapshot (no synthetic enters).
    pub fn set_unified_physics_collision_events_enabled(
        &mut self,
        enabled: bool,
    ) -> Result<(), String> {
        self.unified_physics
            .as_mut()
            .ok_or("Unified physics is not configured")?
            .lifecycle
            .stream
            .set_enabled(enabled);
        Ok(())
    }

    /// Drains queued transitions without stepping, synchronizing geometry or consuming
    /// the separate entity lifecycle stream. Both drop counters reset on drain.
    pub fn drain_unified_physics_collision_events(&mut self) -> Result<(), String> {
        self.unified_physics_collisions.clear();
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or("Unified physics is not configured")?;
        runtime
            .lifecycle
            .stream
            .drain(&mut self.unified_physics_collisions);
        Ok(())
    }

    /// Full active collider snapshot for overflow recovery, even with streaming disabled.
    /// Reflects the last completed step plus explicit removals; does not drain transitions.
    /// Snapshot storage grows with the active pair count, independently of max_events.
    pub fn query_unified_physics_collision_pairs(&mut self) -> Result<(), String> {
        let out = &mut self.unified_physics_collisions;
        out.clear();
        let runtime = self
            .unified_physics
            .as_ref()
            .ok_or("Unified physics is not configured")?;
        runtime.physics.active_collision_pairs(&mut out.active);
        out.rows.extend(out.active.iter().map(|pair| {
            CollisionRecord::active(
                *pair,
                &runtime.entities_by_body,
                &runtime.terrain.by_collider,
            )
        }));
        Ok(())
    }

    pub fn unified_physics_collision_stride_words(&self) -> usize {
        22
    }
    pub fn unified_physics_collision_count(&self) -> usize {
        self.unified_physics_collisions.rows.len()
    }
    pub fn unified_physics_collision_ptr(&self) -> *const u32 {
        self.unified_physics_collisions.rows.as_ptr().cast()
    }
    pub fn unified_physics_collision_dropped_transitions(&self) -> u32 {
        self.unified_physics_collisions.dropped_transitions
    }
    pub fn unified_physics_collision_dropped_events(&self) -> u32 {
        self.unified_physics_collisions.dropped_events
    }
}

#[cfg(test)]
mod tests;

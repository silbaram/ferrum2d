use super::Engine;
use crate::engine::unified_physics::{collision_stream::Participant, observations::*};
use wasm_bindgen::prelude::*;

fn count(value: usize) -> u32 {
    value.min(u32::MAX as usize) as u32
}

fn diagnostics(
    runtime: &crate::engine::unified_physics::UnifiedPhysicsRuntime,
) -> DiagnosticsRecord {
    let frame = runtime.statistics.frame;
    DiagnosticsRecord {
        backend: 1,
        capabilities: 1,
        fixed_steps: frame.fixed_steps,
        authored_joint_breaks: frame.authored_joint_breaks,
        ccd_observations_dropped: frame.ccd_observations_dropped,
        solved_contacts: count(runtime.contacts.diagnostics.solved_contacts),
        impulses_dropped: count(runtime.contacts.diagnostics.dropped),
        step: runtime.physics.step_statistics(),
        frame: frame.totals,
    }
}

#[wasm_bindgen]
impl Engine {
    /// V1: manifold/point/impulse/CCD/diagnostics rows have 27/7/32/28/71 words.
    pub fn unified_physics_observations_version(&self) -> u32 {
        1
    }

    /// Current geometric contacts, including entity-less terrain. Output is a complete
    /// manifold prefix bounded by both limits; geometry work itself is not capped.
    /// Any error clears contact output. Does not advance simulation or consume forces.
    pub fn query_unified_physics_contacts(
        &mut self,
        category_a: u32,
        category_b: u32,
        include_sensors: bool,
        max_manifolds: u32,
        max_points: u32,
    ) -> Result<(), String> {
        self.unified_physics_observations.clear_contacts();
        if !(1..=65536).contains(&max_manifolds) || !(1..=65536).contains(&max_points) {
            return Err("Contact output limits must be in 1..=65536".into());
        }
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or("Unified physics is not configured")?;
        runtime
            .prepare_query(
                &mut self.world,
                self.auto_rigid_body_step_config,
                &self.tilemap,
                &self.spatial_scene,
            )
            .map_err(|e| e.to_string())?;
        runtime
            .physics
            .query_contact_manifolds(
                category_a,
                category_b,
                include_sensors,
                &mut runtime.native_contact_manifolds,
            )
            .map_err(|e| e.to_string())?;
        let out = &mut self.unified_physics_observations;
        out.total_manifolds = count(runtime.native_contact_manifolds.len());
        out.total_points = count(
            runtime
                .native_contact_manifolds
                .iter()
                .fold(0usize, |sum, m| sum.saturating_add(m.points.len())),
        );
        for m in &runtime.native_contact_manifolds {
            if out.manifolds.len() >= max_manifolds as usize
                || m.points.len() > max_points as usize - out.points.len()
            {
                out.truncated = true;
                break;
            }
            out.manifolds.push(ManifoldRecord {
                first: Participant::new(
                    m.first,
                    &runtime.entities_by_body,
                    &runtime.terrain.by_collider,
                ),
                second: Participant::new(
                    m.second,
                    &runtime.entities_by_body,
                    &runtime.terrain.by_collider,
                ),
                subshapes: [m.first_subshape, m.second_subshape],
                normal: m.normal,
                offset: count(out.points.len()),
                count: count(m.points.len()),
            });
            out.points.extend(m.points.iter().map(|p| PointRecord {
                first: p.first,
                second: p.second,
                penetration: p.penetration,
            }));
        }
        Ok(())
    }

    /// Copies last-tick impulses and current-frame CCD/statistics into reusable output.
    /// Identity was captured at solve time; removals/geometry queries cannot rewrite it.
    /// Does not drain or step. An error clears this output without touching contact queries.
    pub fn query_unified_physics_observations(&mut self) -> Result<(), String> {
        let out = &mut self.unified_physics_observations;
        out.clear_observations();
        let runtime = self
            .unified_physics
            .as_ref()
            .ok_or("Unified physics is not configured")?;
        out.impulses
            .extend_from_slice(&runtime.contacts.observations);
        out.clamps
            .extend_from_slice(&runtime.statistics.observations);
        out.diagnostics = diagnostics(runtime);
        Ok(())
    }

    /// Allocation-free statistics refresh for automatic frame sampling. False means
    /// no unified backend is configured; no legacy counters are synthesized.
    pub fn query_unified_physics_diagnostics(&mut self) -> bool {
        self.unified_physics_observations.diagnostics = self
            .unified_physics
            .as_ref()
            .map_or_else(DiagnosticsRecord::default, diagnostics);
        self.unified_physics.is_some()
    }

    /// Kind 0 manifolds, 1 points, 2 impulses, 3 CCD, 4 diagnostics. Unknown kind is empty.
    pub fn unified_physics_observation_stride_words(&self, kind: u32) -> usize {
        match kind {
            0 => 27,
            1 => 7,
            2 => 32,
            3 => 28,
            4 => 71,
            _ => 0,
        }
    }
    pub fn unified_physics_observation_count(&self, kind: u32) -> usize {
        let o = &self.unified_physics_observations;
        match kind {
            0 => o.manifolds.len(),
            1 => o.points.len(),
            2 => o.impulses.len(),
            3 => o.clamps.len(),
            4 => usize::from(o.diagnostics.backend == 1),
            _ => 0,
        }
    }
    pub fn unified_physics_observation_ptr(&self, kind: u32) -> *const u32 {
        let o = &self.unified_physics_observations;
        match kind {
            0 => o.manifolds.as_ptr().cast(),
            1 => o.points.as_ptr().cast(),
            2 => o.impulses.as_ptr().cast(),
            3 => o.clamps.as_ptr().cast(),
            4 => std::ptr::from_ref(&o.diagnostics).cast(),
            _ => std::ptr::null(),
        }
    }
    pub fn unified_physics_contacts_truncated(&self) -> bool {
        self.unified_physics_observations.truncated
    }
    pub fn unified_physics_contacts_total_manifolds(&self) -> u32 {
        self.unified_physics_observations.total_manifolds
    }
    pub fn unified_physics_contacts_total_points(&self) -> u32 {
        self.unified_physics_observations.total_points
    }
}

#[cfg(test)]
mod tests;

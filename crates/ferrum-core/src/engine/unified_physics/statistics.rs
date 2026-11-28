//! Native statistics mapped into Engine step/frame telemetry without estimating solver work.
use super::{Engine, UnifiedPhysicsError, UnifiedPhysicsRuntime};
use crate::components::RigidBodyCcdDebugHit;
use crate::entity::Entity;
use crate::physics::RigidBodyStepStats;
use crate::physics3d::{CcdClamp, Space, StepStatistics};
use crate::world::World;

/// CCD clamp with gameplay identities, retained until the next Engine frame begins.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct UnifiedCcdClamp {
    /// Entity whose body was clamped.
    pub moving: Entity,
    /// Entity whose collider limited motion.
    pub target: Entity,
    /// Full XYZ geometry, native identities and per-sweep fraction/duration.
    pub clamp: CcdClamp,
}

/// Current Engine frame's work counts. Body/island gauges in `totals` describe
/// the last completed tick (zero if none ran); work counts sum every tick.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct UnifiedPhysicsFrameStatistics {
    /// Completed native fixed ticks, including explicit manual steps in this frame.
    pub fixed_steps: u32,
    /// Summed work with final-tick body/island gauges.
    pub totals: StepStatistics,
    /// Authored planar joints broken by distance/angle limits, separate from native force breaks.
    pub authored_joint_breaks: u32,
    /// CCD evidence omitted at either native tick or Engine frame capacity.
    pub ccd_observations_dropped: u32,
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct Statistics {
    pub(super) frame: UnifiedPhysicsFrameStatistics,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub(super) observations: Vec<super::observations::CcdRecord>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    clamps: Vec<UnifiedCcdClamp>,
}

impl Statistics {
    /// Geometry precedes entity-only projection, so native tile/surface CCD is
    /// retained even when one participant has no gameplay entity.
    pub(super) fn debug_ccd_geometry(&self) -> impl Iterator<Item = ([f32; 3], [f32; 3])> + '_ {
        self.observations
            .iter()
            .map(|event| (event.point, event.normal))
    }
}

impl Engine {
    /// Last completed native fixed tick's direct backend measurements.
    /// Legacy row-operation counters (warm starts, block solves, correction rows)
    /// have no mapped native measurement and remain zero in the legacy getters.
    /// Use these explicit native fields for native telemetry instead of inferring
    /// unsupported legacy operations from contact point or manifold counts.
    pub fn unified_physics_step_statistics(&self) -> Result<StepStatistics, UnifiedPhysicsError> {
        Ok(self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .physics
            .step_statistics())
    }
    /// Current frame's native work counts and final observed body/island gauges.
    pub fn unified_physics_frame_statistics(
        &self,
    ) -> Result<UnifiedPhysicsFrameStatistics, UnifiedPhysicsError> {
        Ok(self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .statistics
            .frame)
    }
    /// Bounded CCD clamp evidence from every native fixed tick in this frame.
    /// Querying never steps or drains. An invalid/zero manual step adds nothing.
    pub fn unified_ccd_clamps(&self) -> Result<&[UnifiedCcdClamp], UnifiedPhysicsError> {
        Ok(&self
            .unified_physics
            .as_ref()
            .ok_or(UnifiedPhysicsError::NotConfigured)?
            .statistics
            .clamps)
    }
    pub(in crate::engine) fn begin_unified_statistics_frame(&mut self) {
        if let Some(r) = &mut self.unified_physics {
            r.statistics.frame = UnifiedPhysicsFrameStatistics::default();
            r.statistics.clamps.clear();
            r.statistics.observations.clear();
        }
    }
}

impl UnifiedPhysicsRuntime {
    pub(super) fn finish_statistics(
        &mut self,
        world: &mut World,
        authored_breaks: u32,
    ) -> RigidBodyStepStats {
        let step = self.physics.step_statistics();
        let frame = &mut self.statistics.frame;
        frame.fixed_steps = frame.fixed_steps.saturating_add(1);
        frame.authored_joint_breaks = frame.authored_joint_breaks.saturating_add(authored_breaks);
        frame.ccd_observations_dropped = frame
            .ccd_observations_dropped
            .saturating_add(step.ccd_clamps_dropped);
        let old = frame.totals;
        frame.totals = step;
        macro_rules! sum_work { ($($field:ident),* $(,)?) => { $(frame.totals.$field=old.$field.saturating_add(step.$field);)* }; }
        sum_work!(
            kinematic_character_stops,
            kinematic_path_casts,
            kinematic_path_failures,
            kinematic_path_stops,
            backend_steps,
            ccd_substeps,
            solver_contacts,
            solver_constraints,
            bodies_woken,
            bodies_put_to_sleep,
            broken_joints,
            ccd_prediction_checks,
            ccd_clamp_checks,
            ccd_clamps,
            ccd_clamps_dropped
        );
        for hit in self.physics.ccd_clamps() {
            if self.statistics.observations.len() >= 4096 {
                frame.ccd_observations_dropped = frame.ccd_observations_dropped.saturating_add(1);
                continue;
            }
            self.statistics
                .observations
                .push(super::observations::CcdRecord::new(
                    hit,
                    &self.entities_by_body,
                    &self.terrain.by_collider,
                ));
            let (Some(&moving), Some(&target)) = (
                self.entities_by_body.get(&hit.moving.body),
                self.entities_by_body.get(&hit.target.body),
            ) else {
                continue;
            };
            let project = |p: [f32; 3]| match self.physics.config().space {
                Space::PlanarXy => [p[0], p[1]],
                Space::Spatial => [p[0], -p[2]],
            };
            let point = project(hit.point);
            let normal = project(hit.normal);
            world.record_rigid_body_ccd_debug_hit(RigidBodyCcdDebugHit {
                moving_entity: moving,
                target_entity: target,
                time: hit.fraction,
                point_x: point[0],
                point_y: point[1],
                normal_x: normal[0],
                normal_y: normal[1],
            });
            self.statistics.clamps.push(UnifiedCcdClamp {
                moving,
                target,
                clamp: hit.clone(),
            });
        }
        // Only semantically supported legacy metrics are populated. All other fields
        // are reset, so switching backend cannot expose stale legacy solver work.
        RigidBodyStepStats {
            substeps: step.backend_steps,
            dynamic_bodies: step.dynamic_bodies,
            angular_bodies: step.angular_bodies,
            sleeping_bodies: step.sleeping_bodies,
            bodies_woken: step.bodies_woken,
            bodies_put_to_sleep: step.bodies_put_to_sleep,
            island_count: step.islands,
            island_bodies: step.island_bodies,
            active_islands: step.active_islands,
            sleeping_islands: step.sleeping_islands,
            largest_island_bodies: step.largest_island_bodies,
            ccd_checks: step
                .ccd_prediction_checks
                .saturating_add(step.ccd_clamp_checks),
            ccd_hits: step.ccd_clamps,
            broken_joints: step.broken_joints.saturating_add(authored_breaks),
            ..RigidBodyStepStats::default()
        }
    }
}

mod file_runtime_observation_admission;

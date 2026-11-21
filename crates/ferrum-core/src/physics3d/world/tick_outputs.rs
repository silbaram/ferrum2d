//! Keep the last published tick's outputs until the solver has accepted some
//! physical time. Variable-sized reports reuse their alternate output buffers.
use super::*;
use crate::physics3d::{
    character::interval_credit::Credit, contact_impulses::ImpulseBuffer,
    kinematic_paths::PathScratch, motion_trace::MotionTrace, queries::StepMotion,
    statistics::Statistics, ColliderId, JointId, JointState,
};
use std::collections::BTreeSet;

#[derive(Default)]
pub(in crate::physics3d) struct TickOutputs {
    pub(super) active: bool,
    bytes: usize,
    statistics: Statistics,
    impulses: ImpulseBuffer,
    trace: MotionTrace,
    capture: StepMotion,
    pub(in crate::physics3d) paths: PathScratch,
    updates: Vec<rp::ColliderHandle>,
    pairs: BTreeSet<(ColliderId, ColliderId)>,
    characters: Vec<(BodyId, Credit, [f32; 3], [f32; 3])>,
    joints: Vec<JointOutput>,
}

struct JointOutput {
    id: JointId,
    state: JointState,
    ratio_impulse: f32,
    ratio_reaction: JointState,
    pulley_axes: [rp::Vector; 2],
    radial_direction: Option<rp::Vector>,
}

impl TickOutputs {
    pub(in crate::physics3d) fn reserved_bytes(&self) -> usize {
        if self.active {
            self.bytes
        } else {
            0
        }
    }
}

impl PhysicsWorld3d {
    pub(super) fn prepare_tick_output_storage(
        &mut self,
    ) -> Result<(), crate::physics3d::solver_trajectory::TrajectoryError> {
        use crate::physics3d::solver_trajectory::TrajectoryError::WorkLimit;
        let count = self
            .characters
            .len()
            .checked_add(self.joints.len())
            .and_then(|v| v.checked_add(self.query_updates.len()))
            .ok_or(WorkLimit)?;
        if count == 0 {
            self.tick_outputs.bytes = 0;
            return Ok(());
        }
        let bytes = self
            .characters
            .len()
            .checked_mul(std::mem::size_of::<(BodyId, Credit, [f32; 3], [f32; 3])>())
            .and_then(|v| {
                self.joints
                    .len()
                    .checked_mul(std::mem::size_of::<JointOutput>())
                    .and_then(|j| v.checked_add(j))
            })
            .and_then(|v| {
                self.query_updates
                    .len()
                    .checked_mul(std::mem::size_of::<rp::ColliderHandle>())
                    .and_then(|q| v.checked_add(q))
            })
            .ok_or(WorkLimit)?;
        if bytes > self.actual_motion_scratch_bound()? {
            return Err(WorkLimit);
        }
        let mut work = self.saved_motion_proof_work();
        work.charge(count as u64)?;
        let prior = &mut self.tick_outputs;
        prior.bytes = bytes;
        prior
            .characters
            .try_reserve_exact(self.characters.len().saturating_sub(prior.characters.len()))
            .map_err(|_| WorkLimit)?;
        prior
            .joints
            .try_reserve_exact(self.joints.len().saturating_sub(prior.joints.len()))
            .map_err(|_| WorkLimit)?;
        prior
            .updates
            .try_reserve_exact(self.query_updates.len().saturating_sub(prior.updates.len()))
            .map_err(|_| WorkLimit)?;
        self.commit_saved_motion_proof_work(work)
    }

    pub(super) fn stage_tick_outputs(&mut self) {
        let prior = &mut self.tick_outputs;
        prior.active = true;
        self.statistics.stage_step(&mut prior.statistics);
        let impulses = self.events.1.get_mut().unwrap_or_else(|p| p.into_inner());
        impulses.stage_reports(&mut prior.impulses);
        let trace = self.events.2.get_mut().unwrap_or_else(|p| p.into_inner());
        trace.stage_tick(&mut prior.trace);
        self.step_motion.stage_tick(&mut prior.capture);
        self.events.begin_tick_events();
        prior.updates.clone_from(&self.query_updates);
        std::mem::swap(
            &mut self.contact_policies.character_dynamic_pairs,
            &mut prior.pairs,
        );
        prior.characters.clear();
        prior
            .characters
            .extend(self.characters.iter().map(|(id, runtime)| {
                (
                    *id,
                    runtime.interval_credit(),
                    runtime.tick_velocity,
                    runtime.external_force,
                )
            }));
        prior.joints.clear();
        prior
            .joints
            .extend(self.joints.iter().map(|(&id, joint)| JointOutput {
                id,
                state: joint.state.clone(),
                ratio_impulse: joint.ratio_impulse,
                ratio_reaction: joint.ratio_reaction.clone(),
                pulley_axes: joint.pulley_axes,
                radial_direction: joint.radial_direction,
            }));
    }

    pub(super) fn restore_tick_outputs(&mut self) {
        let prior = &mut self.tick_outputs;
        std::mem::swap(&mut self.statistics, &mut prior.statistics);
        self.events
            .1
            .get_mut()
            .unwrap_or_else(|p| p.into_inner())
            .swap_reports(&mut prior.impulses);
        std::mem::swap(
            self.events.2.get_mut().unwrap_or_else(|p| p.into_inner()),
            &mut prior.trace,
        );
        self.step_motion.restore_tick(&mut prior.capture);
        std::mem::swap(&mut self.query_updates, &mut prior.updates);
        std::mem::swap(
            &mut self.contact_policies.character_dynamic_pairs,
            &mut prior.pairs,
        );
        for (id, credit, tick_velocity, force) in &prior.characters {
            if let Some(runtime) = self.characters.get_mut(id) {
                runtime.return_interval_credit(credit);
                runtime.tick_velocity = *tick_velocity;
                runtime.external_force = *force;
            }
        }
        for prior in &prior.joints {
            if let Some(joint) = self.joints.get_mut(&prior.id) {
                joint.state.clone_from(&prior.state);
                joint.ratio_impulse = prior.ratio_impulse;
                joint.ratio_reaction.clone_from(&prior.ratio_reaction);
                joint.pulley_axes = prior.pulley_axes;
                joint.radial_direction = prior.radial_direction;
            }
        }
    }
}

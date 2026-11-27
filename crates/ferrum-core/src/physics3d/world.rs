use super::character::CharacterRuntime;
use super::events::{collider_id, EventCollector};
use super::geometry::collider_builder;
use super::joints::JointRuntime;
use super::types::{valid_pose, valid_vector, validate_plane};
use super::{
    BodyDesc, BodyId, BodyKind, BodyState, ColliderDesc, PhysicsError, Pose, Space, WorldConfig,
};
use rapier3d::prelude as rp;
use std::collections::BTreeMap;
use std::fmt;
#[cfg(test)]
pub(super) mod p1a_tests;
pub(super) mod tick_outputs;

/// Rust-owned simulation. Space selection changes constraints, not the solver backend.
pub struct PhysicsWorld3d {
    pub(super) backend: rp::PhysicsWorld,
    pub(super) statistics: super::statistics::Statistics,
    pub(super) tick_outputs: tick_outputs::TickOutputs,
    pub(super) config: WorldConfig,
    // Present only while an Engine interval uses an actual variable duration.
    // Both settings are restored before any public checkpoint boundary.
    pub(super) interval_nominal_seconds: Option<f32>,
    pub(super) events: EventCollector,
    pub(super) contact_policies: super::contact_policy::ContactPolicies,
    pub(super) query_updates: Vec<rp::ColliderHandle>,
    /// Sparse, nonzero shape edit revisions. New collider generations start at zero.
    /// Query snapshots store these values instead of process-local SharedShape pointers.
    pub(super) collider_shape_revisions: BTreeMap<super::ColliderId, u64>,
    pub(super) path_scratch: super::kinematic_paths::PathScratch,
    pub(super) step_motion: super::queries::StepMotion,
    pub(super) characters: BTreeMap<BodyId, CharacterRuntime>,
    // Keep reusable solver scratch out of by-value Engine and checkpoint decode frames.
    pub(super) character_motion: Box<super::character_motion::MotionScene>,
    pub(super) character_order: Vec<BodyId>,
    pub(super) character_contacts: super::character_contacts::Scratch,
    pub(super) character_dynamics: super::character_dynamics::Scratch,
    pub(super) joints: BTreeMap<super::JointId, JointRuntime>,
    pub(super) joint_events: Vec<super::JointEvent>,
    pub(super) dropped_joint_events: usize,
    pub(super) broken_joints: Vec<(super::JointId, super::JointEventReason)>,
    pub(super) planar_angles: BTreeMap<BodyId, super::planar_angle::PlanarAngle>,
    pub(super) joint_kinematics: Vec<(rp::RigidBodyHandle, rp::Pose, rp::Pose)>,
    /// Inputs for the next tick begin; never present at a checkpoint boundary.
    pub(super) staged_tick_inputs: Vec<(BodyId, super::tick_inputs::TickInput)>,
}

impl fmt::Debug for PhysicsWorld3d {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PhysicsWorld3d")
            .field("config", &self.config)
            .field("body_count", &self.body_count())
            .finish()
    }
}

pub(super) fn validate_config(config: &WorldConfig) -> Result<(), PhysicsError> {
    if !valid_vector(&config.gravity)
        || !config.step_seconds.is_finite()
        || !(0.0001..=0.1).contains(&config.step_seconds)
        || !config.length_unit.is_finite()
        || !(0.0001..=10000.0).contains(&config.length_unit)
        || config.max_bodies == 0
        || config.max_bodies > 65536
        || config.max_colliders == 0
        || config.max_colliders > 131072
        || config.max_events == 0
        || config.max_events > 65536
        || config.max_characters == 0
        || config.max_characters > 1024
        || config.max_joints == 0
        || config.max_joints > 131072
    {
        return Err(PhysicsError::InvalidConfig);
    }
    validate_plane(config.space, Pose::default(), config.gravity, [0.0; 3])?;
    config.solver.validate()?;
    Ok(())
}

// The same cold producer is used by creation and stored-state admission. Keep
// backend-only defaults here instead of repeating them in snapshot validation.
pub(super) fn integration_parameters(config: &WorldConfig) -> rp::IntegrationParameters {
    let mut params = rp::IntegrationParameters {
        dt: config.step_seconds,
        length_unit: config.length_unit,
        ..rp::IntegrationParameters::default()
    };
    config.solver.apply(&mut params);
    // Limit compression after fast CCD impacts against fixed terrain. The 60 Hz
    // default admitted >4 cm penetration for a radius-0.5 sphere at 1000 units/s.
    // The high-speed continuation and spatial/planar stack tests guard this choice.
    params.static_contact_softness.natural_frequency = 240.0;
    params
}

impl PhysicsWorld3d {
    /// Creates a world after validating finite integration parameters and planar gravity.
    pub fn new(config: WorldConfig) -> Result<Self, PhysicsError> {
        validate_config(&config)?;
        let mut backend = rp::PhysicsWorld::new();
        backend.integration_parameters = integration_parameters(&config);
        backend.ccd_solver.set_diagnostic_limit(config.max_events);
        backend.gravity = config.gravity.into();
        Ok(Self {
            backend,
            statistics: super::statistics::Statistics::default(),
            tick_outputs: Default::default(),
            events: EventCollector::new(config.max_events),
            contact_policies: super::contact_policy::ContactPolicies {
                planar: config.space == Space::PlanarXy,
                ..Default::default()
            },
            joint_events: Vec::with_capacity(config.max_events),
            config,
            interval_nominal_seconds: None,
            query_updates: Vec::new(),
            collider_shape_revisions: BTreeMap::new(),
            path_scratch: Default::default(),
            step_motion: super::queries::StepMotion::default(),
            characters: BTreeMap::new(),
            character_order: Vec::new(),
            character_contacts: Default::default(),
            character_dynamics: Default::default(),
            character_motion: Box::default(),
            joints: BTreeMap::new(),
            dropped_joint_events: 0,
            broken_joints: Vec::new(),
            joint_kinematics: Vec::new(),
            planar_angles: BTreeMap::new(),
            staged_tick_inputs: Vec::new(),
        })
    }

    pub(crate) fn nominal_step_seconds(&self) -> f32 {
        self.interval_nominal_seconds
            .unwrap_or(self.config.step_seconds)
    }

    #[cfg(test)]
    pub(crate) fn enable_experimental_rigid_rapier_ccd(&mut self) {
        self.character_motion.experiment = super::character::experimental::Experiment::RigidRapier;
    }

    pub(crate) fn has_active_interval(&self) -> bool {
        self.interval_nominal_seconds.is_some()
    }

    pub(crate) fn begin_interval(
        &mut self,
        seconds: f32,
        validate_forces: bool,
    ) -> Result<bool, PhysicsError> {
        if !seconds.is_finite() || !(0.0001..=0.1).contains(&seconds) {
            return Err(PhysicsError::InvalidConfig);
        }
        if validate_forces {
            self.validate_character_force_duration(seconds)?;
        }
        if self.interval_nominal_seconds.is_some() {
            // A nested auto/manual driver may join exactly the accepted interval.
            return if seconds == self.config.step_seconds {
                Ok(false)
            } else {
                Err(PhysicsError::InvalidConfig)
            };
        }
        self.interval_nominal_seconds = Some(self.config.step_seconds);
        self.config.step_seconds = seconds;
        self.backend.integration_parameters.dt = seconds;
        Ok(true)
    }

    pub(crate) fn end_interval(&mut self) {
        if let Some(seconds) = self.interval_nominal_seconds.take() {
            self.config.step_seconds = seconds;
            self.backend.integration_parameters.dt = seconds;
        }
    }

    /// Immutable configuration for this world.
    pub fn config(&self) -> &WorldConfig {
        &self.config
    }

    /// Number of live bodies, including fixed terrain and kinematic actors.
    pub fn body_count(&self) -> usize {
        self.backend.bodies.len()
    }

    /// Inserts a validated body and collider atomically.
    pub fn create_body(
        &mut self,
        desc: BodyDesc,
        collider: ColliderDesc,
    ) -> Result<BodyId, PhysicsError> {
        if self.body_count() >= self.config.max_bodies
            || self.collider_count() >= self.config.max_colliders
        {
            return Err(PhysicsError::CapacityExceeded);
        }
        let shape = collider_builder(&collider, desc.kind, self.config.space)?;
        let body = self.body_builder(&desc)?;
        let surface_velocity = collider.surface_velocity;
        let correction = collider.contact_correction;
        let (handle, collider) = self.backend.insert(body, shape);
        self.query_updates.push(collider);
        let (slot, generation) = handle.into_raw_parts();
        let id = BodyId { slot, generation };
        self.contact_policies
            .set_surface(collider_id(collider), surface_velocity);
        self.contact_policies
            .set_correction(collider_id(collider), correction);
        if let Some(c) = self.backend.colliders.get_mut(collider) {
            c.set_active_hooks(self.contact_policies.flags(id, collider_id(collider)));
        }
        self.initialize_planar_angle(id, desc.pose.rotation);
        Ok(id)
    }

    /// Creates a body without fixtures, for non-colliding actors or deferred geometry.
    /// Set explicit mass properties before applying forces to a dynamic empty body.
    pub fn create_body_without_collider(&mut self, desc: BodyDesc) -> Result<BodyId, PhysicsError> {
        if self.body_count() >= self.config.max_bodies {
            return Err(PhysicsError::CapacityExceeded);
        }
        let body = self.body_builder(&desc)?;
        let (slot, generation) = self.backend.insert_body(body).into_raw_parts();
        let id = BodyId { slot, generation };
        self.initialize_planar_angle(id, desc.pose.rotation);
        Ok(id)
    }

    pub(crate) fn validate_body_desc(&self, desc: &BodyDesc) -> Result<(), PhysicsError> {
        self.body_builder(desc).map(|_| ())
    }

    pub(crate) fn validate_collider_desc(
        &self,
        desc: &ColliderDesc,
        kind: BodyKind,
    ) -> Result<(), PhysicsError> {
        collider_builder(desc, kind, self.config.space).map(|_| ())
    }

    fn body_builder(&self, desc: &BodyDesc) -> Result<rp::RigidBodyBuilder, PhysicsError> {
        if !valid_pose(desc.pose)
            || !valid_vector(&desc.linear_velocity)
            || !valid_vector(&desc.angular_velocity)
            || !desc.gravity_scale.is_finite()
            || desc.gravity_scale.abs() > 1000.0
            || ![desc.linear_damping, desc.angular_damping]
                .iter()
                .all(|v| v.is_finite() && (0.0..=10000.0).contains(v))
        {
            return Err(PhysicsError::InvalidBody);
        }
        validate_plane(
            self.config.space,
            desc.pose,
            desc.linear_velocity,
            desc.angular_velocity,
        )?;
        let mut body = match desc.kind {
            BodyKind::Fixed => rp::RigidBodyBuilder::fixed(),
            BodyKind::Dynamic => rp::RigidBodyBuilder::dynamic(),
            BodyKind::KinematicPosition => rp::RigidBodyBuilder::kinematic_position_based(),
            BodyKind::KinematicVelocity => rp::RigidBodyBuilder::kinematic_velocity_based(),
        }
        .pose(native_pose(desc.pose))
        .linvel(desc.linear_velocity.into())
        .angvel(desc.angular_velocity.into())
        .gravity_scale(desc.gravity_scale)
        .linear_damping(desc.linear_damping)
        .angular_damping(desc.angular_damping)
        .ccd_enabled(desc.ccd)
        .can_sleep(desc.can_sleep);
        if self.config.space == Space::PlanarXy {
            body = body.locked_axes(
                rp::LockedAxes::TRANSLATION_LOCKED_Z
                    | rp::LockedAxes::ROTATION_LOCKED_X
                    | rp::LockedAxes::ROTATION_LOCKED_Y,
            );
        }
        Ok(body)
    }

    /// Removes a body, its colliders and joints. Repeating removal rejects the stale identity.
    pub fn remove_body(&mut self, id: BodyId) -> Result<(), PhysicsError> {
        let body = self
            .backend
            .bodies
            .get(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        for &collider in body.colliders() {
            self.collider_shape_revisions.remove(&collider_id(collider));
            self.events.remove_collider(collider_id(collider));
            self.contact_policies.one_way.remove(&collider_id(collider));
            self.contact_policies
                .surfaces
                .remove(&collider_id(collider));
            self.contact_policies
                .corrections
                .remove(&collider_id(collider));
        }
        self.contact_policies.spans.remove(&id);
        self.remove_body_joints(id);
        self.planar_angles.remove(&id);
        self.characters.remove(&id);
        for runtime in self.characters.values_mut() {
            if runtime.state.ground.is_some_and(|ground| ground.body == id) {
                runtime.state.grounded = false;
                runtime.state.ground = None;
            }
        }
        self.backend
            .remove_body(native_id(id))
            .map(|_| ())
            .ok_or(PhysicsError::StaleBody)
    }

    /// Removes all bodies without resetting the backend's generation counters.
    pub fn clear(&mut self) {
        self.characters.clear();
        let ids: Vec<_> = self.backend.bodies.iter().map(|(id, _)| id).collect();
        for id in ids {
            let (slot, generation) = id.into_raw_parts();
            // Collected handles are live and no insertion happens while clearing.
            let _ = self.remove_body(BodyId { slot, generation });
        }
    }

    /// Advances exactly one configured timestep.
    pub fn step(&mut self) {
        let _ = self.step_checked();
    }

    /// Internal Engine execution must consume the checked outcome; a failed
    /// actual-motion suffix is never an instruction to run a second solver.
    pub(crate) fn step_checked(&mut self) -> Result<(), PhysicsError> {
        #[cfg(test)]
        if self.experimental_character_kcc_enabled() {
            return self.step_experimental_character_kcc(&[]);
        }
        if self.has_moving_character_obstacles() || self.backend_motion_enabled() {
            self.step_kinematic_tick(&[]);
            return self.actual_motion_result();
        }
        if !self.begin_fixed_step() {
            return self.actual_motion_result();
        }
        if let Err(error) = self.capture_actual_interval_credit() {
            self.finish_fixed_step();
            return Err(error);
        }
        let before = self.actual_motion_completed_time();
        self.step_characters();
        self.step_with_joints(0.0, 1.0);
        let result = self.finish_actual_interval_credit(before);
        if result.is_ok() {
            self.finish_characters();
        } else {
            self.refresh_queries();
            let elapsed = self.actual_motion_completed_time();
            if elapsed > 0. {
                self.record_step_motion_segment(
                    (elapsed / f64::from(self.backend.integration_parameters.dt)).clamp(0., 1.),
                );
            }
        }
        self.finish_fixed_step();
        result
    }

    pub(super) fn begin_fixed_step(&mut self) -> bool {
        self.begin_fixed_step_with_paths(false)
    }

    pub(super) fn begin_fixed_step_with_paths(&mut self, prescribed_paths: bool) -> bool {
        self.begin_backend_motion_tick();
        if prescribed_paths || self.backend_motion_enabled() {
            if let Err(error) = self
                .begin_backend_step_rollback()
                .and_then(|()| self.prepare_tick_output_storage())
            {
                // Nothing in the world was changed during admission.
                self.finish_backend_step_rollback();
                self.character_motion.backend_motion.fail(error);
                self.end_backend_motion_tick();
                return false;
            }
            self.stage_tick_outputs();
        }
        // After the journal: a zero-progress rejection also undoes these.
        self.apply_staged_tick_inputs();
        self.contact_policies.character_dynamic_pairs.clear();
        for runtime in self.characters.values_mut() {
            runtime.contact_velocity = [0.; 3];
            runtime.dynamic_iterations = 0;
            runtime.dynamic_limited = false;
        }
        if !self.characters.is_empty() {
            for (_, body) in self
                .backend
                .bodies
                .iter_mut()
                .filter(|(_, body)| body.is_dynamic())
            {
                body.recompute_mass_properties_from_colliders(&self.backend.colliders);
            }
        }
        self.begin_step_motion();
        self.begin_statistics();
        self.events
            .1
            .get_mut()
            .unwrap_or_else(|p| p.into_inner())
            .clear();
        for runtime in self.joints.values_mut() {
            runtime.state = super::JointState::default();
        }
        true
    }
    pub(super) fn finish_fixed_step(&mut self) {
        let rejected =
            self.actual_motion_completed_time() == 0. && self.actual_motion_result().is_err();
        if std::mem::take(&mut self.tick_outputs.active) {
            self.events.finish_tick_events(rejected);
            if rejected {
                self.restore_tick_outputs();
                self.finish_backend_step_rollback();
                self.end_backend_motion_tick();
                return;
            }
        }
        // Capture consumes the same tick ledger after actual approval; it
        // never creates a fresh proof allowance or changes actual tick credit.
        let mut work = self.saved_motion_proof_work();
        self.finish_step_motion(&mut work);
        if self.commit_saved_motion_proof_work(work).is_err() {
            self.step_motion.invalidate_capture();
        }
        self.query_updates.clear();
        self.finish_statistics();
        self.finish_backend_step_rollback();
        self.end_backend_motion_tick();
    }

    /// Reads an owned state without retaining a borrowed backend buffer.
    pub fn body_state(&self, id: BodyId) -> Result<BodyState, PhysicsError> {
        let body = self
            .backend
            .bodies
            .get(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        Ok(BodyState {
            pose: Pose {
                position: body.translation().to_array(),
                rotation: body.rotation().to_array(),
            },
            linear_velocity: body.linvel().to_array(),
            angular_velocity: body.angvel().to_array(),
            sleeping: body.is_sleeping(),
        })
    }

    /// Teleports a body. Planar invariants are checked before any mutation.
    pub fn set_pose(&mut self, id: BodyId, pose: Pose) -> Result<(), PhysicsError> {
        self.validate_pose(id, pose)?;
        let body = self
            .backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        body.set_position(native_pose(pose), true);
        self.query_updates.extend_from_slice(body.colliders());
        if let Some(runtime) = self.characters.get_mut(&id) {
            runtime.state = super::CharacterState::default();
        }
        self.invalidate_character_support(Some(id), None);
        self.initialize_planar_angle(id, pose.rotation);
        Ok(())
    }

    // Shared admission with the atomic Web command batch.
    pub(crate) fn validate_pose(&self, id: BodyId, pose: Pose) -> Result<(), PhysicsError> {
        if !valid_pose(pose) {
            return Err(PhysicsError::InvalidBody);
        }
        validate_plane(self.config.space, pose, [0.0; 3], [0.0; 3])?;
        self.validate_character_pose(id, pose)?;
        self.body_state(id).map(|_| ())
    }

    /// Changes velocities after checking that direct setters cannot bypass planar locks.
    ///
    /// A velocity-controlled kinematic body stops at a capsule squeeze constraint.
    /// Both velocities become zero; issue a new command to resume after obstruction.
    pub fn set_velocity(
        &mut self,
        id: BodyId,
        linear: [f32; 3],
        angular: [f32; 3],
    ) -> Result<(), PhysicsError> {
        self.validate_velocity(id, linear, angular)?;
        let body = self
            .backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        body.set_linvel(linear.into(), true);
        body.set_angvel(angular.into(), true);
        Ok(())
    }

    // Shared by the single-body setter and atomic Web batch admission.
    pub(crate) fn validate_velocity(
        &self,
        id: BodyId,
        linear: [f32; 3],
        angular: [f32; 3],
    ) -> Result<(), PhysicsError> {
        if !valid_vector(&linear) || !valid_vector(&angular) {
            return Err(PhysicsError::InvalidBody);
        }
        validate_plane(self.config.space, Pose::default(), linear, angular)?;
        if self.characters.contains_key(&id) {
            return Err(PhysicsError::CharacterControlled);
        }
        let body = self
            .backend
            .bodies
            .get(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        if body.locked_axes().contains(rp::LockedAxes::ROTATION_LOCKED) && angular != [0.0; 3] {
            return Err(PhysicsError::LockedRotation);
        }
        Ok(())
    }

    /// Applies an impulse. Locked axes discard impulse components through inverse mass.
    pub fn apply_impulse(&mut self, id: BodyId, impulse: [f32; 3]) -> Result<(), PhysicsError> {
        self.validate_dynamic_motion(id, impulse, [0.0; 3])?;
        let body = self
            .backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        body.apply_impulse(impulse.into(), true);
        Ok(())
    }

    /// Sets the next pose of a position-controlled kinematic body.
    ///
    /// Capsule squeeze constraints may consume the target at an intermediate pose.
    /// The body stays there until a new target is supplied. Tangential motion that
    /// lets a platform slide beneath a blocked rider remains allowed.
    pub fn set_kinematic_target(&mut self, id: BodyId, pose: Pose) -> Result<(), PhysicsError> {
        self.validate_kinematic_target(id, pose)?;
        self.backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?
            .set_next_kinematic_position(native_pose(pose));
        Ok(())
    }

    pub(crate) fn validate_kinematic_target(
        &self,
        id: BodyId,
        pose: Pose,
    ) -> Result<(), PhysicsError> {
        if self.characters.contains_key(&id) {
            return Err(PhysicsError::CharacterControlled);
        }
        if !valid_pose(pose) {
            return Err(PhysicsError::InvalidBody);
        }
        validate_plane(self.config.space, pose, [0.0; 3], [0.0; 3])?;
        let body = self
            .backend
            .bodies
            .get(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        if body.body_type() != rp::RigidBodyType::KinematicPositionBased {
            return Err(PhysicsError::WrongBodyKind);
        }
        if body.locked_axes().contains(rp::LockedAxes::ROTATION_LOCKED)
            && body.rotation().to_array() != pose.rotation
            && body.rotation().to_array() != pose.rotation.map(|v| -v)
        {
            return Err(PhysicsError::LockedRotation);
        }
        Ok(())
    }
}

pub(super) fn native_id(id: BodyId) -> rp::RigidBodyHandle {
    rp::RigidBodyHandle::from_raw_parts(id.slot, id.generation)
}

pub(super) fn native_pose(pose: Pose) -> rp::Pose {
    rp::Pose::from_parts(
        pose.position.into(),
        rp::Rotation::from_array(pose.rotation),
    )
}

use super::ratio_joints::ConstraintPass;
use super::types::{valid_pose, valid_vector};
use super::world::{native_id, native_pose};
use super::{
    BodyId, JointDesc, JointEvent, JointEventReason, JointId, JointKind, JointMotor, JointState,
    PhysicsError, PhysicsWorld3d, Space,
};
use rapier3d::prelude as rp;

#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct JointRuntime {
    pub(super) desc: JointDesc,
    pub(super) state: JointState,
    pub(super) ratio_impulse: f32,
    pub(super) ratio_reaction: JointState,
    pub(super) pulley_axes: [rp::Vector; 2],
    #[serde(skip)]
    pub(super) reaction: super::joint_reactions::JointReaction,
    pub(super) radial_direction: Option<rp::Vector>,
}

impl PhysicsWorld3d {
    /// Number of live joints, including disabled joints.
    pub fn joint_count(&self) -> usize {
        self.joints.len()
    }

    /// Inserts a validated joint atomically. Backend types never cross this API.
    pub fn create_joint(&mut self, desc: JointDesc) -> Result<JointId, PhysicsError> {
        let data = self.validate_joint(&desc)?;
        if self.joints.len() >= self.config.max_joints {
            return Err(PhysicsError::CapacityExceeded);
        }
        let handle =
            self.backend
                .insert_impulse_joint(native_id(desc.body_a), native_id(desc.body_b), data);
        let id = joint_id(handle);
        self.joints.insert(
            id,
            JointRuntime {
                desc,
                state: JointState::default(),
                radial_direction: None,
                ratio_impulse: 0.0,
                ratio_reaction: JointState::default(),
                pulley_axes: [rp::Vector::Y; 2],
                reaction: super::joint_reactions::JointReaction::default(),
            },
        );
        Ok(id)
    }

    /// Iterates live identities, including disabled joints, without exposing backend handles.
    pub fn joint_ids(&self) -> impl Iterator<Item = JointId> + '_ {
        self.joints.keys().copied()
    }

    /// Reads current settings. A broken or removed identity returns `StaleJoint`.
    pub fn joint_desc(&self, id: JointId) -> Result<&JointDesc, PhysicsError> {
        self.joints
            .get(&id)
            .map(|r| &r.desc)
            .ok_or(PhysicsError::StaleJoint)
    }

    /// Reads the last step's reaction estimate without advancing simulation.
    pub fn joint_state(&self, id: JointId) -> Result<&JointState, PhysicsError> {
        self.joints
            .get(&id)
            .map(|r| &r.state)
            .ok_or(PhysicsError::StaleJoint)
    }

    /// Replaces settings and clears cached impulses, preserving identity and endpoints.
    ///
    /// Changing either endpoint requires removing and recreating the joint. Invalid
    /// updates leave settings, cached impulses and sleep state unchanged.
    pub fn update_joint(&mut self, id: JointId, desc: JointDesc) -> Result<(), PhysicsError> {
        let old = self.joint_desc(id)?;
        if (old.body_a, old.body_b) != (desc.body_a, desc.body_b) {
            return Err(PhysicsError::InvalidJoint);
        }
        let data = self.validate_joint(&desc)?;
        let joint = self
            .backend
            .impulse_joints
            .get_mut(native_joint(id), true)
            .ok_or(PhysicsError::StaleJoint)?;
        joint.data = data;
        joint.impulses.fill(0.0);
        self.joints.insert(
            id,
            JointRuntime {
                desc,
                state: JointState::default(),
                radial_direction: None,
                ratio_impulse: 0.0,
                ratio_reaction: JointState::default(),
                pulley_axes: [rp::Vector::Y; 2],
                reaction: super::joint_reactions::JointReaction::default(),
            },
        );
        Ok(())
    }

    /// Removes a live joint, wakes its endpoints and queues one removal event.
    pub fn remove_joint(&mut self, id: JointId) -> Result<(), PhysicsError> {
        self.remove_joint_with_reason(id, JointEventReason::Removed)
    }

    /// Replaces output with queued events and returns the number dropped since the last drain.
    ///
    /// The queue has the world's `max_events` capacity, independently of collision
    /// events. No simulation or query update occurs here.
    pub fn drain_joint_events(&mut self, out: &mut Vec<JointEvent>) -> usize {
        out.clear();
        out.append(&mut self.joint_events);
        std::mem::take(&mut self.dropped_joint_events)
    }

    pub(super) fn remove_body_joints(&mut self, body: BodyId) {
        let ids: Vec<_> = self
            .backend
            .impulse_joints
            .attached_joints(native_id(body))
            .map(|(_, _, id, _)| joint_id(id))
            .collect();
        for id in ids {
            // All attached joints were created through this module, and are removed once.
            let _ = self.remove_joint_with_reason(id, JointEventReason::BodyRemoved);
        }
    }

    /// Actual outer backend passes. Per-body extra requests are consumed once
    /// inside Rapier and must never be added to these execution parameters.
    pub(super) fn backend_pass_schedule(&self) -> (rp::IntegrationParameters, usize) {
        let mut params = self.backend.integration_parameters;
        if self.joints.is_empty() {
            (params, 1)
        } else {
            let passes = params.num_solver_iterations;
            params.dt /= passes as f32;
            params.num_solver_iterations = 1;
            (params, passes)
        }
    }

    pub(super) fn validate_rapier_step_seconds(&self, seconds: f32) -> Result<(), PhysicsError> {
        let passes = self.backend_pass_schedule().1;
        let dt = seconds / passes as f32;
        if dt.is_finite() && dt > 0. && dt.recip().is_finite() {
            Ok(())
        } else {
            Err(PhysicsError::InvalidBody)
        }
    }

    pub(super) fn step_with_joints(&mut self) {
        if self.joints.is_empty() {
            self.step_backend();
            self.advance_planar_angles(self.backend.integration_parameters.dt);
            return;
        }
        // Rapier only exposes impulses from its final internal substep. Run the
        // same number of single-substep passes so impacts on earlier passes can
        // break a joint immediately, without modifying or copying the solver.
        let params = self.backend.integration_parameters;
        let (pass_params, passes) = self.backend_pass_schedule();
        self.backend.integration_parameters.dt = pass_params.dt;
        self.backend.integration_parameters.num_solver_iterations =
            pass_params.num_solver_iterations;
        if self.joints.values().any(|runtime| {
            runtime.desc.enabled
                && [runtime.desc.linear_spring, runtime.desc.angular_spring]
                    .into_iter()
                    .flatten()
                    .any(|s| s.stiffness > 0.0 || s.damping > 0.0)
        }) {
            // Multiple elastic frame axes share off-center effective masses.
            // One native sweep leaves a steady angular residual under load;
            // converge both biased and relaxed passes within the same substep.
            self.backend
                .integration_parameters
                .num_internal_pgs_iterations = params.num_internal_pgs_iterations.max(4);
            self.backend
                .integration_parameters
                .num_internal_stabilization_iterations =
                params.num_internal_stabilization_iterations.max(4);
        }
        let mut kinematics = std::mem::take(&mut self.joint_kinematics);
        kinematics.clear();
        kinematics.extend(self.backend.bodies.iter().filter_map(|(id, body)| {
            (body.body_type() == rp::RigidBodyType::KinematicPositionBased).then_some((
                id,
                *body.position(),
                *body.next_position(),
            ))
        }));
        let has_ratios = self.has_ratio_joints();
        for pass in 1..=passes {
            let alpha = pass as f32 / passes as f32;
            for &(id, start, target) in &kinematics {
                if let Some(body) = self.backend.bodies.get_mut(id) {
                    let pose = super::kinematic_paths::interpolate_kinematic_pose(
                        start,
                        target,
                        f64::from(alpha),
                    );
                    body.set_next_kinematic_position(pose);
                }
            }
            self.update_radial_joint_frames();
            self.update_continuous_hinge_frames();
            self.limit_hinge_motors();
            if has_ratios {
                self.reset_ratio_impulses();
                self.solve_ratio_joints(ConstraintPass::BeforeIntegration);
            }
            self.prepare_joint_reactions();
            self.step_backend();
            self.advance_planar_angles(self.backend.integration_parameters.dt);
            if has_ratios {
                self.solve_ratio_joints(ConstraintPass::AfterIntegration);
                self.solve_ratio_joints(ConstraintPass::Positions);
            }
            self.finish_joints();
        }
        kinematics.clear();
        self.joint_kinematics = kinematics;
        self.backend.integration_parameters = params;
        if has_ratios {
            self.refresh_queries();
        }
    }

    fn update_radial_joint_frames(&mut self) {
        for (&id, runtime) in &mut self.joints {
            let radial = matches!(runtime.desc.kind, JointKind::Distance { length } if length > 0.0)
                || matches!(
                    runtime.desc.kind,
                    JointKind::Spring { .. }
                        | JointKind::FrequencySpring { .. }
                        | JointKind::AccelerationSpring { .. }
                );
            if !runtime.desc.enabled || !radial {
                continue;
            }
            let Some(a) = self.backend.bodies.get(native_id(runtime.desc.body_a)) else {
                continue;
            };
            let Some(b) = self.backend.bodies.get(native_id(runtime.desc.body_b)) else {
                continue;
            };
            let anchor_a = a.position() * rp::Vector::from(runtime.desc.local_frame_a.position);
            let anchor_b = b.position() * rp::Vector::from(runtime.desc.local_frame_b.position);
            let delta = anchor_b - anchor_a;
            let axis = if delta.length_squared() > 1.0e-12 {
                delta.normalize()
            } else {
                runtime.radial_direction.unwrap_or(rp::Vector::X)
            };
            runtime.radial_direction = Some(axis);
            let frame = rp::GenericJoint::complete_ang_frame(axis);
            if let Some(joint) = self.backend.impulse_joints.get_mut(native_joint(id), false) {
                joint.data.local_frame1.rotation = a.rotation().inverse() * frame;
                joint.data.local_frame2.rotation = b.rotation().inverse() * frame;
            }
        }
    }

    fn finish_joints(&mut self) {
        // One CCD pass, one solver substep, no per-body extra iterations. The
        // public world never exposes backend integration settings or bodies.
        let params = &self.backend.integration_parameters;
        let inv_dt = params.num_solver_iterations as f64 / f64::from(params.dt);
        self.broken_joints.clear();
        for (&id, runtime) in &mut self.joints {
            let Some(joint) = self.backend.impulse_joints.get(native_joint(id)) else {
                continue;
            };
            let bodies = [joint.body1(), joint.body2()].map(|id| self.backend.bodies.get(id));
            // An attached disabled body removes the row from the solver but its
            // cached impulse remains. Never report that old load or break on it.
            let active = runtime.desc.enabled
                && bodies.iter().all(|b| b.is_some_and(|b| b.is_enabled()))
                && bodies
                    .iter()
                    .any(|b| b.is_some_and(|b| b.is_dynamic() && !b.is_sleeping()));
            let current = if active {
                if matches!(
                    runtime.desc.kind,
                    JointKind::Gear { .. }
                        | JointKind::Pulley { .. }
                        | JointKind::ElasticRope { .. }
                ) {
                    runtime.ratio_reaction.clone()
                } else {
                    runtime.reaction.sample(joint, inv_dt)
                }
            } else {
                JointState::default()
            };
            runtime.state.force = runtime.state.force.max(current.force);
            runtime.state.torque = runtime.state.torque.max(current.torque);
            let force = active
                && runtime
                    .desc
                    .break_force
                    .is_some_and(|v| runtime.state.force > v);
            let torque = active
                && runtime
                    .desc
                    .break_torque
                    .is_some_and(|v| runtime.state.torque > v);
            let reason = match (force, torque) {
                (true, true) => JointEventReason::ForceAndTorqueLimit,
                (true, false) => JointEventReason::ForceLimit,
                (false, true) => JointEventReason::TorqueLimit,
                (false, false) => continue,
            };
            self.broken_joints.push((id, reason));
        }
        // Reuse the scratch capacity while removal mutates the joint map.
        let mut broken = std::mem::take(&mut self.broken_joints);
        for (id, reason) in broken.drain(..) {
            let _ = self.remove_joint_with_reason(id, reason);
        }
        self.broken_joints = broken;
    }

    fn remove_joint_with_reason(
        &mut self,
        id: JointId,
        reason: JointEventReason,
    ) -> Result<(), PhysicsError> {
        let runtime = self.joints.remove(&id).ok_or(PhysicsError::StaleJoint)?;
        self.backend.remove_impulse_joint(native_joint(id));
        if self.joint_events.len() < self.config.max_events {
            self.joint_events.push(JointEvent {
                joint: id,
                body_a: runtime.desc.body_a,
                body_b: runtime.desc.body_b,
                reason,
                reaction: runtime.state,
            });
        } else {
            self.dropped_joint_events = self.dropped_joint_events.saturating_add(1);
        }
        Ok(())
    }

    pub(super) fn validate_joint(
        &self,
        desc: &JointDesc,
    ) -> Result<rp::GenericJoint, PhysicsError> {
        let data = self.joint_data(desc)?;
        let a = self
            .backend
            .bodies
            .get(native_id(desc.body_a))
            .ok_or(PhysicsError::StaleBody)?;
        let b = self
            .backend
            .bodies
            .get(native_id(desc.body_b))
            .ok_or(PhysicsError::StaleBody)?;
        if !a.is_dynamic() && !b.is_dynamic() {
            return Err(PhysicsError::WrongBodyKind);
        }
        Ok(data)
    }

    pub(crate) fn validate_joint_settings(&self, desc: &JointDesc) -> Result<(), PhysicsError> {
        self.joint_data(desc).map(|_| ())
    }

    fn joint_data(&self, desc: &JointDesc) -> Result<rp::GenericJoint, PhysicsError> {
        if desc.body_a == desc.body_b
            || !valid_pose(desc.local_frame_a)
            || !valid_pose(desc.local_frame_b)
            || ![desc.break_force, desc.break_torque]
                .into_iter()
                .flatten()
                .all(|n| bounded(n, 1.0e9))
        {
            return Err(PhysicsError::InvalidJoint);
        }
        validate_frames(desc, self.config.space)?;
        let mut data = match &desc.kind {
            JointKind::Fixed => rp::GenericJoint::new(rp::JointAxesMask::LOCKED_FIXED_AXES),
            JointKind::Spherical => rp::GenericJoint::new(rp::JointAxesMask::LOCKED_SPHERICAL_AXES),
            JointKind::Revolute { limits, motor } => {
                let mut data = rp::GenericJoint::new(rp::JointAxesMask::LOCKED_REVOLUTE_AXES);
                set_actuator(
                    &mut data,
                    rp::JointAxis::AngX,
                    limits,
                    motor.as_ref(),
                    std::f32::consts::PI,
                )?;
                data
            }
            JointKind::ContinuousRevolute { limits, motor } => {
                if self.config.space != Space::PlanarXy {
                    return Err(PhysicsError::OutOfPlane);
                }
                let mut data = rp::GenericJoint::new(rp::JointAxesMask::LOCKED_REVOLUTE_AXES);
                set_actuator(
                    &mut data,
                    rp::JointAxis::AngX,
                    &Some(*limits),
                    motor.as_ref(),
                    1e6,
                )?;
                data
            }
            JointKind::Prismatic { limits, motor } => {
                let mut data = rp::GenericJoint::new(rp::JointAxesMask::LOCKED_PRISMATIC_AXES);
                set_actuator(
                    &mut data,
                    rp::JointAxis::LinX,
                    limits,
                    motor.as_ref(),
                    1.0e6,
                )?;
                data
            }
            JointKind::Distance { length } => {
                if !bounded(*length, 1.0e6) {
                    return Err(PhysicsError::InvalidJoint);
                }
                if *length == 0.0 {
                    rp::GenericJoint::new(rp::JointAxesMask::LOCKED_SPHERICAL_AXES)
                } else {
                    // Rapier's coupled linear limit only enforces its MAX bound.
                    // A radial LinX row, oriented before each substep, supplies a
                    // bilateral distance constraint without locking any rotation.
                    rp::GenericJointBuilder::new(rp::JointAxesMask::empty())
                        .limits(rp::JointAxis::LinX, [*length, *length])
                        .build()
                }
            }
            JointKind::Rope { max_length } => {
                if !bounded(*max_length, 1.0e6) || *max_length == 0.0 {
                    return Err(PhysicsError::InvalidJoint);
                }
                rp::RopeJoint::new(*max_length).data
            }
            JointKind::ElasticRope { max_length, spring } => {
                if !bounded(*max_length, 1e6) || !valid_spring_response(Some(*spring)) {
                    return Err(PhysicsError::InvalidJoint);
                }
                rp::GenericJoint::new(rp::JointAxesMask::empty())
            }
            JointKind::Gear {
                ratio,
                reference_angle,
                spring,
            } => {
                if self.config.space != Space::PlanarXy
                    || !ratio.is_finite()
                    || !(0.0001..=10000.0).contains(&ratio.abs())
                    || !valid_vector(&[*reference_angle])
                    || !valid_spring_response(*spring)
                {
                    return Err(PhysicsError::InvalidJoint);
                }
                rp::GenericJoint::new(rp::JointAxesMask::empty())
            }
            JointKind::Pulley {
                ground_a,
                ground_b,
                length,
                ratio,
                spring,
                ..
            } => {
                if !valid_vector(ground_a)
                    || !valid_vector(ground_b)
                    || !bounded(*length, 1e6)
                    || !ratio.is_finite()
                    || !(0.0001..=10000.0).contains(ratio)
                    || !valid_spring_response(*spring)
                {
                    return Err(PhysicsError::InvalidJoint);
                }
                if self.config.space == Space::PlanarXy
                    && (ground_a[2] != 0.0 || ground_b[2] != 0.0)
                {
                    return Err(PhysicsError::OutOfPlane);
                }
                rp::GenericJoint::new(rp::JointAxesMask::empty())
            }
            JointKind::FrequencySpring {
                rest_length,
                frequency_hz,
                damping_ratio,
            } => {
                if !bounded(*rest_length, 1e6)
                    || !bounded(*frequency_hz, 1000.0)
                    || !bounded(*damping_ratio, 10.0)
                {
                    return Err(PhysicsError::InvalidJoint);
                }
                let omega = std::f32::consts::TAU * frequency_hz;
                spring_data(
                    *rest_length,
                    omega * omega,
                    2.0 * damping_ratio * omega,
                    rp::MotorModel::AccelerationBased,
                )
            }
            JointKind::Spring {
                rest_length,
                stiffness,
                damping,
            }
            | JointKind::AccelerationSpring {
                rest_length,
                stiffness,
                damping,
            } => {
                let normalized = matches!(desc.kind, JointKind::AccelerationSpring { .. });
                if !bounded(*rest_length, 1.0e6)
                    || !bounded(*stiffness, 1.0e6)
                    || (!normalized && *stiffness == 0.0)
                    || !bounded(*damping, 1.0e6)
                {
                    return Err(PhysicsError::InvalidJoint);
                }
                // Use the same radial frame as distance joints, including a
                // remembered direction when both anchors coincide.
                spring_data(
                    *rest_length,
                    *stiffness,
                    *damping,
                    if normalized {
                        rp::MotorModel::AccelerationBased
                    } else {
                        rp::MotorModel::ForceBased
                    },
                )
            }
        };
        data.set_local_frame1(native_pose(desc.local_frame_a));
        data.set_local_frame2(native_pose(desc.local_frame_b));
        if self.config.space == Space::PlanarXy
            && matches!(
                desc.kind,
                JointKind::Revolute { .. } | JointKind::ContinuousRevolute { .. }
            )
        {
            // Planar body locks already eliminate these directions. Near-zero
            // quaternion roundoff in a redundant row can otherwise oppose the
            // remaining Z rotation, particularly with off-center anchors.
            data.locked_axes.remove(
                rp::JointAxesMask::LIN_X | rp::JointAxesMask::ANG_Y | rp::JointAxesMask::ANG_Z,
            );
        }
        if self.config.space == Space::PlanarXy
            && matches!(
                desc.kind,
                JointKind::Fixed | JointKind::Prismatic { .. } | JointKind::Spherical
            )
        {
            data.locked_axes.remove(
                rp::JointAxesMask::LIN_Z | rp::JointAxesMask::ANG_X | rp::JointAxesMask::ANG_Y,
            );
        }
        apply_frame_springs(&mut data, desc)?;
        data.set_contacts_enabled(desc.contacts_enabled);
        data.set_enabled(desc.enabled);
        Ok(data)
    }
}

fn apply_frame_springs(data: &mut rp::GenericJoint, desc: &JointDesc) -> Result<(), PhysicsError> {
    if !valid_spring_response(desc.linear_spring) || !valid_spring_response(desc.angular_spring) {
        return Err(PhysicsError::InvalidJoint);
    }
    if (desc.linear_spring.is_some() || desc.angular_spring.is_some())
        && !matches!(
            desc.kind,
            JointKind::Fixed
                | JointKind::Spherical
                | JointKind::Revolute { .. }
                | JointKind::ContinuousRevolute { .. }
                | JointKind::Prismatic { .. }
        )
    {
        return Err(PhysicsError::InvalidJoint);
    }
    for (mask, response) in [
        (rp::JointAxesMask::LIN_AXES, desc.linear_spring),
        (rp::JointAxesMask::ANG_AXES, desc.angular_spring),
    ] {
        let Some(response) = response else { continue };
        let axes = data.locked_axes & mask;
        if axes.is_empty() {
            return Err(PhysicsError::InvalidJoint);
        }
        // Replace only locked coordinates, preserving limit/motor free axes.
        // A zero/zero native motor would still constrain velocity: omit its row.
        data.locked_axes.remove(axes);
        if response.stiffness == 0.0 && response.damping == 0.0 {
            continue;
        }
        for axis in [
            rp::JointAxis::LinX,
            rp::JointAxis::LinY,
            rp::JointAxis::LinZ,
            rp::JointAxis::AngX,
            rp::JointAxis::AngY,
            rp::JointAxis::AngZ,
        ] {
            if axes.bits() & (1 << axis as usize) != 0 {
                data.set_motor_position(axis, 0.0, response.stiffness, response.damping);
                data.set_motor_model(axis, rp::MotorModel::AccelerationBased);
            }
        }
    }
    Ok(())
}

fn bounded(value: f32, max: f32) -> bool {
    value.is_finite() && (0.0..=max).contains(&value)
}

fn valid_spring_response(response: Option<super::SpringResponse>) -> bool {
    response.is_none_or(|r| bounded(r.stiffness, 1e6) && bounded(r.damping, 1e6))
}

fn spring_data(
    length: f32,
    stiffness: f32,
    damping: f32,
    model: rp::MotorModel,
) -> rp::GenericJoint {
    // Rapier's zero/zero motor has zero CFM and still constrains velocity.
    // An inactive spring must omit that row entirely, retaining only identity.
    let data = rp::GenericJointBuilder::new(rp::JointAxesMask::empty());
    if stiffness == 0.0 && damping == 0.0 {
        data.build()
    } else {
        data.motor_position(rp::JointAxis::LinX, length, stiffness, damping)
            .motor_model(rp::JointAxis::LinX, model)
            .build()
    }
}

fn validate_frames(desc: &JointDesc, space: Space) -> Result<(), PhysicsError> {
    if space != Space::PlanarXy {
        return Ok(());
    }
    for frame in [desc.local_frame_a, desc.local_frame_b] {
        if frame.position[2] != 0.0 {
            return Err(PhysicsError::OutOfPlane);
        }
        match desc.kind {
            JointKind::Revolute { .. } | JointKind::ContinuousRevolute { .. } => {
                let axis = rp::Rotation::from_array(frame.rotation) * rp::Vector::X;
                if axis.x.abs() > 1.0e-5 || axis.y.abs() > 1.0e-5 {
                    return Err(PhysicsError::OutOfPlane);
                }
                if matches!(desc.kind, JointKind::ContinuousRevolute { .. }) && axis.z < 0.99998 {
                    return Err(PhysicsError::OutOfPlane);
                }
            }
            JointKind::Fixed | JointKind::Prismatic { .. }
                if frame.rotation[0] != 0.0 || frame.rotation[1] != 0.0 =>
            {
                return Err(PhysicsError::OutOfPlane);
            }
            _ => {}
        }
    }
    if matches!(
        desc.kind,
        JointKind::Revolute { .. } | JointKind::ContinuousRevolute { .. }
    ) {
        let a = rp::Rotation::from_array(desc.local_frame_a.rotation) * rp::Vector::X;
        let b = rp::Rotation::from_array(desc.local_frame_b.rotation) * rp::Vector::X;
        // Opposite local hinge axes cannot align while both bodies stay in XY.
        if a.dot(b) < 0.99998 {
            return Err(PhysicsError::OutOfPlane);
        }
    }
    Ok(())
}

fn set_actuator(
    data: &mut rp::GenericJoint,
    axis: rp::JointAxis,
    limits: &Option<[f32; 2]>,
    motor: Option<&JointMotor>,
    bound: f32,
) -> Result<(), PhysicsError> {
    if let Some(limits) = limits {
        if !valid_vector(limits) || limits[0] > limits[1] || limits.iter().any(|v| v.abs() > bound)
        {
            return Err(PhysicsError::InvalidJoint);
        }
        data.set_limits(axis, *limits);
    }
    if let Some(motor) = motor {
        if !valid_vector(&[motor.target_position, motor.target_velocity])
            || motor.target_position.abs() > bound
            || !bounded(motor.stiffness, 1.0e6)
            || !bounded(motor.damping, 1.0e6)
            || !bounded(motor.max_force, 1.0e9)
        {
            return Err(PhysicsError::InvalidJoint);
        }
        data.set_motor_model(axis, rp::MotorModel::ForceBased);
        data.set_motor(
            axis,
            motor.target_position,
            motor.target_velocity,
            motor.stiffness,
            motor.damping,
        );
        data.set_motor_max_force(axis, motor.max_force);
    }
    Ok(())
}

fn joint_id(id: rp::ImpulseJointHandle) -> JointId {
    let (slot, generation) = id.into_raw_parts();
    JointId { slot, generation }
}

pub(super) fn native_joint(id: JointId) -> rp::ImpulseJointHandle {
    rp::ImpulseJointHandle::from_raw_parts(id.slot, id.generation)
}

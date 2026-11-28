//! Ratio and elastic cable constraints on the same Rapier bodies and fixed substeps.
//!
//! Gear and pulley Jacobians were checked against Jolt's GearConstraintPart and
//! IndependentAxisConstraintPart. No second world or legacy integration is run.
//! Contact/joint coupling converges across the common substeps; correction uses
//! a bounded split position correction, without adding correction energy to velocity.
use super::contact_policy::ContactPolicies;
use super::joints::JointRuntime;
use super::planar_angle::wrap;
use super::world::native_id;
use super::{BodyId, JointId, JointKind, JointState, PhysicsError, PhysicsWorld3d, SpringResponse};
use rapier3d::parry::{bounding_volume::BoundingVolume, query::contact};
use rapier3d::prelude as rp;
use std::collections::BTreeMap;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ConstraintPass {
    BeforeIntegration,
    AfterIntegration,
    Positions,
}

struct Row {
    linear: [rp::Vector; 2],
    angular: [rp::Vector; 2],
    error: f32,
    unilateral: bool,
    spring: Option<SpringResponse>,
}

#[derive(Default)]
pub(super) struct RatioTick {
    disabled_pairs: Vec<(BodyId, BodyId)>,
    pub(super) skipped_corrections: u32,
}

fn body_pair(a: BodyId, b: BodyId) -> (BodyId, BodyId) {
    (a.min(b), a.max(b))
}

impl RatioTick {
    fn refresh_disabled_pairs(&mut self, joints: &BTreeMap<JointId, JointRuntime>) {
        self.disabled_pairs.clear();
        // The capacity was reserved for all live joints before the tick.
        // Refresh on each pass because a joint may have broken in the meantime.
        self.disabled_pairs
            .extend(joints.values().filter_map(|runtime| {
                let desc = &runtime.desc;
                (!desc.contacts_enabled).then(|| body_pair(desc.body_a, desc.body_b))
            }));
        self.disabled_pairs.sort_unstable();
        self.disabled_pairs.dedup();
    }
}

fn body_id(handle: rp::RigidBodyHandle) -> BodyId {
    let (slot, generation) = handle.into_raw_parts();
    BodyId { slot, generation }
}

fn correction_fits(
    bodies: &rp::RigidBodySet,
    colliders: &rp::ColliderSet,
    policies: &ContactPolicies,
    disabled_pairs: &[(BodyId, BodyId)],
    changes: &[(rp::RigidBodyHandle, rp::Pose)],
    allowed_error: f32,
) -> bool {
    for &(id, pose) in changes {
        if !pose.is_finite() || (pose.rotation.length_squared() - 1.).abs() > 1e-5 {
            return false;
        }
        let body = &bodies[id];
        for &handle in body.colliders() {
            let a = &colliders[handle];
            if !a.is_enabled() || a.is_sensor() {
                continue;
            }
            let local = *a.position_wrt_parent().expect("body owns this collider");
            let old_a = *body.position() * local;
            let new_a = pose * local;
            let bounds = a.shape().compute_aabb(&new_a);
            for (other, b) in colliders.iter() {
                if other == handle
                    || b.parent() == Some(id)
                    || !b.is_enabled()
                    || b.is_sensor()
                    || !a.collision_groups().test(b.collision_groups())
                    || !policies.pair_allows(Some(id), b.parent())
                    || b.parent().is_some_and(|parent| {
                        disabled_pairs
                            .binary_search(&body_pair(body_id(id), body_id(parent)))
                            .is_ok()
                    })
                {
                    continue;
                }
                let (old_b, new_b) = if let Some(parent) = b.parent() {
                    let local = *b.position_wrt_parent().expect("body owns this collider");
                    let old = *bodies[parent].position();
                    let new = changes
                        .iter()
                        .find(|(id, _)| *id == parent)
                        .map_or(old, |(_, pose)| *pose);
                    (old * local, new * local)
                } else {
                    (*b.position(), *b.position())
                };
                if !bounds.intersects(&b.shape().compute_aabb(&new_b))
                    || !policies.one_way_allows_at(handle, &new_a, b.shape(), &new_b)
                    || !policies.one_way_allows_at(other, &new_b, a.shape(), &new_a)
                {
                    continue;
                }
                // Only worsening overlap beyond the linear tolerance can
                // block a correction. A query error holds the correction.
                match contact(&new_a, a.shape(), &new_b, b.shape(), 0.) {
                    Ok(None) => {}
                    Ok(Some(next)) if next.dist.is_finite() && next.dist >= -allowed_error => {}
                    Ok(Some(next)) if next.dist.is_finite() => {
                        let before = contact(&old_a, a.shape(), &old_b, b.shape(), 0.);
                        if !matches!(before, Ok(Some(old)) if old.dist.is_finite() && next.dist >= old.dist)
                        {
                            return false;
                        }
                    }
                    _ => return false,
                }
            }
        }
    }
    true
}

impl PhysicsWorld3d {
    pub(super) fn has_ratio_joints(&self) -> bool {
        self.joints.values().any(|runtime| {
            matches!(
                runtime.desc.kind,
                JointKind::Gear { .. } | JointKind::Pulley { .. } | JointKind::ElasticRope { .. }
            )
        })
    }

    pub(super) fn prepare_rapier_ratio_tick(&mut self) -> Result<(), PhysicsError> {
        if self.has_ratio_joints() {
            self.ratio_tick
                .disabled_pairs
                .try_reserve(
                    self.joints
                        .len()
                        .saturating_sub(self.ratio_tick.disabled_pairs.len()),
                )
                .map_err(|_| PhysicsError::CapacityExceeded)?;
        }
        self.ratio_tick.skipped_corrections = 0;
        Ok(())
    }

    pub(super) fn reset_ratio_impulses(&mut self) {
        for runtime in self.joints.values_mut() {
            runtime.ratio_impulse = 0.0;
            runtime.ratio_reaction = JointState::default();
        }
    }

    pub(super) fn solve_ratio_joints(&mut self, pass: ConstraintPass) {
        let dt = self.backend.integration_parameters.dt;
        let positions = pass == ConstraintPass::Positions;
        if positions {
            self.ratio_tick.refresh_disabled_pairs(&self.joints);
        }
        // Bounded Gauss-Seidel sweeps cover chains of ratio joints without allocating.
        for _ in 0..8 {
            for runtime in self.joints.values_mut() {
                if !runtime.desc.enabled {
                    continue;
                }
                let ids = [
                    native_id(runtime.desc.body_a),
                    native_id(runtime.desc.body_b),
                ];
                let (Some(a), Some(b)) = (
                    self.backend.bodies.get(ids[0]),
                    self.backend.bodies.get(ids[1]),
                ) else {
                    continue;
                };
                if !a.is_enabled()
                    || !b.is_enabled()
                    || (!a.is_dynamic() || a.is_sleeping()) && (!b.is_dynamic() || b.is_sleeping())
                {
                    continue;
                }
                let row = match runtime.desc.kind {
                    JointKind::ElasticRope { max_length, spring } => {
                        let anchors = [
                            a.position() * rp::Vector::from(runtime.desc.local_frame_a.position),
                            b.position() * rp::Vector::from(runtime.desc.local_frame_b.position),
                        ];
                        let delta = anchors[1] - anchors[0];
                        let axis = if delta.length_squared() > 1e-12 {
                            delta.normalize()
                        } else {
                            runtime.radial_direction.unwrap_or(rp::Vector::X)
                        };
                        runtime.radial_direction = Some(axis);
                        Row {
                            linear: [-axis, axis],
                            angular: [
                                -(anchors[0] - a.center_of_mass()).cross(axis),
                                (anchors[1] - b.center_of_mass()).cross(axis),
                            ],
                            error: delta.length() - max_length,
                            unilateral: true,
                            spring: Some(spring),
                        }
                    }
                    JointKind::Gear {
                        ratio,
                        reference_angle,
                        spring,
                    } => {
                        let (Some(aa), Some(ab)) = (
                            self.planar_angles.get(&runtime.desc.body_a),
                            self.planar_angles.get(&runtime.desc.body_b),
                        ) else {
                            continue;
                        };
                        Row {
                            linear: [rp::Vector::ZERO; 2],
                            angular: [rp::Vector::Z * ratio, rp::Vector::Z],
                            error: wrap(
                                ab.value() + f64::from(ratio) * aa.value()
                                    - f64::from(reference_angle),
                            ) as f32,
                            unilateral: false,
                            spring,
                        }
                    }
                    JointKind::Pulley {
                        ground_a,
                        ground_b,
                        length,
                        ratio,
                        slack,
                        spring,
                    } => {
                        let anchors = [
                            a.position() * rp::Vector::from(runtime.desc.local_frame_a.position),
                            b.position() * rp::Vector::from(runtime.desc.local_frame_b.position),
                        ];
                        let segments = [
                            anchors[0] - rp::Vector::from(ground_a),
                            anchors[1] - rp::Vector::from(ground_b),
                        ];
                        let mut axes = [rp::Vector::Y; 2];
                        for i in 0..2 {
                            if segments[i].length_squared() > 1e-12 {
                                runtime.pulley_axes[i] = segments[i].normalize();
                            }
                            axes[i] = runtime.pulley_axes[i];
                        }
                        let linear = [axes[0], axes[1] * ratio];
                        Row {
                            linear,
                            angular: [
                                (anchors[0] - a.center_of_mass()).cross(linear[0]),
                                (anchors[1] - b.center_of_mass()).cross(linear[1]),
                            ],
                            error: segments[0].length() + ratio * segments[1].length() - length,
                            unilateral: slack,
                            spring,
                        }
                    }
                    _ => continue,
                };
                // Elastic forces are solved once for the upcoming integration.
                // Applying a second implicit spring after positions have moved
                // creates a permanent velocity offset under a steady load.
                if row.spring.is_some() && pass != ConstraintPass::BeforeIntegration {
                    continue;
                }
                let bodies = [a, b];
                let mut inverse_mass = 0.0;
                let mut velocity = 0.0;
                for (i, body) in bodies.iter().enumerate() {
                    if body.is_dynamic() {
                        let m = body.mass_properties();
                        inverse_mass += row.linear[i].dot(m.effective_inv_mass * row.linear[i])
                            + row.angular[i].dot(m.effective_world_inv_inertia * row.angular[i]);
                    }
                    if !body.is_fixed() {
                        let anticipated = if row.spring.is_some()
                            && body.body_type() == rp::RigidBodyType::KinematicPositionBased
                        {
                            rp::RigidBodyPosition {
                                position: *body.position(),
                                next_position: *body.next_position(),
                            }
                            .interpolate_velocity(
                                1.0 / dt,
                                body.mass_properties().local_mprops.local_com,
                            )
                        } else {
                            rp::RigidBodyVelocity {
                                linvel: body.linvel(),
                                angvel: body.angvel(),
                            }
                        };
                        velocity += row.linear[i].dot(anticipated.linvel)
                            + row.angular[i].dot(anticipated.angvel);
                    }
                    if row.spring.is_some() && body.is_dynamic() {
                        // Predict the backend's pending gravity/user-force increment
                        // in the row RHS; the backend remains the only integrator.
                        let mass = body.mass_properties();
                        let force = body.user_force()
                            + rp::Vector::from(self.config.gravity)
                                * (body.mass() * body.gravity_scale());
                        velocity += dt
                            * (row.linear[i].dot(mass.effective_inv_mass * force)
                                + row.angular[i]
                                    .dot(mass.effective_world_inv_inertia * body.user_torque()));
                    }
                }
                if inverse_mass <= 1e-12 {
                    continue;
                }
                if positions {
                    if row.unilateral && row.error <= 0.0 {
                        continue;
                    }
                    let lambda = -0.2 * row.error / inverse_mass;
                    let mut linear = [rp::Vector::ZERO; 2];
                    let mut angular = [rp::Vector::ZERO; 2];
                    let mut maximum = 0.0_f32;
                    for i in 0..2 {
                        if bodies[i].is_dynamic() {
                            let mass = bodies[i].mass_properties();
                            linear[i] = mass.effective_inv_mass * row.linear[i] * lambda;
                            angular[i] =
                                (mass.effective_world_inv_inertia * row.angular[i]) * lambda;
                            maximum = maximum
                                .max(linear[i].length())
                                .max(angular[i].length() * self.config.length_unit);
                        }
                    }
                    // Eight sweeps together cannot exceed one substep's configured correction budget.
                    let max_step = self
                        .backend
                        .integration_parameters
                        .max_corrective_velocity()
                        * dt
                        / 8.0;
                    let scale = if maximum > max_step {
                        max_step / maximum
                    } else {
                        1.0
                    };
                    let mut changes = [None; 2];
                    for i in 0..2 {
                        let body = bodies[i];
                        if body.is_dynamic()
                            && (linear[i].length_squared() + angular[i].length_squared()) > 1e-18
                        {
                            let mut pose = *body.position();
                            pose.translation += linear[i] * scale;
                            pose.rotation =
                                rp::Rotation::from_scaled_axis(angular[i] * scale) * pose.rotation;
                            changes[i] = Some((ids[i], pose));
                        }
                    }
                    let mut compact = [(ids[0], *a.position()); 2];
                    let mut count = 0;
                    for change in changes.into_iter().flatten() {
                        compact[count] = change;
                        count += 1;
                    }
                    let changes = &compact[..count];
                    if !correction_fits(
                        &self.backend.bodies,
                        &self.backend.colliders,
                        &self.contact_policies,
                        &self.ratio_tick.disabled_pairs,
                        changes,
                        self.backend.integration_parameters.allowed_linear_error(),
                    ) {
                        self.ratio_tick.skipped_corrections =
                            self.ratio_tick.skipped_corrections.saturating_add(1);
                        continue;
                    }
                    for &(id, pose) in changes {
                        if let Some(body) = self.backend.bodies.get_mut(id) {
                            body.set_position(pose, false);
                            self.query_updates.extend_from_slice(body.colliders());
                        }
                    }
                    continue;
                }
                // Predictive slack permits motion up to the available cable length.
                // Bilateral drift is corrected separately, without adding kinetic energy.
                let bias = if row.unilateral && row.error < 0.0 {
                    row.error / dt
                } else {
                    0.0
                };
                let impulse = if let Some(spring) = row.spring {
                    let rate = dt * dt * spring.stiffness + dt * spring.damping;
                    if rate == 0.0 || row.unilateral && row.error < 0.0 {
                        -runtime.ratio_impulse
                    } else {
                        // Implicit acceleration-based spring, including the accumulated
                        // impulse term so repeated sweeps do not harden the spring.
                        // Multiply through by rate to avoid 1/rate overflow for
                        // tiny valid gains. This is algebraically the same CFM row.
                        -(rate * velocity
                            + dt * spring.stiffness * row.error
                            + inverse_mass * runtime.ratio_impulse)
                            / (inverse_mass * (1.0 + rate))
                    }
                } else {
                    -(velocity + bias) / inverse_mass
                };
                if !impulse.is_finite() {
                    continue;
                }
                let previous = runtime.ratio_impulse;
                runtime.ratio_impulse = if row.unilateral {
                    (previous + impulse).min(0.0)
                } else {
                    previous + impulse
                };
                let delta = runtime.ratio_impulse - previous;
                if delta == 0.0 {
                    continue;
                }
                for (i, &id) in ids.iter().enumerate() {
                    if let Some(body) = self.backend.bodies.get_mut(id) {
                        if body.is_dynamic() {
                            body.apply_impulse(row.linear[i] * delta, false);
                            body.apply_torque_impulse(row.angular[i] * delta, false);
                        }
                    }
                }
                let magnitude = runtime.ratio_impulse.abs() / dt;
                runtime.ratio_reaction.force = runtime
                    .ratio_reaction
                    .force
                    .max(magnitude * row.linear[0].length().max(row.linear[1].length()));
                // A pulley cable transmits force at its attachment, not a couple.
                // Its r × force changes body angular velocity but is already
                // accounted for by the anchor force. A gear transmits pure torque.
                if matches!(runtime.desc.kind, JointKind::Gear { .. }) {
                    runtime.ratio_reaction.torque = runtime
                        .ratio_reaction
                        .torque
                        .max(magnitude * row.angular[0].length().max(row.angular[1].length()));
                }
            }
            if positions {
                self.advance_planar_angles(0.0);
            }
        }
    }
}

//! Recover physical wrenches from native joint row impulses.
//!
//! Rapier 0.36.1 angular locks use quaternion derivatives (half the angular axis
//! near alignment), and its unbounded rows are mass-orthogonalized. Raw scalar
//! impulse norms therefore are not physical force/torque. Cache the same row
//! Jacobians before each single-substep pass, then combine the written impulses.
//! This follows the pinned backend's `JointConstraintHelper`/`JointConstraint`
//! row order. Tests must be retained when upgrading the backend.
use super::joints::native_joint;
use super::world::native_id;
use super::{JointKind, JointState, PhysicsWorld3d};
use rapier3d::prelude as rp;
use rapier3d::utils::RotationOps;

#[derive(Clone, Copy)]
enum Source {
    Lock(usize),
    Limit(usize),
    Motor(usize),
}

struct Row {
    source: Source,
    linear: rp::Vector,
    angular: [rp::Vector; 2],
}

pub(super) struct JointReaction {
    rows: Vec<Row>,
    radii: [rp::Vector; 2],
}

impl Default for JointReaction {
    fn default() -> Self {
        Self {
            rows: Vec::with_capacity(7),
            radii: [rp::Vector::ZERO; 2],
        }
    }
}

impl JointReaction {
    pub(super) fn sample(&self, joint: &rp::ImpulseJoint, inv_dt: f64) -> JointState {
        let mut force = rp::Vector::ZERO;
        let mut torque = [rp::Vector::ZERO; 2];
        for row in &self.rows {
            let impulse = match row.source {
                Source::Lock(i) => joint.impulses[i],
                Source::Limit(i) => joint.data.limits[i].impulse,
                Source::Motor(i) => joint.data.motors[i].impulse,
            };
            force += row.linear * impulse;
            for (i, torque) in torque.iter_mut().enumerate() {
                *torque += row.angular[i] * impulse;
            }
        }
        // Convert center-of-mass moments into couples at the authored anchors.
        let torque = torque
            .iter()
            .zip(self.radii)
            .map(|(torque, radius)| (*torque - radius.cross(force)).as_dvec3().length())
            .fold(0.0_f64, f64::max);
        JointState {
            force: (force.as_dvec3().length() * inv_dt) as f32,
            torque: (torque * inv_dt) as f32,
        }
    }
}

impl PhysicsWorld3d {
    pub(super) fn prepare_joint_reactions(&mut self) {
        for (&id, runtime) in &mut self.joints {
            let reaction = &mut runtime.reaction;
            reaction.rows.clear();
            if !runtime.desc.enabled
                || matches!(
                    runtime.desc.kind,
                    JointKind::Gear { .. }
                        | JointKind::Pulley { .. }
                        | JointKind::ElasticRope { .. }
                )
            {
                continue;
            }
            let (Some(a), Some(b), Some(joint)) = (
                self.backend.bodies.get(native_id(runtime.desc.body_a)),
                self.backend.bodies.get(native_id(runtime.desc.body_b)),
                self.backend.impulse_joints.get(native_joint(id)),
            ) else {
                continue;
            };
            let data = &joint.data;
            let frames = [
                *a.position() * data.local_frame1,
                *b.position() * data.local_frame2,
            ];
            let axes =
                [rp::Vector::X, rp::Vector::Y, rp::Vector::Z].map(|v| frames[0].rotation * v);
            let delta = frames[1].translation - frames[0].translation;
            let centers = [a.center_of_mass(), b.center_of_mass()];
            reaction.radii = [
                frames[0].translation - centers[0],
                frames[1].translation - centers[1],
            ];
            let mut adjusted_anchor = frames[1].translation;
            for (i, axis) in axes.iter().enumerate() {
                if data.locked_axes.bits() & (1 << i) != 0 {
                    adjusted_anchor -= *axis * delta.dot(*axis);
                }
            }
            let arms = [adjusted_anchor - centers[0], reaction.radii[1]];
            let gradient = frames[0].rotation.diff_conj1_2_tr(&frames[1].rotation)
                * frames[0].rotation.dot(frames[1].rotation).signum();
            let locks = data.locked_axes.bits();
            let motors = data.motor_axes.bits() & !locks;
            let limits = data.limit_axes.bits() & !locks;
            let coupled = data.coupled_axes.bits();
            let rows = &mut reaction.rows;
            // Native motors have finite force bounds (even the default MAX
            // force becomes MAX * dt). They do not orthogonalize other motor
            // rows, including the multiple motors used by elastic frame axes.
            for i in (3..6).chain(0..3) {
                if motors & (1 << i) != 0 {
                    rows.push(row(Source::Motor(i), i, axes, arms));
                }
            }
            let start = rows.len();
            for i in 3..6 {
                if locks & (1 << i) != 0 {
                    rows.push(Row {
                        source: Source::Lock(i),
                        linear: rp::Vector::ZERO,
                        angular: [gradient.col(i - 3); 2],
                    });
                }
            }
            for i in 0..3 {
                if locks & (1 << i) != 0 {
                    rows.push(row(Source::Lock(i), i, axes, arms));
                }
            }
            for i in (3..6).chain(0..3) {
                if limits & !coupled & (1 << i) != 0 {
                    rows.push(row(Source::Limit(i), i, axes, arms));
                }
            }
            if limits & coupled & rp::JointAxesMask::LIN_AXES.bits() != 0 {
                // Rope is the only coupled joint exposed by this wrapper.
                let axis = delta.normalize_or_zero();
                let i = (coupled & rp::JointAxesMask::LIN_AXES.bits()).trailing_zeros() as usize;
                rows.push(Row {
                    source: Source::Limit(i),
                    linear: axis,
                    angular: arms.map(|r| r.cross(axis)),
                });
            }
            let bodies = [a, b];
            // Match native mass-weighted Gram-Schmidt. Only unbounded lock rows
            // eliminate components of subsequent rows; finite limits/motors do not.
            for j in start..rows.len() {
                if !matches!(rows[j].source, Source::Lock(_)) {
                    continue;
                }
                let denominator = mass_dot(&rows[j], &rows[j], bodies);
                if denominator == 0.0 {
                    continue;
                }
                for i in (j + 1)..rows.len() {
                    let coefficient = mass_dot(&rows[i], &rows[j], bodies) / denominator;
                    let linear = rows[j].linear * coefficient;
                    let angular = rows[j].angular.map(|a| a * coefficient);
                    rows[i].linear -= linear;
                    for (axis, component) in rows[i].angular.iter_mut().zip(angular) {
                        *axis -= component;
                    }
                }
            }
        }
    }
}

fn row(source: Source, i: usize, axes: [rp::Vector; 3], arms: [rp::Vector; 2]) -> Row {
    if i >= 3 {
        Row {
            source,
            linear: rp::Vector::ZERO,
            angular: [axes[i - 3]; 2],
        }
    } else {
        Row {
            source,
            linear: axes[i],
            angular: arms.map(|r| r.cross(axes[i])),
        }
    }
}

fn mass_dot(a: &Row, b: &Row, bodies: [&rp::RigidBody; 2]) -> f32 {
    bodies
        .iter()
        .enumerate()
        .filter(|(_, body)| body.is_dynamic())
        .map(|(i, body)| {
            let mass = body.mass_properties();
            a.linear.dot(mass.effective_inv_mass * b.linear)
                + a.angular[i].dot(mass.effective_world_inv_inertia * b.angular[i])
        })
        .sum()
}

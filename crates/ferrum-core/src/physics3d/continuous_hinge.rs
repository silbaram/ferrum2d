//! Continuous planar limits expressed as local angular rows in the native solver.
//!
//! Recenter before every native substep so the solver sees a small relative angle,
//! while the authoring coordinate retains whole turns. Distant violations retain
//! their direction and recover at the native correction speed. Contacts, anchors,
//! motor impulses and reaction/break sampling still use the same solver pass.
use super::joints::native_joint;
use super::world::native_id;
use super::{JointKind, PhysicsWorld3d};
use rapier3d::prelude as rp;

impl PhysicsWorld3d {
    pub(super) fn limit_hinge_motors(&mut self) {
        let dt = self.backend.integration_parameters.dt;
        for (&id, runtime) in &self.joints {
            let motor = match &runtime.desc.kind {
                JointKind::Revolute {
                    limits: Some(_),
                    motor: Some(motor),
                }
                | JointKind::ContinuousRevolute {
                    motor: Some(motor), ..
                } => motor,
                _ => continue,
            };
            let (Some(a), Some(b), Some(joint)) = (
                self.backend.bodies.get(native_id(runtime.desc.body_a)),
                self.backend.bodies.get(native_id(runtime.desc.body_b)),
                self.backend.impulse_joints.get_mut(native_joint(id), false),
            ) else {
                continue;
            };
            if joint.data.locked_axes.contains(rp::JointAxesMask::ANG_X) {
                continue;
            }
            let frames = [
                a.rotation() * joint.data.local_frame1.rotation,
                b.rotation() * joint.data.local_frame2.rotation,
            ];
            let relative = frames[0].inverse() * frames[1];
            let sign = 1.0_f32.copysign(frames[0].dot(frames[1]));
            let coordinate = 2.0 * (relative.x * sign).atan2(relative.w * sign);
            let axis = rp::JointAxis::AngX as usize;
            let limits = joint.data.limits[axis];
            // Native linear motors already honor limits in their target speed;
            // angular motors do not. Avoid repeatedly accelerating into a stop
            // after its unilateral row releases during the relaxed solve.
            joint.data.motors[axis].target_vel = motor.target_velocity.clamp(
                (limits.min - coordinate) / dt,
                (limits.max - coordinate) / dt,
            );
            joint.data.motors[axis].target_pos = joint.data.motors[axis]
                .target_pos
                .clamp(limits.min, limits.max);
        }
    }

    pub(super) fn update_continuous_hinge_frames(&mut self) {
        let frame = rp::Rotation::from_rotation_y(-std::f32::consts::FRAC_PI_2);
        for (&id, runtime) in &self.joints {
            let JointKind::ContinuousRevolute { limits, motor } = &runtime.desc.kind else {
                continue;
            };
            if !runtime.desc.enabled {
                continue;
            }
            let (Some(angle_a), Some(angle_b), Some(a), Some(b)) = (
                self.planar_angles.get(&runtime.desc.body_a),
                self.planar_angles.get(&runtime.desc.body_b),
                self.backend.bodies.get(native_id(runtime.desc.body_a)),
                self.backend.bodies.get(native_id(runtime.desc.body_b)),
            ) else {
                continue;
            };
            let coordinate = angle_b.value() - angle_a.value();
            // Keep subtraction in f64: authored turns can dwarf the local limit error.
            let local = |value: f32| {
                (f64::from(value) - coordinate)
                    .clamp(-std::f64::consts::FRAC_PI_2, std::f64::consts::FRAC_PI_2)
                    as f32
            };
            if let Some(joint) = self.backend.impulse_joints.get_mut(native_joint(id), false) {
                joint.data.local_frame1.rotation = a.rotation().inverse() * frame;
                joint.data.local_frame2.rotation = b.rotation().inverse() * frame;
                let locked_target = if limits[0] == limits[1] {
                    // A zero-width interval is bilateral. Two unilateral limit
                    // sides can alternate on quaternion roundoff at the target,
                    // producing twice the steady reaction on every other pass.
                    // Angular locks do not have the limit row's native bias cap.
                    // Their error/Jacobian ratio is 2*tan(target/2), so bound the
                    // target by the same configured corrective angular speed.
                    let params = &self.backend.integration_parameters;
                    let gain = joint.data.softness.erp_inv_dt(params.dt);
                    let max_target = if gain > 0.0 {
                        2.0 * (params.max_corrective_velocity() / (2.0 * gain)).atan()
                    } else {
                        std::f32::consts::FRAC_PI_2
                    };
                    let target = local(limits[0]).clamp(-max_target, max_target);
                    joint.data.limit_axes.remove(rp::JointAxesMask::ANG_X);
                    joint.data.locked_axes.insert(rp::JointAxesMask::ANG_X);
                    joint.data.local_frame2.rotation *= rp::Rotation::from_rotation_x(-target);
                    target
                } else {
                    joint.data.locked_axes.remove(rp::JointAxesMask::ANG_X);
                    joint
                        .data
                        .set_limits(rp::JointAxis::AngX, limits.map(local));
                    0.0
                };
                if let Some(motor) = motor {
                    joint.data.motors[rp::JointAxis::AngX as usize].target_pos =
                        (local(motor.target_position) - locked_target)
                            .clamp(-std::f32::consts::FRAC_PI_2, std::f32::consts::FRAC_PI_2);
                }
            }
        }
    }
}

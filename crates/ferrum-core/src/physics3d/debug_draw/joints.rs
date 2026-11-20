use super::*;
use crate::physics3d::{world::native_id, world::native_pose, JointKind};

const JOINT: [f32; 4] = [1., 0.8, 0.2, 1.];
pub(super) const GEAR: [f32; 4] = [1., 0.2, 1., 1.];

impl PhysicsWorld3d {
    pub(super) fn debug_joints<F: FnMut(DebugLine3d) -> bool>(&self, draw: &mut Draw<F>) {
        let scale = self.config.length_unit * 0.2;
        for runtime in self.joints.values() {
            if !draw.visit() {
                return;
            }
            let desc = &runtime.desc;
            if !draw.visit() {
                return;
            }
            let Some(a) = self.backend.bodies.get(native_id(desc.body_a)) else {
                continue;
            };
            if !draw.visit() {
                return;
            }
            let Some(b) = self.backend.bodies.get(native_id(desc.body_b)) else {
                continue;
            };
            let fa = *a.position() * native_pose(desc.local_frame_a);
            let fb = *b.position() * native_pose(desc.local_frame_b);
            let enabled = desc.enabled && a.is_enabled() && b.is_enabled();
            let color = if enabled { JOINT } else { DISABLED };
            if matches!(desc.kind, JointKind::Gear { .. }) {
                let color = if enabled { GEAR } else { DISABLED };
                // A gear couples angles; a dashed association is deliberately
                // different from the continuous cable/distance segment.
                for i in 0..3 {
                    let delta = b.position().translation - a.position().translation;
                    if !draw.line(
                        a.position().translation + delta * (i as f32 / 3.),
                        a.position().translation + delta * ((i as f32 + 0.5) / 3.),
                        color,
                    ) {
                        return;
                    }
                }
                for body in [a, b] {
                    draw.ring(
                        body.position().translation,
                        rp::Vector::X,
                        rp::Vector::Y,
                        scale,
                        color,
                    );
                    if draw.stopped {
                        return;
                    }
                }
                continue;
            }
            if !draw.line(a.position().translation, fa.translation, color)
                || !draw.line(b.position().translation, fb.translation, color)
            {
                return;
            }
            match &desc.kind {
                JointKind::Pulley {
                    ground_a, ground_b, ..
                } => {
                    if !draw.line(fa.translation, (*ground_a).into(), color)
                        || !draw.line((*ground_a).into(), (*ground_b).into(), color)
                        || !draw.line((*ground_b).into(), fb.translation, color)
                    {
                        return;
                    }
                }
                _ => {
                    if !draw.line(fa.translation, fb.translation, color) {
                        return;
                    }
                }
            }
            for frame in [fa, fb] {
                for (axis, rgb) in [
                    (rp::Vector::X, [1., 0.2, 0.2, 1.]),
                    (rp::Vector::Y, [0.2, 1., 0.2, 1.]),
                    (rp::Vector::Z, [0.2, 0.4, 1., 1.]),
                ] {
                    if !draw.line(
                        frame.translation,
                        frame * (axis * scale),
                        if enabled { rgb } else { DISABLED },
                    ) {
                        return;
                    }
                }
            }
            match &desc.kind {
                JointKind::Prismatic {
                    limits: Some([min, max]),
                    ..
                } => {
                    let axis = fa.rotation * rp::Vector::X;
                    let tangent = fa.rotation * rp::Vector::Y * scale * 0.1;
                    let low = fa.translation + axis * *min;
                    let high = fa.translation + axis * *max;
                    if !draw.line(low, high, color)
                        || !draw.line(low - tangent, low + tangent, color)
                        || !draw.line(high - tangent, high + tangent, color)
                    {
                        return;
                    }
                }
                JointKind::Revolute {
                    limits: Some(limits),
                    ..
                }
                | JointKind::ContinuousRevolute { limits, .. } => {
                    // One bounded sample of the authored range. Continuous
                    // multi-turn intervals are not expanded into unbounded arcs.
                    let extent = (limits[1] - limits[0]).min(std::f32::consts::TAU);
                    let start = limits[0].rem_euclid(std::f32::consts::TAU);
                    for i in 0..SEGMENTS {
                        let a = start + extent * i as f32 / SEGMENTS as f32;
                        let b = start + extent * (i + 1) as f32 / SEGMENTS as f32;
                        if !draw.line(
                            fa * rp::Vector::new(0., a.cos() * scale, a.sin() * scale),
                            fa * rp::Vector::new(0., b.cos() * scale, b.sin() * scale),
                            color,
                        ) {
                            return;
                        }
                    }
                }
                _ => {}
            }
            if draw.stopped {
                return;
            }
        }
    }
}

//! Read-only, bounded native wire geometry. No renderer or query state is touched.
use super::PhysicsWorld3d;
use rapier3d::parry::shape::Shape as NativeShape;
use rapier3d::prelude as rp;

mod joints;
mod shapes;
#[cfg(test)]
mod tests;

const BROADPHASE: u32 = 1;
const CONTACTS: u32 = 2;
const COLLIDERS: u32 = 4;
const JOINTS: u32 = 8;
const SLEEPING: u32 = 16;
const CCD: u32 = 32;
const ALL: u32 = 63;
const MAX_LINES: u32 = 16_384;
const MAX_WORK: u32 = 65_536;
const SEGMENTS: usize = 16;
const DISABLED: [f32; 4] = [0.5, 0.5, 0.5, 0.7];
const SENSOR: [f32; 4] = [1., 0.5, 0., 1.];
const FIXED: [f32; 4] = [0.2, 0.7, 1., 1.];
const KINEMATIC: [f32; 4] = [0.8, 0.3, 1., 1.];
const DYNAMIC: [f32; 4] = [0.1, 1., 0.2, 1.];
const ASLEEP: [f32; 4] = [0.35, 0.55, 0.35, 1.];
const BOUNDS: [f32; 4] = [0., 1., 1., 0.6];
const CONTACT: [f32; 4] = [1., 0.1, 0.1, 1.];
const CLAMP: [f32; 4] = [1., 1., 0., 1.];

/// One world-space native line. The Engine selects its existing render adapter.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DebugLine3d {
    pub from: [f32; 3],
    pub to: [f32; 3],
    pub color: [f32; 4],
}

/// Existing six collision debug bits and independently bounded output/work.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DebugDrawOptions {
    pub flags: u32,
    pub max_lines: u32,
    pub max_work: u32,
}

/// Visits count raw arena slots, parent bodies, geometry items and line attempts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct DebugDrawStatistics {
    pub lines: u32,
    pub work: u32,
    pub truncated: bool,
    pub unsupported_shapes: u32,
}

struct Draw<F> {
    sink: F,
    statistics: DebugDrawStatistics,
    max_lines: u32,
    max_work: u32,
    stopped: bool,
}

impl<F: FnMut(DebugLine3d) -> bool> Draw<F> {
    fn visit(&mut self) -> bool {
        if self.stopped {
            return false;
        }
        if self.statistics.work == self.max_work {
            return self.stop();
        }
        self.statistics.work += 1;
        true
    }
    fn stop(&mut self) -> bool {
        self.stopped = true;
        self.statistics.truncated = true;
        false
    }
    fn unsupported(&mut self) {
        self.statistics.unsupported_shapes += 1;
        self.statistics.truncated = true;
    }
    fn line(&mut self, from: rp::Vector, to: rp::Vector, color: [f32; 4]) -> bool {
        if !self.visit() {
            return false;
        }
        if !from.is_finite() || !to.is_finite() || color.iter().any(|c| !c.is_finite()) {
            return self.stop();
        }
        if self.statistics.lines == self.max_lines {
            return self.stop();
        }
        if !(self.sink)(DebugLine3d {
            from: from.to_array(),
            to: to.to_array(),
            color,
        }) {
            return self.stop();
        }
        self.statistics.lines += 1;
        true
    }
    fn cross(&mut self, at: rp::Vector, size: f32, color: [f32; 4]) {
        for axis in [rp::Vector::X, rp::Vector::Y, rp::Vector::Z] {
            if !self.line(at - axis * size, at + axis * size, color) {
                return;
            }
        }
    }
    fn ring(&mut self, at: rp::Vector, u: rp::Vector, v: rp::Vector, radius: f32, color: [f32; 4]) {
        for i in 0..SEGMENTS {
            let a = i as f32 * std::f32::consts::TAU / SEGMENTS as f32;
            let b = (i + 1) as f32 * std::f32::consts::TAU / SEGMENTS as f32;
            if !self.line(
                at + (u * a.cos() + v * a.sin()) * radius,
                at + (u * b.cos() + v * b.sin()) * radius,
                color,
            ) {
                return;
            }
        }
    }
    fn box_edges(&mut self, min: rp::Vector, max: rp::Vector, pose: rp::Pose, color: [f32; 4]) {
        let p = [
            [min.x, min.y, min.z],
            [max.x, min.y, min.z],
            [max.x, max.y, min.z],
            [min.x, max.y, min.z],
            [min.x, min.y, max.z],
            [max.x, min.y, max.z],
            [max.x, max.y, max.z],
            [min.x, max.y, max.z],
        ]
        .map(|v| pose * rp::Vector::from(v));
        for [a, b] in [
            [0, 1],
            [1, 2],
            [2, 3],
            [3, 0],
            [4, 5],
            [5, 6],
            [6, 7],
            [7, 4],
            [0, 4],
            [1, 5],
            [2, 6],
            [3, 7],
        ] {
            if !self.line(p[a], p[b], color) {
                return;
            }
        }
    }
}

fn collider_pose(world: &PhysicsWorld3d, collider: &rp::Collider) -> rp::Pose {
    collider
        .parent()
        .and_then(|id| world.backend.bodies.get(id))
        .zip(collider.position_wrt_parent())
        .map_or(*collider.position(), |(body, local)| {
            *body.position() * *local
        })
}

fn collider_color(world: &PhysicsWorld3d, collider: &rp::Collider) -> [f32; 4] {
    let body = collider
        .parent()
        .and_then(|id| world.backend.bodies.get(id));
    if !collider.is_enabled() || body.is_some_and(|b| !b.is_enabled()) {
        DISABLED
    } else if collider.is_sensor() {
        SENSOR
    } else if body.is_some_and(|b| b.is_dynamic() && b.is_sleeping()) {
        ASLEEP
    } else {
        match body.map(|b| b.body_type()) {
            Some(rp::RigidBodyType::Dynamic) => DYNAMIC,
            Some(
                rp::RigidBodyType::KinematicPositionBased
                | rp::RigidBodyType::KinematicVelocityBased,
            ) => KINEMATIC,
            _ => FIXED,
        }
    }
}

impl PhysicsWorld3d {
    /// CCD geometry may come from a retained Engine frame rather than only the
    /// world's latest tick. No gameplay-entity identity is required for terrain.
    /// Callers supply a dense, bounded-next iterator of witness/normal pairs.
    pub(crate) fn debug_draw(
        &self,
        options: DebugDrawOptions,
        ccd: impl IntoIterator<Item = ([f32; 3], [f32; 3])>,
        sink: impl FnMut(DebugLine3d) -> bool,
    ) -> DebugDrawStatistics {
        let flags = options.flags & ALL;
        if flags == 0 {
            return DebugDrawStatistics::default();
        }
        let mut draw = Draw {
            sink,
            statistics: DebugDrawStatistics::default(),
            max_lines: options.max_lines.min(MAX_LINES),
            max_work: options.max_work.min(MAX_WORK),
            stopped: false,
        };
        if flags & (BROADPHASE | COLLIDERS) != 0 {
            // Arena iterators skip vacant slots inside next(). Charge each raw
            // slot ourselves so a sparse historical arena cannot evade work.
            // Unknown-generation reads enumerate live storage, never resolve a
            // caller-supplied identity or retain a handle across mutations.
            let mut raw_slot = 0;
            let mut seen_live = 0;
            while seen_live < self.backend.colliders.len() {
                if !draw.visit() {
                    break;
                }
                let entry = self.backend.colliders.get_unknown_gen(raw_slot);
                raw_slot += 1;
                let Some((collider, _)) = entry else {
                    continue;
                };
                seen_live += 1;
                if collider.parent().is_some() && !draw.visit() {
                    break;
                }
                let pose = collider_pose(self, collider);
                let color = collider_color(self, collider);
                if flags & BROADPHASE != 0 {
                    draw.shape_bounds(collider.shape(), pose);
                }
                if flags & COLLIDERS != 0 && !draw.stopped {
                    draw.shape(collider.shape(), pose, color);
                }
                if draw.stopped {
                    break;
                }
            }
        }
        if flags & CONTACTS != 0 && !draw.stopped {
            self.debug_contacts(&mut draw);
        }
        if flags & JOINTS != 0 && !draw.stopped {
            self.debug_joints(&mut draw);
        }
        if flags & SLEEPING != 0 && !draw.stopped {
            let mut raw_slot = 0;
            let mut seen_live = 0;
            while seen_live < self.backend.bodies.len() {
                if !draw.visit() {
                    break;
                }
                let entry = self.backend.bodies.get_unknown_gen(raw_slot);
                raw_slot += 1;
                let Some((body, _)) = entry else {
                    continue;
                };
                seen_live += 1;
                if !body.is_dynamic() {
                    continue;
                }
                let color = if !body.is_enabled() {
                    DISABLED
                } else if body.is_sleeping() {
                    ASLEEP
                } else {
                    DYNAMIC
                };
                draw.cross(
                    body.position().translation,
                    self.config.length_unit * 0.04,
                    color,
                );
                if draw.stopped {
                    break;
                }
            }
        }
        if flags & CCD != 0 && !draw.stopped {
            for (point, normal) in ccd {
                if !draw.visit() {
                    break;
                }
                let at = rp::Vector::from(point);
                draw.cross(at, self.config.length_unit * 0.04, CLAMP);
                draw.line(
                    at,
                    at + rp::Vector::from(normal) * self.config.length_unit * 0.2,
                    CLAMP,
                );
                if draw.stopped {
                    break;
                }
            }
        }
        draw.statistics
    }

    fn debug_contacts<F: FnMut(DebugLine3d) -> bool>(&self, draw: &mut Draw<F>) {
        for pair in self.backend.narrow_phase.contact_pairs() {
            if !draw.visit() {
                return;
            }
            let Some(a) = self.backend.colliders.get(pair.collider1) else {
                continue;
            };
            let Some(b) = self.backend.colliders.get(pair.collider2) else {
                continue;
            };
            if !draw.visit() || !draw.visit() {
                return;
            }
            let pa = collider_pose(self, a);
            let pb = collider_pose(self, b);
            for manifold in pair.manifolds() {
                if !draw.visit() {
                    return;
                }
                let ma = manifold.subshape_pos1().map_or(pa, |local| pa * *local);
                let mb = manifold.subshape_pos2().map_or(pb, |local| pb * *local);
                for contact in manifold.contacts() {
                    if !draw.visit() {
                        return;
                    }
                    let from = ma * contact.local_p1;
                    if !draw.line(from, mb * contact.local_p2, CONTACT)
                        || !draw.line(
                            from,
                            ma * (contact.local_p1
                                + manifold.local_n1 * self.config.length_unit * 0.2),
                            CONTACT,
                        )
                    {
                        return;
                    }
                }
            }
        }
    }
}

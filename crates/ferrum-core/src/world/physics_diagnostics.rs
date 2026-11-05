use super::World;
use crate::components::*;
use crate::entity::Entity;
use std::collections::BTreeMap;

pub(crate) type JointLoadKey = (u32, u32, u32);
const EVENT_CAP: usize = 256;
#[derive(Clone, Default)]
pub(crate) struct PhysicsDiagnostics {
    pub enabled: bool,
    pub loads: BTreeMap<JointLoadKey, JointLoad>,
    pub joints: Vec<[f64; 6]>,
    pub ccd: Vec<[f64; 3]>,
    pub breaks: Vec<[f64; 6]>,
    pub dropped: u32,
    pub breaks_dropped: u32,
}
impl PhysicsDiagnostics {
    pub fn begin_step(&mut self) {
        self.joints.clear();
        self.ccd.clear();
        self.dropped = 0;
    }
}
#[derive(Clone, Default)]
pub(crate) struct JointLoad {
    impulses: [[f32; 3]; 2],
    force_limit: f32,
    torque_limit: f32,
}
pub(crate) struct JointMeasure {
    key: JointLoadKey,
    entities: [Entity; 2],
    momenta: [[f32; 3]; 2],
}
impl World {
    pub(crate) fn begin_joint_measure(
        &mut self,
        key: JointLoadKey,
        a: Entity,
        b: Entity,
        force: f32,
        torque: f32,
    ) -> Option<JointMeasure> {
        if !self.physics_diagnostics.enabled && !force.is_finite() && !torque.is_finite() {
            return None;
        }
        self.physics_diagnostics
            .loads
            .entry(key)
            .or_insert(JointLoad {
                force_limit: force,
                torque_limit: torque,
                ..JointLoad::default()
            });
        Some(JointMeasure {
            key,
            entities: [a, b],
            momenta: [self.body_momentum(a), self.body_momentum(b)],
        })
    }
    fn body_momentum(&self, entity: Entity) -> [f32; 3] {
        let Some(body) = self.rigid_body(entity) else {
            return [0.0; 3];
        };
        let index = entity.id as usize;
        let v = self.velocity_at_index_or_default(index);
        let w = self
            .angular_velocities
            .get(index)
            .and_then(|w| *w)
            .map_or(0.0, |w| w.radians_per_second);
        [
            if body.inverse_mass > 0.0 {
                v.vx / body.inverse_mass
            } else {
                0.0
            },
            if body.inverse_mass > 0.0 {
                v.vy / body.inverse_mass
            } else {
                0.0
            },
            if body.inverse_inertia > 0.0 {
                w / body.inverse_inertia
            } else {
                0.0
            },
        ]
    }
    pub(crate) fn finish_joint_measure(&mut self, sample: Option<JointMeasure>) {
        let Some(sample) = sample else {
            return;
        };
        let now = [
            self.body_momentum(sample.entities[0]),
            self.body_momentum(sample.entities[1]),
        ];
        if let Some(load) = self.physics_diagnostics.loads.get_mut(&sample.key) {
            for (i, momentum) in now.iter().enumerate() {
                for (j, value) in momentum.iter().enumerate() {
                    load.impulses[i][j] += value - sample.momenta[i][j];
                }
            }
        }
    }
    pub(crate) fn record_joint_break(
        &mut self,
        key: JointLoadKey,
        reason: u32,
        force: f32,
        torque: f32,
    ) {
        let d = &mut self.physics_diagnostics;
        if d.breaks.len() < EVENT_CAP {
            d.breaks.push([
                key.0 as f64,
                key.1 as f64,
                key.2 as f64,
                reason as f64,
                force as f64,
                torque as f64,
            ]);
        } else {
            d.breaks_dropped = d.breaks_dropped.saturating_add(1);
        }
    }
    pub(crate) fn record_ccd_limit(&mut self, index: usize, reason: u32) {
        let d = &mut self.physics_diagnostics;
        if !d.enabled {
            return;
        }
        if d.ccd.len() < EVENT_CAP {
            d.ccd
                .push([index as f64, self.generations[index] as f64, reason as f64]);
        } else {
            d.dropped = d.dropped.saturating_add(1);
        }
    }
    pub(crate) fn finish_joint_loads(&mut self, dt: f32) -> u32 {
        let loads = std::mem::take(&mut self.physics_diagnostics.loads);
        let mut broken = 0;
        for (key, load) in &loads {
            let force = load
                .impulses
                .iter()
                .map(|v| v[0].hypot(v[1]) / dt)
                .fold(0.0, f32::max);
            let torque = load
                .impulses
                .iter()
                .map(|v| v[2].abs() / dt)
                .fold(0.0, f32::max);
            if self.physics_diagnostics.enabled {
                if self.physics_diagnostics.joints.len() < EVENT_CAP {
                    self.physics_diagnostics.joints.push([
                        key.0 as f64,
                        key.1 as f64,
                        key.2 as f64,
                        force as f64,
                        torque as f64,
                        self.joint_constraint_error(*key) as f64,
                    ]);
                } else {
                    self.physics_diagnostics.dropped =
                        self.physics_diagnostics.dropped.saturating_add(1);
                }
            }
            let reason = if force > load.force_limit {
                1
            } else if torque > load.torque_limit {
                2
            } else {
                0
            };
            if reason != 0 && self.clear_load_joint(*key) {
                self.record_joint_break(*key, reason, force, torque);
                broken += 1;
            }
        }
        self.physics_diagnostics.loads = loads;
        broken
    }
    fn clear_load_joint(&mut self, key: JointLoadKey) -> bool {
        match key.0 {
            0 => self
                .clear_distance_joint(DistanceJointId {
                    index: key.1,
                    generation: key.2,
                })
                .is_some(),
            1 => self
                .clear_rope_joint(RopeJointId {
                    index: key.1,
                    generation: key.2,
                })
                .is_some(),
            2 => self
                .clear_spring_joint(SpringJointId {
                    index: key.1,
                    generation: key.2,
                })
                .is_some(),
            3 => self
                .clear_revolute_joint(RevoluteJointId {
                    index: key.1,
                    generation: key.2,
                })
                .is_some(),
            4 => self
                .clear_prismatic_joint(PrismaticJointId {
                    index: key.1,
                    generation: key.2,
                })
                .is_some(),
            5 => self
                .clear_gear_joint(GearJointId {
                    index: key.1,
                    generation: key.2,
                })
                .is_some(),
            6 => self
                .clear_weld_joint(WeldJointId {
                    index: key.1,
                    generation: key.2,
                })
                .is_some(),
            7 => self
                .clear_pulley_joint(PulleyJointId {
                    index: key.1,
                    generation: key.2,
                })
                .is_some(),
            _ => false,
        }
    }
    fn joint_constraint_error(&self, key: JointLoadKey) -> f32 {
        // Scalar geometric violation; angular joints report radians.
        match key.0 {
            0 => {
                let Some(j) = self.distance_joint(DistanceJointId {
                    index: key.1,
                    generation: key.2,
                }) else {
                    return 0.0;
                };
                let a = self.anchor_point(j.entity_a, j.local_anchor_a_x, j.local_anchor_a_y);
                let b = self.anchor_point(j.entity_b, j.local_anchor_b_x, j.local_anchor_b_y);
                ((b.0 - a.0).hypot(b.1 - a.1) - j.rest_length).abs()
            }
            1 => {
                let Some(j) = self.rope_joint(RopeJointId {
                    index: key.1,
                    generation: key.2,
                }) else {
                    return 0.0;
                };
                let a = self.anchor_point(j.entity_a, j.local_anchor_a_x, j.local_anchor_a_y);
                let b = self.anchor_point(j.entity_b, j.local_anchor_b_x, j.local_anchor_b_y);
                ((b.0 - a.0).hypot(b.1 - a.1) - j.max_length).max(0.0)
            }
            2 => {
                let Some(j) = self.spring_joint(SpringJointId {
                    index: key.1,
                    generation: key.2,
                }) else {
                    return 0.0;
                };
                let a = self.anchor_point(j.entity_a, j.local_anchor_a_x, j.local_anchor_a_y);
                let b = self.anchor_point(j.entity_b, j.local_anchor_b_x, j.local_anchor_b_y);
                ((b.0 - a.0).hypot(b.1 - a.1) - j.rest_length).abs()
            }
            3 => {
                let Some(j) = self.revolute_joint(RevoluteJointId {
                    index: key.1,
                    generation: key.2,
                }) else {
                    return 0.0;
                };
                let a = self.anchor_point(j.entity_a, j.local_anchor_a_x, j.local_anchor_a_y);
                let b = self.anchor_point(j.entity_b, j.local_anchor_b_x, j.local_anchor_b_y);
                (b.0 - a.0).hypot(b.1 - a.1)
            }
            4 => {
                let Some(j) = self.prismatic_joint(PrismaticJointId {
                    index: key.1,
                    generation: key.2,
                }) else {
                    return 0.0;
                };
                let a = self.anchor_point(j.entity_a, j.local_anchor_a_x, j.local_anchor_a_y);
                let b = self.anchor_point(j.entity_b, j.local_anchor_b_x, j.local_anchor_b_y);
                let (sin, cos) = self
                    .rotation(j.entity_a)
                    .unwrap_or_default()
                    .radians
                    .sin_cos();
                let axis_x = cos * j.local_axis_a_x - sin * j.local_axis_a_y;
                let axis_y = sin * j.local_axis_a_x + cos * j.local_axis_a_y;
                let len = axis_x.hypot(axis_y).max(f32::EPSILON);
                ((b.0 - a.0) * axis_y - (b.1 - a.1) * axis_x).abs() / len
            }
            5 => {
                let Some(j) = self.gear_joint(GearJointId {
                    index: key.1,
                    generation: key.2,
                }) else {
                    return 0.0;
                };
                (self.rotation(j.entity_a).unwrap_or_default().radians
                    + j.ratio * self.rotation(j.entity_b).unwrap_or_default().radians
                    - j.reference_angle)
                    .abs()
            }
            6 => {
                let Some(j) = self.weld_joint(WeldJointId {
                    index: key.1,
                    generation: key.2,
                }) else {
                    return 0.0;
                };
                (self.rotation(j.entity_b).unwrap_or_default().radians
                    - self.rotation(j.entity_a).unwrap_or_default().radians
                    - j.reference_angle)
                    .abs()
            }
            7 => {
                let Some(j) = self.pulley_joint(PulleyJointId {
                    index: key.1,
                    generation: key.2,
                }) else {
                    return 0.0;
                };
                let a = self.anchor_point(j.entity_a, j.local_anchor_a_x, j.local_anchor_a_y);
                let b = self.anchor_point(j.entity_b, j.local_anchor_b_x, j.local_anchor_b_y);
                ((a.0 - j.ground_anchor_a_x).hypot(a.1 - j.ground_anchor_a_y)
                    + j.ratio * (b.0 - j.ground_anchor_b_x).hypot(b.1 - j.ground_anchor_b_y)
                    - j.rest_length)
                    .abs()
            }
            _ => 0.0,
        }
    }
    fn anchor_point(&self, entity: Entity, x: f32, y: f32) -> (f32, f32) {
        let p = self.transform(entity).unwrap_or_default();
        let (s, c) = self.rotation(entity).unwrap_or_default().radians.sin_cos();
        (p.x + c * x - s * y, p.y + s * x + c * y)
    }
}

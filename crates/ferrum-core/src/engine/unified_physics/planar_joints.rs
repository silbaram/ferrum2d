//! Legacy joint identity/authoring bridge; all constraints act on the unified bodies.
use super::planar_geometry::rotation;
use super::{UnifiedPhysicsError, UnifiedPhysicsRuntime};
use crate::components as c;
use crate::entity::Entity;
use crate::physics3d::{
    BodyId, BodyKind, JointDesc, JointEvent, JointEventReason, JointId, JointKind, JointMotor,
    PhysicsError, Space, SpringResponse,
};
use crate::world::World;

pub(super) type Key = (u32, u32, u32);

#[cfg(test)]
impl JointBinding {
    pub(in crate::engine) fn corrupt_runtime_payload_fixture(&mut self) {
        self.source.break_distance = Some(f32::NAN);
    }
}
#[cfg(test)]
impl PendingJoint {
    pub(in crate::engine) fn corrupt_runtime_payload_fixture(&mut self) {
        self.desc.local_frame_a.position[0] = f32::NAN;
    }
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct JointBinding {
    pub(super) native: JointId,
    source: PendingJoint,
}
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct PendingJoint {
    key: Key,
    #[serde(with = "crate::checkpoint_codec::array")]
    entities: [Entity; 2],
    desc: JointDesc,
    break_distance: Option<f32>,
    break_angle: Option<f32>,
}

fn threshold(value: f32) -> Result<Option<f32>, UnifiedPhysicsError> {
    if value == f32::INFINITY {
        return Ok(None);
    }
    if value.is_finite() && (0.0..=1e9).contains(&value) {
        Ok(Some(value))
    } else {
        Err(PhysicsError::InvalidJoint.into())
    }
}

fn motor(enabled: bool, speed: f32, force: f32) -> Option<JointMotor> {
    enabled.then_some(JointMotor {
        target_position: 0.0,
        target_velocity: speed,
        stiffness: 0.0,
        damping: 1e6,
        max_force: force,
    })
}

fn normalized_spring(
    length: f32,
    stiffness: f32,
    damping: f32,
) -> Result<JointKind, UnifiedPhysicsError> {
    if ![stiffness, damping]
        .into_iter()
        .all(|v| v.is_finite() && (0.0..=1.0).contains(&v))
    {
        return Err(PhysicsError::InvalidJoint.into());
    }
    // The old normalized spring impulse scales its positional correction by k,
    // and its damping by k*d (or d for a pure damper). Express those gains at
    // the authoring reference tick of 1/60 s as acceleration coefficients.
    // The native implicit integrator is stable across tick rates; it does not
    // reproduce the old iteration-dependent trajectory bit for bit.
    const REFERENCE_RATE: f32 = 60.0;
    let damping_scale = if stiffness > 0.0 { stiffness } else { 1.0 };
    Ok(JointKind::AccelerationSpring {
        rest_length: length,
        stiffness: stiffness * REFERENCE_RATE * REFERENCE_RATE,
        damping: damping * damping_scale * REFERENCE_RATE,
    })
}

fn normalized_constraint_response(
    stiffness: f32,
    damping: f32,
) -> Result<Option<SpringResponse>, UnifiedPhysicsError> {
    if ![stiffness, damping]
        .into_iter()
        .all(|v| v.is_finite() && (0.0..=1.0).contains(&v))
    {
        return Err(PhysicsError::InvalidJoint.into());
    }
    // Full stiffness is a rigid coordinate; damping only tunes elastic/free ones.
    if stiffness == 1.0 {
        return Ok(None);
    }
    Ok(Some(SpringResponse {
        stiffness: 3600.0 * stiffness,
        damping: 60.0 * damping,
    }))
}

impl PendingJoint {
    fn new(key: Key, a: Entity, b: Entity, kind: JointKind) -> Self {
        Self {
            key,
            entities: [a, b],
            desc: JointDesc::new(
                BodyId {
                    slot: a.id,
                    generation: a.generation,
                },
                BodyId {
                    slot: b.id,
                    generation: b.generation,
                },
                kind,
            ),
            break_distance: None,
            break_angle: None,
        }
    }
}

impl UnifiedPhysicsRuntime {
    pub(super) fn prepare_planar_joints(
        &mut self,
        world: &World,
    ) -> Result<(), UnifiedPhysicsError> {
        self.pending_joints.clear();
        if self.physics.config().space != Space::PlanarXy {
            return Ok(());
        }
        macro_rules! append {
            ($field:ident, $gens:ident, $code:expr, $convert:expr) => {
                for (index, item) in world.$field.iter().enumerate() {
                    if let Some(j) = item {
                        let p: PendingJoint =
                            ($convert)(($code, index as u32, world.$gens[index]), j)?;
                        self.validate_pending_joint(world, &p)?;
                        self.pending_joints.push(p);
                    }
                }
            };
        }
        macro_rules! common {
            ($p:ident, $j:ident) => {
                $p.desc.local_frame_a.position=[$j.local_anchor_a_x,$j.local_anchor_a_y,0.0];
                $p.desc.local_frame_b.position=[$j.local_anchor_b_x,$j.local_anchor_b_y,0.0];
                $p.desc.enabled=$j.enabled;
                $p.desc.contacts_enabled=true; // Existing joints do not disable connected contacts.
                $p.desc.break_force=threshold($j.break_force)?;
                $p.desc.break_torque=threshold($j.break_torque)?;
                $p.break_distance=threshold($j.break_distance)?;
            };
        }
        append!(
            distance_joints,
            distance_joint_generations,
            0,
            |key, j: &c::DistanceJoint| -> Result<_, UnifiedPhysicsError> {
                let response = normalized_constraint_response(j.stiffness, j.damping)?;
                let kind = if let Some(response) = response {
                    JointKind::AccelerationSpring {
                        rest_length: j.rest_length,
                        stiffness: response.stiffness,
                        damping: response.damping,
                    }
                } else {
                    JointKind::Distance {
                        length: j.rest_length,
                    }
                };
                let mut p = PendingJoint::new(key, j.entity_a, j.entity_b, kind);
                common!(p, j);
                Ok(p)
            }
        );
        append!(
            rope_joints,
            rope_joint_generations,
            1,
            |key, j: &c::RopeJoint| -> Result<_, UnifiedPhysicsError> {
                let response = normalized_constraint_response(j.stiffness, j.damping)?;
                let kind = if let Some(spring) = response {
                    JointKind::ElasticRope {
                        max_length: j.max_length,
                        spring,
                    }
                } else if j.max_length == 0.0 {
                    JointKind::Distance { length: 0.0 }
                } else {
                    JointKind::Rope {
                        max_length: j.max_length,
                    }
                };
                let mut p = PendingJoint::new(key, j.entity_a, j.entity_b, kind);
                common!(p, j);
                Ok(p)
            }
        );
        append!(
            spring_joints,
            spring_joint_generations,
            2,
            |key, j: &c::SpringJoint| -> Result<_, UnifiedPhysicsError> {
                let kind = if let Some(frequency) = j.frequency_hz {
                    JointKind::FrequencySpring {
                        rest_length: j.rest_length,
                        frequency_hz: frequency,
                        damping_ratio: j.damping_ratio,
                    }
                } else {
                    normalized_spring(j.rest_length, j.stiffness, j.damping)?
                };
                let mut p = PendingJoint::new(key, j.entity_a, j.entity_b, kind);
                common!(p, j);
                Ok(p)
            }
        );
        append!(
            revolute_joints,
            revolute_joint_generations,
            3,
            |key, j: &c::RevoluteJoint| -> Result<_, UnifiedPhysicsError> {
                let actuator = motor(j.motor_enabled, j.motor_speed, j.max_motor_torque);
                let kind = if j.limit_enabled && j.continuous_limit {
                    JointKind::ContinuousRevolute {
                        limits: [j.lower_angle, j.upper_angle],
                        motor: actuator,
                    }
                } else {
                    JointKind::Revolute {
                        limits: j.limit_enabled.then_some([j.lower_angle, j.upper_angle]),
                        motor: actuator,
                    }
                };
                let mut p = PendingJoint::new(key, j.entity_a, j.entity_b, kind);
                p.desc.linear_spring = normalized_constraint_response(j.stiffness, j.damping)?;
                common!(p, j);
                let h = std::f32::consts::FRAC_1_SQRT_2;
                p.desc.local_frame_a.rotation = [0.0, -h, 0.0, h];
                p.desc.local_frame_b.rotation = [0.0, -h, 0.0, h];
                Ok(p)
            }
        );
        append!(
            prismatic_joints,
            prismatic_joint_generations,
            4,
            |key, j: &c::PrismaticJoint| -> Result<_, UnifiedPhysicsError> {
                if !j.local_axis_a_x.is_finite()
                    || !j.local_axis_a_y.is_finite()
                    || j.local_axis_a_x.hypot(j.local_axis_a_y) < 1e-6
                    || !j.reference_angle.is_finite()
                {
                    return Err(PhysicsError::InvalidJoint.into());
                }
                let axis = j.local_axis_a_y.atan2(j.local_axis_a_x);
                let mut p = PendingJoint::new(
                    key,
                    j.entity_a,
                    j.entity_b,
                    JointKind::Prismatic {
                        limits: j
                            .limit_enabled
                            .then_some([j.lower_translation, j.upper_translation]),
                        motor: motor(j.motor_enabled, j.motor_speed, j.max_motor_force),
                    },
                );
                common!(p, j);
                p.desc.linear_spring = normalized_constraint_response(j.stiffness, j.damping)?;
                p.desc.angular_spring =
                    normalized_constraint_response(j.angular_stiffness, j.angular_damping)?;
                p.desc.local_frame_a.rotation = rotation(axis);
                p.desc.local_frame_b.rotation = rotation(axis - j.reference_angle);
                Ok(p)
            }
        );
        append!(
            gear_joints,
            gear_joint_generations,
            5,
            |key, j: &c::GearJoint| -> Result<_, UnifiedPhysicsError> {
                let mut p = PendingJoint::new(
                    key,
                    j.entity_a,
                    j.entity_b,
                    JointKind::Gear {
                        ratio: j.ratio,
                        reference_angle: j.reference_angle,
                        spring: normalized_constraint_response(j.stiffness, j.damping)?,
                    },
                );
                p.desc.enabled = j.enabled;
                p.desc.contacts_enabled = true;
                p.desc.break_force = threshold(j.break_force)?;
                p.desc.break_torque = threshold(j.break_torque)?;
                p.break_angle = threshold(j.break_angle)?;
                Ok(p)
            }
        );
        append!(
            weld_joints,
            weld_joint_generations,
            6,
            |key, j: &c::WeldJoint| -> Result<_, UnifiedPhysicsError> {
                if !j.reference_angle.is_finite() {
                    return Err(PhysicsError::InvalidJoint.into());
                }
                let mut p = PendingJoint::new(key, j.entity_a, j.entity_b, JointKind::Fixed);
                p.desc.linear_spring = normalized_constraint_response(j.stiffness, j.damping)?;
                p.desc.angular_spring =
                    normalized_constraint_response(j.angular_stiffness, j.angular_damping)?;
                common!(p, j);
                p.desc.local_frame_b.rotation = rotation(-j.reference_angle);
                p.break_angle = threshold(j.break_angle)?;
                Ok(p)
            }
        );
        append!(
            pulley_joints,
            pulley_joint_generations,
            7,
            |key, j: &c::PulleyJoint| -> Result<_, UnifiedPhysicsError> {
                let mut p = PendingJoint::new(
                    key,
                    j.entity_a,
                    j.entity_b,
                    JointKind::Pulley {
                        ground_a: [j.ground_anchor_a_x, j.ground_anchor_a_y, 0.0],
                        ground_b: [j.ground_anchor_b_x, j.ground_anchor_b_y, 0.0],
                        length: j.rest_length,
                        ratio: j.ratio,
                        slack: j.slack,
                        spring: normalized_constraint_response(j.stiffness, j.damping)?,
                    },
                );
                common!(p, j);
                Ok(p)
            }
        );
        if self.pending_joints.len() > self.physics.config().max_joints {
            return Err(PhysicsError::CapacityExceeded.into());
        }
        self.pending_joints.sort_unstable_by_key(|p| p.key);
        Ok(())
    }

    fn validate_pending_joint(
        &self,
        world: &World,
        p: &PendingJoint,
    ) -> Result<(), UnifiedPhysicsError> {
        self.physics.validate_joint_settings(&p.desc)?;
        let mut dynamic = false;
        for entity in p.entities {
            if !world.is_current_entity(entity) {
                return Err(UnifiedPhysicsError::StaleEntity);
            }
            if let Some(rigid) = world.rigid_body(entity) {
                dynamic |= rigid.body_type == c::RigidBodyType::Dynamic;
            } else if let Some(b) = self.bindings.get(&(entity.id, entity.generation)) {
                dynamic |= self.physics.body_kind(b.body)? == BodyKind::Dynamic;
            } else if world.compound_collider_count(entity) == 0 {
                return Err(UnifiedPhysicsError::StaleEntity);
            }
        }
        if !dynamic {
            return Err(PhysicsError::WrongBodyKind.into());
        }
        Ok(())
    }

    pub(super) fn commit_planar_joints(&mut self) -> Result<(), UnifiedPhysicsError> {
        self.retired_joints.clear();
        for (&key, binding) in &self.legacy_joints {
            let pending = self
                .pending_joints
                .binary_search_by_key(&key, |p| p.key)
                .ok()
                .map(|i| &self.pending_joints[i]);
            if pending.is_none_or(|p| p.entities != binding.source.entities)
                || self.physics.joint_desc(binding.native).is_err()
            {
                self.retired_joints.push(key);
            }
        }
        for key in self.retired_joints.drain(..) {
            if let Some(old) = self.legacy_joints.remove(&key) {
                if self.physics.joint_desc(old.native).is_ok() {
                    self.physics.remove_joint(old.native)?;
                }
            }
        }
        for mut p in self.pending_joints.drain(..) {
            p.desc.body_a = self
                .bindings
                .get(&(p.entities[0].id, p.entities[0].generation))
                .ok_or(UnifiedPhysicsError::StaleEntity)?
                .body;
            p.desc.body_b = self
                .bindings
                .get(&(p.entities[1].id, p.entities[1].generation))
                .ok_or(UnifiedPhysicsError::StaleEntity)?
                .body;
            if let Some(old) = self.legacy_joints.get_mut(&p.key) {
                if old.source != p {
                    self.physics.update_joint(old.native, p.desc.clone())?;
                    old.source = p;
                }
            } else {
                let native = self.physics.create_joint(p.desc.clone())?;
                self.legacy_joints
                    .insert(p.key, JointBinding { native, source: p });
            }
        }
        Ok(())
    }

    pub(super) fn finish_planar_joints(&mut self, world: &mut World) {
        self.joint_stream.capture(
            &mut self.physics,
            &self.entities_by_body,
            &mut self.native_joint_events,
        );
        let dropped = self.joint_stream.take_legacy_dropped();
        world.physics_diagnostics.breaks_dropped = world
            .physics_diagnostics
            .breaks_dropped
            .saturating_add(dropped);
        self.native_joint_events.sort_unstable_by_key(|e| e.joint);
        self.retired_joints.clear();
        for (&key, binding) in &self.legacy_joints {
            if let Ok(state) = self.physics.joint_state(binding.native) {
                let (distance, angle) = joint_error(world, &binding.source);
                world.record_unified_joint_load(
                    key,
                    state.force,
                    state.torque,
                    distance.max(angle),
                );
            } else {
                // Reconcile every disappeared identity even if the bounded event queue overflowed.
                if let Ok(i) = self
                    .native_joint_events
                    .binary_search_by_key(&binding.native, |e| e.joint)
                {
                    let event: &JointEvent = &self.native_joint_events[i];
                    let reason = match event.reason {
                        JointEventReason::ForceLimit | JointEventReason::ForceAndTorqueLimit => 1,
                        JointEventReason::TorqueLimit => 2,
                        _ => 0,
                    };
                    if reason != 0 {
                        world.record_joint_break(
                            key,
                            reason,
                            event.reaction.force,
                            event.reaction.torque,
                        );
                    }
                }
                if let Ok(kind) = crate::world::JointKind::try_from(key.0) {
                    world.clear_joint_by_kind(kind, key.1, key.2);
                }
                self.retired_joints.push(key);
            }
        }
        for key in self.retired_joints.drain(..) {
            self.legacy_joints.remove(&key);
        }
        self.native_joint_events.clear();
    }

    pub(super) fn break_planar_joint_errors(&mut self, world: &mut World) -> u32 {
        let mut broken = 0;
        self.retired_joints.clear();
        for (&key, binding) in &self.legacy_joints {
            let p = &binding.source;
            if !p.desc.enabled {
                continue;
            }
            let (distance, angle) = joint_error(world, p);
            if p.break_distance.is_some_and(|v| distance > v + 0.0001)
                || p.break_angle.is_some_and(|v| angle > v + 0.0001)
            {
                self.retired_joints.push(key);
            }
        }
        for key in self.retired_joints.drain(..) {
            if let Some(binding) = self.legacy_joints.remove(&key) {
                let _ = self.physics.remove_joint(binding.native);
                if let Ok(kind) = crate::world::JointKind::try_from(key.0) {
                    if world.clear_joint_by_kind(kind, key.1, key.2) {
                        world.record_joint_break(key, 3, 0.0, 0.0);
                        broken += 1;
                    }
                }
            }
        }
        broken
    }
}

fn joint_error(world: &World, p: &PendingJoint) -> (f32, f32) {
    let angles = p
        .entities
        .map(|e| world.rotation(e).unwrap_or_default().radians);
    let frames = [p.desc.local_frame_a, p.desc.local_frame_b];
    let points = std::array::from_fn::<_, 2, _>(|i| {
        let t = world.transform(p.entities[i]).unwrap_or_default();
        let (s, c) = angles[i].sin_cos();
        let local = frames[i].position;
        [
            t.x + c * local[0] - s * local[1],
            t.y + s * local[0] + c * local[1],
        ]
    });
    let delta = [points[1][0] - points[0][0], points[1][1] - points[0][1]];
    let length = delta[0].hypot(delta[1]);
    let wrap = |v: f32| {
        (v + std::f32::consts::PI).rem_euclid(std::f32::consts::TAU) - std::f32::consts::PI
    };
    match p.desc.kind {
        JointKind::Distance { length: rest }
        | JointKind::Spring {
            rest_length: rest, ..
        }
        | JointKind::FrequencySpring {
            rest_length: rest, ..
        }
        | JointKind::AccelerationSpring {
            rest_length: rest, ..
        } => ((length - rest).abs(), 0.0),
        JointKind::Rope { max_length } | JointKind::ElasticRope { max_length, .. } => {
            ((length - max_length).max(0.0), 0.0)
        }
        JointKind::Gear {
            ratio,
            reference_angle,
            ..
        } => (
            0.0,
            wrap(angles[1] + ratio * angles[0] - reference_angle).abs(),
        ),
        JointKind::Pulley {
            ground_a,
            ground_b,
            length: rest,
            ratio,
            slack,
            ..
        } => {
            let error = (points[0][0] - ground_a[0]).hypot(points[0][1] - ground_a[1])
                + ratio * (points[1][0] - ground_b[0]).hypot(points[1][1] - ground_b[1])
                - rest;
            (if slack { error.max(0.0) } else { error.abs() }, 0.0)
        }
        JointKind::Prismatic { .. } => {
            let axis = angles[0] + 2.0 * frames[0].rotation[2].atan2(frames[0].rotation[3]);
            let (s, c) = axis.sin_cos();
            ((delta[0] * s - delta[1] * c).abs(), 0.0)
        }
        JointKind::Fixed => {
            let reference = -2.0 * frames[1].rotation[2].atan2(frames[1].rotation[3]);
            (length, wrap(angles[1] - angles[0] - reference).abs())
        }
        _ => (length, 0.0),
    }
}

// The cached source is old committed authoring; pending sources use entity-id
// placeholder body handles until commit_planar_joints maps them to native owners.
impl JointBinding {
    pub(super) fn file_source(&self) -> (Key, [Entity; 2], &JointDesc) {
        (self.source.key, self.source.entities, &self.source.desc)
    }
    #[cfg(test)]
    pub(super) fn file_test_set_source_entity(&mut self, index: usize, entity: Entity) {
        self.source.entities[index] = entity;
    }
}
impl PendingJoint {
    pub(super) fn file_source(&self) -> (Key, [Entity; 2], &JointDesc) {
        (self.key, self.entities, &self.desc)
    }
}

mod file_payload_admission;

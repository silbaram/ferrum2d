use super::colliders::native_collider;

#[cfg(test)]
pub(super) mod experimental_tests;
mod file_admission;
pub(super) mod interval_credit;
mod kcc;
use super::events::{collider_id, collider_ref};
use super::types::{valid_pose, valid_vector};
use super::world::{native_id, native_pose};
use super::{
    BodyId, ColliderDesc, ColliderId, ColliderRef, PhysicsError, PhysicsWorld3d, Pose, Shape, Space,
};
use rapier3d::control::{
    CharacterAutostep, CharacterCollision, CharacterLength, KinematicCharacterController,
};
use rapier3d::parry::query::ShapeCastOptions;
use rapier3d::prelude as rp;

/// Capsule controller settings. Distances use engine units and angles use radians.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CharacterConfig {
    /// Unit up direction. The capsule's long axis must be parallel to it.
    pub up: [f32; 3],
    /// Positive separation from contacted surfaces.
    pub skin_width: f32,
    /// Maximum climbable slope angle, in [0, pi/2).
    pub max_slope_angle: f32,
    /// Minimum slope angle for automatic sliding; at least `max_slope_angle`.
    pub slide_angle: f32,
    /// Maximum stair height; zero disables automatic stepping.
    pub step_height: f32,
    /// Required free width beyond a stair edge.
    pub step_min_width: f32,
    /// Ground snap distance; zero disables snapping.
    pub snap_distance: f32,
    /// Maximum vertical speed in engine units per second.
    pub max_vertical_speed: f32,
    /// Virtual mass when pushing dynamic bodies or integrating external forces.
    /// Incoming dynamic contacts see the character as kinematic.
    /// Zero disables KCC push impulses and the external force/impulse APIs.
    pub push_mass: f32,
}

impl Default for CharacterConfig {
    fn default() -> Self {
        Self {
            up: [0.0, 1.0, 0.0],
            skin_width: 0.01,
            max_slope_angle: std::f32::consts::FRAC_PI_4,
            slide_angle: std::f32::consts::FRAC_PI_4,
            step_height: 0.3,
            step_min_width: 0.2,
            snap_distance: 0.2,
            max_vertical_speed: 50.0,
            push_mass: 0.0,
        }
    }
}

/// Input retained until replaced. Jump is consumed once by the next accepted interval.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct CharacterInput {
    /// Desired world-space ground-plane velocity, perpendicular to `up`.
    pub velocity: [f32; 3],
    /// Positive launch speed, accepted only when grounded; zero requests no jump.
    pub jump_speed: f32,
}

/// Result of the most recent fixed character step.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct CharacterState {
    /// True when supported by a walkable surface after movement.
    pub grounded: bool,
    /// Supporting collider, if any, with its current generation.
    pub ground: Option<ColliderRef>,
    /// Support that supplied accepted transport during the tick. A round
    /// trip can report the support with zero net carry if still grounded on it.
    /// Rewound platform motion does not count as transport.
    pub carried_by: Option<BodyId>,
    /// Sum of accepted platform carry translations during this tick.
    pub carry_translation: [f32; 3],
    /// Whether the controller is sliding down a steep slope.
    pub sliding: bool,
    /// Whether upward movement hit a ceiling this step.
    pub hit_ceiling: bool,
    /// Actual translation applied during the last accepted interval.
    pub translation: [f32; 3],
    /// Actual translation divided by the fixed timestep.
    pub velocity: [f32; 3],
    /// Integrated speed along `up`, including gravity and jump input.
    pub vertical_speed: f32,
    /// Number of movement contacts omitted from the bounded impulse scratch buffer.
    pub dropped_contacts: usize,
    /// True if relative-motion casting shortened movement against another character.
    pub blocked_by_character: bool,
    /// Character-pair shape casts performed this step, for runtime cost accounting.
    pub character_pair_casts: usize,
    /// Geometric capsule-pair contact queries at sweep starts and constraint refreshes.
    pub character_pair_contact_checks: usize,
    /// Constraint row visits during coupled capsule velocity resolution.
    pub character_coupling_iterations: usize,
    /// Whether the bounded coupled solver or contact timeline exhausted its work limit.
    pub character_coupling_iteration_limit: bool,
    /// Unsupported backend pair queries, which conservatively block the affected motion.
    pub failed_pair_casts: usize,
    /// Relative obstacle casts, including static obstacles reached during a push.
    pub moving_obstacle_casts: usize,
    /// Unsupported relative obstacle casts; affected movement is held conservatively.
    pub failed_moving_obstacle_casts: usize,
    /// Geometric contact queries at sweep starts and simultaneous obstacle contacts.
    pub moving_obstacle_contact_checks: usize,
    /// Unsupported contact queries; moving constraints stop conservatively.
    pub failed_moving_obstacle_contacts: usize,
    /// Whether relative obstacle motion constrained or pushed this character.
    pub blocked_by_moving_obstacle: bool,
    /// Whether the bounded moving-obstacle solve exhausted its iterations.
    pub moving_obstacle_iteration_limit: bool,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(super) struct CharacterRuntime {
    pub config: CharacterConfig,
    pub collider: ColliderId,
    input: CharacterInput,
    pub state: CharacterState,
    #[serde(skip)]
    collisions: Vec<CharacterCollision>,
    pub tick_velocity: [f32; 3],
    pub carry_fraction: super::solver_trajectory::Time,
    pub carry_blocker: Option<BodyId>,
    pub motion_stop: Option<super::character_motion::MotionStop>,
    pub external_velocity: [f32; 3],
    pub external_force: [f32; 3],
    pub pending_impulse: [f32; 3],
    pub contact_velocity: [f32; 3],
    #[serde(skip)]
    pub free_velocity: [f32; 3],
    #[serde(skip)]
    pub free_translation: [f32; 3],
    #[serde(skip)]
    pub free_carry_translation: [f32; 3],
    #[serde(skip)]
    pub support_motion: Option<(BodyId, rp::Vector, rp::Vector)>,
    #[serde(skip)]
    pub dynamic_iterations: usize,
    #[serde(skip)]
    pub dynamic_limited: bool,
}

/// Controller preview owns no solver state; restore it before the actual substep.
#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct CharacterPreview {
    pub id: BodyId,
    pub state: CharacterState,
    pub input: CharacterInput,
    pub external_velocity: [f32; 3],
    pub pending_impulse: [f32; 3],
    pub contact_velocity: [f32; 3],
}

impl CharacterRuntime {
    pub(super) fn input_velocity(&self) -> [f32; 3] {
        self.input.velocity
    }
}

impl CharacterConfig {
    pub(super) fn validate(&self, space: Space) -> Result<(), PhysicsError> {
        let up = rp::Vector::from(self.up);
        if !valid_vector(&self.up)
            || (up.length_squared() - 1.0).abs() > 1.0e-5
            || (space == Space::PlanarXy && self.up[2] != 0.0)
            || !self.skin_width.is_finite()
            || !(0.0001..=100.0).contains(&self.skin_width)
            || !self.max_slope_angle.is_finite()
            || !(0.0..std::f32::consts::FRAC_PI_2).contains(&self.max_slope_angle)
            || !self.slide_angle.is_finite()
            || !(self.max_slope_angle..=std::f32::consts::FRAC_PI_2).contains(&self.slide_angle)
            || ![self.step_height, self.snap_distance, self.push_mass]
                .iter()
                .all(|v| v.is_finite() && (0.0..=10000.0).contains(v))
            || (self.push_mass != 0. && self.push_mass < 0.0001)
            || ![self.step_min_width, self.max_vertical_speed]
                .iter()
                .all(|v| v.is_finite() && (0.0001..=10000.0).contains(v))
        {
            return Err(PhysicsError::InvalidCharacter);
        }
        Ok(())
    }

    pub(super) fn controller(&self) -> KinematicCharacterController {
        KinematicCharacterController {
            up: self.up.into(),
            offset: CharacterLength::Absolute(self.skin_width),
            slide: true,
            autostep: (self.step_height > 0.0).then_some(CharacterAutostep {
                max_height: CharacterLength::Absolute(self.step_height),
                min_width: CharacterLength::Absolute(self.step_min_width),
                include_dynamic_bodies: false,
            }),
            max_slope_climb_angle: self.max_slope_angle,
            min_slope_slide_angle: self.slide_angle,
            snap_to_ground: (self.snap_distance > 0.0)
                .then_some(CharacterLength::Absolute(self.snap_distance)),
            normal_nudge_factor: self.skin_width * 0.01,
        }
    }
}

fn upright(config: &CharacterConfig, pose: &rp::Pose) -> bool {
    (pose.rotation * rp::Vector::Y).dot(config.up.into()).abs() >= 1.0 - 1.0e-5
}

/// For an upright capsule on a box spinning about up, its pole projects to one
/// material point on the face. Keep that point in the platform's local frame.
fn rotating_face_anchor(
    support: &rp::Collider,
    shape: &dyn rp::Shape,
    moved_pose: &rp::Pose,
    up: rp::Vector,
    angular: rp::Vector,
) -> Option<rp::Vector> {
    if angular == rp::Vector::ZERO || angular.cross(up) != rp::Vector::ZERO {
        return None;
    }
    let capsule = shape.as_capsule()?;
    let half = support.shape().as_cuboid()?.half_extents;
    let local_up = support.position().rotation.inverse() * up;
    let axis = local_up.abs().max_position();
    let relative = support.position().inv_mul(moved_pose);
    let segment = relative.rotation * (capsule.segment.b - capsule.segment.a);
    let mut pole = relative * capsule.segment.a;
    let sign = local_up[axis].signum();
    if segment[axis] * sign < 0. {
        pole = relative * capsule.segment.b;
    }
    if pole[axis] * sign < half[axis]
        || (0..3).any(|i| {
            i != axis && (local_up[i] != 0. || segment[i] != 0. || pole[i].abs() >= half[i])
        })
    {
        return None;
    }
    pole[axis] = sign * half[axis];
    Some(*support.position_wrt_parent()? * pole)
}

impl PhysicsWorld3d {
    /// Update traversal limits without resetting grounded state or queued jump.
    pub(crate) fn set_character_traversal(
        &mut self,
        id: BodyId,
        step: f32,
        snap: f32,
    ) -> Result<(), PhysicsError> {
        self.character_state(id)?;
        if ![step, snap]
            .iter()
            .all(|v| v.is_finite() && (0. ..=10000.).contains(v))
        {
            return Err(PhysicsError::InvalidCharacter);
        }
        let runtime = self
            .characters
            .get_mut(&id)
            .ok_or(PhysicsError::InvalidCharacter)?;
        runtime.config.step_height = step;
        runtime.config.snap_distance = snap;
        Ok(())
    }
    /// Attaches a controller to a position-kinematic body with one solid capsule.
    /// Additional sensor fixtures are allowed. Body gravity scale also scales character gravity.
    pub fn enable_character(
        &mut self,
        id: BodyId,
        config: CharacterConfig,
    ) -> Result<(), PhysicsError> {
        config.validate(self.config.space)?;
        if !self.characters.contains_key(&id) && self.characters.len() >= self.config.max_characters
        {
            return Err(PhysicsError::CapacityExceeded);
        }
        let body = self
            .backend
            .bodies
            .get(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        if body.body_type() != rp::RigidBodyType::KinematicPositionBased {
            return Err(PhysicsError::WrongBodyKind);
        }
        let mut solids = body.colliders().iter().filter_map(|&id| {
            self.backend
                .colliders
                .get(id)
                .filter(|c| !c.is_sensor())
                .map(|c| (id, c))
        });
        let (collider, shape) = solids.next().ok_or(PhysicsError::InvalidCharacter)?;
        let local_pose = shape
            .position_wrt_parent()
            .ok_or(PhysicsError::InvalidCharacter)?;
        if solids.next().is_some()
            || shape.shape().as_capsule().is_none()
            || !upright(&config, &(body.position() * local_pose))
            || shape
                .shape()
                .as_capsule()
                .is_some_and(|capsule| config.skin_width >= capsule.radius * 0.5)
        {
            return Err(PhysicsError::InvalidCharacter);
        }
        self.characters.insert(
            id,
            CharacterRuntime {
                config,
                collider: collider_id(collider),
                input: CharacterInput::default(),
                state: CharacterState::default(),
                collisions: Vec::with_capacity(32),
                tick_velocity: [0.; 3],
                carry_fraction: 1.0,
                carry_blocker: None,
                motion_stop: None,
                external_velocity: [0.; 3],
                external_force: [0.; 3],
                pending_impulse: [0.; 3],
                contact_velocity: [0.; 3],
                free_velocity: [0.; 3],
                free_translation: [0.; 3],
                free_carry_translation: [0.; 3],
                support_motion: None,
                dynamic_iterations: 0,
                dynamic_limited: false,
            },
        );
        Ok(())
    }

    /// Removes the controller while retaining the body and colliders.
    pub fn disable_character(&mut self, id: BodyId) -> Result<(), PhysicsError> {
        if !self.backend.bodies.contains(native_id(id)) {
            return Err(PhysicsError::StaleBody);
        }
        self.characters
            .remove(&id)
            .map(|_| ())
            .ok_or(PhysicsError::NotCharacter)
    }

    /// Updates movement input; invalid input leaves both movement and queued jump unchanged.
    pub fn set_character_input(
        &mut self,
        id: BodyId,
        input: CharacterInput,
    ) -> Result<(), PhysicsError> {
        self.validate_character_input(id, &input)?;
        self.characters
            .get_mut(&id)
            .ok_or(PhysicsError::NotCharacter)?
            .input = input;
        Ok(())
    }

    /// Adds a persistent world-space force to a finite-mass character.
    /// The controller owns this force separately from backend rigid-body forces;
    /// it accelerates external velocity once per simulated interval until cleared.
    pub fn add_character_force(&mut self, id: BodyId, force: [f32; 3]) -> Result<(), PhysicsError> {
        self.apply_character_force_commands(&[(id, 0, force)])
    }

    /// Queues a one-shot world-space impulse. The next accepted simulation
    /// interval consumes it; previews, rejected commands and cold probes do not.
    pub fn apply_character_impulse(
        &mut self,
        id: BodyId,
        impulse: [f32; 3],
    ) -> Result<(), PhysicsError> {
        self.apply_character_force_commands(&[(id, 2, impulse)])
    }

    /// Clears persistent external force, retaining velocity and queued impulses.
    pub fn clear_character_forces(&mut self, id: BodyId) -> Result<(), PhysicsError> {
        self.apply_character_force_commands(&[(id, 1, [0.; 3])])
    }

    /// Atomically stages at most 65,536 character force commands in row order.
    /// Opcodes are 0 = add persistent force, 1 = clear force (zero payload), and
    /// 2 = queue impulse. Duplicate rows accumulate with the same finite bounds
    /// as single calls; any invalid row leaves every character unchanged.
    pub fn apply_character_force_commands(
        &mut self,
        commands: &[(BodyId, u32, [f32; 3])],
    ) -> Result<(), PhysicsError> {
        if commands.len() > 65_536 {
            return Err(PhysicsError::CapacityExceeded);
        }
        let mut staged = std::collections::BTreeMap::new();
        for &(id, operation, value) in commands {
            if operation == 1 {
                self.character_state(id)?;
                if value != [0.; 3] {
                    return Err(PhysicsError::InvalidCharacter);
                }
            } else if operation == 0 || operation == 2 {
                self.validate_character_force(id, value)?;
            } else {
                return Err(PhysicsError::InvalidCharacter);
            }
            let runtime = &self.characters[&id];
            let (force, impulse) = staged
                .entry(id)
                .or_insert((runtime.external_force, runtime.pending_impulse));
            match operation {
                0 => *force = (rp::Vector::from(*force) + rp::Vector::from(value)).to_array(),
                1 => *force = [0.; 3],
                _ => *impulse = (rp::Vector::from(*impulse) + rp::Vector::from(value)).to_array(),
            }
            if !valid_vector(force) || !valid_vector(impulse) {
                return Err(PhysicsError::InvalidCharacter);
            }
        }
        for (&id, &(force, impulse)) in &staged {
            let runtime = &self.characters[&id];
            if runtime.config.push_mass > 0. {
                let velocity = rp::Vector::from(runtime.external_velocity)
                    + (rp::Vector::from(force) * self.config.step_seconds
                        + rp::Vector::from(impulse))
                        / runtime.config.push_mass;
                if !valid_vector(&velocity.to_array()) {
                    return Err(PhysicsError::InvalidCharacter);
                }
            }
        }
        for (id, (force, impulse)) in staged {
            let runtime = self
                .characters
                .get_mut(&id)
                .expect("staged live controller; no mutation before publish");
            runtime.external_force = force;
            runtime.pending_impulse = impulse;
        }
        Ok(())
    }

    pub(crate) fn validate_character_force_duration(
        &self,
        seconds: f32,
    ) -> Result<(), PhysicsError> {
        for runtime in self.characters.values() {
            if runtime.config.push_mass > 0. {
                let velocity = rp::Vector::from(runtime.external_velocity)
                    + (rp::Vector::from(runtime.external_force) * seconds
                        + rp::Vector::from(runtime.pending_impulse))
                        / runtime.config.push_mass;
                if !valid_vector(&velocity.to_array()) {
                    return Err(PhysicsError::InvalidCharacter);
                }
            }
        }
        Ok(())
    }

    fn validate_character_force(&self, id: BodyId, value: [f32; 3]) -> Result<(), PhysicsError> {
        self.character_state(id)?;
        if !valid_vector(&value) || self.characters[&id].config.push_mass <= 0. {
            return Err(PhysicsError::InvalidCharacter);
        }
        if self.config.space == Space::PlanarXy && value[2] != 0. {
            return Err(PhysicsError::OutOfPlane);
        }
        Ok(())
    }

    pub(crate) fn validate_character_input(
        &self,
        id: BodyId,
        input: &CharacterInput,
    ) -> Result<(), PhysicsError> {
        if !self.backend.bodies.contains(native_id(id)) {
            return Err(PhysicsError::StaleBody);
        }
        let runtime = self.characters.get(&id).ok_or(PhysicsError::NotCharacter)?;
        if !valid_vector(&input.velocity)
            || !input.jump_speed.is_finite()
            || !(0.0..=runtime.config.max_vertical_speed).contains(&input.jump_speed)
            || rp::Vector::from(input.velocity)
                .dot(runtime.config.up.into())
                .abs()
                > 1.0e-5
            || (self.config.space == Space::PlanarXy && input.velocity[2] != 0.0)
        {
            return Err(PhysicsError::InvalidCharacter);
        }
        Ok(())
    }

    /// Changes actor steering without consuming/replacing its pending one-shot jump.
    pub(crate) fn set_character_ground_velocity(
        &mut self,
        id: BodyId,
        velocity: [f32; 3],
    ) -> Result<(), PhysicsError> {
        self.validate_character_input(
            id,
            &CharacterInput {
                velocity,
                jump_speed: 0.,
            },
        )?;
        self.characters
            .get_mut(&id)
            .ok_or(PhysicsError::NotCharacter)?
            .input
            .velocity = velocity;
        Ok(())
    }

    /// Reads the last completed interval's controller result.
    pub fn character_state(&self, id: BodyId) -> Result<&CharacterState, PhysicsError> {
        if !self.backend.bodies.contains(native_id(id)) {
            return Err(PhysicsError::StaleBody);
        }
        self.characters
            .get(&id)
            .map(|r| &r.state)
            .ok_or(PhysicsError::NotCharacter)
    }

    pub(super) fn validate_character_pose(
        &self,
        id: BodyId,
        pose: Pose,
    ) -> Result<(), PhysicsError> {
        if let Some(runtime) = self.characters.get(&id) {
            let collider = self
                .backend
                .colliders
                .get(native_collider(runtime.collider))
                .ok_or(PhysicsError::StaleCollider)?;
            let local = collider
                .position_wrt_parent()
                .ok_or(PhysicsError::InvalidCharacter)?;
            if !valid_pose(pose) || !upright(&runtime.config, &(native_pose(pose) * local)) {
                return Err(PhysicsError::InvalidCharacter);
            }
        }
        Ok(())
    }

    pub(super) fn validate_character_collider(
        &self,
        id: ColliderId,
        desc: &ColliderDesc,
    ) -> Result<(), PhysicsError> {
        let owner = self.collider_owner(id)?.body;
        if let Some(runtime) = self.characters.get(&owner) {
            if runtime.collider == id {
                let body = self
                    .backend
                    .bodies
                    .get(native_id(owner))
                    .ok_or(PhysicsError::StaleBody)?;
                if desc.sensor
                    || !matches!(desc.shape, Shape::Capsule { .. })
                    || matches!(desc.shape, Shape::Capsule { radius, .. } if runtime.config.skin_width >= radius * 0.5)
                    || !valid_pose(desc.pose)
                    || !upright(&runtime.config, &(body.position() * native_pose(desc.pose)))
                {
                    return Err(PhysicsError::CharacterControlled);
                }
            } else if !desc.sensor {
                return Err(PhysicsError::CharacterControlled);
            }
        }
        Ok(())
    }

    pub(super) fn invalidate_character_support(
        &mut self,
        body: Option<BodyId>,
        collider: Option<ColliderId>,
    ) {
        for runtime in self.characters.values_mut() {
            if runtime.state.ground.is_some_and(|ground| {
                Some(ground.body) == body || Some(ground.collider) == collider
            }) {
                runtime.state.grounded = false;
                runtime.state.ground = None;
            }
        }
    }

    pub(super) fn step_characters(&mut self) {
        self.step_characters_mode(true);
    }

    pub(super) fn save_character_preview(&self, saved: &mut Vec<CharacterPreview>) {
        saved.clear();
        saved.extend(
            self.characters
                .iter()
                .map(|(&id, runtime)| CharacterPreview {
                    id,
                    state: runtime.state.clone(),
                    input: runtime.input.clone(),
                    external_velocity: runtime.external_velocity,
                    pending_impulse: runtime.pending_impulse,
                    contact_velocity: runtime.contact_velocity,
                }),
        );
    }

    pub(super) fn preview_characters(&mut self, saved: &mut Vec<CharacterPreview>) {
        self.save_character_preview(saved);
        self.step_characters_mode(false);
    }

    pub(super) fn restore_character_preview(&mut self, saved: &[CharacterPreview]) {
        for backup in saved {
            if let Some(runtime) = self.characters.get_mut(&backup.id) {
                runtime.state.clone_from(&backup.state);
                runtime.input.clone_from(&backup.input);
                runtime.external_velocity = backup.external_velocity;
                runtime.pending_impulse = backup.pending_impulse;
                runtime.contact_velocity = backup.contact_velocity;
            }
        }
    }

    fn step_characters_mode(&mut self, apply_push: bool) {
        if self.characters.is_empty() {
            return;
        }
        self.refresh_queries();
        self.prepare_character_motion();
        let mut characters = std::mem::take(&mut self.characters);
        self.character_order.clear();
        self.character_order.extend(characters.keys().copied());
        for (&id, runtime) in &mut characters {
            self.step_character(id, runtime, apply_push);
        }
        let dt = self.backend.integration_parameters.dt;
        super::character_contacts::resolve(
            &mut self.backend,
            &self.contact_policies,
            &self.character_motion,
            &mut characters,
            &mut self.character_contacts,
            dt,
        );
        self.characters = characters;
    }

    pub(super) fn finish_characters(&mut self) {
        self.character_dynamics.invalidate();
        self.reconcile_dynamic_character_support();
        for (&id, runtime) in &mut self.characters {
            let support = character_ground(&self.backend, &self.contact_policies, id, runtime);
            runtime.state.grounded = support.is_some();
            runtime.state.ground = support;
            if support.is_some() {
                runtime.state.vertical_speed = 0.0;
                runtime.state.sliding = false;
            }
        }
    }

    fn reconcile_dynamic_character_support(&mut self) {
        // The backend may stop/rotate a dynamic support through contacts or
        // joints. Correct the rider from the actual resulting pose, rather than
        // carrying it by a stale pre-solver velocity estimate.
        for (&id, runtime) in &mut self.characters {
            let Some((support, local_anchor, start_anchor)) = runtime.support_motion.take() else {
                continue;
            };
            let Some(platform) = self.backend.bodies.get(native_id(support)) else {
                continue;
            };
            let mut correction = *platform.position() * local_anchor
                - start_anchor
                - rp::Vector::from(runtime.state.carry_translation);
            if self.config.space == Space::PlanarXy {
                correction.z = 0.;
            }
            if correction.length_squared() <= 1.0e-12 {
                continue;
            }
            let Some(collider) = self
                .backend
                .colliders
                .get(native_collider(runtime.collider))
            else {
                continue;
            };
            let allowed = |handle: rp::ColliderHandle, other: &rp::Collider| {
                other.is_enabled()
                    && other.parent() != Some(native_id(support))
                    && self
                        .contact_policies
                        .pair_allows(Some(native_id(id)), other.parent())
                    && self.contact_policies.one_way_allows(
                        handle,
                        other,
                        collider.shape(),
                        collider.position(),
                    )
            };
            let queries = self.backend.query_pipeline_with_filter(rp::QueryFilter {
                flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
                groups: Some(collider.collision_groups()),
                exclude_rigid_body: Some(native_id(id)),
                predicate: Some(&allowed),
                ..Default::default()
            });
            let controller = KinematicCharacterController {
                autostep: None,
                snap_to_ground: None,
                ..runtime.config.controller()
            };
            let accepted = controller
                .move_shape(
                    0.,
                    &queries,
                    collider.shape(),
                    collider.position(),
                    correction,
                    |_| {},
                )
                .translation;
            if let Some(body) = self.backend.bodies.get_mut(native_id(id)) {
                body.set_position(
                    rp::Pose::from_translation(accepted) * *body.position(),
                    true,
                );
                self.query_updates.extend_from_slice(body.colliders());
            }
            let translation = rp::Vector::from(runtime.state.translation) + accepted;
            runtime.state.translation = translation.to_array();
            runtime.state.velocity =
                (translation / self.backend.integration_parameters.dt).to_array();
            runtime.state.carry_translation =
                (rp::Vector::from(runtime.state.carry_translation) + accepted).to_array();
            if rp::Vector::from(runtime.state.carry_translation).length_squared() > 1.0e-12 {
                runtime.state.carried_by = Some(support);
            } else {
                runtime.state.carried_by = None;
            }
        }
        self.refresh_queries();
    }

    fn step_character(&mut self, id: BodyId, runtime: &mut CharacterRuntime, commit: bool) {
        runtime.carry_fraction = 1.0;
        runtime.carry_blocker = None;
        runtime.motion_stop = None;
        runtime.support_motion = None;
        let Some(body) = self.backend.bodies.get(native_id(id)) else {
            return;
        };
        if !body.is_enabled() {
            runtime.state = CharacterState::default();
            return;
        }
        let Some(collider) = self
            .backend
            .colliders
            .get(native_collider(runtime.collider))
        else {
            return;
        };
        let dt = self.backend.integration_parameters.dt;
        let up = rp::Vector::from(runtime.config.up);
        let mut external_vertical = 0.;
        if runtime.config.push_mass > 0. {
            let impulse = std::mem::take(&mut runtime.pending_impulse);
            let external = rp::Vector::from(runtime.external_velocity)
                + (rp::Vector::from(runtime.external_force) * dt + rp::Vector::from(impulse))
                    / runtime.config.push_mass;
            external_vertical = external.dot(up);
            runtime.external_velocity = (external - up * external_vertical).to_array();
        }
        let body_pose = *body.position();
        let shape_pose = *collider.position();
        let shape = collider.shared_shape().clone(); // Ref-counted geometry, no per-step rebuild.
                                                     // Other controllers are handled by relative-motion casts after all targets exist.
                                                     // Treating their old poses as stationary would slow down co-moving groups.
        let order = &self.character_order;
        let finite_mass = runtime.config.push_mass > 0.;
        let support = runtime.state.ground.map(|g| native_id(g.body));
        let moving = &self.character_motion;
        let ignore_characters = |handle: rp::ColliderHandle, c: &rp::Collider| {
            c.is_enabled()
                && (!finite_mass
                    || c.parent() == support
                    || c.parent().is_none_or(|parent| {
                        self.backend
                            .bodies
                            .get(parent)
                            .is_none_or(|body| !body.is_dynamic())
                    }))
                && (moving.get(handle).is_none() || c.parent() == support)
                && self
                    .contact_policies
                    .one_way_allows(handle, c, shape.as_ref(), &shape_pose)
                && self
                    .contact_policies
                    .pair_allows(Some(native_id(id)), c.parent())
                && c.parent().is_none_or(|parent| {
                    let (slot, generation) = parent.into_raw_parts();
                    order.binary_search(&BodyId { slot, generation }).is_err()
                })
        };
        let filter = rp::QueryFilter {
            flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
            groups: Some(collider.collision_groups()),
            exclude_rigid_body: Some(native_id(id)),
            predicate: Some(&ignore_characters),
            ..rp::QueryFilter::default()
        };
        let mut controller = runtime.config.controller();
        let was_grounded = runtime.state.grounded;
        let jump = std::mem::take(&mut runtime.input.jump_speed);
        if !was_grounded || jump > 0.0 || external_vertical > 0. {
            controller.snap_to_ground = None;
        }
        let mut vertical_speed = runtime.state.vertical_speed;
        if was_grounded && jump > 0.0 {
            vertical_speed = jump;
        }
        vertical_speed += external_vertical;
        vertical_speed += self.backend.gravity.dot(up) * body.gravity_scale() * dt;
        vertical_speed = vertical_speed.clamp(
            -runtime.config.max_vertical_speed,
            runtime.config.max_vertical_speed,
        );
        // A supported character does not repeatedly sweep down into the floor while
        // walking. Ground snapping follows descending terrain; losing support retains
        // the integrated gravity speed for the next tick.
        let movement_speed = if was_grounded && jump == 0.0 && vertical_speed < 0.0 {
            0.0
        } else {
            vertical_speed
        };
        let desired = (rp::Vector::from(runtime.input.velocity)
            + rp::Vector::from(runtime.tick_velocity)
            + rp::Vector::from(runtime.external_velocity)
            + rp::Vector::from(runtime.contact_velocity)
            + up * movement_speed)
            * dt;
        if (rp::Vector::from(runtime.tick_velocity) + rp::Vector::from(runtime.external_velocity))
            .dot(up)
            > 0.
        {
            controller.snap_to_ground = None;
        }
        let mut dropped_contacts = 0;
        let queries = self.backend.query_pipeline_with_filter(filter);
        let planned = self.character_dynamics.contact_limited_translation(
            id,
            support,
            desired,
            self.backend.gravity,
            dt,
        );
        let (movement, mut translation) = super::character_query::move_with_clearance(
            &self.backend,
            &queries,
            &controller,
            &runtime.config,
            self.config.length_unit,
            shape.as_ref(),
            &shape_pose,
            planned,
            was_grounded && movement_speed == 0.0,
            &mut runtime.collisions,
            &mut dropped_contacts,
        );
        let mut upward_motion = desired.dot(up) > 0.0;
        let mut carried_by = None;
        let mut carry_translation = [0.0; 3];
        if was_grounded && jump == 0.0 && external_vertical <= 0. {
            if let Some((support_id, platform)) = runtime
                .state
                .ground
                .and_then(|g| {
                    self.backend
                        .bodies
                        .get(native_id(g.body))
                        .map(|p| (native_id(g.body), p))
                })
                .filter(|(_, p)| p.is_kinematic() || p.is_dynamic())
            {
                let next = if platform.body_type() == rp::RigidBodyType::KinematicPositionBased {
                    *platform.next_position()
                } else if platform.is_kinematic() {
                    super::kinematic_motion::accepted_kinematic_pose(
                        platform,
                        dt,
                        &self.kinematic_prediction_schedule(),
                    )
                } else {
                    super::character_dynamics::predicted_pose(platform, self.backend.gravity, dt)
                };
                let moved_pose = rp::Pose::from_translation(translation) * shape_pose;
                let material_point = runtime
                    .state
                    .ground
                    .filter(|_| platform.is_dynamic())
                    .and_then(|ground| {
                        let support = self
                            .backend
                            .colliders
                            .get(native_collider(ground.collider))?;
                        let hit = rapier3d::parry::query::contact(
                            support.position(),
                            support.shape(),
                            &moved_pose,
                            shape.as_ref(),
                            runtime.config.skin_width * 2.05,
                        )
                        .ok()??;
                        let point = match rotating_face_anchor(
                            support,
                            shape.as_ref(),
                            &moved_pose,
                            up,
                            platform.angvel(),
                        ) {
                            Some(local) => (local, *platform.position() * local),
                            None => (
                                platform.position().inverse_transform_point(hit.point1),
                                hit.point1,
                            ),
                        };
                        Some(point)
                    });
                let (local_anchor, anchor) = material_point.unwrap_or_else(|| {
                    (
                        platform
                            .position()
                            .inverse_transform_point(moved_pose.translation),
                        moved_pose.translation,
                    )
                });
                let next_anchor = next * local_anchor;
                let carry = next_anchor - anchor;
                if platform.is_dynamic() {
                    let (slot, generation) = support_id.into_raw_parts();
                    runtime.support_motion =
                        Some((BodyId { slot, generation }, local_anchor, anchor));
                }
                upward_motion |= carry.dot(up) > 0.0;
                if carry.length_squared() > 1.0e-12 {
                    let ignore_support = |handle: rp::ColliderHandle, c: &rp::Collider| {
                        c.parent() != Some(support_id) && ignore_characters(handle, c)
                    };
                    let carry_queries = self.backend.query_pipeline_with_filter(rp::QueryFilter {
                        predicate: Some(&ignore_support),
                        ..filter
                    });
                    let carry_controller = KinematicCharacterController {
                        autostep: None,
                        snap_to_ground: None,
                        ..controller
                    };
                    let carried = carry_controller.move_shape(
                        0.0,
                        &carry_queries,
                        shape.as_ref(),
                        &moved_pose,
                        carry,
                        |hit| {
                            // The first carry contact is before any sliding. Preserve
                            // its progress so a prescribed support can stop with its rider.
                            if hit.hit.normal1.dot(carry) < -1.0e-7 {
                                runtime.carry_fraction = runtime.carry_fraction.min(f64::from(
                                    (hit.translation_applied.dot(carry) / carry.length_squared())
                                        .clamp(0.0, 1.0),
                                ));
                            }
                            if runtime.collisions.len() < 32 {
                                runtime.collisions.push(hit);
                            } else {
                                dropped_contacts += 1;
                            }
                        },
                    );
                    translation += carried.translation;
                    if carried.translation.length_squared() > 1.0e-12 {
                        let (slot, generation) = support_id.into_raw_parts();
                        carried_by = Some(BodyId { slot, generation });
                        carry_translation = carried.translation.to_array();
                    }
                }
            }
        }
        if self.config.space == Space::PlanarXy {
            translation.z = 0.0;
            carry_translation[2] = 0.0;
        }
        // Contact with fixed/prescribed geometry consumes the blocked part of
        // external momentum. A one-shot knockback must not restart after a wall
        // is later removed; persistent forces will supply new momentum next tick.
        let mut external = rp::Vector::from(runtime.external_velocity);
        for hit in &runtime.collisions {
            let normal = self
                .backend
                .colliders
                .get(hit.handle)
                .map_or(hit.hit.normal1, |c| {
                    super::character_geometry::collision_normal(c, shape.as_ref(), hit)
                });
            let approach = external.dot(normal);
            if approach < 0. {
                external -= normal * approach;
            }
        }
        runtime.external_velocity = external.to_array();
        runtime.free_translation = translation.to_array();
        runtime.free_carry_translation = carry_translation;
        let mut free_velocity = if finite_mass {
            (desired + rp::Vector::from(carry_translation)) / dt
        } else {
            translation / dt
        };
        if finite_mass
            && was_grounded
            && movement_speed == 0.
            && support.is_some_and(|support| {
                self.backend
                    .bodies
                    .get(support)
                    .is_some_and(|body| body.is_dynamic())
            })
        {
            free_velocity += up * vertical_speed;
        }
        if finite_mass {
            for hit in &runtime.collisions {
                let Some(target) = self.backend.colliders.get(hit.handle) else {
                    continue;
                };
                if let Ok(Some(contact)) = rapier3d::parry::query::contact(
                    target.position(),
                    target.shape(),
                    &shape_pose,
                    shape.as_ref(),
                    runtime.config.skin_width * 1.05,
                ) {
                    let normal = super::character_geometry::target_normal(
                        target,
                        target.position(),
                        contact.point1,
                        contact.normal1,
                    );
                    let approach = free_velocity.dot(normal);
                    if approach < 0. {
                        free_velocity -= normal * approach;
                    }
                }
            }
        }
        runtime.free_velocity = free_velocity.to_array();
        let relative = if order.len() > 1 {
            super::character_motion::MotionResult {
                translation,
                carry_translation: carry_translation.into(),
                ..Default::default()
            }
        } else {
            super::character_motion::MotionQuery {
                world: &self.backend,
                scene: &self.character_motion,
                policies: &self.contact_policies,
                order,
                body: id,
                collider,
                config: &runtime.config,
            }
            .resolve(translation, rp::Vector::from(carry_translation))
        };
        runtime.motion_stop = relative.stop;
        translation = relative.translation;
        carry_translation = relative.carry_translation.to_array();
        if self.config.space == Space::PlanarXy {
            translation.z = 0.0;
            carry_translation[2] = 0.0;
        }
        if rp::Vector::from(carry_translation).length_squared() <= 1.0e-12 {
            carried_by = None;
        }
        if let Some(fraction) = relative.carry_fraction {
            if fraction <= runtime.carry_fraction {
                runtime.carry_fraction = fraction;
                runtime.carry_blocker = relative.carry_blocker;
            }
        }
        let hit_ceiling = relative.hit_ceiling
            || upward_motion
                && runtime
                    .collisions
                    .iter()
                    .any(|hit| hit.hit.normal1.dot(up) < -0.01);
        if hit_ceiling {
            vertical_speed = 0.0;
        }
        runtime.state = CharacterState {
            grounded: false,
            ground: None,
            carried_by,
            carry_translation,
            sliding: movement.is_sliding_down_slope
                && translation.dot(up) < -runtime.config.skin_width * 0.01,
            hit_ceiling,
            translation: translation.to_array(),
            velocity: (translation / dt).to_array(),
            vertical_speed,
            dropped_contacts,
            blocked_by_character: false,
            character_pair_casts: 0,
            character_pair_contact_checks: 0,
            character_coupling_iterations: runtime.dynamic_iterations,
            character_coupling_iteration_limit: runtime.dynamic_limited,
            failed_pair_casts: 0,
            moving_obstacle_casts: relative.casts,
            failed_moving_obstacle_casts: relative.failures,
            moving_obstacle_contact_checks: relative.contact_checks,
            failed_moving_obstacle_contacts: relative.contact_failures,
            blocked_by_moving_obstacle: relative.blocked,
            moving_obstacle_iteration_limit: relative.exhausted,
        };
        if commit {
            runtime.dynamic_iterations = 0;
            runtime.dynamic_limited = false;
        }
        if let Some(body) = self.backend.bodies.get_mut(native_id(id)) {
            body.set_next_kinematic_position(rp::Pose::from_translation(translation) * body_pose);
        }
    }
}

fn character_ground(
    world: &rp::PhysicsWorld,
    policies: &super::contact_policy::ContactPolicies,
    id: BodyId,
    runtime: &CharacterRuntime,
) -> Option<ColliderRef> {
    let up = rp::Vector::from(runtime.config.up);
    let rose_during_dash = rp::Vector::from(runtime.tick_velocity).dot(up) > 0.
        && (rp::Vector::from(runtime.state.translation)
            - rp::Vector::from(runtime.state.carry_translation))
        .dot(up)
            > 0.;
    if runtime.state.vertical_speed > 0.0
        || rose_during_dash
        || !world.bodies.get(native_id(id))?.is_enabled()
    {
        return None;
    }
    let collider = world.colliders.get(native_collider(runtime.collider))?;
    ground_at(
        world,
        policies,
        id,
        collider,
        collider.position(),
        &runtime.config,
    )
}

/// Shared support test for simulated and hypothetical capsule poses.
pub(super) fn ground_at(
    world: &rp::PhysicsWorld,
    policies: &super::contact_policy::ContactPolicies,
    id: BodyId,
    collider: &rp::Collider,
    shape_pose: &rp::Pose,
    config: &CharacterConfig,
) -> Option<ColliderRef> {
    ground_at_filtered(world, policies, id, collider, shape_pose, config, false)
}

pub(super) fn ground_at_filtered(
    world: &rp::PhysicsWorld,
    policies: &super::contact_policy::ContactPolicies,
    id: BodyId,
    collider: &rp::Collider,
    shape_pose: &rp::Pose,
    config: &CharacterConfig,
    fixed_only: bool,
) -> Option<ColliderRef> {
    if !collider.is_enabled() {
        return None;
    }
    let up = rp::Vector::from(config.up);
    let allowed = |handle: rp::ColliderHandle, c: &rp::Collider| {
        c.is_enabled()
            && c.parent().is_none_or(|p| {
                world
                    .bodies
                    .get(p)
                    .is_some_and(|b| b.is_enabled() && (!fixed_only || b.is_fixed()))
            })
            && policies.one_way_allows(handle, c, collider.shape(), shape_pose)
            && policies.pair_allows(Some(native_id(id)), c.parent())
    };
    let filter = rp::QueryFilter {
        flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
        groups: Some(collider.collision_groups()),
        exclude_rigid_body: Some(native_id(id)),
        predicate: Some(&allowed),
        ..rp::QueryFilter::default()
    };
    world
        .cast_shape(
            shape_pose,
            -up,
            collider.shape(),
            ShapeCastOptions {
                max_time_of_impact: config.skin_width * 2.0,
                target_distance: 0.0,
                stop_at_penetration: true,
                compute_impact_geometry_on_penetration: true,
            },
            filter,
        )
        .filter(|(_, hit)| hit.normal1.dot(up) >= config.max_slope_angle.cos() - 1.0e-5)
        .and_then(|(id, _)| world.colliders.get(id).and_then(|c| collider_ref(id, c)))
        .or_else(|| {
            // A touching roof may win the native down cast before its walkable
            // floor. This is a finite full-shape ground proximity certificate,
            // with the SAME filter and maximum ground distance; no cast hit,
            // callback, TOI or impulse is fabricated from this evidence.
            let queries = world.query_pipeline_with_filter(filter);
            let handle = super::character_query::certified_tight_ground(
                world,
                &queries,
                collider.shape(),
                shape_pose,
                config,
            )?;
            world
                .colliders
                .get(handle)
                .and_then(|c| collider_ref(handle, c))
        })
}

#[cfg(test)]
mod material_anchor_tests {
    use super::*;

    #[test]
    fn rotating_face_anchor_tracks_tangent_walk_in_the_body_frame() {
        let mut bodies = rp::RigidBodySet::new();
        let mut colliders = rp::ColliderSet::new();
        let pose = rp::Pose::from_parts(
            rp::Vector::new(3., -0.25, 1.),
            rp::Rotation::from_rotation_y(0.36),
        );
        let mount = rp::Pose::from_parts(
            rp::Vector::new(0.25, 0.125, -0.75),
            rp::Rotation::from_rotation_y(-0.2),
        );
        let body = bodies.insert(rp::RigidBodyBuilder::dynamic().pose(pose));
        let id = colliders.insert_with_parent(
            rp::ColliderBuilder::cuboid(2., 0.1, 2.).position(mount),
            body,
            &mut bodies,
        );
        let support = &colliders[id];
        let up = rp::Vector::Y;
        let capsule = rp::Capsule::new(up * -0.25, up * 0.25, 0.25);
        let anchor = |x, rotation, angular| {
            let center = *support.position() * rp::Vector::new(x, 0.61, -0.25);
            rotating_face_anchor(
                support,
                &capsule,
                &rp::Pose::from_parts(center, rotation),
                up,
                angular,
            )
        };
        for x in [0., 0.75] {
            let point = anchor(x, rp::Rotation::IDENTITY, up).unwrap();
            let expected = mount * rp::Vector::new(x, 0.1, -0.25);
            assert_eq!(point.y, expected.y);
            assert!((point - expected).length() < 2.0e-6);
        }
        // Past the edge, the capsule can still touch the box on its round side.
        assert!(anchor(2.05, rp::Rotation::IDENTITY, up).is_none());
        assert!(anchor(0., rp::Rotation::from_rotation_z(0.2), up).is_none());
        assert!(anchor(0., rp::Rotation::IDENTITY, rp::Vector::X).is_none());
    }
}

//! Two-phase migration of existing World components into the Engine-owned solver.
use super::planar_geometry::{fixture, material_supported, rotation};
use super::{Binding, UnifiedPhysicsError, UnifiedPhysicsRuntime};
use crate::components::{
    CompoundCollider, CompoundColliderRef, PhysicsMaterial, RigidBody, RigidBodyType,
};
use crate::entity::Entity;
use crate::physics3d::tick_inputs::TickInput;
use crate::physics3d::{
    AdditionalMassProperties, BodyDesc, BodyKind, BodyOptions, ColliderDesc, ColliderId,
    PhysicsError, PlanarCollisionSpan, Pose, Space,
};
use crate::world::World;

#[cfg(test)]
impl LegacyBinding {
    pub(in crate::engine) fn corrupt_runtime_payload_fixture(&mut self, case: usize) {
        match case {
            0 => self.mass.mass = f32::NAN,
            1 => self.material.friction = f32::NAN,
            2 => self.contact_config.position_correction_percent = f32::NAN,
            _ => unreachable!(),
        }
    }
}
#[cfg(test)]
impl PendingBody {
    pub(in crate::engine) fn corrupt_runtime_payload_fixture(&mut self, case: usize) {
        match case {
            0 => self.desc.pose.position[0] = f32::NAN,
            1 => self.rigid.gravity_scale = f32::NAN,
            2 => self.fixtures.as_mut().unwrap().descs[0].friction = f32::NAN,
            _ => unreachable!(),
        }
    }
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct LegacyBinding {
    // Collider-only motion has no RigidBody component to retain its role at rest.
    pub(super) implicit_kinematic: bool,
    options: BodyOptions,
    mass: AdditionalMassProperties,
    #[serde(with = "crate::checkpoint_codec::vector")]
    sources: Vec<CompoundCollider>,
    material: PhysicsMaterial,
    // Last sleep state written back to World; unchanged projection is not a new command.
    sleeping: bool,
    contact_config: crate::physics::RigidBodyStepConfig,
    #[serde(with = "crate::checkpoint_codec::vector")]
    fixtures: Vec<ColliderId>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Fixtures {
    #[serde(with = "crate::checkpoint_codec::vector")]
    sources: Vec<CompoundCollider>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    descs: Vec<ColliderDesc>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct PendingBody {
    implicit_kinematic: bool,
    entity: Entity,
    desc: BodyDesc,
    options: BodyOptions,
    mass: AdditionalMassProperties,
    rigid: RigidBody,
    contact_config: crate::physics::RigidBodyStepConfig,
    fixtures: Option<Fixtures>,
    span: Option<PlanarCollisionSpan>,
}

fn wanted(
    world: &World,
    i: usize,
    breakout: Option<&super::breakout::BreakoutBodies>,
    platformer: Option<&super::platformer::PlatformerBodies>,
) -> bool {
    world.rigid_bodies[i].is_some()
        || world.compound_collider_count_at(i) != 0
        || breakout.is_some_and(|b| world.entity_at_index(i).is_some_and(|e| b.owns(e)))
        || platformer.is_some_and(|b| world.entity_at_index(i).is_some_and(|e| b.owns(e)))
}

impl UnifiedPhysicsRuntime {
    // Validate the entire authored batch before consuming any impulse or changing bindings.
    pub(super) fn prepare_planar(
        &mut self,
        world: &World,
        contact_config: crate::physics::RigidBodyStepConfig,
    ) -> Result<(), UnifiedPhysicsError> {
        self.pending_planar.clear();
        let contact_config = contact_config.sanitized();
        let terrain_count = self.terrain.projected_count();
        let mut bodies = self.physics.body_count() - self.terrain.current_bodies()
            + self.terrain.projected_bodies();
        let mut colliders =
            self.physics.collider_count() - self.terrain.current_count() + terrain_count;
        if self.physics.config().space != Space::PlanarXy {
            if bodies > self.physics.config().max_bodies
                || colliders > self.physics.config().max_colliders
            {
                return Err(PhysicsError::CapacityExceeded.into());
            }
            if world.rigid_bodies.iter().any(Option::is_some) {
                return Err(UnifiedPhysicsError::LegacyBodiesPresent);
            }
            return Ok(());
        }

        for &i in world.alive_indices() {
            let Some(entity) = world.entity_at_index(i) else {
                continue;
            };
            let binding = self.bindings.get(&(entity.id, entity.generation));
            if binding.is_some_and(|b| b.legacy.is_none()) {
                if wanted(world, i, self.breakout.as_ref(), self.platformer.as_ref()) {
                    return Err(UnifiedPhysicsError::BodyOwnershipConflict);
                }
                continue;
            }
            if !wanted(world, i, self.breakout.as_ref(), self.platformer.as_ref()) {
                continue;
            }
            let cache = binding.and_then(|b| b.legacy.as_ref());
            let implicit_kinematic = world.rigid_bodies[i].is_none()
                && (self.platformer.as_ref().is_some_and(|b| b.owns(entity))
                    || self.breakout.as_ref().is_some_and(|b| b.owns(entity))
                    || (self.shooter_gameplay
                        && matches!(
                            world.collider_layer_at(i),
                            Some(
                                crate::components::CollisionLayer::Player
                                    | crate::components::CollisionLayer::Enemy
                                    | crate::components::CollisionLayer::Bullet
                            )
                        ))
                    || cache.is_some_and(|c| c.implicit_kinematic)
                    || world.velocities[i].is_some_and(|v| v.vx != 0. || v.vy != 0.)
                    || world.angular_velocities[i].is_some_and(|v| v.radians_per_second != 0.)
                    || world.movement_pattern(entity).is_some_and(|pattern| {
                        !matches!(
                            pattern,
                            crate::components::gameplay::MovementPattern::Static
                        )
                    }));
            let rigid = world.rigid_bodies[i].unwrap_or_else(|| {
                if implicit_kinematic {
                    RigidBody::kinematic()
                } else {
                    RigidBody::static_body()
                }
            });
            let p = world.transforms[i].ok_or(PhysicsError::InvalidBody)?;
            let angle = world.rotations[i].unwrap_or_default().radians;
            let v = world.velocities[i].unwrap_or_default();
            let av = world.angular_velocities[i]
                .unwrap_or_default()
                .radians_per_second;
            let desc = BodyDesc {
                kind: match rigid.body_type {
                    RigidBodyType::Static => BodyKind::Fixed,
                    RigidBodyType::Kinematic => BodyKind::KinematicVelocity,
                    RigidBodyType::Dynamic => BodyKind::Dynamic,
                },
                pose: Pose {
                    position: [p.x, p.y, 0.0],
                    rotation: rotation(angle),
                },
                linear_velocity: [v.vx, v.vy, 0.0],
                angular_velocity: [0.0, 0.0, if rigid.fixed_rotation { 0.0 } else { av }],
                gravity_scale: rigid.gravity_scale,
                linear_damping: rigid.linear_damping,
                angular_damping: rigid.angular_damping,
                can_sleep: rigid.can_sleep,
                ccd: contact_config.continuous,
            };
            self.physics.validate_body_desc(&desc)?;
            let span = world.height_span(entity).map(|s| PlanarCollisionSpan {
                floor: s.floor.0,
                elevation: s.elevation,
                height: s.height,
            });
            self.physics.validate_planar_collision_span(span)?;
            for value in [
                rigid.force.vx,
                rigid.force.vy,
                rigid.impulse.vx,
                rigid.impulse.vy,
                rigid.torque,
                rigid.angular_impulse,
            ] {
                if !value.is_finite() || value.abs() > 1.0e6 {
                    return Err(PhysicsError::InvalidBody.into());
                }
            }
            let mut options = BodyOptions::from(&desc);
            options.enabled = rigid.enabled;
            options.lock_rotation = rigid.fixed_rotation;
            let mass = if desc.kind == BodyKind::Dynamic {
                if !rigid.mass.is_finite()
                    || !(0.0..=1.0e9).contains(&rigid.mass)
                    || !rigid.inertia.is_finite()
                    || !(0.0..=1.0e12).contains(&rigid.inertia)
                {
                    return Err(PhysicsError::InvalidBody.into());
                }
                AdditionalMassProperties {
                    mass: rigid.mass,
                    principal_inertia: [rigid.inertia * 0.5, rigid.inertia * 0.5, rigid.inertia],
                    center: [0.0; 3],
                    inertia_rotation: Pose::default().rotation,
                }
            } else {
                AdditionalMassProperties {
                    mass: 0.0,
                    principal_inertia: [0.0; 3],
                    center: [0.0; 3],
                    inertia_rotation: Pose::default().rotation,
                }
            };
            material_supported(rigid.material)?;
            let count = world.compound_collider_count_at(i);
            let same = cache.is_some_and(|c| {
                c.material == rigid.material
                    && c.contact_config == contact_config
                    && c.sources.len() == count
                    && c.sources.iter().enumerate().all(|(j, old)| {
                        source_at(world, i, j) == Some(CompoundColliderRef::from_collider(old))
                    })
            });
            let fixtures = if same {
                None
            } else {
                let mut sources = Vec::with_capacity(count);
                let mut descs = Vec::with_capacity(count);
                for j in 0..count {
                    let source = source_at(world, i, j).ok_or(PhysicsError::InvalidCollider)?;
                    if source.enabled() {
                        // Cached fixtures outlive one variable interval: derive the
                        // per-step correction gains from the world's nominal clock.
                        let mut collider = fixture(
                            source,
                            rigid.material,
                            contact_config,
                            self.physics.nominal_step_seconds(),
                        )?;
                        if self.shooter_gameplay
                            && world.collider_layer_at(i)
                                == Some(crate::components::CollisionLayer::Bullet)
                        {
                            // Gameplay keeps the World fixture and sweeps after movement.
                            // Solver impulses must not replace pierce/bounce/despawn policy.
                            collider.sensor = true;
                        }
                        if self.shooter_gameplay
                            && matches!(
                                world.collider_layer_at(i),
                                Some(
                                    crate::components::CollisionLayer::Player
                                        | crate::components::CollisionLayer::Enemy
                                )
                            )
                        {
                            // Shooter gameplay triggers still collide with terrain.
                            collider.sensor = false;
                        }
                        if self.breakout.is_some()
                            && matches!(
                                world.collider_layer_at(i),
                                Some(
                                    crate::components::CollisionLayer::Player
                                        | crate::components::CollisionLayer::Bullet
                                        | crate::components::CollisionLayer::Wall
                                        | crate::components::CollisionLayer::Enemy
                                )
                            )
                        {
                            // Scene policy, rather than sensor exclusion, decides the first hit.
                            // World authoring trigger flags remain unchanged.
                            collider.sensor = false;
                        }
                        if self
                            .platformer
                            .as_ref()
                            .is_some_and(|b| b.is_player(entity))
                        {
                            collider.sensor = false;
                        }
                        self.physics.validate_collider_desc(&collider, desc.kind)?;
                        descs.push(collider);
                    }
                    sources.push(source.to_owned());
                }
                if descs.len() > 64 {
                    return Err(PhysicsError::CapacityExceeded.into());
                }
                colliders = colliders - cache.map_or(0, |c| c.fixtures.len()) + descs.len();
                Some(Fixtures { sources, descs })
            };
            if binding.is_none() {
                bodies += 1;
            }
            self.pending_planar.push(PendingBody {
                implicit_kinematic,
                entity,
                desc,
                options,
                mass,
                rigid,
                contact_config,
                fixtures,
                span,
            });
        }
        if bodies > self.physics.config().max_bodies
            || colliders > self.physics.config().max_colliders
        {
            return Err(PhysicsError::CapacityExceeded.into());
        }
        Ok(())
    }

    pub(super) fn commit_planar(
        &mut self,
        world: &mut World,
        apply_inputs: bool,
    ) -> Result<(), UnifiedPhysicsError> {
        // Shrink all fixture lists before growth so a full arena can exchange fixtures.
        for p in &self.pending_planar {
            if let (Some(fixtures), Some(binding)) = (
                &p.fixtures,
                self.bindings.get_mut(&(p.entity.id, p.entity.generation)),
            ) {
                if let Some(cache) = &mut binding.legacy {
                    while cache.fixtures.len() > fixtures.descs.len() {
                        if let Some(id) = cache.fixtures.pop() {
                            self.physics.remove_collider(id)?;
                        }
                    }
                }
            }
        }
        for p in self.pending_planar.drain(..) {
            let key = (p.entity.id, p.entity.generation);
            if let std::collections::btree_map::Entry::Vacant(entry) = self.bindings.entry(key) {
                let body = self.physics.create_body_without_collider(p.desc.clone())?;
                self.physics.set_body_options(body, &p.options)?;
                self.physics.set_additional_mass_properties(body, &p.mass)?;
                entry.insert(Binding {
                    body,
                    render_offset: [0.0; 3],
                    legacy: Some(LegacyBinding {
                        implicit_kinematic: p.implicit_kinematic,
                        options: p.options.clone(),
                        mass: p.mass.clone(),
                        sources: Vec::new(),
                        material: p.rigid.material,
                        sleeping: false,
                        contact_config: p.contact_config,
                        fixtures: Vec::new(),
                    }),
                });
                self.entities_by_body.insert(body, p.entity);
                world.unified_physics_entities.insert(key);
            }
            let binding = self
                .bindings
                .get_mut(&key)
                .ok_or(UnifiedPhysicsError::StaleEntity)?;
            let cache = binding
                .legacy
                .as_mut()
                .ok_or(UnifiedPhysicsError::BodyOwnershipConflict)?;
            cache.implicit_kinematic = p.implicit_kinematic;
            if cache.options != p.options {
                self.physics.set_body_options(binding.body, &p.options)?;
                cache.options = p.options;
            }
            if cache.mass != p.mass {
                self.physics
                    .set_additional_mass_properties(binding.body, &p.mass)?;
                cache.mass = p.mass;
            }
            if let Some(fixtures) = p.fixtures {
                for (i, desc) in fixtures.descs.into_iter().enumerate() {
                    if let Some(&id) = cache.fixtures.get(i) {
                        self.physics.update_collider(id, desc)?;
                    } else {
                        cache
                            .fixtures
                            .push(self.physics.add_collider(binding.body, desc)?);
                    }
                }
                cache.sources = fixtures.sources;
                cache.material = p.rigid.material;
                cache.contact_config = p.contact_config;
            }
            self.physics
                .set_planar_collision_span(binding.body, p.span)?;
            let state = self.physics.body_state(binding.body)?;
            // Compare the exact 2D projection to avoid reteleporting due to quaternion roundoff.
            let old_angle = self.physics.planar_rotation(binding.body)? as f32;
            let angle = world.rotations[p.entity.id as usize]
                .unwrap_or_default()
                .radians;
            if state.pose.position != p.desc.pose.position || old_angle != angle {
                self.physics.set_pose(binding.body, p.desc.pose)?;
                self.physics
                    .set_planar_rotation(binding.body, f64::from(angle))?;
            }
            if state.linear_velocity != p.desc.linear_velocity
                || state.angular_velocity != p.desc.angular_velocity
            {
                self.physics.set_velocity(
                    binding.body,
                    p.desc.linear_velocity,
                    p.desc.angular_velocity,
                )?;
            }
        }
        if apply_inputs {
            self.apply_planar_inputs(world)?;
        }
        Ok(())
    }

    /// Stages legacy force/impulse/sleep components for the next native tick.
    /// The tick applies them inside its rollback journal, so a zero-progress
    /// rejection leaves no partial input and the retry stages them once again.
    pub(super) fn apply_planar_inputs(&mut self, world: &World) -> Result<(), UnifiedPhysicsError> {
        self.physics.discard_staged_tick_inputs();
        for (&(id, generation), binding) in &self.bindings {
            let Some(cache) = &binding.legacy else {
                continue;
            };
            let Some(r) = world.rigid_body(crate::entity::Entity { id, generation }) else {
                continue;
            };
            if r.body_type != RigidBodyType::Dynamic || !r.enabled {
                continue;
            }
            let input = TickInput {
                sleeping: (r.is_sleeping != cache.sleeping).then_some(r.is_sleeping),
                force: (r.force.vx != 0.0 || r.force.vy != 0.0 || r.torque != 0.0).then_some((
                    [r.force.vx, r.force.vy, 0.0],
                    [0.0, 0.0, if r.fixed_rotation { 0.0 } else { r.torque }],
                )),
                impulse: (r.impulse.vx != 0.0 || r.impulse.vy != 0.0).then_some([
                    r.impulse.vx,
                    r.impulse.vy,
                    0.0,
                ]),
                torque_impulse: (r.angular_impulse != 0.0 && !r.fixed_rotation).then_some([
                    0.0,
                    0.0,
                    r.angular_impulse,
                ]),
            };
            if input != TickInput::default() {
                if let Err(error) = self.physics.stage_tick_input(binding.body, input) {
                    self.physics.discard_staged_tick_inputs();
                    return Err(error.into());
                }
            }
        }
        Ok(())
    }

    pub(super) fn finish_planar(&mut self, world: &mut World) -> Result<(), UnifiedPhysicsError> {
        for (&(id, _), binding) in &mut self.bindings {
            let Some(cache) = &mut binding.legacy else {
                continue;
            };
            if let Some(body) = world.rigid_bodies[id as usize].as_mut() {
                if body.force.vx != 0.0 || body.force.vy != 0.0 || body.torque != 0.0 {
                    self.physics.clear_forces(binding.body)?;
                }
                body.force = Default::default();
                body.impulse = Default::default();
                body.torque = 0.0;
                body.angular_impulse = 0.0;
                body.is_sleeping = self.physics.body_state(binding.body)?.sleeping;
                cache.sleeping = body.is_sleeping;
                body.sleep_timer_seconds = 0.0; // Sleep timing is owned by the backend.
            }
        }
        Ok(())
    }

    pub(super) fn retire_planar_components(&mut self, world: &mut World) {
        self.retired.clear();
        for (&(id, generation), binding) in &self.bindings {
            if binding.legacy.is_some()
                && world.is_current_entity(Entity { id, generation })
                && world.rigid_bodies[id as usize].is_none()
            {
                // Overrides belong to the explicit RigidBody component, not its
                // collider-only successor after component removal.
                self.automatic_planar.settings.remove(&(id, generation));
            }
            if binding.legacy.is_some()
                && world.is_current_entity(Entity { id, generation })
                && !wanted(
                    world,
                    id as usize,
                    self.breakout.as_ref(),
                    self.platformer.as_ref(),
                )
            {
                self.retired.push((id, generation));
            }
        }
        for key in self.retired.drain(..) {
            self.automatic_planar.settings.remove(&key);
            if let Some(binding) = self.bindings.remove(&key) {
                let _ = self.physics.remove_body(binding.body);
                self.joint_stream.capture(
                    &mut self.physics,
                    &self.entities_by_body,
                    &mut self.native_joint_events,
                );
                self.lifecycle.capture(
                    &mut self.physics,
                    &self.entities_by_body,
                    &self.terrain.by_collider,
                );
                self.entities_by_body.remove(&binding.body);
            }
            world.unified_physics_entities.remove(&key);
        }
    }
}

fn source_at(world: &World, i: usize, j: usize) -> Option<CompoundColliderRef<'_>> {
    let source = world.compound_collider_ref_at(i, j)?;
    Some(CompoundColliderRef::new(
        source.shape,
        source.material(),
        world.compound_collision_filter_at(i, j),
    ))
}

// Borrowed projections for the separate cold file-ownership pass. No schema fields.
impl LegacyBinding {
    pub(super) fn file_fixtures(&self) -> (&[CompoundCollider], &[ColliderId]) {
        (&self.sources, &self.fixtures)
    }
    #[cfg(test)]
    pub(super) fn file_test_drop_source(&mut self) {
        self.sources.pop();
    }
    #[cfg(test)]
    pub(super) fn file_test_replace_fixture(&mut self, index: usize, collider: ColliderId) {
        self.fixtures[index] = collider;
    }
}
impl PendingBody {
    pub(super) fn file_owner(&self) -> Entity {
        self.entity
    }
    pub(super) fn file_fixtures(&self) -> Option<(&[CompoundCollider], &[ColliderDesc])> {
        self.fixtures
            .as_ref()
            .map(|f| (f.sources.as_slice(), f.descs.as_slice()))
    }
}

mod file_payload_admission;

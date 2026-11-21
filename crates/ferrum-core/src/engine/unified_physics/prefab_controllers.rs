//! Immutable actor physics definitions are separate from each instance's native runtime state.
use super::*;
use crate::physics3d::BodyPrototype;
use crate::world::World;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) enum ActorPhysicsPrototype {
    Automatic(super::controller_settings::ControllerSettings),
    Native {
        body: BodyPrototype,
        space: Space,
        #[serde(with = "crate::checkpoint_codec::array")]
        render_offset: [f32; 3],
    },
}

impl ActorPhysicsPrototype {
    pub(in crate::engine) fn accepts_space(&self, space: Space) -> bool {
        match self {
            Self::Automatic(_) => space == Space::PlanarXy,
            Self::Native {
                space: captured, ..
            } => *captured == space,
        }
    }
    pub(in crate::engine) fn is_native(&self) -> bool {
        matches!(self, Self::Native { .. })
    }
    pub(in crate::engine) fn query_work(&self) -> u64 {
        match self {
            Self::Automatic(_) => 1,
            Self::Native { body, .. } => body.query_work(),
        }
    }
}

impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn admit_actor_prefab_capacity(
        &mut self,
        world: &World,
        definition: Option<&ActorPhysicsPrototype>,
    ) -> Result<(), UnifiedPhysicsError> {
        self.retire_deleted_entities(world);
        let mut bodies = self.physics.body_count();
        let mut colliders = self.physics.collider_count();
        if self.physics.config().space == Space::PlanarXy {
            for &index in world.alive_indices() {
                let Some(entity) = world.entity_at_index(index) else {
                    continue;
                };
                if !self.bindings.contains_key(&(entity.id, entity.generation))
                    && (world.rigid_body(entity).is_some()
                        || world.compound_collider_count(entity) != 0)
                {
                    bodies += 1;
                    colliders += world.compound_collider_count(entity);
                }
            }
        }
        if let Some(ActorPhysicsPrototype::Native { body, .. }) = definition {
            bodies += 1;
            colliders += body.collider_count();
        }
        if bodies > self.physics.config().max_bodies
            || colliders > self.physics.config().max_colliders
        {
            return Err(PhysicsError::CapacityExceeded.into());
        }
        Ok(())
    }

    pub(in crate::engine) fn actor_physics_prototype(
        &self,
        source: Entity,
    ) -> Result<Option<ActorPhysicsPrototype>, UnifiedPhysicsError> {
        let key = (source.id, source.generation);
        if let Some(binding) = self
            .bindings
            .get(&key)
            .filter(|binding| binding.legacy.is_none())
        {
            return Ok(Some(ActorPhysicsPrototype::Native {
                body: self.physics.body_prototype(binding.body)?,
                space: self.physics.config().space,
                render_offset: binding.render_offset,
            }));
        }
        Ok(self
            .automatic_planar
            .settings
            .get(&key)
            .cloned()
            .map(ActorPhysicsPrototype::Automatic))
    }

    pub(in crate::engine) fn install_actor_physics_prototype(
        &mut self,
        world: &mut World,
        entity: Entity,
        definition: &ActorPhysicsPrototype,
    ) -> Result<(), UnifiedPhysicsError> {
        self.retire_deleted_entities(world);
        if !definition.accepts_space(self.physics.config().space) {
            return Err(PhysicsError::OutOfPlane.into());
        }
        let key = (entity.id, entity.generation);
        match definition {
            ActorPhysicsPrototype::Automatic(settings) => {
                self.automatic_planar.settings.insert(key, settings.clone());
            }
            ActorPhysicsPrototype::Native {
                body: prototype,
                render_offset,
                ..
            } => {
                let at = world
                    .transform(entity)
                    .ok_or(UnifiedPhysicsError::StaleEntity)?;
                let anchor = match self.physics.config().space {
                    Space::PlanarXy => [at.x, at.y, 0.],
                    Space::Spatial => [
                        at.x,
                        world
                            .height_span(entity)
                            .map_or(prototype.body.pose.position[1] + render_offset[1], |span| {
                                span.elevation
                            }),
                        -at.y,
                    ],
                };
                let position = std::array::from_fn(|i| anchor[i] - render_offset[i]);
                let body = self.physics.spawn_body_prototype(prototype, position)?;
                let span =
                    world
                        .height_span(entity)
                        .map(|span| crate::physics3d::PlanarCollisionSpan {
                            floor: span.floor.0,
                            elevation: span.elevation,
                            height: span.height,
                        });
                if self.physics.config().space == Space::PlanarXy {
                    if let Err(error) = self.physics.set_planar_collision_span(body, span) {
                        let _ = self.physics.remove_body(body);
                        return Err(error.into());
                    }
                }
                self.bindings.insert(
                    key,
                    Binding {
                        body,
                        render_offset: *render_offset,
                        legacy: None,
                    },
                );
                self.entities_by_body.insert(body, entity);
                world.unified_physics_entities.insert(key);
                if let Err(error) = self.write_entity(world, entity) {
                    self.discard_actor_physics_prototype(world, entity);
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    pub(in crate::engine) fn actor_prefab_placement_blocked(
        &mut self,
        entity: Entity,
    ) -> Result<bool, UnifiedPhysicsError> {
        let Some(binding) = self
            .bindings
            .get(&(entity.id, entity.generation))
            .filter(|binding| binding.legacy.is_none())
        else {
            return Ok(false);
        };
        Ok(self
            .physics
            .actor_placement_blocked(binding.body, crate::components::CollisionMask::WALL.bits)?)
    }

    pub(in crate::engine) fn discard_actor_physics_prototype(
        &mut self,
        world: &mut World,
        entity: Entity,
    ) {
        let key = (entity.id, entity.generation);
        self.automatic_planar.settings.remove(&key);
        if let Some(binding) = self.bindings.remove(&key) {
            let _ = self.physics.remove_body(binding.body);
            self.entities_by_body.remove(&binding.body);
            world.unified_physics_entities.remove(&key);
        }
    }
}

#[allow(dead_code)]
mod file_admission;

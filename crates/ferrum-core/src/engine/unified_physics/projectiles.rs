//! Native ownership and per-tick swept hits for generated Data Scene projectiles.
use super::*;
use crate::components::CollisionMask;
use crate::physics3d::{BodyKind, PlanarCollisionSpan, QueryFilter, Shape};
use crate::world::World;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct Projectile {
    body: BodyId,
    source: Entity,
    shape: Shape,
    mask: u32,
    start: Pose,
    #[serde(skip)]
    previous_start: Pose,
    hit: Option<ProjectileHit>,
}

#[cfg(test)]
impl Projectile {
    pub(in crate::engine) fn corrupt_runtime_payload_fixture(&mut self, case: usize) {
        if case == 0 {
            if let Shape::Box { half_extents } = &mut self.shape {
                half_extents[0] = f32::NAN;
            } else {
                panic!("fixture is a generated box projectile");
            }
        } else {
            self.start.position[0] = f32::NAN;
        }
    }
}

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) enum ProjectileHit {
    Entity {
        entity: Entity,
        wall: bool,
    },
    Terrain {
        record: super::terrain_events::TerrainImpactRecord,
    },
}

impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn projectile_transform(
        &self,
        world: &World,
        entity: Entity,
    ) -> Option<Transform2D> {
        // Imported planar bodies receive World authoring edits at the upcoming
        // physics tick. Input/timer dispatch runs before that synchronization.
        if self
            .bindings
            .get(&(entity.id, entity.generation))
            .is_some_and(|binding| binding.legacy.is_some())
        {
            return world.transform(entity);
        }
        let p = self.gameplay_position(world, entity)?;
        Some(match self.physics.config().space {
            Space::PlanarXy => Transform2D { x: p[0], y: p[1] },
            Space::Spatial => Transform2D { x: p[0], y: -p[2] },
        })
    }

    pub(in crate::engine) fn projectile_elevation(&self, source: Entity, authored: f32) -> f32 {
        if self.physics.config().space == Space::Spatial {
            self.bindings
                .get(&(source.id, source.generation))
                .and_then(|binding| self.physics.body_state(binding.body).ok())
                .map_or(authored, |state| state.pose.position[1])
        } else {
            authored
        }
    }

    /// Called before World integrates the newly spawned entity or cooldown is committed.
    pub(in crate::engine) fn admit_projectile(
        &mut self,
        world: &mut World,
        entity: Entity,
        source: Entity,
    ) -> Result<(), UnifiedPhysicsError> {
        self.retire_deleted_entities(world);
        let at = world
            .transform(entity)
            .ok_or(UnifiedPhysicsError::StaleEntity)?;
        let footprint = world
            .collider(entity)
            .ok_or(PhysicsError::InvalidCollider)?;
        let mut span = world
            .height_span(entity)
            .ok_or(PhysicsError::InvalidCollider)?;
        let velocity = world.velocity_at_index_or_default(entity.id as usize);
        let filter = world
            .collision_filter_at(entity.id as usize)
            .ok_or(PhysicsError::InvalidCollider)?;
        span.elevation = self.projectile_elevation(source, span.elevation);
        let (position, velocity, half_extents) = match self.physics.config().space {
            Space::PlanarXy => (
                [at.x, at.y, 0.0],
                [velocity.vx, velocity.vy, 0.0],
                [
                    footprint.half_width,
                    footprint.half_height,
                    footprint.half_width.hypot(footprint.half_height) + 1.0,
                ],
            ),
            Space::Spatial => (
                [at.x, span.elevation, -at.y],
                [velocity.vx, 0.0, -velocity.vy],
                [
                    footprint.half_width,
                    (span.height * 0.5).max(0.005),
                    footprint.half_height,
                ],
            ),
        };
        let planar_span =
            (self.physics.config().space == Space::PlanarXy).then_some(PlanarCollisionSpan {
                floor: span.floor.0,
                elevation: span.elevation,
                height: span.height,
            });
        self.physics.validate_planar_collision_span(planar_span)?;
        let shape = Shape::Box { half_extents };
        let pose = Pose {
            position,
            ..Pose::default()
        };
        let body = self.physics.create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose,
                linear_velocity: velocity,
                gravity_scale: 0.0,
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                category: filter.category.bits,
                mask: filter.mask.bits,
                ..ColliderDesc::new(shape.clone())
            },
        )?;
        // Validated before body creation. Roll back if backend admission nevertheless fails.
        if let Err(error) = self.physics.set_planar_collision_span(body, planar_span) {
            let _ = self.physics.remove_body(body);
            return Err(error.into());
        }
        let key = (entity.id, entity.generation);
        self.bindings.insert(
            key,
            Binding {
                body,
                render_offset: [0.0; 3],
                legacy: None,
            },
        );
        self.entities_by_body.insert(body, entity);
        self.projectiles.insert(
            key,
            Projectile {
                body,
                source,
                shape,
                mask: filter.mask.bits,
                start: pose,
                previous_start: pose,
                hit: None,
            },
        );
        world.unified_physics_entities.insert(key);
        // The native fixture is authoritative; retaining the old collider would reimport
        // it as a fixed body and allow legacy terrain resolution to move the projectile.
        world.clear_collider(entity);
        world.set_height_span(entity, span);
        self.write_entity(world, entity)
    }

    pub(super) fn begin_projectile_step(&mut self) {
        self.physics.set_step_motion_enabled(
            self.projectiles
                .values()
                .any(|projectile| projectile.hit.is_none()),
        );
        for projectile in self.projectiles.values_mut() {
            projectile.previous_start = projectile.start;
            if let Ok(state) = self.physics.body_state(projectile.body) {
                projectile.start = state.pose;
            }
        }
    }

    pub(super) fn restore_projectile_starts(&mut self) {
        for projectile in self.projectiles.values_mut() {
            projectile.start = projectile.previous_start;
        }
    }

    pub(super) fn finish_projectile_step(&mut self, world: &World) {
        for (&(id, generation), projectile) in &mut self.projectiles {
            if projectile.hit.is_some() {
                continue;
            }
            let result = (|| -> Result<(), UnifiedPhysicsError> {
                let state = self.physics.body_state(projectile.body)?;
                let translation: [f32; 3] =
                    std::array::from_fn(|i| state.pose.position[i] - projectile.start.position[i]);
                self.physics.sweep_step_motion(
                    &projectile.shape,
                    projectile.start,
                    translation,
                    &QueryFilter {
                        category: CollisionMask::BULLET.bits,
                        mask: projectile.mask,
                        include_sensors: true,
                        exclude_body: Some(projectile.body),
                        ..QueryFilter::default()
                    },
                    &mut self.native_sweep_hits,
                    self.physics.config().max_colliders,
                )?;
                let mut selected = None;
                for hit in &self.native_sweep_hits {
                    if !self
                        .physics
                        .body_collision_spans_allow(projectile.body, hit.target.body)?
                    {
                        continue;
                    }
                    if let Some(source) = self.terrain.source(hit.target.collider) {
                        if !self.terrain.allows(hit.target.collider, 2) {
                            continue;
                        }
                        let identity = match source {
                            UnifiedTerrainSource::Tile { layer, tile } => (0, layer, tile),
                            UnifiedTerrainSource::SpatialSurface { id } => (1, id, 0),
                        };
                        // Terrain wins ties; authored kind/id remains stable after reorder.
                        let key = (hit.fraction, 0, identity.0, identity.1, identity.2);
                        if selected.as_ref().is_none_or(|(old, _)| key < *old) {
                            let actor = self
                                .physics
                                .collider_ids(projectile.body)?
                                .next()
                                .ok_or(PhysicsError::StaleCollider)?;
                            let actor = self.physics.collider_owner(actor)?;
                            let mut record = super::terrain_events::TerrainImpactRecord::new(
                                2,
                                Entity { id, generation },
                                actor,
                                hit.target,
                                source,
                                hit.point,
                                hit.normal,
                            );
                            record.fraction = hit.fraction;
                            record.flags = 4;
                            selected = Some((key, ProjectileHit::Terrain { record }));
                        }
                        continue;
                    }
                    let Some(&entity) = self.entities_by_body.get(&hit.target.body) else {
                        continue;
                    };
                    if entity == projectile.source
                        || !world.is_current_entity(entity)
                        || !self
                            .physics
                            .body_collision_spans_allow(projectile.body, hit.target.body)?
                    {
                        continue;
                    }
                    let wall = self.physics.collider_category(hit.target.collider)?
                        & CollisionMask::WALL.bits
                        != 0;
                    let key = (hit.fraction, 1, 0, entity.id, entity.generation);
                    if selected.as_ref().is_none_or(|(old, _)| key < *old) {
                        selected = Some((key, ProjectileHit::Entity { entity, wall }));
                    }
                }
                if let Some(((fraction, ..), hit)) = selected {
                    let pose = Pose {
                        position: std::array::from_fn(|i| {
                            projectile.start.position[i] + translation[i] * fraction
                        }),
                        ..projectile.start
                    };
                    self.physics.set_pose(projectile.body, pose)?;
                    self.physics
                        .set_velocity(projectile.body, [0.0; 3], [0.0; 3])?;
                    projectile.hit = Some(hit);
                }
                Ok(())
            })();
            if let Err(error) = result {
                self.last_error.record(error);
            }
        }
    }

    pub(in crate::engine) fn take_projectile_hit(
        &mut self,
        entity: Entity,
    ) -> Option<ProjectileHit> {
        self.projectiles
            .get_mut(&(entity.id, entity.generation))?
            .hit
            .take()
    }

    pub(in crate::engine) fn record_projectile_error(&mut self, error: UnifiedPhysicsError) {
        self.last_error.record(error);
    }
}

impl Projectile {
    pub(super) fn file_hit_matches_actor(&self, key: (u32, u32)) -> bool {
        match self.hit {
            Some(ProjectileHit::Terrain { record }) => {
                record.actor == [key.0, key.1]
                    && record.actor_body == [self.body.slot, self.body.generation]
            }
            _ => true,
        }
    }
    pub(super) fn file_body(&self) -> BodyId {
        self.body
    }
}

mod file_payload_admission;

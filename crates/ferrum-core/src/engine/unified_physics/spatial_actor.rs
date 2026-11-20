//! Spatial actor intent and feedback. The controller owns every physical pose.
use super::{UnifiedPhysicsError, UnifiedPhysicsRuntime};
use crate::components::{PhysicsFloorId, Transform2D};
use crate::entity::Entity;
use crate::input::InputState;
use crate::physics3d::{BodyId, PhysicsError, Space};
use crate::spatial_scene::{SpatialMoveStatus, SpatialScene};
use crate::world::World;

pub(in crate::engine) mod navigation;
#[cfg(test)]
mod tests;
pub(super) use navigation::ActorNavigation;

impl super::Engine {
    pub(in crate::engine) fn move_unified_spatial_actor(
        &mut self,
        entity: Entity,
        dx: f32,
        dy: f32,
        step: f32,
        drop: f32,
    ) -> Option<bool> {
        let runtime = self.unified_physics.as_mut()?;
        let result = (|| -> Result<(), UnifiedPhysicsError> {
            if self.scene_mode != super::SceneMode::Data {
                return Err(UnifiedPhysicsError::WrongScene);
            }
            let body = runtime.spatial_actor_body(entity)?;
            runtime.prepare_query(
                &mut self.world,
                self.auto_rigid_body_step_config,
                &self.tilemap,
                &self.spatial_scene,
            )?;
            let mut scratch = crate::physics3d::CharacterProbeScratch::default();
            runtime.physics.move_character_displacement(
                body,
                [dx, 0., -dy],
                step,
                drop,
                &mut scratch,
            )?;
            runtime.write_entity(&mut self.world, entity)?;
            if self.spatial_scene.actor.map(|a| a.0) == Some(entity) {
                runtime.cancel_spatial_actor_navigation();
                runtime.finish_spatial_actor(&self.spatial_scene, &mut self.world);
            }
            Ok(())
        })();
        if let Err(error) = result {
            runtime.last_error = Some(error);
        }
        Some(result.is_ok())
    }

    #[allow(clippy::too_many_arguments)]
    pub(in crate::engine) fn plan_unified_spatial_actor(
        &mut self,
        goal: Transform2D,
        floor: u32,
        speed: f32,
        cell: f32,
        radius: f32,
        cancel_on_input: bool,
    ) -> Option<bool> {
        let runtime = self.unified_physics.as_mut()?;
        if let Err(error) = runtime.prepare_query(
            &mut self.world,
            self.auto_rigid_body_step_config,
            &self.tilemap,
            &self.spatial_scene,
        ) {
            runtime.last_error = Some(error);
            runtime.actor_navigation.reject_unavailable_request();
            return Some(false);
        }
        Some(runtime.plan_spatial_actor_navigation(
            &self.spatial_scene,
            goal,
            floor,
            speed,
            cell,
            radius,
            cancel_on_input,
        ))
    }
}

impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn spatial_actor_body(
        &self,
        entity: Entity,
    ) -> Result<BodyId, UnifiedPhysicsError> {
        if self.physics.config().space != Space::Spatial {
            return Err(PhysicsError::InvalidCharacter.into());
        }
        let binding = self
            .bindings
            .get(&(entity.id, entity.generation))
            .ok_or(UnifiedPhysicsError::StaleEntity)?;
        let config = self.physics.character_config(binding.body)?;
        if config.up != [0., 1., 0.] {
            return Err(PhysicsError::InvalidCharacter.into());
        }
        Ok(binding.body)
    }

    pub(in crate::engine) fn spatial_actor_settings_valid(
        &self,
        entity: Entity,
        step: f32,
        drop: f32,
    ) -> bool {
        [step, drop]
            .iter()
            .all(|v| v.is_finite() && (0. ..=10000.).contains(v))
            && self.spatial_actor_body(entity).is_ok()
    }

    pub(in crate::engine) fn configure_spatial_actor_controller(
        &mut self,
        entity: Entity,
        step: f32,
        drop: f32,
    ) -> bool {
        if !self.spatial_actor_settings_valid(entity, step, drop) {
            return false;
        }
        let Ok(body) = self.spatial_actor_body(entity) else {
            return false;
        };
        if let Err(error) = self.physics.set_character_traversal(body, step, drop) {
            self.last_error = Some(error.into());
            return false;
        }
        self.release_spatial_actor();
        self.controlled_spatial_actor = Some(entity);
        true
    }

    pub(in crate::engine) fn release_spatial_actor(&mut self) {
        self.actor_navigation.cancel();
        if let Some(entity) = self.controlled_spatial_actor.take() {
            if let Ok(body) = self.spatial_actor_body(entity) {
                if let Err(error) = self.physics.set_character_ground_velocity(body, [0.; 3]) {
                    self.last_error = Some(error.into());
                }
            }
        }
    }

    /// Called before the shared fixed tick. A bound spatial actor never runs the
    /// old height/AABB movement controller, even if its native binding was removed.
    pub(in crate::engine) fn prepare_spatial_actor_input(
        &mut self,
        scene: &SpatialScene,
        input: InputState,
        dt: f32,
    ) {
        let Some((entity, speed, _, _)) = scene.actor else {
            self.release_spatial_actor();
            return;
        };
        let Ok(body) = self.spatial_actor_body(entity) else {
            self.actor_navigation.cancel();
            return;
        };
        let pose = match self.physics.body_state(body) {
            Ok(s) => s.pose,
            Err(_) => return,
        };
        let (velocity, following) = self.actor_navigation.intent(entity, pose, input, dt);
        let velocity = if following {
            velocity
        } else {
            let x = f32::from(input.d) - f32::from(input.a);
            let z = f32::from(input.w) - f32::from(input.s);
            let length = x.hypot(z).max(1.);
            [x * speed / length, 0., z * speed / length]
        };
        // Preserve a queued jump from bulk native input; actor control owns only
        // ground velocity. The actual controller consumes jump once per fixed tick.
        if let Err(error) = self.physics.set_character_ground_velocity(body, velocity) {
            self.last_error = Some(error.into());
        }
    }

    pub(super) fn finish_spatial_actor(&mut self, scene: &SpatialScene, world: &mut World) {
        let Some((entity, _, _, _)) = scene.actor else {
            return;
        };
        let Ok(body) = self.spatial_actor_body(entity) else {
            self.actor_navigation.cancel();
            return;
        };
        let (Ok(state), Ok(character)) = (
            self.physics.body_state(body),
            self.physics.character_state(body),
        ) else {
            return;
        };
        let surface = character
            .ground
            .and_then(|g| self.terrain.source(g.collider))
            .and_then(|source| {
                if let super::UnifiedTerrainSource::SpatialSurface { id } = source {
                    scene.surfaces.iter().find(|s| s.id == id)
                } else {
                    None
                }
            });
        if let (Some(surface), Some(mut span)) = (surface, world.height_span(entity)) {
            span.floor = PhysicsFloorId(surface.floor);
            world.set_height_span(entity, span);
        }
        self.actor_navigation.observe(
            entity,
            state.pose,
            character.grounded,
            surface.map(|s| s.id),
            navigation::MotionProgress::TowardWaypoint,
        );
    }

    pub(in crate::engine) fn cancel_spatial_actor_navigation(&mut self) -> bool {
        let actor = self.actor_navigation.actor();
        let cancelled = self.actor_navigation.cancel();
        if let Some(body) = actor.and_then(|a| self.spatial_actor_body(a).ok()) {
            if let Err(error) = self.physics.set_character_ground_velocity(body, [0.; 3]) {
                self.last_error = Some(error.into());
            }
        }
        cancelled
    }

    pub(in crate::engine) fn spatial_actor_animation_target(&self) -> Option<Transform2D> {
        let actor = self.actor_navigation.actor()?;
        let offset = self
            .bindings
            .get(&(actor.id, actor.generation))?
            .render_offset;
        self.actor_navigation.target().map(|p| Transform2D {
            x: p.position[0] + offset[0],
            y: -p.position[2] - offset[2],
        })
    }
    pub(in crate::engine) fn spatial_actor_animation_ended(&self) -> bool {
        matches!(
            self.actor_navigation.status,
            SpatialMoveStatus::Arrived | SpatialMoveStatus::Blocked
        )
    }
}

impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn validate_file_controller(
        &self,
        _scene: &SpatialScene,
        budget: &mut crate::engine::file_controller_admission::Budget,
    ) -> crate::engine::file_controller_admission::Result {
        budget.work(2)?; // Opaque controlled_spatial_actor is allowed to be stale.
        self.actor_navigation.validate_file_controller(budget)
    }
}

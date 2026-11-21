//! Cold-path per-entity automatic-controller authoring; simulation stays in Rust.
use super::*;
use crate::components::{CollisionMask, CompoundColliderShapeRef, RigidBodyType};
use crate::physics::Hd2dKinematicControllerConfig;
use crate::world::World;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct ControllerSettings {
    solid_mask: u32,
    iterations: u32,
    step: f32,
    drop: f32,
    ledge: bool,
}

impl ControllerSettings {
    pub(super) fn config(&self) -> Hd2dKinematicControllerConfig {
        Hd2dKinematicControllerConfig::new(
            CollisionMask::from_bits(self.solid_mask),
            self.iterations,
        )
        .with_step_height(self.step)
        .with_drop_height(self.drop)
        .with_ledge_drop(self.ledge)
    }
}

pub(super) fn default_config() -> Hd2dKinematicControllerConfig {
    Hd2dKinematicControllerConfig::new(CollisionMask::ALL, 4)
}

pub(super) fn component_source_supported(world: &World, entity: Entity) -> bool {
    if !world
        .rigid_body(entity)
        .is_some_and(|b| b.enabled && b.body_type == RigidBodyType::Kinematic)
    {
        return false;
    }
    convex_source_supported(world, entity)
}

pub(super) fn convex_source_supported(world: &World, entity: Entity) -> bool {
    convex_source_supported_with_triggers(world, entity, false)
}

pub(super) fn shooter_source_supported(world: &World, entity: Entity) -> bool {
    if world
        .rigid_body(entity)
        .is_some_and(|b| !b.enabled || b.body_type != RigidBodyType::Kinematic)
    {
        return false;
    }
    convex_source_supported_with_triggers(world, entity, true)
}

fn convex_source_supported_with_triggers(
    world: &World,
    entity: Entity,
    include_triggers: bool,
) -> bool {
    let mut solid = false;
    for index in 0..world.compound_collider_count(entity) {
        let Some(source) = world.compound_collider_ref_at(entity.id as usize, index) else {
            return false;
        };
        if !source.enabled() || (!include_triggers && source.is_trigger()) {
            continue;
        }
        if matches!(
            source.shape,
            CompoundColliderShapeRef::Edge(_) | CompoundColliderShapeRef::Chain(_)
        ) {
            return false;
        }
        solid = true;
    }
    solid
}

#[wasm_bindgen]
impl Engine {
    /// Replaces one component body's automatic controller settings; reset restores defaults.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_kinematic_controller(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        reset: bool,
        solid_mask: u32,
        max_iterations: u32,
        max_step_height: f32,
        max_drop_height: f32,
        allow_ledge_drop: bool,
    ) -> bool {
        if self.scene_mode != SceneMode::Data
            || !(1..=8).contains(&max_iterations)
            || ![max_step_height, max_drop_height]
                .into_iter()
                .all(|v| v.is_finite() && (0. ..=65536.).contains(&v))
        {
            return false;
        }
        let entity = Entity {
            id: entity_id,
            generation: entity_generation,
        };
        let Some(runtime) = &mut self.unified_physics else {
            return false;
        };
        if runtime.physics.config().space != Space::PlanarXy
            || !self.world.is_current_entity(entity)
            || self.world.rigid_body(entity).is_none()
            || runtime
                .bindings
                .get(&(entity.id, entity.generation))
                .is_some_and(|b| b.legacy.is_none())
        {
            return false;
        }
        if reset {
            runtime
                .automatic_planar
                .settings
                .remove(&(entity.id, entity.generation));
            return true;
        }
        if !component_source_supported(&self.world, entity) {
            return false;
        }
        let accepted = (|| {
            runtime.prepare_query(
                &mut self.world,
                self.auto_rigid_body_step_config,
                &self.tilemap,
                &self.spatial_scene,
            )?;
            let body = runtime
                .bindings
                .get(&(entity.id, entity.generation))
                .filter(|b| b.legacy.is_some())
                .ok_or(UnifiedPhysicsError::BodyOwnershipConflict)?
                .body;
            runtime.physics.validate_planar_controller_source(body)?;
            Ok::<_, UnifiedPhysicsError>(())
        })();
        if accepted.is_err() {
            return false;
        }
        runtime.automatic_planar.settings.insert(
            (entity.id, entity.generation),
            ControllerSettings {
                solid_mask,
                iterations: max_iterations,
                step: max_step_height,
                drop: max_drop_height,
                ledge: allow_ledge_drop,
            },
        );
        true
    }
}

#[allow(dead_code)]
mod file_admission;

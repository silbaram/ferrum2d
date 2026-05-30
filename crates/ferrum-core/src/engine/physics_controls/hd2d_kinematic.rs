use wasm_bindgen::prelude::*;

use crate::components::{CollisionMask, Velocity};
use crate::physics::{Hd2dKinematicControllerConfig, Hd2dKinematicMoveResult, PhysicsSystem};

use super::super::Engine;

const HD2D_KINEMATIC_STEPPED_UP: u32 = 1 << 0;
const HD2D_KINEMATIC_STEPPED_DOWN: u32 = 1 << 1;
const HD2D_KINEMATIC_CHANGED_FLOOR: u32 = 1 << 2;
const HD2D_KINEMATIC_PASSED_UNDER_BRIDGE: u32 = 1 << 3;
const HD2D_KINEMATIC_BLOCKED_BY_STEP: u32 = 1 << 4;
const HD2D_KINEMATIC_BLOCKED_BY_DROP: u32 = 1 << 5;
const HD2D_KINEMATIC_BLOCKED_X: u32 = 1 << 6;
const HD2D_KINEMATIC_BLOCKED_Y: u32 = 1 << 7;

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn move_hd2d_kinematic_body_with_tilemap(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        displacement_x: f32,
        displacement_y: f32,
        solid_mask_bits: u32,
        max_iterations: u32,
        max_step_height: f32,
        max_drop_height: f32,
        allow_ledge_drop: bool,
    ) -> bool {
        if !Self::valid_transform(displacement_x, displacement_y) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        if self.world.rigid_body(entity).is_none() || self.world.collider(entity).is_none() {
            return false;
        }
        let result = PhysicsSystem::move_hd2d_kinematic_with_tilemap_and_counters(
            &mut self.world,
            &self.tilemap,
            entity,
            Velocity {
                vx: displacement_x,
                vy: displacement_y,
            },
            Hd2dKinematicControllerConfig::new(
                CollisionMask::from_bits(solid_mask_bits),
                max_iterations,
            )
            .with_step_height(max_step_height)
            .with_drop_height(max_drop_height)
            .with_ledge_drop(allow_ledge_drop),
            Some(&mut self.physics_counters),
        );
        self.store_hd2d_kinematic_result(result);
        self.store_physics_entity_snapshot(entity)
    }

    pub fn hd2d_kinematic_elevation_delta(&self) -> f32 {
        self.hd2d_kinematic_elevation_delta
    }

    pub fn hd2d_kinematic_hit_count(&self) -> u32 {
        self.hd2d_kinematic_hit_count
    }

    pub fn hd2d_kinematic_flags(&self) -> u32 {
        self.hd2d_kinematic_flags
    }
}

impl Engine {
    fn store_hd2d_kinematic_result(&mut self, result: Hd2dKinematicMoveResult) {
        self.hd2d_kinematic_elevation_delta = result.elevation_delta;
        self.hd2d_kinematic_hit_count = result.movement.hit_count;
        self.hd2d_kinematic_flags = hd2d_kinematic_flags(result);
    }
}

fn hd2d_kinematic_flags(result: Hd2dKinematicMoveResult) -> u32 {
    flag(result.stepped_up, HD2D_KINEMATIC_STEPPED_UP)
        | flag(result.stepped_down, HD2D_KINEMATIC_STEPPED_DOWN)
        | flag(result.changed_floor, HD2D_KINEMATIC_CHANGED_FLOOR)
        | flag(
            result.passed_under_bridge,
            HD2D_KINEMATIC_PASSED_UNDER_BRIDGE,
        )
        | flag(result.blocked_by_step, HD2D_KINEMATIC_BLOCKED_BY_STEP)
        | flag(result.blocked_by_drop, HD2D_KINEMATIC_BLOCKED_BY_DROP)
        | flag(result.movement.blocked_x, HD2D_KINEMATIC_BLOCKED_X)
        | flag(result.movement.blocked_y, HD2D_KINEMATIC_BLOCKED_Y)
}

const fn flag(enabled: bool, bit: u32) -> u32 {
    if enabled {
        bit
    } else {
        0
    }
}

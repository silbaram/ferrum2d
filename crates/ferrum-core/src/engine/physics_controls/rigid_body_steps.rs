use wasm_bindgen::prelude::*;

use crate::components::Velocity;
use crate::physics::{PhysicsSystem, RigidBodyStepConfig, RigidBodyStepStats};

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn step_rigid_bodies(&mut self, delta_seconds: f32) {
        self.rigid_body_step_stats = PhysicsSystem::step_rigid_bodies_with_config_and_scratch(
            &mut self.world,
            delta_seconds,
            RigidBodyStepConfig::default(),
            &mut self.rigid_body_step_scratch,
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn configure_auto_rigid_body_step(
        &mut self,
        enabled: bool,
        gravity_x: f32,
        gravity_y: f32,
        velocity_iterations: u32,
        position_iterations: u32,
        position_correction_percent: f32,
        position_correction_slop: f32,
        restitution_velocity_threshold: f32,
        contact_baumgarte_bias_factor: f32,
        max_contact_baumgarte_bias_velocity: f32,
        contact_split_impulse: bool,
    ) {
        self.auto_rigid_body_step_enabled = enabled;
        self.auto_rigid_body_step_config = RigidBodyStepConfig {
            gravity: Velocity {
                vx: gravity_x,
                vy: gravity_y,
            },
            velocity_iterations,
            position_iterations,
            position_correction_percent,
            position_correction_slop,
            restitution_velocity_threshold,
            contact_baumgarte_bias_factor,
            max_contact_baumgarte_bias_velocity,
            contact_split_impulse,
        };
        if !enabled {
            self.rigid_body_step_stats = RigidBodyStepStats::default();
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn step_rigid_bodies_with_config(
        &mut self,
        delta_seconds: f32,
        gravity_x: f32,
        gravity_y: f32,
        velocity_iterations: u32,
        position_iterations: u32,
        position_correction_percent: f32,
        position_correction_slop: f32,
        restitution_velocity_threshold: f32,
        contact_baumgarte_bias_factor: f32,
        max_contact_baumgarte_bias_velocity: f32,
        contact_split_impulse: bool,
    ) {
        self.rigid_body_step_stats = PhysicsSystem::step_rigid_bodies_with_config_and_scratch(
            &mut self.world,
            delta_seconds,
            RigidBodyStepConfig {
                gravity: Velocity {
                    vx: gravity_x,
                    vy: gravity_y,
                },
                velocity_iterations,
                position_iterations,
                position_correction_percent,
                position_correction_slop,
                restitution_velocity_threshold,
                contact_baumgarte_bias_factor,
                max_contact_baumgarte_bias_velocity,
                contact_split_impulse,
            },
            &mut self.rigid_body_step_scratch,
        );
    }
}

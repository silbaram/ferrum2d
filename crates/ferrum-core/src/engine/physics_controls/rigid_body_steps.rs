use wasm_bindgen::prelude::*;

use crate::components::Velocity;
use crate::physics::{PhysicsSystem, RigidBodyStepConfig, RigidBodyStepStats};

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    /// Toggles stepping without replacing the configured native solver settings.
    pub fn set_auto_rigid_body_step_enabled(&mut self, enabled: bool) {
        self.auto_rigid_body_step_enabled = enabled;
        if !enabled {
            self.rigid_body_step_stats = RigidBodyStepStats::default();
            self.clear_rigid_body_frame_stats();
        }
    }

    /// True when the next `update` advances rigid bodies by itself: automatic
    /// stepping is enabled and the active scene is not frozen. A manual
    /// `step_rigid_bodies` in the same frame then runs a second solver step.
    pub fn auto_rigid_body_step_active(&self) -> bool {
        self.auto_rigid_body_step_enabled && !self.active_scene_game_state().freezes_simulation()
    }

    pub fn step_rigid_bodies(&mut self, delta_seconds: f32) {
        if self.step_unified_manually(delta_seconds, None) {
            return;
        }
        let stats = PhysicsSystem::step_rigid_bodies_with_config_and_scratch(
            &mut self.world,
            delta_seconds,
            RigidBodyStepConfig::default(),
            &mut self.rigid_body_step_scratch,
        );
        self.process_physics_impact_feedback(delta_seconds);
        self.record_rigid_body_step_stats(stats);
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
        continuous: bool,
    ) {
        let config = RigidBodyStepConfig {
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
            continuous,
        };
        if !self.accept_unified_auto_config(config) {
            return;
        }
        self.auto_rigid_body_step_enabled = enabled;
        self.auto_rigid_body_step_config = config;
        if !enabled {
            self.rigid_body_step_stats = RigidBodyStepStats::default();
            self.clear_rigid_body_frame_stats();
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
        continuous: bool,
    ) {
        let config = RigidBodyStepConfig {
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
            continuous,
        };
        if self.step_unified_manually(delta_seconds, Some(config)) {
            return;
        }
        let stats = PhysicsSystem::step_rigid_bodies_with_config_and_scratch(
            &mut self.world,
            delta_seconds,
            config,
            &mut self.rigid_body_step_scratch,
        );
        self.process_physics_impact_feedback(delta_seconds);
        self.record_rigid_body_step_stats(stats);
    }
}

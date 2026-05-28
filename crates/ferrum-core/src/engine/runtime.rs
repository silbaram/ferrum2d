use wasm_bindgen::prelude::*;

use crate::collision::{CollisionSystem, PhysicsDebugLine};
use crate::components::Transform2D;
use crate::input::InputState;
use crate::physics::{
    FixedTimestep, FixedTimestepConfig, FixedTimestepUpdate, PhysicsSystem, RigidBodyStepStats,
};

use super::physics_bridge::{
    PhysicsBodyColliderSnapshot, PhysicsEntitySnapshot, PhysicsJointSnapshot,
};
use super::{Engine, TILEMAP_NAVIGATION_DEBUG_COLOR};

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn set_input(
        &mut self,
        w: bool,
        a: bool,
        s: bool,
        d: bool,
        space: bool,
        enter: bool,
        mouse_left: bool,
        mouse_x: f32,
        mouse_y: f32,
    ) {
        let input = InputState {
            w: u8::from(w),
            a: u8::from(a),
            s: u8::from(s),
            d: u8::from(d),
            space: u8::from(space),
            enter: u8::from(enter),
            mouse_left: u8::from(mouse_left),
            mouse_x,
            mouse_y,
        };
        self.observe_input_sample(input);
        self.input = input;
    }

    pub fn update(&mut self, delta: f64) {
        self.elapsed_seconds += delta;
        self.clear_physics_frame();
        if self.fixed_timestep_enabled {
            let update = self.fixed_timestep.advance(delta as f32);
            self.last_fixed_update = update;
            self.physics_counters.record_fixed_update(update);
            let step_seconds = self.fixed_timestep.config().step_seconds;
            for step_index in 0..update.steps {
                let input = self.fixed_step_input(step_index == 0);
                self.tweens.update(&mut self.world, step_seconds);
                self.update_scene(step_seconds, input);
                self.step_auto_rigid_bodies(step_seconds);
                if step_index == 0 {
                    self.fixed_timestep_input_latch.clear();
                }
                self.record_collision_events();
            }
        } else {
            self.last_fixed_update = FixedTimestepUpdate::default();
            self.tweens.update(&mut self.world, delta as f32);
            self.update_scene(delta as f32, self.input);
            self.step_auto_rigid_bodies(delta as f32);
            self.record_collision_events();
        }
        self.particles.update(delta as f32);
        self.build_physics_debug_lines();
        self.build_render_commands();
    }

    pub fn configure_fixed_timestep(
        &mut self,
        enabled: bool,
        step_seconds: f32,
        max_frame_seconds: f32,
        max_steps_per_update: u32,
    ) {
        let was_enabled = self.fixed_timestep_enabled;
        self.fixed_timestep_enabled = enabled;
        self.fixed_timestep = FixedTimestep::new(FixedTimestepConfig {
            step_seconds,
            max_frame_seconds,
            max_steps_per_update,
        });
        self.last_fixed_update = FixedTimestepUpdate::default();
        if !enabled || !was_enabled {
            self.fixed_timestep_input_latch.clear();
            self.previous_input_sample = self.input;
        }
    }

    pub fn clear_events(&mut self) {
        self.clear_audio_events();
    }

    pub fn clear_audio_events(&mut self) {
        self.audio_events.clear();
    }

    pub fn reset_game(&mut self) {
        self.reset_active_scene_game();
        self.particles.clear();
        self.tweens.clear();
        self.clear_physics_history();
    }
}

impl Engine {
    fn clear_physics_frame(&mut self) {
        self.physics_counters.clear();
        self.collision_events.clear();
        self.collision_event_counts.clear();
        self.physics_debug_lines.clear();
        self.world.clear_rigid_body_ccd_debug_hits();
    }

    pub(super) fn clear_physics_history(&mut self) {
        self.collision_event_tracker.clear();
        self.collision_events.clear();
        self.collision_event_counts.clear();
        self.physics_debug_lines.clear();
        self.world.clear_rigid_body_ccd_debug_hits();
        self.fixed_timestep.reset();
        self.rigid_body_step_stats = RigidBodyStepStats::default();
        self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
        self.physics_body_collider_snapshot = PhysicsBodyColliderSnapshot::default();
        self.physics_joint_snapshot = PhysicsJointSnapshot::default();
        self.last_fixed_update = FixedTimestepUpdate::default();
        self.fixed_timestep_input_latch.clear();
        self.previous_input_sample = self.input;
    }

    fn step_auto_rigid_bodies(&mut self, delta_seconds: f32) {
        if !self.auto_rigid_body_step_enabled {
            return;
        }
        self.rigid_body_step_stats = PhysicsSystem::step_rigid_bodies_with_config_and_scratch(
            &mut self.world,
            delta_seconds,
            self.auto_rigid_body_step_config,
            &mut self.rigid_body_step_scratch,
        );
    }

    fn record_collision_events(&mut self) {
        let counts = self
            .collision_event_tracker
            .update(&self.world, &mut self.collision_events);
        let pair_counts = self.collision_event_tracker.current_pair_counts();
        self.physics_counters.collision_pairs = self
            .physics_counters
            .collision_pairs
            .saturating_add(pair_counts.total);
        self.physics_counters.collision_solid_pairs = self
            .physics_counters
            .collision_solid_pairs
            .saturating_add(pair_counts.solid);
        self.physics_counters.collision_trigger_pairs = self
            .physics_counters
            .collision_trigger_pairs
            .saturating_add(pair_counts.trigger);
        self.collision_event_counts.add(counts);
    }

    pub(super) fn build_physics_debug_lines(&mut self) {
        if !self.physics_debug_lines_enabled || self.physics_debug_line_flags == 0 {
            self.physics_debug_lines.clear();
            return;
        }
        CollisionSystem::build_physics_debug_lines_with_flags_into(
            &self.world,
            16.0,
            self.physics_debug_line_flags,
            &mut self.physics_debug_lines,
        );
    }

    pub(super) fn store_tilemap_navigation_path(
        tilemap_navigation_path_points: &mut Vec<f32>,
        tilemap_navigation_debug_lines: &mut Vec<PhysicsDebugLine>,
        from: Transform2D,
        path: &[Transform2D],
    ) -> (Transform2D, f32) {
        tilemap_navigation_path_points.clear();
        tilemap_navigation_debug_lines.clear();

        let mut previous = from;
        let mut distance = 0.0;
        for point in path.iter().copied() {
            tilemap_navigation_path_points.push(point.x);
            tilemap_navigation_path_points.push(point.y);
            distance += ((point.x - previous.x).powi(2) + (point.y - previous.y).powi(2)).sqrt();
            tilemap_navigation_debug_lines.push(PhysicsDebugLine {
                x0: previous.x,
                y0: previous.y,
                x1: point.x,
                y1: point.y,
                r: TILEMAP_NAVIGATION_DEBUG_COLOR[0],
                g: TILEMAP_NAVIGATION_DEBUG_COLOR[1],
                b: TILEMAP_NAVIGATION_DEBUG_COLOR[2],
                a: TILEMAP_NAVIGATION_DEBUG_COLOR[3],
            });
            previous = point;
        }

        (path.first().copied().unwrap_or(from), distance)
    }

    fn observe_input_sample(&mut self, input: InputState) {
        if self.fixed_timestep_enabled {
            self.fixed_timestep_input_latch
                .observe(self.previous_input_sample, input);
        }
        self.previous_input_sample = input;
    }

    fn fixed_step_input(&self, is_first_step: bool) -> InputState {
        if is_first_step {
            self.fixed_timestep_input_latch.apply_to(self.input)
        } else {
            self.input
        }
    }
}

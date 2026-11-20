use wasm_bindgen::prelude::*;

use crate::collision::{CollisionSystem, PhysicsDebugLine};
use crate::components::gameplay::BehaviorStateEnterActionPhase;
use crate::components::{HeightSpan, PhysicsFloorId, Transform2D};
use crate::entity::Entity;
use crate::gameplay::{
    action_failure_gameplay_event, apply_behavior_state_machine_events,
    apply_gameplay_variable_mutation_events, tick_gameplay_timer_triggers,
};
use crate::gameplay_event::GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED;
use crate::input::InputState;
use crate::physics::{FixedTimestepUpdate, PhysicsSystem, RigidBodyStepStats};
use crate::tilemap::TilemapNavigationPathPoint;

use super::physics_bridge::{
    PhysicsBodyColliderSnapshot, PhysicsEntitySnapshot, PhysicsJointSnapshot,
};
use super::scenes::SceneMode;
use super::{Engine, TILEMAP_NAVIGATION_DEBUG_COLOR, TILEMAP_NAVIGATION_PATH_POINT_FLOATS};
mod actual_motion;

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
        self.update_frame(delta, true, true, true);
    }

    /// SDK frame entry: Rust/Wasm borrows unwind normally before an Err is
    /// converted to a JavaScript exception by wasm-bindgen's Result wrapper.
    pub fn update_frame_checked(
        &mut self,
        delta: f64,
        render_commands: bool,
        frame_telemetry: bool,
        physics_debug_lines: bool,
    ) -> Result<(), String> {
        self.reset_native_motion_attempt();
        self.update_frame(delta, render_commands, frame_telemetry, physics_debug_lines);
        self.checked_actual_native_motion()
    }

    /// Checked manual entry, retaining the original raw void ABI.
    pub fn step_rigid_bodies_checked(&mut self, delta_seconds: f32) -> Result<(), String> {
        self.reset_native_motion_attempt();
        self.step_rigid_bodies(delta_seconds);
        self.checked_actual_native_motion()
    }

    /// Checked one-shot manual configuration, with the original argument order.
    #[allow(clippy::too_many_arguments)]
    pub fn step_rigid_bodies_with_config_checked(
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
    ) -> Result<(), String> {
        self.reset_native_motion_attempt();
        self.step_rigid_bodies_with_config(
            delta_seconds,
            gravity_x,
            gravity_y,
            velocity_iterations,
            position_iterations,
            position_correction_percent,
            position_correction_slop,
            restitution_velocity_threshold,
            contact_baumgarte_bias_factor,
            max_contact_baumgarte_bias_velocity,
            contact_split_impulse,
            continuous,
        );
        self.checked_actual_native_motion()
    }

    pub fn update_frame(
        &mut self,
        delta: f64,
        render_commands: bool,
        frame_telemetry: bool,
        physics_debug_lines: bool,
    ) {
        let variable = match self.variable_native_frame_plan(delta) {
            Ok(plan) => plan,
            Err(_) => return,
        };
        let camera_delta = match self.advance_simulation(delta, variable) {
            Ok(consumed) => consumed,
            Err(_) => return,
        };
        self.spatial_scene
            .attachments
            .prepare_render_poses(&mut self.world, &self.spatial_scene.models);
        self.update_data_scene_camera(camera_delta);
        if render_commands {
            self.build_render_commands();
        } else {
            self.frame_buffers.clear_render_commands();
            self.spatial_scene.frame_active = false;
            self.spatial_scene.billboards.clear();
            self.spatial_scene.terrain_draw_ranges.clear();
            self.spatial_scene.debug.clear_frame();
        }
        // Select the existing flat or XYZ destination after the spatial frame is
        // known. Native geometry is extracted once, never drawn in both passes.
        if !self.build_unified_physics_debug_lines(physics_debug_lines) {
            if physics_debug_lines {
                self.build_physics_debug_lines();
            } else {
                self.frame_buffers.clear_physics_debug_lines();
            }
        }
        if frame_telemetry {
            self.write_frame_telemetry();
        }
    }

    fn advance_simulation(
        &mut self,
        delta: f64,
        variable: Option<super::unified_physics::variable_clock::VariableFramePlan>,
    ) -> Result<f32, super::unified_physics::UnifiedPhysicsError> {
        if let Some(plan) = variable {
            return self.advance_variable_native_simulation(plan);
        }
        if self.unified_physics.is_some() && self.fixed_timestep_enabled {
            return self.advance_fixed_native_simulation(delta);
        }
        self.elapsed_seconds += delta;
        self.begin_simulation_frame();
        if self.active_scene_game_state().freezes_simulation() {
            self.world.reset_render_interpolation();
            self.last_fixed_update = FixedTimestepUpdate::default();
            self.fixed_timestep_input_latch.clear();
            self.previous_input_sample = self.input;
            self.data_scene.gameplay.observe_input(self.input);
            return Ok(delta as f32);
        }
        // Seed before simulation moves any bound light, after the paused-state guard.
        // Render-only or paused rebuilds must leave a reset history uninitialized.
        self.spatial_scene.advance_light_selection(&self.world, 0.);
        self.data_scene.gameplay.combat.begin_frame();
        if self.fixed_timestep_enabled {
            let update = self.fixed_timestep.advance(delta as f32);
            self.last_fixed_update = update;
            self.physics_counters.record_fixed_update(update);
            let step_seconds = self.fixed_timestep.config().step_seconds;
            for step_index in 0..update.steps {
                if self.render_interpolation_enabled {
                    self.world.begin_render_interpolation_step();
                }
                let input = self.fixed_step_input(step_index == 0);
                let latched_presses = if step_index == 0 {
                    self.fixed_timestep_input_latch
                        .apply_to(InputState::default())
                } else {
                    InputState::default()
                };
                self.tweens.update(&mut self.world, step_seconds);
                self.update_scene(step_seconds, input, latched_presses);
                self.step_auto_rigid_bodies(step_seconds);
                if step_index == 0 {
                    self.fixed_timestep_input_latch.clear();
                }
                self.record_collision_lifecycle_events();
                self.update_data_scene_gameplay(input, latched_presses, step_seconds);
                self.spatial_scene
                    .advance_light_selection(&self.world, step_seconds);
                if self.render_interpolation_enabled {
                    self.world.end_render_interpolation_step();
                }
            }
            if self.render_interpolation_enabled {
                self.world
                    .set_render_interpolation_alpha(Some(update.alpha));
            }
            if !self.active_scene_ticks_gameplay_timers() {
                tick_gameplay_timer_triggers(
                    &mut self.world,
                    update.consumed_seconds,
                    &mut self.frame_buffers.gameplay_events,
                );
            }
        } else {
            self.last_fixed_update = FixedTimestepUpdate::default();
            self.tweens.update(&mut self.world, delta as f32);
            self.update_scene(delta as f32, self.input, InputState::default());
            self.step_auto_rigid_bodies(delta as f32);
            self.record_collision_lifecycle_events();
            self.update_data_scene_gameplay(self.input, InputState::default(), delta as f32);
            self.spatial_scene
                .advance_light_selection(&self.world, delta as f32);
            if !self.active_scene_ticks_gameplay_timers() {
                tick_gameplay_timer_triggers(
                    &mut self.world,
                    delta as f32,
                    &mut self.frame_buffers.gameplay_events,
                );
            }
        }
        self.finish_simulation_frame(delta as f32);
        Ok(delta as f32)
    }

    fn begin_simulation_frame(&mut self) {
        self.impact_feedback.begin_frame();
        self.clear_physics_frame();
        self.world.set_render_interpolation_alpha(None);
        self.world
            .clear_retired_gameplay_variable_mutation_triggers();
        self.reset_active_scene_action_trigger_frame_diagnostics();
    }

    fn finish_simulation_frame(&mut self, delta: f32) {
        let behavior_event_start = self.frame_buffers.gameplay_events.len();
        apply_gameplay_variable_mutation_events(
            &mut self.world,
            &self.frame_buffers.gameplay_events,
        );
        apply_behavior_state_machine_events(
            &mut self.world,
            &mut self.frame_buffers.gameplay_events,
        );
        self.queue_behavior_state_enter_actions(behavior_event_start);
        self.particles.update(delta);
    }

    pub(in crate::engine) fn advance_variable_native_simulation(
        &mut self,
        plan: super::unified_physics::variable_clock::VariableFramePlan,
    ) -> Result<f32, super::unified_physics::UnifiedPhysicsError> {
        if plan.steps == 0 {
            // A render-only frame still owns fresh output buffers and counters.
            self.impact_feedback.begin_frame();
            self.clear_physics_frame();
            self.last_fixed_update = FixedTimestepUpdate::default();
            return Ok(0.0);
        }
        if self.active_scene_game_state().freezes_simulation() {
            self.elapsed_seconds += f64::from(plan.update.consumed_seconds);
            self.begin_simulation_frame();
            self.world.reset_render_interpolation();
            self.last_fixed_update = FixedTimestepUpdate::default();
            self.fixed_timestep_input_latch.clear();
            self.previous_input_sample = self.input;
            self.data_scene.gameplay.observe_input(self.input);
            return Ok(plan.update.consumed_seconds);
        }
        let mut completed = 0;
        let mut partial = 0.;
        let mut motion_error = None;
        for step_index in 0..plan.steps {
            let result = self
                .with_unified_frame_interval(plan.interval, |engine| {
                    // Do not clear frame outputs or advance any clock until the first
                    // interval admission succeeds. A rejected frame remains atomic.
                    if step_index == 0 {
                        engine.begin_simulation_frame();
                        engine
                            .spatial_scene
                            .advance_light_selection(&engine.world, 0.);
                        engine.data_scene.gameplay.combat.begin_frame();
                    }
                    let elapsed_before = engine.elapsed_seconds;
                    engine.reset_native_motion_attempt();
                    engine.elapsed_seconds += f64::from(plan.interval);
                    let input = engine.fixed_step_input(step_index == 0);
                    let presses = if step_index == 0 {
                        engine
                            .fixed_timestep_input_latch
                            .apply_to(InputState::default())
                    } else {
                        InputState::default()
                    };
                    engine.tweens.update(&mut engine.world, plan.interval);
                    engine.update_scene(plan.interval, input, presses);
                    engine.step_auto_rigid_bodies(plan.interval);
                    if let Some(error) = engine.actual_native_motion_failure() {
                        partial = engine
                            .actual_native_committed_seconds()
                            .clamp(0., plan.interval);
                        motion_error = Some(error);
                        if step_index == 0 && partial > 0. {
                            engine.fixed_timestep_input_latch.clear();
                        }
                        engine.elapsed_seconds = elapsed_before;
                        return Err(error);
                    }
                    if step_index == 0 {
                        engine.fixed_timestep_input_latch.clear();
                    }
                    engine.record_collision_lifecycle_events();
                    engine.update_data_scene_gameplay(input, presses, plan.interval);
                    engine
                        .spatial_scene
                        .advance_light_selection(&engine.world, plan.interval);
                    if !engine.active_scene_ticks_gameplay_timers() {
                        tick_gameplay_timer_triggers(
                            &mut engine.world,
                            plan.interval,
                            &mut engine.frame_buffers.gameplay_events,
                        );
                    }
                    Ok(())
                })
                .and_then(|result| result);
            match result {
                Ok(()) => completed += 1,
                Err(error) => {
                    if completed == 0 && motion_error.is_none() {
                        return Err(error);
                    }
                    break;
                }
            }
        }
        let consumed = plan.interval * completed as f32 + partial;
        let update = FixedTimestepUpdate {
            steps: completed + u32::from(partial > 0.),
            alpha: 0.0,
            consumed_seconds: consumed,
            dropped_seconds: plan.update.dropped_seconds
                + plan.interval * (plan.steps - completed) as f32
                - partial,
        };
        self.last_fixed_update = update;
        self.physics_counters.record_fixed_update(update);
        if let Some(error) = motion_error {
            self.world.reset_render_interpolation();
            return Err(error);
        }
        self.finish_simulation_frame(consumed);
        Ok(consumed)
    }

    /// Render-only interpolation of native rigid-body poses. Simulation and replay stay unchanged.
    pub fn configure_physics_render_interpolation(&mut self, enabled: bool) {
        self.render_interpolation_enabled = enabled;
        self.world.reset_render_interpolation();
    }

    pub fn configure_fixed_timestep(
        &mut self,
        enabled: bool,
        step_seconds: f32,
        max_frame_seconds: f32,
        max_steps_per_update: u32,
    ) {
        if self.unified_physics.is_some() {
            self.configure_unified_physics_clock(
                enabled,
                step_seconds,
                max_frame_seconds,
                max_steps_per_update,
            );
            return;
        }
        self.apply_fixed_timestep_config(
            enabled,
            step_seconds,
            max_frame_seconds,
            max_steps_per_update,
        );
    }

    pub fn clear_events(&mut self) {
        self.clear_audio_events();
        self.clear_gameplay_events();
        self.clear_effect_events();
    }

    pub fn clear_audio_events(&mut self) {
        self.frame_buffers.clear_audio_events();
    }

    pub fn clear_gameplay_events(&mut self) {
        self.frame_buffers.clear_gameplay_events();
        if let Some(rt) = self.unified_physics.as_mut() {
            rt.contacts.terrain_events.clear();
            rt.contacts.terrain_dropped = 0;
        }
    }

    pub fn clear_effect_events(&mut self) {
        self.frame_buffers.clear_effect_events();
    }

    pub fn set_collision_lifecycle_events_enabled(&mut self, enabled: bool) {
        if self.collision_lifecycle_events_enabled != enabled {
            self.collision_event_tracker.clear();
            self.collision_lifecycle_events_enabled = enabled;
            self.reset_unified_collision_history();
        }
    }

    pub fn reset_game(&mut self) {
        self.reset_active_scene_game();
        self.reset_physics_impact_feedback();
        self.particles.clear();
        self.tweens.clear();
        self.clear_physics_history();
        if self.scene_mode == SceneMode::Data {
            self.clear_scene_output_buffers();
        }
    }
}

impl Engine {
    pub(super) fn clear_scene_output_buffers(&mut self) {
        self.reset_physics_impact_feedback();
        self.frame_buffers.clear_scene_output();
        self.spatial_scene.clear();
    }

    fn clear_physics_frame(&mut self) {
        self.begin_unified_collision_frame();
        self.begin_unified_statistics_frame();
        self.physics_counters.clear();
        self.frame_buffers.clear_physics_frame_output();
        if let Some(rt) = self.unified_physics.as_mut() {
            rt.contacts.terrain_events.clear();
            rt.contacts.terrain_dropped = 0;
        }
        self.collision_event_counts.clear();
        self.world.clear_rigid_body_ccd_debug_hits();
        self.clear_rigid_body_frame_stats();
    }

    pub(super) fn clear_physics_history(&mut self) {
        // Staged restores may allocate and clean up candidate bodies. Preserve
        // the live world's clock/events until the transaction commits.
        if self.physics_restore_transaction.is_some() {
            return;
        }
        self.collision_event_tracker.clear();
        self.begin_unified_collision_frame();
        self.begin_unified_statistics_frame();
        self.reset_unified_collision_history();
        self.frame_buffers.clear_physics_frame_output();
        if let Some(rt) = self.unified_physics.as_mut() {
            rt.contacts.terrain_events.clear();
            rt.contacts.terrain_dropped = 0;
        }
        self.collision_event_counts.clear();
        self.world.clear_rigid_body_ccd_debug_hits();
        self.fixed_timestep.reset();
        self.world.reset_render_interpolation();
        self.rigid_body_step_stats = RigidBodyStepStats::default();
        self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
        self.physics_body_collider_snapshot = PhysicsBodyColliderSnapshot::default();
        self.physics_joint_snapshot = PhysicsJointSnapshot::default();
        self.last_fixed_update = FixedTimestepUpdate::default();
        self.fixed_timestep_input_latch.clear();
        self.previous_input_sample = self.input;
        self.clear_rigid_body_frame_stats();
    }

    fn step_auto_rigid_bodies(&mut self, delta_seconds: f32) {
        if !self.auto_rigid_body_step_enabled || self.has_native_built_in() {
            return;
        }
        if self.step_unified_physics(delta_seconds) {
            return;
        }
        let stats = PhysicsSystem::step_rigid_bodies_with_config_and_scratch(
            &mut self.world,
            delta_seconds,
            self.auto_rigid_body_step_config,
            &mut self.rigid_body_step_scratch,
        );
        self.process_physics_impact_feedback(delta_seconds);
        self.record_rigid_body_step_stats(stats);
        self.spatial_scene
            .attachments
            .synchronize_or_restore(&mut self.world, &self.spatial_scene.models);
    }

    fn record_collision_lifecycle_events(&mut self) {
        let (counts, pair_counts) = if let Some(native) = self.flush_unified_collision_events() {
            native
        } else {
            if !self.collision_lifecycle_events_enabled {
                self.collision_event_tracker.clear();
                return;
            }
            let counts = self
                .collision_event_tracker
                .update(&self.world, &mut self.frame_buffers.collision_events);
            (counts, self.collision_event_tracker.current_pair_counts())
        };
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

    fn queue_behavior_state_enter_actions(&mut self, event_start: usize) {
        if self.scene_mode != SceneMode::BuiltIn
            || event_start >= self.frame_buffers.gameplay_events.len()
            || !self.world.has_behavior_state_enter_actions()
        {
            return;
        }

        let event_end = self.frame_buffers.gameplay_events.len();
        for event_index in event_start..event_end {
            let event = self.frame_buffers.gameplay_events[event_index];
            if event.kind != GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED {
                continue;
            }
            let source = Entity {
                id: event.source_id,
                generation: event.source_generation,
            };
            if !self.world.is_current_entity(source) {
                continue;
            }
            let Some(actions) = self.world.behavior_state_enter_actions(source) else {
                continue;
            };
            for action in actions.iter_for_state(event.token_id) {
                match action.phase {
                    BehaviorStateEnterActionPhase::NextFramePrePhysics => {
                        if let Some(Err(data)) = self
                            .scenes
                            .active_runtime_mut()
                            .queue_behavior_state_enter_action(source, action.action_id)
                        {
                            self.frame_buffers
                                .gameplay_events
                                .push(action_failure_gameplay_event(data));
                        }
                    }
                }
            }
        }
    }

    pub(super) fn build_physics_debug_lines(&mut self) {
        if self.build_unified_physics_debug_lines(true) {
            return;
        }
        self.frame_buffers.native_debug_state = [0; 4];
        if !self.physics_debug_lines_enabled || self.physics_debug_line_flags == 0 {
            self.frame_buffers.clear_physics_debug_lines();
            return;
        }
        CollisionSystem::build_physics_debug_lines_with_flags_and_scratch_into(
            &mut self.physics_debug_collision_scratch,
            &self.world,
            16.0,
            self.physics_debug_line_flags,
            &mut self.frame_buffers.physics_debug_lines,
        );
    }

    pub(super) fn store_tilemap_navigation_path(
        tilemap_navigation_path_points: &mut Vec<f32>,
        tilemap_navigation_debug_lines: &mut Vec<PhysicsDebugLine>,
        from: Transform2D,
        path: &[Transform2D],
    ) -> Option<(Transform2D, f32)> {
        Self::store_tilemap_navigation_path_with_height_span(
            tilemap_navigation_path_points,
            tilemap_navigation_debug_lines,
            from,
            path,
            HeightSpan {
                floor: PhysicsFloorId::DEFAULT,
                elevation: 0.0,
                height: 0.0,
            },
        )
    }

    pub(super) fn store_tilemap_navigation_path_with_height_span(
        tilemap_navigation_path_points: &mut Vec<f32>,
        tilemap_navigation_debug_lines: &mut Vec<PhysicsDebugLine>,
        from: Transform2D,
        path: &[Transform2D],
        height_span: HeightSpan,
    ) -> Option<(Transform2D, f32)> {
        tilemap_navigation_path_points.clear();
        tilemap_navigation_debug_lines.clear();
        tilemap_navigation_path_points.reserve(
            path.len()
                .saturating_mul(TILEMAP_NAVIGATION_PATH_POINT_FLOATS),
        );

        let mut previous = from;
        let mut distance = 0.0f32;
        for point in path.iter().copied() {
            push_tilemap_navigation_path_point(
                tilemap_navigation_path_points,
                TilemapNavigationPathPoint::new(point, height_span),
            );
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

        let Some(distance) =
            super::navigation_distance::finish(distance, from, path.iter().copied())
        else {
            tilemap_navigation_path_points.clear();
            tilemap_navigation_debug_lines.clear();
            return None;
        };
        Some((path.first().copied().unwrap_or(from), distance))
    }

    pub(super) fn store_hd2d_tilemap_navigation_path(
        tilemap_navigation_path_points: &mut Vec<f32>,
        tilemap_navigation_debug_lines: &mut Vec<PhysicsDebugLine>,
        from: Transform2D,
        path: &[TilemapNavigationPathPoint],
    ) -> Option<(TilemapNavigationPathPoint, f32)> {
        tilemap_navigation_path_points.clear();
        tilemap_navigation_debug_lines.clear();
        tilemap_navigation_path_points.reserve(
            path.len()
                .saturating_mul(TILEMAP_NAVIGATION_PATH_POINT_FLOATS),
        );

        let mut previous = from;
        let mut distance = 0.0f32;
        for point in path.iter().copied() {
            push_tilemap_navigation_path_point(tilemap_navigation_path_points, point);
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
            previous = point.transform();
        }

        let first = path.first().copied().unwrap_or(TilemapNavigationPathPoint {
            x: from.x,
            y: from.y,
            floor: PhysicsFloorId::DEFAULT,
            elevation: 0.0,
            height: 0.0,
        });
        let Some(distance) = super::navigation_distance::finish(
            distance,
            from,
            path.iter()
                .copied()
                .map(TilemapNavigationPathPoint::transform),
        ) else {
            tilemap_navigation_path_points.clear();
            tilemap_navigation_debug_lines.clear();
            return None;
        };
        Some((first, distance))
    }

    fn observe_input_sample(&mut self, input: InputState) {
        if self.fixed_timestep_enabled || self.unified_physics.is_some() {
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

fn push_tilemap_navigation_path_point(out: &mut Vec<f32>, point: TilemapNavigationPathPoint) {
    out.push(point.x);
    out.push(point.y);
    out.push(point.floor.0 as f32);
    out.push(point.elevation);
    out.push(point.height);
}

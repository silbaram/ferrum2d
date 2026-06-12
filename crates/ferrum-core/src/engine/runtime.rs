use wasm_bindgen::prelude::*;

use crate::collision::{CollisionSystem, PhysicsDebugLine};
use crate::components::gameplay::BehaviorStateEnterActionPhase;
use crate::components::{HeightSpan, PhysicsFloorId, Transform2D};
use crate::entity::Entity;
use crate::gameplay::{
    action_failure_gameplay_event, apply_behavior_state_machine_events,
    tick_gameplay_timer_triggers,
};
use crate::gameplay_event::GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED;
use crate::input::InputState;
use crate::physics::{
    FixedTimestep, FixedTimestepConfig, FixedTimestepUpdate, PhysicsSystem, RigidBodyStepStats,
};
use crate::shooter_scene::ActionTriggerCommand;
use crate::tilemap::TilemapNavigationPathPoint;

use super::physics_bridge::{
    PhysicsBodyColliderSnapshot, PhysicsEntitySnapshot, PhysicsJointSnapshot,
};
use super::scenes::{ActiveScene, SceneMode};
use super::{Engine, TILEMAP_NAVIGATION_DEBUG_COLOR, TILEMAP_NAVIGATION_PATH_POINT_FLOATS};

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

    pub fn update_frame(
        &mut self,
        delta: f64,
        render_commands: bool,
        frame_telemetry: bool,
        physics_debug_lines: bool,
    ) {
        self.advance_simulation(delta);
        if physics_debug_lines {
            self.build_physics_debug_lines();
        } else {
            self.physics_debug_lines.clear();
        }
        if render_commands {
            self.build_render_commands();
        } else {
            self.render_commands.clear();
        }
        if frame_telemetry {
            self.write_frame_telemetry();
        }
    }

    fn advance_simulation(&mut self, delta: f64) {
        self.elapsed_seconds += delta;
        self.clear_physics_frame();
        self.reset_active_scene_action_trigger_frame_diagnostics();
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
                self.record_collision_lifecycle_events();
            }
            if !self.active_scene_ticks_gameplay_timers() {
                tick_gameplay_timer_triggers(
                    &mut self.world,
                    update.consumed_seconds,
                    &mut self.gameplay_events,
                );
            }
        } else {
            self.last_fixed_update = FixedTimestepUpdate::default();
            self.tweens.update(&mut self.world, delta as f32);
            self.update_scene(delta as f32, self.input);
            self.step_auto_rigid_bodies(delta as f32);
            self.record_collision_lifecycle_events();
            if !self.active_scene_ticks_gameplay_timers() {
                tick_gameplay_timer_triggers(
                    &mut self.world,
                    delta as f32,
                    &mut self.gameplay_events,
                );
            }
        }
        let behavior_event_start = self.gameplay_events.len();
        apply_behavior_state_machine_events(&mut self.world, &mut self.gameplay_events);
        self.queue_behavior_state_enter_actions(behavior_event_start);
        self.particles.update(delta as f32);
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
        self.clear_gameplay_events();
        self.clear_effect_events();
    }

    pub fn clear_audio_events(&mut self) {
        self.audio_events.clear();
    }

    pub fn clear_gameplay_events(&mut self) {
        self.gameplay_events.clear();
    }

    pub fn clear_effect_events(&mut self) {
        self.effect_events.clear();
    }

    pub fn set_collision_lifecycle_events_enabled(&mut self, enabled: bool) {
        if self.collision_lifecycle_events_enabled != enabled {
            self.collision_event_tracker.clear();
        }
        self.collision_lifecycle_events_enabled = enabled;
    }

    pub fn reset_game(&mut self) {
        self.reset_active_scene_game();
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
        self.render_commands.clear();
        self.render_items.clear();
        self.audio_events.clear();
    }

    fn clear_physics_frame(&mut self) {
        self.physics_counters.clear();
        self.collision_events.clear();
        self.gameplay_events.clear();
        self.effect_events.clear();
        self.collision_event_counts.clear();
        self.physics_debug_lines.clear();
        self.world.clear_rigid_body_ccd_debug_hits();
    }

    pub(super) fn clear_physics_history(&mut self) {
        self.collision_event_tracker.clear();
        self.collision_events.clear();
        self.gameplay_events.clear();
        self.effect_events.clear();
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

    fn record_collision_lifecycle_events(&mut self) {
        if !self.collision_lifecycle_events_enabled {
            self.collision_event_tracker.clear();
            return;
        }
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

    fn queue_behavior_state_enter_actions(&mut self, event_start: usize) {
        if self.scene_mode != SceneMode::BuiltIn
            || self.scenes.active() != ActiveScene::Shooter
            || event_start >= self.gameplay_events.len()
            || !self
                .world
                .behavior_state_enter_actions
                .iter()
                .any(Option::is_some)
        {
            return;
        }

        let event_end = self.gameplay_events.len();
        for event_index in event_start..event_end {
            let event = self.gameplay_events[event_index];
            if event.kind != GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED {
                continue;
            }
            let Some(actions) = self
                .world
                .behavior_state_enter_actions
                .get(event.source_id as usize)
                .and_then(|actions| *actions)
            else {
                continue;
            };
            if self
                .world
                .generations
                .get(event.source_id as usize)
                .copied()
                != Some(event.source_generation)
                || !self
                    .world
                    .alive
                    .get(event.source_id as usize)
                    .copied()
                    .unwrap_or(false)
            {
                continue;
            }
            let source = Entity {
                id: event.source_id,
                generation: event.source_generation,
            };
            for action in actions.iter_for_state(event.token_id) {
                match action.phase {
                    BehaviorStateEnterActionPhase::NextFramePrePhysics => {
                        let command =
                            ActionTriggerCommand::behavior_state_enter(source, action.action_id);
                        if let Err(data) = self.scenes.shooter.queue_action_trigger_result(command)
                        {
                            self.gameplay_events
                                .push(action_failure_gameplay_event(data));
                        }
                    }
                }
            }
        }
    }

    pub(super) fn build_physics_debug_lines(&mut self) {
        if !self.physics_debug_lines_enabled || self.physics_debug_line_flags == 0 {
            self.physics_debug_lines.clear();
            return;
        }
        CollisionSystem::build_physics_debug_lines_with_flags_and_scratch_into(
            &mut self.physics_debug_collision_scratch,
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
    ) -> (Transform2D, f32) {
        tilemap_navigation_path_points.clear();
        tilemap_navigation_debug_lines.clear();
        tilemap_navigation_path_points.reserve(
            path.len()
                .saturating_mul(TILEMAP_NAVIGATION_PATH_POINT_FLOATS),
        );

        let mut previous = from;
        let mut distance = 0.0;
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

        (path.first().copied().unwrap_or(from), distance)
    }

    pub(super) fn store_hd2d_tilemap_navigation_path(
        tilemap_navigation_path_points: &mut Vec<f32>,
        tilemap_navigation_debug_lines: &mut Vec<PhysicsDebugLine>,
        from: Transform2D,
        path: &[TilemapNavigationPathPoint],
    ) -> (TilemapNavigationPathPoint, f32) {
        tilemap_navigation_path_points.clear();
        tilemap_navigation_debug_lines.clear();
        tilemap_navigation_path_points.reserve(
            path.len()
                .saturating_mul(TILEMAP_NAVIGATION_PATH_POINT_FLOATS),
        );

        let mut previous = from;
        let mut distance = 0.0;
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
        (first, distance)
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

fn push_tilemap_navigation_path_point(out: &mut Vec<f32>, point: TilemapNavigationPathPoint) {
    out.push(point.x);
    out.push(point.y);
    out.push(point.floor.0 as f32);
    out.push(point.elevation);
    out.push(point.height);
}

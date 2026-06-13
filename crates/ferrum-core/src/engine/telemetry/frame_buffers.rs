use wasm_bindgen::prelude::*;

use crate::audio_event::AudioEvent;
use crate::collision::PhysicsDebugLine;
use crate::collision_event::CollisionEvent;
use crate::effect_event::EffectEvent;
use crate::gameplay_event::GameplayEvent;
use crate::render_command::SpriteRenderCommand;

use super::super::{Engine, TILEMAP_NAVIGATION_PATH_POINT_FLOATS};

#[wasm_bindgen]
impl Engine {
    pub fn collision_event_ptr(&self) -> *const CollisionEvent {
        self.frame_buffers.collision_events.as_ptr()
    }

    pub fn collision_event_len(&self) -> usize {
        self.frame_buffers.collision_events.len()
    }

    pub fn gameplay_event_ptr(&self) -> *const GameplayEvent {
        self.frame_buffers.gameplay_events.as_ptr()
    }

    pub fn gameplay_event_len(&self) -> usize {
        self.frame_buffers.gameplay_events.len()
    }

    pub fn effect_event_ptr(&self) -> *const EffectEvent {
        self.frame_buffers.effect_events.as_ptr()
    }

    pub fn effect_event_len(&self) -> usize {
        self.frame_buffers.effect_events.len()
    }

    pub fn frame_telemetry_ptr(&self) -> *const f64 {
        self.frame_buffers.frame_telemetry.as_ptr()
    }

    pub fn physics_debug_line_ptr(&self) -> *const PhysicsDebugLine {
        self.frame_buffers.physics_debug_lines.as_ptr()
    }

    pub fn physics_debug_line_len(&self) -> usize {
        self.frame_buffers.physics_debug_lines.len()
    }

    pub fn tilemap_navigation_path_point_ptr(&self) -> *const f32 {
        self.frame_buffers.tilemap_navigation_path_points.as_ptr()
    }

    pub fn tilemap_navigation_path_point_len(&self) -> usize {
        self.frame_buffers.tilemap_navigation_path_points.len()
            / TILEMAP_NAVIGATION_PATH_POINT_FLOATS
    }

    pub fn tilemap_navigation_debug_line_ptr(&self) -> *const PhysicsDebugLine {
        self.frame_buffers.tilemap_navigation_debug_lines.as_ptr()
    }

    pub fn tilemap_navigation_debug_line_len(&self) -> usize {
        self.frame_buffers.tilemap_navigation_debug_lines.len()
    }

    pub fn time(&self) -> f64 {
        self.elapsed_seconds
    }

    pub fn render_command_ptr(&self) -> *const SpriteRenderCommand {
        self.frame_buffers.render_commands.as_ptr()
    }

    pub fn render_command_len(&self) -> usize {
        self.frame_buffers.render_commands.len()
    }

    pub fn audio_event_ptr(&self) -> *const AudioEvent {
        self.frame_buffers.audio_events.as_ptr()
    }

    pub fn audio_event_len(&self) -> usize {
        self.frame_buffers.audio_events.len()
    }
}

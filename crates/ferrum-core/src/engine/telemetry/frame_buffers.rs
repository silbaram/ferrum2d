use wasm_bindgen::prelude::*;

use crate::audio_event::AudioEvent;
use crate::collision::PhysicsDebugLine;
use crate::collision_event::CollisionEvent;
use crate::render_command::SpriteRenderCommand;

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn collision_event_ptr(&self) -> *const CollisionEvent {
        self.collision_events.as_ptr()
    }

    pub fn collision_event_len(&self) -> usize {
        self.collision_events.len()
    }

    pub fn physics_debug_line_ptr(&self) -> *const PhysicsDebugLine {
        self.physics_debug_lines.as_ptr()
    }

    pub fn physics_debug_line_len(&self) -> usize {
        self.physics_debug_lines.len()
    }

    pub fn tilemap_navigation_path_point_ptr(&self) -> *const f32 {
        self.tilemap_navigation_path_points.as_ptr()
    }

    pub fn tilemap_navigation_path_point_len(&self) -> usize {
        self.tilemap_navigation_path_points.len() / 2
    }

    pub fn tilemap_navigation_debug_line_ptr(&self) -> *const PhysicsDebugLine {
        self.tilemap_navigation_debug_lines.as_ptr()
    }

    pub fn tilemap_navigation_debug_line_len(&self) -> usize {
        self.tilemap_navigation_debug_lines.len()
    }

    pub fn time(&self) -> f64 {
        self.elapsed_seconds
    }

    pub fn render_command_ptr(&self) -> *const SpriteRenderCommand {
        self.render_commands.as_ptr()
    }

    pub fn render_command_len(&self) -> usize {
        self.render_commands.len()
    }

    pub fn audio_event_ptr(&self) -> *const AudioEvent {
        self.audio_events.as_ptr()
    }

    pub fn audio_event_len(&self) -> usize {
        self.audio_events.len()
    }
}

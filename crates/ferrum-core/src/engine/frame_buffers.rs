use crate::audio_event::AudioEvent;
use crate::collision::PhysicsDebugLine;
use crate::collision_event::CollisionEvent;
use crate::effect_event::EffectEvent;
use crate::gameplay_event::GameplayEvent;
use crate::render_command::{SpriteRenderCommand, SpriteRenderItem};

use super::telemetry::frame_stats::FrameTelemetry;

const RENDER_COMMAND_CAPACITY: usize = 256;
const RENDER_ITEM_CAPACITY: usize = 256;
const AUDIO_EVENT_CAPACITY: usize = 16;
const EFFECT_EVENT_CAPACITY: usize = 16;
const COLLISION_EVENT_CAPACITY: usize = 128;
const GAMEPLAY_EVENT_CAPACITY: usize = 32;
const PHYSICS_DEBUG_LINE_CAPACITY: usize = 64;
const TILEMAP_NAVIGATION_PATH_POINT_CAPACITY: usize = 32;
const TILEMAP_NAVIGATION_DEBUG_LINE_CAPACITY: usize = 16;

pub(in crate::engine) struct EngineFrameBuffers {
    pub(in crate::engine) render_commands: Vec<SpriteRenderCommand>,
    pub(in crate::engine) render_items: Vec<SpriteRenderItem>,
    pub(in crate::engine) audio_events: Vec<AudioEvent>,
    pub(in crate::engine) effect_events: Vec<EffectEvent>,
    pub(in crate::engine) collision_events: Vec<CollisionEvent>,
    pub(in crate::engine) gameplay_events: Vec<GameplayEvent>,
    pub(in crate::engine) frame_telemetry: FrameTelemetry,
    pub(in crate::engine) physics_debug_lines: Vec<PhysicsDebugLine>,
    pub(in crate::engine) tilemap_navigation_path_points: Vec<f32>,
    pub(in crate::engine) tilemap_navigation_debug_lines: Vec<PhysicsDebugLine>,
}

impl EngineFrameBuffers {
    pub(in crate::engine) fn new() -> Self {
        Self {
            render_commands: Vec::with_capacity(RENDER_COMMAND_CAPACITY),
            render_items: Vec::with_capacity(RENDER_ITEM_CAPACITY),
            audio_events: Vec::with_capacity(AUDIO_EVENT_CAPACITY),
            effect_events: Vec::with_capacity(EFFECT_EVENT_CAPACITY),
            collision_events: Vec::with_capacity(COLLISION_EVENT_CAPACITY),
            gameplay_events: Vec::with_capacity(GAMEPLAY_EVENT_CAPACITY),
            frame_telemetry: FrameTelemetry::default(),
            physics_debug_lines: Vec::with_capacity(PHYSICS_DEBUG_LINE_CAPACITY),
            tilemap_navigation_path_points: Vec::with_capacity(
                TILEMAP_NAVIGATION_PATH_POINT_CAPACITY,
            ),
            tilemap_navigation_debug_lines: Vec::with_capacity(
                TILEMAP_NAVIGATION_DEBUG_LINE_CAPACITY,
            ),
        }
    }

    pub(in crate::engine) fn clear_render_commands(&mut self) {
        self.render_commands.clear();
    }

    pub(in crate::engine) fn clear_render_work_buffers(&mut self) {
        self.render_commands.clear();
        self.render_items.clear();
    }

    pub(in crate::engine) fn clear_audio_events(&mut self) {
        self.audio_events.clear();
    }

    pub(in crate::engine) fn clear_gameplay_events(&mut self) {
        self.gameplay_events.clear();
    }

    pub(in crate::engine) fn clear_effect_events(&mut self) {
        self.effect_events.clear();
    }

    pub(in crate::engine) fn clear_scene_output(&mut self) {
        self.clear_render_work_buffers();
        self.clear_audio_events();
    }

    pub(in crate::engine) fn clear_physics_frame_output(&mut self) {
        self.collision_events.clear();
        self.clear_gameplay_events();
        self.clear_effect_events();
        self.clear_physics_debug_lines();
    }

    pub(in crate::engine) fn clear_physics_debug_lines(&mut self) {
        self.physics_debug_lines.clear();
    }

    pub(in crate::engine) fn clear_tilemap_navigation_output(&mut self) {
        self.tilemap_navigation_path_points.clear();
        self.tilemap_navigation_debug_lines.clear();
    }
}

impl Default for EngineFrameBuffers {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_event::AUDIO_CHANNEL_SFX;
    use crate::collision_event::COLLISION_EVENT_ENTER;

    #[test]
    fn new_preserves_hot_path_buffer_capacity_baseline() {
        let buffers = EngineFrameBuffers::new();

        BufferCapacities::baseline().assert_matches(&buffers);
    }

    #[test]
    fn clear_methods_preserve_hot_path_buffer_capacity() {
        let mut buffers = EngineFrameBuffers::new();
        let capacities = BufferCapacities::from_buffers(&buffers);

        fill_buffers(&mut buffers);
        buffers.clear_scene_output();
        assert!(buffers.render_commands.is_empty());
        assert!(buffers.render_items.is_empty());
        assert!(buffers.audio_events.is_empty());
        capacities.assert_matches(&buffers);

        fill_buffers(&mut buffers);
        buffers.clear_physics_frame_output();
        assert!(buffers.collision_events.is_empty());
        assert!(buffers.gameplay_events.is_empty());
        assert!(buffers.effect_events.is_empty());
        assert!(buffers.physics_debug_lines.is_empty());
        capacities.assert_matches(&buffers);

        fill_buffers(&mut buffers);
        buffers.clear_tilemap_navigation_output();
        assert!(buffers.tilemap_navigation_path_points.is_empty());
        assert!(buffers.tilemap_navigation_debug_lines.is_empty());
        capacities.assert_matches(&buffers);
    }

    struct BufferCapacities {
        render_commands: usize,
        render_items: usize,
        audio_events: usize,
        effect_events: usize,
        collision_events: usize,
        gameplay_events: usize,
        physics_debug_lines: usize,
        tilemap_navigation_path_points: usize,
        tilemap_navigation_debug_lines: usize,
    }

    impl BufferCapacities {
        const fn baseline() -> Self {
            Self {
                render_commands: RENDER_COMMAND_CAPACITY,
                render_items: RENDER_ITEM_CAPACITY,
                audio_events: AUDIO_EVENT_CAPACITY,
                effect_events: EFFECT_EVENT_CAPACITY,
                collision_events: COLLISION_EVENT_CAPACITY,
                gameplay_events: GAMEPLAY_EVENT_CAPACITY,
                physics_debug_lines: PHYSICS_DEBUG_LINE_CAPACITY,
                tilemap_navigation_path_points: TILEMAP_NAVIGATION_PATH_POINT_CAPACITY,
                tilemap_navigation_debug_lines: TILEMAP_NAVIGATION_DEBUG_LINE_CAPACITY,
            }
        }

        fn from_buffers(buffers: &EngineFrameBuffers) -> Self {
            Self {
                render_commands: buffers.render_commands.capacity(),
                render_items: buffers.render_items.capacity(),
                audio_events: buffers.audio_events.capacity(),
                effect_events: buffers.effect_events.capacity(),
                collision_events: buffers.collision_events.capacity(),
                gameplay_events: buffers.gameplay_events.capacity(),
                physics_debug_lines: buffers.physics_debug_lines.capacity(),
                tilemap_navigation_path_points: buffers.tilemap_navigation_path_points.capacity(),
                tilemap_navigation_debug_lines: buffers.tilemap_navigation_debug_lines.capacity(),
            }
        }

        fn assert_matches(&self, buffers: &EngineFrameBuffers) {
            assert_eq!(buffers.render_commands.capacity(), self.render_commands);
            assert_eq!(buffers.render_items.capacity(), self.render_items);
            assert_eq!(buffers.audio_events.capacity(), self.audio_events);
            assert_eq!(buffers.effect_events.capacity(), self.effect_events);
            assert_eq!(buffers.collision_events.capacity(), self.collision_events);
            assert_eq!(buffers.gameplay_events.capacity(), self.gameplay_events);
            assert_eq!(
                buffers.physics_debug_lines.capacity(),
                self.physics_debug_lines
            );
            assert_eq!(
                buffers.tilemap_navigation_path_points.capacity(),
                self.tilemap_navigation_path_points
            );
            assert_eq!(
                buffers.tilemap_navigation_debug_lines.capacity(),
                self.tilemap_navigation_debug_lines
            );
        }
    }

    fn fill_buffers(buffers: &mut EngineFrameBuffers) {
        buffers.render_commands.push(test_render_command());
        buffers.render_items.push(test_render_item());
        buffers.audio_events.push(AudioEvent {
            sound_id: 1.0,
            volume: 0.5,
            pitch: 1.0,
            channel_id: AUDIO_CHANNEL_SFX,
        });
        buffers.effect_events.push(EffectEvent::default());
        buffers.collision_events.push(CollisionEvent {
            kind: COLLISION_EVENT_ENTER,
            ..CollisionEvent::default()
        });
        buffers.gameplay_events.push(GameplayEvent::default());
        buffers.physics_debug_lines.push(test_debug_line());
        buffers.tilemap_navigation_path_points.push(1.0);
        buffers
            .tilemap_navigation_debug_lines
            .push(test_debug_line());
    }

    fn test_render_command() -> SpriteRenderCommand {
        SpriteRenderCommand {
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
            texture_id: 0.0,
            effect_flags: 0.0,
            rotation_radians: 0.0,
        }
    }

    fn test_render_item() -> SpriteRenderItem {
        SpriteRenderItem {
            command: test_render_command(),
            sort_key: crate::render_command::SpriteRenderSortKey {
                floor_id: 0,
                elevation: 0.0,
                foot_y: 0.0,
                render_layer: 0,
                stable_id: 0,
            },
        }
    }

    fn test_debug_line() -> PhysicsDebugLine {
        PhysicsDebugLine {
            x0: 0.0,
            y0: 0.0,
            x1: 1.0,
            y1: 1.0,
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
        }
    }
}

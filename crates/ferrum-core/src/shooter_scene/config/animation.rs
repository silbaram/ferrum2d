use crate::components::{SpriteAnimation, SpriteAnimationState, SpriteFrame};
use crate::world::EntityTemplate;

pub(super) fn apply_animation_or_default(
    template: EntityTemplate,
    frame_count: u32,
    fps: f32,
) -> EntityTemplate {
    if frame_count <= 1 || !fps.is_finite() || fps <= 0.0 {
        return template;
    }

    template.with_animation(frame_count, fps)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn sprite_animation_or_none(
    columns: u32,
    rows: u32,
    idle_row: u32,
    idle_frames: u32,
    idle_fps: f32,
    move_row: u32,
    move_frames: u32,
    move_fps: f32,
) -> Option<SpriteAnimation> {
    SpriteAnimation::new(
        columns,
        rows,
        SpriteAnimationState {
            row: idle_row,
            frame_count: idle_frames,
            frames_per_second: idle_fps,
        },
        SpriteAnimationState {
            row: move_row,
            frame_count: move_frames,
            frames_per_second: move_fps,
        },
    )
}

pub(in crate::shooter_scene) fn sprite_frames_from_values(
    values: &[f32],
) -> Option<Vec<SpriteFrame>> {
    let chunks = values.chunks_exact(4);
    if !chunks.remainder().is_empty() {
        return None;
    }

    let frames: Option<Vec<SpriteFrame>> = chunks
        .map(|chunk| SpriteFrame::from_values(chunk[0], chunk[1], chunk[2], chunk[3]))
        .collect();
    frames.filter(|frames| !frames.is_empty())
}

use std::cmp::Ordering;

pub const SPRITE_EFFECT_NONE: f32 = 0.0;
pub const SPRITE_EFFECT_FADE: f32 = 1.0;
pub const SPRITE_EFFECT_GLITCH: f32 = 2.0;

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteRenderCommand {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
    pub texture_id: f32,
    pub effect_flags: f32,
    pub rotation_radians: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SpriteRenderSortKey {
    pub floor_id: u32,
    pub elevation: f32,
    pub foot_y: f32,
    pub render_layer: i32,
    pub stable_id: u32,
}

impl SpriteRenderSortKey {
    pub fn cmp_draw_order(self, other: Self) -> Ordering {
        self.floor_id
            .cmp(&other.floor_id)
            .then_with(|| self.elevation.total_cmp(&other.elevation))
            .then_with(|| self.foot_y.total_cmp(&other.foot_y))
            .then_with(|| self.render_layer.cmp(&other.render_layer))
            .then_with(|| self.stable_id.cmp(&other.stable_id))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SpriteRenderItem {
    pub command: SpriteRenderCommand,
    pub sort_key: SpriteRenderSortKey,
}

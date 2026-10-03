use std::cmp::Ordering;

pub const SPRITE_EFFECT_NONE: f32 = 0.0;
pub const SPRITE_EFFECT_FADE: f32 = 1.0;
pub const SPRITE_EFFECT_GLITCH: f32 = 2.0;
/// Independent bit; low two bits retain the legacy sprite effect codes.
pub const SPRITE_PROJECT_GROUND: f32 = 4.0;

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

const F32_BYTES: usize = core::mem::size_of::<f32>();

/// `SpriteRenderCommand::x`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_X_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, x) / F32_BYTES;
/// `SpriteRenderCommand::y`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_Y_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, y) / F32_BYTES;
/// `SpriteRenderCommand::width`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_WIDTH_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, width) / F32_BYTES;
/// `SpriteRenderCommand::height`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_HEIGHT_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, height) / F32_BYTES;
/// `SpriteRenderCommand::u0`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_U0_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, u0) / F32_BYTES;
/// `SpriteRenderCommand::v0`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_V0_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, v0) / F32_BYTES;
/// `SpriteRenderCommand::u1`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_U1_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, u1) / F32_BYTES;
/// `SpriteRenderCommand::v1`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_V1_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, v1) / F32_BYTES;
/// `SpriteRenderCommand::r`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_R_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, r) / F32_BYTES;
/// `SpriteRenderCommand::g`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_G_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, g) / F32_BYTES;
/// `SpriteRenderCommand::b`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_B_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, b) / F32_BYTES;
/// `SpriteRenderCommand::a`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_A_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, a) / F32_BYTES;
/// `SpriteRenderCommand::texture_id`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_TEXTURE_ID_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, texture_id) / F32_BYTES;
/// `SpriteRenderCommand::effect_flags`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_EFFECT_FLAGS_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, effect_flags) / F32_BYTES;
/// `SpriteRenderCommand::rotation_radians`의 `f32` element offset입니다.
pub(crate) const SPRITE_RENDER_COMMAND_ROTATION_RADIANS_FLOAT_OFFSET: usize =
    core::mem::offset_of!(SpriteRenderCommand, rotation_radians) / F32_BYTES;

const _: () = assert!(core::mem::size_of::<SpriteRenderCommand>() == 60);

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SpriteRenderSortKey {
    pub floor_id: u32,
    pub elevation: f32,
    pub foot_y: f32,
    pub render_layer: i32,
    pub sort_order: f32,
    pub stable_id: u32,
}

impl SpriteRenderSortKey {
    pub fn cmp_draw_order(self, other: Self) -> Ordering {
        self.floor_id
            .cmp(&other.floor_id)
            .then_with(|| self.elevation.total_cmp(&other.elevation))
            .then_with(|| self.foot_y.total_cmp(&other.foot_y))
            .then_with(|| self.render_layer.cmp(&other.render_layer))
            .then_with(|| self.sort_order.total_cmp(&other.sort_order))
            .then_with(|| self.stable_id.cmp(&other.stable_id))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SpriteRenderItem {
    pub command: SpriteRenderCommand,
    pub sort_key: SpriteRenderSortKey,
}

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
}

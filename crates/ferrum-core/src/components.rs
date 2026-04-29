#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Transform2D {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sprite {
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
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Velocity {
    pub vx: f32,
    pub vy: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CollisionLayer {
    Player,
    Enemy,
    Bullet,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AabbCollider {
    pub half_width: f32,
    pub half_height: f32,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

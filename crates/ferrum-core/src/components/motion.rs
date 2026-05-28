#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Transform2D {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Velocity {
    pub vx: f32,
    pub vy: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rotation2D {
    pub radians: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct AngularVelocity {
    pub radians_per_second: f32,
}

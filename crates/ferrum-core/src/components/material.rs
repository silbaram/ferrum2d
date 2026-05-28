use super::motion::Velocity;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhysicsMaterial {
    pub restitution: f32,
    pub friction: f32,
    pub surface_velocity: Velocity,
    pub density: f32,
    pub contact_baumgarte_bias_scale: f32,
    pub max_contact_baumgarte_bias_velocity_scale: f32,
    pub contact_position_correction_scale: f32,
    pub contact_position_correction_slop_scale: f32,
}

impl PhysicsMaterial {
    pub const DEFAULT_RESTITUTION: f32 = 0.0;
    pub const DEFAULT_FRICTION: f32 = 0.4;
    pub const DEFAULT_DENSITY: f32 = 1.0;
    pub const DEFAULT_CONTACT_BAUMGARTE_BIAS_SCALE: f32 = 1.0;
    pub const DEFAULT_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY_SCALE: f32 = 1.0;
    pub const DEFAULT_CONTACT_POSITION_CORRECTION_SCALE: f32 = 1.0;
    pub const DEFAULT_CONTACT_POSITION_CORRECTION_SLOP_SCALE: f32 = 1.0;

    pub const DEFAULT: Self = Self {
        restitution: Self::DEFAULT_RESTITUTION,
        friction: Self::DEFAULT_FRICTION,
        surface_velocity: Velocity { vx: 0.0, vy: 0.0 },
        density: Self::DEFAULT_DENSITY,
        contact_baumgarte_bias_scale: Self::DEFAULT_CONTACT_BAUMGARTE_BIAS_SCALE,
        max_contact_baumgarte_bias_velocity_scale:
            Self::DEFAULT_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY_SCALE,
        contact_position_correction_scale: Self::DEFAULT_CONTACT_POSITION_CORRECTION_SCALE,
        contact_position_correction_slop_scale:
            Self::DEFAULT_CONTACT_POSITION_CORRECTION_SLOP_SCALE,
    };

    pub const fn new(restitution: f32, friction: f32) -> Self {
        Self {
            restitution,
            friction,
            ..Self::DEFAULT
        }
    }

    pub const fn with_surface_velocity(mut self, surface_velocity: Velocity) -> Self {
        self.surface_velocity = surface_velocity;
        self
    }

    pub const fn with_density(mut self, density: f32) -> Self {
        self.density = density;
        self
    }

    pub const fn with_contact_baumgarte_bias_scale(mut self, scale: f32) -> Self {
        self.contact_baumgarte_bias_scale = scale;
        self
    }

    pub const fn with_max_contact_baumgarte_bias_velocity_scale(mut self, scale: f32) -> Self {
        self.max_contact_baumgarte_bias_velocity_scale = scale;
        self
    }

    pub const fn with_contact_position_correction_scale(mut self, scale: f32) -> Self {
        self.contact_position_correction_scale = scale;
        self
    }

    pub const fn with_contact_position_correction_slop_scale(mut self, scale: f32) -> Self {
        self.contact_position_correction_slop_scale = scale;
        self
    }
}

impl Default for PhysicsMaterial {
    fn default() -> Self {
        Self::DEFAULT
    }
}

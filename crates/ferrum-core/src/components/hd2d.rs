#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct PhysicsFloorId(pub u32);

impl PhysicsFloorId {
    pub const DEFAULT: Self = Self(0);
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HeightSpan {
    pub floor: PhysicsFloorId,
    pub elevation: f32,
    pub height: f32,
}

impl HeightSpan {
    pub const DEFAULT_HEIGHT: f32 = 0.0;

    pub fn new(floor: PhysicsFloorId, elevation: f32, height: f32) -> Option<Self> {
        if !elevation.is_finite() || !height.is_finite() || height < 0.0 {
            return None;
        }
        Some(Self {
            floor,
            elevation,
            height,
        })
    }

    pub fn on_default_floor(elevation: f32, height: f32) -> Option<Self> {
        Self::new(PhysicsFloorId::DEFAULT, elevation, height)
    }

    pub fn top(self) -> f32 {
        self.elevation + self.height
    }

    pub fn overlaps(self, other: Self) -> bool {
        self.floor == other.floor && self.elevation <= other.top() && self.top() >= other.elevation
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProjectileArc {
    pub floor: PhysicsFloorId,
    pub base_elevation: f32,
    pub z: f32,
    pub z_velocity: f32,
    pub gravity: f32,
    pub hit_height: f32,
}

impl ProjectileArc {
    pub fn new(
        floor: PhysicsFloorId,
        base_elevation: f32,
        z: f32,
        z_velocity: f32,
        gravity: f32,
        hit_height: f32,
    ) -> Option<Self> {
        if !base_elevation.is_finite()
            || !z.is_finite()
            || z < 0.0
            || !z_velocity.is_finite()
            || !gravity.is_finite()
            || gravity < 0.0
            || !hit_height.is_finite()
            || hit_height < 0.0
        {
            return None;
        }
        Some(Self {
            floor,
            base_elevation,
            z,
            z_velocity,
            gravity,
            hit_height,
        })
    }

    pub fn height_span(self) -> Option<HeightSpan> {
        HeightSpan::new(self.floor, self.base_elevation + self.z, self.hit_height)
    }

    pub fn update(&mut self, delta_seconds: f32) -> Option<HeightSpan> {
        if !delta_seconds.is_finite() || delta_seconds <= 0.0 {
            return self.height_span();
        }
        self.z = (self.z + self.z_velocity * delta_seconds).max(0.0);
        self.z_velocity -= self.gravity * delta_seconds;
        self.height_span()
    }
}

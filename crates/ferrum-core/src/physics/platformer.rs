use crate::components::{CollisionMask, HeightSpan, Transform2D, Velocity};
use crate::entity::Entity;

use super::KINEMATIC_EPSILON;

const DEFAULT_PLATFORMER_HORIZONTAL_SPEED: f32 = 180.0;
const DEFAULT_PLATFORMER_GRAVITY: f32 = 900.0;
const DEFAULT_PLATFORMER_JUMP_SPEED: f32 = 360.0;
const DEFAULT_PLATFORMER_MAX_FALL_SPEED: f32 = 900.0;
const DEFAULT_PLATFORMER_GROUND_PROBE_DISTANCE: f32 = 2.0;
const DEFAULT_PLATFORMER_STEP_OFFSET: f32 = 0.0;
const DEFAULT_PLATFORMER_COYOTE_TIME_SECONDS: f32 = 0.0;
const DEFAULT_PLATFORMER_JUMP_BUFFER_SECONDS: f32 = 0.0;

#[derive(Clone, Copy, Debug)]
pub(super) struct KinematicMoveSettings {
    pub(super) solid_mask: CollisionMask,
    pub(super) one_way_platforms: OneWayPlatformConfig,
    pub(super) max_iterations: u32,
    pub(super) ignored_entity: Option<Entity>,
    pub(super) height_span: Option<HeightSpan>,
}

impl KinematicMoveSettings {
    pub(super) const fn new(
        solid_mask: CollisionMask,
        one_way_platforms: OneWayPlatformConfig,
        max_iterations: u32,
    ) -> Self {
        Self {
            solid_mask,
            one_way_platforms,
            max_iterations,
            ignored_entity: None,
            height_span: None,
        }
    }

    pub(super) const fn ignoring_entity(mut self, entity: Entity) -> Self {
        self.ignored_entity = Some(entity);
        self
    }

    pub(super) const fn with_height_span(mut self, height_span: Option<HeightSpan>) -> Self {
        self.height_span = height_span;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhysicsBounds {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KinematicMoveResult {
    pub start: Transform2D,
    pub end: Transform2D,
    pub requested: Velocity,
    pub remaining: Velocity,
    pub hit_count: u32,
    pub blocked_x: bool,
    pub blocked_y: bool,
    pub last_hit: Option<Entity>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GroundProbeHit {
    pub entity: Option<Entity>,
    pub tile_layer_index: Option<usize>,
    pub tile_index: Option<usize>,
    pub distance: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SlopeSurfaceHit {
    pub x: f32,
    pub y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub t: f32,
    pub angle_radians: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SlopeSegment {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

impl SlopeSegment {
    pub const fn new(x0: f32, y0: f32, x1: f32, y1: f32) -> Self {
        Self { x0, y0, x1, y1 }
    }

    pub fn surface_at_x(self, x: f32) -> Option<SlopeSurfaceHit> {
        if !x.is_finite() {
            return None;
        }

        let dx = self.x1 - self.x0;
        let dy = self.y1 - self.y0;
        let length = self.length()?;
        let t = (x - self.x0) / dx;
        if !t.is_finite() || !(0.0..=1.0).contains(&t) {
            return None;
        }

        let y = self.y0 + dy * t;
        if !y.is_finite() {
            return None;
        }

        let (normal_x, normal_y) = upward_surface_normal(dx, dy, length);
        Some(SlopeSurfaceHit {
            x,
            y,
            normal_x,
            normal_y,
            t,
            angle_radians: dy.abs().atan2(dx.abs()),
        })
    }

    pub fn is_walkable(self, max_climb_angle_radians: f32) -> bool {
        max_climb_angle_radians.is_finite()
            && max_climb_angle_radians >= 0.0
            && self
                .angle_radians()
                .is_some_and(|angle| angle <= max_climb_angle_radians)
    }

    fn angle_radians(self) -> Option<f32> {
        let dx = self.x1 - self.x0;
        let dy = self.y1 - self.y0;
        self.length().map(|_| dy.abs().atan2(dx.abs()))
    }

    fn length(self) -> Option<f32> {
        if !self.x0.is_finite()
            || !self.y0.is_finite()
            || !self.x1.is_finite()
            || !self.y1.is_finite()
        {
            return None;
        }

        let dx = self.x1 - self.x0;
        let dy = self.y1 - self.y0;
        if dx.abs() <= KINEMATIC_EPSILON {
            return None;
        }

        let length = dx.hypot(dy);
        if length.is_finite() && length > KINEMATIC_EPSILON {
            Some(length)
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SlopeConfig {
    pub max_climb_angle_radians: f32,
    pub snap_distance: f32,
    pub allow_downhill_snap: bool,
}

impl SlopeConfig {
    pub const fn new(max_climb_angle_radians: f32, snap_distance: f32) -> Self {
        Self {
            max_climb_angle_radians,
            snap_distance,
            allow_downhill_snap: true,
        }
    }

    pub const fn disabled() -> Self {
        Self {
            max_climb_angle_radians: 0.0,
            snap_distance: 0.0,
            allow_downhill_snap: false,
        }
    }

    pub const fn with_downhill_snap(mut self, allow_downhill_snap: bool) -> Self {
        self.allow_downhill_snap = allow_downhill_snap;
        self
    }
}

impl Default for SlopeConfig {
    fn default() -> Self {
        Self::disabled()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OneWayPlatformConfig {
    pub platform_mask: CollisionMask,
}

impl OneWayPlatformConfig {
    pub const fn new(platform_mask: CollisionMask) -> Self {
        Self { platform_mask }
    }

    pub const fn disabled() -> Self {
        Self {
            platform_mask: CollisionMask::NONE,
        }
    }

    pub const fn is_enabled(self) -> bool {
        self.platform_mask.bits != 0
    }
}

impl Default for OneWayPlatformConfig {
    fn default() -> Self {
        Self::disabled()
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MovingPlatformCarryConfig {
    pub platform: Entity,
    pub displacement: Velocity,
    pub probe_distance: f32,
    pub solid_mask: CollisionMask,
    pub one_way_platforms: OneWayPlatformConfig,
    pub max_iterations: u32,
}

impl MovingPlatformCarryConfig {
    pub const fn new(
        platform: Entity,
        displacement: Velocity,
        probe_distance: f32,
        solid_mask: CollisionMask,
        max_iterations: u32,
    ) -> Self {
        Self {
            platform,
            displacement,
            probe_distance,
            solid_mask,
            one_way_platforms: OneWayPlatformConfig::disabled(),
            max_iterations,
        }
    }

    pub const fn with_one_way_platforms(mut self, one_way_platforms: OneWayPlatformConfig) -> Self {
        self.one_way_platforms = one_way_platforms;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlatformerControllerInput {
    pub horizontal_axis: f32,
    pub jump_pressed: bool,
}

impl PlatformerControllerInput {
    pub const fn new(horizontal_axis: f32, jump_pressed: bool) -> Self {
        Self {
            horizontal_axis,
            jump_pressed,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlatformerControllerConfig {
    pub horizontal_speed: f32,
    pub gravity: f32,
    pub jump_speed: f32,
    pub max_fall_speed: f32,
    pub ground_probe_distance: f32,
    pub step_offset: f32,
    pub coyote_time_seconds: f32,
    pub jump_buffer_seconds: f32,
    pub slope: SlopeConfig,
    pub solid_mask: CollisionMask,
    pub one_way_platforms: OneWayPlatformConfig,
    pub max_iterations: u32,
}

impl PlatformerControllerConfig {
    pub const fn new(solid_mask: CollisionMask, max_iterations: u32) -> Self {
        Self {
            horizontal_speed: DEFAULT_PLATFORMER_HORIZONTAL_SPEED,
            gravity: DEFAULT_PLATFORMER_GRAVITY,
            jump_speed: DEFAULT_PLATFORMER_JUMP_SPEED,
            max_fall_speed: DEFAULT_PLATFORMER_MAX_FALL_SPEED,
            ground_probe_distance: DEFAULT_PLATFORMER_GROUND_PROBE_DISTANCE,
            step_offset: DEFAULT_PLATFORMER_STEP_OFFSET,
            coyote_time_seconds: DEFAULT_PLATFORMER_COYOTE_TIME_SECONDS,
            jump_buffer_seconds: DEFAULT_PLATFORMER_JUMP_BUFFER_SECONDS,
            slope: SlopeConfig::disabled(),
            solid_mask,
            one_way_platforms: OneWayPlatformConfig::disabled(),
            max_iterations,
        }
    }

    pub const fn with_horizontal_speed(mut self, horizontal_speed: f32) -> Self {
        self.horizontal_speed = horizontal_speed;
        self
    }

    pub const fn with_gravity(mut self, gravity: f32) -> Self {
        self.gravity = gravity;
        self
    }

    pub const fn with_jump_speed(mut self, jump_speed: f32) -> Self {
        self.jump_speed = jump_speed;
        self
    }

    pub const fn with_max_fall_speed(mut self, max_fall_speed: f32) -> Self {
        self.max_fall_speed = max_fall_speed;
        self
    }

    pub const fn with_ground_probe_distance(mut self, ground_probe_distance: f32) -> Self {
        self.ground_probe_distance = ground_probe_distance;
        self
    }

    pub const fn with_step_offset(mut self, step_offset: f32) -> Self {
        self.step_offset = step_offset;
        self
    }

    pub const fn with_coyote_time_seconds(mut self, coyote_time_seconds: f32) -> Self {
        self.coyote_time_seconds = coyote_time_seconds;
        self
    }

    pub const fn with_jump_buffer_seconds(mut self, jump_buffer_seconds: f32) -> Self {
        self.jump_buffer_seconds = jump_buffer_seconds;
        self
    }

    pub const fn with_slope_config(mut self, slope: SlopeConfig) -> Self {
        self.slope = slope;
        self
    }

    pub const fn with_one_way_platforms(mut self, one_way_platforms: OneWayPlatformConfig) -> Self {
        self.one_way_platforms = one_way_platforms;
        self
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PlatformerControllerState {
    pub coyote_time_remaining: f32,
    pub jump_buffer_remaining: f32,
}

impl PlatformerControllerState {
    pub const fn new() -> Self {
        Self {
            coyote_time_remaining: 0.0,
            jump_buffer_remaining: 0.0,
        }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlatformerControllerResult {
    pub movement: KinematicMoveResult,
    pub velocity: Velocity,
    pub ground_before: Option<GroundProbeHit>,
    pub ground_after: Option<GroundProbeHit>,
    pub jumped: bool,
    pub grounded: bool,
}

fn upward_surface_normal(dx: f32, dy: f32, length: f32) -> (f32, f32) {
    let normal_x = -dy / length;
    let normal_y = dx / length;
    if normal_y >= 0.0 {
        (normal_x, normal_y)
    } else {
        (-normal_x, -normal_y)
    }
}

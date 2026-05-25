use crate::entity::Entity;

const POLYGON_MASS_EPSILON: f32 = 0.0001;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Transform2D {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sprite {
    pub texture_id: u32,
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

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteFrame {
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
}

impl SpriteFrame {
    pub const FULL: Self = Self {
        u0: 0.0,
        v0: 0.0,
        u1: 1.0,
        v1: 1.0,
    };

    pub fn from_values(u0: f32, v0: f32, u1: f32, v1: f32) -> Option<Self> {
        if u0.is_finite()
            && v0.is_finite()
            && u1.is_finite()
            && v1.is_finite()
            && (0.0..=1.0).contains(&u0)
            && (0.0..=1.0).contains(&v0)
            && (0.0..=1.0).contains(&u1)
            && (0.0..=1.0).contains(&v1)
            && u1 > u0
            && v1 > v0
        {
            Some(Self { u0, v0, u1, v1 })
        } else {
            None
        }
    }

    pub fn uv(self) -> (f32, f32, f32, f32) {
        (self.u0, self.v0, self.u1, self.v1)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimation {
    pub columns: u32,
    pub rows: u32,
    pub idle: SpriteAnimationState,
    pub moving: SpriteAnimationState,
    pub idle_frames: Option<SpriteAnimationFrameSequence>,
    pub moving_frames: Option<SpriteAnimationFrameSequence>,
    pub current_state: SpriteAnimationKind,
    pub current_frame: u32,
    pub elapsed_seconds: f32,
}

pub const MAX_SPRITE_ANIMATION_FRAMES: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimationFrameSequence {
    frames: [SpriteFrame; MAX_SPRITE_ANIMATION_FRAMES],
    frame_count: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimationState {
    pub row: u32,
    pub frame_count: u32,
    pub frames_per_second: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpriteAnimationKind {
    Idle,
    Moving,
}

impl SpriteAnimation {
    pub fn new(
        columns: u32,
        rows: u32,
        idle: SpriteAnimationState,
        moving: SpriteAnimationState,
    ) -> Option<Self> {
        if columns <= 1 || rows == 0 || !idle.is_valid(columns, rows) {
            return None;
        }

        Some(Self {
            columns,
            rows,
            idle,
            moving: if moving.is_valid(columns, rows) {
                moving
            } else {
                idle
            },
            idle_frames: None,
            moving_frames: None,
            current_state: SpriteAnimationKind::Idle,
            current_frame: 0,
            elapsed_seconds: 0.0,
        })
    }

    pub fn horizontal(frame_count: u32, frames_per_second: f32) -> Option<Self> {
        let state = SpriteAnimationState {
            row: 0,
            frame_count,
            frames_per_second,
        };
        Self::new(frame_count, 1, state, state)
    }

    pub fn atlas(
        idle_frames: &[SpriteFrame],
        idle_frames_per_second: f32,
        moving_frames: &[SpriteFrame],
        moving_frames_per_second: f32,
    ) -> Option<Self> {
        let idle_sequence = SpriteAnimationFrameSequence::from_frames(idle_frames)?;
        let moving_sequence =
            SpriteAnimationFrameSequence::from_frames(moving_frames).unwrap_or(idle_sequence);
        let idle = SpriteAnimationState {
            row: 0,
            frame_count: idle_sequence.frame_count,
            frames_per_second: idle_frames_per_second,
        };
        let moving = SpriteAnimationState {
            row: 0,
            frame_count: moving_sequence.frame_count,
            frames_per_second: moving_frames_per_second,
        };
        if !idle.is_timed() {
            return None;
        }

        Some(Self {
            columns: idle_sequence.frame_count.max(moving_sequence.frame_count),
            rows: 1,
            idle,
            moving: if moving.is_timed() { moving } else { idle },
            idle_frames: Some(idle_sequence),
            moving_frames: Some(if moving.is_timed() {
                moving_sequence
            } else {
                idle_sequence
            }),
            current_state: SpriteAnimationKind::Idle,
            current_frame: 0,
            elapsed_seconds: 0.0,
        })
    }

    pub fn advance(&mut self, delta: f32, is_moving: bool) {
        let next_state = if is_moving {
            SpriteAnimationKind::Moving
        } else {
            SpriteAnimationKind::Idle
        };
        if self.current_state != next_state {
            self.current_state = next_state;
            self.current_frame = 0;
            self.elapsed_seconds = 0.0;
        }

        if delta <= 0.0 || !delta.is_finite() {
            return;
        }

        let state = self.active_state();
        self.elapsed_seconds += delta;
        let frame_duration = 1.0 / state.frames_per_second;
        while self.elapsed_seconds >= frame_duration {
            self.elapsed_seconds -= frame_duration;
            self.current_frame = (self.current_frame + 1) % state.frame_count;
        }
    }

    pub fn uv(&self) -> (f32, f32, f32, f32) {
        let state = self.active_state();
        if let Some(sequence) = self.active_frame_sequence() {
            return sequence.frame(self.current_frame).uv();
        }

        let frame_width = 1.0 / self.columns as f32;
        let frame_height = 1.0 / self.rows as f32;
        let u0 = self.current_frame as f32 * frame_width;
        let v0 = state.row as f32 * frame_height;
        (u0, v0, u0 + frame_width, v0 + frame_height)
    }

    fn active_state(&self) -> SpriteAnimationState {
        match self.current_state {
            SpriteAnimationKind::Idle => self.idle,
            SpriteAnimationKind::Moving => self.moving,
        }
    }

    fn active_frame_sequence(&self) -> Option<SpriteAnimationFrameSequence> {
        match self.current_state {
            SpriteAnimationKind::Idle => self.idle_frames,
            SpriteAnimationKind::Moving => self.moving_frames,
        }
    }
}

impl SpriteAnimationFrameSequence {
    pub fn from_frames(frames: &[SpriteFrame]) -> Option<Self> {
        if frames.is_empty() || frames.len() > MAX_SPRITE_ANIMATION_FRAMES {
            return None;
        }

        let mut sequence = Self {
            frames: [SpriteFrame::FULL; MAX_SPRITE_ANIMATION_FRAMES],
            frame_count: frames.len() as u32,
        };
        for (index, frame) in frames.iter().copied().enumerate() {
            sequence.frames[index] = frame;
        }
        Some(sequence)
    }

    pub fn frame_count(self) -> u32 {
        self.frame_count
    }

    pub fn first_frame(self) -> SpriteFrame {
        self.frames[0]
    }

    fn frame(self, index: u32) -> SpriteFrame {
        let resolved = (index % self.frame_count) as usize;
        self.frames[resolved]
    }
}

impl SpriteAnimationState {
    pub fn is_valid(&self, columns: u32, rows: u32) -> bool {
        self.row < rows && self.frame_count > 0 && self.frame_count <= columns && self.is_timed()
    }

    pub fn is_timed(&self) -> bool {
        self.frames_per_second.is_finite() && self.frames_per_second > 0.0
    }
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RigidBodyType {
    Static,
    Kinematic,
    Dynamic,
}

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

    pub const fn new(restitution: f32, friction: f32) -> Self {
        Self {
            restitution,
            friction,
            surface_velocity: Velocity { vx: 0.0, vy: 0.0 },
            density: Self::DEFAULT_DENSITY,
            contact_baumgarte_bias_scale: Self::DEFAULT_CONTACT_BAUMGARTE_BIAS_SCALE,
            max_contact_baumgarte_bias_velocity_scale:
                Self::DEFAULT_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY_SCALE,
            contact_position_correction_scale: Self::DEFAULT_CONTACT_POSITION_CORRECTION_SCALE,
            contact_position_correction_slop_scale:
                Self::DEFAULT_CONTACT_POSITION_CORRECTION_SLOP_SCALE,
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
        Self {
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
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RigidBody {
    pub enabled: bool,
    pub body_type: RigidBodyType,
    pub mass: f32,
    pub inverse_mass: f32,
    pub inertia: f32,
    pub inverse_inertia: f32,
    pub gravity_scale: f32,
    pub linear_damping: f32,
    pub angular_damping: f32,
    pub force: Velocity,
    pub impulse: Velocity,
    pub torque: f32,
    pub angular_impulse: f32,
    pub material: PhysicsMaterial,
    pub can_sleep: bool,
    pub sleep_timer_seconds: f32,
    pub is_sleeping: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RigidContactImpulse {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub normal_impulse: f32,
    pub tangent_impulse: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RigidBodyCcdDebugHit {
    pub moving_entity: Entity,
    pub target_entity: Entity,
    pub time: f32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

impl RigidBody {
    pub const fn static_body() -> Self {
        Self {
            enabled: true,
            body_type: RigidBodyType::Static,
            mass: f32::INFINITY,
            inverse_mass: 0.0,
            inertia: f32::INFINITY,
            inverse_inertia: 0.0,
            gravity_scale: 0.0,
            linear_damping: 0.0,
            angular_damping: 0.0,
            force: Velocity { vx: 0.0, vy: 0.0 },
            impulse: Velocity { vx: 0.0, vy: 0.0 },
            torque: 0.0,
            angular_impulse: 0.0,
            material: PhysicsMaterial {
                restitution: PhysicsMaterial::DEFAULT_RESTITUTION,
                friction: PhysicsMaterial::DEFAULT_FRICTION,
                surface_velocity: Velocity { vx: 0.0, vy: 0.0 },
                density: PhysicsMaterial::DEFAULT_DENSITY,
                contact_baumgarte_bias_scale: PhysicsMaterial::DEFAULT_CONTACT_BAUMGARTE_BIAS_SCALE,
                max_contact_baumgarte_bias_velocity_scale:
                    PhysicsMaterial::DEFAULT_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY_SCALE,
                contact_position_correction_scale:
                    PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SCALE,
                contact_position_correction_slop_scale:
                    PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SLOP_SCALE,
            },
            can_sleep: false,
            sleep_timer_seconds: 0.0,
            is_sleeping: false,
        }
    }

    pub const fn kinematic() -> Self {
        Self {
            enabled: true,
            body_type: RigidBodyType::Kinematic,
            mass: f32::INFINITY,
            inverse_mass: 0.0,
            inertia: f32::INFINITY,
            inverse_inertia: 0.0,
            gravity_scale: 0.0,
            linear_damping: 0.0,
            angular_damping: 0.0,
            force: Velocity { vx: 0.0, vy: 0.0 },
            impulse: Velocity { vx: 0.0, vy: 0.0 },
            torque: 0.0,
            angular_impulse: 0.0,
            material: PhysicsMaterial {
                restitution: PhysicsMaterial::DEFAULT_RESTITUTION,
                friction: PhysicsMaterial::DEFAULT_FRICTION,
                surface_velocity: Velocity { vx: 0.0, vy: 0.0 },
                density: PhysicsMaterial::DEFAULT_DENSITY,
                contact_baumgarte_bias_scale: PhysicsMaterial::DEFAULT_CONTACT_BAUMGARTE_BIAS_SCALE,
                max_contact_baumgarte_bias_velocity_scale:
                    PhysicsMaterial::DEFAULT_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY_SCALE,
                contact_position_correction_scale:
                    PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SCALE,
                contact_position_correction_slop_scale:
                    PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SLOP_SCALE,
            },
            can_sleep: false,
            sleep_timer_seconds: 0.0,
            is_sleeping: false,
        }
    }

    pub fn dynamic(mass: f32) -> Self {
        let mass = sanitize_positive_finite(mass, 1.0);
        Self {
            enabled: true,
            body_type: RigidBodyType::Dynamic,
            mass,
            inverse_mass: 1.0 / mass,
            inertia: mass,
            inverse_inertia: 1.0 / mass,
            gravity_scale: 1.0,
            linear_damping: 0.0,
            angular_damping: 0.0,
            force: Velocity::default(),
            impulse: Velocity::default(),
            torque: 0.0,
            angular_impulse: 0.0,
            material: PhysicsMaterial::default(),
            can_sleep: true,
            sleep_timer_seconds: 0.0,
            is_sleeping: false,
        }
    }

    pub fn dynamic_box(mass: f32, width: f32, height: f32) -> Self {
        let body = Self::dynamic(mass);
        let width = sanitize_positive_finite(width, 1.0);
        let height = sanitize_positive_finite(height, 1.0);
        let inertia = (body.mass * (width * width + height * height)) / 12.0;
        body.with_inertia(inertia)
    }

    pub fn dynamic_box_with_density(density: f32, width: f32, height: f32) -> Self {
        let density = sanitize_positive_finite(density, PhysicsMaterial::DEFAULT_DENSITY);
        let width = sanitize_positive_finite(width, 1.0);
        let height = sanitize_positive_finite(height, 1.0);
        Self::dynamic_box(density * width * height, width, height)
    }

    pub fn dynamic_box_with_material(material: PhysicsMaterial, width: f32, height: f32) -> Self {
        Self::dynamic_box_with_density(material.density, width, height).with_material(material)
    }

    pub fn dynamic_oriented_box(mass: f32, half_width: f32, half_height: f32) -> Self {
        let half_width = sanitize_positive_finite(half_width, 1.0);
        let half_height = sanitize_positive_finite(half_height, 1.0);
        Self::dynamic_box(mass, half_width * 2.0, half_height * 2.0)
    }

    pub fn dynamic_oriented_box_with_density(
        density: f32,
        half_width: f32,
        half_height: f32,
    ) -> Self {
        let density = sanitize_positive_finite(density, PhysicsMaterial::DEFAULT_DENSITY);
        let half_width = sanitize_positive_finite(half_width, 1.0);
        let half_height = sanitize_positive_finite(half_height, 1.0);
        Self::dynamic_oriented_box(
            density * half_width * half_height * 4.0,
            half_width,
            half_height,
        )
    }

    pub fn dynamic_oriented_box_with_material(
        material: PhysicsMaterial,
        half_width: f32,
        half_height: f32,
    ) -> Self {
        Self::dynamic_oriented_box_with_density(material.density, half_width, half_height)
            .with_material(material)
    }

    pub fn dynamic_circle(mass: f32, radius: f32) -> Self {
        let body = Self::dynamic(mass);
        let radius = sanitize_positive_finite(radius, 1.0);
        let inertia = 0.5 * body.mass * radius * radius;
        body.with_inertia(inertia)
    }

    pub fn dynamic_circle_with_density(density: f32, radius: f32) -> Self {
        let density = sanitize_positive_finite(density, PhysicsMaterial::DEFAULT_DENSITY);
        let radius = sanitize_positive_finite(radius, 1.0);
        Self::dynamic_circle(density * core::f32::consts::PI * radius * radius, radius)
    }

    pub fn dynamic_circle_with_material(material: PhysicsMaterial, radius: f32) -> Self {
        Self::dynamic_circle_with_density(material.density, radius).with_material(material)
    }

    pub fn dynamic_capsule(
        mass: f32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
    ) -> Self {
        let body = Self::dynamic(mass);
        let shape = sanitize_capsule_mass_shape(start_x, start_y, end_x, end_y, radius);
        let density = body.mass / capsule_area(shape.length, shape.radius);
        body.with_inertia(capsule_inertia(density, shape.length, shape.radius))
    }

    pub fn dynamic_capsule_with_density(
        density: f32,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
    ) -> Self {
        let density = sanitize_positive_finite(density, PhysicsMaterial::DEFAULT_DENSITY);
        let shape = sanitize_capsule_mass_shape(start_x, start_y, end_x, end_y, radius);
        Self::dynamic_capsule(
            density * capsule_area(shape.length, shape.radius),
            start_x,
            start_y,
            end_x,
            end_y,
            radius,
        )
    }

    pub fn dynamic_capsule_with_material(
        material: PhysicsMaterial,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
    ) -> Self {
        Self::dynamic_capsule_with_density(material.density, start_x, start_y, end_x, end_y, radius)
            .with_material(material)
    }

    pub fn dynamic_convex_polygon(
        mass: f32,
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: u32,
    ) -> Self {
        let body = Self::dynamic(mass);
        let shape = sanitize_convex_polygon_mass_shape(vertices, vertex_count);
        let density = body.mass / shape.area;
        body.with_inertia(density * shape.inertia_factor)
    }

    pub fn dynamic_convex_polygon_with_density(
        density: f32,
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: u32,
    ) -> Self {
        let density = sanitize_positive_finite(density, PhysicsMaterial::DEFAULT_DENSITY);
        let shape = sanitize_convex_polygon_mass_shape(vertices, vertex_count);
        Self::dynamic_convex_polygon(density * shape.area, vertices, vertex_count)
    }

    pub fn dynamic_convex_polygon_with_material(
        material: PhysicsMaterial,
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: u32,
    ) -> Self {
        Self::dynamic_convex_polygon_with_density(material.density, vertices, vertex_count)
            .with_material(material)
    }

    pub const fn with_gravity_scale(mut self, gravity_scale: f32) -> Self {
        self.gravity_scale = gravity_scale;
        self
    }

    pub const fn with_linear_damping(mut self, linear_damping: f32) -> Self {
        self.linear_damping = linear_damping;
        self
    }

    pub const fn with_angular_damping(mut self, angular_damping: f32) -> Self {
        self.angular_damping = angular_damping;
        self
    }

    pub fn with_inertia(mut self, inertia: f32) -> Self {
        if self.body_type == RigidBodyType::Dynamic && inertia.is_finite() && inertia > 0.0 {
            self.inertia = inertia;
            self.inverse_inertia = 1.0 / inertia;
        }
        self
    }

    pub const fn with_material(mut self, material: PhysicsMaterial) -> Self {
        self.material = material;
        self
    }

    pub const fn with_sleeping_enabled(mut self, can_sleep: bool) -> Self {
        self.can_sleep = can_sleep;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

fn sanitize_positive_finite(value: f32, fallback: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        fallback
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct CapsuleMassShape {
    length: f32,
    radius: f32,
}

fn sanitize_capsule_mass_shape(
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
    radius: f32,
) -> CapsuleMassShape {
    let (start_x, start_y, end_x, end_y) =
        if start_x.is_finite() && start_y.is_finite() && end_x.is_finite() && end_y.is_finite() {
            (start_x, start_y, end_x, end_y)
        } else {
            (-0.5, 0.0, 0.5, 0.0)
        };
    let dx = end_x - start_x;
    let dy = end_y - start_y;
    CapsuleMassShape {
        length: (dx * dx + dy * dy).sqrt(),
        radius: sanitize_positive_finite(radius, 1.0),
    }
}

fn capsule_area(length: f32, radius: f32) -> f32 {
    2.0 * radius * length + core::f32::consts::PI * radius * radius
}

fn capsule_inertia(density: f32, length: f32, radius: f32) -> f32 {
    let rect_mass = density * 2.0 * radius * length;
    let rect_inertia = rect_mass * (length * length + 4.0 * radius * radius) / 12.0;
    let half_cap_mass = density * 0.5 * core::f32::consts::PI * radius * radius;
    let half_length = length * 0.5;
    let cap_centroid_offset = 4.0 * radius / (3.0 * core::f32::consts::PI);
    let half_cap_inertia_about_center = 0.5 * half_cap_mass * radius * radius;
    let cap_pair_inertia = 2.0
        * (half_cap_inertia_about_center
            + half_cap_mass
                * (half_length * half_length + 2.0 * half_length * cap_centroid_offset));

    rect_inertia + cap_pair_inertia
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ConvexPolygonMassShape {
    area: f32,
    inertia_factor: f32,
}

fn sanitize_convex_polygon_mass_shape(
    vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
    vertex_count: u32,
) -> ConvexPolygonMassShape {
    let count = (vertex_count as usize).min(MAX_CONVEX_POLYGON_VERTICES);
    if count < 3 {
        return fallback_convex_polygon_mass_shape();
    }

    let mut signed_double_area = 0.0;
    let mut signed_inertia_sum = 0.0;
    for index in 0..count {
        let a = vertices[index];
        let b = vertices[(index + 1) % count];
        if !a.x.is_finite() || !a.y.is_finite() || !b.x.is_finite() || !b.y.is_finite() {
            return fallback_convex_polygon_mass_shape();
        }

        let cross = a.x * b.y - b.x * a.y;
        let inertia_term = a.x * a.x + a.x * b.x + b.x * b.x + a.y * a.y + a.y * b.y + b.y * b.y;
        signed_double_area += cross;
        signed_inertia_sum += cross * inertia_term;
    }

    let area = signed_double_area.abs() * 0.5;
    let inertia_factor = (signed_inertia_sum / 12.0).abs();
    if area.is_finite()
        && area > POLYGON_MASS_EPSILON
        && inertia_factor.is_finite()
        && inertia_factor > POLYGON_MASS_EPSILON
    {
        ConvexPolygonMassShape {
            area,
            inertia_factor,
        }
    } else {
        fallback_convex_polygon_mass_shape()
    }
}

fn fallback_convex_polygon_mass_shape() -> ConvexPolygonMassShape {
    ConvexPolygonMassShape {
        area: 1.0,
        inertia_factor: 1.0 / 6.0,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DistanceJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DistanceJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub rest_length: f32,
    pub break_distance: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl DistanceJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 0.0;

    pub fn new(entity_a: Entity, entity_b: Entity, rest_length: f32) -> Self {
        Self {
            entity_a,
            entity_b,
            rest_length: if rest_length.is_finite() && rest_length >= 0.0 {
                rest_length
            } else {
                0.0
            },
            break_distance: f32::INFINITY,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_break_distance(mut self, break_distance: f32) -> Self {
        self.break_distance = break_distance;
        self
    }

    pub const fn without_break_distance(mut self) -> Self {
        self.break_distance = f32::INFINITY;
        self
    }

    pub const fn with_stiffness(mut self, stiffness: f32) -> Self {
        self.stiffness = stiffness;
        self
    }

    pub const fn with_damping(mut self, damping: f32) -> Self {
        self.damping = damping;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RopeJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RopeJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub max_length: f32,
    pub break_distance: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl RopeJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 0.0;

    pub fn new(entity_a: Entity, entity_b: Entity, max_length: f32) -> Self {
        Self {
            entity_a,
            entity_b,
            max_length: if max_length.is_finite() && max_length >= 0.0 {
                max_length
            } else {
                0.0
            },
            break_distance: f32::INFINITY,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_break_distance(mut self, break_distance: f32) -> Self {
        self.break_distance = break_distance;
        self
    }

    pub const fn without_break_distance(mut self) -> Self {
        self.break_distance = f32::INFINITY;
        self
    }

    pub const fn with_stiffness(mut self, stiffness: f32) -> Self {
        self.stiffness = stiffness;
        self
    }

    pub const fn with_damping(mut self, damping: f32) -> Self {
        self.damping = damping;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpringJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpringJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub rest_length: f32,
    pub break_distance: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl SpringJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 0.0;

    pub fn new(entity_a: Entity, entity_b: Entity, rest_length: f32) -> Self {
        Self {
            entity_a,
            entity_b,
            rest_length: if rest_length.is_finite() && rest_length >= 0.0 {
                rest_length
            } else {
                0.0
            },
            break_distance: f32::INFINITY,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_break_distance(mut self, break_distance: f32) -> Self {
        self.break_distance = break_distance;
        self
    }

    pub const fn without_break_distance(mut self) -> Self {
        self.break_distance = f32::INFINITY;
        self
    }

    pub const fn with_stiffness(mut self, stiffness: f32) -> Self {
        self.stiffness = stiffness;
        self
    }

    pub const fn with_damping(mut self, damping: f32) -> Self {
        self.damping = damping;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PulleyJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PulleyJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub ground_anchor_a_x: f32,
    pub ground_anchor_a_y: f32,
    pub ground_anchor_b_x: f32,
    pub ground_anchor_b_y: f32,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub rest_length: f32,
    pub ratio: f32,
    pub break_distance: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl PulleyJoint {
    pub const DEFAULT_RATIO: f32 = 1.0;
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 0.0;

    pub fn new(entity_a: Entity, entity_b: Entity, rest_length: f32) -> Self {
        Self {
            entity_a,
            entity_b,
            ground_anchor_a_x: 0.0,
            ground_anchor_a_y: 0.0,
            ground_anchor_b_x: 0.0,
            ground_anchor_b_y: 0.0,
            local_anchor_a_x: 0.0,
            local_anchor_a_y: 0.0,
            local_anchor_b_x: 0.0,
            local_anchor_b_y: 0.0,
            rest_length: if rest_length.is_finite() && rest_length >= 0.0 {
                rest_length
            } else {
                0.0
            },
            ratio: Self::DEFAULT_RATIO,
            break_distance: f32::INFINITY,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_ground_anchor_a(mut self, x: f32, y: f32) -> Self {
        self.ground_anchor_a_x = x;
        self.ground_anchor_a_y = y;
        self
    }

    pub const fn with_ground_anchor_b(mut self, x: f32, y: f32) -> Self {
        self.ground_anchor_b_x = x;
        self.ground_anchor_b_y = y;
        self
    }

    pub const fn with_local_anchor_a(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_a_x = x;
        self.local_anchor_a_y = y;
        self
    }

    pub const fn with_local_anchor_b(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_b_x = x;
        self.local_anchor_b_y = y;
        self
    }

    pub const fn with_ratio(mut self, ratio: f32) -> Self {
        self.ratio = ratio;
        self
    }

    pub const fn with_break_distance(mut self, break_distance: f32) -> Self {
        self.break_distance = break_distance;
        self
    }

    pub const fn without_break_distance(mut self) -> Self {
        self.break_distance = f32::INFINITY;
        self
    }

    pub const fn with_stiffness(mut self, stiffness: f32) -> Self {
        self.stiffness = stiffness;
        self
    }

    pub const fn with_damping(mut self, damping: f32) -> Self {
        self.damping = damping;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RevoluteJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RevoluteJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub break_distance: f32,
    pub limit_enabled: bool,
    pub lower_angle: f32,
    pub upper_angle: f32,
    pub motor_enabled: bool,
    pub motor_speed: f32,
    pub max_motor_torque: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl RevoluteJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 1.0;

    pub const fn new(entity_a: Entity, entity_b: Entity) -> Self {
        Self {
            entity_a,
            entity_b,
            local_anchor_a_x: 0.0,
            local_anchor_a_y: 0.0,
            local_anchor_b_x: 0.0,
            local_anchor_b_y: 0.0,
            break_distance: f32::INFINITY,
            limit_enabled: false,
            lower_angle: 0.0,
            upper_angle: 0.0,
            motor_enabled: false,
            motor_speed: 0.0,
            max_motor_torque: 0.0,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_local_anchor_a(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_a_x = x;
        self.local_anchor_a_y = y;
        self
    }

    pub const fn with_local_anchor_b(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_b_x = x;
        self.local_anchor_b_y = y;
        self
    }

    pub const fn with_break_distance(mut self, break_distance: f32) -> Self {
        self.break_distance = break_distance;
        self
    }

    pub const fn without_break_distance(mut self) -> Self {
        self.break_distance = f32::INFINITY;
        self
    }

    pub const fn with_angle_limits(mut self, lower_angle: f32, upper_angle: f32) -> Self {
        self.limit_enabled = true;
        self.lower_angle = lower_angle;
        self.upper_angle = upper_angle;
        self
    }

    pub const fn with_angle_limit_enabled(mut self, limit_enabled: bool) -> Self {
        self.limit_enabled = limit_enabled;
        self
    }

    pub const fn with_motor(mut self, motor_speed: f32, max_motor_torque: f32) -> Self {
        self.motor_enabled = true;
        self.motor_speed = motor_speed;
        self.max_motor_torque = max_motor_torque;
        self
    }

    pub const fn with_motor_enabled(mut self, motor_enabled: bool) -> Self {
        self.motor_enabled = motor_enabled;
        self
    }

    pub const fn with_stiffness(mut self, stiffness: f32) -> Self {
        self.stiffness = stiffness;
        self
    }

    pub const fn with_damping(mut self, damping: f32) -> Self {
        self.damping = damping;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PrismaticJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PrismaticJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub local_axis_a_x: f32,
    pub local_axis_a_y: f32,
    pub break_distance: f32,
    pub reference_angle: f32,
    pub limit_enabled: bool,
    pub lower_translation: f32,
    pub upper_translation: f32,
    pub motor_enabled: bool,
    pub motor_speed: f32,
    pub max_motor_force: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub angular_stiffness: f32,
    pub angular_damping: f32,
    pub enabled: bool,
}

impl PrismaticJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 1.0;
    pub const DEFAULT_ANGULAR_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_ANGULAR_DAMPING: f32 = 1.0;

    pub const fn new(entity_a: Entity, entity_b: Entity) -> Self {
        Self {
            entity_a,
            entity_b,
            local_anchor_a_x: 0.0,
            local_anchor_a_y: 0.0,
            local_anchor_b_x: 0.0,
            local_anchor_b_y: 0.0,
            local_axis_a_x: 1.0,
            local_axis_a_y: 0.0,
            break_distance: f32::INFINITY,
            reference_angle: 0.0,
            limit_enabled: false,
            lower_translation: 0.0,
            upper_translation: 0.0,
            motor_enabled: false,
            motor_speed: 0.0,
            max_motor_force: 0.0,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            angular_stiffness: Self::DEFAULT_ANGULAR_STIFFNESS,
            angular_damping: Self::DEFAULT_ANGULAR_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_local_anchor_a(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_a_x = x;
        self.local_anchor_a_y = y;
        self
    }

    pub const fn with_local_anchor_b(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_b_x = x;
        self.local_anchor_b_y = y;
        self
    }

    pub const fn with_local_axis_a(mut self, x: f32, y: f32) -> Self {
        self.local_axis_a_x = x;
        self.local_axis_a_y = y;
        self
    }

    pub const fn with_reference_angle(mut self, reference_angle: f32) -> Self {
        self.reference_angle = reference_angle;
        self
    }

    pub const fn with_break_distance(mut self, break_distance: f32) -> Self {
        self.break_distance = break_distance;
        self
    }

    pub const fn without_break_distance(mut self) -> Self {
        self.break_distance = f32::INFINITY;
        self
    }

    pub const fn with_translation_limits(
        mut self,
        lower_translation: f32,
        upper_translation: f32,
    ) -> Self {
        self.limit_enabled = true;
        self.lower_translation = lower_translation;
        self.upper_translation = upper_translation;
        self
    }

    pub const fn with_translation_limit_enabled(mut self, limit_enabled: bool) -> Self {
        self.limit_enabled = limit_enabled;
        self
    }

    pub const fn with_motor(mut self, motor_speed: f32, max_motor_force: f32) -> Self {
        self.motor_enabled = true;
        self.motor_speed = motor_speed;
        self.max_motor_force = max_motor_force;
        self
    }

    pub const fn with_motor_enabled(mut self, motor_enabled: bool) -> Self {
        self.motor_enabled = motor_enabled;
        self
    }

    pub const fn with_stiffness(mut self, stiffness: f32) -> Self {
        self.stiffness = stiffness;
        self
    }

    pub const fn with_damping(mut self, damping: f32) -> Self {
        self.damping = damping;
        self
    }

    pub const fn with_angular_stiffness(mut self, angular_stiffness: f32) -> Self {
        self.angular_stiffness = angular_stiffness;
        self
    }

    pub const fn with_angular_damping(mut self, angular_damping: f32) -> Self {
        self.angular_damping = angular_damping;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WeldJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WeldJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub local_anchor_a_x: f32,
    pub local_anchor_a_y: f32,
    pub local_anchor_b_x: f32,
    pub local_anchor_b_y: f32,
    pub reference_angle: f32,
    pub break_distance: f32,
    pub break_angle: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub angular_stiffness: f32,
    pub angular_damping: f32,
    pub enabled: bool,
}

impl WeldJoint {
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 1.0;
    pub const DEFAULT_ANGULAR_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_ANGULAR_DAMPING: f32 = 1.0;

    pub const fn new(entity_a: Entity, entity_b: Entity) -> Self {
        Self {
            entity_a,
            entity_b,
            local_anchor_a_x: 0.0,
            local_anchor_a_y: 0.0,
            local_anchor_b_x: 0.0,
            local_anchor_b_y: 0.0,
            reference_angle: 0.0,
            break_distance: f32::INFINITY,
            break_angle: f32::INFINITY,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            angular_stiffness: Self::DEFAULT_ANGULAR_STIFFNESS,
            angular_damping: Self::DEFAULT_ANGULAR_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_local_anchor_a(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_a_x = x;
        self.local_anchor_a_y = y;
        self
    }

    pub const fn with_local_anchor_b(mut self, x: f32, y: f32) -> Self {
        self.local_anchor_b_x = x;
        self.local_anchor_b_y = y;
        self
    }

    pub const fn with_reference_angle(mut self, reference_angle: f32) -> Self {
        self.reference_angle = reference_angle;
        self
    }

    pub const fn with_break_distance(mut self, break_distance: f32) -> Self {
        self.break_distance = break_distance;
        self
    }

    pub const fn without_break_distance(mut self) -> Self {
        self.break_distance = f32::INFINITY;
        self
    }

    pub const fn with_break_angle(mut self, break_angle: f32) -> Self {
        self.break_angle = break_angle;
        self
    }

    pub const fn without_break_angle(mut self) -> Self {
        self.break_angle = f32::INFINITY;
        self
    }

    pub const fn with_stiffness(mut self, stiffness: f32) -> Self {
        self.stiffness = stiffness;
        self
    }

    pub const fn with_damping(mut self, damping: f32) -> Self {
        self.damping = damping;
        self
    }

    pub const fn with_angular_stiffness(mut self, angular_stiffness: f32) -> Self {
        self.angular_stiffness = angular_stiffness;
        self
    }

    pub const fn with_angular_damping(mut self, angular_damping: f32) -> Self {
        self.angular_damping = angular_damping;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GearJointId {
    pub index: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GearJoint {
    pub entity_a: Entity,
    pub entity_b: Entity,
    pub ratio: f32,
    pub reference_angle: f32,
    pub break_angle: f32,
    pub stiffness: f32,
    pub damping: f32,
    pub enabled: bool,
}

impl GearJoint {
    pub const DEFAULT_RATIO: f32 = 1.0;
    pub const DEFAULT_STIFFNESS: f32 = 1.0;
    pub const DEFAULT_DAMPING: f32 = 1.0;

    pub fn new(entity_a: Entity, entity_b: Entity, ratio: f32) -> Self {
        Self {
            entity_a,
            entity_b,
            ratio: if ratio.is_finite() {
                ratio
            } else {
                Self::DEFAULT_RATIO
            },
            reference_angle: 0.0,
            break_angle: f32::INFINITY,
            stiffness: Self::DEFAULT_STIFFNESS,
            damping: Self::DEFAULT_DAMPING,
            enabled: true,
        }
    }

    pub const fn with_ratio(mut self, ratio: f32) -> Self {
        self.ratio = ratio;
        self
    }

    pub const fn with_reference_angle(mut self, reference_angle: f32) -> Self {
        self.reference_angle = reference_angle;
        self
    }

    pub const fn with_break_angle(mut self, break_angle: f32) -> Self {
        self.break_angle = break_angle;
        self
    }

    pub const fn without_break_angle(mut self) -> Self {
        self.break_angle = f32::INFINITY;
        self
    }

    pub const fn with_stiffness(mut self, stiffness: f32) -> Self {
        self.stiffness = stiffness;
        self
    }

    pub const fn with_damping(mut self, damping: f32) -> Self {
        self.damping = damping;
        self
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CollisionLayer {
    Player,
    Enemy,
    Bullet,
    Wall,
}

impl CollisionLayer {
    pub const fn mask(self) -> CollisionMask {
        match self {
            Self::Player => CollisionMask::PLAYER,
            Self::Enemy => CollisionMask::ENEMY,
            Self::Bullet => CollisionMask::BULLET,
            Self::Wall => CollisionMask::WALL,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CollisionMask {
    pub bits: u32,
}

impl CollisionMask {
    pub const NONE: Self = Self { bits: 0 };
    pub const PLAYER: Self = Self { bits: 1 << 0 };
    pub const ENEMY: Self = Self { bits: 1 << 1 };
    pub const BULLET: Self = Self { bits: 1 << 2 };
    pub const WALL: Self = Self { bits: 1 << 3 };
    pub const ALL: Self = Self { bits: u32::MAX };

    pub const fn from_bits(bits: u32) -> Self {
        Self { bits }
    }

    pub const fn bit(index: u8) -> Option<Self> {
        if index < 32 {
            Some(Self {
                bits: 1_u32 << index,
            })
        } else {
            None
        }
    }

    pub const fn union(self, other: Self) -> Self {
        Self {
            bits: self.bits | other.bits,
        }
    }

    pub const fn intersects(self, other: Self) -> bool {
        self.bits & other.bits != 0
    }
}

impl From<CollisionLayer> for CollisionMask {
    fn from(layer: CollisionLayer) -> Self {
        layer.mask()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CollisionFilter {
    pub category: CollisionMask,
    pub mask: CollisionMask,
}

impl CollisionFilter {
    pub const fn new(category: CollisionMask, mask: CollisionMask) -> Self {
        Self { category, mask }
    }

    pub const fn from_layer(layer: CollisionLayer) -> Self {
        Self {
            category: layer.mask(),
            mask: CollisionMask::ALL,
        }
    }

    pub const fn can_collide_with(self, other: Self) -> bool {
        self.mask.intersects(other.category) && other.mask.intersects(self.category)
    }
}

pub const MAX_CONVEX_POLYGON_VERTICES: usize = 16;
pub const MAX_CHAIN_COLLIDER_VERTICES: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AabbCollider {
    pub half_width: f32,
    pub half_height: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl AabbCollider {
    pub const fn new(
        half_width: f32,
        half_height: f32,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            half_width,
            half_height,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x,
            y: transform.y + self.offset_y,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CircleCollider {
    pub radius: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl CircleCollider {
    pub const fn new(radius: f32, is_trigger: bool, layer: CollisionLayer) -> Self {
        Self {
            radius,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x,
            y: transform.y + self.offset_y,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OrientedBoxCollider {
    pub half_width: f32,
    pub half_height: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub rotation_radians: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl OrientedBoxCollider {
    pub const fn new(
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            half_width,
            half_height,
            offset_x: 0.0,
            offset_y: 0.0,
            rotation_radians,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn with_rotation(mut self, rotation_radians: f32) -> Self {
        self.rotation_radians = rotation_radians;
        self
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x,
            y: transform.y + self.offset_y,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CapsuleCollider {
    pub start_x: f32,
    pub start_y: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub radius: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl CapsuleCollider {
    pub const fn new(
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            start_x,
            start_y,
            end_x,
            end_y,
            radius,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn start(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + self.start_x,
            y: transform.y + self.offset_y + self.start_y,
        }
    }

    pub const fn end(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + self.end_x,
            y: transform.y + self.offset_y + self.end_y,
        }
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + (self.start_x + self.end_x) * 0.5,
            y: transform.y + self.offset_y + (self.start_y + self.end_y) * 0.5,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EdgeCollider {
    pub start_x: f32,
    pub start_y: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl EdgeCollider {
    pub const fn new(
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            start_x,
            start_y,
            end_x,
            end_y,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn start(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + self.start_x,
            y: transform.y + self.offset_y + self.start_y,
        }
    }

    pub const fn end(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + self.end_x,
            y: transform.y + self.offset_y + self.end_y,
        }
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x + (self.start_x + self.end_x) * 0.5,
            y: transform.y + self.offset_y + (self.start_y + self.end_y) * 0.5,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChainCollider {
    pub vertices: [Transform2D; MAX_CHAIN_COLLIDER_VERTICES],
    pub vertex_count: u32,
    pub looped: bool,
    pub offset_x: f32,
    pub offset_y: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl ChainCollider {
    pub const fn new(
        vertices: [Transform2D; MAX_CHAIN_COLLIDER_VERTICES],
        vertex_count: u32,
        looped: bool,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            vertices,
            vertex_count,
            looped,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub fn vertices(&self) -> &[Transform2D] {
        let vertex_count = (self.vertex_count as usize).min(MAX_CHAIN_COLLIDER_VERTICES);
        &self.vertices[..vertex_count]
    }

    pub fn segment_count(&self) -> usize {
        let vertex_count = self.vertices().len();
        if vertex_count < 2 {
            return 0;
        }
        let closing_segment = if self.looped
            && vertex_count > 2
            && self.vertices[vertex_count - 1] != self.vertices[0]
        {
            1
        } else {
            0
        };
        vertex_count - 1 + closing_segment
    }

    pub fn segment(&self, index: usize) -> Option<EdgeCollider> {
        let vertices = self.vertices();
        let segment_count = self.segment_count();
        if index >= segment_count {
            return None;
        }
        let start = vertices[index];
        let end = if index + 1 < vertices.len() {
            vertices[index + 1]
        } else {
            vertices[0]
        };
        Some(
            EdgeCollider::new(start.x, start.y, end.x, end.y, self.is_trigger, self.layer)
                .with_offset(self.offset_x, self.offset_y)
                .with_enabled(self.enabled),
        )
    }

    pub fn center(&self, transform: Transform2D) -> Transform2D {
        let vertices = self.vertices();
        if vertices.is_empty() {
            return Transform2D {
                x: transform.x + self.offset_x,
                y: transform.y + self.offset_y,
            };
        }
        let (sum_x, sum_y) = vertices
            .iter()
            .fold((0.0, 0.0), |(x, y), vertex| (x + vertex.x, y + vertex.y));
        let scale = 1.0 / vertices.len() as f32;
        Transform2D {
            x: transform.x + self.offset_x + sum_x * scale,
            y: transform.y + self.offset_y + sum_y * scale,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ConvexPolygonCollider {
    pub vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
    pub vertex_count: u32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub rotation_radians: f32,
    pub enabled: bool,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

impl ConvexPolygonCollider {
    pub const fn new(
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: u32,
        is_trigger: bool,
        layer: CollisionLayer,
    ) -> Self {
        Self {
            vertices,
            vertex_count,
            offset_x: 0.0,
            offset_y: 0.0,
            rotation_radians: 0.0,
            enabled: true,
            is_trigger,
            layer,
        }
    }

    pub const fn with_enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub const fn with_offset(mut self, offset_x: f32, offset_y: f32) -> Self {
        self.offset_x = offset_x;
        self.offset_y = offset_y;
        self
    }

    pub const fn with_rotation(mut self, rotation_radians: f32) -> Self {
        self.rotation_radians = rotation_radians;
        self
    }

    pub const fn center(self, transform: Transform2D) -> Transform2D {
        Transform2D {
            x: transform.x + self.offset_x,
            y: transform.y + self.offset_y,
        }
    }
}

// ChainCollider intentionally keeps a fixed vertex buffer to avoid per-collider
// heap allocation and preserve Copy semantics for low-frequency authoring paths.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CompoundColliderShape {
    Aabb(AabbCollider),
    Circle(CircleCollider),
    OrientedBox(OrientedBoxCollider),
    Capsule(CapsuleCollider),
    Edge(EdgeCollider),
    Chain(ChainCollider),
    ConvexPolygon(ConvexPolygonCollider),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CompoundCollider {
    pub shape: CompoundColliderShape,
    pub material: Option<PhysicsMaterial>,
    pub filter: Option<CollisionFilter>,
}

impl CompoundCollider {
    pub const fn new(shape: CompoundColliderShape) -> Self {
        Self {
            shape,
            material: None,
            filter: None,
        }
    }

    pub const fn with_material(mut self, material: PhysicsMaterial) -> Self {
        self.material = Some(material);
        self
    }

    pub const fn with_filter(mut self, filter: CollisionFilter) -> Self {
        self.filter = Some(filter);
        self
    }

    pub const fn layer(self) -> CollisionLayer {
        match self.shape {
            CompoundColliderShape::Aabb(collider) => collider.layer,
            CompoundColliderShape::Circle(collider) => collider.layer,
            CompoundColliderShape::OrientedBox(collider) => collider.layer,
            CompoundColliderShape::Capsule(collider) => collider.layer,
            CompoundColliderShape::Edge(collider) => collider.layer,
            CompoundColliderShape::Chain(collider) => collider.layer,
            CompoundColliderShape::ConvexPolygon(collider) => collider.layer,
        }
    }

    pub const fn enabled(self) -> bool {
        match self.shape {
            CompoundColliderShape::Aabb(collider) => collider.enabled,
            CompoundColliderShape::Circle(collider) => collider.enabled,
            CompoundColliderShape::OrientedBox(collider) => collider.enabled,
            CompoundColliderShape::Capsule(collider) => collider.enabled,
            CompoundColliderShape::Edge(collider) => collider.enabled,
            CompoundColliderShape::Chain(collider) => collider.enabled,
            CompoundColliderShape::ConvexPolygon(collider) => collider.enabled,
        }
    }

    pub const fn is_trigger(self) -> bool {
        match self.shape {
            CompoundColliderShape::Aabb(collider) => collider.is_trigger,
            CompoundColliderShape::Circle(collider) => collider.is_trigger,
            CompoundColliderShape::OrientedBox(collider) => collider.is_trigger,
            CompoundColliderShape::Capsule(collider) => collider.is_trigger,
            CompoundColliderShape::Edge(collider) => collider.is_trigger,
            CompoundColliderShape::Chain(collider) => collider.is_trigger,
            CompoundColliderShape::ConvexPolygon(collider) => collider.is_trigger,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn physics_material_density_defaults_and_builder() {
        let material = PhysicsMaterial::new(0.25, 0.75);
        let dense_material = material
            .with_density(3.0)
            .with_contact_baumgarte_bias_scale(0.25)
            .with_max_contact_baumgarte_bias_velocity_scale(0.5)
            .with_contact_position_correction_scale(0.75)
            .with_contact_position_correction_slop_scale(0.5);

        assert_eq!(material.density, PhysicsMaterial::DEFAULT_DENSITY);
        assert_eq!(
            material.contact_baumgarte_bias_scale,
            PhysicsMaterial::DEFAULT_CONTACT_BAUMGARTE_BIAS_SCALE
        );
        assert_eq!(
            material.max_contact_baumgarte_bias_velocity_scale,
            PhysicsMaterial::DEFAULT_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY_SCALE
        );
        assert_eq!(
            material.contact_position_correction_scale,
            PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SCALE
        );
        assert_eq!(
            material.contact_position_correction_slop_scale,
            PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SLOP_SCALE
        );
        assert_eq!(dense_material.density, 3.0);
        assert_eq!(dense_material.contact_baumgarte_bias_scale, 0.25);
        assert_eq!(
            dense_material.max_contact_baumgarte_bias_velocity_scale,
            0.5
        );
        assert_eq!(dense_material.contact_position_correction_scale, 0.75);
        assert_eq!(dense_material.contact_position_correction_slop_scale, 0.5);
        assert_eq!(
            PhysicsMaterial::default().density,
            PhysicsMaterial::DEFAULT_DENSITY
        );
        assert_eq!(
            PhysicsMaterial::default().contact_baumgarte_bias_scale,
            PhysicsMaterial::DEFAULT_CONTACT_BAUMGARTE_BIAS_SCALE
        );
        assert_eq!(
            PhysicsMaterial::default().max_contact_baumgarte_bias_velocity_scale,
            PhysicsMaterial::DEFAULT_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY_SCALE
        );
        assert_eq!(
            PhysicsMaterial::default().contact_position_correction_scale,
            PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SCALE
        );
        assert_eq!(
            PhysicsMaterial::default().contact_position_correction_slop_scale,
            PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SLOP_SCALE
        );
    }

    #[test]
    fn dynamic_box_with_density_calculates_mass_and_inertia() {
        let body = RigidBody::dynamic_box_with_density(0.5, 4.0, 2.0);
        let expected_inertia = 4.0 * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

        assert_eq!(body.body_type, RigidBodyType::Dynamic);
        assert!((body.mass - 4.0).abs() < 0.001);
        assert!((body.inverse_mass - 0.25).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
        assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
    }

    #[test]
    fn dynamic_oriented_box_with_density_calculates_mass_and_inertia_from_half_extents() {
        let body = RigidBody::dynamic_oriented_box_with_density(0.5, 2.0, 1.0);
        let expected_mass = 4.0;
        let expected_inertia = expected_mass * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

        assert_eq!(body.body_type, RigidBodyType::Dynamic);
        assert!((body.mass - expected_mass).abs() < 0.001);
        assert!((body.inverse_mass - (1.0 / expected_mass)).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
        assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
    }

    #[test]
    fn dynamic_circle_with_density_calculates_mass_and_inertia() {
        let body = RigidBody::dynamic_circle_with_density(2.0, 3.0);
        let expected_mass = 2.0 * core::f32::consts::PI * 3.0 * 3.0;
        let expected_inertia = 0.5 * expected_mass * 3.0 * 3.0;

        assert_eq!(body.body_type, RigidBodyType::Dynamic);
        assert!((body.mass - expected_mass).abs() < 0.001);
        assert!((body.inverse_mass - (1.0 / expected_mass)).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
        assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
    }

    #[test]
    fn dynamic_capsule_with_density_calculates_mass_and_inertia() {
        let body = RigidBody::dynamic_capsule_with_density(2.0, -2.0, 0.0, 2.0, 0.0, 1.0);
        let expected_mass = capsule_expected_mass(2.0, 4.0, 1.0);
        let expected_inertia = capsule_expected_inertia(2.0, 4.0, 1.0);

        assert_eq!(body.body_type, RigidBodyType::Dynamic);
        assert!((body.mass - expected_mass).abs() < 0.001);
        assert!((body.inverse_mass - (1.0 / expected_mass)).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
        assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
    }

    #[test]
    fn dynamic_capsule_with_density_treats_zero_length_as_circle() {
        let body = RigidBody::dynamic_capsule_with_density(2.0, 1.0, 1.0, 1.0, 1.0, 3.0);
        let expected_mass = capsule_expected_mass(2.0, 0.0, 3.0);
        let expected_inertia = 0.5 * expected_mass * 3.0 * 3.0;

        assert!((body.mass - expected_mass).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
    }

    #[test]
    fn dynamic_capsule_uses_explicit_mass_with_shape_inertia() {
        let body = RigidBody::dynamic_capsule(10.0, 0.0, -2.0, 0.0, 2.0, 1.0);
        let expected_density = 10.0 / capsule_expected_area(4.0, 1.0);
        let expected_inertia = capsule_expected_inertia(expected_density, 4.0, 1.0);

        assert_eq!(body.body_type, RigidBodyType::Dynamic);
        assert!((body.mass - 10.0).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
    }

    #[test]
    fn dynamic_convex_polygon_with_density_calculates_mass_and_inertia() {
        let vertices =
            convex_polygon_vertices(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]);
        let body = RigidBody::dynamic_convex_polygon_with_density(0.5, vertices, 4);
        let expected_mass = 4.0;
        let expected_inertia = expected_mass * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

        assert_eq!(body.body_type, RigidBodyType::Dynamic);
        assert!((body.mass - expected_mass).abs() < 0.001);
        assert!((body.inverse_mass - (1.0 / expected_mass)).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
        assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
    }

    #[test]
    fn dynamic_convex_polygon_uses_explicit_mass_with_shape_inertia() {
        let vertices =
            convex_polygon_vertices(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]);
        let body = RigidBody::dynamic_convex_polygon(10.0, vertices, 4);
        let expected_inertia = 10.0 * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

        assert_eq!(body.body_type, RigidBodyType::Dynamic);
        assert!((body.mass - 10.0).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
        assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
    }

    #[test]
    fn dynamic_oriented_box_uses_explicit_mass_with_shape_inertia() {
        let body = RigidBody::dynamic_oriented_box(10.0, 2.0, 1.0);
        let expected_inertia = 10.0 * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

        assert_eq!(body.body_type, RigidBodyType::Dynamic);
        assert!((body.mass - 10.0).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
        assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
    }

    #[test]
    fn dynamic_box_with_material_uses_material_density() {
        let material = PhysicsMaterial::new(0.25, 0.75)
            .with_density(0.5)
            .with_surface_velocity(Velocity { vx: 2.0, vy: 0.0 });
        let body = RigidBody::dynamic_box_with_material(material, 4.0, 2.0);
        let expected_inertia = 4.0 * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

        assert_eq!(body.material, material);
        assert!((body.mass - 4.0).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
    }

    #[test]
    fn dynamic_oriented_box_with_material_uses_material_density() {
        let material = PhysicsMaterial::new(0.25, 0.75).with_density(0.5);
        let body = RigidBody::dynamic_oriented_box_with_material(material, 2.0, 1.0);
        let expected_mass = 4.0;
        let expected_inertia = expected_mass * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

        assert_eq!(body.material, material);
        assert!((body.mass - expected_mass).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
    }

    #[test]
    fn dynamic_circle_with_material_uses_material_density() {
        let material = PhysicsMaterial::new(0.25, 0.75).with_density(2.0);
        let body = RigidBody::dynamic_circle_with_material(material, 3.0);
        let expected_mass = 2.0 * core::f32::consts::PI * 3.0 * 3.0;
        let expected_inertia = 0.5 * expected_mass * 3.0 * 3.0;

        assert_eq!(body.material, material);
        assert!((body.mass - expected_mass).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
    }

    #[test]
    fn dynamic_capsule_with_material_uses_material_density() {
        let material = PhysicsMaterial::new(0.25, 0.75).with_density(2.0);
        let body = RigidBody::dynamic_capsule_with_material(material, -2.0, 0.0, 2.0, 0.0, 1.0);
        let expected_mass = capsule_expected_mass(2.0, 4.0, 1.0);
        let expected_inertia = capsule_expected_inertia(2.0, 4.0, 1.0);

        assert_eq!(body.material, material);
        assert!((body.mass - expected_mass).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
    }

    #[test]
    fn dynamic_convex_polygon_with_material_uses_material_density() {
        let material = PhysicsMaterial::new(0.25, 0.75).with_density(0.5);
        let vertices =
            convex_polygon_vertices(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]);
        let body = RigidBody::dynamic_convex_polygon_with_material(material, vertices, 4);
        let expected_mass = 4.0;
        let expected_inertia = expected_mass * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

        assert_eq!(body.material, material);
        assert!((body.mass - expected_mass).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
    }

    #[test]
    fn dynamic_density_helpers_sanitize_invalid_input() {
        let box_body = RigidBody::dynamic_box_with_density(f32::NAN, -4.0, f32::INFINITY);
        let oriented_box_body =
            RigidBody::dynamic_oriented_box_with_density(f32::NAN, -4.0, f32::INFINITY);
        let circle_body = RigidBody::dynamic_circle_with_density(-2.0, f32::NAN);
        let capsule_body = RigidBody::dynamic_capsule_with_density(
            f32::NAN,
            f32::NAN,
            0.0,
            1.0,
            f32::INFINITY,
            -2.0,
        );
        let invalid_polygon_vertices =
            convex_polygon_vertices(&[(f32::NAN, 0.0), (1.0, 0.0), (0.0, 1.0)]);
        let polygon_body =
            RigidBody::dynamic_convex_polygon_with_density(f32::NAN, invalid_polygon_vertices, 3);
        let expected_capsule_mass = capsule_expected_mass(1.0, 1.0, 1.0);
        let expected_capsule_inertia = capsule_expected_inertia(1.0, 1.0, 1.0);

        assert!((box_body.mass - 1.0).abs() < 0.001);
        assert!((box_body.inertia - (1.0 / 6.0)).abs() < 0.001);
        assert!((oriented_box_body.mass - 4.0).abs() < 0.001);
        assert!((oriented_box_body.inertia - (8.0 / 3.0)).abs() < 0.001);
        assert!((circle_body.mass - core::f32::consts::PI).abs() < 0.001);
        assert!((circle_body.inertia - (0.5 * core::f32::consts::PI)).abs() < 0.001);
        assert!((capsule_body.mass - expected_capsule_mass).abs() < 0.001);
        assert!((capsule_body.inertia - expected_capsule_inertia).abs() < 0.001);
        assert!((polygon_body.mass - 1.0).abs() < 0.001);
        assert!((polygon_body.inertia - (1.0 / 6.0)).abs() < 0.001);
    }

    #[test]
    fn material_density_helpers_sanitize_invalid_density_for_mass() {
        let material = PhysicsMaterial::new(0.25, 0.75).with_density(f32::NAN);
        let body = RigidBody::dynamic_box_with_material(material, 4.0, 2.0);
        let expected_inertia = 8.0 * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

        assert_eq!(body.material.restitution, material.restitution);
        assert_eq!(body.material.friction, material.friction);
        assert!(body.material.density.is_nan());
        assert!((body.mass - 8.0).abs() < 0.001);
        assert!((body.inertia - expected_inertia).abs() < 0.001);
    }

    fn capsule_expected_area(length: f32, radius: f32) -> f32 {
        2.0 * radius * length + core::f32::consts::PI * radius * radius
    }

    fn capsule_expected_mass(density: f32, length: f32, radius: f32) -> f32 {
        density * capsule_expected_area(length, radius)
    }

    fn capsule_expected_inertia(density: f32, length: f32, radius: f32) -> f32 {
        let rect_mass = density * 2.0 * radius * length;
        let rect_inertia = rect_mass * (length * length + 4.0 * radius * radius) / 12.0;
        let half_cap_mass = density * 0.5 * core::f32::consts::PI * radius * radius;
        let half_length = length * 0.5;
        let cap_centroid_offset = 4.0 * radius / (3.0 * core::f32::consts::PI);
        let half_cap_inertia_about_center = 0.5 * half_cap_mass * radius * radius;
        let cap_pair_inertia = 2.0
            * (half_cap_inertia_about_center
                + half_cap_mass
                    * (half_length * half_length + 2.0 * half_length * cap_centroid_offset));

        rect_inertia + cap_pair_inertia
    }

    fn convex_polygon_vertices(
        points: &[(f32, f32)],
    ) -> [Transform2D; MAX_CONVEX_POLYGON_VERTICES] {
        let mut vertices = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
        for (index, (x, y)) in points.iter().copied().enumerate() {
            vertices[index] = Transform2D { x, y };
        }
        vertices
    }
}

use crate::entity::Entity;

use super::limits::MAX_CONVEX_POLYGON_VERTICES;
use super::material::PhysicsMaterial;
use super::motion::{Transform2D, Velocity};

const POLYGON_MASS_EPSILON: f32 = 0.0001;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RigidBodyType {
    Static,
    Kinematic,
    Dynamic,
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
            material: PhysicsMaterial::DEFAULT,
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
            material: PhysicsMaterial::DEFAULT,
            can_sleep: false,
            sleep_timer_seconds: 0.0,
            is_sleeping: false,
        }
    }

    pub fn dynamic(mass: f32) -> Self {
        let mass = sanitize_positive_mass_property(mass, 1.0);
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
        if self.body_type == RigidBodyType::Dynamic && valid_positive_mass_property(inertia) {
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

fn sanitize_positive_mass_property(value: f32, fallback: f32) -> f32 {
    if valid_positive_mass_property(value) {
        value
    } else {
        fallback
    }
}

pub(crate) fn valid_positive_mass_property(value: f32) -> bool {
    value.is_finite() && value > 0.0 && (1.0 / value).is_finite()
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

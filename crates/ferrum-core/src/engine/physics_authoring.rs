use crate::collision::CollisionQueryShape;
use crate::components::{
    CollisionLayer, PhysicsMaterial, RigidBody, RigidBodyType, Transform2D, Velocity,
    MAX_CHAIN_COLLIDER_VERTICES, MAX_CONVEX_POLYGON_VERTICES,
};

use super::{
    Engine, PHYSICS_BODY_TYPE_DYNAMIC, PHYSICS_BODY_TYPE_KINEMATIC, PHYSICS_BODY_TYPE_STATIC,
    PHYSICS_EDGE_BODY_RADIUS, PHYSICS_LAYER_BULLET, PHYSICS_LAYER_ENEMY, PHYSICS_LAYER_PICKUP,
    PHYSICS_LAYER_PLAYER, PHYSICS_LAYER_WALL,
};

impl Engine {
    pub(super) fn rigid_body_type_from_code(code: u32) -> Option<RigidBodyType> {
        match code {
            PHYSICS_BODY_TYPE_STATIC => Some(RigidBodyType::Static),
            PHYSICS_BODY_TYPE_KINEMATIC => Some(RigidBodyType::Kinematic),
            PHYSICS_BODY_TYPE_DYNAMIC => Some(RigidBodyType::Dynamic),
            _ => None,
        }
    }

    pub(super) const fn rigid_body_type_code(body_type: RigidBodyType) -> u32 {
        match body_type {
            RigidBodyType::Static => PHYSICS_BODY_TYPE_STATIC,
            RigidBodyType::Kinematic => PHYSICS_BODY_TYPE_KINEMATIC,
            RigidBodyType::Dynamic => PHYSICS_BODY_TYPE_DYNAMIC,
        }
    }

    pub(super) const fn collision_layer_from_code(code: u32) -> CollisionLayer {
        match code {
            PHYSICS_LAYER_ENEMY => CollisionLayer::Enemy,
            PHYSICS_LAYER_BULLET => CollisionLayer::Bullet,
            PHYSICS_LAYER_WALL => CollisionLayer::Wall,
            PHYSICS_LAYER_PICKUP => CollisionLayer::Pickup,
            PHYSICS_LAYER_PLAYER => CollisionLayer::Player,
            _ => CollisionLayer::Player,
        }
    }

    pub(super) fn rigid_body_for_aabb(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        half_width: f32,
        half_height: f32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                let width = half_width * 2.0;
                let height = half_height * 2.0;
                if use_density {
                    RigidBody::dynamic_box_with_density(mass_or_density, width, height)
                } else {
                    RigidBody::dynamic_box(mass_or_density, width, height)
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    pub(super) fn rigid_body_for_circle(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        radius: f32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                if use_density {
                    RigidBody::dynamic_circle_with_density(mass_or_density, radius)
                } else {
                    RigidBody::dynamic_circle(mass_or_density, radius)
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn rigid_body_for_capsule(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        radius: f32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                if use_density {
                    RigidBody::dynamic_capsule_with_density(
                        mass_or_density,
                        start_x,
                        start_y,
                        end_x,
                        end_y,
                        radius,
                    )
                } else {
                    RigidBody::dynamic_capsule(
                        mass_or_density,
                        start_x,
                        start_y,
                        end_x,
                        end_y,
                        radius,
                    )
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn rigid_body_for_edge(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        start_x: f32,
        start_y: f32,
        end_x: f32,
        end_y: f32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                if use_density {
                    RigidBody::dynamic_capsule_with_density(
                        mass_or_density,
                        start_x,
                        start_y,
                        end_x,
                        end_y,
                        PHYSICS_EDGE_BODY_RADIUS,
                    )
                } else {
                    RigidBody::dynamic_capsule(
                        mass_or_density,
                        start_x,
                        start_y,
                        end_x,
                        end_y,
                        PHYSICS_EDGE_BODY_RADIUS,
                    )
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    pub(super) fn rigid_body_for_chain(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        vertices: [Transform2D; MAX_CHAIN_COLLIDER_VERTICES],
        _vertex_count: u32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                let first = vertices[0];
                let second = vertices[1];
                if use_density {
                    RigidBody::dynamic_capsule_with_density(
                        mass_or_density,
                        first.x,
                        first.y,
                        second.x,
                        second.y,
                        PHYSICS_EDGE_BODY_RADIUS,
                    )
                } else {
                    RigidBody::dynamic_capsule(
                        mass_or_density,
                        first.x,
                        first.y,
                        second.x,
                        second.y,
                        PHYSICS_EDGE_BODY_RADIUS,
                    )
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    pub(super) fn rigid_body_for_oriented_box(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        half_width: f32,
        half_height: f32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                if use_density {
                    RigidBody::dynamic_oriented_box_with_density(
                        mass_or_density,
                        half_width,
                        half_height,
                    )
                } else {
                    RigidBody::dynamic_oriented_box(mass_or_density, half_width, half_height)
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    pub(super) fn rigid_body_for_convex_polygon(
        body_type: u32,
        mass_or_density: f32,
        use_density: bool,
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: u32,
        enabled: bool,
        can_sleep: bool,
    ) -> Option<RigidBody> {
        let body_type = Self::rigid_body_type_from_code(body_type)?;
        let body = match body_type {
            RigidBodyType::Static => RigidBody::static_body(),
            RigidBodyType::Kinematic => RigidBody::kinematic(),
            RigidBodyType::Dynamic => {
                if use_density {
                    RigidBody::dynamic_convex_polygon_with_density(
                        mass_or_density,
                        vertices,
                        vertex_count,
                    )
                } else {
                    RigidBody::dynamic_convex_polygon(mass_or_density, vertices, vertex_count)
                }
            }
        };
        Some(body.with_enabled(enabled).with_sleeping_enabled(can_sleep))
    }

    pub(super) fn convex_polygon_vertices(
        vertex_values: &[f32],
    ) -> Option<([Transform2D; MAX_CONVEX_POLYGON_VERTICES], u32)> {
        if !vertex_values.len().is_multiple_of(2) {
            return None;
        }
        let vertex_count = vertex_values.len() / 2;
        if !(3..=MAX_CONVEX_POLYGON_VERTICES).contains(&vertex_count) {
            return None;
        }

        let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
        for (index, coords) in vertex_values.chunks_exact(2).enumerate() {
            if !Self::valid_transform(coords[0], coords[1]) {
                return None;
            }
            vertices[index] = Transform2D {
                x: coords[0],
                y: coords[1],
            };
        }

        Some((vertices, vertex_count as u32))
    }

    pub(super) fn chain_vertices(
        vertex_values: &[f32],
        looped: bool,
    ) -> Option<([Transform2D; MAX_CHAIN_COLLIDER_VERTICES], u32)> {
        if !vertex_values.len().is_multiple_of(2) {
            return None;
        }
        let vertex_count = vertex_values.len() / 2;
        if !(2..=MAX_CHAIN_COLLIDER_VERTICES).contains(&vertex_count) {
            return None;
        }

        let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CHAIN_COLLIDER_VERTICES];
        for (index, coords) in vertex_values.chunks_exact(2).enumerate() {
            if !Self::valid_transform(coords[0], coords[1]) {
                return None;
            }
            vertices[index] = Transform2D {
                x: coords[0],
                y: coords[1],
            };
            if index > 0
                && !Self::valid_edge(
                    vertices[index - 1].x,
                    vertices[index - 1].y,
                    vertices[index].x,
                    vertices[index].y,
                )
            {
                return None;
            }
        }

        if looped
            && vertex_count > 2
            && vertices[vertex_count - 1] != vertices[0]
            && !Self::valid_edge(
                vertices[vertex_count - 1].x,
                vertices[vertex_count - 1].y,
                vertices[0].x,
                vertices[0].y,
            )
        {
            return None;
        }

        Some((vertices, vertex_count as u32))
    }

    pub(super) const fn valid_transform(x: f32, y: f32) -> bool {
        x.is_finite() && y.is_finite()
    }

    pub(super) const fn valid_positive(value: f32) -> bool {
        value.is_finite() && value > 0.0
    }

    pub(super) const fn valid_edge(start_x: f32, start_y: f32, end_x: f32, end_y: f32) -> bool {
        if !Self::valid_transform(start_x, start_y) || !Self::valid_transform(end_x, end_y) {
            return false;
        }
        let dx = end_x - start_x;
        let dy = end_y - start_y;
        dx * dx + dy * dy > PHYSICS_EDGE_BODY_RADIUS * PHYSICS_EDGE_BODY_RADIUS
    }

    pub(super) const fn valid_non_negative(value: f32) -> bool {
        value.is_finite() && value >= 0.0
    }

    pub(super) const fn valid_unit_interval(value: f32) -> bool {
        value.is_finite() && value >= 0.0 && value <= 1.0
    }

    pub(super) const fn valid_break_limit(value: f32) -> bool {
        value.is_infinite() && value.is_sign_positive() || value.is_finite() && value >= 0.0
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) const fn valid_physics_material_parts(
        restitution: f32,
        friction: f32,
        surface_velocity_x: f32,
        surface_velocity_y: f32,
        density: f32,
        contact_baumgarte_bias_scale: f32,
        max_contact_baumgarte_bias_velocity_scale: f32,
        contact_position_correction_scale: f32,
        contact_position_correction_slop_scale: f32,
    ) -> bool {
        Self::valid_non_negative(restitution)
            && Self::valid_non_negative(friction)
            && Self::valid_transform(surface_velocity_x, surface_velocity_y)
            && Self::valid_positive(density)
            && Self::valid_non_negative(contact_baumgarte_bias_scale)
            && Self::valid_non_negative(max_contact_baumgarte_bias_velocity_scale)
            && Self::valid_non_negative(contact_position_correction_scale)
            && Self::valid_non_negative(contact_position_correction_slop_scale)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) const fn physics_material_from_parts(
        restitution: f32,
        friction: f32,
        surface_velocity_x: f32,
        surface_velocity_y: f32,
        density: f32,
        contact_baumgarte_bias_scale: f32,
        max_contact_baumgarte_bias_velocity_scale: f32,
        contact_position_correction_scale: f32,
        contact_position_correction_slop_scale: f32,
    ) -> PhysicsMaterial {
        PhysicsMaterial::new(restitution, friction)
            .with_surface_velocity(Velocity {
                vx: surface_velocity_x,
                vy: surface_velocity_y,
            })
            .with_density(density)
            .with_contact_baumgarte_bias_scale(contact_baumgarte_bias_scale)
            .with_max_contact_baumgarte_bias_velocity_scale(
                max_contact_baumgarte_bias_velocity_scale,
            )
            .with_contact_position_correction_scale(contact_position_correction_scale)
            .with_contact_position_correction_slop_scale(contact_position_correction_slop_scale)
    }

    pub(super) fn convex_polygon_query_shape(vertex_values: &[f32]) -> Option<CollisionQueryShape> {
        if !vertex_values.len().is_multiple_of(2) {
            return None;
        }
        let vertex_count = vertex_values.len() / 2;
        if !(3..=MAX_CONVEX_POLYGON_VERTICES).contains(&vertex_count) {
            return None;
        }

        let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
        for (index, coords) in vertex_values.chunks_exact(2).enumerate() {
            vertices[index] = Transform2D {
                x: coords[0],
                y: coords[1],
            };
        }

        Some(CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count: vertex_count as u32,
        })
    }
}

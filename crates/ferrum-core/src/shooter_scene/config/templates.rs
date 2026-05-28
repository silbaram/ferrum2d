use crate::components::MAX_CONVEX_POLYGON_VERTICES;
use crate::world::{EntityTemplate, EntityTemplateCollider, EntityTemplateColliderShape};

use super::numbers::{finite_or_default, positive_or_default};

pub(super) fn template_or_default(
    width: f32,
    height: f32,
    default: EntityTemplate,
) -> EntityTemplate {
    EntityTemplate::new(
        positive_or_default(width, default.sprite_width),
        positive_or_default(height, default.sprite_height),
    )
}

pub(super) fn template_with_collider_or_default(
    template: EntityTemplate,
    collider: EntityTemplateCollider,
) -> EntityTemplate {
    let default = EntityTemplateCollider::from_template(template);
    template.with_collider(EntityTemplateCollider {
        shape: collider_shape_or_default(collider.shape, default.shape),
        half_width: collider.half_width,
        half_height: collider.half_height,
        offset_x: finite_or_default(collider.offset_x, default.offset_x),
        offset_y: finite_or_default(collider.offset_y, default.offset_y),
        enabled: collider.enabled,
        is_trigger: collider.is_trigger,
        material: collider.material,
    })
}

fn collider_shape_or_default(
    shape: EntityTemplateColliderShape,
    default: EntityTemplateColliderShape,
) -> EntityTemplateColliderShape {
    match shape {
        EntityTemplateColliderShape::Aabb {
            half_width,
            half_height,
        } => EntityTemplateColliderShape::Aabb {
            half_width: positive_shape_or_default(half_width, default_half_width(default)),
            half_height: positive_shape_or_default(half_height, default_half_height(default)),
        },
        EntityTemplateColliderShape::Circle { radius } => {
            if radius.is_finite() && radius > 0.0 {
                shape
            } else {
                default
            }
        }
        EntityTemplateColliderShape::OrientedBox {
            half_width,
            half_height,
            rotation_radians,
        } => {
            if half_width.is_finite()
                && half_width > 0.0
                && half_height.is_finite()
                && half_height > 0.0
                && rotation_radians.is_finite()
            {
                shape
            } else {
                default
            }
        }
        EntityTemplateColliderShape::Capsule {
            start_x,
            start_y,
            end_x,
            end_y,
            radius,
        } => {
            if start_x.is_finite()
                && start_y.is_finite()
                && end_x.is_finite()
                && end_y.is_finite()
                && radius.is_finite()
                && radius > 0.0
            {
                shape
            } else {
                default
            }
        }
        EntityTemplateColliderShape::Edge {
            start_x,
            start_y,
            end_x,
            end_y,
        } => {
            let dx = end_x - start_x;
            let dy = end_y - start_y;
            if start_x.is_finite()
                && start_y.is_finite()
                && end_x.is_finite()
                && end_y.is_finite()
                && dx * dx + dy * dy > 0.0001 * 0.0001
            {
                shape
            } else {
                default
            }
        }
        EntityTemplateColliderShape::ConvexPolygon {
            vertices,
            vertex_count,
            rotation_radians,
        } => {
            let count = vertex_count as usize;
            if (3..=MAX_CONVEX_POLYGON_VERTICES).contains(&count)
                && rotation_radians.is_finite()
                && vertices
                    .iter()
                    .take(count)
                    .all(|vertex| vertex.x.is_finite() && vertex.y.is_finite())
            {
                shape
            } else {
                default
            }
        }
    }
}

fn default_half_width(shape: EntityTemplateColliderShape) -> f32 {
    match shape {
        EntityTemplateColliderShape::Aabb { half_width, .. }
        | EntityTemplateColliderShape::OrientedBox { half_width, .. } => half_width,
        EntityTemplateColliderShape::Circle { radius } => radius,
        EntityTemplateColliderShape::Capsule {
            start_x,
            end_x,
            radius,
            ..
        } => ((start_x - end_x).abs() + radius * 2.0) * 0.5,
        EntityTemplateColliderShape::Edge { start_x, end_x, .. } => (start_x - end_x).abs() * 0.5,
        EntityTemplateColliderShape::ConvexPolygon {
            vertices,
            vertex_count,
            ..
        } => {
            let count = (vertex_count as usize).min(MAX_CONVEX_POLYGON_VERTICES);
            if count == 0 {
                return 0.0;
            }
            let mut min_x = vertices[0].x;
            let mut max_x = vertices[0].x;
            for vertex in vertices.iter().take(count).skip(1) {
                min_x = min_x.min(vertex.x);
                max_x = max_x.max(vertex.x);
            }
            (max_x - min_x) * 0.5
        }
    }
}

fn default_half_height(shape: EntityTemplateColliderShape) -> f32 {
    match shape {
        EntityTemplateColliderShape::Aabb { half_height, .. }
        | EntityTemplateColliderShape::OrientedBox { half_height, .. } => half_height,
        EntityTemplateColliderShape::Circle { radius } => radius,
        EntityTemplateColliderShape::Capsule {
            start_y,
            end_y,
            radius,
            ..
        } => ((start_y - end_y).abs() + radius * 2.0) * 0.5,
        EntityTemplateColliderShape::Edge { start_y, end_y, .. } => (start_y - end_y).abs() * 0.5,
        EntityTemplateColliderShape::ConvexPolygon {
            vertices,
            vertex_count,
            ..
        } => {
            let count = (vertex_count as usize).min(MAX_CONVEX_POLYGON_VERTICES);
            if count == 0 {
                return 0.0;
            }
            let mut min_y = vertices[0].y;
            let mut max_y = vertices[0].y;
            for vertex in vertices.iter().take(count).skip(1) {
                min_y = min_y.min(vertex.y);
                max_y = max_y.max(vertex.y);
            }
            (max_y - min_y) * 0.5
        }
    }
}

fn positive_shape_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        default
    }
}

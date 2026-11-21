//! Convert query geometry, preserving its legacy reference point for sweep outputs.
use super::{
    planar_geometry::{extrusion_depth, rotation},
    UnifiedPhysicsError,
};
use crate::collision::{query_shape_is_valid, query_shape_reference_point, CollisionQueryShape};
use crate::physics3d::{PhysicsError, Pose, Shape};

pub(super) fn convert(query: CollisionQueryShape) -> Result<(Shape, Pose), UnifiedPhysicsError> {
    if !query_shape_is_valid(query) {
        return Err(PhysicsError::InvalidQuery.into());
    }
    let reference = query_shape_reference_point(query);
    let mut pose = Pose {
        position: [reference.x, reference.y, 0.0],
        ..Pose::default()
    };
    let shape = match query {
        CollisionQueryShape::Aabb(bounds) => Shape::Box {
            half_extents: [
                (bounds.max_x - bounds.min_x) * 0.5,
                (bounds.max_y - bounds.min_y) * 0.5,
                extrusion_depth(
                    (bounds.max_x - bounds.min_x) * 0.5,
                    (bounds.max_y - bounds.min_y) * 0.5,
                ),
            ],
        },
        CollisionQueryShape::Circle { radius, .. } => Shape::Sphere { radius },
        CollisionQueryShape::OrientedBox {
            half_width,
            half_height,
            rotation_radians,
            ..
        } => {
            pose.rotation = rotation(rotation_radians);
            Shape::Box {
                half_extents: [
                    half_width,
                    half_height,
                    extrusion_depth(half_width, half_height),
                ],
            }
        }
        CollisionQueryShape::Capsule { start, end, radius } => {
            let dx = end.x - start.x;
            let dy = end.y - start.y;
            pose.rotation = rotation((-dx).atan2(dy));
            Shape::Capsule {
                half_height: dx.hypot(dy) * 0.5,
                radius,
            }
        }
        CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count,
        } => {
            // Center before constructing the hull, so large world offsets do not
            // become shape-local dimensions or degrade hull construction accuracy.
            let depth = vertices[..vertex_count as usize]
                .iter()
                .map(|p| extrusion_depth(p.x - reference.x, p.y - reference.y))
                .fold(1.0, f32::max);
            let points = vertices[..vertex_count as usize]
                .iter()
                .flat_map(|p| {
                    [
                        [p.x - reference.x, p.y - reference.y, -depth],
                        [p.x - reference.x, p.y - reference.y, depth],
                    ]
                })
                .collect();
            Shape::ConvexHull { points }
        }
    };
    Ok((shape, pose))
}

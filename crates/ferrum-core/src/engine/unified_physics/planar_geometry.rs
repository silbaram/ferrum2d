//! Conversion of authored 2D fixtures to planar 3D geometry.
use super::UnifiedPhysicsError;
use crate::components::{
    CollisionFilter, CompoundColliderRef, CompoundColliderShapeRef, PhysicsMaterial,
};
use crate::physics3d::{ColliderDesc, PhysicsError, Pose, Shape, ShapePart};

pub(super) fn rotation(angle: f32) -> [f32; 4] {
    let (s, c) = (angle * 0.5).sin_cos();
    [0.0, 0.0, s, c]
}

pub(super) fn material_supported(m: PhysicsMaterial) -> Result<(), UnifiedPhysicsError> {
    if ![
        m.contact_baumgarte_bias_scale,
        m.max_contact_baumgarte_bias_velocity_scale,
        m.contact_position_correction_scale,
        m.contact_position_correction_slop_scale,
    ]
    .iter()
    .all(|v| v.is_finite() && *v >= 0.0)
    {
        return Err(PhysicsError::InvalidCollider.into());
    }
    Ok(())
}

fn correction(
    m: PhysicsMaterial,
    config: crate::physics::RigidBodyStepConfig,
    dt: f32,
) -> Result<crate::physics3d::ContactCorrection, UnifiedPhysicsError> {
    material_supported(m)?;
    let correction = crate::physics3d::ContactCorrection {
        velocity_rate: config.contact_baumgarte_bias_factor * m.contact_baumgarte_bias_scale / dt,
        max_velocity: config.max_contact_baumgarte_bias_velocity
            * m.max_contact_baumgarte_bias_velocity_scale,
        position_rate: config.position_correction_percent * m.contact_position_correction_scale
            / dt,
        position_slop: config.position_correction_slop * m.contact_position_correction_slop_scale,
        velocity_slop: config.position_correction_slop,
        split_impulse: config.contact_split_impulse,
    };
    correction.validate()?;
    Ok(correction)
}

// Fixtures now have body-local poses in the single 3D world, including their offsets.
// Planar mass does not come from these extruded volumes: it is authored on the body.
pub(super) fn fixture(
    source: CompoundColliderRef<'_>,
    default_material: PhysicsMaterial,
    config: crate::physics::RigidBodyStepConfig,
    dt: f32,
) -> Result<ColliderDesc, UnifiedPhysicsError> {
    let (shape, x, y, angle) = match source.shape {
        CompoundColliderShapeRef::Aabb(c) => (
            Shape::Box {
                half_extents: [
                    c.half_width,
                    c.half_height,
                    extrusion_depth(c.half_width, c.half_height),
                ],
            },
            c.offset_x,
            c.offset_y,
            0.0,
        ),
        CompoundColliderShapeRef::Circle(c) => (
            Shape::Sphere { radius: c.radius },
            c.offset_x,
            c.offset_y,
            0.0,
        ),
        CompoundColliderShapeRef::OrientedBox(c) => (
            Shape::Box {
                half_extents: [
                    c.half_width,
                    c.half_height,
                    extrusion_depth(c.half_width, c.half_height),
                ],
            },
            c.offset_x,
            c.offset_y,
            c.rotation_radians,
        ),
        CompoundColliderShapeRef::Capsule(c) => capsule(
            c.start_x,
            c.start_y,
            c.end_x,
            c.end_y,
            c.radius,
            [c.offset_x, c.offset_y],
        ),
        CompoundColliderShapeRef::Edge(c) => capsule(
            c.start_x,
            c.start_y,
            c.end_x,
            c.end_y,
            0.0001,
            [c.offset_x, c.offset_y],
        ),
        CompoundColliderShapeRef::Chain(c) => {
            if c.vertex_count as usize > c.vertices.len()
                || c.segment_count() == 0
                || c.segment_count() > 64
            {
                return Err(PhysicsError::InvalidCollider.into());
            }
            let mut parts = Vec::with_capacity(c.segment_count());
            for i in 0..c.segment_count() {
                let edge = c.segment(i).ok_or(PhysicsError::InvalidCollider)?;
                let (shape, x, y, angle) = capsule(
                    edge.start_x,
                    edge.start_y,
                    edge.end_x,
                    edge.end_y,
                    0.0001,
                    [0.0; 2],
                );
                parts.push(ShapePart {
                    shape,
                    pose: Pose {
                        position: [x, y, 0.0],
                        rotation: rotation(angle),
                    },
                });
            }
            (Shape::Compound { parts }, c.offset_x, c.offset_y, 0.0)
        }
        CompoundColliderShapeRef::ConvexPolygon(c) => {
            if c.vertex_count < 3 || c.vertex_count as usize > c.vertices.len() {
                return Err(PhysicsError::InvalidCollider.into());
            }
            if !crate::collision::convex_polygon_is_valid(&c.vertices[..c.vertex_count as usize]) {
                return Err(PhysicsError::InvalidCollider.into());
            }
            let depth = c.vertices[..c.vertex_count as usize]
                .iter()
                .map(|p| extrusion_depth(p.x, p.y))
                .fold(1.0, f32::max);
            let points = c.vertices[..c.vertex_count as usize]
                .iter()
                .flat_map(|p| [[p.x, p.y, -depth], [p.x, p.y, depth]])
                .collect();
            (
                Shape::ConvexHull { points },
                c.offset_x,
                c.offset_y,
                c.rotation_radians,
            )
        }
    };
    let m = source.material().unwrap_or(default_material);
    material_supported(m)?;
    let filter = source
        .filter()
        .unwrap_or_else(|| CollisionFilter::from_layer(source.layer()));
    Ok(ColliderDesc {
        shape,
        pose: Pose {
            position: [x, y, 0.0],
            rotation: rotation(angle),
        },
        density: 0.0,
        friction: m.friction,
        restitution: m.restitution,
        surface_velocity: [m.surface_velocity.vx, m.surface_velocity.vy, 0.0],
        contact_correction: Some(correction(m, config, dt)?),
        sensor: source.is_trigger(),
        category: filter.category.bits,
        mask: filter.mask.bits,
    })
}

fn capsule(
    sx: f32,
    sy: f32,
    ex: f32,
    ey: f32,
    radius: f32,
    offset: [f32; 2],
) -> (Shape, f32, f32, f32) {
    let dx = ex - sx;
    let dy = ey - sy;
    (
        Shape::Capsule {
            half_height: dx.hypot(dy) * 0.5,
            radius,
        },
        (sx + ex) * 0.5 + offset[0],
        (sy + ey) * 0.5 + offset[1],
        (-dx).atan2(dy),
    )
}

// Exceed every XY support radius so a deeply overlapping pair of authored planar
// polygons cannot choose an unresolvable Z face. Mass/inertia remain authored.
pub(super) fn extrusion_depth(x: f32, y: f32) -> f32 {
    x.hypot(y) + 1.0
}

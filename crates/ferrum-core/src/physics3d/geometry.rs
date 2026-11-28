use super::types::{valid_pose, valid_vector, validate_plane};
use super::world::native_pose;
use super::{BodyKind, ColliderDesc, PhysicsError, Pose, Shape, Space};
use rapier3d::{
    parry::{shape::TypedShape, utils::Array2},
    prelude as rp,
};

pub(in crate::physics3d) fn same_pose_bits(a: rp::Pose, b: rp::Pose) -> bool {
    a.translation.to_array().map(f32::to_bits) == b.translation.to_array().map(f32::to_bits)
        && a.rotation.to_array().map(f32::to_bits) == b.rotation.to_array().map(f32::to_bits)
}

pub(super) fn positive(v: f32) -> bool {
    v.is_finite() && (0.0001..=10000.0).contains(&v)
}

fn valid_point(v: &[f32; 3]) -> bool {
    v.iter().all(|n| n.is_finite() && n.abs() <= 10000.0)
}

pub(super) fn is_convex(shape: &Shape) -> bool {
    matches!(
        shape,
        Shape::Box { .. } | Shape::Sphere { .. } | Shape::Capsule { .. } | Shape::ConvexHull { .. }
    )
}

pub(super) fn collider_builder(
    desc: &ColliderDesc,
    kind: BodyKind,
    space: Space,
) -> Result<rp::ColliderBuilder, PhysicsError> {
    if !valid_pose(desc.pose)
        || !desc.density.is_finite()
        || !(0.0..=10000.0).contains(&desc.density)
        || !desc.friction.is_finite()
        || !(0.0..=10.0).contains(&desc.friction)
        || !desc.restitution.is_finite()
        || !(0.0..=1.0).contains(&desc.restitution)
        || !valid_vector(&desc.surface_velocity)
    {
        return Err(PhysicsError::InvalidCollider);
    }
    if let Some(correction) = desc.contact_correction {
        correction.validate()?;
    }
    validate_plane(space, desc.pose, desc.surface_velocity, [0.0; 3])?;
    if kind == BodyKind::Dynamic
        && matches!(
            desc.shape,
            Shape::TriangleMesh { .. } | Shape::Heightfield { .. }
        )
    {
        return Err(PhysicsError::UnsupportedShape);
    }
    let shape = shared_shape(&desc.shape, space)?;
    let mut collision_types = rp::ActiveCollisionTypes::default()
        | rp::ActiveCollisionTypes::KINEMATIC_FIXED
        | rp::ActiveCollisionTypes::KINEMATIC_KINEMATIC;
    if desc.sensor {
        collision_types = rp::ActiveCollisionTypes::all();
    }
    Ok(rp::ColliderBuilder::new(shape)
        .position(native_pose(desc.pose))
        .density(desc.density)
        // Store sqrt(mu) with native Multiply to obtain sqrt(mu_a * mu_b)
        // without a per-contact hook on ordinary materials.
        .friction(desc.friction.sqrt())
        .friction_combine_rule(rp::CoefficientCombineRule::Multiply)
        .restitution(desc.restitution)
        .restitution_combine_rule(rp::CoefficientCombineRule::Max)
        .sensor(desc.sensor)
        .active_events(rp::ActiveEvents::COLLISION_EVENTS | rp::ActiveEvents::CONTACT_FORCE_EVENTS)
        .contact_force_event_threshold(0.0)
        .active_collision_types(collision_types)
        .collision_groups(groups(desc.category, desc.mask)))
}

pub(super) fn groups(category: u32, mask: u32) -> rp::InteractionGroups {
    rp::InteractionGroups::new(
        rp::Group::from_bits_truncate(category),
        rp::Group::from_bits_truncate(mask),
        rp::InteractionTestMode::And,
    )
}

pub(super) fn shared_shape(shape: &Shape, space: Space) -> Result<rp::SharedShape, PhysicsError> {
    match shape {
        Shape::Box {
            half_extents: [x, y, z],
        } if valid_box_extents([*x, *y, *z], space, 0.0001) => {
            Ok(rp::SharedShape::cuboid(*x, *y, *z))
        }
        Shape::Sphere { radius } if positive(*radius) => Ok(rp::SharedShape::ball(*radius)),
        Shape::Capsule {
            half_height,
            radius,
        } if half_height.is_finite()
            && (0.0..=10000.0).contains(half_height)
            && positive(*radius) =>
        {
            Ok(rp::SharedShape::capsule_y(*half_height, *radius))
        }
        Shape::ConvexHull { points } => {
            if !(4..=256).contains(&points.len())
                || !points.iter().all(|p| valid_hull_point(p, space))
            {
                return Err(PhysicsError::InvalidCollider);
            }
            let points: Vec<_> = points.iter().copied().map(rp::Vector::from).collect();
            let shape =
                rp::SharedShape::convex_hull(&points).ok_or(PhysicsError::InvalidCollider)?;
            // The backend can construct a flat hull; a rigid body needs positive volume.
            if shape.mass_properties(1.0).mass() <= 1.0e-12 {
                return Err(PhysicsError::InvalidCollider);
            }
            Ok(shape)
        }
        Shape::TriangleMesh {
            vertices,
            triangles,
        } => {
            if !(3..=65536).contains(&vertices.len())
                || !(1..=131072).contains(&triangles.len())
                || !vertices.iter().all(valid_point)
            {
                return Err(PhysicsError::InvalidCollider);
            }
            for &[a, b, c] in triangles {
                let [Some(a), Some(b), Some(c)] = [
                    vertices.get(a as usize),
                    vertices.get(b as usize),
                    vertices.get(c as usize),
                ] else {
                    return Err(PhysicsError::InvalidCollider);
                };
                let ab = rp::Vector::from(*b) - rp::Vector::from(*a);
                let ac = rp::Vector::from(*c) - rp::Vector::from(*a);
                if ab.cross(ac).length_squared() <= 1.0e-16 {
                    return Err(PhysicsError::InvalidCollider);
                }
            }
            // Adjacent triangles must not produce ghost edge normals on a flat floor.
            // Keep back-face contacts for bridge undersides and two-sided authored surfaces.
            rp::SharedShape::trimesh_with_flags(
                vertices.iter().copied().map(rp::Vector::from).collect(),
                triangles.clone(),
                rapier3d::parry::shape::TriMeshFlags::FIX_INTERNAL_EDGES_TWO_SIDED,
            )
            .map_err(|_| PhysicsError::InvalidCollider)
        }
        Shape::Heightfield {
            rows,
            columns,
            heights,
            size,
        } => {
            if *rows < 2
                || *columns < 2
                || rows.checked_mul(*columns) != Some(heights.len())
                || heights.len() > 65536
                || !heights.iter().all(|v| v.is_finite() && v.abs() <= 10000.0)
                || !size.iter().copied().all(positive)
            {
                return Err(PhysicsError::InvalidCollider);
            }
            let samples = Array2::from_fn(*rows, *columns, |r, c| heights[r * columns + c]);
            Ok(rp::SharedShape::heightfield_with_flags(
                samples,
                rp::Vector::new(size[0], 1.0, size[1]),
                rapier3d::parry::shape::HeightFieldFlags::FIX_INTERNAL_EDGES,
            ))
        }
        Shape::Compound { parts } => {
            if !(1..=64).contains(&parts.len()) {
                return Err(PhysicsError::InvalidCollider);
            }
            let mut native_parts = Vec::with_capacity(parts.len());
            for part in parts {
                if !is_convex(&part.shape) {
                    return Err(PhysicsError::UnsupportedShape);
                }
                if !valid_pose(part.pose) {
                    return Err(PhysicsError::InvalidCollider);
                }
                validate_plane(space, part.pose, [0.0; 3], [0.0; 3])?;
                native_parts.push((native_pose(part.pose), shared_shape(&part.shape, space)?));
            }
            Ok(rp::SharedShape::compound(native_parts))
        }
        _ => Err(PhysicsError::InvalidCollider),
    }
}

// Planar authoring extrudes a <=10000 XY radius out to its diagonal plus a margin.
// Permit that derived depth without expanding spatial geometry or XY input bounds.
pub(super) fn valid_box_extents(v: [f32; 3], space: Space, min: f32) -> bool {
    v.into_iter().enumerate().all(|(axis, n)| {
        n.is_finite()
            && (min..=if axis == 2 && space == Space::PlanarXy {
                30000.0
            } else {
                10000.0
            })
                .contains(&n)
    })
}
fn valid_hull_point(v: &[f32; 3], space: Space) -> bool {
    v.iter().enumerate().all(|(axis, n)| {
        n.is_finite()
            && n.abs()
                <= if axis == 2 && space == Space::PlanarXy {
                    30000.0
                } else {
                    10000.0
                }
    })
}

/// Restored native geometry must stay inside the domain `shared_shape` admits.
/// Backend storage checks only prove finite, well-linked records; an
/// out-of-domain cuboid or hull still reaches narrow-phase EPA on the next step.
pub(super) fn valid_native_shape(shape: &dyn rp::Shape, space: Space) -> bool {
    match shape.as_typed_shape() {
        TypedShape::Compound(compound) => {
            let parts = compound.shapes();
            (1..=64).contains(&parts.len())
                && parts.iter().all(|(pose, part)| {
                    valid_native_pose(pose, space) && valid_native_convex(part.as_ref(), space)
                })
        }
        TypedShape::TriMesh(mesh) => {
            let vertices = mesh.vertices();
            (3..=65536).contains(&vertices.len())
                && (1..=131072).contains(&mesh.indices().len())
                && vertices.iter().all(|v| valid_point(&v.to_array()))
                && mesh.indices().iter().all(|&[a, b, c]| {
                    let [Some(a), Some(b), Some(c)] = [a, b, c].map(|i| vertices.get(i as usize))
                    else {
                        return false;
                    };
                    (*b - *a).cross(*c - *a).length_squared() > 1.0e-16
                })
        }
        TypedShape::HeightField(field) => {
            let (heights, scale) = (field.heights(), field.scale());
            heights.nrows() >= 2
                && heights.ncols() >= 2
                && heights.data().len() <= 65536
                && heights
                    .data()
                    .iter()
                    .all(|v| v.is_finite() && v.abs() <= 10000.0)
                && positive(scale.x)
                && scale.y == 1.0
                && positive(scale.z)
        }
        _ => valid_native_convex(shape, space),
    }
}

fn valid_native_convex(shape: &dyn rp::Shape, space: Space) -> bool {
    match shape.as_typed_shape() {
        TypedShape::Cuboid(cuboid) => {
            valid_box_extents(cuboid.half_extents.to_array(), space, 0.0001)
        }
        TypedShape::Ball(ball) => positive(ball.radius),
        TypedShape::Capsule(capsule) => {
            // Public authoring builds only local-Y capsules (`capsule_y`).
            let (a, b) = (capsule.segment.a, capsule.segment.b);
            a.x == 0.0
                && a.z == 0.0
                && b.x == 0.0
                && b.z == 0.0
                && a.y == -b.y
                && b.y.is_finite()
                && (0.0..=10000.0).contains(&b.y)
                && positive(capsule.radius)
        }
        TypedShape::ConvexPolyhedron(hull) => {
            (4..=256).contains(&hull.points().len())
                && hull
                    .points()
                    .iter()
                    .all(|p| valid_hull_point(&p.to_array(), space))
        }
        _ => false,
    }
}

pub(super) fn valid_native_pose(pose: &rp::Pose, space: Space) -> bool {
    let pose = Pose {
        position: pose.translation.to_array(),
        rotation: pose.rotation.to_array(),
    };
    valid_pose(pose) && validate_plane(space, pose, [0.0; 3], [0.0; 3]).is_ok()
}

// Ferrum2D modified source; see FERRUM-PATCHES.md.
use super::DeserializableTypedShape as S;
use crate::math::{Real, Vector};

pub(super) fn nonnegative(n: Real) -> bool {
    n.is_finite() && n >= 0.0
}
pub(super) fn unit(n: Vector) -> bool {
    n.is_finite() && (n.length_squared() - 1.0).abs() <= 1.0e-3
}
pub(super) fn valid_primitive(shape: &S) -> bool {
    match shape {
        S::Ball(s) => nonnegative(s.radius),
        S::Cuboid(s) => s.half_extents.is_finite() && s.half_extents.cmpge(Vector::ZERO).all(),
        S::Capsule(s) => {
            nonnegative(s.radius) && s.segment.a.is_finite() && s.segment.b.is_finite()
        }
        S::Segment(s) => s.a.is_finite() && s.b.is_finite(),
        S::Triangle(s) => s.a.is_finite() && s.b.is_finite() && s.c.is_finite(),
        S::HalfSpace(s) => unit(s.normal),
        #[cfg(feature = "dim3")]
        S::Cylinder(s) => nonnegative(s.radius) && nonnegative(s.half_height),
        #[cfg(feature = "dim3")]
        S::Cone(s) => nonnegative(s.radius) && nonnegative(s.half_height),
        S::RoundCuboid(s) => {
            nonnegative(s.border_radius)
                && s.inner_shape.half_extents.is_finite()
                && s.inner_shape.half_extents.cmpge(Vector::ZERO).all()
        }
        S::RoundTriangle(s) => {
            nonnegative(s.border_radius)
                && s.inner_shape.a.is_finite()
                && s.inner_shape.b.is_finite()
                && s.inner_shape.c.is_finite()
        }
        #[cfg(feature = "dim3")]
        S::RoundCylinder(s) => {
            nonnegative(s.border_radius)
                && nonnegative(s.inner_shape.radius)
                && nonnegative(s.inner_shape.half_height)
        }
        #[cfg(feature = "dim3")]
        S::RoundCone(s) => {
            nonnegative(s.border_radius)
                && nonnegative(s.inner_shape.radius)
                && nonnegative(s.inner_shape.half_height)
        }
        #[cfg(all(feature = "dim3", feature = "alloc"))]
        S::RoundConvexPolyhedron(s) => nonnegative(s.border_radius),
        // This guard covers primitives only. TriMesh, ConvexPolyhedron,
        // Compound and HeightField have separate storage checks; other
        // variants are not an arbitrary-file import boundary.
        _ => true,
    }
}

use crate::components::{AabbCollider, CircleCollider, Transform2D, MAX_CONVEX_POLYGON_VERTICES};
use crate::entity::Entity;

use super::MAX_COLLISION_MANIFOLD_POINTS;

const _: () = assert!(core::mem::size_of::<PhysicsDebugLine>() == 32);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CollisionPair {
    pub a: Entity,
    pub b: Entity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ColliderKey {
    pub entity_index: usize,
    pub collider_index: usize,
    pub segment_index: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ColliderPair {
    pub a: ColliderKey,
    pub b: ColliderKey,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AabbBounds {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
}

impl AabbBounds {
    pub fn from_min_max(min_x: f32, min_y: f32, max_x: f32, max_y: f32) -> Option<Self> {
        if min_x.is_finite()
            && min_y.is_finite()
            && max_x.is_finite()
            && max_y.is_finite()
            && min_x <= max_x
            && min_y <= max_y
        {
            Some(Self {
                min_x,
                min_y,
                max_x,
                max_y,
            })
        } else {
            None
        }
    }

    pub fn from_center(center: Transform2D, half_width: f32, half_height: f32) -> Option<Self> {
        if center.x.is_finite()
            && center.y.is_finite()
            && half_width.is_finite()
            && half_height.is_finite()
            && half_width >= 0.0
            && half_height >= 0.0
        {
            Some(Self {
                min_x: center.x - half_width,
                min_y: center.y - half_height,
                max_x: center.x + half_width,
                max_y: center.y + half_height,
            })
        } else {
            None
        }
    }

    pub fn from_transform(transform: Transform2D, collider: AabbCollider) -> Self {
        let center = collider.center(transform);
        Self {
            min_x: center.x - collider.half_width,
            min_y: center.y - collider.half_height,
            max_x: center.x + collider.half_width,
            max_y: center.y + collider.half_height,
        }
    }

    pub fn from_circle(transform: Transform2D, collider: CircleCollider) -> Self {
        let center = collider.center(transform);
        Self {
            min_x: center.x - collider.radius,
            min_y: center.y - collider.radius,
            max_x: center.x + collider.radius,
            max_y: center.y + collider.radius,
        }
    }

    pub fn swept(start: Transform2D, end: Transform2D, collider: AabbCollider) -> Self {
        let start_bounds = Self::from_transform(start, collider);
        let end_bounds = Self::from_transform(end, collider);
        Self {
            min_x: start_bounds.min_x.min(end_bounds.min_x),
            min_y: start_bounds.min_y.min(end_bounds.min_y),
            max_x: start_bounds.max_x.max(end_bounds.max_x),
            max_y: start_bounds.max_y.max(end_bounds.max_y),
        }
    }

    pub fn overlaps(self, other: Self) -> bool {
        self.min_x <= other.max_x
            && self.max_x >= other.min_x
            && self.min_y <= other.max_y
            && self.max_y >= other.min_y
    }

    pub fn contains_point(self, point: Transform2D) -> bool {
        point.x >= self.min_x
            && point.x <= self.max_x
            && point.y >= self.min_y
            && point.y <= self.max_y
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SweptAabbHit {
    pub time: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SweptAabbContactHit {
    pub time: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SweptShapeContactHit {
    pub time: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AabbContact {
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CollisionContact {
    pub pair: CollisionPair,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point_x: f32,
    pub point_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CollisionContactPoint {
    pub point_x: f32,
    pub point_y: f32,
    pub penetration: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CollisionManifold {
    pub pair: CollisionPair,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point_count: u32,
    pub points: [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
}

impl CollisionManifold {
    pub fn points(&self) -> &[CollisionContactPoint] {
        let point_count = (self.point_count as usize).min(MAX_COLLISION_MANIFOLD_POINTS);
        &self.points[..point_count]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ColliderCollisionContact {
    pub collider_pair: ColliderPair,
    pub contact: CollisionContact,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ColliderCollisionManifold {
    pub collider_pair: ColliderPair,
    pub manifold: CollisionManifold,
}

impl ColliderCollisionManifold {
    pub fn points(&self) -> &[CollisionContactPoint] {
        self.manifold.points()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PointQueryHit {
    pub entity: Entity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AabbQueryHit {
    pub entity: Entity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CircleQueryHit {
    pub entity: Entity,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CollisionQueryShape {
    Aabb(AabbBounds),
    Circle {
        center: Transform2D,
        radius: f32,
    },
    OrientedBox {
        center: Transform2D,
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
    },
    Capsule {
        start: Transform2D,
        end: Transform2D,
        radius: f32,
    },
    ConvexPolygon {
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: u32,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ShapeQueryHit {
    pub entity: Entity,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NearestBodyQueryHit {
    pub entity: Entity,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShapeCastHit {
    pub entity: Entity,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PhysicsDebugLine {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RaycastHit {
    pub entity: Entity,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

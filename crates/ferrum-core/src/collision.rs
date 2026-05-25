use crate::components::{
    AabbCollider, CapsuleCollider, ChainCollider, CircleCollider, CollisionLayer, CollisionMask,
    CompoundCollider, CompoundColliderShape, ConvexPolygonCollider, EdgeCollider,
    OrientedBoxCollider, PulleyJoint, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::world::World;

const SWEPT_EPSILON: f32 = 0.0001;
const RAY_EPSILON: f32 = 0.0001;
const EDGE_COLLIDER_RADIUS: f32 = RAY_EPSILON;
const CONTACT_DEBUG_COLOR: [f32; 4] = [1.0, 0.2, 0.1, 1.0];
const BROADPHASE_DEBUG_COLOR: [f32; 4] = [0.1, 0.75, 1.0, 0.55];
const COLLIDER_AWAKE_DEBUG_COLOR: [f32; 4] = [0.2, 0.85, 0.35, 0.9];
const COLLIDER_SLEEPING_DEBUG_COLOR: [f32; 4] = [0.45, 0.55, 0.65, 0.75];
const JOINT_DEBUG_COLOR: [f32; 4] = [0.95, 0.75, 0.15, 0.9];
const CCD_HIT_DEBUG_COLOR: [f32; 4] = [1.0, 0.45, 0.05, 1.0];
const CONTACT_POINT_MARKER_SIZE: f32 = 3.0;
const CCD_HIT_MARKER_SIZE: f32 = 4.0;
const CCD_HIT_NORMAL_LENGTH: f32 = 12.0;
pub const MAX_COLLISION_MANIFOLD_POINTS: usize = 2;
pub use crate::components::MAX_CONVEX_POLYGON_VERTICES;
pub const PHYSICS_DEBUG_BROADPHASE: u32 = 1 << 0;
pub const PHYSICS_DEBUG_CONTACTS: u32 = 1 << 1;
pub const PHYSICS_DEBUG_COLLIDERS: u32 = 1 << 2;
pub const PHYSICS_DEBUG_JOINTS: u32 = 1 << 3;
pub const PHYSICS_DEBUG_SLEEPING: u32 = 1 << 4;
pub const PHYSICS_DEBUG_CCD: u32 = 1 << 5;
pub const PHYSICS_DEBUG_DEFAULT: u32 = PHYSICS_DEBUG_BROADPHASE | PHYSICS_DEBUG_CONTACTS;

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

#[derive(Clone, Copy, Debug)]
struct CollisionProxy {
    key: ColliderKey,
    bounds: AabbBounds,
}

#[derive(Clone, Copy, Debug)]
struct AxisEntryExit {
    entry: f32,
    exit: f32,
    normal: f32,
}

#[derive(Clone, Copy, Debug)]
struct RaycastBoundsHit {
    distance: f32,
    normal_x: f32,
    normal_y: f32,
}

#[derive(Clone, Copy, Debug)]
struct ShapeCastMotion {
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
}

#[derive(Clone, Copy, Debug)]
struct MovingAxisEntryExit {
    entry: f32,
    exit: f32,
    normal_x: f32,
    normal_y: f32,
}

#[derive(Clone, Copy, Debug)]
struct ClosestPointPair {
    a: Transform2D,
    b: Transform2D,
    distance_squared: f32,
}

#[derive(Clone, Copy, Debug)]
struct SegmentFrame {
    origin: Transform2D,
    axis_x: f32,
    axis_y: f32,
    normal_x: f32,
    normal_y: f32,
    length: f32,
}

#[derive(Clone, Copy, Debug)]
struct OrientedBoxGeometry {
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    axis_x_x: f32,
    axis_x_y: f32,
    axis_y_x: f32,
    axis_y_y: f32,
}

#[derive(Clone, Copy, Debug)]
struct ContactFace {
    center: Transform2D,
    normal: Velocity,
    tangent: Velocity,
    tangent_extent: f32,
}

#[derive(Clone, Copy, Debug)]
struct TangentInterval {
    min: f32,
    max: f32,
}

#[derive(Clone, Copy, Debug)]
enum ConvexContactGeometry {
    Polygon {
        vertices: [Transform2D; MAX_CONVEX_POLYGON_VERTICES],
        vertex_count: usize,
        center: Transform2D,
    },
    Circle {
        center: Transform2D,
        radius: f32,
    },
    Capsule {
        start: Transform2D,
        end: Transform2D,
        radius: f32,
        center: Transform2D,
    },
}

#[derive(Clone, Copy, Debug)]
pub(crate) enum ColliderShapeRef {
    Aabb(AabbCollider),
    Circle(CircleCollider),
    OrientedBox(OrientedBoxCollider, f32),
    Capsule(CapsuleCollider),
    Edge(EdgeCollider),
    ConvexPolygon(ConvexPolygonCollider, f32),
}

impl ColliderShapeRef {
    pub(crate) const fn is_trigger(self) -> bool {
        match self {
            Self::Aabb(collider) => collider.is_trigger,
            Self::Circle(collider) => collider.is_trigger,
            Self::OrientedBox(collider, _) => collider.is_trigger,
            Self::Capsule(collider) => collider.is_trigger,
            Self::Edge(collider) => collider.is_trigger,
            Self::ConvexPolygon(collider, _) => collider.is_trigger,
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum PairFilter {
    All,
    Layers(CollisionLayer, CollisionLayer),
    Masks(CollisionMask, CollisionMask),
}

#[derive(Default, Debug)]
pub(crate) struct CollisionScratch {
    current_proxies: Vec<CollisionProxy>,
    moving_proxies: Vec<CollisionProxy>,
    target_proxies: Vec<CollisionProxy>,
}

#[derive(Default)]
pub struct CollisionSystem;

impl CollisionSystem {
    pub fn overlaps(at: Transform2D, ac: AabbCollider, bt: Transform2D, bc: AabbCollider) -> bool {
        if !ac.enabled || !bc.enabled {
            return false;
        }
        AabbBounds::from_transform(at, ac).overlaps(AabbBounds::from_transform(bt, bc))
    }

    pub fn aabb_contact(
        at: Transform2D,
        ac: AabbCollider,
        bt: Transform2D,
        bc: AabbCollider,
    ) -> Option<AabbContact> {
        aabb_contact(at, ac, bt, bc)
    }

    pub fn swept_aabb_time(
        moving_start: Transform2D,
        moving_velocity: Velocity,
        moving_collider: AabbCollider,
        target_start: Transform2D,
        target_velocity: Velocity,
        target_collider: AabbCollider,
        delta: f32,
    ) -> Option<SweptAabbHit> {
        Self::swept_aabb_contact(
            moving_start,
            moving_velocity,
            moving_collider,
            target_start,
            target_velocity,
            target_collider,
            delta,
        )
        .map(|hit| SweptAabbHit { time: hit.time })
    }

    pub fn swept_aabb_contact(
        moving_start: Transform2D,
        moving_velocity: Velocity,
        moving_collider: AabbCollider,
        target_start: Transform2D,
        target_velocity: Velocity,
        target_collider: AabbCollider,
        delta: f32,
    ) -> Option<SweptAabbContactHit> {
        if !moving_collider.enabled || !target_collider.enabled {
            return None;
        }
        if !is_valid_delta(delta) {
            return aabb_contact(moving_start, moving_collider, target_start, target_collider).map(
                |contact| SweptAabbContactHit {
                    time: 0.0,
                    normal_x: contact.normal_x,
                    normal_y: contact.normal_y,
                },
            );
        }

        if let Some(contact) =
            aabb_contact(moving_start, moving_collider, target_start, target_collider)
        {
            return Some(SweptAabbContactHit {
                time: 0.0,
                normal_x: contact.normal_x,
                normal_y: contact.normal_y,
            });
        }

        let relative_dx = (moving_velocity.vx - target_velocity.vx) * delta;
        let relative_dy = (moving_velocity.vy - target_velocity.vy) * delta;
        let moving_center = moving_collider.center(moving_start);
        let target_center = target_collider.center(target_start);
        let expanded = AabbBounds {
            min_x: target_center.x - target_collider.half_width - moving_collider.half_width,
            min_y: target_center.y - target_collider.half_height - moving_collider.half_height,
            max_x: target_center.x + target_collider.half_width + moving_collider.half_width,
            max_y: target_center.y + target_collider.half_height + moving_collider.half_height,
        };
        let x = axis_entry_exit(moving_center.x, relative_dx, expanded.min_x, expanded.max_x)?;
        let y = axis_entry_exit(moving_center.y, relative_dy, expanded.min_y, expanded.max_y)?;
        let entry = x.entry.max(y.entry);
        let (normal_x, normal_y) = if x.entry > y.entry {
            (x.normal, 0.0)
        } else if y.entry > x.entry {
            (0.0, y.normal)
        } else if relative_dx.abs() >= relative_dy.abs() {
            (x.normal, 0.0)
        } else {
            (0.0, y.normal)
        };
        let exit_x = x.exit;
        let exit_y = y.exit;
        let exit = exit_x.min(exit_y);

        if entry <= exit && exit >= 0.0 && entry <= 1.0 {
            Some(SweptAabbContactHit {
                time: entry.max(0.0),
                normal_x,
                normal_y,
            })
        } else {
            None
        }
    }

    pub(crate) fn swept_shape_contact(
        moving_start: Transform2D,
        moving_velocity: Velocity,
        moving_shape: ColliderShapeRef,
        target_start: Transform2D,
        target_velocity: Velocity,
        target_shape: ColliderShapeRef,
        delta: f32,
    ) -> Option<SweptShapeContactHit> {
        if !collider_shape_is_valid(moving_shape) || !collider_shape_is_valid(target_shape) {
            return None;
        }
        if !is_valid_delta(delta) {
            return shape_contact(moving_start, moving_shape, target_start, target_shape).map(
                |contact| SweptShapeContactHit {
                    time: 0.0,
                    normal_x: contact.normal_x,
                    normal_y: contact.normal_y,
                },
            );
        }

        if let Some(contact) = shape_contact(moving_start, moving_shape, target_start, target_shape)
        {
            return Some(SweptShapeContactHit {
                time: 0.0,
                normal_x: contact.normal_x,
                normal_y: contact.normal_y,
            });
        }

        let relative_dx = (moving_velocity.vx - target_velocity.vx) * delta;
        let relative_dy = (moving_velocity.vy - target_velocity.vy) * delta;
        let max_distance = (relative_dx * relative_dx + relative_dy * relative_dy).sqrt();
        if !max_distance.is_finite() || max_distance <= RAY_EPSILON {
            return None;
        }

        let unit_x = relative_dx / max_distance;
        let unit_y = relative_dy / max_distance;
        let query_shape = collider_query_shape(moving_start, moving_shape)?;
        let hit = shape_cast_hit(
            query_shape,
            unit_x,
            unit_y,
            max_distance,
            target_start,
            target_shape,
        )?;
        let (normal_x, normal_y) = swept_shape_contact_normal(
            moving_start,
            moving_shape,
            target_start,
            target_shape,
            unit_x,
            unit_y,
            hit,
        );

        Some(SweptShapeContactHit {
            time: (hit.distance / max_distance).clamp(0.0, 1.0),
            normal_x,
            normal_y,
        })
    }

    pub(crate) fn shapes_overlap(
        at: Transform2D,
        ac: ColliderShapeRef,
        bt: Transform2D,
        bc: ColliderShapeRef,
    ) -> bool {
        shapes_overlap(at, ac, bt, bc)
    }

    pub fn point_query(
        world: &World,
        point: Transform2D,
        query_mask: CollisionMask,
    ) -> Vec<PointQueryHit> {
        let mut hits = Vec::new();
        Self::point_query_into(world, point, query_mask, &mut hits);
        hits
    }

    pub fn aabb_query(
        world: &World,
        bounds: AabbBounds,
        query_mask: CollisionMask,
    ) -> Vec<AabbQueryHit> {
        let mut hits = Vec::new();
        Self::aabb_query_into(world, bounds, query_mask, &mut hits);
        hits
    }

    pub fn circle_query(
        world: &World,
        center: Transform2D,
        radius: f32,
        query_mask: CollisionMask,
    ) -> Vec<CircleQueryHit> {
        let mut hits = Vec::new();
        Self::circle_query_into(world, center, radius, query_mask, &mut hits);
        hits
    }

    pub fn shape_query(
        world: &World,
        shape: CollisionQueryShape,
        query_mask: CollisionMask,
    ) -> Vec<ShapeQueryHit> {
        let mut hits = Vec::new();
        Self::shape_query_into(world, shape, query_mask, &mut hits);
        hits
    }

    pub fn nearest_body_query(
        world: &World,
        point: Transform2D,
        max_distance: f32,
        query_mask: CollisionMask,
    ) -> Option<NearestBodyQueryHit> {
        if !point.x.is_finite()
            || !point.y.is_finite()
            || !max_distance.is_finite()
            || max_distance < 0.0
        {
            return None;
        }

        let mut best = None;
        for index in 0..world.transforms.len() {
            if !world.alive.get(index).copied().unwrap_or(false) {
                continue;
            }
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    let Some(hit) = nearest_body_hit(
                        point,
                        transform,
                        shape,
                        entity_from_index(world, index),
                        max_distance,
                    ) else {
                        continue;
                    };
                    update_nearest_body_hit(&mut best, hit);
                }
            }
        }
        best
    }

    pub fn raycast(
        world: &World,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
    ) -> Option<RaycastHit> {
        Self::raycast_all(world, origin, direction, max_distance, query_mask)
            .into_iter()
            .next()
    }

    pub fn raycast_all(
        world: &World,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
    ) -> Vec<RaycastHit> {
        let mut hits = Vec::new();
        Self::raycast_all_into(
            world,
            origin,
            direction,
            max_distance,
            query_mask,
            &mut hits,
        );
        hits
    }

    pub fn segment_cast(
        world: &World,
        start: Transform2D,
        end: Transform2D,
        query_mask: CollisionMask,
    ) -> Option<RaycastHit> {
        Self::segment_cast_all(world, start, end, query_mask)
            .into_iter()
            .next()
    }

    pub fn segment_cast_all(
        world: &World,
        start: Transform2D,
        end: Transform2D,
        query_mask: CollisionMask,
    ) -> Vec<RaycastHit> {
        let mut hits = Vec::new();
        Self::segment_cast_all_into(world, start, end, query_mask, &mut hits);
        hits
    }

    pub fn shape_cast(
        world: &World,
        shape: CollisionQueryShape,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
    ) -> Option<ShapeCastHit> {
        Self::shape_cast_all(world, shape, direction, max_distance, query_mask)
            .into_iter()
            .next()
    }

    pub fn shape_cast_all(
        world: &World,
        shape: CollisionQueryShape,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
    ) -> Vec<ShapeCastHit> {
        let mut hits = Vec::new();
        Self::shape_cast_all_into(world, shape, direction, max_distance, query_mask, &mut hits);
        hits
    }

    pub fn build_pairs(world: &World) -> Vec<CollisionPair> {
        let mut pairs = Vec::new();
        let mut scratch = CollisionScratch::default();
        Self::build_pairs_into(&mut scratch, world, &mut pairs);
        pairs
    }

    pub fn build_layer_pairs(
        world: &World,
        layer_a: CollisionLayer,
        layer_b: CollisionLayer,
    ) -> Vec<CollisionPair> {
        let mut pairs = Vec::new();
        let mut scratch = CollisionScratch::default();
        Self::build_layer_pairs_into(&mut scratch, world, layer_a, layer_b, &mut pairs);
        pairs
    }

    pub fn build_mask_pairs(
        world: &World,
        category_a: CollisionMask,
        category_b: CollisionMask,
    ) -> Vec<CollisionPair> {
        let mut pairs = Vec::new();
        let mut scratch = CollisionScratch::default();
        Self::build_mask_pairs_into(&mut scratch, world, category_a, category_b, &mut pairs);
        pairs
    }

    pub fn build_mask_contacts(
        world: &World,
        category_a: CollisionMask,
        category_b: CollisionMask,
    ) -> Vec<CollisionContact> {
        let mut contacts = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::Masks(category_a, category_b)) {
            if let Some(contact) = contact_from_collider_pair(world, pair) {
                contacts.push(contact);
            }
        }
        contacts
    }

    pub fn build_mask_manifolds(
        world: &World,
        category_a: CollisionMask,
        category_b: CollisionMask,
    ) -> Vec<CollisionManifold> {
        let mut manifolds = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::Masks(category_a, category_b)) {
            if let Some(manifold) = manifold_from_collider_pair(world, pair) {
                manifolds.push(manifold);
            }
        }
        manifolds
    }

    pub fn build_contacts(world: &World) -> Vec<CollisionContact> {
        Self::build_collider_contacts(world)
            .into_iter()
            .map(|contact| contact.contact)
            .collect()
    }

    pub fn build_manifolds(world: &World) -> Vec<CollisionManifold> {
        Self::build_collider_manifolds(world)
            .into_iter()
            .map(|manifold| manifold.manifold)
            .collect()
    }

    pub(crate) fn build_rigid_manifolds(world: &World) -> Vec<CollisionManifold> {
        Self::build_rigid_collider_manifolds(world)
            .into_iter()
            .map(|manifold| manifold.manifold)
            .collect()
    }

    pub(crate) fn build_rigid_collider_contacts(world: &World) -> Vec<ColliderCollisionContact> {
        let mut contacts = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::All) {
            if collider_pair_has_trigger(world, pair) {
                continue;
            }
            if let Some(contact) = contact_from_collider_pair(world, pair) {
                contacts.push(ColliderCollisionContact {
                    collider_pair: pair,
                    contact,
                });
            }
        }
        contacts
    }

    pub(crate) fn build_rigid_collider_manifolds(world: &World) -> Vec<ColliderCollisionManifold> {
        let mut manifolds = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::All) {
            if collider_pair_has_trigger(world, pair) {
                continue;
            }
            if let Some(manifold) = manifold_from_collider_pair(world, pair) {
                manifolds.push(ColliderCollisionManifold {
                    collider_pair: pair,
                    manifold,
                });
            }
        }
        manifolds
    }

    fn build_collider_contacts(world: &World) -> Vec<ColliderCollisionContact> {
        let mut contacts = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::All) {
            if let Some(contact) = contact_from_collider_pair(world, pair) {
                contacts.push(ColliderCollisionContact {
                    collider_pair: pair,
                    contact,
                });
            }
        }
        contacts
    }

    fn build_collider_manifolds(world: &World) -> Vec<ColliderCollisionManifold> {
        let mut manifolds = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::All) {
            if let Some(manifold) = manifold_from_collider_pair(world, pair) {
                manifolds.push(ColliderCollisionManifold {
                    collider_pair: pair,
                    manifold,
                });
            }
        }
        manifolds
    }

    pub fn build_layer_contacts(
        world: &World,
        layer_a: CollisionLayer,
        layer_b: CollisionLayer,
    ) -> Vec<CollisionContact> {
        let mut contacts = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::Layers(layer_a, layer_b)) {
            if let Some(contact) = contact_from_collider_pair(world, pair) {
                contacts.push(contact);
            }
        }
        contacts
    }

    pub fn build_layer_manifolds(
        world: &World,
        layer_a: CollisionLayer,
        layer_b: CollisionLayer,
    ) -> Vec<CollisionManifold> {
        let mut manifolds = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::Layers(layer_a, layer_b)) {
            if let Some(manifold) = manifold_from_collider_pair(world, pair) {
                manifolds.push(manifold);
            }
        }
        manifolds
    }

    pub fn build_contact_debug_lines(world: &World, normal_length: f32) -> Vec<PhysicsDebugLine> {
        let mut lines = Vec::new();
        Self::build_contact_debug_lines_into(world, normal_length, &mut lines);
        lines
    }

    pub fn build_broadphase_debug_lines(world: &World) -> Vec<PhysicsDebugLine> {
        let mut lines = Vec::new();
        Self::append_broadphase_debug_lines_into(world, &mut lines);
        lines
    }

    pub fn build_physics_debug_lines(world: &World, normal_length: f32) -> Vec<PhysicsDebugLine> {
        let mut lines = Vec::new();
        Self::build_physics_debug_lines_into(world, normal_length, &mut lines);
        lines
    }

    pub fn build_physics_debug_lines_with_flags(
        world: &World,
        normal_length: f32,
        flags: u32,
    ) -> Vec<PhysicsDebugLine> {
        let mut lines = Vec::new();
        Self::build_physics_debug_lines_with_flags_into(world, normal_length, flags, &mut lines);
        lines
    }

    pub(crate) fn build_contact_debug_lines_into(
        world: &World,
        normal_length: f32,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        lines.clear();
        if !is_valid_debug_line_length(normal_length) {
            return;
        }
        Self::append_contact_debug_lines_into(world, normal_length, lines);
    }

    pub(crate) fn build_physics_debug_lines_into(
        world: &World,
        normal_length: f32,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        Self::build_physics_debug_lines_with_flags_into(
            world,
            normal_length,
            PHYSICS_DEBUG_DEFAULT,
            lines,
        );
    }

    pub(crate) fn build_physics_debug_lines_with_flags_into(
        world: &World,
        normal_length: f32,
        flags: u32,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        lines.clear();
        if flags & PHYSICS_DEBUG_COLLIDERS != 0 {
            Self::append_collider_debug_lines_into(
                world,
                flags & PHYSICS_DEBUG_SLEEPING != 0,
                lines,
            );
        }
        if flags & PHYSICS_DEBUG_BROADPHASE != 0 {
            Self::append_broadphase_debug_lines_into(world, lines);
        }
        if flags & PHYSICS_DEBUG_JOINTS != 0 {
            Self::append_joint_debug_lines_into(world, lines);
        }
        if flags & PHYSICS_DEBUG_CCD != 0 {
            Self::append_ccd_debug_lines_into(world, lines);
        }
        if flags & PHYSICS_DEBUG_CONTACTS != 0 && is_valid_debug_line_length(normal_length) {
            Self::append_contact_debug_lines_into(world, normal_length, lines);
        }
    }

    pub(crate) fn append_contact_debug_lines_into(
        world: &World,
        normal_length: f32,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        for pair in Self::build_collider_pairs(world, PairFilter::All) {
            let Some(contact) = contact_from_collider_pair(world, pair) else {
                continue;
            };
            let Some(line) = contact_debug_line(world, contact, normal_length) else {
                continue;
            };
            lines.push(line);
            append_contact_point_debug_lines(contact, lines);
        }
    }

    pub(crate) fn append_collider_debug_lines_into(
        world: &World,
        show_sleeping_state: bool,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        for index in 0..world.transforms.len() {
            if !world.alive.get(index).copied().unwrap_or(false) {
                continue;
            }
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            for collider_index in 0..world.compound_collider_count_at(index) {
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    append_collider_outline_debug_lines(
                        transform,
                        shape,
                        collider_debug_color(world, index, show_sleeping_state),
                        lines,
                    );
                }
            }
        }
    }

    pub(crate) fn append_broadphase_debug_lines_into(
        world: &World,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        let mut proxies = Vec::new();
        fill_current_proxies(world, &mut proxies);
        for proxy in proxies {
            append_bounds_debug_lines(proxy.bounds, BROADPHASE_DEBUG_COLOR, lines);
        }
    }

    pub(crate) fn append_joint_debug_lines_into(world: &World, lines: &mut Vec<PhysicsDebugLine>) {
        for joint in world.distance_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.rope_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.spring_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.pulley_joints.iter().copied().flatten() {
            append_pulley_joint_debug_lines(world, joint, lines);
        }
        for joint in world.revolute_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.prismatic_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.weld_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
        for joint in world.gear_joints.iter().copied().flatten() {
            append_entity_link_debug_line(
                world,
                joint.entity_a,
                joint.entity_b,
                JOINT_DEBUG_COLOR,
                lines,
            );
        }
    }

    pub(crate) fn append_ccd_debug_lines_into(world: &World, lines: &mut Vec<PhysicsDebugLine>) {
        for hit in world.rigid_body_ccd_debug_hits() {
            append_cross_debug_lines(
                hit.point_x,
                hit.point_y,
                CCD_HIT_MARKER_SIZE,
                CCD_HIT_DEBUG_COLOR,
                lines,
            );
            lines.push(debug_line(
                hit.point_x,
                hit.point_y,
                hit.point_x + hit.normal_x * CCD_HIT_NORMAL_LENGTH,
                hit.point_y + hit.normal_y * CCD_HIT_NORMAL_LENGTH,
                CCD_HIT_DEBUG_COLOR,
            ));
        }
    }

    pub fn build_swept_layer_pairs(
        world: &World,
        moving_layer: CollisionLayer,
        target_layer: CollisionLayer,
        delta: f32,
    ) -> Vec<CollisionPair> {
        let mut pairs = Vec::new();
        let mut scratch = CollisionScratch::default();
        Self::build_swept_layer_pairs_into(
            &mut scratch,
            world,
            moving_layer,
            target_layer,
            delta,
            &mut pairs,
        );
        pairs
    }

    pub fn build_swept_mask_pairs(
        world: &World,
        moving_category: CollisionMask,
        target_category: CollisionMask,
        delta: f32,
    ) -> Vec<CollisionPair> {
        let mut pairs = Vec::new();
        let mut scratch = CollisionScratch::default();
        Self::build_swept_mask_pairs_into(
            &mut scratch,
            world,
            moving_category,
            target_category,
            delta,
            &mut pairs,
        );
        pairs
    }

    pub(crate) fn build_pairs_into(
        scratch: &mut CollisionScratch,
        world: &World,
        pairs: &mut Vec<CollisionPair>,
    ) {
        fill_current_proxies(world, &mut scratch.current_proxies);
        pairs.clear();
        collect_current_pairs(world, &scratch.current_proxies, pairs, PairFilter::All);
    }

    fn build_collider_pairs(world: &World, pair_filter: PairFilter) -> Vec<ColliderPair> {
        let mut pairs = Vec::new();
        let mut scratch = CollisionScratch::default();
        fill_current_proxies(world, &mut scratch.current_proxies);
        collect_current_collider_pairs(world, &scratch.current_proxies, &mut pairs, pair_filter);
        pairs
    }

    pub(crate) fn build_layer_pairs_into(
        scratch: &mut CollisionScratch,
        world: &World,
        layer_a: CollisionLayer,
        layer_b: CollisionLayer,
        pairs: &mut Vec<CollisionPair>,
    ) {
        fill_current_proxies(world, &mut scratch.current_proxies);
        pairs.clear();
        collect_current_pairs(
            world,
            &scratch.current_proxies,
            pairs,
            PairFilter::Layers(layer_a, layer_b),
        );
    }

    pub(crate) fn build_mask_pairs_into(
        scratch: &mut CollisionScratch,
        world: &World,
        category_a: CollisionMask,
        category_b: CollisionMask,
        pairs: &mut Vec<CollisionPair>,
    ) {
        fill_current_proxies(world, &mut scratch.current_proxies);
        pairs.clear();
        collect_current_pairs(
            world,
            &scratch.current_proxies,
            pairs,
            PairFilter::Masks(category_a, category_b),
        );
    }

    pub(crate) fn build_swept_layer_pairs_into(
        scratch: &mut CollisionScratch,
        world: &World,
        moving_layer: CollisionLayer,
        target_layer: CollisionLayer,
        delta: f32,
        pairs: &mut Vec<CollisionPair>,
    ) {
        fill_swept_layer_proxies(world, moving_layer, delta, &mut scratch.moving_proxies);
        fill_swept_layer_proxies(world, target_layer, delta, &mut scratch.target_proxies);
        pairs.clear();

        for moving_proxy in scratch.moving_proxies.iter().copied() {
            for target_proxy in scratch.target_proxies.iter().copied() {
                let moving_index = moving_proxy.key.entity_index;
                let target_index = target_proxy.key.entity_index;
                if moving_index == target_index {
                    continue;
                }
                if target_proxy.bounds.max_x < moving_proxy.bounds.min_x {
                    continue;
                }
                if target_proxy.bounds.min_x > moving_proxy.bounds.max_x {
                    break;
                }
                if !moving_proxy.bounds.overlaps(target_proxy.bounds) {
                    continue;
                }
                if !filters_allow(world, moving_index, target_index)
                    || !precise_swept_overlap(world, moving_index, target_index, delta)
                {
                    continue;
                }
                pairs.push(pair_from_indices(world, moving_index, target_index));
            }
        }
    }

    pub(crate) fn build_swept_mask_pairs_into(
        scratch: &mut CollisionScratch,
        world: &World,
        moving_category: CollisionMask,
        target_category: CollisionMask,
        delta: f32,
        pairs: &mut Vec<CollisionPair>,
    ) {
        fill_swept_mask_proxies(world, moving_category, delta, &mut scratch.moving_proxies);
        fill_swept_mask_proxies(world, target_category, delta, &mut scratch.target_proxies);
        pairs.clear();

        for moving_proxy in scratch.moving_proxies.iter().copied() {
            for target_proxy in scratch.target_proxies.iter().copied() {
                let moving_index = moving_proxy.key.entity_index;
                let target_index = target_proxy.key.entity_index;
                if moving_index == target_index {
                    continue;
                }
                if target_proxy.bounds.max_x < moving_proxy.bounds.min_x {
                    continue;
                }
                if target_proxy.bounds.min_x > moving_proxy.bounds.max_x {
                    break;
                }
                if !moving_proxy.bounds.overlaps(target_proxy.bounds)
                    || !filters_allow(world, moving_index, target_index)
                    || !precise_swept_overlap(world, moving_index, target_index, delta)
                {
                    continue;
                }
                if mask_contains_entity(world, moving_index, moving_category)
                    && mask_contains_entity(world, target_index, target_category)
                {
                    pairs.push(pair_from_indices(world, moving_index, target_index));
                }
            }
        }
    }

    pub(crate) fn point_query_into(
        world: &World,
        point: Transform2D,
        query_mask: CollisionMask,
        hits: &mut Vec<PointQueryHit>,
    ) {
        hits.clear();
        for index in 0..world.transforms.len() {
            if !world.alive.get(index).copied().unwrap_or(false) {
                continue;
            }
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    if !collider_contains_point(transform, shape, point) {
                        continue;
                    }
                    let entity = entity_from_index(world, index);
                    if !hits.iter().any(|hit| hit.entity == entity) {
                        hits.push(PointQueryHit { entity });
                    }
                }
            }
        }
    }

    pub(crate) fn aabb_query_into(
        world: &World,
        bounds: AabbBounds,
        query_mask: CollisionMask,
        hits: &mut Vec<AabbQueryHit>,
    ) {
        hits.clear();
        for index in 0..world.transforms.len() {
            if !world.alive.get(index).copied().unwrap_or(false) {
                continue;
            }
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    if !collider_overlaps_aabb(transform, shape, bounds) {
                        continue;
                    }
                    let entity = entity_from_index(world, index);
                    if !hits.iter().any(|hit| hit.entity == entity) {
                        hits.push(AabbQueryHit { entity });
                    }
                }
            }
        }
    }

    pub(crate) fn circle_query_into(
        world: &World,
        center: Transform2D,
        radius: f32,
        query_mask: CollisionMask,
        hits: &mut Vec<CircleQueryHit>,
    ) {
        hits.clear();
        if !is_valid_radius(radius) {
            return;
        }
        for index in 0..world.transforms.len() {
            if !world.alive.get(index).copied().unwrap_or(false) {
                continue;
            }
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    if !collider_overlaps_circle(transform, shape, center, radius) {
                        continue;
                    }
                    let entity = entity_from_index(world, index);
                    if !hits.iter().any(|hit| hit.entity == entity) {
                        hits.push(CircleQueryHit { entity });
                    }
                }
            }
        }
    }

    pub(crate) fn shape_query_into(
        world: &World,
        shape: CollisionQueryShape,
        query_mask: CollisionMask,
        hits: &mut Vec<ShapeQueryHit>,
    ) {
        hits.clear();
        if !query_shape_is_valid(shape) {
            return;
        }
        for index in 0..world.transforms.len() {
            if !world.alive.get(index).copied().unwrap_or(false) {
                continue;
            }
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(collider_shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    if !query_shape_overlaps_collider(shape, transform, collider_shape) {
                        continue;
                    }
                    let entity = entity_from_index(world, index);
                    if !hits.iter().any(|hit| hit.entity == entity) {
                        hits.push(ShapeQueryHit { entity });
                    }
                }
            }
        }
    }

    pub(crate) fn raycast_all_into(
        world: &World,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
        hits: &mut Vec<RaycastHit>,
    ) {
        hits.clear();
        let Some((unit_x, unit_y)) = normalized_direction(direction) else {
            return;
        };
        if !max_distance.is_finite() || max_distance < 0.0 {
            return;
        }

        for index in 0..world.transforms.len() {
            if !world.alive.get(index).copied().unwrap_or(false) {
                continue;
            }
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    let Some(hit) =
                        raycast_shape(origin, unit_x, unit_y, max_distance, transform, shape)
                    else {
                        continue;
                    };
                    hits.push(RaycastHit {
                        entity: entity_from_index(world, index),
                        distance: hit.distance,
                        point_x: origin.x + unit_x * hit.distance,
                        point_y: origin.y + unit_y * hit.distance,
                        normal_x: hit.normal_x,
                        normal_y: hit.normal_y,
                    });
                }
            }
        }
        hits.sort_by(|a, b| {
            a.distance
                .total_cmp(&b.distance)
                .then_with(|| a.entity.id.cmp(&b.entity.id))
        });
    }

    pub(crate) fn segment_cast_all_into(
        world: &World,
        start: Transform2D,
        end: Transform2D,
        query_mask: CollisionMask,
        hits: &mut Vec<RaycastHit>,
    ) {
        hits.clear();
        let Some((direction, max_distance)) = segment_direction_and_distance(start, end) else {
            return;
        };
        Self::raycast_all_into(world, start, direction, max_distance, query_mask, hits);
    }

    pub(crate) fn shape_cast_all_into(
        world: &World,
        shape: CollisionQueryShape,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
        hits: &mut Vec<ShapeCastHit>,
    ) {
        hits.clear();
        if !query_shape_is_valid(shape) || !max_distance.is_finite() || max_distance < 0.0 {
            return;
        }
        let Some((unit_x, unit_y)) = normalized_direction(direction) else {
            return;
        };
        let sweep_bounds =
            query_shape_sweep_bounds(shape, unit_x * max_distance, unit_y * max_distance);

        for index in 0..world.transforms.len() {
            if !world.alive.get(index).copied().unwrap_or(false) {
                continue;
            }
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(collider_shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    if !sweep_bounds.overlaps(collider_bounds(transform, collider_shape)) {
                        continue;
                    }
                    let Some(hit) = shape_cast_hit(
                        shape,
                        unit_x,
                        unit_y,
                        max_distance,
                        transform,
                        collider_shape,
                    ) else {
                        continue;
                    };
                    let reference = query_shape_reference_point(shape);
                    hits.push(ShapeCastHit {
                        entity: entity_from_index(world, index),
                        distance: hit.distance,
                        point_x: reference.x + unit_x * hit.distance,
                        point_y: reference.y + unit_y * hit.distance,
                        normal_x: hit.normal_x,
                        normal_y: hit.normal_y,
                    });
                }
            }
        }
        hits.sort_by(|a, b| {
            a.distance
                .total_cmp(&b.distance)
                .then_with(|| a.entity.id.cmp(&b.entity.id))
        });
    }
}

fn fill_current_proxies(world: &World, proxies: &mut Vec<CollisionProxy>) {
    proxies.clear();
    for index in 0..world.transforms.len() {
        for collider_index in 0..world.compound_collider_count_at(index) {
            for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                if let Some(proxy) = current_proxy(world, index, collider_index, segment_index) {
                    proxies.push(proxy);
                }
            }
        }
    }
    proxies.sort_by(proxy_order);
}

fn collect_current_collider_pairs(
    world: &World,
    proxies: &[CollisionProxy],
    pairs: &mut Vec<ColliderPair>,
    pair_filter: PairFilter,
) {
    for i in 0..proxies.len() {
        let a = proxies[i];
        for b in proxies.iter().copied().skip(i + 1) {
            if a.key.entity_index == b.key.entity_index {
                continue;
            }
            if b.bounds.min_x > a.bounds.max_x {
                break;
            }
            if !a.bounds.overlaps(b.bounds) {
                continue;
            }
            let pair = ColliderPair { a: a.key, b: b.key };
            if !precise_current_overlap(world, pair) {
                continue;
            }
            if let Some(pair) = pair_filter.orient(world, pair) {
                pairs.push(pair);
            }
        }
    }
}

fn collect_current_pairs(
    world: &World,
    proxies: &[CollisionProxy],
    pairs: &mut Vec<CollisionPair>,
    pair_filter: PairFilter,
) {
    let mut collider_pairs = Vec::new();
    collect_current_collider_pairs(world, proxies, &mut collider_pairs, pair_filter);
    pairs.clear();
    for pair in collider_pairs {
        push_unique_pair(pairs, collider_pair_to_pair(world, pair));
    }
}

fn fill_swept_layer_proxies(
    world: &World,
    layer: CollisionLayer,
    delta: f32,
    proxies: &mut Vec<CollisionProxy>,
) {
    proxies.clear();
    for index in 0..world.transforms.len() {
        if !world.alive.get(index).copied().unwrap_or(false) {
            continue;
        }
        let Some(collider) = world.colliders[index] else {
            continue;
        };
        if !collider.enabled || collider.layer != layer {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let bounds = if is_valid_delta(delta) {
            let velocity = world.velocities[index].unwrap_or_default();
            let start = previous_transform(transform, velocity, delta);
            AabbBounds::swept(start, transform, collider)
        } else {
            AabbBounds::from_transform(transform, collider)
        };
        proxies.push(CollisionProxy {
            key: ColliderKey {
                entity_index: index,
                collider_index: 0,
                segment_index: 0,
            },
            bounds,
        });
    }
    proxies.sort_by(proxy_order);
}

fn fill_swept_mask_proxies(
    world: &World,
    category: CollisionMask,
    delta: f32,
    proxies: &mut Vec<CollisionProxy>,
) {
    proxies.clear();
    for index in 0..world.transforms.len() {
        if !world.alive.get(index).copied().unwrap_or(false)
            || !mask_contains_entity(world, index, category)
        {
            continue;
        }
        let Some(collider) = world.colliders[index] else {
            continue;
        };
        if !collider.enabled {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let bounds = if is_valid_delta(delta) {
            let velocity = world.velocities[index].unwrap_or_default();
            let start = previous_transform(transform, velocity, delta);
            AabbBounds::swept(start, transform, collider)
        } else {
            AabbBounds::from_transform(transform, collider)
        };
        proxies.push(CollisionProxy {
            key: ColliderKey {
                entity_index: index,
                collider_index: 0,
                segment_index: 0,
            },
            bounds,
        });
    }
    proxies.sort_by(proxy_order);
}

fn current_proxy(
    world: &World,
    index: usize,
    collider_index: usize,
    segment_index: usize,
) -> Option<CollisionProxy> {
    if !world.alive.get(index).copied().unwrap_or(false) {
        return None;
    }
    let transform = world.transforms[index]?;
    let shape = collider_shape_at_segment(world, index, collider_index, segment_index)?;
    Some(CollisionProxy {
        key: ColliderKey {
            entity_index: index,
            collider_index,
            segment_index,
        },
        bounds: collider_bounds(transform, shape),
    })
}

fn proxy_order(a: &CollisionProxy, b: &CollisionProxy) -> std::cmp::Ordering {
    a.bounds
        .min_x
        .total_cmp(&b.bounds.min_x)
        .then_with(|| a.key.entity_index.cmp(&b.key.entity_index))
        .then_with(|| a.key.collider_index.cmp(&b.key.collider_index))
        .then_with(|| a.key.segment_index.cmp(&b.key.segment_index))
}

fn pair_from_indices(world: &World, a: usize, b: usize) -> CollisionPair {
    CollisionPair {
        a: entity_from_index(world, a),
        b: entity_from_index(world, b),
    }
}

fn collider_pair_to_pair(world: &World, pair: ColliderPair) -> CollisionPair {
    pair_from_indices(world, pair.a.entity_index, pair.b.entity_index)
}

fn push_unique_pair(pairs: &mut Vec<CollisionPair>, pair: CollisionPair) {
    if !pairs
        .iter()
        .any(|existing| existing.a == pair.a && existing.b == pair.b)
    {
        pairs.push(pair);
    }
}

fn entity_from_index(world: &World, index: usize) -> Entity {
    Entity {
        id: index as u32,
        generation: world.generations[index],
    }
}

pub(crate) fn collider_shape(world: &World, index: usize) -> Option<ColliderShapeRef> {
    collider_shape_at(world, index, 0)
}

pub(crate) fn collider_shape_at(
    world: &World,
    index: usize,
    collider_index: usize,
) -> Option<ColliderShapeRef> {
    collider_shape_at_segment(world, index, collider_index, 0)
}

fn collider_segment_count_at(world: &World, index: usize, collider_index: usize) -> usize {
    let Some(collider) = world.compound_collider_at(index, collider_index) else {
        return 0;
    };
    match collider.shape {
        CompoundColliderShape::Chain(collider) => collider.segment_count(),
        _ => 1,
    }
}

fn collider_shape_at_segment(
    world: &World,
    index: usize,
    collider_index: usize,
    segment_index: usize,
) -> Option<ColliderShapeRef> {
    let collider = world.compound_collider_at(index, collider_index)?;
    collider_shape_from_compound(world, index, collider, segment_index)
}

fn collider_shape_from_compound(
    world: &World,
    index: usize,
    collider: CompoundCollider,
    segment_index: usize,
) -> Option<ColliderShapeRef> {
    if !collider.enabled() {
        return None;
    }
    match collider.shape {
        CompoundColliderShape::Aabb(collider) => Some(ColliderShapeRef::Aabb(collider)),
        CompoundColliderShape::Circle(collider) => {
            is_valid_radius(collider.radius).then_some(ColliderShapeRef::Circle(collider))
        }
        CompoundColliderShape::OrientedBox(collider) => (oriented_box_collider_is_valid(collider))
            .then(|| {
                ColliderShapeRef::OrientedBox(
                    collider,
                    oriented_box_total_rotation(world, index, collider),
                )
            }),
        CompoundColliderShape::Capsule(collider) => {
            capsule_collider_is_valid(collider).then_some(ColliderShapeRef::Capsule(collider))
        }
        CompoundColliderShape::Edge(collider) => {
            edge_collider_is_valid(collider).then_some(ColliderShapeRef::Edge(collider))
        }
        CompoundColliderShape::Chain(collider) => chain_collider_segment(collider, segment_index)
            .and_then(|segment| {
                edge_collider_is_valid(segment).then_some(ColliderShapeRef::Edge(segment))
            }),
        CompoundColliderShape::ConvexPolygon(collider) => {
            (convex_polygon_collider_is_valid(collider)).then(|| {
                ColliderShapeRef::ConvexPolygon(
                    collider,
                    convex_polygon_total_rotation(world, index, collider),
                )
            })
        }
    }
}

fn collider_shape_is_valid(shape: ColliderShapeRef) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => collider.enabled,
        ColliderShapeRef::Circle(collider) => collider.enabled && is_valid_radius(collider.radius),
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            collider.enabled
                && oriented_box_collider_is_valid(collider)
                && rotation_radians.is_finite()
        }
        ColliderShapeRef::Capsule(collider) => {
            collider.enabled && capsule_collider_is_valid(collider)
        }
        ColliderShapeRef::Edge(collider) => collider.enabled && edge_collider_is_valid(collider),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            collider.enabled
                && convex_polygon_collider_is_valid(collider)
                && rotation_radians.is_finite()
        }
    }
}

fn collider_shape_center(transform: Transform2D, shape: ColliderShapeRef) -> Transform2D {
    match shape {
        ColliderShapeRef::Aabb(collider) => collider.center(transform),
        ColliderShapeRef::Circle(collider) => collider.center(transform),
        ColliderShapeRef::OrientedBox(collider, _) => collider.center(transform),
        ColliderShapeRef::Capsule(collider) => collider.center(transform),
        ColliderShapeRef::Edge(collider) => collider.center(transform),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            convex_polygon_collider_centroid(transform, collider, rotation_radians)
                .unwrap_or_else(|| collider.center(transform))
        }
    }
}

fn collider_query_shape(
    transform: Transform2D,
    shape: ColliderShapeRef,
) -> Option<CollisionQueryShape> {
    match shape {
        ColliderShapeRef::Aabb(collider) => Some(CollisionQueryShape::Aabb(
            AabbBounds::from_transform(transform, collider),
        )),
        ColliderShapeRef::Circle(collider) => {
            is_valid_radius(collider.radius).then_some(CollisionQueryShape::Circle {
                center: collider.center(transform),
                radius: collider.radius,
            })
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            oriented_box_collider_is_valid(collider).then_some(CollisionQueryShape::OrientedBox {
                center: collider.center(transform),
                half_width: collider.half_width,
                half_height: collider.half_height,
                rotation_radians,
            })
        }
        ColliderShapeRef::Capsule(collider) => {
            capsule_collider_is_valid(collider).then_some(CollisionQueryShape::Capsule {
                start: collider.start(transform),
                end: collider.end(transform),
                radius: collider.radius,
            })
        }
        ColliderShapeRef::Edge(collider) => {
            edge_collider_is_valid(collider).then_some(CollisionQueryShape::Capsule {
                start: collider.start(transform),
                end: collider.end(transform),
                radius: EDGE_COLLIDER_RADIUS,
            })
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let vertices = convex_polygon_collider_vertices(transform, collider, rotation_radians)?;
            Some(CollisionQueryShape::ConvexPolygon {
                vertices,
                vertex_count: collider.vertex_count,
            })
        }
    }
}

fn swept_shape_contact_normal(
    moving_start: Transform2D,
    moving_shape: ColliderShapeRef,
    target_start: Transform2D,
    target_shape: ColliderShapeRef,
    unit_x: f32,
    unit_y: f32,
    hit: RaycastBoundsHit,
) -> (f32, f32) {
    let normal_x = -hit.normal_x;
    let normal_y = -hit.normal_y;
    let normal_length_squared = normal_x * normal_x + normal_y * normal_y;
    if normal_length_squared > RAY_EPSILON * RAY_EPSILON {
        let inv_length = normal_length_squared.sqrt().recip();
        return (normal_x * inv_length, normal_y * inv_length);
    }

    let moving_center = collider_shape_center(moving_start, moving_shape);
    let target_center = collider_shape_center(target_start, target_shape);
    let center_dx = target_center.x - moving_center.x;
    let center_dy = target_center.y - moving_center.y;
    let center_length_squared = center_dx * center_dx + center_dy * center_dy;
    if center_length_squared > RAY_EPSILON * RAY_EPSILON {
        let inv_length = center_length_squared.sqrt().recip();
        return (center_dx * inv_length, center_dy * inv_length);
    }

    (unit_x, unit_y)
}

fn collider_layer_at(world: &World, key: ColliderKey) -> Option<CollisionLayer> {
    match collider_shape_at_segment(
        world,
        key.entity_index,
        key.collider_index,
        key.segment_index,
    )? {
        ColliderShapeRef::Aabb(collider) => Some(collider.layer),
        ColliderShapeRef::Circle(collider) => Some(collider.layer),
        ColliderShapeRef::OrientedBox(collider, _) => Some(collider.layer),
        ColliderShapeRef::Capsule(collider) => Some(collider.layer),
        ColliderShapeRef::Edge(collider) => Some(collider.layer),
        ColliderShapeRef::ConvexPolygon(collider, _) => Some(collider.layer),
    }
}

pub(crate) fn collider_bounds(transform: Transform2D, shape: ColliderShapeRef) -> AabbBounds {
    match shape {
        ColliderShapeRef::Aabb(collider) => AabbBounds::from_transform(transform, collider),
        ColliderShapeRef::Circle(collider) => AabbBounds::from_circle(transform, collider),
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => oriented_box_bounds(
            collider.center(transform),
            collider.half_width,
            collider.half_height,
            rotation_radians,
        ),
        ColliderShapeRef::Capsule(collider) => capsule_bounds(
            collider.start(transform),
            collider.end(transform),
            collider.radius,
        ),
        ColliderShapeRef::Edge(collider) => {
            edge_bounds(collider.start(transform), collider.end(transform))
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return AabbBounds {
                    min_x: transform.x,
                    min_y: transform.y,
                    max_x: transform.x,
                    max_y: transform.y,
                };
            };
            convex_polygon_bounds(&vertices[..vertex_count])
        }
    }
}

fn collider_contains_point(
    transform: Transform2D,
    shape: ColliderShapeRef,
    point: Transform2D,
) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            AabbBounds::from_transform(transform, collider).contains_point(point)
        }
        ColliderShapeRef::Circle(collider) => {
            circle_contains_point(collider.center(transform), collider.radius, point)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => oriented_box_contains_point(
            collider.center(transform),
            collider.half_width,
            collider.half_height,
            rotation_radians,
            point,
        ),
        ColliderShapeRef::Capsule(collider) => {
            let start = collider.start(transform);
            let end = collider.end(transform);
            point_segment_distance_squared(point, start, end) <= collider.radius * collider.radius
        }
        ColliderShapeRef::Edge(collider) => {
            let start = collider.start(transform);
            let end = collider.end(transform);
            point_segment_distance_squared(point, start, end)
                <= EDGE_COLLIDER_RADIUS * EDGE_COLLIDER_RADIUS
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
                .is_some_and(|(vertices, vertex_count)| {
                    convex_polygon_contains_point(&vertices[..vertex_count], point)
                })
        }
    }
}

fn collider_overlaps_aabb(
    transform: Transform2D,
    shape: ColliderShapeRef,
    bounds: AabbBounds,
) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            AabbBounds::from_transform(transform, collider).overlaps(bounds)
        }
        ColliderShapeRef::Circle(collider) => {
            circle_overlaps_aabb(collider.center(transform), collider.radius, bounds)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let Some(oriented_box) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) else {
                return false;
            };
            oriented_box_overlaps_aabb(oriented_box, bounds)
        }
        ColliderShapeRef::Capsule(collider) => capsule_overlaps_aabb(
            collider.start(transform),
            collider.end(transform),
            collider.radius,
            bounds,
        ),
        ColliderShapeRef::Edge(collider) => {
            segment_intersects_aabb(collider.start(transform), collider.end(transform), bounds)
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return false;
            };
            convex_polygon_overlaps_aabb(&vertices[..vertex_count], bounds)
        }
    }
}

fn collider_overlaps_circle(
    transform: Transform2D,
    shape: ColliderShapeRef,
    center: Transform2D,
    radius: f32,
) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            aabb_overlaps_circle(transform, collider, center, radius)
        }
        ColliderShapeRef::Circle(collider) => {
            circles_overlap(collider.center(transform), collider.radius, center, radius)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let Some(oriented_box) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) else {
                return false;
            };
            oriented_box_overlaps_circle(oriented_box, center, radius)
        }
        ColliderShapeRef::Capsule(collider) => capsule_overlaps_circle(
            collider.start(transform),
            collider.end(transform),
            collider.radius,
            center,
            radius,
        ),
        ColliderShapeRef::Edge(collider) => {
            let radius_sum = radius + EDGE_COLLIDER_RADIUS;
            point_segment_distance_squared(
                center,
                collider.start(transform),
                collider.end(transform),
            ) <= radius_sum * radius_sum
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return false;
            };
            convex_polygon_overlaps_circle(&vertices[..vertex_count], center, radius)
        }
    }
}

fn collider_overlaps_oriented_box(
    transform: Transform2D,
    shape: ColliderShapeRef,
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    rotation_radians: f32,
) -> bool {
    let Some(query_box) = oriented_box_geometry(center, half_width, half_height, rotation_radians)
    else {
        return false;
    };
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            oriented_box_overlaps_aabb(query_box, AabbBounds::from_transform(transform, collider))
        }
        ColliderShapeRef::Circle(collider) => {
            oriented_box_overlaps_circle(query_box, collider.center(transform), collider.radius)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let Some(collider_box) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) else {
                return false;
            };
            oriented_boxes_overlap(query_box, collider_box)
        }
        ColliderShapeRef::Capsule(collider) => oriented_box_overlaps_capsule(
            query_box,
            collider.start(transform),
            collider.end(transform),
            collider.radius,
        ),
        ColliderShapeRef::Edge(collider) => oriented_box_overlaps_capsule(
            query_box,
            collider.start(transform),
            collider.end(transform),
            EDGE_COLLIDER_RADIUS,
        ),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return false;
            };
            convex_polygon_overlaps_oriented_box(&vertices[..vertex_count], query_box)
        }
    }
}

fn collider_overlaps_capsule(
    transform: Transform2D,
    shape: ColliderShapeRef,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => capsule_overlaps_aabb(
            start,
            end,
            radius,
            AabbBounds::from_transform(transform, collider),
        ),
        ColliderShapeRef::Circle(collider) => capsule_overlaps_circle(
            start,
            end,
            radius,
            collider.center(transform),
            collider.radius,
        ),
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let Some(oriented_box) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) else {
                return false;
            };
            oriented_box_overlaps_capsule(oriented_box, start, end, radius)
        }
        ColliderShapeRef::Capsule(collider) => capsules_overlap(
            start,
            end,
            radius,
            collider.start(transform),
            collider.end(transform),
            collider.radius,
        ),
        ColliderShapeRef::Edge(collider) => capsules_overlap(
            start,
            end,
            radius,
            collider.start(transform),
            collider.end(transform),
            EDGE_COLLIDER_RADIUS,
        ),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return false;
            };
            convex_polygon_overlaps_capsule(&vertices[..vertex_count], start, end, radius)
        }
    }
}

fn collider_overlaps_convex_polygon(
    transform: Transform2D,
    shape: ColliderShapeRef,
    vertices: &[Transform2D],
) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            convex_polygon_overlaps_aabb(vertices, AabbBounds::from_transform(transform, collider))
        }
        ColliderShapeRef::Circle(collider) => {
            convex_polygon_overlaps_circle(vertices, collider.center(transform), collider.radius)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let Some(oriented_box) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) else {
                return false;
            };
            convex_polygon_overlaps_oriented_box(vertices, oriented_box)
        }
        ColliderShapeRef::Capsule(collider) => convex_polygon_overlaps_capsule(
            vertices,
            collider.start(transform),
            collider.end(transform),
            collider.radius,
        ),
        ColliderShapeRef::Edge(collider) => convex_polygon_overlaps_capsule(
            vertices,
            collider.start(transform),
            collider.end(transform),
            EDGE_COLLIDER_RADIUS,
        ),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let Some((collider_vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            else {
                return false;
            };
            convex_polygons_overlap(vertices, &collider_vertices[..vertex_count])
        }
    }
}

fn query_shape_overlaps_collider(
    query_shape: CollisionQueryShape,
    collider_transform: Transform2D,
    collider_shape: ColliderShapeRef,
) -> bool {
    match query_shape {
        CollisionQueryShape::Aabb(bounds) => {
            collider_overlaps_aabb(collider_transform, collider_shape, bounds)
        }
        CollisionQueryShape::Circle { center, radius } => {
            collider_overlaps_circle(collider_transform, collider_shape, center, radius)
        }
        CollisionQueryShape::OrientedBox {
            center,
            half_width,
            half_height,
            rotation_radians,
        } => collider_overlaps_oriented_box(
            collider_transform,
            collider_shape,
            center,
            half_width,
            half_height,
            rotation_radians,
        ),
        CollisionQueryShape::Capsule { start, end, radius } => {
            collider_overlaps_capsule(collider_transform, collider_shape, start, end, radius)
        }
        CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count,
        } => {
            let Some(vertices) = convex_polygon_vertices(&vertices, vertex_count) else {
                return false;
            };
            collider_overlaps_convex_polygon(collider_transform, collider_shape, vertices)
        }
    }
}

fn query_shape_reference_point(shape: CollisionQueryShape) -> Transform2D {
    match shape {
        CollisionQueryShape::Aabb(bounds) => Transform2D {
            x: (bounds.min_x + bounds.max_x) * 0.5,
            y: (bounds.min_y + bounds.max_y) * 0.5,
        },
        CollisionQueryShape::Circle { center, .. } => center,
        CollisionQueryShape::OrientedBox { center, .. } => center,
        CollisionQueryShape::Capsule { start, end, .. } => Transform2D {
            x: (start.x + end.x) * 0.5,
            y: (start.y + end.y) * 0.5,
        },
        CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count,
        } => convex_polygon_vertices(&vertices, vertex_count)
            .map(convex_polygon_centroid)
            .unwrap_or(Transform2D { x: 0.0, y: 0.0 }),
    }
}

fn query_shape_bounds(shape: CollisionQueryShape) -> AabbBounds {
    match shape {
        CollisionQueryShape::Aabb(bounds) => bounds,
        CollisionQueryShape::Circle { center, radius } => AabbBounds {
            min_x: center.x - radius,
            min_y: center.y - radius,
            max_x: center.x + radius,
            max_y: center.y + radius,
        },
        CollisionQueryShape::OrientedBox {
            center,
            half_width,
            half_height,
            rotation_radians,
        } => oriented_box_bounds(center, half_width, half_height, rotation_radians),
        CollisionQueryShape::Capsule { start, end, radius } => AabbBounds {
            min_x: start.x.min(end.x) - radius,
            min_y: start.y.min(end.y) - radius,
            max_x: start.x.max(end.x) + radius,
            max_y: start.y.max(end.y) + radius,
        },
        CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count,
        } => convex_polygon_vertices(&vertices, vertex_count)
            .map(convex_polygon_bounds)
            .unwrap_or(AabbBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 0.0,
                max_y: 0.0,
            }),
    }
}

fn query_shape_sweep_bounds(shape: CollisionQueryShape, dx: f32, dy: f32) -> AabbBounds {
    let bounds = query_shape_bounds(shape);
    AabbBounds {
        min_x: bounds.min_x.min(bounds.min_x + dx),
        min_y: bounds.min_y.min(bounds.min_y + dy),
        max_x: bounds.max_x.max(bounds.max_x + dx),
        max_y: bounds.max_y.max(bounds.max_y + dy),
    }
}

fn query_aabb_half_extents(bounds: AabbBounds) -> (f32, f32) {
    (
        (bounds.max_x - bounds.min_x) * 0.5,
        (bounds.max_y - bounds.min_y) * 0.5,
    )
}

fn nearest_body_hit(
    point: Transform2D,
    transform: Transform2D,
    shape: ColliderShapeRef,
    entity: Entity,
    max_distance: f32,
) -> Option<NearestBodyQueryHit> {
    let (distance, point_x, point_y) = nearest_point_on_collider(point, transform, shape)?;
    if distance > max_distance {
        return None;
    }
    Some(NearestBodyQueryHit {
        entity,
        distance,
        point_x,
        point_y,
    })
}

fn nearest_point_on_collider(
    point: Transform2D,
    transform: Transform2D,
    shape: ColliderShapeRef,
) -> Option<(f32, f32, f32)> {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            let bounds = AabbBounds::from_transform(transform, collider);
            let point_x = point.x.max(bounds.min_x).min(bounds.max_x);
            let point_y = point.y.max(bounds.min_y).min(bounds.max_y);
            let dx = point.x - point_x;
            let dy = point.y - point_y;
            let distance = (dx * dx + dy * dy).sqrt();
            distance.is_finite().then_some((distance, point_x, point_y))
        }
        ColliderShapeRef::Circle(collider) => {
            if !is_valid_radius(collider.radius) {
                return None;
            }
            let center = collider.center(transform);
            let dx = point.x - center.x;
            let dy = point.y - center.y;
            let center_distance = (dx * dx + dy * dy).sqrt();
            if !center_distance.is_finite() {
                return None;
            }
            if center_distance <= collider.radius {
                return Some((0.0, point.x, point.y));
            }
            let scale = collider.radius / center_distance;
            Some((
                center_distance - collider.radius,
                center.x + dx * scale,
                center.y + dy * scale,
            ))
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => nearest_point_on_oriented_box(
            point,
            collider.center(transform),
            collider.half_width,
            collider.half_height,
            rotation_radians,
        ),
        ColliderShapeRef::Capsule(collider) => {
            if !capsule_collider_is_valid(collider) {
                return None;
            }
            let start = collider.start(transform);
            let end = collider.end(transform);
            let closest = closest_point_on_segment(point, start, end);
            let dx = point.x - closest.x;
            let dy = point.y - closest.y;
            let center_distance = (dx * dx + dy * dy).sqrt();
            if !center_distance.is_finite() {
                return None;
            }
            if center_distance <= collider.radius {
                return Some((0.0, point.x, point.y));
            }
            let scale = collider.radius / center_distance;
            Some((
                center_distance - collider.radius,
                closest.x + dx * scale,
                closest.y + dy * scale,
            ))
        }
        ColliderShapeRef::Edge(collider) => {
            if !edge_collider_is_valid(collider) {
                return None;
            }
            let start = collider.start(transform);
            let end = collider.end(transform);
            let closest = closest_point_on_segment(point, start, end);
            let dx = point.x - closest.x;
            let dy = point.y - closest.y;
            let distance = (dx * dx + dy * dy).sqrt();
            distance
                .is_finite()
                .then_some((distance, closest.x, closest.y))
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)?;
            nearest_point_on_convex_polygon(point, &vertices[..vertex_count])
        }
    }
}

fn update_nearest_body_hit(best: &mut Option<NearestBodyQueryHit>, next: NearestBodyQueryHit) {
    if best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| next.entity.id.cmp(&current.entity.id))
            .then_with(|| next.entity.generation.cmp(&current.entity.generation))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

impl PairFilter {
    fn orient(self, world: &World, pair: ColliderPair) -> Option<ColliderPair> {
        match self {
            Self::All => filters_allow_collider_pair(world, pair).then_some(pair),
            Self::Layers(layer_a, layer_b) => {
                let pair = orient_layer_pair(world, pair, layer_a, layer_b)?;
                filters_allow_collider_pair(world, pair).then_some(pair)
            }
            Self::Masks(category_a, category_b) => {
                orient_mask_pair(world, pair, category_a, category_b)
            }
        }
    }
}

fn orient_layer_pair(
    world: &World,
    pair: ColliderPair,
    layer_a: CollisionLayer,
    layer_b: CollisionLayer,
) -> Option<ColliderPair> {
    let a_layer = collider_layer_at(world, pair.a)?;
    let b_layer = collider_layer_at(world, pair.b)?;

    if a_layer == layer_a && b_layer == layer_b {
        Some(pair)
    } else if a_layer == layer_b && b_layer == layer_a {
        Some(ColliderPair {
            a: pair.b,
            b: pair.a,
        })
    } else {
        None
    }
}

fn orient_mask_pair(
    world: &World,
    pair: ColliderPair,
    category_a: CollisionMask,
    category_b: CollisionMask,
) -> Option<ColliderPair> {
    let a_filter =
        world.compound_collision_filter_at(pair.a.entity_index, pair.a.collider_index)?;
    let b_filter =
        world.compound_collision_filter_at(pair.b.entity_index, pair.b.collider_index)?;
    if !a_filter.can_collide_with(b_filter) {
        return None;
    }

    let a_in_a = a_filter.category.intersects(category_a);
    let b_in_b = b_filter.category.intersects(category_b);
    if a_in_a && b_in_b {
        return Some(pair);
    }

    let a_in_b = a_filter.category.intersects(category_b);
    let b_in_a = b_filter.category.intersects(category_a);
    if a_in_b && b_in_a {
        Some(ColliderPair {
            a: pair.b,
            b: pair.a,
        })
    } else {
        None
    }
}

fn mask_contains_entity(world: &World, index: usize, category: CollisionMask) -> bool {
    world
        .collision_filter_at(index)
        .is_some_and(|filter| filter.category.intersects(category))
}

fn mask_contains_collider(
    world: &World,
    index: usize,
    collider_index: usize,
    category: CollisionMask,
) -> bool {
    world
        .compound_collision_filter_at(index, collider_index)
        .is_some_and(|filter| filter.category.intersects(category))
}

fn filters_allow_collider_pair(world: &World, pair: ColliderPair) -> bool {
    let Some(a_filter) =
        world.compound_collision_filter_at(pair.a.entity_index, pair.a.collider_index)
    else {
        return false;
    };
    let Some(b_filter) =
        world.compound_collision_filter_at(pair.b.entity_index, pair.b.collider_index)
    else {
        return false;
    };
    a_filter.can_collide_with(b_filter)
}

fn collider_pair_has_trigger(world: &World, pair: ColliderPair) -> bool {
    world
        .compound_collider_at(pair.a.entity_index, pair.a.collider_index)
        .is_some_and(|collider| collider.is_trigger())
        || world
            .compound_collider_at(pair.b.entity_index, pair.b.collider_index)
            .is_some_and(|collider| collider.is_trigger())
}

fn filters_allow(world: &World, a: usize, b: usize) -> bool {
    let Some(a_filter) = world.collision_filter_at(a) else {
        return false;
    };
    let Some(b_filter) = world.collision_filter_at(b) else {
        return false;
    };
    a_filter.can_collide_with(b_filter)
}

fn precise_current_overlap(world: &World, pair: ColliderPair) -> bool {
    ColliderPairContext::from_collider_pair(world, pair).is_some_and(|pair| pair.overlaps())
}

fn contact_from_collider_pair(world: &World, pair: ColliderPair) -> Option<CollisionContact> {
    ColliderPairContext::from_collider_pair(world, pair)?.contact()
}

fn manifold_from_collider_pair(world: &World, pair: ColliderPair) -> Option<CollisionManifold> {
    ColliderPairContext::from_collider_pair(world, pair)?.manifold()
}

#[derive(Clone, Copy, Debug)]
struct ColliderPairContext {
    pair: CollisionPair,
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
}

impl ColliderPairContext {
    fn from_collider_pair(world: &World, collider_pair: ColliderPair) -> Option<Self> {
        let pair = collider_pair_to_pair(world, collider_pair);
        let a_index = pair.a.id as usize;
        let b_index = pair.b.id as usize;
        Some(Self {
            pair,
            at: world.transforms.get(a_index).copied().flatten()?,
            ac: collider_shape_at_segment(
                world,
                a_index,
                collider_pair.a.collider_index,
                collider_pair.a.segment_index,
            )?,
            bt: world.transforms.get(b_index).copied().flatten()?,
            bc: collider_shape_at_segment(
                world,
                b_index,
                collider_pair.b.collider_index,
                collider_pair.b.segment_index,
            )?,
        })
    }

    fn overlaps(self) -> bool {
        shapes_overlap(self.at, self.ac, self.bt, self.bc)
    }

    fn contact(self) -> Option<CollisionContact> {
        let contact = self.shape_contact()?;
        let (point_x, point_y) = self.contact_point(contact);
        Some(CollisionContact {
            pair: self.pair,
            normal_x: contact.normal_x,
            normal_y: contact.normal_y,
            penetration: contact.penetration,
            point_x,
            point_y,
        })
    }

    fn manifold(self) -> Option<CollisionManifold> {
        let contact = self.shape_contact()?;
        let (points, point_count) = self.contact_manifold_points(contact);
        (point_count > 0).then_some(CollisionManifold {
            pair: self.pair,
            normal_x: contact.normal_x,
            normal_y: contact.normal_y,
            penetration: contact.penetration,
            point_count,
            points,
        })
    }

    fn shape_contact(self) -> Option<AabbContact> {
        shape_contact(self.at, self.ac, self.bt, self.bc)
    }

    fn contact_point(self, contact: AabbContact) -> (f32, f32) {
        contact_point(self.at, self.ac, self.bt, self.bc, contact)
    }

    fn contact_manifold_points(
        self,
        contact: AabbContact,
    ) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
        contact_manifold_points(self.at, self.ac, self.bt, self.bc, contact)
    }
}

fn contact_debug_line(
    world: &World,
    contact: CollisionContact,
    normal_length: f32,
) -> Option<PhysicsDebugLine> {
    let at = world
        .transforms
        .get(contact.pair.a.id as usize)
        .copied()
        .flatten()?;
    let bt = world
        .transforms
        .get(contact.pair.b.id as usize)
        .copied()
        .flatten()?;
    let x0 = if contact.point_x.is_finite() {
        contact.point_x
    } else {
        (at.x + bt.x) * 0.5
    };
    let y0 = if contact.point_y.is_finite() {
        contact.point_y
    } else {
        (at.y + bt.y) * 0.5
    };
    Some(PhysicsDebugLine {
        x0,
        y0,
        x1: x0 + contact.normal_x * normal_length,
        y1: y0 + contact.normal_y * normal_length,
        r: CONTACT_DEBUG_COLOR[0],
        g: CONTACT_DEBUG_COLOR[1],
        b: CONTACT_DEBUG_COLOR[2],
        a: CONTACT_DEBUG_COLOR[3],
    })
}

fn append_contact_point_debug_lines(contact: CollisionContact, lines: &mut Vec<PhysicsDebugLine>) {
    append_cross_debug_lines(
        contact.point_x,
        contact.point_y,
        CONTACT_POINT_MARKER_SIZE,
        CONTACT_DEBUG_COLOR,
        lines,
    );
}

fn append_cross_debug_lines(
    x: f32,
    y: f32,
    marker_size: f32,
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    if !x.is_finite() || !y.is_finite() || !marker_size.is_finite() || marker_size <= 0.0 {
        return;
    }
    lines.push(debug_line(x - marker_size, y, x + marker_size, y, color));
    lines.push(debug_line(x, y - marker_size, x, y + marker_size, color));
}

fn append_collider_outline_debug_lines(
    transform: Transform2D,
    shape: ColliderShapeRef,
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    match shape {
        ColliderShapeRef::Aabb(collider) => append_bounds_debug_lines(
            AabbBounds::from_transform(transform, collider),
            color,
            lines,
        ),
        ColliderShapeRef::Circle(collider) => {
            append_circle_debug_lines(collider.center(transform), collider.radius, color, lines)
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            if let Some(geometry) = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            ) {
                append_polygon_debug_lines(&oriented_box_vertices(geometry), color, lines);
            }
        }
        ColliderShapeRef::Capsule(collider) => {
            let start = collider.start(transform);
            let end = collider.end(transform);
            lines.push(debug_line(start.x, start.y, end.x, end.y, color));
            append_circle_debug_lines(start, collider.radius, color, lines);
            append_circle_debug_lines(end, collider.radius, color, lines);
        }
        ColliderShapeRef::Edge(collider) => {
            let start = collider.start(transform);
            let end = collider.end(transform);
            lines.push(debug_line(start.x, start.y, end.x, end.y, color));
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            if let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)
            {
                append_polygon_debug_lines(&vertices[..vertex_count], color, lines);
            }
        }
    }
}

fn append_circle_debug_lines(
    center: Transform2D,
    radius: f32,
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    if !is_valid_radius(radius) {
        return;
    }
    const SEGMENTS: usize = 16;
    let mut previous = Transform2D {
        x: center.x + radius,
        y: center.y,
    };
    for segment in 1..=SEGMENTS {
        let angle = (segment as f32 / SEGMENTS as f32) * core::f32::consts::TAU;
        let next = Transform2D {
            x: center.x + angle.cos() * radius,
            y: center.y + angle.sin() * radius,
        };
        lines.push(debug_line(previous.x, previous.y, next.x, next.y, color));
        previous = next;
    }
}

fn append_polygon_debug_lines(
    vertices: &[Transform2D],
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    if vertices.len() < 2 {
        return;
    }
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        lines.push(debug_line(start.x, start.y, end.x, end.y, color));
    }
}

fn collider_debug_color(world: &World, index: usize, show_sleeping_state: bool) -> [f32; 4] {
    if show_sleeping_state
        && world
            .rigid_bodies
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|body| body.is_sleeping)
    {
        COLLIDER_SLEEPING_DEBUG_COLOR
    } else {
        COLLIDER_AWAKE_DEBUG_COLOR
    }
}

fn append_entity_link_debug_line(
    world: &World,
    entity_a: Entity,
    entity_b: Entity,
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    let Some(a) = world.transform(entity_a) else {
        return;
    };
    let Some(b) = world.transform(entity_b) else {
        return;
    };
    lines.push(debug_line(a.x, a.y, b.x, b.y, color));
}

fn append_pulley_joint_debug_lines(
    world: &World,
    joint: PulleyJoint,
    lines: &mut Vec<PhysicsDebugLine>,
) {
    let Some(anchor_a) = pulley_joint_world_anchor(
        world,
        joint.entity_a,
        joint.local_anchor_a_x,
        joint.local_anchor_a_y,
    ) else {
        return;
    };
    let Some(anchor_b) = pulley_joint_world_anchor(
        world,
        joint.entity_b,
        joint.local_anchor_b_x,
        joint.local_anchor_b_y,
    ) else {
        return;
    };
    let ground_anchor_a = Transform2D {
        x: finite_debug_number(joint.ground_anchor_a_x),
        y: finite_debug_number(joint.ground_anchor_a_y),
    };
    let ground_anchor_b = Transform2D {
        x: finite_debug_number(joint.ground_anchor_b_x),
        y: finite_debug_number(joint.ground_anchor_b_y),
    };
    lines.push(debug_line(
        ground_anchor_a.x,
        ground_anchor_a.y,
        anchor_a.x,
        anchor_a.y,
        JOINT_DEBUG_COLOR,
    ));
    lines.push(debug_line(
        ground_anchor_b.x,
        ground_anchor_b.y,
        anchor_b.x,
        anchor_b.y,
        JOINT_DEBUG_COLOR,
    ));
    lines.push(debug_line(
        ground_anchor_a.x,
        ground_anchor_a.y,
        ground_anchor_b.x,
        ground_anchor_b.y,
        JOINT_DEBUG_COLOR,
    ));
}

fn pulley_joint_world_anchor(
    world: &World,
    entity: Entity,
    local_anchor_x: f32,
    local_anchor_y: f32,
) -> Option<Transform2D> {
    let transform = world.transform(entity)?;
    let index = entity.id as usize;
    let rotation = world
        .rotations
        .get(index)
        .copied()
        .flatten()
        .map(|rotation| rotation.radians)
        .filter(|radians| radians.is_finite())
        .unwrap_or(0.0);
    let (sin, cos) = rotation.sin_cos();
    let x = finite_debug_number(local_anchor_x);
    let y = finite_debug_number(local_anchor_y);
    Some(Transform2D {
        x: transform.x + x * cos - y * sin,
        y: transform.y + x * sin + y * cos,
    })
}

fn finite_debug_number(value: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

fn append_bounds_debug_lines(
    bounds: AabbBounds,
    color: [f32; 4],
    lines: &mut Vec<PhysicsDebugLine>,
) {
    lines.push(debug_line(
        bounds.min_x,
        bounds.min_y,
        bounds.max_x,
        bounds.min_y,
        color,
    ));
    lines.push(debug_line(
        bounds.max_x,
        bounds.min_y,
        bounds.max_x,
        bounds.max_y,
        color,
    ));
    lines.push(debug_line(
        bounds.max_x,
        bounds.max_y,
        bounds.min_x,
        bounds.max_y,
        color,
    ));
    lines.push(debug_line(
        bounds.min_x,
        bounds.max_y,
        bounds.min_x,
        bounds.min_y,
        color,
    ));
}

fn debug_line(x0: f32, y0: f32, x1: f32, y1: f32, color: [f32; 4]) -> PhysicsDebugLine {
    PhysicsDebugLine {
        x0,
        y0,
        x1,
        y1,
        r: color[0],
        g: color[1],
        b: color[2],
        a: color[3],
    }
}

fn shapes_overlap(
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
) -> bool {
    match (ac, bc) {
        (ColliderShapeRef::Edge(ac), other) => shapes_overlap(
            at,
            ColliderShapeRef::Capsule(edge_as_capsule(ac)),
            bt,
            other,
        ),
        (other, ColliderShapeRef::Edge(bc)) => shapes_overlap(
            at,
            other,
            bt,
            ColliderShapeRef::Capsule(edge_as_capsule(bc)),
        ),
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Aabb(bc)) => {
            AabbBounds::from_transform(at, ac).overlaps(AabbBounds::from_transform(bt, bc))
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Circle(bc)) => {
            aabb_overlaps_circle(at, ac, bc.center(bt), bc.radius)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_overlaps_circle(bt, bc, ac.center(at), ac.radius)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Circle(bc)) => {
            circles_overlap(ac.center(at), ac.radius, bc.center(bt), bc.radius)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_aabb(b_box, AabbBounds::from_transform(at, ac))
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Aabb(bc)) => {
            let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_aabb(a_box, AabbBounds::from_transform(bt, bc))
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_circle(b_box, ac.center(at), ac.radius)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Circle(bc)) => {
            let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_circle(a_box, bc.center(bt), bc.radius)
        }
        (
            ColliderShapeRef::OrientedBox(ac, a_rotation),
            ColliderShapeRef::OrientedBox(bc, b_rotation),
        ) => {
            let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            else {
                return false;
            };
            let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            else {
                return false;
            };
            oriented_boxes_overlap(a_box, b_box)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Capsule(bc)) => capsule_overlaps_aabb(
            bc.start(bt),
            bc.end(bt),
            bc.radius,
            AabbBounds::from_transform(at, ac),
        ),
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Capsule(bc)) => {
            let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_capsule(a_box, bc.start(bt), bc.end(bt), bc.radius)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            else {
                return false;
            };
            oriented_box_overlaps_capsule(b_box, ac.start(at), ac.end(at), ac.radius)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Aabb(bc)) => capsule_overlaps_aabb(
            ac.start(at),
            ac.end(at),
            ac.radius,
            AabbBounds::from_transform(bt, bc),
        ),
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Capsule(bc)) => capsule_overlaps_circle(
            bc.start(bt),
            bc.end(bt),
            bc.radius,
            ac.center(at),
            ac.radius,
        ),
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Circle(bc)) => capsule_overlaps_circle(
            ac.start(at),
            ac.end(at),
            ac.radius,
            bc.center(bt),
            bc.radius,
        ),
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Capsule(bc)) => capsules_overlap(
            ac.start(at),
            ac.end(at),
            ac.radius,
            bc.start(bt),
            bc.end(bt),
            bc.radius,
        ),
        (ColliderShapeRef::ConvexPolygon(ac, a_rotation), other) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(at, ac, a_rotation)
            else {
                return false;
            };
            collider_overlaps_convex_polygon(bt, other, &vertices[..vertex_count])
        }
        (other, ColliderShapeRef::ConvexPolygon(bc, b_rotation)) => {
            let Some((vertices, vertex_count)) =
                convex_polygon_collider_vertices_slice(bt, bc, b_rotation)
            else {
                return false;
            };
            collider_overlaps_convex_polygon(at, other, &vertices[..vertex_count])
        }
    }
}

fn shape_contact(
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
) -> Option<AabbContact> {
    match (ac, bc) {
        (ColliderShapeRef::Edge(ac), other) => shape_contact(
            at,
            ColliderShapeRef::Capsule(edge_as_capsule(ac)),
            bt,
            other,
        ),
        (other, ColliderShapeRef::Edge(bc)) => shape_contact(
            at,
            other,
            bt,
            ColliderShapeRef::Capsule(edge_as_capsule(bc)),
        ),
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Aabb(bc)) => aabb_contact(at, ac, bt, bc),
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Circle(bc)) => {
            aabb_circle_contact(at, ac, bt, bc)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_circle_contact(bt, bc, at, ac).map(|contact| AabbContact {
                normal_x: -contact.normal_x,
                normal_y: -contact.normal_y,
                penetration: contact.penetration,
            })
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Circle(bc)) => {
            circle_contact(at, ac, bt, bc)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let a_box = aabb_as_oriented_box(AabbBounds::from_transform(at, ac))?;
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)?;
            oriented_box_oriented_box_contact(a_box, b_box)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Aabb(bc)) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)?;
            let b_box = aabb_as_oriented_box(AabbBounds::from_transform(bt, bc))?;
            oriented_box_oriented_box_contact(a_box, b_box)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)?;
            oriented_box_circle_contact(b_box, ac.center(at), ac.radius).map(invert_contact)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Circle(bc)) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)?;
            oriented_box_circle_contact(a_box, bc.center(bt), bc.radius)
        }
        (
            ColliderShapeRef::OrientedBox(ac, a_rotation),
            ColliderShapeRef::OrientedBox(bc, b_rotation),
        ) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)?;
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)?;
            oriented_box_oriented_box_contact(a_box, b_box)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Capsule(bc)) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)?;
            oriented_box_capsule_contact(a_box, bc.start(bt), bc.end(bt), bc.radius)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)?;
            oriented_box_capsule_contact(b_box, ac.start(at), ac.end(at), ac.radius)
                .map(invert_contact)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Capsule(bc)) => {
            aabb_capsule_contact(at, ac, bt, bc)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Capsule(bc)) => {
            capsule_circle_contact(bt, bc, at, ac).map(invert_contact)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_capsule_contact(bt, bc, at, ac).map(invert_contact)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Circle(bc)) => {
            capsule_circle_contact(at, ac, bt, bc)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Capsule(bc)) => {
            capsule_capsule_contact(at, ac, bt, bc)
        }
        (ColliderShapeRef::ConvexPolygon(_, _), _) | (_, ColliderShapeRef::ConvexPolygon(_, _)) => {
            convex_shape_contact_from_shapes(at, ac, bt, bc)
        }
    }
}

fn contact_point(
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
    contact: AabbContact,
) -> (f32, f32) {
    match (ac, bc) {
        (ColliderShapeRef::Edge(ac), other) => contact_point(
            at,
            ColliderShapeRef::Capsule(edge_as_capsule(ac)),
            bt,
            other,
            contact,
        ),
        (other, ColliderShapeRef::Edge(bc)) => contact_point(
            at,
            other,
            bt,
            ColliderShapeRef::Capsule(edge_as_capsule(bc)),
            contact,
        ),
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_aabb_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Circle(bc)) => {
            aabb_circle_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Aabb(bc)) => {
            circle_aabb_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Circle(_bc)) => {
            circle_circle_contact_point(at, ac, contact)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let a_box = aabb_as_oriented_box(AabbBounds::from_transform(at, ac));
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation);
            if let (Some(a_box), Some(b_box)) = (a_box, b_box) {
                let point = oriented_box_oriented_box_contact_point(a_box, b_box, contact);
                return (point.x, point.y);
            }
            aabb_aabb_contact_point(
                at,
                ac,
                bt,
                AabbCollider::new(0.0, 0.0, false, bc.layer),
                contact,
            )
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Aabb(bc)) => {
            if let (Some(a_box), Some(b_box)) = (
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation),
                aabb_as_oriented_box(AabbBounds::from_transform(bt, bc)),
            ) {
                let point = oriented_box_oriented_box_contact_point(a_box, b_box, contact);
                return (point.x, point.y);
            }
            let a_center = ac.center(at);
            (a_center.x, a_center.y)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            if let Some(oriented_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            {
                let point = oriented_box_circle_contact_point(
                    oriented_box,
                    ac.center(at),
                    ac.radius,
                    invert_contact(contact),
                );
                return (point.x, point.y);
            }
            let center = ac.center(at);
            (center.x, center.y)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Circle(bc)) => {
            if let Some(oriented_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            {
                let point = oriented_box_circle_contact_point(
                    oriented_box,
                    bc.center(bt),
                    bc.radius,
                    contact,
                );
                return (point.x, point.y);
            }
            let center = bc.center(bt);
            (center.x, center.y)
        }
        (
            ColliderShapeRef::OrientedBox(ac, a_rotation),
            ColliderShapeRef::OrientedBox(bc, b_rotation),
        ) => {
            if let (Some(a_box), Some(b_box)) = (
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation),
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation),
            ) {
                let point = oriented_box_oriented_box_contact_point(a_box, b_box, contact);
                return (point.x, point.y);
            }
            let a_center = ac.center(at);
            let b_center = bc.center(bt);
            (
                (a_center.x + b_center.x) * 0.5,
                (a_center.y + b_center.y) * 0.5,
            )
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Capsule(bc)) => {
            if let Some(oriented_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            {
                let point = oriented_box_capsule_contact_point(
                    oriented_box,
                    bc.start(bt),
                    bc.end(bt),
                    bc.radius,
                    contact,
                );
                return (point.x, point.y);
            }
            let center = bc.center(bt);
            (center.x, center.y)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            if let Some(oriented_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            {
                let point = oriented_box_capsule_contact_point(
                    oriented_box,
                    ac.start(at),
                    ac.end(at),
                    ac.radius,
                    invert_contact(contact),
                );
                return (point.x, point.y);
            }
            let center = ac.center(at);
            (center.x, center.y)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Capsule(bc)) => {
            aabb_capsule_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Capsule(_bc)) => {
            circle_circle_contact_point(at, ac, contact)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Aabb(bc)) => {
            capsule_aabb_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Circle(bc)) => {
            capsule_circle_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Capsule(bc)) => {
            capsule_capsule_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::ConvexPolygon(_, _), _) | (_, ColliderShapeRef::ConvexPolygon(_, _)) => {
            if let (Some(a), Some(b)) = (
                convex_contact_geometry_from_shape(at, ac),
                convex_contact_geometry_from_shape(bt, bc),
            ) {
                let point = convex_shape_contact_point(a, b, contact);
                return (point.x, point.y);
            }
            let a_center = collider_shape_center(at, ac);
            let b_center = collider_shape_center(bt, bc);
            (
                (a_center.x + b_center.x) * 0.5,
                (a_center.y + b_center.y) * 0.5,
            )
        }
    }
}

fn contact_manifold_points(
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    match (ac, bc) {
        (ColliderShapeRef::Edge(ac), other) => contact_manifold_points(
            at,
            ColliderShapeRef::Capsule(edge_as_capsule(ac)),
            bt,
            other,
            contact,
        ),
        (other, ColliderShapeRef::Edge(bc)) => contact_manifold_points(
            at,
            other,
            bt,
            ColliderShapeRef::Capsule(edge_as_capsule(bc)),
            contact,
        ),
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_aabb_contact_manifold_points(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Circle(bc)) => {
            if let Some(points) = aabb_circle_contact_manifold_points(at, ac, bt, bc, contact) {
                return points;
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Aabb(ac),
                bt,
                ColliderShapeRef::Circle(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Aabb(bc)) => {
            if let Some(points) =
                aabb_circle_contact_manifold_points(bt, bc, at, ac, invert_contact(contact))
            {
                return points;
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Circle(ac),
                bt,
                ColliderShapeRef::Aabb(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let a_box = aabb_as_oriented_box(AabbBounds::from_transform(at, ac));
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation);
            if let (Some(a_box), Some(b_box)) = (a_box, b_box) {
                return oriented_box_oriented_box_contact_manifold_points(a_box, b_box, contact);
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Aabb(ac),
                bt,
                ColliderShapeRef::OrientedBox(bc, b_rotation),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Aabb(bc)) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation);
            let b_box = aabb_as_oriented_box(AabbBounds::from_transform(bt, bc));
            if let (Some(a_box), Some(b_box)) = (a_box, b_box) {
                return oriented_box_oriented_box_contact_manifold_points(a_box, b_box, contact);
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::OrientedBox(ac, a_rotation),
                bt,
                ColliderShapeRef::Aabb(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            if let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            {
                if let Some(points) = oriented_box_circle_contact_manifold_points(
                    b_box,
                    ac.center(at),
                    ac.radius,
                    invert_contact(contact),
                ) {
                    return points;
                }
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Circle(ac),
                bt,
                ColliderShapeRef::OrientedBox(bc, b_rotation),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Circle(bc)) => {
            if let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            {
                if let Some(points) = oriented_box_circle_contact_manifold_points(
                    a_box,
                    bc.center(bt),
                    bc.radius,
                    contact,
                ) {
                    return points;
                }
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::OrientedBox(ac, a_rotation),
                bt,
                ColliderShapeRef::Circle(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (
            ColliderShapeRef::OrientedBox(ac, a_rotation),
            ColliderShapeRef::OrientedBox(bc, b_rotation),
        ) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation);
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation);
            if let (Some(a_box), Some(b_box)) = (a_box, b_box) {
                return oriented_box_oriented_box_contact_manifold_points(a_box, b_box, contact);
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::OrientedBox(ac, a_rotation),
                bt,
                ColliderShapeRef::OrientedBox(bc, b_rotation),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Capsule(bc)) => {
            if let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            {
                return oriented_box_capsule_contact_manifold_points(
                    a_box,
                    bc.start(bt),
                    bc.end(bt),
                    bc.radius,
                    contact,
                );
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::OrientedBox(ac, a_rotation),
                bt,
                ColliderShapeRef::Capsule(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            if let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            {
                return oriented_box_capsule_contact_manifold_points(
                    b_box,
                    ac.start(at),
                    ac.end(at),
                    ac.radius,
                    invert_contact(contact),
                );
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Capsule(ac),
                bt,
                ColliderShapeRef::OrientedBox(bc, b_rotation),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Capsule(bc)) => {
            aabb_capsule_contact_manifold_points(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Capsule(bc)) => {
            if let Some(points) =
                capsule_circle_contact_manifold_points(bt, bc, at, ac, invert_contact(contact))
            {
                return points;
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Circle(ac),
                bt,
                ColliderShapeRef::Capsule(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_capsule_contact_manifold_points(bt, bc, at, ac, invert_contact(contact))
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Circle(bc)) => {
            if let Some(points) = capsule_circle_contact_manifold_points(at, ac, bt, bc, contact) {
                return points;
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Capsule(ac),
                bt,
                ColliderShapeRef::Circle(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Capsule(bc)) => {
            capsule_capsule_contact_manifold_points(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::ConvexPolygon(_, _), _) | (_, ColliderShapeRef::ConvexPolygon(_, _)) => {
            if let (Some(a), Some(b)) = (
                convex_contact_geometry_from_shape(at, ac),
                convex_contact_geometry_from_shape(bt, bc),
            ) {
                if let Some(points) = convex_polygon_contact_manifold_points(a, b, contact) {
                    return points;
                }
            }
            let (point_x, point_y) = contact_point(at, ac, bt, bc, contact);
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        _ => {
            let (point_x, point_y) = contact_point(at, ac, bt, bc, contact);
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
    }
}

fn aabb_aabb_contact_manifold_points(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: AabbCollider,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    let a_bounds = AabbBounds::from_transform(at, ac);
    let b_bounds = AabbBounds::from_transform(bt, bc);
    let a_center = ac.center(at);
    if contact.normal_x != 0.0 {
        let min_y = a_bounds.min_y.max(b_bounds.min_y);
        let max_y = a_bounds.max_y.min(b_bounds.max_y);
        let face_x = a_center.x + contact.normal_x * ac.half_width;
        two_or_one_contact_manifold_points(face_x, min_y, face_x, max_y, contact.penetration)
    } else {
        let min_x = a_bounds.min_x.max(b_bounds.min_x);
        let max_x = a_bounds.max_x.min(b_bounds.max_x);
        let face_y = a_center.y + contact.normal_y * ac.half_height;
        two_or_one_contact_manifold_points(min_x, face_y, max_x, face_y, contact.penetration)
    }
}

fn aabb_circle_contact_manifold_points(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CircleCollider,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let face = aabb_reference_face(AabbBounds::from_transform(at, ac), contact)?;
    circle_face_contact_manifold_points(face, bc.center(bt), bc.radius, contact)
}

fn oriented_box_oriented_box_contact_manifold_points(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    let Some((reference, incident)) = oriented_box_reference_incident_faces(
        a,
        b,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    ) else {
        let point = oriented_box_oriented_box_contact_point(a, b, contact);
        return single_contact_manifold_point(point.x, point.y, contact.penetration);
    };

    let Some((first, second)) = clip_segment_to_face_tangent_interval(
        incident.0,
        incident.1,
        reference.center,
        reference.tangent,
        reference.tangent_extent,
    ) else {
        let point = oriented_box_oriented_box_contact_point(a, b, contact);
        return single_contact_manifold_point(point.x, point.y, contact.penetration);
    };

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_face_clipped_contact_point(&mut points, &mut point_count, reference, first);
    append_face_clipped_contact_point(&mut points, &mut point_count, reference, second);
    if point_count > 0 {
        (points, point_count)
    } else {
        let point = oriented_box_oriented_box_contact_point(a, b, contact);
        single_contact_manifold_point(point.x, point.y, contact.penetration)
    }
}

fn oriented_box_circle_contact_manifold_points(
    oriented_box: OrientedBoxGeometry,
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let face = oriented_box_reference_face(
        oriented_box,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    )?;
    circle_face_contact_manifold_points(face, center, radius, contact)
}

fn convex_polygon_contact_manifold_points(
    a: ConvexContactGeometry,
    b: ConvexContactGeometry,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    match (a, b) {
        (
            ConvexContactGeometry::Polygon {
                vertices,
                vertex_count,
                ..
            },
            ConvexContactGeometry::Circle { center, radius },
        ) => convex_polygon_circle_contact_manifold_points(
            convex_contact_polygon_vertices_slice(&vertices, vertex_count)?,
            center,
            radius,
            contact,
        ),
        (
            ConvexContactGeometry::Circle { center, radius },
            ConvexContactGeometry::Polygon {
                vertices,
                vertex_count,
                ..
            },
        ) => convex_polygon_circle_contact_manifold_points(
            convex_contact_polygon_vertices_slice(&vertices, vertex_count)?,
            center,
            radius,
            invert_contact(contact),
        ),
        (
            ConvexContactGeometry::Polygon {
                vertices,
                vertex_count,
                ..
            },
            ConvexContactGeometry::Capsule {
                start, end, radius, ..
            },
        ) => convex_polygon_capsule_contact_manifold_points(
            convex_contact_polygon_vertices_slice(&vertices, vertex_count)?,
            start,
            end,
            radius,
            contact,
        ),
        (
            ConvexContactGeometry::Capsule {
                start, end, radius, ..
            },
            ConvexContactGeometry::Polygon {
                vertices,
                vertex_count,
                ..
            },
        ) => convex_polygon_capsule_contact_manifold_points(
            convex_contact_polygon_vertices_slice(&vertices, vertex_count)?,
            start,
            end,
            radius,
            invert_contact(contact),
        ),
        (
            ConvexContactGeometry::Polygon {
                vertices: a_vertices,
                vertex_count: a_vertex_count,
                ..
            },
            ConvexContactGeometry::Polygon {
                vertices: b_vertices,
                vertex_count: b_vertex_count,
                ..
            },
        ) => convex_polygon_polygon_contact_manifold_points(
            convex_contact_polygon_vertices_slice(&a_vertices, a_vertex_count)?,
            convex_contact_polygon_vertices_slice(&b_vertices, b_vertex_count)?,
            contact,
        ),
        _ => None,
    }
}

fn convex_contact_polygon_vertices_slice(
    vertices: &[Transform2D; MAX_CONVEX_POLYGON_VERTICES],
    vertex_count: usize,
) -> Option<&[Transform2D]> {
    if vertex_count > MAX_CONVEX_POLYGON_VERTICES {
        return None;
    }
    let vertices = &vertices[..vertex_count];
    convex_polygon_is_valid(vertices).then_some(vertices)
}

fn convex_polygon_polygon_contact_manifold_points(
    a_vertices: &[Transform2D],
    b_vertices: &[Transform2D],
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let (reference, incident) = convex_polygon_reference_incident_faces(
        a_vertices,
        b_vertices,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    )?;
    let (first, second) = clip_segment_to_face_tangent_interval(
        incident.0,
        incident.1,
        reference.center,
        reference.tangent,
        reference.tangent_extent,
    )?;

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_face_clipped_contact_point(&mut points, &mut point_count, reference, first);
    append_face_clipped_contact_point(&mut points, &mut point_count, reference, second);
    (point_count > 0).then_some((points, point_count))
}

fn convex_polygon_circle_contact_manifold_points(
    vertices: &[Transform2D],
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if let Some(points) =
        convex_polygon_circle_face_contact_manifold_points(vertices, center, radius, contact)
    {
        return Some(points);
    }

    let point = convex_polygon_round_contact_point(vertices, center, radius, contact)?;
    Some(single_contact_manifold_point(
        point.point_x,
        point.point_y,
        point.penetration,
    ))
}

fn convex_polygon_circle_face_contact_manifold_points(
    vertices: &[Transform2D],
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let face = convex_polygon_reference_face(
        vertices,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    )?;
    circle_face_contact_manifold_points(face, center, radius, contact)
}

fn convex_polygon_capsule_contact_manifold_points(
    vertices: &[Transform2D],
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if let Some(points) =
        convex_polygon_capsule_side_contact_manifold_points(vertices, start, end, contact)
    {
        return Some(points);
    }
    if let Some(points) = convex_polygon_capsule_arc_clipped_contact_manifold_points(
        vertices, start, end, radius, contact,
    ) {
        return Some(points);
    }
    if let Some(points) = convex_polygon_capsule_endpoint_contact_manifold_points(
        vertices, start, end, radius, contact,
    ) {
        return Some(points);
    }

    let point = convex_shape_contact_point(
        ConvexContactGeometry::Polygon {
            vertices: convex_contact_polygon_array(vertices)?,
            vertex_count: vertices.len(),
            center: convex_polygon_centroid(vertices),
        },
        ConvexContactGeometry::Capsule {
            start,
            end,
            radius,
            center: Transform2D {
                x: (start.x + end.x) * 0.5,
                y: (start.y + end.y) * 0.5,
            },
        },
        contact,
    );
    Some(single_contact_manifold_point(
        point.x,
        point.y,
        contact.penetration,
    ))
}

fn convex_polygon_capsule_arc_clipped_contact_manifold_points(
    vertices: &[Transform2D],
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let reference = convex_polygon_reference_face(
        vertices,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    )?;
    capsule_face_arc_clipped_contact_manifold_points(reference, start, end, radius)
}

fn convex_polygon_capsule_side_contact_manifold_points(
    vertices: &[Transform2D],
    start: Transform2D,
    end: Transform2D,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let reference = convex_polygon_reference_face(
        vertices,
        Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        },
    )?;
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let segment_length = (segment_x * segment_x + segment_y * segment_y).sqrt();
    if !segment_length.is_finite() || segment_length <= RAY_EPSILON {
        return None;
    }

    let axis = Velocity {
        vx: segment_x / segment_length,
        vy: segment_y / segment_length,
    };
    let tangent_alignment = dot_velocity(axis, reference.tangent).abs();
    let normal_alignment = dot_velocity(axis, reference.normal).abs();
    if tangent_alignment < 1.0 - RAY_EPSILON || normal_alignment > RAY_EPSILON {
        return None;
    }

    let start_tangent = point_tangent_projection(start, reference);
    let end_tangent = point_tangent_projection(end, reference);
    let min_tangent = start_tangent
        .min(end_tangent)
        .max(-reference.tangent_extent);
    let max_tangent = start_tangent.max(end_tangent).min(reference.tangent_extent);
    if max_tangent - min_tangent <= RAY_EPSILON {
        return None;
    }

    let first = contact_face_point(reference, min_tangent);
    let second = contact_face_point(reference, max_tangent);
    Some(two_or_one_contact_manifold_points(
        first.x,
        first.y,
        second.x,
        second.y,
        contact.penetration,
    ))
}

fn convex_polygon_capsule_endpoint_contact_manifold_points(
    vertices: &[Transform2D],
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if !is_valid_radius(radius) {
        return None;
    }

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_convex_polygon_round_contact_point(
        &mut points,
        &mut point_count,
        vertices,
        start,
        radius,
        contact,
    );
    append_convex_polygon_round_contact_point(
        &mut points,
        &mut point_count,
        vertices,
        end,
        radius,
        contact,
    );
    (point_count > 0).then_some((points, point_count))
}

fn append_convex_polygon_round_contact_point(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    vertices: &[Transform2D],
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) {
    if let Some(point) = convex_polygon_round_contact_point(vertices, center, radius, contact) {
        append_contact_manifold_point_by_depth(points, point_count, point);
    }
}

fn convex_polygon_round_contact_point(
    vertices: &[Transform2D],
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<CollisionContactPoint> {
    if !is_valid_radius(radius) || !convex_polygon_is_valid(vertices) {
        return None;
    }

    if convex_polygon_contains_point(vertices, center) {
        return Some(CollisionContactPoint {
            point_x: center.x - contact.normal_x * radius,
            point_y: center.y - contact.normal_y * radius,
            penetration: contact.penetration,
        });
    }

    let (distance, point_x, point_y) = nearest_point_on_convex_polygon(center, vertices)?;
    if distance > radius + RAY_EPSILON {
        return None;
    }

    Some(CollisionContactPoint {
        point_x,
        point_y,
        penetration: (radius - distance).max(0.0),
    })
}

fn circle_face_contact_manifold_points(
    face: ContactFace,
    center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if !is_valid_radius(radius)
        || !center.x.is_finite()
        || !center.y.is_finite()
        || !face.center.x.is_finite()
        || !face.center.y.is_finite()
        || !face.normal.vx.is_finite()
        || !face.normal.vy.is_finite()
        || !face.tangent.vx.is_finite()
        || !face.tangent.vy.is_finite()
        || !face.tangent_extent.is_finite()
        || face.tangent_extent <= RAY_EPSILON
        || !contact.penetration.is_finite()
    {
        return None;
    }

    let normal_length =
        (contact.normal_x * contact.normal_x + contact.normal_y * contact.normal_y).sqrt();
    if !normal_length.is_finite() || normal_length <= RAY_EPSILON {
        return None;
    }

    let contact_normal = Velocity {
        vx: contact.normal_x / normal_length,
        vy: contact.normal_y / normal_length,
    };
    if dot_velocity(face.normal, contact_normal) < 1.0 - RAY_EPSILON {
        return None;
    }

    let center_tangent = point_tangent_projection(center, face);
    if center_tangent < -face.tangent_extent - RAY_EPSILON
        || center_tangent > face.tangent_extent + RAY_EPSILON
    {
        return None;
    }

    let normal_distance = point_normal_projection(center, face).abs();
    if !normal_distance.is_finite() || normal_distance > radius + RAY_EPSILON {
        return None;
    }

    let tangent_radius = (radius * radius - normal_distance * normal_distance)
        .max(0.0)
        .sqrt();
    let min = (center_tangent - tangent_radius).max(-face.tangent_extent);
    let max = (center_tangent + tangent_radius).min(face.tangent_extent);
    if max - min <= RAY_EPSILON {
        return None;
    }

    let first = contact_face_point(face, min);
    let second = contact_face_point(face, max);
    Some(two_or_one_contact_manifold_points(
        first.x,
        first.y,
        second.x,
        second.y,
        contact.penetration,
    ))
}

fn convex_contact_polygon_array(
    vertices: &[Transform2D],
) -> Option<[Transform2D; MAX_CONVEX_POLYGON_VERTICES]> {
    if !convex_polygon_is_valid(vertices) {
        return None;
    }

    let mut copied = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
    for (index, vertex) in vertices.iter().copied().enumerate() {
        copied[index] = vertex;
    }
    Some(copied)
}

fn point_tangent_projection(point: Transform2D, face: ContactFace) -> f32 {
    (point.x - face.center.x) * face.tangent.vx + (point.y - face.center.y) * face.tangent.vy
}

fn contact_face_point(face: ContactFace, tangent_projection: f32) -> Transform2D {
    Transform2D {
        x: face.center.x + face.tangent.vx * tangent_projection,
        y: face.center.y + face.tangent.vy * tangent_projection,
    }
}

fn capsule_face_arc_clipped_contact_manifold_points(
    face: ContactFace,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let interval = capsule_face_tangent_interval(face, start, end, radius)?;
    let min = interval.min.max(-face.tangent_extent);
    let max = interval.max.min(face.tangent_extent);
    if max - min <= RAY_EPSILON {
        return None;
    }

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_capsule_face_arc_clipped_contact_point(
        &mut points,
        &mut point_count,
        face,
        start,
        end,
        radius,
        min,
    );
    append_capsule_face_arc_clipped_contact_point(
        &mut points,
        &mut point_count,
        face,
        start,
        end,
        radius,
        max,
    );
    (point_count > 0).then_some((points, point_count))
}

fn capsule_face_tangent_interval(
    face: ContactFace,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<TangentInterval> {
    if !is_valid_radius(radius)
        || !start.x.is_finite()
        || !start.y.is_finite()
        || !end.x.is_finite()
        || !end.y.is_finite()
        || !face.center.x.is_finite()
        || !face.center.y.is_finite()
        || !face.normal.vx.is_finite()
        || !face.normal.vy.is_finite()
        || !face.tangent.vx.is_finite()
        || !face.tangent.vy.is_finite()
        || !face.tangent_extent.is_finite()
        || face.tangent_extent <= RAY_EPSILON
    {
        return None;
    }

    let start_t = point_tangent_projection(start, face);
    let start_n = point_normal_projection(start, face);
    let end_t = point_tangent_projection(end, face);
    let end_n = point_normal_projection(end, face);
    let mut interval = None;
    append_capsule_endpoint_face_tangent_interval(&mut interval, start_t, start_n, radius);
    append_capsule_endpoint_face_tangent_interval(&mut interval, end_t, end_n, radius);
    append_capsule_side_face_tangent_interval(
        &mut interval,
        start_t,
        start_n,
        end_t,
        end_n,
        radius,
    );
    interval
}

fn point_normal_projection(point: Transform2D, face: ContactFace) -> f32 {
    (point.x - face.center.x) * face.normal.vx + (point.y - face.center.y) * face.normal.vy
}

fn append_capsule_endpoint_face_tangent_interval(
    interval: &mut Option<TangentInterval>,
    tangent: f32,
    normal: f32,
    radius: f32,
) {
    let normal_distance = normal.abs();
    if normal_distance > radius + RAY_EPSILON {
        return;
    }

    let tangent_radius = (radius * radius - normal_distance * normal_distance)
        .max(0.0)
        .sqrt();
    append_tangent_interval(interval, tangent - tangent_radius, tangent + tangent_radius);
}

fn append_capsule_side_face_tangent_interval(
    interval: &mut Option<TangentInterval>,
    start_t: f32,
    start_n: f32,
    end_t: f32,
    end_n: f32,
    radius: f32,
) {
    let delta_t = end_t - start_t;
    let delta_n = end_n - start_n;
    let length_squared = delta_t * delta_t + delta_n * delta_n;
    if length_squared <= RAY_EPSILON * RAY_EPSILON || !length_squared.is_finite() {
        return;
    }

    let mut min = f32::NEG_INFINITY;
    let mut max = f32::INFINITY;
    if delta_t.abs() > RAY_EPSILON {
        let projection_start = start_t + start_n * delta_n / delta_t;
        let projection_end = start_t + (length_squared + start_n * delta_n) / delta_t;
        min = min.max(projection_start.min(projection_end));
        max = max.min(projection_start.max(projection_end));
    } else {
        let projection = -start_n * delta_n / length_squared;
        if !projection.is_finite() || !(0.0..=1.0).contains(&projection) {
            return;
        }
    }

    let length = length_squared.sqrt();
    if delta_n.abs() > RAY_EPSILON {
        let center = start_t - start_n * delta_t / delta_n;
        let span = radius * length / delta_n.abs();
        min = min.max(center - span);
        max = max.min(center + span);
    } else if start_n.abs() > radius + RAY_EPSILON {
        return;
    }

    append_tangent_interval(interval, min, max);
}

fn append_tangent_interval(interval: &mut Option<TangentInterval>, min: f32, max: f32) {
    if !min.is_finite() || !max.is_finite() {
        return;
    }
    let (min, max) = if min <= max { (min, max) } else { (max, min) };
    if max - min <= RAY_EPSILON {
        return;
    }

    if let Some(existing) = interval {
        existing.min = existing.min.min(min);
        existing.max = existing.max.max(max);
    } else {
        *interval = Some(TangentInterval { min, max });
    }
}

fn append_capsule_face_arc_clipped_contact_point(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    face: ContactFace,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    tangent_projection: f32,
) {
    let point = contact_face_point(face, tangent_projection);
    let distance_squared = point_segment_distance_squared(point, start, end);
    if distance_squared > radius * radius + RAY_EPSILON {
        return;
    }

    let penetration = (radius - distance_squared.sqrt()).max(0.0);
    if penetration <= RAY_EPSILON {
        return;
    }

    append_contact_manifold_point_by_depth(
        points,
        point_count,
        CollisionContactPoint {
            point_x: point.x,
            point_y: point.y,
            penetration,
        },
    );
}

fn convex_polygon_reference_incident_faces(
    a_vertices: &[Transform2D],
    b_vertices: &[Transform2D],
    normal: Velocity,
) -> Option<(ContactFace, (Transform2D, Transform2D))> {
    if !normal.vx.is_finite() || !normal.vy.is_finite() {
        return None;
    }

    let a_alignment = convex_polygon_face_alignment(a_vertices, normal)?;
    let reference_normal = Velocity {
        vx: -normal.vx,
        vy: -normal.vy,
    };
    let b_alignment = convex_polygon_face_alignment(b_vertices, reference_normal)?;
    if a_alignment + RAY_EPSILON >= b_alignment {
        let reference = convex_polygon_reference_face(a_vertices, normal)?;
        let incident = convex_polygon_incident_face_segment(b_vertices, reference.normal)?;
        Some((reference, incident))
    } else {
        let reference = convex_polygon_reference_face(b_vertices, reference_normal)?;
        let incident = convex_polygon_incident_face_segment(a_vertices, reference.normal)?;
        Some((reference, incident))
    }
}

fn convex_polygon_face_alignment(vertices: &[Transform2D], normal: Velocity) -> Option<f32> {
    let mut best = f32::NEG_INFINITY;
    for index in 0..vertices.len() {
        let face = convex_polygon_contact_face(vertices, index)?;
        best = best.max(dot_velocity(face.normal, normal));
    }
    best.is_finite().then_some(best)
}

fn convex_polygon_reference_face(
    vertices: &[Transform2D],
    outward_normal: Velocity,
) -> Option<ContactFace> {
    let mut best_face = None;
    let mut best_alignment = f32::NEG_INFINITY;
    for index in 0..vertices.len() {
        let face = convex_polygon_contact_face(vertices, index)?;
        let alignment = dot_velocity(face.normal, outward_normal);
        if alignment > best_alignment {
            best_alignment = alignment;
            best_face = Some(face);
        }
    }
    best_face
}

fn convex_polygon_incident_face_segment(
    vertices: &[Transform2D],
    reference_normal: Velocity,
) -> Option<(Transform2D, Transform2D)> {
    let mut best_index = None;
    let mut best_alignment = f32::INFINITY;
    for index in 0..vertices.len() {
        let face = convex_polygon_contact_face(vertices, index)?;
        let alignment = dot_velocity(face.normal, reference_normal);
        if alignment < best_alignment {
            best_alignment = alignment;
            best_index = Some(index);
        }
    }
    let index = best_index?;
    Some((vertices[index], vertices[(index + 1) % vertices.len()]))
}

fn convex_polygon_contact_face(vertices: &[Transform2D], index: usize) -> Option<ContactFace> {
    if !convex_polygon_is_valid(vertices) || index >= vertices.len() {
        return None;
    }

    let start = vertices[index];
    let end = vertices[(index + 1) % vertices.len()];
    let edge_x = end.x - start.x;
    let edge_y = end.y - start.y;
    let edge_length = (edge_x * edge_x + edge_y * edge_y).sqrt();
    if edge_length <= RAY_EPSILON || !edge_length.is_finite() {
        return None;
    }

    let tangent = Velocity {
        vx: edge_x / edge_length,
        vy: edge_y / edge_length,
    };
    let is_counter_clockwise = convex_polygon_signed_area(vertices) > 0.0;
    let normal = if is_counter_clockwise {
        Velocity {
            vx: tangent.vy,
            vy: -tangent.vx,
        }
    } else {
        Velocity {
            vx: -tangent.vy,
            vy: tangent.vx,
        }
    };

    Some(ContactFace {
        center: Transform2D {
            x: (start.x + end.x) * 0.5,
            y: (start.y + end.y) * 0.5,
        },
        normal,
        tangent,
        tangent_extent: edge_length * 0.5,
    })
}

fn dot_velocity(a: Velocity, b: Velocity) -> f32 {
    a.vx * b.vx + a.vy * b.vy
}

fn oriented_box_reference_incident_faces(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
    normal: Velocity,
) -> Option<(ContactFace, (Transform2D, Transform2D))> {
    if !normal.vx.is_finite() || !normal.vy.is_finite() {
        return None;
    }

    let a_alignment = oriented_box_axis_alignment(a, normal);
    let b_alignment = oriented_box_axis_alignment(b, normal);
    if a_alignment + RAY_EPSILON >= b_alignment {
        let reference = oriented_box_reference_face(a, normal)?;
        let incident = oriented_box_incident_face_segment(b, reference.normal)?;
        Some((reference, incident))
    } else {
        let reference_normal = Velocity {
            vx: -normal.vx,
            vy: -normal.vy,
        };
        let reference = oriented_box_reference_face(b, reference_normal)?;
        let incident = oriented_box_incident_face_segment(a, reference.normal)?;
        Some((reference, incident))
    }
}

fn oriented_box_axis_alignment(oriented_box: OrientedBoxGeometry, normal: Velocity) -> f32 {
    let x = normal.vx * oriented_box.axis_x_x + normal.vy * oriented_box.axis_x_y;
    let y = normal.vx * oriented_box.axis_y_x + normal.vy * oriented_box.axis_y_y;
    x.abs().max(y.abs())
}

fn oriented_box_reference_face(
    oriented_box: OrientedBoxGeometry,
    outward_normal: Velocity,
) -> Option<ContactFace> {
    let local_x =
        outward_normal.vx * oriented_box.axis_x_x + outward_normal.vy * oriented_box.axis_x_y;
    let local_y =
        outward_normal.vx * oriented_box.axis_y_x + outward_normal.vy * oriented_box.axis_y_y;
    if !local_x.is_finite() || !local_y.is_finite() {
        return None;
    }

    if local_x.abs() >= local_y.abs() {
        let sign = if local_x >= 0.0 { 1.0 } else { -1.0 };
        let normal = Velocity {
            vx: oriented_box.axis_x_x * sign,
            vy: oriented_box.axis_x_y * sign,
        };
        Some(ContactFace {
            center: oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: oriented_box.half_width * sign,
                    y: 0.0,
                },
            ),
            normal,
            tangent: Velocity {
                vx: oriented_box.axis_y_x,
                vy: oriented_box.axis_y_y,
            },
            tangent_extent: oriented_box.half_height,
        })
    } else {
        let sign = if local_y >= 0.0 { 1.0 } else { -1.0 };
        let normal = Velocity {
            vx: oriented_box.axis_y_x * sign,
            vy: oriented_box.axis_y_y * sign,
        };
        Some(ContactFace {
            center: oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: 0.0,
                    y: oriented_box.half_height * sign,
                },
            ),
            normal,
            tangent: Velocity {
                vx: oriented_box.axis_x_x,
                vy: oriented_box.axis_x_y,
            },
            tangent_extent: oriented_box.half_width,
        })
    }
}

fn oriented_box_incident_face_segment(
    oriented_box: OrientedBoxGeometry,
    reference_normal: Velocity,
) -> Option<(Transform2D, Transform2D)> {
    let local_x =
        reference_normal.vx * oriented_box.axis_x_x + reference_normal.vy * oriented_box.axis_x_y;
    let local_y =
        reference_normal.vx * oriented_box.axis_y_x + reference_normal.vy * oriented_box.axis_y_y;
    if !local_x.is_finite() || !local_y.is_finite() {
        return None;
    }

    if local_x.abs() >= local_y.abs() {
        let sign = if local_x >= 0.0 { -1.0 } else { 1.0 };
        Some((
            oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: oriented_box.half_width * sign,
                    y: -oriented_box.half_height,
                },
            ),
            oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: oriented_box.half_width * sign,
                    y: oriented_box.half_height,
                },
            ),
        ))
    } else {
        let sign = if local_y >= 0.0 { -1.0 } else { 1.0 };
        Some((
            oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: -oriented_box.half_width,
                    y: oriented_box.half_height * sign,
                },
            ),
            oriented_box_world_point(
                oriented_box,
                Transform2D {
                    x: oriented_box.half_width,
                    y: oriented_box.half_height * sign,
                },
            ),
        ))
    }
}

fn clip_segment_to_face_tangent_interval(
    first: Transform2D,
    second: Transform2D,
    face_center: Transform2D,
    tangent: Velocity,
    tangent_extent: f32,
) -> Option<(Transform2D, Transform2D)> {
    if !tangent_extent.is_finite() || tangent_extent < 0.0 {
        return None;
    }

    let first_projection =
        (first.x - face_center.x) * tangent.vx + (first.y - face_center.y) * tangent.vy;
    let second_projection =
        (second.x - face_center.x) * tangent.vx + (second.y - face_center.y) * tangent.vy;
    let delta = second_projection - first_projection;
    let min = -tangent_extent;
    let max = tangent_extent;

    if delta.abs() <= RAY_EPSILON {
        return (first_projection >= min - RAY_EPSILON && first_projection <= max + RAY_EPSILON)
            .then_some((first, second));
    }

    let mut entry: f32 = 0.0;
    let mut exit: f32 = 1.0;
    if delta > 0.0 {
        entry = entry.max((min - first_projection) / delta);
        exit = exit.min((max - first_projection) / delta);
    } else {
        entry = entry.max((max - first_projection) / delta);
        exit = exit.min((min - first_projection) / delta);
    }
    if entry > exit || exit < 0.0 || entry > 1.0 {
        return None;
    }

    Some((
        lerp_transform(first, second, entry.clamp(0.0, 1.0)),
        lerp_transform(first, second, exit.clamp(0.0, 1.0)),
    ))
}

fn lerp_transform(first: Transform2D, second: Transform2D, t: f32) -> Transform2D {
    Transform2D {
        x: first.x + (second.x - first.x) * t,
        y: first.y + (second.y - first.y) * t,
    }
}

fn append_face_clipped_contact_point(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    reference: ContactFace,
    point: Transform2D,
) {
    let separation = (point.x - reference.center.x) * reference.normal.vx
        + (point.y - reference.center.y) * reference.normal.vy;
    if !separation.is_finite() || separation > RAY_EPSILON {
        return;
    }

    let projected = Transform2D {
        x: point.x - reference.normal.vx * separation,
        y: point.y - reference.normal.vy * separation,
    };
    append_contact_manifold_point_by_depth(
        points,
        point_count,
        CollisionContactPoint {
            point_x: projected.x,
            point_y: projected.y,
            penetration: (-separation).max(0.0),
        },
    );
}

fn oriented_box_capsule_contact_manifold_points(
    oriented_box: OrientedBoxGeometry,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    let Some(local_bounds) = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    ) else {
        let point = oriented_box_capsule_contact_point(oriented_box, start, end, radius, contact);
        return single_contact_manifold_point(point.x, point.y, contact.penetration);
    };

    let local_start = oriented_box_local_point(oriented_box, start);
    let local_end = oriented_box_local_point(oriented_box, end);
    let (local_normal_x, local_normal_y) =
        oriented_box_local_vector(oriented_box, contact.normal_x, contact.normal_y);
    let local_contact = AabbContact {
        normal_x: local_normal_x,
        normal_y: local_normal_y,
        penetration: contact.penetration,
    };

    if let Some((x0, y0, x1, y1)) =
        aabb_capsule_side_contact_segment(local_bounds, local_start, local_end, local_contact)
    {
        let first = oriented_box_world_point(oriented_box, Transform2D { x: x0, y: y0 });
        let second = oriented_box_world_point(oriented_box, Transform2D { x: x1, y: y1 });
        return two_or_one_contact_manifold_points(
            first.x,
            first.y,
            second.x,
            second.y,
            contact.penetration,
        );
    }

    if let Some((points, point_count)) = aabb_capsule_arc_clipped_contact_manifold_points(
        local_bounds,
        local_start,
        local_end,
        radius,
        local_contact,
    ) {
        return oriented_box_world_contact_manifold_points(oriented_box, points, point_count);
    }

    if let Some((points, point_count)) = aabb_capsule_endpoint_contact_manifold_points(
        local_bounds,
        local_start,
        local_end,
        radius,
        local_contact,
    ) {
        return oriented_box_world_contact_manifold_points(oriented_box, points, point_count);
    }

    let point = oriented_box_capsule_contact_point(oriented_box, start, end, radius, contact);
    single_contact_manifold_point(point.x, point.y, contact.penetration)
}

fn oriented_box_world_contact_manifold_points(
    oriented_box: OrientedBoxGeometry,
    points: [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: u32,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    let mut world_points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let count = (point_count as usize).min(MAX_COLLISION_MANIFOLD_POINTS);
    for index in 0..count {
        let point = oriented_box_world_point(
            oriented_box,
            Transform2D {
                x: points[index].point_x,
                y: points[index].point_y,
            },
        );
        world_points[index] = CollisionContactPoint {
            point_x: point.x,
            point_y: point.y,
            penetration: points[index].penetration,
        };
    }
    (world_points, count as u32)
}

fn aabb_capsule_contact_manifold_points(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    let bounds = AabbBounds::from_transform(at, ac);
    if let Some((x0, y0, x1, y1)) =
        aabb_capsule_side_contact_segment(bounds, bc.start(bt), bc.end(bt), contact)
    {
        return two_or_one_contact_manifold_points(x0, y0, x1, y1, contact.penetration);
    }
    if let Some(points) = aabb_capsule_arc_clipped_contact_manifold_points(
        bounds,
        bc.start(bt),
        bc.end(bt),
        bc.radius,
        contact,
    ) {
        return points;
    }
    if let Some(points) = aabb_capsule_endpoint_contact_manifold_points(
        bounds,
        bc.start(bt),
        bc.end(bt),
        bc.radius,
        contact,
    ) {
        return points;
    }

    let (point_x, point_y) = aabb_capsule_contact_point(at, ac, bt, bc, contact);
    single_contact_manifold_point(point_x, point_y, contact.penetration)
}

fn aabb_capsule_side_contact_segment(
    bounds: AabbBounds,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    contact: AabbContact,
) -> Option<(f32, f32, f32, f32)> {
    if contact.normal_x.abs() >= 1.0 - RAY_EPSILON
        && (capsule_start.x - capsule_end.x).abs() <= RAY_EPSILON
    {
        let min_y = capsule_start.y.min(capsule_end.y).max(bounds.min_y);
        let max_y = capsule_start.y.max(capsule_end.y).min(bounds.max_y);
        if max_y - min_y <= RAY_EPSILON {
            return None;
        }
        let face_x = if contact.normal_x > 0.0 {
            bounds.max_x
        } else {
            bounds.min_x
        };
        return Some((face_x, min_y, face_x, max_y));
    }

    if contact.normal_y.abs() >= 1.0 - RAY_EPSILON
        && (capsule_start.y - capsule_end.y).abs() <= RAY_EPSILON
    {
        let min_x = capsule_start.x.min(capsule_end.x).max(bounds.min_x);
        let max_x = capsule_start.x.max(capsule_end.x).min(bounds.max_x);
        if max_x - min_x <= RAY_EPSILON {
            return None;
        }
        let face_y = if contact.normal_y > 0.0 {
            bounds.max_y
        } else {
            bounds.min_y
        };
        return Some((min_x, face_y, max_x, face_y));
    }

    None
}

fn aabb_capsule_arc_clipped_contact_manifold_points(
    bounds: AabbBounds,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let face = aabb_reference_face(bounds, contact)?;
    capsule_face_arc_clipped_contact_manifold_points(
        face,
        capsule_start,
        capsule_end,
        capsule_radius,
    )
}

fn aabb_reference_face(bounds: AabbBounds, contact: AabbContact) -> Option<ContactFace> {
    if !bounds.min_x.is_finite()
        || !bounds.min_y.is_finite()
        || !bounds.max_x.is_finite()
        || !bounds.max_y.is_finite()
        || bounds.max_x < bounds.min_x
        || bounds.max_y < bounds.min_y
        || !contact.normal_x.is_finite()
        || !contact.normal_y.is_finite()
        || contact.normal_x * contact.normal_x + contact.normal_y * contact.normal_y
            <= RAY_EPSILON * RAY_EPSILON
    {
        return None;
    }

    let center = aabb_center(bounds);
    if contact.normal_x.abs() >= contact.normal_y.abs() {
        let sign = if contact.normal_x >= 0.0 { 1.0 } else { -1.0 };
        let x = if sign > 0.0 {
            bounds.max_x
        } else {
            bounds.min_x
        };
        Some(ContactFace {
            center: Transform2D { x, y: center.y },
            normal: Velocity { vx: sign, vy: 0.0 },
            tangent: Velocity { vx: 0.0, vy: 1.0 },
            tangent_extent: (bounds.max_y - bounds.min_y) * 0.5,
        })
    } else {
        let sign = if contact.normal_y >= 0.0 { 1.0 } else { -1.0 };
        let y = if sign > 0.0 {
            bounds.max_y
        } else {
            bounds.min_y
        };
        Some(ContactFace {
            center: Transform2D { x: center.x, y },
            normal: Velocity { vx: 0.0, vy: sign },
            tangent: Velocity { vx: 1.0, vy: 0.0 },
            tangent_extent: (bounds.max_x - bounds.min_x) * 0.5,
        })
    }
}

fn aabb_capsule_endpoint_contact_manifold_points(
    bounds: AabbBounds,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_aabb_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        bounds,
        capsule_start,
        capsule_radius,
        contact,
    );
    append_aabb_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        bounds,
        capsule_end,
        capsule_radius,
        contact,
    );
    (point_count > 0).then_some((points, point_count))
}

fn capsule_circle_contact_manifold_points(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CircleCollider,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    let face = capsule_circle_side_contact_face(ac.start(at), ac.end(at), ac.radius, contact)?;
    circle_face_contact_manifold_points(face, bc.center(bt), bc.radius, contact)
}

fn capsule_circle_side_contact_face(
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
    contact: AabbContact,
) -> Option<ContactFace> {
    if !is_valid_radius(capsule_radius)
        || !contact.normal_x.is_finite()
        || !contact.normal_y.is_finite()
    {
        return None;
    }

    let frame = segment_frame(capsule_start, capsule_end)?;
    let normal_length =
        (contact.normal_x * contact.normal_x + contact.normal_y * contact.normal_y).sqrt();
    if !normal_length.is_finite() || normal_length <= RAY_EPSILON {
        return None;
    }

    let contact_normal = Velocity {
        vx: contact.normal_x / normal_length,
        vy: contact.normal_y / normal_length,
    };
    let axis = Velocity {
        vx: frame.axis_x,
        vy: frame.axis_y,
    };
    if dot_velocity(axis, contact_normal).abs() > RAY_EPSILON {
        return None;
    }

    let frame_normal = Velocity {
        vx: frame.normal_x,
        vy: frame.normal_y,
    };
    let side_alignment = dot_velocity(frame_normal, contact_normal);
    if side_alignment.abs() < 1.0 - RAY_EPSILON {
        return None;
    }

    let normal = if side_alignment >= 0.0 {
        frame_normal
    } else {
        Velocity {
            vx: -frame_normal.vx,
            vy: -frame_normal.vy,
        }
    };
    let side_center = segment_frame_world_point(frame, frame.length * 0.5, 0.0);
    Some(ContactFace {
        center: Transform2D {
            x: side_center.x + normal.vx * capsule_radius,
            y: side_center.y + normal.vy * capsule_radius,
        },
        normal,
        tangent: axis,
        tangent_extent: frame.length * 0.5,
    })
}

fn append_aabb_capsule_endpoint_contact_point(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    bounds: AabbBounds,
    capsule_center: Transform2D,
    capsule_radius: f32,
    contact: AabbContact,
) {
    if !is_valid_radius(capsule_radius) {
        return;
    }
    let closest = closest_point_on_aabb(capsule_center, bounds);
    let distance_squared = point_distance_squared(capsule_center, closest);
    if distance_squared > capsule_radius * capsule_radius + RAY_EPSILON {
        return;
    }

    let inside = bounds.contains_point(capsule_center);
    let point = if inside {
        Transform2D {
            x: capsule_center.x - contact.normal_x * capsule_radius,
            y: capsule_center.y - contact.normal_y * capsule_radius,
        }
    } else {
        closest
    };
    append_contact_manifold_point_by_depth(
        points,
        point_count,
        CollisionContactPoint {
            point_x: point.x,
            point_y: point.y,
            penetration: contact.penetration,
        },
    );
}

fn capsule_capsule_contact_manifold_points(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    if let Some((first, second)) = capsule_capsule_side_contact_segment(
        ac.start(at),
        ac.end(at),
        ac.radius,
        bc.start(bt),
        bc.end(bt),
        bc.radius,
        contact,
    ) {
        return two_or_one_contact_manifold_points(
            first.x,
            first.y,
            second.x,
            second.y,
            contact.penetration,
        );
    }
    if let Some(points) = capsule_capsule_curve_contact_manifold_points(
        ac.start(at),
        ac.end(at),
        ac.radius,
        bc.start(bt),
        bc.end(bt),
        bc.radius,
        contact,
    ) {
        return points;
    }
    if let Some(points) = capsule_capsule_endpoint_contact_manifold_points(
        ac.start(at),
        ac.end(at),
        ac.radius,
        bc.start(bt),
        bc.end(bt),
        bc.radius,
        contact,
    ) {
        return points;
    }

    let (point_x, point_y) = capsule_capsule_contact_point(at, ac, bt, bc, contact);
    single_contact_manifold_point(point_x, point_y, contact.penetration)
}

fn capsule_capsule_side_contact_segment(
    a_start: Transform2D,
    a_end: Transform2D,
    a_radius: f32,
    b_start: Transform2D,
    b_end: Transform2D,
    b_radius: f32,
    contact: AabbContact,
) -> Option<(Transform2D, Transform2D)> {
    let frame = segment_frame(a_start, a_end)?;
    let b_start_local = segment_frame_local_point(frame, b_start);
    let b_end_local = segment_frame_local_point(frame, b_end);
    if (b_start_local.y - b_end_local.y).abs() > RAY_EPSILON {
        return None;
    }

    let normal_axis_dot = contact.normal_x * frame.axis_x + contact.normal_y * frame.axis_y;
    let normal_side_dot = contact.normal_x * frame.normal_x + contact.normal_y * frame.normal_y;
    if normal_axis_dot.abs() > RAY_EPSILON || normal_side_dot.abs() < 1.0 - RAY_EPSILON {
        return None;
    }

    let b_min_x = b_start_local.x.min(b_end_local.x);
    let b_max_x = b_start_local.x.max(b_end_local.x);
    let min_x = 0.0_f32.max(b_min_x);
    let max_x = frame.length.min(b_max_x);
    if max_x - min_x <= RAY_EPSILON {
        return None;
    }

    let first = capsule_capsule_side_contact_point_at(
        frame,
        b_start_local.y,
        min_x,
        a_radius,
        b_radius,
        contact,
    );
    let second = capsule_capsule_side_contact_point_at(
        frame,
        b_start_local.y,
        max_x,
        a_radius,
        b_radius,
        contact,
    );
    Some((first, second))
}

fn capsule_capsule_curve_contact_manifold_points(
    a_start: Transform2D,
    a_end: Transform2D,
    a_radius: f32,
    b_start: Transform2D,
    b_end: Transform2D,
    b_radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if !is_valid_radius(a_radius) || !is_valid_radius(b_radius) {
        return None;
    }
    if !segments_intersect(a_start, a_end, b_start, b_end) {
        return None;
    }

    let intersection = segment_intersection_point(a_start, a_end, b_start, b_end)?;
    let normal_length =
        (contact.normal_x * contact.normal_x + contact.normal_y * contact.normal_y).sqrt();
    if !normal_length.is_finite() || normal_length <= RAY_EPSILON {
        return None;
    }

    let normal = Velocity {
        vx: contact.normal_x / normal_length,
        vy: contact.normal_y / normal_length,
    };
    let tangent = Velocity {
        vx: -normal.vy,
        vy: normal.vx,
    };
    let contact_line = ContactFace {
        center: intersection,
        normal,
        tangent,
        tangent_extent: 1.0,
    };
    let a_interval = capsule_face_tangent_interval(contact_line, a_start, a_end, a_radius)?;
    let b_interval = capsule_face_tangent_interval(contact_line, b_start, b_end, b_radius)?;
    let min = a_interval.min.max(b_interval.min);
    let max = a_interval.max.min(b_interval.max);
    if max - min <= RAY_EPSILON {
        return None;
    }

    let first = contact_face_point(contact_line, min);
    let second = contact_face_point(contact_line, max);
    Some(two_or_one_contact_manifold_points(
        first.x,
        first.y,
        second.x,
        second.y,
        contact.penetration,
    ))
}

fn capsule_capsule_endpoint_contact_manifold_points(
    a_start: Transform2D,
    a_end: Transform2D,
    a_radius: f32,
    b_start: Transform2D,
    b_end: Transform2D,
    b_radius: f32,
    contact: AabbContact,
) -> Option<([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)> {
    if !is_valid_radius(a_radius) || !is_valid_radius(b_radius) {
        return None;
    }

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    let mut point_count = 0;
    append_capsule_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        closest_point_on_segment(b_start, a_start, a_end),
        a_radius,
        b_start,
        b_radius,
        contact,
    );
    append_capsule_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        closest_point_on_segment(b_end, a_start, a_end),
        a_radius,
        b_end,
        b_radius,
        contact,
    );
    append_capsule_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        a_start,
        a_radius,
        closest_point_on_segment(a_start, b_start, b_end),
        b_radius,
        contact,
    );
    append_capsule_capsule_endpoint_contact_point(
        &mut points,
        &mut point_count,
        a_end,
        a_radius,
        closest_point_on_segment(a_end, b_start, b_end),
        b_radius,
        contact,
    );
    (point_count > 0).then_some((points, point_count))
}

fn append_capsule_capsule_endpoint_contact_point(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    a_center: Transform2D,
    a_radius: f32,
    b_center: Transform2D,
    b_radius: f32,
    contact: AabbContact,
) {
    let distance_squared = point_distance_squared(a_center, b_center);
    let radius_sum = a_radius + b_radius;
    if distance_squared > radius_sum * radius_sum + RAY_EPSILON {
        return;
    }

    let a_surface = Transform2D {
        x: a_center.x + contact.normal_x * a_radius,
        y: a_center.y + contact.normal_y * a_radius,
    };
    let b_surface = Transform2D {
        x: b_center.x - contact.normal_x * b_radius,
        y: b_center.y - contact.normal_y * b_radius,
    };
    let distance = distance_squared.sqrt();
    append_contact_manifold_point_by_depth(
        points,
        point_count,
        CollisionContactPoint {
            point_x: (a_surface.x + b_surface.x) * 0.5,
            point_y: (a_surface.y + b_surface.y) * 0.5,
            penetration: (radius_sum - distance).max(0.0),
        },
    );
}

fn capsule_capsule_side_contact_point_at(
    frame: SegmentFrame,
    b_local_y: f32,
    x: f32,
    a_radius: f32,
    b_radius: f32,
    contact: AabbContact,
) -> Transform2D {
    let a_center = segment_frame_world_point(frame, x, 0.0);
    let b_center = segment_frame_world_point(frame, x, b_local_y);
    let a_surface = Transform2D {
        x: a_center.x + contact.normal_x * a_radius,
        y: a_center.y + contact.normal_y * a_radius,
    };
    let b_surface = Transform2D {
        x: b_center.x - contact.normal_x * b_radius,
        y: b_center.y - contact.normal_y * b_radius,
    };
    Transform2D {
        x: (a_surface.x + b_surface.x) * 0.5,
        y: (a_surface.y + b_surface.y) * 0.5,
    }
}

fn segment_frame_world_point(frame: SegmentFrame, x: f32, y: f32) -> Transform2D {
    Transform2D {
        x: frame.origin.x + frame.axis_x * x + frame.normal_x * y,
        y: frame.origin.y + frame.axis_y * x + frame.normal_y * y,
    }
}

fn two_or_one_contact_manifold_points(
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    penetration: f32,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    if !x0.is_finite()
        || !y0.is_finite()
        || !x1.is_finite()
        || !y1.is_finite()
        || !penetration.is_finite()
    {
        return empty_contact_manifold_points();
    }

    let dx = x1 - x0;
    let dy = y1 - y0;
    if dx * dx + dy * dy <= RAY_EPSILON * RAY_EPSILON {
        return single_contact_manifold_point((x0 + x1) * 0.5, (y0 + y1) * 0.5, penetration);
    }

    (
        [
            CollisionContactPoint {
                point_x: x0,
                point_y: y0,
                penetration,
            },
            CollisionContactPoint {
                point_x: x1,
                point_y: y1,
                penetration,
            },
        ],
        2,
    )
}

fn single_contact_manifold_point(
    point_x: f32,
    point_y: f32,
    penetration: f32,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    if !point_x.is_finite() || !point_y.is_finite() || !penetration.is_finite() {
        return empty_contact_manifold_points();
    }

    let mut points = [empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS];
    points[0] = CollisionContactPoint {
        point_x,
        point_y,
        penetration,
    };
    (points, 1)
}

fn append_contact_manifold_point_by_depth(
    points: &mut [CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS],
    point_count: &mut u32,
    point: CollisionContactPoint,
) {
    if !point.point_x.is_finite() || !point.point_y.is_finite() || !point.penetration.is_finite() {
        return;
    }
    let duplicate = points[..(*point_count as usize).min(MAX_COLLISION_MANIFOLD_POINTS)]
        .iter()
        .any(|existing| {
            let dx = existing.point_x - point.point_x;
            let dy = existing.point_y - point.point_y;
            dx * dx + dy * dy <= RAY_EPSILON * RAY_EPSILON
        });
    if duplicate {
        return;
    }

    let count = (*point_count as usize).min(MAX_COLLISION_MANIFOLD_POINTS);
    if count < MAX_COLLISION_MANIFOLD_POINTS {
        points[count] = point;
        *point_count = (count + 1) as u32;
    } else if point.penetration > points[MAX_COLLISION_MANIFOLD_POINTS - 1].penetration {
        points[MAX_COLLISION_MANIFOLD_POINTS - 1] = point;
    } else {
        return;
    }

    let count = (*point_count as usize).min(MAX_COLLISION_MANIFOLD_POINTS);
    points[..count].sort_by(|a, b| b.penetration.total_cmp(&a.penetration));
}

fn empty_contact_manifold_points() -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32)
{
    ([empty_contact_point(); MAX_COLLISION_MANIFOLD_POINTS], 0)
}

const fn empty_contact_point() -> CollisionContactPoint {
    CollisionContactPoint {
        point_x: 0.0,
        point_y: 0.0,
        penetration: 0.0,
    }
}

fn aabb_aabb_contact_point(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: AabbCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let a_bounds = AabbBounds::from_transform(at, ac);
    let b_bounds = AabbBounds::from_transform(bt, bc);
    let a_center = ac.center(at);
    if contact.normal_x != 0.0 {
        let min_y = a_bounds.min_y.max(b_bounds.min_y);
        let max_y = a_bounds.max_y.min(b_bounds.max_y);
        (
            a_center.x + contact.normal_x * ac.half_width,
            (min_y + max_y) * 0.5,
        )
    } else {
        let min_x = a_bounds.min_x.max(b_bounds.min_x);
        let max_x = a_bounds.max_x.min(b_bounds.max_x);
        (
            (min_x + max_x) * 0.5,
            a_center.y + contact.normal_y * ac.half_height,
        )
    }
}

fn aabb_circle_contact_point(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CircleCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let bounds = AabbBounds::from_transform(at, ac);
    let circle_center = bc.center(bt);
    let closest_x = circle_center.x.clamp(bounds.min_x, bounds.max_x);
    let closest_y = circle_center.y.clamp(bounds.min_y, bounds.max_y);
    let inside = (closest_x - circle_center.x).abs() <= RAY_EPSILON
        && (closest_y - circle_center.y).abs() <= RAY_EPSILON;
    if inside {
        (
            circle_center.x - contact.normal_x * bc.radius,
            circle_center.y - contact.normal_y * bc.radius,
        )
    } else {
        (closest_x, closest_y)
    }
}

fn circle_aabb_contact_point(
    at: Transform2D,
    ac: CircleCollider,
    bt: Transform2D,
    bc: AabbCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let circle_center = ac.center(at);
    let point_on_circle = (
        circle_center.x + contact.normal_x * ac.radius,
        circle_center.y + contact.normal_y * ac.radius,
    );
    let bounds = AabbBounds::from_transform(bt, bc);
    (
        point_on_circle.0.clamp(bounds.min_x, bounds.max_x),
        point_on_circle.1.clamp(bounds.min_y, bounds.max_y),
    )
}

fn circle_circle_contact_point(
    at: Transform2D,
    ac: CircleCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let center = ac.center(at);
    (
        center.x + contact.normal_x * ac.radius,
        center.y + contact.normal_y * ac.radius,
    )
}

fn aabb_capsule_contact_point(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let bounds = AabbBounds::from_transform(at, ac);
    let start = bc.start(bt);
    let end = bc.end(bt);
    let closest = closest_segment_aabb_pair(start, end, bounds);
    if closest.distance_squared > RAY_EPSILON * RAY_EPSILON {
        return (closest.b.x, closest.b.y);
    }

    let reference = capsule_aabb_reference_point(start, end, bounds);
    (
        reference.x - contact.normal_x * bc.radius,
        reference.y - contact.normal_y * bc.radius,
    )
}

fn capsule_aabb_contact_point(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: AabbCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let bounds = AabbBounds::from_transform(bt, bc);
    let start = ac.start(at);
    let end = ac.end(at);
    let reference = closest_point_on_segment(aabb_center(bounds), start, end);
    let point_on_capsule = Transform2D {
        x: reference.x + contact.normal_x * ac.radius,
        y: reference.y + contact.normal_y * ac.radius,
    };
    (
        point_on_capsule.x.clamp(bounds.min_x, bounds.max_x),
        point_on_capsule.y.clamp(bounds.min_y, bounds.max_y),
    )
}

fn capsule_circle_contact_point(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CircleCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let circle_center = bc.center(bt);
    let closest = closest_point_on_segment(circle_center, ac.start(at), ac.end(at));
    (
        closest.x + contact.normal_x * ac.radius,
        closest.y + contact.normal_y * ac.radius,
    )
}

fn capsule_capsule_contact_point(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let closest = closest_points_on_segments(ac.start(at), ac.end(at), bc.start(bt), bc.end(bt));
    let a_surface = Transform2D {
        x: closest.a.x + contact.normal_x * ac.radius,
        y: closest.a.y + contact.normal_y * ac.radius,
    };
    let b_surface = Transform2D {
        x: closest.b.x - contact.normal_x * bc.radius,
        y: closest.b.y - contact.normal_y * bc.radius,
    };
    (
        (a_surface.x + b_surface.x) * 0.5,
        (a_surface.y + b_surface.y) * 0.5,
    )
}

fn oriented_box_oriented_box_contact_point(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
    contact: AabbContact,
) -> Transform2D {
    let a_point = oriented_box_contact_face_point(a, contact.normal_x, contact.normal_y);
    let b_point = oriented_box_contact_face_point(b, -contact.normal_x, -contact.normal_y);
    Transform2D {
        x: (a_point.x + b_point.x) * 0.5,
        y: (a_point.y + b_point.y) * 0.5,
    }
}

fn oriented_box_circle_contact_point(
    oriented_box: OrientedBoxGeometry,
    circle_center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Transform2D {
    let local_center = oriented_box_local_point(oriented_box, circle_center);
    let closest_local = Transform2D {
        x: local_center
            .x
            .clamp(-oriented_box.half_width, oriented_box.half_width),
        y: local_center
            .y
            .clamp(-oriented_box.half_height, oriented_box.half_height),
    };
    let separation_x = local_center.x - closest_local.x;
    let separation_y = local_center.y - closest_local.y;
    let distance_squared = separation_x * separation_x + separation_y * separation_y;
    if distance_squared > RAY_EPSILON * RAY_EPSILON {
        return oriented_box_world_point(oriented_box, closest_local);
    }

    Transform2D {
        x: circle_center.x - contact.normal_x * radius,
        y: circle_center.y - contact.normal_y * radius,
    }
}

fn oriented_box_capsule_contact_point(
    oriented_box: OrientedBoxGeometry,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Transform2D {
    let local_start = oriented_box_local_point(oriented_box, start);
    let local_end = oriented_box_local_point(oriented_box, end);
    let Some(local_bounds) = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    ) else {
        return oriented_box.center;
    };
    let closest = closest_segment_aabb_pair(local_start, local_end, local_bounds);
    if closest.distance_squared > RAY_EPSILON * RAY_EPSILON {
        return oriented_box_world_point(oriented_box, closest.b);
    }

    let reference = capsule_aabb_reference_point(local_start, local_end, local_bounds);
    let (local_normal_x, local_normal_y) =
        oriented_box_local_vector(oriented_box, contact.normal_x, contact.normal_y);
    oriented_box_world_point(
        oriented_box,
        Transform2D {
            x: reference.x - local_normal_x * radius,
            y: reference.y - local_normal_y * radius,
        },
    )
}

fn oriented_box_contact_face_point(
    oriented_box: OrientedBoxGeometry,
    normal_x: f32,
    normal_y: f32,
) -> Transform2D {
    let (local_normal_x, local_normal_y) =
        oriented_box_local_vector(oriented_box, normal_x, normal_y);
    let local_point = if local_normal_x.abs() >= local_normal_y.abs() {
        Transform2D {
            x: if local_normal_x >= 0.0 {
                oriented_box.half_width
            } else {
                -oriented_box.half_width
            },
            y: 0.0,
        }
    } else {
        Transform2D {
            x: 0.0,
            y: if local_normal_y >= 0.0 {
                oriented_box.half_height
            } else {
                -oriented_box.half_height
            },
        }
    };
    oriented_box_world_point(oriented_box, local_point)
}

fn aabb_contact(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: AabbCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    let a_center = ac.center(at);
    let b_center = bc.center(bt);
    let dx = b_center.x - a_center.x;
    let overlap_x = ac.half_width + bc.half_width - dx.abs();
    if overlap_x <= 0.0 {
        return None;
    }

    let dy = b_center.y - a_center.y;
    let overlap_y = ac.half_height + bc.half_height - dy.abs();
    if overlap_y <= 0.0 {
        return None;
    }

    if overlap_x < overlap_y {
        Some(AabbContact {
            normal_x: if dx >= 0.0 { 1.0 } else { -1.0 },
            normal_y: 0.0,
            penetration: overlap_x,
        })
    } else {
        Some(AabbContact {
            normal_x: 0.0,
            normal_y: if dy >= 0.0 { 1.0 } else { -1.0 },
            penetration: overlap_y,
        })
    }
}

fn circle_contact(
    at: Transform2D,
    ac: CircleCollider,
    bt: Transform2D,
    bc: CircleCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    if !is_valid_radius(ac.radius) || !is_valid_radius(bc.radius) {
        return None;
    }
    let a_center = ac.center(at);
    let b_center = bc.center(bt);
    let dx = b_center.x - a_center.x;
    let dy = b_center.y - a_center.y;
    let radius_sum = ac.radius + bc.radius;
    let distance_squared = dx * dx + dy * dy;
    if distance_squared >= radius_sum * radius_sum {
        return None;
    }
    if distance_squared <= RAY_EPSILON * RAY_EPSILON {
        return Some(AabbContact {
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: radius_sum,
        });
    }
    let distance = distance_squared.sqrt();
    Some(AabbContact {
        normal_x: dx / distance,
        normal_y: dy / distance,
        penetration: radius_sum - distance,
    })
}

fn aabb_circle_contact(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CircleCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    if !is_valid_radius(bc.radius) {
        return None;
    }
    let bounds = AabbBounds::from_transform(at, ac);
    let circle_center = bc.center(bt);
    let closest_x = circle_center.x.clamp(bounds.min_x, bounds.max_x);
    let closest_y = circle_center.y.clamp(bounds.min_y, bounds.max_y);
    let dx = circle_center.x - closest_x;
    let dy = circle_center.y - closest_y;
    let distance_squared = dx * dx + dy * dy;
    if distance_squared > bc.radius * bc.radius {
        return None;
    }
    if distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = distance_squared.sqrt();
        return Some(AabbContact {
            normal_x: dx / distance,
            normal_y: dy / distance,
            penetration: bc.radius - distance,
        });
    }

    let left = circle_center.x - bounds.min_x;
    let right = bounds.max_x - circle_center.x;
    let down = circle_center.y - bounds.min_y;
    let up = bounds.max_y - circle_center.y;
    let (normal_x, normal_y, distance_to_face) = if left <= right && left <= down && left <= up {
        (-1.0, 0.0, left)
    } else if right <= down && right <= up {
        (1.0, 0.0, right)
    } else if down <= up {
        (0.0, -1.0, down)
    } else {
        (0.0, 1.0, up)
    };

    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: bc.radius + distance_to_face,
    })
}

fn aabb_capsule_contact(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    if !is_valid_half_extent(ac.half_width)
        || !is_valid_half_extent(ac.half_height)
        || !capsule_collider_is_valid(bc)
    {
        return None;
    }

    let bounds = AabbBounds::from_transform(at, ac);
    let start = bc.start(bt);
    let end = bc.end(bt);
    let closest = closest_segment_aabb_pair(start, end, bounds);
    if closest.distance_squared > bc.radius * bc.radius {
        return None;
    }
    if closest.distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = closest.distance_squared.sqrt();
        return Some(AabbContact {
            normal_x: (closest.a.x - closest.b.x) / distance,
            normal_y: (closest.a.y - closest.b.y) / distance,
            penetration: bc.radius - distance,
        });
    }

    let reference = capsule_aabb_reference_point(start, end, bounds);
    let (normal_x, normal_y, distance_to_face) = nearest_aabb_face(reference, bounds);
    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: bc.radius + distance_to_face,
    })
}

fn capsule_circle_contact(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CircleCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    if !capsule_collider_is_valid(ac) || !is_valid_radius(bc.radius) {
        return None;
    }

    let start = ac.start(at);
    let end = ac.end(at);
    let circle_center = bc.center(bt);
    let closest = closest_point_on_segment(circle_center, start, end);
    let dx = circle_center.x - closest.x;
    let dy = circle_center.y - closest.y;
    let radius_sum = ac.radius + bc.radius;
    let distance_squared = dx * dx + dy * dy;
    if distance_squared > radius_sum * radius_sum {
        return None;
    }
    if distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = distance_squared.sqrt();
        return Some(AabbContact {
            normal_x: dx / distance,
            normal_y: dy / distance,
            penetration: radius_sum - distance,
        });
    }

    let (normal_x, normal_y) = fallback_contact_normal(ac.center(at), circle_center);
    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: radius_sum,
    })
}

fn capsule_capsule_contact(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    if !capsule_collider_is_valid(ac) || !capsule_collider_is_valid(bc) {
        return None;
    }

    let closest = closest_points_on_segments(ac.start(at), ac.end(at), bc.start(bt), bc.end(bt));
    let radius_sum = ac.radius + bc.radius;
    if closest.distance_squared > radius_sum * radius_sum {
        return None;
    }
    if closest.distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = closest.distance_squared.sqrt();
        return Some(AabbContact {
            normal_x: (closest.b.x - closest.a.x) / distance,
            normal_y: (closest.b.y - closest.a.y) / distance,
            penetration: radius_sum - distance,
        });
    }

    let (normal_x, normal_y) = fallback_contact_normal(ac.center(at), bc.center(bt));
    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: radius_sum,
    })
}

fn aabb_as_oriented_box(bounds: AabbBounds) -> Option<OrientedBoxGeometry> {
    oriented_box_geometry(
        aabb_center(bounds),
        (bounds.max_x - bounds.min_x) * 0.5,
        (bounds.max_y - bounds.min_y) * 0.5,
        0.0,
    )
}

fn convex_polygon_vertices(
    vertices: &[Transform2D; MAX_CONVEX_POLYGON_VERTICES],
    vertex_count: u32,
) -> Option<&[Transform2D]> {
    let vertex_count = vertex_count as usize;
    if !(3..=MAX_CONVEX_POLYGON_VERTICES).contains(&vertex_count) {
        return None;
    }
    Some(&vertices[..vertex_count])
}

fn convex_polygon_is_valid(vertices: &[Transform2D]) -> bool {
    if vertices.len() < 3 || vertices.len() > MAX_CONVEX_POLYGON_VERTICES {
        return false;
    }
    if !vertices
        .iter()
        .all(|vertex| vertex.x.is_finite() && vertex.y.is_finite())
    {
        return false;
    }

    let mut winding = 0.0;
    for index in 0..vertices.len() {
        let a = vertices[index];
        let b = vertices[(index + 1) % vertices.len()];
        let c = vertices[(index + 2) % vertices.len()];
        let cross = cross_points(a, b, c);
        if cross.abs() <= RAY_EPSILON {
            return false;
        }
        if winding == 0.0 {
            winding = cross.signum();
        } else if cross.signum() != winding {
            return false;
        }
    }

    true
}

fn convex_polygon_centroid(vertices: &[Transform2D]) -> Transform2D {
    let mut x = 0.0;
    let mut y = 0.0;
    for vertex in vertices {
        x += vertex.x;
        y += vertex.y;
    }
    let vertex_count = vertices.len() as f32;
    Transform2D {
        x: x / vertex_count,
        y: y / vertex_count,
    }
}

fn convex_polygon_bounds(vertices: &[Transform2D]) -> AabbBounds {
    let mut bounds = AabbBounds {
        min_x: vertices[0].x,
        min_y: vertices[0].y,
        max_x: vertices[0].x,
        max_y: vertices[0].y,
    };
    for vertex in &vertices[1..] {
        bounds.min_x = bounds.min_x.min(vertex.x);
        bounds.min_y = bounds.min_y.min(vertex.y);
        bounds.max_x = bounds.max_x.max(vertex.x);
        bounds.max_y = bounds.max_y.max(vertex.y);
    }
    bounds
}

fn convex_polygon_collider_vertices(
    transform: Transform2D,
    collider: ConvexPolygonCollider,
    rotation_radians: f32,
) -> Option<[Transform2D; MAX_CONVEX_POLYGON_VERTICES]> {
    let local_vertices = convex_polygon_vertices(&collider.vertices, collider.vertex_count)?;
    if !convex_polygon_is_valid(local_vertices)
        || !transform.x.is_finite()
        || !transform.y.is_finite()
        || !collider.offset_x.is_finite()
        || !collider.offset_y.is_finite()
        || !rotation_radians.is_finite()
    {
        return None;
    }

    let cos = rotation_radians.cos();
    let sin = rotation_radians.sin();
    let center = collider.center(transform);
    let mut world_vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
    for (index, vertex) in local_vertices.iter().copied().enumerate() {
        world_vertices[index] = Transform2D {
            x: center.x + vertex.x * cos - vertex.y * sin,
            y: center.y + vertex.x * sin + vertex.y * cos,
        };
    }

    Some(world_vertices)
}

fn convex_polygon_collider_vertices_slice(
    transform: Transform2D,
    collider: ConvexPolygonCollider,
    rotation_radians: f32,
) -> Option<([Transform2D; MAX_CONVEX_POLYGON_VERTICES], usize)> {
    let vertex_count = collider.vertex_count as usize;
    let vertices = convex_polygon_collider_vertices(transform, collider, rotation_radians)?;
    Some((vertices, vertex_count))
}

fn convex_polygon_collider_centroid(
    transform: Transform2D,
    collider: ConvexPolygonCollider,
    rotation_radians: f32,
) -> Option<Transform2D> {
    let (vertices, vertex_count) =
        convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)?;
    Some(convex_polygon_centroid(&vertices[..vertex_count]))
}

fn convex_polygon_overlaps_aabb(vertices: &[Transform2D], bounds: AabbBounds) -> bool {
    if !bounds.min_x.is_finite()
        || !bounds.min_y.is_finite()
        || !bounds.max_x.is_finite()
        || !bounds.max_y.is_finite()
        || bounds.min_x > bounds.max_x
        || bounds.min_y > bounds.max_y
    {
        return false;
    }
    let aabb_vertices = aabb_bounds_vertices(bounds);
    convex_polygons_overlap(vertices, &aabb_vertices)
}

fn convex_polygon_overlaps_circle(
    vertices: &[Transform2D],
    center: Transform2D,
    radius: f32,
) -> bool {
    if !center.x.is_finite() || !center.y.is_finite() || !is_valid_radius(radius) {
        return false;
    }
    if convex_polygon_contains_point(vertices, center) {
        return true;
    }

    let radius_squared = radius * radius;
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        if point_segment_distance_squared(center, start, end) <= radius_squared {
            return true;
        }
    }
    false
}

fn convex_polygon_overlaps_oriented_box(
    vertices: &[Transform2D],
    oriented_box: OrientedBoxGeometry,
) -> bool {
    let box_vertices = oriented_box_vertices(oriented_box);
    convex_polygons_overlap(vertices, &box_vertices)
}

fn convex_polygon_overlaps_capsule(
    vertices: &[Transform2D],
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> bool {
    if !start.x.is_finite()
        || !start.y.is_finite()
        || !end.x.is_finite()
        || !end.y.is_finite()
        || !is_valid_radius(radius)
    {
        return false;
    }
    if convex_polygon_contains_point(vertices, start)
        || convex_polygon_contains_point(vertices, end)
    {
        return true;
    }

    let radius_squared = radius * radius;
    for index in 0..vertices.len() {
        let edge_start = vertices[index];
        let edge_end = vertices[(index + 1) % vertices.len()];
        if segment_segment_distance_squared(start, end, edge_start, edge_end) <= radius_squared {
            return true;
        }
    }
    false
}

fn convex_polygon_contains_point(vertices: &[Transform2D], point: Transform2D) -> bool {
    if !point.x.is_finite() || !point.y.is_finite() {
        return false;
    }

    let mut winding = 0.0;
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        let cross = cross_points(start, end, point);
        if cross.abs() <= RAY_EPSILON {
            continue;
        }
        if winding == 0.0 {
            winding = cross.signum();
        } else if cross.signum() != winding {
            return false;
        }
    }
    true
}

fn nearest_point_on_convex_polygon(
    point: Transform2D,
    vertices: &[Transform2D],
) -> Option<(f32, f32, f32)> {
    if !point.x.is_finite() || !point.y.is_finite() || !convex_polygon_is_valid(vertices) {
        return None;
    }
    if convex_polygon_contains_point(vertices, point) {
        return Some((0.0, point.x, point.y));
    }

    let mut best_point = vertices[0];
    let mut best_distance_squared = f32::INFINITY;
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        let candidate = closest_point_on_segment(point, start, end);
        let distance_squared = point_distance_squared(point, candidate);
        if distance_squared < best_distance_squared {
            best_distance_squared = distance_squared;
            best_point = candidate;
        }
    }

    best_distance_squared.is_finite().then_some((
        best_distance_squared.sqrt(),
        best_point.x,
        best_point.y,
    ))
}

fn convex_polygons_overlap(a: &[Transform2D], b: &[Transform2D]) -> bool {
    !convex_polygon_has_separating_axis(a, b) && !convex_polygon_has_separating_axis(b, a)
}

fn convex_polygon_has_separating_axis(axis_source: &[Transform2D], other: &[Transform2D]) -> bool {
    for index in 0..axis_source.len() {
        let start = axis_source[index];
        let end = axis_source[(index + 1) % axis_source.len()];
        let edge_x = end.x - start.x;
        let edge_y = end.y - start.y;
        let axis_length = (edge_x * edge_x + edge_y * edge_y).sqrt();
        if axis_length <= RAY_EPSILON {
            continue;
        }
        let axis_x = -edge_y / axis_length;
        let axis_y = edge_x / axis_length;
        let (source_min, source_max) = project_vertices(axis_source, axis_x, axis_y);
        let (other_min, other_max) = project_vertices(other, axis_x, axis_y);
        if source_max < other_min - RAY_EPSILON || other_max < source_min - RAY_EPSILON {
            return true;
        }
    }
    false
}

fn project_vertices(vertices: &[Transform2D], axis_x: f32, axis_y: f32) -> (f32, f32) {
    let mut min = vertices[0].x * axis_x + vertices[0].y * axis_y;
    let mut max = min;
    for vertex in &vertices[1..] {
        let projection = vertex.x * axis_x + vertex.y * axis_y;
        min = min.min(projection);
        max = max.max(projection);
    }
    (min, max)
}

fn aabb_bounds_vertices(bounds: AabbBounds) -> [Transform2D; 4] {
    [
        Transform2D {
            x: bounds.min_x,
            y: bounds.min_y,
        },
        Transform2D {
            x: bounds.max_x,
            y: bounds.min_y,
        },
        Transform2D {
            x: bounds.max_x,
            y: bounds.max_y,
        },
        Transform2D {
            x: bounds.min_x,
            y: bounds.max_y,
        },
    ]
}

fn oriented_box_vertices(oriented_box: OrientedBoxGeometry) -> [Transform2D; 4] {
    [
        oriented_box_world_point(
            oriented_box,
            Transform2D {
                x: -oriented_box.half_width,
                y: -oriented_box.half_height,
            },
        ),
        oriented_box_world_point(
            oriented_box,
            Transform2D {
                x: oriented_box.half_width,
                y: -oriented_box.half_height,
            },
        ),
        oriented_box_world_point(
            oriented_box,
            Transform2D {
                x: oriented_box.half_width,
                y: oriented_box.half_height,
            },
        ),
        oriented_box_world_point(
            oriented_box,
            Transform2D {
                x: -oriented_box.half_width,
                y: oriented_box.half_height,
            },
        ),
    ]
}

fn oriented_box_oriented_box_contact(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
) -> Option<AabbContact> {
    let axes = [
        (a.axis_x_x, a.axis_x_y),
        (a.axis_y_x, a.axis_y_y),
        (b.axis_x_x, b.axis_x_y),
        (b.axis_y_x, b.axis_y_y),
    ];
    let mut best_contact = AabbContact {
        normal_x: 0.0,
        normal_y: 0.0,
        penetration: f32::INFINITY,
    };

    for (axis_x, axis_y) in axes {
        let contact = oriented_box_axis_contact(a, b, axis_x, axis_y)?;
        if contact.penetration < best_contact.penetration {
            best_contact = contact;
        }
    }

    Some(best_contact)
}

fn oriented_box_axis_contact(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
    axis_x: f32,
    axis_y: f32,
) -> Option<AabbContact> {
    let center_dx = b.center.x - a.center.x;
    let center_dy = b.center.y - a.center.y;
    let center_distance = center_dx * axis_x + center_dy * axis_y;
    let penetration = oriented_box_projection_radius(a, axis_x, axis_y)
        + oriented_box_projection_radius(b, axis_x, axis_y)
        - center_distance.abs();
    if penetration <= 0.0 {
        return None;
    }

    let normal_sign = if center_distance >= 0.0 { 1.0 } else { -1.0 };
    Some(AabbContact {
        normal_x: axis_x * normal_sign,
        normal_y: axis_y * normal_sign,
        penetration,
    })
}

fn oriented_box_circle_contact(
    oriented_box: OrientedBoxGeometry,
    circle_center: Transform2D,
    radius: f32,
) -> Option<AabbContact> {
    if !is_valid_radius(radius) {
        return None;
    }

    let local_center = oriented_box_local_point(oriented_box, circle_center);
    let closest_local = Transform2D {
        x: local_center
            .x
            .clamp(-oriented_box.half_width, oriented_box.half_width),
        y: local_center
            .y
            .clamp(-oriented_box.half_height, oriented_box.half_height),
    };
    let separation_x = local_center.x - closest_local.x;
    let separation_y = local_center.y - closest_local.y;
    let distance_squared = separation_x * separation_x + separation_y * separation_y;
    if distance_squared > radius * radius {
        return None;
    }
    if distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = distance_squared.sqrt();
        let (normal_x, normal_y) = oriented_box_world_vector(
            oriented_box,
            separation_x / distance,
            separation_y / distance,
        );
        return Some(AabbContact {
            normal_x,
            normal_y,
            penetration: radius - distance,
        });
    }

    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    )?;
    let (local_normal_x, local_normal_y, distance_to_face) =
        nearest_aabb_face(local_center, local_bounds);
    let (normal_x, normal_y) =
        oriented_box_world_vector(oriented_box, local_normal_x, local_normal_y);
    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: radius + distance_to_face,
    })
}

fn oriented_box_capsule_contact(
    oriented_box: OrientedBoxGeometry,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<AabbContact> {
    if !is_valid_radius(radius) {
        return None;
    }

    let local_start = oriented_box_local_point(oriented_box, start);
    let local_end = oriented_box_local_point(oriented_box, end);
    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    )?;
    let closest = closest_segment_aabb_pair(local_start, local_end, local_bounds);
    if closest.distance_squared > radius * radius {
        return None;
    }
    if closest.distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = closest.distance_squared.sqrt();
        let (normal_x, normal_y) = oriented_box_world_vector(
            oriented_box,
            (closest.a.x - closest.b.x) / distance,
            (closest.a.y - closest.b.y) / distance,
        );
        return Some(AabbContact {
            normal_x,
            normal_y,
            penetration: radius - distance,
        });
    }

    let reference = capsule_aabb_reference_point(local_start, local_end, local_bounds);
    let (local_normal_x, local_normal_y, distance_to_face) =
        nearest_aabb_face(reference, local_bounds);
    let (normal_x, normal_y) =
        oriented_box_world_vector(oriented_box, local_normal_x, local_normal_y);
    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: radius + distance_to_face,
    })
}

fn convex_shape_contact_from_shapes(
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
) -> Option<AabbContact> {
    let a = convex_contact_geometry_from_shape(at, ac)?;
    let b = convex_contact_geometry_from_shape(bt, bc)?;
    convex_shape_contact(a, b)
}

fn convex_contact_geometry_from_shape(
    transform: Transform2D,
    shape: ColliderShapeRef,
) -> Option<ConvexContactGeometry> {
    match shape {
        ColliderShapeRef::Aabb(collider) => {
            if !collider.enabled {
                return None;
            }
            convex_contact_polygon_from_slice(&aabb_bounds_vertices(AabbBounds::from_transform(
                transform, collider,
            )))
        }
        ColliderShapeRef::Circle(collider) => {
            if !collider.enabled || !is_valid_radius(collider.radius) {
                return None;
            }
            Some(ConvexContactGeometry::Circle {
                center: collider.center(transform),
                radius: collider.radius,
            })
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            let oriented_box = oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            )?;
            convex_contact_polygon_from_slice(&oriented_box_vertices(oriented_box))
        }
        ColliderShapeRef::Capsule(collider) => {
            if !collider.enabled || !capsule_collider_is_valid(collider) {
                return None;
            }
            Some(ConvexContactGeometry::Capsule {
                start: collider.start(transform),
                end: collider.end(transform),
                radius: collider.radius,
                center: collider.center(transform),
            })
        }
        ColliderShapeRef::Edge(collider) => {
            if !collider.enabled || !edge_collider_is_valid(collider) {
                return None;
            }
            Some(ConvexContactGeometry::Capsule {
                start: collider.start(transform),
                end: collider.end(transform),
                radius: EDGE_COLLIDER_RADIUS,
                center: collider.center(transform),
            })
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)?;
            Some(ConvexContactGeometry::Polygon {
                vertices,
                vertex_count,
                center: convex_polygon_centroid(&vertices[..vertex_count]),
            })
        }
    }
}

fn convex_contact_polygon_from_slice(vertices: &[Transform2D]) -> Option<ConvexContactGeometry> {
    if !convex_polygon_is_valid(vertices) {
        return None;
    }

    let mut copied = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
    for (index, vertex) in vertices.iter().copied().enumerate() {
        copied[index] = vertex;
    }
    Some(ConvexContactGeometry::Polygon {
        vertices: copied,
        vertex_count: vertices.len(),
        center: convex_polygon_centroid(vertices),
    })
}

fn convex_shape_contact(a: ConvexContactGeometry, b: ConvexContactGeometry) -> Option<AabbContact> {
    let mut best_contact = AabbContact {
        normal_x: 0.0,
        normal_y: 0.0,
        penetration: f32::INFINITY,
    };
    let mut has_axis = false;

    if !convex_contact_polygon_axes(a, a, b, &mut best_contact, &mut has_axis)?
        || !convex_contact_polygon_axes(b, a, b, &mut best_contact, &mut has_axis)?
        || !convex_contact_capsule_axis(a, a, b, &mut best_contact, &mut has_axis)?
        || !convex_contact_capsule_axis(b, a, b, &mut best_contact, &mut has_axis)?
        || !convex_contact_round_feature_axes(a, b, a, b, &mut best_contact, &mut has_axis)?
        || !convex_contact_round_feature_axes(b, a, a, b, &mut best_contact, &mut has_axis)?
    {
        return None;
    }

    if !has_axis {
        let a_center = convex_contact_geometry_center(a);
        let b_center = convex_contact_geometry_center(b);
        if !convex_contact_axis(
            a,
            b,
            b_center.x - a_center.x,
            b_center.y - a_center.y,
            &mut best_contact,
            &mut has_axis,
        )? {
            return None;
        }
    }

    has_axis.then_some(best_contact)
}

fn convex_contact_polygon_axes(
    axis_source: ConvexContactGeometry,
    a: ConvexContactGeometry,
    other: ConvexContactGeometry,
    best_contact: &mut AabbContact,
    has_axis: &mut bool,
) -> Option<bool> {
    let ConvexContactGeometry::Polygon {
        vertices,
        vertex_count,
        ..
    } = axis_source
    else {
        return Some(true);
    };

    for index in 0..vertex_count {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertex_count];
        let edge_x = end.x - start.x;
        let edge_y = end.y - start.y;
        if !convex_contact_axis(a, other, -edge_y, edge_x, best_contact, has_axis)? {
            return Some(false);
        }
    }
    Some(true)
}

fn convex_contact_capsule_axis(
    axis_source: ConvexContactGeometry,
    a: ConvexContactGeometry,
    other: ConvexContactGeometry,
    best_contact: &mut AabbContact,
    has_axis: &mut bool,
) -> Option<bool> {
    let ConvexContactGeometry::Capsule { start, end, .. } = axis_source else {
        return Some(true);
    };

    let axis_x = -(end.y - start.y);
    let axis_y = end.x - start.x;
    convex_contact_axis(a, other, axis_x, axis_y, best_contact, has_axis)
}

fn convex_contact_round_feature_axes(
    axis_source: ConvexContactGeometry,
    other: ConvexContactGeometry,
    a: ConvexContactGeometry,
    b: ConvexContactGeometry,
    best_contact: &mut AabbContact,
    has_axis: &mut bool,
) -> Option<bool> {
    let ConvexContactGeometry::Polygon {
        vertices,
        vertex_count,
        ..
    } = other
    else {
        return Some(true);
    };

    match axis_source {
        ConvexContactGeometry::Circle { center, .. } => {
            for vertex in &vertices[..vertex_count] {
                if !convex_contact_axis(
                    a,
                    b,
                    center.x - vertex.x,
                    center.y - vertex.y,
                    best_contact,
                    has_axis,
                )? {
                    return Some(false);
                }
            }
        }
        ConvexContactGeometry::Capsule { start, end, .. } => {
            for endpoint in [start, end] {
                for vertex in &vertices[..vertex_count] {
                    if !convex_contact_axis(
                        a,
                        b,
                        endpoint.x - vertex.x,
                        endpoint.y - vertex.y,
                        best_contact,
                        has_axis,
                    )? {
                        return Some(false);
                    }
                }
            }
        }
        ConvexContactGeometry::Polygon { .. } => {}
    }

    Some(true)
}

fn convex_contact_axis(
    a: ConvexContactGeometry,
    b: ConvexContactGeometry,
    axis_x: f32,
    axis_y: f32,
    best_contact: &mut AabbContact,
    has_axis: &mut bool,
) -> Option<bool> {
    if !axis_x.is_finite() || !axis_y.is_finite() {
        return Some(true);
    }
    let axis_length_squared = axis_x * axis_x + axis_y * axis_y;
    if axis_length_squared <= RAY_EPSILON * RAY_EPSILON {
        return Some(true);
    }

    let inv_axis_length = axis_length_squared.sqrt().recip();
    let mut unit_x = axis_x * inv_axis_length;
    let mut unit_y = axis_y * inv_axis_length;
    let a_center = convex_contact_geometry_center(a);
    let b_center = convex_contact_geometry_center(b);
    let center_projection = (b_center.x - a_center.x) * unit_x + (b_center.y - a_center.y) * unit_y;
    if center_projection < 0.0 {
        unit_x = -unit_x;
        unit_y = -unit_y;
    }

    let (a_min, a_max) = convex_contact_geometry_project(a, unit_x, unit_y)?;
    let (b_min, b_max) = convex_contact_geometry_project(b, unit_x, unit_y)?;
    let penetration = a_max.min(b_max) - a_min.max(b_min);
    if !penetration.is_finite() || penetration <= 0.0 {
        return Some(false);
    }

    if penetration < best_contact.penetration {
        *best_contact = AabbContact {
            normal_x: unit_x,
            normal_y: unit_y,
            penetration,
        };
    }
    *has_axis = true;
    Some(true)
}

fn convex_contact_geometry_project(
    geometry: ConvexContactGeometry,
    axis_x: f32,
    axis_y: f32,
) -> Option<(f32, f32)> {
    match geometry {
        ConvexContactGeometry::Polygon {
            vertices,
            vertex_count,
            ..
        } => {
            if vertex_count == 0 || vertex_count > MAX_CONVEX_POLYGON_VERTICES {
                return None;
            }
            Some(project_vertices(&vertices[..vertex_count], axis_x, axis_y))
        }
        ConvexContactGeometry::Circle { center, radius } => {
            if !center.x.is_finite() || !center.y.is_finite() || !is_valid_radius(radius) {
                return None;
            }
            let center_projection = center.x * axis_x + center.y * axis_y;
            Some((center_projection - radius, center_projection + radius))
        }
        ConvexContactGeometry::Capsule {
            start, end, radius, ..
        } => {
            if !start.x.is_finite()
                || !start.y.is_finite()
                || !end.x.is_finite()
                || !end.y.is_finite()
                || !is_valid_radius(radius)
            {
                return None;
            }
            let start_projection = start.x * axis_x + start.y * axis_y;
            let end_projection = end.x * axis_x + end.y * axis_y;
            Some((
                start_projection.min(end_projection) - radius,
                start_projection.max(end_projection) + radius,
            ))
        }
    }
}

fn convex_contact_geometry_center(geometry: ConvexContactGeometry) -> Transform2D {
    match geometry {
        ConvexContactGeometry::Polygon { center, .. }
        | ConvexContactGeometry::Circle { center, .. }
        | ConvexContactGeometry::Capsule { center, .. } => center,
    }
}

fn convex_shape_contact_point(
    a: ConvexContactGeometry,
    b: ConvexContactGeometry,
    contact: AabbContact,
) -> Transform2D {
    let a_support = convex_contact_support_point(a, contact.normal_x, contact.normal_y);
    let b_support = convex_contact_support_point(b, -contact.normal_x, -contact.normal_y);
    match (a_support, b_support) {
        (Some(a_point), Some(b_point)) => Transform2D {
            x: (a_point.x + b_point.x) * 0.5,
            y: (a_point.y + b_point.y) * 0.5,
        },
        (Some(point), None) | (None, Some(point)) => point,
        (None, None) => {
            let a_center = convex_contact_geometry_center(a);
            let b_center = convex_contact_geometry_center(b);
            Transform2D {
                x: (a_center.x + b_center.x) * 0.5,
                y: (a_center.y + b_center.y) * 0.5,
            }
        }
    }
}

fn convex_contact_support_point(
    geometry: ConvexContactGeometry,
    direction_x: f32,
    direction_y: f32,
) -> Option<Transform2D> {
    if !direction_x.is_finite() || !direction_y.is_finite() {
        return None;
    }
    let length_squared = direction_x * direction_x + direction_y * direction_y;
    if length_squared <= RAY_EPSILON * RAY_EPSILON {
        return Some(convex_contact_geometry_center(geometry));
    }
    let inv_length = length_squared.sqrt().recip();
    let direction_x = direction_x * inv_length;
    let direction_y = direction_y * inv_length;

    match geometry {
        ConvexContactGeometry::Polygon {
            vertices,
            vertex_count,
            ..
        } => polygon_support_point(&vertices[..vertex_count], direction_x, direction_y),
        ConvexContactGeometry::Circle { center, radius } => {
            is_valid_radius(radius).then_some(Transform2D {
                x: center.x + direction_x * radius,
                y: center.y + direction_y * radius,
            })
        }
        ConvexContactGeometry::Capsule {
            start, end, radius, ..
        } => {
            if !is_valid_radius(radius) {
                return None;
            }
            let start_projection = start.x * direction_x + start.y * direction_y;
            let end_projection = end.x * direction_x + end.y * direction_y;
            let endpoint = if (start_projection - end_projection).abs() <= RAY_EPSILON {
                Transform2D {
                    x: (start.x + end.x) * 0.5,
                    y: (start.y + end.y) * 0.5,
                }
            } else if start_projection > end_projection {
                start
            } else {
                end
            };
            Some(Transform2D {
                x: endpoint.x + direction_x * radius,
                y: endpoint.y + direction_y * radius,
            })
        }
    }
}

fn polygon_support_point(
    vertices: &[Transform2D],
    direction_x: f32,
    direction_y: f32,
) -> Option<Transform2D> {
    let first = vertices.first().copied()?;
    let mut max_projection = first.x * direction_x + first.y * direction_y;
    for vertex in &vertices[1..] {
        let projection = vertex.x * direction_x + vertex.y * direction_y;
        if projection > max_projection {
            max_projection = projection;
        }
    }

    let mut sum_x = 0.0;
    let mut sum_y = 0.0;
    let mut count = 0;
    for vertex in vertices {
        let projection = vertex.x * direction_x + vertex.y * direction_y;
        if (projection - max_projection).abs() <= RAY_EPSILON {
            sum_x += vertex.x;
            sum_y += vertex.y;
            count += 1;
        }
    }

    (count > 0).then_some(Transform2D {
        x: sum_x / count as f32,
        y: sum_y / count as f32,
    })
}

fn invert_contact(contact: AabbContact) -> AabbContact {
    AabbContact {
        normal_x: -contact.normal_x,
        normal_y: -contact.normal_y,
        penetration: contact.penetration,
    }
}

fn circle_contains_point(center: Transform2D, radius: f32, point: Transform2D) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    let dx = point.x - center.x;
    let dy = point.y - center.y;
    dx * dx + dy * dy <= radius * radius
}

fn circles_overlap(a: Transform2D, a_radius: f32, b: Transform2D, b_radius: f32) -> bool {
    if !is_valid_radius(a_radius) || !is_valid_radius(b_radius) {
        return false;
    }
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let radius_sum = a_radius + b_radius;
    dx * dx + dy * dy <= radius_sum * radius_sum
}

fn aabb_overlaps_circle(
    at: Transform2D,
    ac: AabbCollider,
    center: Transform2D,
    radius: f32,
) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    let bounds = AabbBounds::from_transform(at, ac);
    circle_overlaps_aabb(center, radius, bounds)
}

fn circle_overlaps_aabb(center: Transform2D, radius: f32, bounds: AabbBounds) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    let closest_x = center.x.clamp(bounds.min_x, bounds.max_x);
    let closest_y = center.y.clamp(bounds.min_y, bounds.max_y);
    let dx = center.x - closest_x;
    let dy = center.y - closest_y;
    dx * dx + dy * dy <= radius * radius
}

fn capsule_overlaps_aabb(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    bounds: AabbBounds,
) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    if segment_intersects_aabb(start, end, bounds) {
        return true;
    }

    let radius_squared = radius * radius;
    if point_aabb_distance_squared(start, bounds) <= radius_squared
        || point_aabb_distance_squared(end, bounds) <= radius_squared
    {
        return true;
    }

    for corner in aabb_corners(bounds) {
        if point_segment_distance_squared(corner, start, end) <= radius_squared {
            return true;
        }
    }
    false
}

fn capsule_overlaps_circle(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    circle_center: Transform2D,
    circle_radius: f32,
) -> bool {
    if !is_valid_radius(radius) || !is_valid_radius(circle_radius) {
        return false;
    }
    let radius_sum = radius + circle_radius;
    point_segment_distance_squared(circle_center, start, end) <= radius_sum * radius_sum
}

fn capsules_overlap(
    a_start: Transform2D,
    a_end: Transform2D,
    a_radius: f32,
    b_start: Transform2D,
    b_end: Transform2D,
    b_radius: f32,
) -> bool {
    if !is_valid_radius(a_radius) || !is_valid_radius(b_radius) {
        return false;
    }
    let radius_sum = a_radius + b_radius;
    segment_segment_distance_squared(a_start, a_end, b_start, b_end) <= radius_sum * radius_sum
}

fn capsule_bounds(start: Transform2D, end: Transform2D, radius: f32) -> AabbBounds {
    AabbBounds {
        min_x: start.x.min(end.x) - radius,
        min_y: start.y.min(end.y) - radius,
        max_x: start.x.max(end.x) + radius,
        max_y: start.y.max(end.y) + radius,
    }
}

fn edge_bounds(start: Transform2D, end: Transform2D) -> AabbBounds {
    capsule_bounds(start, end, EDGE_COLLIDER_RADIUS)
}

fn edge_as_capsule(collider: EdgeCollider) -> CapsuleCollider {
    CapsuleCollider::new(
        collider.start_x,
        collider.start_y,
        collider.end_x,
        collider.end_y,
        EDGE_COLLIDER_RADIUS,
        collider.is_trigger,
        collider.layer,
    )
    .with_offset(collider.offset_x, collider.offset_y)
    .with_enabled(collider.enabled)
}

fn chain_collider_segment(collider: ChainCollider, segment_index: usize) -> Option<EdgeCollider> {
    if !collider.enabled {
        return None;
    }
    collider.segment(segment_index)
}

fn point_aabb_distance_squared(point: Transform2D, bounds: AabbBounds) -> f32 {
    let dx = if point.x < bounds.min_x {
        bounds.min_x - point.x
    } else if point.x > bounds.max_x {
        point.x - bounds.max_x
    } else {
        0.0
    };
    let dy = if point.y < bounds.min_y {
        bounds.min_y - point.y
    } else if point.y > bounds.max_y {
        point.y - bounds.max_y
    } else {
        0.0
    };
    dx * dx + dy * dy
}

fn aabb_corners(bounds: AabbBounds) -> [Transform2D; 4] {
    [
        Transform2D {
            x: bounds.min_x,
            y: bounds.min_y,
        },
        Transform2D {
            x: bounds.max_x,
            y: bounds.min_y,
        },
        Transform2D {
            x: bounds.max_x,
            y: bounds.max_y,
        },
        Transform2D {
            x: bounds.min_x,
            y: bounds.max_y,
        },
    ]
}

fn segment_intersects_aabb(start: Transform2D, end: Transform2D, bounds: AabbBounds) -> bool {
    if bounds.contains_point(start) || bounds.contains_point(end) {
        return true;
    }
    let Some((direction, max_distance)) = segment_direction_and_distance(start, end) else {
        return false;
    };
    raycast_bounds(
        start,
        direction.vx / max_distance,
        direction.vy / max_distance,
        max_distance,
        bounds,
    )
    .is_some()
}

fn point_segment_distance_squared(point: Transform2D, start: Transform2D, end: Transform2D) -> f32 {
    let closest = closest_point_on_segment(point, start, end);
    let dx = point.x - closest.x;
    let dy = point.y - closest.y;
    dx * dx + dy * dy
}

fn closest_point_on_segment(
    point: Transform2D,
    start: Transform2D,
    end: Transform2D,
) -> Transform2D {
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let length_squared = segment_x * segment_x + segment_y * segment_y;
    if length_squared <= RAY_EPSILON * RAY_EPSILON {
        return start;
    }

    let point_x = point.x - start.x;
    let point_y = point.y - start.y;
    let t = ((point_x * segment_x + point_y * segment_y) / length_squared).clamp(0.0, 1.0);
    Transform2D {
        x: start.x + segment_x * t,
        y: start.y + segment_y * t,
    }
}

fn closest_segment_aabb_pair(
    start: Transform2D,
    end: Transform2D,
    bounds: AabbBounds,
) -> ClosestPointPair {
    if bounds.contains_point(start) {
        return closest_point_pair(start, start);
    }
    if bounds.contains_point(end) {
        return closest_point_pair(end, end);
    }
    if let Some(point) = segment_aabb_intersection_point(start, end, bounds) {
        return closest_point_pair(point, point);
    }

    let mut closest = closest_point_pair(start, closest_point_on_aabb(start, bounds));
    closest = closer_point_pair(
        closest,
        closest_point_pair(end, closest_point_on_aabb(end, bounds)),
    );

    for corner in aabb_corners(bounds) {
        let segment_point = closest_point_on_segment(corner, start, end);
        closest = closer_point_pair(closest, closest_point_pair(segment_point, corner));
    }

    closest
}

fn segment_aabb_intersection_point(
    start: Transform2D,
    end: Transform2D,
    bounds: AabbBounds,
) -> Option<Transform2D> {
    let (direction, max_distance) = segment_direction_and_distance(start, end)?;
    let unit_x = direction.vx / max_distance;
    let unit_y = direction.vy / max_distance;
    let hit = raycast_bounds(start, unit_x, unit_y, max_distance, bounds)?;
    Some(Transform2D {
        x: start.x + unit_x * hit.distance,
        y: start.y + unit_y * hit.distance,
    })
}

fn closest_point_on_aabb(point: Transform2D, bounds: AabbBounds) -> Transform2D {
    Transform2D {
        x: point.x.clamp(bounds.min_x, bounds.max_x),
        y: point.y.clamp(bounds.min_y, bounds.max_y),
    }
}

fn capsule_aabb_reference_point(
    start: Transform2D,
    end: Transform2D,
    bounds: AabbBounds,
) -> Transform2D {
    closest_point_on_aabb(
        closest_point_on_segment(aabb_center(bounds), start, end),
        bounds,
    )
}

fn aabb_center(bounds: AabbBounds) -> Transform2D {
    Transform2D {
        x: (bounds.min_x + bounds.max_x) * 0.5,
        y: (bounds.min_y + bounds.max_y) * 0.5,
    }
}

fn nearest_aabb_face(point: Transform2D, bounds: AabbBounds) -> (f32, f32, f32) {
    let point = closest_point_on_aabb(point, bounds);
    let left = point.x - bounds.min_x;
    let right = bounds.max_x - point.x;
    let down = point.y - bounds.min_y;
    let up = bounds.max_y - point.y;

    if left <= right && left <= down && left <= up {
        (-1.0, 0.0, left)
    } else if right <= down && right <= up {
        (1.0, 0.0, right)
    } else if down <= up {
        (0.0, -1.0, down)
    } else {
        (0.0, 1.0, up)
    }
}

fn fallback_contact_normal(a_center: Transform2D, b_center: Transform2D) -> (f32, f32) {
    let dx = b_center.x - a_center.x;
    let dy = b_center.y - a_center.y;
    let distance_squared = dx * dx + dy * dy;
    if distance_squared <= RAY_EPSILON * RAY_EPSILON {
        return (1.0, 0.0);
    }

    let distance = distance_squared.sqrt();
    (dx / distance, dy / distance)
}

fn closest_points_on_segments(
    a_start: Transform2D,
    a_end: Transform2D,
    b_start: Transform2D,
    b_end: Transform2D,
) -> ClosestPointPair {
    if segments_intersect(a_start, a_end, b_start, b_end) {
        if let Some(point) = segment_intersection_point(a_start, a_end, b_start, b_end) {
            return closest_point_pair(point, point);
        }
    }

    let mut closest =
        closest_point_pair(a_start, closest_point_on_segment(a_start, b_start, b_end));
    closest = closer_point_pair(
        closest,
        closest_point_pair(a_end, closest_point_on_segment(a_end, b_start, b_end)),
    );
    closest = closer_point_pair(
        closest,
        closest_point_pair(closest_point_on_segment(b_start, a_start, a_end), b_start),
    );
    closer_point_pair(
        closest,
        closest_point_pair(closest_point_on_segment(b_end, a_start, a_end), b_end),
    )
}

fn segment_intersection_point(
    a_start: Transform2D,
    a_end: Transform2D,
    b_start: Transform2D,
    b_end: Transform2D,
) -> Option<Transform2D> {
    let rx = a_end.x - a_start.x;
    let ry = a_end.y - a_start.y;
    let sx = b_end.x - b_start.x;
    let sy = b_end.y - b_start.y;
    let denominator = rx * sy - ry * sx;
    if denominator.abs() <= RAY_EPSILON {
        return None;
    }

    let qpx = b_start.x - a_start.x;
    let qpy = b_start.y - a_start.y;
    let t = (qpx * sy - qpy * sx) / denominator;
    Some(Transform2D {
        x: a_start.x + rx * t,
        y: a_start.y + ry * t,
    })
}

fn closest_point_pair(a: Transform2D, b: Transform2D) -> ClosestPointPair {
    ClosestPointPair {
        a,
        b,
        distance_squared: point_distance_squared(a, b),
    }
}

fn closer_point_pair(a: ClosestPointPair, b: ClosestPointPair) -> ClosestPointPair {
    if b.distance_squared < a.distance_squared {
        b
    } else {
        a
    }
}

fn segment_segment_distance_squared(
    a_start: Transform2D,
    a_end: Transform2D,
    b_start: Transform2D,
    b_end: Transform2D,
) -> f32 {
    if segments_intersect(a_start, a_end, b_start, b_end) {
        return 0.0;
    }

    point_segment_distance_squared(a_start, b_start, b_end)
        .min(point_segment_distance_squared(a_end, b_start, b_end))
        .min(point_segment_distance_squared(b_start, a_start, a_end))
        .min(point_segment_distance_squared(b_end, a_start, a_end))
}

fn segments_intersect(
    a_start: Transform2D,
    a_end: Transform2D,
    b_start: Transform2D,
    b_end: Transform2D,
) -> bool {
    let a_length_squared = point_distance_squared(a_start, a_end);
    let b_length_squared = point_distance_squared(b_start, b_end);
    if a_length_squared <= RAY_EPSILON * RAY_EPSILON {
        return point_segment_distance_squared(a_start, b_start, b_end)
            <= RAY_EPSILON * RAY_EPSILON;
    }
    if b_length_squared <= RAY_EPSILON * RAY_EPSILON {
        return point_segment_distance_squared(b_start, a_start, a_end)
            <= RAY_EPSILON * RAY_EPSILON;
    }

    let ab_cross_c = cross_points(a_start, a_end, b_start);
    let ab_cross_d = cross_points(a_start, a_end, b_end);
    let cd_cross_a = cross_points(b_start, b_end, a_start);
    let cd_cross_b = cross_points(b_start, b_end, a_end);

    if ab_cross_c.abs() <= RAY_EPSILON && point_on_segment(b_start, a_start, a_end) {
        return true;
    }
    if ab_cross_d.abs() <= RAY_EPSILON && point_on_segment(b_end, a_start, a_end) {
        return true;
    }
    if cd_cross_a.abs() <= RAY_EPSILON && point_on_segment(a_start, b_start, b_end) {
        return true;
    }
    if cd_cross_b.abs() <= RAY_EPSILON && point_on_segment(a_end, b_start, b_end) {
        return true;
    }

    (ab_cross_c > 0.0) != (ab_cross_d > 0.0) && (cd_cross_a > 0.0) != (cd_cross_b > 0.0)
}

fn point_on_segment(point: Transform2D, start: Transform2D, end: Transform2D) -> bool {
    point.x >= start.x.min(end.x) - RAY_EPSILON
        && point.x <= start.x.max(end.x) + RAY_EPSILON
        && point.y >= start.y.min(end.y) - RAY_EPSILON
        && point.y <= start.y.max(end.y) + RAY_EPSILON
}

fn cross_points(origin: Transform2D, a: Transform2D, b: Transform2D) -> f32 {
    let ax = a.x - origin.x;
    let ay = a.y - origin.y;
    let bx = b.x - origin.x;
    let by = b.y - origin.y;
    ax * by - ay * bx
}

fn point_distance_squared(a: Transform2D, b: Transform2D) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    dx * dx + dy * dy
}

fn oriented_box_collider_is_valid(collider: OrientedBoxCollider) -> bool {
    collider.enabled
        && is_valid_half_extent(collider.half_width)
        && is_valid_half_extent(collider.half_height)
        && collider.rotation_radians.is_finite()
}

fn oriented_box_total_rotation(world: &World, index: usize, collider: OrientedBoxCollider) -> f32 {
    let entity_rotation = world
        .rotations
        .get(index)
        .copied()
        .flatten()
        .map(|rotation| rotation.radians)
        .filter(|rotation| rotation.is_finite())
        .unwrap_or(0.0);
    collider.rotation_radians + entity_rotation
}

fn convex_polygon_total_rotation(
    world: &World,
    index: usize,
    collider: ConvexPolygonCollider,
) -> f32 {
    let entity_rotation = world
        .rotations
        .get(index)
        .copied()
        .flatten()
        .map(|rotation| rotation.radians)
        .filter(|rotation| rotation.is_finite())
        .unwrap_or(0.0);
    collider.rotation_radians + entity_rotation
}

fn oriented_box_geometry(
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    rotation_radians: f32,
) -> Option<OrientedBoxGeometry> {
    if !center.x.is_finite()
        || !center.y.is_finite()
        || !is_valid_half_extent(half_width)
        || !is_valid_half_extent(half_height)
        || !rotation_radians.is_finite()
    {
        return None;
    }
    let (sin, cos) = rotation_radians.sin_cos();
    Some(OrientedBoxGeometry {
        center,
        half_width,
        half_height,
        axis_x_x: cos,
        axis_x_y: sin,
        axis_y_x: -sin,
        axis_y_y: cos,
    })
}

fn oriented_box_bounds(
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    rotation_radians: f32,
) -> AabbBounds {
    let Some(oriented_box) =
        oriented_box_geometry(center, half_width, half_height, rotation_radians)
    else {
        return AabbBounds {
            min_x: center.x,
            min_y: center.y,
            max_x: center.x,
            max_y: center.y,
        };
    };
    let extent_x =
        oriented_box.axis_x_x.abs() * half_width + oriented_box.axis_y_x.abs() * half_height;
    let extent_y =
        oriented_box.axis_x_y.abs() * half_width + oriented_box.axis_y_y.abs() * half_height;
    AabbBounds {
        min_x: center.x - extent_x,
        min_y: center.y - extent_y,
        max_x: center.x + extent_x,
        max_y: center.y + extent_y,
    }
}

fn oriented_box_overlaps_aabb(oriented_box: OrientedBoxGeometry, bounds: AabbBounds) -> bool {
    let Some(aabb_box) = oriented_box_geometry(
        Transform2D {
            x: (bounds.min_x + bounds.max_x) * 0.5,
            y: (bounds.min_y + bounds.max_y) * 0.5,
        },
        (bounds.max_x - bounds.min_x) * 0.5,
        (bounds.max_y - bounds.min_y) * 0.5,
        0.0,
    ) else {
        return false;
    };
    oriented_boxes_overlap(oriented_box, aabb_box)
}

fn oriented_box_overlaps_circle(
    oriented_box: OrientedBoxGeometry,
    circle_center: Transform2D,
    radius: f32,
) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    let dx = circle_center.x - oriented_box.center.x;
    let dy = circle_center.y - oriented_box.center.y;
    let local_x = dx * oriented_box.axis_x_x + dy * oriented_box.axis_x_y;
    let local_y = dx * oriented_box.axis_y_x + dy * oriented_box.axis_y_y;
    let closest_x = local_x.clamp(-oriented_box.half_width, oriented_box.half_width);
    let closest_y = local_y.clamp(-oriented_box.half_height, oriented_box.half_height);
    let separation_x = local_x - closest_x;
    let separation_y = local_y - closest_y;
    separation_x * separation_x + separation_y * separation_y <= radius * radius
}

fn oriented_box_overlaps_capsule(
    oriented_box: OrientedBoxGeometry,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> bool {
    if !is_valid_radius(radius) {
        return false;
    }
    let local_start = oriented_box_local_point(oriented_box, start);
    let local_end = oriented_box_local_point(oriented_box, end);
    let Some(local_bounds) = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    ) else {
        return false;
    };
    capsule_overlaps_aabb(local_start, local_end, radius, local_bounds)
}

fn oriented_box_local_point(oriented_box: OrientedBoxGeometry, point: Transform2D) -> Transform2D {
    let dx = point.x - oriented_box.center.x;
    let dy = point.y - oriented_box.center.y;
    Transform2D {
        x: dx * oriented_box.axis_x_x + dy * oriented_box.axis_x_y,
        y: dx * oriented_box.axis_y_x + dy * oriented_box.axis_y_y,
    }
}

fn oriented_box_world_point(
    oriented_box: OrientedBoxGeometry,
    local_point: Transform2D,
) -> Transform2D {
    Transform2D {
        x: oriented_box.center.x
            + local_point.x * oriented_box.axis_x_x
            + local_point.y * oriented_box.axis_y_x,
        y: oriented_box.center.y
            + local_point.x * oriented_box.axis_x_y
            + local_point.y * oriented_box.axis_y_y,
    }
}

fn oriented_box_local_vector(
    oriented_box: OrientedBoxGeometry,
    vector_x: f32,
    vector_y: f32,
) -> (f32, f32) {
    (
        vector_x * oriented_box.axis_x_x + vector_y * oriented_box.axis_x_y,
        vector_x * oriented_box.axis_y_x + vector_y * oriented_box.axis_y_y,
    )
}

fn oriented_box_world_vector(
    oriented_box: OrientedBoxGeometry,
    local_x: f32,
    local_y: f32,
) -> (f32, f32) {
    (
        local_x * oriented_box.axis_x_x + local_y * oriented_box.axis_y_x,
        local_x * oriented_box.axis_x_y + local_y * oriented_box.axis_y_y,
    )
}

fn oriented_box_local_motion(
    oriented_box: OrientedBoxGeometry,
    motion: ShapeCastMotion,
) -> ShapeCastMotion {
    let (unit_x, unit_y) = oriented_box_local_vector(oriented_box, motion.unit_x, motion.unit_y);
    ShapeCastMotion {
        unit_x,
        unit_y,
        max_distance: motion.max_distance,
    }
}

fn oriented_box_world_hit(
    oriented_box: OrientedBoxGeometry,
    hit: RaycastBoundsHit,
) -> RaycastBoundsHit {
    let (normal_x, normal_y) = oriented_box_world_vector(oriented_box, hit.normal_x, hit.normal_y);
    RaycastBoundsHit {
        distance: hit.distance,
        normal_x,
        normal_y,
    }
}

fn oriented_box_contains_point(
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    rotation_radians: f32,
    point: Transform2D,
) -> bool {
    let Some(oriented_box) =
        oriented_box_geometry(center, half_width, half_height, rotation_radians)
    else {
        return false;
    };
    let local_point = oriented_box_local_point(oriented_box, point);
    local_point.x.abs() <= oriented_box.half_width
        && local_point.y.abs() <= oriented_box.half_height
}

fn nearest_point_on_oriented_box(
    point: Transform2D,
    center: Transform2D,
    half_width: f32,
    half_height: f32,
    rotation_radians: f32,
) -> Option<(f32, f32, f32)> {
    let oriented_box = oriented_box_geometry(center, half_width, half_height, rotation_radians)?;
    let local_point = oriented_box_local_point(oriented_box, point);
    let closest_local = Transform2D {
        x: local_point
            .x
            .clamp(-oriented_box.half_width, oriented_box.half_width),
        y: local_point
            .y
            .clamp(-oriented_box.half_height, oriented_box.half_height),
    };
    if closest_local == local_point {
        return Some((0.0, point.x, point.y));
    }

    let closest = oriented_box_world_point(oriented_box, closest_local);
    let dx = point.x - closest.x;
    let dy = point.y - closest.y;
    let distance = (dx * dx + dy * dy).sqrt();
    distance
        .is_finite()
        .then_some((distance, closest.x, closest.y))
}

fn oriented_boxes_overlap(a: OrientedBoxGeometry, b: OrientedBoxGeometry) -> bool {
    !oriented_box_axis_separates(a, b, a.axis_x_x, a.axis_x_y)
        && !oriented_box_axis_separates(a, b, a.axis_y_x, a.axis_y_y)
        && !oriented_box_axis_separates(a, b, b.axis_x_x, b.axis_x_y)
        && !oriented_box_axis_separates(a, b, b.axis_y_x, b.axis_y_y)
}

fn oriented_box_axis_separates(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
    axis_x: f32,
    axis_y: f32,
) -> bool {
    let center_dx = b.center.x - a.center.x;
    let center_dy = b.center.y - a.center.y;
    let center_distance = (center_dx * axis_x + center_dy * axis_y).abs();
    let a_radius = oriented_box_projection_radius(a, axis_x, axis_y);
    let b_radius = oriented_box_projection_radius(b, axis_x, axis_y);
    center_distance > a_radius + b_radius
}

fn oriented_box_projection_radius(
    oriented_box: OrientedBoxGeometry,
    axis_x: f32,
    axis_y: f32,
) -> f32 {
    oriented_box.half_width
        * (oriented_box.axis_x_x * axis_x + oriented_box.axis_x_y * axis_y).abs()
        + oriented_box.half_height
            * (oriented_box.axis_y_x * axis_x + oriented_box.axis_y_y * axis_y).abs()
}

fn precise_swept_overlap(
    world: &World,
    moving_index: usize,
    target_index: usize,
    delta: f32,
) -> bool {
    let Some(moving_transform) = world.transforms[moving_index] else {
        return false;
    };
    let Some(moving_collider) = world.colliders[moving_index] else {
        return false;
    };
    if !moving_collider.enabled {
        return false;
    }
    let Some(target_transform) = world.transforms[target_index] else {
        return false;
    };
    let Some(target_collider) = world.colliders[target_index] else {
        return false;
    };
    if !target_collider.enabled {
        return false;
    }
    if CollisionSystem::overlaps(
        moving_transform,
        moving_collider,
        target_transform,
        target_collider,
    ) {
        return true;
    }

    let moving_velocity = world.velocities[moving_index].unwrap_or_default();
    let target_velocity = world.velocities[target_index].unwrap_or_default();
    let moving_start = previous_transform(moving_transform, moving_velocity, delta);
    let target_start = previous_transform(target_transform, target_velocity, delta);
    CollisionSystem::swept_aabb_time(
        moving_start,
        moving_velocity,
        moving_collider,
        target_start,
        target_velocity,
        target_collider,
        delta,
    )
    .is_some()
}

fn previous_transform(transform: Transform2D, velocity: Velocity, delta: f32) -> Transform2D {
    Transform2D {
        x: transform.x - velocity.vx * delta,
        y: transform.y - velocity.vy * delta,
    }
}

fn raycast_shape(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    transform: Transform2D,
    shape: ColliderShapeRef,
) -> Option<RaycastBoundsHit> {
    match shape {
        ColliderShapeRef::Aabb(collider) => raycast_bounds(
            origin,
            unit_x,
            unit_y,
            max_distance,
            AabbBounds::from_transform(transform, collider),
        ),
        ColliderShapeRef::Circle(collider) => raycast_circle(
            origin,
            unit_x,
            unit_y,
            max_distance,
            collider.center(transform),
            collider.radius,
        ),
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => raycast_oriented_box(
            origin,
            unit_x,
            unit_y,
            max_distance,
            oriented_box_geometry(
                collider.center(transform),
                collider.half_width,
                collider.half_height,
                rotation_radians,
            )?,
        ),
        ColliderShapeRef::Capsule(collider) => raycast_capsule(
            origin,
            unit_x,
            unit_y,
            max_distance,
            collider.start(transform),
            collider.end(transform),
            collider.radius,
        ),
        ColliderShapeRef::Edge(collider) => raycast_edge(
            origin,
            unit_x,
            unit_y,
            max_distance,
            collider.start(transform),
            collider.end(transform),
        ),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(transform, collider, rotation_radians)?;
            raycast_convex_polygon(
                origin,
                unit_x,
                unit_y,
                max_distance,
                &vertices[..vertex_count],
            )
        }
    }
}

fn shape_cast_hit(
    query_shape: CollisionQueryShape,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    collider_transform: Transform2D,
    collider_shape: ColliderShapeRef,
) -> Option<RaycastBoundsHit> {
    let collider_shape = match collider_shape {
        ColliderShapeRef::Edge(collider) => ColliderShapeRef::Capsule(edge_as_capsule(collider)),
        other => other,
    };

    if query_shape_overlaps_collider(query_shape, collider_transform, collider_shape) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let reference = query_shape_reference_point(query_shape);
    let motion = ShapeCastMotion {
        unit_x,
        unit_y,
        max_distance,
    };
    match (query_shape, collider_shape) {
        (query_shape, ColliderShapeRef::Edge(collider)) => shape_cast_hit(
            query_shape,
            unit_x,
            unit_y,
            max_distance,
            collider_transform,
            ColliderShapeRef::Capsule(edge_as_capsule(collider)),
        ),
        (CollisionQueryShape::Aabb(bounds), ColliderShapeRef::Aabb(collider)) => {
            let (half_width, half_height) = query_aabb_half_extents(bounds);
            raycast_bounds(
                reference,
                unit_x,
                unit_y,
                max_distance,
                inflate_bounds(
                    AabbBounds::from_transform(collider_transform, collider),
                    half_width,
                    half_height,
                ),
            )
        }
        (CollisionQueryShape::Aabb(bounds), ColliderShapeRef::Circle(collider)) => {
            shape_cast_aabb_circle(
                reference,
                bounds,
                unit_x,
                unit_y,
                max_distance,
                collider.center(collider_transform),
                collider.radius,
            )
        }
        (CollisionQueryShape::Circle { radius, .. }, ColliderShapeRef::Aabb(collider)) => {
            raycast_bounds(
                reference,
                unit_x,
                unit_y,
                max_distance,
                inflate_bounds(
                    AabbBounds::from_transform(collider_transform, collider),
                    radius,
                    radius,
                ),
            )
        }
        (
            CollisionQueryShape::Circle {
                radius: query_radius,
                ..
            },
            ColliderShapeRef::Circle(collider),
        ) => raycast_circle(
            reference,
            unit_x,
            unit_y,
            max_distance,
            collider.center(collider_transform),
            query_radius + collider.radius,
        ),
        (
            CollisionQueryShape::OrientedBox {
                center,
                half_width,
                half_height,
                rotation_radians,
            },
            ColliderShapeRef::Aabb(collider),
        ) => shape_cast_oriented_box_aabb(
            oriented_box_geometry(center, half_width, half_height, rotation_radians)?,
            motion,
            AabbBounds::from_transform(collider_transform, collider),
        ),
        (
            CollisionQueryShape::OrientedBox {
                center,
                half_width,
                half_height,
                rotation_radians,
            },
            ColliderShapeRef::Circle(collider),
        ) => shape_cast_oriented_box_circle(
            oriented_box_geometry(center, half_width, half_height, rotation_radians)?,
            motion,
            collider.center(collider_transform),
            collider.radius,
        ),
        (CollisionQueryShape::Capsule { start, end, radius }, ColliderShapeRef::Aabb(collider)) => {
            shape_cast_capsule_aabb(
                start,
                end,
                radius,
                unit_x,
                unit_y,
                max_distance,
                AabbBounds::from_transform(collider_transform, collider),
            )
        }
        (
            CollisionQueryShape::Capsule { start, end, radius },
            ColliderShapeRef::Circle(collider),
        ) => shape_cast_moving_segment_circle(
            start,
            end,
            unit_x,
            unit_y,
            max_distance,
            collider.center(collider_transform),
            radius + collider.radius,
        ),
        (CollisionQueryShape::Aabb(bounds), ColliderShapeRef::Capsule(collider)) => {
            shape_cast_aabb_capsule(
                reference,
                bounds,
                motion,
                collider.start(collider_transform),
                collider.end(collider_transform),
                collider.radius,
            )
        }
        (CollisionQueryShape::Circle { radius, .. }, ColliderShapeRef::Capsule(collider)) => {
            shape_cast_circle_capsule(
                reference,
                radius,
                motion,
                collider.start(collider_transform),
                collider.end(collider_transform),
                collider.radius,
            )
        }
        (
            CollisionQueryShape::OrientedBox {
                center,
                half_width,
                half_height,
                rotation_radians,
            },
            ColliderShapeRef::Capsule(collider),
        ) => shape_cast_oriented_box_capsule(
            oriented_box_geometry(center, half_width, half_height, rotation_radians)?,
            motion,
            collider.start(collider_transform),
            collider.end(collider_transform),
            collider.radius,
        ),
        (CollisionQueryShape::Aabb(bounds), ColliderShapeRef::OrientedBox(collider, rotation)) => {
            shape_cast_aabb_oriented_box(
                reference,
                bounds,
                motion,
                oriented_box_geometry(
                    collider.center(collider_transform),
                    collider.half_width,
                    collider.half_height,
                    rotation,
                )?,
            )
        }
        (
            CollisionQueryShape::Circle { radius, .. },
            ColliderShapeRef::OrientedBox(collider, rotation),
        ) => shape_cast_circle_oriented_box(
            reference,
            radius,
            motion,
            oriented_box_geometry(
                collider.center(collider_transform),
                collider.half_width,
                collider.half_height,
                rotation,
            )?,
        ),
        (
            CollisionQueryShape::OrientedBox {
                center,
                half_width,
                half_height,
                rotation_radians,
            },
            ColliderShapeRef::OrientedBox(collider, target_rotation),
        ) => shape_cast_oriented_box_oriented_box(
            oriented_box_geometry(center, half_width, half_height, rotation_radians)?,
            motion,
            oriented_box_geometry(
                collider.center(collider_transform),
                collider.half_width,
                collider.half_height,
                target_rotation,
            )?,
        ),
        (
            CollisionQueryShape::Capsule { start, end, radius },
            ColliderShapeRef::OrientedBox(collider, rotation),
        ) => shape_cast_capsule_oriented_box(
            start,
            end,
            radius,
            motion,
            oriented_box_geometry(
                collider.center(collider_transform),
                collider.half_width,
                collider.half_height,
                rotation,
            )?,
        ),
        (
            CollisionQueryShape::Capsule { start, end, radius },
            ColliderShapeRef::Capsule(collider),
        ) => shape_cast_capsule_capsule(
            start,
            end,
            radius,
            motion,
            collider.start(collider_transform),
            collider.end(collider_transform),
            collider.radius,
        ),
        (
            CollisionQueryShape::Aabb(bounds),
            ColliderShapeRef::ConvexPolygon(collider, rotation),
        ) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(collider_transform, collider, rotation)?;
            shape_cast_aabb_convex_polygon(reference, bounds, motion, &vertices[..vertex_count])
        }
        (
            CollisionQueryShape::Circle { radius, .. },
            ColliderShapeRef::ConvexPolygon(collider, rotation),
        ) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(collider_transform, collider, rotation)?;
            shape_cast_circle_convex_polygon(reference, radius, motion, &vertices[..vertex_count])
        }
        (
            CollisionQueryShape::OrientedBox {
                center,
                half_width,
                half_height,
                rotation_radians,
            },
            ColliderShapeRef::ConvexPolygon(collider, target_rotation),
        ) => {
            let (vertices, vertex_count) = convex_polygon_collider_vertices_slice(
                collider_transform,
                collider,
                target_rotation,
            )?;
            shape_cast_oriented_box_convex_polygon(
                oriented_box_geometry(center, half_width, half_height, rotation_radians)?,
                motion,
                &vertices[..vertex_count],
            )
        }
        (
            CollisionQueryShape::Capsule { start, end, radius },
            ColliderShapeRef::ConvexPolygon(collider, rotation),
        ) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(collider_transform, collider, rotation)?;
            shape_cast_capsule_convex_polygon(start, end, radius, motion, &vertices[..vertex_count])
        }
        (
            CollisionQueryShape::ConvexPolygon {
                vertices: moving_vertices,
                vertex_count: moving_vertex_count,
            },
            ColliderShapeRef::ConvexPolygon(collider, rotation),
        ) => {
            let moving_vertices = convex_polygon_vertices(&moving_vertices, moving_vertex_count)?;
            let (target_vertices, target_vertex_count) =
                convex_polygon_collider_vertices_slice(collider_transform, collider, rotation)?;
            shape_cast_convex_polygon_convex_polygon(
                moving_vertices,
                motion,
                &target_vertices[..target_vertex_count],
            )
        }
        (
            CollisionQueryShape::ConvexPolygon {
                vertices,
                vertex_count,
            },
            ColliderShapeRef::Aabb(collider),
        ) => {
            let moving_vertices = convex_polygon_vertices(&vertices, vertex_count)?;
            shape_cast_convex_polygon_aabb(
                moving_vertices,
                motion,
                AabbBounds::from_transform(collider_transform, collider),
            )
        }
        (
            CollisionQueryShape::ConvexPolygon {
                vertices,
                vertex_count,
            },
            ColliderShapeRef::Circle(collider),
        ) => {
            let moving_vertices = convex_polygon_vertices(&vertices, vertex_count)?;
            shape_cast_convex_polygon_circle(
                moving_vertices,
                motion,
                collider.center(collider_transform),
                collider.radius,
            )
        }
        (
            CollisionQueryShape::ConvexPolygon {
                vertices,
                vertex_count,
            },
            ColliderShapeRef::OrientedBox(collider, rotation),
        ) => {
            let moving_vertices = convex_polygon_vertices(&vertices, vertex_count)?;
            shape_cast_convex_polygon_oriented_box(
                moving_vertices,
                motion,
                oriented_box_geometry(
                    collider.center(collider_transform),
                    collider.half_width,
                    collider.half_height,
                    rotation,
                )?,
            )
        }
        (
            CollisionQueryShape::ConvexPolygon {
                vertices,
                vertex_count,
            },
            ColliderShapeRef::Capsule(collider),
        ) => {
            let moving_vertices = convex_polygon_vertices(&vertices, vertex_count)?;
            shape_cast_convex_polygon_capsule(
                moving_vertices,
                motion,
                collider.start(collider_transform),
                collider.end(collider_transform),
                collider.radius,
            )
        }
    }
}

fn shape_cast_aabb_convex_polygon(
    reference: Transform2D,
    bounds: AabbBounds,
    motion: ShapeCastMotion,
    target_vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    let (half_width, half_height) = query_aabb_half_extents(bounds);
    let moving_bounds = AabbBounds::from_center(reference, half_width, half_height)?;
    let moving_vertices = aabb_bounds_vertices(moving_bounds);
    shape_cast_convex_polygon_convex_polygon(&moving_vertices, motion, target_vertices)
}

fn shape_cast_circle_convex_polygon(
    center: Transform2D,
    radius: f32,
    motion: ShapeCastMotion,
    target_vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) || !convex_polygon_is_valid(target_vertices) {
        return None;
    }

    let mut best = None;
    for index in 0..target_vertices.len() {
        let start = target_vertices[index];
        let end = target_vertices[(index + 1) % target_vertices.len()];
        update_nearest_hit(
            &mut best,
            raycast_capsule(
                center,
                motion.unit_x,
                motion.unit_y,
                motion.max_distance,
                start,
                end,
                radius,
            ),
        );
    }
    best
}

fn shape_cast_oriented_box_convex_polygon(
    moving: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    target_vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    let moving_vertices = oriented_box_vertices(moving);
    shape_cast_convex_polygon_convex_polygon(&moving_vertices, motion, target_vertices)
}

fn shape_cast_capsule_convex_polygon(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    motion: ShapeCastMotion,
    target_vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) || !convex_polygon_is_valid(target_vertices) {
        return None;
    }

    let mut best = None;
    update_nearest_hit(
        &mut best,
        shape_cast_circle_convex_polygon(start, radius, motion, target_vertices),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_circle_convex_polygon(end, radius, motion, target_vertices),
    );
    for index in 0..target_vertices.len() {
        let edge_start = target_vertices[index];
        let edge_end = target_vertices[(index + 1) % target_vertices.len()];
        update_nearest_hit(
            &mut best,
            shape_cast_moving_segment_capsule_side(
                start, end, motion, edge_start, edge_end, radius,
            ),
        );
        update_nearest_hit(
            &mut best,
            shape_cast_moving_segment_circle(
                start,
                end,
                motion.unit_x,
                motion.unit_y,
                motion.max_distance,
                edge_start,
                radius,
            ),
        );
    }
    best
}

fn shape_cast_convex_polygon_aabb(
    moving_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    target_bounds: AabbBounds,
) -> Option<RaycastBoundsHit> {
    let target_vertices = aabb_bounds_vertices(target_bounds);
    shape_cast_convex_polygon_convex_polygon(moving_vertices, motion, &target_vertices)
}

fn shape_cast_convex_polygon_circle(
    moving_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    center: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    let reverse_motion = ShapeCastMotion {
        unit_x: -motion.unit_x,
        unit_y: -motion.unit_y,
        max_distance: motion.max_distance,
    };
    let hit = shape_cast_circle_convex_polygon(center, radius, reverse_motion, moving_vertices)?;
    Some(invert_raycast_hit_normal(hit))
}

fn shape_cast_convex_polygon_oriented_box(
    moving_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    target: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    let target_vertices = oriented_box_vertices(target);
    shape_cast_convex_polygon_convex_polygon(moving_vertices, motion, &target_vertices)
}

fn shape_cast_convex_polygon_capsule(
    moving_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    let reverse_motion = ShapeCastMotion {
        unit_x: -motion.unit_x,
        unit_y: -motion.unit_y,
        max_distance: motion.max_distance,
    };
    let hit =
        shape_cast_capsule_convex_polygon(start, end, radius, reverse_motion, moving_vertices)?;
    Some(invert_raycast_hit_normal(hit))
}

fn shape_cast_convex_polygon_convex_polygon(
    moving_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    target_vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    if !convex_polygon_is_valid(moving_vertices) || !convex_polygon_is_valid(target_vertices) {
        return None;
    }
    if convex_polygons_overlap(moving_vertices, target_vertices) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let mut entry = 0.0;
    let mut exit = motion.max_distance;
    let mut normal_x = 0.0;
    let mut normal_y = 0.0;

    shape_cast_convex_polygon_axes(
        moving_vertices,
        moving_vertices,
        target_vertices,
        motion,
        &mut entry,
        &mut exit,
        &mut normal_x,
        &mut normal_y,
    )?;
    shape_cast_convex_polygon_axes(
        target_vertices,
        moving_vertices,
        target_vertices,
        motion,
        &mut entry,
        &mut exit,
        &mut normal_x,
        &mut normal_y,
    )?;

    if entry > exit || exit < 0.0 || entry > motion.max_distance {
        return None;
    }

    Some(RaycastBoundsHit {
        distance: entry.max(0.0),
        normal_x,
        normal_y,
    })
}

fn invert_raycast_hit_normal(hit: RaycastBoundsHit) -> RaycastBoundsHit {
    RaycastBoundsHit {
        distance: hit.distance,
        normal_x: -hit.normal_x,
        normal_y: -hit.normal_y,
    }
}

#[allow(clippy::too_many_arguments)]
fn shape_cast_convex_polygon_axes(
    axis_source: &[Transform2D],
    moving_vertices: &[Transform2D],
    target_vertices: &[Transform2D],
    motion: ShapeCastMotion,
    entry: &mut f32,
    exit: &mut f32,
    normal_x: &mut f32,
    normal_y: &mut f32,
) -> Option<()> {
    for index in 0..axis_source.len() {
        let start = axis_source[index];
        let end = axis_source[(index + 1) % axis_source.len()];
        let edge_x = end.x - start.x;
        let edge_y = end.y - start.y;
        let axis_length = (edge_x * edge_x + edge_y * edge_y).sqrt();
        if axis_length <= RAY_EPSILON {
            continue;
        }
        let axis_x = -edge_y / axis_length;
        let axis_y = edge_x / axis_length;
        let (moving_min, moving_max) = project_vertices(moving_vertices, axis_x, axis_y);
        let (target_min, target_max) = project_vertices(target_vertices, axis_x, axis_y);
        let velocity = motion.unit_x * axis_x + motion.unit_y * axis_y;
        let axis_hit = moving_axis_entry_exit(
            moving_min, moving_max, velocity, target_min, target_max, axis_x, axis_y,
        )?;
        if axis_hit.entry > *entry {
            *entry = axis_hit.entry;
            *normal_x = axis_hit.normal_x;
            *normal_y = axis_hit.normal_y;
        }
        *exit = (*exit).min(axis_hit.exit);
        if *entry > *exit || *exit < 0.0 || *entry > motion.max_distance {
            return None;
        }
    }
    Some(())
}

fn shape_cast_aabb_oriented_box(
    reference: Transform2D,
    bounds: AabbBounds,
    motion: ShapeCastMotion,
    target: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    let (half_width, half_height) = query_aabb_half_extents(bounds);
    let moving = oriented_box_geometry(reference, half_width, half_height, 0.0)?;
    shape_cast_oriented_box_oriented_box(moving, motion, target)
}

fn shape_cast_circle_oriented_box(
    center: Transform2D,
    radius: f32,
    motion: ShapeCastMotion,
    target: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) {
        return None;
    }

    let local_center = oriented_box_local_point(target, center);
    let (local_unit_x, local_unit_y) =
        oriented_box_local_vector(target, motion.unit_x, motion.unit_y);
    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        target.half_width,
        target.half_height,
    )?;
    let local_hit = raycast_bounds(
        local_center,
        local_unit_x,
        local_unit_y,
        motion.max_distance,
        inflate_bounds(local_bounds, radius, radius),
    )?;
    Some(oriented_box_world_hit(target, local_hit))
}

fn shape_cast_oriented_box_oriented_box(
    moving: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    target: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    let local_center = oriented_box_local_point(target, moving.center);
    let (local_axis_x_x, local_axis_x_y) =
        oriented_box_local_vector(target, moving.axis_x_x, moving.axis_x_y);
    let local_moving = oriented_box_geometry(
        local_center,
        moving.half_width,
        moving.half_height,
        local_axis_x_y.atan2(local_axis_x_x),
    )?;
    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        target.half_width,
        target.half_height,
    )?;
    let local_hit = shape_cast_oriented_box_aabb(
        local_moving,
        oriented_box_local_motion(target, motion),
        local_bounds,
    )?;
    Some(oriented_box_world_hit(target, local_hit))
}

fn shape_cast_capsule_oriented_box(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    motion: ShapeCastMotion,
    target: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) {
        return None;
    }

    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        target.half_width,
        target.half_height,
    )?;
    let local_motion = oriented_box_local_motion(target, motion);
    let local_hit = shape_cast_capsule_aabb(
        oriented_box_local_point(target, start),
        oriented_box_local_point(target, end),
        radius,
        local_motion.unit_x,
        local_motion.unit_y,
        motion.max_distance,
        local_bounds,
    )?;
    Some(oriented_box_world_hit(target, local_hit))
}

fn shape_cast_oriented_box_aabb(
    oriented_box: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    bounds: AabbBounds,
) -> Option<RaycastBoundsHit> {
    let mut entry = 0.0;
    let mut exit = motion.max_distance;
    let mut normal_x = 0.0;
    let mut normal_y = 0.0;

    for axis in [
        (oriented_box.axis_x_x, oriented_box.axis_x_y),
        (oriented_box.axis_y_x, oriented_box.axis_y_y),
        (1.0, 0.0),
        (0.0, 1.0),
    ] {
        let moving_center = oriented_box.center.x * axis.0 + oriented_box.center.y * axis.1;
        let moving_radius = oriented_box_projection_radius(oriented_box, axis.0, axis.1);
        let (target_min, target_max) = project_aabb_onto_axis(bounds, axis.0, axis.1);
        let velocity = motion.unit_x * axis.0 + motion.unit_y * axis.1;
        let axis_hit = moving_axis_entry_exit(
            moving_center - moving_radius,
            moving_center + moving_radius,
            velocity,
            target_min,
            target_max,
            axis.0,
            axis.1,
        )?;
        if axis_hit.entry > entry {
            entry = axis_hit.entry;
            normal_x = axis_hit.normal_x;
            normal_y = axis_hit.normal_y;
        }
        exit = exit.min(axis_hit.exit);
        if entry > exit || exit < 0.0 || entry > motion.max_distance {
            return None;
        }
    }

    Some(RaycastBoundsHit {
        distance: entry.max(0.0),
        normal_x,
        normal_y,
    })
}

fn shape_cast_oriented_box_circle(
    oriented_box: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    circle_center: Transform2D,
    circle_radius: f32,
) -> Option<RaycastBoundsHit> {
    let dx = circle_center.x - oriented_box.center.x;
    let dy = circle_center.y - oriented_box.center.y;
    let local_circle_center = Transform2D {
        x: dx * oriented_box.axis_x_x + dy * oriented_box.axis_x_y,
        y: dx * oriented_box.axis_y_x + dy * oriented_box.axis_y_y,
    };
    let local_unit_x =
        motion.unit_x * oriented_box.axis_x_x + motion.unit_y * oriented_box.axis_x_y;
    let local_unit_y =
        motion.unit_x * oriented_box.axis_y_x + motion.unit_y * oriented_box.axis_y_y;
    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    )?;
    let local_hit = shape_cast_aabb_circle(
        Transform2D { x: 0.0, y: 0.0 },
        local_bounds,
        local_unit_x,
        local_unit_y,
        motion.max_distance,
        local_circle_center,
        circle_radius,
    )?;

    Some(RaycastBoundsHit {
        distance: local_hit.distance,
        normal_x: local_hit.normal_x * oriented_box.axis_x_x
            + local_hit.normal_y * oriented_box.axis_y_x,
        normal_y: local_hit.normal_x * oriented_box.axis_x_y
            + local_hit.normal_y * oriented_box.axis_y_y,
    })
}

fn shape_cast_capsule_aabb(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    bounds: AabbBounds,
) -> Option<RaycastBoundsHit> {
    let mut best = None;
    let vertical_strip = AabbBounds {
        min_x: bounds.min_x - radius,
        min_y: bounds.min_y,
        max_x: bounds.max_x + radius,
        max_y: bounds.max_y,
    };
    update_nearest_hit(
        &mut best,
        shape_cast_moving_segment_aabb(start, end, unit_x, unit_y, max_distance, vertical_strip),
    );

    let horizontal_strip = AabbBounds {
        min_x: bounds.min_x,
        min_y: bounds.min_y - radius,
        max_x: bounds.max_x,
        max_y: bounds.max_y + radius,
    };
    update_nearest_hit(
        &mut best,
        shape_cast_moving_segment_aabb(start, end, unit_x, unit_y, max_distance, horizontal_strip),
    );

    for corner in aabb_corners(bounds) {
        update_nearest_hit(
            &mut best,
            shape_cast_moving_segment_circle(
                start,
                end,
                unit_x,
                unit_y,
                max_distance,
                corner,
                radius,
            ),
        );
    }
    best
}

fn shape_cast_aabb_capsule(
    reference: Transform2D,
    bounds: AabbBounds,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(capsule_radius) {
        return None;
    }

    let mut best = None;
    update_nearest_hit(
        &mut best,
        shape_cast_aabb_circle(
            reference,
            bounds,
            motion.unit_x,
            motion.unit_y,
            motion.max_distance,
            capsule_start,
            capsule_radius,
        ),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_aabb_circle(
            reference,
            bounds,
            motion.unit_x,
            motion.unit_y,
            motion.max_distance,
            capsule_end,
            capsule_radius,
        ),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_aabb_capsule_side(
            reference,
            bounds,
            motion,
            capsule_start,
            capsule_end,
            capsule_radius,
        ),
    );
    best
}

fn shape_cast_circle_capsule(
    center: Transform2D,
    circle_radius: f32,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(circle_radius) || !is_valid_radius(capsule_radius) {
        return None;
    }
    raycast_capsule(
        center,
        motion.unit_x,
        motion.unit_y,
        motion.max_distance,
        capsule_start,
        capsule_end,
        circle_radius + capsule_radius,
    )
}

fn shape_cast_oriented_box_capsule(
    oriented_box: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(capsule_radius) {
        return None;
    }

    let mut best = None;
    update_nearest_hit(
        &mut best,
        shape_cast_oriented_box_circle(oriented_box, motion, capsule_start, capsule_radius),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_oriented_box_circle(oriented_box, motion, capsule_end, capsule_radius),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_oriented_box_capsule_side(
            oriented_box,
            motion,
            capsule_start,
            capsule_end,
            capsule_radius,
        ),
    );
    best
}

fn shape_cast_capsule_capsule(
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    motion: ShapeCastMotion,
    target_start: Transform2D,
    target_end: Transform2D,
    target_radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) || !is_valid_radius(target_radius) {
        return None;
    }

    let radius_sum = radius + target_radius;
    let mut best = None;
    update_nearest_hit(
        &mut best,
        shape_cast_moving_segment_circle(
            start,
            end,
            motion.unit_x,
            motion.unit_y,
            motion.max_distance,
            target_start,
            radius_sum,
        ),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_moving_segment_circle(
            start,
            end,
            motion.unit_x,
            motion.unit_y,
            motion.max_distance,
            target_end,
            radius_sum,
        ),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_moving_segment_capsule_side(
            start,
            end,
            motion,
            target_start,
            target_end,
            radius_sum,
        ),
    );
    best
}

fn shape_cast_aabb_capsule_side(
    reference: Transform2D,
    bounds: AabbBounds,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
) -> Option<RaycastBoundsHit> {
    let frame = segment_frame(capsule_start, capsule_end)?;
    let (half_width, half_height) = query_aabb_half_extents(bounds);
    let local_oriented_box = oriented_box_geometry(
        segment_frame_local_point(frame, reference),
        half_width,
        half_height,
        (-frame.axis_y).atan2(frame.axis_x),
    )?;
    let local_hit = shape_cast_oriented_box_aabb(
        local_oriented_box,
        segment_frame_local_motion(frame, motion),
        capsule_side_bounds(frame.length, capsule_radius),
    )?;
    Some(segment_frame_world_hit(frame, local_hit))
}

fn shape_cast_oriented_box_capsule_side(
    oriented_box: OrientedBoxGeometry,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    capsule_radius: f32,
) -> Option<RaycastBoundsHit> {
    let frame = segment_frame(capsule_start, capsule_end)?;
    let local_axis_x_x =
        oriented_box.axis_x_x * frame.axis_x + oriented_box.axis_x_y * frame.axis_y;
    let local_axis_x_y =
        oriented_box.axis_x_x * frame.normal_x + oriented_box.axis_x_y * frame.normal_y;
    let local_oriented_box = oriented_box_geometry(
        segment_frame_local_point(frame, oriented_box.center),
        oriented_box.half_width,
        oriented_box.half_height,
        local_axis_x_y.atan2(local_axis_x_x),
    )?;
    let local_hit = shape_cast_oriented_box_aabb(
        local_oriented_box,
        segment_frame_local_motion(frame, motion),
        capsule_side_bounds(frame.length, capsule_radius),
    )?;
    Some(segment_frame_world_hit(frame, local_hit))
}

fn shape_cast_moving_segment_capsule_side(
    start: Transform2D,
    end: Transform2D,
    motion: ShapeCastMotion,
    capsule_start: Transform2D,
    capsule_end: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    let frame = segment_frame(capsule_start, capsule_end)?;
    let local_start = segment_frame_local_point(frame, start);
    let local_end = segment_frame_local_point(frame, end);
    let local_motion = segment_frame_local_motion(frame, motion);
    let local_hit = shape_cast_moving_segment_aabb(
        local_start,
        local_end,
        local_motion.unit_x,
        local_motion.unit_y,
        local_motion.max_distance,
        capsule_side_bounds(frame.length, radius),
    )?;
    Some(segment_frame_world_hit(frame, local_hit))
}

fn shape_cast_moving_segment_aabb(
    start: Transform2D,
    end: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    bounds: AabbBounds,
) -> Option<RaycastBoundsHit> {
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let segment_length = (segment_x * segment_x + segment_y * segment_y).sqrt();
    if segment_length <= RAY_EPSILON {
        return raycast_bounds(start, unit_x, unit_y, max_distance, bounds);
    }

    let axis_x = -segment_y / segment_length;
    let axis_y = segment_x / segment_length;
    let mut entry = 0.0;
    let mut exit = max_distance;
    let mut normal_x = 0.0;
    let mut normal_y = 0.0;

    for axis in [(1.0, 0.0), (0.0, 1.0), (axis_x, axis_y)] {
        let segment_a = start.x * axis.0 + start.y * axis.1;
        let segment_b = end.x * axis.0 + end.y * axis.1;
        let segment_min = segment_a.min(segment_b);
        let segment_max = segment_a.max(segment_b);
        let (bounds_min, bounds_max) = project_aabb_onto_axis(bounds, axis.0, axis.1);
        let velocity = unit_x * axis.0 + unit_y * axis.1;
        let axis_hit = moving_axis_entry_exit(
            segment_min,
            segment_max,
            velocity,
            bounds_min,
            bounds_max,
            axis.0,
            axis.1,
        )?;
        if axis_hit.entry > entry {
            entry = axis_hit.entry;
            normal_x = axis_hit.normal_x;
            normal_y = axis_hit.normal_y;
        }
        exit = exit.min(axis_hit.exit);
        if entry > exit || exit < 0.0 || entry > max_distance {
            return None;
        }
    }

    Some(RaycastBoundsHit {
        distance: entry.max(0.0),
        normal_x,
        normal_y,
    })
}

fn shape_cast_moving_segment_circle(
    start: Transform2D,
    end: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    circle_center: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) {
        return None;
    }
    let mut best = None;
    update_nearest_hit(
        &mut best,
        raycast_circle(start, unit_x, unit_y, max_distance, circle_center, radius),
    );
    update_nearest_hit(
        &mut best,
        raycast_circle(end, unit_x, unit_y, max_distance, circle_center, radius),
    );
    update_nearest_hit(
        &mut best,
        shape_cast_segment_side_circle(
            start,
            end,
            unit_x,
            unit_y,
            max_distance,
            circle_center,
            radius,
        ),
    );
    best
}

fn shape_cast_segment_side_circle(
    start: Transform2D,
    end: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    circle_center: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let segment_length = (segment_x * segment_x + segment_y * segment_y).sqrt();
    if segment_length <= RAY_EPSILON {
        return None;
    }

    let axis_x = segment_x / segment_length;
    let axis_y = segment_y / segment_length;
    let normal_axis_x = -axis_y;
    let normal_axis_y = axis_x;
    let center_x = circle_center.x - start.x;
    let center_y = circle_center.y - start.y;
    let segment_projection = center_x * axis_x + center_y * axis_y;
    let segment_projection_delta = -(unit_x * axis_x + unit_y * axis_y);
    let normal_projection = center_x * normal_axis_x + center_y * normal_axis_y;
    let normal_projection_delta = -(unit_x * normal_axis_x + unit_y * normal_axis_y);

    let mut entry = 0.0;
    let mut exit = max_distance;
    intersect_value_interval(
        &mut entry,
        &mut exit,
        segment_projection,
        segment_projection_delta,
        0.0,
        segment_length,
    )?;
    intersect_value_interval(
        &mut entry,
        &mut exit,
        normal_projection,
        normal_projection_delta,
        -radius,
        radius,
    )?;
    if entry > max_distance || exit < 0.0 {
        return None;
    }

    let distance = entry.max(0.0);
    let normal_projection_at_hit = normal_projection + normal_projection_delta * distance;
    let (normal_x, normal_y) = if normal_projection_at_hit.abs() > RAY_EPSILON {
        let scale = -normal_projection_at_hit.signum();
        (normal_axis_x * scale, normal_axis_y * scale)
    } else {
        (-unit_x, -unit_y)
    };
    Some(RaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}

fn project_aabb_onto_axis(bounds: AabbBounds, axis_x: f32, axis_y: f32) -> (f32, f32) {
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    for corner in aabb_corners(bounds) {
        let projection = corner.x * axis_x + corner.y * axis_y;
        min = min.min(projection);
        max = max.max(projection);
    }
    (min, max)
}

fn moving_axis_entry_exit(
    moving_min: f32,
    moving_max: f32,
    velocity: f32,
    target_min: f32,
    target_max: f32,
    axis_x: f32,
    axis_y: f32,
) -> Option<MovingAxisEntryExit> {
    if velocity.abs() <= RAY_EPSILON {
        return (moving_max >= target_min && moving_min <= target_max).then_some(
            MovingAxisEntryExit {
                entry: f32::NEG_INFINITY,
                exit: f32::INFINITY,
                normal_x: 0.0,
                normal_y: 0.0,
            },
        );
    }

    if velocity > 0.0 {
        Some(MovingAxisEntryExit {
            entry: (target_min - moving_max) / velocity,
            exit: (target_max - moving_min) / velocity,
            normal_x: -axis_x,
            normal_y: -axis_y,
        })
    } else {
        Some(MovingAxisEntryExit {
            entry: (target_max - moving_min) / velocity,
            exit: (target_min - moving_max) / velocity,
            normal_x: axis_x,
            normal_y: axis_y,
        })
    }
}

fn intersect_value_interval(
    entry: &mut f32,
    exit: &mut f32,
    value: f32,
    delta: f32,
    min: f32,
    max: f32,
) -> Option<()> {
    if delta.abs() <= RAY_EPSILON {
        return (value >= min && value <= max).then_some(());
    }

    let t1 = (min - value) / delta;
    let t2 = (max - value) / delta;
    *entry = entry.max(t1.min(t2));
    *exit = exit.min(t1.max(t2));
    (*entry <= *exit).then_some(())
}

fn segment_frame(start: Transform2D, end: Transform2D) -> Option<SegmentFrame> {
    if !start.x.is_finite() || !start.y.is_finite() || !end.x.is_finite() || !end.y.is_finite() {
        return None;
    }
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let length = (segment_x * segment_x + segment_y * segment_y).sqrt();
    if length <= RAY_EPSILON {
        return None;
    }

    let axis_x = segment_x / length;
    let axis_y = segment_y / length;
    Some(SegmentFrame {
        origin: start,
        axis_x,
        axis_y,
        normal_x: -axis_y,
        normal_y: axis_x,
        length,
    })
}

fn segment_frame_local_point(frame: SegmentFrame, point: Transform2D) -> Transform2D {
    let dx = point.x - frame.origin.x;
    let dy = point.y - frame.origin.y;
    Transform2D {
        x: dx * frame.axis_x + dy * frame.axis_y,
        y: dx * frame.normal_x + dy * frame.normal_y,
    }
}

fn segment_frame_local_motion(frame: SegmentFrame, motion: ShapeCastMotion) -> ShapeCastMotion {
    ShapeCastMotion {
        unit_x: motion.unit_x * frame.axis_x + motion.unit_y * frame.axis_y,
        unit_y: motion.unit_x * frame.normal_x + motion.unit_y * frame.normal_y,
        max_distance: motion.max_distance,
    }
}

fn segment_frame_world_hit(frame: SegmentFrame, hit: RaycastBoundsHit) -> RaycastBoundsHit {
    RaycastBoundsHit {
        distance: hit.distance,
        normal_x: hit.normal_x * frame.axis_x + hit.normal_y * frame.normal_x,
        normal_y: hit.normal_x * frame.axis_y + hit.normal_y * frame.normal_y,
    }
}

fn capsule_side_bounds(length: f32, radius: f32) -> AabbBounds {
    AabbBounds {
        min_x: 0.0,
        min_y: -radius,
        max_x: length,
        max_y: radius,
    }
}

fn shape_cast_aabb_circle(
    reference: Transform2D,
    bounds: AabbBounds,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    circle_center: Transform2D,
    circle_radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(circle_radius) {
        return None;
    }
    let (half_width, half_height) = query_aabb_half_extents(bounds);
    let mut best: Option<RaycastBoundsHit> = None;

    let vertical_strip = AabbBounds {
        min_x: circle_center.x - half_width - circle_radius,
        min_y: circle_center.y - half_height,
        max_x: circle_center.x + half_width + circle_radius,
        max_y: circle_center.y + half_height,
    };
    update_nearest_hit(
        &mut best,
        raycast_bounds(reference, unit_x, unit_y, max_distance, vertical_strip),
    );

    let horizontal_strip = AabbBounds {
        min_x: circle_center.x - half_width,
        min_y: circle_center.y - half_height - circle_radius,
        max_x: circle_center.x + half_width,
        max_y: circle_center.y + half_height + circle_radius,
    };
    update_nearest_hit(
        &mut best,
        raycast_bounds(reference, unit_x, unit_y, max_distance, horizontal_strip),
    );

    for corner_x in [circle_center.x - half_width, circle_center.x + half_width] {
        for corner_y in [circle_center.y - half_height, circle_center.y + half_height] {
            update_nearest_hit(
                &mut best,
                raycast_circle(
                    reference,
                    unit_x,
                    unit_y,
                    max_distance,
                    Transform2D {
                        x: corner_x,
                        y: corner_y,
                    },
                    circle_radius,
                ),
            );
        }
    }

    best
}

fn inflate_bounds(bounds: AabbBounds, x: f32, y: f32) -> AabbBounds {
    AabbBounds {
        min_x: bounds.min_x - x,
        min_y: bounds.min_y - y,
        max_x: bounds.max_x + x,
        max_y: bounds.max_y + y,
    }
}

fn update_nearest_hit(best: &mut Option<RaycastBoundsHit>, next: Option<RaycastBoundsHit>) {
    let Some(next) = next else {
        return;
    };
    if best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| next.normal_x.total_cmp(&current.normal_x))
            .then_with(|| next.normal_y.total_cmp(&current.normal_y))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

fn raycast_bounds(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    bounds: AabbBounds,
) -> Option<RaycastBoundsHit> {
    if bounds.contains_point(origin) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let x = ray_axis_entry_exit(origin.x, unit_x, bounds.min_x, bounds.max_x)?;
    let y = ray_axis_entry_exit(origin.y, unit_y, bounds.min_y, bounds.max_y)?;
    let entry = x.entry.max(y.entry);
    let exit = x.exit.min(y.exit);
    if entry > exit || exit < 0.0 || entry > max_distance {
        return None;
    }

    let distance = entry.max(0.0);
    let (normal_x, normal_y) = if x.entry > y.entry {
        (x.normal, 0.0)
    } else if y.entry > x.entry {
        (0.0, y.normal)
    } else if unit_x.abs() >= unit_y.abs() {
        (x.normal, 0.0)
    } else {
        (0.0, y.normal)
    };

    Some(RaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}

fn raycast_oriented_box(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    oriented_box: OrientedBoxGeometry,
) -> Option<RaycastBoundsHit> {
    let local_origin = oriented_box_local_point(oriented_box, origin);
    let local_unit_x = unit_x * oriented_box.axis_x_x + unit_y * oriented_box.axis_x_y;
    let local_unit_y = unit_x * oriented_box.axis_y_x + unit_y * oriented_box.axis_y_y;
    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    )?;
    let hit = raycast_bounds(
        local_origin,
        local_unit_x,
        local_unit_y,
        max_distance,
        local_bounds,
    )?;
    Some(RaycastBoundsHit {
        distance: hit.distance,
        normal_x: hit.normal_x * oriented_box.axis_x_x + hit.normal_y * oriented_box.axis_y_x,
        normal_y: hit.normal_x * oriented_box.axis_x_y + hit.normal_y * oriented_box.axis_y_y,
    })
}

fn raycast_circle(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    center: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius) {
        return None;
    }
    if circle_contains_point(center, radius, origin) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let origin_to_center_x = origin.x - center.x;
    let origin_to_center_y = origin.y - center.y;
    let projection = origin_to_center_x * unit_x + origin_to_center_y * unit_y;
    let center_distance_squared =
        origin_to_center_x * origin_to_center_x + origin_to_center_y * origin_to_center_y;
    let discriminant = projection * projection - center_distance_squared + radius * radius;
    if discriminant < 0.0 {
        return None;
    }

    let distance = -projection - discriminant.sqrt();
    if distance < 0.0 || distance > max_distance {
        return None;
    }
    let point_x = origin.x + unit_x * distance;
    let point_y = origin.y + unit_y * distance;
    let normal_x = (point_x - center.x) / radius;
    let normal_y = (point_y - center.y) / radius;
    Some(RaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}

fn raycast_capsule(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    if !is_valid_radius(radius)
        || !origin.x.is_finite()
        || !origin.y.is_finite()
        || !start.x.is_finite()
        || !start.y.is_finite()
        || !end.x.is_finite()
        || !end.y.is_finite()
    {
        return None;
    }
    if point_segment_distance_squared(origin, start, end) <= radius * radius {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let mut best = None;
    update_nearest_hit(
        &mut best,
        raycast_circle(origin, unit_x, unit_y, max_distance, start, radius),
    );
    update_nearest_hit(
        &mut best,
        raycast_circle(origin, unit_x, unit_y, max_distance, end, radius),
    );
    update_nearest_hit(
        &mut best,
        raycast_capsule_side(origin, unit_x, unit_y, max_distance, start, end, radius),
    );
    best
}

fn raycast_edge(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    start: Transform2D,
    end: Transform2D,
) -> Option<RaycastBoundsHit> {
    if !origin.x.is_finite()
        || !origin.y.is_finite()
        || !unit_x.is_finite()
        || !unit_y.is_finite()
        || !max_distance.is_finite()
        || max_distance < 0.0
        || !start.x.is_finite()
        || !start.y.is_finite()
        || !end.x.is_finite()
        || !end.y.is_finite()
    {
        return None;
    }
    if point_segment_distance_squared(origin, start, end)
        <= EDGE_COLLIDER_RADIUS * EDGE_COLLIDER_RADIUS
    {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let edge_x = end.x - start.x;
    let edge_y = end.y - start.y;
    let edge_length = (edge_x * edge_x + edge_y * edge_y).sqrt();
    if edge_length <= RAY_EPSILON {
        return None;
    }

    let denominator = unit_x * edge_y - unit_y * edge_x;
    if denominator.abs() <= RAY_EPSILON {
        return None;
    }

    let origin_to_start_x = start.x - origin.x;
    let origin_to_start_y = start.y - origin.y;
    let distance = (origin_to_start_x * edge_y - origin_to_start_y * edge_x) / denominator;
    let edge_fraction = (origin_to_start_x * unit_y - origin_to_start_y * unit_x) / denominator;
    if distance < 0.0
        || distance > max_distance
        || !(-RAY_EPSILON..=1.0 + RAY_EPSILON).contains(&edge_fraction)
    {
        return None;
    }

    let mut normal_x = edge_y / edge_length;
    let mut normal_y = -edge_x / edge_length;
    if normal_x * unit_x + normal_y * unit_y > 0.0 {
        normal_x = -normal_x;
        normal_y = -normal_y;
    }
    Some(RaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}

fn raycast_convex_polygon(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    vertices: &[Transform2D],
) -> Option<RaycastBoundsHit> {
    if !origin.x.is_finite()
        || !origin.y.is_finite()
        || !unit_x.is_finite()
        || !unit_y.is_finite()
        || !max_distance.is_finite()
        || max_distance < 0.0
        || !convex_polygon_is_valid(vertices)
    {
        return None;
    }
    if convex_polygon_contains_point(vertices, origin) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let is_ccw = convex_polygon_signed_area(vertices) > 0.0;
    let mut best = None;
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        let edge_x = end.x - start.x;
        let edge_y = end.y - start.y;
        let denominator = unit_x * edge_y - unit_y * edge_x;
        if denominator.abs() <= RAY_EPSILON {
            continue;
        }

        let origin_to_start_x = start.x - origin.x;
        let origin_to_start_y = start.y - origin.y;
        let distance = (origin_to_start_x * edge_y - origin_to_start_y * edge_x) / denominator;
        let edge_fraction = (origin_to_start_x * unit_y - origin_to_start_y * unit_x) / denominator;
        if distance < 0.0
            || distance > max_distance
            || !(-RAY_EPSILON..=1.0 + RAY_EPSILON).contains(&edge_fraction)
        {
            continue;
        }

        let edge_length = (edge_x * edge_x + edge_y * edge_y).sqrt();
        if edge_length <= RAY_EPSILON {
            continue;
        }
        let (mut normal_x, mut normal_y) = if is_ccw {
            (edge_y / edge_length, -edge_x / edge_length)
        } else {
            (-edge_y / edge_length, edge_x / edge_length)
        };
        if normal_x * unit_x + normal_y * unit_y > 0.0 {
            normal_x = -normal_x;
            normal_y = -normal_y;
        }
        update_nearest_hit(
            &mut best,
            Some(RaycastBoundsHit {
                distance,
                normal_x,
                normal_y,
            }),
        );
    }

    best
}

fn convex_polygon_signed_area(vertices: &[Transform2D]) -> f32 {
    let mut area = 0.0;
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        area += start.x * end.y - start.y * end.x;
    }
    area * 0.5
}

fn raycast_capsule_side(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<RaycastBoundsHit> {
    let segment_x = end.x - start.x;
    let segment_y = end.y - start.y;
    let segment_length = (segment_x * segment_x + segment_y * segment_y).sqrt();
    if segment_length <= RAY_EPSILON {
        return None;
    }

    let axis_x = segment_x / segment_length;
    let axis_y = segment_y / segment_length;
    let normal_axis_x = -axis_y;
    let normal_axis_y = axis_x;
    let origin_x = origin.x - start.x;
    let origin_y = origin.y - start.y;
    let segment_projection = origin_x * axis_x + origin_y * axis_y;
    let segment_projection_delta = unit_x * axis_x + unit_y * axis_y;
    let normal_projection = origin_x * normal_axis_x + origin_y * normal_axis_y;
    let normal_projection_delta = unit_x * normal_axis_x + unit_y * normal_axis_y;

    let mut entry = 0.0;
    let mut exit = max_distance;
    intersect_value_interval(
        &mut entry,
        &mut exit,
        segment_projection,
        segment_projection_delta,
        0.0,
        segment_length,
    )?;
    intersect_value_interval(
        &mut entry,
        &mut exit,
        normal_projection,
        normal_projection_delta,
        -radius,
        radius,
    )?;
    if entry > max_distance || exit < 0.0 {
        return None;
    }

    let distance = entry.max(0.0);
    let normal_projection_at_hit = normal_projection + normal_projection_delta * distance;
    let (normal_x, normal_y) = if normal_projection_at_hit.abs() > RAY_EPSILON {
        let scale = normal_projection_at_hit.signum();
        (normal_axis_x * scale, normal_axis_y * scale)
    } else {
        (-unit_x, -unit_y)
    };
    Some(RaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}

fn ray_axis_entry_exit(start: f32, direction: f32, min: f32, max: f32) -> Option<AxisEntryExit> {
    if direction.abs() <= RAY_EPSILON {
        return (start >= min && start <= max).then_some(AxisEntryExit {
            entry: f32::NEG_INFINITY,
            exit: f32::INFINITY,
            normal: 0.0,
        });
    }
    let t1 = (min - start) / direction;
    let t2 = (max - start) / direction;
    if t1 <= t2 {
        Some(AxisEntryExit {
            entry: t1,
            exit: t2,
            normal: -1.0,
        })
    } else {
        Some(AxisEntryExit {
            entry: t2,
            exit: t1,
            normal: 1.0,
        })
    }
}

fn normalized_direction(direction: Velocity) -> Option<(f32, f32)> {
    if !direction.vx.is_finite() || !direction.vy.is_finite() {
        return None;
    }
    let length = (direction.vx * direction.vx + direction.vy * direction.vy).sqrt();
    if length <= RAY_EPSILON {
        None
    } else {
        Some((direction.vx / length, direction.vy / length))
    }
}

fn segment_direction_and_distance(start: Transform2D, end: Transform2D) -> Option<(Velocity, f32)> {
    if !start.x.is_finite() || !start.y.is_finite() || !end.x.is_finite() || !end.y.is_finite() {
        return None;
    }
    let direction = Velocity {
        vx: end.x - start.x,
        vy: end.y - start.y,
    };
    let max_distance = (direction.vx * direction.vx + direction.vy * direction.vy).sqrt();
    (max_distance > RAY_EPSILON).then_some((direction, max_distance))
}

fn axis_entry_exit(start: f32, delta: f32, min: f32, max: f32) -> Option<AxisEntryExit> {
    if delta.abs() <= SWEPT_EPSILON {
        return (start >= min && start <= max).then_some(AxisEntryExit {
            entry: f32::NEG_INFINITY,
            exit: f32::INFINITY,
            normal: 0.0,
        });
    }
    let t1 = (min - start) / delta;
    let t2 = (max - start) / delta;
    if t1 <= t2 {
        Some(AxisEntryExit {
            entry: t1,
            exit: t2,
            normal: 1.0,
        })
    } else {
        Some(AxisEntryExit {
            entry: t2,
            exit: t1,
            normal: -1.0,
        })
    }
}

fn is_valid_delta(delta: f32) -> bool {
    delta.is_finite() && delta > 0.0
}

fn query_shape_is_valid(shape: CollisionQueryShape) -> bool {
    match shape {
        CollisionQueryShape::Aabb(bounds) => {
            bounds.min_x.is_finite()
                && bounds.min_y.is_finite()
                && bounds.max_x.is_finite()
                && bounds.max_y.is_finite()
                && bounds.min_x <= bounds.max_x
                && bounds.min_y <= bounds.max_y
        }
        CollisionQueryShape::Circle { center, radius } => {
            center.x.is_finite() && center.y.is_finite() && is_valid_radius(radius)
        }
        CollisionQueryShape::OrientedBox {
            center,
            half_width,
            half_height,
            rotation_radians,
        } => {
            center.x.is_finite()
                && center.y.is_finite()
                && is_valid_half_extent(half_width)
                && is_valid_half_extent(half_height)
                && rotation_radians.is_finite()
        }
        CollisionQueryShape::Capsule { start, end, radius } => {
            start.x.is_finite()
                && start.y.is_finite()
                && end.x.is_finite()
                && end.y.is_finite()
                && is_valid_radius(radius)
        }
        CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count,
        } => convex_polygon_vertices(&vertices, vertex_count)
            .map(convex_polygon_is_valid)
            .unwrap_or(false),
    }
}

fn is_valid_debug_line_length(length: f32) -> bool {
    length.is_finite() && length > 0.0
}

fn is_valid_radius(radius: f32) -> bool {
    radius.is_finite() && radius > 0.0
}

fn capsule_collider_is_valid(collider: CapsuleCollider) -> bool {
    collider.start_x.is_finite()
        && collider.start_y.is_finite()
        && collider.end_x.is_finite()
        && collider.end_y.is_finite()
        && collider.offset_x.is_finite()
        && collider.offset_y.is_finite()
        && is_valid_radius(collider.radius)
}

fn edge_collider_is_valid(collider: EdgeCollider) -> bool {
    if !collider.start_x.is_finite()
        || !collider.start_y.is_finite()
        || !collider.end_x.is_finite()
        || !collider.end_y.is_finite()
        || !collider.offset_x.is_finite()
        || !collider.offset_y.is_finite()
    {
        return false;
    }

    let dx = collider.end_x - collider.start_x;
    let dy = collider.end_y - collider.start_y;
    dx * dx + dy * dy > RAY_EPSILON * RAY_EPSILON
}

fn convex_polygon_collider_is_valid(collider: ConvexPolygonCollider) -> bool {
    collider.offset_x.is_finite()
        && collider.offset_y.is_finite()
        && collider.rotation_radians.is_finite()
        && convex_polygon_vertices(&collider.vertices, collider.vertex_count)
            .map(convex_polygon_is_valid)
            .unwrap_or(false)
}

fn is_valid_half_extent(half_extent: f32) -> bool {
    half_extent.is_finite() && half_extent > 0.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{
        CapsuleCollider, CircleCollider, CollisionFilter, CollisionLayer, CollisionMask,
        CompoundCollider, CompoundColliderShape, ConvexPolygonCollider, EdgeCollider,
        OrientedBoxCollider,
    };

    fn collider(half_width: f32, half_height: f32) -> AabbCollider {
        AabbCollider {
            half_width,
            half_height,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: true,
            layer: CollisionLayer::Enemy,
        }
    }

    fn circle(radius: f32) -> CircleCollider {
        CircleCollider {
            radius,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: true,
            layer: CollisionLayer::Enemy,
        }
    }

    fn capsule(start_x: f32, start_y: f32, end_x: f32, end_y: f32, radius: f32) -> CapsuleCollider {
        CapsuleCollider::new(
            start_x,
            start_y,
            end_x,
            end_y,
            radius,
            true,
            CollisionLayer::Enemy,
        )
    }

    fn edge(start_x: f32, start_y: f32, end_x: f32, end_y: f32) -> EdgeCollider {
        EdgeCollider::new(start_x, start_y, end_x, end_y, true, CollisionLayer::Enemy)
    }

    fn oriented_box(
        half_width: f32,
        half_height: f32,
        rotation_radians: f32,
    ) -> OrientedBoxCollider {
        OrientedBoxCollider::new(
            half_width,
            half_height,
            rotation_radians,
            true,
            CollisionLayer::Enemy,
        )
    }

    fn convex_polygon(points: &[(f32, f32)]) -> CollisionQueryShape {
        let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
        for (index, (x, y)) in points.iter().copied().enumerate() {
            vertices[index] = Transform2D { x, y };
        }
        CollisionQueryShape::ConvexPolygon {
            vertices,
            vertex_count: points.len() as u32,
        }
    }

    fn convex_polygon_collider(points: &[(f32, f32)]) -> ConvexPolygonCollider {
        let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
        for (index, (x, y)) in points.iter().copied().enumerate() {
            vertices[index] = Transform2D { x, y };
        }
        ConvexPolygonCollider::new(vertices, points.len() as u32, true, CollisionLayer::Enemy)
    }

    #[test]
    fn overlapping_aabbs_are_detected() {
        let a = Transform2D { x: 10.0, y: 10.0 };
        let b = Transform2D { x: 18.0, y: 10.0 };

        assert!(CollisionSystem::overlaps(
            a,
            collider(5.0, 5.0),
            b,
            collider(5.0, 5.0),
        ));
    }

    #[test]
    fn separated_aabbs_are_not_detected() {
        let a = Transform2D { x: 10.0, y: 10.0 };
        let b = Transform2D { x: 30.1, y: 10.0 };

        assert!(!CollisionSystem::overlaps(
            a,
            collider(10.0, 10.0),
            b,
            collider(10.0, 10.0),
        ));
    }

    #[test]
    fn aabb_bounds_from_transform_respects_collider_offset() {
        let bounds = AabbBounds::from_transform(
            Transform2D { x: 10.0, y: 20.0 },
            collider(3.0, 4.0).with_offset(5.0, -2.0),
        );

        assert_eq!(bounds.min_x, 12.0);
        assert_eq!(bounds.max_x, 18.0);
        assert_eq!(bounds.min_y, 14.0);
        assert_eq!(bounds.max_y, 22.0);
    }

    #[test]
    fn build_pairs_returns_overlapping_entities() {
        let mut world = World::default();
        let first = world.spawn_enemy(10.0, 10.0, 0);
        let second = world.spawn_enemy(18.0, 10.0, 0);
        world.spawn_enemy(80.0, 80.0, 0);

        let pairs = CollisionSystem::build_pairs(&world);

        assert_eq!(pairs.len(), 1);
        assert_eq!(
            pairs[0],
            CollisionPair {
                a: first,
                b: second
            }
        );
    }

    #[test]
    fn build_layer_pairs_orients_requested_layers() {
        let mut world = World::default();
        let player = world.spawn_player(10.0, 10.0, 0);
        let enemy = world.spawn_enemy(12.0, 10.0, 0);

        let pairs = CollisionSystem::build_layer_pairs(
            &world,
            CollisionLayer::Player,
            CollisionLayer::Enemy,
        );

        assert_eq!(
            pairs,
            vec![CollisionPair {
                a: player,
                b: enemy
            }]
        );
    }

    #[test]
    fn collision_filters_can_exclude_existing_layer_pairs() {
        let mut world = World::default();
        let player = world.spawn_player(10.0, 10.0, 0);
        world.spawn_enemy(12.0, 10.0, 0);
        world.set_collision_filter(
            player,
            CollisionFilter::new(CollisionMask::PLAYER, CollisionMask::BULLET),
        );

        assert!(CollisionSystem::build_pairs(&world).is_empty());
        assert!(CollisionSystem::build_layer_pairs(
            &world,
            CollisionLayer::Player,
            CollisionLayer::Enemy,
        )
        .is_empty());
    }

    #[test]
    fn mask_pairs_support_custom_categories() {
        let mut world = World::default();
        let sensor_category = CollisionMask::bit(8).expect("bit index is valid");
        let actor_category = CollisionMask::bit(9).expect("bit index is valid");
        let sensor = spawn_custom_body(&mut world, 10.0, 10.0, sensor_category, actor_category);
        let actor = spawn_custom_body(&mut world, 12.0, 10.0, actor_category, sensor_category);

        let pairs = CollisionSystem::build_mask_pairs(&world, sensor_category, actor_category);

        assert_eq!(
            pairs,
            vec![CollisionPair {
                a: sensor,
                b: actor
            }]
        );
    }

    #[test]
    fn mask_contacts_and_manifolds_support_custom_categories() {
        let mut world = World::default();
        let sensor_category = CollisionMask::bit(8).expect("bit index is valid");
        let actor_category = CollisionMask::bit(9).expect("bit index is valid");
        let sensor = spawn_custom_body(&mut world, 10.0, 10.0, sensor_category, actor_category);
        let actor = spawn_custom_body(&mut world, 12.0, 10.0, actor_category, sensor_category);

        let contacts =
            CollisionSystem::build_mask_contacts(&world, sensor_category, actor_category);
        let manifolds =
            CollisionSystem::build_mask_manifolds(&world, actor_category, sensor_category);

        assert_eq!(contacts.len(), 1);
        assert_eq!(
            contacts[0],
            CollisionContact {
                pair: CollisionPair {
                    a: sensor,
                    b: actor,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 8.0,
                point_x: 15.0,
                point_y: 10.0,
            }
        );
        assert_eq!(manifolds.len(), 1);
        assert_eq!(
            manifolds[0].pair,
            CollisionPair {
                a: actor,
                b: sensor,
            }
        );
        assert_eq!(manifolds[0].point_count, 2);
    }

    #[test]
    fn aabb_contact_reports_normal_and_penetration() {
        let contact = CollisionSystem::aabb_contact(
            Transform2D { x: 10.0, y: 10.0 },
            collider(5.0, 5.0),
            Transform2D { x: 18.0, y: 10.0 },
            collider(5.0, 5.0),
        )
        .unwrap();

        assert_eq!(
            contact,
            AabbContact {
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 2.0,
            }
        );
    }

    #[test]
    fn aabb_contact_respects_collider_offsets() {
        let contact = CollisionSystem::aabb_contact(
            Transform2D { x: 0.0, y: 0.0 },
            collider(2.0, 2.0).with_offset(10.0, 0.0),
            Transform2D { x: 15.0, y: 0.0 },
            collider(4.0, 4.0),
        )
        .unwrap();

        assert_eq!(
            contact,
            AabbContact {
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 1.0,
            }
        );
    }

    #[test]
    fn build_layer_contacts_returns_oriented_contact() {
        let mut world = World::default();
        let player = world.spawn_player(10.0, 10.0, 0);
        let enemy = world.spawn_enemy(12.0, 10.0, 0);

        let contacts = CollisionSystem::build_layer_contacts(
            &world,
            CollisionLayer::Player,
            CollisionLayer::Enemy,
        );

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: player,
                    b: enemy,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 28.0,
                point_x: 28.0,
                point_y: 10.0,
            }]
        );
    }

    #[test]
    fn contact_debug_lines_report_contact_normal() {
        let mut world = World::default();
        world.spawn_player(10.0, 10.0, 0);
        world.spawn_enemy(12.0, 10.0, 0);

        let lines = CollisionSystem::build_contact_debug_lines(&world, 8.0);

        assert_eq!(lines.len(), 3);
        assert_eq!(
            lines[0],
            PhysicsDebugLine {
                x0: 28.0,
                y0: 10.0,
                x1: 36.0,
                y1: 10.0,
                r: 1.0,
                g: 0.2,
                b: 0.1,
                a: 1.0,
            }
        );
        assert_eq!(lines[1].x0, 25.0);
        assert_eq!(lines[1].x1, 31.0);
        assert_eq!(lines[2].y0, 7.0);
        assert_eq!(lines[2].y1, 13.0);
    }

    #[test]
    fn contact_debug_lines_report_oriented_box_contact_normal() {
        let mut world = World::default();
        spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(2.0, 1.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        spawn_custom_circle(
            &mut world,
            2.5,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let lines = CollisionSystem::build_contact_debug_lines(&world, 8.0);

        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].x0, 2.0);
        assert_eq!(lines[0].y0, 0.0);
        assert_eq!(lines[0].x1, 10.0);
        assert_eq!(lines[0].y1, 0.0);
    }

    #[test]
    fn contact_debug_lines_reject_invalid_length() {
        let mut world = World::default();
        world.spawn_player(10.0, 10.0, 0);
        world.spawn_enemy(12.0, 10.0, 0);

        let lines = CollisionSystem::build_contact_debug_lines(&world, 0.0);

        assert!(lines.is_empty());
    }

    #[test]
    fn broadphase_debug_lines_report_proxy_bounds() {
        let mut world = World::default();
        spawn_custom_body(
            &mut world,
            10.0,
            20.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let lines = CollisionSystem::build_broadphase_debug_lines(&world);

        assert_eq!(
            lines,
            vec![
                PhysicsDebugLine {
                    x0: 5.0,
                    y0: 15.0,
                    x1: 15.0,
                    y1: 15.0,
                    r: 0.1,
                    g: 0.75,
                    b: 1.0,
                    a: 0.55,
                },
                PhysicsDebugLine {
                    x0: 15.0,
                    y0: 15.0,
                    x1: 15.0,
                    y1: 25.0,
                    r: 0.1,
                    g: 0.75,
                    b: 1.0,
                    a: 0.55,
                },
                PhysicsDebugLine {
                    x0: 15.0,
                    y0: 25.0,
                    x1: 5.0,
                    y1: 25.0,
                    r: 0.1,
                    g: 0.75,
                    b: 1.0,
                    a: 0.55,
                },
                PhysicsDebugLine {
                    x0: 5.0,
                    y0: 25.0,
                    x1: 5.0,
                    y1: 15.0,
                    r: 0.1,
                    g: 0.75,
                    b: 1.0,
                    a: 0.55,
                },
            ]
        );
    }

    #[test]
    fn physics_debug_lines_include_broadphase_bounds_before_contacts() {
        let mut world = World::default();
        world.spawn_player(10.0, 10.0, 0);
        world.spawn_enemy(12.0, 10.0, 0);

        let lines = CollisionSystem::build_physics_debug_lines(&world, 8.0);

        assert_eq!(lines.len(), 11);
        assert_eq!(lines[0].r, 0.1);
        assert_eq!(lines[8].r, 1.0);
        assert_eq!(lines[8].x0, 28.0);
        assert_eq!(lines[8].x1, 36.0);
        assert_eq!(lines[9].x0, 25.0);
        assert_eq!(lines[10].y1, 13.0);
    }

    #[test]
    fn build_pairs_uses_precise_circle_overlap_after_broadphase() {
        let mut world = World::default();
        spawn_custom_circle(
            &mut world,
            0.0,
            0.0,
            5.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        spawn_custom_circle(
            &mut world,
            9.0,
            9.0,
            5.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        assert!(CollisionSystem::build_pairs(&world).is_empty());
    }

    #[test]
    fn build_pairs_supports_capsule_colliders() {
        let mut world = World::default();
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let aabb_entity = spawn_custom_body(
            &mut world,
            0.0,
            1.4,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
        let circle_entity = spawn_custom_circle(
            &mut world,
            7.0,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let miss = spawn_custom_body(
            &mut world,
            0.0,
            3.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(miss, collider(0.5, 0.5));

        let pairs = CollisionSystem::build_pairs(&world);

        assert_eq!(
            pairs,
            vec![
                CollisionPair {
                    a: capsule_entity,
                    b: aabb_entity,
                },
                CollisionPair {
                    a: capsule_entity,
                    b: circle_entity,
                },
            ]
        );
    }

    #[test]
    fn build_pairs_supports_edge_colliders() {
        let mut world = World::default();
        let edge_entity = spawn_custom_edge(
            &mut world,
            0.0,
            0.0,
            edge(-5.0, 0.0, 5.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            0.0,
            0.5,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let miss = spawn_custom_circle(
            &mut world,
            0.0,
            4.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let pairs = CollisionSystem::build_pairs(&world);

        assert_eq!(
            pairs,
            vec![CollisionPair {
                a: edge_entity,
                b: circle_entity,
            }]
        );
        assert!(!pairs.iter().any(|pair| pair.a == miss || pair.b == miss));
    }

    #[test]
    fn build_pairs_supports_convex_polygon_colliders() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let aabb_entity = spawn_custom_body(
            &mut world,
            2.4,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
        let circle_entity = spawn_custom_circle(
            &mut world,
            -3.0,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let miss = spawn_custom_body(
            &mut world,
            0.0,
            3.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(miss, collider(0.5, 0.5));

        let pairs = CollisionSystem::build_pairs(&world);

        assert_eq!(
            pairs,
            vec![
                CollisionPair {
                    a: circle_entity,
                    b: polygon_entity,
                },
                CollisionPair {
                    a: polygon_entity,
                    b: aabb_entity,
                },
            ]
        );
    }

    #[test]
    fn build_pairs_supports_oriented_box_colliders() {
        let mut world = World::default();
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(6.0, 1.0, core::f32::consts::FRAC_PI_4),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let aabb_entity = spawn_custom_body(
            &mut world,
            4.0,
            4.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
        let circle_entity = spawn_custom_circle(
            &mut world,
            -4.0,
            -4.0,
            0.75,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let miss = spawn_custom_body(
            &mut world,
            0.0,
            12.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(miss, collider(0.5, 0.5));

        let pairs = CollisionSystem::build_pairs(&world);

        assert_eq!(pairs.len(), 2);
        assert!(pairs.contains(&CollisionPair {
            a: oriented_entity,
            b: aabb_entity,
        }));
        assert!(pairs.contains(&CollisionPair {
            a: oriented_entity,
            b: circle_entity,
        }));
    }

    #[test]
    fn build_contacts_supports_circle_pairs() {
        let mut world = World::default();
        let first = spawn_custom_circle(
            &mut world,
            0.0,
            0.0,
            5.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let second = spawn_custom_circle(
            &mut world,
            8.0,
            0.0,
            5.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: first,
                    b: second,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 2.0,
                point_x: 5.0,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_manifolds_keeps_circle_circle_contact_single_point() {
        let mut world = World::default();
        let first = spawn_custom_circle(
            &mut world,
            0.0,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let second = spawn_custom_circle(
            &mut world,
            1.5,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(
            manifolds,
            vec![CollisionManifold {
                pair: CollisionPair {
                    a: first,
                    b: second,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_count: 1,
                points: [
                    CollisionContactPoint {
                        point_x: 1.0,
                        point_y: 0.0,
                        penetration: 0.5,
                    },
                    CollisionContactPoint {
                        point_x: 0.0,
                        point_y: 0.0,
                        penetration: 0.0,
                    },
                ],
            }]
        );
        assert_eq!(manifolds[0].points().len(), 1);
    }

    #[test]
    fn build_contacts_supports_capsule_circle_pairs() {
        let mut world = World::default();
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            7.5,
            0.0,
            2.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: capsule_entity,
                    b: circle_entity,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_x: 6.0,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_contacts_supports_circle_edge_pairs() {
        let mut world = World::default();
        let edge_entity = spawn_custom_edge(
            &mut world,
            0.0,
            0.0,
            edge(-5.0, 0.0, 5.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            0.0,
            0.75,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(contacts.len(), 1);
        assert_eq!(
            contacts[0].pair,
            CollisionPair {
                a: edge_entity,
                b: circle_entity,
            }
        );
        assert_eq!(contacts[0].normal_x, 0.0);
        assert!(contacts[0].normal_y > 0.99);
        assert!(contacts[0].penetration > 0.24);
        assert!(contacts[0].point_x.abs() <= 0.01);
        assert!(contacts[0].point_y.abs() <= 0.01);
    }

    #[test]
    fn build_contacts_supports_aabb_capsule_pairs() {
        let mut world = World::default();
        let aabb_entity = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(aabb_entity, collider(1.0, 1.0));
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            2.5,
            0.0,
            capsule(-1.0, 0.0, 1.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: aabb_entity,
                    b: capsule_entity,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_x: 1.0,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_contacts_supports_capsule_capsule_pairs() {
        let mut world = World::default();
        let first = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-5.0, 0.0, 5.0, 0.0, 2.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let second = spawn_custom_capsule(
            &mut world,
            0.0,
            2.5,
            capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(contacts.len(), 1);
        assert_eq!(
            contacts[0].pair,
            CollisionPair {
                a: first,
                b: second,
            }
        );
        assert_eq!(contacts[0].normal_x, 0.0);
        assert_eq!(contacts[0].normal_y, 1.0);
        assert_eq!(contacts[0].penetration, 0.5);
        assert!(contacts[0].point_x.is_finite());
        assert!(contacts[0].point_y.is_finite());
    }

    #[test]
    fn build_contacts_supports_capsule_edge_pairs() {
        let mut world = World::default();
        let edge_entity = spawn_custom_edge(
            &mut world,
            0.0,
            0.0,
            edge(-6.0, 0.0, 6.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.75,
            capsule(-2.0, 0.0, 2.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(contacts.len(), 1);
        assert_eq!(
            contacts[0].pair,
            CollisionPair {
                a: edge_entity,
                b: capsule_entity,
            }
        );
        assert_eq!(contacts[0].normal_x, 0.0);
        assert!(contacts[0].normal_y > 0.99);
        assert!(contacts[0].penetration > 0.24);
        assert!(contacts[0].point_x.is_finite());
        assert!(contacts[0].point_y.is_finite());
    }

    #[test]
    fn build_layer_contacts_supports_oriented_box_aabb_pairs() {
        let mut world = World::default();
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(1.0, 1.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::PLAYER,
        );
        let aabb_entity = spawn_custom_body(
            &mut world,
            1.5,
            0.0,
            CollisionMask::PLAYER,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(
            aabb_entity,
            AabbCollider::new(1.0, 1.0, true, CollisionLayer::Player),
        );

        let contacts = CollisionSystem::build_layer_contacts(
            &world,
            CollisionLayer::Enemy,
            CollisionLayer::Player,
        );

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: oriented_entity,
                    b: aabb_entity,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_x: 0.75,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_contacts_supports_oriented_box_circle_pairs() {
        let mut world = World::default();
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(2.0, 1.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            2.5,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: oriented_entity,
                    b: circle_entity,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_x: 2.0,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_contacts_supports_oriented_box_oriented_box_pairs() {
        let mut world = World::default();
        let first = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(2.0, 1.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let second = spawn_custom_oriented_box(
            &mut world,
            3.0,
            0.0,
            oriented_box(2.0, 1.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: first,
                    b: second,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 1.0,
                point_x: 1.5,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_contacts_supports_oriented_box_capsule_pairs() {
        let mut world = World::default();
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(2.0, 1.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            2.5,
            0.0,
            capsule(0.0, -1.0, 0.0, 1.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(contacts.len(), 1);
        assert_eq!(
            contacts[0].pair,
            CollisionPair {
                a: oriented_entity,
                b: capsule_entity,
            }
        );
        assert_eq!(contacts[0].normal_x, 1.0);
        assert_eq!(contacts[0].normal_y, 0.0);
        assert_eq!(contacts[0].penetration, 0.5);
        assert!(contacts[0].point_x.is_finite());
        assert!(contacts[0].point_y.is_finite());
    }

    #[test]
    fn build_contacts_supports_convex_polygon_aabb_pairs() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let aabb_entity = spawn_custom_body(
            &mut world,
            2.5,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(aabb_entity, collider(1.0, 1.0));

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: polygon_entity,
                    b: aabb_entity,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_x: 1.75,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_contacts_supports_convex_polygon_circle_pairs() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            2.5,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: polygon_entity,
                    b: circle_entity,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_x: 1.75,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_contacts_supports_convex_polygon_oriented_box_pairs() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            2.5,
            0.0,
            oriented_box(1.0, 1.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: polygon_entity,
                    b: oriented_entity,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_x: 1.75,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_contacts_supports_convex_polygon_capsule_pairs() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            2.5,
            0.0,
            capsule(0.0, -1.0, 0.0, 1.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: polygon_entity,
                    b: capsule_entity,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_x: 1.75,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_contacts_supports_convex_polygon_convex_polygon_pairs() {
        let mut world = World::default();
        let first = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let second = spawn_custom_convex_polygon(
            &mut world,
            3.5,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let contacts = CollisionSystem::build_contacts(&world);

        assert_eq!(
            contacts,
            vec![CollisionContact {
                pair: CollisionPair {
                    a: first,
                    b: second,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_x: 1.75,
                point_y: 0.0,
            }]
        );
    }

    #[test]
    fn build_manifolds_reports_two_convex_polygon_circle_face_points() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            2.5,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        assert_eq!(
            manifolds[0].pair,
            CollisionPair {
                a: polygon_entity,
                b: circle_entity,
            }
        );
        assert_eq!(manifolds[0].normal_x, 1.0);
        assert_eq!(manifolds[0].normal_y, 0.0);
        assert_eq!(manifolds[0].penetration, 0.5);
        assert_eq!(manifolds[0].point_count, 2);
        assert!(manifolds[0]
            .points()
            .iter()
            .all(|point| (point.point_x - 2.0).abs() < 0.001
                && (point.penetration - 0.5).abs() < 0.001));
        assert!(manifolds[0]
            .points()
            .iter()
            .any(|point| (point.point_y - 0.866).abs() < 0.001));
        assert!(manifolds[0]
            .points()
            .iter()
            .any(|point| (point.point_y + 0.866).abs() < 0.001));
    }

    #[test]
    fn build_manifolds_keeps_convex_polygon_circle_corner_contact_single_point() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            2.5,
            1.5,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: polygon_entity,
                b: circle_entity,
            }
        );
        assert_eq!(manifold.point_count, 1);
        assert!((manifold.normal_x - 0.707).abs() < 0.001);
        assert!((manifold.normal_y - 0.707).abs() < 0.001);
        assert!((manifold.penetration - 0.293).abs() < 0.001);
        assert!((manifold.points()[0].point_x - 2.0).abs() < 0.001);
        assert!((manifold.points()[0].point_y - 1.0).abs() < 0.001);
    }

    #[test]
    fn build_manifolds_reports_two_convex_polygon_capsule_side_points() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::PLAYER,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            2.5,
            0.0,
            capsule(0.0, -0.5, 0.0, 0.5, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::PLAYER,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: polygon_entity,
                b: capsule_entity,
            }
        );
        assert_eq!(manifold.normal_x, 1.0);
        assert_eq!(manifold.normal_y, 0.0);
        assert_eq!(manifold.penetration, 0.5);
        assert_eq!(manifold.point_count, 2);
        assert!(manifold
            .points()
            .iter()
            .all(|point| (point.point_x - 2.0).abs() < 0.001
                && (point.penetration - 0.5).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_y - 0.5).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_y + 0.5).abs() < 0.001));
    }

    #[test]
    fn build_manifolds_reports_two_convex_polygon_face_points() {
        let mut world = World::default();
        let first = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::PLAYER,
            CollisionMask::ENEMY,
        );
        let second = spawn_custom_convex_polygon(
            &mut world,
            3.5,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::PLAYER,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: first,
                b: second
            }
        );
        assert_eq!(manifold.normal_x, 1.0);
        assert_eq!(manifold.normal_y, 0.0);
        assert_eq!(manifold.penetration, 0.5);
        assert_eq!(manifold.point_count, 2);
        assert!(manifold
            .points()
            .iter()
            .all(|point| (point.point_x - 2.0).abs() < 0.001
                && (point.penetration - 0.5).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_y - 1.0).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_y + 1.0).abs() < 0.001));
    }

    #[test]
    fn build_manifolds_reports_two_oriented_box_circle_face_points() {
        let mut world = World::default();
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(2.0, 1.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            2.5,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: oriented_entity,
                b: circle_entity,
            }
        );
        assert_eq!(manifold.normal_x, 1.0);
        assert_eq!(manifold.normal_y, 0.0);
        assert_eq!(manifold.penetration, 0.5);
        assert_eq!(manifold.point_count, 2);
        assert!(manifold
            .points()
            .iter()
            .all(|point| (point.point_x - 2.0).abs() < 0.001
                && (point.penetration - 0.5).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_y - 0.866).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_y + 0.866).abs() < 0.001));
    }

    #[test]
    fn build_manifolds_reports_two_aabb_oriented_box_face_points() {
        let mut world = World::default();
        let aabb_entity = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            8.0,
            0.0,
            oriented_box(5.0, 5.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(
            manifolds,
            vec![CollisionManifold {
                pair: CollisionPair {
                    a: aabb_entity,
                    b: oriented_entity,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 2.0,
                point_count: 2,
                points: [
                    CollisionContactPoint {
                        point_x: 5.0,
                        point_y: -5.0,
                        penetration: 2.0,
                    },
                    CollisionContactPoint {
                        point_x: 5.0,
                        point_y: 5.0,
                        penetration: 2.0,
                    },
                ],
            }]
        );
        assert_eq!(manifolds[0].points().len(), 2);
    }

    #[test]
    fn build_manifolds_reports_two_oriented_box_face_points() {
        let mut world = World::default();
        let first = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(2.0, 1.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let second = spawn_custom_oriented_box(
            &mut world,
            3.0,
            0.0,
            oriented_box(2.0, 1.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(
            manifolds,
            vec![CollisionManifold {
                pair: CollisionPair {
                    a: first,
                    b: second,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 1.0,
                point_count: 2,
                points: [
                    CollisionContactPoint {
                        point_x: 2.0,
                        point_y: -1.0,
                        penetration: 1.0,
                    },
                    CollisionContactPoint {
                        point_x: 2.0,
                        point_y: 1.0,
                        penetration: 1.0,
                    },
                ],
            }]
        );
        assert_eq!(manifolds[0].points().len(), 2);
    }

    #[test]
    fn build_manifolds_reports_two_oriented_box_capsule_side_points() {
        let mut world = World::default();
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(5.0, 5.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            5.5,
            capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(
            manifolds,
            vec![CollisionManifold {
                pair: CollisionPair {
                    a: oriented_entity,
                    b: capsule_entity,
                },
                normal_x: 0.0,
                normal_y: 1.0,
                penetration: 0.5,
                point_count: 2,
                points: [
                    CollisionContactPoint {
                        point_x: -3.0,
                        point_y: 5.0,
                        penetration: 0.5,
                    },
                    CollisionContactPoint {
                        point_x: 3.0,
                        point_y: 5.0,
                        penetration: 0.5,
                    },
                ],
            }]
        );
        assert_eq!(manifolds[0].points().len(), 2);
    }

    #[test]
    fn build_manifolds_supports_capsule_contacts_as_single_point() {
        let mut world = World::default();
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            7.5,
            0.0,
            2.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(
            manifolds,
            vec![CollisionManifold {
                pair: CollisionPair {
                    a: capsule_entity,
                    b: circle_entity,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 0.5,
                point_count: 1,
                points: [
                    CollisionContactPoint {
                        point_x: 6.0,
                        point_y: 0.0,
                        penetration: 0.5,
                    },
                    CollisionContactPoint {
                        point_x: 0.0,
                        point_y: 0.0,
                        penetration: 0.0,
                    },
                ],
            }]
        );
        assert_eq!(manifolds[0].points().len(), 1);
    }

    #[test]
    fn build_manifolds_reports_two_capsule_circle_side_points() {
        let mut world = World::default();
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            0.0,
            1.5,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: capsule_entity,
                b: circle_entity,
            }
        );
        assert_eq!(manifold.normal_x, 0.0);
        assert_eq!(manifold.normal_y, 1.0);
        assert_eq!(manifold.penetration, 0.5);
        assert_eq!(manifold.point_count, 2);
        assert!(manifold
            .points()
            .iter()
            .all(|point| (point.point_y - 1.0).abs() < 0.001
                && (point.penetration - 0.5).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_x - 0.866).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_x + 0.866).abs() < 0.001));
    }

    #[test]
    fn build_manifolds_reports_two_circle_capsule_side_points() {
        let mut world = World::default();
        let circle_entity = spawn_custom_circle(
            &mut world,
            0.0,
            1.5,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            CapsuleCollider::new(-3.0, 0.0, 3.0, 0.0, 1.0, true, CollisionLayer::Player),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_layer_manifolds(
            &world,
            CollisionLayer::Enemy,
            CollisionLayer::Player,
        );

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: circle_entity,
                b: capsule_entity,
            }
        );
        assert_eq!(manifold.normal_x, 0.0);
        assert_eq!(manifold.normal_y, -1.0);
        assert_eq!(manifold.penetration, 0.5);
        assert_eq!(manifold.point_count, 2);
        assert!(manifold
            .points()
            .iter()
            .all(|point| (point.point_y - 1.0).abs() < 0.001
                && (point.penetration - 0.5).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_x - 0.866).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_x + 0.866).abs() < 0.001));
    }

    #[test]
    fn build_manifolds_reports_two_aabb_capsule_side_points() {
        let mut world = World::default();
        let aabb_entity = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            5.5,
            capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(
            manifolds,
            vec![CollisionManifold {
                pair: CollisionPair {
                    a: aabb_entity,
                    b: capsule_entity,
                },
                normal_x: 0.0,
                normal_y: 1.0,
                penetration: 0.5,
                point_count: 2,
                points: [
                    CollisionContactPoint {
                        point_x: -3.0,
                        point_y: 5.0,
                        penetration: 0.5,
                    },
                    CollisionContactPoint {
                        point_x: 3.0,
                        point_y: 5.0,
                        penetration: 0.5,
                    },
                ],
            }]
        );
        assert_eq!(manifolds[0].points().len(), 2);

        let mut world = World::default();
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            5.5,
            capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let aabb_entity = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_layer_manifolds(
            &world,
            CollisionLayer::Enemy,
            CollisionLayer::Player,
        );

        assert_eq!(
            manifolds,
            vec![CollisionManifold {
                pair: CollisionPair {
                    a: capsule_entity,
                    b: aabb_entity,
                },
                normal_x: 0.0,
                normal_y: -1.0,
                penetration: 0.5,
                point_count: 2,
                points: [
                    CollisionContactPoint {
                        point_x: -3.0,
                        point_y: 5.0,
                        penetration: 0.5,
                    },
                    CollisionContactPoint {
                        point_x: 3.0,
                        point_y: 5.0,
                        penetration: 0.5,
                    },
                ],
            }]
        );
        assert_eq!(manifolds[0].points().len(), 2);
    }

    #[test]
    fn build_manifolds_reports_two_aabb_capsule_endpoint_points() {
        let mut world = World::default();
        let aabb_entity = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            5.5,
            capsule(-3.0, 0.0, 3.0, 0.5, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: aabb_entity,
                b: capsule_entity,
            }
        );
        assert_eq!(manifold.normal_x, 0.0);
        assert_eq!(manifold.normal_y, 1.0);
        assert_eq!(manifold.point_count, 2);
        assert_eq!(manifold.points[0].point_x, -3.0);
        assert_eq!(manifold.points[0].point_y, 5.0);
        assert_eq!(manifold.points[1].point_x, 3.0);
        assert_eq!(manifold.points[1].point_y, 5.0);
    }

    #[test]
    fn build_manifolds_reports_two_aabb_capsule_arc_clipped_face_points() {
        let mut world = World::default();
        let aabb_entity = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-8.0, 4.5, 8.0, 5.5, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: capsule_entity,
                b: aabb_entity,
            }
        );
        assert_eq!(manifold.normal_x, 0.0);
        assert_eq!(manifold.normal_y, -1.0);
        assert_eq!(manifold.point_count, 2);
        assert!(manifold
            .points()
            .iter()
            .all(|point| (point.point_y - 5.0).abs() < 0.001 && point.penetration > 0.6));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_x + 5.0).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_x - 5.0).abs() < 0.001));
    }

    #[test]
    fn build_manifolds_reports_two_oriented_box_capsule_arc_clipped_face_points() {
        let mut world = World::default();
        let rotation = 0.35;
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(5.0, 5.0, rotation),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let geometry =
            oriented_box_geometry(Transform2D { x: 0.0, y: 0.0 }, 5.0, 5.0, rotation).unwrap();
        let start = oriented_box_world_point(geometry, Transform2D { x: -8.0, y: 4.5 });
        let end = oriented_box_world_point(geometry, Transform2D { x: 8.0, y: 5.5 });
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(start.x, start.y, end.x, end.y, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let expected_first = oriented_box_world_point(geometry, Transform2D { x: -5.0, y: 5.0 });
        let expected_second = oriented_box_world_point(geometry, Transform2D { x: 5.0, y: 5.0 });

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: capsule_entity,
                b: oriented_entity,
            }
        );
        assert!((manifold.normal_x + geometry.axis_y_x).abs() < 0.001);
        assert!((manifold.normal_y + geometry.axis_y_y).abs() < 0.001);
        assert_eq!(manifold.point_count, 2);
        assert!(manifold
            .points()
            .iter()
            .all(|point| point.penetration > 0.6));
        assert!(manifold.points().iter().any(|point| {
            (point.point_x - expected_first.x).abs() < 0.001
                && (point.point_y - expected_first.y).abs() < 0.001
        }));
        assert!(manifold.points().iter().any(|point| {
            (point.point_x - expected_second.x).abs() < 0.001
                && (point.point_y - expected_second.y).abs() < 0.001
        }));
    }

    #[test]
    fn build_manifolds_reports_two_convex_polygon_capsule_arc_clipped_face_points() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-4.0, 0.6, 4.0, 1.4, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: capsule_entity,
                b: polygon_entity,
            }
        );
        assert!(manifold.normal_x.abs() < 0.11);
        assert!(manifold.normal_y < -0.99);
        assert_eq!(manifold.point_count, 2);
        assert!(manifold
            .points()
            .iter()
            .all(|point| (point.point_y - 1.0).abs() < 0.001 && point.penetration > 0.7));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_x + 2.0).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_x - 2.0).abs() < 0.001));
    }

    #[test]
    fn build_manifolds_reports_two_parallel_capsule_side_points() {
        let mut world = World::default();
        let first = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let second = spawn_custom_capsule(
            &mut world,
            0.0,
            1.5,
            capsule(-2.0, 0.0, 4.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(
            manifolds,
            vec![CollisionManifold {
                pair: CollisionPair {
                    a: first,
                    b: second,
                },
                normal_x: 0.0,
                normal_y: 1.0,
                penetration: 0.5,
                point_count: 2,
                points: [
                    CollisionContactPoint {
                        point_x: -2.0,
                        point_y: 0.75,
                        penetration: 0.5,
                    },
                    CollisionContactPoint {
                        point_x: 3.0,
                        point_y: 0.75,
                        penetration: 0.5,
                    },
                ],
            }]
        );
        assert_eq!(manifolds[0].points().len(), 2);
    }

    #[test]
    fn build_manifolds_reports_two_non_parallel_capsule_endpoint_points() {
        let mut world = World::default();
        let first = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let second = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-2.0, 1.5, 2.0, 1.75, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: first,
                b: second,
            }
        );
        assert_eq!(manifold.normal_x, 0.0);
        assert_eq!(manifold.normal_y, 1.0);
        assert_eq!(manifold.point_count, 2);
        assert!((manifold.points[0].point_x + 2.0).abs() < 0.001);
        assert!((manifold.points[0].point_y - 0.75).abs() < 0.001);
        assert!((manifold.points[0].penetration - 0.5).abs() < 0.001);
        assert!((manifold.points[1].point_x - 2.0).abs() < 0.001);
        assert!((manifold.points[1].point_y - 0.875).abs() < 0.001);
        assert!((manifold.points[1].penetration - 0.25).abs() < 0.001);
    }

    #[test]
    fn build_manifolds_reports_two_crossing_capsule_curve_points() {
        let mut world = World::default();
        let horizontal = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-3.0, 0.0, 3.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let vertical = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(0.0, -3.0, 0.0, 3.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: horizontal,
                b: vertical,
            }
        );
        assert_eq!(manifold.normal_x, 1.0);
        assert_eq!(manifold.normal_y, 0.0);
        assert_eq!(manifold.point_count, 2);
        assert!(
            manifold.points().iter().all(|point| {
                point.point_x.abs() < 0.001 && (point.penetration - 2.0).abs() < 0.001
            }),
            "expected crossing capsule curve points on the normal tangent, got {manifold:?}"
        );
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_y + 1.0).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_y - 1.0).abs() < 0.001));
    }

    #[test]
    fn build_manifolds_reports_two_aabb_face_points() {
        let mut world = World::default();
        let first = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let second = spawn_custom_body(
            &mut world,
            8.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(
            manifolds,
            vec![CollisionManifold {
                pair: CollisionPair {
                    a: first,
                    b: second,
                },
                normal_x: 1.0,
                normal_y: 0.0,
                penetration: 2.0,
                point_count: 2,
                points: [
                    CollisionContactPoint {
                        point_x: 5.0,
                        point_y: -5.0,
                        penetration: 2.0,
                    },
                    CollisionContactPoint {
                        point_x: 5.0,
                        point_y: 5.0,
                        penetration: 2.0,
                    },
                ],
            }]
        );
        assert_eq!(manifolds[0].points().len(), 2);
    }

    #[test]
    fn build_manifolds_reports_two_aabb_circle_face_points() {
        let mut world = World::default();
        let aabb_entity = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let circle_entity = spawn_custom_circle(
            &mut world,
            5.5,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let manifolds = CollisionSystem::build_manifolds(&world);

        assert_eq!(manifolds.len(), 1);
        let manifold = manifolds[0];
        assert_eq!(
            manifold.pair,
            CollisionPair {
                a: aabb_entity,
                b: circle_entity,
            }
        );
        assert_eq!(manifold.normal_x, 1.0);
        assert_eq!(manifold.normal_y, 0.0);
        assert_eq!(manifold.penetration, 0.5);
        assert_eq!(manifold.point_count, 2);
        assert!(manifold
            .points()
            .iter()
            .all(|point| (point.point_x - 5.0).abs() < 0.001
                && (point.penetration - 0.5).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_y - 0.866).abs() < 0.001));
        assert!(manifold
            .points()
            .iter()
            .any(|point| (point.point_y + 0.866).abs() < 0.001));
    }

    #[test]
    fn point_query_returns_matching_mask_hits() {
        let mut world = World::default();
        let enemy = world.spawn_enemy(10.0, 10.0, 0);
        world.spawn_bullet(80.0, 80.0, 0.0, 0.0, 0);

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 10.0, y: 10.0 },
            CollisionMask::ENEMY,
        );

        assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
    }

    #[test]
    fn point_query_respects_aabb_collider_offset() {
        let mut world = World::default();
        let enemy = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.colliders[enemy.id as usize] = Some(collider(2.0, 2.0).with_offset(10.0, 0.0));

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 10.0, y: 0.0 },
            CollisionMask::ENEMY,
        );
        let misses = CollisionSystem::point_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            CollisionMask::ENEMY,
        );

        assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
        assert!(misses.is_empty());
    }

    #[test]
    fn disabled_aabb_collider_is_excluded_from_pairs_and_queries() {
        let mut world = World::default();
        let disabled = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        spawn_custom_body(
            &mut world,
            8.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(disabled, collider(5.0, 5.0).with_enabled(false));

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            CollisionMask::ENEMY,
        );

        assert!(CollisionSystem::build_pairs(&world).is_empty());
        assert!(hits.is_empty());
    }

    #[test]
    fn point_query_respects_circle_shape() {
        let mut world = World::default();
        spawn_custom_circle(
            &mut world,
            10.0,
            10.0,
            5.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 14.0, y: 14.0 },
            CollisionMask::ENEMY,
        );

        assert!(hits.is_empty());
    }

    #[test]
    fn point_query_respects_circle_collider_offset() {
        let mut world = World::default();
        let enemy = spawn_custom_circle(
            &mut world,
            0.0,
            0.0,
            3.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_circle_collider(enemy, circle(3.0).with_offset(8.0, 0.0));

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 8.0, y: 0.0 },
            CollisionMask::ENEMY,
        );
        let misses = CollisionSystem::point_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            CollisionMask::ENEMY,
        );

        assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
        assert!(misses.is_empty());
    }

    #[test]
    fn disabled_circle_collider_is_excluded_from_queries() {
        let mut world = World::default();
        let enemy = spawn_custom_circle(
            &mut world,
            0.0,
            0.0,
            3.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_circle_collider(enemy, circle(3.0).with_enabled(false));

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            CollisionMask::ENEMY,
        );

        assert!(hits.is_empty());
    }

    #[test]
    fn point_query_respects_oriented_box_collider_offset_and_rotation() {
        let mut world = World::default();
        let enemy = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(4.0, 1.0, core::f32::consts::FRAC_PI_4).with_offset(8.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 10.0, y: 2.0 },
            CollisionMask::ENEMY,
        );
        let misses = CollisionSystem::point_query(
            &world,
            Transform2D { x: 8.0, y: 3.0 },
            CollisionMask::ENEMY,
        );

        assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
        assert!(misses.is_empty());
    }

    #[test]
    fn disabled_oriented_box_collider_is_excluded_from_pairs_and_queries() {
        let mut world = World::default();
        let disabled = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(4.0, 1.0, 0.0).with_enabled(false),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            CollisionMask::ENEMY,
        );

        assert!(!world.oriented_box_collider(disabled).unwrap().enabled);
        assert!(CollisionSystem::build_pairs(&world).is_empty());
        assert!(hits.is_empty());
    }

    #[test]
    fn point_query_respects_capsule_collider_offset() {
        let mut world = World::default();
        let enemy = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-4.0, 0.0, 4.0, 0.0, 1.0).with_offset(8.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 8.0, y: 0.75 },
            CollisionMask::ENEMY,
        );
        let misses = CollisionSystem::point_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            CollisionMask::ENEMY,
        );

        assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
        assert!(misses.is_empty());
    }

    #[test]
    fn disabled_capsule_collider_is_excluded_from_pairs_and_queries() {
        let mut world = World::default();
        let disabled = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-4.0, 0.0, 4.0, 0.0, 1.0).with_enabled(false),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        spawn_custom_body(
            &mut world,
            7.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            CollisionMask::ENEMY,
        );

        assert!(!world.capsule_collider(disabled).unwrap().enabled);
        assert!(CollisionSystem::build_pairs(&world).is_empty());
        assert!(hits.is_empty());
    }

    #[test]
    fn point_query_respects_convex_polygon_collider_offset_and_rotation() {
        let mut world = World::default();
        let enemy = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-4.0, -1.0), (4.0, -1.0), (4.0, 1.0), (-4.0, 1.0)])
                .with_offset(8.0, 0.0)
                .with_rotation(core::f32::consts::FRAC_PI_4),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 10.0, y: 2.0 },
            CollisionMask::ENEMY,
        );
        let misses = CollisionSystem::point_query(
            &world,
            Transform2D { x: 8.0, y: 3.0 },
            CollisionMask::ENEMY,
        );

        assert_eq!(hits, vec![PointQueryHit { entity: enemy }]);
        assert!(misses.is_empty());
    }

    #[test]
    fn disabled_convex_polygon_collider_is_excluded_from_pairs_and_queries() {
        let mut world = World::default();
        let disabled = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-4.0, -1.0), (4.0, -1.0), (4.0, 1.0), (-4.0, 1.0)])
                .with_enabled(false),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        spawn_custom_body(
            &mut world,
            7.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            CollisionMask::ENEMY,
        );

        assert!(!world.convex_polygon_collider(disabled).unwrap().enabled);
        assert!(CollisionSystem::build_pairs(&world).is_empty());
        assert!(hits.is_empty());
    }

    #[test]
    fn aabb_query_returns_overlapping_mask_hits() {
        let mut world = World::default();
        let enemy = world.spawn_enemy(20.0, 20.0, 0);
        world.spawn_enemy(100.0, 100.0, 0);
        let bounds = AabbBounds::from_center(Transform2D { x: 20.0, y: 20.0 }, 4.0, 4.0)
            .expect("query bounds are valid");

        let hits = CollisionSystem::aabb_query(&world, bounds, CollisionMask::ENEMY);

        assert_eq!(hits, vec![AabbQueryHit { entity: enemy }]);
    }

    #[test]
    fn circle_query_returns_overlapping_circle_and_aabb_hits() {
        let mut world = World::default();
        let circle_entity = spawn_custom_circle(
            &mut world,
            10.0,
            10.0,
            5.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let aabb_entity = spawn_custom_body(
            &mut world,
            18.0,
            10.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.spawn_enemy(80.0, 80.0, 0);

        let hits = CollisionSystem::circle_query(
            &world,
            Transform2D { x: 10.0, y: 10.0 },
            6.0,
            CollisionMask::ENEMY,
        );

        assert_eq!(
            hits,
            vec![
                CircleQueryHit {
                    entity: circle_entity
                },
                CircleQueryHit {
                    entity: aabb_entity
                }
            ]
        );
    }

    #[test]
    fn aabb_and_circle_queries_support_capsule_colliders() {
        let mut world = World::default();
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            20.0,
            10.0,
            capsule(-4.0, 0.0, 4.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let aabb_hits = CollisionSystem::aabb_query(
            &world,
            AabbBounds::from_center(Transform2D { x: 24.5, y: 10.0 }, 0.5, 0.5)
                .expect("query bounds are valid"),
            CollisionMask::ENEMY,
        );
        let circle_hits = CollisionSystem::circle_query(
            &world,
            Transform2D { x: 15.0, y: 10.0 },
            1.0,
            CollisionMask::ENEMY,
        );

        assert_eq!(
            aabb_hits,
            vec![AabbQueryHit {
                entity: capsule_entity
            }]
        );
        assert_eq!(
            circle_hits,
            vec![CircleQueryHit {
                entity: capsule_entity
            }]
        );
    }

    #[test]
    fn aabb_and_circle_queries_support_oriented_box_colliders() {
        let mut world = World::default();
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            20.0,
            10.0,
            oriented_box(4.0, 1.0, core::f32::consts::FRAC_PI_4),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let aabb_hits = CollisionSystem::aabb_query(
            &world,
            AabbBounds::from_center(Transform2D { x: 23.0, y: 13.0 }, 0.5, 0.5)
                .expect("query bounds are valid"),
            CollisionMask::ENEMY,
        );
        let circle_hits = CollisionSystem::circle_query(
            &world,
            Transform2D { x: 17.0, y: 7.0 },
            0.75,
            CollisionMask::ENEMY,
        );

        assert_eq!(
            aabb_hits,
            vec![AabbQueryHit {
                entity: oriented_entity
            }]
        );
        assert_eq!(
            circle_hits,
            vec![CircleQueryHit {
                entity: oriented_entity
            }]
        );
    }

    #[test]
    fn aabb_and_circle_queries_support_convex_polygon_colliders() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            20.0,
            10.0,
            convex_polygon_collider(&[(-4.0, -1.0), (4.0, -1.0), (4.0, 1.0), (-4.0, 1.0)])
                .with_rotation(core::f32::consts::FRAC_PI_4),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let aabb_hits = CollisionSystem::aabb_query(
            &world,
            AabbBounds::from_center(Transform2D { x: 23.0, y: 13.0 }, 0.5, 0.5)
                .expect("query bounds are valid"),
            CollisionMask::ENEMY,
        );
        let circle_hits = CollisionSystem::circle_query(
            &world,
            Transform2D { x: 17.0, y: 7.0 },
            0.75,
            CollisionMask::ENEMY,
        );

        assert_eq!(
            aabb_hits,
            vec![AabbQueryHit {
                entity: polygon_entity
            }]
        );
        assert_eq!(
            circle_hits,
            vec![CircleQueryHit {
                entity: polygon_entity
            }]
        );
    }

    #[test]
    fn shape_query_supports_aabb_shape() {
        let mut world = World::default();
        let enemy = world.spawn_enemy(20.0, 20.0, 0);
        world.spawn_bullet(80.0, 80.0, 0.0, 0.0, 0);
        let bounds = AabbBounds::from_center(Transform2D { x: 20.0, y: 20.0 }, 4.0, 4.0)
            .expect("query bounds are valid");

        let hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Aabb(bounds),
            CollisionMask::ENEMY,
        );

        assert_eq!(hits, vec![ShapeQueryHit { entity: enemy }]);
    }

    #[test]
    fn shape_query_supports_circle_shape() {
        let mut world = World::default();
        let circle_entity = spawn_custom_circle(
            &mut world,
            10.0,
            10.0,
            5.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let aabb_entity = spawn_custom_body(
            &mut world,
            18.0,
            10.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 10.0, y: 10.0 },
                radius: 6.0,
            },
            CollisionMask::ENEMY,
        );

        assert_eq!(
            hits,
            vec![
                ShapeQueryHit {
                    entity: circle_entity
                },
                ShapeQueryHit {
                    entity: aabb_entity
                }
            ]
        );
    }

    #[test]
    fn shape_query_supports_oriented_box_shape() {
        let mut world = World::default();
        let aabb_entity = spawn_custom_body(
            &mut world,
            6.0,
            6.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
        let circle_entity = spawn_custom_circle(
            &mut world,
            -6.0,
            -6.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let miss = spawn_custom_body(
            &mut world,
            0.0,
            6.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(miss, collider(0.5, 0.5));

        let hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 0.0, y: 0.0 },
                half_width: 10.0,
                half_height: 1.0,
                rotation_radians: core::f32::consts::FRAC_PI_4,
            },
            CollisionMask::ENEMY,
        );

        assert_eq!(
            hits,
            vec![
                ShapeQueryHit {
                    entity: aabb_entity
                },
                ShapeQueryHit {
                    entity: circle_entity
                }
            ]
        );
    }

    #[test]
    fn shape_query_supports_capsule_shape() {
        let mut world = World::default();
        let aabb_entity = spawn_custom_body(
            &mut world,
            0.0,
            1.4,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
        let circle_entity = spawn_custom_circle(
            &mut world,
            6.0,
            2.2,
            1.3,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let miss = spawn_custom_body(
            &mut world,
            0.0,
            3.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(miss, collider(0.5, 0.5));

        let hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: -8.0, y: 0.0 },
                end: Transform2D { x: 8.0, y: 0.0 },
                radius: 1.0,
            },
            CollisionMask::ENEMY,
        );

        assert_eq!(
            hits,
            vec![
                ShapeQueryHit {
                    entity: aabb_entity
                },
                ShapeQueryHit {
                    entity: circle_entity
                }
            ]
        );
    }

    #[test]
    fn shape_query_supports_convex_polygon_shape() {
        let mut world = World::default();
        let aabb_entity = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(aabb_entity, collider(0.5, 0.5));
        let circle_entity = spawn_custom_circle(
            &mut world,
            4.0,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let miss = spawn_custom_body(
            &mut world,
            0.0,
            5.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(miss, collider(0.5, 0.5));

        let hits = CollisionSystem::shape_query(
            &world,
            convex_polygon(&[(-2.0, -1.0), (5.0, -1.0), (5.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
        );

        assert_eq!(
            hits,
            vec![
                ShapeQueryHit {
                    entity: aabb_entity
                },
                ShapeQueryHit {
                    entity: circle_entity
                }
            ]
        );
    }

    #[test]
    fn shape_query_supports_convex_polygon_against_stored_oriented_box_and_capsule() {
        let mut world = World::default();
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            6.0,
            0.0,
            oriented_box(1.0, 1.0, core::f32::consts::FRAC_PI_4),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            -5.0,
            0.0,
            capsule(-1.0, 0.0, 1.0, 0.0, 0.5),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let miss = spawn_custom_body(
            &mut world,
            0.0,
            5.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(miss, collider(0.5, 0.5));

        let hits = CollisionSystem::shape_query(
            &world,
            convex_polygon(&[(-7.0, -1.0), (7.0, -1.0), (7.0, 1.0), (-7.0, 1.0)]),
            CollisionMask::ENEMY,
        );

        assert_eq!(
            hits,
            vec![
                ShapeQueryHit {
                    entity: oriented_entity
                },
                ShapeQueryHit {
                    entity: capsule_entity
                }
            ]
        );
    }

    #[test]
    fn shape_query_supports_stored_convex_polygon_colliders() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            4.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let rotated_polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            -4.0,
            0.0,
            convex_polygon_collider(&[(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)])
                .with_rotation(core::f32::consts::FRAC_PI_4),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        spawn_custom_convex_polygon(
            &mut world,
            0.0,
            8.0,
            convex_polygon_collider(&[(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let circle_hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 6.0, y: 0.0 },
                radius: 0.5,
            },
            CollisionMask::ENEMY,
        );
        let aabb_hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Aabb(
                AabbBounds::from_center(Transform2D { x: -4.0, y: 1.8 }, 0.5, 0.5)
                    .expect("query bounds are valid"),
            ),
            CollisionMask::ENEMY,
        );

        assert_eq!(
            circle_hits,
            vec![ShapeQueryHit {
                entity: polygon_entity
            }]
        );
        assert_eq!(
            aabb_hits,
            vec![ShapeQueryHit {
                entity: rotated_polygon_entity
            }]
        );
    }

    #[test]
    fn shape_query_supports_oriented_box_against_stored_capsule() {
        let mut world = World::default();
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 0.0, y: 1.2 },
                half_width: 4.0,
                half_height: 0.25,
                rotation_radians: 0.0,
            },
            CollisionMask::ENEMY,
        );

        assert_eq!(
            hits,
            vec![ShapeQueryHit {
                entity: capsule_entity
            }]
        );
    }

    #[test]
    fn shape_query_supports_stored_oriented_box_colliders() {
        let mut world = World::default();
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(5.0, 1.0, core::f32::consts::FRAC_PI_4),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let oriented_hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 4.0, y: 4.0 },
                half_width: 1.0,
                half_height: 1.0,
                rotation_radians: core::f32::consts::FRAC_PI_4,
            },
            CollisionMask::ENEMY,
        );
        let capsule_hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: -4.0, y: -4.0 },
                end: Transform2D { x: -2.0, y: -2.0 },
                radius: 0.75,
            },
            CollisionMask::ENEMY,
        );

        assert_eq!(
            oriented_hits,
            vec![ShapeQueryHit {
                entity: oriented_entity
            }]
        );
        assert_eq!(
            capsule_hits,
            vec![ShapeQueryHit {
                entity: oriented_entity
            }]
        );
    }

    #[test]
    fn shape_query_supports_capsule_against_stored_capsule() {
        let mut world = World::default();
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: 6.0, y: -2.0 },
                end: Transform2D { x: 6.0, y: 2.0 },
                radius: 0.5,
            },
            CollisionMask::ENEMY,
        );

        assert_eq!(
            hits,
            vec![ShapeQueryHit {
                entity: capsule_entity
            }]
        );
    }

    #[test]
    fn shape_query_supports_zero_length_capsule_as_circle() {
        let mut world = World::default();
        let hit = spawn_custom_circle(
            &mut world,
            3.0,
            0.0,
            1.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let miss = spawn_custom_body(
            &mut world,
            5.2,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        world.set_aabb_collider(miss, collider(0.5, 0.5));

        let hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: 0.0, y: 0.0 },
                end: Transform2D { x: 0.0, y: 0.0 },
                radius: 2.1,
            },
            CollisionMask::ENEMY,
        );

        assert_eq!(hits, vec![ShapeQueryHit { entity: hit }]);
    }

    #[test]
    fn shape_query_rejects_invalid_circle_shape() {
        let mut world = World::default();
        world.spawn_enemy(10.0, 10.0, 0);

        let hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 10.0, y: 10.0 },
                radius: 0.0,
            },
            CollisionMask::ENEMY,
        );

        assert!(hits.is_empty());
    }

    #[test]
    fn shape_query_rejects_invalid_oriented_box_shape() {
        let mut world = World::default();
        world.spawn_enemy(10.0, 10.0, 0);

        let hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 10.0, y: 10.0 },
                half_width: 0.0,
                half_height: 2.0,
                rotation_radians: 0.0,
            },
            CollisionMask::ENEMY,
        );
        let nan_rotation_hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 10.0, y: 10.0 },
                half_width: 2.0,
                half_height: 2.0,
                rotation_radians: f32::NAN,
            },
            CollisionMask::ENEMY,
        );

        assert!(hits.is_empty());
        assert!(nan_rotation_hits.is_empty());
    }

    #[test]
    fn shape_query_rejects_invalid_capsule_shape() {
        let mut world = World::default();
        world.spawn_enemy(10.0, 10.0, 0);

        let zero_radius_hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: 0.0, y: 0.0 },
                end: Transform2D { x: 10.0, y: 0.0 },
                radius: 0.0,
            },
            CollisionMask::ENEMY,
        );
        let nan_endpoint_hits = CollisionSystem::shape_query(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D {
                    x: f32::NAN,
                    y: 0.0,
                },
                end: Transform2D { x: 10.0, y: 0.0 },
                radius: 1.0,
            },
            CollisionMask::ENEMY,
        );

        assert!(zero_radius_hits.is_empty());
        assert!(nan_endpoint_hits.is_empty());
    }

    #[test]
    fn shape_query_rejects_invalid_convex_polygon_shape() {
        let mut world = World::default();
        world.spawn_enemy(0.0, 0.0, 0);

        let too_few_vertices = CollisionSystem::shape_query(
            &world,
            convex_polygon(&[(0.0, 0.0), (1.0, 0.0)]),
            CollisionMask::ENEMY,
        );
        let concave_vertices = CollisionSystem::shape_query(
            &world,
            convex_polygon(&[(0.0, 0.0), (2.0, 0.0), (1.0, 0.5), (2.0, 2.0), (0.0, 2.0)]),
            CollisionMask::ENEMY,
        );
        let non_finite_vertex = CollisionSystem::shape_query(
            &world,
            convex_polygon(&[(0.0, 0.0), (1.0, 0.0), (f32::NAN, 1.0)]),
            CollisionMask::ENEMY,
        );

        assert!(too_few_vertices.is_empty());
        assert!(concave_vertices.is_empty());
        assert!(non_finite_vertex.is_empty());
    }

    #[test]
    fn nearest_body_query_returns_nearest_aabb_surface() {
        let mut world = World::default();
        let near = spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        spawn_custom_body(
            &mut world,
            40.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::nearest_body_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("nearest query should hit enemy");

        assert_eq!(hit.entity, near);
        assert!((hit.distance - 15.0).abs() < 0.01);
        assert!((hit.point_x - 15.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
    }

    #[test]
    fn nearest_body_query_supports_circle_shape_and_mask() {
        let mut world = World::default();
        world.spawn_enemy(4.0, 0.0, 0);
        let circle_entity = spawn_custom_circle(
            &mut world,
            20.0,
            0.0,
            4.0,
            CollisionMask::bit(8).expect("bit index is valid"),
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::nearest_body_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            100.0,
            CollisionMask::bit(8).expect("bit index is valid"),
        )
        .expect("nearest query should hit custom circle");

        assert_eq!(hit.entity, circle_entity);
        assert!((hit.distance - 16.0).abs() < 0.01);
        assert!((hit.point_x - 16.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
    }

    #[test]
    fn nearest_body_query_supports_capsule_shape() {
        let mut world = World::default();
        let capsule_entity = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::nearest_body_query(
            &world,
            Transform2D { x: 0.0, y: 4.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("nearest query should hit capsule");

        assert_eq!(hit.entity, capsule_entity);
        assert!((hit.distance - 3.0).abs() < 0.01);
        assert!((hit.point_x - 0.0).abs() < 0.01);
        assert!((hit.point_y - 1.0).abs() < 0.01);
    }

    #[test]
    fn nearest_body_query_supports_oriented_box_shape() {
        let mut world = World::default();
        let oriented_entity = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(4.0, 1.0, core::f32::consts::FRAC_PI_4),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::nearest_body_query(
            &world,
            Transform2D { x: 0.0, y: 5.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("nearest query should hit oriented box");

        assert_eq!(hit.entity, oriented_entity);
        assert!(hit.distance > 1.0);
        assert!(hit.distance < 5.0);
        assert!(hit.point_y < 5.0);
    }

    #[test]
    fn nearest_body_query_supports_convex_polygon_shape() {
        let mut world = World::default();
        let polygon_entity = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::nearest_body_query(
            &world,
            Transform2D { x: 0.0, y: 4.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("nearest query should hit convex polygon");

        assert_eq!(hit.entity, polygon_entity);
        assert!((hit.distance - 3.0).abs() < 0.01);
        assert!((hit.point_x - 0.0).abs() < 0.01);
        assert!((hit.point_y - 1.0).abs() < 0.01);
    }

    #[test]
    fn nearest_body_query_reports_zero_when_point_is_inside_body() {
        let mut world = World::default();
        let enemy = spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::nearest_body_query(
            &world,
            Transform2D { x: 20.0, y: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("nearest query should hit containing body");

        assert_eq!(hit.entity, enemy);
        assert_eq!(hit.distance, 0.0);
        assert_eq!(hit.point_x, 20.0);
        assert_eq!(hit.point_y, 0.0);
    }

    #[test]
    fn nearest_body_query_rejects_invalid_input_and_max_distance_misses() {
        let mut world = World::default();
        spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        assert!(CollisionSystem::nearest_body_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            10.0,
            CollisionMask::ENEMY,
        )
        .is_none());
        assert!(CollisionSystem::nearest_body_query(
            &world,
            Transform2D {
                x: f32::NAN,
                y: 0.0,
            },
            100.0,
            CollisionMask::ENEMY,
        )
        .is_none());
        assert!(CollisionSystem::nearest_body_query(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            -1.0,
            CollisionMask::ENEMY,
        )
        .is_none());
    }

    #[test]
    fn shape_cast_returns_nearest_aabb_hit() {
        let mut world = World::default();
        let enemy = spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        spawn_custom_body(
            &mut world,
            40.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 2.0, 2.0)
            .expect("shape cast bounds are valid");

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Aabb(bounds),
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("shape cast should hit nearest enemy");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 13.0).abs() < 0.01);
        assert!((hit.point_x - 13.0).abs() < 0.01);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_circle_shape_against_aabb() {
        let mut world = World::default();
        let enemy = spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 0.0, y: 0.0 },
                radius: 3.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("circle shape cast should hit aabb enemy");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 12.0).abs() < 0.01);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_aabb_shape_against_circle() {
        let mut world = World::default();
        let enemy = spawn_custom_circle(
            &mut world,
            20.0,
            0.0,
            4.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 5.0, 5.0)
            .expect("shape cast bounds are valid");

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Aabb(bounds),
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("aabb shape cast should hit circle enemy");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 11.0).abs() < 0.01);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_oriented_box_shape_against_aabb() {
        let mut world = World::default();
        let enemy = spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let axis = std::f32::consts::FRAC_1_SQRT_2;
        let expected_distance = 15.0 - (4.0 * axis + 2.0 * axis);

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 0.0, y: 0.0 },
                half_width: 4.0,
                half_height: 2.0,
                rotation_radians: std::f32::consts::FRAC_PI_4,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("oriented box shape cast should hit aabb enemy");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - expected_distance).abs() < 0.01);
        assert!((hit.point_x - expected_distance).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_oriented_box_shape_against_circle() {
        let mut world = World::default();
        let axis = std::f32::consts::FRAC_1_SQRT_2;
        let enemy = spawn_custom_circle(
            &mut world,
            20.0 * axis,
            20.0 * axis,
            3.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 0.0, y: 0.0 },
                half_width: 4.0,
                half_height: 2.0,
                rotation_radians: std::f32::consts::FRAC_PI_4,
            },
            Velocity { vx: axis, vy: axis },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("oriented box shape cast should hit circle enemy");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 13.0).abs() < 0.01);
        assert!((hit.point_x - 13.0 * axis).abs() < 0.01);
        assert!((hit.point_y - 13.0 * axis).abs() < 0.01);
        assert!((hit.normal_x + axis).abs() < 0.01);
        assert!((hit.normal_y + axis).abs() < 0.01);
    }

    #[test]
    fn shape_cast_supports_aabb_shape_against_stored_oriented_box() {
        let mut world = World::default();
        let enemy = spawn_custom_oriented_box(
            &mut world,
            20.0,
            0.0,
            oriented_box(5.0, 5.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 2.0, 2.0)
            .expect("shape cast bounds are valid");

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Aabb(bounds),
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("aabb shape cast should hit stored oriented box");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 13.0).abs() < 0.01);
        assert!((hit.point_x - 13.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_circle_shape_against_stored_oriented_box() {
        let mut world = World::default();
        let axis = std::f32::consts::FRAC_1_SQRT_2;
        let enemy = spawn_custom_oriented_box(
            &mut world,
            20.0,
            0.0,
            oriented_box(4.0, 2.0, std::f32::consts::FRAC_PI_4),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 0.0, y: 0.0 },
                radius: 1.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("circle shape cast should hit stored oriented box");

        assert_eq!(hit.entity, enemy);
        assert!(hit.distance > 15.0 && hit.distance < 16.0);
        assert!((hit.point_x - hit.distance).abs() < 0.01);
        assert!((hit.normal_x + axis).abs() < 0.01);
        assert!((hit.normal_y - axis).abs() < 0.01);
    }

    #[test]
    fn shape_cast_supports_oriented_box_shape_against_stored_oriented_box() {
        let mut world = World::default();
        let enemy = spawn_custom_oriented_box(
            &mut world,
            20.0,
            0.0,
            oriented_box(5.0, 5.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let axis = std::f32::consts::FRAC_1_SQRT_2;
        let expected_distance = 15.0 - (4.0 * axis + 2.0 * axis);

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 0.0, y: 0.0 },
                half_width: 4.0,
                half_height: 2.0,
                rotation_radians: std::f32::consts::FRAC_PI_4,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("oriented box shape cast should hit stored oriented box");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - expected_distance).abs() < 0.01);
        assert!((hit.point_x - expected_distance).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_capsule_shape_against_stored_oriented_box() {
        let mut world = World::default();
        let enemy = spawn_custom_oriented_box(
            &mut world,
            20.0,
            0.0,
            oriented_box(5.0, 5.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: 0.0, y: -2.0 },
                end: Transform2D { x: 0.0, y: 2.0 },
                radius: 1.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("capsule shape cast should hit stored oriented box");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 14.0).abs() < 0.01);
        assert!((hit.point_x - 14.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_capsule_shape_against_aabb() {
        let mut world = World::default();
        let enemy = spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: 0.0, y: -2.0 },
                end: Transform2D { x: 0.0, y: 2.0 },
                radius: 1.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("capsule shape cast should hit aabb enemy");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 14.0).abs() < 0.01);
        assert!((hit.point_x - 14.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_capsule_shape_against_circle() {
        let mut world = World::default();
        let enemy = spawn_custom_circle(
            &mut world,
            20.0,
            0.0,
            3.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: 0.0, y: -2.0 },
                end: Transform2D { x: 0.0, y: 2.0 },
                radius: 2.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("capsule shape cast should hit circle enemy");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 15.0).abs() < 0.01);
        assert!((hit.point_x - 15.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_aabb_shape_against_stored_capsule() {
        let mut world = World::default();
        let enemy = spawn_custom_capsule(
            &mut world,
            20.0,
            0.0,
            capsule(0.0, -3.0, 0.0, 3.0, 2.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 1.0, 1.0)
            .expect("shape cast bounds are valid");

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Aabb(bounds),
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("aabb shape cast should hit stored capsule");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 17.0).abs() < 0.01);
        assert!((hit.point_x - 17.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert!(hit.normal_y.abs() < 0.01);
    }

    #[test]
    fn shape_cast_supports_circle_shape_against_stored_capsule() {
        let mut world = World::default();
        let enemy = spawn_custom_capsule(
            &mut world,
            20.0,
            0.0,
            capsule(0.0, -3.0, 0.0, 3.0, 2.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 0.0, y: 0.0 },
                radius: 1.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("circle shape cast should hit stored capsule");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 17.0).abs() < 0.01);
        assert!((hit.point_x - 17.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_circle_shape_against_stored_edge() {
        let mut world = World::default();
        let enemy = spawn_custom_edge(
            &mut world,
            20.0,
            0.0,
            edge(0.0, -3.0, 0.0, 3.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 0.0, y: 0.0 },
                radius: 1.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("circle shape cast should hit stored edge");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 19.0).abs() < 0.01);
        assert!((hit.point_x - 19.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_oriented_box_shape_against_stored_capsule() {
        let mut world = World::default();
        let enemy = spawn_custom_capsule(
            &mut world,
            20.0,
            0.0,
            capsule(0.0, -3.0, 0.0, 3.0, 2.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let axis = std::f32::consts::FRAC_1_SQRT_2;
        let expected_distance = 18.0 - (axis + 2.0 * axis);

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 0.0, y: 0.0 },
                half_width: 1.0,
                half_height: 2.0,
                rotation_radians: std::f32::consts::FRAC_PI_4,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("oriented box shape cast should hit stored capsule");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - expected_distance).abs() < 0.01);
        assert!((hit.point_x - expected_distance).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_capsule_shape_against_stored_capsule() {
        let mut world = World::default();
        let enemy = spawn_custom_capsule(
            &mut world,
            20.0,
            0.0,
            capsule(0.0, -3.0, 0.0, 3.0, 2.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: 0.0, y: -2.0 },
                end: Transform2D { x: 0.0, y: 2.0 },
                radius: 1.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("capsule shape cast should hit stored capsule");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 17.0).abs() < 0.01);
        assert!((hit.point_x - 17.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_capsule_shape_against_stored_edge() {
        let mut world = World::default();
        let enemy = spawn_custom_edge(
            &mut world,
            20.0,
            0.0,
            edge(0.0, -3.0, 0.0, 3.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: 0.0, y: -2.0 },
                end: Transform2D { x: 0.0, y: 2.0 },
                radius: 1.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("capsule shape cast should hit stored edge");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 19.0).abs() < 0.01);
        assert!((hit.point_x - 19.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_aabb_shape_against_stored_convex_polygon() {
        let mut world = World::default();
        let enemy = spawn_custom_convex_polygon(
            &mut world,
            20.0,
            0.0,
            convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let bounds = AabbBounds::from_center(Transform2D { x: 0.0, y: 0.0 }, 2.0, 2.0)
            .expect("shape cast bounds are valid");

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Aabb(bounds),
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("aabb shape cast should hit stored convex polygon");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 13.0).abs() < 0.01);
        assert!((hit.point_x - 13.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_circle_shape_against_stored_convex_polygon() {
        let mut world = World::default();
        let enemy = spawn_custom_convex_polygon(
            &mut world,
            20.0,
            0.0,
            convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 0.0, y: 0.0 },
                radius: 1.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("circle shape cast should hit stored convex polygon");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 14.0).abs() < 0.01);
        assert!((hit.point_x - 14.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_oriented_box_shape_against_stored_convex_polygon() {
        let mut world = World::default();
        let enemy = spawn_custom_convex_polygon(
            &mut world,
            20.0,
            0.0,
            convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let axis = std::f32::consts::FRAC_1_SQRT_2;
        let expected_distance = 15.0 - (4.0 * axis + 2.0 * axis);

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 0.0, y: 0.0 },
                half_width: 4.0,
                half_height: 2.0,
                rotation_radians: std::f32::consts::FRAC_PI_4,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("oriented box shape cast should hit stored convex polygon");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - expected_distance).abs() < 0.01);
        assert!((hit.point_x - expected_distance).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_capsule_shape_against_stored_convex_polygon() {
        let mut world = World::default();
        let enemy = spawn_custom_convex_polygon(
            &mut world,
            20.0,
            0.0,
            convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: 0.0, y: -2.0 },
                end: Transform2D { x: 0.0, y: 2.0 },
                radius: 1.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("capsule shape cast should hit stored convex polygon");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 14.0).abs() < 0.01);
        assert!((hit.point_x - 14.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_convex_polygon_shape_against_stored_convex_polygon() {
        let mut world = World::default();
        let enemy = spawn_custom_convex_polygon(
            &mut world,
            20.0,
            0.0,
            convex_polygon_collider(&[(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            convex_polygon(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("convex polygon shape cast should hit stored convex polygon");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 13.0).abs() < 0.01);
        assert!((hit.point_x - 13.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_convex_polygon_shape_against_aabb() {
        let mut world = World::default();
        let enemy = spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            convex_polygon(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("convex polygon shape cast should hit aabb");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 13.0).abs() < 0.01);
        assert!((hit.point_x - 13.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_convex_polygon_shape_against_circle() {
        let mut world = World::default();
        let enemy = spawn_custom_circle(
            &mut world,
            20.0,
            0.0,
            3.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            convex_polygon(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("convex polygon shape cast should hit circle");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 15.0).abs() < 0.01);
        assert!((hit.point_x - 15.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_convex_polygon_shape_against_stored_oriented_box() {
        let mut world = World::default();
        let enemy = spawn_custom_oriented_box(
            &mut world,
            20.0,
            0.0,
            oriented_box(5.0, 5.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            convex_polygon(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("convex polygon shape cast should hit stored oriented box");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 13.0).abs() < 0.01);
        assert!((hit.point_x - 13.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_convex_polygon_shape_against_stored_capsule() {
        let mut world = World::default();
        let enemy = spawn_custom_capsule(
            &mut world,
            20.0,
            0.0,
            capsule(0.0, -3.0, 0.0, 3.0, 2.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            convex_polygon(&[(-2.0, -2.0), (2.0, -2.0), (2.0, 2.0), (-2.0, 2.0)]),
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("convex polygon shape cast should hit stored capsule");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 16.0).abs() < 0.01);
        assert!((hit.point_x - 16.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_supports_zero_length_capsule_as_circle() {
        let mut world = World::default();
        let enemy = spawn_custom_body(
            &mut world,
            10.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D { x: 0.0, y: 0.0 },
                end: Transform2D { x: 0.0, y: 0.0 },
                radius: 2.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .expect("zero-length capsule shape cast should hit like a circle");

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 3.0).abs() < 0.01);
        assert!((hit.point_x - 3.0).abs() < 0.01);
        assert_eq!(hit.point_y, 0.0);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn shape_cast_all_sorts_hits_by_distance() {
        let mut world = World::default();
        let far = spawn_custom_body(
            &mut world,
            40.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let near = spawn_custom_circle(
            &mut world,
            20.0,
            0.0,
            4.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::shape_cast_all(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 0.0, y: 0.0 },
                radius: 2.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        );

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].entity, near);
        assert_eq!(hits[1].entity, far);
        assert!(hits[0].distance < hits[1].distance);
    }

    #[test]
    fn shape_cast_rejects_invalid_input() {
        let mut world = World::default();
        world.spawn_enemy(10.0, 0.0, 0);

        assert!(CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 0.0, y: 0.0 },
                radius: 0.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .is_none());
        assert!(CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Circle {
                center: Transform2D { x: 0.0, y: 0.0 },
                radius: 2.0,
            },
            Velocity { vx: 0.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .is_none());
        assert!(CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::Capsule {
                start: Transform2D {
                    x: f32::NAN,
                    y: 0.0,
                },
                end: Transform2D { x: 2.0, y: 0.0 },
                radius: 1.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .is_none());
        assert!(CollisionSystem::shape_cast(
            &world,
            CollisionQueryShape::OrientedBox {
                center: Transform2D { x: 0.0, y: 0.0 },
                half_width: 0.0,
                half_height: 2.0,
                rotation_radians: 0.0,
            },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .is_none());
    }

    #[test]
    fn raycast_returns_nearest_hit_with_surface_normal() {
        let mut world = World::default();
        let enemy = world.spawn_enemy(20.0, 10.0, 0);
        world.spawn_enemy(60.0, 10.0, 0);

        let hit = CollisionSystem::raycast(
            &world,
            Transform2D { x: 0.0, y: 10.0 },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .unwrap();

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 8.0).abs() < 0.01);
        assert!((hit.point_x - 8.0).abs() < 0.01);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn raycast_returns_circle_hit_with_surface_normal() {
        let mut world = World::default();
        let enemy = spawn_custom_circle(
            &mut world,
            20.0,
            10.0,
            4.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::raycast(
            &world,
            Transform2D { x: 0.0, y: 10.0 },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .unwrap();

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 16.0).abs() < 0.01);
        assert!((hit.point_x - 16.0).abs() < 0.01);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn raycast_returns_capsule_side_hit_with_surface_normal() {
        let mut world = World::default();
        let enemy = spawn_custom_capsule(
            &mut world,
            0.0,
            0.0,
            capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::raycast(
            &world,
            Transform2D { x: 0.0, y: 4.0 },
            Velocity { vx: 0.0, vy: -1.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .unwrap();

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 3.0).abs() < 0.01);
        assert!((hit.point_x - 0.0).abs() < 0.01);
        assert!((hit.point_y - 1.0).abs() < 0.01);
        assert_eq!(hit.normal_x, 0.0);
        assert_eq!(hit.normal_y, 1.0);
    }

    #[test]
    fn raycast_returns_edge_hit_with_surface_normal() {
        let mut world = World::default();
        let enemy = spawn_custom_edge(
            &mut world,
            0.0,
            0.0,
            edge(-5.0, 0.0, 5.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::raycast(
            &world,
            Transform2D { x: 0.0, y: 4.0 },
            Velocity { vx: 0.0, vy: -1.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .unwrap();

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 4.0).abs() < 0.01);
        assert!((hit.point_x - 0.0).abs() < 0.01);
        assert!((hit.point_y - 0.0).abs() < 0.01);
        assert_eq!(hit.normal_x, 0.0);
        assert_eq!(hit.normal_y, 1.0);
    }

    #[test]
    fn segment_cast_returns_edge_hit() {
        let mut world = World::default();
        let enemy = spawn_custom_edge(
            &mut world,
            0.0,
            0.0,
            edge(-5.0, 0.0, 5.0, 0.0),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::segment_cast(
            &world,
            Transform2D { x: 0.0, y: 4.0 },
            Transform2D { x: 0.0, y: -4.0 },
            CollisionMask::ENEMY,
        )
        .unwrap();

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 4.0).abs() < 0.01);
        assert!((hit.point_y - 0.0).abs() < 0.01);
        assert_eq!(hit.normal_x, 0.0);
        assert_eq!(hit.normal_y, 1.0);
    }

    #[test]
    fn raycast_returns_oriented_box_hit_with_surface_normal() {
        let mut world = World::default();
        let enemy = spawn_custom_oriented_box(
            &mut world,
            0.0,
            0.0,
            oriented_box(4.0, 1.0, core::f32::consts::FRAC_PI_4),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::raycast(
            &world,
            Transform2D { x: 0.0, y: 6.0 },
            Velocity { vx: 0.0, vy: -1.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .unwrap();

        assert_eq!(hit.entity, enemy);
        assert!(hit.distance > 1.0);
        assert!(hit.distance < 6.0);
        assert!(hit.point_y < 6.0);
        assert!(hit.normal_y > 0.0);
    }

    #[test]
    fn raycast_returns_convex_polygon_hit_with_surface_normal() {
        let mut world = World::default();
        let enemy = spawn_custom_convex_polygon(
            &mut world,
            0.0,
            0.0,
            convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hit = CollisionSystem::raycast(
            &world,
            Transform2D { x: -6.0, y: 0.0 },
            Velocity { vx: 1.0, vy: 0.0 },
            100.0,
            CollisionMask::ENEMY,
        )
        .unwrap();

        assert_eq!(hit.entity, enemy);
        assert!((hit.distance - 4.0).abs() < 0.01);
        assert!((hit.point_x + 2.0).abs() < 0.01);
        assert!((hit.point_y - 0.0).abs() < 0.01);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn segment_cast_limits_hits_to_segment_endpoints() {
        let mut world = World::default();
        let near = spawn_custom_circle(
            &mut world,
            20.0,
            0.0,
            4.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        spawn_custom_body(
            &mut world,
            40.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::segment_cast_all(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            Transform2D { x: 30.0, y: 0.0 },
            CollisionMask::ENEMY,
        );
        let hit = CollisionSystem::segment_cast(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            Transform2D { x: 30.0, y: 0.0 },
            CollisionMask::ENEMY,
        )
        .expect("segment cast should hit near circle");

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].entity, near);
        assert_eq!(hit.entity, near);
        assert!((hit.distance - 16.0).abs() < 0.01);
        assert!((hit.point_x - 16.0).abs() < 0.01);
        assert_eq!(hit.normal_x, -1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn segment_cast_all_sorts_hits_by_distance() {
        let mut world = World::default();
        let far = spawn_custom_circle(
            &mut world,
            40.0,
            0.0,
            4.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );
        let near = spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::ENEMY,
        );

        let hits = CollisionSystem::segment_cast_all(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            Transform2D { x: 60.0, y: 0.0 },
            CollisionMask::ENEMY,
        );

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].entity, near);
        assert_eq!(hits[1].entity, far);
        assert!(hits[0].distance < hits[1].distance);
    }

    #[test]
    fn segment_cast_rejects_invalid_or_zero_length_segment() {
        let mut world = World::default();
        world.spawn_enemy(10.0, 0.0, 0);

        assert!(CollisionSystem::segment_cast(
            &world,
            Transform2D { x: 0.0, y: 0.0 },
            Transform2D { x: 0.0, y: 0.0 },
            CollisionMask::ENEMY,
        )
        .is_none());
        assert!(CollisionSystem::segment_cast_all(
            &world,
            Transform2D {
                x: f32::NAN,
                y: 0.0,
            },
            Transform2D { x: 20.0, y: 0.0 },
            CollisionMask::ENEMY,
        )
        .is_empty());
    }

    #[test]
    fn swept_aabb_contact_reports_entry_normal() {
        let hit = CollisionSystem::swept_aabb_contact(
            Transform2D { x: 0.0, y: 0.0 },
            Velocity { vx: 100.0, vy: 0.0 },
            collider(1.0, 1.0),
            Transform2D { x: 50.0, y: 0.0 },
            Velocity::default(),
            collider(5.0, 5.0),
            1.0,
        )
        .unwrap();

        assert!((hit.time - 0.44).abs() < 0.01);
        assert_eq!(hit.normal_x, 1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn swept_aabb_contact_rejects_disabled_colliders() {
        assert!(CollisionSystem::swept_aabb_contact(
            Transform2D { x: 0.0, y: 0.0 },
            Velocity { vx: 10.0, vy: 0.0 },
            collider(1.0, 1.0).with_enabled(false),
            Transform2D { x: 5.0, y: 0.0 },
            Velocity::default(),
            collider(1.0, 1.0),
            1.0,
        )
        .is_none());
    }

    #[test]
    fn swept_aabb_contact_respects_collider_offsets() {
        let hit = CollisionSystem::swept_aabb_contact(
            Transform2D { x: 0.0, y: 0.0 },
            Velocity { vx: 10.0, vy: 0.0 },
            collider(1.0, 1.0).with_offset(4.0, 0.0),
            Transform2D { x: 8.0, y: 0.0 },
            Velocity::default(),
            collider(1.0, 1.0),
            1.0,
        )
        .unwrap();

        assert!((hit.time - 0.2).abs() < 0.01);
        assert_eq!(hit.normal_x, 1.0);
        assert_eq!(hit.normal_y, 0.0);
    }

    #[test]
    fn build_pairs_into_reuses_scratch_and_pair_buffers() {
        let mut world = World::default();
        world.spawn_player(10.0, 10.0, 0);
        world.spawn_enemy(12.0, 10.0, 0);
        let mut scratch = CollisionScratch::default();
        let mut pairs = Vec::with_capacity(4);

        CollisionSystem::build_layer_pairs_into(
            &mut scratch,
            &world,
            CollisionLayer::Player,
            CollisionLayer::Enemy,
            &mut pairs,
        );
        let proxy_capacity = scratch.current_proxies.capacity();
        let pair_capacity = pairs.capacity();

        CollisionSystem::build_layer_pairs_into(
            &mut scratch,
            &World::default(),
            CollisionLayer::Player,
            CollisionLayer::Enemy,
            &mut pairs,
        );

        assert!(pairs.is_empty());
        assert_eq!(scratch.current_proxies.capacity(), proxy_capacity);
        assert_eq!(pairs.capacity(), pair_capacity);
    }

    #[test]
    fn swept_aabb_time_detects_fast_pass_through() {
        let hit = CollisionSystem::swept_aabb_time(
            Transform2D { x: 0.0, y: 0.0 },
            Velocity { vx: 100.0, vy: 0.0 },
            collider(1.0, 1.0),
            Transform2D { x: 50.0, y: 0.0 },
            Velocity::default(),
            collider(5.0, 5.0),
            1.0,
        )
        .unwrap();

        assert!((hit.time - 0.44).abs() < 0.01);
    }

    #[test]
    fn swept_layer_pairs_detects_fast_bullet_enemy_pass_through() {
        let mut world = World::default();
        let bullet = world.spawn_bullet(100.0, 50.0, 1000.0, 0.0, 0);
        let enemy = world.spawn_enemy(150.0, 50.0, 0);
        world.transforms[bullet.id as usize] = Some(Transform2D { x: 200.0, y: 50.0 });

        let pairs = CollisionSystem::build_swept_layer_pairs(
            &world,
            CollisionLayer::Bullet,
            CollisionLayer::Enemy,
            0.1,
        );

        assert_eq!(
            pairs,
            vec![CollisionPair {
                a: bullet,
                b: enemy
            }]
        );
    }

    #[test]
    fn compound_collider_secondary_shape_participates_in_queries_contacts_and_debug() {
        let mut world = World::default();
        let compound = spawn_custom_body(
            &mut world,
            0.0,
            0.0,
            CollisionMask::ENEMY,
            CollisionMask::PLAYER,
        );
        let target = spawn_custom_body(
            &mut world,
            20.0,
            0.0,
            CollisionMask::PLAYER,
            CollisionMask::ENEMY,
        );
        assert_eq!(
            world.add_compound_collider(
                compound,
                CompoundCollider::new(CompoundColliderShape::Circle(
                    CircleCollider::new(6.0, false, CollisionLayer::Enemy).with_offset(20.0, 0.0),
                ))
                .with_filter(CollisionFilter::new(
                    CollisionMask::ENEMY,
                    CollisionMask::PLAYER,
                )),
            ),
            Some(1)
        );

        let point_hits = CollisionSystem::point_query(
            &world,
            Transform2D { x: 20.0, y: 0.0 },
            CollisionMask::ENEMY,
        );
        assert_eq!(point_hits, vec![PointQueryHit { entity: compound }]);

        let contacts = CollisionSystem::build_contacts(&world);
        assert!(
            contacts.iter().any(|contact| {
                (contact.pair.a == compound && contact.pair.b == target)
                    || (contact.pair.a == target && contact.pair.b == compound)
            }),
            "secondary compound collider should contact target, got {contacts:?}"
        );

        let collider_lines = CollisionSystem::build_physics_debug_lines_with_flags(
            &world,
            4.0,
            PHYSICS_DEBUG_COLLIDERS,
        );
        assert!(
            collider_lines.len() > 8,
            "compound body should draw primary and secondary collider outlines"
        );

        world.set_aabb_collider(
            compound,
            AabbCollider::new(7.0, 7.0, true, CollisionLayer::Player).with_offset(-10.0, 0.0),
        );
        assert_eq!(
            world.compound_collider_count(compound),
            2,
            "single-collider API should update the primary collider without dropping secondary colliders"
        );
        let point_hits_after_primary_update = CollisionSystem::point_query(
            &world,
            Transform2D { x: 20.0, y: 0.0 },
            CollisionMask::ENEMY,
        );
        assert_eq!(
            point_hits_after_primary_update,
            vec![PointQueryHit { entity: compound }]
        );
    }

    #[test]
    fn chain_collider_segments_participate_in_queries_contacts_and_debug_lines() {
        let mut world = World::default();
        let chain = spawn_custom_chain(
            &mut world,
            0.0,
            0.0,
            chain(&[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0)], false),
            CollisionMask::WALL,
            CollisionMask::PLAYER,
        );
        let player = spawn_custom_circle(
            &mut world,
            10.0,
            5.0,
            1.0,
            CollisionMask::PLAYER,
            CollisionMask::WALL,
        );

        let aabb_hits = CollisionSystem::aabb_query(
            &world,
            AabbBounds::from_center(Transform2D { x: 10.0, y: 5.0 }, 1.0, 1.0)
                .expect("valid query bounds"),
            CollisionMask::WALL,
        );
        assert_eq!(aabb_hits, vec![AabbQueryHit { entity: chain }]);

        let contacts = CollisionSystem::build_contacts(&world);
        assert!(
            contacts.iter().any(|contact| {
                (contact.pair.a == chain && contact.pair.b == player)
                    || (contact.pair.a == player && contact.pair.b == chain)
            }),
            "chain segment should contact circle body, got {contacts:?}"
        );

        let hits = CollisionSystem::raycast_all(
            &world,
            Transform2D { x: 15.0, y: 5.0 },
            Velocity { vx: -1.0, vy: 0.0 },
            20.0,
            CollisionMask::WALL,
        );
        assert_eq!(hits.first().map(|hit| hit.entity), Some(chain));

        let debug_lines = CollisionSystem::build_physics_debug_lines_with_flags(
            &world,
            4.0,
            PHYSICS_DEBUG_COLLIDERS,
        );
        assert!(debug_lines.iter().any(|line| {
            (line.x0 - 0.0).abs() < 0.0001
                && (line.y0 - 0.0).abs() < 0.0001
                && (line.x1 - 10.0).abs() < 0.0001
                && (line.y1 - 0.0).abs() < 0.0001
        }));
        assert!(debug_lines.iter().any(|line| {
            (line.x0 - 10.0).abs() < 0.0001
                && (line.y0 - 0.0).abs() < 0.0001
                && (line.x1 - 10.0).abs() < 0.0001
                && (line.y1 - 10.0).abs() < 0.0001
        }));
    }

    fn spawn_custom_body(
        world: &mut World,
        x: f32,
        y: f32,
        category: CollisionMask,
        mask: CollisionMask,
    ) -> Entity {
        let entity = world.spawn_entity();
        let index = entity.id as usize;
        world.transforms[index] = Some(Transform2D { x, y });
        world.colliders[index] = Some(AabbCollider {
            half_width: 5.0,
            half_height: 5.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: true,
            layer: CollisionLayer::Player,
        });
        world.collision_filters[index] = Some(CollisionFilter::new(category, mask));
        entity
    }

    fn spawn_custom_circle(
        world: &mut World,
        x: f32,
        y: f32,
        radius: f32,
        category: CollisionMask,
        mask: CollisionMask,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_circle_collider(entity, circle(radius));
        world.set_collision_filter(entity, CollisionFilter::new(category, mask));
        entity
    }

    fn spawn_custom_capsule(
        world: &mut World,
        x: f32,
        y: f32,
        collider: CapsuleCollider,
        category: CollisionMask,
        mask: CollisionMask,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_capsule_collider(entity, collider);
        world.set_collision_filter(entity, CollisionFilter::new(category, mask));
        entity
    }

    fn spawn_custom_edge(
        world: &mut World,
        x: f32,
        y: f32,
        collider: EdgeCollider,
        category: CollisionMask,
        mask: CollisionMask,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_edge_collider(entity, collider);
        world.set_collision_filter(entity, CollisionFilter::new(category, mask));
        entity
    }

    fn spawn_custom_chain(
        world: &mut World,
        x: f32,
        y: f32,
        collider: ChainCollider,
        category: CollisionMask,
        mask: CollisionMask,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_chain_collider(entity, collider);
        world.set_collision_filter(entity, CollisionFilter::new(category, mask));
        entity
    }

    fn spawn_custom_oriented_box(
        world: &mut World,
        x: f32,
        y: f32,
        collider: OrientedBoxCollider,
        category: CollisionMask,
        mask: CollisionMask,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_oriented_box_collider(entity, collider);
        world.set_collision_filter(entity, CollisionFilter::new(category, mask));
        entity
    }

    fn spawn_custom_convex_polygon(
        world: &mut World,
        x: f32,
        y: f32,
        collider: ConvexPolygonCollider,
        category: CollisionMask,
        mask: CollisionMask,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_convex_polygon_collider(entity, collider);
        world.set_collision_filter(entity, CollisionFilter::new(category, mask));
        entity
    }

    fn chain(points: &[(f32, f32)], looped: bool) -> ChainCollider {
        let mut vertices =
            [Transform2D { x: 0.0, y: 0.0 }; crate::components::MAX_CHAIN_COLLIDER_VERTICES];
        for (index, (x, y)) in points.iter().copied().enumerate() {
            vertices[index] = Transform2D { x, y };
        }
        ChainCollider::new(
            vertices,
            points.len() as u32,
            looped,
            false,
            CollisionLayer::Wall,
        )
    }
}

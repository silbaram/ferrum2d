use crate::components::{
    AabbCollider, CapsuleCollider, ChainCollider, CircleCollider, CollisionLayer, CollisionMask,
    ConvexPolygonCollider, EdgeCollider, OrientedBoxCollider, PulleyJoint, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::world::World;

mod aabb_manifold;
mod bounds;
mod broadphase;
mod capsule_manifold;
mod cast_primitives;
mod collider_shapes;
mod contact_manifold;
mod contact_points;
mod contact_primitives;
mod contacts;
mod convex_contact;
mod convex_manifold;
mod debug;
mod face_manifold;
mod filters;
mod geometry;
mod manifold_points;
mod narrowphase;
mod oriented_box_geometry;
mod oriented_box_manifold;
mod overlap;
mod overlap_primitives;
mod overlap_shapes;
mod query;
mod raycast;
mod shape_cast;
mod shape_contact;
mod shape_projection;
use shape_cast::shape_cast_hit;
use shape_contact::shape_contact;
mod types;
mod validation;

const SWEPT_EPSILON: f32 = 0.0001;
const RAY_EPSILON: f32 = 0.0001;
const EDGE_COLLIDER_RADIUS: f32 = RAY_EPSILON;
pub const MAX_COLLISION_MANIFOLD_POINTS: usize = 2;
pub use crate::components::MAX_CONVEX_POLYGON_VERTICES;
pub const PHYSICS_DEBUG_BROADPHASE: u32 = 1 << 0;
pub const PHYSICS_DEBUG_CONTACTS: u32 = 1 << 1;
pub const PHYSICS_DEBUG_COLLIDERS: u32 = 1 << 2;
pub const PHYSICS_DEBUG_JOINTS: u32 = 1 << 3;
pub const PHYSICS_DEBUG_SLEEPING: u32 = 1 << 4;
pub const PHYSICS_DEBUG_CCD: u32 = 1 << 5;
pub const PHYSICS_DEBUG_DEFAULT: u32 = PHYSICS_DEBUG_BROADPHASE | PHYSICS_DEBUG_CONTACTS;

use aabb_manifold::{
    aabb_aabb_contact_manifold_points, aabb_capsule_arc_clipped_contact_manifold_points,
    aabb_capsule_contact_manifold_points, aabb_capsule_endpoint_contact_manifold_points,
    aabb_capsule_side_contact_segment, aabb_circle_contact_manifold_points,
};
pub(crate) use bounds::collider_bounds;
use bounds::{
    aabb_bounds_vertices, aabb_corners, capsule_side_bounds, inflate_bounds,
    query_aabb_half_extents, query_shape_sweep_bounds,
};
pub(crate) use broadphase::{
    CollisionScratch, KinematicSweepCandidateQuery, RigidBodyCcdCandidateQuery,
};
use capsule_manifold::{
    capsule_capsule_contact_manifold_points, capsule_circle_contact_manifold_points,
};
use cast_primitives::*;
pub(crate) use collider_shapes::collider_shape;
use collider_shapes::{
    collider_query_shape, collider_segment_count_at, collider_shape_at_segment,
    collider_shape_center, collider_shape_is_valid, edge_as_capsule,
};
use contact_manifold::contact_manifold_points;
use contact_points::{
    aabb_capsule_contact_point, capsule_capsule_contact_point, contact_point,
    oriented_box_capsule_contact_point, oriented_box_oriented_box_contact_point,
};
use contact_primitives::{
    aabb_capsule_contact, aabb_circle_contact, aabb_contact, capsule_capsule_contact,
    capsule_circle_contact, circle_contact, invert_contact, oriented_box_capsule_contact,
    oriented_box_circle_contact, oriented_box_oriented_box_contact,
};
use convex_contact::{
    convex_contact_geometry_from_shape, convex_shape_contact_from_shapes,
    convex_shape_contact_point, ConvexContactGeometry,
};
use convex_manifold::convex_polygon_contact_manifold_points;
use face_manifold::{
    append_face_clipped_contact_point, capsule_face_arc_clipped_contact_manifold_points,
    capsule_face_tangent_interval, circle_face_contact_manifold_points,
    clip_segment_to_face_tangent_interval, contact_face_point, point_tangent_projection,
};
use filters::{
    collider_pair_has_trigger, filters_allow, filters_allow_collider_pair, mask_contains_collider,
    mask_contains_entity, orient_layer_pair, orient_mask_pair,
};
use geometry::{
    aabb_center, axis_entry_exit, capsule_aabb_reference_point, closest_point_on_aabb,
    closest_point_on_segment, closest_points_on_segments, closest_segment_aabb_pair, cross_points,
    fallback_contact_normal, nearest_aabb_face, normalized_direction, point_aabb_distance_squared,
    point_distance_squared, point_segment_distance_squared, ray_axis_entry_exit,
    segment_direction_and_distance, segment_intersection_point, segment_intersects_aabb,
    segment_segment_distance_squared, segments_intersect,
};
use manifold_points::{
    append_contact_manifold_point_by_depth, empty_contact_point, single_contact_manifold_point,
    two_or_one_contact_manifold_points,
};
use narrowphase::{
    contact_from_collider_pair, manifold_from_collider_pair, precise_current_overlap,
};
use oriented_box_geometry::{
    aabb_as_oriented_box, nearest_point_on_oriented_box, oriented_box_geometry,
    oriented_box_local_motion, oriented_box_local_point, oriented_box_local_vector,
    oriented_box_world_hit, oriented_box_world_point, oriented_box_world_vector,
    OrientedBoxGeometry,
};
use oriented_box_manifold::{
    oriented_box_capsule_contact_manifold_points, oriented_box_circle_contact_manifold_points,
    oriented_box_oriented_box_contact_manifold_points,
};
use overlap::{
    collider_contains_point, collider_overlaps_aabb, collider_overlaps_circle,
    query_shape_overlaps_collider, shapes_overlap,
};
use overlap_primitives::circle_contains_point;
use overlap_shapes::{
    convex_polygon_contains_point, convex_polygon_overlaps_aabb, convex_polygon_overlaps_capsule,
    convex_polygon_overlaps_circle, convex_polygon_overlaps_oriented_box,
    oriented_box_contains_point, oriented_box_overlaps_aabb, oriented_box_overlaps_capsule,
    oriented_box_overlaps_circle, oriented_boxes_overlap,
};
use shape_projection::{
    convex_polygons_overlap, oriented_box_projection_radius, oriented_box_vertices,
    project_vertices,
};
pub use types::{
    AabbBounds, AabbContact, AabbQueryHit, CircleQueryHit, CollisionContact, CollisionContactPoint,
    CollisionManifold, CollisionPair, CollisionQueryShape, NearestBodyQueryHit, PhysicsDebugLine,
    PointQueryHit, RaycastHit, ShapeCastHit, ShapeQueryHit, SweptAabbContactHit, SweptAabbHit,
};
pub(crate) use types::{
    ColliderCollisionContact, ColliderCollisionManifold, ColliderKey, ColliderPair,
    SweptShapeContactHit,
};
use validation::*;

#[derive(Clone, Copy, Debug)]
struct AxisEntryExit {
    entry: f32,
    exit: f32,
    normal: f32,
}

#[derive(Clone, Copy, Debug)]
struct ClosestPointPair {
    a: Transform2D,
    b: Transform2D,
    distance_squared: f32,
}

#[derive(Clone, Copy, Debug)]
struct ContactFace {
    center: Transform2D,
    normal: Velocity,
    tangent: Velocity,
    tangent_extent: f32,
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

fn entity_from_index(world: &World, index: usize) -> Entity {
    world
        .entity_at_index(index)
        .expect("collision pair indices are built from live world entities")
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

fn dot_velocity(a: Velocity, b: Velocity) -> f32 {
    a.vx * b.vx + a.vy * b.vy
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

fn precise_swept_overlap(
    world: &World,
    moving_index: usize,
    target_index: usize,
    delta: f32,
) -> bool {
    let Some(moving_transform) = world.transform_at_index(moving_index) else {
        return false;
    };
    let Some(moving_collider) = world.colliders[moving_index] else {
        return false;
    };
    if !moving_collider.enabled {
        return false;
    }
    let Some(target_transform) = world.transform_at_index(target_index) else {
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

    let moving_velocity = world.velocity_at_index_or_default(moving_index);
    let target_velocity = world.velocity_at_index_or_default(target_index);
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

#[cfg(test)]
mod tests;

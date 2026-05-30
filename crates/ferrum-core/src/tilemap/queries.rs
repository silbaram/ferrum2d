use super::collision_cache::TileCollisionRect;
use super::Hd2dTileDefinition;
use super::{
    TileSlopeDefinition, TilemapContactHit, TilemapContactManifoldHit, TilemapContactPoint,
    TilemapLayer, TilemapNearestObstacleHit, TilemapShapeCastHit, TilemapSlopeGroundHit,
    TilemapSweepHit, MAX_TILEMAP_CONTACT_MANIFOLD_POINTS, TILE_GROUND_NORMAL_Y_MIN,
    TILE_SWEEP_EPSILON,
};
use crate::collision::{AabbBounds, AabbContact, CollisionSystem, SweptAabbContactHit};
use crate::components::{AabbCollider, CollisionLayer, HeightSpan, Transform2D, Velocity};

pub(super) fn one_way_tile_contact_blocks(
    start: Transform2D,
    collider: AabbCollider,
    displacement: Velocity,
    tile_bounds: AabbBounds,
    contact: SweptAabbContactHit,
) -> bool {
    if displacement.vy <= TILE_SWEEP_EPSILON || contact.normal_y < TILE_GROUND_NORMAL_Y_MIN {
        return false;
    }
    let mover_bottom = collider.center(start).y + collider.half_height;
    mover_bottom <= tile_bounds.min_y + TILE_SWEEP_EPSILON
}

#[allow(clippy::too_many_arguments)]
pub(super) fn tilemap_shape_cast_hit_from_contact(
    start: Transform2D,
    collider: AabbCollider,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    layer_index: usize,
    tile_index: usize,
    contact: SweptAabbContactHit,
) -> TilemapShapeCastHit {
    let distance = contact.time.clamp(0.0, 1.0) * max_distance;
    let reference = collider.center(start);
    TilemapShapeCastHit {
        layer_index,
        tile_index,
        distance,
        point_x: reference.x + unit_x * distance,
        point_y: reference.y + unit_y * distance,
        normal_x: -contact.normal_x,
        normal_y: -contact.normal_y,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn tilemap_contact_hit_from_contact(
    transform: Transform2D,
    collider: AabbCollider,
    static_transform: Transform2D,
    static_collider: AabbCollider,
    layer_index: usize,
    tile_index: usize,
    contact: AabbContact,
) -> TilemapContactHit {
    let (point_x, point_y) = tilemap_aabb_contact_point(
        transform,
        collider,
        static_transform,
        static_collider,
        contact,
    );
    TilemapContactHit {
        layer_index,
        tile_index,
        normal_x: -contact.normal_x,
        normal_y: -contact.normal_y,
        penetration: contact.penetration,
        point_x,
        point_y,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn tilemap_contact_manifold_hit_from_contact(
    transform: Transform2D,
    collider: AabbCollider,
    static_transform: Transform2D,
    static_collider: AabbCollider,
    layer_index: usize,
    tile_index: usize,
    contact: AabbContact,
) -> Option<TilemapContactManifoldHit> {
    let (points, point_count) = tilemap_aabb_contact_manifold_points(
        transform,
        collider,
        static_transform,
        static_collider,
        contact,
    );
    (point_count > 0).then_some(TilemapContactManifoldHit {
        layer_index,
        tile_index,
        point_count,
        normal_x: -contact.normal_x,
        normal_y: -contact.normal_y,
        penetration: contact.penetration,
        points,
    })
}

pub(super) fn tilemap_aabb_contact_point(
    transform: Transform2D,
    collider: AabbCollider,
    static_transform: Transform2D,
    static_collider: AabbCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let bounds = AabbBounds::from_transform(transform, collider);
    let static_bounds = AabbBounds::from_transform(static_transform, static_collider);
    let center = collider.center(transform);
    if contact.normal_x != 0.0 {
        let min_y = bounds.min_y.max(static_bounds.min_y);
        let max_y = bounds.max_y.min(static_bounds.max_y);
        (
            center.x + contact.normal_x * collider.half_width,
            (min_y + max_y) * 0.5,
        )
    } else {
        let min_x = bounds.min_x.max(static_bounds.min_x);
        let max_x = bounds.max_x.min(static_bounds.max_x);
        (
            (min_x + max_x) * 0.5,
            center.y + contact.normal_y * collider.half_height,
        )
    }
}

pub(super) fn tilemap_aabb_contact_manifold_points(
    transform: Transform2D,
    collider: AabbCollider,
    static_transform: Transform2D,
    static_collider: AabbCollider,
    contact: AabbContact,
) -> (
    [TilemapContactPoint; MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
    u32,
) {
    let bounds = AabbBounds::from_transform(transform, collider);
    let static_bounds = AabbBounds::from_transform(static_transform, static_collider);
    let center = collider.center(transform);
    if contact.normal_x != 0.0 {
        let min_y = bounds.min_y.max(static_bounds.min_y);
        let max_y = bounds.max_y.min(static_bounds.max_y);
        let face_x = center.x + contact.normal_x * collider.half_width;
        tilemap_two_or_one_contact_points(face_x, min_y, face_x, max_y, contact.penetration)
    } else {
        let min_x = bounds.min_x.max(static_bounds.min_x);
        let max_x = bounds.max_x.min(static_bounds.max_x);
        let face_y = center.y + contact.normal_y * collider.half_height;
        tilemap_two_or_one_contact_points(min_x, face_y, max_x, face_y, contact.penetration)
    }
}

pub(super) fn tilemap_two_or_one_contact_points(
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    penetration: f32,
) -> (
    [TilemapContactPoint; MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
    u32,
) {
    if !x0.is_finite()
        || !y0.is_finite()
        || !x1.is_finite()
        || !y1.is_finite()
        || !penetration.is_finite()
    {
        return tilemap_empty_contact_manifold_points();
    }

    let dx = x1 - x0;
    let dy = y1 - y0;
    if dx * dx + dy * dy <= TILE_SWEEP_EPSILON * TILE_SWEEP_EPSILON {
        return (
            [
                TilemapContactPoint {
                    point_x: (x0 + x1) * 0.5,
                    point_y: (y0 + y1) * 0.5,
                    penetration,
                },
                TilemapContactPoint::default(),
            ],
            1,
        );
    }

    (
        [
            TilemapContactPoint {
                point_x: x0,
                point_y: y0,
                penetration,
            },
            TilemapContactPoint {
                point_x: x1,
                point_y: y1,
                penetration,
            },
        ],
        2,
    )
}

pub(super) fn tilemap_empty_contact_manifold_points() -> (
    [TilemapContactPoint; MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
    u32,
) {
    (
        [TilemapContactPoint::default(); MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
        0,
    )
}

pub(super) fn tile_aabb_query_is_valid(start: Transform2D, collider: AabbCollider) -> bool {
    collider.enabled
        && is_tilemap_blocked_layer(collider.layer)
        && AabbBounds::from_center(
            collider.center(start),
            collider.half_width,
            collider.half_height,
        )
        .is_some()
}

pub(super) fn tile_shape_cast_query_is_valid(
    start: Transform2D,
    collider: AabbCollider,
    max_distance: f32,
) -> bool {
    tile_aabb_query_is_valid(start, collider) && max_distance.is_finite() && max_distance >= 0.0
}

pub(super) fn tile_shape_cast_unit_direction(direction: Velocity) -> Option<(f32, f32)> {
    if !direction.vx.is_finite() || !direction.vy.is_finite() {
        return None;
    }
    let length = (direction.vx * direction.vx + direction.vy * direction.vy).sqrt();
    if length <= TILE_SWEEP_EPSILON {
        None
    } else {
        Some((direction.vx / length, direction.vy / length))
    }
}

pub(super) fn tile_raycast_query_is_valid(origin: Transform2D, max_distance: f32) -> bool {
    origin.x.is_finite() && origin.y.is_finite() && max_distance.is_finite() && max_distance >= 0.0
}

pub(super) fn tile_segment_direction_and_distance(
    start: Transform2D,
    end: Transform2D,
) -> Option<(Velocity, f32)> {
    if !start.x.is_finite() || !start.y.is_finite() || !end.x.is_finite() || !end.y.is_finite() {
        return None;
    }
    let direction = Velocity {
        vx: end.x - start.x,
        vy: end.y - start.y,
    };
    let distance = (direction.vx * direction.vx + direction.vy * direction.vy).sqrt();
    (distance > TILE_SWEEP_EPSILON).then_some((direction, distance))
}

pub(super) fn tile_raycast_bounds(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
) -> Option<AabbBounds> {
    let end_x = origin.x + unit_x * max_distance;
    let end_y = origin.y + unit_y * max_distance;
    AabbBounds::from_min_max(
        origin.x.min(end_x) - TILE_SWEEP_EPSILON,
        origin.y.min(end_y) - TILE_SWEEP_EPSILON,
        origin.x.max(end_x) + TILE_SWEEP_EPSILON,
        origin.y.max(end_y) + TILE_SWEEP_EPSILON,
    )
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct TilemapRaycastBoundsHit {
    pub(super) distance: f32,
    pub(super) normal_x: f32,
    pub(super) normal_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct TileRayAxisEntryExit {
    pub(super) entry: f32,
    pub(super) exit: f32,
    pub(super) normal: f32,
}

pub(super) fn tilemap_raycast_bounds(
    origin: Transform2D,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    bounds: AabbBounds,
) -> Option<TilemapRaycastBoundsHit> {
    if bounds.contains_point(origin) {
        return Some(TilemapRaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let x = tile_ray_axis_entry_exit(origin.x, unit_x, bounds.min_x, bounds.max_x)?;
    let y = tile_ray_axis_entry_exit(origin.y, unit_y, bounds.min_y, bounds.max_y)?;
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

    Some(TilemapRaycastBoundsHit {
        distance,
        normal_x,
        normal_y,
    })
}

pub(super) fn tile_ray_axis_entry_exit(
    start: f32,
    direction: f32,
    min: f32,
    max: f32,
) -> Option<TileRayAxisEntryExit> {
    if direction.abs() <= TILE_SWEEP_EPSILON {
        return (start >= min && start <= max).then_some(TileRayAxisEntryExit {
            entry: f32::NEG_INFINITY,
            exit: f32::INFINITY,
            normal: 0.0,
        });
    }

    let inv_direction = direction.recip();
    let first = (min - start) * inv_direction;
    let second = (max - start) * inv_direction;
    if first <= second {
        Some(TileRayAxisEntryExit {
            entry: first,
            exit: second,
            normal: -1.0,
        })
    } else {
        Some(TileRayAxisEntryExit {
            entry: second,
            exit: first,
            normal: 1.0,
        })
    }
}

pub(super) fn sort_tile_linear_hits(hits: &mut [TilemapShapeCastHit]) {
    hits.sort_by(|a, b| {
        a.distance
            .total_cmp(&b.distance)
            .then_with(|| a.layer_index.cmp(&b.layer_index))
            .then_with(|| a.tile_index.cmp(&b.tile_index))
    });
}

pub(super) fn tile_height_span_allows(
    rect: TileCollisionRect,
    query_height_span: Option<HeightSpan>,
) -> bool {
    match query_height_span {
        Some(query_span) => rect
            .height_span
            .is_some_and(|tile_span| query_span.overlaps(tile_span)),
        None => true,
    }
}

pub(super) fn tile_height_span_allows_movement(
    rect: TileCollisionRect,
    query_height_span: Option<HeightSpan>,
) -> bool {
    match query_height_span {
        Some(query_span) => rect
            .height_span
            .is_none_or(|tile_span| query_span.overlaps(tile_span)),
        None => true,
    }
}

pub(super) fn tile_id_height_span_allows(
    tile_id: u32,
    height_span_definitions: &[Option<HeightSpan>],
    query_height_span: Option<HeightSpan>,
) -> bool {
    match query_height_span {
        Some(query_span) => height_span_definitions
            .get(tile_id as usize)
            .and_then(|height_span| *height_span)
            .is_some_and(|tile_span| query_span.overlaps(tile_span)),
        None => true,
    }
}

pub(super) fn tile_id_height_span_allows_movement(
    tile_id: u32,
    height_span_definitions: &[Option<HeightSpan>],
    query_height_span: Option<HeightSpan>,
) -> bool {
    match query_height_span {
        Some(query_span) => height_span_definitions
            .get(tile_id as usize)
            .and_then(|height_span| *height_span)
            .is_none_or(|tile_span| query_span.overlaps(tile_span)),
        None => true,
    }
}

pub(super) fn tile_id_blocks_movement(
    tile_id: u32,
    hd2d_definitions: &[Option<Hd2dTileDefinition>],
) -> bool {
    tile_id != 0
        && hd2d_definitions
            .get(tile_id as usize)
            .and_then(|definition| *definition)
            .is_none_or(|definition| definition.blocks_movement)
}

pub(super) fn tile_id_blocks_projectile(
    tile_id: u32,
    hd2d_definitions: &[Option<Hd2dTileDefinition>],
) -> bool {
    tile_id != 0
        && hd2d_definitions
            .get(tile_id as usize)
            .and_then(|definition| *definition)
            .is_none_or(|definition| definition.blocks_projectile)
}

pub(super) fn tile_slope_definition_from_values(
    local_x0: f32,
    local_y0: f32,
    local_x1: f32,
    local_y1: f32,
) -> Option<TileSlopeDefinition> {
    if !is_normalized(local_x0)
        || !is_normalized(local_y0)
        || !is_normalized(local_x1)
        || !is_normalized(local_y1)
        || (local_x1 - local_x0).abs() <= TILE_SWEEP_EPSILON
    {
        return None;
    }
    Some(TileSlopeDefinition::new(
        local_x0, local_y0, local_x1, local_y1,
    ))
}

pub(super) fn best_tile_slope_hit_is_better(
    best: &Option<TilemapSlopeGroundHit>,
    next: TilemapSlopeGroundHit,
) -> bool {
    best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| next.layer_index.cmp(&current.layer_index))
            .then_with(|| next.tile_index.cmp(&current.tile_index))
            .is_lt()
    })
}

pub(super) fn is_tilemap_blocked_layer(layer: CollisionLayer) -> bool {
    matches!(layer, CollisionLayer::Player | CollisionLayer::Enemy)
}

pub(super) fn resolve_dynamic_aabb_against_static(
    transform: &mut Transform2D,
    collider: AabbCollider,
    static_center: Transform2D,
    static_half_width: f32,
    static_half_height: f32,
) -> bool {
    let static_collider = AabbCollider {
        half_width: static_half_width,
        half_height: static_half_height,
        offset_x: 0.0,
        offset_y: 0.0,
        enabled: true,
        is_trigger: false,
        layer: collider.layer,
    };
    let Some(contact) =
        CollisionSystem::aabb_contact(*transform, collider, static_center, static_collider)
    else {
        return false;
    };

    transform.x -= contact.normal_x * contact.penetration;
    transform.y -= contact.normal_y * contact.penetration;
    true
}

pub(super) fn best_tile_hit_is_better(
    best: &Option<TilemapSweepHit>,
    contact: SweptAabbContactHit,
    layer_index: usize,
    tile_index: usize,
) -> bool {
    match best {
        Some(best_hit) => {
            let same_time = (contact.time - best_hit.contact.time).abs() <= f32::EPSILON;
            contact.time < best_hit.contact.time
                || (same_time
                    && (layer_index, tile_index) < (best_hit.layer_index, best_hit.tile_index))
        }
        None => true,
    }
}

pub(super) fn nearest_obstacle_hit(
    point: Transform2D,
    max_distance: f32,
    layer_index: usize,
    layer: &TilemapLayer,
    rect: TileCollisionRect,
) -> Option<TilemapNearestObstacleHit> {
    let bounds = rect.bounds(layer);
    let point_x = point.x.max(bounds.min_x).min(bounds.max_x);
    let point_y = point.y.max(bounds.min_y).min(bounds.max_y);
    let dx = point.x - point_x;
    let dy = point.y - point_y;
    let distance = (dx * dx + dy * dy).sqrt();
    if !distance.is_finite() || distance > max_distance {
        return None;
    }
    Some(TilemapNearestObstacleHit {
        layer_index,
        tile_index: rect.tile_index,
        distance,
        point_x,
        point_y,
    })
}

pub(super) fn update_nearest_obstacle_hit(
    best: &mut Option<TilemapNearestObstacleHit>,
    next: TilemapNearestObstacleHit,
) {
    if best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| next.layer_index.cmp(&current.layer_index))
            .then_with(|| next.tile_index.cmp(&current.tile_index))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

pub(super) fn tile_axis_index(value: f32, origin: f32, tile_size: f32, max_index: u32) -> u32 {
    ((value - origin) / tile_size)
        .floor()
        .clamp(0.0, max_index as f32) as u32
}

pub(super) fn is_positive(value: f32) -> bool {
    value.is_finite() && value > 0.0
}

pub(super) fn is_normalized(value: f32) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

pub(super) fn finite_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        default
    }
}

pub(super) fn normalized_or_default(value: f32, default: f32) -> f32 {
    if is_normalized(value) {
        value
    } else {
        default
    }
}

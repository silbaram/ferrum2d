use crate::components::{
    AabbCollider, CircleCollider, CollisionLayer, CollisionMask, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::world::World;

const SWEPT_EPSILON: f32 = 0.0001;
const RAY_EPSILON: f32 = 0.0001;
const CONTACT_DEBUG_COLOR: [f32; 4] = [1.0, 0.2, 0.1, 1.0];
const BROADPHASE_DEBUG_COLOR: [f32; 4] = [0.1, 0.75, 1.0, 0.55];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CollisionPair {
    pub a: Entity,
    pub b: Entity,
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
        Self {
            min_x: transform.x - collider.half_width,
            min_y: transform.y - collider.half_height,
            max_x: transform.x + collider.half_width,
            max_y: transform.y + collider.half_height,
        }
    }

    pub fn from_circle(transform: Transform2D, collider: CircleCollider) -> Self {
        Self {
            min_x: transform.x - collider.radius,
            min_y: transform.y - collider.radius,
            max_x: transform.x + collider.radius,
            max_y: transform.y + collider.radius,
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
    Circle { center: Transform2D, radius: f32 },
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
    index: usize,
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
enum ColliderShapeRef {
    Aabb(AabbCollider),
    Circle(CircleCollider),
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
        let expanded = AabbBounds {
            min_x: target_start.x - target_collider.half_width - moving_collider.half_width,
            min_y: target_start.y - target_collider.half_height - moving_collider.half_height,
            max_x: target_start.x + target_collider.half_width + moving_collider.half_width,
            max_y: target_start.y + target_collider.half_height + moving_collider.half_height,
        };
        let x = axis_entry_exit(moving_start.x, relative_dx, expanded.min_x, expanded.max_x)?;
        let y = axis_entry_exit(moving_start.y, relative_dy, expanded.min_y, expanded.max_y)?;
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
            if !world.alive.get(index).copied().unwrap_or(false)
                || !mask_contains_entity(world, index, query_mask)
            {
                continue;
            }
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            let Some(shape) = collider_shape(world, index) else {
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

    pub fn build_contacts(world: &World) -> Vec<CollisionContact> {
        let mut contacts = Vec::new();
        for pair in Self::build_pairs(world) {
            if let Some(contact) = contact_from_pair(world, pair) {
                contacts.push(contact);
            }
        }
        contacts
    }

    pub fn build_layer_contacts(
        world: &World,
        layer_a: CollisionLayer,
        layer_b: CollisionLayer,
    ) -> Vec<CollisionContact> {
        let mut contacts = Vec::new();
        for pair in Self::build_layer_pairs(world, layer_a, layer_b) {
            if let Some(contact) = contact_from_pair(world, pair) {
                contacts.push(contact);
            }
        }
        contacts
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
        lines.clear();
        Self::append_broadphase_debug_lines_into(world, lines);
        if is_valid_debug_line_length(normal_length) {
            Self::append_contact_debug_lines_into(world, normal_length, lines);
        }
    }

    pub(crate) fn append_contact_debug_lines_into(
        world: &World,
        normal_length: f32,
        lines: &mut Vec<PhysicsDebugLine>,
    ) {
        for pair in Self::build_pairs(world) {
            let Some(contact) = contact_from_pair(world, pair) else {
                continue;
            };
            let Some(line) = contact_debug_line(world, contact, normal_length) else {
                continue;
            };
            lines.push(line);
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
                if moving_proxy.index == target_proxy.index {
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
                if !filters_allow(world, moving_proxy.index, target_proxy.index)
                    || !precise_swept_overlap(world, moving_proxy.index, target_proxy.index, delta)
                {
                    continue;
                }
                pairs.push(pair_from_indices(
                    world,
                    moving_proxy.index,
                    target_proxy.index,
                ));
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
                if moving_proxy.index == target_proxy.index {
                    continue;
                }
                if target_proxy.bounds.max_x < moving_proxy.bounds.min_x {
                    continue;
                }
                if target_proxy.bounds.min_x > moving_proxy.bounds.max_x {
                    break;
                }
                if !moving_proxy.bounds.overlaps(target_proxy.bounds)
                    || !filters_allow(world, moving_proxy.index, target_proxy.index)
                    || !precise_swept_overlap(world, moving_proxy.index, target_proxy.index, delta)
                {
                    continue;
                }
                if mask_contains_entity(world, moving_proxy.index, moving_category)
                    && mask_contains_entity(world, target_proxy.index, target_category)
                {
                    pairs.push(pair_from_indices(
                        world,
                        moving_proxy.index,
                        target_proxy.index,
                    ));
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
            let Some(shape) = collider_shape(world, index) else {
                continue;
            };
            if !mask_contains_entity(world, index, query_mask)
                || !collider_contains_point(transform, shape, point)
            {
                continue;
            }
            hits.push(PointQueryHit {
                entity: entity_from_index(world, index),
            });
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
            let Some(shape) = collider_shape(world, index) else {
                continue;
            };
            if !mask_contains_entity(world, index, query_mask)
                || !collider_overlaps_aabb(transform, shape, bounds)
            {
                continue;
            }
            hits.push(AabbQueryHit {
                entity: entity_from_index(world, index),
            });
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
            let Some(shape) = collider_shape(world, index) else {
                continue;
            };
            if !mask_contains_entity(world, index, query_mask)
                || !collider_overlaps_circle(transform, shape, center, radius)
            {
                continue;
            }
            hits.push(CircleQueryHit {
                entity: entity_from_index(world, index),
            });
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
            let Some(collider_shape) = collider_shape(world, index) else {
                continue;
            };
            if !mask_contains_entity(world, index, query_mask)
                || !query_shape_overlaps_collider(shape, transform, collider_shape)
            {
                continue;
            }
            hits.push(ShapeQueryHit {
                entity: entity_from_index(world, index),
            });
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
            let Some(shape) = collider_shape(world, index) else {
                continue;
            };
            if !mask_contains_entity(world, index, query_mask) {
                continue;
            }
            let Some(hit) = raycast_shape(origin, unit_x, unit_y, max_distance, transform, shape)
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
        hits.sort_by(|a, b| {
            a.distance
                .total_cmp(&b.distance)
                .then_with(|| a.entity.id.cmp(&b.entity.id))
        });
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
            let Some(collider_shape) = collider_shape(world, index) else {
                continue;
            };
            if !mask_contains_entity(world, index, query_mask)
                || !sweep_bounds.overlaps(collider_bounds(transform, collider_shape))
            {
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
        if let Some(proxy) = current_proxy(world, index) {
            proxies.push(proxy);
        }
    }
    proxies.sort_by(proxy_order);
}

fn collect_current_pairs(
    world: &World,
    proxies: &[CollisionProxy],
    pairs: &mut Vec<CollisionPair>,
    pair_filter: PairFilter,
) {
    for i in 0..proxies.len() {
        let a = proxies[i];
        for b in proxies.iter().copied().skip(i + 1) {
            if b.bounds.min_x > a.bounds.max_x {
                break;
            }
            if !a.bounds.overlaps(b.bounds) {
                continue;
            }
            if !precise_current_overlap(world, a.index, b.index) {
                continue;
            }
            let pair = pair_from_indices(world, a.index, b.index);
            if let Some(pair) = pair_filter.orient(world, pair) {
                pairs.push(pair);
            }
        }
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
        if collider.layer != layer {
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
        proxies.push(CollisionProxy { index, bounds });
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
        proxies.push(CollisionProxy { index, bounds });
    }
    proxies.sort_by(proxy_order);
}

fn current_proxy(world: &World, index: usize) -> Option<CollisionProxy> {
    if !world.alive.get(index).copied().unwrap_or(false) {
        return None;
    }
    let transform = world.transforms[index]?;
    let shape = collider_shape(world, index)?;
    Some(CollisionProxy {
        index,
        bounds: collider_bounds(transform, shape),
    })
}

fn proxy_order(a: &CollisionProxy, b: &CollisionProxy) -> std::cmp::Ordering {
    a.bounds
        .min_x
        .total_cmp(&b.bounds.min_x)
        .then_with(|| a.index.cmp(&b.index))
}

fn pair_from_indices(world: &World, a: usize, b: usize) -> CollisionPair {
    CollisionPair {
        a: entity_from_index(world, a),
        b: entity_from_index(world, b),
    }
}

fn entity_from_index(world: &World, index: usize) -> Entity {
    Entity {
        id: index as u32,
        generation: world.generations[index],
    }
}

fn collider_shape(world: &World, index: usize) -> Option<ColliderShapeRef> {
    world
        .colliders
        .get(index)
        .copied()
        .flatten()
        .map(ColliderShapeRef::Aabb)
        .or_else(|| {
            world
                .circle_colliders
                .get(index)
                .copied()
                .flatten()
                .map(ColliderShapeRef::Circle)
        })
}

fn collider_layer(world: &World, index: usize) -> Option<CollisionLayer> {
    match collider_shape(world, index)? {
        ColliderShapeRef::Aabb(collider) => Some(collider.layer),
        ColliderShapeRef::Circle(collider) => Some(collider.layer),
    }
}

fn collider_bounds(transform: Transform2D, shape: ColliderShapeRef) -> AabbBounds {
    match shape {
        ColliderShapeRef::Aabb(collider) => AabbBounds::from_transform(transform, collider),
        ColliderShapeRef::Circle(collider) => AabbBounds::from_circle(transform, collider),
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
            circle_contains_point(transform, collider.radius, point)
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
            circle_overlaps_aabb(transform, collider.radius, bounds)
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
            circles_overlap(transform, collider.radius, center, radius)
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
    }
}

fn query_shape_reference_point(shape: CollisionQueryShape) -> Transform2D {
    match shape {
        CollisionQueryShape::Aabb(bounds) => Transform2D {
            x: (bounds.min_x + bounds.max_x) * 0.5,
            y: (bounds.min_y + bounds.max_y) * 0.5,
        },
        CollisionQueryShape::Circle { center, .. } => center,
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
            let dx = point.x - transform.x;
            let dy = point.y - transform.y;
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
                transform.x + dx * scale,
                transform.y + dy * scale,
            ))
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
    fn orient(self, world: &World, pair: CollisionPair) -> Option<CollisionPair> {
        match self {
            Self::All => filters_allow_pair(world, pair).then_some(pair),
            Self::Layers(layer_a, layer_b) => {
                let pair = orient_layer_pair(world, pair, layer_a, layer_b)?;
                filters_allow_pair(world, pair).then_some(pair)
            }
            Self::Masks(category_a, category_b) => {
                orient_mask_pair(world, pair, category_a, category_b)
            }
        }
    }
}

fn orient_layer_pair(
    world: &World,
    pair: CollisionPair,
    layer_a: CollisionLayer,
    layer_b: CollisionLayer,
) -> Option<CollisionPair> {
    let a_index = pair.a.id as usize;
    let b_index = pair.b.id as usize;
    let a_layer = collider_layer(world, a_index)?;
    let b_layer = collider_layer(world, b_index)?;

    if a_layer == layer_a && b_layer == layer_b {
        Some(pair)
    } else if a_layer == layer_b && b_layer == layer_a {
        Some(CollisionPair {
            a: pair.b,
            b: pair.a,
        })
    } else {
        None
    }
}

fn orient_mask_pair(
    world: &World,
    pair: CollisionPair,
    category_a: CollisionMask,
    category_b: CollisionMask,
) -> Option<CollisionPair> {
    let a_index = pair.a.id as usize;
    let b_index = pair.b.id as usize;
    let a_filter = world.collision_filter_at(a_index)?;
    let b_filter = world.collision_filter_at(b_index)?;
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
        Some(CollisionPair {
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

fn filters_allow_pair(world: &World, pair: CollisionPair) -> bool {
    filters_allow(world, pair.a.id as usize, pair.b.id as usize)
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

fn precise_current_overlap(world: &World, a_index: usize, b_index: usize) -> bool {
    let Some(at) = world.transforms.get(a_index).copied().flatten() else {
        return false;
    };
    let Some(ac) = collider_shape(world, a_index) else {
        return false;
    };
    let Some(bt) = world.transforms.get(b_index).copied().flatten() else {
        return false;
    };
    let Some(bc) = collider_shape(world, b_index) else {
        return false;
    };
    shapes_overlap(at, ac, bt, bc)
}

fn contact_from_pair(world: &World, pair: CollisionPair) -> Option<CollisionContact> {
    let a_index = pair.a.id as usize;
    let b_index = pair.b.id as usize;
    let at = world.transforms.get(a_index).copied().flatten()?;
    let ac = collider_shape(world, a_index)?;
    let bt = world.transforms.get(b_index).copied().flatten()?;
    let bc = collider_shape(world, b_index)?;
    let contact = shape_contact(at, ac, bt, bc)?;
    Some(CollisionContact {
        pair,
        normal_x: contact.normal_x,
        normal_y: contact.normal_y,
        penetration: contact.penetration,
    })
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
    let x0 = (at.x + bt.x) * 0.5;
    let y0 = (at.y + bt.y) * 0.5;
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
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Aabb(bc)) => {
            AabbBounds::from_transform(at, ac).overlaps(AabbBounds::from_transform(bt, bc))
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Circle(bc)) => {
            aabb_overlaps_circle(at, ac, bt, bc.radius)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_overlaps_circle(bt, bc, at, ac.radius)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Circle(bc)) => {
            circles_overlap(at, ac.radius, bt, bc.radius)
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
    }
}

fn aabb_contact(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: AabbCollider,
) -> Option<AabbContact> {
    let dx = bt.x - at.x;
    let overlap_x = ac.half_width + bc.half_width - dx.abs();
    if overlap_x <= 0.0 {
        return None;
    }

    let dy = bt.y - at.y;
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
    if !is_valid_radius(ac.radius) || !is_valid_radius(bc.radius) {
        return None;
    }
    let dx = bt.x - at.x;
    let dy = bt.y - at.y;
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
    if !is_valid_radius(bc.radius) {
        return None;
    }
    let bounds = AabbBounds::from_transform(at, ac);
    let closest_x = bt.x.clamp(bounds.min_x, bounds.max_x);
    let closest_y = bt.y.clamp(bounds.min_y, bounds.max_y);
    let dx = bt.x - closest_x;
    let dy = bt.y - closest_y;
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

    let left = bt.x - bounds.min_x;
    let right = bounds.max_x - bt.x;
    let down = bt.y - bounds.min_y;
    let up = bounds.max_y - bt.y;
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
    let Some(target_transform) = world.transforms[target_index] else {
        return false;
    };
    let Some(target_collider) = world.colliders[target_index] else {
        return false;
    };
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
            transform,
            collider.radius,
        ),
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
    if query_shape_overlaps_collider(query_shape, collider_transform, collider_shape) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let reference = query_shape_reference_point(query_shape);
    match (query_shape, collider_shape) {
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
                collider_transform,
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
            collider_transform,
            query_radius + collider.radius,
        ),
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
    }
}

fn is_valid_debug_line_length(length: f32) -> bool {
    length.is_finite() && length > 0.0
}

fn is_valid_radius(radius: f32) -> bool {
    radius.is_finite() && radius > 0.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{CircleCollider, CollisionFilter, CollisionLayer, CollisionMask};

    fn collider(half_width: f32, half_height: f32) -> AabbCollider {
        AabbCollider {
            half_width,
            half_height,
            is_trigger: true,
            layer: CollisionLayer::Enemy,
        }
    }

    fn circle(radius: f32) -> CircleCollider {
        CircleCollider {
            radius,
            is_trigger: true,
            layer: CollisionLayer::Enemy,
        }
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
            }]
        );
    }

    #[test]
    fn contact_debug_lines_report_contact_normal() {
        let mut world = World::default();
        world.spawn_player(10.0, 10.0, 0);
        world.spawn_enemy(12.0, 10.0, 0);

        let lines = CollisionSystem::build_contact_debug_lines(&world, 8.0);

        assert_eq!(
            lines,
            vec![PhysicsDebugLine {
                x0: 11.0,
                y0: 10.0,
                x1: 19.0,
                y1: 10.0,
                r: 1.0,
                g: 0.2,
                b: 0.1,
                a: 1.0,
            }]
        );
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

        assert_eq!(lines.len(), 9);
        assert_eq!(lines[0].r, 0.1);
        assert_eq!(lines[8].r, 1.0);
        assert_eq!(lines[8].x0, 11.0);
        assert_eq!(lines[8].x1, 19.0);
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
            }]
        );
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
}

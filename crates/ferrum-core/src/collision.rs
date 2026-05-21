use crate::components::{AabbCollider, CollisionLayer, CollisionMask, Transform2D, Velocity};
use crate::entity::Entity;
use crate::world::World;

const SWEPT_EPSILON: f32 = 0.0001;
const RAY_EPSILON: f32 = 0.0001;

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
            let Some(proxy) = current_proxy(world, index) else {
                continue;
            };
            if !mask_contains_entity(world, index, query_mask)
                || !proxy.bounds.contains_point(point)
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
            let Some(proxy) = current_proxy(world, index) else {
                continue;
            };
            if !mask_contains_entity(world, index, query_mask) || !proxy.bounds.overlaps(bounds) {
                continue;
            }
            hits.push(AabbQueryHit {
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
            let Some(proxy) = current_proxy(world, index) else {
                continue;
            };
            if !mask_contains_entity(world, index, query_mask) {
                continue;
            }
            let Some(hit) = raycast_bounds(origin, unit_x, unit_y, max_distance, proxy.bounds)
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
    let collider = world.colliders[index]?;
    Some(CollisionProxy {
        index,
        bounds: AabbBounds::from_transform(transform, collider),
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
    let a_layer = world.colliders.get(a_index).copied().flatten()?.layer;
    let b_layer = world.colliders.get(b_index).copied().flatten()?.layer;

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

fn contact_from_pair(world: &World, pair: CollisionPair) -> Option<CollisionContact> {
    let a_index = pair.a.id as usize;
    let b_index = pair.b.id as usize;
    let at = world.transforms.get(a_index).copied().flatten()?;
    let ac = world.colliders.get(a_index).copied().flatten()?;
    let bt = world.transforms.get(b_index).copied().flatten()?;
    let bc = world.colliders.get(b_index).copied().flatten()?;
    let contact = aabb_contact(at, ac, bt, bc)?;
    Some(CollisionContact {
        pair,
        normal_x: contact.normal_x,
        normal_y: contact.normal_y,
        penetration: contact.penetration,
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{CollisionFilter, CollisionLayer, CollisionMask};

    fn collider(half_width: f32, half_height: f32) -> AabbCollider {
        AabbCollider {
            half_width,
            half_height,
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
}

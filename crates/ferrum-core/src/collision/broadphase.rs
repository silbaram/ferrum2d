use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct CollisionProxy {
    key: ColliderKey,
    bounds: AabbBounds,
}

#[derive(Clone, Copy, Debug)]
pub(super) enum PairFilter {
    All,
    Layers(CollisionLayer, CollisionLayer),
    Masks(CollisionMask, CollisionMask),
}

#[derive(Default, Debug)]
pub(crate) struct CollisionScratch {
    pub(super) current_proxies: Vec<CollisionProxy>,
    pub(super) moving_proxies: Vec<CollisionProxy>,
    pub(super) target_proxies: Vec<CollisionProxy>,
    pub(super) collider_pairs: Vec<ColliderPair>,
    pair_dedupe: Vec<CollisionPairDedupeEntry>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct CollisionScratchUsage {
    pub(crate) current_proxies: usize,
    pub(crate) moving_proxies: usize,
    pub(crate) target_proxies: usize,
    pub(crate) collider_pairs: usize,
    pub(crate) pair_dedupe: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct CollisionPairKey {
    a_id: u32,
    a_generation: u32,
    b_id: u32,
    b_generation: u32,
}

#[derive(Clone, Copy, Debug)]
struct CollisionPairDedupeEntry {
    key: CollisionPairKey,
    pair: CollisionPair,
    first_order: usize,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct RigidBodyCcdCandidateQuery {
    pub(crate) moving_index: usize,
    pub(crate) moving_start: Transform2D,
    pub(crate) moving_shape: ColliderShapeRef,
    pub(crate) moving_velocity: Velocity,
    pub(crate) delta_seconds: f32,
}

impl CollisionScratch {
    pub(crate) fn usage(&self) -> CollisionScratchUsage {
        CollisionScratchUsage {
            current_proxies: self.current_proxies.len(),
            moving_proxies: self.moving_proxies.len(),
            target_proxies: self.target_proxies.len(),
            collider_pairs: self.collider_pairs.len(),
            pair_dedupe: self.pair_dedupe.len(),
        }
    }
}

impl CollisionSystem {
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
        collect_current_pairs(
            world,
            &scratch.current_proxies,
            &mut scratch.collider_pairs,
            &mut scratch.pair_dedupe,
            pairs,
            PairFilter::All,
        );
    }

    pub(super) fn build_collider_pairs(
        world: &World,
        pair_filter: PairFilter,
    ) -> Vec<ColliderPair> {
        let mut scratch = CollisionScratch::default();
        Self::build_collider_pairs_with_scratch(&mut scratch, world, pair_filter);
        scratch.collider_pairs
    }

    #[cfg(test)]
    pub(super) fn build_all_collider_pairs(world: &World) -> Vec<ColliderPair> {
        Self::build_collider_pairs(world, PairFilter::All)
    }

    pub(super) fn build_collider_pairs_with_scratch<'a>(
        scratch: &'a mut CollisionScratch,
        world: &World,
        pair_filter: PairFilter,
    ) -> &'a [ColliderPair] {
        fill_current_proxies(world, &mut scratch.current_proxies);
        scratch.collider_pairs.clear();
        collect_current_collider_pairs(
            world,
            &scratch.current_proxies,
            &mut scratch.collider_pairs,
            pair_filter,
        );
        &scratch.collider_pairs
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
            &mut scratch.collider_pairs,
            &mut scratch.pair_dedupe,
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
            &mut scratch.collider_pairs,
            &mut scratch.pair_dedupe,
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

    pub(crate) fn build_rigid_body_ccd_candidate_indices_into(
        scratch: &mut CollisionScratch,
        world: &World,
        query: RigidBodyCcdCandidateQuery,
        candidates: &mut Vec<usize>,
    ) {
        let moving_bounds = swept_collider_bounds(
            query.moving_start,
            query.moving_shape,
            finite_broadphase_velocity(query.moving_velocity),
            query.delta_seconds,
        );
        fill_rigid_body_ccd_target_proxies(
            world,
            query.moving_index,
            query.delta_seconds,
            &mut scratch.target_proxies,
        );
        candidates.clear();

        for target_proxy in scratch.target_proxies.iter().copied() {
            if target_proxy.bounds.max_x < moving_bounds.min_x {
                continue;
            }
            if target_proxy.bounds.min_x > moving_bounds.max_x {
                break;
            }
            if target_proxy.bounds.overlaps(moving_bounds) {
                candidates.push(target_proxy.key.entity_index);
            }
        }

        candidates.sort_unstable();
        candidates.dedup();
    }
}

pub(super) fn current_proxy_bounds(world: &World) -> Vec<AabbBounds> {
    let mut proxies = Vec::new();
    fill_current_proxies(world, &mut proxies);
    proxies.into_iter().map(|proxy| proxy.bounds).collect()
}

pub(super) fn current_proxy_bounds_with_scratch<'a>(
    scratch: &'a mut CollisionScratch,
    world: &World,
) -> impl Iterator<Item = AabbBounds> + 'a {
    fill_current_proxies(world, &mut scratch.current_proxies);
    scratch.current_proxies.iter().map(|proxy| proxy.bounds)
}

fn fill_current_proxies(world: &World, proxies: &mut Vec<CollisionProxy>) {
    proxies.clear();
    for &index in world.alive_indices() {
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
    collider_pairs: &mut Vec<ColliderPair>,
    pair_dedupe: &mut Vec<CollisionPairDedupeEntry>,
    pairs: &mut Vec<CollisionPair>,
    pair_filter: PairFilter,
) {
    collider_pairs.clear();
    collect_current_collider_pairs(world, proxies, collider_pairs, pair_filter);
    pairs.clear();
    pair_dedupe.clear();
    pair_dedupe.extend(collider_pairs.iter().copied().enumerate().map(
        |(first_order, collider_pair)| {
            let pair = collider_pair_to_pair(world, collider_pair);
            CollisionPairDedupeEntry {
                key: CollisionPairKey::from_pair(pair),
                pair,
                first_order,
            }
        },
    ));
    pair_dedupe.sort_unstable_by(collision_pair_dedupe_order);
    pair_dedupe.dedup_by(|a, b| a.key == b.key);
    pair_dedupe.sort_unstable_by(|a, b| a.first_order.cmp(&b.first_order));
    pairs.extend(pair_dedupe.iter().map(|entry| entry.pair));
}

impl CollisionPairKey {
    fn from_pair(pair: CollisionPair) -> Self {
        Self {
            a_id: pair.a.id,
            a_generation: pair.a.generation,
            b_id: pair.b.id,
            b_generation: pair.b.generation,
        }
    }
}

fn collision_pair_dedupe_order(
    a: &CollisionPairDedupeEntry,
    b: &CollisionPairDedupeEntry,
) -> std::cmp::Ordering {
    a.key
        .cmp(&b.key)
        .then_with(|| a.first_order.cmp(&b.first_order))
}

fn fill_swept_layer_proxies(
    world: &World,
    layer: CollisionLayer,
    delta: f32,
    proxies: &mut Vec<CollisionProxy>,
) {
    proxies.clear();
    for &index in world.alive_indices() {
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
    for &index in world.alive_indices() {
        if !mask_contains_entity(world, index, category) {
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

fn fill_rigid_body_ccd_target_proxies(
    world: &World,
    moving_index: usize,
    delta_seconds: f32,
    proxies: &mut Vec<CollisionProxy>,
) {
    proxies.clear();
    for &index in world.alive_indices() {
        if index == moving_index || !filters_allow(world, moving_index, index) {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let velocity = finite_broadphase_velocity(world.velocities[index].unwrap_or_default());
        for collider_index in 0..world.compound_collider_count_at(index) {
            for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                let Some(shape) =
                    collider_shape_at_segment(world, index, collider_index, segment_index)
                else {
                    continue;
                };
                if shape.is_trigger() {
                    continue;
                }
                proxies.push(CollisionProxy {
                    key: ColliderKey {
                        entity_index: index,
                        collider_index,
                        segment_index,
                    },
                    bounds: swept_collider_bounds(transform, shape, velocity, delta_seconds),
                });
            }
        }
    }
    proxies.sort_by(proxy_order);
}

fn swept_collider_bounds(
    start: Transform2D,
    shape: ColliderShapeRef,
    velocity: Velocity,
    delta_seconds: f32,
) -> AabbBounds {
    let start_bounds = collider_bounds(start, shape);
    if !is_valid_delta(delta_seconds) {
        return start_bounds;
    }
    let end = Transform2D {
        x: start.x + velocity.vx * delta_seconds,
        y: start.y + velocity.vy * delta_seconds,
    };
    merge_bounds(start_bounds, collider_bounds(end, shape))
}

fn merge_bounds(a: AabbBounds, b: AabbBounds) -> AabbBounds {
    AabbBounds {
        min_x: a.min_x.min(b.min_x),
        min_y: a.min_y.min(b.min_y),
        max_x: a.max_x.max(b.max_x),
        max_y: a.max_y.max(b.max_y),
    }
}

fn finite_broadphase_velocity(velocity: Velocity) -> Velocity {
    Velocity {
        vx: if velocity.vx.is_finite() {
            velocity.vx
        } else {
            0.0
        },
        vy: if velocity.vy.is_finite() {
            velocity.vy
        } else {
            0.0
        },
    }
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

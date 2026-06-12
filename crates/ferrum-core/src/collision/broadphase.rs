use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) struct CollisionProxy {
    key: ColliderKey,
    bounds: AabbBounds,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct CollisionEntityPairKey {
    first_index: usize,
    second_index: usize,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct CollisionEntityPairCandidate {
    key: CollisionEntityPairKey,
    pair: CollisionPair,
    first_order: usize,
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
    pub(super) entity_pair_candidates: Vec<CollisionEntityPairCandidate>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct CollisionScratchUsage {
    pub(crate) current_proxies: usize,
    pub(crate) moving_proxies: usize,
    pub(crate) target_proxies: usize,
    pub(crate) collider_pairs: usize,
    pub(crate) entity_pair_candidates: usize,
}

impl CollisionScratch {
    pub(crate) fn usage(&self) -> CollisionScratchUsage {
        CollisionScratchUsage {
            current_proxies: self.current_proxies.len(),
            moving_proxies: self.moving_proxies.len(),
            target_proxies: self.target_proxies.len(),
            collider_pairs: self.collider_pairs.len(),
            entity_pair_candidates: self.entity_pair_candidates.len(),
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
            &mut scratch.entity_pair_candidates,
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
            &mut scratch.entity_pair_candidates,
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
            &mut scratch.entity_pair_candidates,
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
    entity_pair_candidates: &mut Vec<CollisionEntityPairCandidate>,
    pairs: &mut Vec<CollisionPair>,
    pair_filter: PairFilter,
) {
    collider_pairs.clear();
    collect_current_collider_pairs(world, proxies, collider_pairs, pair_filter);
    pairs.clear();
    entity_pair_candidates.clear();
    for (first_order, pair) in collider_pairs.iter().copied().enumerate() {
        entity_pair_candidates.push(CollisionEntityPairCandidate {
            key: pair_filter.entity_pair_key(pair),
            pair: collider_pair_to_pair(world, pair),
            first_order,
        });
    }
    entity_pair_candidates.sort_unstable_by(|a, b| {
        a.key
            .cmp(&b.key)
            .then_with(|| a.first_order.cmp(&b.first_order))
    });
    entity_pair_candidates.dedup_by_key(|candidate| candidate.key);
    entity_pair_candidates.sort_unstable_by_key(|candidate| candidate.first_order);
    pairs.extend(
        entity_pair_candidates
            .iter()
            .map(|candidate| candidate.pair),
    );
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

    fn entity_pair_key(self, pair: ColliderPair) -> CollisionEntityPairKey {
        match self {
            Self::All => CollisionEntityPairKey::unordered(pair),
            Self::Layers(_, _) | Self::Masks(_, _) => CollisionEntityPairKey::ordered(pair),
        }
    }
}

impl CollisionEntityPairKey {
    fn ordered(pair: ColliderPair) -> Self {
        Self {
            first_index: pair.a.entity_index,
            second_index: pair.b.entity_index,
        }
    }

    fn unordered(pair: ColliderPair) -> Self {
        let a = pair.a.entity_index;
        let b = pair.b.entity_index;
        if a <= b {
            Self {
                first_index: a,
                second_index: b,
            }
        } else {
            Self {
                first_index: b,
                second_index: a,
            }
        }
    }
}

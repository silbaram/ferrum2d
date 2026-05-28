use super::*;
use crate::components::CompoundColliderShapeRef;

fn collider_layer_at(world: &World, key: ColliderKey) -> Option<CollisionLayer> {
    let collider = world.compound_collider_ref_at(key.entity_index, key.collider_index)?;
    if let CompoundColliderShapeRef::Chain(chain) = collider.shape {
        if key.segment_index >= chain.segment_count() {
            return None;
        }
    }
    Some(collider.layer())
}

pub(super) fn orient_layer_pair(
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

pub(super) fn orient_mask_pair(
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

pub(super) fn mask_contains_entity(world: &World, index: usize, category: CollisionMask) -> bool {
    world
        .collision_filter_at(index)
        .is_some_and(|filter| filter.category.intersects(category))
}

pub(super) fn mask_contains_collider(
    world: &World,
    index: usize,
    collider_index: usize,
    category: CollisionMask,
) -> bool {
    world
        .compound_collision_filter_at(index, collider_index)
        .is_some_and(|filter| filter.category.intersects(category))
}

pub(super) fn filters_allow_collider_pair(world: &World, pair: ColliderPair) -> bool {
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

pub(super) fn collider_pair_has_trigger(world: &World, pair: ColliderPair) -> bool {
    world
        .compound_collider_ref_at(pair.a.entity_index, pair.a.collider_index)
        .is_some_and(|collider| collider.is_trigger())
        || world
            .compound_collider_ref_at(pair.b.entity_index, pair.b.collider_index)
            .is_some_and(|collider| collider.is_trigger())
}

pub(super) fn filters_allow(world: &World, a: usize, b: usize) -> bool {
    let Some(a_filter) = world.collision_filter_at(a) else {
        return false;
    };
    let Some(b_filter) = world.collision_filter_at(b) else {
        return false;
    };
    a_filter.can_collide_with(b_filter)
}

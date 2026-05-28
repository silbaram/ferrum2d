use crate::collision::SweptAabbContactHit;
use crate::components::{AabbCollider, CollisionMask, Transform2D, Velocity};
use crate::world::World;

use crate::physics::{OneWayPlatformConfig, GROUND_NORMAL_Y_MIN, KINEMATIC_EPSILON};

pub(super) fn solid_filter_allows(
    world: &World,
    moving_index: usize,
    target_index: usize,
    solid_mask: CollisionMask,
) -> bool {
    let Some(target_filter) = world.collision_filter_at(target_index) else {
        return false;
    };
    if !target_filter.category.intersects(solid_mask) {
        return false;
    }
    let Some(moving_filter) = world.collision_filter_at(moving_index) else {
        return false;
    };
    moving_filter.can_collide_with(target_filter)
}

pub(super) fn is_one_way_platform_candidate(
    world: &World,
    target_index: usize,
    one_way_platforms: OneWayPlatformConfig,
) -> bool {
    one_way_platforms.is_enabled()
        && world
            .collision_filter_at(target_index)
            .is_some_and(|filter| filter.category.intersects(one_way_platforms.platform_mask))
}

pub(super) fn one_way_platform_contact_blocks(
    position: Transform2D,
    collider: AabbCollider,
    remaining: Velocity,
    target_transform: Transform2D,
    target_collider: AabbCollider,
    contact: SweptAabbContactHit,
) -> bool {
    if remaining.vy <= KINEMATIC_EPSILON || !is_ground_normal(contact.normal_y) {
        return false;
    }
    let mover_bottom = collider.center(position).y + collider.half_height;
    let platform_top = target_collider.center(target_transform).y - target_collider.half_height;
    mover_bottom <= platform_top + KINEMATIC_EPSILON
}
pub(super) fn is_ground_normal(normal_y: f32) -> bool {
    normal_y >= GROUND_NORMAL_Y_MIN
}

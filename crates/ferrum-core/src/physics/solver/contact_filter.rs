use crate::physics::{has_disabled_rigid_body, rigid_body_inverse_mass};
use crate::world::World;

pub(in crate::physics) fn should_solve_rigid_contact(
    world: &World,
    a_index: usize,
    b_index: usize,
) -> bool {
    if is_trigger_collider(world, a_index) || is_trigger_collider(world, b_index) {
        return false;
    }
    if has_disabled_rigid_body(world, a_index) || has_disabled_rigid_body(world, b_index) {
        return false;
    }
    if !world.height_spans_allow_at(a_index, b_index) {
        return false;
    }
    rigid_body_inverse_mass(world, a_index) > 0.0 || rigid_body_inverse_mass(world, b_index) > 0.0
}

fn is_trigger_collider(world: &World, index: usize) -> bool {
    world
        .colliders
        .get(index)
        .copied()
        .flatten()
        .is_some_and(|collider| collider.is_trigger)
        || world
            .circle_colliders
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|collider| collider.is_trigger)
        || world
            .capsule_colliders
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|collider| collider.is_trigger)
}

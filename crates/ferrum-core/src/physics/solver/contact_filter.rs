use crate::physics::{has_disabled_rigid_body, rigid_body_inverse_mass};
use crate::world::World;

/// Body-level eligibility after the caller has selected a non-trigger collider pair.
/// A primary sensor must not suppress contacts belonging to a solid secondary collider.
pub(in crate::physics) fn should_solve_rigid_contact(
    world: &World,
    a_index: usize,
    b_index: usize,
) -> bool {
    if has_disabled_rigid_body(world, a_index) || has_disabled_rigid_body(world, b_index) {
        return false;
    }
    if !world.height_spans_allow_at(a_index, b_index) {
        return false;
    }
    rigid_body_inverse_mass(world, a_index) > 0.0 || rigid_body_inverse_mass(world, b_index) > 0.0
}

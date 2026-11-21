//! File-only persistent SharedShape identities. Ordinary memory codec/schema and
//! shape revisions/dirty flags/contact/BVH history remain unchanged. Native
//! storage/reference/numeric admission is a separate prerequisite; a successful
//! shape sidecar does not admit the surrounding Engine or publish its candidate.
use super::PhysicsWorld3d;
use rapier3d::geometry::file_shape_aliases as owner;

pub(crate) use owner::{Error, Limits, Table, Usage};

#[allow(dead_code)] // Root's detached file section integration is staged separately.
pub(crate) fn capture(world: &PhysicsWorld3d, limits: Limits) -> Result<(Table, Usage), Error> {
    owner::capture(&world.backend.colliders, limits)
}

#[allow(dead_code)]
pub(crate) fn restore(
    world: &mut PhysicsWorld3d,
    table: &Table,
    limits: Limits,
) -> Result<Usage, Error> {
    owner::restore(&mut world.backend.colliders, table, limits)
}

#[cfg(test)]
mod tests;

/// Controlled producer for the Engine file integration regression: the source
/// uses the ordinary tracked vendor setter BEFORE capture. Restore must keep
/// that saved pending/dirty history rather than invoking this setter again.
#[cfg(test)]
pub(crate) fn share_first_pair_for_file_test(world: &mut PhysicsWorld3d) {
    let (first, second) = {
        let mut handles = world.backend.colliders.iter().map(|(handle, _)| handle);
        (
            handles.next().expect("fixture has two equal spheres"),
            handles.next().expect("fixture has two equal spheres"),
        )
    };
    let shape = world
        .backend
        .colliders
        .get(first)
        .unwrap()
        .shared_shape()
        .clone();
    world
        .backend
        .colliders
        .get_mut(second)
        .unwrap()
        .set_shape(shape);
}

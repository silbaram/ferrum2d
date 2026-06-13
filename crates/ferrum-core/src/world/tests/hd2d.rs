use super::*;
use crate::components::{PhysicsFloorId, ProjectileArc};

#[test]
fn clear_projectile_arc_also_clears_derived_height_span() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let arc = ProjectileArc::new(PhysicsFloorId::DEFAULT, 2.0, 3.0, 0.0, 9.8, 1.5).unwrap();

    assert!(world.set_projectile_arc(entity, arc));
    assert_eq!(world.projectile_arc(entity), Some(arc));
    assert_eq!(world.height_span(entity), arc.height_span());

    assert!(world.clear_projectile_arc(entity));

    assert_eq!(world.projectile_arc(entity), None);
    assert_eq!(world.height_span(entity), None);
}

#[test]
fn update_projectile_arc_at_updates_derived_height_span() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    let index = entity.id as usize;
    let arc = ProjectileArc::new(PhysicsFloorId::DEFAULT, 2.0, 3.0, 4.0, 9.8, 1.5).unwrap();

    assert!(world.set_projectile_arc(entity, arc));

    let updated_span = world.update_projectile_arc_at(index, 0.25);
    let updated_arc = world.projectile_arc(entity).unwrap();

    assert_eq!(updated_span, updated_arc.height_span());
    assert_eq!(world.height_span(entity), updated_arc.height_span());
}

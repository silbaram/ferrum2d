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

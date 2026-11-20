use super::*;
use crate::components as c;

fn setup() -> (Engine, Entity, Entity) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0, -10.0, 0.0],
        ..WorldConfig::default()
    })
    .unwrap();
    let floor = e.world.spawn_entity();
    e.world
        .set_transform(floor, Transform2D { x: 0.0, y: -0.5 });
    e.world.set_aabb_collider(
        floor,
        c::AabbCollider::new(100.0, 0.5, false, c::CollisionLayer::Wall),
    );
    let b = e.world.spawn_entity();
    e.world.set_transform(b, Transform2D { x: 0.0, y: 0.5 });
    let mut rigid = c::RigidBody::dynamic(1.0).with_fixed_rotation(true);
    rigid.can_sleep = false;
    e.world.set_rigid_body(b, rigid);
    e.world.set_aabb_collider(
        b,
        c::AabbCollider::new(0.5, 0.5, false, c::CollisionLayer::Wall),
    );
    (e, floor, b)
}

fn tick(e: &mut Engine, n: usize) {
    for _ in 0..n {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
    }
    assert_eq!(e.unified_physics_error(), None);
}

#[test]
fn existing_surface_material_moves_body_and_updates_direction_without_changing_mass() {
    let (mut e, floor, b) = setup();
    let material = |speed| {
        c::PhysicsMaterial::new(0.0, 10.0).with_surface_velocity(Velocity { vx: speed, vy: 0.0 })
    };
    e.world.set_collider_material(floor, material(2.0));
    tick(&mut e, 120);
    assert!((e.world.velocity(b).unwrap().vx - 2.0).abs() < 0.01);
    assert!(e.world.transform(b).unwrap().x > 3.7);
    e.world.set_collider_material(floor, material(-2.0));
    tick(&mut e, 120);
    assert!((e.world.velocity(b).unwrap().vx + 2.0).abs() < 0.01);
    assert_eq!(e.world.rigid_body(b).unwrap().mass, 1.0);
    assert_eq!(e.world.transform(floor).unwrap().x, 0.0);
}

#[test]
fn existing_height_span_and_floor_control_actual_contacts_and_live_changes() {
    let (mut e, floor, b) = setup();
    e.world
        .set_height_span(floor, HeightSpan::new(PhysicsFloorId(1), 0.0, 1.0).unwrap());
    e.world
        .set_height_span(b, HeightSpan::new(PhysicsFloorId(2), 0.0, 1.0).unwrap());
    tick(&mut e, 60);
    assert!(e.world.transform(b).unwrap().y < -4.0);
    e.world.set_transform(b, Transform2D { x: 0.0, y: 2.0 });
    e.world.set_velocity(b, Velocity::default());
    e.world
        .set_height_span(b, HeightSpan::new(PhysicsFloorId(1), 0.0, 1.0).unwrap());
    tick(&mut e, 120);
    // The imported default contact slop is 0.01; it was previously ignored.
    assert!(
        (e.world.transform(b).unwrap().y - 0.49).abs() < 0.0001,
        "{:?}",
        e.unified_body_state(b).unwrap()
    );
    e.world
        .set_height_span(b, HeightSpan::new(PhysicsFloorId(1), 3.0, 1.0).unwrap());
    tick(&mut e, 60);
    assert!(e.world.transform(b).unwrap().y < -4.0);
}

#[test]
fn invalid_surface_and_height_batches_preserve_all_pending_impulses() {
    for height in [false, true] {
        let (mut e, floor, b) = setup();
        if height {
            e.world
                .set_height_span(floor, HeightSpan::new(PhysicsFloorId(1), 1e6, 1.0).unwrap());
        } else {
            e.world.set_collider_material(
                floor,
                c::PhysicsMaterial::DEFAULT.with_surface_velocity(Velocity {
                    vx: f32::NAN,
                    vy: 0.0,
                }),
            );
        }
        e.world.apply_impulse(b, Velocity { vx: 3.0, vy: 0.0 });
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
        assert!(e.unified_physics_error().is_some());
        assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
        assert_eq!(e.world.rigid_body(b).unwrap().impulse.vx, 3.0);
    }
}

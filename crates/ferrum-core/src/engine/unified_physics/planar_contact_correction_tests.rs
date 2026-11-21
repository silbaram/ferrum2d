use super::*;
use crate::components as c;

fn config(e: &mut Engine, position: f32, slop: f32, bias: f32, cap: f32, split: bool) {
    e.configure_auto_rigid_body_step(
        true, 0.0, 0.0, 6, 3, position, slop, 1.0, bias, cap, split, true,
    );
}
fn setup(material: c::PhysicsMaterial) -> (Engine, Entity, Entity) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let floor = e.world.spawn_entity();
    e.world
        .set_transform(floor, Transform2D { x: 0.0, y: -0.5 });
    e.world.set_aabb_collider(
        floor,
        c::AabbCollider::new(5.0, 0.5, false, c::CollisionLayer::Wall),
    );
    e.world.set_collider_material(floor, material);
    let b = e.world.spawn_entity();
    e.world.set_transform(b, Transform2D { x: 0.0, y: 0.3 });
    let mut body = c::RigidBody::dynamic(1.0)
        .with_fixed_rotation(true)
        .with_material(material);
    body.can_sleep = false;
    e.world.set_rigid_body(b, body);
    e.world.set_circle_collider(
        b,
        c::CircleCollider::new(0.5, false, c::CollisionLayer::Wall),
    );
    (e, floor, b)
}
fn tick(e: &mut Engine) {
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    assert_eq!(e.unified_physics_error(), None);
}

#[test]
fn contact_correction_authored_four_material_scales_change_actual_engine_response() {
    for case in 0..8 {
        let mut m = c::PhysicsMaterial::DEFAULT;
        match case {
            1 => m.contact_position_correction_scale = 0.0,
            3 => m.contact_baumgarte_bias_scale = 0.0,
            4 => m.max_contact_baumgarte_bias_velocity_scale = 0.0,
            5 => m.max_contact_baumgarte_bias_velocity_scale = 0.5,
            6 => m.contact_position_correction_slop_scale = 3.0,
            7 => m.contact_position_correction_slop_scale = 0.0,
            _ => {}
        }
        let (mut e, _, b) = setup(m);
        if (2..=5).contains(&case) {
            config(&mut e, 0.0, 0.0, 0.2, 0.3, false);
        } else {
            config(&mut e, 0.4, 0.1, 0.0, 0.3, false);
        }
        tick(&mut e);
        let s = e.unified_body_state(b).unwrap();
        if [1, 3, 4, 6].contains(&case) {
            assert!((s.pose.position[1] - 0.3).abs() < 1e-5, "{case} {s:?}");
        } else {
            assert!(s.pose.position[1] > 0.3005, "{case} {s:?}");
        }
        let expected_velocity = if case == 2 {
            0.3
        } else if case == 5 {
            0.15
        } else {
            0.0
        };
        assert!(
            (s.linear_velocity[1] - expected_velocity).abs() < 0.005,
            "{case} {s:?}"
        );
    }
}

#[test]
fn contact_correction_global_live_changes_rebuild_response_and_split_removes_velocity_bias() {
    for split in [false, true] {
        let (mut e, _, b) = setup(c::PhysicsMaterial::DEFAULT);
        config(&mut e, 0.0, 0.0, 0.0, 0.25, split);
        tick(&mut e);
        assert!((e.unified_body_state(b).unwrap().pose.position[1] - 0.3).abs() < 1e-5);
        config(&mut e, 0.0, 0.0, 0.2, 0.25, split);
        tick(&mut e);
        let s = e.unified_body_state(b).unwrap();
        assert!(s.pose.position[1] > 0.3005);
        let expected = if split { 0.0 } else { 0.25 };
        assert!((s.linear_velocity[1] - expected).abs() < 0.005, "{s:?}");
    }
}

#[test]
fn contact_correction_invalid_material_batch_rejects_before_body_creation_or_input_consumption() {
    for field in 0..4 {
        for value in [f32::NAN, -1.0, f32::MAX] {
            let (mut e, floor, b) = setup(c::PhysicsMaterial::DEFAULT);
            let mut m = c::PhysicsMaterial::DEFAULT;
            match field {
                0 => m.contact_baumgarte_bias_scale = value,
                1 => m.max_contact_baumgarte_bias_velocity_scale = value,
                2 => m.contact_position_correction_scale = value,
                _ => m.contact_position_correction_slop_scale = value,
            }
            e.world.set_collider_material(floor, m);
            e.world.apply_impulse(b, Velocity { vx: 3.0, vy: 0.0 });
            e.update(f64::from(e.fixed_timestep.config().step_seconds));
            assert_eq!(
                e.unified_physics_error(),
                Some(UnifiedPhysicsError::Physics(PhysicsError::InvalidCollider))
            );
            assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
            assert_eq!(e.world.rigid_body(b).unwrap().impulse.vx, 3.0);
        }
    }
}

#[test]
fn contact_correction_default_authored_stack_settles_under_gravity_with_both_split_modes() {
    for split in [false, true] {
        let mut e = Engine::new();
        e.activate_data_scene();
        config(&mut e, 0.8, 0.01, 0.2, 120.0, split);
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
            c::AabbCollider::new(5.0, 0.5, false, c::CollisionLayer::Wall),
        );
        let mut stack = Vec::new();
        for i in 0..8 {
            let b = e.world.spawn_entity();
            e.world.set_transform(
                b,
                Transform2D {
                    x: 0.0,
                    y: 0.5 + i as f32,
                },
            );
            e.world.set_rigid_body(b, c::RigidBody::dynamic(1.0));
            e.world.set_aabb_collider(
                b,
                c::AabbCollider::new(0.5, 0.5, false, c::CollisionLayer::Wall),
            );
            stack.push(b);
        }
        for _ in 0..600 {
            tick(&mut e);
        }
        for (i, b) in stack.into_iter().enumerate() {
            let s = e.unified_body_state(b).unwrap();
            // Slop is an allowed deadzone, not an imposed overlap at every
            // interface. A settled stack may retain any gap within that band.
            let lower = 0.49 + 0.99 * i as f32 - 0.01;
            let upper = 0.5 + i as f32 + 0.01;
            assert!(
                (lower..=upper).contains(&s.pose.position[1]),
                "{split} {i} {s:?}"
            );
            assert!(s.pose.position[0].abs() < 0.1, "{split} {i} {s:?}");
            assert!(
                s.linear_velocity.iter().all(|v| v.abs() < 0.05),
                "{split} {i} {s:?}"
            );
        }
    }
}

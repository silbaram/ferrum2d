use super::data_scene_visuals::sprite;
use super::*;
use crate::components::{CircleCollider, CompoundCollider, CompoundColliderShape};
use crate::physics::RigidBodyStepConfig;

fn moving_sprite(engine: &mut Engine, x: f32) -> Entity {
    let entity = sprite(engine, 71, x, 300.0, 0);
    engine
        .world
        .set_velocity(entity, Velocity { vx: 10.0, vy: 0.0 });
    entity
}

#[test]
fn authored_dynamic_attaches_shape_inertia_and_renders_the_same_entity() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine.set_viewport_size(1600.0, 960.0);
    let actor = sprite(&mut engine, 71, 300.0, 300.0, 0);
    assert!(engine.configure_data_scene_dynamic_body(actor.id, actor.generation, 2.0, false));
    let body = engine.world.rigid_body(actor).unwrap();
    assert_eq!(body.mass, 2.0);
    assert!((body.inertia - 2.0 * (16.0 * 16.0 + 16.0 * 16.0) / 12.0).abs() < 0.001);
    assert!(!body.can_sleep);
    assert!(!engine.auto_rigid_body_step_enabled);
    assert!(engine.set_physics_body_position(actor.id, actor.generation, 320.0, 300.0));
    assert!(engine.set_physics_body_rotation(actor.id, actor.generation, 0.5));
    engine.build_render_commands();
    let command = engine
        .frame_buffers
        .render_commands
        .iter()
        .find(|c| c.texture_id == 71.0)
        .unwrap();
    assert_eq!(command.rotation_radians, 0.5);
    assert_eq!(
        engine.query_point_bodies(320.0, 300.0, CollisionMask::PLAYER.bits),
        1
    );
    for mass in [0.0, f32::NAN, f32::INFINITY, f32::from_bits(1)] {
        assert!(!engine.configure_data_scene_dynamic_body(actor.id, actor.generation, mass, true));
        assert_eq!(engine.world.rigid_body(actor).unwrap().mass, 2.0);
    }
    assert!(engine.despawn_physics_entity(actor.id, actor.generation));
    assert!(!engine.configure_data_scene_dynamic_body(actor.id, actor.generation, 1.0, true));
}

#[test]
fn automatic_scene_step_integrates_raw_dynamic_authored_dynamic_and_kinematic_once() {
    for fixed in [false, true] {
        let mut engine = Engine::new();
        engine.use_data_scene();
        let authored = moving_sprite(&mut engine, 100.0);
        assert!(engine.configure_data_scene_dynamic_body(
            authored.id,
            authored.generation,
            1.0,
            false
        ));
        let raw = moving_sprite(&mut engine, 200.0);
        engine.world.set_rigid_body(raw, RigidBody::dynamic(1.0));
        let kinematic = moving_sprite(&mut engine, 300.0);
        engine
            .world
            .set_rigid_body(kinematic, RigidBody::kinematic());
        let legacy = moving_sprite(&mut engine, 400.0);
        engine.auto_rigid_body_step_enabled = true;
        engine.auto_rigid_body_step_config = RigidBodyStepConfig {
            gravity: Velocity::default(),
            ..RigidBodyStepConfig::default()
        };
        engine.fixed_timestep_enabled = fixed;
        engine.update(1.0 / 60.0);
        for (entity, start) in [
            (authored, 100.0),
            (raw, 200.0),
            (kinematic, 300.0),
            (legacy, 400.0),
        ] {
            assert!(
                (engine.world.transform(entity).unwrap().x - start - 10.0 / 60.0).abs() < 0.001
            );
        }
        assert!(engine.pause_data_scene());
        let position = engine.world.transform(authored).unwrap();
        engine.update(1.0 / 60.0);
        assert_eq!(engine.world.transform(authored).unwrap(), position);
    }
}

#[test]
fn manual_dynamics_step_explicitly_while_static_and_disabled_bodies_stay_still() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let dynamic = moving_sprite(&mut engine, 100.0);
    assert!(engine.configure_data_scene_dynamic_body(dynamic.id, dynamic.generation, 1.0, false));
    let kinematic = moving_sprite(&mut engine, 200.0);
    engine
        .world
        .set_rigid_body(kinematic, RigidBody::kinematic());
    let disabled = moving_sprite(&mut engine, 300.0);
    engine
        .world
        .set_rigid_body(disabled, RigidBody::dynamic(1.0).with_enabled(false));
    let fixed = moving_sprite(&mut engine, 400.0);
    engine.world.set_rigid_body(fixed, RigidBody::static_body());
    engine.update(0.1);
    assert_eq!(engine.world.transform(dynamic).unwrap().x, 100.0);
    assert_eq!(engine.world.transform(kinematic).unwrap().x, 201.0);
    assert_eq!(engine.world.transform(disabled).unwrap().x, 300.0);
    assert_eq!(engine.world.transform(fixed).unwrap().x, 400.0);
    engine.step_rigid_bodies(0.1);
    assert_eq!(engine.world.transform(dynamic).unwrap().x, 101.0);
    assert_eq!(engine.world.transform(disabled).unwrap().x, 300.0);
    assert_eq!(engine.world.transform(fixed).unwrap().x, 400.0);
}

#[test]
fn disabled_compound_body_is_excluded_from_queries_and_casts_then_reenabled() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let body = sprite(&mut engine, 71, 30.0, 300.0, 0);
    assert!(engine.configure_data_scene_dynamic_body(body.id, body.generation, 1.0, true));
    engine.world.add_compound_collider(
        body,
        CompoundCollider::new(CompoundColliderShape::Circle(CircleCollider {
            offset_x: 30.0,
            ..CircleCollider::new(4.0, false, CollisionLayer::Player)
        })),
    );
    for enabled in [true, false, true] {
        assert!(engine.set_physics_body_enabled(body.id, body.generation, enabled));
        for x in [30.0, 60.0] {
            assert_eq!(
                engine.query_point_bodies(x, 300.0, CollisionMask::PLAYER.bits),
                u32::from(enabled)
            );
        }
        assert_eq!(
            engine.query_aabb_bodies(45.0, 300.0, 40.0, 10.0, CollisionMask::PLAYER.bits),
            u32::from(enabled)
        );
        assert_eq!(
            engine.raycast_bodies(0.0, 300.0, 1.0, 0.0, 100.0, CollisionMask::PLAYER.bits),
            2 * u32::from(enabled)
        );
        assert_eq!(
            engine.segment_cast_bodies(0.0, 300.0, 100.0, 300.0, CollisionMask::PLAYER.bits),
            2 * u32::from(enabled)
        );
        assert_eq!(
            engine.shape_cast_circle_bodies(
                0.0,
                300.0,
                1.0,
                1.0,
                0.0,
                100.0,
                CollisionMask::PLAYER.bits
            ),
            2 * u32::from(enabled)
        );
        assert!(engine.query_physics_entity(body.id, body.generation));
    }
    engine.world.rigid_bodies[body.id as usize]
        .as_mut()
        .unwrap()
        .is_sleeping = true;
    assert_eq!(
        engine.query_point_bodies(30.0, 300.0, CollisionMask::PLAYER.bits),
        1
    );
}

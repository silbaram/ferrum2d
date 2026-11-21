use super::*;
use crate::components::{
    CircleCollider, CollisionFilter, CollisionLayer, CollisionMask, RigidBody,
};
use crate::physics3d::{BodyKind, Shape};

fn scene(config: WorldConfig) -> (Engine, Entity) {
    let mut e = Engine::new();
    assert_eq!(e.data_scene_spawn_prefabs_version(), 1);
    assert_eq!(e.data_scene_spawn_prefab_physics_version(), 1);
    e.use_data_scene();
    e.configure_unified_physics(config).unwrap();
    let actor = e.world.spawn_entity();
    e.world.set_transform(actor, Transform2D::default());
    assert!(e.set_gameplay_action_spawn_prefab(
        actor.id,
        actor.generation,
        77,
        0.,
        1,
        0,
        0,
        10.,
        0.
    ));
    assert!(e.set_input_action_binding(
        77,
        0,
        crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    ));
    (e, actor)
}
fn config(space: Space) -> WorldConfig {
    WorldConfig {
        space,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    }
}
fn register(e: &mut Engine, actor: Entity, prototype: Entity) -> bool {
    e.configure_data_scene_gameplay_v7(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        0,
        &[1, prototype.id, prototype.generation],
    )
}
fn click(e: &mut Engine, down: bool) {
    e.set_input(false, false, false, false, false, false, down, 0., 0.);
    e.update(0.01);
    assert_eq!(e.unified_physics_error(), None);
}
fn actors(e: &Engine) -> Vec<Entity> {
    e.data_scene_spawned_actor_handles()[3..]
        .chunks_exact(5)
        .filter(|v| v[4] == 1)
        .map(|v| Entity {
            id: v[2],
            generation: v[3],
        })
        .collect()
}
fn legacy(e: &mut Engine) -> Entity {
    let p = e.world.spawn_entity();
    e.world.set_transform(p, Transform2D { x: 100., y: 0. });
    e.world
        .set_circle_collider(p, CircleCollider::new(0.25, false, CollisionLayer::Enemy));
    e.world.set_rigid_body(p, RigidBody::kinematic());
    e.world
        .set_collision_filter(p, CollisionFilter::from_layer(CollisionLayer::Enemy));
    assert!(e.configure_data_scene_kinematic_controller(
        p.id,
        p.generation,
        false,
        0,
        7,
        3.,
        4.,
        true
    ));
    p
}
fn settings(e: &Engine, entity: Entity) -> crate::physics::Hd2dKinematicControllerConfig {
    e.unified_physics
        .as_ref()
        .unwrap()
        .automatic_planar
        .settings[&(entity.id, entity.generation)]
        .config()
}
fn native(e: &mut Engine) -> Entity {
    let planar = e.unified_physics.as_ref().unwrap().physics.config().space == Space::PlanarXy;
    let mut collider = ColliderDesc::new(Shape::Capsule {
        half_height: 0.5,
        radius: 0.25,
    });
    collider.category = CollisionMask::ENEMY.bits;
    let p = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [100., 2., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            collider,
            if planar {
                [0.2, 0.3, 0.]
            } else {
                [0.2, 0.3, 0.4]
            },
        )
        .unwrap();
    e.enable_unified_character(
        p,
        CharacterConfig {
            skin_width: 0.02,
            step_height: 0.4,
            snap_distance: 0.15,
            push_mass: 2.,
            ..Default::default()
        },
    )
    .unwrap();
    let body = e.unified_body_id(p).unwrap();
    let mut sensor = ColliderDesc::new(Shape::Sphere { radius: 0.1 });
    sensor.sensor = true;
    sensor.category = CollisionMask::PICKUP.bits;
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .add_collider(body, sensor)
        .unwrap();
    p
}

#[test]
fn prefab_controller_automatic_settings_are_owned_and_survive_source_removal() {
    let (mut e, a) = scene(config(Space::PlanarXy));
    let p = legacy(&mut e);
    let captured = settings(&e, p);
    assert!(register(&mut e, a, p));
    assert!(e.configure_data_scene_kinematic_controller(
        p.id,
        p.generation,
        false,
        CollisionMask::WALL.bits,
        1,
        0.,
        0.,
        false
    ));
    e.world.despawn(p);
    click(&mut e, true);
    let first = actors(&e)[0];
    assert_eq!(settings(&e, first), captured);
    assert!(e.configure_data_scene_kinematic_controller(
        first.id,
        first.generation,
        false,
        CollisionMask::ALL.bits,
        2,
        1.,
        2.,
        false
    ));
    click(&mut e, false);
    click(&mut e, true);
    let second = actors(&e)[1];
    assert_eq!(settings(&e, second), captured);
    assert_ne!(settings(&e, first), settings(&e, second));
    e.world.despawn(first);
    e.world.despawn(second);
    click(&mut e, false);
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .automatic_planar
        .settings
        .is_empty());
}

#[test]
fn prefab_controller_automatic_pending_settings_and_capacity_failures_leave_no_stale_entries() {
    let mut c = config(Space::PlanarXy);
    c.max_bodies = 1;
    let (mut e, a) = scene(c);
    let p = legacy(&mut e);
    assert!(register(&mut e, a, p));
    let before = e.world.alive_indices().len();
    click(&mut e, true);
    assert!(actors(&e).is_empty());
    assert_eq!(e.world.alive_indices().len(), before);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .automatic_planar
            .settings
            .len(),
        1
    );
    e.world.despawn(p);
    click(&mut e, false);
    click(&mut e, true);
    let child = actors(&e)[0];
    let captured = e
        .unified_physics
        .as_ref()
        .unwrap()
        .actor_physics_prototype(child)
        .unwrap()
        .unwrap();
    let provisional = e.world.spawn_entity();
    e.unified_physics
        .as_mut()
        .unwrap()
        .install_actor_physics_prototype(&mut e.world, provisional, &captured)
        .unwrap();
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .bindings
        .contains_key(&(provisional.id, provisional.generation)));
    e.world.despawn(provisional);
    e.unified_physics
        .as_mut()
        .unwrap()
        .retire_deleted_entities(&e.world);
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .automatic_planar
        .settings
        .contains_key(&(provisional.id, provisional.generation)));
}

#[test]
fn prefab_controller_native_capsules_copy_configuration_but_not_input_forces_or_support() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut e, a) = scene(config(space));
        if space == Space::Spatial {
            assert!(e.configure_spatial_camera(&[
                0., 0., 100., 200., 0., 16., 0., 200., 0.1, 1000., 400., 300.
            ]));
        }
        let p = native(&mut e);
        let id = e.unified_body_id(p).unwrap();
        let captured = e
            .unified_physics
            .as_ref()
            .unwrap()
            .physics
            .character_config(id)
            .unwrap()
            .clone();
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .set_character_input(
                id,
                CharacterInput {
                    velocity: [3., 0., 0.],
                    jump_speed: 5.,
                },
            )
            .unwrap();
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .add_character_force(id, [10., 0., 0.])
            .unwrap();
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .apply_character_impulse(id, [2., 0., 0.])
            .unwrap();
        assert!(register(&mut e, a, p));
        e.remove_unified_body(p).unwrap();
        click(&mut e, true);
        let child = actors(&e)[0];
        let body = e.unified_body_id(child).unwrap();
        let runtime = e.unified_physics.as_ref().unwrap();
        assert_eq!(runtime.physics.character_config(body).unwrap(), &captured);
        assert_eq!(runtime.physics.collider_ids(body).unwrap().count(), 2);
        let state = runtime.physics.character_state(body).unwrap();
        assert_eq!(state.translation, [0.; 3]);
        assert_eq!(state.ground, None);
        assert_eq!(state.carried_by, None);
        let anchor = e.world.transform(child).unwrap();
        assert!((anchor.x - 10.).abs() < 1e-5);
        assert!(anchor.y.abs() < 1e-5);
        let physics = e.unified_body_state(child).unwrap().pose.position;
        assert!((physics[0] - 9.8).abs() < 1e-5);
        if space == Space::Spatial {
            assert!((physics[1] - 2.).abs() < 1e-5);
            assert!((physics[2] + 0.4).abs() < 1e-5);
        } else {
            assert!((physics[1] + 0.3).abs() < 1e-5);
            assert_eq!(physics[2], 0.);
        }
        e.enable_unified_character(
            child,
            CharacterConfig {
                step_height: 1.,
                ..captured.clone()
            },
        )
        .unwrap();
        click(&mut e, false);
        click(&mut e, true);
        let next = actors(&e)[1];
        let body = e.unified_body_id(next).unwrap();
        assert_eq!(
            e.unified_physics
                .as_ref()
                .unwrap()
                .physics
                .character_config(body)
                .unwrap(),
            &captured
        );
    }
}

#[test]
fn prefab_controller_native_body_collider_character_capacity_and_blocked_placement_are_atomic() {
    for limit in 0..3 {
        let mut c = config(Space::Spatial);
        match limit {
            0 => c.max_bodies = 1,
            1 => c.max_colliders = 2,
            _ => c.max_characters = 1,
        };
        let (mut e, a) = scene(c);
        let p = native(&mut e);
        assert!(register(&mut e, a, p));
        let alive = e.world.alive_indices().len();
        click(&mut e, true);
        assert!(actors(&e).is_empty());
        assert_eq!(e.world.alive_indices().len(), alive);
        let runtime = e.unified_physics.as_ref().unwrap();
        assert_eq!(runtime.physics.body_count(), 1);
        assert_eq!(runtime.physics.collider_count(), 2);
        assert_eq!(runtime.bindings.len(), 1);
        e.remove_unified_body(p).unwrap();
        click(&mut e, false);
        click(&mut e, true);
        assert_eq!(actors(&e).len(), 1);
    }
    let (mut e, a) = scene(config(Space::Spatial));
    let p = native(&mut e);
    assert!(register(&mut e, a, p));
    e.remove_unified_body(p).unwrap();
    let mut collider = ColliderDesc::new(Shape::Box {
        half_extents: [1.; 3],
    });
    collider.category = CollisionMask::WALL.bits;
    let wall = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [9.8, 2., -0.4],
                    ..Default::default()
                },
                ..Default::default()
            },
            collider,
            [0.; 3],
        )
        .unwrap();
    let alive = e.world.alive_indices().len();
    click(&mut e, true);
    assert!(actors(&e).is_empty());
    assert_eq!(e.world.alive_indices().len(), alive);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 1);
    assert_eq!(
        e.unified_physics.as_ref().unwrap().physics.collider_count(),
        1
    );
    e.remove_unified_body(wall).unwrap();
    click(&mut e, false);
    click(&mut e, true);
    assert_eq!(actors(&e).len(), 1);
}

#[test]
fn prefab_controller_native_and_automatic_catalogs_replay_from_runtime_checkpoints() {
    for explicit in [false, true] {
        let (mut e, a) = scene(config(if explicit {
            Space::Spatial
        } else {
            Space::PlanarXy
        }));
        let p = if explicit {
            native(&mut e)
        } else {
            legacy(&mut e)
        };
        assert!(register(&mut e, a, p));
        if explicit {
            e.remove_unified_body(p).unwrap();
        } else {
            e.world.despawn(p);
        }
        let checkpoint = e.runtime_checkpoint().unwrap();
        click(&mut e, true);
        let first = actors(&e)[0];
        let state = e.unified_body_state(first).unwrap();
        let definition = e
            .unified_physics
            .as_ref()
            .unwrap()
            .actor_physics_prototype(first)
            .unwrap();
        let records = e.data_scene_spawned_actor_handles();
        e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
        click(&mut e, true);
        let replay = actors(&e)[0];
        assert_eq!(e.data_scene_spawned_actor_handles(), records);
        assert_eq!(e.unified_body_state(replay).unwrap(), state);
        assert_eq!(
            e.unified_physics
                .as_ref()
                .unwrap()
                .actor_physics_prototype(replay)
                .unwrap(),
            definition
        );
    }
}

#[test]
fn prefab_controller_native_dynamic_and_jointed_registration_preserve_the_previous_catalog() {
    let (mut e, a) = scene(config(Space::Spatial));
    let p = native(&mut e);
    assert!(register(&mut e, a, p));
    let dynamic = e
        .create_unified_body(
            BodyDesc::default(),
            ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
            [0.; 3],
        )
        .unwrap();
    assert!(!register(&mut e, a, dynamic));
    let joint = crate::physics3d::JointDesc::new(
        e.unified_body_id(p).unwrap(),
        e.unified_body_id(dynamic).unwrap(),
        crate::physics3d::JointKind::Spherical,
    );
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .create_joint(joint)
        .unwrap();
    assert!(!register(&mut e, a, p));
    e.remove_unified_body(p).unwrap();
    e.remove_unified_body(dynamic).unwrap();
    click(&mut e, true);
    assert_eq!(actors(&e).len(), 1);
}

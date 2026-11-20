use super::*;
use crate::components::{
    AabbCollider, CollisionFilter, CollisionLayer, HeightSpan, PhysicsFloorId, Transform2D,
};
use crate::engine::persistence;
use crate::engine::{Engine, PHYSICS_COLLIDER_TYPE_AABB, PHYSICS_LAYER_PLAYER};
use crate::entity::Entity;
fn limits() -> Limits {
    Limits {
        max_work: 100_000_000,
        max_scratch_bytes: 32_000_000,
    }
}
fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn check(e: &Engine) -> Usage {
    let before = bytes(e);
    let usage = validate(e, limits()).unwrap();
    assert_eq!(bytes(e), before);
    let d = persistence::decode(&before).unwrap();
    assert_eq!(validate(&d, limits()), Ok(usage));
    assert_eq!(bytes(&d), before);
    usage
}
fn sprite(engine: &mut Engine, texture: u32, x: f32, y: f32, layer: i32) -> Entity {
    assert!(engine.spawn_data_scene_entity(
        x,
        y,
        0.0,
        layer,
        texture,
        32.0,
        64.0,
        0.0,
        0.0,
        1.0,
        1.0,
        0,
        0.0,
        PHYSICS_LAYER_PLAYER,
        PHYSICS_COLLIDER_TYPE_AABB,
        0.0,
        0.0,
        true,
        true,
        8.0,
        8.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        vec![]
    ));
    Entity {
        id: engine.data_scene_entity_id(),
        generation: engine.data_scene_entity_generation(),
    }
}
fn surface(x: f32, y: f32, w: f32, d: f32, a: f32, b: f32) -> [f32; 11] {
    [x, y, w, d, 0., a, b, 1., 1., 1., 1.]
}
fn setup(multifloor: bool) -> (Engine, Entity) {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_data_scene();
    assert!(e.configure_spatial_camera(&[
        0., 0., 100., 200., 0., 16., 0., 200., 0.1, 1000., 400., 300.
    ]));
    let a = sprite(&mut e, 71, 0., 16., 0);
    e.world
        .set_aabb_collider(a, AabbCollider::new(2., 2., false, CollisionLayer::Player));
    assert!(e.configure_data_scene_body(a.id, a.generation, 1, true, 0, 0., 8.));
    assert!(e.configure_data_scene_gameplay(true, a.id, a.generation, 0));
    if multifloor {
        assert!(e.configure_spatial_terrain(
            &[
                surface(-32., 0., 64., 32., 0., 0.),
                surface(-32., 32., 64., 32., 0., 32.),
                [-32., 64., 64., 48., 24., 32., 32., 1., 1., 1., 1.],
                surface(-32., 64., 64., 48., 0., 0.),
                surface(32., 32., 32., 80., 0., 0.)
            ]
            .concat(),
            &[
                1, 0, 16777215, 1, 2, 0, 16777215, 5, 3, 1, 16777215, 9, 4, 0, 16777215, 1, 5, 0,
                16777215, 1
            ]
        ));
        assert!(e.spatial_scene.configure_connections(&[2, 3]));
    } else {
        assert!(e.configure_spatial_terrain(
            &surface(-32., 0., 96., 112., 0., 0.),
            &[1, 0, 16777215, 1]
        ));
    }
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    assert!(e.configure_spatial_actor(a.id, a.generation, 96., 8., 40.));
    (e, a)
}
fn enemy(e: &mut Engine, x: f32, y: f32, trigger: bool) -> Entity {
    let entity = sprite(e, 72, x, y, 0);
    e.world.set_aabb_collider(
        entity,
        AabbCollider::new(2., 2., trigger, CollisionLayer::Enemy),
    );
    e.world
        .set_collision_filter(entity, CollisionFilter::from_layer(CollisionLayer::Enemy));
    assert!(e.configure_data_scene_body(entity.id, entity.generation, 1, true, 0, 0., 8.));
    assert!(e.set_gameplay_movement_chase_primary_actor(entity.id, entity.generation, 64.));
    entity
}
fn configure(e: &mut Engine, actor: Entity, agents: f32) -> bool {
    e.configure_data_scene_gameplay_v4(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 0., agents],
    )
}
fn slow_search() -> (Engine, Entity, Entity) {
    let (mut e, actor) = setup(false);
    assert!(e.configure_spatial_terrain(
        &[-128., 0., 256., 256., 0., 0., 0., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    e.world.set_transform(actor, Transform2D { x: 0., y: 240. });
    let follower = enemy(&mut e, 0., 16., true);
    for (i, (x, y, w, h)) in [
        (-40., 64., 80., 4.),
        (40., 128., 80., 4.),
        (-40., 192., 80., 4.),
    ]
    .into_iter()
    .enumerate()
    {
        let wall = sprite(&mut e, 74 + i as u32, x, y, 0);
        e.world
            .set_aabb_collider(wall, AabbCollider::new(w, h, false, CollisionLayer::Wall));
        e.world
            .set_height_span(wall, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
        e.world
            .set_collision_filter(wall, CollisionFilter::from_layer(CollisionLayer::Wall));
    }
    assert!(configure(&mut e, actor, 1.));
    (e, actor, follower)
}
fn combat() -> (Engine, Entity, Entity) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = sprite(&mut engine, 1, 100.0, 100.0, 0);
    let enemy = sprite(&mut engine, 2, 20.0, 100.0, 0);
    engine.world.set_aabb_collider(
        enemy,
        AabbCollider::new(3.0, 3.0, true, CollisionLayer::Enemy),
    );
    engine.world.set_collision_filter(
        enemy,
        crate::components::CollisionFilter::from_layer(CollisionLayer::Enemy),
    );
    assert!(engine.set_gameplay_health(actor.id, actor.generation, 6.0));
    assert!(engine.set_gameplay_movement_chase_primary_actor(enemy.id, enemy.generation, 2.0));
    assert!(engine.set_gameplay_action_projectile_with_target(
        enemy.id,
        enemy.generation,
        31,
        0.0,
        400.0,
        3.0,
        2.0,
        1,
        1,
        0
    ));
    assert!(engine.set_gameplay_timer_action_trigger(enemy.id, enemy.generation, 17, 0.2, 31));
    for entity in [actor, enemy] {
        assert!(engine.world.set_height_span(
            entity,
            HeightSpan::new(PhysicsFloorId(0), 8.0, 8.0).unwrap()
        ));
    }
    assert!(engine.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    (engine, actor, enemy)
}

#[test]
fn file_data_gameplay_default_exact_one_below_work_and_scratch_are_readonly() {
    let (mut e, _, _) = slow_search();
    e.update(1. / 60.);
    let usage = check(&e);
    let old = bytes(&e);
    assert!(usage.work > 0 && usage.scratch_bytes > 0);
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: usage.work,
                max_scratch_bytes: usage.scratch_bytes
            }
        ),
        Ok(usage)
    );
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: usage.work - 1,
                max_scratch_bytes: usage.scratch_bytes
            }
        ),
        Err(Error::WorkLimit)
    );
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: usage.work,
                max_scratch_bytes: usage.scratch_bytes - 1
            }
        ),
        Err(Error::ScratchLimit)
    );
    assert_eq!(bytes(&e), old);
    check(&Engine::new());
}
#[test]
fn file_data_gameplay_public_combat_event_clear_stale_and_six_tick_codec_continuation() {
    let (mut e, actor, _) = combat();
    check(&e);
    e.update(0.5);
    check(&e);
    e.clear_events();
    check(&e);
    let mut restored = persistence::decode(&bytes(&e)).unwrap();
    for _ in 0..6 {
        e.update(0.1);
        restored.update(0.1);
        check(&e);
        assert_eq!(bytes(&e), bytes(&restored));
    }
    e.world.despawn(actor);
    check(&e);
    e.clear_events();
    check(&e);
    e.update(0.01);
    check(&e);
}
#[test]
fn file_data_gameplay_actual_pending_job_pause_reconfigure_and_six_tick_continuation() {
    let (mut e, _, _) = slow_search();
    e.update(1. / 60.);
    assert_eq!(e.data_scene_combat_navigation_scheduler_stats()[2], 1);
    check(&e);
    let mut restored = persistence::decode(&bytes(&e)).unwrap();
    for _ in 0..6 {
        e.update(1. / 60.);
        restored.update(1. / 60.);
        check(&e);
        assert_eq!(bytes(&e), bytes(&restored));
    }
    assert!(e.pause_data_scene());
    check(&e);
    e.update(1.);
    check(&e);
    assert!(e.resume_data_scene());
    e.update(1. / 60.);
    check(&e);
    assert!(
        e.configure_spatial_terrain(&surface(-32., 0., 96., 112., 0., 0.), &[1, 0, 16777215, 1])
    );
    check(&e);
    e.update(1. / 60.);
    check(&e);
}
#[test]
fn file_data_gameplay_public_spawn_prefab_capture_source_despawn_and_next_tick() {
    let (mut e, actor) = setup(false);
    let prototype = enemy(&mut e, 24., 16., true);
    assert!(e.set_gameplay_action_spawn_prefab(
        actor.id,
        actor.generation,
        77,
        0.,
        1,
        0,
        0,
        16.,
        0.
    ));
    assert!(e.set_input_action_binding(
        77,
        0,
        crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    ));
    assert!(e.configure_data_scene_gameplay_v7(
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
        &[1, prototype.id, prototype.generation]
    ));
    check(&e);
    e.world.despawn(prototype);
    check(&e);
    e.set_input(false, false, false, false, false, false, true, 80., 80.);
    e.update(0.01);
    check(&e);
    let mut r = persistence::decode(&bytes(&e)).unwrap();
    for _ in 0..6 {
        e.update(0.01);
        r.update(0.01);
        check(&e);
        assert_eq!(bytes(&e), bytes(&r));
    }
}
#[test]
fn file_data_gameplay_cumulative_allowance_cannot_reset_at_nested_owner() {
    let e = Engine::new();
    let usage = check(&e);
    let mut b = Budget::new(Limits {
        max_work: usage.work,
        max_scratch_bytes: usage.scratch_bytes,
    });
    b.work(1).unwrap();
    assert_eq!(
        e.data_scene
            .gameplay
            .validate_file(&e.world, &e.spatial_scene, &mut b),
        Err(Error::WorkLimit)
    );
}

fn prefab_fixture() -> Engine {
    let (mut e, actor) = setup(false);
    let prototype = enemy(&mut e, 24., 16., true);
    assert!(e.set_gameplay_action_spawn_prefab(
        actor.id,
        actor.generation,
        77,
        0.,
        1,
        0,
        0,
        16.,
        0.
    ));
    assert!(e.configure_data_scene_gameplay_v7(
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
        &[1, prototype.id, prototype.generation]
    ));
    e
}
#[test]
fn file_data_gameplay_twenty_one_actual_engine_valid_crc_payload_damage_cases_are_readonly() {
    for case in 0..=20 {
        let mut e = if (12..=15).contains(&case) {
            prefab_fixture()
        } else {
            let (mut e, _, _) = slow_search();
            e.update(1. / 60.);
            e
        };
        check(&e);
        let original = bytes(&e);
        let mut candidate = persistence::decode(&original).unwrap();
        candidate.data_scene.gameplay.corrupt_file_fixture(case);
        let malformed = bytes(&candidate);
        let decoded = persistence::decode(&malformed).unwrap();
        assert!(
            matches!(validate(&decoded, limits()), Err(Error::Invalid { .. })),
            "case {case}: {:?}",
            validate(&decoded, limits())
        );
        assert_eq!(bytes(&decoded), malformed, "case {case}");
        assert_eq!(bytes(&e), original);
        e.clear_events();
    }
}

#[test]
fn file_data_gameplay_public_native_melee_hit_history_survives_target_removal_and_clear() {
    use crate::components::CollisionMask;
    use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Pose, Shape, Space, WorldConfig};
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = Engine::new();
        e.activate_data_scene();
        e.configure_unified_physics(WorldConfig {
            space,
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let mut body = |x, category| {
            e.create_unified_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position: [x, 1., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    category,
                    sensor: true,
                    ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
                },
                [0.; 3],
            )
            .unwrap()
        };
        let actor = body(0., CollisionMask::PLAYER.bits);
        let target = body(1., CollisionMask::ENEMY.bits);
        assert!(e.world.set_health(target, 10.));
        assert!(e.set_gameplay_action_melee(actor.id, actor.generation, 77, 1., 2., 2.));
        assert!(e.set_input_action_binding(
            77,
            0,
            crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
            crate::input::INPUT_ACTION_ACTIVATION_PRESSED
        ));
        assert!(e.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
        e.set_input(false, false, false, false, false, false, true, -1., -1.);
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
        assert_eq!(e.world.health(target), Some(8.));
        check(&e);
        e.world.despawn(target);
        e.clear_events();
        check(&e);
        let mut r = persistence::decode(&bytes(&e)).unwrap();
        for _ in 0..6 {
            e.update(0.01);
            r.update(0.01);
            check(&e);
            assert_eq!(bytes(&e), bytes(&r));
        }
    }
}

#[test]
fn file_data_gameplay_public_crowd_routes_shared_history_and_velocity_only_moving() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let a = enemy(&mut e, -8., 16., true);
    let c = enemy(&mut e, 8., 16., true);
    assert!(e.configure_data_scene_gameplay_v5(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 0., 64., 1.],
        &[a.id, a.generation, c.id, c.generation],
        &[16., 24.]
    ));
    for _ in 0..36 {
        e.update(1. / 60.);
        check(&e);
    }
    e.world.despawn(c);
    check(&e);
    e.update(1. / 60.);
    check(&e);
    assert!(e.set_gameplay_movement_accelerate(a.id, a.generation, 0., 2., 64.));
    assert!(e.configure_data_scene_gameplay_v6(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 4., 64., -1.],
        &[],
        &[],
        1
    ));
    for _ in 0..6 {
        e.update(1. / 60.);
        check(&e);
    }
}

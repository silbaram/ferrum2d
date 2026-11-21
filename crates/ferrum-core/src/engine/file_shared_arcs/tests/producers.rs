//! Real authoring/spawn/search producers, separate from private graph damage fixtures.
use super::*;
use crate::components::gameplay::{MovementPattern, MovementTarget};
use crate::physics3d::{BodyDesc, BodyKind, CharacterConfig, ColliderDesc, Shape, WorldConfig};

fn clips_fixture() -> (Engine, Entity, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    let actor = e.world.spawn_player(0., 0., 1);
    let prototype = e.world.spawn_enemy(500., 0., 2);
    e.world.clear_movement_pattern(prototype);
    assert!(e.configure_data_scene_sprite_clips(
        prototype.id,
        prototype.generation,
        &[1., 2., 10., 1.],
        &[0., 0., 0.5, 1., 0.5, 0., 1., 1.],
        1
    ));
    assert!(e.set_gameplay_action_spawn_prefab(
        actor.id,
        actor.generation,
        77,
        0.,
        1,
        0,
        0,
        100.,
        0.
    ));
    assert!(e.set_input_action_binding(
        77,
        0,
        crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    ));
    assert!(e.set_gameplay_action_projectile_with_target(
        prototype.id,
        prototype.generation,
        31,
        0.,
        100.,
        1.,
        5.,
        1,
        1,
        0
    ));
    assert!(e.set_gameplay_timer_action_trigger(prototype.id, prototype.generation, 3, 0.05, 31));
    assert!(e.configure_data_scene_gameplay_v8(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[1, 3],
        &[12., 4., 0., 0., 0.5, 1., 2., 2., 1., 0.1, 3., 1., 1., 1., 1.],
        &[prototype.id, prototype.generation, 31, 1],
        &[],
        &[],
        &[],
        0,
        &[1, prototype.id, prototype.generation],
        &[1, 2, 1, 0],
        &[3.],
        &[0., 0., 0.5, 1., 1., 0., 0.5, 1.]
    ));
    e.set_input(false, false, false, false, false, false, true, -1., -1.);
    e.update(0.01);
    e.set_input(false, false, false, false, false, false, false, -1., -1.);
    e.update(0.08);
    let table = graph(&e);
    assert!(table
        .rows
        .iter()
        .any(|r| matches!(r.location, Location::ActorPrototype { .. })));
    assert!(table
        .rows
        .iter()
        .any(|r| matches!(r.location, Location::ProjectilePrefab { .. })));
    assert!(
        table
            .rows
            .iter()
            .filter(|r| matches!(r.location, Location::WorldPlayback { .. }))
            .count()
            >= 3,
        "{table:?}"
    );
    let token =
        e.begin_data_scene_authoring_continuity(&[prototype.id, prototype.generation], &[1]);
    assert_ne!(token, 0);
    (e, actor, prototype)
}
#[test]
fn real_prefab_prototype_spawn_and_continuity_all_clip_roots_rejoin_after_codec() {
    let (mut e, _, prototype) = clips_fixture();
    let table = graph(&e);
    assert!(table
        .rows
        .iter()
        .any(|r| matches!(r.location, Location::Continuity { .. })));
    for kind in [0, 1, 2] {
        let row = table
            .rows
            .iter()
            .position(|r| match kind {
                0 => matches!(r.location, Location::ProjectilePrefab { .. }),
                1 => matches!(r.location, Location::ActorPrototype { .. }),
                _ => matches!(r.location, Location::Continuity { .. }),
            })
            .unwrap();
        let leader = table.rows[row].first;
        assert!(
            table.rows.iter().enumerate().any(|(i, r)| i != row
                && r.first == leader
                && matches!(r.location, Location::WorldPlayback { .. })),
            "owner{kind}: {table:?}"
        );
    }
    let before = bytes(&e);
    let mut candidate = detached(&e);
    assert_eq!(bytes(&candidate), before);
    restore(&mut candidate, &copied_table(&table), limits()).unwrap();
    assert_eq!(graph(&candidate), table);
    assert_eq!(bytes(&candidate), before);
    for _ in 0..6 {
        e.update(0.013);
        candidate.update(0.013);
        assert_eq!(bytes(&e), bytes(&candidate));
        assert_eq!(graph(&e), graph(&candidate));
    }
    // A retired prototype source is legitimate history; its catalog and handoff
    // still own immutable data after the live source cell is gone.
    e.world.despawn(prototype);
    let before = bytes(&e);
    let table = graph(&e);
    let mut c = detached(&e);
    restore(&mut c, &table, limits()).unwrap();
    assert_eq!(graph(&c), table);
    assert_eq!(bytes(&c), before);
}
fn capsule(e: &mut Engine, x: f32, z: f32, offset: [f32; 3]) -> Entity {
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [x, 1., z],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
            offset,
        )
        .unwrap();
    e.enable_unified_character(a, CharacterConfig::default())
        .unwrap();
    a
}
fn tick(e: &mut Engine) {
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    assert_eq!(e.unified_physics_error(), None);
}
fn route_fixture(sensors: usize) -> (Engine, Entity, Entity, Entity) {
    let mut e = Engine::new();
    e.activate_data_scene();
    assert!(e.configure_spatial_camera(&[0., 0., 8., 10., 0., 0., 0., 20., 0.1, 100., 100., 100.]));
    e.configure_unified_physics(WorldConfig::default()).unwrap();
    assert!(e.spatial_scene.configure_surfaces(
        &[-100., -10., 200., 20., -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1]
    ));
    let p = capsule(&mut e, 4., 0., [100., 0., 0.]);
    let a = capsule(&mut e, 0., 0., [100., 0., 0.]);
    let b = capsule(&mut e, -50., 0., [100., 0., 0.]);
    let controlled = capsule(&mut e, -4., 2., [0., -0.75, 0.]);
    assert!(e.configure_spatial_actor(controlled.id, controlled.generation, 2., 0.3, 0.2));
    for i in 0..sensors {
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [500. + i as f32, 1., 50.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.1 })
            },
            [0.; 3],
        )
        .unwrap();
    }
    for _ in 0..120 {
        tick(&mut e);
    }
    e.world.set_movement_pattern(
        a,
        MovementPattern::Chase {
            target: MovementTarget::Entity(p),
            speed: 2.,
        },
    );
    assert!(e.configure_data_scene_gameplay_v4(
        true,
        p.id,
        p.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 0.3, 0.2, 0.1, 1., 8.]
    ));
    let mut shared = false;
    for _ in 0..80 {
        tick(&mut e);
        let t = graph(&e);
        shared = t.rows.iter().any(|a| {
            matches!(a.location, Location::AgentRoute { .. })
                && t.rows.iter().any(|b| {
                    matches!(b.location, Location::CacheRoute { .. }) && a.first == b.first
                })
        });
        if shared {
            break;
        }
    }
    assert!(
        shared,
        "normal completed route must be shared by cache and agent"
    );
    (e, p, b, controlled)
}
#[test]
fn real_native_cache_agent_and_controlled_actor_routes_keep_alias_and_six_step_replay() {
    let (mut e, _, _, controlled) = route_fixture(0);
    assert!(e.move_data_scene_spatial_actor_to(-2., 2., 0, 2., 0.5, 0.02, true));
    let table = graph(&e);
    assert!(table
        .rows
        .iter()
        .any(|r| matches!(r.location, Location::ActorRoute { .. })));
    let initial_pose = e.unified_body_state(controlled).unwrap().pose;
    let initial_target = e
        .unified_physics
        .as_ref()
        .unwrap()
        .actor_navigation
        .target();
    let before = bytes(&e);
    let mut candidate = detached(&e);
    restore(&mut candidate, &table, limits()).unwrap();
    assert_eq!(bytes(&candidate), before);
    assert_eq!(graph(&candidate), table);
    for _ in 0..6 {
        tick(&mut e);
        tick(&mut candidate);
        assert_eq!(bytes(&e), bytes(&candidate));
        assert_eq!(graph(&e), graph(&candidate));
    }
    let observed = e.unified_body_state(controlled).unwrap().pose;
    let target = initial_target.unwrap();
    // This API projects screen Y to native -Z. The certified first leg is
    // [2,-4], not a pure +X route; six nominal ticks at speed2 travel0.2.
    assert_eq!([target.position[0], target.position[2]], [-2., -2.]);
    let delta = [
        f64::from(target.position[0]) - f64::from(initial_pose.position[0]),
        f64::from(target.position[2]) - f64::from(initial_pose.position[2]),
    ];
    let length = delta[0].hypot(delta[1]);
    let travel = 2.0 * 6.0 * f64::from(e.fixed_timestep.config().step_seconds);
    let magnitude = initial_pose
        .position
        .iter()
        .chain(target.position.iter())
        .fold(1.0_f32, |m, x| m.max(x.abs()));
    let rounding = f64::from(6.0 * f32::EPSILON * magnitude);
    for (axis, d) in [(0, delta[0]), (2, delta[1])] {
        let expected = f64::from(initial_pose.position[axis]) + travel * d / length;
        assert!(
            (f64::from(observed.position[axis]) - expected).abs() <= rounding,
            "axis{axis}: {observed:?} vs{expected}"
        );
    }
    assert_eq!(
        e.unified_physics.as_ref().unwrap().actor_navigation.status as u32,
        1
    );

    assert_eq!(
        e.data_scene_combat_navigation_scheduler_stats(),
        candidate.data_scene_combat_navigation_scheduler_stats()
    );
}
#[test]
fn real_suspended_cache_connector_root_is_captured_and_continues_without_cache_reset() {
    let (mut e, p, b, _) = route_fixture(1000);
    e.world.set_movement_pattern(
        b,
        MovementPattern::Chase {
            target: MovementTarget::Entity(p),
            speed: 2.,
        },
    );
    let mut pending = false;
    for _ in 0..30 {
        tick(&mut e);
        let t = graph(&e);
        pending = t.rows.iter().any(|a| {
            matches!(a.location, Location::Connector { .. })
                && t.rows.iter().any(|b| {
                    matches!(b.location, Location::CacheRoute { .. }) && a.first == b.first
                })
        });
        if pending {
            break;
        }
    }
    assert!(
        pending,
        "normal cached join must suspend a connector slice: {:?}",
        e.data_scene_combat_navigation_scheduler_stats()
    );
    let table = graph(&e);
    let before = bytes(&e);
    let scheduler = e.data_scene_combat_navigation_scheduler_stats();
    let mut candidate = detached(&e);
    restore(&mut candidate, &table, limits()).unwrap();
    assert_eq!(bytes(&candidate), before);
    assert_eq!(
        candidate.data_scene_combat_navigation_scheduler_stats(),
        scheduler
    );
    assert_eq!(graph(&candidate), table);
    for _ in 0..6 {
        tick(&mut e);
        tick(&mut candidate);
        assert_eq!(bytes(&e), bytes(&candidate));
        assert_eq!(graph(&e), graph(&candidate));
        assert_eq!(
            e.data_scene_combat_navigation_scheduler_stats(),
            candidate.data_scene_combat_navigation_scheduler_stats()
        );
    }
    let after = e.data_scene_combat_navigation_scheduler_stats();
    assert!(after[5] > scheduler[5], "pending connector did not advance");
    assert_eq!(after[3], scheduler[3], "cache entries were reset");
    assert_eq!(after[7], scheduler[7], "pending connector was cancelled");
}

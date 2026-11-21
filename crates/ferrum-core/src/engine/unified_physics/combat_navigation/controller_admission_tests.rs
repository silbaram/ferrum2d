use super::tests::{capsule, setup, tick};
use super::*;
use crate::components::gameplay::MovementTarget;
use crate::engine::file_controller_admission::{self as guard, Error, Limits};
fn limits() -> Limits {
    Limits {
        max_work: 16_000_000,
        max_scratch_bytes: 1_000_000,
    }
}
fn nav(e: &mut Engine) -> &mut NativeCombatNavigation {
    e.data_scene.gameplay.combat.file_native_routes_mut()
}
fn completed() -> (Engine, Entity, Entity) {
    let (mut e, p, a) = setup();
    assert!(e.configure_data_scene_gameplay_v5(
        true,
        p.id,
        p.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 0.3, 0.2, 0.1, 1., 64., 0.1],
        &[],
        &[]
    ));
    for _ in 0..80 {
        tick(&mut e, 1);
        guard::validate(&e, limits()).unwrap();
        if e.data_scene_combat_navigation_scheduler_stats()[3] > 0 {
            break;
        }
    }
    assert!(e.data_scene_combat_navigation_scheduler_stats()[3] > 0);
    (e, p, a)
}
fn detached(e: &Engine) -> Box<Engine> {
    let l = crate::engine::file_sharing::Limits {
        max_work: 16_000_000,
        max_scratch_bytes: 16_000_000,
        max_roots: 1_000_000,
        max_compare_bytes: 16_000_000,
    };
    let (t, _) = crate::engine::file_sharing::capture(e, l).unwrap();
    let memory = crate::engine::persistence::encode(e).unwrap();
    let candidate = crate::engine::persistence::decode(&memory).unwrap();
    let (candidate, _) = crate::engine::file_sharing::restore(candidate, t, l).unwrap();
    assert_eq!(
        crate::engine::persistence::encode(&candidate).unwrap(),
        memory
    );
    candidate
}
#[test]
fn controller_admission_actual_routes_crowd_and_top_actor_survive_six_ticks() {
    let (mut source, p, a) = completed();
    assert!(
        source.configure_spatial_camera(&[0., 0., 8., 10., 0., 0., 0., 20., 0.1, 100., 100., 100.])
    );
    assert!(source.configure_spatial_actor(p.id, p.generation, 2., 0.3, 0.2));
    assert!(source.move_data_scene_spatial_actor_to(106., 0., 0, 2., 0.5, 0.02, true));
    let before = crate::engine::persistence::encode(&source).unwrap();
    let mut candidate = detached(&source);
    let usage = guard::validate(&candidate, limits()).unwrap();
    assert!(usage.work > 100);
    assert_eq!(
        crate::engine::persistence::encode(&candidate).unwrap(),
        before
    );
    let start = source.unified_body_state(p).unwrap().pose;
    for _ in 0..6 {
        tick(&mut source, 1);
        tick(&mut candidate, 1);
        guard::validate(&candidate, limits()).unwrap();
        assert_eq!(
            crate::engine::persistence::encode(&source).unwrap(),
            crate::engine::persistence::encode(&candidate).unwrap()
        );
    }
    assert!(source.unified_body_state(p).unwrap().pose.position[0] > start.position[0] + 0.1);
    // Normal stale tokens/observations survive external removal until the next tick.
    source.remove_unified_body(a).unwrap();
    source.world.despawn(a);
    let frozen = crate::engine::persistence::encode(&source).unwrap();
    guard::validate(&source, limits()).unwrap();
    assert_eq!(crate::engine::persistence::encode(&source).unwrap(), frozen);
    let mut stale = detached(&source);
    guard::validate(&stale, limits()).unwrap();
    for _ in 0..3 {
        tick(&mut source, 1);
        tick(&mut stale, 1);
        assert_eq!(
            crate::engine::persistence::encode(&source).unwrap(),
            crate::engine::persistence::encode(&stale).unwrap()
        );
    }
}
#[test]
fn controller_admission_real_pending_connector_keeps_cache_and_force_once() {
    let (mut e, p, _) = setup();
    assert!(e.spatial_scene.configure_surfaces(
        &[-100., -10., 200., 20., -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1]
    ));
    let b = capsule(&mut e, -50., 0.);
    for i in 0..1000 {
        e.create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [500. + i as f32, 1., 50.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(crate::physics3d::Shape::Sphere { radius: 0.1 })
            },
            [0.; 3],
        )
        .unwrap();
    }
    for _ in 0..100 {
        tick(&mut e, 1);
        guard::validate(&e, limits()).unwrap();
        if e.data_scene_combat_navigation_scheduler_stats()[3] > 0 {
            break;
        }
    }
    assert!(e.data_scene_combat_navigation_scheduler_stats()[3] > 0);
    e.world.set_movement_pattern(
        b,
        MovementPattern::Chase {
            target: MovementTarget::Entity(p),
            speed: 2.,
        },
    );
    for _ in 0..30 {
        tick(&mut e, 1);
        guard::validate(&e, limits()).unwrap();
        if nav(&mut e)
            .pending
            .as_ref()
            .is_some_and(|p| matches!(p.kind, JobKind::Connector(_)))
        {
            break;
        }
    }
    assert!(nav(&mut e)
        .pending
        .as_ref()
        .is_some_and(|p| matches!(p.kind, JobKind::Connector(_))));
    let aux = e
        .create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::KinematicPosition,
                pose: Pose {
                    position: [-20., 2., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(crate::physics3d::Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
            [0.; 3],
        )
        .unwrap();
    e.enable_unified_character(
        aux,
        CharacterConfig {
            push_mass: 10.,
            ..CharacterConfig::default()
        },
    )
    .unwrap();
    e.set_unified_character_input(
        aux,
        crate::physics3d::CharacterInput {
            velocity: [0.; 3],
            jump_speed: 3.,
        },
    )
    .unwrap();
    let aux_body = e.unified_body_id(aux).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    runtime
        .physics
        .add_character_force(aux_body, [10., 0., 0.])
        .unwrap();
    runtime
        .physics
        .apply_character_impulse(aux_body, [5., 0., 0.])
        .unwrap();
    let stats = e.data_scene_combat_navigation_scheduler_stats();
    let wire = crate::engine::persistence::encode(&e).unwrap();
    let mut c = detached(&e);
    let usage = guard::validate(&c, limits()).unwrap();
    let exact = Limits {
        max_work: usage.work,
        max_scratch_bytes: usage.scratch_bytes,
    };
    assert_eq!(guard::validate(&c, exact).unwrap(), usage);
    assert_eq!(
        guard::validate(
            &c,
            Limits {
                max_work: usage.work - 1,
                ..exact
            }
        ),
        Err(Error::Work)
    );
    assert!(matches!(
        guard::validate(
            &c,
            Limits {
                max_scratch_bytes: usage.scratch_bytes - 1,
                ..exact
            }
        ),
        Err(Error::Scratch)
    ));
    assert_eq!(crate::engine::persistence::encode(&c).unwrap(), wire);
    let dt = e.fixed_timestep.config().step_seconds;
    let mut previous_x = e.unified_body_state(aux).unwrap().pose.position[0];
    for step in 1..=6 {
        tick(&mut e, 1);
        tick(&mut c, 1);
        guard::validate(&c, limits()).unwrap();
        assert_eq!(
            crate::engine::persistence::encode(&e).unwrap(),
            crate::engine::persistence::encode(&c).unwrap()
        );
        // J/m is consumed once, then F/m accumulates on each tick. Compare
        // the represented endpoint because the published rate is measured
        // from that endpoint, including F32 rounding of the position.
        let expected_velocity = 0.5 + step as f32 * dt;
        let expected_x = previous_x + expected_velocity * dt;
        let realized_velocity = (expected_x - previous_x) / dt;
        let actual_x = e.unified_body_state(aux).unwrap().pose.position[0];
        let actual_velocity = e.unified_character_state(aux).unwrap().velocity[0];
        assert_eq!(actual_x.to_bits(), expected_x.to_bits(), "tick {step}");
        assert_eq!(
            actual_velocity.to_bits(),
            realized_velocity.to_bits(),
            "tick {step}"
        );
        previous_x = actual_x;
    }
    let after = e.data_scene_combat_navigation_scheduler_stats();
    assert!(after[5] > stats[5]);
    assert_eq!(after[3], stats[3]);
    assert_eq!(after[7], stats[7]);
}
#[test]
fn controller_admission_native_valid_crc_bad_fields_do_not_mutate_bytes() {
    let (source, _, _) = completed();
    let original = crate::engine::persistence::encode(&source).unwrap();
    for case in 0..12 {
        let mut bad = crate::engine::persistence::decode(&original).unwrap();
        let n = nav(&mut bad);
        match case {
            0 => n.used = FRAME_WORK + 1,
            1 => n.cursor = 64,
            2 => n.agents.push(n.agents[0].clone()),
            3 => n.agents[0].speed = f32::NAN,
            4 => n.agents[0].cooldown = -1.,
            5 => n.agents[0].intent.vx = f32::INFINITY,
            6 => n.agents[0].detour = Some(([2., 0.], 1.)),
            7 => {
                n.peers = vec![crate::physics3d::CharacterCrowdPeer {
                    body: crate::physics3d::BodyId {
                        slot: 1,
                        generation: 1,
                    },
                    velocity: [f32::NAN, 0., 0.],
                }]
            }
            8 => n.frame_searches = 2,
            9 => n.frame_search_work = SLICE_WORK as u32 + 1,
            10 => n.peak_work = 8_000_001,
            _ => n.request_status = 9,
        }
        let bytes = crate::engine::persistence::encode(&bad).unwrap();
        let candidate = crate::engine::persistence::decode(&bytes).unwrap();
        assert!(
            matches!(
                guard::validate(&candidate, limits()),
                Err(Error::Invalid { .. })
            ),
            "case{case}"
        );
        assert_eq!(
            crate::engine::persistence::encode(&candidate).unwrap(),
            bytes
        );
        assert_eq!(
            crate::engine::persistence::encode(&source).unwrap(),
            original
        );
    }
}
#[test]
fn controller_admission_native_max64_stale_agent_peer_tokens_are_bounded() {
    let (mut e, _, _) = completed();
    let n = nav(&mut e);
    let mut base = n.agents[0].clone();
    base.route = ActorNavigation::default();
    n.agents.clear();
    n.peers.clear();
    n.pending = None;
    for i in 0..64 {
        let mut a = base.clone();
        a.entity = Entity {
            id: u32::MAX - i,
            generation: 5,
        };
        n.agents.push(a);
        n.peers.push(crate::physics3d::CharacterCrowdPeer {
            body: crate::physics3d::BodyId {
                slot: u32::MAX - i,
                generation: 5,
            },
            velocity: [0.; 3],
        });
    }
    n.cursor = 63;
    n.used = FRAME_WORK;
    n.frame_searches = 1;
    n.frame_search_work = SLICE_WORK as u32;
    n.peak_work = 8_000_000;
    n.nodes = 4096;
    n.probes = 32768;
    let bytes = crate::engine::persistence::encode(&e).unwrap();
    let candidate = crate::engine::persistence::decode(&bytes).unwrap();
    let u = guard::validate(&candidate, limits()).unwrap();
    assert_eq!(
        guard::validate(
            &candidate,
            Limits {
                max_work: u.work,
                max_scratch_bytes: u.scratch_bytes
            }
        )
        .unwrap(),
        u
    );
    let mut too_many = candidate;
    let n = nav(&mut too_many);
    n.agents.push(n.agents[0].clone());
    assert!(guard::validate(&too_many, limits()).is_err());
}
#[test]
fn controller_admission_public64_agent_producer_is_not_reduced_by_empty_slot_cost() {
    let (mut e, p, _) = setup();
    for i in 0..63 {
        let a = capsule(&mut e, -8. + (i % 16) as f32, -8. + (i / 16) as f32 * 2.);
        e.world.set_movement_pattern(
            a,
            MovementPattern::Chase {
                target: MovementTarget::Entity(p),
                speed: 2.,
            },
        );
    }
    assert!(e.configure_data_scene_gameplay_v5(
        true,
        p.id,
        p.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 0.3, 0.2, 0.1, 1., 64., 0.1],
        &[],
        &[]
    ));
    tick(&mut e, 1);
    assert_eq!(nav(&mut e).agents.len(), 64);
    assert_eq!(nav(&mut e).peers.len(), 64);
    let memory = crate::engine::persistence::encode(&e).unwrap();
    let candidate = detached(&e);
    let u = guard::validate(&candidate, limits()).unwrap();
    assert!(u.work < 128 * 1024 * 1024);
    assert_eq!(
        crate::engine::persistence::encode(&candidate).unwrap(),
        memory
    );
}
#[test]
fn controller_admission_rejected_high_floor_request_retains_raw_agent_history() {
    let (mut e, _, a) = completed();
    assert!(e.spawn_data_scene_entity(
        4.,
        0.,
        0.,
        0,
        1,
        1.,
        1.,
        0.,
        0.,
        1.,
        1.,
        1,
        1.,
        crate::engine::PHYSICS_LAYER_PLAYER,
        crate::engine::PHYSICS_COLLIDER_TYPE_NONE,
        0.,
        0.,
        false,
        false,
        0.5,
        0.5,
        0.5,
        0.,
        0.,
        0.,
        0.,
        0.,
        Vec::new()
    ));
    let target = Entity {
        id: e.data_scene_entity_id(),
        generation: e.data_scene_entity_generation(),
    };
    e.world.set_height_span(
        target,
        crate::components::HeightSpan::new(crate::components::PhysicsFloorId(u32::MAX), 0., 0.)
            .unwrap(),
    );
    e.world.set_movement_pattern(
        a,
        MovementPattern::Chase {
            target: MovementTarget::Entity(target),
            speed: 2.,
        },
    );
    tick(&mut e, 1);
    let n = nav(&mut e);
    assert_eq!(n.agents[0].floor, u32::MAX);
    assert_eq!(n.request_status, 2);
    let before = crate::engine::persistence::encode(&e).unwrap();
    let mut candidate = detached(&e);
    guard::validate(&candidate, limits()).unwrap();
    assert_eq!(
        crate::engine::persistence::encode(&candidate).unwrap(),
        before
    );
    for _ in 0..3 {
        tick(&mut e, 1);
        tick(&mut candidate, 1);
        assert_eq!(
            crate::engine::persistence::encode(&e).unwrap(),
            crate::engine::persistence::encode(&candidate).unwrap()
        );
    }
}

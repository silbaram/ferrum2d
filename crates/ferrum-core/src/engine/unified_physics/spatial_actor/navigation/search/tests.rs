use super::*;
use crate::engine::Engine;
use crate::entity::Entity;
use crate::physics3d::{
    BodyDesc, BodyKind, BodyOptions, CharacterConfig, CharacterInput, ColliderDesc, Shape,
    WorldConfig,
};

fn capsule(e: &mut Engine, x: f32, z: f32) -> Entity {
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
            [0.; 3],
        )
        .unwrap();
    e.enable_unified_character(a, CharacterConfig::default())
        .unwrap();
    a
}
fn setup(wall: bool) -> (Engine, Entity, Option<Entity>) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig::default()).unwrap();
    assert!(e.spatial_scene.configure_surfaces(
        &[-20., -20., 100., 40., -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1]
    ));
    let a = capsule(&mut e, 0., 0.);
    let wall = wall.then(|| {
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [1.5, 1., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.3, 1., 0.6],
            }),
            [0.; 3],
        )
        .unwrap()
    });
    for _ in 0..120 {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
    }
    assert!(e.unified_character_state(a).unwrap().grounded);
    (e, a, wall)
}
fn job(e: &Engine, a: Entity, x: f32, z: f32) -> Search {
    let runtime = e.unified_physics.as_ref().unwrap();
    let body = e.unified_body_id(a).unwrap();
    let start = e.unified_body_state(a).unwrap().pose;
    Search::new(
        runtime,
        &e.spatial_scene,
        body,
        Pose {
            position: [x, start.position[1], z],
            ..start
        },
        0,
        0.5,
    )
    .unwrap()
}
fn advance(e: &mut Engine, job: &mut Search, budget: u64) -> Result<Option<Vec<Point>>, u32> {
    let before = job.work;
    let result = job.advance(
        e.unified_physics.as_mut().unwrap(),
        &e.spatial_scene,
        budget,
    );
    assert!(job.work - before <= budget);
    result
}
fn finish(e: &mut Engine, job: &mut Search, budget: u64) -> (Vec<Point>, usize) {
    for slices in 1..100_000 {
        if let Some(route) = advance(e, job, budget).unwrap() {
            return (route, slices);
        }
    }
    panic!("search failed to make progress");
}
fn points(route: &[Point]) -> Vec<([f32; 3], u32)> {
    route.iter().map(|p| (p.pose.position, p.surface)).collect()
}

#[test]
fn native_navigation_slices_resume_a_long_edge_without_repeating_probes() {
    let (mut e, a, _) = setup(false);
    let mut full = job(&e, a, 40., 0.);
    let (expected, _) = finish(&mut e, &mut full, MAX_WORK);
    let mut sliced = job(&e, a, 40., 0.);
    let (actual, slices) = finish(&mut e, &mut sliced, 32);
    assert!(slices > 20, "{slices}");
    assert_eq!(points(&actual), points(&expected));
    assert_eq!(sliced.probes, full.probes);
    assert_eq!(sliced.expanded, full.expanded);
    assert!(sliced.work >= full.work); // Each resume admits and checks its retained geometry snapshot.
    assert_eq!(advance(&mut e, &mut sliced, 32).err(), Some(8));
}

#[test]
fn native_navigation_slices_preserve_the_frontier_and_exact_detour() {
    let (mut e, a, _) = setup(true);
    let mut full = job(&e, a, 3., 0.);
    let (expected, _) = finish(&mut e, &mut full, MAX_WORK);
    assert!(expected.iter().any(|p| p.pose.position[2].abs() > 0.85));
    for budget in [32, 64, 257] {
        let mut sliced = job(&e, a, 3., 0.);
        let (actual, slices) = finish(&mut e, &mut sliced, budget);
        assert!(slices > 1);
        assert_eq!(points(&actual), points(&expected));
        assert_eq!(sliced.probes, full.probes);
        assert_eq!(sliced.expanded, full.expanded);
    }
}

#[test]
fn native_navigation_slices_admit_before_queries_and_preserve_pending_jump() {
    let (mut e, a, _) = setup(false);
    e.set_unified_character_input(
        a,
        CharacterInput {
            velocity: [1., 0., 0.],
            jump_speed: 4.,
        },
    )
    .unwrap();
    let state = e.unified_body_state(a).unwrap();
    let mut search = job(&e, a, 20., 0.);
    for budget in [0, 1] {
        assert!(advance(&mut e, &mut search, budget).unwrap().is_none());
        assert_eq!(search.work, 0);
        assert_eq!(search.probes, 0);
    }
    finish(&mut e, &mut search, 32);
    assert_eq!(e.unified_body_state(a).unwrap(), state);
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    let after = e.unified_body_state(a).unwrap();
    assert!(after.pose.position[0] > state.pose.position[0]);
    assert!(after.pose.position[1] > state.pose.position[1]);
    assert!(e.unified_character_state(a).unwrap().vertical_speed > 3.);
}

#[test]
fn native_navigation_slices_cancel_after_same_count_geometry_or_filter_edits() {
    for edit in 0..9 {
        let (mut e, a, wall) = setup(true);
        let wall = wall.unwrap();
        let mut search = job(&e, a, 40., 0.);
        assert!(advance(&mut e, &mut search, 32).unwrap().is_none());
        assert!(search.snapshot.is_some());
        let probes = search.probes;
        let w = e.unified_body_id(wall).unwrap();
        let source = e.unified_body_id(a).unwrap();
        let runtime = e.unified_physics.as_mut().unwrap();
        let id = runtime.physics.collider_ids(w).unwrap().next().unwrap();
        match edit {
            0 => runtime
                .physics
                .set_pose(
                    w,
                    Pose {
                        position: [2., 1., 0.],
                        ..Pose::default()
                    },
                )
                .unwrap(),
            1 => runtime
                .physics
                .update_collider(id, ColliderDesc::new(Shape::Sphere { radius: 1. }))
                .unwrap(),
            2 => runtime
                .physics
                .update_collider(
                    id,
                    ColliderDesc {
                        category: 0,
                        ..ColliderDesc::new(Shape::Box {
                            half_extents: [0.3, 1., 0.6],
                        })
                    },
                )
                .unwrap(),
            3 => runtime
                .physics
                .set_body_options(
                    w,
                    &BodyOptions {
                        kind: BodyKind::Fixed,
                        enabled: false,
                        ..BodyOptions::default()
                    },
                )
                .unwrap(),
            4 => runtime
                .physics
                .set_character_traversal(source, 0.4, 0.2)
                .unwrap(),
            5 => runtime
                .physics
                .set_pose(
                    source,
                    Pose {
                        position: [0.5, 1., 0.],
                        ..Pose::default()
                    },
                )
                .unwrap(),
            6 => {
                runtime.physics.remove_collider(id).unwrap();
                runtime
                    .physics
                    .add_collider(
                        w,
                        ColliderDesc::new(Shape::Box {
                            half_extents: [0.3, 1., 0.6],
                        }),
                    )
                    .unwrap();
            }
            7 => runtime
                .physics
                .update_collider(
                    id,
                    ColliderDesc {
                        sensor: true,
                        ..ColliderDesc::new(Shape::Box {
                            half_extents: [0.3, 1., 0.6],
                        })
                    },
                )
                .unwrap(),
            _ => runtime
                .physics
                .set_terrain_one_way(
                    id,
                    Some(crate::physics3d::TerrainOneWay {
                        point: [0.; 3],
                        normal: [0., 1., 0.],
                    }),
                )
                .unwrap(),
        }
        assert_eq!(
            advance(&mut e, &mut search, 64).err(),
            Some(8),
            "edit {edit}"
        );
        assert_eq!(search.probes, probes);
    }
}

#[test]
fn native_navigation_slices_interleave_independent_agent_frontiers() {
    let (mut e, a, _) = setup(true);
    let b = capsule(&mut e, 0., 3.);
    for _ in 0..120 {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
    }
    let mut first = job(&e, a, 3., 0.);
    let mut second = job(&e, b, 5., 3.);
    let mut one = None;
    let mut two = None;
    for _ in 0..10_000 {
        if one.is_none() {
            one = advance(&mut e, &mut first, 64).unwrap();
        }
        if two.is_none() {
            two = advance(&mut e, &mut second, 64).unwrap();
        }
        if one.is_some() && two.is_some() {
            break;
        }
    }
    let one = one.unwrap();
    let two = two.unwrap();
    assert!(one.iter().any(|p| p.pose.position[2].abs() > 0.85));
    assert!((two.last().unwrap().pose.position[0] - 5.).abs() < 0.001);
    assert!((two.last().unwrap().pose.position[2] - 3.).abs() < 0.001);
    for actor in [a, b] {
        assert!(e.unified_body_state(actor).unwrap().pose.position[0].abs() <= 0.005);
    }
}

#[test]
fn native_navigation_slices_enforce_request_work_and_topology_limits() {
    let (mut e, a, _) = setup(false);
    let mut search = job(&e, a, 40., 0.);
    search.work = MAX_WORK - 1;
    assert_eq!(advance(&mut e, &mut search, 64).err(), Some(7));
    assert_eq!(search.probes, 0);
    let mut search = job(&e, a, 40., 0.);
    assert!(advance(&mut e, &mut search, 32).unwrap().is_none());
    capsule(&mut e, 10., 10.);
    let probes = search.probes;
    assert_eq!(advance(&mut e, &mut search, 64).err(), Some(8));
    assert_eq!(search.probes, probes);
}

#[test]
fn native_navigation_slices_source_edits_before_first_query_are_rejected() {
    for edit in 0..3 {
        let (mut e, a, _) = setup(false);
        let mut search = job(&e, a, 40., 0.);
        let body = e.unified_body_id(a).unwrap();
        let runtime = e.unified_physics.as_mut().unwrap();
        match edit {
            0 => runtime
                .physics
                .set_character_traversal(body, 0.4, 0.2)
                .unwrap(),
            1 => runtime
                .physics
                .set_pose(
                    body,
                    Pose {
                        position: [0.5, 1., 0.],
                        ..Pose::default()
                    },
                )
                .unwrap(),
            _ => {
                let support = runtime
                    .physics
                    .character_state(body)
                    .unwrap()
                    .ground
                    .unwrap()
                    .body;
                runtime
                    .physics
                    .set_body_options(
                        support,
                        &BodyOptions {
                            kind: BodyKind::Fixed,
                            enabled: false,
                            ..BodyOptions::default()
                        },
                    )
                    .unwrap();
            }
        }
        assert_eq!(advance(&mut e, &mut search, MAX_WORK).err(), Some(8));
        assert_eq!(search.work, 0);
        assert_eq!(search.probes, 0);
    }
}

#[test]
fn native_navigation_fixed_graph_ignores_mobile_edits_but_cancels_fixed_edits() {
    let (mut e, a, wall) = setup(true);
    let wall = wall.unwrap();
    let peer = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [10., 1., 5.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
            [0.; 3],
        )
        .unwrap();
    let mut search = job(&e, a, 40., 0.).fixed_geometry();
    assert!(advance(&mut e, &mut search, 32).unwrap().is_none());
    let peer = e.unified_body_id(peer).unwrap();
    let w = e.unified_body_id(wall).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_pose(
            peer,
            Pose {
                position: [12., 1., 5.],
                ..Pose::default()
            },
        )
        .unwrap();
    assert!(advance(&mut e, &mut search, 32).unwrap().is_none());
    let probes = search.probes;
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_pose(
            w,
            Pose {
                position: [2., 1., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    assert_eq!(advance(&mut e, &mut search, 64).err(), Some(8));
    assert_eq!(search.probes, probes);
}

#[test]
fn native_navigation_fixed_graph_membership_swaps_cancel_at_equal_counts() {
    let (mut e, a, wall) = setup(true);
    let wall = wall.unwrap();
    let peer = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [10., 1., 5.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
            [0.; 3],
        )
        .unwrap();
    let mut search = job(&e, a, 40., 0.).fixed_geometry();
    assert!(advance(&mut e, &mut search, 32).unwrap().is_none());
    let ids = [wall, peer].map(|a| e.unified_body_id(a).unwrap());
    let physics = &mut e.unified_physics.as_mut().unwrap().physics;
    for (id, kind) in ids
        .into_iter()
        .zip([BodyKind::KinematicVelocity, BodyKind::Fixed])
    {
        physics
            .set_body_options(
                id,
                &BodyOptions {
                    kind,
                    ..BodyOptions::default()
                },
            )
            .unwrap();
    }
    let probes = search.probes;
    assert_eq!(advance(&mut e, &mut search, 64).err(), Some(8));
    assert_eq!(search.probes, probes);
}

mod file_admission_tests;

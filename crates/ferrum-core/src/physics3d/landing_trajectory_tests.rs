//! Landing keeps its collision-tested prefix and resumes only its remaining tangent.
use super::*;

const START: [f32; 3] = [-10., 0.5497451, 1.041666];
const DOWN: f32 = -0.09892499;
const TANGENT_SPEED: f32 = 0.5;

fn pose(position: [f32; 3]) -> Pose {
    Pose {
        position,
        ..Pose::default()
    }
}

fn box_body(w: &mut PhysicsWorld3d, kind: BodyKind, p: [f32; 3], half: [f32; 3]) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: pose(p),
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box { half_extents: half }),
    )
    .unwrap()
}

fn fixture(kind: BodyKind) -> (PhysicsWorld3d, BodyId, BodyId) {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let floor = box_body(&mut w, kind, [0., -0.1, 0.], [20., 0.1, 20.]);
    let actor = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose(START),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    w.enable_character(
        actor,
        CharacterConfig {
            push_mass: 10.,
            step_height: 0.,
            snap_distance: 0.,
            ..CharacterConfig::default()
        },
    )
    .unwrap();
    (w, actor, floor)
}

fn falling_impulse(w: &mut PhysicsWorld3d, actor: BodyId, dt: f32) {
    // The actual interval, rather than the nominal clock, must integrate gravity once.
    w.apply_character_impulse(actor, [0., 10. * (DOWN / dt + 9.81 * dt), 5.])
        .unwrap();
}

fn step_interval(w: &mut PhysicsWorld3d, dt: f32) {
    assert!(w.begin_interval(dt, true).unwrap());
    w.step();
    w.end_interval();
    assert_eq!(w.config().step_seconds, WorldConfig::default().step_seconds);
}

#[test]
fn falling_landing_preserves_remaining_tangent_at_actual_intervals() {
    for kind in [
        BodyKind::Fixed,
        BodyKind::KinematicPosition,
        BodyKind::KinematicVelocity,
    ] {
        for dt in [0.007, 0.013, 1. / 60., 0.021, 0.1] {
            let (mut w, actor, _) = fixture(kind);
            falling_impulse(&mut w, actor, dt);
            step_interval(&mut w, dt);
            let state = w.character_state(actor).unwrap();
            let p = w.body_state(actor).unwrap().pose.position;
            assert!(state.grounded, "{kind:?} dt={dt}: {state:?}");
            assert!((p[1] - 0.51).abs() < 0.001, "{p:?}");
            assert!(
                (p[2] - START[2] - TANGENT_SPEED * dt).abs() < 4e-5,
                "{kind:?} dt={dt}: {p:?} {state:?}"
            );
            assert_eq!(w.characters[&actor].pending_impulse, [0.; 3]);
            assert_eq!(state.dropped_contacts, 0);
        }
    }
}

#[test]
fn landing_suffix_stops_at_wall_instead_of_reusing_full_endpoint() {
    let (mut w, actor, _) = fixture(BodyKind::KinematicPosition);
    // Floor contact occurs at z=1.0450313; the remaining path hits this wall.
    box_body(&mut w, BodyKind::Fixed, [-10., 1., 1.3565], [1., 1., 0.05]);
    falling_impulse(&mut w, actor, 1. / 60.);
    w.step();
    let p = w.body_state(actor).unwrap().pose.position;
    assert!(p[2] > 1.0455 && p[2] < 1.0470, "{p:?}");
    assert!(w.character_state(actor).unwrap().grounded);
    assert_eq!(w.character_state(actor).unwrap().dropped_contacts, 0);
}

#[test]
fn landing_continuation_keeps_wall_in_same_compound_collider() {
    let (mut w, actor, floor) = fixture(BodyKind::KinematicPosition);
    w.remove_body(floor).unwrap();
    w.create_body(
        BodyDesc {
            kind: BodyKind::KinematicPosition,
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Compound {
            parts: vec![
                ShapePart {
                    pose: pose([0., -0.1, 0.]),
                    shape: Shape::Box {
                        half_extents: [20., 0.1, 20.],
                    },
                },
                ShapePart {
                    pose: pose([-10., 1., 1.3565]),
                    shape: Shape::Box {
                        half_extents: [1., 1., 0.05],
                    },
                },
            ],
        }),
    )
    .unwrap();
    falling_impulse(&mut w, actor, 1. / 60.);
    w.step();
    let p = w.body_state(actor).unwrap().pose.position;
    assert!(p[2] > 1.0455 && p[2] < 1.0470, "{p:?}");
    assert!(w.character_state(actor).unwrap().grounded);
}

#[test]
fn landing_physically_fitting_ceiling_preserves_tangent() {
    for ceiling in [false, true] {
        let (mut w, actor, _) = fixture(BodyKind::KinematicPosition);
        w.set_pose(actor, pose([-10., 0.5097955, 0.])).unwrap();
        if ceiling {
            // The real capsule fits; two preferred skin margins do not.
            box_body(&mut w, BodyKind::Fixed, [-10., 1.1103, 0.], [1., 0.1, 1.]);
        }
        falling_impulse(&mut w, actor, 1. / 60.);
        w.step();
        let p = w.body_state(actor).unwrap().pose.position;
        assert!((p[1] - 0.5097955).abs() < 0.0003, "{p:?}");
        if ceiling {
            assert!(
                (p[2] - TANGENT_SPEED / 60.).abs() < 4e-5,
                "physical fit must retain the tangent: {p:?}"
            );
            assert!(p[1] - 0.5 >= 0. && p[1] + 0.5 <= 1.0103 + 2e-6, "{p:?}");
            assert!(
                (p[1] - 0.5097955).abs() < 2e-6,
                "shim must restore its vertical placement: {p:?}"
            );
            println!(
                "FORMER_SAFE_STOP fit=true p={p:?} floor_gap={} roof_gap={} net_vertical={}",
                p[1] - 0.5,
                1.0103 - p[1] - 0.5,
                p[1] - 0.5097955
            );
        } else {
            assert!(
                (p[2] - TANGENT_SPEED / 60.).abs() < 4e-5,
                "control must resume: {p:?}"
            );
        }
    }
}

#[test]
fn landing_one_way_catches_above_and_does_not_catch_below() {
    for below in [false, true] {
        let (mut w, actor, floor) = fixture(BodyKind::KinematicPosition);
        let collider = w.collider_ids(floor).unwrap().next().unwrap();
        w.set_terrain_one_way(
            collider,
            Some(TerrainOneWay {
                point: [0., 0.1, 0.],
                normal: [0., 1., 0.],
            }),
        )
        .unwrap();
        if below {
            w.set_pose(actor, pose([-10., -0.8, START[2]])).unwrap();
            w.apply_character_impulse(actor, [0., 300., 5.]).unwrap();
        } else {
            falling_impulse(&mut w, actor, 1. / 60.);
        }
        w.step();
        let p = w.body_state(actor).unwrap().pose.position;
        let state = w.character_state(actor).unwrap();
        assert!(
            (p[2] - START[2] - TANGENT_SPEED / 60.).abs() < 4e-5,
            "{p:?}"
        );
        if below {
            assert!(p[1] > -0.31 && p[1] < -0.30, "{p:?}");
            assert!(!state.grounded);
        } else {
            assert!(state.grounded);
            assert!((p[1] - 0.51).abs() < 0.001, "{p:?}");
        }
    }
}

#[test]
fn landing_checkpoint_replays_pending_impulse_and_variable_intervals_exactly() {
    let (mut w, actor, _) = fixture(BodyKind::KinematicPosition);
    falling_impulse(&mut w, actor, 0.013);
    let saved = w.capture_snapshot().unwrap();
    let mut reference = PhysicsWorld3d::from_snapshot(&saved).unwrap();
    for dt in [0.013, 0.007, 0.021, 1. / 60.] {
        step_interval(&mut w, dt);
        step_interval(&mut reference, dt);
        assert_eq!(
            w.body_state(actor).unwrap(),
            reference.body_state(actor).unwrap()
        );
        assert_eq!(
            w.character_state(actor).unwrap(),
            reference.character_state(actor).unwrap()
        );
        assert_eq!(
            w.characters[&actor].pending_impulse,
            reference.characters[&actor].pending_impulse
        );
        assert_eq!(
            w.characters[&actor].external_velocity,
            reference.characters[&actor].external_velocity
        );
        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            reference.capture_snapshot().unwrap().encoded_bytes()
        );
    }
    let final_state = w.body_state(actor).unwrap();
    w.restore_snapshot(&saved).unwrap();
    for dt in [0.013, 0.007, 0.021, 1. / 60.] {
        step_interval(&mut w, dt);
    }
    assert_eq!(w.body_state(actor).unwrap(), final_state);
    assert_eq!(w.characters[&actor].pending_impulse, [0.; 3]);
}

#[test]
fn landing_suffix_respects_step_height_and_ceiling() {
    for (height, ceiling, crosses) in [(0.2, false, true), (0.6, false, false), (0.2, true, false)]
    {
        let (mut w, actor, _) = fixture(BodyKind::KinematicPosition);
        w.characters.get_mut(&actor).unwrap().config.step_height = 0.3;
        box_body(
            &mut w,
            BodyKind::Fixed,
            [-10., height / 2., 1.4],
            [1., height / 2., 0.1],
        );
        if ceiling {
            box_body(
                &mut w,
                BodyKind::Fixed,
                [-10., 1.15, START[2]],
                [1., 0.1, 1.],
            );
        }
        falling_impulse(&mut w, actor, 1. / 60.);
        w.step();
        let p = w.body_state(actor).unwrap().pose.position;
        if crosses {
            // The spherical capsule first rises along the low step's edge; one
            // short interval does not yet complete the whole 0.2-height step.
            assert!(p[1] > 0.519 && p[1] < 0.522, "{p:?}");
            assert!(p[2] > 1.046 && p[2] < 1.048, "{p:?}");
        } else if ceiling {
            assert!(p[1] > 0.509 && p[1] < 0.512, "{p:?}");
            assert!(p[2] < 1.048, "ceiling must prohibit stepping: {p:?}");
        } else {
            assert!(
                (p[1] - START[1]).abs() < 2e-4,
                "too-high step must prohibit stepping: {p:?}"
            );
            assert!(p[2] <= START[2], "{p:?}");
        }
    }
}

#[test]
fn landing_on_ramps_preserves_cross_slope_tangent_without_gravity_drift() {
    for (slope, walkable) in [(0.5, true), (1.7320508, false)] {
        let (mut w, actor, floor) = fixture(BodyKind::KinematicPosition);
        w.remove_body(floor).unwrap();
        w.create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::TriangleMesh {
                vertices: vec![
                    [-2., -2. * slope, -5.],
                    [2., 2. * slope, -5.],
                    [2., 2. * slope, 5.],
                    [-2., -2. * slope, 5.],
                ],
                triangles: vec![[0, 2, 1], [0, 3, 2]],
            }),
        )
        .unwrap();
        // A capsule's support extent on y=slope*x is half_height + r/cos(angle).
        let contact_y = 0.25 + 0.26 * (1. + slope * slope).sqrt();
        w.set_pose(actor, pose([0., contact_y + 0.04, START[2]]))
            .unwrap();
        falling_impulse(&mut w, actor, 1. / 60.);
        w.step();
        let p = w.body_state(actor).unwrap().pose.position;
        let state = w.character_state(actor).unwrap();
        println!(
            "landing ramp: slope={slope}, p={p:?}, grounded={}, sliding={}",
            state.grounded, state.sliding
        );
        assert!(
            (p[2] - START[2] - TANGENT_SPEED / 60.).abs() < 4e-5,
            "{p:?}"
        );
        if walkable {
            assert!(state.grounded);
            assert!(
                p[0].abs() < 2e-4,
                "gravity may not manufacture downhill input: {p:?}"
            );
            assert!((p[1] - contact_y).abs() < 0.002, "{p:?}");
        } else {
            assert!(!state.grounded);
            assert!(p[0] < -0.001 && p[1] < contact_y, "{p:?}");
        }
    }
}

#[test]
fn landing_beside_ledge_does_not_restore_a_blocked_or_unsupported_path() {
    let (mut w, actor, floor) = fixture(BodyKind::KinematicPosition);
    w.remove_body(floor).unwrap();
    box_body(
        &mut w,
        BodyKind::KinematicPosition,
        [-10., -0.1, START[2]],
        [1., 0.1, 0.05],
    );
    w.apply_character_impulse(actor, [0., 10. * (DOWN / 0.1 + 9.81 * 0.1), 50.])
        .unwrap();
    step_interval(&mut w, 0.1);
    let p = w.body_state(actor).unwrap().pose.position;
    let state = w.character_state(actor).unwrap();
    println!("landing ledge: p={p:?}, state={state:?}");
    assert!(
        !state.grounded,
        "the departed ledge cannot remain support: {p:?}"
    );
    assert!(p[1] < 0.5, "leaving support must remain a drop: {p:?}");
    assert!((p[2] - START[2] - 0.5).abs() < 0.001, "{p:?}");
}

// Counts dispatcher calls to admitted collider leaves. BVH traversal, each shape's
// internal GJK/composite work and KCC's direct contact-manifold queries are separate.
mod cast_work {
    use super::*;
    use rapier3d::{parry::query::*, prelude as rp};
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct CountingDispatcher(AtomicUsize);
    impl QueryDispatcher for CountingDispatcher {
        fn intersection_test(
            &self,
            p: &rp::Pose,
            a: &dyn rp::Shape,
            b: &dyn rp::Shape,
        ) -> Result<ShapeIntersection, Unsupported> {
            DefaultQueryDispatcher.intersection_test(p, a, b)
        }
        fn distance(
            &self,
            p: &rp::Pose,
            a: &dyn rp::Shape,
            b: &dyn rp::Shape,
        ) -> Result<ShapeDistance, Unsupported> {
            DefaultQueryDispatcher.distance(p, a, b)
        }
        fn contact(
            &self,
            p: &rp::Pose,
            a: &dyn rp::Shape,
            b: &dyn rp::Shape,
            prediction: f32,
        ) -> Result<Option<Contact>, Unsupported> {
            DefaultQueryDispatcher.contact(p, a, b, prediction)
        }
        fn closest_points(
            &self,
            p: &rp::Pose,
            a: &dyn rp::Shape,
            b: &dyn rp::Shape,
            max: f32,
        ) -> Result<ClosestPoints, Unsupported> {
            DefaultQueryDispatcher.closest_points(p, a, b, max)
        }
        fn cast_shapes(
            &self,
            p: &rp::Pose,
            v: rp::Vector,
            a: &dyn rp::Shape,
            b: &dyn rp::Shape,
            options: ShapeCastOptions,
        ) -> Result<Option<ShapeCastHit>, Unsupported> {
            self.0.fetch_add(1, Ordering::Relaxed);
            DefaultQueryDispatcher.cast_shapes(p, v, a, b, options)
        }
        fn cast_shapes_nonlinear(
            &self,
            m1: &NonlinearRigidMotion,
            a: &dyn rp::Shape,
            m2: &NonlinearRigidMotion,
            b: &dyn rp::Shape,
            start: f32,
            end: f32,
            stop: bool,
        ) -> Result<Option<ShapeCastHit>, Unsupported> {
            DefaultQueryDispatcher.cast_shapes_nonlinear(m1, a, m2, b, start, end, stop)
        }
    }

    fn probe(
        w: &mut PhysicsWorld3d,
        actor: BodyId,
        config: CharacterConfig,
        desired: [f32; 3],
    ) -> (
        rp::Vector,
        Vec<rapier3d::control::CharacterCollision>,
        usize,
    ) {
        w.refresh_queries();
        let before = w.capture_snapshot().unwrap();
        let collider = &w.backend.colliders
            [super::super::colliders::native_collider(w.characters[&actor].collider)];
        let dispatcher = CountingDispatcher::default();
        let mut q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
            flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
            exclude_rigid_body: Some(super::super::world::native_id(actor)),
            ..Default::default()
        });
        q.dispatcher = &dispatcher;
        let mut collisions = vec![];
        let mut dropped = 0;
        let (_, translation) = super::super::character_query::move_with_clearance(
            &w.backend,
            &q,
            &config.controller(),
            &config,
            w.config.length_unit,
            collider.shape(),
            collider.position(),
            desired.into(),
            false,
            &mut collisions,
            &mut dropped,
        );
        assert_eq!(dropped, 0);
        assert!(collisions.len() <= 32);
        assert_eq!(
            before.encoded_bytes(),
            w.capture_snapshot().unwrap().encoded_bytes(),
            "read-only retries cannot consume force/input or integrate a backend tick"
        );
        (
            translation,
            collisions,
            dispatcher.0.load(Ordering::Relaxed),
        )
    }

    #[test]
    fn landing_cast_work_is_bounded_and_collision_records_keep_world_prefix() {
        for stairs in [false, true] {
            let (mut w, actor, floor) = fixture(BodyKind::KinematicPosition);
            let wall = box_body(&mut w, BodyKind::Fixed, [-10., 1., 1.3565], [1., 1., 0.05]);
            w.set_character_input(
                actor,
                CharacterInput {
                    jump_speed: 4.,
                    ..CharacterInput::default()
                },
            )
            .unwrap();
            w.apply_character_impulse(actor, [1., 2., 3.]).unwrap();
            w.add_character_force(actor, [4., 5., 6.]).unwrap();
            let mut config = w.characters[&actor].config.clone();
            if stairs {
                config.step_height = 0.3;
                config.snap_distance = 0.1;
            }
            let (translation, collisions, casts) =
                probe(&mut w, actor, config, [0., DOWN, TANGENT_SPEED / 60.]);
            let floor_handle = super::super::colliders::native_collider(
                w.collider_ids(floor).unwrap().next().unwrap(),
            );
            let wall_handle = super::super::colliders::native_collider(
                w.collider_ids(wall).unwrap().next().unwrap(),
            );
            assert!(collisions.iter().any(|hit| hit.handle == floor_handle));
            assert!(
                collisions.iter().any(|hit| hit.handle == wall_handle),
                "{collisions:?}"
            );
            assert!(
                translation.z > 0.0038 && translation.z < 0.0054,
                "{translation:?}"
            );
            for hit in &collisions {
                let expected = rp::Vector::from(START) + hit.translation_applied;
                assert!(
                    (hit.character_pos.translation - expected).length() < 2e-6,
                    "{hit:?}"
                );
                assert!(hit.hit.time_of_impact >= 0. && hit.hit.time_of_impact <= 0.1);
                if hit.handle == wall_handle {
                    assert!(
                        hit.translation_applied.z > 0.0033,
                        "suffix must retain the landing prefix: {hit:?}"
                    );
                    assert!((hit.hit.witness1.z - 1.3065).abs() < 0.001, "{hit:?}");
                }
            }
            // Each query can dispatch at most once to each of the two admitted
            // collider leaves. One retry: 20+20+lift/down(2) = 42 casts;
            // with stairs(4 extra/iteration) and snap(1/pass): 204 casts.
            let pipeline_bound = if stairs { 204 } else { 42 };
            assert!(
                casts >= 20,
                "fixture must exercise the original stalled pass: {casts}"
            );
            assert!(
                casts <= pipeline_bound * 2,
                "stairs={stairs}, casts={casts}"
            );
            println!("landing casts: stairs={stairs}, leaves=2, dispatches={casts}, pipeline_bound={pipeline_bound}, contacts={}", collisions.len());
        }
    }
}

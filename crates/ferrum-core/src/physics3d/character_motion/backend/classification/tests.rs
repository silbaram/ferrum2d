use super::*;
use crate::physics3d::{
    BodyDesc, BodyKind, CharacterConfig, CharacterInput, ColliderDesc, Pose, Shape, WorldConfig,
};

fn world() -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..WorldConfig::default()
    })
    .unwrap()
}

fn body(world: &mut PhysicsWorld3d, kind: BodyKind, x: f32, y: f32) -> BodyId {
    world
        .create_body(
            BodyDesc {
                kind,
                pose: Pose {
                    position: [x, y, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 2., 5.],
            }),
        )
        .unwrap()
}

fn character(world: &mut PhysicsWorld3d) -> BodyId {
    let id = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    world
        .enable_character(
            id,
            CharacterConfig {
                step_height: 0.,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
    id
}

fn bytes(world: &PhysicsWorld3d) -> Vec<u8> {
    world.capture_snapshot().unwrap().encoded_bytes().to_vec()
}

#[test]
fn selected_stop_tags_preserve_physics_bytes_and_leave_unrelated_bodies_native() {
    let mut w = world();
    let selected = body(&mut w, BodyKind::KinematicVelocity, 3., 0.);
    let unrelated = body(&mut w, BodyKind::KinematicVelocity, 100., 100.);
    let dynamic = body(&mut w, BodyKind::Dynamic, 200., 100.);
    let actor = character(&mut w);
    w.set_character_input(
        actor,
        CharacterInput {
            velocity: [2., 0., 0.],
            jump_speed: 3.,
        },
    )
    .unwrap();
    w.set_velocity(selected, [-60., 0., 0.], [0., 0., 2.])
        .unwrap();
    w.apply_impulse(dynamic, [1., 2., 3.]).unwrap();
    let before = bytes(&w);
    let statistics = w.step_statistics();
    let work_before = w.saved_motion_proof_work().used;
    assert!(w.classify_preview_stop_consumers(&[selected]).unwrap());
    let scratch = &w.character_motion.backend_motion;
    assert_eq!(scratch.promoted, [selected]);
    assert!(!scratch.promoted.contains(&unrelated));
    assert!(!scratch.promoted.contains(&dynamic));
    assert!(scratch.mixed.is_empty());
    assert!(!scratch.promotion_pending);
    assert!(scratch.used > work_before);
    assert_eq!(scratch.committed_seconds, 0.);
    assert_eq!(statistics, w.step_statistics());
    assert_eq!(before, bytes(&w));
}

#[test]
fn live_character_finite_sleeping_disabled_and_fixed_sets_keep_the_original_retry() {
    for variant in 0..5 {
        let mut w = world();
        let selected = body(&mut w, BodyKind::KinematicPosition, 3., 0.);
        let other = match variant {
            0 => character(&mut w),
            1 | 2 => body(&mut w, BodyKind::Dynamic, 100., 0.),
            3 => body(&mut w, BodyKind::KinematicVelocity, 100., 0.),
            _ => body(&mut w, BodyKind::Fixed, 100., 0.),
        };
        if variant == 2 {
            w.backend.bodies[crate::physics3d::world::native_id(other)].sleep();
        } else if variant == 3 {
            w.backend.bodies[crate::physics3d::world::native_id(other)].set_enabled(false);
        }
        let before = bytes(&w);
        assert!(!w
            .classify_preview_stop_consumers(&[selected, other])
            .unwrap());
        assert!(w.character_motion.backend_motion.promoted.is_empty());
        assert!(!w.character_motion.backend_motion.promotion_pending);
        assert_eq!(before, bytes(&w));
    }
}

#[test]
fn stale_generation_fails_before_any_tag_even_after_an_unsupported_live_kind() {
    let mut w = world();
    let stale = body(&mut w, BodyKind::KinematicPosition, 0., 0.);
    w.remove_body(stale).unwrap();
    let replacement = body(&mut w, BodyKind::KinematicPosition, 3., 0.);
    let dynamic = body(&mut w, BodyKind::Dynamic, 100., 0.);
    let before = bytes(&w);
    assert_eq!(
        w.classify_preview_stop_consumers(&[dynamic, replacement, stale]),
        Err(TrajectoryError::InvalidReference)
    );
    assert!(w.character_motion.backend_motion.promoted.is_empty());
    assert!(!w.character_motion.backend_motion.promotion_pending);
    assert_eq!(before, bytes(&w));
}

#[test]
fn registration_work_and_combined_retained_tag_backing_have_exact_one_below_controls() {
    let mut w = world();
    let selected = body(&mut w, BodyKind::KinematicPosition, 3., 0.);
    let mut scratch = BackendMotionScratch::default();
    let mut measured = Work {
        used: 17,
        limit: u64::MAX,
    };
    assert!(register(
        &[selected],
        &w.backend.bodies,
        &w.characters,
        &mut scratch,
        &mut measured,
        usize::MAX
    )
    .unwrap());
    let required = measured.used;
    for (limit, succeeds) in [(required, true), (required - 1, false)] {
        let mut scratch = BackendMotionScratch::default();
        let mut work = Work { used: 17, limit };
        let result = register(
            &[selected],
            &w.backend.bodies,
            &w.characters,
            &mut scratch,
            &mut work,
            usize::MAX,
        );
        if succeeds {
            assert_eq!(result, Ok(true));
            assert_eq!(work.used, required);
            assert_eq!(scratch.promoted, [selected]);
        } else {
            assert_eq!(result, Err(TrajectoryError::WorkLimit));
            assert!(scratch.promoted.is_empty());
            assert_eq!(work.used, 17);
        }
        assert!(!scratch.promotion_pending);
        assert_eq!(scratch.committed_seconds, 0.);
    }
    for (short, succeeds) in [(0, true), (1, false)] {
        let mut scratch = BackendMotionScratch {
            mixed: vec![selected],
            promotions: vec![selected],
            affected: vec![selected],
            prescribed_paths: vec![selected],
            sweep_sensor_paths: vec![selected],
            ..Default::default()
        };
        let exact = tag_bytes(&scratch, 1).unwrap();
        let mut work = Work {
            used: 17,
            limit: u64::MAX,
        };
        let result = register(
            &[selected],
            &w.backend.bodies,
            &w.characters,
            &mut scratch,
            &mut work,
            exact - short,
        );
        assert_eq!(
            result,
            if succeeds {
                Ok(true)
            } else {
                Err(TrajectoryError::WorkLimit)
            }
        );
        assert_eq!(scratch.promoted.contains(&selected), succeeds);
    }
}

#[test]
fn tags_survive_controller_and_pass_rollback_but_do_not_waive_a_new_finite_promotion() {
    let mut w = world();
    let selected = body(&mut w, BodyKind::KinematicPosition, 3., 0.);
    let dynamic = body(&mut w, BodyKind::Dynamic, 100., 0.);
    assert!(w
        .classify_preview_stop_consumers(&[selected, selected])
        .unwrap());
    let scratch = &mut w.character_motion.backend_motion;
    scratch.begin_controller_interval();
    scratch.reset();
    scratch.begin_pass();
    scratch.reject_current_pass();
    scratch.prepare_mixed().unwrap();
    assert_eq!(scratch.promoted, [selected]);
    assert_eq!(scratch.mixed, [selected]);
    assert!(!scratch.promotion_pending);
    scratch.promotions.push(dynamic);
    let mut work = Work {
        used: scratch.used,
        limit: super::super::super::trajectory::MAX_PROOF_WORK,
    };
    assert!(scratch.request_promotions(&mut work).unwrap());
    assert!(scratch.promotion_pending);
    assert!(scratch.promoted.contains(&dynamic));
    scratch.begin_tick();
    assert!(scratch.promoted.is_empty());
    assert!(scratch.mixed.is_empty());
    assert!(!scratch.promotion_pending);
}

#[test]
fn empty_selection_and_existing_failures_never_publish_tags_or_consume_a_pending_retry() {
    let mut w = world();
    let selected = body(&mut w, BodyKind::KinematicPosition, 3., 0.);
    let before = w.saved_motion_proof_work().used;
    assert_eq!(w.classify_preview_stop_consumers(&[]), Ok(false));
    assert_eq!(w.saved_motion_proof_work().used, before);
    w.character_motion.backend_motion.promotion_pending = true;
    assert_eq!(w.classify_preview_stop_consumers(&[selected]), Ok(true));
    assert!(w.character_motion.backend_motion.promotion_pending);
    w.character_motion.backend_motion.promoted.clear();
    w.character_motion
        .backend_motion
        .fail(TrajectoryError::Unresolved);
    let before = w.saved_motion_proof_work().used;
    assert_eq!(
        w.classify_preview_stop_consumers(&[selected]),
        Err(TrajectoryError::Unresolved)
    );
    assert!(w.character_motion.backend_motion.promoted.is_empty());
    assert!(w.character_motion.backend_motion.promotion_pending);
    assert_eq!(w.saved_motion_proof_work().used, before);
}

#[test]
fn selected_pusher_handoff_preserves_checked_squeeze_endpoints_and_native_call_count() {
    for kind in [BodyKind::KinematicPosition, BodyKind::KinematicVelocity] {
        let mut w = world();
        w.force_character_motion_proof();
        let actor = character(&mut w);
        body(&mut w, BodyKind::Fixed, -1., 0.);
        let pusher = body(&mut w, kind, 3., 0.);
        let unrelated = body(&mut w, BodyKind::KinematicVelocity, 100., 100.);
        w.set_velocity(unrelated, [2., 0., 0.], [0.; 3]).unwrap();
        if kind == BodyKind::KinematicPosition {
            w.set_kinematic_target(
                pusher,
                Pose {
                    position: [-3., 0., 0.],
                    ..Pose::default()
                },
            )
            .unwrap();
        } else {
            w.set_velocity(pusher, [-60., 0., 0.], [0.; 3]).unwrap();
        }
        w.set_character_input(actor, CharacterInput::default())
            .unwrap();
        assert_eq!(w.step_checked(), Ok(()));
        assert_eq!(
            w.actual_motion_completed_time().to_bits(),
            f64::from(0.1_f32).to_bits()
        );
        assert!((w.body_state(pusher).unwrap().pose.position[0] - 0.02).abs() < 0.02);
        assert!((w.body_state(actor).unwrap().pose.position[0] + 0.49).abs() < 0.02);
        assert_eq!(w.body_state(pusher).unwrap().linear_velocity, [0.; 3]);
        assert!((w.body_state(unrelated).unwrap().pose.position[0] - 100.2).abs() < 0.0001);
        assert_eq!(w.step_statistics().backend_steps, 2);
        assert!(w.character_motion.backend_motion.promoted.contains(&pusher));
        assert!(!w
            .character_motion
            .backend_motion
            .promoted
            .contains(&unrelated));
    }
}

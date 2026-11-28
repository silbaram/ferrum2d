use super::*;
use crate::physics3d::{
    BodyDesc, BodyId, BodyKind, CharacterConfig, CharacterInput, ColliderDesc, PhysicsWorld3d,
    Pose, Shape, Space, WorldConfig,
};
fn pose(p: [f32; 3]) -> Pose {
    Pose {
        position: p,
        ..Default::default()
    }
}
fn fixture() -> (PhysicsWorld3d, BodyId, BodyId) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let bar = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                angular_velocity: [0., 0., 40.],
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.025, 0.1],
            }),
        )
        .unwrap();
    let actor = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose([1.2, 1.3, 0.]),
                ..Default::default()
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
            step_height: 0.,
            snap_distance: 0.,
            ..Default::default()
        },
    )
    .unwrap();
    for (p, half) in [
        ([0.89, 1.3, 0.], [0.05, 0.6, 0.2]),
        ([1.2, 1.86, 0.], [0.7, 0.05, 0.2]),
    ] {
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: pose(p),
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box { half_extents: half }),
        )
        .unwrap();
    }
    (w, bar, actor)
}
fn distance(w: &PhysicsWorld3d, bar: BodyId, actor: BodyId) -> f32 {
    let b = &w.backend.bodies[native_id(bar)];
    let a = &w.backend.bodies[native_id(actor)];
    let bc = &w.backend.colliders[b.colliders()[0]];
    let ac = &w.backend.colliders[a.colliders()[0]];
    rapier3d::parry::query::contact(bc.position(), bc.shape(), ac.position(), ac.shape(), 10.)
        .unwrap()
        .unwrap()
        .dist
}
#[test]
fn event_prefix_public_squeeze_rejects_overrunning_cap_at_actual_contact() {
    let (mut w, bar, actor) = fixture();
    w.force_character_motion_proof();
    assert!(distance(&w, bar, actor) > 0.7);
    let saved = w.capture_snapshot().unwrap();
    w.step();
    assert!(
        distance(&w, bar, actor) > 0.0,
        "distance={}",
        distance(&w, bar, actor)
    );
    let b = w.body_state(bar).unwrap();
    assert!(
        b.pose.rotation[2] > 0.2 && b.pose.rotation[2] < 0.3,
        "{b:?}"
    );
    assert_eq!(b.angular_velocity, [0.; 3]);
    assert_eq!(w.step_statistics().kinematic_character_stops, 1);
    assert_eq!(w.step_statistics().kinematic_path_failures, 0);
    assert!(w.step_statistics().character_preview_passes > 2);
    let accepted = w.capture_snapshot().unwrap();
    w.restore_snapshot(&saved).unwrap();
    w.force_character_motion_proof();
    w.step();
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        accepted.encoded_bytes()
    );
    for _ in 0..6 {
        w.step();
        assert!(distance(&w, bar, actor) >= 0.0);
    }
}
#[test]
fn event_prefix_exact_refinement_allowance_and_one_below_are_explicit() {
    let (mut w, bar, _) = fixture();
    let mut scratch = PathScratch::default();
    scratch.pending_stops.push(bar);
    let event = w.refine_prefix_event(
        &[],
        &mut scratch,
        0.,
        0.6967556,
        0.1,
        0,
        1,
        false,
        true,
        MAX_REFINEMENTS,
    );
    let used = w.step_statistics().character_preview_passes as usize;
    assert!(used > 1 && used < MAX_REFINEMENTS);
    assert!(event.impact > 0. && event.impact < 0.2);
    assert_eq!(w.step_statistics().kinematic_path_failures, 0);
    for allowance in [used, used - 1, 0] {
        let (mut candidate, body, _) = fixture();
        let mut scratch = PathScratch::default();
        scratch.pending_stops.push(body);
        let before = candidate.body_state(body).unwrap();
        let event = candidate.refine_prefix_event(
            &[],
            &mut scratch,
            0.,
            0.6967556,
            0.1,
            0,
            1,
            false,
            true,
            allowance,
        );
        assert_eq!(candidate.body_state(body).unwrap(), before);
        assert_eq!(
            candidate.step_statistics().character_preview_passes as usize,
            allowance
        );
        if allowance == used {
            assert!(event.impact > 0.);
            assert_eq!(candidate.step_statistics().kinematic_path_failures, 0);
        } else {
            assert_eq!(event.impact, 0.);
            assert_eq!(candidate.step_statistics().kinematic_path_failures, 1);
            assert!(scratch.pending_stops.contains(&body));
        }
    }
}
#[test]
fn event_prefix_preview_preserves_native_impulse_force_and_character_input_owners() {
    let (mut w, bar, actor) = fixture();
    w.disable_character(actor).unwrap();
    w.enable_character(
        actor,
        CharacterConfig {
            step_height: 0.,
            snap_distance: 0.,
            push_mass: 70.,
            ..Default::default()
        },
    )
    .unwrap();
    w.set_character_input(
        actor,
        CharacterInput {
            velocity: [2., 0., 0.],
            ..Default::default()
        },
    )
    .unwrap();
    w.apply_character_impulse(actor, [3., 0., 0.]).unwrap();
    w.add_character_force(actor, [7., 0., 0.]).unwrap();
    let dynamic = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                pose: pose([1.7, 1.3, 0.]),
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 0.5, 0.2],
            }),
        )
        .unwrap();
    w.add_force(dynamic, [1., 0., 0.], [0., 0., 0.]).unwrap();
    let mut scratch = PathScratch::default();
    w.preview_characters(&mut scratch.preview);
    w.restore_character_preview(&scratch.preview);
    w.solve_character_dynamic_contacts();
    w.preview_characters(&mut scratch.preview);
    w.restore_character_preview(&scratch.preview);
    let body = w.body_state(dynamic).unwrap();
    let force = w.backend.bodies[native_id(dynamic)].user_force();
    let r = &w.characters[&actor];
    let input = r.input_velocity();
    let impulse = r.pending_impulse;
    let external = r.external_velocity;
    let external_force = r.external_force;
    scratch.pending_stops.push(bar);
    w.refine_prefix_event(
        &[],
        &mut scratch,
        0.,
        0.6967556,
        0.1,
        0,
        1,
        false,
        true,
        MAX_REFINEMENTS,
    );
    assert!(w.step_statistics().character_preview_passes > 1);
    assert_eq!(w.body_state(dynamic).unwrap(), body);
    assert_eq!(w.backend.bodies[native_id(dynamic)].user_force(), force);
    let r = &w.characters[&actor];
    assert_eq!(r.input_velocity(), input);
    assert_eq!(r.pending_impulse, impulse);
    assert_eq!(r.external_velocity, external);
    assert_eq!(r.external_force, external_force);
}

//! Physical fit, rather than simultaneous satisfaction of incompatible skins.
use super::*;
use rapier3d::{
    parry::query::{contact, ShapeCastOptions},
    prelude as rp,
};

const START: [f32; 3] = [-10., 0.5101, 10.];
const DOWN: f32 = -0.09892499;
fn pose(p: [f32; 3]) -> Pose {
    Pose {
        position: p,
        ..Pose::default()
    }
}
fn fixture(
    start: [f32; 3],
    ceiling_bottom: Option<f32>,
) -> (PhysicsWorld3d, BodyId, BodyId, Option<BodyId>) {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let floor = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose([0., -0.1, 0.]),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [20., 0.1, 20.],
            }),
        )
        .unwrap();
    let actor = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose(start),
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
    let ceiling = ceiling_bottom.map(|bottom| {
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: pose([start[0], bottom + 0.1, start[2]]),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [1., 0.1, 1.],
            }),
        )
        .unwrap()
    });
    (w, actor, floor, ceiling)
}
fn impulse(w: &mut PhysicsWorld3d, actor: BodyId, dt: f32) {
    w.apply_character_impulse(actor, [0., 10. * (DOWN / dt + 9.81 * dt), 5.])
        .unwrap();
}
fn interval(w: &mut PhysicsWorld3d, dt: f32) {
    assert!(w.begin_interval(dt, true).unwrap());
    w.step();
    w.end_interval();
    assert_eq!(w.config.step_seconds, WorldConfig::default().step_seconds);
}

#[test]
fn physically_fitting_capsule_selects_floor_even_when_ceiling_skin_cannot_fit() {
    for bottom in [None, Some(1.0103)] {
        let (mut w, actor, floor, ceiling) = fixture(START, bottom);
        let dt = w.config.step_seconds;
        let desired = rp::Vector::new(0., DOWN, 0.5 * dt);
        w.refresh_queries();
        let before_query = w.capture_snapshot().unwrap();
        let actor_c = super::colliders::native_collider(w.characters[&actor].collider);
        let c = &w.backend.colliders[actor_c];
        let floor_h =
            super::colliders::native_collider(w.collider_ids(floor).unwrap().next().unwrap());
        let f = &w.backend.colliders[floor_h];
        let floor_contact = contact(f.position(), f.shape(), c.position(), c.shape(), 0.1)
            .unwrap()
            .unwrap();
        assert!((floor_contact.dist - 0.0101).abs() < 4e-6);
        if let Some(ceiling) = ceiling {
            let ceiling_h =
                super::colliders::native_collider(w.collider_ids(ceiling).unwrap().next().unwrap());
            let top = &w.backend.colliders[ceiling_h];
            let clearance = contact(top.position(), top.shape(), c.position(), c.shape(), 0.1)
                .unwrap()
                .unwrap();
            // Height 1.0 fits gap1.0103; two .01 skins cannot both fit.
            assert!(clearance.dist > 0. && clearance.dist < 0.001);
            assert!(floor_contact.dist + clearance.dist < 0.02);
        }
        let q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
            exclude_rigid_body: Some(super::world::native_id(actor)),
            ..Default::default()
        });
        let (handle, hit) = q
            .cast_shape(
                c.position(),
                desired.normalize(),
                c.shape(),
                ShapeCastOptions {
                    max_time_of_impact: desired.length(),
                    target_distance: 0.01,
                    stop_at_penetration: false,
                    compute_impact_geometry_on_penetration: true,
                },
            )
            .expect("approaching the real floor must produce a hit");
        let analytic = (START[1] - 0.5 - 0.01) / -desired.normalize().y;
        assert_eq!(handle, floor_h);
        assert!(
            (hit.time_of_impact - analytic).abs() < 1e-5,
            "{hit:?}, analytic={analytic}"
        );
        assert!(hit.time_of_impact > 0.00008);
        assert!(hit.normal1.dot(rp::Vector::Y) > 0.9999);
        assert!(hit.witness1.y.abs() < 2e-5);
        println!("NEAR_SKIN_DIRECT bottom={bottom:?}, analytic={analytic}, hit={hit:?}");
        assert_eq!(
            before_query.encoded_bytes(),
            w.capture_snapshot().unwrap().encoded_bytes()
        );
        impulse(&mut w, actor, dt);
        w.step();
        let p = w.body_state(actor).unwrap().pose.position;
        assert!(p[1] > 0.5099 && p[1] < 0.5102, "{p:?}");
        if let Some(bottom) = bottom {
            assert!(
                p[1] + 0.5 <= bottom + 1e-5,
                "physical ceiling cannot be bypassed: {p:?}"
            );
            // Preserve the real first-hit vertical prefix and complete the
            // tangent with a checked placement and positive query margin.
            let prefix_y = desired.normalize().y * hit.time_of_impact;
            assert!(
                (p[2] - START[2] - 0.5 * dt).abs() < 4e-5,
                "fit tangent: {p:?}"
            );
            assert!(
                (p[1] - START[1] - prefix_y).abs() < 2e-6,
                "shim vs real prefix: {p:?}, prefix_y={prefix_y}"
            );
            println!("FORMER_SAFE_STOP near_skin p={p:?} floor_gap={} roof_gap={} net_vertical={} prefix_y={prefix_y}",p[1]-0.5,bottom-p[1]-0.5,p[1]-START[1]);
        } else {
            assert!(
                (p[2] - START[2] - 0.5 * dt).abs() < 4e-5,
                "open space must retain the remaining tangent: {p:?}"
            );
        }
    }
}

fn expected_contact_projection(w: &mut PhysicsWorld3d, actor: BodyId, dt: f32) -> [f32; 3] {
    w.refresh_queries();
    let runtime = &w.characters[&actor];
    let config = &runtime.config;
    let up = rp::Vector::from(config.up);
    let external = rp::Vector::from(runtime.pending_impulse) / config.push_mass;
    let vertical = (external.dot(up) + w.backend.gravity.dot(up) * dt)
        .clamp(-config.max_vertical_speed, config.max_vertical_speed);
    let mut projected = external - up * external.dot(up);
    let desired = (projected + up * vertical) * dt;
    let c = &w.backend.colliders[super::colliders::native_collider(runtime.collider)];
    let q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
        exclude_rigid_body: Some(super::world::native_id(actor)),
        ..Default::default()
    });
    let mut hits = vec![];
    let mut dropped = 0;
    super::character_query::move_with_clearance(
        &w.backend,
        &q,
        &config.controller(),
        config,
        w.config.length_unit,
        c.shape(),
        c.position(),
        desired,
        false,
        &mut hits,
        &mut dropped,
    );
    assert_eq!(dropped, 0);
    for hit in hits {
        let target = &w.backend.colliders[hit.handle];
        let normal = super::character_geometry::target_normal(
            target,
            target.position(),
            hit.hit.witness1,
            hit.hit.normal1,
        );
        let before = projected;
        let approach = projected.dot(normal);
        if approach < 0. {
            projected -= normal * approach;
        }
        if (before.z - projected.z).abs() > 1e-5 {
            println!("CONTACT_PROJECTION dt={dt}, handle={:?}, subshape={}, raw_normal={:?}, corrected_normal={normal:?}, witness={:?}, before={before:?}, approach={approach}, after={projected:?}",hit.handle,hit.hit.subshape1,hit.hit.normal1,hit.hit.witness1);
        }
    }
    projected.to_array()
}

#[test]
fn contact_free_probe_preserves_pending_impulse_then_consumes_exact_j_over_m_once() {
    let (mut w, actor, _, _) = fixture([-10., 2., 10.], None);
    w.apply_character_impulse(actor, [0., 0., 5.]).unwrap();
    let before = w.capture_snapshot().unwrap();
    let mut reference = PhysicsWorld3d::from_snapshot(&before).unwrap();
    let pose = w.body_state(actor).unwrap().pose;
    let mut probe = super::CharacterProbeScratch::default();
    for _ in 0..3 {
        w.probe_character_motion(actor, pose, [0., 0., 0.1], false, &mut probe)
            .unwrap();
        assert_eq!(w.characters[&actor].pending_impulse, [0., 0., 5.]);
        assert_eq!(w.characters[&actor].external_velocity, [0.; 3]);
        assert_eq!(w.body_state(actor).unwrap().pose, pose);
    }
    w.step();
    reference.step();
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        reference.capture_snapshot().unwrap().encoded_bytes()
    );
    assert_eq!(w.characters[&actor].pending_impulse, [0.; 3]);
    assert_eq!(w.characters[&actor].external_velocity, [0., 0., 0.5]);
    w.step();
    reference.step();
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        reference.capture_snapshot().unwrap().encoded_bytes()
    );
    assert_eq!(w.characters[&actor].external_velocity, [0., 0., 0.5]);
    let p = w.body_state(actor).unwrap().pose.position;
    assert!(
        (p[2] - 10. - 2. * 0.5 * w.config.step_seconds).abs() < 2e-6,
        "{p:?}"
    );
}

#[test]
fn near_skin_landing_uses_actual_interval_and_consumes_impulse_once() {
    for dt in [0.007, 0.013, 1. / 60., 0.021, 0.1] {
        for bottom in [None, Some(1.0103)] {
            let (mut w, actor, _, _) = fixture(START, bottom);
            impulse(&mut w, actor, dt);
            let projected = expected_contact_projection(&mut w, actor, dt);
            interval(&mut w, dt);
            let state = w.character_state(actor).unwrap();
            let p = w.body_state(actor).unwrap().pose.position;
            assert!(
                p[1] >= 0.5098 && p[1] <= 0.5103,
                "dt={dt}, bottom={bottom:?}: {p:?}"
            );
            assert!(state.grounded);
            assert!(
                p[2] >= START[2] && p[2] <= START[2] + 0.5 * dt + 4e-5,
                "{p:?}"
            );
            assert_eq!(w.characters[&actor].pending_impulse, [0.; 3]);
            assert_eq!(
                w.characters[&actor].external_velocity, projected,
                "contact-normal projection differs at dt={dt}, bottom={bottom:?}"
            );
            if dt == 0.021 && bottom.is_none() {
                assert_eq!(w.characters[&actor].external_velocity,[0.,0.,0.5],"a flat floor must not consume tangent impulse or manufacture vertical/lateral momentum");
            }
        }
    }
}

#[test]
fn gravity_only_small_actual_intervals_do_not_lose_horizontal_dominant_floor_hits() {
    for dt in [0.007, 0.013, 0.021] {
        let (mut w, actor, _, _) = fixture(START, None);
        w.refresh_queries();
        let c =
            &w.backend.colliders[super::colliders::native_collider(w.characters[&actor].collider)];
        let desired = rp::Vector::new(0., -9.81 * dt * dt, 0.5 * dt);
        let q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
            exclude_rigid_body: Some(super::world::native_id(actor)),
            ..Default::default()
        });
        let (_, hit) = q
            .cast_shape(
                c.position(),
                desired.normalize(),
                c.shape(),
                ShapeCastOptions {
                    max_time_of_impact: desired.length(),
                    target_distance: 0.01,
                    stop_at_penetration: false,
                    compute_impact_geometry_on_penetration: true,
                },
            )
            .expect("the interval enters the floor skin even with horizontal-dominant velocity");
        let expected = (START[1] - 0.51) / -desired.normalize().y;
        assert!(
            (hit.time_of_impact - expected).abs() < 3e-5,
            "dt={dt}: {hit:?}, expected={expected}"
        );
        w.apply_character_impulse(actor, [0., 0., 5.]).unwrap();
        interval(&mut w, dt);
        let p = w.body_state(actor).unwrap().pose.position;
        assert!(p[1] >= 0.5098 && p[1] <= 0.5103, "{p:?}");
        assert_eq!(w.characters[&actor].pending_impulse, [0.; 3]);
    }
}

#[test]
fn near_skin_one_way_still_catches_above_and_passes_from_below() {
    for below in [false, true] {
        let start = if below { [-10., -0.8, 10.] } else { START };
        let (mut w, actor, floor, _) = fixture(start, None);
        let c = w.collider_ids(floor).unwrap().next().unwrap();
        w.set_terrain_one_way(
            c,
            Some(TerrainOneWay {
                point: [0., 0.1, 0.],
                normal: [0., 1., 0.],
            }),
        )
        .unwrap();
        if below {
            w.apply_character_impulse(actor, [0., 300., 5.]).unwrap();
        } else {
            impulse(&mut w, actor, 1. / 60.);
        }
        w.step();
        let p = w.body_state(actor).unwrap().pose.position;
        if below {
            assert!(p[1] > -0.31 && p[1] < -0.30, "{p:?}");
            assert!(!w.character_state(actor).unwrap().grounded);
        } else {
            assert!(p[1] > 0.5099 && p[1] < 0.5102, "{p:?}");
            assert!(w.character_state(actor).unwrap().grounded);
        }
    }
}

#[test]
fn near_skin_checkpoint_replays_force_jump_and_pending_impulse_exactly() {
    let (mut w, actor, _, _) = fixture(START, Some(1.0103));
    impulse(&mut w, actor, 0.013);
    w.add_character_force(actor, [0., 0., 3.]).unwrap();
    w.set_character_input(
        actor,
        CharacterInput {
            jump_speed: 4.,
            ..CharacterInput::default()
        },
    )
    .unwrap();
    let saved = w.capture_snapshot().unwrap();
    let mut replay = PhysicsWorld3d::from_snapshot(&saved).unwrap();
    let mut elapsed = 0.;
    for dt in [0.013, 0.007, 0.021, 1. / 60.] {
        elapsed += dt;
        interval(&mut w, dt);
        interval(&mut replay, dt);
        assert_eq!(
            w.body_state(actor).unwrap(),
            replay.body_state(actor).unwrap()
        );
        assert_eq!(
            w.character_state(actor).unwrap(),
            replay.character_state(actor).unwrap()
        );
        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            replay.capture_snapshot().unwrap().encoded_bytes()
        );
        assert_eq!(w.characters[&actor].pending_impulse, [0.; 3]);
        assert!((w.characters[&actor].external_velocity[2] - (0.5 + 0.3 * elapsed)).abs() < 2e-6);
    }
    let expected = w.capture_snapshot().unwrap();
    w.restore_snapshot(&saved).unwrap();
    for dt in [0.013, 0.007, 0.021, 1. / 60.] {
        interval(&mut w, dt);
    }
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        expected.encoded_bytes()
    );
}

#[test]
fn initial_physical_penetration_and_no_fit_are_distinct_from_missing_skin() {
    for (y, bottom) in [(0.49, None), (0.45, Some(0.9))] {
        let (mut w, actor, _, _) = fixture([-10., y, 10.], bottom);
        // These fixtures intentionally violate physical fit. The controller does
        // not promise cold depenetration, but must not take the full inward fall.
        impulse(&mut w, actor, 1. / 60.);
        w.step();
        let p = w.body_state(actor).unwrap().pose.position;
        assert!(
            p[1] >= y - 0.001,
            "existing overlap must not become a full fall: {p:?}"
        );
        assert!(
            p[1] <= y + 0.001,
            "no teleport/depenetration policy was introduced: {p:?}"
        );
    }
}

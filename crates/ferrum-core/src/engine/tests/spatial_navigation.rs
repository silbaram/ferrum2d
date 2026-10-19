use super::{data_scene_visuals::sprite, *};
use crate::collision::CollisionSystem;
use crate::components::{HeightSpan, PhysicsFloorId};

fn surface(x: f32, y: f32, w: f32, d: f32, a: f32, b: f32) -> [f32; 11] {
    [x, y, w, d, 0., a, b, 1., 1., 1., 1.]
}
pub(super) fn setup(multifloor: bool) -> (Engine, Entity) {
    let mut e = Engine::new();
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
pub(super) fn pose(e: &Engine, a: Entity) -> (f32, f32, u32, f32) {
    let p = e.world.transform(a).unwrap();
    let s = e.world.height_span(a).unwrap();
    (p.x, p.y, s.floor.0, s.elevation)
}
fn go(e: &mut Engine, x: f32, y: f32, floor: u32) -> bool {
    e.move_data_scene_spatial_actor_to(x, y, floor, 96., 8., 0., true)
}
fn finish(e: &mut Engine) {
    for _ in 0..1000 {
        if e.data_scene_spatial_move_status() != 1 {
            break;
        }
        e.update(1. / 60.);
    }
    assert_eq!(
        e.data_scene_spatial_move_status(),
        2,
        "stats={:?}",
        e.data_scene_spatial_move_stats()
    );
}
fn wall(e: &mut Engine, x: f32, y: f32, w: f32, h: f32) -> Entity {
    let w_entity = sprite(e, 72, x, y, 0);
    e.world.set_aabb_collider(
        w_entity,
        AabbCollider::new(w, h, false, CollisionLayer::Wall),
    );
    e.world.set_height_span(
        w_entity,
        HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap(),
    );
    w_entity
}

#[test]
fn spatial_navigation_routes_ramp_bridge_both_ways_without_frame_search_or_terrain_rebuild() {
    let (mut e, a) = setup(true);
    e.build_render_commands();
    let revision = e.spatial_terrain_revision();
    let terrain = e.spatial_terrain_ptr();
    assert!(
        go(&mut e, 0., 80., 1),
        "stats={:?}",
        e.data_scene_spatial_move_stats()
    );
    let stats = e.data_scene_spatial_move_stats();
    assert!(stats[0] > 1 && stats[0] <= 4098 && stats[1] <= 32768 && stats[5] <= 8_000_000);
    assert_eq!(pose(&e, a), (0., 16., 0, 0.), "query must restore pose");
    finish(&mut e);
    assert_eq!(pose(&e, a), (0., 80., 1, 32.));
    assert_eq!(e.data_scene_spatial_move_stats()[4], stats[4]);
    assert_eq!(e.data_scene_spatial_move_stats()[3], 0);
    assert!(go(&mut e, 0., 16., 0));
    finish(&mut e);
    assert_eq!(pose(&e, a), (0., 16., 0, 0.));
    e.build_render_commands();
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert_eq!(e.spatial_terrain_ptr(), terrain);
    assert!(e.world.is_current_entity(a));
}

#[test]
fn spatial_navigation_same_xy_other_floor_requires_actual_connected_route() {
    let (mut e, a) = setup(true);
    assert!(go(&mut e, 0., 80., 1));
    finish(&mut e);
    assert!(
        go(&mut e, 0., 80., 0),
        "stats={:?}",
        e.data_scene_spatial_move_stats()
    );
    e.update(1. / 60.);
    assert_eq!(e.data_scene_spatial_move_status(), 1);
    assert_eq!(pose(&e, a).2, 1);
    finish(&mut e);
    assert_eq!(pose(&e, a), (0., 80., 0, 0.));
}

#[test]
fn spatial_navigation_detours_static_solids_and_preserves_state_on_failed_replacement() {
    let (mut e, a) = setup(false);
    wall(&mut e, 0., 56., 12., 8.);
    assert!(go(&mut e, 0., 96., 0));
    let before = pose(&e, a);
    e.world.set_velocity(a, Velocity { vx: 3., vy: 4. });
    assert!(!go(&mut e, 0., 56., 0));
    assert_eq!(pose(&e, a), before);
    assert_eq!(e.world.velocity(a).unwrap(), Velocity { vx: 3., vy: 4. });
    assert_eq!(e.data_scene_spatial_move_status(), 1);
    assert!(!go(&mut e, 0., 96., 7));
    assert!(!e.move_data_scene_spatial_actor_to(0., 96., 0, 96., 0.000001, 0., true));
    assert_eq!(pose(&e, a), before);
    e.world.set_velocity(a, Velocity::default());
    let mut detoured = false;
    for _ in 0..1000 {
        if e.data_scene_spatial_move_status() != 1 {
            break;
        }
        e.update(1. / 60.);
        let p = pose(&e, a);
        detoured |= p.0.abs() >= 14.;
        assert!(
            p.0.abs() >= 14. || p.1 <= 46. || p.1 >= 66.,
            "penetrated wall: {p:?}"
        );
    }
    assert!(detoured);
    assert_eq!(e.data_scene_spatial_move_status(), 2);
    assert_eq!(pose(&e, a), (0., 96., 0, 0.));
}

#[test]
fn spatial_navigation_leaves_fractional_model_proxy_contact_without_repositioning() {
    // Public game-test model-cove: the scaled crate's fractional half depth leaves
    // equal f32 edges, while the center-distance contact reports positive overlap.
    let (mut e, a) = setup(false);
    assert!(e.configure_spatial_terrain(
        &surface(100., 200., 1000., 620., 0., 0.),
        &[1, 0, 16777215, 1]
    ));
    e.world
        .set_aabb_collider(a, AabbCollider::new(9., 9., false, CollisionLayer::Player));
    e.world.set_transform(a, Transform2D { x: 582., y: 810. });
    let crate_body = wall(&mut e, 560., 710., 24., 26.175);
    assert!(e.move_spatial_body(a.id, a.generation, 0., -200., 8., 8.));
    let contact = pose(&e, a);
    let actor_at = e.world.transform(a).unwrap();
    let actor_collider = e.world.collider(a).unwrap();
    let crate_at = e.world.transform(crate_body).unwrap();
    let crate_collider = e.world.collider(crate_body).unwrap();
    assert!(
        CollisionSystem::aabb_contact(actor_at, actor_collider, crate_at, crate_collider).is_some()
    );
    assert_eq!(
        actor_collider.center(actor_at).y - actor_collider.half_height,
        crate_collider.center(crate_at).y + crate_collider.half_height
    );
    assert!(e.move_spatial_body(a.id, a.generation, 0., -100., 8., 8.));
    assert_eq!(
        pose(&e, a),
        contact,
        "moving into the crate must stay blocked"
    );
    assert!(
        e.move_data_scene_spatial_actor_to(650., 780., 0, 170., 64., 0., true),
        "contact={contact:?}, diagnostics={:?}",
        e.data_scene_spatial_move_diagnostics()
    );
    assert_eq!(pose(&e, a), contact, "planning must not nudge the actor");
    assert!(!e.move_data_scene_spatial_actor_to(560., 710., 0, 170., 64., 0., true));
    assert_eq!(pose(&e, a), contact);
    assert_eq!(e.data_scene_spatial_move_status(), 1);
    finish(&mut e);
    assert_eq!(pose(&e, a), (650., 780., 0, 0.));
}

#[test]
fn spatial_navigation_fractional_contact_handles_all_faces_offsets_and_real_penetration() {
    for swap_axes in [false, true] {
        for sign in [-1_f32, 1.] {
            for offset in [0., 3.25] {
                let (mut e, a) = setup(false);
                let map = |x: f32, y: f32| {
                    if swap_axes {
                        Transform2D { x: y * sign, y: x }
                    } else {
                        Transform2D { x, y: y * sign }
                    }
                };
                assert!(e.configure_spatial_terrain(
                    &surface(-1200., -1200., 2400., 2400., 0., 0.),
                    &[1, 0, 16777215, 1]
                ));
                e.world.set_aabb_collider(
                    a,
                    AabbCollider::new(9., 9., false, CollisionLayer::Player)
                        .with_offset(offset, -offset),
                );
                let start = map(582., 810.);
                e.world.set_transform(
                    a,
                    Transform2D {
                        x: start.x - offset,
                        y: start.y + offset,
                    },
                );
                let proxy = map(560., 710.);
                let (w, h) = if swap_axes {
                    (26.175, 24.)
                } else {
                    (24., 26.175)
                };
                wall(&mut e, proxy.x, proxy.y, w, h);
                let delta = map(0., -200.);
                assert!(e.move_spatial_body(a.id, a.generation, delta.x, delta.y, 8., 8.));
                let contact = pose(&e, a);
                let mut inside = e.world.transform(a).unwrap();
                let coordinate = if swap_axes {
                    &mut inside.x
                } else {
                    &mut inside.y
                };
                *coordinate = if sign > 0. {
                    coordinate.next_down()
                } else {
                    coordinate.next_up()
                };
                e.world.set_transform(a, inside);
                let goal = if swap_axes {
                    Transform2D {
                        x: contact.0,
                        y: 650. + offset,
                    }
                } else {
                    Transform2D {
                        x: 650. - offset,
                        y: contact.1,
                    }
                };
                assert!(
                    !e.move_data_scene_spatial_actor_to(goal.x, goal.y, 0, 170., 64., 0., true),
                    "one-ULP penetration must not be waived: swap={swap_axes}, sign={sign}, offset={offset}"
                );
                assert_eq!(e.world.transform(a), Some(inside));
                e.world.set_transform(
                    a,
                    Transform2D {
                        x: contact.0,
                        y: contact.1,
                    },
                );
                assert!(
                    e.move_data_scene_spatial_actor_to(goal.x, goal.y, 0, 170., 64., 0., true),
                    "tangential contact route: swap={swap_axes}, sign={sign}, offset={offset}, diagnostics={:?}",
                    e.data_scene_spatial_move_diagnostics()
                );
                assert_eq!(pose(&e, a), contact);
                finish(&mut e);
                assert_eq!(pose(&e, a), (goal.x, goal.y, 0, 0.));
            }
        }
    }
}

#[test]
fn spatial_navigation_dynamic_blocker_stops_without_search_and_explicit_request_replans() {
    let (mut e, a) = setup(false);
    assert!(go(&mut e, 0., 96., 0));
    let searches = e.data_scene_spatial_move_stats()[4];
    wall(&mut e, 0., 56., 12., 8.);
    for _ in 0..120 {
        e.update(1. / 60.);
    }
    assert_eq!(e.data_scene_spatial_move_status(), 3);
    assert!(pose(&e, a).1 <= 46.);
    assert_eq!(e.data_scene_spatial_move_stats()[4], searches);
    assert!(go(&mut e, 0., 96., 0));
    finish(&mut e);
    assert_eq!(pose(&e, a), (0., 96., 0, 0.));
}

#[test]
fn spatial_navigation_sweeps_rotated_boxes_without_blocking_empty_bounds_corners() {
    let (mut e, a) = setup(false);
    let target = wall(&mut e, 0., 56., 16., 2.);
    e.world.set_oriented_box_collider(
        target,
        crate::components::OrientedBoxCollider::new(
            16.,
            2.,
            std::f32::consts::FRAC_PI_4,
            false,
            CollisionLayer::Wall,
        ),
    );
    // The rotated box's broad AABB covers (11,45), but the actual thin diagonal does not.
    e.world.set_transform(a, Transform2D { x: 11., y: 42. });
    assert!(e.move_data_scene_spatial_actor_to(11., 45., 0, 96., 8., 0., true));
    finish(&mut e);
    assert_eq!(pose(&e, a), (11., 45., 0, 0.));
    e.world.set_transform(a, Transform2D { x: 0., y: 16. });
    assert!(e.move_spatial_body(a.id, a.generation, 0., 40., 8., 8.));
    let contact = pose(&e, a);
    assert!(contact.1 < 56., "rotated wall was crossed: {contact:?}");
    assert!(
        e.move_data_scene_spatial_actor_to(0., 16., 0, 96., 8., 0., true),
        "escape failed: {:?}",
        e.data_scene_spatial_move_diagnostics()
    );
    finish(&mut e);
    assert_eq!(pose(&e, a), (0., 16., 0, 0.));
    e.world
        .set_height_span(target, HeightSpan::new(PhysicsFloorId(1), 0., 8.).unwrap());
    assert!(e.move_data_scene_spatial_actor_to(0., 96., 0, 96., 8., 0., true));
    finish(&mut e);
    assert_eq!(pose(&e, a), (0., 96., 0, 0.));
    e.world.set_transform(a, Transform2D { x: 0., y: 16. });
    e.world
        .set_height_span(target, HeightSpan::new(PhysicsFloorId(0), 20., 8.).unwrap());
    assert!(e.move_data_scene_spatial_actor_to(0., 96., 0, 96., 8., 0., true));
    finish(&mut e);
}

#[test]
fn spatial_navigation_owns_motion_pause_and_input_cancel_without_double_movement() {
    let (mut e, a) = setup(false);
    assert!(go(&mut e, 0., 96., 0));
    e.update(1. / 60.);
    assert!((pose(&e, a).1 - 17.6).abs() < 0.00001);
    assert!(e.pause_data_scene());
    let paused = pose(&e, a);
    e.update(1.);
    assert_eq!(pose(&e, a), paused);
    assert!(e.resume_data_scene());
    e.set_input(false, false, false, true, false, false, false, 0., 0.);
    e.update(1. / 60.);
    assert_eq!(e.data_scene_spatial_move_status(), 4);
    assert!(pose(&e, a).0 > paused.0);
    assert_eq!(pose(&e, a).1, paused.1);
    assert!(e.move_data_scene_spatial_actor_to(0., 96., 0, 96., 8., 0., false));
    finish(&mut e);
    assert_eq!(pose(&e, a), (0., 96., 0, 0.));
    assert!(!e.cancel_data_scene_spatial_move());
}

#[test]
fn spatial_navigation_tiny_speed_accumulates_and_reaches_exact_goal() {
    let (mut e, a) = setup(false);
    e.world.set_transform(a, Transform2D { x: 16., y: 16. });
    let target = 16.00008;
    assert!(e.move_data_scene_spatial_actor_to(target, 16., 0, 0.00008, 8., 0., true));
    for _ in 0..180 {
        e.update(1. / 60.);
    }
    assert_eq!(pose(&e, a), (target, 16., 0, 0.));
    assert_eq!(e.data_scene_spatial_move_status(), 2);
}

#[test]
fn spatial_navigation_cancels_on_external_actor_changes_but_not_other_body_motion() {
    let (mut e, a) = setup(false);
    assert!(go(&mut e, 0., 96., 0));
    let other = sprite(&mut e, 73, 48., 16., 0);
    e.world.set_aabb_collider(
        other,
        AabbCollider::new(2., 2., false, CollisionLayer::Player),
    );
    assert!(e.configure_data_scene_body(other.id, other.generation, 1, true, 0, 0., 8.));
    assert!(e.move_spatial_body(other.id, other.generation, 0., 1., 8., 8.));
    assert_eq!(e.data_scene_spatial_move_status(), 1);
    assert!(e.move_spatial_body(a.id, a.generation, 1., 0., 8., 8.));
    assert_eq!(e.data_scene_spatial_move_status(), 4);
    assert!(go(&mut e, 0., 96., 0));
    e.world.set_transform(a, Transform2D { x: 4., y: 16. });
    e.update(1. / 60.);
    assert_eq!(e.data_scene_spatial_move_status(), 4);
    assert!(go(&mut e, 0., 96., 0));
    assert!(e.cancel_data_scene_spatial_move());
    assert!(!e.cancel_data_scene_spatial_move());
    e.clear_spatial_scene();
    assert_eq!(e.data_scene_spatial_move_status(), 0);
}

#[test]
fn spatial_navigation_rejects_request_that_cannot_fit_one_follower_step() {
    let (mut e, a) = setup(false);
    assert!(go(&mut e, 0., 96., 0));
    let before = pose(&e, a);
    for i in 0..1500 {
        wall(&mut e, 1000. + i as f32 * 8., 1000., 2., 2.);
    }
    assert!(!go(&mut e, 8., 16., 0));
    assert_eq!(e.data_scene_spatial_move_status(), 1);
    assert_eq!(pose(&e, a), before);
    assert_eq!(e.data_scene_spatial_move_diagnostics()[1], 8);
    assert_eq!(e.data_scene_spatial_move_stats()[0..2], [0, 0]);
    assert!(e.cancel_data_scene_spatial_move());
    // A failed admission must release the prepared snapshot before ordinary movement.
    let blocker = wall(&mut e, 8., 16., 2., 2.);
    assert!(e.move_spatial_body(a.id, a.generation, 20., 0., 8., 8.));
    assert!(pose(&e, a).0 <= 4.);
    assert!(e.world.is_current_entity(blocker));
}

#[test]
fn spatial_navigation_decorations_only_pay_one_preparation_scan() {
    let (mut e, a) = setup(true);
    assert!(go(&mut e, 0., 80., 1));
    let stats = e.data_scene_spatial_move_stats();
    let diagnostics = e.data_scene_spatial_move_diagnostics();
    for _ in 0..1500 {
        e.world.spawn_entity();
    }
    assert!(go(&mut e, 0., 80., 1));
    let after = e.data_scene_spatial_move_stats();
    let prepared = e.data_scene_spatial_move_diagnostics();
    assert_eq!(&after[..4], &stats[..4]);
    assert_eq!(prepared[3], diagnostics[3]);
    assert_eq!(prepared[4] - diagnostics[4], 1500);
    assert_eq!(after[5] - stats[5], 1500);
    finish(&mut e);
    assert_eq!(pose(&e, a), (0., 80., 1, 32.));
}

#[test]
fn spatial_navigation_stops_if_new_colliders_exhaust_the_follower_frame_budget() {
    let (mut e, a) = setup(false);
    assert!(go(&mut e, 0., 96., 0));
    let before = pose(&e, a);
    for _ in 0..1500 {
        let trigger = wall(&mut e, 0., 16., 32., 112.);
        let mut collider = e.world.collider(trigger).unwrap();
        collider.is_trigger = true;
        e.world.set_aabb_collider(trigger, collider);
    }
    e.update(1. / 60.);
    assert_eq!(e.data_scene_spatial_move_status(), 3);
    assert_eq!(pose(&e, a), before);
}

#[test]
fn spatial_navigation_last_request_reasons_do_not_replace_active_route() {
    let (mut e, a) = setup(true);
    assert_eq!(e.data_scene_spatial_move_diagnostics(), [1, 0, 0, 0, 0]);
    assert!(go(&mut e, 0., 80., 1));
    let before = pose(&e, a);
    let planned = e.data_scene_spatial_move_stats()[2];
    assert_eq!(e.data_scene_spatial_move_diagnostics()[1], 1);
    assert!(!go(&mut e, f32::NAN, 16., 0));
    assert_eq!(e.data_scene_spatial_move_diagnostics()[..3], [1, 2, 2]);
    assert_eq!(e.data_scene_spatial_move_stats()[..2], [0, 0]);
    assert!(!go(&mut e, 0., 80., 99));
    assert_eq!(e.data_scene_spatial_move_diagnostics()[1], 4);
    assert!(!e.move_data_scene_spatial_actor_to(0., 80., 1, 96., 0.001, 0., true));
    assert_eq!(e.data_scene_spatial_move_diagnostics()[1], 5);
    for _ in 0..800 {
        let trigger = wall(&mut e, 0., 56., 64., 112.);
        let mut collider = e.world.collider(trigger).unwrap();
        collider.is_trigger = true;
        e.world.set_aabb_collider(trigger, collider);
    }
    e.world.set_velocity(a, Velocity { vx: 3., vy: 4. });
    assert!(!go(&mut e, 0., 80., 1));
    assert_eq!(e.data_scene_spatial_move_diagnostics()[..3], [1, 7, 5]);
    assert!(e.data_scene_spatial_move_stats()[5] <= 8_000_000);
    assert_eq!(e.data_scene_spatial_move_stats()[2], planned);
    assert_eq!(e.data_scene_spatial_move_status(), 1);
    assert_eq!(pose(&e, a), before);
    assert_eq!(e.world.velocity(a), Some(Velocity { vx: 3., vy: 4. }));
    e.world.set_velocity(a, Velocity::default());
    finish(&mut e);
}

#[test]
fn spatial_navigation_small_grid_cove_repro_reaches_floor_three_within_original_budget() {
    // Reduced public game-test repro: identical seven supports, actor footprint and gateways.
    let (mut e, a) = setup(false);
    let data = [
        [
            -6000., -6000., 12000., 12000., -48., -48., -48., 1., 1., 1., 1.,
        ],
        [100., 200., 1000., 470., -36., 0., 0., 1., 1., 1., 1.],
        [100., 670., 1000., 150., -36., 0., 0., 1., 1., 1., 1.],
        [260., 470., 120., 200., 0., 96., 0., 1., 1., 1., 1.],
        [260., 350., 700., 120., 80., 96., 96., 1., 1., 1., 1.],
        [960., 350., 140., 120., 0., 96., 96., 1., 1., 1., 1.],
        [800., -100., 300., 160., -48., 40., 40., 1., 1., 1., 1.],
    ];
    assert!(e.configure_spatial_terrain(
        &data.concat(),
        &[
            1, 9, 16777215, 0, 2, 0, 16777215, 1, 3, 0, 16777215, 1, 4, 2, 16777215, 5, 5, 1,
            16777215, 9, 6, 3, 16777215, 1, 7, 8, 16777215, 0,
        ]
    ));
    assert!(e.spatial_scene.configure_connections(&[3, 4, 4, 5, 5, 6]));
    e.world
        .set_aabb_collider(a, AabbCollider::new(9., 9., false, CollisionLayer::Player));
    e.world.set_transform(
        a,
        Transform2D {
            x: 648.5919,
            y: 440.96555,
        },
    );
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId(0), 0., 24.).unwrap());
    assert!(e.configure_spatial_actor(a.id, a.generation, 170., 12., 16.));
    wall(&mut e, 495., 430., 12., 10.);
    wall(&mut e, 820., 430., 12., 10.);
    for (x, y) in [(290., 755.), (650., 440.), (1030., 410.)] {
        let trigger = sprite(&mut e, 73, x, y, 0);
        e.world.set_aabb_collider(
            trigger,
            AabbCollider::new(1., 1., true, CollisionLayer::Enemy),
        );
    }
    for _ in 0..9 {
        e.world.spawn_entity();
    }
    assert_eq!(e.world.alive_indices().len(), 15);
    let before = pose(&e, a);
    assert!(
        e.move_data_scene_spatial_actor_to(1030., 410., 3, 170., 32., 0., true),
        "stats={:?}, diagnostics={:?}",
        e.data_scene_spatial_move_stats(),
        e.data_scene_spatial_move_diagnostics()
    );
    assert_eq!(pose(&e, a), before);
    let stats = e.data_scene_spatial_move_stats();
    assert!(stats[5] <= 8_000_000);
    assert_eq!(e.data_scene_spatial_move_diagnostics()[3], 5);
    finish(&mut e);
    assert_eq!(pose(&e, a), (1030., 410., 3, 96.));
    e.world.set_transform(
        a,
        Transform2D {
            x: before.0,
            y: before.1,
        },
    );
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId(0), 0., 24.).unwrap());
    assert!(e.move_data_scene_spatial_actor_to(1030., 410., 3, 640., 32., 0., true));
    for _ in 0..1000 {
        if e.data_scene_spatial_move_status() != 1 {
            break;
        }
        e.update(0.05);
    }
    assert_eq!(
        e.data_scene_spatial_move_status(),
        2,
        "pose={:?}",
        pose(&e, a)
    );
    assert_eq!(pose(&e, a), (1030., 410., 3, 96.));
    assert!(e.move_data_scene_spatial_actor_to(before.0, before.1, 0, 640., 32., 0., true));
    for i in 0..1000 {
        if e.data_scene_spatial_move_status() != 1 {
            break;
        }
        e.update(if i % 2 == 0 { 0.05 } else { 1. / 60. });
    }
    assert_eq!(
        e.data_scene_spatial_move_status(),
        2,
        "pose={:?}",
        pose(&e, a)
    );
    assert_eq!(pose(&e, a), before);
}

#[test]
fn spatial_navigation_uses_collider_center_offset_and_step_drop_limits() {
    let (mut e, a) = setup(true);
    let mut collider = e.world.collider(a).unwrap();
    collider.offset_x = 3.;
    collider.offset_y = 1.;
    e.world.set_aabb_collider(a, collider);
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
    assert!(go(&mut e, 0., 80., 1));
    finish(&mut e);
    assert_eq!(pose(&e, a), (0., 80., 1, 32.));
    assert!(e.configure_spatial_actor(a.id, a.generation, 96., 8., 0.));
    assert!(
        !go(&mut e, 0., 16., 0),
        "slope descent exceeds zero drop allowance"
    );
    assert_eq!(pose(&e, a), (0., 80., 1, 32.));
}

#[test]
fn spatial_navigation_drives_movement_animation_and_stops_on_arrival_or_cancel() {
    let (mut e, a) = setup(false);
    let descriptors: Vec<f32> = (0..8).flat_map(|id| [id as f32, 2., 4., 1.]).collect();
    let frames: Vec<f32> = (0..8)
        .flat_map(|_| [0., 0., 0.5, 1., 0.5, 0., 1., 1.])
        .collect();
    assert!(e.configure_data_scene_sprite_clips(a.id, a.generation, &descriptors, &frames, 0));
    let poses: Vec<u32> = (0..8).flat_map(|id| [id, 0, 0]).collect();
    assert!(e.configure_data_scene_movement_animation(&poses, 1));
    assert!(go(&mut e, 48., 16., 0));
    e.update(1. / 60.);
    assert_eq!(
        e.data_scene_sprite_animation_state(a.id, a.generation)[0],
        7.
    );
    finish(&mut e);
    assert_eq!(
        e.data_scene_sprite_animation_state(a.id, a.generation)[0],
        3.
    );
    assert!(go(&mut e, 0., 16., 0));
    e.update(1. / 60.);
    assert_eq!(
        e.data_scene_sprite_animation_state(a.id, a.generation)[0],
        6.
    );
    assert!(e.cancel_data_scene_spatial_move());
    assert_eq!(
        e.data_scene_sprite_animation_state(a.id, a.generation)[0],
        2.
    );
}

#[test]
fn spatial_navigation_does_not_animate_a_different_primary_actor() {
    let (mut e, a) = setup(false);
    let other = sprite(&mut e, 73, 48., 16., 0);
    assert!(e.configure_data_scene_gameplay(true, other.id, other.generation, 0));
    let descriptors: Vec<f32> = (0..8).flat_map(|id| [id as f32, 1., 4., 1.]).collect();
    let frames: Vec<f32> = (0..8).flat_map(|_| [0., 0., 1., 1.]).collect();
    assert!(e.configure_data_scene_sprite_clips(
        other.id,
        other.generation,
        &descriptors,
        &frames,
        0
    ));
    let poses: Vec<u32> = (0..8).flat_map(|id| [id, 0, 0]).collect();
    assert!(e.configure_data_scene_movement_animation(&poses, 1));
    assert!(go(&mut e, 0., 96., 0));
    e.update(1. / 60.);
    assert!(pose(&e, a).1 > 16.);
    assert_eq!(
        e.data_scene_sprite_animation_state(other.id, other.generation)[0],
        1.
    );
    e.world.set_velocity(other, Velocity { vx: 3., vy: 0. });
    e.update(1. / 60.);
    assert_eq!(
        e.data_scene_sprite_animation_state(other.id, other.generation)[0],
        7.
    );
    assert!(e.cancel_data_scene_spatial_move());
    assert_eq!(
        e.data_scene_sprite_animation_state(other.id, other.generation)[0],
        7.
    );
}

#[test]
fn spatial_navigation_x_ramp_connections_and_fast_fragments_keep_floor_and_step_limits() {
    let (mut e, a) = setup(false);
    assert!(e.configure_spatial_terrain(
        &[
            surface(0., -32., 32., 64., 0., 0.),
            surface(32., -32., 32., 64., 0., 32.),
            [64., -32., 48., 64., 24., 32., 32., 1., 1., 1., 1.],
        ]
        .concat(),
        &[1, 0, 16777215, 17, 2, 0, 16777215, 53, 3, 1, 16777215, 25],
    ));
    assert!(e.spatial_scene.configure_connections(&[2, 3]));
    assert!(e.set_physics_body_position(a.id, a.generation, 16., 0.));
    for (x, floor, height) in [(80., 1, 32.), (16., 0, 0.)] {
        assert!(e.move_data_scene_spatial_actor_to(x, 0., floor, 640., 16., 0., true));
        for frame in 0..100 {
            if e.data_scene_spatial_move_status() != 1 {
                break;
            }
            e.update(if frame % 2 == 0 { 0.05 } else { 1. / 60. });
        }
        assert_eq!(
            e.data_scene_spatial_move_status(),
            2,
            "{:?}",
            e.data_scene_spatial_move_stats()
        );
        assert_eq!(pose(&e, a), (x, 0., floor, height));
        assert!(e.data_scene_spatial_move_stats()[5] <= 8_000_000);
    }
}

#[test]
fn distant_proxy_density_is_charged_once_per_segment_and_does_not_exhaust_local_route_budget() {
    let (mut e, a) = setup(true);
    for index in 0..1000 {
        wall(&mut e, 10000. + index as f32 * 4., 10000., 1., 1.);
    }
    assert!(
        go(&mut e, 0., 80., 1),
        "{:?}",
        e.data_scene_spatial_move_diagnostics()
    );
    let stats = e.data_scene_spatial_move_stats();
    assert!(stats[5] >= 1000 && stats[5] < 8_000_000);
    finish(&mut e);
    assert_eq!(pose(&e, a), (0., 80., 1, 32.));
    assert_eq!(e.data_scene_spatial_move_stats()[4], stats[4]);
}

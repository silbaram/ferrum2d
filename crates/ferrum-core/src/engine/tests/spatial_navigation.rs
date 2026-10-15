use super::{data_scene_visuals::sprite, *};
use crate::components::{HeightSpan, PhysicsFloorId};

fn surface(x: f32, y: f32, w: f32, d: f32, a: f32, b: f32) -> [f32; 11] {
    [x, y, w, d, 0., a, b, 1., 1., 1., 1.]
}
fn setup(multifloor: bool) -> (Engine, Entity) {
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
fn pose(e: &Engine, a: Entity) -> (f32, f32, u32, f32) {
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
    for _ in 0..1500 {
        e.world.spawn_entity();
    }
    assert!(!go(&mut e, 8., 16., 0));
    assert_eq!(e.data_scene_spatial_move_status(), 1);
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

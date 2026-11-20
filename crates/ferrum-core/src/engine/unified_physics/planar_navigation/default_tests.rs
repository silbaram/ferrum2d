use super::*;
use crate::components::{AabbCollider, CollisionLayer};
use crate::engine::{file_prepare::NativeFilePrepare, persistence};
use crate::physics3d::{BodyKind, BodyOptions, Shape};

fn fixture(kind: BodyKind, sensor: bool, offset: [f32; 3]) -> (Engine, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    assert_eq!(
        e.unified_physics.as_ref().unwrap().physics.config().space,
        Space::PlanarXy
    );
    assert!(!e.fixed_timestep_enabled);
    let actor = e
        .create_unified_body(
            BodyDesc {
                kind,
                pose: Pose {
                    position: [0.5, 0.5, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc {
                sensor,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
            },
            offset,
        )
        .unwrap();
    assert!(e.world.collider(actor).is_none());
    assert!(e.world.rigid_body(actor).is_none());
    assert!(e.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(e.configure_data_scene_navigation(12, 6, 1., 1., 0., 0., &[1; 72]));
    (e, actor)
}
fn pos(e: &Engine, actor: Entity) -> [f32; 3] {
    e.unified_body_state(actor).unwrap().pose.position
}
fn go(e: &mut Engine, x: f32, y: f32) -> bool {
    e.move_data_scene_actor_to(x, y, 4., 0., u32::MAX, true)
}
fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn file_clone(e: &Engine) -> Engine {
    // SDK sections stay opaque here. This verifies the real Native file guards,
    // sidecars, decode and target install, not whole SDK Ready/publication.
    let before = bytes(e);
    let file = e
        .capture_native_file(b"{}{}{}{}{}{}", &[2; 6], 7, 9, &[])
        .unwrap();
    let mut target = Engine::new();
    let mut prepare = NativeFilePrepare::new(&target, file, 7, 9, &[]).unwrap();
    assert_eq!(target.install_native_file_prepare(&mut prepare), 0);
    assert!(prepare.is_consumed());
    assert_eq!(bytes(e), before);
    assert_eq!(bytes(&target), before);
    target
}

#[test]
fn native_default_explicit_planar_route_uses_physical_xy_and_never_double_integrates_old_velocity()
{
    let (mut e, actor) = fixture(BodyKind::KinematicVelocity, false, [100., 200., 0.]);
    e.set_unified_body_velocity(actor, [3., 0., 0.], [0.; 3])
        .unwrap();
    assert!(go(&mut e, 10.5, 0.5));
    assert_eq!(pos(&e, actor), [0.5, 0.5, 0.]);
    e.update(0.1);
    let at = pos(&e, actor);
    assert!((at[0] - 0.9).abs() < 1e-5, "{at:?}");
    assert_eq!(
        e.world.transform(actor),
        Some(Transform2D {
            x: at[0] + 100.,
            y: at[1] + 200.
        })
    );
    assert_eq!(
        e.unified_body_state(actor).unwrap().linear_velocity,
        [0.; 3]
    );
    assert_eq!(e.unified_physics_error(), None);
    assert!(!e.fixed_timestep_enabled);
    assert_eq!(e.physics_counters.tile_candidate_checks, 0);
    for _ in 0..30 {
        e.update(0.1);
    }
    assert_eq!(e.data_scene_move_status(), 2);
    assert_eq!(pos(&e, actor), [10.5, 0.5, 0.]);
}

#[test]
fn native_default_planar_route_invalid_sources_preserve_existing_state_without_legacy_fallback() {
    for (kind, sensor) in [
        (BodyKind::Dynamic, false),
        (BodyKind::Fixed, false),
        (BodyKind::KinematicVelocity, true),
    ] {
        let (mut e, _) = fixture(kind, sensor, [0.; 3]);
        let before = bytes(&e);
        assert!(!go(&mut e, 10.5, 0.5));
        assert_eq!(bytes(&e), before);
    }
    let (mut e, actor) = fixture(BodyKind::KinematicVelocity, false, [0.; 3]);
    assert!(go(&mut e, 10.5, 0.5));
    let body = e.unified_body_id(actor).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_body_options(
            body,
            &BodyOptions {
                enabled: false,
                ..Default::default()
            },
        )
        .unwrap();
    let before = bytes(&e);
    assert!(!go(&mut e, 5.5, 0.5));
    assert_eq!(bytes(&e), before);
}

#[test]
fn native_default_navigation_obstacle_uses_actual_native_shape_pose_enable_and_generation() {
    let (mut e, _) = fixture(BodyKind::KinematicVelocity, false, [0.; 3]);
    let wall = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [4.5, 0.5, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.45, 0.45, 1.],
            }),
            [100., 200., 0.],
        )
        .unwrap();
    assert!(e.world.collider(wall).is_none());
    assert!(e.configure_data_scene_navigation_obstacles(&[wall.id, wall.generation, 0]));
    let state = e.unified_body_state(wall).unwrap();
    assert!(!e.query_tilemap_navigation_waypoint(0.5, 0.5, 4.5, 0.5));
    assert_eq!(e.unified_body_state(wall).unwrap(), state);
    let body = e.unified_body_id(wall).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_body_options(
            body,
            &BodyOptions {
                enabled: false,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(e.query_tilemap_navigation_waypoint(0.5, 0.5, 4.5, 0.5));
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_body_options(body, &BodyOptions::default())
        .unwrap();
    e.set_unified_body_pose(
        wall,
        Pose {
            position: [7.5, 0.5, 0.],
            ..Default::default()
        },
    )
    .unwrap();
    assert!(e.query_tilemap_navigation_waypoint(0.5, 0.5, 4.5, 0.5));
    assert!(!e.query_tilemap_navigation_waypoint(0.5, 0.5, 7.5, 0.5));
    e.remove_unified_body(wall).unwrap();
    let replacement = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [7.5, 0.5, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.45 }),
            [0.; 3],
        )
        .unwrap();
    assert_eq!(wall.id, replacement.id);
    assert_ne!(wall.generation, replacement.generation);
    assert!(e.query_tilemap_navigation_waypoint(0.5, 0.5, 7.5, 0.5));
    assert_eq!(
        e.capture_data_scene_navigation_obstacles(),
        [wall.id, wall.generation, 0]
    );
}

#[test]
fn native_default_planar_route_checkpoint_and_actual_file_replay_pending_obstacle_history() {
    let (mut e, actor) = fixture(BodyKind::KinematicVelocity, false, [40., -20., 0.]);
    let wall = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [4.5, 0.5, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.45, 0.45, 1.],
            }),
            [0.; 3],
        )
        .unwrap();
    assert!(e.configure_data_scene_navigation_obstacles(&[wall.id, wall.generation, 0]));
    assert!(go(&mut e, 10.5, 0.5));
    e.update(0.013);
    e.remove_unified_body(wall).unwrap();
    // Saved active old coverage is legal until the next navigation sync.
    let mut restored = file_clone(&e);
    let checkpoint = e.capture_runtime_checkpoint().unwrap();
    let trace: Vec<_> = [0., 0.013, 0.1, 0.04, 0.01, 0.1]
        .into_iter()
        .map(|dt| {
            e.update(dt);
            restored.update(dt);
            assert_eq!(bytes(&restored), bytes(&e));
            (dt, pos(&e, actor), e.data_scene_move_status())
        })
        .collect();
    assert!(e.restore_runtime_checkpoint(&checkpoint));
    for (dt, position, status) in trace {
        e.update(dt);
        assert_eq!(pos(&e, actor), position);
        assert_eq!(e.data_scene_move_status(), status);
    }
}

#[test]
fn native_default_navigation_manual_legacy_cells_still_accept_transformless_dormant_sources() {
    let mut e = Engine::new();
    e.use_data_scene();
    assert!(e.configure_data_scene_navigation(3, 3, 1., 1., 0., 0., &[1; 9]));
    let wall = e.world.spawn_entity();
    e.world.set_aabb_collider(
        wall,
        AabbCollider::new(0.25, 0.25, false, CollisionLayer::Wall),
    );
    assert!(e.world.transform(wall).is_none());
    assert!(e.configure_data_scene_navigation_obstacles(&[wall.id, wall.generation, 1, 1, 1]));
    assert!(!e.query_tilemap_navigation_waypoint(0.5, 0.5, 1.5, 1.5));
}

#[test]
fn native_default_planar_route_sweep_keeps_body_rotation_collider_offset_and_render_anchor_distinct(
) {
    let mut e = Engine::new();
    e.use_data_scene();
    let half = core::f32::consts::FRAC_1_SQRT_2;
    let actor = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [0.5, 0.5, 0.],
                    rotation: [0., 0., half, half],
                },
                ..Default::default()
            },
            ColliderDesc {
                pose: Pose {
                    position: [0., -0.5, 0.],
                    ..Default::default()
                },
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [0.2, 0.1, 1.],
                })
            },
            [100., 200., 0.],
        )
        .unwrap();
    let wall = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [4.5, 0.5, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 1., 2.],
            }),
            [0.; 3],
        )
        .unwrap();
    assert!(e.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(e.configure_data_scene_navigation(12, 6, 1., 1., 0., 0., &[1; 72]));
    // The native integration kernel normalizes even a zero-angular step. Compare
    // the identical scene without a route, rather than the pre-integration bits.
    let mut baseline = persistence::decode(&bytes(&e)).unwrap();
    baseline.update(0.1);
    let rotation = baseline.unified_body_state(actor).unwrap().pose.rotation;
    assert!(e.move_data_scene_actor_to(10.5, 0.5, 100., 0., u32::MAX, true));
    e.update(0.1);
    let state = e.unified_body_state(actor).unwrap();
    assert_eq!(e.data_scene_move_status(), 3);
    assert!(
        (state.pose.position[0] - 3.65).abs() < 0.002,
        "{:?}",
        state.pose
    );
    assert_eq!(state.pose.rotation, rotation);
    assert!(e.world.transform(actor).unwrap().x > 100.);
    assert!(e.query_point_bodies(4.5, 0.5, u32::MAX) > 0);
    assert_eq!(
        e.unified_body_state(wall).unwrap().pose.position,
        [4.5, 0.5, 0.]
    );
    assert_eq!(e.physics_counters.tile_candidate_checks, 0);
}

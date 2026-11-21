//! Actual native geometry routing, bounded output and cold admission.
use super::*;
use crate::collision::PHYSICS_DEBUG_COLLIDERS;
use crate::components::{AabbCollider, CircleCollider, CollisionLayer, HeightSpan, RigidBody};
use crate::physics3d::{BodyKind, Shape};

fn engine(space: Space) -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    e.set_auto_rigid_body_step_enabled(false);
    e
}
fn camera(e: &mut Engine) {
    e.set_viewport_size(400., 300.);
    assert!(e.configure_spatial_camera(&[
        0., 0., 100., 200., 0., 16., 0., 200., 0.1, 1000., 400., 300.
    ]));
}
fn enabled(e: &mut Engine, flags: u32) {
    e.set_physics_debug_line_flags(flags);
    e.set_physics_debug_lines_enabled(flags != 0);
}
fn cube(e: &mut Engine, position: [f32; 3]) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position,
                ..Default::default()
            },
            ..Default::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [1., 2., 3.],
        }),
        [0.; 3],
    )
    .unwrap()
}
fn bounds<I: Iterator<Item = [f32; 3]>>(points: I) -> ([f32; 3], [f32; 3]) {
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for p in points {
        for i in 0..3 {
            min[i] = min[i].min(p[i]);
            max[i] = max[i].max(p[i]);
        }
    }
    (min, max)
}
fn near(actual: f32, expected: f32) {
    assert!((actual - expected).abs() < 1e-4, "{actual} != {expected}");
}
fn flat_bounds(e: &Engine) -> ([f32; 3], [f32; 3]) {
    bounds(
        e.frame_buffers
            .physics_debug_lines
            .iter()
            .flat_map(|l| [[l.x0, l.y0, 0.], [l.x1, l.y1, 0.]]),
    )
}
fn frame(e: &mut Engine) {
    e.update_frame(0., true, true, true);
}

#[test]
fn unified_debug_flat_uses_native_fixture_pose_not_visual_origin_or_world_aabb() {
    let mut e = engine(Space::PlanarXy);
    let h = std::f32::consts::FRAC_1_SQRT_2;
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [10., 20., 0.],
                rotation: [0., 0., h, h],
            },
            ..Default::default()
        },
        ColliderDesc {
            pose: Pose {
                position: [2., 0., 0.],
                ..Default::default()
            },
            ..ColliderDesc::new(Shape::Box {
                half_extents: [1., 2., 3.],
            })
        },
        [50., -30., 0.],
    )
    .unwrap();
    enabled(&mut e, PHYSICS_DEBUG_COLLIDERS);
    frame(&mut e);
    assert_eq!(e.frame_buffers.native_debug_state[0], 12);
    assert_eq!(e.frame_buffers.native_debug_state[2], 1);
    let (min, max) = flat_bounds(&e);
    near(min[0], 8.);
    near(max[0], 12.);
    near(min[1], 21.);
    near(max[1], 23.);
    assert_eq!(e.frame_buffers.physics_debug_lines.len(), 12);
}

#[test]
fn unified_debug_spatial_without_camera_is_explicit_flat_xz_footprint() {
    let mut e = engine(Space::Spatial);
    cube(&mut e, [10., 20., 30.]);
    enabled(&mut e, PHYSICS_DEBUG_COLLIDERS);
    frame(&mut e);
    let (min, max) = flat_bounds(&e);
    near(min[0], 9.);
    near(max[0], 11.);
    near(min[1], -33.);
    near(max[1], -27.);
    assert_eq!(e.frame_buffers.native_debug_state[2], 17);
}

#[test]
fn unified_debug_engine_only_xyz_has_output_marker_depth_and_no_flat_duplicate() {
    let mut e = engine(Space::Spatial);
    camera(&mut e);
    cube(&mut e, [10., 20., 30.]);
    enabled(&mut e, PHYSICS_DEBUG_COLLIDERS);
    frame(&mut e);
    assert_eq!(e.spatial_debug_flags(), 256);
    assert_eq!(e.spatial_debug_len(), 24);
    assert!(e.frame_buffers.physics_debug_lines.is_empty());
    assert_eq!(e.frame_buffers.native_debug_state[2], 9);
    assert!(!e.spatial_debug_depth_test());
    let (min, max) = bounds(e.spatial_scene.debug.vertices.iter().map(|v| v.position));
    assert_eq!(min, [9., 18., 27.]);
    assert_eq!(max, [11., 22., 33.]);
    assert!(e.configure_spatial_debug(8));
    frame(&mut e);
    assert_eq!(e.spatial_debug_len(), 24);
    assert!(e.spatial_debug_depth_test());
    assert!(e.configure_spatial_debug(0));
    frame(&mut e);
    assert!(!e.spatial_debug_depth_test());
    assert_eq!(e.spatial_debug_len(), 24);
}

#[test]
fn unified_debug_joint_only_engine_request_reaches_xyz_and_removal_clears_lines() {
    use crate::physics3d::{JointDesc, JointKind};
    let mut e = engine(Space::Spatial);
    camera(&mut e);
    let a = cube(&mut e, [0., 0., 0.]);
    let b = e
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [4., 5., 6.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 1. }),
            [0.; 3],
        )
        .unwrap();
    let mut desc = JointDesc::new(
        e.unified_body_id(a).unwrap(),
        e.unified_body_id(b).unwrap(),
        JointKind::Rope { max_length: 10. },
    );
    desc.local_frame_a.position = [1., 0., 0.];
    desc.local_frame_b.position = [-1., 0., 0.];
    let joint = e
        .unified_physics
        .as_mut()
        .unwrap()
        .physics
        .create_joint(desc)
        .unwrap();
    enabled(&mut e, crate::collision::PHYSICS_DEBUG_JOINTS);
    frame(&mut e);
    assert_eq!(e.spatial_debug_flags(), 256);
    assert!(e.frame_buffers.physics_debug_lines.is_empty());
    assert!(e
        .spatial_scene
        .debug
        .vertices
        .chunks_exact(2)
        .any(|line| line[0].position == [1., 0., 0.] && line[1].position == [3., 5., 6.]));
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .remove_joint(joint)
        .unwrap();
    frame(&mut e);
    assert_eq!(e.spatial_debug_len(), 0);
    assert_eq!(e.frame_buffers.native_debug_state[0], 0);
}

#[test]
fn unified_debug_spatial_category_selects_native_without_engine_or_legacy_prism() {
    let mut e = engine(Space::PlanarXy);
    camera(&mut e);
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 10., y: 20. });
    e.world
        .set_circle_collider(a, CircleCollider::new(2., false, CollisionLayer::Enemy));
    e.world.set_height_span(
        a,
        HeightSpan {
            floor: Default::default(),
            elevation: 5.,
            height: 6.,
        },
    );
    assert!(e.configure_spatial_debug(24));
    frame(&mut e);
    // Native circle is a ball: three 16-segment rings, not the legacy tall prism.
    assert_eq!(e.spatial_debug_len(), 96);
    assert!(e.frame_buffers.physics_debug_lines.is_empty());
    let (min, max) = bounds(e.spatial_scene.debug.vertices.iter().map(|v| v.position));
    near(min[0], 8.);
    near(max[0], 12.);
    near(min[1], -2.);
    near(max[1], 2.);
    near(min[2], -22.);
    near(max[2], -18.);
    assert!(e.spatial_debug_depth_test());
}

#[test]
fn unified_debug_cold_teleport_changes_geometry_without_tick_or_query_refresh() {
    let mut e = engine(Space::Spatial);
    let a = cube(&mut e, [1., 2., 3.]);
    enabled(&mut e, PHYSICS_DEBUG_COLLIDERS);
    frame(&mut e);
    let before = e.elapsed_seconds;
    e.set_unified_body_pose(
        a,
        Pose {
            position: [10., 20., 30.],
            ..Default::default()
        },
    )
    .unwrap();
    frame(&mut e);
    let (min, _) = flat_bounds(&e);
    near(min[0], 9.);
    near(min[1], -33.);
    assert_eq!(e.elapsed_seconds, before);
    assert_eq!(e.last_fixed_update.steps, 0);
}

#[test]
fn unified_debug_cold_component_admission_preserves_pending_force_impulse_and_clock() {
    let mut e = engine(Space::PlanarXy);
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 10., y: 10. });
    e.world
        .set_circle_collider(a, CircleCollider::new(1., false, CollisionLayer::Enemy));
    let mut body = RigidBody::dynamic_circle(1., 1.);
    body.force = Velocity { vx: 5., vy: 7. };
    body.impulse = Velocity { vx: 2., vy: 3. };
    e.world.set_rigid_body(a, body);
    enabled(&mut e, PHYSICS_DEBUG_COLLIDERS);
    let before = e.fixed_timestep;
    frame(&mut e);
    assert!(e.unified_body_state(a).is_ok());
    assert_eq!(e.world.rigid_body(a).unwrap().force, body.force);
    assert_eq!(e.world.rigid_body(a).unwrap().impulse, body.impulse);
    assert_eq!(e.fixed_timestep, before);
    assert_eq!(e.elapsed_seconds, 0.);
    assert_eq!(
        e.unified_body_state(a).unwrap().pose.position,
        [10., 10., 0.]
    );
}

#[test]
fn unified_debug_frame_ccd_includes_native_terrain_without_gameplay_entity() {
    let mut e = engine(Space::Spatial);
    camera(&mut e);
    assert!(e.configure_spatial_terrain(
        &[-24., -16., 48., 32., -8., 1., 1., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    e.create_unified_body(
        BodyDesc {
            ccd: true,
            pose: Pose {
                position: [0., 2., 0.],
                ..Default::default()
            },
            linear_velocity: [0., -300., 0.],
            ..Default::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        [0.; 3],
    )
    .unwrap();
    e.set_auto_rigid_body_step_enabled(true);
    enabled(&mut e, crate::collision::PHYSICS_DEBUG_CCD);
    e.update(f64::from(0.01_f32));
    assert!(
        e.unified_physics_frame_statistics()
            .unwrap()
            .totals
            .ccd_clamps
            > 0
    );
    assert!(!e
        .unified_physics
        .as_ref()
        .unwrap()
        .statistics
        .observations
        .is_empty());
    assert!(
        e.unified_ccd_clamps().unwrap().is_empty(),
        "the entity-only convenience view intentionally excludes terrain"
    );
    assert_eq!(
        e.spatial_debug_len(),
        8,
        "native terrain witness axes and normal must still be drawn"
    );
    assert_eq!(e.frame_buffers.native_debug_state[0], 4);
}

#[test]
fn unified_debug_ccd_source_capacity_loss_is_visible_in_truncation() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        step_seconds: 0.01,
        max_events: 1,
        ..Default::default()
    })
    .unwrap();
    camera(&mut e);
    assert!(e.configure_spatial_terrain(
        &[-24., -16., 48., 32., -8., 1., 1., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    for x in [-2., 2.] {
        e.create_unified_body(
            BodyDesc {
                ccd: true,
                pose: Pose {
                    position: [x, 2., 0.],
                    ..Default::default()
                },
                linear_velocity: [0., -300., 0.],
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.; 3],
        )
        .unwrap();
    }
    enabled(&mut e, crate::collision::PHYSICS_DEBUG_CCD);
    e.update(f64::from(0.01_f32));
    assert!(
        e.unified_physics_frame_statistics()
            .unwrap()
            .totals
            .ccd_clamps_dropped
            > 0
    );
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .statistics
            .observations
            .len(),
        1
    );
    assert_eq!(e.frame_buffers.native_debug_state[0], 4);
    assert_ne!(e.frame_buffers.native_debug_state[2] & 2, 0);
    assert!(e.spatial_debug_truncated());
}

#[test]
fn unified_debug_rejected_cold_geometry_marks_empty_truncated_xyz_without_fallback() {
    let mut e = engine(Space::PlanarXy);
    camera(&mut e);
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 0., y: 0. });
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(f32::NAN, 1., false, CollisionLayer::Enemy),
    );
    assert!(e.configure_spatial_debug(24));
    frame(&mut e);
    assert_eq!(e.spatial_debug_len(), 0);
    assert!(e.spatial_debug_truncated());
    assert_ne!(e.spatial_debug_flags(), 0);
    assert_eq!(e.frame_buffers.native_debug_state, [0, 0, 15, 0]);
    assert!(e.frame_buffers.physics_debug_lines.is_empty());
    assert!(e.unified_physics_error().is_some());
}

#[test]
fn unified_debug_cap_work_truncation_reuses_xyz_capacity_and_disables_cleanly() {
    let mut e = engine(Space::Spatial);
    camera(&mut e);
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            ..Default::default()
        },
        ColliderDesc::new(Shape::TriangleMesh {
            vertices: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]],
            triangles: vec![[0, 1, 2]; 6000],
        }),
        [0.; 3],
    )
    .unwrap();
    enabled(&mut e, PHYSICS_DEBUG_COLLIDERS);
    frame(&mut e);
    assert_eq!(e.spatial_debug_len(), 32_768);
    assert!(e.spatial_debug_truncated());
    assert_eq!(e.frame_buffers.native_debug_state[0], 16_384);
    assert!(e.frame_buffers.native_debug_state[1] <= 65_536);
    let pointer = e.spatial_debug_ptr();
    let capacity = e.spatial_scene.debug.vertices.capacity();
    frame(&mut e);
    assert_eq!(e.spatial_debug_ptr(), pointer);
    assert_eq!(e.spatial_scene.debug.vertices.capacity(), capacity);
    enabled(&mut e, 0);
    frame(&mut e);
    assert_eq!(e.spatial_debug_len(), 0);
    assert_eq!(e.spatial_debug_flags(), 0);
    assert_eq!(e.frame_buffers.native_debug_state, [0; 4]);
    assert_eq!(e.spatial_scene.debug.vertices.capacity(), capacity);
}

#[test]
fn unified_debug_spatial_budget_accounts_for_existing_authored_debug_vertices() {
    let mut e = engine(Space::Spatial);
    camera(&mut e);
    assert!(e.configure_spatial_terrain(
        &[-24., -16., 48., 32., -8., 16., 16., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    assert!(e.configure_spatial_debug(1));
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            ..Default::default()
        },
        ColliderDesc::new(Shape::TriangleMesh {
            vertices: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.]],
            triangles: vec![[0, 1, 2]; 6000],
        }),
        [0.; 3],
    )
    .unwrap();
    enabled(&mut e, PHYSICS_DEBUG_COLLIDERS);
    frame(&mut e);
    assert_eq!(e.spatial_debug_len(), 32_768);
    assert!(e.spatial_debug_truncated());
    assert_eq!(
        e.frame_buffers.native_debug_state[0], 16_372,
        "12 authored terrain lines share the existing cap"
    );
    assert!(e.frame_buffers.native_debug_state[1] <= 65_536);
}

#[test]
fn unified_debug_checkpoint_preserves_and_replays_frame_geometry_and_statistics() {
    let mut e = engine(Space::Spatial);
    camera(&mut e);
    let a = cube(&mut e, [10., 20., 30.]);
    enabled(&mut e, PHYSICS_DEBUG_COLLIDERS);
    frame(&mut e);
    let expected: Vec<_> = e
        .spatial_scene
        .debug
        .vertices
        .iter()
        .map(|v| (v.position, v.color))
        .collect();
    let statistics = e.frame_buffers.native_debug_state;
    let checkpoint = e.runtime_checkpoint().unwrap();
    e.set_unified_body_pose(
        a,
        Pose {
            position: [40., 50., 60.],
            ..Default::default()
        },
    )
    .unwrap();
    frame(&mut e);
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    frame(&mut e);
    assert_eq!(e.frame_buffers.native_debug_state, statistics);
    assert_eq!(
        e.spatial_scene
            .debug
            .vertices
            .iter()
            .map(|v| (v.position, v.color))
            .collect::<Vec<_>>(),
        expected
    );
}

#[test]
fn unified_debug_off_and_renderless_paths_do_not_retain_native_geometry() {
    let mut e = engine(Space::Spatial);
    camera(&mut e);
    cube(&mut e, [1., 2., 3.]);
    frame(&mut e);
    assert_eq!(e.spatial_debug_len(), 0);
    assert_eq!(e.frame_buffers.native_debug_state, [0; 4]);
    assert_eq!(e.spatial_scene.debug.vertices.capacity(), 0);
    enabled(&mut e, PHYSICS_DEBUG_COLLIDERS);
    frame(&mut e);
    assert!(e.spatial_debug_len() > 0);
    e.update_frame(0., false, false, false);
    assert_eq!(e.spatial_debug_len(), 0);
    assert!(e.frame_buffers.physics_debug_lines.is_empty());
    assert_eq!(e.frame_buffers.native_debug_state, [0; 4]);
}

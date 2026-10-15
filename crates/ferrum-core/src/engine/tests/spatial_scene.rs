use super::data_scene_visuals::sprite;
use super::*;

fn terrain(engine: &mut Engine) -> bool {
    engine.configure_spatial_terrain(
        &[
            0., 0., 32., 64., 0., 0., 0., 1., 1., 1., 1., 32., 0., 32., 64., 0., 16., 16., 1., 1.,
            1., 1., 64., 0., 32., 64., 0., 32., 32., 1., 1., 1., 1.,
        ],
        &[1, 0, 16777215, 1, 2, 0, 16777215, 3, 3, 0, 16777215, 3],
    )
}
fn actor(engine: &mut Engine) -> Entity {
    let e = sprite(engine, 71, 16., 16., 0);
    engine
        .world
        .set_aabb_collider(e, AabbCollider::new(2., 2., false, CollisionLayer::Player));
    assert!(engine.configure_data_scene_body(e.id, e.generation, 1, true, 0, 0., 8.));
    e
}
fn camera(perspective: bool) -> [f32; 12] {
    [
        if perspective { 1. } else { 0. },
        48.,
        120.,
        120.,
        48.,
        16.,
        -32.,
        if perspective { 0.9 } else { 240. },
        0.1,
        1000.,
        800.,
        480.,
    ]
}
#[test]
fn spatial_billboard_uses_same_body_height_without_changing_legacy_sprite_abi() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = actor(&mut e);
    assert!(terrain(&mut e));
    assert!(e.configure_spatial_camera(&camera(false)));
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    e.build_render_commands();
    let lower = e.spatial_scene.billboards.clone();
    assert_eq!(lower.len(), 6);
    assert_eq!(e.frame_buffers.render_commands.len(), 0);
    assert!(e.set_physics_body_height_span(a.id, a.generation, 0, 64., 8.));
    e.build_render_commands();
    for (lo, hi) in lower.iter().zip(&e.spatial_scene.billboards) {
        assert_eq!(hi.position[1] - lo.position[1], 64.);
    }
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 7.]));
    e.build_render_commands();
    for (lo, hi) in lower.iter().zip(&e.spatial_scene.billboards) {
        assert_eq!(hi.position[1] - lo.position[1], 71.);
    }
    assert_eq!(
        std::mem::size_of::<crate::render_command::SpriteRenderCommand>(),
        60
    );
    e.use_data_scene();
    assert!(!e.spatial_scene.frame_active);
    assert!(e.spatial_scene.bindings.is_empty());
}
#[test]
fn native_terrain_step_and_ramp_change_the_original_entity_height() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = actor(&mut e);
    assert!(terrain(&mut e));
    assert!(e.move_spatial_body(a.id, a.generation, 64., 0., 16., 32.));
    assert!((e.world.transform(a).unwrap().x - 80.).abs() < 0.01);
    assert_eq!(e.world.height_span(a).unwrap().elevation, 32.);
    e.set_physics_body_position(a.id, a.generation, 16., 16.);
    e.set_physics_body_height_span(a.id, a.generation, 0, 0., 8.);
    assert!(e.move_spatial_body(a.id, a.generation, 64., 0., 8., 32.));
    assert!(e.world.transform(a).unwrap().x < 32.);
    assert_eq!(e.world.height_span(a).unwrap().elevation, 0.);
    assert!(e.configure_spatial_terrain(
        &[0., 0., 32., 64., 0., 0., 32., 1., 1., 1., 1.],
        &[1, 0, 16777215, 5]
    ));
    e.set_physics_body_position(a.id, a.generation, 16., 1.);
    e.set_physics_body_height_span(a.id, a.generation, 0, 0.5, 8.);
    assert!(e.move_spatial_body(a.id, a.generation, 0., 31., 16., 32.));
    assert!((e.world.height_span(a).unwrap().elevation - 16.).abs() < 0.01);
    assert!(e.set_physics_body_enabled(a.id, a.generation, false));
    assert!(!e.move_spatial_body(a.id, a.generation, 0., 1., 16., 32.));
}
#[test]
fn orthographic_and_perspective_pick_nearest_bridge_surface_and_preserve_snapshot() {
    for perspective in [false, true] {
        let mut e = Engine::new();
        e.use_data_scene();
        assert!(e.configure_spatial_terrain(
            &[
                0., 0., 96., 64., 0., 0., 0., 1., 1., 1., 1., 0., 0., 96., 64., 56., 64., 64., 1.,
                1., 1., 1.
            ],
            &[1, 0, 16777215, 1, 2, 1, 16777215, 9]
        ));
        assert!(e.configure_spatial_camera(&camera(perspective)));
        e.build_render_commands();
        let c = e.spatial_scene.frame_camera;
        let p = [48., 64., -32., 1.];
        let clip: [f32; 4] = std::array::from_fn(|r| (0..4).map(|k| c[k * 4 + r] * p[k]).sum());
        let hit = e.pick_spatial_surface(
            clip[0] / clip[3],
            clip[1] / clip[3],
            &c,
            e.spatial_terrain_revision(),
        );
        assert_eq!(hit.len(), 10);
        assert_eq!(hit[0], 2.);
        assert!((hit[4] - 64.).abs() < 0.01);
        assert_eq!(hit[9], 1.);
        let old = e.spatial_terrain_revision();
        e.clear_spatial_scene();
        assert!(e.pick_spatial_surface(0., 0., &c, old).is_empty());
    }
}
#[test]
fn invalid_spatial_configuration_is_atomic_and_stale_billboards_cannot_bind() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = actor(&mut e);
    assert!(terrain(&mut e));
    assert!(e.configure_spatial_camera(&camera(false)));
    let revision = e.spatial_terrain_revision();
    assert!(!e.configure_spatial_scene(
        &camera(false),
        &[f32::NAN; 11],
        &[1, 0, 0, 1],
        &[a.id, a.generation],
        &[1., 0.5, 0.],
        &[],
        &[]
    ));
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert_eq!(e.spatial_scene.terrain.len(), 108);
    e.despawn_physics_entity(a.id, a.generation);
    assert!(!e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
}

#[test]
fn nonwalkable_volume_blocks_native_movement_and_overflow_style_rejection_preserves_scene() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = actor(&mut e);
    assert!(e.configure_spatial_terrain(
        &[
            0., 0., 32., 64., 0., 0., 0., 1., 1., 1., 1., 32., 0., 32., 64., 0., 16., 16., 1., 1.,
            1., 1.
        ],
        &[1, 0, 16777215, 1, 2, 0, 16777215, 0]
    ));
    assert!(e.move_spatial_body(a.id, a.generation, 32., 0., 32., 32.));
    assert!(e.world.transform(a).unwrap().x < 32.);
    assert_eq!(e.world.height_span(a).unwrap().elevation, 0.);
    let rev = e.spatial_terrain_revision();
    assert!(!e.configure_spatial_scene(
        &camera(false),
        &[],
        &[],
        &[a.id, a.generation],
        &[f32::MAX, 0.5, 0.],
        &[],
        &[]
    ));
    assert_eq!(e.spatial_terrain_revision(), rev);
}

#[test]
fn wide_perspective_camera_round_trip_hits_low_surface() {
    let mut e = Engine::new();
    e.use_data_scene();
    assert!(e.configure_spatial_terrain(
        &[-96., -64., 64., 128., 0., 0., 0., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    assert!(e.configure_spatial_camera(&[
        1.,
        160.,
        380.,
        200.,
        32.,
        24.,
        -40.,
        std::f32::consts::FRAC_PI_2,
        0.1,
        2000.,
        1280.,
        720.
    ]));
    e.set_viewport_size(1280., 720.);
    e.build_render_commands();
    let c = e.spatial_scene.frame_camera;
    let p = [-80., 0., 32., 1.];
    let clip: [f32; 4] = std::array::from_fn(|r| (0..4).map(|k| c[k * 4 + r] * p[k]).sum());
    let hit = e.pick_spatial_surface(
        clip[0] / clip[3],
        clip[1] / clip[3],
        &c,
        e.spatial_terrain_revision(),
    );
    assert_eq!(
        e.pick_spatial_surface(-0.1620939, -0.050315935, &c, e.spatial_terrain_revision())
            .len(),
        10
    );
    assert_eq!(hit.len(), 10);
    assert!((hit[2] + 80.).abs() < 0.02 && (hit[3] + 32.).abs() < 0.02);
}

#[test]
fn native_spatial_input_drives_existing_animation_and_obeys_pause() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = actor(&mut e);
    assert!(e.configure_data_scene_gameplay(true, a.id, a.generation, 0));
    let descriptors: Vec<f32> = (0..8).flat_map(|id| [id as f32, 2., 4., 1.]).collect();
    let frames: Vec<f32> = (0..8)
        .flat_map(|_| [0., 0., 0.5, 1., 0.5, 0., 1., 1.])
        .collect();
    assert!(e.configure_data_scene_sprite_clips(a.id, a.generation, &descriptors, &frames, 0));
    let poses: Vec<u32> = (0..8).flat_map(|id| [id, 0, 0]).collect();
    assert!(e.configure_data_scene_movement_animation(&poses, 1));
    assert!(e.configure_spatial_scene(
        &camera(false),
        &[0., 0., 96., 64., 0., 0., 0., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1],
        &[a.id, a.generation],
        &[1., 0.5, 0.],
        &[a.id, a.generation],
        &[16., 16., 32.]
    ));
    assert!(!e.move_data_scene_actor_to(48., 16., 16., 0., u32::MAX, true));
    e.set_input(false, false, false, true, false, false, false, 0., 0.);
    e.update(0.25);
    assert_eq!(e.world.transform(a).unwrap().x, 20.);
    assert!(e.physics_counters.kinematic_moves > 0);
    assert_eq!(
        e.data_scene_sprite_animation_state(a.id, a.generation)[0],
        7.
    );
    e.update(0.25);
    assert_eq!(
        e.data_scene_sprite_animation_state(a.id, a.generation)[1],
        1.
    );
    assert!(e.pause_data_scene());
    e.update(0.25);
    assert_eq!(e.world.transform(a).unwrap().x, 24.);
    assert!(e.resume_data_scene());
    e.set_input(false, false, false, false, false, false, false, 0., 0.);
    e.update(0.25);
    assert_eq!(
        e.data_scene_sprite_animation_state(a.id, a.generation)[0],
        3.
    );
}

#[test]
fn spatial_atlas_frames_and_flips_preserve_rotated_foot_pivot_and_body_pose() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(800., 480.);
    let a = actor(&mut e);
    assert!(e.set_physics_body_position(a.id, a.generation, 0., 0.));
    assert!(e.set_physics_body_height_span(a.id, a.generation, 0, 16., 8.));
    assert!(e.configure_data_scene_visual(a.id, a.generation, 0.25, 1., 0., false, 1., 1., 1., 1.));
    assert!(e.configure_data_scene_sprite_clips(
        a.id,
        a.generation,
        &[7., 2., 4., 1.],
        &[0.0625, 0.125, 0.4375, 0.875, 0.5625, 0.125, 0.9375, 0.875],
        7
    ));
    assert!(
        e.configure_spatial_camera(&[0., 0., 56., 200., 0., 56., 0., 160., 0.1, 1000., 800., 480.])
    );
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 3.]));
    let original_span = e.world.height_span(a);
    for rotation in [0., 0.6, std::f32::consts::FRAC_PI_2] {
        assert!(e.set_physics_body_rotation(a.id, a.generation, rotation));
        let mut original_positions = None;
        for frame in 0..2 {
            for flip_x in 0..2 {
                for flip_y in 0..2 {
                    assert!(e.update_data_scene_sprite_animations(&[
                        a.id,
                        a.generation,
                        31,
                        7,
                        frame,
                        flip_x,
                        flip_y,
                        1
                    ]));
                    e.build_render_commands();
                    let vertices = &e.spatial_scene.billboards;
                    assert_eq!(vertices.len(), 6);
                    let positions: Vec<_> = vertices.iter().map(|v| v.position).collect();
                    assert_eq!(
                        original_positions.get_or_insert_with(|| positions.clone()),
                        &positions
                    );
                    let left = vertices[5].position;
                    let right = vertices[2].position;
                    let foot: [f32; 3] =
                        std::array::from_fn(|i| left[i] + 0.25 * (right[i] - left[i]));
                    for (actual, expected) in foot.into_iter().zip([0., 19., 0.]) {
                        assert!((actual - expected).abs() < 1e-5);
                    }
                    let start = 0.0625 + frame as f32 * 0.5;
                    assert_eq!(
                        vertices[0].uv,
                        [
                            start + if flip_x == 0 { 0. } else { 0.375 },
                            if flip_y == 0 { 0.125 } else { 0.875 }
                        ]
                    );
                    assert_eq!(
                        vertices[2].uv,
                        [
                            start + if flip_x == 0 { 0.375 } else { 0. },
                            if flip_y == 0 { 0.875 } else { 0.125 }
                        ]
                    );
                    assert_eq!(e.world.transform(a), Some(Transform2D { x: 0., y: 0. }));
                    assert_eq!(e.world.height_span(a), original_span);
                }
            }
        }
    }
}

#[test]
fn spatial_culling_keeps_visible_geometry_with_offscreen_foot_or_rotated_bounds() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(100., 100.);
    let a = actor(&mut e);
    assert!(e.configure_data_scene_visual(a.id, a.generation, 0.25, 1., 0., false, 1., 1., 1., 1.));
    assert!(
        e.configure_spatial_camera(&[0., 0., 0., 200., 0., 0., 0., 100., 0.1, 1000., 100., 100.])
    );
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    for (x, elevation, rotation, count) in [
        (0., -60., 0., 6),
        (-60., 0., 0., 6),
        (60., 0., 0., 0),
        (60., 0., std::f32::consts::FRAC_PI_2, 6),
        (0., 0., 0., 6),
    ] {
        assert!(e.set_physics_body_position(a.id, a.generation, x, 0.));
        assert!(e.set_physics_body_height_span(a.id, a.generation, 0, elevation, 8.));
        assert!(e.set_physics_body_rotation(a.id, a.generation, rotation));
        e.build_render_commands();
        assert_eq!(
            e.spatial_scene.billboards.len(),
            count,
            "pose=({x}, {elevation}), rotation={rotation}"
        );
        assert!(e.frame_buffers.render_commands.is_empty());
    }
}

#[test]
fn spatial_near_and_eye_plane_crossings_keep_partial_quad_then_cull_and_recover() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(800., 480.);
    let a = actor(&mut e);
    assert!(e.set_physics_body_position(a.id, a.generation, 0., 0.));
    assert!(e.configure_data_scene_visual(a.id, a.generation, 0.25, 1., 0., false, 1., 1., 1., 1.));
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    for perspective in [false, true] {
        for near in [0.1, 92., 94., 96., 98., 100., 0.1] {
            assert!(e.configure_spatial_camera(&[
                f32::from(u8::from(perspective)),
                0.,
                48.,
                96.,
                0.,
                40.,
                0.,
                if perspective {
                    std::f32::consts::FRAC_PI_3
                } else {
                    160.
                },
                near,
                1000.,
                800.,
                480.
            ]));
            e.build_render_commands();
            assert_eq!(
                e.spatial_scene.billboards.len(),
                if near == 100. { 0 } else { 6 }
            );
            if near == 96. {
                let m = e.spatial_scene.frame_camera;
                let clip = |p: [f32; 3], row: usize| {
                    m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row]
                };
                let top = e.spatial_scene.billboards[0].position;
                let bottom = e.spatial_scene.billboards[2].position;
                assert!(clip(top, 2) + clip(top, 3) < 0.);
                assert!(clip(bottom, 2) + clip(bottom, 3) > 0.);
            }
        }
    }
    assert!(e.configure_spatial_camera(&[
        1.,
        0.,
        16.,
        16.,
        0.,
        0.,
        0.,
        std::f32::consts::FRAC_PI_2,
        0.1,
        1000.,
        800.,
        480.
    ]));
    e.build_render_commands();
    assert_eq!(e.spatial_scene.billboards.len(), 6);
    let m = e.spatial_scene.frame_camera;
    let clip_w = |p: [f32; 3]| m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    assert!(clip_w(e.spatial_scene.billboards[0].position) < 0.);
    assert!(clip_w(e.spatial_scene.billboards[2].position) > 0.);
}

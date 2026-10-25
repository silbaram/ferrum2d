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
fn authoring_preview_filter_changes_draws_and_picking_without_changing_body_or_terrain() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = actor(&mut e);
    assert!(terrain(&mut e));
    assert!(e.configure_spatial_camera(&camera(false)));
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    e.build_render_commands();
    let at = e.world.transform(a).unwrap();
    let span = e.world.height_span(a).unwrap();
    let geometry = e.spatial_scene.terrain.clone();
    assert!(!e.spatial_scene.terrain_draw_ranges.is_empty());
    assert_eq!(e.spatial_scene.billboards.len(), 6);
    assert!(e.set_spatial_preview_filter(&[a.id, a.generation], &[1, 2, 3]));
    e.build_render_commands();
    assert!(e.spatial_scene.terrain_draw_ranges.is_empty());
    assert!(e.spatial_scene.billboards.is_empty());
    assert_eq!(e.world.transform(a), Some(at));
    assert_eq!(e.world.height_span(a), Some(span));
    assert_eq!(e.spatial_scene.terrain, geometry);
    assert!(!e.set_spatial_preview_filter(&[a.id, a.generation + 1], &[]));
    assert!(!e.set_spatial_preview_filter(&[], &[999]));
    assert_eq!(e.spatial_scene.preview_hidden_entities.len(), 1);
    assert_eq!(e.spatial_scene.preview_hidden_surfaces.len(), 3);
    assert!(e.set_spatial_preview_filter(&[], &[]));
    e.build_render_commands();
    assert!(!e.spatial_scene.terrain_draw_ranges.is_empty());
    assert_eq!(e.spatial_scene.billboards.len(), 6);
}

#[test]
fn selected_entity_diagnostics_distinguish_absent_fsm_and_stale_handles_without_mutation() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = actor(&mut e);
    let before = e.world.transform(a);
    let absent = e.gameplay_entity_diagnostics(a.id, a.generation);
    assert_eq!(absent[0], 1.);
    assert_eq!(absent[1], 0.);
    assert!(e.set_gameplay_behavior_state_machine(a.id, a.generation, 7));
    assert!(e.world.set_health(a, 12.));
    assert!(e
        .world
        .upsert_action_binding(a, ActionBinding::projectile(42, 1., 10., 2., 1.)));
    assert!(e.world.commit_action_cooldown_if_ready(a, 42).is_some());
    let active = e.gameplay_entity_diagnostics(a.id, a.generation);
    assert_eq!(active[1], 1.);
    assert_eq!(active[2], 7.);
    assert_eq!(active[3], 1.);
    assert_eq!(active[4], 12.);
    assert_eq!(active[9], 1.);
    assert_eq!(&active[10..], &[42., 1.]);
    assert_eq!(e.world.transform(a), before);
    assert!(e
        .gameplay_entity_diagnostics(a.id, a.generation + 1)
        .is_empty());
    assert_eq!(e.gameplay_entity_diagnostics(a.id, a.generation), active);
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

#[test]
fn static_model_instances_share_native_height_and_restore_without_geometry_in_progress() {
    let mut e = Engine::new();
    e.use_data_scene();
    let rock = sprite(&mut e, 71, 16., 16., 0);
    e.world
        .set_aabb_collider(rock, AabbCollider::new(8., 8., false, CollisionLayer::Wall));
    assert!(e.configure_data_scene_body(rock.id, rock.generation, 0, true, 0, 12., 24.));
    let setup = |e: &mut Engine, scale| {
        e.configure_spatial_scene_models(
            &camera(false),
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[rock.id, rock.generation, 1, 3, 1, 8],
            &[0., 0., scale, -14., 0., -13., 18., 24., 15.],
        )
    };
    assert!(setup(&mut e, 1.));
    e.build_render_commands();
    assert_eq!(e.spatial_model_len(), 1);
    assert_eq!(e.frame_buffers.render_commands.len(), 0);
    let words = unsafe { std::slice::from_raw_parts(e.spatial_model_ptr(), 20) };
    assert_eq!(words[17], 12.);
    let epoch = e.data_scene_epoch();
    let handles = [rock.id, rock.generation];
    let progress = e.capture_data_scene_spatial_progress(epoch, &handles);
    assert_eq!(progress[13], 1.);
    assert_eq!(progress[18], 12.);
    let states = e.capture_data_scene_progress(epoch, &handles);
    assert!(e.set_physics_body_position(rock.id, rock.generation, 99., 99.));
    assert!(e.restore_data_scene_progress_with_spatial(epoch, &handles, &states, &[], &progress));
    assert_eq!(e.world.transform(rock).unwrap().x, 16.);
    let mut invalid = progress.clone();
    invalid[14] = 3e38;
    invalid[15] = 3e38;
    assert!(!e.restore_data_scene_progress_with_spatial(epoch, &handles, &states, &[], &invalid));
    assert_eq!(e.world.transform(rock).unwrap().x, 16.);
    assert!(!e.preflight_spatial_model_poses(
        &[0., 0., 1., -14., 0., -13., 18., 24., 15.],
        &[3e38, 3e38, 0.]
    ));
    assert!(e.set_physics_body_position(rock.id, rock.generation, 3e38, 3e38));
    assert!(
        e.capture_data_scene_spatial_progress(epoch, &handles)
            .is_empty(),
        "unrestorable model poses must not be saved"
    );
    assert!(e.set_physics_body_position(rock.id, rock.generation, 16., 16.));
    assert!(!setup(&mut e, 0.));
    assert_eq!(e.spatial_scene.models.bindings.len(), 1);
    assert!(e.spatial_model_asset_in_use(1));
    e.use_data_scene();
    assert!(!e.spatial_model_asset_in_use(1));
}

#[test]
fn spatial_model_attachments_follow_native_root_pose_and_motion_restore_atomically() {
    let mut e = Engine::new();
    e.use_data_scene();
    let root = sprite(&mut e, 71, 100., 200., 0);
    let child = sprite(&mut e, 72, 0., 0., 0);
    let proxy = sprite(&mut e, 73, 0., 0., 0);
    for (entity, body) in [(root, 1), (child, 0), (proxy, 0)] {
        e.world.set_aabb_collider(
            entity,
            AabbCollider::new(1., 1., entity != proxy, CollisionLayer::Wall),
        );
        assert!(e.configure_data_scene_body(entity.id, entity.generation, body, true, 0, 10., 1.));
    }
    assert!(e.configure_spatial_scene_models(
        &camera(false),
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[
            root.id,
            root.generation,
            1,
            3,
            1,
            2,
            child.id,
            child.generation,
            2,
            3,
            1,
            2
        ],
        &[0., 0., 1., -1., 0., -1., 1., 2., 1., 0., 0., 1., -1., 0., -1., 1., 2., 1.]
    ));
    let metadata = [
        child.id,
        child.generation,
        root.id,
        root.generation,
        1,
        proxy.id,
        proxy.generation,
        child.id,
        child.generation,
        1,
    ];
    assert!(e.configure_spatial_attachments(&metadata, &[10., 0., 2., 0., 0., 5., 3., 0.]));
    assert_eq!(
        e.world.transform(child),
        Some(Transform2D { x: 110., y: 200. })
    );
    assert!(e.set_physics_body_position(root.id, root.generation, 200., 300.));
    assert!(e.set_physics_body_rotation(root.id, root.generation, std::f32::consts::FRAC_PI_2));
    assert!(e.set_physics_body_height_span(root.id, root.generation, 2, 40., 1.));
    let child_at = e.world.transform(child).unwrap();
    let proxy_at = e.world.transform(proxy).unwrap();
    assert!((child_at.x - 200.).abs() < 0.0001 && (child_at.y - 310.).abs() < 0.0001);
    assert!((proxy_at.x - 195.).abs() < 0.0001 && (proxy_at.y - 310.).abs() < 0.0001);
    assert_eq!(e.world.height_span(child).unwrap().elevation, 42.);
    assert_eq!(e.world.height_span(proxy).unwrap().elevation, 45.);
    assert_eq!(e.world.height_span(proxy).unwrap().floor.0, 2);
    assert!(!e.set_physics_body_position(child.id, child.generation, 0., 0.));
    assert!(!e.set_physics_body_position(root.id, root.generation, 1_000_000., 1_000_000.));
    assert_eq!(e.world.transform(child), Some(child_at));
    e.build_render_commands();
    let packet = unsafe { std::slice::from_raw_parts(e.spatial_model_ptr(), 40) };
    assert_eq!(packet[36], child_at.x);
    assert_eq!(packet[38], -child_at.y);
    let handles = [
        root.id,
        root.generation,
        child.id,
        child.generation,
        proxy.id,
        proxy.generation,
    ];
    let epoch = e.data_scene_epoch();
    let spatial = e.capture_data_scene_spatial_progress(epoch, &handles);
    assert_eq!(spatial[13], 1.);
    assert_eq!(spatial[21], 0.);
    assert_eq!(spatial[29], 0.);
    let rotations = e.capture_data_scene_spatial_rotations(epoch, &handles);
    let states = e.capture_data_scene_progress(epoch, &handles);
    assert!(e.set_physics_body_position(root.id, root.generation, 300., 400.));
    assert!(e.set_physics_body_rotation(root.id, root.generation, 0.));
    assert!(e.restore_data_scene_progress_with_spatial_motion(
        epoch,
        &handles,
        &states,
        &[],
        &spatial,
        &[],
        &rotations,
        false
    ));
    assert_eq!(e.world.transform(child), Some(child_at));
    assert_eq!(e.world.transform(proxy), Some(proxy_at));
    let mut invalid = rotations.clone();
    invalid[0] = f64::NAN;
    assert!(!e.restore_data_scene_progress_with_spatial_motion(
        epoch,
        &handles,
        &states,
        &[],
        &spatial,
        &[],
        &invalid,
        false
    ));
    assert_eq!(e.world.transform(proxy), Some(proxy_at));
    assert!(!e.configure_spatial_attachments(
        &[
            child.id,
            child.generation,
            proxy.id,
            proxy.generation,
            1,
            proxy.id,
            proxy.generation,
            child.id,
            child.generation,
            1
        ],
        &[0.; 8]
    ));
    assert_eq!(e.world.transform(proxy), Some(proxy_at));
    assert!(e.despawn_physics_entity(root.id, root.generation));
    assert!(!e.world.is_current_entity(child));
    assert!(!e.world.is_current_entity(proxy));
}

fn attachment_pair(root_x: f32, model_elevation: f32) -> (Engine, Entity, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    let root = sprite(&mut e, 71, root_x, 0., 0);
    let child = sprite(&mut e, 72, 0., 0., 0);
    for (entity, body) in [(root, 1), (child, 0)] {
        e.world.set_aabb_collider(
            entity,
            AabbCollider::new(1., 1., false, CollisionLayer::Wall),
        );
        assert!(e.configure_data_scene_body(entity.id, entity.generation, body, true, 0, 0., 1.));
    }
    assert!(e.configure_spatial_scene_models(
        &camera(false),
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[root.id, root.generation, 1, 3, 1, 2],
        &[model_elevation, 0., 1., -1., 0., -1., 1., 2., 1.],
    ));
    (e, root, child)
}

#[test]
fn spatial_attachments_validate_root_model_even_when_child_elevation_cancels_overflow() {
    let (mut e, root, child) = attachment_pair(0., 2e38);
    let metadata = [child.id, child.generation, root.id, root.generation, 1];
    assert!(e.configure_spatial_attachments(&metadata, &[0., 0., -2e38, 0.]));
    let child_before = e.world.height_span(child);
    assert!(!e.set_physics_body_height_span(root.id, root.generation, 0, 2e38, 1.));
    assert_eq!(e.world.height_span(root).unwrap().elevation, 0.);
    assert_eq!(e.world.height_span(child), child_before);
    assert!(!e
        .capture_data_scene_spatial_progress(e.data_scene_epoch(), &[root.id, root.generation])
        .is_empty());
    // Reconfiguring with an invalid root must leave the current graph and child pose intact.
    e.world
        .set_height_span(root, HeightSpan::new(PhysicsFloorId(0), 2e38, 1.).unwrap());
    assert!(!e.configure_spatial_attachments(&metadata, &[0., 0., -2e38, 0.]));
    assert_eq!(e.world.height_span(child), child_before);
    e.build_render_commands();
    assert_eq!(e.world.height_span(root).unwrap().elevation, 0.);
}

#[test]
fn spatial_attachments_roll_back_autonomous_motion_instead_of_stranding_colliders() {
    let (mut e, root, child) = attachment_pair(999_980., 0.);
    assert!(e.configure_spatial_attachments(
        &[child.id, child.generation, root.id, root.generation, 1],
        &[10., 0., 0., 0.],
    ));
    let root_before = e.world.transform(root);
    let child_before = e.world.transform(child);
    assert!(e.set_physics_body_velocity(root.id, root.generation, 100., 0.));
    assert!(e.set_physics_body_angular_velocity(root.id, root.generation, 0.5));
    e.world.update(1.);
    assert!(e.world.transform(root).unwrap().x > 1_000_000.);
    e.build_render_commands();
    assert_eq!(e.world.transform(root), root_before);
    assert_eq!(e.world.transform(child), child_before);
    assert_eq!(
        e.world
            .rotation_at_index_or_default(root.id as usize)
            .radians,
        0.
    );
    assert_eq!(e.world.velocity(root), Some(Velocity::default()));
    assert_eq!(
        e.world.angular_velocity(root),
        Some(crate::components::AngularVelocity::default())
    );
    assert!(e.set_physics_body_position(root.id, root.generation, 100., 200.));
    assert_eq!(
        e.world.transform(child),
        Some(Transform2D { x: 110., y: 200. })
    );
    // Rendering may be skipped. Both integration paths and fixed substeps must still roll back.
    for automatic in [false, true] {
        for fixed in [false, true] {
            assert!(e.set_physics_body_position(root.id, root.generation, 999_980., 0.));
            e.auto_rigid_body_step_enabled = automatic;
            e.configure_fixed_timestep(fixed, 0.5, 2., 4);
            assert!(e.set_physics_body_velocity(root.id, root.generation, 100., 0.));
            e.update_frame(1., false, false, false);
            assert_eq!(
                e.world.transform(root),
                Some(Transform2D { x: 999_980., y: 0. }),
                "automatic={automatic}, fixed={fixed}"
            );
            assert_eq!(
                e.world.transform(child),
                Some(Transform2D { x: 999_990., y: 0. })
            );
            assert_eq!(e.world.velocity(root), Some(Velocity::default()));
        }
    }
}

#[test]
fn spatial_attachment_motion_restore_rejects_inconsistent_graph_and_clears_angular_velocity() {
    let (mut e, root, child) = attachment_pair(100., 0.);
    assert!(e.configure_spatial_attachments(
        &[child.id, child.generation, root.id, root.generation, 1],
        &[10., 0., 0., 0.],
    ));
    let handles = [root.id, root.generation, child.id, child.generation];
    let epoch = e.data_scene_epoch();
    let states = e.capture_data_scene_progress(epoch, &handles);
    let spatial = e.capture_data_scene_spatial_progress(epoch, &handles);
    let child_before = e.world.transform(child);
    assert!(e.set_physics_body_angular_velocity(root.id, root.generation, 2.));
    let mut invalid = spatial.clone();
    invalid[14] = 1_000_000.;
    assert!(!e.restore_data_scene_progress_with_spatial_motion(
        epoch,
        &handles,
        &states,
        &[],
        &invalid,
        &[],
        &[0.5, 0.],
        false,
    ));
    assert_eq!(
        e.world
            .rotation_at_index_or_default(root.id as usize)
            .radians,
        0.
    );
    assert_eq!(
        e.world.angular_velocity(root).unwrap().radians_per_second,
        2.
    );
    assert_eq!(e.world.transform(child), child_before);
    let mut missing_span = spatial.clone();
    missing_span[16..21].fill(0.);
    assert!(!e.restore_data_scene_progress_with_spatial_motion(
        epoch,
        &handles,
        &states,
        &[],
        &missing_span,
        &[],
        &[0., 0.],
        false,
    ));
    let mut removed_root_pose = spatial.clone();
    removed_root_pose[13..21].fill(0.);
    assert!(!e.restore_data_scene_progress_with_spatial_motion(
        epoch,
        &handles,
        &[0, states[1]],
        &[],
        &removed_root_pose,
        &[],
        &[0., 0.],
        false,
    ));
    assert!(e.world.is_current_entity(root));
    assert!(e.world.is_current_entity(child));
    assert!(e.restore_data_scene_progress_with_spatial_motion(
        epoch,
        &handles,
        &states,
        &[],
        &spatial,
        &[],
        &[0., 0.],
        false,
    ));
    assert_eq!(
        e.world.angular_velocity(root).unwrap().radians_per_second,
        0.
    );
    assert_eq!(e.world.transform(child), child_before);
}

#[test]
fn spatial_attachments_reject_child_motion_and_preserve_reused_entity_generations() {
    let (mut e, root, child) = attachment_pair(100., 0.);
    let metadata = [child.id, child.generation, root.id, root.generation, 1];
    assert!(e.configure_spatial_attachments(&metadata, &[10., 0., 0., 0.]));
    assert!(!e.set_physics_body_velocity(child.id, child.generation, 1., 0.));
    assert!(!e.set_physics_body_angular_velocity(child.id, child.generation, 1.));
    assert!(!e.apply_physics_body_force(child.id, child.generation, 1., 0.));
    assert!(!e.apply_physics_body_impulse(child.id, child.generation, 1., 0.));
    assert!(!e.apply_physics_body_torque(child.id, child.generation, 1.));
    assert!(!e.apply_physics_body_angular_impulse(child.id, child.generation, 1.));
    e.world.despawn(root);
    let replacement = sprite(&mut e, 73, 300., 400., 0);
    assert_eq!(replacement.id, root.id);
    assert_ne!(replacement.generation, root.generation);
    assert!(!e.configure_spatial_attachments(&metadata, &[10., 0., 0., 0.]));
    assert!(!e.set_physics_body_position(root.id, root.generation, 0., 0.));
    e.build_render_commands();
    assert!(!e.world.is_current_entity(child));
    assert!(e.world.is_current_entity(replacement));
    assert_eq!(
        e.world.transform(replacement),
        Some(Transform2D { x: 300., y: 400. })
    );
}

#[test]
fn static_model_world_text_uses_spatial_depth_and_tracks_the_same_native_height() {
    let mut e = Engine::new();
    e.use_data_scene();
    let rock = sprite(&mut e, 71, 16., 16., 0);
    assert!(e.configure_data_scene_body(rock.id, rock.generation, 0, true, 0, 12., 24.));
    assert!(e.configure_spatial_scene_models(
        &camera(false),
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[rock.id, rock.generation, 1, 3, 1, 8],
        &[3., 0., 2., -14., 0., -13., 18., 24., 15.]
    ));
    assert!(e.register_bitmap_font(
        7,
        99,
        8.,
        u32::MAX,
        &[65],
        &[0., 0., 1., 1., 8., 8., 0., 0., 8.],
        &[],
        &[]
    ));
    assert!(e.set_world_text(
        3,
        7,
        "A",
        0.,
        -32.,
        1.,
        1.,
        1.,
        1.,
        1.,
        0.,
        0,
        4,
        0,
        0.,
        rock.id,
        rock.generation
    ));
    e.build_render_commands();
    assert!(
        e.frame_buffers.render_commands.is_empty(),
        "model labels must not leak into flat camera commands"
    );
    let first = e.spatial_scene.billboards.clone();
    assert_eq!(first.len(), 6);
    assert_eq!(first[0].texture, 99.);
    assert!(e.set_physics_body_height_span(rock.id, rock.generation, 0, 76., 24.));
    e.build_render_commands();
    for (old, new) in first.iter().zip(&e.spatial_scene.billboards) {
        assert_eq!(new.position[1] - old.position[1], 64.);
    }
    // The model's meter-to-world scale does not rescale font pixels.
    let edge = crate::spatial_scene::sub(first[1].position, first[0].position);
    assert!((crate::spatial_scene::dot(edge, edge).sqrt() - 8.).abs() < 0.001);
}

#[test]
fn static_model_off_camera_does_not_disappear_from_asset_lifetime_and_stale_handles_are_skipped() {
    let mut e = Engine::new();
    e.use_data_scene();
    let rock = sprite(&mut e, 71, 100000., 100000., 0);
    assert!(e.configure_spatial_scene_models(
        &camera(false),
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[rock.id, rock.generation, 1, 3, 1, 8],
        &[0., 0., 1., -1., 0., -1., 1., 2., 1.]
    ));
    e.build_render_commands();
    assert_eq!(e.spatial_model_len(), 1);
    let words = unsafe { std::slice::from_raw_parts(e.spatial_model_ptr().cast::<u32>(), 20) };
    assert_eq!(words[2], 0);
    let mut light = vec![0.; 80];
    light[0] = 1.;
    light[1] = 1.;
    light[2] = 0.;
    light[3] = 128.;
    light[4] = 0.05;
    light[12..20].copy_from_slice(&[100000., 64., -100000., 200., 1., 1., 1., 1.]);
    light[60..76].copy_from_slice(&[
        100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
    ]);
    assert!(e.configure_spatial_environment(&light));
    e.build_render_commands();
    let words = unsafe { std::slice::from_raw_parts(e.spatial_model_ptr().cast::<u32>(), 20) };
    assert_eq!(words[2] & 1, 0, "camera culling still excludes color draw");
    assert_ne!(
        words[2] & 0x7e,
        0,
        "offscreen models still submit to nearby shadow faces"
    );
    e.world.despawn(rock);
    e.build_render_commands();
    assert_eq!(e.spatial_model_len(), 0);
}

#[test]
fn invisible_surface_proxies_retain_movement_picking_and_debug_without_render_submission() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = actor(&mut e);
    let values = [0., 0., 96., 64., 0., 0., 32., 1., 1., 1., 1.];
    assert_eq!(e.spatial_surface_proxy_abi_version(), 1);
    assert!(e.configure_spatial_terrain(&values, &[1, 0, 16777215, 21]));
    assert!(e.configure_spatial_camera(&camera(false)));
    assert!(e.configure_spatial_debug(1));
    assert!(e.set_physics_body_height_span(a.id, a.generation, 0, 8., 8.));
    assert!(e.move_spatial_body(a.id, a.generation, 0., 16., 8., 8.));
    assert_eq!(e.world.transform(a).unwrap().y, 32.);
    assert_eq!(e.world.height_span(a).unwrap().elevation, 16.);
    e.build_render_commands();
    assert_eq!(
        e.spatial_scene.terrain.len(),
        36,
        "stable static storage ABI"
    );
    assert!(e.spatial_scene.terrain_draw_ranges.is_empty());
    assert_eq!(e.spatial_scene.terrain_materials[0].flags, 0);
    assert!(e.spatial_debug_len() > 0);
    let c = e.spatial_scene.frame_camera;
    let p = [48., 16., -32., 1.];
    let clip: [f32; 4] = std::array::from_fn(|r| (0..4).map(|k| c[k * 4 + r] * p[k]).sum());
    let hit = e.pick_spatial_surface(
        clip[0] / clip[3],
        clip[1] / clip[3],
        &c,
        e.spatial_terrain_revision(),
    );
    assert_eq!(hit.len(), 10);
    assert_eq!(hit[0], 1.);
    assert!((hit[4] - 16.).abs() < 0.01);
    let mut environment = vec![0.; 80];
    environment[0] = 1.;
    environment[1] = 1.;
    environment[2] = 0.;
    environment[3] = 128.;
    environment[4] = 0.05;
    environment[12..20].copy_from_slice(&[48., 96., -32., 300., 1., 1., 1., 1.]);
    environment[60..76].copy_from_slice(&[
        100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
    ]);
    assert!(e.configure_spatial_environment(&environment));
    e.build_render_commands();
    assert!(e.spatial_scene.shadow_draw_ranges.is_empty());
}

#[test]
fn invisible_surface_invalid_metadata_and_shadow_overrides_are_atomic() {
    let mut e = Engine::new();
    e.use_data_scene();
    assert!(terrain(&mut e));
    let revision = e.spatial_terrain_revision();
    let values = [0., 0., 96., 64., 0., 0., 0., 1., 1., 1., 1.];
    for metadata in [[1, 0, 2, 17], [1, 0, 16777215, 33], [1, 0, 16777215, 23]] {
        assert!(!e.configure_spatial_terrain(&values, &metadata));
        assert_eq!(e.spatial_terrain_revision(), revision);
        assert_eq!(e.spatial_scene.terrain.len(), 108);
    }
    assert!(!e.configure_spatial_scene_materials(
        &camera(false),
        &values,
        &[1, 0, 16777215, 17],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[3],
        &[]
    ));
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert!(e.configure_spatial_scene_materials(
        &camera(false),
        &values,
        &[1, 0, 16777215, 17],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[0],
        &[]
    ));
    e.build_render_commands();
    assert!(e.spatial_scene.terrain_draw_ranges.is_empty());
    // The next legacy visible surface resumes the same index and main draw range.
    assert!(e.configure_spatial_terrain(&values, &[1, 0, 16777215, 1]));
    e.build_render_commands();
    assert_eq!(e.spatial_scene.terrain_draw_ranges.len(), 1);
    assert_eq!(e.spatial_scene.terrain_draw_ranges[0].first_vertex, 0);
    assert_eq!(e.spatial_scene.terrain_draw_ranges[0].vertex_count, 36);
}

#[test]
fn x_axis_ramps_share_height_mesh_picking_debug_and_bidirectional_body_motion() {
    for hidden in [false, true] {
        for descending in [false, true] {
            let mut e = Engine::new();
            e.use_data_scene();
            let a = actor(&mut e);
            let (lo, hi) = if descending { (32., 0.) } else { (0., 32.) };
            assert_eq!(e.spatial_ramp_axis_abi_version(), 1);
            assert!(e.configure_spatial_terrain(
                &[0., 0., 64., 48., 0., lo, hi, 1., 1., 1., 1.],
                &[1, 0, 16777215, 37 + if hidden { 16 } else { 0 }],
            ));
            assert!(e.configure_spatial_camera(&camera(false)));
            assert!(e.configure_spatial_debug(1));
            let h = if descending { 24. } else { 8. };
            assert!(e.set_physics_body_height_span(a.id, a.generation, 0, h, 8.));
            assert!(e.move_spatial_body(a.id, a.generation, 16., 0., 8., 8.));
            assert_eq!(e.world.transform(a).unwrap().x, 32.);
            assert_eq!(e.world.height_span(a).unwrap().elevation, 16.);
            assert!(e.move_spatial_body(a.id, a.generation, -16., 0., 8., 8.));
            assert_eq!(e.world.height_span(a).unwrap().elevation, h);
            e.build_render_commands();
            assert_eq!(e.spatial_scene.terrain[0].position, [0., lo, 0.]);
            assert_eq!(e.spatial_scene.terrain[1].position, [64., hi, 0.]);
            assert_eq!(e.spatial_scene.terrain[2].position, [64., hi, -48.]);
            assert_eq!(e.spatial_scene.terrain_draw_ranges.is_empty(), hidden);
            assert!(e.spatial_debug_len() > 0);
            let c = e.spatial_scene.frame_camera;
            let p = [32., 16., -24., 1.];
            let clip: [f32; 4] = std::array::from_fn(|r| (0..4).map(|k| c[k * 4 + r] * p[k]).sum());
            let hit = e.pick_spatial_surface(
                clip[0] / clip[3],
                clip[1] / clip[3],
                &c,
                e.spatial_terrain_revision(),
            );
            assert_eq!(hit.len(), 10);
            assert!((hit[4] - 16.).abs() < 0.01);
            let revision = e.spatial_terrain_revision();
            for flags in [33, 69, 101] {
                // X on flat, unknown bit, unknown + X.
                assert!(!e.configure_spatial_terrain(
                    &[0., 0., 64., 48., 0., 0., 0., 1., 1., 1., 1.],
                    &[1, 0, 16777215, flags]
                ));
                assert_eq!(e.spatial_terrain_revision(), revision);
            }
        }
    }
}

#[test]
fn rotated_ramp_negative_edge_keeps_support_before_crossing_to_upper_floor() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = actor(&mut e);
    assert!(e.configure_spatial_terrain(
        &[
            40., 12., 40., 40., 16., 56., 16., 1., 1., 1., 1., -60., -48., 100., 160., 16., 16.,
            16., 1., 1., 1., 1., -40., -28., 80., 120., 46., 56., 56., 1., 1., 1., 1.,
        ],
        &[1, 0, 16777215, 53, 2, 0, 16777215, 17, 3, 1, 16777215, 25],
    ));
    assert!(e.spatial_scene.configure_connections(&[1, 3]));
    assert!(e.set_physics_body_position(a.id, a.generation, 50., 32.));
    assert!(e.set_physics_body_height_span(a.id, a.generation, 0, 46., 10.));
    assert!(e.move_spatial_body(a.id, a.generation, -10., 0., 10., 10.));
    assert_eq!(e.world.transform(a).unwrap().x, 40.);
    assert_eq!(e.world.height_span(a).unwrap().elevation, 56.);
    assert_eq!(e.world.height_span(a).unwrap().floor.0, 0);
    assert!(e.move_spatial_body(a.id, a.generation, -10., 0., 10., 10.));
    assert_eq!(e.world.transform(a).unwrap().x, 30.);
    assert_eq!(e.world.height_span(a).unwrap().floor.0, 1);
    assert_eq!(e.world.height_span(a).unwrap().elevation, 56.);
    assert!(e.move_spatial_body(a.id, a.generation, 20., 0., 10., 10.));
    assert_eq!(e.world.height_span(a).unwrap().floor.0, 0);
    assert_eq!(e.world.height_span(a).unwrap().elevation, 46.);
}

#[test]
fn spatial_f32_collapsed_surface_bounds_reject_without_replacing_terrain() {
    let mut e = Engine::new();
    e.use_data_scene();
    assert!(terrain(&mut e));
    let revision = e.spatial_terrain_revision();
    for bounds in [[16777216., 0., 1., 32.], [0., 16777216., 32., 1.]] {
        let mut values = bounds.to_vec();
        values.extend([0., 0., 0., 1., 1., 1., 1.]);
        assert!(!e.configure_spatial_terrain(&values, &[1, 0, 16777215, 1]));
        assert_eq!(e.spatial_terrain_revision(), revision);
        assert_eq!(e.spatial_scene.terrain.len(), 108);
    }
}

#[test]
fn static_model_batch_limits_are_bounded_and_rejections_preserve_previous_bindings() {
    let mut e = Engine::new();
    e.use_data_scene();
    let mut metadata = Vec::new();
    let mut styles = Vec::new();
    for i in 0..1025 {
        let entity = sprite(&mut e, 71, (i % 32) as f32, (i / 32) as f32, 0);
        metadata.extend([entity.id, entity.generation, 1, 3, 4, 8]);
        styles.extend([0., 0., 1., -1., 0., -1., 1., 2., 1.]);
    }
    let configure = |e: &mut Engine, m: &[u32], s: &[f32]| {
        e.configure_spatial_scene_models(
            &camera(false),
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            m,
            s,
        )
    };
    assert_eq!(e.spatial_model_batch_abi_version(), 1);
    assert!(configure(
        &mut e,
        &metadata[..1024 * 6],
        &styles[..1024 * 9]
    ));
    // Reserve the bulk output during cold activation, before the frame loop.
    assert!(e.spatial_scene.models.draws.capacity() >= 1024);
    let output = e.spatial_scene.models.draws.as_ptr();
    let capacity = e.spatial_scene.models.draws.capacity();
    e.build_render_commands();
    assert_eq!(e.spatial_scene.models.draws.as_ptr(), output);
    assert_eq!(e.spatial_scene.models.draws.capacity(), capacity);
    assert_eq!(e.spatial_model_len(), 1024);
    assert!(!configure(&mut e, &metadata, &styles));
    let mut too_many_primitives = metadata[..1024 * 6].to_vec();
    too_many_primitives[4] = 5;
    assert!(!configure(
        &mut e,
        &too_many_primitives,
        &styles[..1024 * 9]
    ));
    let mut too_many_triangles = metadata[..1024 * 6].to_vec();
    for row in too_many_triangles.chunks_exact_mut(6) {
        row[5] = 257;
    }
    assert!(!configure(&mut e, &too_many_triangles, &styles[..1024 * 9]));
    e.build_render_commands();
    assert_eq!(e.spatial_model_len(), 1024);
}

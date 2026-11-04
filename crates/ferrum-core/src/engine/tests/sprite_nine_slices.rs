use super::data_scene_visuals::sprite;
use super::*;
use crate::render_command::{SpriteRenderCommand, SPRITE_PROJECT_GROUND};

const SLICE: [f32; 9] = [16., 12., 2., 4., 3., 1., 1., 0., 0.];
fn scene() -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(800., 600.);
    e.camera.x = 400.;
    e.camera.y = 300.;
    e
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 0.0001, "{a} != {b}");
}
fn commands(e: &mut Engine) -> Vec<SpriteRenderCommand> {
    e.build_render_commands();
    e.frame_buffers.render_commands.clone()
}

#[test]
fn nine_slice_preserves_atlas_borders_and_stretches_only_edges_and_center() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    let s = e.world.sprite_mut_at_index(a.id as usize).unwrap();
    s.u0 = 0.25;
    s.u1 = 0.75;
    s.v0 = 0.5;
    s.v1 = 1.;
    let original = commands(&mut e)[0];
    assert!(e.configure_sprite_nine_slices(&[a.id, a.generation], &SLICE));
    let c = commands(&mut e);
    assert_eq!(c.len(), 9);
    for y in 0..3 {
        for x in 0..3 {
            let tile = c[y * 3 + x];
            near(tile.x, original.x + [0., 2., 28.][x]);
            near(tile.y, original.y + [0., 3., 63.][y]);
            near(tile.width, [2., 26., 4.][x]);
            near(tile.height, [3., 60., 1.][y]);
            near(tile.u0, 0.25 + 0.5 * [0., 2. / 16., 12. / 16.][x]);
            near(tile.u1, 0.25 + 0.5 * [2. / 16., 12. / 16., 1.][x]);
            near(tile.v0, 0.5 + 0.5 * [0., 3. / 12., 11. / 12.][y]);
            near(tile.v1, 0.5 + 0.5 * [3. / 12., 11. / 12., 1.][y]);
        }
    }
    assert!(e.configure_sprite_nine_slices(&[a.id, a.generation], &[0.; 9]));
    assert_eq!(commands(&mut e), vec![original]);
    assert_eq!(core::mem::size_of::<SpriteRenderCommand>(), 60);
}

#[test]
fn nine_slice_rotation_origin_ground_projection_tint_and_normal_alignment() {
    for rotation in [0., 0.6, std::f32::consts::FRAC_PI_2] {
        for ground in [false, true] {
            let mut e = scene();
            e.camera.ground_y_scale = 0.5;
            let a = sprite(&mut e, 71, 300., 300., 10);
            let b = sprite(&mut e, 72, 400., 300., -10);
            let s = e.world.sprite_mut_at_index(a.id as usize).unwrap();
            s.origin_x = 0.;
            s.origin_y = 1.;
            s.rotation_radians = rotation;
            s.project_ground = ground;
            s.r = 0.4;
            s.g = 0.2;
            s.b = 0.8;
            s.a = 0.7;
            let full = commands(&mut e)
                .into_iter()
                .find(|c| c.texture_id == 71.)
                .unwrap();
            assert!(e.configure_sprite_normal_materials(&[
                a.id,
                a.generation,
                91,
                0,
                b.id,
                b.generation,
                92,
                0
            ]));
            assert!(e.configure_sprite_nine_slices(&[a.id, a.generation], &SLICE));
            let c = commands(&mut e);
            assert_eq!(c.len(), 10);
            assert_eq!(c[0].texture_id, 72.);
            assert_eq!(
                e.frame_buffers.sprite_normal_materials[0].normal_texture,
                92
            );
            for (n, tile) in c[1..].iter().enumerate() {
                let x = n % 3;
                let y = n / 3;
                let dx = [1., 15., 30.][x] - 16.;
                let dy = [1.5, 33., 63.5][y] - 32.;
                let (sin, cos) = rotation.sin_cos();
                near(
                    tile.x + tile.width * 0.5,
                    full.x + 16. + cos * dx - sin * dy,
                );
                near(
                    tile.y + tile.height * 0.5,
                    full.y + 32. + (sin * dx + cos * dy) * if ground { 0.5 } else { 1. },
                );
                assert_eq!((tile.r, tile.g, tile.b, tile.a), (0.4, 0.2, 0.8, 0.7));
                assert_eq!(
                    tile.effect_flags,
                    if ground { SPRITE_PROJECT_GROUND } else { 0. }
                );
                assert_eq!(tile.rotation_radians, rotation);
                assert_eq!(
                    e.frame_buffers.sprite_normal_materials[n + 1].normal_texture,
                    91
                );
            }
        }
    }
}

#[test]
fn nine_slice_flips_asymmetric_borders_and_compresses_small_targets_without_overlap() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    let mut v = SLICE;
    v[6] = 2.;
    v[7] = 1.;
    v[8] = 1.;
    assert!(e.configure_sprite_nine_slices(&[a.id, a.generation], &v));
    let c = commands(&mut e);
    assert_eq!(c.len(), 9);
    assert_eq!(
        (c[0].width, c[0].height, c[8].width, c[8].height),
        (8., 2., 4., 6.)
    );
    assert_eq!(
        (c[0].u0, c[0].u1, c[0].v0, c[0].v1),
        (1., 0.75, 1., 11. / 12.)
    );
    let s = e.world.sprite_mut_at_index(a.id as usize).unwrap();
    s.width = 3.;
    s.height = 2.;
    let c = commands(&mut e);
    assert_eq!(c.len(), 4);
    near(c.iter().map(|c| c.width * c.height).sum(), 6.);
    near(c[0].width, 2.);
    near(c[0].height, 0.5);
    near(c[0].x + c[0].width, c[1].x);
    near(c[0].y + c[0].height, c[2].y);
    let mut no_borders = SLICE;
    no_borders[2..6].fill(0.);
    assert!(e.configure_sprite_nine_slices(&[a.id, a.generation], &no_borders));
    assert_eq!(commands(&mut e).len(), 1);
}

#[test]
fn nine_slice_batch_validation_is_atomic_and_excludes_incompatible_render_paths() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    let b = sprite(&mut e, 72, 400., 300., 0);
    assert!(e.configure_sprite_nine_slices(&[a.id, a.generation], &SLICE));
    let before = e.world.sprite_nine_slices[a.id as usize];
    for (index, value) in [
        (0, 0.),
        (0, 16385.),
        (2, 0.5),
        (2, -1.),
        (2, 12.),
        (4, 11.),
        (6, 0.),
        (6, 65537.),
        (7, 2.),
        (8, f32::NAN),
    ] {
        let mut invalid = SLICE;
        invalid[index] = value;
        let values: Vec<_> = [0.; 9].into_iter().chain(invalid).collect();
        assert!(!e.configure_sprite_nine_slices(&[a.id, a.generation, b.id, b.generation], &values));
        assert_eq!(e.world.sprite_nine_slices[a.id as usize], before);
        assert_eq!(e.world.sprite_nine_slices[b.id as usize], None);
    }
    for handles in [
        vec![a.id],
        vec![a.id, a.generation + 1],
        vec![a.id, a.generation, a.id, a.generation],
    ] {
        assert!(!e.configure_sprite_nine_slices(&handles, &SLICE));
    }
    assert!(!e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    assert!(!e.configure_data_scene_ground_shadow(a.id, a.generation, 3, 32., 64., 0.8, false, 0));
    assert!(e.configure_spatial_billboards(&[b.id, b.generation], &[1., 0.5, 0.]));
    assert!(!e.configure_sprite_nine_slices(&[b.id, b.generation], &SLICE));
    assert!(e.configure_spatial_billboards(&[], &[]));
    assert!(e.configure_data_scene_ground_shadow(b.id, b.generation, 3, 32., 64., 0.8, false, 0));
    assert!(!e.configure_sprite_nine_slices(&[b.id, b.generation], &SLICE));
}

#[test]
fn nine_slice_survives_snapshot_actor_clone_and_clears_on_entity_reuse() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    assert!(e.configure_sprite_nine_slices(&[a.id, a.generation], &SLICE));
    let snapshot = e.world.snapshot();
    let prototype = e.world.actor_prototype(a).unwrap();
    let clone = e
        .world
        .spawn_actor_prototype(&prototype, Transform2D { x: 400., y: 300. }, None, 100)
        .unwrap();
    assert_eq!(
        e.world.sprite_nine_slices[clone.id as usize],
        e.world.sprite_nine_slices[a.id as usize]
    );
    e.world.despawn(a);
    let reused = e.world.spawn_entity();
    assert_eq!(reused.id, a.id);
    assert_eq!(e.world.sprite_nine_slices[reused.id as usize], None);
    e.world.restore_snapshot(&snapshot);
    assert!(e.world.sprite_nine_slices[a.id as usize].is_some());
}

#[test]
fn nine_slice_composes_playback_uv_flip_with_authored_flip() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    assert!(e.configure_sprite_nine_slices(&[a.id, a.generation], &SLICE));
    let normal = commands(&mut e);
    let s = e.world.sprite_mut_at_index(a.id as usize).unwrap();
    s.u0 = 1.;
    s.u1 = 0.;
    s.v0 = 1.;
    s.v1 = 0.;
    let flipped = commands(&mut e);
    assert_eq!((flipped[0].width, flipped[0].height), (4., 1.));
    assert_eq!((flipped[0].u0, flipped[0].u1), (1., 0.75));
    let mut both = SLICE;
    both[7] = 1.;
    both[8] = 1.;
    assert!(e.configure_sprite_nine_slices(&[a.id, a.generation], &both));
    assert_eq!(commands(&mut e), normal);
}

#[test]
fn nine_slice_samples_each_native_animation_frame_and_playback_flip() {
    let mut e = scene();
    let a = sprite(&mut e, 71, 300., 300., 0);
    assert!(e.configure_sprite_nine_slices(&[a.id, a.generation], &SLICE));
    assert!(e.configure_data_scene_sprite_clips(
        a.id,
        a.generation,
        &[7., 2., 10., 1.],
        &[0., 0., 0.5, 1., 0.5, 0., 1., 1.],
        7
    ));
    for frame in 0..2 {
        assert!(e.update_data_scene_sprite_animations(&[
            a.id,
            a.generation,
            2 | 4 | 8,
            0,
            frame,
            1,
            1,
            0
        ]));
        let c = commands(&mut e);
        assert_eq!(c.len(), 9);
        assert_eq!((c[0].width, c[0].height), (4., 1.));
        near(c[0].u0, (frame + 1) as f32 * 0.5);
        near(c[0].u1, frame as f32 * 0.5 + 0.375);
        near(c[8].u1, frame as f32 * 0.5);
        near(c[0].v0, 1.);
    }
}

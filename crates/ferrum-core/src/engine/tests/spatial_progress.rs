use super::data_scene_visuals::sprite;
use super::*;

fn scene(e: &mut Engine) -> (Entity, Entity) {
    e.use_data_scene();
    let a = sprite(e, 71, 16., 16., 0);
    let b = sprite(e, 72, 16., 32., 0);
    for actor in [a, b] {
        e.world.set_aabb_collider(
            actor,
            AabbCollider::new(2., 2., false, CollisionLayer::Player),
        );
        assert!(e.configure_data_scene_body(actor.id, actor.generation, 1, true, 0, 0., 8.));
    }
    assert!(e.configure_data_scene_gameplay(true, a.id, a.generation, 0));
    assert!(e.configure_data_scene_sprite_clips(
        a.id,
        a.generation,
        &[0., 2., 4., 1.],
        &[0., 0., 0.5, 1., 0.5, 0., 1., 1.],
        0
    ));
    assert!(e.configure_spatial_scene(
        &[0., 48., 120., 120., 48., 16., -32., 240., 0.1, 1000., 800., 480.],
        &[
            0., 0., 32., 64., 0., 0., 0., 1., 1., 1., 1., 32., 0., 32., 64., 0., 16., 16., 1., 1.,
            1., 1., 64., 0., 32., 64., 0., 32., 32., 1., 1., 1., 1.
        ],
        &[1, 0, 16777215, 1, 2, 0, 16777215, 3, 3, 0, 16777215, 3],
        &[a.id, a.generation, b.id, b.generation],
        &[1., 0.5, 0., 1., 0.5, 0.],
        &[a.id, a.generation],
        &[16., 16., 32.],
    ));
    (a, b)
}
fn handles(a: Entity, b: Entity) -> [u32; 4] {
    [a.id, a.generation, b.id, b.generation]
}

#[test]
fn spatial_source_revision_covers_native_binding_and_actor_configuration_but_not_camera() {
    let mut e = Engine::new();
    let (a, b) = scene(&mut e);
    let revision = e.spatial_terrain_revision();
    assert!(e.configure_spatial_camera(&[
        0., 48., 160., 160., 48., 16., -32., 360., 0.1, 1000., 800., 480.
    ]));
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert!(!e.configure_spatial_billboards(&handles(a, b), &[f32::NAN; 6]));
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert!(e.configure_spatial_billboards(&handles(a, b), &[2., 0.5, 7., 1., 0.5, 0.]));
    assert_eq!(e.spatial_terrain_revision(), revision + 1);
    assert!(e.configure_spatial_actor(a.id, a.generation, 24., 16., 32.));
    assert_eq!(e.spatial_terrain_revision(), revision + 2);
}

#[test]
fn spatial_progress_restores_native_pose_camera_and_animation_without_copying_source_viewport() {
    let mut source = Engine::new();
    let (a, b) = scene(&mut source);
    assert!(source.move_spatial_body(a.id, a.generation, 64., 0., 16., 32.));
    assert!(source.set_physics_body_height_span(a.id, a.generation, 0, 32., 10.));
    assert!(source.configure_spatial_camera(&[
        1., 48., 160., 160., 48., 32., -32., 0.9, 0.1, 2000., 800., 480.
    ]));
    source.world.sprite_playbacks[a.id as usize]
        .as_mut()
        .unwrap()
        .elapsed = 0.125;
    let h = handles(a, b);
    let epoch = source.data_scene_epoch();
    let states = source.capture_data_scene_progress(epoch, &h);
    let animation = source.capture_data_scene_animation_progress(epoch, &h);
    let saved = source.capture_data_scene_spatial_progress(epoch, &h);
    assert_eq!(&saved[13..21], &[1., 80., 16., 1., 0., 32., 10., 3.]);
    let mut dest = Engine::new();
    dest.use_data_scene();
    sprite(&mut dest, 90, 0., 0., 0);
    let (fresh_a, fresh_b) = scene(&mut dest);
    assert_ne!(fresh_a, a);
    dest.set_viewport_size(390., 844.);
    assert!(dest.restore_data_scene_progress_with_spatial(
        dest.data_scene_epoch(),
        &handles(fresh_a, fresh_b),
        &states,
        &animation,
        &saved
    ));
    assert_eq!(dest.world.transform(fresh_a).unwrap().x, 80.);
    assert_eq!(dest.world.height_span(fresh_a).unwrap().height, 10.);
    assert_eq!(dest.world.height_span(fresh_a).unwrap().elevation, 32.);
    assert_eq!(
        dest.world.sprite_playbacks[fresh_a.id as usize]
            .as_ref()
            .unwrap()
            .elapsed,
        0.125
    );
    let camera = dest.spatial_scene.camera.unwrap();
    assert_eq!(camera.parameters[0], 1.);
    assert_eq!(&camera.parameters[10..12], &[390., 844.]);
    assert_eq!(
        &camera.parameters[..10],
        &saved[1..11].iter().map(|v| *v as f32).collect::<Vec<_>>()
    );
    assert!(!dest.spatial_scene.frame_active);
    dest.build_render_commands();
    assert!(dest.spatial_scene.frame_active);
    assert_eq!(dest.spatial_scene.billboards.len(), 12);
    assert!(dest.move_spatial_body(fresh_a.id, fresh_a.generation, -16., 0., 16., 32.));
}

#[test]
fn malformed_spatial_progress_never_partially_changes_pose_camera_flags_or_playback() {
    let mut e = Engine::new();
    let (a, b) = scene(&mut e);
    let h = handles(a, b);
    let epoch = e.data_scene_epoch();
    let mut states = e.capture_data_scene_progress(epoch, &h);
    states[0] &= !8; // Valid requested body disable must also remain unapplied on failure.
    let animations = e.capture_data_scene_animation_progress(epoch, &h);
    let original = e.capture_data_scene_spatial_progress(epoch, &h);
    let mut values = original.clone();
    values[8] = 360.; // camera height
    values[14] = 80.;
    values[18] = 32.;
    values[20] = 3.; // Valid first pose
    for bad in [f64::NAN, f64::INFINITY, f64::from(f32::MAX) * 2.] {
        values[22] = bad; // invalid second X
        assert!(!e.restore_data_scene_progress_with_spatial(
            epoch,
            &h,
            &states,
            &animations,
            &values
        ));
        assert_eq!(e.capture_data_scene_spatial_progress(epoch, &h), original);
        assert!(e.world.rigid_body(a).unwrap().enabled);
    }
    values[22] = 16.;
    let mut bad_animation = animations.clone();
    bad_animation[1] = 999.;
    assert!(!e.restore_data_scene_progress_with_spatial(
        epoch,
        &h,
        &states,
        &bad_animation,
        &values
    ));
    assert_eq!(e.capture_data_scene_spatial_progress(epoch, &h), original);
    assert!(!e.restore_data_scene_progress_with_spatial(
        epoch + 1,
        &h,
        &states,
        &animations,
        &values
    ));
    assert_eq!(e.world.transform(a).unwrap().x, 16.);
}

#[test]
fn spatial_preflight_checks_surface_links_and_camera_without_mutating_a_live_engine() {
    let mut e = Engine::new();
    let (a, b) = scene(&mut e);
    let h = handles(a, b);
    let original = e.capture_data_scene_spatial_progress(e.data_scene_epoch(), &h);
    let terrain = [0., 0., 32., 64., 0., 0., 0., 1., 1., 1., 1.];
    let metadata = [1, 0, 16777215, 1];
    assert!(e.preflight_data_scene_spatial_progress(&terrain, &metadata, &original));
    let mut invalid = original.clone();
    invalid[20] = 2.; // no authored surface 2 in supplied terrain
    assert!(!e.preflight_data_scene_spatial_progress(&terrain, &metadata, &invalid));
    invalid[20] = 1.;
    invalid[18] = 16.; // wrong height on surface 1
    assert!(!e.preflight_data_scene_spatial_progress(&terrain, &metadata, &invalid));
    invalid = original.clone();
    invalid[9] = 0.; // near
    assert!(!e.preflight_data_scene_spatial_progress(&terrain, &metadata, &invalid));
    assert_eq!(
        e.capture_data_scene_spatial_progress(e.data_scene_epoch(), &h),
        original
    );
}

#[test]
fn removed_billboards_and_explicitly_disabled_spatial_mode_restore_cleanly() {
    let mut source = Engine::new();
    let (a, b) = scene(&mut source);
    let h = handles(a, b);
    let epoch = source.data_scene_epoch();
    source.despawn_physics_entity(b.id, b.generation);
    let states = source.capture_data_scene_progress(epoch, &h);
    let saved = source.capture_data_scene_spatial_progress(epoch, &h);
    assert_eq!(&saved[21..29], &[0.; 8]);
    let mut dest = Engine::new();
    let (fresh_a, fresh_b) = scene(&mut dest);
    assert!(dest.restore_data_scene_progress_with_spatial(
        dest.data_scene_epoch(),
        &handles(fresh_a, fresh_b),
        &states,
        &[],
        &saved
    ));
    assert!(!dest.world.is_current_entity(fresh_b));
    source.clear_spatial_scene();
    let disabled = source.capture_data_scene_spatial_progress(epoch, &h);
    assert!(disabled.iter().all(|v| *v == 0.));
    let (fresh_a, fresh_b) = scene(&mut dest);
    assert!(dest.restore_data_scene_progress_with_spatial(
        dest.data_scene_epoch(),
        &handles(fresh_a, fresh_b),
        &states,
        &[],
        &disabled
    ));
    assert!(dest.spatial_scene.camera.is_none());
    assert!(dest.spatial_scene.bindings.is_empty());
    assert!(dest.world.is_current_entity(fresh_a));
}

#[test]
fn moving_platform_checkpoint_restores_surface_phase_and_nonvisual_rider_atomically() {
    let mut source = Engine::new();
    let (a, b) = scene(&mut source);
    assert!(source.configure_spatial_moving_platforms(&[2., 1., 0., 0., 8., 1., 0., 0.]));
    source.spatial_scene.bindings.remove(&(b.id, b.generation));
    source
        .spatial_scene
        .step_moving_platforms(&mut source.world, 0.5);
    let hs = handles(a, b);
    let epoch = source.data_scene_epoch();
    let states = source.capture_data_scene_progress(epoch, &hs);
    let mut saved = source.capture_data_scene_spatial_progress(epoch, &hs);
    assert_eq!(saved[21], 1., "nonvisual kinematic rider must have a pose");
    saved.extend(source.capture_spatial_moving_platforms());
    let mut dest = Engine::new();
    let (c, d) = scene(&mut dest);
    assert!(dest.configure_spatial_moving_platforms(&[2., 1., 0., 0., 8., 1., 0., 0.]));
    dest.spatial_scene.bindings.remove(&(d.id, d.generation));
    assert!(dest.restore_data_scene_progress_with_spatial(
        dest.data_scene_epoch(),
        &handles(c, d),
        &states,
        &[],
        &saved
    ));
    assert_eq!(dest.world.height_span(d).unwrap().elevation, 4.);
    assert_eq!(dest.capture_spatial_moving_platforms()[6], 0.5);
    let before = dest.world.snapshot();
    let platform_before = dest.capture_spatial_moving_platforms();
    let tail = saved.len() - 8;
    saved[tail + 1] = 999.;
    assert!(!dest.restore_data_scene_progress_with_spatial(
        dest.data_scene_epoch(),
        &handles(c, d),
        &states,
        &[],
        &saved
    ));
    assert_eq!(dest.world.snapshot(), before);
    assert_eq!(dest.capture_spatial_moving_platforms(), platform_before);
}

#[test]
fn moving_platform_checkpoint_preserves_half_open_support_edges() {
    for axis in 0..2 {
        // The surface owning the shared edge is deliberately earlier in layer order.
        let mut terrain = vec![
            0., 0., 32., 32., 0., 0., 0., 1., 1., 1., 1., 0., 0., 32., 32., 0., 0., 0., 1., 1., 1.,
            1., 128., 128., 32., 32., 0., 0., 0., 1., 1., 1., 1.,
        ];
        terrain[axis] = 32.;
        let metadata = [1, 0, 16777215, 1, 2, 0, 16777215, 1, 3, 0, 16777215, 1];
        let platform = [2., 3., 0., 0., 8., 1., 0., 0.];
        let mut source = Engine::new();
        let (a, b) = scene(&mut source);
        assert!(source.configure_spatial_terrain(&terrain, &metadata));
        assert!(source.configure_spatial_moving_platforms(&platform));
        source.world.set_transform(
            a,
            Transform2D {
                x: if axis == 0 { 32. } else { 16. },
                y: if axis == 1 { 32. } else { 16. },
            },
        );
        source
            .world
            .set_transform(b, Transform2D { x: 16., y: 16. });
        source
            .spatial_scene
            .step_moving_platforms(&mut source.world, 0.5);
        let epoch = source.data_scene_epoch();
        let states = source.capture_data_scene_progress(epoch, &handles(a, b));
        let mut saved = source.capture_data_scene_spatial_progress(epoch, &handles(a, b));
        assert_eq!(saved[20], 1., "the lower edge belongs to the first surface");
        saved.extend(source.capture_spatial_moving_platforms());

        let mut dest = Engine::new();
        let (c, d) = scene(&mut dest);
        assert!(dest.configure_spatial_terrain(&terrain, &metadata));
        assert!(dest.configure_spatial_moving_platforms(&platform));
        assert!(dest.preflight_data_scene_spatial_progress(&terrain, &metadata, &saved));
        assert!(dest.restore_data_scene_progress_with_spatial(
            dest.data_scene_epoch(),
            &handles(c, d),
            &states,
            &[],
            &saved,
        ));
        assert_eq!(dest.world.transform(c), source.world.transform(a));
        assert_eq!(dest.capture_spatial_moving_platforms()[6], 0.5);

        let before = dest.world.snapshot();
        let platform_before = dest.capture_spatial_moving_platforms();
        saved[20] = 2.;
        assert!(!dest.preflight_data_scene_spatial_progress(&terrain, &metadata, &saved));
        assert!(!dest.restore_data_scene_progress_with_spatial(
            dest.data_scene_epoch(),
            &handles(c, d),
            &states,
            &[],
            &saved,
        ));
        assert_eq!(dest.world.snapshot(), before);
        assert_eq!(dest.capture_spatial_moving_platforms(), platform_before);
    }
}

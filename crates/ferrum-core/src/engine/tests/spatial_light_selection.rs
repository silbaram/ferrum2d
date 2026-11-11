use super::*;

#[test]
fn native_compound_light_history_restore_validates_before_pose_source_or_history_mutation() {
    let mut e = setup();
    let entity = super::data_scene_visuals::sprite(&mut e, 71, 30., 40., 0);
    assert!(e.configure_spatial_billboards(&[entity.id, entity.generation], &[1., 0.5, 0.]));
    e.update(0.);
    pan(&mut e, 20.);
    e.update(0.05);
    let epoch = e.data_scene_epoch();
    let handles = [entity.id, entity.generation];
    let states = e.capture_data_scene_progress(epoch, &handles);
    let poses = e.capture_data_scene_spatial_progress(epoch, &handles);
    let environment = e.capture_spatial_environment();
    let selection = e.capture_spatial_light_selection_state();
    assert!(e.preflight_spatial_light_selection_state(&environment, &selection));
    e.world
        .set_transform(entity, Transform2D { x: 300., y: 400. });
    pan(&mut e, -20.);
    e.update(0.1);
    let before = e.capture_spatial_light_selection_state();
    let before_pose = e.capture_data_scene_spatial_progress(epoch, &handles);
    let mut bad = selection.clone();
    bad[9] = f64::NAN;
    assert!(!e.preflight_spatial_light_selection_state(&environment, &bad));
    assert!(!e.restore_data_scene_progress_with_spatial_light_selection(
        epoch,
        &handles,
        &states,
        &[],
        &poses,
        &environment,
        &[0.],
        true,
        &[],
        &bad
    ));
    assert_eq!(e.capture_spatial_light_selection_state(), before);
    assert_eq!(
        e.capture_data_scene_spatial_progress(epoch, &handles),
        before_pose
    );
    let mut invalid_pose = poses.clone();
    invalid_pose[1] = f64::NAN;
    assert!(!e.restore_data_scene_progress_with_spatial_light_selection(
        epoch,
        &handles,
        &states,
        &[],
        &invalid_pose,
        &environment,
        &[0.],
        true,
        &[],
        &selection
    ));
    assert_eq!(e.capture_spatial_light_selection_state(), before);
    assert_eq!(
        e.capture_data_scene_spatial_progress(epoch, &handles),
        before_pose
    );
    assert!(e.restore_data_scene_progress_with_spatial_light_selection(
        epoch,
        &handles,
        &states,
        &[],
        &poses,
        &environment,
        &[0.],
        true,
        &[],
        &selection
    ));
    assert_eq!(e.capture_spatial_light_selection_state(), selection);
    assert_eq!(
        e.capture_data_scene_spatial_progress(epoch, &handles),
        poses
    );
    e.build_render_commands();
    assert_eq!(e.capture_spatial_light_selection_state(), selection);
    let cleared = vec![0.; 21];
    assert!(!e.restore_data_scene_progress_with_spatial_light_selection(
        epoch,
        &handles,
        &states,
        &[],
        &cleared,
        &[],
        &[0.],
        false,
        &[],
        &selection
    ));
    assert_eq!(e.capture_spatial_light_selection_state(), selection);
    assert!(e.restore_data_scene_progress_with_spatial_light_selection(
        epoch,
        &handles,
        &states,
        &[],
        &cleared,
        &[],
        &[0.],
        false,
        &[],
        &[]
    ));
    assert!(e.spatial_scene.camera.is_none());
    assert!(e.capture_spatial_environment().is_empty());
    assert!(e.capture_spatial_light_selection_state().is_empty());
}
pub(super) fn values() -> Vec<f32> {
    let mut v = vec![0.; 580];
    v[0] = 1.;
    v[1] = 1.;
    v[2] = -1.;
    v[5..8].fill(0.15);
    v[60..76].copy_from_slice(&[
        100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
    ]);
    v[136] = 1.;
    v[137] = 2.;
    v[138] = -1.;
    let lights = [
        [-20., 64., 0., 100., 1., 0., 0., 1.],
        [20., 64., 0., 100., 0., 1., 0., 1.],
    ];
    for (i, light) in lights.iter().enumerate() {
        v[192 + i * 20..200 + i * 20].copy_from_slice(light);
        v[549 + i] = 65535.;
    }
    v[12..20].copy_from_slice(&lights[0]);
    v[545] = 65535.;
    v[576..580].copy_from_slice(&[1., 0.1, 0.2, 0.]);
    v
}

#[test]
fn equivalent_source_or_effect_edits_preserve_fades_but_selection_inputs_reset_them() {
    let mut e = setup();
    e.update(0.);
    pan(&mut e, 20.);
    e.update(0.05);
    let saved = e.capture_spatial_light_selection_state();
    let mut source = e.capture_spatial_environment();
    assert!(e.configure_spatial_environment(&source));
    assert_eq!(e.capture_spatial_light_selection_state(), saved);
    source[64] = 1.;
    assert!(e.configure_spatial_environment(&source));
    assert_eq!(e.capture_spatial_light_selection_state(), saved);
    source[199] = 0.8;
    assert!(e.configure_spatial_environment(&source));
    assert_eq!(e.capture_spatial_light_selection_state()[2], 0.);
}

#[test]
fn changing_two_coordinate_signs_rejects_old_history_before_compound_mutation() {
    let mut e = setup();
    let mut source = e.capture_spatial_environment();
    source[192] = 10.;
    source[193] = 20.;
    assert!(e.configure_spatial_environment(&source));
    e.update(0.);
    let history = e.capture_spatial_light_selection_state();
    let epoch = e.data_scene_epoch();
    let spatial = e.capture_data_scene_spatial_progress(epoch, &[]);
    source[192] = -10.;
    source[193] = -20.;
    assert!(!e.preflight_spatial_light_selection_state(&source, &history));
    assert!(!e.restore_data_scene_progress_with_spatial_light_selection(
        epoch,
        &[],
        &[],
        &[],
        &spatial,
        &source,
        &[],
        true,
        &[],
        &history
    ));
    assert_eq!(e.capture_spatial_light_selection_state(), history);
    assert_eq!(e.capture_spatial_environment()[192..194], [10., 20.]);
    assert!(e.configure_spatial_environment(&source));
    assert_eq!(e.capture_spatial_light_selection_state()[2], 0.);
    assert!(!e.restore_spatial_light_selection_state(&history));
}
fn setup() -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(400., 300.);
    assert!(e.configure_spatial_camera(&[
        0., -20., 164., 200., -20., 64., 0., 200., 0.1, 1000., 400., 300.
    ]));
    assert!(e.configure_spatial_environment(&values()));
    e
}
fn pan(e: &mut Engine, x: f32) {
    let mut p = e.spatial_scene.camera.unwrap().parameters;
    p[1] = x;
    p[4] = x;
    assert!(e.configure_spatial_camera(&p));
}

#[test]
fn temporal_selection_excludes_zero_energy_masked_and_outside_lights_without_changing_legacy_ranking(
) {
    for case in 0..4 {
        let mut source = values();
        source[199] = 64.;
        match case {
            0 => source[196..199].fill(0.),
            1 => source[549] = 65280., // Shadow channels alone do not create direct light.
            2 => {
                source[192] = 700.;
                source[195] = 500.;
            }
            _ => source[196..199].fill(0.001),
        }
        let mut e = setup();
        assert!(e.configure_spatial_environment(&source));
        e.update(0.);
        let frame = &e.spatial_scene.environment.frame_values;
        assert_eq!(frame[1], 1., "case {case}");
        assert_eq!(&frame[12..15], &source[212..215], "case {case}");
        assert_eq!(e.capture_spatial_environment(), source);
        if case < 3 {
            assert_eq!(
                e.spatial_scene.environment.light_selection_diagnostics()[0].reason,
                7
            );
        }
        // Disabled v8 and exact v7 preserve the previous intensity/distance policy.
        source[576] = 0.;
        for size in [580, 576] {
            assert!(e.configure_spatial_environment(&source[..size]));
            e.update(0.);
            assert_eq!(
                &e.spatial_scene.environment.frame_values[12..15],
                &source[192..195],
                "legacy case {case}/{size}"
            );
        }
    }
}

#[test]
fn temporal_light_bounds_keep_frustum_edges_near_plane_crossings_and_large_ranges() {
    for (projection, span, position, radius, expected) in [
        (0., 10., [7.5, 0., 0.], 1., 1.),
        (0., 10., [8., 0., 0.], 1., 0.),
        (0., 10., [7.6666665, 0., 0.], 1., 1.),
        (1., std::f32::consts::FRAC_PI_2, [0., 0., 10.], 2., 1.),
        (1., std::f32::consts::FRAC_PI_2, [0., 0., 13.], 1., 0.),
        (1., std::f32::consts::FRAC_PI_2, [1e6, 0., 0.], 1e6, 1.),
    ] {
        let mut e = setup();
        assert!(e.configure_spatial_camera(&[
            projection, 0., 0., 10., 0., 0., 0., span, 1., 20., 400., 300.
        ]));
        let mut source = values();
        source[192..195].copy_from_slice(&position);
        source[195] = radius;
        source[219] = 0.; // Only source0 can contribute.
        assert!(e.configure_spatial_environment(&source));
        e.update(0.);
        assert_eq!(
            e.spatial_scene.environment.frame_values[1], expected,
            "{projection}/{position:?}/{radius}"
        );
    }
}

#[test]
fn temporal_culling_preserves_explicit_shadow_owner_reservation_and_source_history() {
    let mut e = setup();
    let mut source = values();
    source[196..199].fill(0.);
    source[138] = 0.;
    source[139] = 128.;
    source[2] = 0.;
    source[3] = 128.;
    assert!(e.configure_spatial_environment(&source));
    e.update(0.);
    let frame = &e.spatial_scene.environment.frame_values;
    assert_eq!((frame[1], frame[2], frame[19]), (1., 0., 0.));
    let diagnostic = &e.spatial_scene.environment.light_selection_diagnostics()[0];
    assert_eq!(
        (diagnostic.slot, diagnostic.reason, diagnostic.flags & 1),
        (0, 7, 1)
    );
    let history = e.capture_spatial_light_selection_state();
    assert_eq!(history[7], 0.);
    assert!(e.restore_spatial_light_selection_state(&history));
    assert_eq!(e.capture_spatial_environment(), source);
}

#[test]
fn temporal_selection_uses_presented_pixel_art_frustum_before_rendering() {
    let mut e = setup();
    let mut source = values();
    source[0] = 17.;
    source[80..83].copy_from_slice(&[400., 200., 0.]);
    source[192] = 260.;
    source[199] = 64.;
    assert!(e.configure_spatial_environment(&source));
    e.update(0.);
    // Source0 is outside the base4:3 frustum but intersects the displayed2:1 view.
    assert_eq!(e.capture_spatial_light_selection_state()[7], 0.);
    assert_eq!(e.spatial_scene.environment.frame_values[12], 260.);
}

#[test]
fn native_v8_configuration_and_cold_history_are_owned_atomic_and_leave_v7_reserved_fields_intact() {
    let mut e = setup();
    assert_eq!(e.spatial_environment_abi_version(), 8);
    assert_eq!(e.spatial_light_selection_abi_version(), 1);
    assert_eq!(e.spatial_light_selection_diagnostic_size_bytes(), 24);
    let source = e.capture_spatial_environment();
    let before = e.capture_spatial_light_selection_state();
    e.build_render_commands();
    e.build_render_commands();
    assert_eq!(e.capture_spatial_light_selection_state(), before);
    assert_eq!(e.spatial_light_selection_diagnostics_len(), 2);
    for (at, bad) in [
        (576, 2.),
        (577, -0.1),
        (578, 6.),
        (579, -1.),
        (565, 1.),
        (579, f32::NAN),
    ] {
        let mut invalid = source.clone();
        invalid[at] = bad;
        assert!(!e.configure_spatial_environment(&invalid));
        assert_eq!(e.capture_spatial_environment(), source);
        assert_eq!(e.capture_spatial_light_selection_state(), before);
    }
    e.update(0.);
    pan(&mut e, 20.);
    e.update(0.05);
    let saved = e.capture_spatial_light_selection_state();
    assert!((saved[9] - 0.75).abs() < 1e-6);
    assert_eq!(e.spatial_scene.environment.frame_values[545], 65535.);
    assert!(e.spatial_scene.environment.frame_values[565..576]
        .iter()
        .all(|n| *n == 0.));
    let mut invalid = saved.clone();
    invalid[8] = 0.;
    assert!(!e.restore_spatial_light_selection_state(&invalid));
    assert_eq!(e.capture_spatial_light_selection_state(), saved);
    e.update(0.1);
    let replay = e.capture_spatial_light_selection_state();
    assert!(e.restore_spatial_light_selection_state(&saved));
    assert_eq!(e.spatial_light_selection_diagnostics_len(), 0);
    e.update(0.1);
    assert_eq!(e.capture_spatial_light_selection_state(), replay);
    assert_eq!(e.capture_spatial_environment(), source);
}

#[test]
fn native_selection_uses_simulation_steps_independent_of_render_rebuilds_zero_steps_and_pause() {
    let mut a = setup();
    let mut b = setup();
    for e in [&mut a, &mut b] {
        e.configure_fixed_timestep(true, 0.05, 1., 8);
        e.update(0.);
        pan(e, 20.);
    }
    a.update_frame(0.1, false, false, false);
    b.update(0.05);
    b.build_render_commands();
    b.update(0.05);
    assert_eq!(
        a.capture_spatial_light_selection_state(),
        b.capture_spatial_light_selection_state()
    );
    let before = a.capture_spatial_light_selection_state();
    a.build_render_commands();
    a.update(0.001);
    assert_eq!(a.capture_spatial_light_selection_state(), before);
    assert!(a.pause_data_scene());
    a.update(0.5);
    assert_eq!(a.capture_spatial_light_selection_state(), before);
    assert!(a.reset_spatial_light_selection());
    let empty = a.capture_spatial_light_selection_state();
    a.update(0.);
    a.update(0.5);
    assert_eq!(a.capture_spatial_light_selection_state(), empty);
    assert_eq!(
        a.spatial_scene.environment.light_selection_diagnostics()[0].flags & 4,
        4
    );
    assert!(a.resume_data_scene());
    assert!(a.reset_spatial_light_selection());
    assert_eq!(a.capture_spatial_light_selection_state()[2], 0.);
}

#[test]
fn native_v7_default_selection_and_v8_disabled_or_off_source_keep_original_semantics() {
    let mut e = setup();
    let mut v = values();
    v.truncate(576);
    assert!(e.configure_spatial_environment(&v));
    assert_eq!(e.spatial_environment_abi_version(), 7);
    assert!(e.capture_spatial_light_selection_state().is_empty());
    pan(&mut e, 20.);
    e.update(0.);
    assert_eq!(e.spatial_scene.environment.frame_values[16], 0.);
    assert_eq!(e.spatial_scene.environment.frame_values[17], 1.);
    v = values();
    v[576] = 0.;
    assert!(e.configure_spatial_environment(&v));
    e.update(0.);
    assert!(e.capture_spatial_light_selection_state().is_empty());
    assert_eq!(e.spatial_light_selection_diagnostics_len(), 0);
    v = values();
    v[0] = 0.;
    v[1] = 0.;
    v[12..60].fill(0.);
    v[545..549].fill(0.);
    assert!(e.configure_spatial_environment(&v));
    e.update(0.1);
    assert_eq!(e.capture_spatial_environment(), v);
    assert_eq!(e.spatial_scene.environment.frame_values[1], 0.);
    assert_eq!(e.capture_spatial_light_selection_state()[2], 0.);
    assert_eq!(e.spatial_light_selection_diagnostics_len(), 2);
}

#[test]
fn native_bound_light_selection_scores_simulation_pose_and_emits_interpolated_pose_without_reviving_stale_handles(
) {
    let mut e = setup();
    pan(&mut e, 0.);
    let mut v = values();
    v[192] = 0.;
    v[577] = 0.;
    v[578] = 0.;
    assert!(e.configure_spatial_environment(&v));
    let entity = super::data_scene_visuals::sprite(&mut e, 71, 1000., 0., 0);
    e.world.set_rigid_body(entity, RigidBody::kinematic());
    assert!(e.configure_spatial_light_bindings(&[0, entity.id, entity.generation], &[0.]));
    e.spatial_scene.advance_light_selection(&e.world, 0.);
    assert_eq!(e.capture_spatial_light_selection_state()[7], 1.);
    e.world.begin_render_interpolation_step();
    e.world.set_transform(entity, Transform2D { x: 0., y: 0. });
    e.world.end_render_interpolation_step();
    e.world.set_render_interpolation_alpha(Some(0.));
    assert_eq!(
        e.world
            .render_transform_at_index(entity.id as usize)
            .unwrap()
            .x,
        1000.
    );
    e.spatial_scene.advance_light_selection(&e.world, 0.1);
    let history = e.capture_spatial_light_selection_state();
    assert_eq!(history[7], 0.);
    e.build_render_commands();
    assert_eq!(e.capture_spatial_light_selection_state(), history);
    assert_eq!(e.spatial_scene.environment.frame_values[12], 1000.);
    assert_eq!(e.spatial_scene.environment.frame_values[16], 1.);
    assert_eq!(
        e.spatial_scene.environment.light_selection_diagnostics()[0].score,
        1.
    );
    e.world.despawn(entity);
    let fresh = super::data_scene_visuals::sprite(&mut e, 72, 0., 0., 0);
    assert_eq!(fresh.id, entity.id);
    assert_ne!(fresh.generation, entity.generation);
    e.spatial_scene.advance_light_selection(&e.world, 0.1);
    e.build_render_commands();
    assert_eq!(e.spatial_scene.environment.frame_values[17], 1.);
    assert_eq!(
        e.spatial_scene.environment.light_selection_diagnostics()[0].reason,
        6
    );
    let before = e.capture_spatial_light_selection_state();
    assert!(!e.configure_spatial_light_bindings(&[0, entity.id, entity.generation], &[0.]));
    assert_eq!(e.capture_spatial_light_selection_state(), before);
    assert!(e.configure_spatial_light_bindings(&[0, fresh.id, fresh.generation], &[0.]));
    assert_eq!(e.capture_spatial_light_selection_state()[2], 0.);
    e.build_render_commands();
    assert_eq!(e.spatial_scene.environment.frame_values[16], 1.);
    assert_eq!(e.capture_spatial_light_selection_state()[2], 0.);
}

#[test]
fn native_wide_bloom_v9_is_atomic_and_preserves_selection_history_across_quality_edits() {
    let mut e = setup();
    let mut v = values();
    v.resize(584, 0.);
    v[0] = 33.;
    v[128..132].copy_from_slice(&[1., 0.5, 64., 1.]);
    v[528] = 1.;
    v[580..584].copy_from_slice(&[1., 2., 4., 1.]);
    assert_eq!(e.spatial_wide_bloom_abi_version(), 1);
    assert!(e.configure_spatial_environment(&v));
    e.update(0.);
    assert_eq!(e.spatial_environment_abi_version(), 9);
    let history = e.capture_spatial_light_selection_state();
    for (at, value) in [
        (580, 0.),
        (581, 3.),
        (582, 2.),
        (583, 2.),
        (528, 0.),
        (130, 97.),
    ] {
        let mut bad = v.clone();
        bad[at] = value;
        assert!(!e.configure_spatial_environment(&bad));
        assert_eq!(e.capture_spatial_environment(), v);
        assert_eq!(e.capture_spatial_light_selection_state(), history);
    }
    v[581] = 4.;
    assert!(e.configure_spatial_environment(&v));
    assert_eq!(e.capture_spatial_light_selection_state(), history);
    assert!(!e.configure_spatial_environment(&v[..580]));
    v[583] = 0.;
    assert!(!e.configure_spatial_environment(&v));
    v[576..580].fill(0.);
    assert!(e.configure_spatial_environment(&v));
    assert!(e.capture_spatial_light_selection_state().is_empty());
    assert_eq!(e.capture_spatial_environment(), v);
}

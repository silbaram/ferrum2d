use super::{data_scene_visuals::sprite, *};
fn values(shadows: bool) -> Vec<f32> {
    let mut v = vec![0.; 80];
    v[0] = 1.;
    v[1] = 1.;
    v[2] = if shadows { 0. } else { -1. };
    v[3] = if shadows { 128. } else { 0. };
    v[4] = 0.05;
    v[5..8].copy_from_slice(&[0.15; 3]);
    v[12..20].copy_from_slice(&[0., 64., 0., 200., 1., 1., 1., 2.]);
    v[60..76].copy_from_slice(&[
        100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
    ]);
    v
}
fn setup() -> (Engine, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(400., 300.);
    assert!(e.configure_spatial_camera(&[
        0., 0., 100., 200., 0., 16., 0., 200., 0.1, 1000., 400., 300.
    ]));
    assert!(e.configure_spatial_terrain(
        &[-32., -32., 64., 64., 0., 16., 16., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    let a = sprite(&mut e, 71, 0., 0., 0);
    e.world
        .set_aabb_collider(a, AabbCollider::new(2., 2., false, CollisionLayer::Player));
    assert!(e.configure_data_scene_body(a.id, a.generation, 1, true, 0, 16., 8.));
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    (e, a)
}
fn two_point_shadow_values() -> Vec<f32> {
    let mut v = values(true);
    v.resize(592, 0.);
    v[1] = 3.;
    v[12..60].fill(0.);
    v[136..142].copy_from_slice(&[4., 3., 2., 128., 0.05, 0.]);
    for (source, x) in [-64., 0., 64.].into_iter().enumerate() {
        let p = 192 + source * 20;
        v[p..p + 8].copy_from_slice(&[x, 64., 0., 300., 1., 1., 1., 2.]);
    }
    for (slot, source) in [2, 0, 1].into_iter().enumerate() {
        let light = v[192 + source * 20..200 + source * 20].to_vec();
        v[12 + slot * 12..20 + slot * 12].copy_from_slice(&light);
    }
    v[544..548].fill(65535.);
    v[549..552].fill(65535.);
    v[576..580].copy_from_slice(&[1., 0.15, 0.15, 0.]);
    v[583] = 1.;
    v[584..590].copy_from_slice(&[0., 256., 0.1, 0.2, 1., 1.]);
    v
}
#[test]
fn spatial_environment_v10_pins_two_owners_and_preserves_atomic_history_and_off_source() {
    let (mut e, actor) = setup();
    let v = two_point_shadow_values();
    assert_eq!(e.spatial_point_shadows_abi_version(), 1);
    assert!(e.configure_spatial_environment(&v));
    e.update(0.01);
    assert_eq!(e.spatial_environment_abi_version(), 10);
    assert_eq!(e.spatial_model_abi_version(), 2);
    assert_eq!(e.spatial_environment_len(), 592);
    assert_eq!(e.spatial_shadow_matrix_len(), 192);
    let frame = &e.spatial_scene.environment.frame_values;
    assert_eq!((frame[12], frame[24], frame[588]), (64., -64., 1.));
    let history = e.capture_spatial_light_selection_state();
    assert_eq!((history[7], history[11]), (2., 0.));
    let diagnostics = e.spatial_scene.environment.light_selection_diagnostics();
    assert_eq!((diagnostics[2].slot, diagnostics[0].slot), (0, 1));
    assert_eq!((diagnostics[2].flags & 1, diagnostics[0].flags & 1), (1, 1));
    for (at, value) in [
        (584, 2.),
        (584, 3.),
        (584, 0.5),
        (585, 64.),
        (586, -1.),
        (587, 11.),
        (588, 0.),
        (589, 0.),
        (590, 1.),
        (591, f32::NAN),
        (136, 1.),
    ] {
        let mut bad = v.clone();
        bad[at] = value;
        assert!(
            !e.configure_spatial_environment(&bad),
            "accepted invalid {at}={value}"
        );
        assert_eq!(e.capture_spatial_environment(), v);
        assert_eq!(e.capture_spatial_light_selection_state(), history);
    }
    let mut swapped = history.clone();
    let mut missing_slot = v.clone();
    missing_slot[1] = 1.;
    missing_slot[24..60].fill(0.);
    missing_slot[546..549].fill(0.);
    assert!(!e.configure_spatial_environment(&missing_slot));
    swapped[7] = 0.;
    swapped[11] = 2.;
    assert!(!e.restore_spatial_light_selection_state(&swapped));
    assert_eq!(e.capture_spatial_light_selection_state(), history);
    let epoch = e.data_scene_epoch();
    let handles = [actor.id, actor.generation];
    let states = e.capture_data_scene_progress(epoch, &handles);
    let spatial = e.capture_data_scene_spatial_progress(epoch, &handles);
    let rotations = e.capture_data_scene_spatial_rotations(epoch, &handles);
    assert!(e.configure_spatial_environment(&values(false)));
    assert!(e.restore_data_scene_progress_with_spatial_light_selection(
        epoch,
        &handles,
        &states,
        &[],
        &spatial,
        &v,
        &rotations,
        true,
        &[],
        &history
    ));
    assert_eq!(e.capture_spatial_environment(), v);
    assert_eq!(e.capture_spatial_light_selection_state(), history);
    let mut off = v.clone();
    off[0] = 0.;
    off[1] = 0.;
    off[2] = -1.;
    off[3] = 0.;
    off[4] = 0.05;
    off[12..60].fill(0.);
    off[545..549].fill(0.);
    off[588] = -1.;
    assert!(e.configure_spatial_environment(&off));
    e.build_render_commands();
    assert_eq!(e.capture_spatial_environment(), off);
    assert_eq!(e.spatial_shadow_matrix_len(), 0);
    assert_eq!(e.spatial_shadow_range_len(), 0);
    assert_eq!(e.spatial_shadow_caster_len(), 0);
}
#[test]
fn spatial_environment_v10_model_masks_and_ranges_keep_sun_face6_between_both_cubes() {
    let (mut e, actor) = setup();
    let mut v = two_point_shadow_values();
    v[83..91].copy_from_slice(&[1., 0., 1., 0., 1., 1., 1., 1.]);
    v[91..95].copy_from_slice(&[512., 128., 0.05, 256.]);
    let model = sprite(&mut e, 0, 0., 0., 0);
    assert!(e.configure_spatial_scene_models(
        &[0., 0., 100., 200., 0., 16., 0., 200., 0.1, 1000., 400., 300.],
        &[-32., -32., 64., 64., 0., 16., 16., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1],
        &[actor.id, actor.generation],
        &[1., 0.5, 0.],
        &[],
        &[],
        &[],
        &v,
        &[],
        &[],
        &[model.id, model.generation, 1, 3, 1, 12],
        &[0., 0., 1., -4., 0., -4., 4., 24., 4.],
    ));
    e.update(0.01);
    assert_eq!(e.spatial_shadow_matrix_len(), 208);
    assert_eq!(e.spatial_model_len(), 1);
    // Native snapshot owns the record; no borrowed pointer is retained across native calls.
    let draw = e.spatial_model_draw_snapshot(model.id, model.generation);
    assert_ne!(
        draw[2] & 0x3f00,
        0,
        "second cube model visibility was omitted"
    );
    assert_ne!(draw[2] & 128, 0, "sun bit7 must remain unchanged");
    let ranges = &e.spatial_scene.shadow_draw_ranges;
    assert!(ranges.windows(2).all(|pair| pair[0].face <= pair[1].face));
    assert!(ranges.iter().any(|r| r.face == 6));
    assert!(ranges.iter().all(|r| r.face <= 12));
    assert!(ranges.iter().any(|r| r.face >= 7));
}
#[test]
fn spatial_environment_v6_composition_is_atomic_and_survives_progress_restore() {
    let (mut engine, actor) = setup();
    let mut v = values(false);
    v.resize(544, 0.);
    v[136] = 4.;
    v[137] = 1.;
    v[138] = -1.;
    let light = v[12..20].to_vec();
    v[192..200].copy_from_slice(&light);
    v[528] = 1.;
    assert!(engine.configure_spatial_environment(&v));
    engine.build_render_commands();
    assert_eq!(engine.spatial_environment_abi_version(), 6);
    assert_eq!(engine.spatial_environment_len(), 544);
    assert_eq!(engine.capture_spatial_environment(), v);
    for (index, value) in [(528, 2.), (529, 1.), (543, f32::NAN)] {
        let mut invalid = v.clone();
        invalid[index] = value;
        assert!(!engine.configure_spatial_environment(&invalid));
        assert_eq!(engine.capture_spatial_environment(), v);
    }
    let epoch = engine.data_scene_epoch();
    let handles = [actor.id, actor.generation];
    let states = engine.capture_data_scene_progress(epoch, &handles);
    let spatial = engine.capture_data_scene_spatial_progress(epoch, &handles);
    assert!(engine.configure_spatial_environment(&values(false)));
    assert!(engine.restore_data_scene_progress_with_spatial_environment(
        epoch,
        &handles,
        &states,
        &[],
        &spatial,
        &v
    ));
    assert_eq!(engine.capture_spatial_environment(), v);
}
#[test]
fn spatial_environment_v3_hemisphere_and_receiver_offsets_are_owned_and_atomic() {
    let (mut e, actor) = setup();
    let mut v = values(true);
    v.resize(128, 0.);
    v[112..123].copy_from_slice(&[1., 0., 1., 0., 0.6, 0.75, 1., 0.35, 0.3, 0.22, 0.14]);
    v[123] = 0.5;
    assert!(e.configure_spatial_environment(&v));
    e.build_render_commands();
    assert_eq!(e.spatial_environment_abi_version(), 3);
    assert_eq!(e.spatial_environment_len(), 128);
    assert_eq!(e.capture_spatial_environment(), v);
    let pose = e.world.transform(actor);
    let revision = e.spatial_terrain_revision();
    let matrices = e.spatial_scene.environment.shadow_matrices.clone();
    for (index, value) in [
        (112, 2.),
        (113, 2.),
        (119, -1.),
        (120, 2.),
        (123, 11.),
        (124, 0.5),
        (125, 1.),
    ] {
        let mut bad = v.clone();
        bad[index] = value;
        assert!(!e.configure_spatial_environment(&bad));
        assert_eq!(e.capture_spatial_environment(), v);
        assert_eq!(e.world.transform(actor), pose);
    }
    v[119] = 0.6;
    v[123] = 1.;
    assert!(e.configure_spatial_environment(&v));
    e.build_render_commands();
    assert_eq!(e.spatial_scene.environment.shadow_matrices, matrices);
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert!(e.configure_spatial_environment(&values(false)));
    e.build_render_commands();
    assert_eq!(e.spatial_environment_abi_version(), 1);
    assert_eq!(e.spatial_environment_len(), 80);
}
#[test]
fn spatial_environment_v3_progress_restores_both_shadow_offsets_atomically() {
    let (mut e, actor) = setup();
    let mut saved = values(true);
    saved.resize(128, 0.);
    saved[83..95].copy_from_slice(&[1., 0., 1., 0., 0.8, 1., 1., 1., 500., 128., 0.05, 256.]);
    saved[112..123].copy_from_slice(&[1., 0., 1., 0., 0.6, 0.75, 1., 0.35, 0.3, 0.22, 0.14]);
    saved[123] = 1.;
    saved[124] = 2.;
    assert!(e.configure_spatial_environment(&saved));
    let epoch = e.data_scene_epoch();
    let handles = [actor.id, actor.generation];
    let states = e.capture_data_scene_progress(epoch, &handles);
    let spatial = e.capture_data_scene_spatial_progress(epoch, &handles);
    assert!(e.configure_spatial_environment(&values(false)));
    e.world.set_transform(actor, Transform2D { x: 4., y: 0. });
    let mut invalid = saved.clone();
    invalid[125] = 1.;
    assert!(!e.restore_data_scene_progress_with_spatial_environment(
        epoch,
        &handles,
        &states,
        &[],
        &spatial,
        &invalid
    ));
    assert_eq!(e.capture_spatial_environment(), values(false));
    assert_eq!(e.world.transform(actor).unwrap().x, 4.);
    assert!(e.restore_data_scene_progress_with_spatial_environment(
        epoch,
        &handles,
        &states,
        &[],
        &spatial,
        &saved
    ));
    e.build_render_commands();
    assert_eq!(e.spatial_environment_abi_version(), 3);
    assert_eq!(e.capture_spatial_environment(), saved);
    assert_eq!(e.world.transform(actor).unwrap().x, 0.);
}
#[test]
fn spatial_environment_is_optional_and_shadow_casters_survive_camera_culling() {
    let (mut e, a) = setup();
    e.build_render_commands();
    assert_eq!(e.spatial_environment_len(), 0);
    let revision = e.spatial_terrain_revision();
    let v = values(true);
    assert!(e.configure_spatial_environment(&v));
    assert_eq!(e.capture_spatial_environment(), v);
    e.build_render_commands();
    assert_eq!(e.spatial_environment_abi_version(), 1);
    assert_eq!(e.spatial_environment_len(), 80);
    assert_eq!(e.spatial_shadow_matrix_len(), 96);
    assert_eq!(e.spatial_shadow_caster_len(), 6);
    assert_eq!(e.spatial_abi_version(), 2);
    assert_eq!(e.spatial_vertex_stride(), 11);
    assert_eq!(e.spatial_terrain_revision(), revision);
    e.world.set_transform(a, Transform2D { x: 10000., y: 0. });
    e.build_render_commands();
    assert!(e.spatial_scene.billboards.is_empty());
    assert_eq!(
        e.spatial_shadow_caster_len(),
        6,
        "offscreen actors still cast shadows"
    );
    let ptr = e.spatial_shadow_caster_ptr();
    for _ in 0..3 {
        e.build_render_commands();
        assert_eq!(e.spatial_shadow_caster_ptr(), ptr);
    }
    assert!(e.configure_spatial_environment(&[]));
    e.build_render_commands();
    assert_eq!(e.spatial_environment_len(), 0);
    assert_eq!(e.spatial_shadow_caster_len(), 0);
}
#[test]
fn spatial_environment_rejects_invalid_settings_without_mutating_scene_or_pose() {
    let (mut e, a) = setup();
    let v = values(true);
    assert!(e.configure_spatial_environment(&v));
    let revision = e.spatial_terrain_revision();
    let at = e.world.transform(a);
    for (index, bad) in [
        (0, 16.),
        (1, 5.),
        (2, 1.),
        (3, 300.),
        (4, -1.),
        (12, f32::INFINITY),
        (15, 0.),
        (20, 1.),
        (60, 0.),
        (63, 13.),
        (64, 11.),
        (67, 3.),
        (72, 0.),
        (79, 1.),
    ] {
        let mut invalid = v.clone();
        invalid[index] = bad;
        assert!(!e.configure_spatial_environment(&invalid), "field {index}");
        assert_eq!(e.capture_spatial_environment(), v);
        assert_eq!(e.world.transform(a), at);
        assert_eq!(e.spatial_terrain_revision(), revision);
    }
    assert!(!e.configure_spatial_environment(&v[..79]));
    assert_eq!(e.capture_spatial_environment(), v);
}
#[test]
fn spatial_environment_cube_matrices_project_the_six_light_axes() {
    let (mut e, _) = setup();
    assert!(e.configure_spatial_environment(&values(true)));
    for (face, (matrix, dir)) in e
        .spatial_scene
        .environment
        .shadow_matrices
        .chunks_exact(16)
        .zip([
            [1., 0., 0.],
            [-1., 0., 0.],
            [0., 1., 0.],
            [0., -1., 0.],
            [0., 0., 1.],
            [0., 0., -1.],
        ])
        .enumerate()
    {
        let p = [dir[0] * 10., 64. + dir[1] * 10., dir[2] * 10., 1.];
        let clip: [f32; 4] =
            std::array::from_fn(|r| (0..4).map(|c| matrix[c * 4 + r] * p[c]).sum());
        assert!(clip[0].abs() < 0.001 && clip[1].abs() < 0.001 && clip[3] > 0.);
        assert!(clip[2].abs() < clip[3]);
        // Canonical cube UVs are also a contract with the shader texel-ray
        // reconstruction. Center axes alone would not detect flipped/rolled faces.
        let offset = [
            [10., 3., -2.],
            [-10., 3., 2.],
            [2., 10., -3.],
            [2., -10., 3.],
            [2., 3., 10.],
            [-2., 3., -10.],
        ][face];
        let p = [offset[0], 64. + offset[1], offset[2], 1.];
        let clip: [f32; 4] =
            std::array::from_fn(|r| (0..4).map(|c| matrix[c * 4 + r] * p[c]).sum());
        assert!((clip[0] / clip[3] - 0.2).abs() < 1e-6, "cube face {face} U");
        assert!((clip[1] / clip[3] + 0.3).abs() < 1e-6, "cube face {face} V");
        // Caster shaders recover radial depth from reciprocal clip-W. The
        // matrix scale must retain world units, not just equivalent NDC values.
        assert!((clip[3] - 10.).abs() < 1e-6, "cube face {face} clip-W");
        let u = clip[0] / clip[3];
        let v = clip[1] / clip[3];
        let radial = clip[3] * (1. + u * u + v * v).sqrt();
        let expected = offset.iter().map(|value| value * value).sum::<f32>().sqrt();
        assert!(
            (radial - expected).abs() < 1e-5,
            "cube face {face} radial depth"
        );
    }
}
#[test]
fn spatial_environment_shadow_work_limits_are_atomic() {
    let (mut e, a) = setup();
    assert!(e.configure_spatial_environment(&values(true)));
    let mut handles = vec![a.id, a.generation];
    for _ in 0..1024 {
        let a = sprite(&mut e, 71, 0., 0., 0);
        handles.extend([a.id, a.generation]);
    }
    let styles: Vec<f32> = (0..1025).flat_map(|_| [1., 0.5, 0.]).collect();
    let revision = e.spatial_terrain_revision();
    assert!(!e.configure_spatial_billboards(&handles, &styles));
    assert_eq!(e.spatial_scene.bindings.len(), 1);
    assert_eq!(e.spatial_terrain_revision(), revision);
    let terrain: Vec<f32> = (0..66)
        .flat_map(|i| [i as f32 * 8., 0., 8., 8., 0., 0., 0., 1., 1., 1., 1.])
        .collect();
    let metadata: Vec<u32> = (0..66).flat_map(|i| [i + 1, 0, i % 2 + 1, 1]).collect();
    assert!(!e.configure_spatial_terrain(&terrain, &metadata));
    assert_eq!(e.spatial_scene.surfaces.len(), 1);
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert!(e.configure_spatial_environment(&values(false)));
    assert!(e.configure_spatial_billboards(&handles, &styles));
    assert!(!e.configure_spatial_environment(&values(true)));
    assert_eq!(e.capture_spatial_environment(), values(false));
}
#[test]
fn spatial_environment_progress_restores_settings_and_pose_atomically() {
    let (mut e, a) = setup();
    let saved = values(true);
    assert!(e.configure_spatial_environment(&saved));
    let epoch = e.data_scene_epoch();
    let handles = [a.id, a.generation];
    let states = e.capture_data_scene_progress(epoch, &handles);
    let spatial = e.capture_data_scene_spatial_progress(epoch, &handles);
    e.world.set_transform(a, Transform2D { x: 4., y: 0. });
    let mut changed = saved.clone();
    changed[19] = 5.;
    assert!(e.configure_spatial_environment(&changed));
    let mut invalid = saved.clone();
    invalid[63] = 100.;
    assert!(!e.restore_data_scene_progress_with_spatial_environment(
        epoch,
        &handles,
        &states,
        &[],
        &spatial,
        &invalid
    ));
    assert_eq!(e.world.transform(a).unwrap().x, 4.);
    assert_eq!(e.capture_spatial_environment(), changed);
    assert!(e.restore_data_scene_progress_with_spatial_environment(
        epoch,
        &handles,
        &states,
        &[],
        &spatial,
        &saved
    ));
    assert_eq!(e.world.transform(a).unwrap().x, 0.);
    assert_eq!(e.capture_spatial_environment(), saved);
    assert!(e.restore_data_scene_progress_with_spatial_environment(
        epoch,
        &handles,
        &states,
        &[],
        &spatial,
        &[]
    ));
    assert!(e.capture_spatial_environment().is_empty());
}

#[test]
fn spatial_environment_shadow_ranges_are_light_relative_and_revisions_follow_actual_geometry() {
    let (mut e, actor) = setup();
    assert!(e.configure_spatial_environment(&values(true)));
    e.build_render_commands();
    let revision = e.spatial_shadow_revision();
    let full = (e.spatial_terrain_len() + e.spatial_shadow_caster_len()) * 6;
    let submitted: u32 = e
        .spatial_scene
        .shadow_draw_ranges
        .iter()
        .map(|r| r.count)
        .sum();
    assert!(submitted > 0 && submitted < full);
    e.build_render_commands();
    assert_eq!(e.spatial_shadow_revision(), revision);
    e.world
        .set_transform(actor, Transform2D { x: 10000., y: 0. });
    e.build_render_commands();
    assert_ne!(e.spatial_shadow_revision(), revision);
    assert_eq!(e.spatial_shadow_caster_len(), 6);
    assert!(
        e.spatial_scene
            .shadow_draw_ranges
            .iter()
            .all(|r| r.source == 0),
        "offscreen caster outside light volume should not be submitted"
    );
    let revision = e.spatial_shadow_revision();
    let mut camera = e.spatial_scene.camera.unwrap().parameters;
    camera[1] += 100.;
    assert!(e.configure_spatial_camera(&camera));
    e.build_render_commands();
    assert_ne!(
        e.spatial_shadow_revision(),
        revision,
        "billboard orientation invalidates shadows"
    );
}

#[test]
fn spatial_environment_pixel_viewport_and_snap_preserve_source_camera_and_world_pose() {
    let (mut e, actor) = setup();
    let original = e.spatial_scene.camera.unwrap().parameters;
    let pose = e.world.transform(actor);
    let mut settings = values(false);
    settings.resize(112, 0.);
    settings[0] = 16.;
    settings[1] = 0.;
    settings[12..60].fill(0.);
    settings[80..83].copy_from_slice(&[160., 90., 1.]);
    assert!(e.configure_spatial_environment(&settings));
    e.build_render_commands();
    assert_eq!(e.spatial_environment_abi_version(), 2);
    assert_eq!(e.spatial_environment_len(), 112);
    for (a, b) in e
        .spatial_scene
        .presentation
        .iter()
        .zip([0.1, 0.2, 0.8, 0.6, 160., 90.])
    {
        assert!((a - b).abs() < 0.00001);
    }
    assert_eq!(e.spatial_scene.camera.unwrap().parameters, original);
    assert_eq!(e.world.transform(actor), pose);
    let good = e.capture_spatial_environment();
    for (index, value) in [(80, 0.), (81, 1.5), (82, 2.), (83, 1.)] {
        let mut invalid = good.clone();
        invalid[index] = value;
        assert!(!e.configure_spatial_environment(&invalid));
        assert_eq!(e.capture_spatial_environment(), good);
    }
}

#[test]
fn spatial_materials_are_atomic_and_cast_flags_exclude_both_terrain_and_sprites() {
    let (mut e, actor) = setup();
    let camera = e.spatial_scene.camera.unwrap().parameters;
    let terrain = [-32., -32., 64., 64., 0., 16., 16., 1., 1., 1., 1.];
    let metadata = [1, 0, 16777215, 1];
    let handles = [actor.id, actor.generation];
    assert!(e.configure_spatial_scene_materials(
        &camera,
        &terrain,
        &metadata,
        &handles,
        &[1., 0.5, 0.],
        &[],
        &[],
        &[],
        &values(true),
        &[0],
        &[72, 0]
    ));
    e.build_render_commands();
    assert_eq!(e.spatial_scene.billboard_materials[0].normal_texture, 72);
    assert_eq!(e.spatial_scene.billboard_materials[0].flags, 0);
    assert!(e.spatial_scene.shadow_casters.is_empty());
    assert!(e.spatial_scene.shadow_draw_ranges.is_empty());
    let revision = e.spatial_terrain_revision();
    assert!(!e.configure_spatial_scene_materials(
        &camera,
        &terrain,
        &metadata,
        &handles,
        &[1., 0.5, 0.],
        &[],
        &[],
        &[],
        &values(true),
        &[0],
        &[72, 4]
    ));
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert_eq!(
        e.spatial_scene.bindings[&(actor.id, actor.generation)]
            .material
            .flags,
        0
    );
}

#[test]
fn spatial_environment_sun_and_actor_focus_use_native_depth_and_survive_capture() {
    let (mut e, actor) = setup();
    e.spatial_scene.actor = Some((actor, 0., 32., 32.));
    let mut settings = values(false);
    settings.resize(112, 0.);
    settings[0] = 5.;
    settings[83..95].copy_from_slice(&[1., 0., 1., 0., 2., 1., 1., 1., 200., 128., 0.05, 128.]);
    settings[96..99].copy_from_slice(&[1., 1., 8.]);
    assert!(e.configure_spatial_environment(&settings));
    e.build_render_commands();
    assert_eq!(e.spatial_shadow_matrix_len(), 16);
    assert!(e
        .spatial_scene
        .shadow_draw_ranges
        .iter()
        .all(|r| r.face == 6));
    assert!(!e.spatial_scene.shadow_draw_ranges.is_empty());
    let focus = e.spatial_scene.environment.frame_values[99];
    e.world.set_transform(actor, Transform2D { x: 100., y: 0. });
    e.build_render_commands();
    assert_eq!(
        e.spatial_scene.environment.frame_values[99], focus,
        "lateral movement must not use Euclidean distance"
    );
    assert!(e.configure_data_scene_body(actor.id, actor.generation, 1, true, 0, 32., 8.));
    e.build_render_commands();
    assert!(
        e.spatial_scene.environment.frame_values[99] < focus,
        "higher actor is closer along this view axis"
    );
    assert_eq!(
        e.capture_spatial_environment(),
        settings,
        "derived focus must not overwrite authored fallback"
    );
    e.despawn_physics_entity(actor.id, actor.generation);
    e.build_render_commands();
    assert_eq!(e.spatial_scene.environment.frame_values[99], settings[60]);
    for (index, value) in [
        (83, 2.),
        (84, 2.),
        (91, 0.),
        (92, 300.),
        (95, 2.),
        (96, 2.),
        (99, 1.),
        (111, 1.),
    ] {
        let mut invalid = settings.clone();
        invalid[index] = value;
        assert!(!e.configure_spatial_environment(&invalid), "field {index}");
        assert_eq!(e.capture_spatial_environment(), settings);
    }
}

#[test]
fn spatial_environment_preflight_checks_prospective_camera_without_mutation() {
    let (mut e, actor) = setup();
    let camera = e.spatial_scene.camera.unwrap().parameters;
    let pose = e.world.transform(actor);
    let revision = e.spatial_terrain_revision();
    let mut settings = values(false);
    settings.resize(112, 0.);
    settings[83..95].copy_from_slice(&[1., 0., 1., 0., 2., 1., 1., 1., 512., 1024., 0.05, 1.]);
    assert!(e.preflight_spatial_camera_environment(&camera, &settings));
    let mut invalid_camera = camera;
    invalid_camera[1] = 1e37;
    invalid_camera[4] = 1e37;
    assert!(crate::spatial_scene::SpatialCamera::new(&invalid_camera).is_some());
    assert!(!e.preflight_spatial_camera_environment(&invalid_camera, &settings));
    assert!(!e.preflight_spatial_camera_environment(&camera[..11], &settings));
    assert!(!e.preflight_spatial_camera_environment(&camera, &settings[..111]));
    assert_eq!(e.spatial_scene.camera.unwrap().parameters, camera);
    assert!(e.capture_spatial_environment().is_empty());
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert_eq!(e.world.transform(actor), pose);
    assert!(e.configure_spatial_environment(&settings));
}

#[test]
fn lighting_v4_selects_by_influence_and_tracks_bound_entity_without_mutating_authoring() {
    let (mut e, actor) = setup();
    let mut v = values(false);
    v.resize(512, 0.);
    v[136] = 1.;
    v[137] = 6.;
    v[138] = -1.;
    for i in 0..6 {
        let p = 192 + i * 20;
        v[p..p + 8].copy_from_slice(&[i as f32 * 10., 32., 0., 100., 1., 0.5, 0.2, (i + 1) as f32]);
    }
    v[12..20].copy_from_slice(&[0., 32., 0., 100., 1., 0.5, 0.2, 1.]);
    assert!(e.configure_spatial_environment(&v));
    assert!(e.configure_spatial_light_bindings(&[5, actor.id, actor.generation], &[4.]));
    e.build_render_commands();
    assert_eq!(e.spatial_environment_abi_version(), 4);
    assert_eq!(e.spatial_scene.environment.frame_values[1], 1.);
    let before = e.spatial_scene.environment.frame_values[12];
    e.world.set_transform(actor, Transform2D { x: 20., y: 10. });
    e.build_render_commands();
    assert_ne!(e.spatial_scene.environment.frame_values[12], before);
    assert_eq!(e.capture_spatial_environment(), v);
    assert!(!e.configure_spatial_light_bindings(&[16, actor.id, actor.generation], &[0.]));
    assert!(e.spatial_scene.light_bindings[5].is_some());
    let mut inconsistent_shadow = v.clone();
    inconsistent_shadow[138] = 0.;
    inconsistent_shadow[139] = 128.;
    assert!(!e.configure_spatial_environment(&inconsistent_shadow));
    assert_eq!(e.capture_spatial_environment(), v);
    for (index, value) in [
        (136, 0.),
        (137, 17.),
        (138, 6.),
        (142, 1.),
        (176, 1.),
        (207, 1.),
    ] {
        let mut invalid = v.clone();
        invalid[index] = value;
        assert!(!e.configure_spatial_environment(&invalid), "field {index}");
        assert_eq!(e.capture_spatial_environment(), v);
    }
}

#[test]
fn spatial_billboard_and_actor_focus_share_interpolated_height_and_position() {
    let (mut e, actor) = setup();
    e.spatial_scene.actor = Some((actor, 0., 32., 32.));
    let mut settings = values(false);
    settings.resize(112, 0.);
    settings[0] = 5.;
    settings[83..95].copy_from_slice(&[1., 0., 1., 0., 2., 1., 1., 1., 200., 128., 0.05, 128.]);
    settings[96..99].copy_from_slice(&[1., 1., 8.]);
    assert!(e.configure_spatial_environment(&settings));
    e.build_render_commands();
    let before_focus = e.spatial_scene.environment.frame_values[99];
    let before_vertex = e.spatial_scene.billboards[0].position;
    e.world.begin_render_interpolation_step();
    e.world.set_transform(actor, Transform2D { x: 10., y: 20. });
    e.world.set_height_span(
        actor,
        HeightSpan::new(crate::components::PhysicsFloorId(0), 36., 8.).unwrap(),
    );
    e.world.end_render_interpolation_step();
    e.build_render_commands();
    let after_focus = e.spatial_scene.environment.frame_values[99];
    let after_vertex = e.spatial_scene.billboards[0].position;
    e.world.set_render_interpolation_alpha(Some(0.5));
    e.build_render_commands();
    assert!(
        (e.spatial_scene.environment.frame_values[99] - (before_focus + after_focus) * 0.5).abs()
            < 0.001
    );
    for axis in 0..3 {
        assert!(
            (e.spatial_scene.billboards[0].position[axis]
                - (before_vertex[axis] + after_vertex[axis]) * 0.5)
                .abs()
                < 0.001
        );
    }
    assert_eq!(
        e.world.transform(actor).unwrap(),
        Transform2D { x: 10., y: 20. }
    );
    assert_eq!(e.world.height_span(actor).unwrap().elevation, 36.);
}

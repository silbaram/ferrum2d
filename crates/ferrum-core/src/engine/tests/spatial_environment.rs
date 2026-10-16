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
    for (matrix, dir) in e
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
    {
        let p = [dir[0] * 10., 64. + dir[1] * 10., dir[2] * 10., 1.];
        let clip: [f32; 4] =
            std::array::from_fn(|r| (0..4).map(|c| matrix[c * 4 + r] * p[c]).sum());
        assert!(clip[0].abs() < 0.001 && clip[1].abs() < 0.001 && clip[3] > 0.);
        assert!(clip[2].abs() < clip[3]);
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

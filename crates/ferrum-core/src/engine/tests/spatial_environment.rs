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

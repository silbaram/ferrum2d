use super::*;
use crate::spatial_scene::SpatialTerrainDrawRange;

fn ranges(e: &Engine) -> Vec<(u32, u32)> {
    e.spatial_scene
        .terrain_draw_ranges
        .iter()
        .map(|r| (r.first_vertex, r.vertex_count))
        .collect()
}
fn camera(e: &mut Engine, x: f32) {
    assert!(
        e.configure_spatial_camera(&[0., x, 16., 200., x, 16., 0., 200., 0.1, 1000., 200., 200.])
    );
}

#[test]
fn terrain_chunks_merge_visible_neighbors_and_reuse_static_mesh_and_range_capacity() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(200., 200.);
    let floats: Vec<f32> = [10000., -20., 0., 20000., 20.]
        .into_iter()
        .flat_map(|x| [x, 0., 8., 8., -8., 8., 8., 1., 1., 1., 1.])
        .collect();
    let metadata: Vec<u32> = (1..=5).flat_map(|id| [id, 0, 16777215, 1]).collect();
    assert!(e.configure_spatial_terrain(&floats, &metadata));
    let mesh_ptr = e.spatial_terrain_ptr();
    let revision = e.spatial_terrain_revision();
    let capacity = e.spatial_scene.terrain_draw_ranges.capacity();
    assert!(capacity >= 5);
    for (x, expected) in [
        (0., vec![(36, 72), (144, 36)]),
        (10000., vec![(0, 36)]),
        (-10000., vec![]),
        (20000., vec![(108, 36)]),
        (0., vec![(36, 72), (144, 36)]),
    ] {
        camera(&mut e, x);
        e.build_render_commands();
        assert_eq!(ranges(&e), expected);
        assert_eq!(e.spatial_terrain_len(), 180);
        assert_eq!(e.spatial_terrain_ptr(), mesh_ptr);
        assert_eq!(e.spatial_terrain_revision(), revision);
        assert_eq!(e.spatial_scene.terrain_draw_ranges.capacity(), capacity);
    }
    assert_eq!(e.spatial_abi_version(), 2);
    assert_eq!(e.spatial_vertex_stride(), 11);
    assert_eq!(e.spatial_terrain_draw_range_stride(), 2);
    assert_eq!(std::mem::size_of::<SpatialTerrainDrawRange>(), 8);
    assert_eq!(e.spatial_terrain_draw_range_len(), 2);
    assert!(e.configure_spatial_terrain(&[], &[]));
    e.build_render_commands();
    assert!(ranges(&e).is_empty());
    e.clear_spatial_scene();
    assert!(ranges(&e).is_empty());
}

#[test]
fn terrain_chunk_bounds_include_cliff_side_when_top_bottom_and_origin_are_outside() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(100., 100.);
    assert!(e.configure_spatial_terrain(
        &[
            -8., 0., 16., 16., -80., 80., 80., 1., 1., 1., 1., 24., 0., 16., 16., 60., 80., 80.,
            1., 1., 1., 1.
        ],
        &[1, 0, 16777215, 1, 2, 0, 16777215, 1]
    ));
    assert!(
        e.configure_spatial_camera(&[0., 0., 0., 100., 0., 0., 0., 100., 0.1, 1000., 100., 100.])
    );
    e.build_render_commands();
    assert_eq!(ranges(&e), [(0, 36)]);
}

#[test]
fn terrain_chunks_keep_near_eye_and_frustum_boundary_intersections() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(200., 200.);
    assert!(e.configure_spatial_terrain(
        &[-8., -10., 16., 40., 0., 16., 16., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    for projection in [0., 1.] {
        for (near, count) in [(0.1, 1), (100., 1), (130., 0), (0.1, 1)] {
            assert!(e.configure_spatial_camera(&[
                projection,
                0.,
                8.,
                96.,
                0.,
                8.,
                0.,
                if projection == 0. {
                    200.
                } else {
                    std::f32::consts::FRAC_PI_2
                },
                near,
                1000.,
                200.,
                200.
            ]));
            e.build_render_commands();
            assert_eq!(e.spatial_terrain_draw_range_len(), count);
        }
    }
    assert!(e.configure_spatial_camera(&[
        1.,
        0.,
        8.,
        0.,
        0.,
        8.,
        -1.,
        std::f32::consts::FRAC_PI_2,
        0.1,
        1000.,
        200.,
        200.
    ]));
    e.build_render_commands();
    assert_eq!(ranges(&e), [(0, 36)]);
    // Touching the right clip plane is retained; moving the complete bounds outside is rejected.
    assert!(e.configure_spatial_terrain(
        &[100., 0., 8., 8., 0., 8., 8., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    camera(&mut e, 0.);
    e.build_render_commands();
    assert_eq!(ranges(&e), [(0, 36)]);
    camera(&mut e, -1.);
    e.build_render_commands();
    assert!(ranges(&e).is_empty());
}

#[test]
fn terrain_chunk_ranges_are_cleared_on_skipped_render_and_scene_reset() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(200., 200.);
    assert!(e.configure_spatial_terrain(
        &[0., 0., 8., 8., 0., 8., 8., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    camera(&mut e, 0.);
    e.build_render_commands();
    assert_eq!(ranges(&e), [(0, 36)]);
    e.update_frame(0., false, false, false);
    assert!(!e.spatial_frame_active());
    assert!(ranges(&e).is_empty());
    assert_eq!(e.spatial_terrain_len(), 36);
    e.build_render_commands();
    assert_eq!(ranges(&e), [(0, 36)]);
    e.use_data_scene();
    assert!(ranges(&e).is_empty());
    assert_eq!(e.spatial_terrain_len(), 0);
}

#[test]
fn terrain_chunks_keep_gpu_f32_far_plane_cancellation_boundary() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(1280., 720.);
    assert!(e.configure_spatial_terrain(
        &[-256., 10047., 512., 1., 0., 64., 64., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    assert!(e.configure_spatial_camera(&[
        1.,
        0.,
        0.,
        0.,
        0.,
        0.,
        -1.,
        std::f32::consts::FRAC_PI_3,
        0.1,
        10000.,
        1280.,
        720.
    ]));
    e.build_render_commands();
    let m = e.spatial_scene.frame_camera;
    let z = -10047.;
    let clip_z = m[10] * z + m[14];
    let clip_w = m[11] * z;
    assert_eq!(
        clip_z, clip_w,
        "GPU f32 reference remains at the far clip boundary"
    );
    assert_eq!(ranges(&e), [(0, 36)]);
    assert!(e.configure_spatial_terrain(
        &[-256., 20000., 512., 1., 0., 64., 64., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    e.build_render_commands();
    assert!(ranges(&e).is_empty());
}

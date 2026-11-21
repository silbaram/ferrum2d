use super::*;
use crate::engine::UnifiedTerrainSource;
use crate::physics3d::{QueryFilter, RayCast, Space, WorldConfig};

fn collision() -> (Vec<u32>, Vec<f32>, Vec<u32>) {
    (
        vec![2, 1, 2, 1, 0, 0, 7, 0, 2, 0, 0, 7, 0],
        vec![10., 10., 0., 0., 0., 1., 1., 0., 0., 0., 1., 1., 0., 0.],
        vec![1, 2],
    )
}
fn visual() -> (Vec<u32>, Vec<f32>) {
    (
        vec![2, 1, 1, 17],
        vec![0.25, 0., 0.5, 1., 0.8, 0.7, 0.6, 0.5],
    )
}
fn hits(e: &mut Engine) -> Vec<crate::engine::UnifiedTerrainRayHit> {
    let mut out = Vec::new();
    e.cast_unified_terrain_ray_all(
        &RayCast {
            origin: [-1., 5., 0.],
            direction: [1., 0., 0.],
            max_distance: 30.,
            solid: true,
        },
        &QueryFilter::default(),
        &mut out,
        2,
    )
    .unwrap();
    out
}

#[test]
fn graphical_tilemap_reuses_camera_commands_and_retains_invisible_native_collision() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.camera = crate::camera::Camera2D::new(100., 100.);
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let (m, f, c) = collision();
    let (vm, vf) = visual();
    assert_eq!(e.data_scene_collision_tilemap_version(), 2);
    assert!(e.configure_data_scene_collision_tilemap_v2(&m, &f, &c, &vm, &vf));
    assert_eq!(
        e.entity_count(),
        0,
        "tiles do not become per-cell gameplay entities"
    );
    e.build_render_commands();
    assert_eq!(e.frame_buffers.render_commands.len(), 1);
    let command = e.frame_buffers.render_commands[0];
    assert_eq!(
        (command.texture_id, command.width, command.height),
        (17., 10., 10.)
    );
    assert_eq!(
        (command.u0, command.u1, command.r, command.a),
        (0.25, 0.5, 0.8, 0.5)
    );
    let before = hits(&mut e);
    assert_eq!(before.len(), 2);
    assert_eq!(
        before[1].source,
        UnifiedTerrainSource::Tile { layer: 0, tile: 1 }
    );
    let mut recolored = vf.clone();
    recolored[4] = 0.25;
    assert!(e.configure_data_scene_collision_tilemap_v2(&m, &f, &c, &vm, &recolored));
    e.build_render_commands();
    assert_eq!(e.frame_buffers.render_commands[0].r, 0.25);
    assert_eq!(
        hits(&mut e),
        before,
        "visual-only reapply retains native collider handles"
    );
    e.camera.x = 10_000.;
    e.build_render_commands();
    assert!(
        e.frame_buffers.render_commands.is_empty(),
        "existing camera culling applies"
    );
    assert_eq!(
        hits(&mut e),
        before,
        "camera movement must not alter native terrain"
    );
}

#[test]
fn graphical_tilemap_invalid_visual_buffers_preserve_live_graphics_and_native_handles() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        ..Default::default()
    })
    .unwrap();
    let (m, f, c) = collision();
    let (vm, vf) = visual();
    assert!(e.configure_data_scene_collision_tilemap_v2(&m, &f, &c, &vm, &vf));
    let previous = e.tilemap.clone();
    let before = hits(&mut e);
    let bad_uv = {
        let mut v = vf.clone();
        v[2] = v[0];
        v
    };
    let bad_color = {
        let mut v = vf.clone();
        v[4] = f32::NAN;
        v
    };
    let over_color = {
        let mut v = vf.clone();
        v[7] = 1.1;
        v
    };
    for (metadata, values) in [
        (vec![], vf.clone()),
        (vec![1, 1, 1, 17], vf.clone()),
        (vec![2, 1, 3, 17], vf.clone()),
        (vec![2, 1, 0, 17], vf.clone()),
        (vec![2, 1, 1, 0x0100_0000], vf.clone()),
        (vec![2, 2, 1, 17, 1, 18], [vf.clone(), vf.clone()].concat()),
        (vm.clone(), vec![]),
        (vm.clone(), bad_uv),
        (vm.clone(), bad_color),
        (vm.clone(), over_color),
    ] {
        assert!(!e.configure_data_scene_collision_tilemap_v2(&m, &f, &c, &metadata, &values));
        assert_eq!(e.tilemap, previous);
        assert_eq!(hits(&mut e), before);
    }
}

#[test]
fn graphical_tilemap_native_capacity_and_spatial_camera_reject_before_publication() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        max_bodies: 1,
        max_colliders: 1,
        ..Default::default()
    })
    .unwrap();
    let (m, f, c) = collision();
    let (vm, vf) = visual();
    let previous = e.tilemap.clone();
    assert!(!e.configure_data_scene_collision_tilemap_v2(&m, &f, &c, &vm, &vf));
    assert_eq!(e.tilemap, previous);
    e.spatial_scene.camera = crate::spatial_scene::SpatialCamera::new(&[
        0., 0., 40., 1., 0., 0., 0., 200., 0.1, 2000., 200., 200.,
    ]);
    assert!(e.spatial_scene.camera.is_some());
    assert!(!e.configure_data_scene_collision_tilemap_v2(&m, &f, &[1, 0], &vm, &vf));
    assert_eq!(e.tilemap, previous);
    assert!(
        e.configure_data_scene_collision_tilemap(&m, &f, &[1, 0]),
        "collision-only stays supported with spatial cameras"
    );
}

#[test]
fn graphical_tilemap_v1_replacement_and_clear_remove_graphics_without_retaining_visual_state() {
    let mut e = Engine::new();
    let (m, f, c) = collision();
    let (vm, vf) = visual();
    assert!(!e.configure_data_scene_collision_tilemap_v2(&m, &f, &c, &vm, &vf));
    e.use_data_scene();
    e.camera = crate::camera::Camera2D::new(100., 100.);
    assert!(e.configure_data_scene_collision_tilemap_v2(&m, &f, &c, &vm, &vf));
    e.build_render_commands();
    assert_eq!(e.frame_buffers.render_commands.len(), 1);
    let revision = e.tilemap.physics_revision();
    assert!(e.configure_data_scene_collision_tilemap(&m, &f, &c));
    e.build_render_commands();
    assert!(e.frame_buffers.render_commands.is_empty());
    assert!(e.tilemap.physics_revision() > revision);
    assert_eq!(e.tilemap.terrain_tiles().count(), 2);
    assert!(e.configure_data_scene_collision_tilemap_v2(&m, &f, &c, &vm, &vf));
    assert!(e.configure_data_scene_collision_tilemap(&[], &[], &[]));
    e.build_render_commands();
    assert!(e.frame_buffers.render_commands.is_empty());
    assert_eq!(e.tilemap.terrain_tiles().count(), 0);
}

#[test]
fn graphical_tilemap_native_checkpoint_rolls_back_visuals_terrain_and_collider_identity() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.camera = crate::camera::Camera2D::new(100., 100.);
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        ..Default::default()
    })
    .unwrap();
    let (m, mut f, c) = collision();
    let (mut vm, vf) = visual();
    assert!(e.configure_data_scene_collision_tilemap_v2(&m, &f, &c, &vm, &vf));
    let before = hits(&mut e);
    e.build_render_commands();
    let commands = e.frame_buffers.render_commands.clone();
    let original = e.tilemap.clone();
    let checkpoint = e.runtime_checkpoint().unwrap();
    f[2] = 100.;
    vm[3] = 42;
    assert!(e.configure_data_scene_collision_tilemap_v2(&m, &f, &c, &vm, &vf));
    assert!(hits(&mut e).is_empty());
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    assert_eq!(e.tilemap, original);
    assert_eq!(hits(&mut e), before);
    e.build_render_commands();
    assert_eq!(e.frame_buffers.render_commands, commands);
}

use super::{data_scene_visuals::sprite, *};

fn packed(light: u32, shadow: u32) -> f32 {
    (light | shadow << 8) as f32
}

fn values() -> Vec<f32> {
    let mut v = vec![0.; 576];
    v[0] = 1.;
    v[1] = 2.;
    v[2] = 0.;
    v[3] = 128.;
    v[4] = 0.05;
    v[5..8].fill(0.15);
    v[60..76].copy_from_slice(&[
        100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
    ]);
    v[83..91].copy_from_slice(&[1., 0., 1., 0., 1., 1., 1., 1.]);
    v[136] = 2.;
    v[137] = 3.;
    v[138] = 2.;
    v[139] = 128.;
    v[140] = 0.05;
    let sources = [
        [1000., 64., 0., 50., 1., 0., 0., 5.],
        [0., 64., 0., 50., 0., 1., 0., 4.],
        [0., 64., 0., 50., 0., 0., 1., 1.],
    ];
    let channels = [packed(3, 128), packed(0, 2), packed(8, 0)];
    for (i, source) in sources.iter().enumerate() {
        v[192 + i * 20..200 + i * 20].copy_from_slice(source);
        v[549 + i] = channels[i];
    }
    for (slot, source) in [2, 0].into_iter().enumerate() {
        v[12 + slot * 12..20 + slot * 12].copy_from_slice(&sources[source]);
        v[545 + slot] = channels[source];
    }
    v[544] = packed(0, 3);
    v
}

fn setup() -> (Engine, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(400., 300.);
    assert!(e.configure_spatial_camera(&[
        0., 0., 100., 200., 0., 16., 0., 200., 0.1, 1000., 400., 300.
    ]));
    let entity = sprite(&mut e, 71, 0., 0., 0);
    assert!(e.configure_spatial_billboards(&[entity.id, entity.generation], &[1., 0.5, 0.]));
    (e, entity)
}

#[test]
fn native_light_channels_follow_selected_sources_and_pinned_shadow_owner_without_mutating_authored_values(
) {
    let (mut e, _) = setup();
    let input = values();
    assert_eq!(e.spatial_light_channel_abi_version(), 1);
    assert!(e.configure_spatial_environment(&input));
    assert_eq!(e.spatial_environment_abi_version(), 7);
    e.build_render_commands();
    let v = &e.spatial_scene.environment.frame_values;
    assert_eq!(v.len(), 576);
    assert_eq!(v[544], packed(0, 3));
    assert_eq!(v[2], 0.);
    assert_eq!(&v[16..19], &[0., 0., 1.]);
    assert_eq!(&v[28..31], &[0., 1., 0.]);
    assert_eq!(&v[545..549], &[packed(8, 0), packed(0, 2), 0., 0.]);
    assert_eq!(e.capture_spatial_environment(), input);
    let mut camera = e.spatial_scene.camera.unwrap().parameters;
    camera[1] += 1000.;
    camera[4] += 1000.;
    assert!(e.configure_spatial_camera(&camera));
    e.build_render_commands();
    let v = &e.spatial_scene.environment.frame_values;
    assert_eq!(&v[28..31], &[1., 0., 0.]);
    assert_eq!(&v[545..549], &[packed(8, 0), packed(3, 128), 0., 0.]);
    assert_eq!(e.capture_spatial_environment(), input);
}

#[test]
fn native_light_channel_input_validation_and_progress_restore_are_atomic() {
    let (mut e, entity) = setup();
    let input = values();
    assert!(e.configure_spatial_environment(&input));
    e.build_render_commands();
    let epoch = e.data_scene_epoch();
    let handles = [entity.id, entity.generation];
    let state = e.capture_data_scene_progress(epoch, &handles);
    let spatial = e.capture_data_scene_spatial_progress(epoch, &handles);
    let original_frame = e.spatial_scene.environment.frame_values.clone();
    for (index, value) in [
        (544, -1.),
        (544, 65536.),
        (545, 0.5),
        (549, f32::NAN),
        (548, 1.),
        (552, 1.),
        (529, 1.),
        (565, 1.),
    ] {
        let mut invalid = input.clone();
        invalid[index] = value;
        assert!(!e.configure_spatial_environment(&invalid), "slot {index}");
        assert!(!e.restore_data_scene_progress_with_spatial_environment(
            epoch,
            &handles,
            &state,
            &[],
            &spatial,
            &invalid
        ));
        assert_eq!(e.capture_spatial_environment(), input);
        assert_eq!(e.spatial_scene.environment.frame_values, original_frame);
    }
    assert!(!e.configure_spatial_environment(&input[..575]));
    let legacy = input[..544].to_vec();
    assert!(e.configure_spatial_environment(&legacy));
    assert_eq!(e.spatial_environment_abi_version(), 6);
    assert!(e.restore_data_scene_progress_with_spatial_environment(
        epoch,
        &handles,
        &state,
        &[],
        &spatial,
        &input
    ));
    e.build_render_commands();
    assert_eq!(e.capture_spatial_environment(), input);
    assert_eq!(e.spatial_scene.environment.frame_values, original_frame);
}

#[test]
fn disabled_native_lighting_preserves_explicit_zero_channels_and_rejects_unused_or_invalid_data() {
    let (mut e, _) = setup();
    let mut off = values();
    off[0] = 0.;
    off[1] = 0.;
    off[2] = -1.;
    off[3] = 0.;
    off[12..60].fill(0.);
    off[91..95].copy_from_slice(&[200., 128., 0.05, 100.]);
    off[112..123].copy_from_slice(&[1., 0., 1., 0., 1., 1., 1., 1., 0.2, 0.2, 0.2]);
    off[512] = 1.;
    off[544] = 0.;
    off[545..549].fill(0.);
    off[549] = 0.;
    assert!(e.configure_spatial_environment(&off));
    e.build_render_commands();
    assert_eq!(e.capture_spatial_environment(), off);
    assert_eq!(
        &e.spatial_scene.environment.frame_values[545..549],
        &[0.; 4]
    );
    assert_eq!(e.spatial_scene.environment.frame_values[544], 0.);
    assert_eq!(e.spatial_scene.environment.frame_values[137], 3.);
    assert_eq!(e.spatial_scene.environment.frame_values[83], 0.);
    assert_eq!(e.spatial_scene.environment.frame_values[92], 0.);
    assert_eq!(e.spatial_scene.environment.frame_values[112], 0.);
    assert_eq!(e.spatial_scene.environment.frame_values[512], 0.);
    assert!(e.spatial_scene.environment.shadow_matrices.is_empty());
    assert!(!e.spatial_scene.environment.shadows());
    for (index, value) in [(544, 65536.), (545, 1.), (552, 1.)] {
        let mut invalid = off.clone();
        invalid[index] = value;
        assert!(!e.configure_spatial_environment(&invalid));
        assert_eq!(e.capture_spatial_environment(), off);
    }
}

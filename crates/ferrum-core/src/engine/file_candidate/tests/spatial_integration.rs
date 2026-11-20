use super::*;

fn fixture() -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    assert!(e.configure_spatial_camera(&[
        0., 48., 120., 120., 48., 16., -32., 240., 0.1, 1000., 800., 480.,
    ]));
    assert!(e.configure_spatial_terrain(
        &[
            0., 0., 32., 64., 0., 0., 0., 1., 1., 1., 1., 32., 0., 32., 64., 0., 16., 16., 1., 1.,
            1., 1.,
        ],
        &[1, 0, 16777215, 1, 2, 0, 16777215, 3]
    ));
    e.build_render_commands();
    e
}

#[test]
fn file_candidate_spatial_actual_render_state_and_six_tick_continuation() {
    let mut source = fixture();
    let file = wire(&source);
    let before = file.clone();
    let memory = persistence::encode(&source).unwrap();
    let mut candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
    assert_eq!(persistence::encode(&candidate.engine).unwrap(), memory);
    for _ in 0..6 {
        source.update_frame(0.01, false, false, false);
        candidate.engine.update_frame(0.01, false, false, false);
        assert_eq!(
            persistence::encode(&source).unwrap(),
            persistence::encode(&candidate.engine).unwrap()
        );
        prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
    }
    assert_eq!(file, before);
}

#[test]
fn file_candidate_spatial_valid_crcs_guard_camera_frame_and_mask_damage_readonly() {
    let source = fixture();
    let original = persistence::encode(&source).unwrap();
    for case in 0..4 {
        let mut damaged = persistence::decode(&original).unwrap();
        match case {
            0 => damaged.spatial_scene.camera.as_mut().unwrap().matrix[0] = f32::NAN,
            1 => damaged.spatial_scene.frame_camera[0] = f32::NAN,
            2 => damaged.spatial_scene.presentation[0] = f32::NAN,
            3 => {
                // An empty mask sidecar is valid and means default masks.
                // Force a nonempty length that cannot match the two surfaces.
                assert_eq!(damaged.spatial_scene.surfaces.len(), 2);
                damaged.spatial_scene.terrain_receiver_masks = vec![Default::default(); 3];
            }
            _ => unreachable!(),
        }
        let file = wire(&damaged);
        let before = file.clone();
        framing::read(&file, &profile(SDK_BUILD), &Limits::default().framing).unwrap();
        assert!(
            matches!(
                prepare(&file, SDK_BUILD, &Limits::default()),
                Err(Error::Spatial(_))
            ),
            "case {case}"
        );
        assert_eq!(file, before);
        assert_eq!(persistence::encode(&source).unwrap(), original);
    }
}

#[test]
fn file_candidate_spatial_common_work_scratch_exact_one_below_and_pending_terrain_clear() {
    let mut source = fixture();
    let file = wire(&source);
    let usage = prepare(&file, SDK_BUILD, &Limits::default())
        .unwrap()
        .usage();
    let exact = Limits {
        max_post_decode_work: usage.post_decode_work,
        max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes,
        ..Limits::default()
    };
    assert_eq!(prepare(&file, SDK_BUILD, &exact).unwrap().usage(), usage);
    assert!(prepare(
        &file,
        SDK_BUILD,
        &Limits {
            max_post_decode_work: usage.post_decode_work - 1,
            ..exact.clone()
        }
    )
    .is_err());
    assert!(prepare(
        &file,
        SDK_BUILD,
        &Limits {
            max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes - 1,
            ..exact
        }
    )
    .is_err());
    assert!(source.configure_spatial_terrain(&[], &[]));
    let pending = persistence::encode(&source).unwrap();
    let file = wire(&source);
    let candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
    assert_eq!(persistence::encode(&candidate.engine).unwrap(), pending);
    assert_eq!(persistence::encode(&source).unwrap(), pending);
}

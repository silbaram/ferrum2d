use super::*;
use crate::engine::persistence;
fn limits() -> Limits {
    Limits {
        max_work: 100_000_000,
        max_scratch_bytes: 32 * 1024 * 1024,
    }
}
fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn fixture() -> Engine {
    fixture_with_engine(Engine::new())
}
fn fixture_with_engine(mut e: Engine) -> Engine {
    e.use_data_scene();
    assert!(e.configure_spatial_camera(&[
        0., 48., 120., 120., 48., 16., -32., 240., 0.1, 1000., 800., 480.
    ]));
    assert!(e.configure_spatial_terrain(
        &[
            0., 0., 32., 64., 0., 0., 0., 1., 1., 1., 1., 32., 0., 32., 64., 0., 16., 16., 1., 1.,
            1., 1.
        ],
        &[1, 0, 16777215, 1, 2, 0, 16777215, 3]
    ));
    e.build_render_commands();
    e
}
#[test]
fn file_spatial_producer_codec_root_geometry_and_pending_reconfigure_are_readonly() {
    let mut e = fixture();
    for state in 0..4 {
        if state == 1 {
            assert!(e.configure_spatial_terrain(&[], &[]));
        }
        if state == 2 {
            e.build_render_commands();
        }
        if state == 3 {
            e.clear_spatial_scene();
        }
        let before = bytes(&e);
        validate(&e, limits()).unwrap();
        assert_eq!(bytes(&e), before);
        let mut r = persistence::decode(&before).unwrap();
        validate(&r, limits()).unwrap();
        assert_eq!(bytes(&r), before);
        e.build_render_commands();
        r.build_render_commands();
        assert_eq!(bytes(&e), bytes(&r));
    }
}
#[test]
fn file_spatial_initial_default_and_exact_quota() {
    for e in [Engine::new(), fixture()] {
        let before = bytes(&e);
        let used = validate(&e, limits()).unwrap();
        assert_eq!(
            validate(
                &e,
                Limits {
                    max_work: used.work,
                    max_scratch_bytes: used.scratch_bytes
                }
            ),
            Ok(used)
        );
        assert_eq!(
            validate(
                &e,
                Limits {
                    max_work: used.work - 1,
                    max_scratch_bytes: used.scratch_bytes
                }
            ),
            Err(Error::WorkLimit)
        );
        assert_eq!(bytes(&e), before);
    }
}

fn environment(length: usize) -> Vec<f32> {
    let mut v = vec![0.; length];
    v[0] = 1.;
    v[1] = 1.;
    v[2] = 0.;
    v[3] = 128.;
    v[4] = 0.05;
    v[5..8].fill(0.15);
    v[12..20].copy_from_slice(&[0., 64., 0., 200., 1., 1., 1., 2.]);
    v[60..76].copy_from_slice(&[
        100., 10., 8., 8., 0., 1., 1., 0., 1., 1., 1., 0., 1000., 0., 0., 0.,
    ]);
    if length >= 512 {
        v[136..142].copy_from_slice(&[4., 1., 0., 128., 0.05, 0.]);
        let light = v[12..20].to_vec();
        v[192..200].copy_from_slice(&light);
    }
    if length >= 576 {
        v[544..546].fill(65535.);
        v[549] = 65535.;
    }
    if length >= 580 {
        v[576..580].copy_from_slice(&[1., 0.15, 0.15, 10.]);
    }
    if length == 584 {
        v[0] = 33.;
        v[128..132].copy_from_slice(&[1., 1., 4., 1.]);
        v[528] = 1.;
        v[580..584].copy_from_slice(&[1., 4., 4., 1.]);
    }
    if length >= 592 {
        v[583] = 1.;
        v[584] = -1.;
        v[588] = -1.;
        v[589] = 1.;
    }
    v
}
#[test]
fn file_spatial_all_fifteen_environment_layouts_and_temporal_ticks_are_readonly() {
    for length in [
        80, 112, 128, 512, 528, 544, 576, 580, 584, 592, 600, 608, 616, 632, 700,
    ] {
        let mut e = fixture();
        assert!(
            e.configure_spatial_environment(&environment(length)),
            "constructor layout{length}"
        );
        for tick in 0..4 {
            if tick != 0 {
                e.update_frame(0.01, false, false, false);
            }
            let before = bytes(&e);
            validate(&e, limits())
                .unwrap_or_else(|error| panic!("layout{length}/tick{tick}: {error:?}"));
            assert_eq!(bytes(&e), before);
            let mut r = persistence::decode(&before).unwrap();
            validate(&r, limits()).unwrap();
            r.update_frame(0.01, false, false, false);
            let mut copy = persistence::decode(&before).unwrap();
            copy.update_frame(0.01, false, false, false);
            assert_eq!(bytes(&r), bytes(&copy));
        }
    }
}

fn sprite(e: &mut Engine, x: f32, y: f32) -> crate::entity::Entity {
    assert!(e.spawn_data_scene_entity(
        x,
        y,
        0.,
        0,
        71,
        32.,
        64.,
        0.,
        0.,
        1.,
        1.,
        0,
        0.,
        crate::engine::PHYSICS_LAYER_PLAYER,
        crate::engine::PHYSICS_COLLIDER_TYPE_AABB,
        0.,
        0.,
        true,
        true,
        8.,
        8.,
        0.,
        0.,
        0.,
        0.,
        0.,
        0.,
        vec![]
    ));
    crate::entity::Entity {
        id: e.data_scene_entity_id(),
        generation: e.data_scene_entity_generation(),
    }
}
fn rich() -> (Engine, [crate::entity::Entity; 2]) {
    let mut e = fixture_with_engine(crate::engine::legacy_test_fixture::engine());
    let a = sprite(&mut e, 8., 16.);
    e.world.set_aabb_collider(
        a,
        crate::components::AabbCollider::new(
            2.,
            2.,
            false,
            crate::components::CollisionLayer::Player,
        ),
    );
    let child = sprite(&mut e, 12., 16.);
    assert!(e.configure_data_scene_body(a.id, a.generation, 1, true, 0, 0., 8.));
    assert!(e.configure_data_scene_body(child.id, child.generation, 0, true, 0, 0., 4.));
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    assert!(e.spatial_scene.models.configure(
        &e.world,
        &[
            a.id,
            a.generation,
            1,
            3,
            1,
            12,
            child.id,
            child.generation,
            10,
            3,
            1,
            12
        ],
        &[0., 0., 1., -4., 0., -4., 4., 24., 4., 0., 0., 1., -4., 0., -4., 4., 24., 4.]
    ));
    assert!(e.configure_spatial_model_streaming(
        &[-10., -10., -10., 50., 50., 50., 200., 300.],
        &[
            a.id,
            a.generation,
            1,
            1,
            12,
            1,
            a.id,
            a.generation,
            2,
            1,
            2,
            1,
            child.id,
            child.generation,
            10,
            1,
            12,
            0,
            child.id,
            child.generation,
            11,
            1,
            2,
            0
        ],
        &[0., 100., 0., 100.]
    ));
    assert!(e.configure_spatial_attachments(
        &[child.id, child.generation, a.id, a.generation, 1],
        &[4., 0., 0., 0.]
    ));
    assert!(e.configure_data_scene_sprite_clips(
        a.id,
        a.generation,
        &[0., 4., 6., 1.],
        &[0., 0., 0.25, 1., 0.25, 0., 0.5, 1., 0.5, 0., 0.75, 1., 0.75, 0., 1., 1.],
        0
    ));
    assert!(e.configure_spatial_environment(&environment(700)));
    assert!(e.configure_spatial_debug(255));
    assert!(e.configure_spatial_actor(a.id, a.generation, 96., 8., 40.));
    assert_ne!(
        e.begin_data_scene_authoring_continuity(&[a.id, a.generation], &[3]),
        0
    );
    e.build_render_commands();
    (e, [a, child])
}
fn check(e: &Engine) {
    let before = bytes(e);
    validate(e, limits()).unwrap();
    assert_eq!(bytes(e), before);
    let r = persistence::decode(&before).unwrap();
    validate(&r, limits()).unwrap();
    assert_eq!(bytes(&r), before);
}
#[test]
fn file_spatial_models_attachments_clips_continuity_pending_and_stale_generations_continue() {
    let (mut e, [a, child]) = rich();
    check(&e);
    assert!(e.move_data_scene_spatial_actor_to(16., 40., 0, 24., 8., 0., true));
    let before = bytes(&e);
    let mut r = persistence::decode(&before).unwrap();
    for dt in [0., 0.01, 0.05, 0.0, 0.01] {
        e.update_frame(dt, false, false, false);
        r.update_frame(dt, false, false, false);
        check(&e);
        check(&r);
        assert_eq!(bytes(&e), bytes(&r));
    }
    assert!(e.set_spatial_preview_filter(&[child.id, child.generation], &[2]));
    check(&e);
    // An active/old draw and attachment history can refer to a despawned full
    // generation until the next producer pass; capture does not synchronize it.
    e.world.despawn(a);
    assert!(!e.world.is_current_entity(a));
    check(&e);
    let pending = bytes(&e);
    let mut r = persistence::decode(&pending).unwrap();
    e.update_frame(0.01, false, false, false);
    r.update_frame(0.01, false, false, false);
    check(&e);
    check(&r);
    assert_eq!(bytes(&e), bytes(&r));
    e.use_data_scene();
    check(&e); // Pending continuity intentionally owns old clips/LOD.
}
fn navigation_fixture() -> Engine {
    use crate::components::{AabbCollider, CollisionLayer};
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_data_scene();
    assert!(e.configure_spatial_camera(&[
        0., 0., 100., 200., 0., 16., 0., 200., 0.1, 1000., 400., 300.
    ]));
    let actor = sprite(&mut e, 0., 16.);
    e.world.set_aabb_collider(
        actor,
        AabbCollider::new(2., 2., false, CollisionLayer::Player),
    );
    assert!(e.configure_data_scene_body(actor.id, actor.generation, 1, true, 0, 0., 8.));
    assert!(e.configure_spatial_terrain(
        &[
            -32., 0., 64., 32., 0., 0., 0., 1., 1., 1., 1., -32., 32., 64., 32., 0., 0., 32., 1.,
            1., 1., 1., -32., 64., 64., 48., 24., 32., 32., 1., 1., 1., 1.
        ],
        &[1, 0, 16777215, 1, 2, 0, 16777215, 5, 3, 1, 16777215, 9]
    ));
    assert!(e.spatial_scene.configure_connections(&[2, 3]));
    assert!(e.configure_spatial_actor(actor.id, actor.generation, 96., 8., 40.));
    assert!(e.move_data_scene_spatial_actor_to(0., 88., 1, 96., 8., 0., true));
    e
}
#[test]
fn file_spatial_astar_nodes_heap_cells_active_follower_and_old_terrain_scratch_are_preserved() {
    let mut e = navigation_fixture();
    check(&e);
    let mut r = persistence::decode(&bytes(&e)).unwrap();
    for dt in [0., 0.01, 0.02, 0.06, 0.01] {
        e.update_frame(dt, false, false, false);
        r.update_frame(dt, false, false, false);
        check(&e);
        check(&r);
        assert_eq!(bytes(&e), bytes(&r));
    }
    assert!(e.configure_spatial_terrain(&[], &[]));
    check(&e);
    let mut r = persistence::decode(&bytes(&e)).unwrap();
    e.update_frame(0.01, false, false, false);
    r.update_frame(0.01, false, false, false);
    check(&e);
    check(&r);
    assert_eq!(bytes(&e), bytes(&r));
}
#[test]
fn file_spatial_moving_platform_origin_phase_geometry_and_tilemap_cache_stay_exact() {
    let mut e = fixture();
    assert!(e.configure_spatial_moving_platforms(&[2., 1., 0., 0., 4., 1., 0.25, 0.]));
    check(&e);
    let mut r = persistence::decode(&bytes(&e)).unwrap();
    for dt in [0., 0.01, 0.12, 0.5, 0.0] {
        e.update_frame(dt, false, false, false);
        r.update_frame(dt, false, false, false);
        check(&e);
        check(&r);
        assert_eq!(bytes(&e), bytes(&r));
    }
}

#[test]
fn file_spatial_valid_crc_malformed_owner_fields_reject_without_changing_source_or_candidate() {
    let (e, _) = rich();
    check(&e);
    let original = bytes(&e);
    for case in 0..39 {
        let mut candidate = persistence::decode(&original).unwrap();
        if case < 36 {
            candidate.spatial_scene.corrupt_file_fixture(case);
        } else {
            candidate
                .authoring_continuity
                .corrupt_file_fixture(case - 36);
        }
        let malformed = bytes(&candidate);
        assert_ne!(malformed, original, "case{case} must change actual wire");
        let decoded = persistence::decode(&malformed).unwrap();
        assert!(
            matches!(validate(&decoded, limits()), Err(Error::Invalid { .. })),
            "case{case}: {:?}",
            validate(&decoded, limits())
        );
        assert_eq!(bytes(&decoded), malformed);
        assert_eq!(bytes(&e), original);
    }
}

#[test]
fn file_spatial_astar_malformed_parent_cells_and_raw_heap_reject_before_consumption() {
    let live = navigation_fixture();
    check(&live);
    let original = bytes(&live);
    for case in 2..6 {
        let mut candidate = persistence::decode(&original).unwrap();
        candidate
            .spatial_scene
            .navigation
            .corrupt_file_fixture(case);
        let malformed = bytes(&candidate);
        let decoded = persistence::decode(&malformed).unwrap();
        assert!(
            matches!(
                validate(&decoded, limits()),
                Err(Error::Invalid {
                    field: crate::spatial_scene::file_admission::Field::Navigation,
                    ..
                })
            ),
            "case{case}"
        );
        assert_eq!(bytes(&decoded), malformed);
        assert_eq!(bytes(&live), original);
    }
    let malformed = live
        .spatial_scene
        .navigation
        .malformed_file_heap_packet(&original);
    assert_ne!(malformed, original);
    assert!(matches!(
        persistence::decode(&malformed),
        Err(crate::engine::RuntimeCheckpointError::InvalidState)
    ));
    assert_eq!(bytes(&live), original);
}

fn lighting_features() -> Vec<f32> {
    let mut v = environment(700);
    v[0] = 3.;
    v[1] = 4.;
    v[12..60].fill(0.);
    v[136..142].copy_from_slice(&[4., 5., 2., 128., 0.05, 0.]);
    for (source, x) in [-64., 0., 64., 128., 256.].into_iter().enumerate() {
        let p = 192 + source * 20;
        v[p..p + 8].copy_from_slice(&[x, 64., 0., 300., 1., 1., 1., 2.]);
    }
    for (slot, source) in [2, 0, 1, 3].into_iter().enumerate() {
        let light = v[192 + source * 20..200 + source * 20].to_vec();
        v[12 + slot * 12..20 + slot * 12].copy_from_slice(&light);
    }
    v[544..549].fill(65535.);
    v[549..554].fill(65535.);
    v[584..590].copy_from_slice(&[0., 256., 0.1, 0.2, 1., 1.]);
    v[83..95].copy_from_slice(&[1., 0., 1., 0., 2., 1., 1., 1., 200., 128., 0.05, 128.]);
    v[512..516].copy_from_slice(&[1., 10., 20., -30.]);
    v[528] = 1.;
    v[592..595].copy_from_slice(&[1., 1., 8.]);
    v[600..604].copy_from_slice(&[1., 5., 8., 0.]);
    v[604..608].copy_from_slice(&[1., 10., 16., 0.]);
    v[608..612].copy_from_slice(&[1., 0., 0.1, 0.2]);
    v[616..626].copy_from_slice(&[1., 0.5, 0.01, 200., 1., 1., 1., 0.9, 2., 32.]);
    v[632] = 1.;
    v[633] = 1.;
    v[636..644].copy_from_slice(&[0., 64., 0., 200., 1., 1., 1., 1.]);
    v
}
#[test]
fn file_spatial_sun_two_point_shadows_temporal_fades_and_disabled_source_history() {
    let (mut e, [actor, _]) = rich();
    let mut source = lighting_features();
    assert!(e.configure_spatial_environment(&source));
    check(&e);
    e.build_render_commands();
    check(&e);
    assert!(e.configure_spatial_light_bindings(&[1, actor.id, actor.generation], &[1.]));
    check(&e);
    e.update_frame(0.01, true, false, false);
    check(&e);
    assert!(e.configure_spatial_camera(&[
        0., 256., 120., 120., 256., 16., -32., 240., 0.1, 1000., 800., 480.
    ]));
    check(&e);
    let mut r = persistence::decode(&bytes(&e)).unwrap();
    for (dt, render) in [
        (0.01, false),
        (0.02, true),
        (0., false),
        (0.04, true),
        (0.1, true),
    ] {
        e.update_frame(dt, render, false, false);
        r.update_frame(dt, render, false, false);
        check(&e);
        check(&r);
        assert_eq!(bytes(&e), bytes(&r));
    }
    source[0] = 2.;
    source[1] = 0.;
    source[2] = -1.;
    source[3] = 0.;
    source[12..60].fill(0.);
    source[144..176].fill(0.);
    source[545..549].fill(0.);
    source[588] = -1.;
    assert!(e.configure_spatial_environment(&source));
    check(&e);
    e.update_frame(0.01, true, false, false);
    check(&e);
    assert_eq!(e.capture_spatial_environment(), source);
}
#[test]
fn file_spatial_quotas_include_nested_scratch_and_inactive_metadata_is_not_repaired() {
    let (mut e, _) = rich();
    e.update_frame(0.01, false, false, false);
    assert!(
        !e.spatial_scene.frame_active
            && e.spatial_scene.billboards.is_empty()
            && !e.spatial_scene.billboard_materials.is_empty()
    );
    let before = bytes(&e);
    let used = validate(&e, limits()).unwrap();
    assert!(used.scratch_bytes > 0);
    for (limit, expected) in [
        (
            Limits {
                max_work: used.work,
                max_scratch_bytes: used.scratch_bytes,
            },
            Ok(used),
        ),
        (
            Limits {
                max_work: used.work - 1,
                max_scratch_bytes: used.scratch_bytes,
            },
            Err(Error::WorkLimit),
        ),
        (
            Limits {
                max_work: used.work,
                max_scratch_bytes: used.scratch_bytes - 1,
            },
            Err(Error::ScratchLimit),
        ),
        (
            Limits {
                max_work: 0,
                max_scratch_bytes: 0,
            },
            Err(Error::WorkLimit),
        ),
    ] {
        assert_eq!(validate(&e, limit), expected);
        assert_eq!(bytes(&e), before);
    }
    let mut c = persistence::decode(&before).unwrap();
    c.spatial_scene
        .physics
        .set_layer(0, 1, 1, 17., 64., 0., 0., true, vec![1]);
    let malformed = bytes(&c);
    let decoded = persistence::decode(&malformed).unwrap();
    assert!(matches!(
        validate(&decoded, limits()),
        Err(Error::Invalid { .. })
    ));
    assert_eq!(bytes(&decoded), malformed);
    assert_eq!(bytes(&e), before);
}

fn collection_fixture() -> Engine {
    let (mut e, [a, child]) = rich();
    assert!(e.configure_spatial_billboards(
        &[a.id, a.generation, child.id, child.generation],
        &[1., 0.5, 0., 1.25, 0.25, 1.],
    ));
    // Separated actual handles/IDs make the entire target wire field unique.
    let mut hidden = Vec::new();
    loop {
        let entity = e.world.spawn_entity();
        if [137, 281].contains(&entity.id) {
            hidden.extend_from_slice(&[entity.id, entity.generation]);
        }
        if entity.id >= 281 {
            break;
        }
    }
    assert!(e.configure_spatial_terrain(
        &[
            0., 0., 32., 64., 0., 0., 0., 1., 1., 1., 1., 32., 0., 32., 64., 0., 16., 16., 1., 1.,
            1., 1.
        ],
        &[34017, 0, 16777215, 1, 51029, 0, 16777215, 3],
    ));
    assert!(e.set_spatial_preview_filter(&hidden, &[34017, 51029]));
    e
}

#[test]
fn file_spatial_collection_order_and_duplicate_wire_rejects_all_six_actual_engine_fields() {
    let e = collection_fixture();
    let nav = navigation_fixture();
    for collection in 0..6 {
        let source = if collection == 5 { &nav } else { &e };
        check(source);
        let original = bytes(source);
        for duplicate in [false, true] {
            let malformed = source
                .spatial_scene
                .file_collection_packet(&original, collection, duplicate);
            assert_ne!(malformed, original);
            assert!(
                matches!(
                    persistence::decode(&malformed),
                    Err(crate::engine::RuntimeCheckpointError::InvalidState)
                ),
                "collection={collection} duplicate={duplicate}"
            );
            check(source);
            assert_eq!(bytes(source), original);
            println!("SPATIAL_COLLECTION_AFTER collection={collection} duplicate={duplicate} rejected=true source_preserved=true original={} malformed={}", original.len(), malformed.len());
        }
    }
}

#[test]
fn file_spatial_collection_normal_producer_reverse_duplicate_input_and_continuation_keep_bytes() {
    let mut e = collection_fixture();
    assert!(e.set_spatial_preview_filter(&[281, 0, 137, 0, 281, 0], &[51029, 34017, 51029]));
    check(&e);
    let mut restored = persistence::decode(&bytes(&e)).unwrap();
    for dt in [0., 0.01, 0.05] {
        e.update_frame(dt, false, false, true);
        restored.update_frame(dt, false, false, true);
        check(&e);
        check(&restored);
        assert_eq!(bytes(&e), bytes(&restored));
    }
    let mut nav = navigation_fixture();
    let mut restored = persistence::decode(&bytes(&nav)).unwrap();
    for dt in [0., 0.01, 0.05] {
        nav.update_frame(dt, false, false, true);
        restored.update_frame(dt, false, false, true);
        check(&nav);
        check(&restored);
        assert_eq!(bytes(&nav), bytes(&restored));
    }
}

use super::*;
use crate::engine::{
    file_candidate as candidate, file_engine_section, file_envelope as framing, file_sharing,
    persistence,
};
use crate::gameplay_event::GAMEPLAY_EVENT_TERRAIN_IMPACT;
use crate::physics3d::{QueryFilter, RayCast, Shape};
const SDK: u64 = 0x1122334455667788;
fn engine(space: Space, bodies: usize, colliders: usize) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.; 3],
        max_bodies: bodies,
        max_colliders: colliders,
        ..Default::default()
    })
    .unwrap();
    e
}
fn grid(e: &mut Engine, w: u32, h: u32) {
    e.tilemap
        .set_layer(0, w, h, 1., 1., 0., 0., true, vec![1; (w * h) as usize]);
}
fn ray(e: &mut Engine, y: f32) -> Vec<UnifiedTerrainRayHit> {
    let mut out = Vec::new();
    e.cast_unified_terrain_ray_all(
        &RayCast {
            origin: [-1., y, 0.],
            direction: [1., 0., 0.],
            max_distance: 1000.,
            solid: true,
        },
        &QueryFilter {
            include_sensors: true,
            respect_target_mask: false,
            ..Default::default()
        },
        &mut out,
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .config()
            .max_colliders,
    )
    .unwrap();
    out
}
fn wire(e: &Engine) -> Vec<u8> {
    let limits = candidate::Limits::default();
    let (tables, _) = file_sharing::capture(
        e,
        file_sharing::Limits {
            max_work: limits.max_post_decode_work,
            max_scratch_bytes: limits.max_post_decode_scratch_bytes,
            max_roots: limits.max_alias_roots,
            max_compare_bytes: limits.max_alias_compare_bytes,
        },
    )
    .unwrap();
    let memory = persistence::encode(e).unwrap();
    let section = file_engine_section::encode(&memory, &tables.arcs, &tables.shapes).unwrap();
    framing::encode(
        &candidate::profile(SDK),
        &framing::Sections {
            engine: &section,
            variables: b"{}",
            authoring: b"{}",
            resource_manifest: b"{}",
            resource_data: b"{}",
            dialogue_quest: b"{}",
            host_bindings: b"{}",
        },
        &framing::Limits::default(),
    )
    .unwrap()
}
fn admitted(e: &Engine) -> candidate::Usage {
    candidate::prepare(&wire(e), SDK, &candidate::Limits::default())
        .unwrap()
        .usage()
}
fn native_query(e: &mut Engine, purpose: u32, limit: u32) -> usize {
    let mut m = [0u32; 12];
    let mut v = [0.; 13];
    m[1] = purpose << 6;
    m[2] = u32::MAX;
    m[3] = u32::MAX;
    m[9] = limit;
    v[0] = -1.;
    v[1] = 0.5;
    v[6] = 1.;
    v[7] = 1.;
    v[10] = 20.;
    e.query_unified_physics(&m, &v, &[], &[]).unwrap();
    e.unified_physics_query_hit_count()
}
#[test]
fn terrain_integration_chunks_keep_each_geometry_identity_and_separate_capacity_limits() {
    let mut e = engine(Space::PlanarXy, 1, 64);
    grid(&mut e, 8, 8);
    let initial = ray(&mut e, 0.5);
    assert_eq!(initial.len(), 8);
    let rt = e.unified_physics.as_ref().unwrap();
    assert_eq!(
        (rt.physics.body_count(), rt.physics.collider_count()),
        (1, 64)
    );
    let body = initial[0].hit.target.body;
    assert!(initial.iter().all(|h| h.hit.target.body == body));
    assert_eq!(
        initial.iter().map(|h| h.source).collect::<Vec<_>>(),
        (0..8)
            .map(|tile| UnifiedTerrainSource::Tile { layer: 0, tile })
            .collect::<Vec<_>>()
    );
    admitted(&e);
    e.tilemap.set_tile(0, 1, 0, 0);
    let removed = ray(&mut e, 0.5);
    assert_eq!(removed.len(), 7);
    assert_eq!(removed[0].hit.target, initial[0].hit.target);
    assert_eq!(removed[1].hit.target, initial[2].hit.target);
    e.tilemap.set_tile(0, 1, 0, 1);
    let readded = ray(&mut e, 0.5);
    assert_ne!(
        readded[1].hit.target.collider,
        initial[1].hit.target.collider
    );
    assert_eq!(readded[1].hit.target.body, body);
    admitted(&e);
    let mut too_small = engine(Space::PlanarXy, 1, 63);
    grid(&mut too_small, 8, 8);
    let mut unchanged = initial.clone();
    assert!(too_small
        .cast_unified_terrain_ray_all(
            &RayCast {
                origin: [-1., 0.5, 0.],
                direction: [1., 0., 0.],
                max_distance: 20.,
                solid: true
            },
            &QueryFilter::default(),
            &mut unchanged,
            1
        )
        .is_err());
    assert_eq!(unchanged, initial);
    assert_eq!(
        too_small
            .unified_physics
            .as_ref()
            .unwrap()
            .physics
            .collider_count(),
        0
    );
}
#[test]
fn terrain_integration_native_tile_legacy_views_and_vision_apply_authored_flags_before_limit() {
    let mut e = engine(Space::PlanarXy, 4, 16);
    assert!(e
        .tilemap
        .set_tile_hd2d_definition(1, 1, false, false, true, 1., false, 0, 0., 0.));
    assert!(e
        .tilemap
        .set_tile_hd2d_definition(2, 1, true, true, false, 1., false, 0, 0., 0.));
    e.tilemap
        .set_layer(0, 2, 1, 1., 1., 0., 0., true, vec![1, 2]);
    assert_eq!(native_query(&mut e, 4, 1), 1);
    assert_eq!(
        e.unified_physics.as_ref().unwrap().native_ray_hits[0].distance,
        1.
    );
    assert_eq!(native_query(&mut e, 3, 1), 1);
    assert_eq!(
        e.unified_physics.as_ref().unwrap().native_ray_hits[0].distance,
        2.
    );
    assert_eq!(e.raycast_tile_obstacles(-1., 0.5, 1., 0., 20.), 1);
    assert_eq!(e.physics_tile_shape_cast_hits[0].tile_index, 1);
    assert_eq!(e.segment_cast_tile_obstacles(-1., 0.5, 4., 0.5), 1);
    assert_eq!(
        e.shape_cast_aabb_tile_obstacles(-1., 0.5, 0.2, 0.2, 1., 0., 20.),
        1
    );
    assert!(e.query_nearest_tile_obstacle(-1., 0.5, 20.));
    assert_eq!(e.physics_query_result.tile_index, 1);
    assert_eq!(e.query_aabb_tile_obstacle_contacts(1.1, 0.5, 0.2, 0.2), 1);
    assert!(e.physics_tile_contact_hits[0].penetration > 0.);
    assert_eq!(e.query_aabb_tile_obstacle_manifolds(1.1, 0.5, 0.2, 0.2), 1);
    assert!(e.physics_tile_manifold_hits[0].point_count >= 1);
    // An explicit span never invents a default span for unspanned native terrain.
    assert_eq!(
        e.raycast_tile_obstacles_with_height_span(-1., 0.5, 1., 0., 20., 0, 0., 1.),
        0
    );
    admitted(&e);
}
#[test]
fn terrain_integration_render_samples_turnaround_without_moving_physics_or_picker_revision() {
    let mut e = super::platform_tests::engine(0.1);
    // Platform offsets are dx/dy/dh; physical Y-up interpolation uses dh.
    super::platform_tests::configure(&mut e, [1., 0., 1.], 0.05, 0.025);
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    assert_eq!(e.unified_physics_error(), None);
    let physics = e
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .capture_snapshot()
        .unwrap();
    let revision = e.spatial_terrain_revision();
    let source = e.spatial_scene.terrain.clone();
    e.world.set_render_interpolation_alpha(Some(0.25));
    e.build_render_commands();
    let platform = e.spatial_scene.moving_platforms[0];
    let sample = platform.surface_at(0.05);
    let current = e.spatial_scene.surfaces[0];
    let delta = [
        sample.bounds[0] - current.bounds[0],
        sample.base - current.base,
        current.bounds[1] - sample.bounds[1],
    ];
    assert!(delta[0] > 0.4 && delta[1] > 0.4);
    for (a, b) in e.spatial_scene.presented_terrain().iter().zip(&source) {
        for (axis, offset) in delta.iter().enumerate() {
            assert!((a.position[axis] - b.position[axis] - offset).abs() < 1e-5);
        }
    }
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert_eq!(e.spatial_scene.terrain, source);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap()
            .encoded_bytes(),
        physics.encoded_bytes()
    );
    let render_revision = e.spatial_terrain_render_revision();
    e.build_render_commands();
    assert_eq!(e.spatial_terrain_render_revision(), render_revision);
    admitted(&e);
    e.world.set_render_interpolation_alpha(None);
    e.build_render_commands();
    assert_eq!(e.spatial_scene.presented_terrain(), source);
    assert_ne!(e.spatial_terrain_render_revision(), render_revision);
    admitted(&e);
}
#[test]
fn terrain_integration_actual_solved_contact_reaches_typed_gameplay_audio_and_native_frame_storage()
{
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space, 8, 16);
        grid(&mut e, 1, 1);
        assert!(e.configure_physics_impact_feedback(&[
            u32::MAX as f64,
            0.,
            0.5,
            7.,
            u32::MAX as f64,
            0.5
        ]));
        let entity = e
            .create_unified_body(
                BodyDesc {
                    pose: Pose {
                        position: if space == Space::PlanarXy {
                            [-0.3, 0.5, 0.]
                        } else {
                            [-0.3, 0.5, -0.5]
                        },
                        ..Default::default()
                    },
                    linear_velocity: [5., 0., 0.],
                    ccd: true,
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
                [0.; 3],
            )
            .unwrap();
        let mut observed = false;
        for _ in 0..10 {
            e.update(1. / 60.);
            if e.terrain_impact_count() > 0 {
                let rt = e.unified_physics.as_ref().unwrap();
                let row = rt.contacts.terrain_events[0];
                assert_eq!(row.actor, [entity.id, entity.generation]);
                assert_eq!(row.terrain, [1, 0, 0]);
                assert!(row.impulse > 0.);
                assert!(row.point[0].abs() < 0.05);
                assert!(row.normal[0] < -0.9);
                let event = e
                    .frame_buffers
                    .gameplay_events
                    .iter()
                    .find(|v| v.kind == GAMEPLAY_EVENT_TERRAIN_IMPACT)
                    .unwrap();
                assert_eq!(event.source_id, u32::MAX);
                assert_eq!(event.payload_bits, 0);
                assert!(e
                    .frame_buffers
                    .audio_events
                    .iter()
                    .any(|a| a.sound_id == 7.));
                assert!(e.unified_contact_impulses().unwrap().is_empty());
                admitted(&e);
                observed = true;
                break;
            }
        }
        assert!(observed);
        e.world.despawn(entity);
        admitted(&e);
        e.clear_gameplay_events();
        assert_eq!(e.terrain_impact_count(), 0);
    }
}
#[test]
fn terrain_integration_stored_new_owners_crc_corruption_exact_budget_and_six_tick_continuation() {
    let mut e = super::platform_tests::engine(0.01);
    super::platform_tests::configure(&mut e, [1., 0.2, 0.], 0.1, 0.03);
    e.configure_physics_render_interpolation(true);
    e.update(0.014);
    // The damage case below targets an actual successful interpolation cache.
    assert_ne!(
        e.spatial_scene.presented_terrain().as_ptr(),
        e.spatial_scene.terrain.as_ptr()
    );
    let file = wire(&e);
    let before = persistence::encode(&e).unwrap();
    let usage = candidate::prepare(&file, SDK, &candidate::Limits::default())
        .unwrap()
        .usage();
    let exact = candidate::Limits {
        max_post_decode_work: usage.post_decode_work,
        max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes,
        ..Default::default()
    };
    assert_eq!(
        candidate::prepare(&file, SDK, &exact).unwrap().usage(),
        usage
    );
    assert!(candidate::prepare(
        &file,
        SDK,
        &candidate::Limits {
            max_post_decode_work: usage.post_decode_work - 1,
            ..exact.clone()
        }
    )
    .is_err());
    assert!(candidate::prepare(
        &file,
        SDK,
        &candidate::Limits {
            max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes - 1,
            ..exact
        }
    )
    .is_err());
    let mut restored = candidate::prepare(&file, SDK, &candidate::Limits::default())
        .unwrap()
        .into_owned_parts()
        .engine
        .unwrap();
    assert_eq!(persistence::encode(&restored).unwrap(), before);
    for _ in 0..6 {
        e.update(0.013);
        restored.update(0.013);
        assert_eq!(
            persistence::encode(&e).unwrap(),
            persistence::encode(&restored).unwrap()
        );
    }
    for case in 0..3 {
        let mut malformed = persistence::decode(&before).unwrap();
        if case == 0 {
            malformed
                .unified_physics
                .as_mut()
                .unwrap()
                .platform_motion
                .corrupt_render_history_fixture();
        }
        if case == 1 {
            malformed
                .spatial_scene
                .corrupt_terrain_presentation_fixture();
        }
        if case == 2 {
            malformed
                .unified_physics
                .as_mut()
                .unwrap()
                .terrain
                .registered
                .values_mut()
                .next()
                .unwrap()
                .wanted
                .blocking = 8;
        }
        let bytes = persistence::encode(&malformed).unwrap();
        let valid_crc = wire(&malformed);
        assert!(
            candidate::prepare(&valid_crc, SDK, &candidate::Limits::default()).is_err(),
            "case{case}"
        );
        assert_eq!(persistence::encode(&malformed).unwrap(), bytes);
    }
}
#[test]
fn terrain_integration_chunk_cost_scenarios_report_existing_model_counts_storage_and_replacement() {
    for side in [8u32, 32, 64] {
        let cells = (side * side) as usize;
        let bodies = (side.div_ceil(8) * side.div_ceil(8)) as usize;
        let mut e = engine(Space::PlanarXy, bodies, cells);
        grid(&mut e, side, side);
        let start = std::time::Instant::now();
        let first = ray(&mut e, 0.5);
        let prepare = start.elapsed();
        assert_eq!(
            e.unified_physics.as_ref().unwrap().physics.body_count(),
            bodies
        );
        assert_eq!(
            e.unified_physics.as_ref().unwrap().physics.collider_count(),
            cells
        );
        let start = std::time::Instant::now();
        let bytes = persistence::encode(&e).unwrap();
        let capture = start.elapsed();
        e.tilemap.set_tile(0, 1, 0, 0);
        let start = std::time::Instant::now();
        let next = ray(&mut e, 0.5);
        let replace = start.elapsed();
        assert_eq!(first[0].hit.target, next[0].hit.target);
        assert_eq!(first[2].hit.target, next[1].hit.target);
        eprintln!("terrain-cost cells={cells} fixed_bodies={bodies} colliders={cells} checkpoint_bytes={} prepare_us={} capture_us={} one_cell_replace_us={}",bytes.len(),prepare.as_micros(),capture.as_micros(),replace.as_micros());
        // No invented wall-clock threshold. Native configured body/collider caps
        // and 64-collider body limit are the acceptance contract.
    }
}

#[test]
fn terrain_integration_chunk_span_discontinuities_keep_distinct_native_bodies_and_height_queries() {
    let mut e = engine(Space::PlanarXy, 2, 2);
    e.tilemap.set_tile_height_span_definition(1, 3, 0., 2.);
    e.tilemap.set_tile_height_span_definition(2, 7, 0., 2.);
    e.tilemap
        .set_layer(0, 2, 1, 1., 1., 0., 0., true, vec![1, 2]);
    let hits = ray(&mut e, 0.5);
    assert_eq!(hits.len(), 2);
    assert_ne!(hits[0].hit.target.body, hits[1].hit.target.body);
    assert_eq!(
        e.raycast_tile_obstacles_with_height_span(-1., 0.5, 1., 0., 20., 3, 0., 1.),
        1
    );
    assert_eq!(e.physics_tile_shape_cast_hits[0].tile_index, 0);
    assert_eq!(
        e.raycast_tile_obstacles_with_height_span(-1., 0.5, 1., 0., 20., 7, 0., 1.),
        1
    );
    assert_eq!(e.physics_tile_shape_cast_hits[0].tile_index, 1);
    admitted(&e);
    let mut bad = engine(Space::PlanarXy, 1, 2);
    bad.tilemap = e.tilemap.clone();
    let mut out = hits.clone();
    assert!(bad
        .cast_unified_terrain_ray_all(
            &RayCast {
                origin: [-1., 0.5, 0.],
                direction: [1., 0., 0.],
                max_distance: 20.,
                solid: true
            },
            &QueryFilter::default(),
            &mut out,
            1
        )
        .is_err());
    assert_eq!(out, hits);
}

#[test]
fn terrain_integration_kind15_sentinel_sidecar_actor_index_and_native_absence_are_cold_checked() {
    use crate::engine::file_physics_output_admission::{Error, Limits};
    use crate::engine::{file_frame_admission, file_runtime_observation_admission as runtime};
    let limits = Limits {
        max_work: 10000000,
        max_scratch_bytes: 10000000,
    };
    let mut e = engine(Space::PlanarXy, 8, 16);
    grid(&mut e, 1, 1);
    e.create_unified_body(
        BodyDesc {
            pose: Pose {
                position: [-0.3, 0.5, 0.],
                ..Default::default()
            },
            linear_velocity: [5., 0., 0.],
            ccd: true,
            ..Default::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
        [0.; 3],
    )
    .unwrap();
    for _ in 0..10 {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
        if e.terrain_impact_count() > 0 {
            break;
        }
    }
    assert!(e.terrain_impact_count() > 0);
    admitted(&e);
    runtime::validate(&e, limits).unwrap();
    let source = persistence::encode(&e).unwrap();
    for case in 0..5 {
        let mut bad = persistence::decode(&source).unwrap();
        let event = bad
            .frame_buffers
            .gameplay_events
            .iter_mut()
            .find(|v| v.kind == GAMEPLAY_EVENT_TERRAIN_IMPACT)
            .unwrap();
        match case {
            0 => event.source_id = 0,
            1 => event.source_generation = 1,
            2 => event.payload_bits = u32::MAX,
            3 => event.actor_generation = event.actor_generation.wrapping_add(1),
            4 => {
                bad.unified_physics
                    .as_mut()
                    .unwrap()
                    .contacts
                    .terrain_events[0]
                    .actor[0] = u32::MAX
            }
            _ => unreachable!(),
        }
        let malformed = persistence::encode(&bad).unwrap();
        if case <= 1 {
            assert!(file_frame_admission::validate(
                &bad.frame_buffers,
                file_frame_admission::Limits { max_work: 1000000 }
            )
            .is_err());
        }
        assert!(
            matches!(
                runtime::validate(&bad, limits),
                Err(Error::Invalid {
                    owner: "terrain_events",
                    ..
                })
            ),
            "case{case}"
        );
        let valid_crc = wire(&bad);
        assert!(
            candidate::prepare(&valid_crc, SDK, &candidate::Limits::default()).is_err(),
            "case{case}"
        );
        assert_eq!(persistence::encode(&bad).unwrap(), malformed);
        assert_eq!(persistence::encode(&e).unwrap(), source);
    }
    let mut absent = Engine::new();
    assert!(absent.select_legacy_physics_defaults());
    absent.use_data_scene();
    assert!(absent.unified_physics.is_none());
    let actor = absent.world.spawn_entity();
    absent
        .frame_buffers
        .gameplay_events
        .push(crate::gameplay_event::GameplayEvent {
            kind: GAMEPLAY_EVENT_TERRAIN_IMPACT,
            actor_id: actor.id,
            actor_generation: actor.generation,
            source_id: u32::MAX,
            source_generation: 0,
            token_id: 1,
            flags: 0,
            payload_bits: 0,
        });
    file_frame_admission::validate(
        &absent.frame_buffers,
        file_frame_admission::Limits { max_work: 1000000 },
    )
    .unwrap();
    let before = persistence::encode(&absent).unwrap();
    assert!(matches!(
        runtime::validate(&absent, limits),
        Err(Error::Invalid {
            owner: "terrain_events",
            field: "native_owner_absent",
            ..
        })
    ));
    assert!(candidate::prepare(&wire(&absent), SDK, &candidate::Limits::default()).is_err());
    assert_eq!(persistence::encode(&absent).unwrap(), before);
}

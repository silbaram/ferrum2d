use super::*;
use crate::engine::file_shared_arcs as arcs;
use crate::entity::Entity;

fn shared_source() -> (Engine, [Entity; 3]) {
    let mut e = source(Space::PlanarXy);
    for (x, radius) in [(9., 0.2), (18., 0.7)] {
        e.create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [x, 2., 0.],
                    ..Default::default()
                },
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius }),
            [0.; 3],
        )
        .unwrap();
    }
    bindings::share_first_pair_for_file_test(&mut e);
    let ids = std::array::from_fn(|i| {
        let id = e.world.spawn_enemy(500. + i as f32 * 50., 0., 0);
        e.world.clear_movement_pattern(id);
        assert!(e.configure_data_scene_sprite_clips(
            id.id,
            id.generation,
            &[1., 2., 10., 1.],
            &[0., 0., 0.5, 1., 0.5, 0., 1., 1.],
            1
        ));
        id
    });
    let shared = Arc::clone(
        &e.world.sprite_playbacks[ids[0].id as usize]
            .as_ref()
            .unwrap()
            .clips,
    );
    e.world.sprite_playbacks[ids[1].id as usize]
        .as_mut()
        .unwrap()
        .clips = shared;
    (e, ids)
}
fn tables(engine: &Engine) -> sharing::Tables {
    let l = Limits::default();
    sharing::capture(
        engine,
        l.sharing(l.max_post_decode_work, l.max_post_decode_scratch_bytes),
    )
    .unwrap()
    .0
}
fn file_with_tables(memory: &[u8], tables: &sharing::Tables) -> Vec<u8> {
    wire_section(&engine_section::encode(memory, &tables.arcs, &tables.shapes).unwrap())
}
fn decoded(file: &[u8]) -> sharing::Decoded {
    let parsed = framing::read(file, &profile(SDK_BUILD), &framing::Limits::default()).unwrap();
    engine_section::decode(
        parsed.section(framing::SectionKind::Engine),
        Default::default(),
    )
    .unwrap()
}
fn assert_source_unchanged(source: &Engine, memory: &[u8], file: &[u8], before: &[u8]) {
    assert_eq!(persistence::encode(source).unwrap(), memory);
    assert_eq!(file, before);
}

#[test]
fn file_candidate_actual_shared_clip_and_shape_graph_survives_file_and_six_ticks() {
    let (mut source, ids) = shared_source();
    let memory = persistence::encode(&source).unwrap();
    let original_graph = tables(&source);
    assert_eq!(original_graph.arcs.root_count(), 3);
    let shapes = original_graph.shapes.as_ref().unwrap();
    assert_eq!(
        shapes.roots.iter().map(|r| r.first).collect::<Vec<_>>(),
        [0, 0, 2]
    );
    let ordinary = persistence::decode(&memory).unwrap();
    assert_ne!(tables(&ordinary).arcs, original_graph.arcs);
    assert_ne!(tables(&ordinary).shapes, original_graph.shapes);
    let file = wire(&source);
    let before = file.clone();
    let mut candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
    let actual = tables(&candidate.engine);
    assert_eq!(actual.arcs, original_graph.arcs);
    assert_eq!(actual.shapes, original_graph.shapes);
    assert_eq!(candidate.usage().alias_roots, 6);
    assert!(candidate.usage().alias_compare_bytes > 0);
    assert_source_unchanged(&source, &memory, &file, &before);
    assert_eq!(
        persistence::encode(&candidate.engine).unwrap(),
        memory,
        "pending flags/revisions/contacts/outputs must survive without setters or rebuilds"
    );
    for _ in 0..6 {
        source.update(0.013);
        candidate.engine.update(0.013);
        assert_eq!(
            persistence::encode(&source).unwrap(),
            persistence::encode(&candidate.engine).unwrap()
        );
        let a = tables(&source);
        let b = tables(&candidate.engine);
        assert_eq!(a.arcs, b.arcs);
        assert_eq!(a.shapes, b.shapes);
    }
    let a = &candidate.engine.world.sprite_playbacks[ids[0].id as usize]
        .as_ref()
        .unwrap()
        .clips;
    let b = &candidate.engine.world.sprite_playbacks[ids[1].id as usize]
        .as_ref()
        .unwrap()
        .clips;
    let c = &candidate.engine.world.sprite_playbacks[ids[2].id as usize]
        .as_ref()
        .unwrap()
        .clips;
    assert!(Arc::ptr_eq(a, b));
    assert!(!Arc::ptr_eq(a, c));
    Arc::make_mut(
        &mut candidate.engine.world.sprite_playbacks[ids[0].id as usize]
            .as_mut()
            .unwrap()
            .clips,
    )[0]
    .fps = 11.;
    assert_eq!(
        candidate.engine.world.sprite_playbacks[ids[1].id as usize]
            .as_ref()
            .unwrap()
            .clips[0]
            .fps,
        10.
    );
    assert_eq!(
        source.world.sprite_playbacks[ids[0].id as usize]
            .as_ref()
            .unwrap()
            .clips[0]
            .fps,
        10.
    );
    assert_eq!(file, before);
}

#[test]
fn file_candidate_late_shape_failure_drops_detached_clip_changes_without_live_mutation() {
    let (source, ids) = shared_source();
    let memory = persistence::encode(&source).unwrap();
    let refs = Arc::strong_count(
        &source.world.sprite_playbacks[ids[0].id as usize]
            .as_ref()
            .unwrap()
            .clips,
    );
    for case in 0..4 {
        let mut t = tables(&source);
        let expected = match case {
            0 => {
                t.shapes = None;
                sharing::Error::ShapePresence
            }
            1 => {
                t.shapes.as_mut().unwrap().roots[2].first = 0;
                sharing::Error::Shapes(crate::physics3d::file_shared_shapes::Error::DifferentValue)
            }
            2 => {
                t.shapes.as_mut().unwrap().roots[0].first = 1;
                sharing::Error::Shapes(crate::physics3d::file_shared_shapes::Error::Group)
            }
            _ => {
                t.shapes.as_mut().unwrap().roots[0].location =
                    rapier3d::geometry::file_shape_aliases::RootLocation::Collider {
                        slot: u32::MAX,
                        generation: 0,
                    };
                sharing::Error::Shapes(crate::physics3d::file_shared_shapes::Error::RootLocation)
            }
        };
        let file = file_with_tables(&memory, &t);
        let before = file.clone();
        assert_eq!(
            prepare(&file, SDK_BUILD, &Limits::default()).unwrap_err(),
            Error::Sharing(expected)
        );
        assert_source_unchanged(&source, &memory, &file, &before);
        assert_eq!(
            Arc::strong_count(
                &source.world.sprite_playbacks[ids[0].id as usize]
                    .as_ref()
                    .unwrap()
                    .clips
            ),
            refs
        );
    }
    prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
    assert!(matches!(
        prepare(&wire_section(&memory), SDK_BUILD, &Limits::default()),
        Err(Error::EngineSection(engine_section::Error::InvalidPrefix))
    ));
}

#[test]
fn file_candidate_alias_owners_share_work_scratch_roots_and_comparison_allowances() {
    let (source, _) = shared_source();
    let memory = persistence::encode(&source).unwrap();
    let file = wire(&source);
    let before = file.clone();
    let full = prepare(&file, SDK_BUILD, &Limits::default())
        .unwrap()
        .usage();
    let mut d = decoded(&file);
    let a = arcs::restore(
        &mut d.engine,
        &d.arcs,
        arcs::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 64 * MIB,
            max_roots: 1000,
            max_compare_bytes: 128 * MIB,
        },
    )
    .unwrap();
    let b = bindings::restore_shape_aliases(
        d.engine.unified_physics.as_mut().unwrap(),
        d.shapes.as_ref().unwrap(),
        crate::physics3d::file_shared_shapes::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 64 * MIB,
            max_roots: 1000,
            max_compare_bytes: 128 * MIB,
        },
    )
    .unwrap();
    assert_eq!(full.alias_compare_bytes, a.compare_bytes + b.compare_bytes);
    assert!(a.compare_bytes > 0 && b.compare_bytes > 0);
    let exact = Limits {
        max_post_decode_work: full.post_decode_work,
        max_post_decode_scratch_bytes: full.post_decode_scratch_bytes,
        max_alias_roots: full.alias_roots,
        max_alias_compare_bytes: full.alias_compare_bytes,
        ..Default::default()
    };
    assert_eq!(prepare(&file, SDK_BUILD, &exact).unwrap().usage(), full);
    // Restrict the allowance at the sharing stage itself. Later readonly
    // passes must not be counted as work performed before alias restoration.
    let c = controller::validate(
        &d.engine,
        controller::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 64 * MIB,
        },
    )
    .unwrap();
    let later = builtin::validate(
        &d.engine,
        builtin::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 64 * MIB,
        },
    )
    .unwrap();
    let gameplay = data_gameplay::validate(
        &d.engine,
        data_gameplay::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 64 * MIB,
        },
    )
    .unwrap();
    let observations = runtime_observations::validate(
        &d.engine,
        runtime_observations::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 64 * MIB,
        },
    )
    .unwrap();
    let payload = runtime_payload::validate(
        &d.engine,
        runtime_payload::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 64 * MIB,
        },
    )
    .unwrap();
    let layout = d
        .engine
        .world
        .gameplay_variable_slab()
        .admit_file_layout()
        .unwrap();
    let (_, roster) = native_roster::capture_after_admission(
        &d.engine,
        &layout,
        native_roster::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 64 * MIB,
        },
    )
    .unwrap();
    let (_, resources) = native_resources::capture_after_admission(
        &d.engine,
        native_resources::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 64 * MIB,
        },
    )
    .unwrap();
    let base_work = full.post_decode_work
        - c.work
        - later.work
        - gameplay.work
        - observations.work
        - payload.work
        - roster.work
        - resources.work
        - 4
        - a.work
        - b.work;
    let base_scratch = full.post_decode_scratch_bytes
        - c.scratch_bytes
        - later.scratch_bytes
        - gameplay.scratch_bytes
        - observations.scratch_bytes
        - payload.scratch_bytes
        - roster.scratch_bytes
        - resources.scratch_bytes
        - a.scratch_bytes
        - b.scratch_bytes;
    let limited = [
        Limits {
            max_post_decode_work: base_work + 4 + a.work.max(b.work),
            ..exact.clone()
        },
        Limits {
            max_post_decode_scratch_bytes: base_scratch + a.scratch_bytes.max(b.scratch_bytes),
            ..exact.clone()
        },
        Limits {
            max_alias_compare_bytes: a.compare_bytes.max(b.compare_bytes),
            ..exact.clone()
        },
        Limits {
            max_alias_roots: d
                .arcs
                .root_count()
                .max(d.shapes.as_ref().unwrap().root_count()),
            ..exact.clone()
        },
        Limits {
            max_alias_compare_bytes: full.alias_compare_bytes - 1,
            ..exact.clone()
        },
    ];
    for (index, l) in limited.iter().enumerate() {
        let error = prepare(&file, SDK_BUILD, l).unwrap_err();
        assert!(
            matches!(
                error,
                Error::Sharing(
                    sharing::Error::Work
                        | sharing::Error::Scratch
                        | sharing::Error::Roots
                        | sharing::Error::Compare
                        | sharing::Error::Arcs(
                            arcs::Error::Work
                                | arcs::Error::Scratch
                                | arcs::Error::Roots
                                | arcs::Error::CompareBytes
                        )
                        | sharing::Error::Shapes(
                            crate::physics3d::file_shared_shapes::Error::WorkLimit
                                | crate::physics3d::file_shared_shapes::Error::ScratchLimit
                                | crate::physics3d::file_shared_shapes::Error::RootLimit
                                | crate::physics3d::file_shared_shapes::Error::CompareLimit
                        )
                )
            ),
            "case {index}: {error:?}"
        );
        assert_source_unchanged(&source, &memory, &file, &before);
    }
    prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
}

#[test]
fn file_candidate_clip_only_graph_has_no_native_table_and_rejects_forged_presence() {
    let mut source = crate::engine::legacy_test_fixture::engine();
    source.use_data_scene();
    let ids = std::array::from_fn::<_, 2, _>(|i| {
        let entity = source.world.spawn_enemy(i as f32 * 50., 0., 0);
        source.world.clear_movement_pattern(entity);
        assert!(source.configure_data_scene_sprite_clips(
            entity.id,
            entity.generation,
            &[1., 2., 10., 1.],
            &[0., 0., 0.5, 1., 0.5, 0., 1., 1.],
            1
        ));
        entity
    });
    let clips = Arc::clone(
        &source.world.sprite_playbacks[ids[0].id as usize]
            .as_ref()
            .unwrap()
            .clips,
    );
    source.world.sprite_playbacks[ids[1].id as usize]
        .as_mut()
        .unwrap()
        .clips = clips;
    let file = wire(&source);
    let memory = persistence::encode(&source).unwrap();
    let candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
    let graph = tables(&candidate.engine);
    assert!(graph.shapes.is_none());
    assert_eq!(graph.arcs, tables(&source).arcs);
    assert_eq!(candidate.usage().alias_roots, 2);
    assert!(candidate.usage().alias_compare_bytes > 0);
    let mut forged = tables(&source);
    forged.shapes = Some(crate::physics3d::file_shared_shapes::Table {
        version: 1,
        roots: Vec::new(),
    });
    let bad = file_with_tables(&memory, &forged);
    let before = bad.clone();
    assert_eq!(
        prepare(&bad, SDK_BUILD, &Limits::default()).unwrap_err(),
        Error::Sharing(sharing::Error::ShapePresence)
    );
    assert_source_unchanged(&source, &memory, &bad, &before);
}

#[test]
fn file_candidate_actual_typed_alias_tables_use_exact_cumulative_decode_allowance() {
    let (source, _) = shared_source();
    let file = wire(&source);
    let before = file.clone();
    let memory = persistence::encode(&source).unwrap();
    let parsed = framing::read(&file, &profile(SDK_BUILD), &framing::Limits::default()).unwrap();
    let (_, usage) = engine_section::decode_with_usage::<
        arcs::Table,
        Option<crate::physics3d::file_shared_shapes::Table>,
    >(
        parsed.section(framing::SectionKind::Engine),
        Limits::default().decode,
    )
    .unwrap();
    let exact = Limits {
        decode: crate::checkpoint_decode::Limits {
            allocation_work: usage.allocation_work,
            ..Limits::default().decode
        },
        ..Default::default()
    };
    prepare(&file, SDK_BUILD, &exact).unwrap();
    let below = Limits {
        decode: crate::checkpoint_decode::Limits {
            allocation_work: usage.allocation_work - 1,
            ..exact.decode
        },
        ..exact
    };
    assert_eq!(
        prepare(&file, SDK_BUILD, &below).unwrap_err(),
        Error::EngineSection(engine_section::Error::Payload(
            RuntimeCheckpointError::Capacity
        ))
    );
    prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
    assert_source_unchanged(&source, &memory, &file, &before);
}

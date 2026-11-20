use super::*;
use crate::engine::{file_candidate as c, file_envelope as f, persistence};
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Pose, Shape, Space, WorldConfig};
use std::sync::Arc;
const SDK: u64 = 0x524f_5354_4552;
fn wire(e: &Engine) -> Vec<u8> {
    let section = c::capture_engine_section(e, &c::Limits::default()).unwrap();
    f::encode(
        &c::profile(SDK),
        &f::Sections {
            engine: &section,
            variables: b"{}",
            authoring: b"{}",
            resource_manifest: b"{}",
            resource_data: b"{}",
            dialogue_quest: b"{}",
            host_bindings: b"{}",
        },
        &f::Limits::default(),
    )
    .unwrap()
}
fn metadata(e: &Engine) -> (Roster, Usage) {
    let before = persistence::encode(e).unwrap();
    let file = wire(e);
    let copy = file.clone();
    let candidate = c::prepare(&file, SDK, &c::Limits::default()).unwrap();
    let variables = e
        .world
        .gameplay_variable_slab()
        .admit_file_layout()
        .unwrap();
    let (r, u) = capture_after_admission(
        e,
        &variables,
        Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 32 * 1024 * 1024,
        },
    )
    .unwrap();
    assert_eq!(candidate.native_roster(), &r);
    assert_eq!(file, copy);
    assert_eq!(persistence::encode(e).unwrap(), before);
    (r, u)
}
fn fixture() -> (Engine, [Entity; 3], Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    assert!(e.configure_gameplay_variable(1, 0, 0, -3., 7.));
    assert!(e.configure_gameplay_variable(2, 1, 1, 1.25, 8.5));
    assert!(e.configure_gameplay_variable(3, 2, 0, 1., 0.));
    let ids = std::array::from_fn(|i| {
        let entity = e.world.spawn_enemy(i as f32 * 10., 0., 17);
        e.world.clear_movement_pattern(entity);
        assert!(e.configure_data_scene_sprite_clips(
            entity.id,
            entity.generation,
            &[7., 2., 10., 1., 9., 2., 5., 1.],
            &[0., 0., 0.5, 1., 0.5, 0., 1., 1., 0., 0., 0.5, 1., 0.5, 0., 1., 1.],
            7
        ));
        entity
    });
    let clips = Arc::clone(
        &e.world.sprite_playbacks[ids[0].id as usize]
            .as_ref()
            .unwrap()
            .clips,
    );
    e.world.sprite_playbacks[ids[1].id as usize]
        .as_mut()
        .unwrap()
        .clips = clips;
    assert!(e.configure_sprite_normal_materials(&[ids[0].id, ids[0].generation, 18, 0]));
    assert!(e.configure_sprite_lighting_materials(&[ids[0].id, ids[0].generation, 1, 0]));
    assert!(e.configure_sprite_surface_materials(&[
        ids[0].id,
        ids[0].generation,
        17,
        19,
        crate::render_command::SPRITE_SURFACE_TEXTURE_NONE,
        1,
        0,
        0,
        0,
        0,
        1f32.to_bits(),
        0
    ]));
    assert!(e.spatial_scene.models.configure(
        &e.world,
        &[ids[0].id, ids[0].generation, 21, 3, 1, 12],
        &[0., 0., 1., -1., -1., -1., 1., 1., 1.]
    ));
    assert!(e.configure_spatial_model_streaming(
        &[],
        &[
            ids[0].id,
            ids[0].generation,
            21,
            1,
            12,
            0,
            ids[0].id,
            ids[0].generation,
            22,
            1,
            12,
            0
        ],
        &[0., 10.]
    ));
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let body = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [100., 0., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.2 }),
            [0.; 3],
        )
        .unwrap();
    (e, ids, body)
}
#[test]
fn native_roster_actual_variables_live_flags_resource_roles_model_lods_and_body_binding() {
    let (e, ids, body) = fixture();
    let (r, _) = metadata(&e);
    assert_eq!(r.context.scene, Scene::Data);
    assert_eq!(r.context.stored_data_epoch, e.data_scene_epoch());
    assert_eq!(
        r.variables
            .iter()
            .map(|v| (v.slot, v.variable_type, v.scope, v.default_value))
            .collect::<Vec<_>>(),
        vec![
            (
                1,
                GameplayVariableType::Integer,
                GameplayVariableScope::Global,
                -3.
            ),
            (
                2,
                GameplayVariableType::Real,
                GameplayVariableScope::Scene,
                1.25
            ),
            (
                3,
                GameplayVariableType::Bool,
                GameplayVariableScope::Global,
                1.
            )
        ]
    );
    assert_eq!(r.classify_handle(ids[0]), HandleFact::LiveExact);
    assert_eq!(
        r.live_entities
            .iter()
            .find(|v| v.handle == ids[0])
            .unwrap()
            .progress_flags,
        49
    );
    assert_eq!(
        r.textures
            .iter()
            .filter(|t| t.handle == ids[0])
            .map(|v| (v.role, v.id))
            .collect::<Vec<_>>(),
        vec![
            (TextureRole::Sprite, 17),
            (TextureRole::Normal, 18),
            (TextureRole::Emission, 17),
            (TextureRole::Specular, 19)
        ]
    );
    assert_eq!(
        r.clips
            .iter()
            .filter(|v| v.handle == ids[0])
            .map(|v| (v.ordinal, v.id, v.active))
            .collect::<Vec<_>>(),
        vec![(0, 7, true), (1, 9, false)]
    );
    assert_eq!(
        r.models
            .iter()
            .map(|v| (v.handle, v.role, v.asset))
            .collect::<Vec<_>>(),
        vec![
            (ids[0], ModelRole::Base { flags: 3 }, 21),
            (ids[0], ModelRole::Lod(0), 21),
            (ids[0], ModelRole::Lod(1), 22)
        ]
    );
    assert_eq!(r.bodies.len(), 1);
    assert_eq!(r.bodies[0].handle, body);
    assert!(!r.bodies[0].legacy);
}
#[test]
fn native_roster_despawn_reuse_retains_only_actual_stored_relations_without_fake_history() {
    let (mut e, ids, _) = fixture();
    e.world.despawn(ids[0]);
    let (r, _) = metadata(&e);
    assert_eq!(
        r.classify_handle(ids[0]),
        HandleFact::StoredSlotNotCurrent {
            stored_generation: ids[0].generation + 1,
            slot_alive: false
        }
    );
    assert!(!r.live_entities.iter().any(|v| v.handle == ids[0]));
    assert!(!r.textures.iter().any(|v| v.handle == ids[0]));
    assert!(!r.clips.iter().any(|v| v.handle == ids[0]));
    assert_eq!(r.models.iter().filter(|v| v.handle == ids[0]).count(), 3);
    let replacement = e.world.spawn_enemy(200., 0., 44);
    e.world.clear_movement_pattern(replacement);
    assert_eq!(replacement.id, ids[0].id);
    assert_ne!(replacement.generation, ids[0].generation);
    let (r, _) = metadata(&e);
    assert_eq!(r.classify_handle(replacement), HandleFact::LiveExact);
    assert_eq!(
        r.classify_handle(ids[0]),
        HandleFact::StoredSlotNotCurrent {
            stored_generation: replacement.generation,
            slot_alive: true
        }
    );
    assert_eq!(
        r.classify_handle(Entity {
            id: u32::MAX,
            generation: 0
        }),
        HandleFact::UnknownSlot
    );
    assert_eq!(
        r.textures
            .iter()
            .filter(|v| v.handle == replacement)
            .map(|v| v.id)
            .collect::<Vec<_>>(),
        vec![44]
    );
}
#[test]
fn native_roster_reset_bumps_never_spawned_generations_without_historical_existence_claim() {
    let mut e = Engine::new();
    e.use_data_scene();
    let h = e.world.spawn_entity();
    e.world.despawn(h);
    e.world.reset_preserving_gameplay_variables();
    e.world.reset_preserving_gameplay_variables();
    let (r, _) = metadata(&e);
    let stored = h.generation + 3;
    for generation in [
        h.generation,
        h.generation + 1,
        h.generation + 2,
        stored,
        u32::MAX,
    ] {
        assert_eq!(
            r.classify_handle(Entity {
                id: h.id,
                generation
            }),
            HandleFact::StoredSlotNotCurrent {
                stored_generation: stored,
                slot_alive: false
            }
        );
    }
    let next = e.world.spawn_entity();
    assert_eq!(next.generation, stored);
    assert_eq!(metadata(&e).0.classify_handle(next), HandleFact::LiveExact);
}
#[test]
fn native_roster_checked_max_retire_and_never_spawned_max_have_same_backing_facts() {
    let mut last = None;
    for spawn_max in [false, true] {
        let mut e = Engine::new();
        e.use_data_scene();
        let (mut world, a, _) = crate::world::World::file_roster_boundary_source_for_test();
        world.despawn(a);
        if spawn_max {
            let live = world.spawn_entity();
            assert_eq!(live.generation, u32::MAX);
            world.despawn(live);
        }
        world.reset_preserving_gameplay_variables();
        e.world = world;
        let (r, _) = metadata(&e);
        let fact = r.classify_handle(Entity {
            id: a.id,
            generation: u32::MAX,
        });
        assert_eq!(
            fact,
            HandleFact::StoredSlotNotCurrent {
                stored_generation: u32::MAX,
                slot_alive: false
            }
        );
        if let Some(old) = last {
            assert_eq!(old, fact);
        }
        last = Some(fact);
        let next = e.world.spawn_entity();
        assert_ne!(next.id, a.id);
        metadata(&e);
    }
}
#[test]
fn native_roster_unkeyed_continuity_survives_despawn_with_no_invented_handle_or_texture() {
    let (mut e, ids, _) = fixture();
    let token = e.begin_data_scene_authoring_continuity(
        &[ids[0].id, ids[0].generation, ids[2].id, ids[2].generation],
        &[3, 1],
    );
    assert_ne!(token, 0);
    e.world.despawn(ids[0]);
    e.world.despawn(ids[2]);
    let (r, _) = metadata(&e);
    let h = r.continuity.unwrap();
    assert_eq!(
        (h.token, h.epoch, h.instance_count),
        (token, e.data_scene_epoch(), 2)
    );
    assert_eq!(r.continuity_instances.len(), 2);
    assert_eq!(
        r.continuity_clips
            .iter()
            .map(|v| (v.instance_ordinal, v.id))
            .collect::<Vec<_>>(),
        vec![(0, 7), (0, 9), (1, 7), (1, 9)]
    );
    assert_eq!(
        r.continuity_models.iter().map(|v| v.id).collect::<Vec<_>>(),
        vec![21, 22]
    );
    assert!(!r
        .textures
        .iter()
        .any(|v| v.handle == ids[0] || v.handle == ids[2]));
}
#[test]
fn native_roster_shared_and_equal_distinct_arcs_and_source_bytes_stay_unchanged() {
    let (mut e, ids, _) = fixture();
    let groups = crate::engine::file_sharing::capture(
        &e,
        crate::engine::file_sharing::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 32 * 1024 * 1024,
            max_roots: 1000,
            max_compare_bytes: 32 * 1024 * 1024,
        },
    )
    .unwrap()
    .0;
    let strong = Arc::strong_count(
        &e.world.sprite_playbacks[ids[0].id as usize]
            .as_ref()
            .unwrap()
            .clips,
    );
    let (a, _) = metadata(&e);
    let (b, _) = metadata(&e);
    assert_eq!(a, b);
    let actual = crate::engine::file_sharing::capture(
        &e,
        crate::engine::file_sharing::Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 32 * 1024 * 1024,
            max_roots: 1000,
            max_compare_bytes: 32 * 1024 * 1024,
        },
    )
    .unwrap()
    .0;
    assert_eq!(groups.arcs, actual.arcs);
    assert_eq!(groups.shapes, actual.shapes);
    let clips = |index: usize| {
        &e.world.sprite_playbacks[ids[index].id as usize]
            .as_ref()
            .unwrap()
            .clips
    };
    assert!(Arc::ptr_eq(clips(0), clips(1)));
    assert!(!Arc::ptr_eq(clips(0), clips(2)));
    assert_eq!(Arc::strong_count(clips(0)), strong);
    Arc::make_mut(
        &mut e.world.sprite_playbacks[ids[0].id as usize]
            .as_mut()
            .unwrap()
            .clips,
    )[0]
    .fps = 11.;
    assert_eq!(
        e.world.sprite_playbacks[ids[1].id as usize]
            .as_ref()
            .unwrap()
            .clips[0]
            .fps,
        10.
    );
}
#[test]
fn native_roster_exact_work_scratch_and_candidate_aggregate_one_below_are_readonly() {
    let (e, _, _) = fixture();
    let (r, u) = metadata(&e);
    let layout = e
        .world
        .gameplay_variable_slab()
        .admit_file_layout()
        .unwrap();
    let before = persistence::encode(&e).unwrap();
    let exact = Limits {
        max_work: u.work,
        max_scratch_bytes: u.scratch_bytes,
    };
    assert_eq!(capture_after_admission(&e, &layout, exact).unwrap(), (r, u));
    assert_eq!(
        capture_after_admission(
            &e,
            &layout,
            Limits {
                max_work: u.work - 1,
                ..exact
            }
        )
        .unwrap_err(),
        Error::WorkLimit
    );
    assert_eq!(
        capture_after_admission(
            &e,
            &layout,
            Limits {
                max_scratch_bytes: u.scratch_bytes - 1,
                ..exact
            }
        )
        .unwrap_err(),
        Error::ScratchLimit
    );
    let file = wire(&e);
    let baseline = c::prepare(&file, SDK, &c::Limits::default())
        .unwrap()
        .usage();
    let exact = c::Limits {
        max_post_decode_work: baseline.post_decode_work,
        max_post_decode_scratch_bytes: baseline.post_decode_scratch_bytes,
        ..Default::default()
    };
    assert_eq!(c::prepare(&file, SDK, &exact).unwrap().usage(), baseline);
    assert_eq!(
        c::prepare(
            &file,
            SDK,
            &c::Limits {
                max_post_decode_work: baseline.post_decode_work - 1,
                ..exact.clone()
            }
        )
        .unwrap_err(),
        c::Error::NativeResources(Error::WorkLimit)
    );
    assert_eq!(
        c::prepare(
            &file,
            SDK,
            &c::Limits {
                max_post_decode_scratch_bytes: baseline.post_decode_scratch_bytes - 1,
                ..exact
            }
        )
        .unwrap_err(),
        c::Error::NativeResources(Error::ScratchLimit)
    );
    assert_eq!(persistence::encode(&e).unwrap(), before);
}
#[test]
fn native_roster_bad_reference_and_declared_alias_are_rejected_before_fact_exposure() {
    let (e, _, _) = fixture();
    let before = persistence::encode(&e).unwrap();
    let limits = crate::engine::file_sharing::Limits {
        max_work: 100_000_000,
        max_scratch_bytes: 32 * 1024 * 1024,
        max_roots: 1000,
        max_compare_bytes: 32 * 1024 * 1024,
    };
    let mut tables = crate::engine::file_sharing::capture(&e, limits).unwrap().0;
    tables.shapes.as_mut().unwrap().roots[0].first = 1;
    let section =
        crate::engine::file_engine_section::encode(&before, &tables.arcs, &tables.shapes).unwrap();
    let bad = f::encode(
        &c::profile(SDK),
        &f::Sections {
            engine: &section,
            variables: b"{}",
            authoring: b"{}",
            resource_manifest: b"{}",
            resource_data: b"{}",
            dialogue_quest: b"{}",
            host_bindings: b"{}",
        },
        &f::Limits::default(),
    )
    .unwrap();
    let copy = bad.clone();
    f::read(&bad, &c::profile(SDK), &f::Limits::default()).unwrap();
    assert!(matches!(
        c::prepare(&bad, SDK, &c::Limits::default()),
        Err(c::Error::Sharing(_))
    ));
    assert_eq!(bad, copy);
    assert_eq!(persistence::encode(&e).unwrap(), before);
    let mut damaged = persistence::decode(&before).unwrap();
    damaged
        .spatial_scene
        .models
        .bindings
        .values_mut()
        .next()
        .unwrap()
        .asset = 0;
    let raw = persistence::encode(&damaged).unwrap();
    let file = wire(&damaged);
    let copy = file.clone();
    f::read(&file, &c::profile(SDK), &f::Limits::default()).unwrap();
    assert!(matches!(
        c::prepare(&file, SDK, &c::Limits::default()),
        Err(c::Error::Spatial(_))
    ));
    assert_eq!(file, copy);
    assert_eq!(persistence::encode(&damaged).unwrap(), raw);
    assert_eq!(persistence::encode(&e).unwrap(), before);
}
#[test]
fn native_roster_epoch_revision_wrap_are_stored_counters_and_normal_six_ticks_are_pure() {
    let (mut e, _, _) = fixture();
    e.data_scene.epoch = u32::MAX;
    e.spatial_scene.revision = u32::MAX;
    let (r, _) = metadata(&e);
    assert_eq!(r.context.stored_data_epoch, u32::MAX);
    assert_eq!(r.context.spatial_revision, u32::MAX);
    for _ in 0..6 {
        e.update(1. / 60.);
        metadata(&e);
    }
    e.use_data_scene();
    let (r, _) = metadata(&e);
    assert_eq!(r.context.stored_data_epoch, 1);
    assert_eq!(r.context.spatial_revision, e.spatial_scene.revision);
    let builtin = metadata(&Engine::new()).0;
    assert_eq!(builtin.context.scene, Scene::BuiltIn);
}

#[test]
fn native_roster_pending_handoff_old_epoch_and_unknown_original_handle_remain_unkeyed() {
    let (mut e, ids, _) = fixture();
    let old = e.data_scene_epoch();
    assert_ne!(
        e.begin_data_scene_authoring_continuity(
            &[ids[0].id, ids[0].generation, u32::MAX, u32::MAX],
            &[3, 3]
        ),
        0
    );
    e.use_data_scene();
    assert_ne!(e.data_scene_epoch(), old);
    let current = e.world.spawn_enemy(300., 0., 99);
    e.world.clear_movement_pattern(current);
    let (r, _) = metadata(&e);
    assert_eq!(r.context.stored_data_epoch, e.data_scene_epoch());
    assert_eq!(r.continuity.unwrap().epoch, old);
    assert_eq!(r.continuity_instances.len(), 2);
    assert_eq!(
        r.continuity_instances[1],
        ContinuityInstance {
            ordinal: 1,
            active_clip: None,
            selected_lod: None
        }
    );
    assert_eq!(r.continuity_clips.len(), 2);
    assert_eq!(r.continuity_models.len(), 2);
    assert!(r.models.is_empty());
    assert_eq!(
        r.textures
            .iter()
            .map(|v| (v.handle, v.id))
            .collect::<Vec<_>>(),
        vec![(current, 99)]
    );
    assert_eq!(
        r.classify_handle(Entity {
            id: u32::MAX,
            generation: u32::MAX
        }),
        HandleFact::UnknownSlot
    );
}

#[test]
fn native_roster_native_max64_layout_and_clip_ids_are_flat_bulk_facts() {
    let mut e = Engine::new();
    e.use_data_scene();
    let actor = e.world.spawn_enemy(0., 0., 0);
    e.world.clear_movement_pattern(actor);
    let mut clips = Vec::new();
    let mut frames = Vec::new();
    for id in 1..=64 {
        assert!(e.configure_gameplay_variable(id, 0, id % 2, id as f64, id as f64 + 1.));
        clips.extend_from_slice(&[id as f32, 1., 10., 1.]);
        frames.extend_from_slice(&[0., 0., 1., 1.]);
    }
    assert!(e.configure_data_scene_sprite_clips(actor.id, actor.generation, &clips, &frames, 64));
    let (r, _) = metadata(&e);
    assert_eq!(r.variables.len(), 64);
    assert_eq!(r.clips.len(), 64);
    assert_eq!(r.variables[63].slot, 64);
    assert_eq!(r.variables[63].default_value, 64.);
    assert_eq!(
        r.clips.last().unwrap(),
        &Clip {
            handle: actor,
            ordinal: 63,
            id: 64,
            active: true
        }
    );
    assert_eq!(
        r.textures[0].id, 0,
        "base stored ID0 is not an invented normal/surface NONE sentinel"
    );
}

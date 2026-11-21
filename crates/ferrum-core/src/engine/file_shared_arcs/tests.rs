use super::super::persistence;
use super::*;
use crate::components::SpriteFrame;
mod determinism;
mod producers;
use crate::physics3d::Pose;
fn limits() -> Limits {
    Limits {
        max_work: 100_000_000,
        max_scratch_bytes: 16 * 1024 * 1024,
        max_roots: 10000,
        max_compare_bytes: 64 * 1024 * 1024,
    }
}
fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn detached(e: &Engine) -> Box<Engine> {
    persistence::decode(&bytes(e)).unwrap()
}
fn graph(e: &Engine) -> Table {
    capture(e, limits()).unwrap().0
}
fn counts(e: &Engine) -> Vec<(usize, usize)> {
    let mut values = Vec::new();
    let mut budget = Budget::new(limits());
    walk(e, &mut budget, |_, root| {
        values.push(match root {
            Root::Route(a) => (Arc::strong_count(a), Arc::weak_count(a)),
            Root::Clips(a) => (Arc::strong_count(a), Arc::weak_count(a)),
        });
        Ok(())
    })
    .unwrap();
    values
}
fn copied_table(t: &Table) -> Table {
    crate::checkpoint_codec::decode(&crate::checkpoint_codec::encode(t).unwrap()).unwrap()
}
fn simple() -> (Engine, Vec<Entity>) {
    let mut e = Engine::new();
    e.use_data_scene();
    let mut ids = Vec::new();
    for i in 0..5 {
        let a = e.world.spawn_enemy(i as f32 * 50., 0., 0);
        assert!(e.configure_data_scene_sprite_clips(
            a.id,
            a.generation,
            &[1., 2., 10., 1.],
            &[0., 0., 0.5, 1., 0.5, 0., 1., 1.],
            1
        ));
        ids.push(a);
    }
    let shared = Arc::clone(
        &e.world.sprite_playbacks[ids[0].id as usize]
            .as_ref()
            .unwrap()
            .clips,
    );
    for i in [1, 4] {
        e.world.sprite_playbacks[ids[i].id as usize]
            .as_mut()
            .unwrap()
            .clips = Arc::clone(&shared);
    }
    Arc::make_mut(
        &mut e.world.sprite_playbacks[ids[3].id as usize]
            .as_mut()
            .unwrap()
            .clips,
    )[0]
    .fps = 11.;
    (e, ids)
}
fn assert_reject(e: &Engine, table: &Table, reason: Invalid) {
    let mut candidate = detached(e);
    let source = bytes(e);
    let before = bytes(&candidate);
    let t = crate::checkpoint_codec::encode(table).unwrap();
    let before_counts = counts(&candidate);
    assert!(
        matches!(restore(&mut candidate,table,limits()),Err(Error::Invalid{reason:r,..}) if r==reason)
    );
    assert_eq!(bytes(&candidate), before);
    assert_eq!(bytes(e), source);
    assert_eq!(counts(&candidate), before_counts);
    assert_eq!(crate::checkpoint_codec::encode(table).unwrap(), t);
}
#[test]
fn identity_capture_and_detached_restore_keep_equal_distinct_arcs_separate() {
    let (e, ids) = simple();
    let source = bytes(&e);
    let before_counts = counts(&e);
    let (table, usage) = capture(&e, limits()).unwrap();
    assert_eq!(usage.compare_bytes, 0);
    assert_eq!(counts(&e), before_counts);
    assert_eq!(bytes(&e), source);
    assert_eq!(
        table.rows.iter().map(|r| r.first).collect::<Vec<_>>(),
        [0, 0, 2, 3, 0]
    );
    assert_eq!(copied_table(&table), table);
    let mut candidate = detached(&e);
    assert_eq!(bytes(&candidate), source);
    assert_eq!(
        graph(&candidate)
            .rows
            .iter()
            .map(|r| r.first)
            .collect::<Vec<_>>(),
        [0, 1, 2, 3, 4]
    );
    let usage = restore(&mut candidate, &table, limits()).unwrap();
    assert!(usage.compare_bytes > 0);
    assert_eq!(graph(&candidate), table);
    assert_eq!(bytes(&candidate), source);
    assert_eq!(bytes(&e), source);
    let a = &candidate.world.sprite_playbacks[ids[0].id as usize]
        .as_ref()
        .unwrap()
        .clips;
    let b = &candidate.world.sprite_playbacks[ids[1].id as usize]
        .as_ref()
        .unwrap()
        .clips;
    let c = &candidate.world.sprite_playbacks[ids[2].id as usize]
        .as_ref()
        .unwrap()
        .clips;
    assert!(Arc::ptr_eq(a, b));
    assert!(!Arc::ptr_eq(a, c));
    assert_eq!(a, c);
}
#[test]
fn altered_census_domain_location_group_length_and_false_value_alias_are_guard_only() {
    let (e, _) = simple();
    let table = graph(&e);
    let mut t = table.clone();
    t.version += 1;
    assert_reject(&e, &t, Invalid::Version);
    let mut t = table.clone();
    t.rows.pop();
    assert_reject(&e, &t, Invalid::Census);
    let mut t = table.clone();
    t.rows.push(t.rows[0]);
    assert_reject(&e, &t, Invalid::Census);
    let mut t = table.clone();
    t.rows[1] = t.rows[0];
    assert_reject(&e, &t, Invalid::Location);
    let mut t = table.clone();
    t.rows.swap(1, 2);
    assert_reject(&e, &t, Invalid::Location);
    let mut t = table.clone();
    t.rows[0].domain = Domain::Route;
    assert_reject(&e, &t, Invalid::Domain);
    let mut t = table.clone();
    if let Location::WorldPlayback { generation, .. } = &mut t.rows[0].location {
        *generation += 1;
    }
    assert_reject(&e, &t, Invalid::Location);
    let mut t = table.clone();
    t.rows[0].first = u32::MAX;
    assert_reject(&e, &t, Invalid::Group);
    let mut t = table.clone();
    t.rows[4].first = 1;
    assert_reject(&e, &t, Invalid::Group);
    let mut t = table.clone();
    t.rows[0].len += 1;
    assert_reject(&e, &t, Invalid::Length);
    let mut t = table.clone();
    t.rows[3].first = 0;
    assert_reject(&e, &t, Invalid::Value);
}
#[test]
fn file_graph_is_authoritative_for_equal_value_aliases_not_historical_authentication() {
    let (e, _) = simple();
    let original = graph(&e);
    assert_eq!(original.rows[2].first, 2);
    let mut declared = original.clone();
    declared.rows[2].first = 0;
    let mut candidate = detached(&e);
    let before = bytes(&candidate);
    restore(&mut candidate, &declared, limits()).unwrap();
    assert_eq!(graph(&candidate), declared);
    assert_eq!(bytes(&candidate), before);
    assert_eq!(graph(&e), original);
}
#[test]
fn already_shared_input_cannot_silently_violate_declared_distinct_groups() {
    let (mut e, _) = simple();
    let mut table = graph(&e);
    table.rows[1].first = 1;
    let before = bytes(&e);
    let refs = counts(&e);
    assert!(matches!(
        restore(&mut e, &table, limits()),
        Err(Error::Invalid {
            reason: Invalid::NeedsSplit,
            ..
        })
    ));
    assert_eq!(bytes(&e), before);
    assert_eq!(counts(&e), refs);
}
#[test]
fn exact_and_one_below_capture_and_restore_budgets_leave_bytes_and_refs_unchanged() {
    let (e, _) = simple();
    let (table, usage) = capture(&e, limits()).unwrap();
    let source = bytes(&e);
    let exact = Limits {
        max_work: usage.work,
        max_scratch_bytes: usage.scratch_bytes,
        max_roots: table.root_count(),
        max_compare_bytes: 0,
    };
    assert_eq!(capture(&e, exact).unwrap().0, table);
    for l in [
        Limits {
            max_work: usage.work - 1,
            ..exact
        },
        Limits {
            max_scratch_bytes: usage.scratch_bytes - 1,
            ..exact
        },
        Limits {
            max_roots: table.root_count() - 1,
            ..exact
        },
    ] {
        assert!(capture(&e, l).is_err());
        assert_eq!(bytes(&e), source);
    }
    let mut candidate = detached(&e);
    let (plan, usage) = prepare(&candidate, &table, limits()).unwrap();
    drop(plan);
    let before = bytes(&candidate);
    let refs = counts(&candidate);
    let exact = Limits {
        max_work: usage.work,
        max_scratch_bytes: usage.scratch_bytes,
        max_roots: table.root_count(),
        max_compare_bytes: usage.compare_bytes,
    };
    for (l, expected) in [
        (
            Limits {
                max_work: usage.work - 1,
                ..exact
            },
            Error::Work,
        ),
        (
            Limits {
                max_scratch_bytes: usage.scratch_bytes - 1,
                ..exact
            },
            Error::Scratch,
        ),
        (
            Limits {
                max_roots: table.root_count() - 1,
                ..exact
            },
            Error::Roots,
        ),
        (
            Limits {
                max_compare_bytes: usage.compare_bytes - 1,
                ..exact
            },
            Error::CompareBytes,
        ),
    ] {
        assert_eq!(restore(&mut candidate, &table, l), Err(expected));
        assert_eq!(bytes(&candidate), before);
        assert_eq!(counts(&candidate), refs);
    }
    assert_eq!(restore(&mut candidate, &table, exact).unwrap(), usage);
    assert_eq!(bytes(&candidate), before);
    assert_eq!(graph(&candidate), table);
    assert!(matches!(reserve::<u64>(usize::MAX), Err(Error::Allocation)));
}
#[test]
fn restored_sharing_preserves_cow_and_six_step_private_memory_replay() {
    let (mut e, ids) = simple();
    let table = graph(&e);
    let mut candidate = detached(&e);
    restore(&mut candidate, &table, limits()).unwrap();
    let at = ids[1].id as usize;
    Arc::make_mut(&mut e.world.sprite_playbacks[at].as_mut().unwrap().clips)[0].fps = 7.;
    Arc::make_mut(&mut candidate.world.sprite_playbacks[at].as_mut().unwrap().clips)[0].fps = 7.;
    assert_eq!(graph(&e), graph(&candidate));
    assert_eq!(bytes(&e), bytes(&candidate));
    assert_eq!(
        graph(&e).rows.iter().map(|r| r.first).collect::<Vec<_>>(),
        [0, 1, 2, 3, 0]
    );
    for _ in 0..6 {
        e.update(0.013);
        candidate.update(0.013);
        assert_eq!(bytes(&e), bytes(&candidate));
        assert_eq!(graph(&e), graph(&candidate));
    }
}
#[test]
fn comparison_is_bit_exact_and_preserves_private_frame_timeline_capacity_fields() {
    let a: Arc<[Point]> = Arc::from([Point {
        pose: Pose::default(),
        surface: 7,
    }]);
    let mut v = a.to_vec();
    v[0].pose.position[0] = -0.;
    let b: Arc<[Point]> = v.into();
    let mut budget = Budget::new(limits());
    assert!(!content::equal(Root::Route(&a), Root::Route(&b), &mut budget).unwrap());
    let mut clip = SpriteClip::uniform(1, vec![SpriteFrame::FULL; 2], 10., true)
        .extended(2, Some(&[1., 2.]), true)
        .unwrap();
    let identical = clip.clone();
    assert_eq!(clip, identical);
    clip.frames.reserve_exact(8);
    assert_eq!(clip, identical);
    assert!(!clip.file_alias_value_eq(&identical));
    let mut nan = SpriteClip::uniform(1, vec![SpriteFrame::FULL], f32::from_bits(0x7fc00001), true);
    let same = nan.clone();
    assert!(nan.file_alias_value_eq(&same));
    nan.fps = f32::from_bits(0x7fc00002);
    assert!(!nan.file_alias_value_eq(&same));
}
#[test]
fn empty_roots_and_domains_are_identity_grouped_without_value_deduplication() {
    let (mut e, ids) = simple();
    for a in &ids {
        e.world.sprite_playbacks[a.id as usize]
            .as_mut()
            .unwrap()
            .clips = Arc::from([]);
    }
    let table = graph(&e);
    assert!(table.rows.iter().all(|r| r.len == 0));
    assert!(table
        .rows
        .iter()
        .enumerate()
        .all(|(i, r)| r.first as usize == i));
    let mut candidate = detached(&e);
    let before = bytes(&candidate);
    restore(&mut candidate, &table, limits()).unwrap();
    assert_eq!(graph(&candidate), table);
    assert_eq!(bytes(&candidate), before);
}

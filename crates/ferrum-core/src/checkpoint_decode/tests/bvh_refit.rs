use super::bvh_depth::{chain_tree, DEEP};
use super::*;
use rapier3d::parry::{
    bounding_volume::Aabb,
    partitioning::{Bvh, BvhBuildStrategy, BvhWorkspace},
};
use rapier3d::prelude::Vector;

#[derive(Clone, Copy)]
enum Mode {
    Resolve,
    Preserve,
    InPlace,
}
fn apply(tree: &mut Bvh, w: &mut BvhWorkspace, mode: Mode) {
    match mode {
        Mode::Resolve => tree.refit(w),
        Mode::Preserve => tree.refit_without_resolve(w),
        Mode::InPlace => tree.refit_without_opt(),
    }
}
fn bytes(tree: &Bvh) -> Vec<u8> {
    postcard::to_allocvec(tree).unwrap()
}
fn restored(tree: &Bvh) -> Bvh {
    let raw = bytes(tree);
    let result: Bvh = with_limits(&raw, Limits::default()).unwrap().0;
    assert_eq!(bytes(&result), raw);
    result
}
fn check(tree: &Bvh, expected: &[Aabb]) {
    assert_eq!(tree.leaf_count() as usize, expected.len());
    let root = tree.root_aabb();
    for (id, bounds) in expected.iter().enumerate() {
        assert_eq!(tree.leaf_node(id as u32).unwrap().aabb(), *bounds);
        assert!(root.mins.cmple(bounds.mins).all() && root.maxs.cmpge(bounds.maxs).all());
    }
    // A deep chain has linear query cost. Check representative overlaps against
    // all leaf AABBs without turning this regression into quadratic query work.
    for id in [0, expected.len() / 2, expected.len() - 1] {
        let query = expected[id];
        let wanted: Vec<_> = expected
            .iter()
            .enumerate()
            .filter_map(|(i, b)| {
                (b.mins.cmple(query.maxs).all() && query.mins.cmple(b.maxs).all())
                    .then_some(i as u32)
            })
            .collect();
        let mut found: Vec<_> = tree.intersect_aabb(&query).collect();
        found.sort_unstable();
        assert_eq!(found, wanted);
    }
}
fn deep(mode: Mode) {
    for paired in [false, true] {
        let mut tree = chain_tree(DEEP, paired);
        let mut expected: Vec<_> = (0..tree.leaf_count())
            .map(|id| tree.leaf_node(id).unwrap().aabb())
            .collect();
        let changed = DEEP / 2;
        let new = expected[changed];
        tree.insert_or_update_partially(
            Aabb::new(
                new.mins + Vector::new(0., 5., 0.),
                new.maxs + Vector::new(0., 5., 0.),
            ),
            changed as u32,
            0.1,
        );
        expected[changed] = tree.leaf_node(changed as u32).unwrap().aabb();
        let mut copy = restored(&tree);
        let (mut w, mut wc) = (BvhWorkspace::default(), BvhWorkspace::default());
        apply(&mut tree, &mut w, mode);
        apply(&mut copy, &mut wc, mode);
        check(&tree, &expected);
        check(&copy, &expected);
        assert_eq!(bytes(&copy), bytes(&tree));
        let mut captured = restored(&tree);
        // Preserve pending flags and future continuation, not just present bounds.
        for mode in [Mode::Preserve, Mode::Resolve, Mode::InPlace, Mode::Resolve] {
            apply(&mut tree, &mut w, mode);
            apply(&mut captured, &mut wc, mode);
            assert_eq!(bytes(&captured), bytes(&tree));
            check(&tree, &expected);
        }
    }
}
#[test]
fn bvh_refit_depth_resolving_layout_handles_deep_saved_chain() {
    deep(Mode::Resolve)
}
#[test]
fn bvh_refit_depth_preserving_layout_handles_deep_saved_chain() {
    deep(Mode::Preserve)
}
#[test]
fn bvh_refit_depth_in_place_handles_deep_saved_chain() {
    deep(Mode::InPlace)
}

fn digest(tree: &Bvh) -> u64 {
    bytes(tree).into_iter().fold(0xcbf29ce484222325, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    })
}
#[test]
fn bvh_refit_pinned_layout_flags_and_churn_match_pre_fix_native_bytes() {
    let mut hashes = Vec::new();
    for strategy in [BvhBuildStrategy::Binned, BvhBuildStrategy::Ploc] {
        for seed in 0..4usize {
            let boxes: Vec<_> = (0..32usize)
                .map(|i| {
                    let p = Vector::new(
                        ((i * 17 + seed * 13) % 23) as f32 * 0.45,
                        ((i * 7 + seed * 11) % 19) as f32 * 0.35,
                        0.,
                    );
                    Aabb::new(p, p + Vector::new(1.5, 1.5, 1.))
                })
                .collect();
            let mut tree = Bvh::from_leaves(strategy, &boxes);
            let mut w = BvhWorkspace::default();
            for (i, b) in boxes.iter().enumerate().filter(|(i, _)| i % 4 == seed) {
                tree.insert_or_update_partially(
                    Aabb::new(b.mins + Vector::X * 0.25, b.maxs + Vector::X * 0.25),
                    i as u32,
                    0.1,
                );
            }
            let expected: Vec<_> = (0..32u32)
                .map(|i| tree.leaf_node(i).unwrap().aabb())
                .collect();
            for mode in [Mode::Preserve, Mode::Resolve, Mode::InPlace] {
                apply(&mut tree, &mut w, mode);
                check(&tree, &expected);
                restored(&tree);
                hashes.push(digest(&tree));
            }
            for tick in 0..20u32 {
                let key = tick % 32;
                tree.remove(key);
                tree.insert(
                    Aabb::new(Vector::splat(tick as f32), Vector::splat(tick as f32 + 0.5)),
                    key,
                );
                if tick % 3 == 0 {
                    tree.optimize_incremental(&mut w);
                }
            }
            tree.remove(7);
            tree.refit_without_resolve(&mut w);
            restored(&tree);
            hashes.push(digest(&tree));
            tree.insert(boxes[7], 7);
            tree.refit(&mut w);
            restored(&tree);
            hashes.push(digest(&tree));
        }
    }
    // Captured before production edits; never regenerate to accept changed bytes.
    const EXPECTED_LAYOUT: [u64; 40] = [
        7443781739930493152,
        14221444747490639100,
        11391201185460826312,
        8836693212017106871,
        13817311359011763755,
        14782120412913217265,
        7972559717399759609,
        14545652395275151001,
        7638085055561994467,
        4615919662175328051,
        10546651341743779994,
        12017202408846204946,
        9792009427487573370,
        934257513498479648,
        8651147806328911894,
        17703432704834360386,
        5450334313103445590,
        17105892215794768066,
        9923719843173216113,
        7050220296445318899,
        8599031893253033958,
        7761375875533805826,
        3607534840218529134,
        10443838596198572417,
        17616725427400656948,
        15556072028886244688,
        16849993303507149140,
        16696455463155542576,
        8487678490015655886,
        2710621303922394487,
        2437261329139387628,
        13136889754351200200,
        10020023350210707972,
        17720618039594879264,
        7372927050459595436,
        10372114390762366316,
        14999690434893280440,
        8726643557805327724,
        13791454628633073248,
        52951031812101605,
    ];
    assert_eq!(hashes, EXPECTED_LAYOUT);
}
#[test]
fn bvh_refit_empty_singleton_and_root_leaf_flags_keep_pre_fix_wire() {
    let mut hashes = Vec::new();
    for strategy in [BvhBuildStrategy::Binned, BvhBuildStrategy::Ploc] {
        for n in 0..4 {
            let boxes: Vec<_> = (0..n)
                .map(|i| {
                    Aabb::new(
                        Vector::splat(i as f32 * 3.),
                        Vector::splat(i as f32 * 3. + 1.),
                    )
                })
                .collect();
            let mut tree = Bvh::from_leaves(strategy, &boxes);
            let mut w = BvhWorkspace::default();
            if n > 0 {
                tree.insert_or_update_partially(
                    Aabb::new(Vector::splat(-2.), Vector::splat(-1.)),
                    0,
                    0.1,
                );
            }
            for mode in [Mode::InPlace, Mode::Preserve, Mode::Resolve] {
                apply(&mut tree, &mut w, mode);
                restored(&tree);
                hashes.push(digest(&tree));
            }
        }
    }
    // Captured before production edits; never regenerate to accept changed bytes.
    const EXPECTED_ROOT: [u64; 24] = [
        8614007388540201639,
        8614007388540201639,
        8614007388540201639,
        11160084893107009974,
        11160084893107009974,
        16276499599657963822,
        6009716219022601536,
        6009716219022601536,
        13589109493936077952,
        9827324738017568882,
        9827324738017568882,
        10458307326010893722,
        8614007388540201639,
        8614007388540201639,
        8614007388540201639,
        11160084893107009974,
        11160084893107009974,
        16276499599657963822,
        6009716219022601536,
        6009716219022601536,
        13589109493936077952,
        9497958827552065540,
        9497958827552065540,
        12970321660630697984,
    ];
    assert_eq!(hashes, EXPECTED_ROOT);
}

#[test]
fn bvh_refit_keeps_unused_root_parent_and_sparse_leaf_mapping() {
    let mut tree = Bvh::from_leaves(
        BvhBuildStrategy::Binned,
        &(0..32)
            .map(|i| {
                let p = Vector::splat(i as f32 * 3.);
                Aabb::new(p, p + Vector::ONE)
            })
            .collect::<Vec<_>>(),
    );
    let old = tree.leaf_node(0).unwrap().aabb();
    tree.remove(0);
    tree.insert(old, 9000);
    let mut wire: super::bvh_depth::Tree = postcard::from_bytes(&bytes(&tree)).unwrap();
    // This root-parent slot is unused by the rooted graph and accepted by the
    // existing codec. Refit must preserve it instead of normalizing valid bytes.
    wire.parents[0] = 123;
    tree = with_limits(&postcard::to_allocvec(&wire).unwrap(), Limits::default())
        .unwrap()
        .0;
    let mut w = BvhWorkspace::default();
    for mode in [Mode::Preserve, Mode::Resolve, Mode::InPlace] {
        apply(&mut tree, &mut w, mode);
        assert!(tree.leaf_node(0).is_none());
        assert_eq!(tree.leaf_node(9000).unwrap().aabb(), old);
        let wire: super::bvh_depth::Tree = postcard::from_bytes(&bytes(&tree)).unwrap();
        assert_eq!(wire.parents[0], 123);
        restored(&tree);
    }
}

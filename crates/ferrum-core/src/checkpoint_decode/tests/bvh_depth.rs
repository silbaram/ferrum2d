use super::*;
use rapier3d::parry::{
    bounding_volume::Aabb,
    partitioning::{Bvh, BvhBuildStrategy, BvhWorkspace},
};
use rapier3d::prelude::Vector;

// Exact pinned wire fixtures. Every synthetic tree is accepted by the checked
// production Deserialize and its bytes must round-trip before any query runs.
#[derive(Serialize, Deserialize)]
struct Node {
    mins: Vector,
    children: u32,
    maxs: Vector,
    data: u32,
}
#[derive(Serialize, Deserialize)]
struct Wide {
    left: Node,
    right: Node,
}
#[derive(Serialize, Deserialize)]
struct Map {
    n: usize,
    v: Vec<Option<usize>>,
}
#[derive(Serialize, Deserialize)]
struct Optimization {
    frame: u32,
    start: u32,
}
#[derive(Serialize, Deserialize)]
pub(super) struct Tree {
    nodes: Vec<Wide>,
    pub(super) parents: Vec<usize>,
    leaves: Map,
    optimization: Optimization,
    free: Vec<u32>,
}
fn bounds(i: usize) -> Aabb {
    Aabb::new(
        Vector::new(i as f32 * 3., 0., 0.),
        Vector::new(i as f32 * 3. + 1., 1., 1.),
    )
}
fn node(aabb: Aabb, children: u32, count: u32) -> Node {
    Node {
        mins: aabb.mins,
        maxs: aabb.maxs,
        children,
        data: count,
    }
}
pub(super) fn chain_tree(depth: usize, paired: bool) -> Bvh {
    assert!(depth > 1);
    let copies = if paired { 2 } else { 1 };
    let offset = usize::from(paired);
    let mut nodes = Vec::with_capacity(depth * copies + offset);
    let mut parents = Vec::with_capacity(nodes.capacity());
    let mut leaves = vec![None; (depth + 1) * copies];
    if paired {
        let all = Aabb::new(bounds(0).mins, bounds(depth).maxs);
        nodes.push(Wide {
            left: node(all, 1, (depth + 1) as u32),
            right: node(all, (depth + 1) as u32, (depth + 1) as u32),
        });
        parents.push(0);
    }
    for copy in 0..copies {
        let first = offset + copy * depth;
        let key = copy * (depth + 1);
        for i in 0..depth {
            let id = first + i;
            let left = if i + 1 == depth {
                leaves[key + depth] = Some(id * 2);
                node(bounds(depth), (key + depth) as u32, 1)
            } else {
                node(
                    Aabb::new(bounds(i + 1).mins, bounds(depth).maxs),
                    (id + 1) as u32,
                    (depth - i) as u32,
                )
            };
            leaves[key + i] = Some(id * 2 + 1);
            nodes.push(Wide {
                left,
                right: node(bounds(i), (key + i) as u32, 1),
            });
            parents.push(if i == 0 {
                if paired {
                    copy
                } else {
                    0
                }
            } else {
                (id - 1) * 2
            });
        }
    }
    let wire = Tree {
        nodes,
        parents,
        leaves: Map {
            n: leaves.len(),
            v: leaves,
        },
        optimization: Optimization { frame: 0, start: 0 },
        free: vec![],
    };
    let bytes = postcard::to_allocvec(&wire).unwrap();
    let tree: Bvh = with_limits(&bytes, Limits::default()).unwrap().0;
    assert_eq!(postcard::to_allocvec(&tree).unwrap(), bytes);
    tree
}

pub(super) const DEEP: usize = 16_384;
#[test]
fn bvh_depth_keeps_empty_singleton_and_small_tree_depth_conventions() {
    assert_eq!(Bvh::new().subtree_depth(0), 0);
    for strategy in [BvhBuildStrategy::Binned, BvhBuildStrategy::Ploc] {
        for (leaves, expected) in [(1, 1), (2, 2), (3, 3)] {
            let tree = Bvh::from_leaves(strategy, &(0..leaves).map(bounds).collect::<Vec<_>>());
            assert_eq!(tree.subtree_depth(0), expected);
        }
    }
    assert_eq!(chain_tree(3, true).subtree_depth(0), 5);
}
#[test]
fn bvh_depth_measurement_accepts_deep_valid_saved_chain() {
    let tree = chain_tree(DEEP, false);
    assert_eq!(tree.subtree_depth(0), DEEP as u32 + 1);
    assert_eq!(
        tree.subtree_depth((DEEP / 2) as u32),
        (DEEP - DEEP / 2) as u32 + 1
    );
}
#[test]
fn bvh_depth_self_query_accepts_deep_valid_saved_chain() {
    let tree = chain_tree(DEEP, false);
    let before = postcard::to_allocvec(&tree).unwrap();
    tree.traverse_bvtt_single_tree::<false>(&mut BvhWorkspace::default(), &mut |_, _| {
        panic!("disjoint leaves cannot overlap")
    });
    assert_eq!(postcard::to_allocvec(&tree).unwrap(), before);
}
#[test]
fn bvh_depth_pair_query_keeps_every_pair_and_callback_order_on_deep_chain() {
    let tree = chain_tree(DEEP, true);
    let before = postcard::to_allocvec(&tree).unwrap();
    let mut workspace = BvhWorkspace::default();
    for _ in 0..2 {
        let mut expected = DEEP + 1;
        tree.traverse_bvtt_single_tree::<false>(&mut workspace, &mut |a, b| {
            expected -= 1;
            assert_eq!((a, b), (expected as u32, (expected + DEEP + 1) as u32));
        });
        assert_eq!(expected, 0);
    }
    assert_eq!(postcard::to_allocvec(&tree).unwrap(), before);
}

fn callback_hash(pairs: &[(u32, u32)]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for n in core::iter::once(pairs.len() as u32).chain(pairs.iter().flat_map(|(a, b)| [*a, *b])) {
        for byte in n.to_le_bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}
#[test]
fn bvh_depth_callback_order_and_changed_filter_match_pinned_native_results() {
    let mut hashes = Vec::new();
    for strategy in [BvhBuildStrategy::Binned, BvhBuildStrategy::Ploc] {
        for seed in 0..4usize {
            let mut boxes: Vec<_> = (0..32usize)
                .map(|i| {
                    let x = ((i * 17 + seed * 13) % 23) as f32 * 0.45;
                    let y = ((i * 7 + seed * 11) % 19) as f32 * 0.35;
                    Aabb::new(Vector::new(x, y, 0.), Vector::new(x + 1.5, y + 1.5, 1.))
                })
                .collect();
            let mut tree = Bvh::from_leaves(strategy, &boxes);
            let mut workspace = BvhWorkspace::default();
            for changed in [false, true] {
                if changed {
                    for (i, b) in boxes.iter_mut().enumerate().filter(|(i, _)| i % 4 == seed) {
                        b.mins.x += 0.25;
                        b.maxs.x += 0.25;
                        tree.insert_or_update_partially(*b, i as u32, 0.1);
                    }
                    tree.refit(&mut workspace);
                }
                for filtered in [false, true] {
                    let mut actual = Vec::new();
                    if filtered {
                        tree.traverse_bvtt_single_tree::<true>(&mut workspace, &mut |a, b| {
                            actual.push((a, b))
                        });
                    } else {
                        tree.traverse_bvtt_single_tree::<false>(&mut workspace, &mut |a, b| {
                            actual.push((a, b))
                        });
                    }
                    hashes.push(callback_hash(&actual));
                    let mut expected = Vec::new();
                    for a in 0..boxes.len() {
                        for b in a + 1..boxes.len() {
                            let a_node = tree.leaf_node(a as u32).unwrap();
                            let b_node = tree.leaf_node(b as u32).unwrap();
                            let changed_pair = a_node.is_changed() || b_node.is_changed();
                            // This is a BVH broad-phase query: native leaves may
                            // include the update margin, not just thin geometry.
                            if (!filtered || changed_pair)
                                && a_node.aabb().mins.cmple(b_node.aabb().maxs).all()
                                && b_node.aabb().mins.cmple(a_node.aabb().maxs).all()
                            {
                                expected.push((a as u32, b as u32));
                            }
                        }
                    }
                    let mut canonical: Vec<_> = actual
                        .into_iter()
                        .map(|(a, b)| (a.min(b), a.max(b)))
                        .collect();
                    canonical.sort_unstable();
                    assert_eq!(canonical, expected);
                }
            }
        }
    }
    // Captured from the unchanged pinned native traversal before this fix;
    // see bvh-depth-callback-golden-provenance.json. Never regenerate to accept a changed order.
    const EXPECTED: [u64; 32] = [
        17380083254937206470,
        17380083254937206470,
        4885584856945989383,
        4333557075718643163,
        13173044633380606114,
        13173044633380606114,
        13173044633380606114,
        15292665938030949209,
        2700031809064386098,
        2700031809064386098,
        883898804516591704,
        18095365340705858373,
        4188808073648544660,
        4188808073648544660,
        2998406742737726270,
        5432030445503955955,
        15163955728034679238,
        15163955728034679238,
        16693985901330912455,
        13591983541139959835,
        14768671828109817106,
        14768671828109817106,
        14768671828109817106,
        4290431357705454249,
        11780753213609734306,
        11780753213609734306,
        5064636101123413784,
        14052122544537419925,
        14730168299217473860,
        14730168299217473860,
        6009182741553821358,
        9192938627387948451,
    ];
    assert_eq!(hashes, EXPECTED);
}

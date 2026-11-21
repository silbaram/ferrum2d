use super::*;
use rapier3d::parry::{
    bounding_volume::Aabb,
    partitioning::{Bvh, BvhBuildStrategy, BvhWorkspace},
    query::RayCast,
    shape::{HeightField, HeightFieldCellStatus, HeightFieldFlags},
    utils::{Array2, VecMap},
};
use rapier3d::prelude as rp;

// Pinned wire fixtures deliberately expose corrupt metadata only in test data.
// A native Serialize -> fixture -> Serialize equality check verifies the layout.
#[derive(Clone, Serialize, Deserialize)]
struct Node {
    mins: rp::Vector,
    children: u32,
    maxs: rp::Vector,
    data: u32,
}
#[derive(Clone, Serialize, Deserialize)]
struct Wide {
    left: Node,
    right: Node,
}
#[derive(Clone, Serialize, Deserialize)]
struct Map<T> {
    n: usize,
    v: Vec<Option<T>>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Optimization {
    rebuild_frame_index: u32,
    rebuild_start_index: u32,
}
#[derive(Clone, Serialize, Deserialize)]
struct Tree {
    nodes: Vec<Wide>,
    parents: Vec<usize>,
    leaf_node_indices: Map<usize>,
    optimization: Optimization,
    free_wide_nodes: Vec<u32>,
}
fn aabb(i: u32) -> Aabb {
    Aabb::new(
        rp::Vector::new(i as f32 * 3., 0., 0.),
        rp::Vector::new(i as f32 * 3. + 1., 1., 1.),
    )
}
fn tree() -> Bvh {
    Bvh::from_leaves(
        BvhBuildStrategy::Binned,
        &(0..16).map(aabb).collect::<Vec<_>>(),
    )
}
fn wire(native: &Bvh) -> Tree {
    let bytes = postcard::to_allocvec(native).unwrap();
    let wire: Tree = postcard::from_bytes(&bytes).unwrap();
    assert_eq!(postcard::to_allocvec(&wire).unwrap(), bytes);
    wire
}
fn reject(t: &Tree) {
    let bytes = postcard::to_allocvec(t).unwrap();
    assert_eq!(
        with_limits::<Bvh>(&bytes, Limits::default())
            .unwrap_err()
            .kind,
        ErrorKind::Invalid
    );
}
fn internal(t: &Tree) -> usize {
    t.nodes
        .iter()
        .enumerate()
        .skip(1)
        .find(|(_, w)| w.left.data & 0x3fff_ffff != 0)
        .unwrap()
        .0
}

#[test]
fn geometry_admission_bvh_keeps_empty_single_binned_ploc_wire_and_leaves() {
    for strategy in [BvhBuildStrategy::Binned, BvhBuildStrategy::Ploc] {
        for n in [0, 1, 2, 16, 257] {
            let native = Bvh::from_leaves(strategy, &(0..n).map(aabb).collect::<Vec<_>>());
            wire(&native);
            let bytes = postcard::to_allocvec(&native).unwrap();
            let restored: Bvh = with_limits(&bytes, Limits::default()).unwrap().0;
            assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
            for key in 0..n {
                assert_eq!(
                    native.leaf_node(key).unwrap().aabb(),
                    restored.leaf_node(key).unwrap().aabb()
                );
            }
        }
    }
}

#[test]
fn geometry_admission_bvh_rejects_storage_and_parent_links() {
    let original = wire(&tree());
    let index = internal(&original);
    for mode in 0..5 {
        let mut t = original.clone();
        match mode {
            0 => {
                t.parents.pop();
            }
            1 => t.parents[index] = usize::MAX,
            2 => t.parents[index] ^= 1,
            3 => t.parents[index] = index * 2,
            _ => t.parents[0] = 1usize << (usize::BITS - 1),
        }
        reject(&t);
    }
}

#[test]
fn geometry_admission_bvh_rejects_child_cycles_range_and_count_mismatch() {
    let original = wire(&tree());
    for mode in 0..5 {
        let mut t = original.clone();
        match mode {
            0 => t.nodes[0].left.children = 0,
            1 => t.nodes[0].left.children = u32::MAX,
            2 => t.nodes[0].left.data = 2,
            3 => t.nodes[0].left.data = 0,
            _ => t.nodes[0].left.data = 0x3fff_ffff,
        }
        reject(&t);
    }
}

#[test]
fn geometry_admission_bvh_rejects_leaf_map_count_and_backreference() {
    let original = wire(&tree());
    for mode in 0..4 {
        let mut t = original.clone();
        match mode {
            0 => t.leaf_node_indices.n = 0,
            1 => t.leaf_node_indices.n = usize::MAX,
            2 => t.leaf_node_indices.v[0] = Some(usize::MAX),
            _ => t.leaf_node_indices.v.swap(0, 1),
        }
        reject(&t);
    }
}

#[test]
fn geometry_admission_bvh_rejects_nonfinite_and_inverted_bounds() {
    let original = wire(&tree());
    for mode in 0..3 {
        let mut t = original.clone();
        match mode {
            0 => t.nodes[0].left.mins.x = f32::NAN,
            1 => t.nodes[0].left.maxs.x = f32::INFINITY,
            _ => t.nodes[0].left.mins.x = t.nodes[0].left.maxs.x + 1.,
        }
        reject(&t);
    }
}

#[test]
fn geometry_admission_bvh_rejects_forged_free_marks_and_bad_free_slots() {
    let original = wire(&tree());
    for mode in 0..4 {
        let mut t = original.clone();
        match mode {
            0 => t.nodes[0].left.data = 0x8000_0000,
            1 => t.free_wide_nodes.push(0),
            2 => t.free_wide_nodes.push(u32::MAX),
            _ => t.free_wide_nodes.push(1),
        }
        reject(&t);
    }
    let mut native = tree();
    native.remove(3);
    let original = wire(&native);
    assert!(!original.free_wide_nodes.is_empty());
    let mut duplicate = original.clone();
    duplicate.free_wide_nodes.push(duplicate.free_wide_nodes[0]);
    reject(&duplicate);
    let mut unlisted = original;
    unlisted.free_wide_nodes.clear();
    reject(&unlisted);
}

#[test]
fn geometry_admission_bvh_dirty_free_optimization_and_churn_continue_exactly() {
    let mut native = tree();
    let mut workspace = BvhWorkspace::default();
    for tick in 0..120u32 {
        let key = tick % 16;
        native.remove(key);
        // Serialize before reuse/refit, including zeroed free slots and their order.
        let bytes = postcard::to_allocvec(&native).unwrap();
        let mut restored: Bvh = with_limits(&bytes, Limits::default()).unwrap().0;
        assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
        native.insert(aabb(tick + 20), key);
        restored.insert(aabb(tick + 20), key);
        assert_eq!(
            postcard::to_allocvec(&native).unwrap(),
            postcard::to_allocvec(&restored).unwrap()
        );
        if tick % 7 == 0 {
            native.optimize_incremental(&mut workspace);
        }
        if tick % 11 == 0 {
            native.refit(&mut workspace);
        }
        let bytes = postcard::to_allocvec(&native).unwrap();
        let restored: Bvh = with_limits(&bytes, Limits::default()).unwrap().0;
        assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
    }
    for key in 0..16 {
        native.remove(key);
    }
    let bytes = postcard::to_allocvec(&native).unwrap();
    let mut restored: Bvh = with_limits(&bytes, Limits::default()).unwrap().0;
    native.insert(aabb(5), 5);
    restored.insert(aabb(5), 5);
    assert_eq!(
        postcard::to_allocvec(&native).unwrap(),
        postcard::to_allocvec(&restored).unwrap()
    );
}

#[test]
fn geometry_admission_bvh_rebuild_ignores_retired_optimization_nodes() {
    let mut native = tree();
    let mut expected: Vec<_> = (0..16).map(aabb).collect();
    let mut workspace = BvhWorkspace::default();
    for tick in 0..20u32 {
        let key = tick % 16;
        native.remove(key);
        expected[key as usize] = aabb(tick + 20);
        native.insert(expected[key as usize], key);
        if tick % 3 == 0 {
            native.optimize_incremental(&mut workspace);
        }
    }
    let bytes = postcard::to_allocvec(&native).unwrap();
    let mut restored: Bvh = with_limits(&bytes, Limits::default()).unwrap().0;
    assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
    for strategy in [BvhBuildStrategy::Binned, BvhBuildStrategy::Ploc] {
        native.rebuild(&mut workspace, strategy);
        restored.rebuild(&mut BvhWorkspace::default(), strategy);
        for candidate in [&native, &restored] {
            assert_eq!(candidate.leaf_count(), 16);
            for (id, bounds) in expected.iter().enumerate() {
                assert_eq!(candidate.leaf_node(id as u32).unwrap().aabb(), *bounds);
                assert_eq!(
                    candidate.intersect_aabb(bounds).collect::<Vec<_>>(),
                    vec![id as u32]
                );
            }
        }
        assert_eq!(
            postcard::to_allocvec(&restored).unwrap(),
            postcard::to_allocvec(&native).unwrap()
        );
    }
}

#[test]
fn geometry_admission_bvh_pending_partial_update_survives_until_refit() {
    for margin in [0.0, 0.1] {
        let mut native = tree();
        native.insert_or_update_partially(aabb(100), 3, margin);
        let bytes = postcard::to_allocvec(&native).unwrap();
        let mut restored: Bvh = with_limits(&bytes, Limits::default()).unwrap().0;
        assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
        let mut a = BvhWorkspace::default();
        let mut b = BvhWorkspace::default();
        native.refit(&mut a);
        restored.refit(&mut b);
        assert_eq!(
            postcard::to_allocvec(&restored).unwrap(),
            postcard::to_allocvec(&native).unwrap()
        );
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct Array<T> {
    nrows: usize,
    ncols: usize,
    data: Vec<T>,
}
#[test]
fn geometry_admission_array_dimensions_are_checked_before_indexed_use() {
    for (nrows, ncols, data) in [
        (usize::MAX, 2, vec![]),
        (2, 2, vec![0u32; 3]),
        (0, 0, vec![1]),
    ] {
        let bytes = postcard::to_allocvec(&Array { nrows, ncols, data }).unwrap();
        assert_eq!(
            with_limits::<Array2<u32>>(&bytes, Limits::default())
                .unwrap_err()
                .kind,
            ErrorKind::Invalid
        );
    }
    for (nrows, ncols, data) in [(0, 4, vec![]), (2, 3, vec![0u32, 1, 2, 3, 4, 5])] {
        let bytes = postcard::to_allocvec(&Array {
            nrows,
            ncols,
            data: data.clone(),
        })
        .unwrap();
        let restored: Array2<u32> = with_limits(&bytes, Limits::default()).unwrap().0;
        assert_eq!(restored.data(), data);
        assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
    }
}

#[test]
fn geometry_admission_vecmap_count_is_checked_before_iterator_use() {
    for n in [0, 2, usize::MAX] {
        let bytes = postcard::to_allocvec(&Map {
            n,
            v: vec![Some(17u32), None],
        })
        .unwrap();
        assert!(with_limits::<VecMap<u32>>(&bytes, Limits::default()).is_err());
    }
    let bytes = postcard::to_allocvec(&Map {
        n: 1,
        v: vec![None, Some(17u32), None],
    })
    .unwrap();
    let restored: VecMap<u32> = with_limits(&bytes, Limits::default()).unwrap().0;
    assert_eq!(restored.iter().collect::<Vec<_>>(), vec![(1, &17)]);
    assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
}

#[derive(Clone, Serialize, Deserialize)]
struct Height {
    heights: Array<f32>,
    status: Array<u8>,
    scale: rp::Vector,
    aabb: Aabb,
    num_triangles: usize,
    flags: u8,
}
fn height() -> HeightField {
    HeightField::new(
        Array2::new(3, 4, (0..12).map(|i| i as f32 * 0.1).collect()),
        rp::Vector::new(8., 2., 6.),
    )
}
fn height_wire() -> Height {
    let bytes = postcard::to_allocvec(&height()).unwrap();
    let wire: Height = postcard::from_bytes(&bytes).unwrap();
    assert_eq!(postcard::to_allocvec(&wire).unwrap(), bytes);
    wire
}
fn reject_height(wire: Height) {
    let bytes = postcard::to_allocvec(&wire).unwrap();
    assert_eq!(
        with_limits::<HeightField>(&bytes, Limits::default())
            .unwrap_err()
            .kind,
        ErrorKind::Invalid
    );
}

#[test]
fn geometry_admission_heightfield_rejects_grid_status_and_triangle_mismatch() {
    for mode in 0..5 {
        let mut t = height_wire();
        match mode {
            0 => {
                t.heights.nrows = 0;
                t.heights.data.clear();
            }
            1 => {
                t.heights.nrows = 1;
                t.heights.data.truncate(t.heights.ncols);
            }
            2 => {
                t.status.nrows = 1;
                t.status.ncols = 6;
            }
            3 => t.num_triangles = usize::MAX,
            _ => {
                t.heights.nrows = usize::MAX;
                t.heights.ncols = 2;
            }
        }
        reject_height(t);
    }
}

#[test]
fn geometry_admission_heightfield_rejects_invalid_numbers_and_flags() {
    for mode in 0..10 {
        let mut t = height_wire();
        match mode {
            0 => t.heights.data[0] = f32::NAN,
            1 => t.scale.x = f32::INFINITY,
            2 => t.scale.z = 0.,
            3 => t.scale.x = -1.,
            4 => t.aabb.mins.x = f32::NEG_INFINITY,
            5 => t.aabb.maxs.x = t.aabb.mins.x - 1.,
            6 => t.status.data[0] = 8,
            7 => t.flags = 2,
            8 => {
                t.heights.data[0] = f32::MAX;
                t.scale.y = 2.;
            }
            _ => t.scale.x = f32::from_bits(1),
        }
        reject_height(t);
    }
}

#[test]
fn geometry_admission_heightfield_keeps_scaled_removed_cells_and_ray_result() {
    let mut native = height();
    native.set_cell_status(
        0,
        1,
        HeightFieldCellStatus::LEFT_TRIANGLE_REMOVED | HeightFieldCellStatus::ZIGZAG_SUBDIVISION,
    );
    native.set_flags(HeightFieldFlags::FIX_INTERNAL_EDGES);
    native.set_scale(rp::Vector::new(11., 3., 9.));
    let bytes = postcard::to_allocvec(&native).unwrap();
    let restored: HeightField = with_limits(&bytes, Limits::default()).unwrap().0;
    assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
    let ray = rp::Ray::new(rp::Vector::new(0., 30., 0.), -rp::Vector::Y);
    let hit = native.cast_local_ray(&ray, 100., true);
    assert!(hit.is_some());
    assert_eq!(hit, restored.cast_local_ray(&ray, 100., true));
}

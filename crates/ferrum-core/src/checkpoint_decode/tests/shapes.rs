use super::*;
use rapier3d::parry::{
    bounding_volume::Aabb,
    partitioning::Bvh,
    query::RayCast,
    shape::{
        Compound, CompoundFlags, CompoundPseudoNormals, ConvexPolyhedron, Shape, SharedShape,
        TriMesh, TriMeshConnectedComponents, TriMeshFlags, TriMeshPseudoNormals, TriMeshTopology,
    },
};
use rapier3d::prelude as rp;
use serde::de::DeserializeOwned;

fn fixture<N: Serialize, W: Serialize + DeserializeOwned>(native: &N) -> W {
    let bytes = postcard::to_allocvec(native).unwrap();
    let wire: W = postcard::from_bytes(&bytes).unwrap();
    assert_eq!(postcard::to_allocvec(&wire).unwrap(), bytes);
    wire
}
fn roundtrip<T: Serialize + DeserializeOwned>(native: &T) -> T {
    let bytes = postcard::to_allocvec(native).unwrap();
    let restored: T = with_limits(&bytes, Limits::default()).unwrap().0;
    assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
    restored
}
fn reject<N: DeserializeOwned, W: Serialize>(wire: &W) {
    let bytes = postcard::to_allocvec(wire).unwrap();
    match with_limits::<N>(&bytes, Limits::default()) {
        Err(error) => assert_eq!(error.kind, ErrorKind::Invalid),
        Ok(_) => panic!("corrupt shape was accepted"),
    }
}

fn tetrahedron() -> ConvexPolyhedron {
    ConvexPolyhedron::from_convex_hull(&[
        rp::Vector::ZERO,
        rp::Vector::X,
        rp::Vector::Y,
        rp::Vector::Z,
    ])
    .unwrap()
}

#[test]
fn shape_admission_scaled_convex_face_normals_match_geometry() {
    let hull = tetrahedron().scaled(rp::Vector::new(2., 3., 4.)).unwrap();
    for face in hull.faces() {
        let first = face.first_vertex_or_edge as usize;
        let count = face.num_vertices_or_edges as usize;
        let ids = &hull.vertices_adj_to_face()[first..first + count];
        let origin = hull.points()[ids[0] as usize];
        for &id in &ids[1..] {
            let tangent = hull.points()[id as usize] - origin;
            assert!(
                face.normal.dot(tangent).abs() < 1.0e-5,
                "scaled face normal is not perpendicular: {:?}",
                face.normal
            );
        }
    }
}

#[test]
fn shape_admission_convex_reflections_keep_winding_features_mass_and_queries() {
    let original = tetrahedron();
    for signs in 0..8 {
        let scale = rp::Vector::new(
            if signs & 1 == 0 { 2. } else { -2. },
            if signs & 2 == 0 { 3. } else { -3. },
            if signs & 4 == 0 { 4. } else { -4. },
        );
        let hull = original.clone().scaled(scale).unwrap();
        assert_eq!(hull.faces().len(), original.faces().len());
        assert_eq!(hull.edges().len(), original.edges().len());
        for (actual, point) in hull.points().iter().zip(original.points()) {
            assert_eq!(*actual, *point * scale);
        }
        for (edge, old) in hull.edges().iter().zip(original.edges()) {
            assert_eq!(edge.vertices, old.vertices);
            assert_eq!(edge.faces, old.faces);
        }
        let center = hull.points().iter().sum::<rp::Vector>() / hull.points().len() as f32;
        for face in hull.faces() {
            let start = face.first_vertex_or_edge as usize;
            let ids =
                &hull.vertices_adj_to_face()[start..start + face.num_vertices_or_edges as usize];
            let a = hull.points()[ids[0] as usize];
            let b = hull.points()[ids[1] as usize];
            let c = hull.points()[ids[2] as usize];
            assert!((b - a).cross(c - a).normalize().dot(face.normal) > 0.9999);
            assert!(face.normal.dot(center - a) < 0.);
        }
        assert!((hull.mass_properties(1.).mass() - 4.).abs() < 1.0e-4);
        let restored = roundtrip(&hull);
        let ray = rp::Ray::new(
            center + rp::Vector::new(20., 10., 30.),
            -rp::Vector::new(2., 1., 3.).normalize(),
        );
        let hit = hull
            .cast_local_ray_and_get_normal(&ray, 100., true)
            .map(|h| (h.time_of_impact, h.normal, h.feature));
        assert!(hit.is_some());
        assert_eq!(
            hit,
            restored
                .cast_local_ray_and_get_normal(&ray, 100., true)
                .map(|h| (h.time_of_impact, h.normal, h.feature))
        );
    }
}

#[test]
fn shape_admission_convex_scaling_rejects_singular_nonfinite_and_overflow() {
    for scale in [
        rp::Vector::new(0., 1., 1.),
        rp::Vector::new(1., -0., 1.),
        rp::Vector::splat(f32::NAN),
        rp::Vector::splat(f32::INFINITY),
        rp::Vector::splat(f32::from_bits(1)),
    ] {
        assert!(tetrahedron().scaled(scale).is_none());
    }
    let big = tetrahedron().scaled(rp::Vector::splat(2.)).unwrap();
    assert!(big.scaled(rp::Vector::splat(f32::MAX)).is_none());
}

#[derive(Clone, Serialize, Deserialize)]
struct ConvexVertex {
    first: u32,
    count: u32,
}
#[derive(Clone, Serialize, Deserialize)]
struct ConvexFace {
    first: u32,
    count: u32,
    normal: rp::Vector,
}
#[derive(Clone, Serialize, Deserialize)]
struct ConvexEdge {
    vertices: [u32; 2],
    faces: [u32; 2],
    dir: rp::Vector,
    deleted: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct ConvexWire {
    points: Vec<rp::Vector>,
    vertices: Vec<ConvexVertex>,
    faces: Vec<ConvexFace>,
    edges: Vec<ConvexEdge>,
    faces_adj_to_vertex: Vec<u32>,
    edges_adj_to_vertex: Vec<u32>,
    edges_adj_to_face: Vec<u32>,
    vertices_adj_to_face: Vec<u32>,
}
fn cube() -> ConvexPolyhedron {
    ConvexPolyhedron::from_convex_hull(
        &(0..8)
            .map(|i| rp::Vector::new((i & 1) as f32, ((i >> 1) & 1) as f32, ((i >> 2) & 1) as f32))
            .collect::<Vec<_>>(),
    )
    .unwrap()
}
#[test]
fn shape_admission_convex_keeps_coplanar_retired_edges_and_wire() {
    let hull = cube();
    let wire: ConvexWire = fixture(&hull);
    assert!(wire.edges.iter().any(|e| e.deleted));
    assert_eq!(wire.faces.len(), 6);
    roundtrip(&hull);
    roundtrip(&hull.scaled(rp::Vector::new(-2., 3., 4.)).unwrap());
}

#[test]
fn shape_admission_convex_keeps_planar_hulls_and_unused_mesh_vertices() {
    let planar = ConvexPolyhedron::from_convex_hull(&[
        rp::Vector::ZERO,
        rp::Vector::X,
        rp::Vector::Y,
        rp::Vector::X + rp::Vector::Y,
    ])
    .unwrap();
    roundtrip(&planar);
    let source: ConvexWire = fixture(&tetrahedron());
    let indices = source
        .faces
        .iter()
        .map(|f| {
            assert_eq!(f.count, 3);
            let i = f.first as usize;
            [
                source.vertices_adj_to_face[i],
                source.vertices_adj_to_face[i + 1],
                source.vertices_adj_to_face[i + 2],
            ]
        })
        .collect::<Vec<_>>();
    let mut points = source.points;
    points.push(rp::Vector::splat(0.1));
    let native = ConvexPolyhedron::from_convex_mesh(points, &indices).unwrap();
    assert_eq!(native.points().len(), 5);
    roundtrip(&native);
}
#[test]
fn shape_admission_convex_rejects_dimensions_ranges_and_invalid_normals() {
    let original: ConvexWire = fixture(&tetrahedron());
    for mode in 0..10 {
        let mut w = original.clone();
        match mode {
            0 => {
                w.vertices.pop();
            }
            1 => w.points[0].x = f32::NAN,
            2 => w.faces[0].first = u32::MAX,
            3 => w.faces[0].count = 2,
            4 => w.faces[0].normal = rp::Vector::ZERO,
            5 => w.edges[0].dir = rp::Vector::splat(f32::INFINITY),
            6 => w.vertices[0].count = u32::MAX,
            7 => {
                w.edges_adj_to_face.pop();
            }
            8 => w.vertices[0].first = 1,
            _ => w.edges[0].vertices[0] = u32::MAX,
        }
        reject::<ConvexPolyhedron, _>(&w);
    }
}
#[test]
fn shape_admission_convex_rejects_broken_reciprocal_and_duplicate_incidence() {
    let original: ConvexWire = fixture(&tetrahedron());
    for mode in 0..9 {
        let mut w = original.clone();
        match mode {
            0 => w.edges[0].faces[0] |= 1 << 31,
            1 => w.edges[0].faces[1] = w.edges[0].faces[0],
            2 => w.faces_adj_to_vertex[0] = u32::MAX,
            3 => w.faces_adj_to_vertex[1] = w.faces_adj_to_vertex[0],
            4 => w.edges_adj_to_vertex[0] = u32::MAX,
            5 => w.vertices_adj_to_face[0] = u32::MAX,
            6 => w.edges_adj_to_face[1] = w.edges_adj_to_face[0],
            7 => w.edges[0].deleted = true,
            _ => w.vertices_adj_to_face[1] = w.vertices_adj_to_face[0],
        }
        reject::<ConvexPolyhedron, _>(&w);
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct MeshWire {
    bvh: Bvh,
    vertices: Vec<rp::Vector>,
    indices: Vec<[u32; 3]>,
    pseudo_normals: Option<TriMeshPseudoNormals>,
    topology: Option<TriMeshTopology>,
    connected_components: Option<TriMeshConnectedComponents>,
    flags: TriMeshFlags,
}
fn mesh(flags: TriMeshFlags) -> TriMesh {
    // Two connected triangles, an isolated triangle, and an unused vertex.
    TriMesh::with_flags(
        vec![
            rp::Vector::ZERO,
            rp::Vector::X,
            rp::Vector::Y,
            rp::Vector::new(1., 1., 0.),
            rp::Vector::new(3., 0., 1.),
            rp::Vector::new(4., 0., 1.),
            rp::Vector::new(3., 1., 1.),
            rp::Vector::new(8., 9., 10.),
        ],
        vec![[0, 1, 2], [1, 3, 2], [4, 5, 6]],
        flags,
    )
    .unwrap()
}
fn mesh_flags() -> TriMeshFlags {
    TriMeshFlags::HALF_EDGE_TOPOLOGY
        | TriMeshFlags::CONNECTED_COMPONENTS
        | TriMeshFlags::ORIENTED
        | TriMeshFlags::DEFORMABLE
}
#[test]
fn shape_admission_mesh_keeps_optional_caches_deformation_and_queries() {
    for flags in [
        TriMeshFlags::empty(),
        mesh_flags(),
        TriMeshFlags::DELETE_BAD_TOPOLOGY_TRIANGLES,
        TriMeshFlags::FIX_INTERNAL_EDGES,
        TriMeshFlags::FIX_INTERNAL_EDGES_TWO_SIDED,
    ] {
        let mut native = mesh(flags);
        let _: MeshWire = fixture(&native);
        roundtrip(&native);
        native.update_vertices(|v| {
            v[2].z = 0.25;
            v[3].z = 0.5;
        });
        native.transform_vertices(&rp::Pose::from_parts(
            rp::Vector::new(2., 3., 4.),
            rp::Rotation::from_rotation_y(0.37),
        ));
        native = native.scaled(rp::Vector::new(-2., 3., 4.));
        let restored = roundtrip(&native);
        assert_eq!(native.indices(), restored.indices());
        for (i, _) in native.indices().iter().enumerate() {
            assert_eq!(
                native.bvh().leaf_node(i as u32).unwrap().aabb(),
                restored.bvh().leaf_node(i as u32).unwrap().aabb()
            );
        }
        let tri = native.triangle(0);
        let center = (tri.a + tri.b + tri.c) / 3.;
        let direction = (tri.b - tri.a).cross(tri.c - tri.a).normalize();
        let ray = rp::Ray::new(center + direction * 10., -direction);
        let hit = native
            .cast_local_ray_and_get_normal(&ray, 100., true)
            .map(|h| (h.time_of_impact, h.normal, h.feature));
        assert!(hit.is_some());
        assert_eq!(
            hit,
            restored
                .cast_local_ray_and_get_normal(&ray, 100., true)
                .map(|h| (h.time_of_impact, h.normal, h.feature))
        );
    }
}
#[test]
fn shape_admission_mesh_scaled_pseudo_normals_match_recomputed_geometry() {
    let flags = TriMeshFlags::ORIENTED;
    let native = TriMesh::with_flags(
        vec![
            rp::Vector::ZERO,
            rp::Vector::X,
            rp::Vector::new(0., 1., 1.),
            rp::Vector::Z,
        ],
        vec![[0, 1, 2], [0, 2, 3]],
        flags,
    )
    .unwrap();
    for scale in [rp::Vector::new(2., 3., 4.), rp::Vector::new(-2., 3., 4.)] {
        let scaled = native.clone().scaled(scale);
        let recomputed =
            TriMesh::with_flags(scaled.vertices().to_vec(), scaled.indices().to_vec(), flags)
                .unwrap();
        let actual: MeshWire = fixture(&scaled);
        let expected: MeshWire = fixture(&recomputed);
        let (a, b) = (
            actual.pseudo_normals.unwrap(),
            expected.pseudo_normals.unwrap(),
        );
        for (a, b) in a
            .vertices_pseudo_normal
            .iter()
            .zip(&b.vertices_pseudo_normal)
            .chain(
                a.edges_pseudo_normal
                    .iter()
                    .flatten()
                    .zip(b.edges_pseudo_normal.iter().flatten()),
            )
        {
            assert!(
                (*a - *b).length() < 1.0e-5,
                "scaled pseudo normal {a:?} differs from geometry {b:?}"
            );
        }
    }
}
#[test]
fn shape_admission_mesh_rejects_indices_flags_and_cache_sizes() {
    let original: MeshWire = fixture(&mesh(mesh_flags()));
    for mode in 0..9 {
        let mut w = original.clone();
        match mode {
            0 => w.indices[0][0] = u32::MAX,
            1 => w.vertices[0].x = f32::NAN,
            2 => w.flags = TriMeshFlags::from_bits_retain(1 << 15),
            3 => {
                w.pseudo_normals = None;
            }
            4 => {
                w.pseudo_normals
                    .as_mut()
                    .unwrap()
                    .vertices_pseudo_normal
                    .pop();
            }
            5 => {
                w.pseudo_normals.as_mut().unwrap().edges_pseudo_normal.pop();
            }
            6 => w.pseudo_normals.as_mut().unwrap().edges_pseudo_normal[0][0].z = f32::NAN,
            7 => w.topology = None,
            _ => w.connected_components = None,
        }
        reject::<TriMesh, _>(&w);
    }
}
#[test]
fn shape_admission_mesh_rejects_half_edge_cycles_twins_and_vertices() {
    let original: MeshWire = fixture(&mesh(mesh_flags()));
    for mode in 0..9 {
        let mut w = original.clone();
        let t = w.topology.as_mut().unwrap();
        match mode {
            0 => {
                t.half_edges.pop();
            }
            1 => t.faces[0].half_edge = u32::MAX,
            2 => t.half_edges[0].next = 0,
            3 => t.half_edges[0].face = 1,
            4 => t.half_edges[0].vertex = u32::MAX,
            5 => t.half_edges[0].twin = 0,
            6 => t.vertices[0].half_edge = u32::MAX,
            7 => t.vertices[0].half_edge = t.faces[2].half_edge,
            _ => {
                let h = t
                    .half_edges
                    .iter_mut()
                    .find(|h| h.twin != u32::MAX)
                    .unwrap();
                h.twin = u32::MAX - 1;
            }
        }
        reject::<TriMesh, _>(&w);
    }
}

#[test]
fn shape_admission_mesh_rejects_repeated_edge_even_with_matching_degenerate_indices() {
    let mut w: MeshWire = fixture(&mesh(mesh_flags()));
    w.indices[0] = [0, 0, 0];
    let t = w.topology.as_mut().unwrap();
    let edge = t.faces[0].half_edge;
    let h = &mut t.half_edges[edge as usize];
    h.next = edge;
    h.twin = u32::MAX;
    h.vertex = 0;
    reject::<TriMesh, _>(&w);
}

#[test]
fn shape_admission_mesh_keeps_filter_generated_empty_tree() {
    // The public builder rejects initially empty input, but DELETE_DEGENERATE
    // can legitimately remove every input triangle after construction starts.
    let native = TriMesh::with_flags(
        vec![rp::Vector::ZERO],
        vec![[0, 0, 0]],
        TriMeshFlags::DELETE_DEGENERATE_TRIANGLES
            | TriMeshFlags::MERGE_DUPLICATE_VERTICES
            | TriMeshFlags::CONNECTED_COMPONENTS,
    )
    .unwrap();
    assert!(native.indices().is_empty());
    roundtrip(&native);
}
#[test]
fn shape_admission_mesh_rejects_component_range_color_and_permutation() {
    let original: MeshWire = fixture(&mesh(mesh_flags()));
    for mode in 0..7 {
        let mut w = original.clone();
        let c = w.connected_components.as_mut().unwrap();
        match mode {
            0 => c.ranges[0] = 1,
            1 => {
                c.ranges.push(usize::MAX);
            }
            2 => c.ranges[1] = 0,
            3 => c.face_colors[0] = u32::MAX,
            4 => c.grouped_faces[1] = c.grouped_faces[0],
            5 => c.grouped_faces.swap(0, 2),
            _ => {
                c.face_colors.pop();
            }
        }
        reject::<TriMesh, _>(&w);
    }
}
#[test]
fn shape_admission_mesh_rejects_stale_geometry_tree_but_dynamic_tree_keeps_pending() {
    let native = mesh(TriMeshFlags::empty());
    let mut w: MeshWire = fixture(&native);
    // A pending dynamic tree is a legal generic BVH state, but a shape tree must
    // already cover every indexed triangle and have contiguous part IDs.
    w.bvh.insert_or_update_partially(
        Aabb::new(rp::Vector::splat(100.), rp::Vector::splat(101.)),
        0,
        0.,
    );
    roundtrip(&w.bvh);
    reject::<TriMesh, _>(&w);
    let mut w: MeshWire = fixture(&native);
    w.bvh.remove(0);
    reject::<TriMesh, _>(&w);
}

#[derive(Clone, Serialize, Deserialize)]
struct CompoundWire {
    shapes: Vec<(rp::Pose, SharedShape)>,
    bvh: Bvh,
    aabbs: Vec<Aabb>,
    aabb: Aabb,
    flags: CompoundFlags,
    pseudo_normals: Option<Vec<Option<CompoundPseudoNormals>>>,
}
fn compound(flags: CompoundFlags) -> Compound {
    Compound::with_flags(
        vec![
            (rp::Pose::IDENTITY, SharedShape::cuboid(1., 1., 1.)),
            (
                rp::Pose::translation(2., 0., 0.),
                SharedShape::cuboid(1., 1., 1.),
            ),
            (rp::Pose::translation(5., 0., 0.), SharedShape::ball(0.5)),
            (
                rp::Pose::from_parts(
                    rp::Vector::new(0., 4., 2.),
                    rp::Rotation::from_rotation_y(0.37),
                ),
                SharedShape::new(tetrahedron().scaled(rp::Vector::new(-2., 3., 4.)).unwrap()),
            ),
        ],
        flags,
        None,
    )
}
#[test]
fn shape_admission_compound_keeps_parts_bounds_normals_and_ray_features() {
    for flags in [CompoundFlags::empty(), CompoundFlags::FIX_INTERNAL_EDGES] {
        let native = compound(flags);
        let _: CompoundWire = fixture(&native);
        let restored = roundtrip(&native);
        let ray = rp::Ray::new(rp::Vector::new(-5., 0., 0.), rp::Vector::X);
        let hit = native
            .cast_local_ray_and_get_normal(&ray, 100., true)
            .map(|h| (h.time_of_impact, h.normal, h.feature));
        assert!(hit.is_some());
        assert_eq!(
            hit,
            restored
                .cast_local_ray_and_get_normal(&ray, 100., true)
                .map(|h| (h.time_of_impact, h.normal, h.feature))
        );
    }
}
#[test]
fn shape_admission_compound_rejects_part_bounds_pose_nesting_and_cache_sizes() {
    let original: CompoundWire = fixture(&compound(CompoundFlags::FIX_INTERNAL_EDGES));
    for mode in 0..10 {
        let mut w = original.clone();
        match mode {
            0 => {
                w.aabbs.pop();
            }
            1 => w.aabbs[0].maxs = rp::Vector::ZERO,
            2 => w.aabb.maxs = rp::Vector::ZERO,
            3 => w.shapes[0].0.translation.x = f32::NAN,
            4 => w.shapes[0].0.rotation = rp::Rotation::from_xyzw(0., 0., 0., 0.),
            5 => w.shapes[0].1 = SharedShape::new(compound(CompoundFlags::empty())),
            6 => w.pseudo_normals = None,
            7 => {
                w.pseudo_normals.as_mut().unwrap().pop();
            }
            8 => {
                w.pseudo_normals.as_mut().unwrap()[0]
                    .as_mut()
                    .unwrap()
                    .boundary_faces[0]
                    .face
                    .x = f32::INFINITY
            }
            _ => w.flags = CompoundFlags::from_bits_retain(1 << 7),
        }
        reject::<Compound, _>(&w);
    }
}
#[test]
fn shape_admission_compound_rejects_wrong_leaf_ids_and_stale_part_tree() {
    let original = compound(CompoundFlags::empty());
    let mut w: CompoundWire = fixture(&original);
    w.bvh.remove(0);
    let bounds = w.aabbs[0];
    w.bvh.insert(bounds, 99);
    reject::<Compound, _>(&w);
    let mut w: CompoundWire = fixture(&original);
    w.bvh.insert_or_update_partially(
        Aabb::new(rp::Vector::splat(100.), rp::Vector::splat(101.)),
        0,
        0.,
    );
    reject::<Compound, _>(&w);
}
#[test]
fn shape_admission_shared_primitives_reject_invalid_numbers_before_geometry_use() {
    use rapier3d::parry::shape::{
        Ball, Capsule, Cone, Cuboid, Cylinder, HalfSpace, RoundShape, Segment,
    };
    for shape in [
        SharedShape::ball(1.),
        SharedShape::cuboid(1., 2., 3.),
        SharedShape::capsule_y(1., 0.5),
        SharedShape::cylinder(1., 0.5),
        SharedShape::cone(1., 0.5),
        SharedShape::halfspace(rp::Vector::Y),
    ] {
        // Generic vendor value-data Serde supports more primitive types than
        // Ferrum native checkpoints. Keep its numeric validation independently
        // covered instead of letting the checkpoint tag policy mask it.
        let bytes = postcard::to_allocvec(&shape).unwrap();
        let restored: SharedShape = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
    }
    for invalid in [
        SharedShape::new(Ball { radius: -1. }),
        SharedShape::new(Ball { radius: f32::NAN }),
        SharedShape::new(Cuboid {
            half_extents: rp::Vector::new(-1., 2., 3.),
        }),
        SharedShape::new(Capsule {
            segment: Segment::new(rp::Vector::ZERO, rp::Vector::Y),
            radius: -1.,
        }),
        SharedShape::new(Segment::new(
            rp::Vector::ZERO,
            rp::Vector::splat(f32::INFINITY),
        )),
        SharedShape::new(Cylinder {
            half_height: -1.,
            radius: 1.,
        }),
        SharedShape::new(Cone {
            half_height: 1.,
            radius: -1.,
        }),
        SharedShape::new(HalfSpace {
            normal: rp::Vector::ZERO,
        }),
        SharedShape::new(RoundShape {
            inner_shape: Cuboid {
                half_extents: rp::Vector::ONE,
            },
            border_radius: -1.,
        }),
    ] {
        let bytes = postcard::to_allocvec(&invalid).unwrap();
        assert!(postcard::from_bytes::<SharedShape>(&bytes).is_err());
        reject::<SharedShape, _>(&invalid);
    }
}

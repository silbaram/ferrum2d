use super::*;
use rapier3d::parry::{
    bounding_volume::Aabb,
    partitioning::Bvh,
    shape::{CompoundFlags, CompoundPseudoNormals, SharedShape, Voxels},
    utils::Array2,
};
use rapier3d::prelude as rp;

fn supported() -> Vec<(u8, SharedShape)> {
    vec![
        (0, SharedShape::ball(0.5)),
        (1, SharedShape::cuboid(0.5, 0.75, 1.)),
        (2, SharedShape::capsule_y(0.4, 0.25)),
        (
            11,
            SharedShape::convex_hull(&[
                rp::Vector::ZERO,
                rp::Vector::X,
                rp::Vector::Y,
                rp::Vector::Z,
            ])
            .unwrap(),
        ),
        (
            6,
            SharedShape::trimesh(
                vec![
                    rp::Vector::new(-1., 0., -1.),
                    rp::Vector::new(1., 0., -1.),
                    rp::Vector::new(0., 0., 1.),
                ],
                vec![[0, 1, 2]],
            )
            .unwrap(),
        ),
        (
            9,
            SharedShape::heightfield(Array2::new(2, 2, vec![0.; 4]), rp::Vector::new(2., 1., 2.)),
        ),
        (
            10,
            SharedShape::compound(vec![
                (rp::Pose::IDENTITY, SharedShape::ball(0.5)),
                (
                    rp::Pose::translation(2., 0., 0.),
                    SharedShape::capsule_y(0.4, 0.25),
                ),
            ]),
        ),
    ]
}

fn unsupported() -> Vec<(u8, SharedShape)> {
    vec![
        (3, SharedShape::segment(rp::Vector::ZERO, rp::Vector::X)),
        (
            4,
            SharedShape::triangle(rp::Vector::ZERO, rp::Vector::X, rp::Vector::Y),
        ),
        (
            5,
            SharedShape::new(Voxels::from_points(rp::Vector::ONE, &[rp::Vector::ZERO])),
        ),
        (
            7,
            SharedShape::polyline(
                (0..4096)
                    .map(|i| rp::Vector::new(i as f32, 0., 0.))
                    .collect(),
                None,
            ),
        ),
        (8, SharedShape::halfspace(rp::Vector::Y)),
        (12, SharedShape::cylinder(1., 0.5)),
        (13, SharedShape::cone(1., 0.5)),
        (14, SharedShape::round_cuboid(1., 1., 1., 0.1)),
        (
            15,
            SharedShape::round_triangle(rp::Vector::ZERO, rp::Vector::X, rp::Vector::Y, 0.1),
        ),
        (16, SharedShape::round_cylinder(1., 0.5, 0.1)),
        (17, SharedShape::round_cone(1., 0.5, 0.1)),
        (
            18,
            SharedShape::round_convex_hull(
                &[
                    rp::Vector::ZERO,
                    rp::Vector::X,
                    rp::Vector::Y,
                    rp::Vector::Z,
                ],
                0.1,
            )
            .unwrap(),
        ),
    ]
}

#[test]
fn native_shape_boundary_keeps_all_seven_pinned_tags_bytes_and_queries() {
    for (tag, shape) in supported() {
        let bytes = postcard::to_allocvec(&shape).unwrap();
        assert_eq!(bytes[0], tag, "the pinned vendor wire tag changed");
        let restored: SharedShape = from_bytes(&bytes).unwrap();
        assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
        assert_eq!(shape.compute_local_aabb(), restored.compute_local_aabb());
        let mut hit_count = 0;
        for direction in [rp::Vector::X, rp::Vector::Y, rp::Vector::Z] {
            let ray = rp::Ray::new(-direction * 4., direction);
            let hit = |s: &SharedShape| {
                s.cast_local_ray_and_get_normal(&ray, 10., true)
                    .map(|h| (h.time_of_impact, h.normal, h.feature))
            };
            let expected = hit(&shape);
            hit_count += usize::from(expected.is_some());
            assert_eq!(hit(&restored), expected);
        }
        assert!(hit_count > 0, "each shape must exercise an actual ray hit");
    }
}

#[test]
fn native_shape_boundary_rejects_actual_unsupported_shapes_before_payload() {
    for (tag, shape) in unsupported() {
        let bytes = postcard::to_allocvec(&shape).unwrap();
        assert_eq!(bytes[0], tag, "the pinned vendor wire tag changed");
        // Independent vendor value-data Serde is intentionally unchanged.
        let generic: SharedShape = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(postcard::to_allocvec(&generic).unwrap(), bytes);
        let full = from_bytes::<SharedShape>(&bytes).unwrap_err();
        let tag_only = from_bytes::<SharedShape>(&bytes[..1]).unwrap_err();
        assert_eq!(full.kind, ErrorKind::Invalid);
        assert_eq!(full, tag_only, "unsupported payload must not be visited");
        assert_eq!(full.usage.values, 2, "only enum and tag are decoded");
    }
    // The custom marker and an out-of-range tag are denied without payload too.
    for tag in [19u32, u32::MAX] {
        let bytes = postcard::to_allocvec(&tag).unwrap();
        let error = from_bytes::<SharedShape>(&bytes).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Invalid);
        assert_eq!(error.usage.values, 2);
    }
}

#[test]
fn native_shape_boundary_rejects_compound_child_before_child_payload_and_bvh() {
    for shape in [
        SharedShape::cylinder(1., 0.5),
        SharedShape::round_cuboid(1., 1., 1., 0.1),
    ] {
        let compound = SharedShape::compound(vec![(rp::Pose::IDENTITY, shape.clone())]);
        let bytes = postcard::to_allocvec(&compound).unwrap();
        let child = postcard::to_allocvec(&shape).unwrap();
        let prefix = postcard::to_allocvec(&(1usize, rp::Pose::IDENTITY)).unwrap();
        let child_offset = 1 + prefix.len();
        assert_eq!(&bytes[child_offset..child_offset + child.len()], child);
        let full = from_bytes::<SharedShape>(&bytes).unwrap_err();
        let tag_only = from_bytes::<SharedShape>(&bytes[..child_offset + 1]).unwrap_err();
        assert_eq!(full.kind, ErrorKind::Invalid);
        assert_eq!(
            full, tag_only,
            "do not visit child payload or remaining BVH"
        );
    }
}

#[derive(Serialize, Deserialize)]
struct CompoundWire {
    shapes: Vec<(rp::Pose, SharedShape)>,
    bvh: Bvh,
    aabbs: Vec<Aabb>,
    aabb: Aabb,
    flags: CompoundFlags,
    pseudo_normals: Option<Vec<Option<CompoundPseudoNormals>>>,
}

#[test]
fn native_shape_boundary_keeps_numeric_and_late_compound_rotation_guards() {
    let native = SharedShape::compound(vec![
        (rp::Pose::IDENTITY, SharedShape::ball(0.5)),
        (
            rp::Pose::translation(2., 0., 0.),
            SharedShape::capsule_y(0.4, 0.25),
        ),
    ]);
    let bytes = postcard::to_allocvec(&native).unwrap();
    let mut wire: CompoundWire = postcard::from_bytes(&bytes[1..]).unwrap();
    let mut copied = vec![10];
    copied.extend(postcard::to_allocvec(&wire).unwrap());
    assert_eq!(
        copied, bytes,
        "corruption fixture must preserve pinned wire"
    );
    wire.shapes[1].0.rotation = rp::Rotation::from_xyzw(0., 0., 0., 2.);
    let mut bad = vec![10];
    bad.extend(postcard::to_allocvec(&wire).unwrap());
    assert_eq!(
        from_bytes::<SharedShape>(&bad).unwrap_err().kind,
        ErrorKind::Invalid
    );
    assert!(
        from_bytes::<SharedShape>(&bytes).is_ok(),
        "failed scopes clean up"
    );

    let mut bad = postcard::to_allocvec(&SharedShape::ball(0.5)).unwrap();
    bad[1..5].copy_from_slice(&f32::NAN.to_le_bytes());
    assert_eq!(
        from_bytes::<SharedShape>(&bad).unwrap_err().kind,
        ErrorKind::Invalid
    );
}

#[test]
fn native_shape_boundary_preserves_saved_world_bytes_and_actual_continuation() {
    use crate::physics3d::{
        BodyDesc, BodyKind, ColliderDesc, PhysicsWorld3d, Pose, QueryFilter, RayCast as Cast,
        Shape, WorldConfig,
    };
    let geometry = vec![
        Shape::Box {
            half_extents: [0.5; 3],
        },
        Shape::Sphere { radius: 0.5 },
        Shape::Capsule {
            half_height: 0.4,
            radius: 0.25,
        },
        Shape::ConvexHull {
            points: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
        },
        Shape::TriangleMesh {
            vertices: vec![[-1., 0., -1.], [1., 0., -1.], [0., 0., 1.]],
            triangles: vec![[0, 1, 2]],
        },
        Shape::Heightfield {
            rows: 2,
            columns: 2,
            heights: vec![0.; 4],
            size: [2., 2.],
        },
        Shape::Compound {
            parts: vec![crate::physics3d::ShapePart {
                pose: Pose::default(),
                shape: Shape::Sphere { radius: 0.5 },
            }],
        },
    ];
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    for (index, shape) in geometry.into_iter().enumerate() {
        world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position: [index as f32 * 4., 0., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc::new(shape),
            )
            .unwrap();
    }
    let body = world
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [0., 2., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        )
        .unwrap();
    for _ in 0..60 {
        world.step();
    }
    let saved = world.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&saved).unwrap();
    assert_eq!(
        restored.capture_snapshot().unwrap().encoded_bytes(),
        saved.encoded_bytes()
    );
    for tick in 0..20 {
        if tick == 3 {
            world.apply_impulse(body, [0.2, 0.4, 0.]).unwrap();
            restored.apply_impulse(body, [0.2, 0.4, 0.]).unwrap();
        }
        world.step();
        restored.step();
        assert_eq!(world.body_state(body), restored.body_state(body));
        for index in 0..7 {
            let ray = Cast {
                origin: [index as f32 * 4., 4., 0.],
                direction: [0., -1., 0.],
                max_distance: 10.,
                solid: true,
            };
            assert_eq!(
                world.cast_ray(&ray, &QueryFilter::default()),
                restored.cast_ray(&ray, &QueryFilter::default())
            );
        }
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}

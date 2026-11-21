use super::*;
use rapier3d::parry::{
    query::{
        details::VoxelsShapeContactManifoldsWorkspace, ContactManifold, ContactManifoldsWorkspace,
        DefaultQueryDispatcher, PersistentQueryDispatcher,
    },
    shape::SharedShape,
    utils::Array2,
};
use rapier3d::prelude as rp;

#[test]
fn native_workspace_boundary_preserves_five_empty_and_actual_query_variants() {
    let ball = SharedShape::ball(0.3);
    let mesh = SharedShape::trimesh(
        vec![
            rp::Vector::new(-2.0, 0.0, -2.0),
            rp::Vector::new(2.0, 0.0, -2.0),
            rp::Vector::new(0.0, 0.0, 2.0),
        ],
        vec![[0, 1, 2]],
    )
    .unwrap();
    let heightfield = SharedShape::heightfield(
        Array2::new(2, 2, vec![0.0; 4]),
        rp::Vector::new(4.0, 1.0, 4.0),
    );
    let compound = SharedShape::compound(vec![
        (rp::Pose::IDENTITY, ball.clone()),
        (rp::Pose::translation(0.5, 0.0, 0.0), ball.clone()),
    ]);
    for (tag, a, b) in [
        (0, &mesh, &ball),
        (1, &heightfield, &ball),
        (2, &heightfield, &compound),
        (3, &compound, &compound),
        (4, &compound, &ball),
    ] {
        let mut manifolds: Vec<ContactManifold<(), ()>> = Vec::new();
        let mut workspace = None;
        // Generate an actual empty cache through the dispatcher without
        // exposing private vendor workspace constructors to Ferrum.
        DefaultQueryDispatcher
            .contact_manifolds(
                &rp::Pose::translation(0.0, 10.0, 0.0),
                &**a,
                &**b,
                0.01,
                &mut manifolds,
                &mut workspace,
            )
            .unwrap();
        assert!(manifolds.is_empty());
        let empty = postcard::to_allocvec(workspace.as_ref().unwrap()).unwrap();
        assert_eq!(empty[0], tag);
        let restored: ContactManifoldsWorkspace = from_bytes(&empty).unwrap();
        assert_eq!(postcard::to_allocvec(&restored).unwrap(), empty);
        DefaultQueryDispatcher
            .contact_manifolds(
                &rp::Pose::IDENTITY,
                &**a,
                &**b,
                0.01,
                &mut manifolds,
                &mut workspace,
            )
            .unwrap();
        assert!(manifolds.iter().any(|m| !m.points.is_empty()));
        assert_eq!(
            postcard::to_allocvec(workspace.as_ref().unwrap()).unwrap()[0],
            tag
        );
        let bytes = postcard::to_allocvec(&(manifolds.clone(), workspace.clone())).unwrap();
        let (mut restored_manifolds, mut restored_workspace): (
            Vec<ContactManifold<(), ()>>,
            Option<ContactManifoldsWorkspace>,
        ) = from_bytes(&bytes).unwrap();
        assert_eq!(
            postcard::to_allocvec(&(&restored_manifolds, &restored_workspace)).unwrap(),
            bytes
        );
        for step in 1..=6 {
            let pose = rp::Pose::translation(step as f32 * 0.001, 0.0, 0.0);
            DefaultQueryDispatcher
                .contact_manifolds(&pose, &**a, &**b, 0.01, &mut manifolds, &mut workspace)
                .unwrap();
            DefaultQueryDispatcher
                .contact_manifolds(
                    &pose,
                    &**a,
                    &**b,
                    0.01,
                    &mut restored_manifolds,
                    &mut restored_workspace,
                )
                .unwrap();
            assert_eq!(
                postcard::to_allocvec(&(&restored_manifolds, &restored_workspace)).unwrap(),
                postcard::to_allocvec(&(&manifolds, &workspace)).unwrap(),
                "workspace tag {tag}, step {step}"
            );
        }
    }
}

#[test]
fn native_workspace_boundary_rejects_unsupported_tags_before_payload() {
    for (tag, workspace) in [
        (
            5,
            ContactManifoldsWorkspace::from(VoxelsShapeContactManifoldsWorkspace::<2>::new()),
        ),
        (
            6,
            ContactManifoldsWorkspace::from(VoxelsShapeContactManifoldsWorkspace::<3>::new()),
        ),
        (
            7,
            ContactManifoldsWorkspace::from(VoxelsShapeContactManifoldsWorkspace::<4>::new()),
        ),
    ] {
        let bytes = postcard::to_allocvec(&workspace).unwrap();
        assert_eq!(bytes[0], tag);
        // Vendor Serde retains its wider independent value-data contract.
        let generic: ContactManifoldsWorkspace = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(postcard::to_allocvec(&generic).unwrap(), bytes);
        let full = from_bytes::<ContactManifoldsWorkspace>(&bytes)
            .err()
            .unwrap();
        let tag_only = from_bytes::<ContactManifoldsWorkspace>(&bytes[..1])
            .err()
            .unwrap();
        assert_eq!(full.kind, ErrorKind::Invalid);
        assert_eq!(
            full, tag_only,
            "unsupported workspace payload must not be visited"
        );
        assert_eq!(full.usage.values, 2);
    }
    for tag in [8u32, u32::MAX] {
        let bytes = postcard::to_allocvec(&tag).unwrap();
        let failure = from_bytes::<ContactManifoldsWorkspace>(&bytes)
            .err()
            .unwrap();
        assert_eq!(failure.kind, ErrorKind::Invalid);
        assert_eq!(failure.usage.values, 2);
    }
}

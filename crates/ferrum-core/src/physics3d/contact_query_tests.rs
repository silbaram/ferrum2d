use super::*;
fn world(space: Space) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap()
}
fn fixed(position: [f32; 3]) -> BodyDesc {
    BodyDesc {
        kind: BodyKind::Fixed,
        pose: Pose {
            position,
            ..Pose::default()
        },
        ..BodyDesc::default()
    }
}
fn ball(category: u32, sensor: bool) -> ColliderDesc {
    ColliderDesc {
        category,
        sensor,
        ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
    }
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 0.0005, "{a} != {b}");
}
#[test]
fn contacts_refresh_edits_and_respect_masks_spans_sensors_and_disabled_bodies() {
    let mut w = world(Space::PlanarXy);
    let a = w.create_body(fixed([0.0; 3]), ball(2, false)).unwrap();
    let b = w
        .create_body(fixed([0.8, 0.0, 0.0]), ball(4, true))
        .unwrap();
    let c = w.collider_ids(b).unwrap().next().unwrap();
    let mut out = Vec::new();
    w.query_contact_manifolds(2, 4, false, &mut out).unwrap();
    assert!(out.is_empty());
    w.query_contact_manifolds(2, 4, true, &mut out).unwrap();
    assert_eq!(out.len(), 1);
    near(out[0].normal[0], 1.0);
    near(out[0].points[0].penetration, 0.2);
    w.set_planar_collision_span(
        a,
        Some(PlanarCollisionSpan {
            floor: 1,
            elevation: 0.0,
            height: 1.0,
        }),
    )
    .unwrap();
    w.set_planar_collision_span(
        b,
        Some(PlanarCollisionSpan {
            floor: 2,
            elevation: 0.0,
            height: 1.0,
        }),
    )
    .unwrap();
    w.query_contact_manifolds(2, 4, true, &mut out).unwrap();
    assert!(out.is_empty());
    w.set_planar_collision_span(b, None).unwrap(); // Missing span is wildcard for pairs.
    w.query_contact_manifolds(4, 2, true, &mut out).unwrap();
    assert_eq!(out[0].first.body, b);
    near(out[0].normal[0], -1.0);
    w.update_collider(
        c,
        ColliderDesc {
            mask: 0,
            ..ball(4, true)
        },
    )
    .unwrap();
    w.query_contact_manifolds(2, 4, true, &mut out).unwrap();
    assert!(out.is_empty());
    w.update_collider(c, ball(4, true)).unwrap();
    w.set_body_options(
        b,
        &BodyOptions {
            kind: BodyKind::Fixed,
            enabled: false,
            ..BodyOptions::default()
        },
    )
    .unwrap();
    w.query_contact_manifolds(2, 4, true, &mut out).unwrap();
    assert!(out.is_empty());
    w.set_body_options(
        b,
        &BodyOptions {
            kind: BodyKind::Fixed,
            ..BodyOptions::default()
        },
    )
    .unwrap();
    w.set_pose(
        b,
        Pose {
            position: [0.2, 0.0, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    w.query_contact_manifolds(2, 4, true, &mut out).unwrap();
    near(out[0].points[0].penetration, 0.8);
    let mut events = Vec::new();
    w.drain_collision_events(&mut events);
    assert!(events.is_empty());
    let mut active = Vec::new();
    w.active_collision_pairs(&mut active);
    assert!(active.is_empty());
    w.remove_body(a).unwrap();
    w.query_contact_manifolds(2, 4, true, &mut out).unwrap();
    assert!(out.is_empty());
}
#[test]
fn rotated_compound_witnesses_and_normals_include_subshape_and_body_transforms() {
    let mut w = world(Space::Spatial);
    let q = std::f32::consts::FRAC_1_SQRT_2;
    let shape = Shape::Compound {
        parts: vec![
            ShapePart {
                pose: Pose {
                    position: [2.0, 0.0, 0.0],
                    rotation: [0.0, 0.0, q, q],
                },
                shape: Shape::Box {
                    half_extents: [1.0, 0.5, 0.5],
                },
            },
            ShapePart {
                pose: Pose {
                    position: [-10.0, 0.0, 0.0],
                    ..Pose::default()
                },
                shape: Shape::Sphere { radius: 0.5 },
            },
        ],
    };
    let a = w
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [5.0, 4.0, 3.0],
                    rotation: [0.0, 0.0, q, q],
                },
                ..fixed([0.0; 3])
            },
            ColliderDesc {
                category: 2,
                ..ColliderDesc::new(shape)
            },
        )
        .unwrap();
    let b = w
        .create_body(fixed([5.0, 6.8, 3.0]), ball(4, false))
        .unwrap();
    let mut out = Vec::new();
    w.query_contact_manifolds(2, 4, true, &mut out).unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!((out[0].first.body, out[0].second.body), (a, b));
    near(out[0].normal[0], 0.0);
    near(out[0].normal[1], 1.0);
    near(out[0].normal[2], 0.0);
    near(out[0].points[0].first[1], 6.5);
    near(out[0].points[0].second[1], 6.3);
    near(out[0].points[0].penetration, 0.2);
    near(out[0].points[0].first[0], 5.0);
    near(out[0].points[0].first[2], 3.0);
}
#[test]
fn contact_geometry_supports_triangle_and_heightfield_terrain_before_any_step() {
    for shape in [
        Shape::TriangleMesh {
            vertices: vec![
                [-5.0, 0.0, -5.0],
                [5.0, 0.0, -5.0],
                [5.0, 0.0, 5.0],
                [-5.0, 0.0, 5.0],
            ],
            triangles: vec![[0, 2, 1], [0, 3, 2]],
        },
        Shape::Heightfield {
            rows: 2,
            columns: 2,
            heights: vec![0.0; 4],
            size: [10.0; 2],
        },
    ] {
        let mut w = world(Space::Spatial);
        w.create_body(
            fixed([0.0; 3]),
            ColliderDesc {
                category: 2,
                ..ColliderDesc::new(shape)
            },
        )
        .unwrap();
        w.create_body(fixed([0.2, 0.3, 0.1]), ball(4, false))
            .unwrap();
        let mut out = Vec::new();
        w.query_contact_manifolds(2, 4, true, &mut out).unwrap();
        assert!(!out.is_empty());
        for m in &out {
            near(m.normal[1], 1.0);
            for p in &m.points {
                near(p.first[1], 0.0);
                near(p.second[1], -0.2);
                near(p.penetration, 0.2);
            }
        }
    }
}
#[test]
fn contact_queries_preserve_kinematic_targets_forces_and_event_history() {
    let mut queried = world(Space::Spatial);
    let mut plain = world(Space::Spatial);
    let mut ids = Vec::new();
    for w in [&mut queried, &mut plain] {
        let k = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    ..BodyDesc::default()
                },
                ball(2, true),
            )
            .unwrap();
        let d = w
            .create_body(
                BodyDesc {
                    pose: Pose {
                        position: [0.8, 0.0, 0.0],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ball(4, false),
            )
            .unwrap();
        w.step();
        w.add_force(d, [3.0, 2.0, 1.0], [0.0, 0.0, 1.0]).unwrap();
        w.set_kinematic_target(
            k,
            Pose {
                position: [2.0, 3.0, 4.0],
                ..Pose::default()
            },
        )
        .unwrap();
        ids.push((k, d));
    }
    let mut out = Vec::new();
    for _ in 0..3 {
        queried
            .query_contact_manifolds(2, 4, true, &mut out)
            .unwrap();
        assert_eq!(out.len(), 1);
    }
    let mut a = Vec::new();
    let mut b = Vec::new();
    queried.drain_collision_events(&mut a);
    plain.drain_collision_events(&mut b);
    assert_eq!(a, b);
    queried.step();
    plain.step();
    for (a, b) in [(ids[0].0, ids[1].0), (ids[0].1, ids[1].1)] {
        assert_eq!(queried.body_state(a).unwrap(), plain.body_state(b).unwrap());
    }
}
#[test]
fn contact_results_sort_generational_identities_and_keep_fixture_pairs_distinct() {
    let mut w = world(Space::Spatial);
    let gone = w
        .create_body(fixed([50.0, 0.0, 0.0]), ball(2, true))
        .unwrap();
    w.remove_body(gone).unwrap();
    let a = w.create_body(fixed([0.0; 3]), ball(2, true)).unwrap();
    let b = w
        .create_body(fixed([0.8, 0.0, 0.0]), ball(4, true))
        .unwrap();
    w.add_collider(a, ball(2, true)).unwrap();
    w.add_collider(b, ball(4, true)).unwrap();
    let mut out = Vec::new();
    w.query_contact_manifolds(2, 4, true, &mut out).unwrap();
    assert_eq!(out.len(), 4);
    assert!(out.iter().all(|m| m.first.body == a && m.second.body == b));
    assert!(out
        .windows(2)
        .all(|v| (v[0].first.collider, v[0].second.collider)
            < (v[1].first.collider, v[1].second.collider)));
    let expected = out.clone();
    w.query_contact_manifolds(2, 4, true, &mut out).unwrap();
    assert_eq!(out, expected);
    w.query_contact_manifolds(0, 4, true, &mut out).unwrap();
    assert!(out.is_empty());
}

#[test]
fn planar_contact_motion_is_independent_of_extrusion_depth_with_both_friction_models() {
    use rapier3d::prelude::FrictionModel;
    for model in [FrictionModel::Simplified, FrictionModel::Coulomb] {
        let mut expected: Option<BodyState> = None;
        for depth in [0.5, 1.7, 100.0] {
            let mut w = PhysicsWorld3d::new(WorldConfig {
                space: Space::PlanarXy,
                gravity: [0.0, -10.0, 0.0],
                ..WorldConfig::default()
            })
            .unwrap();
            w.backend.integration_parameters.friction_model = model;
            w.create_body(
                fixed([0.0, -0.5, 0.0]),
                ColliderDesc {
                    friction: 1.0,
                    ..ColliderDesc::new(Shape::Box {
                        half_extents: [10.0, 0.5, depth + 1.0],
                    })
                },
            )
            .unwrap();
            let body = w
                .create_body(
                    BodyDesc {
                        pose: Pose {
                            position: [0.0, 0.5, 0.0],
                            ..Pose::default()
                        },
                        linear_velocity: [2.0, 0.0, 0.0],
                        ..BodyDesc::default()
                    },
                    ColliderDesc {
                        density: 0.0,
                        friction: 1.0,
                        ..ColliderDesc::new(Shape::Box {
                            half_extents: [0.5, 0.5, depth],
                        })
                    },
                )
                .unwrap();
            w.set_additional_mass_properties(
                body,
                &AdditionalMassProperties {
                    mass: 1.0,
                    principal_inertia: [1.0 / 6.0; 3],
                    center: [0.0; 3],
                    inertia_rotation: Pose::default().rotation,
                },
            )
            .unwrap();
            for _ in 0..300 {
                w.step_checked().unwrap();
                assert_eq!(w.step_statistics().ccd_clamps, 0, "{model:?} {depth}");
            }
            let state = w.body_state(body).unwrap();
            assert!(
                state.linear_velocity.iter().all(|v| v.abs() < 0.02),
                "{model:?} {depth} {state:?}"
            );
            assert!((state.pose.position[1] - 0.5).abs() < 0.01);
            if let Some(expected) = &expected {
                for (a, b) in state.pose.position.iter().zip(expected.pose.position) {
                    near(*a, b);
                }
                for (a, b) in state.pose.rotation.iter().zip(expected.pose.rotation) {
                    near(*a, b);
                }
            } else {
                expected = Some(state);
            }
        }
    }
}

use super::*;

fn world() -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap()
}

fn ball() -> ColliderDesc {
    ColliderDesc::new(Shape::Sphere { radius: 0.5 })
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

fn down(x: f32, z: f32) -> RayCast {
    RayCast {
        origin: [x, 10.0, z],
        direction: [0.0, -7.0, 0.0],
        max_distance: 20.0,
        solid: true,
    }
}

fn close(actual: f32, expected: f32) {
    assert!(
        (actual - expected).abs() < 1.0e-4,
        "actual={actual}, expected={expected}"
    );
}

#[test]
fn queries_follow_repeated_edits_without_simulation_steps() {
    let mut world = world();
    let id = world.create_body(fixed([0.0; 3]), ball()).unwrap();
    let collider = world.collider_ids(id).unwrap().next().unwrap();
    let hit = world
        .cast_ray(&down(0.0, 0.0), &QueryFilter::default())
        .unwrap()
        .unwrap();
    close(hit.distance, 9.5);
    assert_eq!(hit.target.collider, collider);
    for x in [2.0, 4.0, -3.0] {
        world
            .set_pose(
                id,
                Pose {
                    position: [x, 0.0, 0.0],
                    ..Pose::default()
                },
            )
            .unwrap();
        assert!(world
            .cast_ray(&down(0.0, 0.0), &QueryFilter::default())
            .unwrap()
            .is_none());
        assert!(world
            .cast_ray(&down(x, 0.0), &QueryFilter::default())
            .unwrap()
            .is_some());
    }
    let mut desc = ColliderDesc::new(Shape::Sphere { radius: 1.0 });
    desc.pose.position = [3.0, 2.0, 0.0];
    world.update_collider(collider, desc).unwrap();
    close(
        world
            .cast_ray(&down(0.0, 0.0), &QueryFilter::default())
            .unwrap()
            .unwrap()
            .distance,
        7.0,
    );
    world.remove_collider(collider).unwrap();
    assert!(world
        .cast_ray(&down(0.0, 0.0), &QueryFilter::default())
        .unwrap()
        .is_none());
    assert_eq!(
        world.collider_owner(collider),
        Err(PhysicsError::StaleCollider)
    );
    let replacement = world.add_collider(id, ball()).unwrap();
    assert_ne!(collider, replacement);
    world.clear();
    assert_eq!(
        world.collider_owner(replacement),
        Err(PhysicsError::StaleCollider)
    );
    assert!(world
        .cast_ray(&down(-3.0, 0.0), &QueryFilter::default())
        .unwrap()
        .is_none());
}

#[test]
fn collider_mass_changes_apply_before_an_impulse() {
    let mut world = world();
    let cube = ColliderDesc::new(Shape::Box {
        half_extents: [0.5; 3],
    });
    let body = world
        .create_body(BodyDesc::default(), cube.clone())
        .unwrap();
    let extra = world.add_collider(body, cube.clone()).unwrap();
    world.apply_impulse(body, [1.0, 0.0, 0.0]).unwrap();
    close(world.body_state(body).unwrap().linear_velocity[0], 0.5);
    world.remove_collider(extra).unwrap();
    world.set_velocity(body, [0.0; 3], [0.0; 3]).unwrap();
    world.apply_impulse(body, [1.0, 0.0, 0.0]).unwrap();
    close(world.body_state(body).unwrap().linear_velocity[0], 1.0);
    let original = world.collider_ids(body).unwrap().next().unwrap();
    world
        .update_collider(
            original,
            ColliderDesc {
                density: 4.0,
                ..cube
            },
        )
        .unwrap();
    world.set_velocity(body, [0.0; 3], [0.0; 3]).unwrap();
    world.apply_impulse(body, [1.0, 0.0, 0.0]).unwrap();
    close(world.body_state(body).unwrap().linear_velocity[0], 0.25);
}

#[test]
fn massless_sensor_fixture_does_not_change_body_response() {
    let mut world = world();
    let body = world
        .create_body(
            BodyDesc::default(),
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            }),
        )
        .unwrap();
    world
        .add_collider(
            body,
            ColliderDesc {
                density: 0.0,
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 5.0 })
            },
        )
        .unwrap();
    world.apply_impulse(body, [1.0, 0.0, 0.0]).unwrap();
    close(world.body_state(body).unwrap().linear_velocity[0], 1.0);
    let hit = world
        .cast_ray(
            &down(0.0, 0.0),
            &QueryFilter {
                include_sensors: true,
                ..QueryFilter::default()
            },
        )
        .unwrap()
        .unwrap();
    assert!(hit.target.sensor);
    close(hit.distance, 5.0);
}

#[test]
fn heightfield_uses_row_major_zx_samples_and_total_extent() {
    let mut world = world();
    world
        .create_body(
            fixed([0.0; 3]),
            ColliderDesc::new(Shape::Heightfield {
                rows: 2,
                columns: 3,
                heights: vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
                size: [2.0, 4.0],
            }),
        )
        .unwrap();
    for (x, z, height) in [(-0.5, -1.0, 1.25), (0.5, 1.0, 3.75)] {
        let hit = world
            .cast_ray(&down(x, z), &QueryFilter::default())
            .unwrap()
            .unwrap();
        close(hit.point[1], height);
        close(hit.distance, 10.0 - height);
        assert!(hit.normal[1] > 0.0);
    }
    assert!(world
        .cast_ray(&down(1.1, 0.0), &QueryFilter::default())
        .unwrap()
        .is_none());
    assert!(world
        .cast_ray(&down(0.0, 2.1), &QueryFilter::default())
        .unwrap()
        .is_none());
}

#[test]
fn both_terrain_shapes_support_falling_bodies() {
    let shapes = [
        Shape::Heightfield {
            rows: 2,
            columns: 2,
            heights: vec![0.8; 4],
            size: [10.0; 2],
        },
        Shape::TriangleMesh {
            vertices: vec![
                [-5.0, 0.8, -5.0],
                [5.0, 0.8, -5.0],
                [5.0, 0.8, 5.0],
                [-5.0, 0.8, 5.0],
            ],
            triangles: vec![[0, 2, 1], [0, 3, 2]],
        },
    ];
    for shape in shapes {
        let terrain_label = format!("{shape:?}");
        let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
        assert_eq!(
            world.create_body(BodyDesc::default(), ColliderDesc::new(shape.clone())),
            Err(PhysicsError::UnsupportedShape)
        );
        world
            .create_body(fixed([0.0; 3]), ColliderDesc::new(shape))
            .unwrap();
        let body = world
            .create_body(
                BodyDesc {
                    pose: Pose {
                        position: [0.2, 4.0, 0.3],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ball(),
            )
            .unwrap();
        for _ in 0..300 {
            world.step();
        }
        let state = world.body_state(body).unwrap();
        assert!((state.pose.position[1] - 1.3).abs() < 0.02, "{state:?}");
        assert!(
            state.linear_velocity[1].abs() < 0.01,
            "{terrain_label}: {state:?}"
        );
        assert!(
            (state.pose.position[0] - 0.2).abs() < 0.02,
            "{terrain_label}: {state:?}"
        );
        assert!(
            (state.pose.position[2] - 0.3).abs() < 0.02,
            "{terrain_label}: {state:?}"
        );
    }
}

#[test]
fn compound_gap_and_convex_sweep_use_exact_geometry() {
    let mut world = world();
    let shape = Shape::Compound {
        parts: [-2.0, 2.0]
            .into_iter()
            .map(|x| ShapePart {
                pose: Pose {
                    position: [x, 0.0, 0.0],
                    ..Pose::default()
                },
                shape: Shape::Sphere { radius: 0.5 },
            })
            .collect(),
    };
    let body = world
        .create_body(fixed([0.0; 3]), ColliderDesc::new(shape))
        .unwrap();
    assert!(world
        .cast_ray(&down(0.0, 0.0), &QueryFilter::default())
        .unwrap()
        .is_none());
    let hit = world
        .sweep(
            &Shape::Sphere { radius: 0.25 },
            Pose {
                position: [2.0, 5.0, 0.0],
                ..Pose::default()
            },
            [0.0, -10.0, 0.0],
            &QueryFilter::default(),
        )
        .unwrap()
        .unwrap();
    close(hit.fraction, 0.425);
    close(hit.point[1], 0.5);
    close(hit.normal[1], 1.0);
    assert_eq!(hit.target.body, body);
    assert!(!hit.initial_overlap);
    let hit = world
        .sweep(
            &Shape::Sphere { radius: 0.25 },
            Pose {
                position: [2.0, 0.6, 0.0],
                ..Pose::default()
            },
            [0.0; 3],
            &QueryFilter::default(),
        )
        .unwrap()
        .unwrap();
    assert!(hit.initial_overlap);
    assert!(hit.normal.iter().all(|n| n.is_finite()));
}

#[test]
fn ray_normals_and_points_are_in_world_space() {
    let mut world = world();
    let half_angle = std::f32::consts::FRAC_PI_4;
    let pose = Pose {
        position: [0.0, 2.0, 0.0],
        rotation: [0.0, half_angle.sin(), 0.0, half_angle.cos()],
    };
    world
        .create_body(
            BodyDesc {
                pose,
                ..fixed([0.0; 3])
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2.0, 0.5, 0.25],
            }),
        )
        .unwrap();
    let ray = RayCast {
        origin: [-3.0, 2.0, 0.0],
        direction: [5.0, 0.0, 0.0],
        max_distance: 8.0,
        solid: true,
    };
    let hit = world
        .cast_ray(&ray, &QueryFilter::default())
        .unwrap()
        .unwrap();
    close(hit.distance, 2.75);
    close(hit.point[0], -0.25);
    close(hit.normal[0], -1.0);
    close(hit.normal[2], 0.0);
}

#[test]
fn queries_apply_symmetric_masks_sensor_selection_and_owner_exclusion() {
    let mut world = world();
    let solid = world
        .create_body(
            fixed([0.0; 3]),
            ColliderDesc {
                category: 2,
                mask: 4,
                ..ball()
            },
        )
        .unwrap();
    let trigger = world
        .create_body(
            fixed([0.0, 3.0, 0.0]),
            ColliderDesc {
                sensor: true,
                category: 2,
                mask: 4,
                ..ball()
            },
        )
        .unwrap();
    let allowed = QueryFilter {
        category: 4,
        mask: 2,
        ..QueryFilter::default()
    };
    assert_eq!(
        world
            .cast_ray(&down(0.0, 0.0), &allowed)
            .unwrap()
            .unwrap()
            .target
            .body,
        solid
    );
    assert_eq!(
        world
            .cast_ray(
                &down(0.0, 0.0),
                &QueryFilter {
                    include_sensors: true,
                    ..allowed.clone()
                }
            )
            .unwrap()
            .unwrap()
            .target
            .body,
        trigger
    );
    for (category, mask) in [(1, 2), (4, 8)] {
        assert!(world
            .cast_ray(
                &down(0.0, 0.0),
                &QueryFilter {
                    category,
                    mask,
                    ..allowed.clone()
                }
            )
            .unwrap()
            .is_none());
    }
    assert!(world
        .cast_ray(
            &down(0.0, 0.0),
            &QueryFilter {
                exclude_body: Some(solid),
                ..allowed.clone()
            }
        )
        .unwrap()
        .is_none());
    let collider = world.collider_ids(solid).unwrap().next().unwrap();
    world.remove_body(solid).unwrap();
    assert_eq!(
        world.cast_ray(
            &down(0.0, 0.0),
            &QueryFilter {
                exclude_body: Some(solid),
                ..allowed.clone()
            }
        ),
        Err(PhysicsError::StaleBody)
    );
    assert_eq!(
        world.cast_ray(
            &down(0.0, 0.0),
            &QueryFilter {
                exclude_collider: Some(collider),
                ..allowed
            }
        ),
        Err(PhysicsError::StaleCollider)
    );
}

#[test]
fn overlaps_use_shapes_and_report_truncation_without_unbounded_output() {
    let mut world = world();
    let first = world.create_body(fixed([0.0; 3]), ball()).unwrap();
    let second = world.create_body(fixed([3.0, 0.0, 0.0]), ball()).unwrap();
    let mut out = Vec::new();
    assert!(!world
        .overlap(
            &Shape::Sphere { radius: 0.5 },
            Pose {
                position: [0.9, 0.9, 0.0],
                ..Pose::default()
            },
            &QueryFilter::default(),
            &mut out,
            2
        )
        .unwrap());
    assert!(out.is_empty()); // AABBs overlap, spheres do not.
    assert!(world
        .overlap(
            &Shape::Sphere { radius: 5.0 },
            Pose::default(),
            &QueryFilter::default(),
            &mut out,
            1
        )
        .unwrap());
    assert_eq!(out.len(), 1);
    assert!(!world
        .overlap(
            &Shape::Sphere { radius: 5.0 },
            Pose::default(),
            &QueryFilter::default(),
            &mut out,
            2
        )
        .unwrap());
    assert_eq!(
        out.iter().map(|h| h.body).collect::<Vec<_>>(),
        [first, second]
    );
    let previous = out.clone();
    assert_eq!(
        world.overlap(
            &Shape::Sphere { radius: f32::NAN },
            Pose::default(),
            &QueryFilter::default(),
            &mut out,
            2
        ),
        Err(PhysicsError::InvalidCollider)
    );
    assert_eq!(out, previous);
}

#[test]
fn invalid_geometry_never_inserts_partial_objects() {
    let shapes = [
        Shape::ConvexHull {
            points: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [1.0, 1.0, 0.0],
                [0.0, 1.0, 0.0],
            ],
        },
        Shape::ConvexHull {
            points: vec![[f32::NAN; 3]; 4],
        },
        Shape::TriangleMesh {
            vertices: vec![[0.0; 3]; 3],
            triangles: vec![[0, 1, 3]],
        },
        Shape::TriangleMesh {
            vertices: vec![[0.0; 3]; 3],
            triangles: vec![[0, 1, 2]],
        },
        Shape::Heightfield {
            rows: usize::MAX,
            columns: 2,
            heights: vec![],
            size: [1.0; 2],
        },
        Shape::Heightfield {
            rows: 2,
            columns: 2,
            heights: vec![0.0; 3],
            size: [1.0; 2],
        },
        Shape::Compound { parts: vec![] },
    ];
    let mut world = world();
    for shape in shapes {
        assert_eq!(
            world.create_body(fixed([0.0; 3]), ColliderDesc::new(shape)),
            Err(PhysicsError::InvalidCollider)
        );
        assert_eq!((world.body_count(), world.collider_count()), (0, 0));
    }
    let tetrahedron = Shape::ConvexHull {
        points: vec![[0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
    };
    world
        .create_body(fixed([0.0; 3]), ColliderDesc::new(tetrahedron))
        .unwrap();
    close(
        world
            .cast_ray(&down(0.2, 0.2), &QueryFilter::default())
            .unwrap()
            .unwrap()
            .point[1],
        0.6,
    );
}

#[test]
fn capacity_and_planar_compound_guards_are_atomic() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        max_colliders: 1,
        ..WorldConfig::default()
    })
    .unwrap();
    let invalid = Shape::Compound {
        parts: vec![ShapePart {
            pose: Pose {
                position: [0.0, 0.0, 1.0],
                ..Pose::default()
            },
            shape: Shape::Sphere { radius: 0.5 },
        }],
    };
    assert_eq!(
        world.create_body(BodyDesc::default(), ColliderDesc::new(invalid)),
        Err(PhysicsError::OutOfPlane)
    );
    let body = world.create_body(BodyDesc::default(), ball()).unwrap();
    assert_eq!(
        world.add_collider(body, ball()),
        Err(PhysicsError::CapacityExceeded)
    );
    assert_eq!(
        world.create_body(BodyDesc::default(), ball()),
        Err(PhysicsError::CapacityExceeded)
    );
    assert_eq!((world.body_count(), world.collider_count()), (1, 1));
    assert_eq!(
        world.cast_ray(&down(0.0, 1.0), &QueryFilter::default()),
        Err(PhysicsError::OutOfPlane)
    );
    assert_eq!(
        world.cast_ray(
            &RayCast {
                direction: [0.0; 3],
                ..down(0.0, 0.0)
            },
            &QueryFilter::default()
        ),
        Err(PhysicsError::InvalidQuery)
    );
}

#[test]
fn mesh_underside_stops_an_upward_body_without_sideways_kicks() {
    let mut world = world();
    world
        .create_body(
            fixed([0.0; 3]),
            ColliderDesc::new(Shape::TriangleMesh {
                vertices: vec![
                    [-5.0, 0.0, -5.0],
                    [5.0, 0.0, -5.0],
                    [5.0, 0.0, 5.0],
                    [-5.0, 0.0, 5.0],
                ],
                triangles: vec![[0, 2, 1], [0, 3, 2]],
            }),
        )
        .unwrap();
    let body = world
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [0.2, -2.0, 0.3],
                    ..Pose::default()
                },
                linear_velocity: [0.0, 10.0, 0.0],
                ccd: true,
                ..BodyDesc::default()
            },
            ball(),
        )
        .unwrap();
    for _ in 0..120 {
        world.step();
        let state = world.body_state(body).unwrap();
        assert!(state.pose.position[1] <= -0.48, "{state:?}");
        assert!((state.pose.position[0] - 0.2).abs() < 0.02, "{state:?}");
        assert!((state.pose.position[2] - 0.3).abs() < 0.02, "{state:?}");
    }
    assert!(world.body_state(body).unwrap().linear_velocity[1].abs() < 0.01);
}

#[test]
fn query_refresh_does_not_integrate_or_lose_kinematic_targets() {
    let mut queried = world();
    let mut plain = world();
    let desc = BodyDesc {
        kind: BodyKind::KinematicPosition,
        ..BodyDesc::default()
    };
    let queried_id = queried.create_body(desc.clone(), ball()).unwrap();
    let plain_id = plain.create_body(desc, ball()).unwrap();
    let target = Pose {
        position: [1.0, 2.0, 3.0],
        ..Pose::default()
    };
    queried.set_kinematic_target(queried_id, target).unwrap();
    plain.set_kinematic_target(plain_id, target).unwrap();
    // First query also flushes the pending body creation, without consuming its target.
    queried
        .cast_ray(&down(0.0, 0.0), &QueryFilter::default())
        .unwrap();
    assert_eq!(
        queried.body_state(queried_id).unwrap().pose.position,
        [0.0; 3]
    );
    queried.step();
    plain.step();
    assert_eq!(
        queried.body_state(queried_id).unwrap(),
        plain.body_state(plain_id).unwrap()
    );
    assert_eq!(
        queried.body_state(queried_id).unwrap().pose.position,
        target.position
    );
    let hit = queried
        .cast_ray(&down(1.0, 3.0), &QueryFilter::default())
        .unwrap()
        .unwrap();
    close(hit.point[1], 2.5);
}

#[test]
fn rejected_collider_update_keeps_geometry_mass_and_events() {
    let mut world = world();
    let body = world.create_body(BodyDesc::default(), ball()).unwrap();
    let collider = world.collider_ids(body).unwrap().next().unwrap();
    let mut invalid = ball();
    invalid.pose.rotation = [0.0; 4];
    assert_eq!(
        world.update_collider(collider, invalid),
        Err(PhysicsError::InvalidCollider)
    );
    assert_eq!(world.collider_count(), 1);
    close(
        world
            .cast_ray(&down(0.0, 0.0), &QueryFilter::default())
            .unwrap()
            .unwrap()
            .distance,
        9.5,
    );
    world.apply_impulse(body, [1.0, 0.0, 0.0]).unwrap();
    close(
        world.body_state(body).unwrap().linear_velocity[0],
        6.0 / std::f32::consts::PI,
    );
}

#[test]
fn local_collider_edits_are_visible_after_the_parent_has_already_stepped() {
    let mut world = world();
    let body = world.create_body(fixed([3.0, 1.0, 0.0]), ball()).unwrap();
    let collider = world.collider_ids(body).unwrap().next().unwrap();
    world.step();
    for y in [1.0, 3.0, -2.0] {
        world
            .update_collider(
                collider,
                ColliderDesc {
                    pose: Pose {
                        position: [0.0, y, 0.0],
                        ..Pose::default()
                    },
                    ..ball()
                },
            )
            .unwrap();
        close(
            world
                .cast_ray(&down(3.0, 0.0), &QueryFilter::default())
                .unwrap()
                .unwrap()
                .point[1],
            y + 1.5,
        );
        world.step();
        close(
            world
                .cast_ray(&down(3.0, 0.0), &QueryFilter::default())
                .unwrap()
                .unwrap()
                .point[1],
            y + 1.5,
        );
    }
}

#[test]
fn queries_before_every_step_preserve_dynamic_simulation() {
    let mut queried = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let mut plain = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let mut ids = Vec::new();
    for world in [&mut queried, &mut plain] {
        world
            .create_body(
                fixed([0.0, -0.1, 0.0]),
                ColliderDesc::new(Shape::Box {
                    half_extents: [10.0, 0.1, 10.0],
                }),
            )
            .unwrap();
        ids.push(
            world
                .create_body(
                    BodyDesc {
                        pose: Pose {
                            position: [0.0, 3.0, 0.0],
                            ..Pose::default()
                        },
                        ..BodyDesc::default()
                    },
                    ball(),
                )
                .unwrap(),
        );
    }
    for tick in 0..240 {
        queried
            .cast_ray(&down(0.0, 0.0), &QueryFilter::default())
            .unwrap();
        queried.step();
        plain.step();
        assert_eq!(
            queried.body_state(ids[0]).unwrap(),
            plain.body_state(ids[1]).unwrap(),
            "tick {tick}"
        );
    }
    assert!((queried.body_state(ids[0]).unwrap().pose.position[1] - 0.5).abs() < 0.02);
}

#[test]
fn all_ray_hits_are_distance_sorted_truncated_and_immediately_refreshed() {
    let mut world = world();
    let far = world.create_body(fixed([0.0, -3.0, 0.0]), ball()).unwrap();
    let near = world.create_body(fixed([0.0, 3.0, 0.0]), ball()).unwrap();
    let middle = world.create_body(fixed([0.0; 3]), ball()).unwrap();
    let mut out = Vec::new();
    assert!(world
        .cast_ray_all(&down(0.0, 0.0), &QueryFilter::default(), &mut out, 2)
        .unwrap());
    assert_eq!(
        out.iter().map(|h| h.target.body).collect::<Vec<_>>(),
        [near, middle]
    );
    close(out[0].distance, 6.5);
    assert_eq!(out[0].normal, [0.0, 1.0, 0.0]);
    world
        .set_pose(
            far,
            Pose {
                position: [0.0, 5.0, 0.0],
                ..Pose::default()
            },
        )
        .unwrap();
    world.remove_body(near).unwrap();
    let replacement = world.create_body(fixed([0.0, 7.0, 0.0]), ball()).unwrap();
    assert_ne!(near, replacement);
    assert!(!world
        .cast_ray_all(&down(0.0, 0.0), &QueryFilter::default(), &mut out, 3)
        .unwrap());
    assert_eq!(
        out.iter().map(|h| h.target.body).collect::<Vec<_>>(),
        [replacement, far, middle]
    );
    close(out[0].distance, 2.5);
    let prior = out.clone();
    for invalid in [0, world.config().max_colliders + 1] {
        assert_eq!(
            world.cast_ray_all(&down(0.0, 0.0), &QueryFilter::default(), &mut out, invalid),
            Err(PhysicsError::InvalidQuery)
        );
        assert_eq!(out, prior);
    }
    let mut invalid = down(0.0, 0.0);
    invalid.direction = [f32::NAN; 3];
    assert_eq!(
        world.cast_ray_all(&invalid, &QueryFilter::default(), &mut out, 3),
        Err(PhysicsError::InvalidQuery)
    );
    assert_eq!(out, prior);
    assert_eq!(
        world.cast_ray_all(
            &down(0.0, 0.0),
            &QueryFilter {
                exclude_body: Some(near),
                ..QueryFilter::default()
            },
            &mut out,
            3
        ),
        Err(PhysicsError::StaleBody)
    );
    assert_eq!(out, prior);
}

#[test]
fn category_only_queries_include_zero_mask_sensors_without_affecting_collision_filters() {
    let mut world = world();
    let body = world
        .create_body(
            fixed([0.0; 3]),
            ColliderDesc {
                category: 8,
                mask: 0,
                sensor: true,
                ..ball()
            },
        )
        .unwrap();
    let mut out = Vec::new();
    let mut filter = QueryFilter {
        mask: 8,
        include_sensors: true,
        ..QueryFilter::default()
    };
    world
        .cast_ray_all(&down(0.0, 0.0), &filter, &mut out, 4)
        .unwrap();
    assert!(out.is_empty());
    filter.respect_target_mask = false;
    world
        .cast_ray_all(&down(0.0, 0.0), &filter, &mut out, 4)
        .unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].target.body, body);
    assert_eq!(
        world.cast_ray(&down(0.0, 0.0), &filter).unwrap().unwrap(),
        out[0]
    );
    let mut points = Vec::new();
    world
        .overlap_point([0.0; 3], &filter, &mut points, 4)
        .unwrap();
    assert_eq!(points, [out[0].target]);
    let mut overlaps = Vec::new();
    world
        .overlap(
            &Shape::Sphere { radius: 0.1 },
            Pose::default(),
            &filter,
            &mut overlaps,
            4,
        )
        .unwrap();
    assert_eq!(overlaps, points);
    assert!(world
        .sweep(
            &Shape::Sphere { radius: 0.1 },
            Pose {
                position: [0.0, 2.0, 0.0],
                ..Pose::default()
            },
            [0.0, -4.0, 0.0],
            &filter
        )
        .unwrap()
        .is_some());
    filter.mask = 4;
    world
        .overlap_point([0.0; 3], &filter, &mut points, 4)
        .unwrap();
    assert!(points.is_empty());
    filter.mask = 8;
    filter.include_sensors = false;
    world
        .overlap_point([0.0; 3], &filter, &mut points, 4)
        .unwrap();
    assert!(points.is_empty());
}

#[test]
fn point_queries_track_fixture_offsets_disabled_bodies_and_stale_handles() {
    let mut world = world();
    let body = world.create_body(fixed([0.0; 3]), ball()).unwrap();
    let first = world.collider_ids(body).unwrap().next().unwrap();
    let second = world.add_collider(body, ball()).unwrap();
    let mut out = Vec::new();
    assert!(world
        .overlap_point([0.0; 3], &QueryFilter::default(), &mut out, 1)
        .unwrap());
    assert_eq!(out[0].collider, first.min(second));
    world
        .update_collider(
            first,
            ColliderDesc {
                pose: Pose {
                    position: [2.0, 0.0, 0.0],
                    ..Pose::default()
                },
                ..ball()
            },
        )
        .unwrap();
    world.remove_collider(second).unwrap();
    world
        .overlap_point([0.0; 3], &QueryFilter::default(), &mut out, 4)
        .unwrap();
    assert!(out.is_empty());
    world
        .overlap_point([2.0, 0.0, 0.0], &QueryFilter::default(), &mut out, 4)
        .unwrap();
    assert_eq!(out[0].collider, first);
    let prior = out.clone();
    assert_eq!(
        world.overlap_point(
            [f32::INFINITY, 0.0, 0.0],
            &QueryFilter::default(),
            &mut out,
            4
        ),
        Err(PhysicsError::InvalidQuery)
    );
    assert_eq!(out, prior);
    assert_eq!(
        world.overlap_point(
            [2.0, 0.0, 0.0],
            &QueryFilter {
                exclude_collider: Some(second),
                ..QueryFilter::default()
            },
            &mut out,
            4
        ),
        Err(PhysicsError::StaleCollider)
    );
    assert_eq!(out, prior);
    let mut options = BodyOptions::from(&fixed([0.0; 3]));
    options.enabled = false;
    world.set_body_options(body, &options).unwrap();
    world
        .overlap_point([2.0, 0.0, 0.0], &QueryFilter::default(), &mut out, 4)
        .unwrap();
    assert!(out.is_empty());
    options.enabled = true;
    world.set_body_options(body, &options).unwrap();
    world
        .overlap_point([2.0, 0.0, 0.0], &QueryFilter::default(), &mut out, 4)
        .unwrap();
    assert_eq!(out[0].collider, first);
}

#[test]
fn all_ray_compound_returns_first_surface_per_collider_and_obeys_solid_origin() {
    let mut world = world();
    let shape = Shape::Compound {
        parts: [-2.0, 2.0]
            .into_iter()
            .map(|y| ShapePart {
                shape: Shape::Sphere { radius: 0.5 },
                pose: Pose {
                    position: [0.0, y, 0.0],
                    ..Pose::default()
                },
            })
            .collect(),
    };
    let body = world
        .create_body(fixed([0.0; 3]), ColliderDesc::new(shape))
        .unwrap();
    let mut hits = Vec::new();
    world
        .cast_ray_all(&down(0.0, 0.0), &QueryFilter::default(), &mut hits, 4)
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].target.body, body);
    close(hits[0].distance, 7.5);
    let mut point_hits = Vec::new();
    world
        .overlap_point([0.0; 3], &QueryFilter::default(), &mut point_hits, 4)
        .unwrap();
    assert!(point_hits.is_empty()); // Do not report the compound's bounding box gap.
    let mut cast = RayCast {
        origin: [0.0, 2.0, 0.0],
        direction: [0.0, -1.0, 0.0],
        max_distance: 10.0,
        solid: true,
    };
    world
        .cast_ray_all(&cast, &QueryFilter::default(), &mut hits, 4)
        .unwrap();
    assert_eq!(hits.len(), 1);
    close(hits[0].distance, 0.0);
    cast.solid = false;
    world
        .cast_ray_all(&cast, &QueryFilter::default(), &mut hits, 4)
        .unwrap();
    close(hits[0].distance, 0.5);
}

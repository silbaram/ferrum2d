use super::*;

fn desc(kind: BodyKind, p: [f32; 3]) -> BodyDesc {
    BodyDesc {
        kind,
        pose: Pose {
            position: p,
            ..Pose::default()
        },
        can_sleep: false,
        ..BodyDesc::default()
    }
}
fn world(space: Space, limit: usize) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.0; 3],
        max_events: limit,
        ..WorldConfig::default()
    })
    .unwrap()
}
fn sphere() -> ColliderDesc {
    ColliderDesc::new(Shape::Sphere { radius: 0.5 })
}
fn wall() -> ColliderDesc {
    ColliderDesc::new(Shape::Box {
        half_extents: [0.05, 10.0, 10.0],
    })
}
fn fast(w: &mut PhysicsWorld3d, y: f32) -> BodyId {
    let mut d = desc(BodyKind::Dynamic, [-2.0, y, 0.0]);
    d.linear_velocity = [300.0, 0.0, 0.0];
    d.ccd = true;
    w.create_body(d, sphere()).unwrap()
}
fn close(a: f32, b: f32, t: f32) {
    assert!((a - b).abs() < t, "{a} != {b}");
}

#[test]
fn native_statistics_ccd_records_actual_clamp_and_geometry_without_inventing_impulses() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut w = world(space, 64);
        let target = w
            .create_body(desc(BodyKind::Fixed, [0.0; 3]), wall())
            .unwrap();
        let moving = fast(&mut w, 0.0);
        w.step();
        let s = w.step_statistics();
        assert_eq!(s.backend_steps, 1);
        assert_eq!(s.ccd_clamps, 1);
        assert!(s.ccd_clamp_checks > 0);
        assert_eq!(s.ccd_prediction_checks, 0);
        assert_eq!(s.ccd_substeps, 1);
        assert_eq!(s.ccd_clamps_dropped, 0);
        assert_eq!(w.ccd_clamps().len(), 1);
        let h = &w.ccd_clamps()[0];
        assert_eq!(h.moving.body, moving);
        assert_eq!(h.target.body, target);
        close(h.fraction, 0.291, 0.003);
        close(h.sweep_seconds, w.config().step_seconds, 1e-6);
        close(h.point[0], -0.05, 0.01);
        close(h.normal[0], -1.0, 1e-5);
        close(h.normal[1], 0.0, 1e-5);
        let state = w.body_state(moving).unwrap();
        assert!(state.pose.position[0] < -0.5);
        close(state.linear_velocity[0], 300.0, 0.01);
        let mut impulses = Vec::new();
        assert_eq!(w.contact_impulses(&mut impulses).solved_contacts, 0);
        let snapshot = w.ccd_clamps().to_vec();
        assert_eq!(w.step_statistics(), s);
        assert_eq!(w.ccd_clamps(), snapshot);
        w.step();
        assert!(w.step_statistics().solver_contacts > 0);
        assert!(w.body_state(moving).unwrap().linear_velocity[0] < 1.0);
    }
}

#[test]
fn native_statistics_ccd_sensors_masks_and_logical_floors_do_not_become_clamps() {
    for kind in 0..3 {
        let mut w = world(Space::PlanarXy, 64);
        let mut target_shape = wall();
        if kind == 0 {
            target_shape.sensor = true;
        }
        if kind == 1 {
            target_shape.mask = 0;
        }
        let target = w
            .create_body(desc(BodyKind::Fixed, [0.0; 3]), target_shape)
            .unwrap();
        let body = fast(&mut w, 0.0);
        if kind == 2 {
            w.set_planar_collision_span(
                target,
                Some(PlanarCollisionSpan {
                    floor: 1,
                    elevation: 0.0,
                    height: 1.0,
                }),
            )
            .unwrap();
            w.set_planar_collision_span(
                body,
                Some(PlanarCollisionSpan {
                    floor: 2,
                    elevation: 0.0,
                    height: 1.0,
                }),
            )
            .unwrap();
        }
        w.step();
        assert_eq!(w.step_statistics().ccd_clamps, 0);
        assert!(w.ccd_clamps().is_empty());
        assert!(w.body_state(body).unwrap().pose.position[0] > 1.0);
        if kind != 0 {
            assert_eq!(w.step_statistics().ccd_clamp_checks, 0);
        }
    }
}

#[test]
fn native_statistics_ccd_compound_against_triangle_mesh_preserves_witness_geometry() {
    let mut w = world(Space::Spatial, 64);
    let mesh = Shape::TriangleMesh {
        vertices: vec![
            [0.0, -10.0, -10.0],
            [0.0, 10.0, -10.0],
            [0.0, 10.0, 10.0],
            [0.0, -10.0, 10.0],
        ],
        triangles: vec![[0, 1, 2], [0, 2, 3]],
    };
    let target = w
        .create_body(desc(BodyKind::Fixed, [0.0; 3]), ColliderDesc::new(mesh))
        .unwrap();
    let mut d = desc(BodyKind::Dynamic, [-2.0, 0.0, 0.0]);
    d.linear_velocity = [300.0, 0.0, 0.0];
    d.ccd = true;
    let shape = Shape::Compound {
        parts: vec![
            ShapePart {
                pose: Pose {
                    position: [0.0, 1.0, 0.0],
                    ..Pose::default()
                },
                shape: Shape::Sphere { radius: 0.5 },
            },
            ShapePart {
                pose: Pose::default(),
                shape: Shape::Sphere { radius: 0.5 },
            },
        ],
    };
    let body = w.create_body(d, ColliderDesc::new(shape)).unwrap();
    w.step();
    assert_eq!(w.step_statistics().ccd_clamps, 1);
    let h = &w.ccd_clamps()[0];
    assert_eq!(h.target.body, target);
    assert_eq!(h.moving.body, body);
    close(h.point[0], 0.0, 0.02);
    close(h.normal[0], -1.0, 0.01);
    assert!((0.28..0.32).contains(&h.fraction));
}

#[test]
fn native_statistics_ccd_capacity_does_not_cap_counts_or_change_motion() {
    let run = |limit| {
        let mut w = world(Space::PlanarXy, limit);
        w.create_body(desc(BodyKind::Fixed, [0.0; 3]), wall())
            .unwrap();
        let a = fast(&mut w, -3.0);
        let b = fast(&mut w, 3.0);
        w.step();
        (
            w.step_statistics(),
            w.ccd_clamps().to_vec(),
            w.body_state(a).unwrap(),
            w.body_state(b).unwrap(),
        )
    };
    let (small, small_hits, a, b) = run(1);
    let (large, large_hits, c, d) = run(64);
    assert_eq!(a, c);
    assert_eq!(b, d);
    assert_eq!(small.ccd_clamps, 2);
    assert_eq!(large.ccd_clamps, 2);
    assert_eq!(small.ccd_clamp_checks, large.ccd_clamp_checks);
    assert_eq!(small_hits.len(), 1);
    assert_eq!(large_hits.len(), 2);
    assert_eq!(small.ccd_clamps_dropped, 1);
}

#[test]
fn native_statistics_ccd_prediction_is_separate_and_disabling_clears_previous_work() {
    let mut w = world(Space::Spatial, 64);
    w.create_body(desc(BodyKind::Fixed, [0.0; 3]), wall())
        .unwrap();
    let body = fast(&mut w, 0.0);
    w.backend.integration_parameters.max_ccd_substeps = 4;
    w.step();
    let s = w.step_statistics();
    assert!(s.ccd_prediction_checks > 0);
    assert!(s.ccd_substeps >= 1);
    assert_eq!(s.backend_steps, 1);
    w.set_runtime_settings(
        [0.0; 3],
        SolverSettings {
            continuous: false,
            ..SolverSettings::default()
        },
    )
    .unwrap();
    w.set_pose(
        body,
        Pose {
            position: [-2.0, 0.0, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    w.set_velocity(body, [300.0, 0.0, 0.0], [0.0; 3]).unwrap();
    w.step();
    let s = w.step_statistics();
    assert_eq!(
        (
            s.ccd_substeps,
            s.ccd_prediction_checks,
            s.ccd_clamp_checks,
            s.ccd_clamps
        ),
        (0, 0, 0, 0)
    );
    assert!(w.ccd_clamps().is_empty());
}

#[test]
fn native_statistics_body_island_gauges_include_sleep_but_exclude_disabled_and_fixed() {
    let mut w = world(Space::PlanarXy, 64);
    w.create_body(desc(BodyKind::Fixed, [100.0, 0.0, 0.0]), sphere())
        .unwrap();
    let a = w
        .create_body(desc(BodyKind::Dynamic, [0.0; 3]), sphere())
        .unwrap();
    let b = w
        .create_body(desc(BodyKind::Dynamic, [10.0, 0.0, 0.0]), sphere())
        .unwrap();
    let k = w
        .create_body(
            desc(BodyKind::KinematicPosition, [20.0, 0.0, 0.0]),
            sphere(),
        )
        .unwrap();
    w.step();
    let s = w.step_statistics();
    assert_eq!(s.dynamic_bodies, 2);
    assert_eq!(s.angular_bodies, 2);
    assert_eq!(s.islands, 3);
    assert_eq!(s.island_bodies, 3);
    assert_eq!(s.largest_island_bodies, 1);
    w.set_sleeping(a, true).unwrap();
    w.set_body_options(
        b,
        &BodyOptions {
            enabled: false,
            ..BodyOptions::default()
        },
    )
    .unwrap();
    w.step();
    let s = w.step_statistics();
    assert_eq!(s.dynamic_bodies, 1);
    assert_eq!(s.sleeping_bodies, 1);
    assert_eq!(s.island_bodies, 2);
    assert_eq!(s.sleeping_islands, 1);
    assert_eq!(s.bodies_put_to_sleep, 0);
    assert_eq!(s.bodies_woken, 0);
    w.remove_body(k).unwrap();
    w.remove_body(a).unwrap();
    w.step();
    let s = w.step_statistics();
    assert_eq!(s.dynamic_bodies, 0);
    assert_eq!(s.islands, 0);
    assert_eq!(s.solver_contacts, 0);
}

#[test]
fn native_statistics_joint_substeps_sum_work_and_force_breaks_ignore_queue_capacity() {
    let mut w = world(Space::PlanarXy, 1);
    let a = w
        .create_body(desc(BodyKind::Fixed, [0.0; 3]), sphere())
        .unwrap();
    for y in [2.0, 4.0] {
        let b = w
            .create_body(desc(BodyKind::Dynamic, [0.0, y, 0.0]), sphere())
            .unwrap();
        let mut j = JointDesc::new(a, b, JointKind::Fixed);
        j.break_force = Some(0.001);
        w.create_joint(j).unwrap();
    }
    w.step();
    let s = w.step_statistics();
    assert_eq!(s.backend_steps, 4);
    assert_eq!(s.broken_joints, 2);
    assert!(s.solver_constraints >= 2);
    assert_eq!(w.joint_count(), 0);
    let mut events = Vec::new();
    assert_eq!(w.drain_joint_events(&mut events), 1);
    w.step();
    let s = w.step_statistics();
    assert_eq!(s.backend_steps, 1);
    assert_eq!(s.broken_joints, 0);
}

#[test]
fn native_statistics_contact_work_accumulates_across_joint_passes_not_only_last_pass() {
    let mut w = world(Space::PlanarXy, 64);
    w.set_runtime_settings([0.0, -10.0, 0.0], SolverSettings::default())
        .unwrap();
    w.create_body(
        desc(BodyKind::Fixed, [0.0, -0.5, 0.0]),
        ColliderDesc::new(Shape::Box {
            half_extents: [10.0, 0.5, 2.0],
        }),
    )
    .unwrap();
    w.create_body(
        desc(BodyKind::Dynamic, [0.0, 0.5, 0.0]),
        ColliderDesc::new(Shape::Box {
            half_extents: [0.5; 3],
        }),
    )
    .unwrap();
    let a = w
        .create_body_without_collider(desc(BodyKind::Fixed, [100.0, 100.0, 0.0]))
        .unwrap();
    let b = w
        .create_body_without_collider(desc(BodyKind::Dynamic, [100.0, 100.0, 0.0]))
        .unwrap();
    w.create_joint(JointDesc::new(a, b, JointKind::Fixed))
        .unwrap();
    for _ in 0..30 {
        w.step();
    }
    let s = w.step_statistics();
    assert_eq!(s.backend_steps, 4);
    assert!(s.solver_contacts >= 8, "{s:?}");
    assert!(s.solver_constraints >= 8, "{s:?}");
    assert!(s.solver_contacts > w.backend.physics_pipeline.counters.solver.ncontacts as u32);
}

#[test]
fn native_statistics_sleep_and_collision_wake_count_begin_end_transitions_once() {
    let mut w = world(Space::PlanarXy, 64);
    let mut d = desc(BodyKind::Dynamic, [0.0; 3]);
    d.can_sleep = true;
    let a = w.create_body(d, sphere()).unwrap();
    let mut slept = 0;
    for _ in 0..180 {
        w.step();
        slept += w.step_statistics().bodies_put_to_sleep;
    }
    assert!(w.body_state(a).unwrap().sleeping);
    assert_eq!(slept, 1);
    assert_eq!(w.step_statistics().sleeping_islands, 1);
    let mut d = desc(BodyKind::Dynamic, [0.99, 0.0, 0.0]);
    d.linear_velocity = [-1.0, 0.0, 0.0];
    w.create_body(d, sphere()).unwrap();
    w.step();
    assert_eq!(w.step_statistics().bodies_woken, 1);
    assert!(!w.body_state(a).unwrap().sleeping);
    w.step();
    assert_eq!(w.step_statistics().bodies_woken, 0);
}

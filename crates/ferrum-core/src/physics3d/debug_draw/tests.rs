use super::*;
use crate::physics3d::{
    world::native_id, BodyDesc, BodyKind, BodyOptions, ColliderDesc, JointDesc, JointKind, Pose,
    Shape, ShapePart, Space, SpringResponse, WorldConfig,
};

fn world(space: Space) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.; 3],
        length_unit: 1.,
        ..Default::default()
    })
    .unwrap()
}
fn body(
    w: &mut PhysicsWorld3d,
    kind: BodyKind,
    at: [f32; 3],
    shape: Shape,
) -> crate::physics3d::BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: Pose {
                position: at,
                ..Default::default()
            },
            ..Default::default()
        },
        ColliderDesc::new(shape),
    )
    .unwrap()
}
fn draw_world(
    w: &PhysicsWorld3d,
    options: DebugDrawOptions,
    sink: impl FnMut(DebugLine3d) -> bool,
) -> DebugDrawStatistics {
    w.debug_draw(
        options,
        w.ccd_clamps()
            .iter()
            .map(|clamp| (clamp.point, clamp.normal)),
        sink,
    )
}
fn options(flags: u32) -> DebugDrawOptions {
    DebugDrawOptions {
        flags,
        max_lines: MAX_LINES,
        max_work: MAX_WORK,
    }
}
fn capture(w: &PhysicsWorld3d, flags: u32) -> (Vec<DebugLine3d>, DebugDrawStatistics) {
    let mut lines = Vec::with_capacity(1024);
    let stats = draw_world(w, options(flags), |line| {
        lines.push(line);
        true
    });
    (lines, stats)
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 0.0001, "{a} != {b}");
}
fn point_near(a: [f32; 3], b: [f32; 3]) -> bool {
    a.into_iter().zip(b).all(|(a, b)| (a - b).abs() < 0.0001)
}
fn has_line(lines: &[DebugLine3d], a: [f32; 3], b: [f32; 3]) -> bool {
    lines.iter().any(|l| {
        (point_near(l.from, a) && point_near(l.to, b))
            || (point_near(l.from, b) && point_near(l.to, a))
    })
}
fn tetra() -> Shape {
    Shape::ConvexHull {
        points: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
    }
}
fn field(rows: usize, columns: usize) -> Shape {
    Shape::Heightfield {
        rows,
        columns,
        heights: vec![0.; rows * columns],
        size: [2., 2.],
    }
}

#[test]
fn native_debug_all_seven_public_shapes_use_real_geometry() {
    let fixtures = [
        Shape::Box {
            half_extents: [1., 2., 3.],
        },
        Shape::Sphere { radius: 2. },
        Shape::Capsule {
            half_height: 2.,
            radius: 0.5,
        },
        tetra(),
        Shape::TriangleMesh {
            vertices: vec![[0., 0., 0.], [2., 0., 0.], [0., 0., 3.]],
            triangles: vec![[0, 1, 2]],
        },
        field(2, 2),
        Shape::Compound {
            parts: vec![
                ShapePart {
                    pose: Pose {
                        position: [5., 0., 0.],
                        ..Default::default()
                    },
                    shape: Shape::Sphere { radius: 0.5 },
                },
                ShapePart {
                    pose: Pose {
                        position: [0., 5., 0.],
                        ..Default::default()
                    },
                    shape: Shape::Box {
                        half_extents: [0.5; 3],
                    },
                },
            ],
        },
    ];
    for (index, shape) in fixtures.into_iter().enumerate() {
        let mut w = world(Space::Spatial);
        body(&mut w, BodyKind::Fixed, [0.; 3], shape);
        let (lines, stats) = capture(&w, COLLIDERS);
        assert!(!lines.is_empty(), "shape {index}");
        assert_eq!(stats.lines as usize, lines.len());
        assert!(!stats.truncated, "shape {index}");
        assert_eq!(stats.unsupported_shapes, 0);
        assert!(lines
            .iter()
            .flat_map(|l| l.from.into_iter().chain(l.to).chain(l.color))
            .all(f32::is_finite));
        match index {
            0 => assert!(has_line(&lines, [-1., -2., -3.], [1., -2., -3.])),
            1 => {
                for p in lines.iter().flat_map(|l| [l.from, l.to]) {
                    near(rp::Vector::from(p).length(), 2.);
                }
            }
            2 => {
                for p in lines.iter().flat_map(|l| [l.from, l.to]) {
                    let nearest = rp::Vector::new(0., p[1].clamp(-2., 2.), 0.);
                    near((rp::Vector::from(p) - nearest).length(), 0.5);
                }
            }
            3 => {
                assert!(has_line(&lines, [0.; 3], [1., 0., 0.]));
                assert!(has_line(&lines, [1., 0., 0.], [0., 0., 1.]));
            }
            4 => {
                assert_eq!(lines.len(), 3);
                assert!(has_line(&lines, [2., 0., 0.], [0., 0., 3.]));
            }
            5 => assert!(lines
                .iter()
                .flat_map(|l| [l.from, l.to])
                .all(|p| p[1] == 0. && p[0].abs() <= 1. && p[2].abs() <= 1.)),
            6 => assert!(lines
                .iter()
                .flat_map(|l| [l.from, l.to])
                .all(|p| (p[0] >= 4.5 && p[1].abs() <= 0.5) || (p[1] >= 4.5 && p[0].abs() <= 0.5))),
            _ => unreachable!(),
        }
    }
}

#[test]
fn native_debug_teleport_and_fixture_rotation_use_current_parent_pose_without_refresh() {
    let mut w = world(Space::Spatial);
    let id = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                ..Default::default()
            },
            ColliderDesc {
                pose: Pose {
                    position: [2., 0., 0.],
                    rotation: rp::Rotation::from_rotation_z(std::f32::consts::FRAC_PI_2).to_array(),
                },
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [1., 2., 3.],
                })
            },
        )
        .unwrap();
    let collider = w.collider_ids(id).unwrap().next().unwrap();
    let old = *w
        .backend
        .colliders
        .get(super::super::colliders::native_collider(collider))
        .unwrap()
        .position();
    w.set_pose(
        id,
        Pose {
            position: [10., 20., 30.],
            rotation: rp::Rotation::from_rotation_z(std::f32::consts::FRAC_PI_2).to_array(),
        },
    )
    .unwrap();
    let before = w.capture_snapshot().unwrap();
    let (lines, stats) = capture(&w, COLLIDERS);
    assert!(!stats.truncated);
    assert!(has_line(&lines, [11., 24., 27.], [9., 24., 27.]));
    assert_eq!(
        *w.backend
            .colliders
            .get(super::super::colliders::native_collider(collider))
            .unwrap()
            .position(),
        old
    );
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn native_debug_compound_local_pose_and_native_planar_chain_parts_are_visible() {
    let mut w = world(Space::PlanarXy);
    let id = body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Box {
            half_extents: [1.; 3],
        },
    );
    let cid = w.collider_ids(id).unwrap().next().unwrap();
    let parts = (0..3)
        .map(|i| {
            (
                rp::Pose::from_translation(rp::Vector::new(i as f32 * 2., 0., 0.)),
                rp::SharedShape::capsule_y(1., 0.0001),
            )
        })
        .collect();
    w.backend
        .colliders
        .get_mut(super::super::colliders::native_collider(cid))
        .unwrap()
        .set_shape(rp::SharedShape::compound(parts));
    let (lines, stats) = capture(&w, COLLIDERS);
    assert!(!stats.truncated);
    assert_eq!(stats.unsupported_shapes, 0);
    assert!(lines.iter().any(|l| l.from[0] < 0.001));
    assert!(lines.iter().any(|l| l.from[0] > 3.999));
    assert!(lines
        .iter()
        .all(|l| (rp::Vector::from(l.to) - rp::Vector::from(l.from)).length() < 2.01));
}

#[test]
fn native_debug_native_sensor_disabled_body_and_sleep_styles_are_distinct() {
    let mut w = world(Space::Spatial);
    let id = body(
        &mut w,
        BodyKind::Dynamic,
        [0.; 3],
        Shape::Sphere { radius: 1. },
    );
    let normal = capture(&w, COLLIDERS).0[0].color;
    let cid = w.collider_ids(id).unwrap().next().unwrap();
    w.update_collider(
        cid,
        ColliderDesc {
            sensor: true,
            ..ColliderDesc::new(Shape::Sphere { radius: 1. })
        },
    )
    .unwrap();
    assert_eq!(capture(&w, COLLIDERS).0[0].color, SENSOR);
    w.set_body_options(
        id,
        &BodyOptions {
            enabled: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(capture(&w, COLLIDERS).0[0].color, DISABLED);
    w.set_body_options(id, &BodyOptions::default()).unwrap();
    w.update_collider(cid, ColliderDesc::new(Shape::Sphere { radius: 1. }))
        .unwrap();
    w.backend.bodies.get_mut(native_id(id)).unwrap().sleep();
    assert_eq!(capture(&w, COLLIDERS).0[0].color, ASLEEP);
    assert_ne!(normal, ASLEEP);
    assert_eq!(capture(&w, SLEEPING).0[0].color, ASLEEP);
}

#[test]
fn native_debug_line_work_sink_and_disabled_limits_stop_actual_iteration() {
    let mut w = world(Space::Spatial);
    body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Sphere { radius: 1. },
    );
    assert_eq!(
        draw_world(&w, options(0), |_| panic!("disabled draw")),
        DebugDrawStatistics::default()
    );
    let mut seen = 0;
    let s = draw_world(
        &w,
        DebugDrawOptions {
            max_lines: 5,
            ..options(COLLIDERS)
        },
        |_| {
            seen += 1;
            true
        },
    );
    assert_eq!(seen, 5);
    assert_eq!(s.lines, 5);
    assert!(s.truncated);
    let s = draw_world(
        &w,
        DebugDrawOptions {
            max_work: 4,
            ..options(COLLIDERS)
        },
        |_| true,
    );
    assert_eq!(s.work, 4);
    assert!(s.truncated);
    let mut seen = 0;
    let s = draw_world(&w, options(COLLIDERS), |_| {
        seen += 1;
        false
    });
    assert_eq!(seen, 1);
    assert_eq!(s.lines, 0);
    assert!(s.truncated);
    let s = draw_world(
        &w,
        DebugDrawOptions {
            max_lines: 0,
            ..options(COLLIDERS)
        },
        |_| panic!("zero output budget"),
    );
    assert_eq!(s.lines, 0);
    assert!(s.truncated);
}

#[test]
fn native_debug_convex_bounds_visit_every_point_within_budget() {
    let mut w = world(Space::Spatial);
    body(&mut w, BodyKind::Fixed, [0.; 3], tetra());
    let s = draw_world(
        &w,
        DebugDrawOptions {
            max_work: 5,
            ..options(BROADPHASE)
        },
        |_| panic!("incomplete bounds must not be drawn"),
    );
    assert_eq!(s.work, 5);
    assert_eq!(s.lines, 0);
    assert!(s.truncated);
    let (lines, s) = capture(&w, BROADPHASE);
    assert!(!s.truncated);
    assert_eq!(lines.len(), 12);
    assert!(has_line(&lines, [0.; 3], [1., 0., 0.]));
}

#[test]
fn native_debug_convex_hull_omits_deleted_coplanar_face_diagonals() {
    let mut w = world(Space::Spatial);
    let points = [-1., 1.]
        .into_iter()
        .flat_map(|x| {
            [-1., 1.]
                .into_iter()
                .flat_map(move |y| [-1., 1.].into_iter().map(move |z| [x, y, z]))
        })
        .collect();
    body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::ConvexHull { points },
    );
    let (lines, stats) = capture(&w, COLLIDERS);
    assert!(!stats.truncated);
    assert_eq!(lines.len(), 12);
    for line in lines {
        near(
            (rp::Vector::from(line.to) - rp::Vector::from(line.from)).length(),
            2.,
        );
    }
}

#[test]
fn native_debug_heightfield_empty_cells_and_mesh_triangles_consume_work() {
    let mut w = world(Space::Spatial);
    let id = body(&mut w, BodyKind::Fixed, [0.; 3], field(32, 32));
    let cid = w.collider_ids(id).unwrap().next().unwrap();
    let shape = w
        .backend
        .colliders
        .get_mut(super::super::colliders::native_collider(cid))
        .unwrap()
        .shape_mut()
        .as_heightfield_mut()
        .unwrap();
    for i in 0..31 {
        for j in 0..31 {
            shape.set_cell_status(
                i,
                j,
                rapier3d::parry::shape::HeightFieldCellStatus::CELL_REMOVED,
            );
        }
    }
    let s = draw_world(
        &w,
        DebugDrawOptions {
            max_work: 12,
            ..options(COLLIDERS)
        },
        |_| panic!("removed cells emit no lines"),
    );
    assert_eq!(s.work, 12);
    assert!(s.truncated);
    assert_eq!(s.lines, 0);
    let mut w = world(Space::Spatial);
    body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::TriangleMesh {
            vertices: vec![[0., 0., 0.], [1., 0., 0.], [0., 0., 1.]],
            triangles: vec![[0, 1, 2]; 100],
        },
    );
    let s = draw_world(
        &w,
        DebugDrawOptions {
            max_work: 12,
            ..options(COLLIDERS)
        },
        |_| true,
    );
    assert_eq!(s.work, 12);
    assert!(s.truncated);
    assert!(s.lines <= 7);
}

#[test]
fn native_debug_compound_width_is_bounded_without_recursion_or_heap_scratch() {
    let mut w = world(Space::Spatial);
    let id = body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Sphere { radius: 1. },
    );
    let cid = w.collider_ids(id).unwrap().next().unwrap();
    let parts = (0..65)
        .map(|i| {
            (
                rp::Pose::from_translation(rp::Vector::new(i as f32, 0., 0.)),
                rp::SharedShape::ball(0.5),
            )
        })
        .collect();
    w.backend
        .colliders
        .get_mut(super::super::colliders::native_collider(cid))
        .unwrap()
        .set_shape(rp::SharedShape::compound(parts));
    let s = draw_world(&w, options(COLLIDERS), |_| {
        panic!("overfull work stack stops before traversal")
    });
    assert!(s.truncated);
    assert_eq!(s.lines, 0);
    assert!(s.work < 100);
}

#[test]
fn native_debug_unsupported_native_shape_is_reported_without_replacement_geometry() {
    let mut w = world(Space::Spatial);
    let id = body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Sphere { radius: 1. },
    );
    let cid = w.collider_ids(id).unwrap().next().unwrap();
    w.backend
        .colliders
        .get_mut(super::super::colliders::native_collider(cid))
        .unwrap()
        .set_shape(rp::SharedShape::halfspace(rp::Vector::Y));
    let stats = draw_world(&w, options(COLLIDERS), |_| {
        panic!("unsupported shape must not become an AABB fallback")
    });
    assert_eq!(stats.unsupported_shapes, 1);
    assert!(stats.truncated);
    assert_eq!(stats.lines, 0);
}

#[test]
fn native_debug_all_thirteen_joint_kinds_and_local_frames_are_supported() {
    let spring = SpringResponse {
        stiffness: 10.,
        damping: 2.,
    };
    let kinds = [
        JointKind::Fixed,
        JointKind::Spherical,
        JointKind::Revolute {
            limits: Some([-0.5, 0.5]),
            motor: None,
        },
        JointKind::ContinuousRevolute {
            limits: [-20., 20.],
            motor: None,
        },
        JointKind::Prismatic {
            limits: Some([-1., 2.]),
            motor: None,
        },
        JointKind::Distance { length: 2. },
        JointKind::Rope { max_length: 2. },
        JointKind::ElasticRope {
            max_length: 2.,
            spring,
        },
        JointKind::Gear {
            ratio: 2.,
            reference_angle: 0.,
            spring: None,
        },
        JointKind::Pulley {
            ground_a: [0., 3., 0.],
            ground_b: [2., 3., 0.],
            length: 6.,
            ratio: 1.,
            slack: false,
            spring: None,
        },
        JointKind::FrequencySpring {
            rest_length: 2.,
            frequency_hz: 2.,
            damping_ratio: 1.,
        },
        JointKind::AccelerationSpring {
            rest_length: 2.,
            stiffness: 10.,
            damping: 2.,
        },
        JointKind::Spring {
            rest_length: 2.,
            stiffness: 10.,
            damping: 2.,
        },
    ];
    for (index, kind) in kinds.into_iter().enumerate() {
        let planar = matches!(
            kind,
            JointKind::ContinuousRevolute { .. } | JointKind::Gear { .. }
        );
        let mut w = world(if planar {
            Space::PlanarXy
        } else {
            Space::Spatial
        });
        let a = body(
            &mut w,
            BodyKind::Fixed,
            [0.; 3],
            Shape::Sphere { radius: 0.25 },
        );
        let b = body(
            &mut w,
            BodyKind::Dynamic,
            [2., 0., 0.],
            Shape::Sphere { radius: 0.25 },
        );
        let mut desc = JointDesc::new(a, b, kind);
        desc.local_frame_a.position = [0., 0.5, 0.];
        desc.local_frame_b.position = [0., -0.5, 0.];
        if matches!(desc.kind, JointKind::ContinuousRevolute { .. }) {
            let r = rp::Rotation::from_rotation_y(-std::f32::consts::FRAC_PI_2).to_array();
            desc.local_frame_a.rotation = r;
            desc.local_frame_b.rotation = r;
        }
        w.create_joint(desc).unwrap();
        let (lines, s) = capture(&w, JOINTS);
        assert!(!s.truncated, "kind {index}");
        assert_eq!(s.unsupported_shapes, 0);
        assert!(!lines.is_empty(), "kind {index}");
        if index == 9 {
            assert!(has_line(&lines, [0., 0.5, 0.], [0., 3., 0.]));
            assert!(has_line(&lines, [0., 3., 0.], [2., 3., 0.]));
            assert!(!has_line(&lines, [0., 0.5, 0.], [2., -0.5, 0.]));
        } else if index == 8 {
            assert!(lines.iter().all(|l| l.color == joints::GEAR));
            assert!(!has_line(&lines, [0.; 3], [2., 0., 0.]));
        } else {
            assert!(has_line(&lines, [0.; 3], [0., 0.5, 0.]));
            assert!(has_line(&lines, [0., 0.5, 0.], [2., -0.5, 0.]));
        }
    }
}

#[test]
fn native_debug_disabled_removed_joint_and_joint_visit_limit_are_observable() {
    let mut w = world(Space::Spatial);
    let a = body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Sphere { radius: 0.25 },
    );
    let b = body(
        &mut w,
        BodyKind::Dynamic,
        [2., 0., 0.],
        Shape::Sphere { radius: 0.25 },
    );
    let mut d = JointDesc::new(a, b, JointKind::Fixed);
    d.enabled = false;
    let id = w.create_joint(d).unwrap();
    let (lines, s) = capture(&w, JOINTS);
    assert!(!s.truncated);
    assert!(lines.iter().all(|l| l.color == DISABLED));
    let s = draw_world(
        &w,
        DebugDrawOptions {
            max_work: 1,
            ..options(JOINTS)
        },
        |_| panic!("joint lookup budget"),
    );
    assert_eq!(s.work, 1);
    assert!(s.truncated);
    w.remove_joint(id).unwrap();
    assert!(capture(&w, JOINTS).0.is_empty());
}

#[test]
fn native_debug_contacts_and_ccd_observations_are_read_without_consumption() {
    let mut w = world(Space::Spatial);
    body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Box {
            half_extents: [0.05, 10., 10.],
        },
    );
    let moving = w
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [-2., 0., 0.],
                    ..Default::default()
                },
                linear_velocity: [300., 0., 0.],
                ccd: true,
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        )
        .unwrap();
    w.step();
    let clamps = w.ccd_clamps().to_vec();
    assert!(!clamps.is_empty());
    let before = w.capture_snapshot().unwrap();
    let (lines, s) = capture(&w, CCD);
    assert!(!s.truncated);
    assert!(lines.iter().any(|l| point_near(l.from, clamps[0].point)));
    assert_eq!(w.ccd_clamps(), clamps);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    w.step();
    let stats = w.step_statistics();
    assert!(stats.solver_contacts > 0);
    let before = w.capture_snapshot().unwrap();
    let (lines, s) = capture(&w, CONTACTS);
    assert!(!s.truncated);
    assert!(!lines.is_empty());
    assert!(lines.iter().all(|l| l.color == CONTACT));
    assert_eq!(w.step_statistics(), stats);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    assert!(w.body_state(moving).unwrap().pose.position[0] < 0.);
}

#[test]
fn native_debug_retained_frame_ccd_survives_empty_last_tick_and_shares_geometry_budget() {
    let mut w = world(Space::Spatial);
    body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Box {
            half_extents: [0.05, 10., 10.],
        },
    );
    w.create_body(
        BodyDesc {
            pose: Pose {
                position: [-2., 0., 0.],
                ..Default::default()
            },
            linear_velocity: [300., 0., 0.],
            ccd: true,
            can_sleep: false,
            ..Default::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
    )
    .unwrap();
    w.step();
    let retained = w.ccd_clamps().to_vec();
    assert_eq!(retained.len(), 1);
    w.step();
    w.step();
    assert!(w.ccd_clamps().is_empty());
    assert!(capture(&w, CCD).0.is_empty());
    let before = w.capture_snapshot().unwrap();
    let mut lines = Vec::new();
    let stats = w.debug_draw(
        options(CCD),
        retained.iter().map(|clamp| (clamp.point, clamp.normal)),
        |line| {
            lines.push(line);
            true
        },
    );
    assert!(!stats.truncated);
    assert_eq!(stats.lines, 4);
    assert!(lines
        .iter()
        .any(|line| point_near(line.from, retained[0].point)));
    let geometry_lines = capture(&w, COLLIDERS).0.len() as u32;
    let stats = w.debug_draw(
        DebugDrawOptions {
            max_lines: geometry_lines + 2,
            ..options(COLLIDERS | CCD)
        },
        retained.iter().map(|clamp| (clamp.point, clamp.normal)),
        |_| true,
    );
    assert_eq!(stats.lines, geometry_lines + 2);
    assert!(stats.truncated);
    let visits = std::cell::Cell::new(0);
    let ccd = retained.iter().map(|clamp| {
        visits.set(visits.get() + 1);
        (clamp.point, clamp.normal)
    });
    w.debug_draw(options(COLLIDERS), ccd, |_| true);
    assert_eq!(visits.get(), 0);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );

    // Engine terrain observations need only geometry: no gameplay entity or
    // currently-live body's identity is needed to retain the frame witness.
    let empty = world(Space::Spatial);
    let mut terrain_lines = Vec::new();
    let stats = empty.debug_draw(
        options(CCD),
        std::iter::once(([14., 15., 16.], [0., 1., 0.])),
        |line| {
            terrain_lines.push(line);
            true
        },
    );
    assert_eq!(stats.lines, 4);
    assert!(!stats.truncated);
    assert!(has_line(&terrain_lines, [14., 15., 16.], [14., 15.2, 16.]));
}

#[test]
fn native_debug_repeated_frames_reuse_output_capacity_and_preserve_queued_native_state() {
    let mut w = world(Space::Spatial);
    let id = body(
        &mut w,
        BodyKind::Dynamic,
        [0.; 3],
        Shape::Capsule {
            half_height: 1.,
            radius: 0.5,
        },
    );
    w.backend
        .bodies
        .get_mut(native_id(id))
        .unwrap()
        .add_force(rp::Vector::new(1., 2., 3.), true);
    let before = w.capture_snapshot().unwrap();
    let mut out = Vec::with_capacity(1024);
    let capacity = out.capacity();
    let pointer = out.as_ptr();
    for _ in 0..16 {
        out.clear();
        let s = draw_world(&w, options(ALL), |line| {
            out.push(line);
            true
        });
        assert!(!s.truncated);
        assert_eq!(out.capacity(), capacity);
        assert_eq!(out.as_ptr(), pointer);
    }
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn native_debug_hard_maximums_hold_when_requested_limits_are_unbounded() {
    let mut w = world(Space::Spatial);
    for i in 0..350 {
        body(
            &mut w,
            BodyKind::Fixed,
            [i as f32 * 3., 0., 0.],
            Shape::Sphere { radius: 1. },
        );
    }
    let stats = draw_world(
        &w,
        DebugDrawOptions {
            flags: COLLIDERS,
            max_lines: u32::MAX,
            max_work: u32::MAX,
        },
        |_| true,
    );
    assert_eq!(stats.lines, 16_384);
    assert!(stats.truncated);
    assert!(stats.work < 65_536);

    // A native-only large field is valid backend geometry even though the cold
    // public descriptor has tighter sample admission. Empty cells must not turn
    // the independent work ceiling into an unbounded iterator skip.
    let mut w = world(Space::Spatial);
    let id = body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Sphere { radius: 1. },
    );
    let cid = w.collider_ids(id).unwrap().next().unwrap();
    let shape = rp::SharedShape::heightfield(
        rapier3d::parry::utils::Array2::from_fn(300, 300, |_, _| 0.),
        rp::Vector::ONE,
    );
    let collider = w
        .backend
        .colliders
        .get_mut(super::super::colliders::native_collider(cid))
        .unwrap();
    collider.set_shape(shape);
    let field = collider.shape_mut().as_heightfield_mut().unwrap();
    for i in 0..299 {
        for j in 0..299 {
            field.set_cell_status(
                i,
                j,
                rapier3d::parry::shape::HeightFieldCellStatus::CELL_REMOVED,
            );
        }
    }
    let stats = draw_world(
        &w,
        DebugDrawOptions {
            flags: COLLIDERS,
            max_lines: u32::MAX,
            max_work: u32::MAX,
        },
        |_| panic!("removed cells must not draw"),
    );
    assert_eq!(stats.work, 65_536);
    assert_eq!(stats.lines, 0);
    assert!(stats.truncated);
}

#[test]
fn native_debug_sparse_collider_arena_charges_vacant_slots_before_live_geometry() {
    let mut w = world(Space::Spatial);
    let ids: Vec<_> = (0..16)
        .map(|i| {
            body(
                &mut w,
                BodyKind::Dynamic,
                [i as f32 * 3., 0., 0.],
                Shape::Sphere { radius: 1. },
            )
        })
        .collect();
    let survivor = *ids.last().unwrap();
    let collider = w.collider_ids(survivor).unwrap().next().unwrap();
    assert_eq!(collider.slot, 15);
    for id in &ids[..15] {
        w.remove_body(*id).unwrap();
    }
    let before = w.capture_snapshot().unwrap();
    let stats = draw_world(
        &w,
        DebugDrawOptions {
            max_work: 8,
            ..options(COLLIDERS)
        },
        |_| panic!("live collider lies beyond charged slot budget"),
    );
    assert_eq!(stats.work, 8);
    assert_eq!(stats.lines, 0);
    assert!(stats.truncated);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    let (_, stats) = capture(&w, COLLIDERS);
    assert!(!stats.truncated);
    assert!(stats.lines > 0);
    assert!(stats.work > 16);
    w.remove_body(survivor).unwrap();
    assert_eq!(
        draw_world(
            &w,
            DebugDrawOptions {
                max_work: 8,
                ..options(COLLIDERS)
            },
            |_| panic!("empty historical arena")
        ),
        DebugDrawStatistics::default()
    );
}

#[test]
fn native_debug_sparse_sleep_arena_charges_vacant_slots_before_body_markers() {
    let mut w = world(Space::Spatial);
    let ids: Vec<_> = (0..16)
        .map(|i| {
            body(
                &mut w,
                BodyKind::Dynamic,
                [i as f32 * 3., 0., 0.],
                Shape::Sphere { radius: 1. },
            )
        })
        .collect();
    let survivor = *ids.last().unwrap();
    assert_eq!(survivor.slot, 15);
    for id in &ids[..15] {
        w.remove_body(*id).unwrap();
    }
    let before = w.capture_snapshot().unwrap();
    let stats = draw_world(
        &w,
        DebugDrawOptions {
            max_work: 8,
            ..options(SLEEPING)
        },
        |_| panic!("live body lies beyond charged slot budget"),
    );
    assert_eq!(stats.work, 8);
    assert_eq!(stats.lines, 0);
    assert!(stats.truncated);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    let (lines, stats) = capture(&w, SLEEPING);
    assert!(!stats.truncated);
    assert_eq!(lines.len(), 3);
    assert_eq!(stats.work, 19);
    w.remove_body(survivor).unwrap();
    assert_eq!(
        draw_world(
            &w,
            DebugDrawOptions {
                max_work: 8,
                ..options(SLEEPING)
            },
            |_| panic!("empty historical arena")
        ),
        DebugDrawStatistics::default()
    );
}

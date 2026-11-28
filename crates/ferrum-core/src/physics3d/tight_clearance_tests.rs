//! Tight physical fit keeps the real capsule and a positive numerical margin.
use super::*;

const Y: f32 = 0.5097955;
const EPS: f32 = 2e-6;
fn pose(p: [f32; 3]) -> Pose {
    Pose {
        position: p,
        ..Pose::default()
    }
}
fn fixture(gap: f32, z: f32, compound: bool) -> (PhysicsWorld3d, BodyId, BodyId, BodyId, f32) {
    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let roof = Y + 0.5 + gap;
    let floor_shape = Shape::Box {
        half_extents: [20., 0.1, 20.],
    };
    let roof_shape = Shape::Box {
        half_extents: [1., 0.1, 1.],
    };
    let (floor, ceiling) = if compound {
        let body = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Compound {
                    parts: vec![
                        ShapePart {
                            pose: pose([0., -0.1, 0.]),
                            shape: floor_shape,
                        },
                        ShapePart {
                            pose: pose([-10., roof + 0.1, z]),
                            shape: roof_shape,
                        },
                    ],
                }),
            )
            .unwrap();
        (body, body)
    } else {
        let floor = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose([0., -0.1, 0.]),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(floor_shape),
            )
            .unwrap();
        let ceiling = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: pose([-10., roof + 0.1, z]),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(roof_shape),
            )
            .unwrap();
        (floor, ceiling)
    };
    let actor = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: pose([-10., Y, z]),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    w.enable_character(
        actor,
        CharacterConfig {
            push_mass: 10.,
            step_height: 0.,
            snap_distance: 0.,
            ..CharacterConfig::default()
        },
    )
    .unwrap();
    (w, actor, floor, ceiling, roof)
}
fn interval(w: &mut PhysicsWorld3d, dt: f32) {
    assert!(w.begin_interval(dt, true).unwrap());
    w.step();
    w.end_interval();
    assert_eq!(w.config().step_seconds, WorldConfig::default().step_seconds);
}
fn fresh_impulse(w: &mut PhysicsWorld3d, actor: BodyId, axis: usize, sign: f32, dt: f32) {
    let mut impulse = [0.; 3];
    impulse[axis] = sign * 5.;
    impulse[1] = 10. * (-0.09892499 / dt + 9.81 * dt);
    w.apply_character_impulse(actor, impulse).unwrap();
}
fn fits(p: [f32; 3], roof: f32) -> bool {
    p[1] - 0.5 >= -EPS && p[1] + 0.5 <= roof + EPS
}

fn first_actual_prefix(w: &mut PhysicsWorld3d, actor: BodyId, desired: [f32; 3]) -> [f32; 3] {
    use rapier3d::prelude as rp;
    w.refresh_queries();
    let c = &w.backend.colliders[super::colliders::native_collider(w.characters[&actor].collider)];
    let q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
        exclude_rigid_body: Some(super::world::native_id(actor)),
        ..Default::default()
    });
    let mut first = None;
    w.characters[&actor].config.controller().move_shape(
        0.,
        &q,
        c.shape(),
        c.position(),
        desired.into(),
        |hit| {
            first.get_or_insert(hit.translation_applied);
        },
    );
    first.unwrap_or_default().to_array()
}

#[test]
fn tight_fit_gap_axis_sign_origin_and_actual_interval_matrix() {
    let mut failed = vec![];
    for compound in [false, true] {
        for z in [0., 10.] {
            for gap in [0., 0.000001, 0.00001, 0.0001, 0.0003, 0.0005, 0.001, 0.002] {
                for axis in [0, 2] {
                    for sign in [-1., 1.] {
                        for dt in [0.007, 1. / 60., 0.021, 0.1] {
                            let (mut w, actor, _, _, roof) = fixture(gap, z, compound);
                            let start = w.body_state(actor).unwrap().pose.position;
                            let mut desired = [0., -0.09892499, 0.];
                            desired[axis] = sign * 0.5 * dt;
                            let prefix = first_actual_prefix(&mut w, actor, desired);
                            fresh_impulse(&mut w, actor, axis, sign, dt);
                            interval(&mut w, dt);
                            let p = w.body_state(actor).unwrap().pose.position;
                            let requested = sign * 0.5 * dt;
                            let actual = p[axis] - start[axis];
                            let other = if axis == 0 { 2 } else { 0 };
                            let ok = fits(p, roof)
                                && (actual - requested).abs() < 2e-5
                                && (p[other] - start[other]).abs() < 2e-6
                                && (p[1] - start[1] - prefix[1]).abs() < 4e-6;
                            println!("FIT_MATRIX compound={compound} z={z} gap={gap} axis={axis} sign={sign} dt={dt} requested={requested} actual={actual} dy={} prefix_y={} floor_gap={} roof_gap={} other={} ok={ok}",p[1]-start[1],prefix[1],p[1]-0.5,roof-p[1]-0.5,p[other]-start[other]);
                            if !ok {
                                failed.push((compound, z, gap, axis, sign, dt, p));
                            }
                            assert_eq!(w.characters[&actor].pending_impulse, [0.; 3]);
                        }
                    }
                }
            }
        }
    }
    assert!(
        failed.is_empty(),
        "{} physical-fit cases failed, first={:?}",
        failed.len(),
        failed.first()
    );
    // Exact packed-browser fixture, including stationary position-kinematic
    // support and zero gravity. Keep its forward-wall negative control.
    for wall in [false, true] {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let floor = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose([0., -0.1, 0.]),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [20., 0.1, 20.],
                }),
            )
            .unwrap();
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: pose([-10., 1.1103, 10.]),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [1., 0.1, 1.],
            }),
        )
        .unwrap();
        if wall {
            w.create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: pose([-10., 0.5, 10.272]),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [1., 0.5, 0.02],
                }),
            )
            .unwrap();
        }
        let actor = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: pose([-10., 0.5101, 10.]),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.25,
                    radius: 0.25,
                }),
            )
            .unwrap();
        w.enable_character(
            actor,
            CharacterConfig {
                push_mass: 10.,
                step_height: 0.,
                snap_distance: 0.,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
        let dt = 1f32 / 60.;
        w.apply_character_impulse(actor, [0., 10. * (-0.09892499 / dt), 5.])
            .unwrap();
        interval(&mut w, dt);
        let p = w.body_state(actor).unwrap().pose.position;
        let tangent = p[2] - 10.;
        assert!(p[1] - 0.5 >= -EPS && p[1] + 0.5 <= 1.0103 + EPS, "{p:?}");
        assert!(w.character_state(actor).unwrap().grounded);
        assert_eq!(
            w.character_state(actor).unwrap().ground.unwrap().body,
            floor
        );
        if wall {
            // Preserve the existing within-skin KCC nudge while checking the
            // actual wall plane. This control promises blocking, not maximal
            // progress through the original preferred wall margin.
            assert!((-0.0002..=0.002002).contains(&tangent), "{p:?}");
            assert!(tangent < 0.5 * dt);
        } else {
            assert!((tangent - 0.5 * dt).abs() < 2e-5, "{p:?}");
        }
        assert_eq!(w.characters[&actor].pending_impulse, [0.; 3]);
        println!("OFFICIAL_PACKED_EQUIVALENT gravity=0 floor=KinematicPosition wall={wall} dt={dt} pose={p:?} tangent={tangent} floor_gap={} roof_gap={}",p[1]-0.5,1.0103-p[1]-0.5);
    }
}

#[test]
fn tight_supported_motion_does_not_accumulate_vertical_drift() {
    for gap in [0., 0.000001, 0.0001, 0.0003] {
        let (mut w, actor, _, _, roof) = fixture(gap, 0., false);
        w.step();
        assert!(w.character_state(actor).unwrap().grounded);
        let start = w.body_state(actor).unwrap().pose.position;
        for tick in 0..1200 {
            let sign = if (tick / 60) % 2 == 0 { 1. } else { -1. };
            w.set_character_input(
                actor,
                CharacterInput {
                    velocity: [0., 0., sign * 0.5],
                    ..CharacterInput::default()
                },
            )
            .unwrap();
            let before = w.body_state(actor).unwrap().pose.position;
            w.step();
            let p = w.body_state(actor).unwrap().pose.position;
            assert!(fits(p, roof), "gap={gap}, tick={tick}: {p:?}");
            assert!(
                (p[1] - start[1]).abs() < 4e-6,
                "vertical drift gap={gap}, tick={tick}: {p:?}"
            );
            assert!(
                (p[2] - before[2] - sign * 0.5 / 60.).abs() < 2e-5,
                "lost tangent gap={gap}, tick={tick}: {p:?}"
            );
        }
    }
}

#[test]
fn physical_initial_penetration_and_true_no_fit_do_not_admit_clearance_retry() {
    for gap in [-0.0003, -0.0105] {
        let (mut w, actor, _, _, roof) = fixture(gap, 0., false);
        w.step();
        let start = w.body_state(actor).unwrap().pose.position;
        w.set_character_input(
            actor,
            CharacterInput {
                velocity: [0.5, 0., 0.],
                ..CharacterInput::default()
            },
        )
        .unwrap();
        w.step();
        let p = w.body_state(actor).unwrap().pose.position;
        assert!(
            (p[0] - start[0]).abs() < EPS && (p[1] - start[1]).abs() < EPS,
            "gap={gap}: {p:?}, roof={roof}"
        );
    }
}

#[test]
fn tight_cold_queries_keep_pending_force_jump_and_checkpoint_bytes() {
    let (mut w, actor, _, _, roof) = fixture(0., 0., false);
    w.step();
    w.add_character_force(actor, [0., 0., 3.]).unwrap();
    w.apply_character_impulse(actor, [0., 0., 5.]).unwrap();
    w.set_character_input(
        actor,
        CharacterInput {
            jump_speed: 4.,
            ..CharacterInput::default()
        },
    )
    .unwrap();
    w.refresh_queries();
    let before = w.capture_snapshot().unwrap();
    let p = w.body_state(actor).unwrap().pose;
    let mut scratch = super::character_query::CharacterProbeScratch::default();
    for _ in 0..3 {
        let result = w
            .probe_character_motion(actor, p, [0., 0., 0.03], true, &mut scratch)
            .unwrap();
        assert!(fits(result.pose.position, roof));
        assert!((result.pose.position[2] - p.position[2] - 0.03).abs() < 2e-5);
    }
    assert_eq!(
        before.encoded_bytes(),
        w.capture_snapshot().unwrap().encoded_bytes()
    );
    assert_eq!(w.characters[&actor].pending_impulse, [0., 0., 5.]);
}

#[test]
fn tight_force_preview_checkpoint_replays_actual_intervals_without_duplicate_impulses() {
    let (mut w, actor, _, _, roof) = fixture(0.0003, 0., false);
    w.step();
    w.add_character_force(actor, [0., 0., 3.]).unwrap();
    w.apply_character_impulse(actor, [0., 0., 5.]).unwrap();
    let saved = w.capture_snapshot().unwrap();
    let mut replay = PhysicsWorld3d::from_snapshot(&saved).unwrap();
    let mut elapsed = 0.;
    for dt in [0.007, 0.013, 0.021, 1. / 60., 0.1] {
        elapsed += dt;
        interval(&mut w, dt);
        interval(&mut replay, dt);
        assert!(fits(w.body_state(actor).unwrap().pose.position, roof));
        assert_eq!(
            w.body_state(actor).unwrap(),
            replay.body_state(actor).unwrap()
        );
        assert_eq!(
            w.character_state(actor).unwrap(),
            replay.character_state(actor).unwrap()
        );
        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            replay.capture_snapshot().unwrap().encoded_bytes()
        );
        assert_eq!(w.characters[&actor].pending_impulse, [0.; 3]);
        assert!((w.characters[&actor].external_velocity[2] - (0.5 + 0.3 * elapsed)).abs() < 2e-6);
    }
}

const FULL_MARGIN_QUERY_GOLDEN: [u64; 64] = [
    0x4f97e52a68023320,
    0x5b628f8d23645f1a,
    0x932ed8dee94eac02,
    0x9113a3f493151880,
    0xe77dd93b38162020,
    0x38dcd9d57723ce1a,
    0x5c400221c67d4302,
    0x9514d00bd2e7c180,
    0x235f76bc5c18aaf9,
    0x9f3387d5fc28c28e,
    0x0c161d59113491ae,
    0x5d6ca6a92e7954b1,
    0x3a946f1d1748176e,
    0x9a97f02d0b138430,
    0xf1f97702e1aa3ab8,
    0x011101c36026099f,
    0xec5498306d5b4d3e,
    0x481e4598edf12e52,
    0xc22657c059cbb3aa,
    0x405c0d7cfe7296b6,
    0x780ed013f2feb2b9,
    0x27ab3d5a42fc3738,
    0x3df4191508937360,
    0x3b6010be30818540,
    0x22a037fd9b3251e6,
    0x18b79b867359275c,
    0x553b74610414158a,
    0x67627d6cf2f317b0,
    0xee3a24995f64b1ca,
    0xb8a1b6af9185c9cd,
    0x0e9eeb4b9ac261be,
    0x3df3d075a78554fe,
    0x4f97e52a68023320,
    0x5b628f8d23645f1a,
    0x932ed8dee94eac02,
    0x9113a3f493151880,
    0xe77dd93b38162020,
    0x38dcd9d57723ce1a,
    0x5c400221c67d4302,
    0x9514d00bd2e7c180,
    0x235f76bc5c18aaf9,
    0x9f3387d5fc28c28e,
    0x0c161d59113491ae,
    0x5d6ca6a92e7954b1,
    0xc70ba8685856612f,
    0x3ab2f119a59805de,
    0x8fd6d61cfa026c56,
    0xecabb97aff5173db,
    0xec5498306d5b4d3e,
    0x481e4598edf12e52,
    0xc22657c059cbb3aa,
    0x405c0d7cfe7296b6,
    0x780ed013f2feb2b9,
    0x27ab3d5a42fc3738,
    0x3df4191508937360,
    0x3b6010be30818540,
    0x22a037fd9b3251e6,
    0x18b79b867359275c,
    0x553b74610414158a,
    0x67627d6cf2f317b0,
    0xee3a24995f64b1ca,
    0xb8a1b6af9185c9cd,
    0x0e9eeb4b9ac261be,
    0x3df3d075a78554fe,
];

#[test]
fn full_clearance_query_bytes() {
    let mut golden_index = 0;
    use rapier3d::prelude as rp;
    for compound in [false, true] {
        for z in [0., 10.] {
            for gap in [0.002, 0.02] {
                for axis in [0, 2] {
                    for sign in [-1., 1.] {
                        for dt in [0.007, 1. / 60., 0.021, 0.1] {
                            let (mut w, actor, _, _, _) = fixture(gap, z, compound);
                            w.refresh_queries();
                            let c = &w.backend.colliders
                                [super::colliders::native_collider(w.characters[&actor].collider)];
                            let q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
                                exclude_rigid_body: Some(super::world::native_id(actor)),
                                ..Default::default()
                            });
                            let cfg = &w.characters[&actor].config;
                            let mut desired = rp::Vector::new(0., -0.09892499, 0.);
                            desired[axis] = sign * 0.5 * dt;
                            let mut records = vec![];
                            let mut dropped = 0;
                            let (m, t) = super::character_query::move_with_clearance(
                                &w.backend,
                                &q,
                                &cfg.controller(),
                                cfg,
                                1.,
                                c.shape(),
                                c.position(),
                                desired,
                                false,
                                &mut records,
                                &mut dropped,
                            );
                            let rows = records
                                .iter()
                                .map(|h| {
                                    (
                                        h.handle.into_raw_parts(),
                                        h.character_pos.translation,
                                        h.character_pos.rotation.to_array(),
                                        h.translation_applied,
                                        h.translation_remaining,
                                        h.hit.time_of_impact,
                                        h.hit.witness1,
                                        h.hit.witness2,
                                        h.hit.normal1,
                                        h.hit.normal2,
                                        h.hit.status as u8,
                                        h.hit.subshape1,
                                        h.hit.subshape2,
                                    )
                                })
                                .collect::<Vec<_>>();
                            let bytes = postcard::to_allocvec(&(
                                t,
                                m.grounded,
                                m.is_sliding_down_slope,
                                rows,
                                dropped,
                            ))
                            .unwrap();
                            if gap == 0.02 {
                                let hash =
                                    bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| {
                                        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
                                    });
                                assert_eq!(
                                    hash, FULL_MARGIN_QUERY_GOLDEN[golden_index],
                                    "original full-margin query fields/order changed"
                                );
                                golden_index += 1;
                            }
                            let hex = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
                            println!("QUERY_BYTES compound={compound} z={z} gap={gap} axis={axis} sign={sign} dt={dt} {hex}");
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn physical_double_touch_room_preserves_both_tangent_axes() {
    for compound in [false, true] {
        for axis in [0, 2] {
            for sign in [-1., 1.] {
                let (mut w, actor, floor, ceiling, _) = fixture(0., 0., compound);
                w.set_pose(actor, pose([-10., 0.5, 0.])).unwrap();
                if compound {
                    let c = w.collider_ids(floor).unwrap().next().unwrap();
                    w.update_collider(
                        c,
                        ColliderDesc::new(Shape::Compound {
                            parts: vec![
                                ShapePart {
                                    pose: pose([0., -0.1, 0.]),
                                    shape: Shape::Box {
                                        half_extents: [20., 0.1, 20.],
                                    },
                                },
                                ShapePart {
                                    pose: pose([-10., 1.1, 0.]),
                                    shape: Shape::Box {
                                        half_extents: [1., 0.1, 1.],
                                    },
                                },
                            ],
                        }),
                    )
                    .unwrap();
                } else {
                    w.set_pose(ceiling, pose([-10., 1.1, 0.])).unwrap();
                }
                w.refresh_queries();
                let start = w.body_state(actor).unwrap().pose;
                let mut desired = [0.; 3];
                desired[axis] = sign * 0.03;
                let _ = super::character_query::clearance_work::take();
                let result = w
                    .probe_character_motion(
                        actor,
                        start,
                        desired,
                        true,
                        &mut super::character_query::CharacterProbeScratch::default(),
                    )
                    .unwrap();
                println!(
                    "DOUBLE_WORK {:?}",
                    super::character_query::clearance_work::take()
                );
                println!(
                    "DOUBLE_TOUCH compound={compound} axis={axis} sign={sign} p={:?}",
                    result.pose.position
                );
                assert!(
                    (result.pose.position[axis] - start.position[axis] - desired[axis]).abs() < EPS
                );
                assert!((result.pose.position[1] - 0.5).abs() < EPS);
            }
        }
    }
}

#[test]
fn tight_same_compound_wall_blocks_both_axes_and_directions() {
    for axis in [0, 2] {
        for sign in [-1., 1.] {
            let (mut w, actor, floor, _, roof) = fixture(0.0003, 0., true);
            let mut center = [-10., 0.5, 0.];
            center[axis] += sign * 0.30;
            let mut half = [1., 0.5, 1.];
            half[axis] = 0.02;
            let c = w.collider_ids(floor).unwrap().next().unwrap();
            w.update_collider(
                c,
                ColliderDesc::new(Shape::Compound {
                    parts: vec![
                        ShapePart {
                            pose: pose([0., -0.1, 0.]),
                            shape: Shape::Box {
                                half_extents: [20., 0.1, 20.],
                            },
                        },
                        ShapePart {
                            pose: pose([-10., roof + 0.1, 0.]),
                            shape: Shape::Box {
                                half_extents: [1., 0.1, 1.],
                            },
                        },
                        ShapePart {
                            pose: pose(center),
                            shape: Shape::Box { half_extents: half },
                        },
                    ],
                }),
            )
            .unwrap();
            let start = w.body_state(actor).unwrap().pose;
            let mut desired = [0.; 3];
            desired[axis] = sign * 0.1;
            let result = w
                .probe_character_motion(
                    actor,
                    start,
                    desired,
                    true,
                    &mut super::character_query::CharacterProbeScratch::default(),
                )
                .unwrap();
            let delta = (result.pose.position[axis] - start.position[axis]) * sign;
            println!(
                "COMPOUND_WALL axis={axis} sign={sign} delta={delta} p={:?}",
                result.pose.position
            );
            assert!(delta > 0.029 && delta <= 0.030002, "{result:?}");
            assert!(fits(result.pose.position, roof));
            assert!((result.pose.position[1] - start.position[1]).abs() < EPS);
        }
    }
}

#[test]
fn tight_rotated_floor_ceiling_and_oblique_gravity_keep_real_shape_fit() {
    use rapier3d::prelude as rp;
    let rotation = rp::Rotation::from_rotation_z(0.61) * rp::Rotation::from_rotation_x(0.3);
    let up = rotation * rp::Vector::Y;
    let side = rotation * rp::Vector::Z;
    for gap in [0., 0.0003] {
        for dt in [0.007, 0.013, 1. / 60., 0.021, 0.05, 0.1] {
            let mut w = PhysicsWorld3d::new(WorldConfig {
                gravity: (-up * 9.81).to_array(),
                ..WorldConfig::default()
            })
            .unwrap();
            let transform = |p: [f32; 3]| Pose {
                position: (rotation * rp::Vector::from(p)).to_array(),
                rotation: rotation.to_array(),
            };
            for (center, half) in [
                ([0., -0.1, 0.], [20., 0.1, 20.]),
                ([0., Y + 0.6 + gap, 0.], [4., 0.1, 4.]),
            ] {
                w.create_body(
                    BodyDesc {
                        kind: BodyKind::Fixed,
                        pose: transform(center),
                        ..BodyDesc::default()
                    },
                    ColliderDesc::new(Shape::Box { half_extents: half }),
                )
                .unwrap();
            }
            let actor = w
                .create_body(
                    BodyDesc {
                        kind: BodyKind::KinematicPosition,
                        pose: transform([0., Y, 0.]),
                        ..BodyDesc::default()
                    },
                    ColliderDesc::new(Shape::Capsule {
                        half_height: 0.25,
                        radius: 0.25,
                    }),
                )
                .unwrap();
            w.enable_character(
                actor,
                CharacterConfig {
                    up: up.to_array(),
                    step_height: 0.,
                    snap_distance: 0.,
                    ..CharacterConfig::default()
                },
            )
            .unwrap();
            w.step();
            let start = rp::Vector::from(w.body_state(actor).unwrap().pose.position);
            let mut expected = 0.;
            let saved = w.capture_snapshot().unwrap();
            let mut replay = PhysicsWorld3d::from_snapshot(&saved).unwrap();
            for tick in 0..1200 {
                let sign = if (tick / 20) % 2 == 0 { 1. } else { -1. };
                expected += sign * 0.5 * dt;
                let before_state = w.character_state(actor).unwrap().clone();
                let _ = super::character_query::clearance_work::take();
                let input = CharacterInput {
                    velocity: (side * (sign * 0.5)).to_array(),
                    ..CharacterInput::default()
                };
                w.set_character_input(actor, input.clone()).unwrap();
                replay.set_character_input(actor, input).unwrap();
                interval(&mut w, dt);
                interval(&mut replay, dt);
                assert_eq!(
                    w.body_state(actor).unwrap(),
                    replay.body_state(actor).unwrap()
                );
                if tick % 120 == 0 {
                    assert!(
                        w.capture_snapshot().unwrap().encoded_bytes()
                            == replay.capture_snapshot().unwrap().encoded_bytes(),
                        "oblique checkpoint replay diverged"
                    );
                }
                let p = rp::Vector::from(w.body_state(actor).unwrap().pose.position);
                let local = rotation.inverse() * p;
                assert!(
                    local.y - 0.5 >= -EPS && local.y + 0.5 <= Y + 0.5 + gap + EPS,
                    "gap={gap} dt={dt} tick={tick} local={local:?}"
                );
                assert!((p-start).dot(up).abs()<4e-6,"vertical drift gap={gap} dt={dt} tick={tick}: p={p:?} upshift={} start={start:?} before_state={before_state:?} after_state={:?} work={:?}",(p-start).dot(up),w.character_state(actor).unwrap(),super::character_query::clearance_work::take());
                assert!(
                    ((p - start).dot(side) - expected).abs() < 5e-5,
                    "lost tangent tick={tick}: {p:?}"
                );
            }
            w.set_character_input(
                actor,
                CharacterInput {
                    velocity: (side * 0.5).to_array(),
                    jump_speed: 4.,
                },
            )
            .unwrap();
            interval(&mut w, dt);
            let local =
                rotation.inverse() * rp::Vector::from(w.body_state(actor).unwrap().pose.position);
            assert!(
                local.y - 0.5 >= -EPS && local.y + 0.5 <= Y + 0.5 + gap + EPS,
                "rotated jump gap={gap} dt={dt} local={local:?}"
            );
            let consumed = w.capture_snapshot().unwrap();
            w.set_character_input(
                actor,
                CharacterInput {
                    velocity: (side * 0.5).to_array(),
                    jump_speed: 0.,
                },
            )
            .unwrap();
            assert!(consumed.encoded_bytes() == w.capture_snapshot().unwrap().encoded_bytes());
        }
    }
}

#[test]
fn tight_continuous_path_rejects_wall_even_when_both_endpoints_fit() {
    for axis in [0, 2] {
        for sign in [-1., 1.] {
            let (mut w, actor, _, _, roof) = fixture(0.0003, 0., false);
            let mut center = [-10., 0.5, 0.];
            center[axis] += sign * 0.6;
            let mut half = [1., 0.5, 1.];
            half[axis] = 0.02;
            w.create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: pose(center),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box { half_extents: half }),
            )
            .unwrap();
            let start = w.body_state(actor).unwrap().pose;
            let mut desired = [0.; 3];
            desired[axis] = sign * 1.2;
            // Both endpoints are separated, by OPPOSITE wall faces. A single-plane
            // continuous certificate must fail because the actual middle crosses it.
            let distance = (center[axis] - start.position[axis]) * sign;
            assert!(
                distance - 0.25 > half[axis] && desired[axis] * sign - distance - 0.25 > half[axis]
            );
            let result = w
                .probe_character_motion(
                    actor,
                    start,
                    desired,
                    true,
                    &mut super::character_query::CharacterProbeScratch::default(),
                )
                .unwrap();
            let delta = (result.pose.position[axis] - start.position[axis]) * sign;
            assert!(
                delta > 0.329 && delta <= 0.330002,
                "continuous path must hit wall: {result:?}"
            );
            assert!(fits(result.pose.position, roof));
        }
    }
}

#[test]
fn tight_one_way_support_above_and_filtered_passage_below() {
    for compound in [false, true] {
        let (mut w, actor, floor, _, roof) = fixture(0.0003, 0., compound);
        let collider = w.collider_ids(floor).unwrap().next().unwrap();
        w.set_terrain_one_way(
            collider,
            Some(TerrainOneWay {
                point: if compound {
                    [0., 0., 0.]
                } else {
                    [0., 0.1, 0.]
                },
                normal: [0., 1., 0.],
            }),
        )
        .unwrap();
        let mut scratch = super::character_query::CharacterProbeScratch::default();
        let start = w.body_state(actor).unwrap().pose;
        let above = w
            .probe_character_motion(actor, start, [0., 0., 0.03], true, &mut scratch)
            .unwrap();
        assert!((above.pose.position[2] - 0.03).abs() < EPS && fits(above.pose.position, roof));
        assert!(above.grounded);
        let below = pose([-10., -0.8, 0.]);
        let pass = w
            .probe_character_motion(actor, below, [0., 0.4, 0.03], false, &mut scratch)
            .unwrap();
        assert!(
            (pass.pose.position[1] + 0.4).abs() < EPS && (pass.pose.position[2] - 0.03).abs() < EPS
        );
        assert!(
            !pass.grounded,
            "one-way below must not gain support: {pass:?}"
        );
    }
}

#[test]
fn tight_physical_checks_preserve_sensor_and_pair_masks() {
    for masked in [false, true] {
        let (mut w, actor, _, ceiling, _) = fixture(-0.0003, 0., false);
        let c = w.collider_ids(ceiling).unwrap().next().unwrap();
        let mut desc = ColliderDesc::new(Shape::Box {
            half_extents: [1., 0.1, 1.],
        });
        if masked {
            desc.mask = 0;
        } else {
            desc.sensor = true;
        }
        w.update_collider(c, desc).unwrap();
        let start = w.body_state(actor).unwrap().pose;
        let result = w
            .probe_character_motion(
                actor,
                start,
                [0., 0., 0.03],
                true,
                &mut super::character_query::CharacterProbeScratch::default(),
            )
            .unwrap();
        assert!(
            (result.pose.position[2] - 0.03).abs() < EPS,
            "filtered roof must not obstruct: {result:?}"
        );
    }
}

#[test]
fn tight_jump_pending_input_consumes_once_and_cannot_enter_ceiling() {
    for gap in [0., 0.0003] {
        for dt in [0.007, 1. / 60., 0.021] {
            let (mut w, actor, _, _, roof) = fixture(gap, 0., false);
            w.step();
            w.set_character_input(
                actor,
                CharacterInput {
                    velocity: [0., 0., 0.5],
                    jump_speed: 4.,
                },
            )
            .unwrap();
            let before = w.capture_snapshot().unwrap();
            let p = w.body_state(actor).unwrap().pose;
            let mut scratch = super::character_query::CharacterProbeScratch::default();
            for _ in 0..3 {
                w.probe_character_motion(actor, p, [0., 0., 0.03], true, &mut scratch)
                    .unwrap();
            }
            assert_eq!(
                before.encoded_bytes(),
                w.capture_snapshot().unwrap().encoded_bytes()
            );
            interval(&mut w, dt);
            let position = w.body_state(actor).unwrap().pose.position;
            assert!(fits(position, roof), "gap={gap} dt={dt} p={position:?}");
            let consumed = w.capture_snapshot().unwrap();
            w.set_character_input(
                actor,
                CharacterInput {
                    velocity: [0., 0., 0.5],
                    jump_speed: 0.,
                },
            )
            .unwrap();
            assert_eq!(
                consumed.encoded_bytes(),
                w.capture_snapshot().unwrap().encoded_bytes(),
                "jump was consumed exactly once"
            );
            interval(&mut w, dt);
            assert!(fits(w.body_state(actor).unwrap().pose.position, roof));
        }
    }
}

#[test]
fn tight_dynamic_push_and_preview_replay_do_not_duplicate_momentum() {
    for dt in [0.007, 1. / 60., 0.021] {
        let (mut w, actor, _, _, roof) = fixture(0.0003, 0., false);
        let first = w.step_checked();
        assert!(first.is_ok(), "{first:?}");
        let pushed = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::Dynamic,
                    pose: pose([-10., 0.3, 0.36]),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.08, 0.3, 0.08],
                }),
            )
            .unwrap();
        w.apply_character_impulse(actor, [0., 0., 5.]).unwrap();
        w.refresh_queries();
        let saved = w.capture_snapshot().unwrap();
        let mut replay = PhysicsWorld3d::from_snapshot(&saved).unwrap();
        let p = w.body_state(actor).unwrap().pose;
        let mut scratch = super::character_query::CharacterProbeScratch::default();
        for _ in 0..3 {
            w.probe_character_motion(actor, p, [0., 0., 0.05], true, &mut scratch)
                .unwrap();
        }
        assert_eq!(
            saved.encoded_bytes(),
            w.capture_snapshot().unwrap().encoded_bytes()
        );
        for _ in 0..30 {
            for current in [&mut w, &mut replay] {
                assert!(current.begin_interval(dt, true).unwrap());
                let result = current.step_checked();
                current.end_interval();
                assert!(result.is_ok(), "{result:?}");
            }
        }
        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            replay.capture_snapshot().unwrap().encoded_bytes()
        );
        assert!(fits(w.body_state(actor).unwrap().pose.position, roof));
        let native = &w.backend.bodies[super::world::native_id(pushed)];
        let momentum =
            native.mass() * native.linvel().z + 10. * w.characters[&actor].external_velocity[2];
        println!(
            "TIGHT_DYNAMIC dt={dt} pushed={:?} total_z_momentum={momentum}",
            w.body_state(pushed).unwrap()
        );
        assert!(w.body_state(pushed).unwrap().pose.position[2] > 0.36);
        assert!(
            momentum > 0. && momentum <= 5.001,
            "one impulse cannot be integrated twice: {momentum}"
        );
        assert_eq!(w.characters[&actor].pending_impulse, [0.; 3]);
    }
}

#[test]
fn tight_support_certificate_selects_nearest_real_face_and_rejects_moving_floor() {
    use rapier3d::prelude as rp;
    for compound in [false, true] {
        let (mut w, actor, floor, _, _) = fixture(0.0003, 0., compound);
        let closer = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: pose([0., 0.004, 0.]),
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [20., 0.001, 20.],
                }),
            )
            .unwrap();
        w.refresh_queries();
        let c =
            &w.backend.colliders[super::colliders::native_collider(w.characters[&actor].collider)];
        let q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
            exclude_rigid_body: Some(super::world::native_id(actor)),
            ..Default::default()
        });
        let actual = super::character_query::certified_tight_ground(
            &w.backend,
            &q,
            c.shape(),
            c.position(),
            &w.characters[&actor].config,
        )
        .unwrap();
        let expected =
            super::colliders::native_collider(w.collider_ids(closer).unwrap().next().unwrap());
        assert_eq!(actual, expected);
        w.remove_body(closer).unwrap();
        w.set_kinematic_target(floor, pose([0., 0.001, 0.]))
            .unwrap();
        w.refresh_queries();
        let c =
            &w.backend.colliders[super::colliders::native_collider(w.characters[&actor].collider)];
        let q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
            exclude_rigid_body: Some(super::world::native_id(actor)),
            ..Default::default()
        });
        assert!(super::character_query::certified_tight_ground(
            &w.backend,
            &q,
            c.shape(),
            c.position(),
            &w.characters[&actor].config
        )
        .is_none());
    }
}

mod tight_work {
    use super::*;
    use rapier3d::{parry::query::*, prelude as rp};
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[derive(Default)]
    struct CountingDispatcher {
        casts: AtomicUsize,
        contacts: AtomicUsize,
        fail_sphere: bool,
        miss_down: bool,
    }
    impl QueryDispatcher for CountingDispatcher {
        fn intersection_test(
            &self,
            p: &rp::Pose,
            a: &dyn rp::Shape,
            b: &dyn rp::Shape,
        ) -> Result<ShapeIntersection, Unsupported> {
            DefaultQueryDispatcher.intersection_test(p, a, b)
        }
        fn distance(
            &self,
            p: &rp::Pose,
            a: &dyn rp::Shape,
            b: &dyn rp::Shape,
        ) -> Result<ShapeDistance, Unsupported> {
            DefaultQueryDispatcher.distance(p, a, b)
        }
        fn contact(
            &self,
            p: &rp::Pose,
            a: &dyn rp::Shape,
            b: &dyn rp::Shape,
            prediction: f32,
        ) -> Result<Option<Contact>, Unsupported> {
            self.contacts.fetch_add(1, Ordering::Relaxed);
            if self.fail_sphere && a.as_ball().is_some() {
                return Err(Unsupported);
            }
            DefaultQueryDispatcher.contact(p, a, b, prediction)
        }
        fn closest_points(
            &self,
            p: &rp::Pose,
            a: &dyn rp::Shape,
            b: &dyn rp::Shape,
            max: f32,
        ) -> Result<ClosestPoints, Unsupported> {
            DefaultQueryDispatcher.closest_points(p, a, b, max)
        }
        fn cast_shapes(
            &self,
            p: &rp::Pose,
            v: rp::Vector,
            a: &dyn rp::Shape,
            b: &dyn rp::Shape,
            options: ShapeCastOptions,
        ) -> Result<Option<ShapeCastHit>, Unsupported> {
            self.casts.fetch_add(1, Ordering::Relaxed);
            if self.miss_down && v.dot(p.rotation * (-rp::Vector::Y)) > 0.9999 {
                return Ok(None);
            }
            DefaultQueryDispatcher.cast_shapes(p, v, a, b, options)
        }
        fn cast_shapes_nonlinear(
            &self,
            m1: &NonlinearRigidMotion,
            a: &dyn rp::Shape,
            m2: &NonlinearRigidMotion,
            b: &dyn rp::Shape,
            start: f32,
            end: f32,
            stop: bool,
        ) -> Result<Option<ShapeCastHit>, Unsupported> {
            DefaultQueryDispatcher.cast_shapes_nonlinear(m1, a, m2, b, start, end, stop)
        }
    }

    #[test]
    fn tight_cast_scan_leaf_work_bounds_and_contact_world_positions() {
        for stairs in [false, true] {
            for compound in [false, true] {
                for wall in [false, true] {
                    let (mut w, actor, _, _, _) = fixture(0.0003, 0., compound);
                    if wall {
                        w.create_body(
                            BodyDesc {
                                kind: BodyKind::Fixed,
                                pose: pose([-10., 0.5, 0.30]),
                                ..BodyDesc::default()
                            },
                            ColliderDesc::new(Shape::Box {
                                half_extents: [1., 0.5, 0.02],
                            }),
                        )
                        .unwrap();
                    }
                    w.refresh_queries();
                    let before = w.capture_snapshot().unwrap();
                    let collider = &w.backend.colliders
                        [super::super::colliders::native_collider(w.characters[&actor].collider)];
                    let dispatcher = CountingDispatcher::default();
                    let mut q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
                        exclude_rigid_body: Some(super::super::world::native_id(actor)),
                        ..Default::default()
                    });
                    q.dispatcher = &dispatcher;
                    let mut config = w.characters[&actor].config.clone();
                    if stairs {
                        config.step_height = 0.3;
                        config.snap_distance = 0.1;
                    }
                    let desired = rp::Vector::new(0., -0.09892499, 0.1);
                    let mut hits = vec![];
                    let mut dropped = 0;
                    let _ = super::super::character_query::clearance_work::take();
                    let (_, translation) = super::super::character_query::move_with_clearance(
                        &w.backend,
                        &q,
                        &config.controller(),
                        &config,
                        1.,
                        collider.shape(),
                        collider.position(),
                        desired,
                        false,
                        &mut hits,
                        &mut dropped,
                    );
                    let work = super::super::character_query::clearance_work::take();
                    let candidates = if compound { 1 } else { 2 } + usize::from(wall);
                    let bound = if stairs { 206 } else { 44 };
                    let casts = dispatcher.casts.load(Ordering::Relaxed);
                    assert!(
                        work.kcc <= 2
                            && work.scans <= 10
                            && work.support_scans <= 3
                            && work.continuous_scans <= 3,
                        "{work:?}"
                    );
                    assert!(work.scans + work.support_scans + work.continuous_scans <= 16);
                    assert!(
                        casts <= bound * candidates,
                        "casts={casts} bound={bound} N={candidates}"
                    );
                    assert!(
                        work.colliders <= 16 * candidates
                            && work.leaves <= 16 * (2 + usize::from(wall)),
                        "{work:?}"
                    );
                    assert!(work.margin > 0. && work.margin <= config.skin_width);
                    assert!(
                        work.accepted_restore >= 0.
                            && work.accepted_restore <= work.placement.length()
                    );
                    assert!(
                        std::mem::size_of::<[Option<rapier3d::control::CharacterCollision>; 32]>()
                            <= 8192
                    );
                    for (start, axis, max, toi) in &work.sweeps {
                        assert!(
                            start.is_finite() && axis.is_finite() && *toi >= 0. && *toi <= *max
                        );
                    }
                    assert!(hits.len() <= 32);
                    assert_eq!(dropped, 0);
                    for hit in &hits {
                        assert!(
                            (hit.character_pos.translation
                                - collider.position().translation
                                - hit.translation_applied)
                                .length()
                                < 2e-6,
                            "{hit:?}"
                        );
                        assert!(
                            hit.hit.time_of_impact >= 0.
                                && hit.hit.time_of_impact <= desired.length()
                        );
                    }
                    if wall {
                        assert!(translation.z <= 0.030002 && translation.z > 0.029);
                    } else {
                        assert!((translation.z - 0.1).abs() < EPS);
                    }
                    assert!(
                        before.encoded_bytes() == w.capture_snapshot().unwrap().encoded_bytes()
                    );
                    println!("TIGHT_WORK stairs={stairs} compound={compound} wall={wall} casts={casts} N={candidates} translation={translation:?} work={work:?}");
                }
            }
        }
    }
    #[test]
    fn failed_final_geometry_query_rolls_back_suffix_and_keeps_primary_records() {
        let (mut w, actor, _, _, _) = fixture(0.0003, 0., false);
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: pose([-9.65, 0.5, 0.4]),
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
        )
        .unwrap();
        w.apply_character_impulse(actor, [0., 0., 5.]).unwrap();
        w.add_character_force(actor, [0., 0., 3.]).unwrap();
        w.refresh_queries();
        let before = w.capture_snapshot().unwrap();
        let collider = &w.backend.colliders
            [super::super::colliders::native_collider(w.characters[&actor].collider)];
        let dispatcher = CountingDispatcher {
            fail_sphere: true,
            ..Default::default()
        };
        let mut q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
            exclude_rigid_body: Some(super::super::world::native_id(actor)),
            ..Default::default()
        });
        q.dispatcher = &dispatcher;
        let config = &w.characters[&actor].config;
        let desired = rp::Vector::new(0., -0.09892499, 0.2);
        let mut primary = vec![];
        config.controller().move_shape(
            0.,
            &q,
            collider.shape(),
            collider.position(),
            desired,
            |hit| primary.push(hit),
        );
        let prefix = primary.first().unwrap().translation_applied;
        let mut hits = vec![];
        let mut dropped = 0;
        let _ = super::super::character_query::clearance_work::take();
        let (_, translation) = super::super::character_query::move_with_clearance(
            &w.backend,
            &q,
            &config.controller(),
            config,
            1.,
            collider.shape(),
            collider.position(),
            desired,
            false,
            &mut hits,
            &mut dropped,
        );
        let work = super::super::character_query::clearance_work::take();
        assert_eq!(
            work.kcc, 2,
            "the rejected candidate must actually run: {work:?}"
        );
        assert!(work.contacts > 0);
        assert_eq!(translation, prefix);
        assert_eq!(format!("{hits:?}"), format!("{primary:?}"));
        assert_eq!(dropped, 0);
        assert!(before.encoded_bytes() == w.capture_snapshot().unwrap().encoded_bytes());
        println!("TIGHT_ROLLBACK work={work:?} prefix={prefix:?}");
    }
    #[test]
    fn tiny_capsule_down_shim_rejects_thin_finite_edge_between_safe_endpoints() {
        let radius = 0.001f32;
        let half_height = 1e-9f32;
        let skin = 0.00049f32;
        let distance = skin * 0.1;
        let shift = distance * 0.5;
        let half = rp::Vector::splat(0.0001);
        let rotation = rp::Rotation::from_rotation_z(std::f32::consts::FRAC_PI_4);
        let edge_pose = Pose {
            position: [
                radius - 4e-8 + std::f32::consts::SQRT_2 * half.x,
                -shift * 0.5,
                0.,
            ],
            rotation: rotation.to_array(),
        };
        // Exact point-to-OBB distance brackets the entire very short axis:
        // d(center,box)-half_height-radius <= d(capsule,box) <= d(center,box)-radius.
        let signed_bounds = |y: f32| {
            let local = super::super::world::native_pose(edge_pose)
                .inverse_transform_point(rp::Vector::new(0., y, 0.));
            let nearest = local.clamp(-half, half);
            let delta = local - nearest;
            let d =
                ((delta.x as f64).powi(2) + (delta.y as f64).powi(2) + (delta.z as f64).powi(2))
                    .sqrt();
            (
                d - f64::from(half_height) - f64::from(radius),
                d - f64::from(radius),
            )
        };
        let start = signed_bounds(0.);
        let end = signed_bounds(-shift);
        let middle = signed_bounds(-shift * 0.5);
        assert!(
            start.0 > 0. && end.0 > 0. && middle.1 < 0.,
            "start={start:?} end={end:?} middle={middle:?}"
        );
        let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
        for (position, extents, rot) in [
            (
                [0., -radius - half_height - 0.0002, 0.],
                [0.01, 0.0001, 0.01],
                [0., 0., 0., 1.],
            ),
            (
                [0., radius + half_height + 0.0001, 0.],
                [0.01, 0.0001, 0.01],
                [0., 0., 0., 1.],
            ),
            (edge_pose.position, half.to_array(), edge_pose.rotation),
        ] {
            w.create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position,
                        rotation: rot,
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: extents,
                }),
            )
            .unwrap();
        }
        let actor = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height,
                    radius,
                }),
            )
            .unwrap();
        w.enable_character(
            actor,
            CharacterConfig {
                skin_width: skin,
                step_height: 0.,
                snap_distance: 0.,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
        w.refresh_queries();
        let collider = &w.backend.colliders
            [super::super::colliders::native_collider(w.characters[&actor].collider)];
        let dispatcher = CountingDispatcher {
            miss_down: true,
            ..Default::default()
        };
        let mut q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
            exclude_rigid_body: Some(super::super::world::native_id(actor)),
            ..Default::default()
        });
        q.dispatcher = &dispatcher;
        let epsilon = (1e-6f32).min(skin * 0.001);
        assert!(!super::super::character_query::clearance_work::certifies(
            &w.backend,
            &q,
            collider.shape(),
            collider.position(),
            -rp::Vector::Y * shift,
            epsilon
        ));
        let _ = super::super::character_query::clearance_work::take();
        let mut hits = vec![];
        let mut dropped = 0;
        let config = &w.characters[&actor].config;
        let (_, translation) = super::super::character_query::move_with_clearance(
            &w.backend,
            &q,
            &config.controller(),
            config,
            1.,
            collider.shape(),
            collider.position(),
            rp::Vector::Z * 0.0001,
            true,
            &mut hits,
            &mut dropped,
        );
        let work = super::super::character_query::clearance_work::take();
        assert!(
            work.down_proof_attempted && !work.down_certified,
            "{work:?}"
        );
        assert_eq!(
            work.placement,
            rp::Vector::ZERO,
            "an unchecked down shim cannot cross the edge"
        );
        assert!(translation.y.abs() <= epsilon, "{translation:?}");
        println!("TINY_DOWN_CERT start={start:?} end={end:?} middle={middle:?} epsilon={epsilon} translation={translation:?} work={work:?}");
    }
}

#[test]
fn cold_query_cache_refresh_preserves_body_target_force_and_input_fields() {
    let (mut w, actor, floor, _, _) = fixture(0.0003, 0., false);
    w.step();
    w.create_body(
        BodyDesc {
            kind: BodyKind::Dynamic,
            pose: pose([-10., 0.3, 0.36]),
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.08, 0.3, 0.08],
        }),
    )
    .unwrap();
    w.set_kinematic_target(floor, pose([0., -0.099, 0.]))
        .unwrap();
    w.set_character_input(
        actor,
        CharacterInput {
            velocity: [0., 0., 0.5],
            jump_speed: 4.,
        },
    )
    .unwrap();
    w.apply_character_impulse(actor, [0., 0., 5.]).unwrap();
    w.add_character_force(actor, [0., 0., 3.]).unwrap();
    let simulation_before = postcard::to_allocvec(&(
        &w.characters,
        &w.backend.bodies,
        &w.backend.integration_parameters,
        w.backend.gravity,
    ))
    .unwrap();
    let broad_before = postcard::to_allocvec(&w.backend.broad_phase).unwrap();
    let dirty = w.query_updates.len();
    assert!(dirty > 0);
    let before = w.capture_snapshot().unwrap();
    let start = w.body_state(actor).unwrap().pose;
    let mut scratch = super::character_query::CharacterProbeScratch::default();
    w.probe_character_motion(actor, start, [0., 0., 0.05], true, &mut scratch)
        .unwrap();
    let after = w.capture_snapshot().unwrap();
    let simulation_after = postcard::to_allocvec(&(
        &w.characters,
        &w.backend.bodies,
        &w.backend.integration_parameters,
        w.backend.gravity,
    ))
    .unwrap();
    let broad_after = postcard::to_allocvec(&w.backend.broad_phase).unwrap();
    assert_eq!(
        simulation_before, simulation_after,
        "refresh cannot consume body state, target, force, impulse or input"
    );
    assert!(
        before.encoded_bytes() != after.encoded_bytes(),
        "dirty cache control must actually change"
    );
    assert_ne!(broad_before, broad_after);
    assert!(w.query_updates.is_empty());
    for _ in 0..3 {
        w.probe_character_motion(actor, start, [0., 0., 0.05], true, &mut scratch)
            .unwrap();
    }
    assert!(
        after.encoded_bytes() == w.capture_snapshot().unwrap().encoded_bytes(),
        "warm cache queries must be byte-exact"
    );
    println!("COLD_CACHE_CONTROL dirty_before={dirty} dirty_after={} snapshot_changed={} broad_changed={} simulation_command_body_fields_equal={} warm_bytes_equal={}",w.query_updates.len(),before.encoded_bytes()!=after.encoded_bytes(),broad_before!=broad_after,simulation_before==simulation_after,after.encoded_bytes()==w.capture_snapshot().unwrap().encoded_bytes());
}

#[test]
fn tight_original_snap_applies_once_after_restoring_numerical_placement() {
    use rapier3d::{parry::query::ShapeCastOptions, prelude as rp};
    for snap in [0., 0.1] {
        let (mut w, actor, _, ceiling, _) = fixture(0.0003, 0., false);
        let start = pose([-10., 0.515, 0.]);
        w.set_pose(actor, start).unwrap();
        w.set_pose(ceiling, pose([-10., 1.1153, 0.])).unwrap();
        w.characters.get_mut(&actor).unwrap().config.snap_distance = snap;
        w.refresh_queries();
        let native_snap = |w: &PhysicsWorld3d, position: Pose| {
            if snap == 0. {
                return 0.;
            }
            let collider = &w.backend.colliders
                [super::colliders::native_collider(w.characters[&actor].collider)];
            let q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
                exclude_rigid_body: Some(super::world::native_id(actor)),
                ..Default::default()
            });
            let end = rp::Pose::translation(
                position.position[0],
                position.position[1],
                position.position[2] + 0.03,
            );
            q.cast_shape(
                &end,
                -rp::Vector::Y,
                collider.shape(),
                ShapeCastOptions {
                    max_time_of_impact: snap,
                    target_distance: 0.01,
                    stop_at_penetration: false,
                    compute_impact_geometry_on_penetration: true,
                },
            )
            .map_or(0., |(_, hit)| hit.time_of_impact)
        };
        let first_toi = native_snap(&w, start);
        let expected = start.position[1] - first_toi;
        let before = w.capture_snapshot().unwrap();
        let mut scratch = super::character_query::CharacterProbeScratch::default();
        let result = w
            .probe_character_motion(actor, start, [0., 0., 0.03], true, &mut scratch)
            .unwrap();
        assert!((result.pose.position[1]-expected).abs()<1e-7,"native snap must apply exactly once: snap={snap} native_toi={first_toi} result={result:?}");
        assert!((result.pose.position[2] - 0.03).abs() < EPS);
        assert!(before.encoded_bytes() == w.capture_snapshot().unwrap().encoded_bytes());
        let second_toi = native_snap(&w, result.pose);
        let again = w
            .probe_character_motion(actor, result.pose, [0., 0., 0.03], true, &mut scratch)
            .unwrap();
        assert!(
            (again.pose.position[1] - (expected - second_toi)).abs() < 1e-7,
            "original native snap cannot be integrated twice: {again:?}"
        );
        assert!(result.pose.position[1] >= 0.5 && again.pose.position[1] >= 0.5);
        if snap > 0. {
            assert!((first_toi - 0.005).abs() < 1e-5);
            assert!(second_toi.is_finite() && second_toi >= 0. && second_toi < snap);
        }
        println!("TIGHT_SNAP snap={snap} native_first_toi={first_toi} native_second_toi={second_toi} first_y={} second_y={} analytic_skin_target_error={}",result.pose.position[1],again.pose.position[1],if snap>0. {result.pose.position[1]-0.51}else{0.});
    }
}

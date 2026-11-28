//! Product rigid-body regressions and the optional soft CCD measurements.
use super::*;
use crate::collision_event::{COLLISION_EVENT_ENTER, COLLISION_EVENT_TRIGGER_ENTER};
use crate::components::{
    DistanceJoint, GearJoint, PrismaticJoint, RevoluteJoint, RopeJoint, SpringJoint, Transform2D,
    WeldJoint,
};
use crate::physics3d::p1b_tests::TraceHash;
use crate::physics3d::{BodyDesc, BodyId, BodyKind, ColliderDesc, PhysicsWorld3d, Pose, Shape};
use std::collections::BTreeSet;
use std::time::Instant;

const FRAMES: usize = 300;
const BRICK_HALF_EXTENTS: [f32; 2] = [26., 9.];

fn physics(e: &Engine) -> &PhysicsWorld3d {
    &e.unified_physics.as_ref().unwrap().physics
}

fn step_sample<T>(step: impl FnOnce() -> T) -> (T, f64) {
    let before = (!cfg!(debug_assertions)).then(Instant::now);
    let result = step();
    (
        result,
        before.map_or(0., |t| t.elapsed().as_secs_f64() * 1e6),
    )
}

// The fixed lower fence is 760 x 24, centered at (400, 454).
pub(super) fn past_sandbox_floor(e: &Engine, tracked: &[Entity]) -> bool {
    tracked.iter().any(|&id| {
        let p = e.world.transform(id).unwrap();
        (20. ..=780.).contains(&p.x) && p.y > 466.
    })
}

fn crosses_chain_downward(path: [Transform2D; 2], chain: &[[f32; 2]]) -> bool {
    let [before, after] = path;
    chain.windows(2).any(|segment| {
        let [[ax, ay], [bx, by]] = [segment[0], segment[1]];
        // The gallery chain is authored from left to right, with +y down.
        let side = |p: Transform2D| (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax);
        let start = side(before);
        let end = side(after);
        if start > 0. || end <= 0. {
            return false;
        }
        let x = before.x + (after.x - before.x) * (start / (start - end));
        (ax..=bx).contains(&x)
    })
}

fn gallery_chain(bodies: &[Body]) -> Vec<[f32; 2]> {
    let (position, vertices) = bodies
        .iter()
        .find_map(|body| match body.collider {
            Collider::Chain(vertices) => Some((body.position, vertices)),
            _ => None,
        })
        .expect("the collider gallery has an authored chain");
    vertices
        .chunks_exact(2)
        .map(|point| [point[0] + position[0], point[1] + position[1]])
        .collect()
}

pub(super) fn assert_gallery_advances_without_crossing_the_chain() {
    let bodies = collider_gallery();
    let chain = gallery_chain(&bodies);
    let (mut engine, entities) = sandbox_engine(&bodies, 640., [8, 6]);
    let dynamic: Vec<_> = bodies
        .iter()
        .zip(entities)
        .filter_map(|(body, entity)| body.dynamic.then_some(entity))
        .collect();
    for tick in 0..FRAMES {
        engine.update(1. / 60.);
        let before: Vec<_> = dynamic
            .iter()
            .map(|&id| engine.world.transform(id).unwrap())
            .collect();
        sandbox_step(&mut engine, 640., [8, 6]);
        assert_eq!(engine.take_unified_physics_error(), None, "tick {tick}");
        assert!(!past_sandbox_floor(&engine, &dynamic), "tick {tick}");
        for (&id, start) in dynamic.iter().zip(before) {
            let end = engine.world.transform(id).unwrap();
            assert!(
                !crosses_chain_downward([start, end], &chain),
                "tick {tick}: {id:?}"
            );
        }
    }
}

#[test]
fn p1a_probes_detect_crossings_near_chain_vertices() {
    let chain = gallery_chain(&collider_gallery());
    for x in [145., 230., 250., 365.] {
        let path = [Transform2D { x, y: 310. }, Transform2D { x, y: 412. }];
        assert!(crosses_chain_downward(path, &chain), "missed x={x}");
    }
    assert!(!crosses_chain_downward(
        [
            Transform2D { x: 110., y: 377. },
            Transform2D { x: 130., y: 392. }
        ],
        &chain,
    ));
}

#[test]
#[ignore = "P2a compares first-contact geometry and release step costs"]
fn p2a_compare_soft_ccd_at_first_contact() {
    let materials = rigid_materials();
    let contacts = contacts_sensors();
    let gallery = collider_gallery();
    for (name, bodies, gravity, iterations) in [
        ("rigid-materials", materials.as_slice(), 860., [8, 6]),
        ("contacts-sensors", contacts.as_slice(), 820., [8, 7]),
        ("collider-gallery", gallery.as_slice(), 640., [8, 6]),
    ] {
        for fraction in [0., 0.5] {
            let mut expected = None;
            for repeat in 0..2 {
                let (mut e, entities) = sandbox_engine(bodies, gravity, iterations);
                let ids: Vec<_> = entities
                    .iter()
                    .map(|&id| e.unified_body_id(id).unwrap())
                    .collect();
                e.unified_physics
                    .as_mut()
                    .unwrap()
                    .physics
                    .p2a_set_soft_ccd_fraction(fraction);
                let tracked: Vec<_> = bodies
                    .iter()
                    .zip(&entities)
                    .filter_map(|(body, &id)| body.dynamic.then_some(id))
                    .collect();
                let chain = (name == "collider-gallery").then(|| gallery_chain(bodies));
                let mut starts = BTreeSet::new();
                let mut active = BTreeSet::new();
                let mut first = (0_f32, 0, None);
                let mut peak = 0_f32;
                let mut episodes = 0;
                let mut sum = 0.;
                let mut max = 0_f64;
                let mut hash = TraceHash::new();
                for tick in 0..FRAMES {
                    e.update(1. / 60.);
                    let previous: Vec<_> = tracked
                        .iter()
                        .map(|&id| e.world.transform(id).unwrap())
                        .collect();
                    let (_, elapsed) = step_sample(|| sandbox_step(&mut e, gravity, iterations));
                    assert_eq!(
                        e.take_unified_physics_error(),
                        None,
                        "{name} {fraction} tick {tick}"
                    );
                    assert!(!past_sandbox_floor(&e, &tracked));
                    if let Some(chain) = &chain {
                        for (&id, before) in tracked.iter().zip(previous) {
                            assert!(
                                !crosses_chain_downward(
                                    [before, e.world.transform(id).unwrap()],
                                    chain
                                ),
                                "{name} {fraction} tick {tick}"
                            );
                        }
                    }
                    physics(&e).p1a_visit_overlaps(|sample| {
                        if !sample.solver_allowed {
                            return;
                        }
                        let pair = sample.bodies.map(|b| b.collider);
                        active.insert(pair);
                        peak = peak.max(sample.depth);
                        if !starts.contains(&pair) {
                            episodes += 1;
                            if sample.depth > first.0 {
                                first = (sample.depth, tick, Some(sample.bodies));
                            }
                        }
                    });
                    std::mem::swap(&mut starts, &mut active);
                    active.clear();
                    for &body in &ids {
                        hash.body(physics(&e), body);
                    }
                    sum += elapsed;
                    max = max.max(elapsed);
                }
                let hash = hash.finish();
                if let Some(expected) = expected {
                    assert_eq!(hash, expected, "{name} soft={fraction}");
                } else {
                    expected = Some(hash);
                }
                let timing = (!cfg!(debug_assertions)).then_some((sum / FRAMES as f64, max));
                println!("P2A_SOFT scene={name} fraction={fraction} repeat={repeat} first_depth={:.7} first_tick={} episodes={episodes} peak={peak:.7} hash={hash:016x} timing_us={timing:?} first_pair={:?}", first.0,first.1, first.2);
            }
        }
    }
}

fn anchor(e: &mut Engine, x: f32, y: f32) -> Entity {
    assert!(e.spawn_physics_aabb_body(
        x,
        y,
        1.,
        1.,
        0,
        1.,
        true,
        PHYSICS_LAYER_WALL,
        0,
        0,
        false,
        false,
        true,
        false
    ));
    Entity {
        id: e.physics_entity_id(),
        generation: e.physics_entity_generation(),
    }
}

fn joints_lab() -> (Engine, Vec<Entity>) {
    // The authored order, world anchors and seven joints from joints-lab.physics.json.
    let rubber = [0.68, 0.42, 1.];
    let metal = [0.36, 0.06, 2.2];
    let bodies = [
        Body::new(
            false,
            [400., 454.],
            Collider::Box([380., 12.]),
            [0.82, 0., 1.],
        ),
        Body::new(true, [118., 112.], Collider::Circle(18.), rubber),
        Body::new(true, [198., 112.], Collider::Circle(18.), rubber),
        Body::new(true, [300., 105.], Collider::Box([16., 16.]), rubber),
        Body::new(true, [400., 105.], Collider::Box([16., 16.]), rubber),
        Body {
            rotation: 0.2,
            ..Body::new(
                true,
                [540., 128.],
                Collider::OrientedBox([37., 10.], 0.05),
                metal,
            )
        },
        Body::new(true, [168., 284.], Collider::Box([24., 12.]), metal),
        Body::new(true, [492., 286.], Collider::Circle(24.), metal),
        Body::new(true, [574., 286.], Collider::Circle(18.), metal),
        Body {
            rotation: 0.04,
            ..Body::new(true, [650., 200.], Collider::Box([32., 9.]), metal)
        },
        Body {
            rotation: -0.04,
            ..Body::new(true, [714., 200.], Collider::Box([32., 9.]), metal)
        },
    ];
    let (mut e, entities) = sandbox_engine(&bodies, 640., [8, 8]);
    let [_, distance_a, distance_b, spring_a, spring_b, hinge, slider, gear_a, gear_b, weld_a, weld_b] =
        <[Entity; 11]>::try_from(entities.as_slice()).unwrap();
    e.world.add_distance_joint(
        DistanceJoint::new(distance_a, distance_b, 80.)
            .with_stiffness(0.95)
            .with_damping(0.15),
    );
    e.world.add_rope_joint(
        RopeJoint::new(distance_b, spring_a, 120.)
            .with_stiffness(0.9)
            .with_damping(0.25),
    );
    e.world
        .add_spring_joint(SpringJoint::new(spring_a, spring_b, 94.).with_frequency(2., 0.7));
    let hinge_anchor = anchor(&mut e, 540., 128.);
    e.world
        .add_revolute_joint(RevoluteJoint::new(hinge_anchor, hinge).with_angle_limits(-0.85, 0.85));
    let slide_anchor = anchor(&mut e, 168., 284.);
    e.world.add_prismatic_joint(
        PrismaticJoint::new(slide_anchor, slider)
            .with_local_axis_a(1., 0.)
            .with_translation_limits(-90., 90.)
            .with_motor(28., 50.),
    );
    e.world
        .add_gear_joint(GearJoint::new(gear_a, gear_b, -4. / 3.));
    e.world.add_weld_joint(
        WeldJoint::new(weld_a, weld_b)
            .with_local_anchor_a(32., 0.)
            .with_local_anchor_b(-32., 0.)
            .with_reference_angle(-0.08),
    );
    (e, entities)
}

#[test]
fn joints_lab_keeps_seven_joints_and_the_weld_aligned_for_300_ticks() {
    let (mut e, bodies) = joints_lab();
    for tick in 0..FRAMES {
        e.update(1. / 60.);
        sandbox_step(&mut e, 640., [8, 8]);
        assert_eq!(e.take_unified_physics_error(), None, "tick {tick}");
        assert_eq!(physics(&e).joint_count(), 7);
        assert!(!past_sandbox_floor(&e, &bodies[1..]), "tick {tick}");
        let weld_anchor = |entity, offset| {
            let p = e.world.transform(entity).unwrap();
            let angle = e.world.rotation(entity).unwrap().radians;
            let (s, c) = angle.sin_cos();
            [p.x + c * offset, p.y + s * offset]
        };
        let a = weld_anchor(bodies[9], 32.);
        let b = weld_anchor(bodies[10], -32.);
        let separation = (a[0] - b[0]).hypot(a[1] - b[1]);
        assert!(
            separation < 2.,
            "weld separation {separation} at tick {tick}"
        );
    }
}

fn crosses_box_interior([before, after]: [Transform2D; 2], body: &Body) -> bool {
    if body.trigger {
        return false;
    }
    let Collider::Box([half_width, half_height]) = body.collider else {
        unreachable!("the breakout obstacles are axis-aligned boxes");
    };
    let [x, y] = body.position;
    // Clip the center's segment to the open interior. Edge-only contact is not a crossing.
    let mut entry = 0_f32;
    let mut exit = 1_f32;
    for (from, to, min, max) in [
        (before.x, after.x, x - half_width, x + half_width),
        (before.y, after.y, y - half_height, y + half_height),
    ] {
        if from == to {
            if from <= min || from >= max {
                return false;
            }
            continue;
        }
        let a = (min - from) / (to - from);
        let b = (max - from) / (to - from);
        entry = entry.max(a.min(b));
        exit = exit.min(a.max(b));
        if entry >= exit {
            return false;
        }
    }
    true
}

#[test]
fn p1a_probes_detect_crossings_at_brick_edges() {
    let brick = Body::new(
        false,
        [404., 168.],
        Collider::Box(BRICK_HALF_EXTENTS),
        [0., 0., 1.],
    );
    let vertical_path = |x| {
        [187., 182., 177., 172., 167., 162., 157., 152., 147.]
            .windows(2)
            .any(|y| {
                crosses_box_interior(
                    [Transform2D { x, y: y[0] }, Transform2D { x, y: y[1] }],
                    &brick,
                )
            })
    };
    assert!(vertical_path(426.));
    assert!(!vertical_path(430.));
    assert!(crosses_box_interior(
        [
            Transform2D { x: 376., y: 174. },
            Transform2D { x: 432., y: 174. }
        ],
        &brick,
    ));
}

#[test]
fn breakout_gap_runs_300_ticks_without_errors_or_tunneling() {
    const GAP: [f32; 2] = [348., 168.];
    const SPEED: f32 = 300.;
    const PADDLE_REACH: f32 = 56. + 6.;
    let wall = |p, size| Body::new(false, p, Collider::Box(size), [0., 0., 1.]);
    let static_bodies = [
        wall([320., 24.], [304., 8.]),
        wall([24., 200.], [8., 184.]),
        wall([616., 200.], [8., 184.]),
        Body {
            trigger: true,
            ..wall([320., 380.], [288., 4.])
        },
    ];
    let (mut e, walls) = sandbox_engine(&static_bodies, 0., [6, 3]);
    e.set_collision_lifecycle_events_enabled(true);
    assert!(e.configure_auto_rigid_body_step(
        true, 0., 0., 6, 3, 0.8, 0.01, 1., 0.2, 120., false, true,
    ));
    let paddle_body = wall([320., 344.], [56., 6.]);
    let paddle = spawn_kind(&mut e, &paddle_body, 1);
    let mut bricks = Vec::new();
    for row in 0..5 {
        for column in 0..10 {
            let p = [68. + 56. * column as f32, 72. + 24. * row as f32];
            let body = wall(p, BRICK_HALF_EXTENTS);
            let brick = spawn(&mut e, &body);
            if p == GAP {
                assert!(e.despawn_physics_entity(brick.id, brick.generation));
            } else {
                bricks.push((brick, body));
            }
        }
    }
    let ball = spawn(
        &mut e,
        &Body {
            mass: Some(1.),
            gravity_scale: 0.,
            angular_damping: 4.,
            ..Body::new(true, [320., 331.], Collider::Circle(6.), [0., 1., 1.])
        },
    );
    assert!(e.set_physics_body_fixed_rotation(ball.id, ball.generation, true));
    let mut rigid = e.world.rigid_body(ball).unwrap();
    rigid.can_sleep = false;
    e.world.set_rigid_body(ball, rigid);
    assert!(e.resume_data_scene());
    assert!(e.auto_rigid_body_step_active());
    let dt = f64::from(e.fixed_timestep.config().step_seconds);
    let mut in_play = false;
    let mut gap_frames = 0;
    let mut hits = 0;
    let mut ccd_clamps = 0;
    for frame in 0..FRAMES {
        if frame % 100 == 0 {
            in_play = true;
            let start = 18_f32.to_radians();
            assert!(e.set_physics_body_position(ball.id, ball.generation, 320., 331.));
            assert!(e.set_physics_body_velocity(
                ball.id,
                ball.generation,
                SPEED * start.sin(),
                -SPEED * start.cos()
            ));
        }
        let before = e.world.transform(ball).unwrap();
        // The demo uses automatic stepping so native collision lifecycle events
        // are available before its brick removal and paddle response.
        e.update(dt);
        assert_eq!(e.take_unified_physics_error(), None, "tick {frame}");
        assert_eq!(e.unified_physics_frame_statistics().unwrap().fixed_steps, 1);
        ccd_clamps += physics(&e).step_statistics().ccd_clamps;
        let p = e.world.transform(ball).unwrap();
        let crossing = static_bodies
            .iter()
            .chain(std::iter::once(&paddle_body))
            .chain(bricks.iter().map(|(_, body)| body))
            .any(|body| crosses_box_interior([before, p], body));
        let [half_width, half_height] = BRICK_HALF_EXTENTS;
        gap_frames +=
            usize::from((p.x - GAP[0]).abs() < half_width && (p.y - GAP[1]).abs() < half_height);
        assert!(
            !crossing,
            "the ball crossed a solid fixture at tick {frame}"
        );
        if !in_play {
            continue;
        }
        let mut paddle_hit = false;
        let mut miss = false;
        let mut popped = Vec::new();
        for event in &e.frame_buffers.collision_events {
            let a = Entity {
                id: event.a_id,
                generation: event.a_generation,
            };
            let b = Entity {
                id: event.b_id,
                generation: event.b_generation,
            };
            let other = if a == ball {
                b
            } else if b == ball {
                a
            } else {
                continue;
            };
            if event.kind == COLLISION_EVENT_ENTER {
                paddle_hit |= other == paddle;
                if bricks.iter().any(|(brick, _)| *brick == other) {
                    popped.push(other);
                }
            } else if event.kind == COLLISION_EVENT_TRIGGER_ENTER && other == walls[3] {
                miss = true;
            }
        }
        for brick in popped {
            if let Some(index) = bricks.iter().position(|(id, _)| *id == brick) {
                assert!(e.despawn_physics_entity(brick.id, brick.generation));
                bricks.remove(index);
                hits += 1;
            }
        }
        if miss {
            in_play = false;
            assert!(e.set_physics_body_position(ball.id, ball.generation, 320., 331.));
            assert!(e.set_physics_body_velocity(ball.id, ball.generation, 0., 0.));
        } else if paddle_hit {
            let angle = ((p.x - 320.) / PADDLE_REACH).clamp(-1., 1.) * 60_f32.to_radians();
            assert!(e.set_physics_body_velocity(
                ball.id,
                ball.generation,
                SPEED * angle.sin(),
                -SPEED * angle.cos()
            ));
        } else {
            let v = e.world.velocity(ball).unwrap();
            let length = v.vx.hypot(v.vy);
            let (mut vx, mut vy) = if length > 1. {
                (v.vx / length * SPEED, v.vy / length * SPEED)
            } else {
                (0., -SPEED)
            };
            if vy.abs() < 0.35 * SPEED {
                vy = if vy > 0. { 0.35 * SPEED } else { -0.35 * SPEED };
                vx = (SPEED * SPEED - vy * vy).sqrt().copysign(vx);
            }
            if (v.vx - vx).abs() > 0.5 || (v.vy - vy).abs() > 0.5 {
                assert!(e.set_physics_body_velocity(ball.id, ball.generation, vx, vy));
            }
        }
    }
    assert!(
        gap_frames > 0 && hits > 0,
        "the ball must reach the brick gap"
    );
    assert!(
        ccd_clamps > 0,
        "the ball must exercise continuous collision detection"
    );
}

fn spatial_world() -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space: Space::Spatial,
        ..WorldConfig::default()
    })
    .unwrap()
}

#[test]
fn fast_ball_stays_above_a_thin_triangle_mesh() {
    let mut w = spatial_world();
    w.create_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::TriangleMesh {
            vertices: vec![
                [-10., 0., -10.],
                [10., 0., -10.],
                [10., 0., 10.],
                [-10., 0., 10.],
            ],
            triangles: vec![[0, 2, 1], [0, 3, 2]],
        }),
    )
    .unwrap();
    let ball = w
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [0., 2., 0.],
                    ..Pose::default()
                },
                linear_velocity: [0., -1000., 0.],
                ccd: true,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        )
        .unwrap();
    for tick in 0..FRAMES {
        w.step_checked().unwrap();
        let y = w.body_state(ball).unwrap().pose.position[1];
        assert!(y >= -0.005, "ball crossed the mesh at tick {tick}: {y}");
        if tick == 0 {
            assert_eq!(w.ccd_clamps().len(), 1);
            assert_eq!(w.ccd_clamps()[0].moving.body, ball);
        }
    }
}

#[test]
fn p1a_probes_require_stack_support_when_boxes_are_still() {
    for (upper, expected) in [
        ([0., 1.5, 0.], true),
        ([2., 0.5, 0.], false),
        ([0., 1.7, 0.], false),
    ] {
        let mut w = spatial_world();
        let floor = create_stack_box(&mut w, BodyKind::Fixed, [0., -0.5, 0.], [10., 0.5, 10.]);
        let blocks = [
            create_stack_box(&mut w, BodyKind::Dynamic, [0., 0.5, 0.], [0.5; 3]),
            create_stack_box(&mut w, BodyKind::Dynamic, upper, [0.5; 3]),
        ];
        assert!(blocks.iter().all(|&id| {
            let state = w.body_state(id).unwrap();
            state.linear_velocity == [0.; 3] && state.angular_velocity == [0.; 3]
        }));
        assert_eq!(
            w.p1a_stack_is_supported(floor, &blocks),
            expected,
            "upper={upper:?}"
        );
    }
}

fn create_stack_box(
    w: &mut PhysicsWorld3d,
    kind: BodyKind,
    position: [f32; 3],
    half_extents: [f32; 3],
) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: Pose {
                position,
                ..Pose::default()
            },
            ccd: kind == BodyKind::Dynamic,
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box { half_extents }),
    )
    .unwrap()
}

#[test]
fn eight_box_stack_settles_without_losing_support() {
    let mut w = spatial_world();
    let floor = create_stack_box(&mut w, BodyKind::Fixed, [0., -0.5, 0.], [10., 0.5, 10.]);
    let blocks: Vec<_> = (0..8)
        .map(|level| {
            create_stack_box(
                &mut w,
                BodyKind::Dynamic,
                [0., 0.55 + 1.03 * level as f32, 0.],
                [0.5; 3],
            )
        })
        .collect();
    for tick in 0..FRAMES {
        w.step_checked().unwrap();
        for &id in &blocks {
            let state = w.body_state(id).unwrap();
            assert!(
                state.pose.position[1] > 0.,
                "box crossed the floor at tick {tick}"
            );
            if tick >= FRAMES - 60 {
                assert!(
                    state
                        .linear_velocity
                        .into_iter()
                        .map(f32::abs)
                        .fold(0., f32::max)
                        < 0.05,
                    "unsettled box at tick {tick}: {state:?}"
                );
                assert!(
                    state
                        .angular_velocity
                        .into_iter()
                        .map(f32::abs)
                        .fold(0., f32::max)
                        < 0.05,
                    "rotating box at tick {tick}: {state:?}"
                );
            }
        }
        if tick >= FRAMES - 60 {
            assert!(w.p1a_stack_is_supported(floor, &blocks), "tick {tick}");
            assert!(w.p1a_max_overlap() < 0.02, "stack overlap at tick {tick}");
        }
    }
}

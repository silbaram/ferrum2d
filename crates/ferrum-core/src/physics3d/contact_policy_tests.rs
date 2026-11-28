use super::*;

fn world(space: Space) -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.0, -10.0, 0.0],
        ..WorldConfig::default()
    })
    .unwrap()
}

fn desc(kind: BodyKind, position: [f32; 3]) -> BodyDesc {
    BodyDesc {
        kind,
        pose: Pose {
            position,
            ..Pose::default()
        },
        can_sleep: false,
        ..BodyDesc::default()
    }
}

fn box_shape(half: [f32; 3]) -> ColliderDesc {
    ColliderDesc::new(Shape::Box { half_extents: half })
}

fn steps(w: &mut PhysicsWorld3d, n: usize) {
    for _ in 0..n {
        w.step();
    }
}

fn span(floor: u32, elevation: f32, height: f32) -> Option<PlanarCollisionSpan> {
    Some(PlanarCollisionSpan {
        floor,
        elevation,
        height,
    })
}

fn floor_and_box(
    w: &mut PhysicsWorld3d,
    surface: [f32; 3],
    friction: f32,
) -> (BodyId, BodyId, ColliderId, ColliderDesc) {
    let mut material = box_shape([100.0, 0.5, 0.5]);
    material.friction = 10.0;
    material.surface_velocity = surface;
    let floor = w
        .create_body(desc(BodyKind::Fixed, [0.0, -0.5, 0.0]), material.clone())
        .unwrap();
    let collider = w.collider_ids(floor).unwrap().next().unwrap();
    let d = desc(BodyKind::Dynamic, [0.0, 0.5, 0.0]);
    let mut shape = box_shape([0.5; 3]);
    shape.friction = friction;
    let b = w.create_body(d.clone(), shape).unwrap();
    let mut options = BodyOptions::from(&d);
    options.lock_rotation = true;
    w.set_body_options(b, &options).unwrap();
    (floor, b, collider, material)
}

#[test]
fn conveyor_moves_by_tangential_friction_and_live_reversal_preserves_geometry() {
    for (space, model) in [
        (Space::Spatial, rapier3d::prelude::FrictionModel::Simplified),
        (
            Space::PlanarXy,
            rapier3d::prelude::FrictionModel::Simplified,
        ),
        (Space::PlanarXy, rapier3d::prelude::FrictionModel::Coulomb),
    ] {
        let mut w = world(space);
        w.backend.integration_parameters.friction_model = model;
        let (floor, b, collider, mut material) = floor_and_box(&mut w, [2.0, 100.0, 0.0], 10.0);
        steps(&mut w, 120);
        let s = w.body_state(b).unwrap();
        assert!(
            (s.linear_velocity[0] - 2.0).abs() < 0.01,
            "{space:?}: {s:?}"
        );
        assert!(
            s.pose.position[0] > 3.8 && (s.pose.position[1] - 0.5).abs() < 0.01,
            "{s:?}"
        );
        material.surface_velocity = [-2.0, 0.0, 0.0];
        w.update_collider(collider, material).unwrap();
        steps(&mut w, 120);
        let reversed = w.body_state(b).unwrap();
        assert!(
            (reversed.linear_velocity[0] + 2.0).abs() < 0.01,
            "{reversed:?}"
        );
        assert!(reversed.pose.position[0] < 0.1);
        assert_eq!(w.body_state(floor).unwrap().pose.position, [0.0, -0.5, 0.0]);
    }
}

#[test]
fn friction_uses_geometric_mean_instead_of_arithmetic_average() {
    let mut w = world(Space::PlanarXy);
    let (_, b, _, _) = floor_and_box(&mut w, [2.0, 0.0, 0.0], 0.0);
    steps(&mut w, 120);
    assert!(w.body_state(b).unwrap().pose.position[0].abs() < 0.001);
    let mut w = world(Space::PlanarXy);
    let (_, b, floor, mut material) = floor_and_box(&mut w, [0.0; 3], 0.25);
    material.friction = 0.81;
    w.update_collider(floor, material).unwrap();
    steps(&mut w, 60);
    w.set_velocity(b, [10.0, 0.0, 0.0], [0.0; 3]).unwrap();
    steps(&mut w, 12);
    let velocity = w.body_state(b).unwrap().linear_velocity[0];
    // mu = sqrt(0.25 * 0.81) = 0.45, load = mg, duration = 0.2 s.
    assert!((velocity - 9.1).abs() < 0.03, "{velocity}");
}

#[test]
fn planar_span_change_refilters_stationary_sensors_and_clear_releases_the_filter() {
    let mut w = world(Space::PlanarXy);
    let mut sensor = box_shape([0.5; 3]);
    sensor.sensor = true;
    let a = w
        .create_body(desc(BodyKind::Fixed, [0.0; 3]), sensor.clone())
        .unwrap();
    let b = w
        .create_body(desc(BodyKind::Fixed, [0.0; 3]), sensor)
        .unwrap();
    w.set_planar_collision_span(a, span(1, 0.0, 1.0)).unwrap();
    w.set_planar_collision_span(b, span(1, 1.0, 1.0)).unwrap();
    let mut events = Vec::new();
    for (range, expected) in [
        (span(1, 1.0, 1.0), CollisionPhase::Enter),
        (span(2, 0.0, 1.0), CollisionPhase::Exit),
        (None, CollisionPhase::Enter),
        (span(1, 2.0, 1.0), CollisionPhase::Exit),
    ] {
        w.set_planar_collision_span(b, range).unwrap();
        w.step();
        assert_eq!(w.drain_collision_events(&mut events), 0);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].phase, expected);
        w.step();
        w.drain_collision_events(&mut events);
        assert!(events.is_empty());
    }
}

#[test]
fn planar_span_filters_fast_ccd_without_clamping_to_other_floors() {
    for blocked in [false, true] {
        let mut w = world(Space::PlanarXy);
        let wall = w
            .create_body(desc(BodyKind::Fixed, [0.0; 3]), box_shape([0.05, 5.0, 0.5]))
            .unwrap();
        let mut d = desc(BodyKind::Dynamic, [-2.0, 0.0, 0.0]);
        d.linear_velocity = [300.0, 0.0, 0.0];
        d.gravity_scale = 0.0;
        d.ccd = true;
        let b = w.create_body(d, box_shape([0.1; 3])).unwrap();
        w.set_planar_collision_span(wall, span(1, 0.0, 1.0))
            .unwrap();
        w.set_planar_collision_span(b, span(if blocked { 1 } else { 2 }, 0.0, 1.0))
            .unwrap();
        w.step_checked()
            .unwrap_or_else(|error| panic!("blocked={blocked}: {error:?}"));
        let x = w.body_state(b).unwrap().pose.position[0];
        if blocked {
            assert!(x < -0.1, "{x}");
        } else {
            assert!((x - 3.0).abs() < 0.01, "{x}");
        }
    }
}

#[test]
fn planar_query_span_is_immediate_and_excludes_unspecified_targets() {
    let mut w = world(Space::PlanarXy);
    let mut bodies = Vec::new();
    for (x, range) in [
        (1.0, None),
        (3.0, span(2, 0.0, 1.0)),
        (5.0, span(1, 0.0, 1.0)),
    ] {
        let b = w
            .create_body(desc(BodyKind::Fixed, [x, 0.0, 0.0]), box_shape([0.5; 3]))
            .unwrap();
        w.set_planar_collision_span(b, range).unwrap();
        bodies.push(b);
    }
    let ray = RayCast {
        origin: [0.0; 3],
        direction: [1.0, 0.0, 0.0],
        max_distance: 10.0,
        solid: true,
    };
    let filter = QueryFilter {
        planar_span: span(1, 0.0, 1.0),
        ..QueryFilter::default()
    };
    assert_eq!(
        w.cast_ray(&ray, &filter).unwrap().unwrap().target.body,
        bodies[2]
    );
    w.set_planar_collision_span(bodies[1], span(1, 0.0, 1.0))
        .unwrap();
    assert_eq!(
        w.cast_ray(&ray, &filter).unwrap().unwrap().target.body,
        bodies[1]
    );
    let swept = w
        .sweep(
            &Shape::Sphere { radius: 0.25 },
            Pose::default(),
            [10.0, 0.0, 0.0],
            &filter,
        )
        .unwrap()
        .unwrap();
    assert_eq!(swept.target.body, bodies[1]);
    let mut hits = Vec::new();
    let truncated = w
        .overlap(
            &Shape::Box {
                half_extents: [3.0, 1.0, 0.5],
            },
            Pose {
                position: [3.0, 0.0, 0.0],
                ..Pose::default()
            },
            &filter,
            &mut hits,
            1,
        )
        .unwrap();
    assert!(truncated);
    assert_eq!(hits.len(), 1);
    assert_ne!(hits[0].body, bodies[0]);
    assert_eq!(
        w.cast_ray(&ray, &QueryFilter::default())
            .unwrap()
            .unwrap()
            .target
            .body,
        bodies[0]
    );
    let invalid = span(1, f32::NAN, 1.0);
    assert_eq!(
        w.set_planar_collision_span(bodies[1], invalid),
        Err(PhysicsError::InvalidBody)
    );
    assert_eq!(
        w.cast_ray(&ray, &filter).unwrap().unwrap().target.body,
        bodies[1]
    );
    w.remove_body(bodies[1]).unwrap();
    let replacement = w
        .create_body(desc(BodyKind::Fixed, [3.0, 0.0, 0.0]), box_shape([0.5; 3]))
        .unwrap();
    assert_ne!(replacement, bodies[1]);
    assert_eq!(
        w.cast_ray(&ray, &filter).unwrap().unwrap().target.body,
        bodies[2]
    );
}

#[test]
fn mixed_restitution_uses_the_more_elastic_surface_in_actual_bounce() {
    let mut w = world(Space::PlanarXy);
    let (_, b, _, _) = floor_and_box(&mut w, [0.0; 3], 0.0);
    let id = w.collider_ids(b).unwrap().next().unwrap();
    let mut material = box_shape([0.5; 3]);
    material.friction = 0.0;
    material.restitution = 0.8;
    w.update_collider(id, material).unwrap();
    w.set_pose(
        b,
        Pose {
            position: [0.0, 2.5, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    let mut rebound = 0.0_f32;
    for _ in 0..120 {
        w.step();
        rebound = rebound.max(w.body_state(b).unwrap().linear_velocity[1]);
    }
    // 2-unit fall at g=10 gives about 6.32 speed, times max(0, 0.8).
    assert!((4.8..5.3).contains(&rebound), "{rebound}");
}

#[test]
fn planar_character_span_changes_drop_grounding_before_jump_and_filter_other_actors() {
    let mut w = world(Space::PlanarXy);
    let floor = w
        .create_body(
            desc(BodyKind::Fixed, [0.0, -0.5, 0.0]),
            box_shape([20.0, 0.5, 0.5]),
        )
        .unwrap();
    let actor = |w: &mut PhysicsWorld3d, x| {
        let b = w
            .create_body(
                desc(BodyKind::KinematicPosition, [x, 0.91, 0.0]),
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.5,
                    radius: 0.4,
                }),
            )
            .unwrap();
        w.enable_character(b, CharacterConfig::default()).unwrap();
        b
    };
    let a = actor(&mut w, -2.0);
    let b = actor(&mut w, 2.0);
    w.set_planar_collision_span(a, span(1, 0.0, 1.0)).unwrap();
    w.set_planar_collision_span(b, span(2, 0.0, 1.0)).unwrap();
    steps(&mut w, 3);
    for (id, speed) in [(a, 20.0), (b, -20.0)] {
        w.set_character_input(
            id,
            CharacterInput {
                velocity: [speed, 0.0, 0.0],
                ..Default::default()
            },
        )
        .unwrap();
    }
    steps(&mut w, 15);
    assert!(w.body_state(a).unwrap().pose.position[0] > 2.9);
    assert!(w.body_state(b).unwrap().pose.position[0] < -2.9);
    assert_eq!(w.character_state(a).unwrap().character_pair_casts, 0);
    assert!(w.character_state(a).unwrap().grounded);
    w.set_planar_collision_span(floor, span(1, 0.0, 1.0))
        .unwrap();
    w.set_character_input(a, CharacterInput::default()).unwrap();
    steps(&mut w, 3);
    assert!(w.character_state(a).unwrap().grounded);
    w.set_planar_collision_span(a, span(3, 0.0, 1.0)).unwrap();
    assert!(!w.character_state(a).unwrap().grounded);
    w.set_character_input(
        a,
        CharacterInput {
            jump_speed: 10.0,
            ..Default::default()
        },
    )
    .unwrap();
    w.step();
    assert!(w.character_state(a).unwrap().vertical_speed < 0.0);
    steps(&mut w, 60);
    assert!(w.body_state(a).unwrap().pose.position[1] < -4.0);
}

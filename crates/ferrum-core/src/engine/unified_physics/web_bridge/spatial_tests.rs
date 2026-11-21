use super::*;

fn engine(space: u32) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics_world(
        &[space, 1, 1, 1, 100, 200, 100, 20, 100],
        &[0.0, -9.81, 0.0, 0.01, 1.0, 0.0],
    )
    .unwrap();
    e
}
fn values(position: [f32; 3]) -> [f32; 37] {
    let mut v = [0.0; 37];
    v[..3].copy_from_slice(&position);
    v[6] = 1.0;
    v[13] = 1.0;
    v[22] = 1.0;
    v[23] = 1.0;
    v[24] = 0.5;
    v
}
fn spawn(e: &mut Engine, kind: u32, p: [f32; 3], m: &[u32], v: &[f32]) -> Entity {
    let h = e
        .spawn_unified_physics_body(&[kind, 2, 1, u32::MAX], &values(p), m, v)
        .unwrap();
    entity(&h)
}
fn tick(e: &mut Engine, n: usize) {
    for _ in 0..n {
        e.update(f64::from(0.01_f32));
    }
}
const CHARACTER: [f32; 11] = [
    0.0,
    1.0,
    0.0,
    0.01,
    std::f32::consts::FRAC_PI_4,
    std::f32::consts::FRAC_PI_4,
    0.3,
    0.2,
    0.2,
    50.0,
    0.0,
];
fn capsule(e: &mut Engine, x: f32) -> Entity {
    let c = spawn(e, 2, [x, 0.76, 0.0], &[2], &[0.5, 0.25]);
    e.configure_unified_physics_character(c.id, c.generation, &CHARACTER)
        .unwrap();
    c
}

#[test]
fn all_native_geometry_kinds_are_constructible_through_the_wire_codec() {
    let mut e = engine(1);
    let cases: Vec<(Vec<u32>, Vec<f32>)> = vec![
        (vec![0], vec![1.0, 1.0, 1.0]),
        (vec![1], vec![0.5]),
        (vec![2], vec![0.5, 0.25]),
        (
            vec![3, 4],
            vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        ),
        (
            vec![4, 3, 1, 0, 1, 2],
            vec![-1.0, 0.0, -1.0, 1.0, 0.0, -1.0, 0.0, 0.0, 1.0],
        ),
        (vec![5, 2, 2], vec![2.0, 2.0, 0.0, 0.0, 0.0, 0.0]),
        (
            vec![6, 2, 0, 1],
            vec![
                0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 2.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                1.0, 0.5,
            ],
        ),
    ];
    for (i, (m, v)) in cases.iter().enumerate() {
        let p = [i as f32 * 5.0, 3.0, 2.0];
        let h = spawn(&mut e, 0, p, m, v);
        assert_eq!(e.unified_body_state(h).unwrap().pose.position, p);
        let visual = e.world.transform(h).unwrap();
        assert_eq!([visual.x, visual.y], [p[0], -p[2]]);
        e.remove_unified_physics_body(h.id, h.generation).unwrap();
        assert!(e.unified_body_state(h).is_err());
    }
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
}

#[test]
fn malformed_or_unsupported_shapes_never_create_an_entity_or_native_body() {
    let mut e = engine(1);
    let v = values([0.0; 3]);
    let count = e.entity_count();
    let cases: Vec<(Vec<u32>, Vec<f32>)> = vec![
        (vec![99], vec![]),
        (vec![0], vec![1.0]),
        (vec![1, 0], vec![1.0]),
        (vec![1], vec![1.0, 2.0]),
        (vec![3, u32::MAX], vec![]),
        (vec![4, 3, 1, 0, 1, 9], vec![0.0; 9]),
        (vec![5, u32::MAX, 2], vec![]),
        (vec![6, 1, 6, 1], vec![0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]),
        (vec![1], vec![f32::NAN]),
    ];
    for (m, s) in cases {
        assert!(e
            .spawn_unified_physics_body(&[0, 2, 1, u32::MAX], &v, &m, &s)
            .is_err());
    }
    assert!(e
        .spawn_unified_physics_body(&[0, 32, 1, u32::MAX], &v, &[1], &[1.0])
        .is_err());
    assert!(e
        .spawn_unified_physics_body(
            &[1, 2, 1, u32::MAX],
            &v,
            &[5, 2, 2],
            &[2.0, 2.0, 0.0, 0.0, 0.0, 0.0]
        )
        .is_err());
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
    assert_eq!(e.entity_count(), count);
}

#[test]
fn spatial_controller_walks_in_xz_jumps_once_and_reports_ground_support() {
    let mut e = engine(1);
    let ground = spawn(&mut e, 0, [0.0, -0.25, 0.0], &[0], &[10.0, 0.25, 10.0]);
    let c = capsule(&mut e, 0.0);
    let handles = [c.id, c.generation];
    tick(&mut e, 2);
    let s = e.unified_character_state(c).unwrap();
    assert!(s.grounded);
    assert_eq!(s.ground.unwrap().body, e.unified_body_id(ground).unwrap());
    e.set_unified_physics_character_inputs(&handles, &[1.0, 0.0, 1.0, 0.0])
        .unwrap();
    tick(&mut e, 50);
    let p = e.unified_body_state(c).unwrap().pose.position;
    assert!(
        (p[0] - 0.5).abs() < 1e-4 && (p[2] - 0.5).abs() < 1e-4,
        "{p:?}"
    );
    e.set_unified_physics_character_inputs(&handles, &[0.0, 0.0, 0.0, 4.0])
        .unwrap();
    tick(&mut e, 10);
    assert!(e.unified_body_state(c).unwrap().pose.position[1] > p[1] + 0.2);
    tick(&mut e, 150);
    assert!(e.unified_character_state(c).unwrap().grounded);
    assert!((e.unified_body_state(c).unwrap().pose.position[1] - p[1]).abs() < 0.02);
    e.query_unified_physics_character_states(&[c.id, c.generation, c.id, c.generation])
        .unwrap();
    assert_eq!(e.unified_physics_character_state_count(), 2);
    assert_eq!(e.unified_physics_character_state_stride_words(), 28);
}

#[test]
fn invalid_last_character_input_preserves_all_previous_velocity_and_pending_jump() {
    let mut e = engine(1);
    spawn(&mut e, 0, [0.0, -0.25, 0.0], &[0], &[10.0, 0.25, 10.0]);
    let a = capsule(&mut e, -2.0);
    let b = capsule(&mut e, 2.0);
    tick(&mut e, 2);
    let h = [a.id, a.generation, b.id, b.generation];
    e.set_unified_physics_character_inputs(&h, &[1.0, 0.0, 0.0, 4.0, 0.0, 0.0, 1.0, 0.0])
        .unwrap();
    assert!(e
        .set_unified_physics_character_inputs(&h, &[0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0])
        .is_err());
    let stale = [a.id, a.generation, b.id, b.generation + 1];
    assert!(e
        .set_unified_physics_character_inputs(&stale, &[0.0; 8])
        .is_err());
    tick(&mut e, 1);
    let s = e.unified_character_state(a).unwrap();
    assert!(s.vertical_speed > 3.0 && s.translation[0] > 0.009);
    assert!(e.unified_character_state(b).unwrap().translation[2] > 0.009);
    assert!(e.query_unified_physics_character_states(&stale).is_err());
    assert_eq!(e.unified_physics_character_state_count(), 0);
}

#[test]
fn controller_disable_removal_and_planar_input_constraints_preserve_ownership() {
    let mut e = engine(0);
    let c = capsule(&mut e, 0.0);
    let h = [c.id, c.generation];
    assert!(e
        .set_unified_physics_character_inputs(&h, &[0.0, 0.0, 1.0, 0.0])
        .is_err());
    assert!(e.set_unified_physics_velocities(&h, &[0.0; 6]).is_err());
    e.configure_unified_physics_character(c.id, c.generation, &[])
        .unwrap();
    e.set_unified_physics_velocities(&h, &[0.0; 6]).unwrap();
    assert!(e.query_unified_physics_character_states(&h).is_err());
    e.configure_unified_physics_character(c.id, c.generation, &CHARACTER)
        .unwrap();
    e.remove_unified_physics_body(c.id, c.generation).unwrap();
    assert!(e
        .set_unified_physics_character_inputs(&h, &[0.0; 4])
        .is_err());
    assert!(e.remove_unified_physics_body(c.id, c.generation).is_err());
    let fresh = spawn(&mut e, 0, [0.0; 3], &[1], &[1.0]);
    assert_ne!(fresh, c);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 1);
}

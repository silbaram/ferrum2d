use super::*;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Shape, Space, WorldConfig};

mod sphere_center;

fn engine(space: Space) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        step_seconds: 0.01,
        max_colliders: 32,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn ball(e: &mut Engine, p: [f32; 3]) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: p,
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        [0.0, 100.0, 0.0],
    )
    .unwrap()
}
fn row(kind: u32, p: [f32; 3]) -> ([u32; 12], [f32; 13]) {
    let mut m = [0; 12];
    m[0] = kind;
    m[1] = 2 | if kind == 0 { 32 } else { 0 };
    m[2] = u32::MAX;
    m[3] = u32::MAX;
    m[9] = 8;
    let mut v = [0.0; 13];
    v[..3].copy_from_slice(&p);
    v[6] = 1.0;
    if kind == 0 {
        v[8] = -7.0;
        v[10] = 20.0;
    }
    if kind == 4 {
        v[10] = 10.0;
    }
    (m, v)
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 1e-4, "{a} != {b}");
}
fn run(e: &mut Engine, m: &[u32], v: &[f32]) {
    e.query_unified_physics(m, v, &[], &[]).unwrap();
}

#[test]
fn mixed_query_batch_returns_geometry_order_and_truncation_in_simulation_xyz() {
    let mut e = engine(Space::Spatial);
    let a = ball(&mut e, [0.0; 3]);
    ball(&mut e, [0.0, -3.0, 0.0]);
    let (mut r, rv) = row(0, [0.0, 10.0, 0.0]);
    r[9] = 1;
    let (p, pv) = row(1, [0.0; 3]);
    let (mut o, ov) = row(2, [0.0; 3]);
    o[10] = 1;
    o[11] = 3;
    let (mut s, mut sv) = row(3, [0.0, 2.0, 0.0]);
    s[10] = 1;
    s[11] = 1;
    sv[8] = -4.0;
    let (n, mut nv) = row(4, [0.0, 2.0, 0.0]);
    nv[10] = 5.0;
    e.query_unified_physics(
        &[r, p, o, s, n].concat(),
        &[rv, pv, ov, sv, nv].concat(),
        &[0, 1],
        &[0.25, 0.25, 0.25, 0.25],
    )
    .unwrap();
    assert_eq!(e.unified_physics_query_hit_stride_words(), 19);
    assert_eq!(e.unified_physics_query_summary_stride_words(), 3);
    let out = &e.unified_physics_queries;
    assert_eq!(
        out.summaries,
        vec![[0, 1, 1], [1, 1, 0], [2, 1, 0], [3, 1, 0], [4, 2, 0]]
    );
    let ray = &out.hits[0];
    assert_eq!(ray.entity, [a.id, a.generation]);
    assert_eq!(ray.flags, 1);
    near(ray.value, 9.5);
    assert_eq!(ray.point, [0.0, 0.5, 0.0]);
    assert_eq!(ray.normal, [0.0, 1.0, 0.0]);
    near(out.hits[3].value, 0.3125);
    near(out.hits[3].point[1], 0.5);
    assert_eq!(out.hits[3].flags & 4, 0);
    near(out.hits[4].value, 1.5);
    near(out.hits[5].value, 4.5);
    assert_eq!(out.hits[5].query, 4);
    assert_eq!(out.hits[5].kind, 4);
    assert_eq!(e.elapsed_seconds, 0.0); // The render offset does not affect any query geometry.
}

#[test]
fn filters_sensor_masks_exclusions_edits_and_generations_are_live_without_ticks() {
    let mut e = engine(Space::Spatial);
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                category: 2,
                mask: 4,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
            },
            [0.0; 3],
        )
        .unwrap();
    let (mut m, v) = row(0, [0.0, 10.0, 0.0]);
    run(&mut e, &m, &v);
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    m[1] |= 1;
    run(&mut e, &m, &v);
    assert_eq!(e.unified_physics_query_hit_count(), 1);
    assert_eq!(e.unified_physics_queries.hits[0].flags, 3);
    let old_collider = e.unified_physics_queries.hits[0].collider;
    m[2] = 1;
    run(&mut e, &m, &v);
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    m[1] &= !2;
    run(&mut e, &m, &v);
    assert_eq!(e.unified_physics_query_hit_count(), 1);
    m[1] |= 4;
    m[4] = a.id;
    m[5] = a.generation;
    run(&mut e, &m, &v);
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    m[1] &= !4;
    m[4..6].fill(0);
    m[1] |= 8;
    m[6..8].copy_from_slice(&old_collider);
    run(&mut e, &m, &v);
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    m[1] &= !8;
    m[6..8].fill(0);
    e.set_unified_body_pose(
        a,
        Pose {
            position: [5.0, 0.0, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    run(&mut e, &m, &v);
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    let mut moved = v;
    moved[0] = 5.0;
    run(&mut e, &m, &moved);
    assert_eq!(e.unified_physics_query_hit_count(), 1);
    e.remove_unified_body(a).unwrap();
    let replacement = ball(&mut e, [5.0, 0.0, 0.0]);
    assert_ne!(a, replacement);
    run(&mut e, &m, &moved);
    assert_eq!(
        e.unified_physics_queries.hits[0].entity,
        [replacement.id, replacement.generation]
    );
    m[1] |= 8;
    m[6..8].copy_from_slice(&old_collider);
    assert!(e.query_unified_physics(&m, &moved, &[], &[]).is_err());
    assert_eq!(e.unified_physics_query_count(), 0);
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    m[1] &= !8;
    m[6..8].fill(0);
    m[1] |= 4;
    m[4] = a.id;
    m[5] = a.generation;
    assert!(e.query_unified_physics(&m, &moved, &[], &[]).is_err());
}

#[test]
fn queries_preserve_pending_kinematic_targets_and_handle_zero_motion_overlap() {
    let mut e = engine(Space::Spatial);
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.0; 3],
        )
        .unwrap();
    e.command_unified_physics_bodies(
        1,
        &[a.id, a.generation],
        &[5.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0],
    )
    .unwrap();
    let (r, rv) = row(0, [0.0, 10.0, 0.0]);
    run(&mut e, &r, &rv);
    assert_eq!(e.unified_physics_query_hit_count(), 1);
    assert_eq!(e.unified_body_state(a).unwrap().pose.position, [0.0; 3]);
    assert_eq!(e.elapsed_seconds, 0.0);
    let (mut s, sv) = row(3, [0.0; 3]);
    s[10] = 1;
    s[11] = 1;
    e.query_unified_physics(&s, &sv, &[1], &[0.25]).unwrap();
    assert_eq!(e.unified_physics_queries.hits[0].value, 0.0);
    assert_ne!(e.unified_physics_queries.hits[0].flags & 4, 0);
    e.update(f64::from(0.01_f32));
    near(e.unified_body_state(a).unwrap().pose.position[0], 5.0);
    run(&mut e, &r, &rv);
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    let (n, nv) = row(4, [5.0, 0.0, 0.0]);
    run(&mut e, &n, &nv);
    assert_ne!(e.unified_physics_queries.hits[0].flags & 8, 0);
    assert_eq!(e.unified_physics_queries.hits[0].value, 0.0);
}

#[test]
fn failures_clear_whole_output_and_reject_malformed_or_over_capacity_batches() {
    let mut e = engine(Space::Spatial);
    ball(&mut e, [0.0; 3]);
    let (m, v) = row(0, [0.0, 10.0, 0.0]);
    let mut bad = v;
    bad[7..10].fill(0.0);
    run(&mut e, &m, &v);
    assert!(e
        .query_unified_physics(&[m, m].concat(), &[v, bad].concat(), &[], &[])
        .is_err());
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    assert_eq!(e.unified_physics_query_count(), 0);
    let mut invalid = m;
    invalid[1] |= 512; // bits6..8 now encode the bounded terrain purpose
    assert!(e.query_unified_physics(&invalid, &v, &[], &[]).is_err());
    invalid = m;
    invalid[9] = 65536;
    assert!(e
        .query_unified_physics(&[invalid, invalid].concat(), &[v, v].concat(), &[], &[])
        .is_err());
    assert!(e
        .query_unified_physics(&vec![0; 12 * 257], &vec![0.0; 13 * 257], &[], &[])
        .is_err());
    assert!(e.query_unified_physics(&m, &v, &[1], &[1.0]).is_err());
    let (mut shape, sv) = row(2, [0.0; 3]);
    shape[10] = 1;
    shape[11] = 1;
    for code in [4, 5, 6, 99] {
        assert!(e
            .query_unified_physics(&shape, &sv, &[code], &[1.0])
            .is_err());
    }
    shape[10] = 2;
    assert!(e
        .query_unified_physics(&shape, &sv, &[3, u32::MAX], &[1.0])
        .is_err());
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    e.query_unified_physics(&[], &[], &[], &[]).unwrap();
    assert_eq!(e.unified_physics_query_count(), 0);
}

#[test]
fn planar_span_and_authored_terrain_identity_are_returned_without_simulation() {
    let mut e = engine(Space::PlanarXy);
    e.tilemap
        .set_layer(0, 1, 1, 1.0, 2.0, 2.0, -1.0, true, vec![1]);
    let a = ball(&mut e, [6.0, 0.0, 0.0]);
    let (mut m, mut v) = row(0, [0.0; 3]);
    v[7] = 1.0;
    v[8] = 0.0;
    run(&mut e, &m, &v);
    assert_eq!(e.unified_physics_query_hit_count(), 2);
    let hit = &e.unified_physics_queries.hits[0];
    near(hit.value, 2.0);
    assert_eq!(hit.flags & 1, 0);
    assert_eq!(hit.terrain, [1, 0, 0]);
    assert_eq!(
        e.unified_physics_queries.hits[1].entity,
        [a.id, a.generation]
    );
    e.tilemap
        .set_layer(0, 1, 1, 1.0, 2.0, 4.0, -1.0, true, vec![1]);
    run(&mut e, &m, &v);
    near(e.unified_physics_queries.hits[0].value, 4.0);
    let body = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_planar_collision_span(
            body,
            Some(PlanarCollisionSpan {
                floor: 7,
                elevation: 2.0,
                height: 1.0,
            }),
        )
        .unwrap();
    m[1] |= 16;
    m[8] = 7;
    v[11] = 2.0;
    v[12] = 1.0;
    run(&mut e, &m, &v);
    assert_eq!(e.unified_physics_query_hit_count(), 1);
    assert_eq!(
        e.unified_physics_queries.hits[0].entity,
        [a.id, a.generation]
    );
    v[2] = 1.0;
    assert!(e.query_unified_physics(&m, &v, &[], &[]).is_err());
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    assert_eq!(e.elapsed_seconds, 0.0);
}

#[test]
fn malformed_later_row_rejects_before_query_preparation_imports_components() {
    use crate::components::{CircleCollider, CollisionLayer, RigidBody, Transform2D};
    let mut e = engine(Space::PlanarXy);
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 3., y: 0. });
    e.world
        .set_circle_collider(a, CircleCollider::new(0.5, false, CollisionLayer::Enemy));
    e.world
        .set_rigid_body(a, RigidBody::dynamic_circle(1., 0.5));
    let (m, v) = row(1, [3., 0., 0.]);
    let (mut bad, bad_v) = row(2, [0.; 3]);
    bad[10] = 1;
    bad[11] = 1;
    assert!(e
        .query_unified_physics(&[m, bad].concat(), &[v, bad_v].concat(), &[], &[])
        .is_err());
    // The rejected batch did not run preparation, so nothing was imported.
    assert!(e.unified_body_state(a).is_err());
    run(&mut e, &m, &v);
    assert!(e.unified_body_state(a).is_ok());
    assert_eq!(e.unified_physics_query_count(), 1);
}

#[test]
fn batch_queries_follow_the_native_scene_contract_outside_data_scenes() {
    let mut e = Engine::new();
    assert!(
        e.unified_physics.is_some(),
        "built-in default uses native physics"
    );
    let (m, v) = row(1, [0.; 3]);
    run(&mut e, &m, &v);
    assert_eq!(e.unified_physics_query_count(), 1);
}

use super::{data_scene_visuals::sprite, *};
use crate::components::{
    CapsuleCollider, ChainCollider, CircleCollider, CompoundCollider, CompoundColliderShape,
    ConvexPolygonCollider, EdgeCollider, HeightSpan, OrientedBoxCollider, PhysicsFloorId,
    RigidContactImpulse, MAX_CHAIN_COLLIDER_VERTICES, MAX_CONVEX_POLYGON_VERTICES,
};

fn setup() -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(400., 300.);
    assert!(e.configure_spatial_camera(&[
        0., 0., 100., 200., 0., 16., 0., 200., 0.1, 1000., 400., 300.
    ]));
    assert!(e.configure_spatial_terrain(
        &[-24., -16., 48., 32., -8., 16., 16., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    e
}

#[test]
fn spatial_debug_is_opt_in_and_uses_render_geometry_and_native_height_span() {
    let mut e = setup();
    let a = sprite(&mut e, 71, 0., 0., 0);
    assert!(e.configure_data_scene_body(a.id, a.generation, 1, true, 2, 16., 8.));
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 7.]));
    e.build_render_commands();
    assert_eq!(e.spatial_debug_flags(), 0);
    assert!(e.spatial_scene.debug.vertices.is_empty());
    assert_eq!(e.spatial_scene.debug.vertices.capacity(), 0);
    let terrain_ptr = e.spatial_terrain_ptr();
    let revision = e.spatial_terrain_revision();
    let camera = e.spatial_scene.frame_camera;
    assert!(e.configure_spatial_debug(15));
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 24 + 12 + 10);
    assert!(e.spatial_debug_depth_test());
    assert!(!e.spatial_debug_truncated());
    let v = &e.spatial_scene.debug.vertices;
    for (line, pair) in v[24..32].chunks_exact(2).enumerate() {
        let indices = [0, 1, 2, 5];
        assert_eq!(
            pair[0].position,
            e.spatial_scene.billboards[indices[line]].position
        );
        assert_eq!(
            pair[1].position,
            e.spatial_scene.billboards[indices[(line + 1) % 4]].position
        );
    }
    assert_eq!(v[36].position, [0., 16., 0.]);
    assert_eq!(v[37].position, [0., 24., 0.]);
    assert_eq!(v[36].color, [1., 0., 1., 1.]);
    assert!(e.set_physics_body_height_span(a.id, a.generation, 3, 64., 12.));
    e.build_render_commands();
    assert_eq!(e.spatial_scene.debug.vertices[36].position, [0., 64., 0.]);
    assert_eq!(e.spatial_scene.debug.vertices[37].position, [0., 76., 0.]);
    assert_eq!(e.spatial_terrain_ptr(), terrain_ptr);
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert_eq!(e.spatial_scene.frame_camera, camera);
    assert_eq!(e.spatial_debug_abi_version(), 1);
    assert_eq!(e.spatial_debug_vertex_stride(), 11);
    assert_eq!(e.spatial_abi_version(), 2);
}

#[test]
fn spatial_debug_flags_and_frame_lifecycle_never_retain_stale_lines() {
    let mut e = setup();
    assert!(e.configure_spatial_debug(1));
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 24);
    assert!(!e.spatial_debug_depth_test());
    assert!(!e.configure_spatial_debug(128));
    assert!(!e.configure_spatial_debug(8));
    assert_eq!(e.spatial_debug_len(), 24, "invalid options are atomic");
    e.update_frame(0., false, false, false);
    assert_eq!(e.spatial_debug_len(), 0);
    assert_eq!(e.spatial_debug_flags(), 0);
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 24);
    assert!(e.configure_spatial_debug(0));
    assert_eq!(e.spatial_debug_len(), 0);
    e.build_render_commands();
    assert_eq!(e.spatial_debug_flags(), 0);
    assert!(e.configure_spatial_debug(9));
    e.build_render_commands();
    e.clear_spatial_scene();
    assert_eq!(e.spatial_debug_flags(), 0);
    assert_eq!(e.spatial_debug_len(), 0);
    assert!(!e.configure_spatial_debug(9));
    e.use_data_scene();
    assert_eq!(e.spatial_debug_len(), 0);
}

#[test]
fn spatial_debug_budget_is_bounded_and_steady_capacity_is_reused() {
    let mut e = setup();
    let mut handles = Vec::new();
    for _ in 0..3000 {
        let a = sprite(&mut e, 71, 0., 0., 0);
        handles.extend([a.id, a.generation]);
    }
    let styles: Vec<f32> = (0..3000).flat_map(|_| [1., 0.5, 0.]).collect();
    assert!(e.configure_spatial_billboards(&handles, &styles));
    assert!(e.configure_spatial_debug(2));
    let capacity = e.spatial_scene.debug.vertices.capacity();
    let ptr = e.spatial_debug_ptr();
    for _ in 0..3 {
        e.build_render_commands();
        assert_eq!(e.spatial_debug_len(), 32768);
        assert!(e.spatial_debug_truncated());
        assert_eq!(e.spatial_debug_ptr(), ptr);
        assert_eq!(e.spatial_scene.debug.vertices.capacity(), capacity);
    }
    assert!(e.configure_spatial_debug(0));
    assert!(!e.spatial_debug_truncated());
    assert_eq!(e.spatial_debug_len(), 0);
}

#[test]
fn spatial_debug_filters_stale_billboard_handles_and_offscreen_terrain() {
    let mut e = setup();
    let a = sprite(&mut e, 71, 0., 0., 0);
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    assert!(e.configure_spatial_debug(3));
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 36);
    e.world.despawn(a);
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 24);
    assert!(e.configure_spatial_camera(&[
        0., 10000., 100., 200., 10000., 16., 0., 200., 0.1, 1000., 400., 300.
    ]));
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 0);
    assert_eq!(e.spatial_debug_flags(), 3);
}

fn physics_body(e: &mut Engine) -> Entity {
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 0., y: 0. });
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(2., 3., false, CollisionLayer::Player).with_offset(4., 5.),
    );
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId(3), 16., 8.).unwrap());
    a
}

#[test]
fn spatial_debug_colliders_use_native_offset_span_and_enabled_flags_without_visuals() {
    let mut e = setup();
    let a = physics_body(&mut e);
    assert!(e.configure_spatial_debug(16));
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 24);
    let v = &e.spatial_scene.debug.vertices;
    assert!(v.iter().all(|v| (2. ..=6.).contains(&v.position[0])
        && (16. ..=24.).contains(&v.position[1])
        && (-8. ..=-2.).contains(&v.position[2])));
    assert!(v.iter().all(|v| v.color == [0.1, 1., 0.2, 1.]));
    let mut c = e.world.collider(a).unwrap();
    c.is_trigger = true;
    e.world.set_aabb_collider(a, c);
    e.build_render_commands();
    assert!(e
        .spatial_scene
        .debug
        .vertices
        .iter()
        .all(|v| v.color == [1., 0.5, 0., 1.]));
    c.enabled = false;
    e.world.set_aabb_collider(a, c);
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 0);
    c.enabled = true;
    e.world.set_aabb_collider(a, c);
    let mut body = crate::components::RigidBody::kinematic();
    body.enabled = false;
    e.world.set_rigid_body(a, body);
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 0);
}

#[test]
fn spatial_debug_all_native_shapes_compound_and_chain_preserve_geometry() {
    let mut e = setup();
    let a = physics_body(&mut e);
    assert!(e.configure_spatial_debug(16));
    e.world
        .set_circle_collider(a, CircleCollider::new(3., false, CollisionLayer::Player));
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 96);
    e.world.set_oriented_box_collider(
        a,
        OrientedBoxCollider::new(
            2.,
            3.,
            core::f32::consts::FRAC_PI_4,
            false,
            CollisionLayer::Player,
        ),
    );
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 24);
    assert!(e
        .spatial_scene
        .debug
        .vertices
        .iter()
        .any(|v| v.position[0].abs() > 3.));
    e.world.set_capsule_collider(
        a,
        CapsuleCollider::new(-3., 0., 3., 0., 2., false, CollisionLayer::Player),
    );
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 198);
    e.world.set_edge_collider(
        a,
        EdgeCollider::new(-3., 0., 3., 0., false, CollisionLayer::Player),
    );
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 6);
    let mut vertices = [Transform2D::default(); MAX_CHAIN_COLLIDER_VERTICES];
    vertices[0] = Transform2D { x: -3., y: 0. };
    vertices[1] = Transform2D { x: 0., y: 3. };
    vertices[2] = Transform2D { x: 3., y: 0. };
    e.world.set_chain_collider(
        a,
        ChainCollider::new(vertices, 3, false, false, CollisionLayer::Player),
    );
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 12);
    let mut vertices = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
    vertices[0] = Transform2D { x: -3., y: 0. };
    vertices[1] = Transform2D { x: 0., y: 3. };
    vertices[2] = Transform2D { x: 3., y: 0. };
    e.world.set_convex_polygon_collider(
        a,
        ConvexPolygonCollider::new(vertices, 3, false, CollisionLayer::Player),
    );
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 18);
    e.world
        .set_aabb_collider(a, AabbCollider::new(2., 3., false, CollisionLayer::Player));
    assert!(e
        .world
        .add_compound_collider(
            a,
            CompoundCollider::new(CompoundColliderShape::Circle(
                CircleCollider::new(3., true, CollisionLayer::Player).with_offset(8., 0.)
            ))
        )
        .is_some());
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 120);
    assert!(e
        .spatial_scene
        .debug
        .vertices
        .iter()
        .any(|v| v.position[0] == 11. && v.color == [1., 0.5, 0., 1.]));
}

#[test]
fn spatial_debug_floor_labels_distinguish_native_floor_and_unrestricted_height() {
    let mut e = setup();
    let a = physics_body(&mut e);
    assert!(e.configure_spatial_debug(64));
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 38, "terrain F0 and body F3");
    let before = e.spatial_scene.debug.vertices.clone();
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId(8), 32., 8.).unwrap());
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 42, "F8 has seven segments");
    assert!(e
        .spatial_scene
        .debug
        .vertices
        .iter()
        .all(|v| v.color == [1.; 4]));
    assert!(e
        .spatial_scene
        .debug
        .vertices
        .iter()
        .any(|v| v.position[1] > 40.));
    e.world.clear_height_span(a);
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 30, "F- does not claim floor zero");
    assert_ne!(
        before[20].position,
        e.spatial_scene.debug.vertices[20].position
    );
}

#[test]
fn spatial_debug_sweep_contacts_are_real_hits_and_navigation_probes_do_not_replace_them() {
    let mut e = setup();
    let a = sprite(&mut e, 71, 0., 0., 0);
    e.world
        .set_aabb_collider(a, AabbCollider::new(2., 2., false, CollisionLayer::Player));
    assert!(e.configure_data_scene_body(a.id, a.generation, 1, true, 0, 16., 8.));
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    assert!(e.configure_spatial_actor(a.id, a.generation, 16., 8., 8.));
    let wall = e.world.spawn_entity();
    e.world.set_transform(wall, Transform2D { x: 10., y: 0. });
    e.world
        .set_aabb_collider(wall, AabbCollider::new(2., 8., false, CollisionLayer::Wall));
    e.world
        .set_height_span(wall, HeightSpan::new(PhysicsFloorId(0), 16., 8.).unwrap());
    assert!(e.configure_spatial_debug(32));
    assert!(e.move_spatial_body(a.id, a.generation, 16., 0., 8., 8.));
    assert!(e.world.transform(a).unwrap().x <= 6.00001);
    e.build_render_commands();
    let before = e.spatial_scene.debug.vertices.clone();
    assert!(!before.is_empty());
    assert!(before
        .iter()
        .all(|v| v.color == [1., 0.1, 0.1, 1.] && v.position[1] == 20.));
    assert!(
        before.iter().any(|v| (v.position[0] - 8.).abs() < 0.001),
        "{before:?}"
    );
    assert!(e.move_data_scene_spatial_actor_to(-8., 0., 0, 16., 8., 0., true));
    e.build_render_commands();
    assert_eq!(before.len(), e.spatial_scene.debug.vertices.len());
    for (a, b) in before.iter().zip(&e.spatial_scene.debug.vertices) {
        assert_eq!(a.position, b.position);
        assert_eq!(a.color, b.color);
    }
    assert!(!e.move_data_scene_spatial_actor_to(10., 0., 0, 16., 8., 0., true));
    e.build_render_commands();
    assert_eq!(before.len(), e.spatial_scene.debug.vertices.len());
    for (a, b) in before.iter().zip(&e.spatial_scene.debug.vertices) {
        assert_eq!(a.position, b.position);
        assert_eq!(a.color, b.color);
    }
    e.world.despawn(wall);
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 0);
    assert!(e.move_spatial_body(a.id, a.generation, -8., 0., 8., 8.));
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 0);
}

#[test]
fn spatial_debug_rigid_snapshot_and_work_limits_do_not_run_collision_queries() {
    let mut e = setup();
    let a = physics_body(&mut e);
    let b = physics_body(&mut e);
    for _ in 0..257 {
        e.world.record_rigid_contact_impulse(RigidContactImpulse {
            entity_a: a,
            entity_b: b,
            point_x: 4.,
            point_y: 5.,
            normal_x: 1.,
            normal_y: 0.,
            normal_impulse: 1.,
            tangent_impulse: 0.,
        });
    }
    assert!(e.configure_spatial_debug(32));
    let queries = e.physics_counters.collision_pairs;
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 256 * 6);
    assert!(e.spatial_debug_truncated());
    assert_eq!(queries, e.physics_counters.collision_pairs);
    assert!(e.configure_spatial_debug(16));
    for _ in 0..2050 {
        let p = e.world.spawn_entity();
        e.world.set_transform(
            p,
            Transform2D {
                x: 100000.,
                y: 100000.,
            },
        );
        e.world
            .set_aabb_collider(p, AabbCollider::new(1., 1., false, CollisionLayer::Wall));
    }
    e.build_render_commands();
    assert!(e.spatial_debug_truncated());
    assert_eq!(e.spatial_debug_len(), 48);
    for _ in 0..4097 {
        e.world.spawn_entity();
    }
    assert!(e.configure_spatial_debug(64));
    e.build_render_commands();
    assert!(e.spatial_debug_truncated());
    assert!(e.spatial_debug_len() <= 32768);
    assert!(e.configure_spatial_debug(0));
    e.build_render_commands();
    assert_eq!(e.spatial_debug_len(), 0);
    assert!(!e.spatial_debug_truncated());
}

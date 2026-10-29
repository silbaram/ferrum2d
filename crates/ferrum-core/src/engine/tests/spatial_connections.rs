use super::{data_scene_visuals::sprite, *};
use crate::components::{CircleCollider, CompoundCollider, CompoundColliderShape};
use crate::components::{HeightSpan, PhysicsFloorId};

fn surface(x: f32, y: f32, w: f32, d: f32, a: f32, b: f32) -> [f32; 11] {
    [x, y, w, d, 0., a, b, 1., 1., 1., 1.]
}
fn actor(e: &mut Engine, x: f32, y: f32) -> Entity {
    let a = sprite(e, 71, x, y, 0);
    e.world
        .set_aabb_collider(a, AabbCollider::new(2., 2., false, CollisionLayer::Player));
    assert!(e.configure_data_scene_body(a.id, a.generation, 1, true, 0, 0., 8.));
    a
}
fn setup() -> (Engine, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(400., 300.);
    assert!(e.configure_spatial_camera(&[
        0., 48., 100., 200., 48., 16., 0., 200., 0.1, 1000., 400., 300.
    ]));
    let a = actor(&mut e, 16., 16.);
    assert!(e.configure_spatial_billboards(&[a.id, a.generation], &[1., 0.5, 0.]));
    assert!(e.configure_spatial_terrain(
        &[
            surface(0., 0., 32., 32., 0., 0.),
            surface(32., 0., 32., 32., 16., 16.)
        ]
        .concat(),
        &[1, 0, 16777215, 1, 2, 1, 16777215, 1]
    ));
    (e, a)
}
fn pose(e: &Engine, a: Entity) -> (f32, f32, u32, f32) {
    let p = e.world.transform(a).unwrap();
    let s = e.world.height_span(a).unwrap();
    (p.x, p.y, s.floor.0, s.elevation)
}

#[test]
fn spatial_connections_cross_both_directions_on_same_entity_without_render_revision_changes() {
    let (mut e, a) = setup();
    assert!(e.spatial_scene.configure_connections(&[1, 2]));
    e.build_render_commands();
    let revision = e.spatial_terrain_revision();
    let terrain = e.spatial_terrain_ptr();
    let before = e.spatial_scene.billboards.clone();
    assert!(e.move_spatial_body(a.id, a.generation, 32., 0., 16., 16.));
    assert_eq!(pose(&e, a), (48., 16., 1, 16.));
    e.build_render_commands();
    for (lo, hi) in before.iter().zip(&e.spatial_scene.billboards) {
        assert_eq!(hi.position[1] - lo.position[1], 16.);
    }
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert_eq!(e.spatial_terrain_ptr(), terrain);
    assert!(e.move_spatial_body(a.id, a.generation, -32., 0., 16., 16.));
    assert_eq!(pose(&e, a), (16., 16., 0, 0.));
    assert!(e.world.is_current_entity(a));
}

#[test]
fn spatial_connections_climb_ramp_to_bridge_and_preserve_unlinked_underpass() {
    let (mut e, a) = setup();
    assert!(e.configure_spatial_terrain(
        &[
            surface(0., 0., 32., 32., 0., 0.),
            surface(0., 32., 32., 32., 0., 32.),
            [0., 64., 32., 32., 24., 32., 32., 1., 1., 1., 1.],
            surface(0., 64., 32., 32., 0., 0.)
        ]
        .concat(),
        &[1, 0, 16777215, 1, 2, 0, 16777215, 5, 3, 1, 16777215, 9, 4, 0, 16777215, 1]
    ));
    assert!(e.spatial_scene.configure_connections(&[2, 3]));
    assert!(e.move_spatial_body(a.id, a.generation, 0., 64., 8., 8.));
    assert_eq!(pose(&e, a), (16., 80., 1, 32.));
    assert!(e.move_spatial_body(a.id, a.generation, 0., -64., 8., 8.));
    assert_eq!(pose(&e, a), (16., 16., 0, 0.));
    e.world.set_transform(a, Transform2D { x: 48., y: 80. });
    assert!(e.move_spatial_body(a.id, a.generation, -32., 0., 8., 8.));
    assert_eq!(pose(&e, a), (16., 80., 0, 0.));
}

#[test]
fn spatial_connections_enforce_step_drop_and_gateway_clearance() {
    let (mut e, a) = setup();
    assert!(e.spatial_scene.configure_connections(&[1, 2]));
    assert!(e.move_spatial_body(a.id, a.generation, 32., 0., 8., 8.));
    assert_eq!(pose(&e, a).2, 0);
    assert!(pose(&e, a).0 < 32.);
    assert!(e.move_spatial_body(a.id, a.generation, 24., 0., 16., 16.));
    assert_eq!(pose(&e, a).2, 1);
    assert!(e.move_spatial_body(a.id, a.generation, -32., 0., 16., 8.));
    assert_eq!(pose(&e, a).2, 1);
    assert!(pose(&e, a).0 >= 32.);
    assert!(e.move_spatial_body(a.id, a.generation, -24., 0., 16., 16.));
    assert_eq!(pose(&e, a).2, 0);
    e.world.set_transform(a, Transform2D { x: 16., y: 1. });
    assert!(e.move_spatial_body(a.id, a.generation, 32., 0., 16., 16.));
    assert_eq!(pose(&e, a).2, 0, "collider must fit shared edge");
}

#[test]
fn spatial_connections_sweep_source_and_destination_solids_before_committing() {
    for floor in [0, 1, 2] {
        let (mut e, a) = setup();
        assert!(e.spatial_scene.configure_connections(&[1, 2]));
        let w = sprite(&mut e, 72, 34., 16., 0);
        e.world
            .set_aabb_collider(w, AabbCollider::new(3., 12., false, CollisionLayer::Wall));
        assert!(e.world.set_height_span(
            w,
            HeightSpan::new(PhysicsFloorId(floor), if floor == 1 { 16. } else { 0. }, 8.).unwrap()
        ));
        assert!(e.move_spatial_body(a.id, a.generation, 32., 0., 16., 16.));
        if floor == 2 {
            assert_eq!(pose(&e, a), (48., 16., 1, 16.));
        } else {
            assert!(pose(&e, a).0 < 32.);
            assert_eq!(pose(&e, a).2, 0);
            assert_eq!(pose(&e, a).3, 0.);
        }
    }
}

#[test]
fn spatial_connections_reject_invalid_or_ambiguous_topology_atomically() {
    let (mut e, a) = setup();
    assert!(e.spatial_scene.configure_connections(&[1, 2]));
    for pairs in [&[1][..], &[1, 3], &[1, 1], &[1, 2, 2, 1]] {
        assert!(!e.spatial_scene.configure_connections(pairs));
    }
    assert!(e.move_spatial_body(a.id, a.generation, 32., 0., 16., 16.));
    assert_eq!(pose(&e, a).2, 1);
    assert!(e.configure_spatial_terrain(
        &[
            surface(0., 0., 32., 32., 0., 0.),
            surface(32., 0., 32., 32., 16., 16.),
            surface(32., 0., 32., 32., 32., 32.)
        ]
        .concat(),
        &[1, 0, 16777215, 1, 2, 1, 16777215, 1, 3, 2, 16777215, 1]
    ));
    assert!(!e.spatial_scene.configure_connections(&[1, 2, 1, 3]));
}

#[test]
fn spatial_gateways_reject_circular_and_compound_destination_obstacles() {
    for secondary in [false, true] {
        for floor in [0, 1, 2] {
            let (mut e, actor) = setup();
            assert!(e.spatial_scene.configure_connections(&[1, 2]));
            let wall = e.world.spawn_entity();
            e.world
                .set_transform(wall, Transform2D { x: 34.0, y: 16.0 });
            if secondary {
                e.world.set_aabb_collider(
                    wall,
                    AabbCollider::new(2.0, 2.0, false, CollisionLayer::Wall).with_offset(0.0, 40.0),
                );
            }
            assert!(e
                .world
                .add_compound_collider(
                    wall,
                    CompoundCollider::new(CompoundColliderShape::Circle(CircleCollider::new(
                        3.0,
                        false,
                        CollisionLayer::Wall
                    )))
                    .with_filter(CollisionFilter::new(
                        CollisionMask::WALL,
                        CollisionMask::ALL
                    ))
                )
                .is_some());
            assert!(e.world.set_height_span(
                wall,
                HeightSpan::new(
                    PhysicsFloorId(floor),
                    if floor == 1 { 16.0 } else { 0.0 },
                    8.0
                )
                .unwrap()
            ));
            assert!(e.move_spatial_body(actor.id, actor.generation, 32.0, 0.0, 16.0, 16.0));
            if floor == 2 {
                assert_eq!(pose(&e, actor), (48.0, 16.0, 1, 16.0));
            } else {
                assert!(
                    pose(&e, actor).0 < 32.0,
                    "secondary={secondary}, obstacle floor={floor}"
                );
                assert_eq!(pose(&e, actor).2, 0);
                assert_eq!(pose(&e, actor).3, 0.0);
            }
        }
    }
}

#[test]
fn spatial_connections_do_not_materialize_inside_a_destination_floor_solid() {
    let (mut e, a) = setup();
    assert!(e.spatial_scene.configure_connections(&[1, 2]));
    let wall = sprite(&mut e, 72, 20., 16., 0);
    e.world.set_aabb_collider(
        wall,
        AabbCollider::new(16., 12., false, CollisionLayer::Wall),
    );
    e.world
        .set_height_span(wall, HeightSpan::new(PhysicsFloorId(1), 16., 8.).unwrap());
    assert!(e.move_spatial_body(a.id, a.generation, 32., 0., 16., 16.));
    assert_eq!(pose(&e, a).2, 0);
    assert!(pose(&e, a).0 < 32.);
}

#[test]
fn spatial_connections_tiny_crossings_commit_floor_only_after_actual_xy_crosses_edge() {
    let (mut e, a) = setup();
    assert!(e.spatial_scene.configure_connections(&[1, 2]));
    e.world.set_transform(
        a,
        Transform2D {
            x: 31.99995,
            y: 16.,
        },
    );
    assert!(e.move_spatial_body(a.id, a.generation, 0.00008, 0., 16., 16.));
    assert!(pose(&e, a).0 >= 32.);
    assert_eq!(pose(&e, a).2, 1);
    assert!(e.move_spatial_body(a.id, a.generation, -0.00008, 0., 16., 16.));
    assert!(pose(&e, a).0 < 32.);
    assert_eq!(pose(&e, a).2, 0);
}

#[test]
fn spatial_connections_terrain_replacement_clears_links_and_failure_preserves_them() {
    let (mut e, a) = setup();
    assert!(e.spatial_scene.configure_connections(&[1, 2]));
    assert!(!e.configure_spatial_terrain(&[0.], &[]));
    assert!(e.move_spatial_body(a.id, a.generation, 32., 0., 16., 16.));
    assert_eq!(pose(&e, a).2, 1);
    assert!(e.move_spatial_body(a.id, a.generation, -32., 0., 16., 16.));
    assert!(e.configure_spatial_terrain(
        &[
            surface(0., 0., 32., 32., 0., 0.),
            surface(32., 0., 32., 32., 16., 16.)
        ]
        .concat(),
        &[1, 0, 16777215, 1, 2, 1, 16777215, 3]
    ));
    assert!(e.move_spatial_body(a.id, a.generation, 32., 0., 16., 16.));
    assert_eq!(
        pose(&e, a).2,
        0,
        "generic stair inference must not bypass explicit links"
    );
}

#[test]
fn spatial_connections_reject_diagonal_substeps_that_skip_an_intermediate_floor() {
    let (mut e, a) = setup();
    assert!(e.configure_spatial_terrain(
        &[
            surface(0., 0., 32., 32., 0., 0.),
            surface(32., 0., 32., 32., 0., 0.),
            surface(32., 32., 32., 32., 0., 0.)
        ]
        .concat(),
        &[1, 0, 16777215, 1, 2, 1, 16777215, 1, 3, 0, 16777215, 1]
    ));
    assert!(e.spatial_scene.configure_connections(&[1, 2, 2, 3]));
    e.world.set_transform(a, Transform2D { x: 30., y: 27. });
    assert!(e.move_spatial_body(a.id, a.generation, 6., 6., 16., 16.));
    assert_eq!(pose(&e, a), (30., 27., 0, 0.));
}

#[test]
fn spatial_connections_large_move_visits_each_link_and_invalid_full_config_keeps_scene() {
    let (mut e, a) = setup();
    assert!(e.configure_spatial_terrain(
        &[
            surface(0., 0., 32., 32., 0., 0.),
            surface(32., 0., 32., 32., 16., 16.),
            surface(64., 0., 32., 32., 32., 32.)
        ]
        .concat(),
        &[1, 0, 16777215, 1, 2, 1, 16777215, 1, 3, 2, 16777215, 1]
    ));
    assert!(e.spatial_scene.configure_connections(&[1, 2, 2, 3]));
    let revision = e.spatial_terrain_revision();
    let camera = e.spatial_scene.camera.unwrap().parameters;
    assert!(!e.configure_spatial_scene_connected(&camera, &[], &[], &[], &[], &[], &[], &[1, 99]));
    assert_eq!(e.spatial_terrain_revision(), revision);
    assert!(e.move_spatial_body(a.id, a.generation, 64., 0., 16., 16.));
    assert_eq!(pose(&e, a), (80., 16., 2, 32.));
}

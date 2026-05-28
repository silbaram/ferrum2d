use super::*;

#[test]
fn mask_contacts_and_manifolds_support_custom_categories() {
    let mut world = World::default();
    let sensor_category = CollisionMask::bit(8).expect("bit index is valid");
    let actor_category = CollisionMask::bit(9).expect("bit index is valid");
    let sensor = spawn_custom_body(&mut world, 10.0, 10.0, sensor_category, actor_category);
    let actor = spawn_custom_body(&mut world, 12.0, 10.0, actor_category, sensor_category);

    let contacts = CollisionSystem::build_mask_contacts(&world, sensor_category, actor_category);
    let manifolds = CollisionSystem::build_mask_manifolds(&world, actor_category, sensor_category);

    assert_eq!(contacts.len(), 1);
    assert_eq!(
        contacts[0],
        CollisionContact {
            pair: CollisionPair {
                a: sensor,
                b: actor,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 8.0,
            point_x: 15.0,
            point_y: 10.0,
        }
    );
    assert_eq!(manifolds.len(), 1);
    assert_eq!(
        manifolds[0].pair,
        CollisionPair {
            a: actor,
            b: sensor,
        }
    );
    assert_eq!(manifolds[0].point_count, 2);
}

#[test]
fn aabb_contact_reports_normal_and_penetration() {
    let contact = CollisionSystem::aabb_contact(
        Transform2D { x: 10.0, y: 10.0 },
        collider(5.0, 5.0),
        Transform2D { x: 18.0, y: 10.0 },
        collider(5.0, 5.0),
    )
    .unwrap();

    assert_eq!(
        contact,
        AabbContact {
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 2.0,
        }
    );
}

#[test]
fn aabb_contact_respects_collider_offsets() {
    let contact = CollisionSystem::aabb_contact(
        Transform2D { x: 0.0, y: 0.0 },
        collider(2.0, 2.0).with_offset(10.0, 0.0),
        Transform2D { x: 15.0, y: 0.0 },
        collider(4.0, 4.0),
    )
    .unwrap();

    assert_eq!(
        contact,
        AabbContact {
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 1.0,
        }
    );
}

#[test]
fn build_layer_contacts_returns_oriented_contact() {
    let mut world = World::default();
    let player = world.spawn_player(10.0, 10.0, 0);
    let enemy = world.spawn_enemy(12.0, 10.0, 0);

    let contacts = CollisionSystem::build_layer_contacts(
        &world,
        CollisionLayer::Player,
        CollisionLayer::Enemy,
    );

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: player,
                b: enemy,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 28.0,
            point_x: 28.0,
            point_y: 10.0,
        }]
    );
}

#[test]
fn build_contacts_supports_circle_pairs() {
    let mut world = World::default();
    let first = spawn_custom_circle(
        &mut world,
        0.0,
        0.0,
        5.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_circle(
        &mut world,
        8.0,
        0.0,
        5.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: first,
                b: second,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 2.0,
            point_x: 5.0,
            point_y: 0.0,
        }]
    );
}

#[test]
fn build_contacts_supports_capsule_circle_pairs() {
    let mut world = World::default();
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let circle_entity = spawn_custom_circle(
        &mut world,
        7.5,
        0.0,
        2.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: capsule_entity,
                b: circle_entity,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_x: 6.0,
            point_y: 0.0,
        }]
    );
}

#[test]
fn build_contacts_supports_circle_edge_pairs() {
    let mut world = World::default();
    let edge_entity = spawn_custom_edge(
        &mut world,
        0.0,
        0.0,
        edge(-5.0, 0.0, 5.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let circle_entity = spawn_custom_circle(
        &mut world,
        0.0,
        0.75,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(contacts.len(), 1);
    assert_eq!(
        contacts[0].pair,
        CollisionPair {
            a: edge_entity,
            b: circle_entity,
        }
    );
    assert_eq!(contacts[0].normal_x, 0.0);
    assert!(contacts[0].normal_y > 0.99);
    assert!(contacts[0].penetration > 0.24);
    assert!(contacts[0].point_x.abs() <= 0.01);
    assert!(contacts[0].point_y.abs() <= 0.01);
}

#[test]
fn build_contacts_supports_aabb_capsule_pairs() {
    let mut world = World::default();
    let aabb_entity = spawn_custom_body(
        &mut world,
        0.0,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(aabb_entity, collider(1.0, 1.0));
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        2.5,
        0.0,
        capsule(-1.0, 0.0, 1.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: aabb_entity,
                b: capsule_entity,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_x: 1.0,
            point_y: 0.0,
        }]
    );
}

#[test]
fn build_contacts_supports_capsule_capsule_pairs() {
    let mut world = World::default();
    let first = spawn_custom_capsule(
        &mut world,
        0.0,
        0.0,
        capsule(-5.0, 0.0, 5.0, 0.0, 2.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_capsule(
        &mut world,
        0.0,
        2.5,
        capsule(-5.0, 0.0, 5.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(contacts.len(), 1);
    assert_eq!(
        contacts[0].pair,
        CollisionPair {
            a: first,
            b: second,
        }
    );
    assert_eq!(contacts[0].normal_x, 0.0);
    assert_eq!(contacts[0].normal_y, 1.0);
    assert_eq!(contacts[0].penetration, 0.5);
    assert!(contacts[0].point_x.is_finite());
    assert!(contacts[0].point_y.is_finite());
}

#[test]
fn build_contacts_supports_capsule_edge_pairs() {
    let mut world = World::default();
    let edge_entity = spawn_custom_edge(
        &mut world,
        0.0,
        0.0,
        edge(-6.0, 0.0, 6.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        0.0,
        0.75,
        capsule(-2.0, 0.0, 2.0, 0.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(contacts.len(), 1);
    assert_eq!(
        contacts[0].pair,
        CollisionPair {
            a: edge_entity,
            b: capsule_entity,
        }
    );
    assert_eq!(contacts[0].normal_x, 0.0);
    assert!(contacts[0].normal_y > 0.99);
    assert!(contacts[0].penetration > 0.24);
    assert!(contacts[0].point_x.is_finite());
    assert!(contacts[0].point_y.is_finite());
}

#[test]
fn build_layer_contacts_supports_oriented_box_aabb_pairs() {
    let mut world = World::default();
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(1.0, 1.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::PLAYER,
    );
    let aabb_entity = spawn_custom_body(
        &mut world,
        1.5,
        0.0,
        CollisionMask::PLAYER,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(
        aabb_entity,
        AabbCollider::new(1.0, 1.0, true, CollisionLayer::Player),
    );

    let contacts = CollisionSystem::build_layer_contacts(
        &world,
        CollisionLayer::Enemy,
        CollisionLayer::Player,
    );

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: oriented_entity,
                b: aabb_entity,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_x: 0.75,
            point_y: 0.0,
        }]
    );
}

#[test]
fn build_contacts_supports_oriented_box_circle_pairs() {
    let mut world = World::default();
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(2.0, 1.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let circle_entity = spawn_custom_circle(
        &mut world,
        2.5,
        0.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: oriented_entity,
                b: circle_entity,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_x: 2.0,
            point_y: 0.0,
        }]
    );
}

#[test]
fn build_contacts_supports_oriented_box_oriented_box_pairs() {
    let mut world = World::default();
    let first = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(2.0, 1.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_oriented_box(
        &mut world,
        3.0,
        0.0,
        oriented_box(2.0, 1.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: first,
                b: second,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 1.0,
            point_x: 1.5,
            point_y: 0.0,
        }]
    );
}

#[test]
fn build_contacts_supports_oriented_box_capsule_pairs() {
    let mut world = World::default();
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(2.0, 1.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        2.5,
        0.0,
        capsule(0.0, -1.0, 0.0, 1.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(contacts.len(), 1);
    assert_eq!(
        contacts[0].pair,
        CollisionPair {
            a: oriented_entity,
            b: capsule_entity,
        }
    );
    assert_eq!(contacts[0].normal_x, 1.0);
    assert_eq!(contacts[0].normal_y, 0.0);
    assert_eq!(contacts[0].penetration, 0.5);
    assert!(contacts[0].point_x.is_finite());
    assert!(contacts[0].point_y.is_finite());
}

#[test]
fn build_contacts_supports_convex_polygon_aabb_pairs() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let aabb_entity = spawn_custom_body(
        &mut world,
        2.5,
        0.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    world.set_aabb_collider(aabb_entity, collider(1.0, 1.0));

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: polygon_entity,
                b: aabb_entity,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_x: 1.75,
            point_y: 0.0,
        }]
    );
}

#[test]
fn build_contacts_supports_convex_polygon_circle_pairs() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let circle_entity = spawn_custom_circle(
        &mut world,
        2.5,
        0.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: polygon_entity,
                b: circle_entity,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_x: 1.75,
            point_y: 0.0,
        }]
    );
}

#[test]
fn build_contacts_supports_convex_polygon_oriented_box_pairs() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let oriented_entity = spawn_custom_oriented_box(
        &mut world,
        2.5,
        0.0,
        oriented_box(1.0, 1.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: polygon_entity,
                b: oriented_entity,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_x: 1.75,
            point_y: 0.0,
        }]
    );
}

#[test]
fn build_contacts_supports_convex_polygon_capsule_pairs() {
    let mut world = World::default();
    let polygon_entity = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let capsule_entity = spawn_custom_capsule(
        &mut world,
        2.5,
        0.0,
        capsule(0.0, -1.0, 0.0, 1.0, 1.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: polygon_entity,
                b: capsule_entity,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_x: 1.75,
            point_y: 0.0,
        }]
    );
}

#[test]
fn build_contacts_supports_convex_polygon_convex_polygon_pairs() {
    let mut world = World::default();
    let first = spawn_custom_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    let second = spawn_custom_convex_polygon(
        &mut world,
        3.5,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let contacts = CollisionSystem::build_contacts(&world);

    assert_eq!(
        contacts,
        vec![CollisionContact {
            pair: CollisionPair {
                a: first,
                b: second,
            },
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: 0.5,
            point_x: 1.75,
            point_y: 0.0,
        }]
    );
}

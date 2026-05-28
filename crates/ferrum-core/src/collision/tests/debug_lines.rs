use super::*;

#[test]
fn contact_debug_lines_report_contact_normal() {
    let mut world = World::default();
    world.spawn_player(10.0, 10.0, 0);
    world.spawn_enemy(12.0, 10.0, 0);

    let lines = CollisionSystem::build_contact_debug_lines(&world, 8.0);

    assert_eq!(lines.len(), 3);
    assert_eq!(
        lines[0],
        PhysicsDebugLine {
            x0: 28.0,
            y0: 10.0,
            x1: 36.0,
            y1: 10.0,
            r: 1.0,
            g: 0.2,
            b: 0.1,
            a: 1.0,
        }
    );
    assert_eq!(lines[1].x0, 25.0);
    assert_eq!(lines[1].x1, 31.0);
    assert_eq!(lines[2].y0, 7.0);
    assert_eq!(lines[2].y1, 13.0);
}

#[test]
fn contact_debug_lines_report_oriented_box_contact_normal() {
    let mut world = World::default();
    spawn_custom_oriented_box(
        &mut world,
        0.0,
        0.0,
        oriented_box(2.0, 1.0, 0.0),
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );
    spawn_custom_circle(
        &mut world,
        2.5,
        0.0,
        1.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let lines = CollisionSystem::build_contact_debug_lines(&world, 8.0);

    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0].x0, 2.0);
    assert_eq!(lines[0].y0, 0.0);
    assert_eq!(lines[0].x1, 10.0);
    assert_eq!(lines[0].y1, 0.0);
}

#[test]
fn contact_debug_lines_reject_invalid_length() {
    let mut world = World::default();
    world.spawn_player(10.0, 10.0, 0);
    world.spawn_enemy(12.0, 10.0, 0);

    let lines = CollisionSystem::build_contact_debug_lines(&world, 0.0);

    assert!(lines.is_empty());
}

#[test]
fn broadphase_debug_lines_report_proxy_bounds() {
    let mut world = World::default();
    spawn_custom_body(
        &mut world,
        10.0,
        20.0,
        CollisionMask::ENEMY,
        CollisionMask::ENEMY,
    );

    let lines = CollisionSystem::build_broadphase_debug_lines(&world);

    assert_eq!(
        lines,
        vec![
            PhysicsDebugLine {
                x0: 5.0,
                y0: 15.0,
                x1: 15.0,
                y1: 15.0,
                r: 0.1,
                g: 0.75,
                b: 1.0,
                a: 0.55,
            },
            PhysicsDebugLine {
                x0: 15.0,
                y0: 15.0,
                x1: 15.0,
                y1: 25.0,
                r: 0.1,
                g: 0.75,
                b: 1.0,
                a: 0.55,
            },
            PhysicsDebugLine {
                x0: 15.0,
                y0: 25.0,
                x1: 5.0,
                y1: 25.0,
                r: 0.1,
                g: 0.75,
                b: 1.0,
                a: 0.55,
            },
            PhysicsDebugLine {
                x0: 5.0,
                y0: 25.0,
                x1: 5.0,
                y1: 15.0,
                r: 0.1,
                g: 0.75,
                b: 1.0,
                a: 0.55,
            },
        ]
    );
}

#[test]
fn physics_debug_lines_include_broadphase_bounds_before_contacts() {
    let mut world = World::default();
    world.spawn_player(10.0, 10.0, 0);
    world.spawn_enemy(12.0, 10.0, 0);

    let lines = CollisionSystem::build_physics_debug_lines(&world, 8.0);

    assert_eq!(lines.len(), 11);
    assert_eq!(lines[0].r, 0.1);
    assert_eq!(lines[8].r, 1.0);
    assert_eq!(lines[8].x0, 28.0);
    assert_eq!(lines[8].x1, 36.0);
    assert_eq!(lines[9].x0, 25.0);
    assert_eq!(lines[10].y1, 13.0);
}

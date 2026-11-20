use super::*;

fn scene(space: Space, flipped: bool, composite: bool) -> (PhysicsWorld3d, BodyId, BodyId) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let floor = Shape::Box {
        half_extents: [5.0, 0.5, 5.0],
    };
    let actor = if composite {
        Shape::Compound {
            parts: [-0.2, 0.2]
                .into_iter()
                .map(|x| ShapePart {
                    pose: Pose {
                        position: [x, 0.0, 0.0],
                        ..Pose::default()
                    },
                    shape: Shape::Sphere { radius: 0.5 },
                })
                .collect(),
        }
    } else {
        Shape::Box {
            half_extents: [0.5; 3],
        }
    };
    let (wall, moving);
    if flipped {
        moving = body(
            &mut world,
            BodyKind::KinematicVelocity,
            [0.0, 0.5, 0.0],
            actor,
        );
        wall = body(&mut world, BodyKind::Fixed, [0.0, -0.5, 0.0], floor);
    } else {
        wall = body(&mut world, BodyKind::Fixed, [0.0, -0.5, 0.0], floor);
        moving = body(
            &mut world,
            BodyKind::KinematicVelocity,
            [0.0, 0.5, 0.0],
            actor,
        );
    }
    step(&mut world, 1);
    assert!(world.backend.narrow_phase.contact_pairs().any(|pair| !pair
        .rigid()
        .unwrap()
        .manifolds
        .is_empty()));
    world.capture_snapshot().unwrap();
    (world, wall, moving)
}

#[test]
fn native_pending_removals_public_capture_preserves_history_and_original_continuation() {
    let mut cases = 0;
    for space in [Space::PlanarXy, Space::Spatial] {
        for flipped in [false, true] {
            for composite in [false, true] {
                for remove_body in [false, true] {
                    for reuse in [false, true] {
                        let (mut world, wall, moving) = scene(space, flipped, composite);
                        let collider = world.collider_ids(wall).unwrap().next().unwrap();
                        let before = world.capture_snapshot().unwrap();
                        if remove_body {
                            world.remove_body(wall).unwrap();
                        } else {
                            world.remove_collider(collider).unwrap();
                        }
                        if reuse {
                            let replacement = body(
                                &mut world,
                                BodyKind::Fixed,
                                [100.0, 100.0, 0.0],
                                Shape::Sphere { radius: 0.1 },
                            );
                            let fresh = world.collider_ids(replacement).unwrap().next().unwrap();
                            assert_eq!(fresh.slot, collider.slot);
                            assert_ne!(fresh.generation, collider.generation);
                        }
                        let raw = postcard::to_allocvec(&Capture { world: &world }).unwrap();
                        rp::validate_stored_references(&world.backend, REFERENCE_LIMITS).unwrap();
                        islands::validate(&world.backend).unwrap();
                        super::super::contact_numerics::validate(&world.backend).unwrap();
                        let guard = rp::validate_stored_contact_workspaces(
                            &world.backend,
                            super::super::contact_workspaces::LIMITS,
                        );
                        std::eprintln!("PENDING_REMOVAL {space:?} flip{flipped} composite{composite} body{remove_body} reuse{reuse} references/islands/numerics=Ok workspace={guard:?}");
                        let pending = world
                            .capture_snapshot()
                            .expect("normal pending collider removal must capture");
                        assert_eq!(
                            postcard::to_allocvec(&Capture { world: &world }).unwrap(),
                            raw
                        );
                        let mut restored = PhysicsWorld3d::from_snapshot(&pending).unwrap();
                        assert_eq!(
                            restored.capture_snapshot().unwrap().encoded_bytes(),
                            pending.encoded_bytes()
                        );
                        let mut live = PhysicsWorld3d::from_snapshot(&before).unwrap();
                        live.restore_snapshot(&pending).unwrap();
                        assert_eq!(
                            live.capture_snapshot().unwrap().encoded_bytes(),
                            pending.encoded_bytes()
                        );
                        for _ in 0..6 {
                            world.step();
                            restored.step();
                            live.step();
                            same(&world, &restored, &[moving]);
                            same(&world, &live, &[moving]);
                            let mut a = Vec::new();
                            let mut b = Vec::new();
                            let mut c = Vec::new();
                            world.drain_collision_events(&mut a);
                            restored.drain_collision_events(&mut b);
                            live.drain_collision_events(&mut c);
                            assert_eq!(a, b);
                            assert_eq!(a, c);
                        }
                        cases += 1;
                    }
                }
            }
        }
    }
    std::eprintln!("PENDING_REMOVAL_PUBLIC cases={cases}");
}

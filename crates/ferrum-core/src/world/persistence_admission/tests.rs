use super::*;
use crate::components::*;
use crate::gameplay_variables::{
    GameplayVariableMutationOperation, GameplayVariableMutationTrigger, GameplayVariableScope,
    GameplayVariableType,
};

fn limits() -> WorldStorageAdmissionLimits {
    WorldStorageAdmissionLimits {
        max_entity_slots: 1024,
        max_joint_slots: 4096,
        max_work: 1_000_000,
        max_scratch_bytes: 1_000_000,
    }
}
fn bytes(world: &World) -> Vec<u8> {
    #[derive(serde::Serialize)]
    struct Capture<'a> {
        #[serde(with = "crate::world::persistence::State")]
        world: &'a World,
    }
    crate::checkpoint_codec::encode(&Capture { world }).unwrap()
}
fn decoded(world: &World) -> World {
    crate::world::persistence::copy_for_test(world)
}
fn admitted(world: &World) -> WorldStorageAdmissionStats {
    let before = bytes(world);
    let result = world.validate_storage_admission(limits()).unwrap();
    assert_eq!(
        before,
        bytes(world),
        "admission must not rebuild or repair any persisted field"
    );
    result
}
fn add_all(world: &mut World, a: Entity, b: Entity) -> [(JointKind, u32, u32); 8] {
    let d = world.add_distance_joint(DistanceJoint::new(a, b, 2.));
    let r = world.add_rope_joint(RopeJoint::new(a, b, 3.));
    let s = world.add_spring_joint(SpringJoint::new(a, b, 2.));
    let p = world.add_pulley_joint(PulleyJoint::new(a, b, 3.));
    let v = world.add_revolute_joint(RevoluteJoint::new(a, b));
    let l = world.add_prismatic_joint(PrismaticJoint::new(a, b));
    let w = world.add_weld_joint(WeldJoint::new(a, b));
    let g = world.add_gear_joint(GearJoint::new(a, b, 1.));
    [
        (JointKind::Distance, d.index, d.generation),
        (JointKind::Rope, r.index, r.generation),
        (JointKind::Spring, s.index, s.generation),
        (JointKind::Pulley, p.index, p.generation),
        (JointKind::Revolute, v.index, v.generation),
        (JointKind::Prismatic, l.index, l.generation),
        (JointKind::Weld, w.index, w.generation),
        (JointKind::Gear, g.index, g.generation),
    ]
}
fn fixture() -> (World, Entity, Entity) {
    let mut world = World::default();
    let entities = (0..17).map(|_| world.spawn_entity()).collect::<Vec<_>>();
    for (i, &entity) in entities.iter().enumerate() {
        if i % 3 == 0 {
            world.set_transform(entity, Transform2D { x: i as f32, y: 1. });
            world.set_velocity(entity, Velocity { vx: 0.25, vy: -0.5 });
        }
    }
    add_all(&mut world, entities[0], entities[2]);
    add_all(&mut world, entities[0], entities[0]);
    for i in [1, 4, 8, 12] {
        world.despawn(entities[i]);
    }
    // Spare allocation capacity is not an arena length invariant.
    world.transforms.reserve_exact(19);
    (world, entities[0], entities[2])
}

#[test]
fn sparse_lifecycle_private_codec_admission_keeps_bytes_and_exact_continuation() {
    let (mut world, a, b) = fixture();
    let mut copy = decoded(&world);
    assert_eq!(world.alive_indices, copy.alive_indices);
    assert_eq!(admitted(&world), admitted(&copy));
    assert_eq!(admitted(&world).live_joints, 16);
    for tick in 0..30 {
        let x = world.spawn_entity();
        let y = copy.spawn_entity();
        assert_eq!(x, y);
        world.set_transform(
            x,
            Transform2D {
                x: tick as f32,
                y: 2.,
            },
        );
        copy.set_transform(
            y,
            Transform2D {
                x: tick as f32,
                y: 2.,
            },
        );
        if tick % 2 == 0 {
            world.despawn(x);
            copy.despawn(y);
        }
        if tick == 4 {
            world.despawn(a);
            copy.despawn(a);
        }
        if tick == 5 {
            let x = world.spawn_entity();
            let y = copy.spawn_entity();
            assert_eq!(x, y);
            assert_eq!(add_all(&mut world, x, b), add_all(&mut copy, y, b));
        }
        world.update(0.01);
        copy.update(0.01);
        assert_eq!(world.snapshot(), copy.snapshot());
        assert_eq!(bytes(&world), bytes(&copy));
        assert_eq!(admitted(&world), admitted(&copy));
    }
}

#[test]
fn reset_preserves_sparse_slots_but_incidents_are_a_valid_lazy_prefix() {
    let (mut world, _, _) = fixture();
    world.reset_preserving_gameplay_variables();
    assert_eq!(world.entity_capacity(), 17);
    assert!(world.joint_incident_counts.is_empty());
    assert_eq!(admitted(&world).live_entities, 0);
    let mut copy = decoded(&world);
    for _ in 0..3 {
        assert_eq!(world.spawn_entity(), copy.spawn_entity());
    }
    assert_eq!(world.joint_incident_counts.len(), 3);
    assert!(world.joint_incident_counts.len() < world.entity_capacity());
    assert_eq!(admitted(&world), admitted(&copy));
    let a = world.entity_at_index(0).unwrap();
    let b = world.entity_at_index(2).unwrap();
    assert_eq!(add_all(&mut world, a, b), add_all(&mut copy, a, b));
    world.despawn(b);
    copy.despawn(b);
    assert_eq!(admitted(&world), admitted(&copy));
    for _ in 0..20 {
        assert_eq!(world.spawn_entity(), copy.spawn_entity());
        assert_eq!(admitted(&world), admitted(&copy));
    }
    assert_eq!(bytes(&world), bytes(&copy));
}

#[test]
fn pending_observations_keep_retired_generations_and_guard_does_not_repair_them() {
    let mut world = World::default();
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x: 1., y: 2. });
    world.set_rigid_body(entity, RigidBody::dynamic(1.));
    world.begin_render_interpolation_step();
    world.end_render_interpolation_step();
    assert!(world.configure_gameplay_variable(
        1,
        GameplayVariableType::Integer,
        GameplayVariableScope::Scene,
        0.,
        0.
    ));
    assert!(world.add_gameplay_variable_mutation_trigger(
        entity,
        GameplayVariableMutationTrigger::new(
            1,
            7,
            1,
            GameplayVariableMutationOperation::Increment,
            2.
        )
        .unwrap()
    ));
    world.despawn(entity);
    let replacement = world.spawn_entity();
    assert_ne!(replacement.generation, entity.generation);
    assert_eq!(world.retired_gameplay_variable_mutation_trigger_count(), 1);
    let mut copy = decoded(&world);
    admitted(&copy);
    assert_eq!(
        world.retired_gameplay_variable_mutation_trigger(0),
        copy.retired_gameplay_variable_mutation_trigger(0)
    );
    world.clear_retired_gameplay_variable_mutation_triggers();
    copy.clear_retired_gameplay_variable_mutation_triggers();
    assert_eq!(bytes(&world), bytes(&copy));
    admitted(&copy);
}

#[test]
fn all_eight_joint_arenas_reuse_free_order_and_self_endpoints_count_once() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let first = add_all(&mut world, a, b);
    add_all(&mut world, a, a);
    admitted(&world);
    for &(kind, index, generation) in &first {
        assert!(world.clear_joint_by_kind(kind, index, generation));
    }
    admitted(&world);
    let mut copy = decoded(&world);
    assert_eq!(add_all(&mut world, a, b), add_all(&mut copy, a, b));
    world.despawn(a);
    copy.despawn(a);
    admitted(&world);
    admitted(&copy);
    assert_eq!(bytes(&world), bytes(&copy));
    let next = world.spawn_entity();
    assert_eq!(next, copy.spawn_entity());
    assert_eq!(add_all(&mut world, next, b), add_all(&mut copy, next, b));
    assert_eq!(bytes(&world), bytes(&copy));
}

#[test]
fn max_generation_contract_distinguishes_entity_retirement_from_joint_wrap() {
    // Metadata seeds represent reachable long histories, not a new-validator
    // repair. Subsequent mutation is solely through the existing producers.
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    world.despawn(a);
    world.generations[a.id as usize] = u32::MAX;
    world.joint_incident_counts[a.id as usize].generation = u32::MAX - 1;
    let mut world = decoded(&world);
    admitted(&world);
    let a = world.spawn_entity();
    assert_eq!(a.generation, u32::MAX);
    admitted(&world);
    world.despawn(a);
    assert!(!world.free_list.contains(&a.id));
    admitted(&world);
    let fresh = world.spawn_entity();
    assert_ne!(fresh.id, a.id);
    let id = world.add_distance_joint(DistanceJoint::new(fresh, b, 1.));
    world.distance_joint_generations[id.index as usize] = u32::MAX;
    let mut world = decoded(&world);
    admitted(&world);
    assert!(world.clear_joint_by_kind(JointKind::Distance, id.index, u32::MAX));
    assert_eq!(world.distance_joint_generations[id.index as usize], 0);
    admitted(&world);
    let replacement = world.add_distance_joint(DistanceJoint::new(fresh, b, 1.));
    assert_eq!(replacement.index, id.index);
    assert_eq!(replacement.generation, 0);
    admitted(&world);
}

#[test]
fn exact_and_one_below_limits_are_preflighted_and_leave_bytes_unchanged() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    world.add_distance_joint(DistanceJoint::new(a, b, 1.));
    let world = decoded(&world);
    let stats = admitted(&world);
    assert_eq!(
        stats,
        WorldStorageAdmissionStats {
            entity_slots: 2,
            live_entities: 2,
            joint_slots: 1,
            live_joints: 1,
            work_units: 188,
            scratch_bytes: 11
        }
    );
    let exact = WorldStorageAdmissionLimits {
        max_entity_slots: 2,
        max_joint_slots: 1,
        max_work: 188,
        max_scratch_bytes: 11,
    };
    assert_eq!(world.validate_storage_admission(exact), Ok(stats));
    for (limited, kind) in [
        (
            WorldStorageAdmissionLimits {
                max_entity_slots: 1,
                ..exact
            },
            EntitySlots,
        ),
        (
            WorldStorageAdmissionLimits {
                max_joint_slots: 0,
                ..exact
            },
            JointSlots,
        ),
        (
            WorldStorageAdmissionLimits {
                max_work: 187,
                ..exact
            },
            Work,
        ),
        (
            WorldStorageAdmissionLimits {
                max_scratch_bytes: 10,
                ..exact
            },
            ScratchBytes,
        ),
    ] {
        let before = bytes(&world);
        assert_eq!(world.validate_storage_admission(limited), Err(Limit(kind)));
        assert_eq!(before, bytes(&world));
    }
    let empty = World::default();
    assert_eq!(
        empty
            .validate_storage_admission(WorldStorageAdmissionLimits {
                max_entity_slots: 0,
                max_joint_slots: 0,
                max_work: HEADER_WORK,
                max_scratch_bytes: 0
            })
            .unwrap()
            .scratch_bytes,
        0
    );
    assert!(matches!(
        zeroed::<u32>(usize::MAX),
        Err(WorldStorageAdmissionError::Allocation)
    ));
}

#[test]
fn private_codec_entity_and_component_corruptions_are_guard_only_rejections() {
    type Case = (&'static str, fn(&mut World));
    let cases: [Case; 16] = [
        ("generation-length", |w| {
            w.generations.pop();
        }),
        ("position-length", |w| {
            w.alive_positions.pop();
        }),
        ("duplicate-alive", |w| {
            w.alive_indices.push(w.alive_indices[0])
        }),
        ("out-of-range-alive", |w| w.alive_indices[0] = w.alive.len()),
        ("bad-backlink", |w| {
            w.alive_positions[w.alive_indices[0]] = usize::MAX
        }),
        ("out-of-range-free", |w| {
            w.free_list[0] = u32::MAX;
        }),
        ("dead-position", |w| {
            w.alive_positions[w.free_list[0] as usize] = 0;
        }),
        ("dead-alive-index", |w| {
            w.alive_indices[0] = w.free_list[0] as usize;
        }),
        ("live-free", |w| w.free_list.push(w.alive_indices[0] as u32)),
        ("duplicate-free", |w| w.free_list.push(w.free_list[0])),
        ("missing-free", |w| w.free_list.clear()),
        ("dead-generation-zero", |w| {
            w.generations[w.free_list[0] as usize] = 0
        }),
        ("short-transform", |w| {
            w.transforms.pop();
        }),
        ("long-sprite", |w| w.sprites.push(None)),
        ("dead-component", |w| {
            w.transforms[w.free_list[0] as usize] = Some(Transform2D { x: 9., y: 8. })
        }),
        ("dead-compound", |w| {
            w.compound_colliders[w.free_list[0] as usize].push(CompoundCollider::new(
                CompoundColliderShape::Aabb(AabbCollider::new(
                    1.,
                    1.,
                    false,
                    CollisionLayer::Enemy,
                )),
            ))
        }),
    ];
    for (name, corrupt) in cases {
        let (mut candidate, _, _) = fixture();
        corrupt(&mut candidate);
        let candidate = decoded(&candidate);
        let before = bytes(&candidate);
        assert!(
            matches!(
                candidate.validate_storage_admission(limits()),
                Err(Invalid(_))
            ),
            "{name}"
        );
        assert_eq!(before, bytes(&candidate), "{name} was repaired or mutated");
    }
}

fn corrupt_endpoint(world: &mut World, kind: JointKind) {
    macro_rules! stale {
        ($field:ident) => {{
            world.$field[0].as_mut().unwrap().entity_b.generation += 1;
        }};
    }
    match kind {
        JointKind::Distance => stale!(distance_joints),
        JointKind::Rope => stale!(rope_joints),
        JointKind::Spring => stale!(spring_joints),
        JointKind::Pulley => stale!(pulley_joints),
        JointKind::Revolute => stale!(revolute_joints),
        JointKind::Prismatic => stale!(prismatic_joints),
        JointKind::Weld => stale!(weld_joints),
        JointKind::Gear => stale!(gear_joints),
    }
}
#[test]
fn all_eight_private_codec_joint_endpoint_candidates_are_rejected_without_rebuild() {
    for kind in [
        JointKind::Distance,
        JointKind::Rope,
        JointKind::Spring,
        JointKind::Pulley,
        JointKind::Revolute,
        JointKind::Prismatic,
        JointKind::Weld,
        JointKind::Gear,
    ] {
        let (mut candidate, _, _) = fixture();
        corrupt_endpoint(&mut candidate, kind);
        let candidate = decoded(&candidate);
        let before = bytes(&candidate);
        assert_eq!(
            candidate.validate_storage_admission(limits()),
            Err(Invalid(WorldStorageInvariant::JointEndpoint {
                kind,
                slot: 0
            }))
        );
        assert_eq!(before, bytes(&candidate));
    }
}

#[test]
fn private_codec_joint_free_and_incident_corruptions_are_not_repaired() {
    type Case = (&'static str, fn(&mut World));
    let cases: [Case; 11] = [
        ("generation-length", |w| {
            w.distance_joint_generations.pop();
        }),
        ("small-removal-capacity", |w| {
            w.distance_joint_free_list = Vec::new()
        }),
        ("free-live-slot", |w| w.distance_joint_free_list.push(0)),
        ("free-out-of-range", |w| {
            w.distance_joint_free_list.push(u32::MAX)
        }),
        ("missing-empty-slot", |w| {
            w.clear_joint_by_kind(JointKind::Distance, 0, 0);
            w.distance_joint_free_list.clear();
        }),
        ("duplicate-free-slot", |w| {
            w.clear_joint_by_kind(JointKind::Distance, 0, 0);
            w.distance_joint_free_list.push(0);
        }),
        ("extra-incident-slot", |w| {
            w.joint_incident_counts.push(w.joint_incident_counts[0]);
        }),
        ("wrong-live-incident-generation", |w| {
            w.joint_incident_counts[0].generation += 1;
        }),
        ("dead-nonzero-incidents", |w| {
            w.joint_incident_counts[w.free_list[0] as usize].count = 1;
        }),
        ("wrong-live-incidents", |w| {
            w.joint_incident_counts[0].count = 0
        }),
        ("missing-live-incident-prefix", |w| {
            w.joint_incident_counts.clear()
        }),
    ];
    for (name, corrupt) in cases {
        let (mut candidate, _, _) = fixture();
        corrupt(&mut candidate);
        let candidate = decoded(&candidate);
        let before = bytes(&candidate);
        assert!(
            matches!(
                candidate.validate_storage_admission(limits()),
                Err(Invalid(_))
            ),
            "{name}"
        );
        assert_eq!(before, bytes(&candidate));
    }
}

#[test]
fn grown_incident_gap_from_retired_max_reset_is_admitted_without_repair() {
    let mut seed = World::default();
    let retired = seed.spawn_entity();
    seed.spawn_entity();
    seed.generations[retired.id as usize] = u32::MAX;
    seed.joint_incident_counts[retired.id as usize].generation = u32::MAX;
    let mut world = decoded(&seed);
    world.reset_preserving_gameplay_variables();
    admitted(&world);
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    assert_eq!(a.id, 1);
    assert_eq!(world.joint_incident_counts[0].count, 0);
    assert_eq!(world.joint_incident_counts[0].generation, 0);
    let joint = world.add_distance_joint(DistanceJoint::new(a, b, 2.));
    let mut world = decoded(&world);
    admitted(&world);
    world.despawn(a);
    assert!(world.distance_joint(joint).is_none());
    admitted(&world);
    let next = world.spawn_entity();
    assert_eq!(next.id, a.id);
    world.add_distance_joint(DistanceJoint::new(next, b, 3.));
    admitted(&decoded(&world));
}

use super::*;
use crate::components::gameplay::*;
use crate::components::*;
use crate::entity::Entity;
use crate::gameplay_variables::*;
use crate::render_command::*;
use crate::world::ground_shadow::{GroundShadowCaster, GroundShadowShape};
use crate::world::sprite_playback::{SpriteClip, SpritePlayback};
use std::sync::Arc;
mod variants;
mod wire;

fn limits() -> WorldPayloadAdmissionLimits {
    WorldPayloadAdmissionLimits {
        storage: WorldStorageAdmissionLimits {
            max_entity_slots: 4096,
            max_joint_slots: 4096,
            max_work: 100_000_000,
            max_scratch_bytes: 1_000_000,
        },
        max_work: 100_000_000,
        max_scratch_bytes: 1_000_000,
        max_nested_items: 1_000_000,
    }
}
fn bytes(w: &World) -> Vec<u8> {
    #[derive(serde::Serialize)]
    struct Capture<'a> {
        #[serde(with = "crate::world::persistence::State")]
        world: &'a World,
    }
    crate::checkpoint_codec::encode(&Capture { world: w }).unwrap()
}
fn copied(w: &World) -> World {
    crate::world::persistence::copy_for_test(w)
}
fn admitted(w: &World) -> WorldPayloadAdmissionStats {
    let before = bytes(w);
    let stats = w.validate_payload_admission(limits()).unwrap();
    assert_eq!(before, bytes(w));
    stats
}
fn rejected(w: &World) -> WorldPayloadAdmissionError {
    let w = copied(w);
    let before = bytes(&w);
    // Prove the damage is payload, not the older structural guard rejecting it.
    w.validate_storage_admission(limits().storage).unwrap();
    let result = w.validate_payload_admission(limits()).unwrap_err();
    assert!(
        matches!(result, WorldPayloadAdmissionError::Invalid { .. }),
        "{result:?}"
    );
    assert_eq!(before, bytes(&w));
    result
}
fn add_all(w: &mut World, a: Entity, b: Entity) {
    w.add_distance_joint(DistanceJoint::new(a, b, 2.));
    w.add_rope_joint(RopeJoint::new(a, b, 3.));
    w.add_spring_joint(SpringJoint::new(a, b, 2.));
    w.add_pulley_joint(PulleyJoint::new(a, b, 4.));
    w.add_revolute_joint(RevoluteJoint::new(a, b));
    w.add_prismatic_joint(PrismaticJoint::new(a, b));
    w.add_weld_joint(WeldJoint::new(a, b));
    w.add_gear_joint(GearJoint::new(a, b, -2.));
}
// Coverage fixture deliberately fills independent slots directly inside World's
// owner harness; it is not claimed as a single public authoring history. Real
// producer/reset/reuse continuation is tested separately below.
fn coverage() -> World {
    let mut w = World::default();
    let a = w.spawn_player(0., 0., 0);
    let b = w.spawn_enemy(8., 0., 1);
    w.set_rigid_body(a, RigidBody::dynamic(2.));
    w.set_velocity(a, Velocity { vx: 1., vy: -2. });
    w.sprite_normal_materials[0] = Some(SpriteNormalMaterial {
        normal_texture: 2,
        flags: 0,
    });
    w.sprite_lighting_materials[0] = Some(SpriteLightingMaterial {
        mode: 2,
        alpha_cutoff: 0.5,
    });
    w.sprite_surface_materials[0] = Some(SpriteSurfaceMaterial {
        flags: 1,
        emission: [32., 64., 2.],
        ..Default::default()
    });
    w.sprite_light_masks[0] = Some(SpriteLightMasks {
        light_mask: 3,
        shadow_mask: 255,
    });
    w.sprite_nine_slices[0] = SpriteNineSlice::from_record(&[16., 16., 2., 2., 2., 2., 1., 0., 1.]);
    w.sprite_animations[0] =
        SpriteAnimation::atlas(&[SpriteFrame::FULL], 8., &[SpriteFrame::FULL], 4.);
    w.sprite_playbacks[0] = Some(SpritePlayback {
        clips: Arc::from([SpriteClip::uniform(1, vec![SpriteFrame::FULL], 8., true)]),
        active: 0,
        elapsed: 0.,
        paused: false,
        flip_x: false,
        flip_y: true,
    });
    w.ground_shadows[0] = Some(GroundShadowCaster::new(
        GroundShadowShape::Box,
        4.,
        3.,
        0.5,
        0,
    ));
    w.height_spans[0] = HeightSpan::new(PhysicsFloorId(2), -3., 4.);
    w.projectile_arcs[0] = ProjectileArc::new(PhysicsFloorId(2), -3., 1., -2., 9.8, 0.5);
    w.circle_colliders[0] = Some(CircleCollider::new(2., false, CollisionLayer::Wall));
    w.oriented_box_colliders[0] = Some(OrientedBoxCollider::new(
        1.,
        2.,
        0.,
        false,
        CollisionLayer::Wall,
    ));
    w.capsule_colliders[0] = Some(CapsuleCollider::new(
        -1.,
        0.,
        1.,
        0.,
        0.5,
        false,
        CollisionLayer::Wall,
    ));
    w.edge_colliders[0] = Some(EdgeCollider::new(
        -1.,
        0.,
        1.,
        0.,
        false,
        CollisionLayer::Wall,
    ));
    let mut chain = [Transform2D::default(); MAX_CHAIN_COLLIDER_VERTICES];
    chain[1].x = 2.;
    w.chain_colliders[0] = Some(ChainCollider::new(
        chain,
        2,
        false,
        false,
        CollisionLayer::Wall,
    ));
    let mut vertices = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
    vertices[1].x = 2.;
    vertices[2].y = 2.;
    w.convex_polygon_colliders[0] = Some(ConvexPolygonCollider::new(
        vertices,
        3,
        false,
        CollisionLayer::Wall,
    ));
    w.set_collider_material(a, PhysicsMaterial::default());
    w.set_gameplay_lifetime(a, -0.01);
    w.set_projectile_policy_at(
        0,
        ProjectilePolicy {
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Bounce,
        },
    );
    w.set_health(a, -2.);
    w.set_damage(a, -1.);
    w.set_score_reward(a, u32::MAX);
    w.set_gameplay_faction(a, GameplayFaction::new(31, u32::MAX).unwrap());
    w.set_gameplay_tags(a, GameplayTags::new(u32::MAX).unwrap());
    w.upsert_action_binding(a, ActionBinding::projectile(1, 0.1, 100., 1., 2.));
    w.set_pickup(a, Pickup::new(u32::MAX, 0, false));
    w.set_interaction(a, Interaction::new(7, 3., false));
    w.set_movement_pattern(
        a,
        MovementPattern::Chase {
            target: MovementTarget::Entity(b),
            speed: -3.,
        },
    );
    w.add_collision_reaction(
        a,
        CollisionReaction::Knockback {
            target: CollisionTarget::OtherEntity,
            impulse: -2.,
        },
    );
    w.set_behavior_state_machine(a, BehaviorStateMachine::new(u32::MAX));
    w.add_behavior_state_transition(a, BehaviorStateTransition::new(1, 2, 0));
    w.add_behavior_state_enter_action(
        a,
        BehaviorStateEnterAction::new(2, 3, BehaviorStateEnterActionPhase::NextFramePrePhysics),
    );
    w.set_gameplay_timer_trigger(a, GameplayTimerTrigger::new(9, 0.1));
    let mut mutations = GameplayVariableMutationTriggerSet::default();
    mutations.upsert(
        GameplayVariableMutationTrigger::new(
            0,
            0,
            64,
            GameplayVariableMutationOperation::Increment,
            -1.,
        )
        .unwrap(),
    );
    w.gameplay_variable_mutation_triggers[0] = Some(mutations);
    add_all(&mut w, a, b);
    w
}

#[test]
fn all_component_and_joint_payloads_round_trip_without_mutation() {
    let w = coverage();
    let stats = admitted(&w);
    assert!(stats.nested_items > 0);
    let copy = copied(&w);
    assert_eq!(stats, admitted(&copy));
    assert_eq!(bytes(&w), bytes(&copy));
}
#[test]
fn exact_and_one_below_combined_work_scratch_and_nested_budgets() {
    let w = copied(&coverage());
    let stats = admitted(&w);
    let before = bytes(&w);
    let exact = WorldPayloadAdmissionLimits {
        max_work: stats.work_units,
        max_scratch_bytes: stats.scratch_bytes,
        max_nested_items: stats.nested_items,
        ..limits()
    };
    assert_eq!(w.validate_payload_admission(exact), Ok(stats));
    for (limit, kind) in [
        (
            WorldPayloadAdmissionLimits {
                max_work: stats.work_units - 1,
                ..exact
            },
            0,
        ),
        (
            WorldPayloadAdmissionLimits {
                max_scratch_bytes: stats.scratch_bytes - 1,
                ..exact
            },
            1,
        ),
        (
            WorldPayloadAdmissionLimits {
                max_nested_items: stats.nested_items - 1,
                ..exact
            },
            2,
        ),
    ] {
        let e = w.validate_payload_admission(limit).unwrap_err();
        assert!(match kind {0=>e==WorldPayloadAdmissionError::Work,1=>matches!(e,WorldPayloadAdmissionError::Storage(WorldStorageAdmissionError::Limit(super::super::persistence_admission::WorldStorageAdmissionLimit::ScratchBytes))),_=>e==WorldPayloadAdmissionError::NestedItems},"{e:?}");
        assert_eq!(before, bytes(&w));
    }
    let empty = World::default();
    let stats = admitted(&empty);
    assert_eq!(stats.work_units, 83);
    assert_eq!(stats.scratch_bytes, 0);
    assert_eq!(stats.nested_items, 0);
}
#[test]
fn storage_success_is_an_actual_precondition_before_payload_indexing() {
    let mut w = coverage();
    w.transforms.clear();
    let w = copied(&w);
    let before = bytes(&w);
    assert!(matches!(
        w.validate_payload_admission(limits()),
        Err(WorldPayloadAdmissionError::Storage(_))
    ));
    assert_eq!(before, bytes(&w));
}
#[test]
fn pending_signed_hdr_disabled_sentinels_and_reverse_limits_remain_valid() {
    let mut w = coverage();
    let a = w.entity_at_index(0).unwrap();
    w.sprites[0].as_mut().unwrap().r = 128.;
    w.sprites[0].as_mut().unwrap().width = -4.;
    w.set_rigid_body(a, RigidBody::static_body());
    admitted(&w);
    w.set_rigid_body(a, RigidBody::kinematic());
    admitted(&w);
    w.set_rigid_body(a, RigidBody::dynamic(2.).with_gravity_scale(-3.));
    w.apply_force(a, Velocity { vx: -5., vy: 3. });
    w.apply_impulse(a, Velocity { vx: 4., vy: -2. });
    w.apply_torque(a, -4.);
    w.apply_angular_impulse(a, -7.);
    w.distance_joints[0].as_mut().unwrap().rest_length = -3.;
    w.revolute_joints[0].as_mut().unwrap().lower_angle = 4.;
    w.revolute_joints[0].as_mut().unwrap().upper_angle = -4.;
    w.revolute_joints[0].as_mut().unwrap().motor_speed = -10.;
    w.revolute_joints[0].as_mut().unwrap().max_motor_torque = -3.;
    w.colliders[0].as_mut().unwrap().enabled = false;
    w.colliders[0].as_mut().unwrap().half_width = -2.;
    let before = bytes(&w);
    admitted(&copied(&w));
    assert_eq!(before, bytes(&w));
}
#[test]
fn stale_entity_and_reconfigured_variable_references_are_safe_history() {
    let mut w = World::default();
    let a = w.spawn_player(0., 0., 0);
    let b = w.spawn_enemy(10., 0., 1);
    w.gameplay_variables.configure(
        1,
        GameplayVariableType::Real,
        GameplayVariableScope::Scene,
        0.,
        0.,
    );
    let guard =
        GameplayVariableComparison::new(1, GameplayVariableComparisonOperator::GreaterThan, 0, 0.)
            .unwrap();
    let mut machine = BehaviorStateMachine::new(0);
    machine.push_transition(BehaviorStateTransition::new_variable(0, 1, guard));
    w.set_behavior_state_machine(a, machine);
    let mut interaction = Interaction::new(1, 2., false);
    interaction.guard = guard;
    w.set_interaction(a, interaction);
    w.set_movement_pattern(
        a,
        MovementPattern::Chase {
            target: MovementTarget::Entity(b),
            speed: 1.,
        },
    );
    let mut set = GameplayVariableMutationTriggerSet::default();
    set.upsert(
        GameplayVariableMutationTrigger::new(
            0,
            0,
            1,
            GameplayVariableMutationOperation::Increment,
            1.,
        )
        .unwrap(),
    );
    w.gameplay_variable_mutation_triggers[0] = Some(set);
    w.despawn(b);
    let reused = w.spawn_entity();
    assert_ne!(reused, b);
    w.gameplay_variables.clear();
    assert!(!w.gameplay_variables.supports_comparison(guard));
    admitted(&copied(&w));
    w.gameplay_variables.configure(
        1,
        GameplayVariableType::Bool,
        GameplayVariableScope::Global,
        0.,
        0.,
    );
    assert!(!w.gameplay_variables.supports_comparison(guard));
    assert!(!w.gameplay_variables.supports_mutation(
        1,
        GameplayVariableMutationOperation::Increment,
        1.
    ));
    admitted(&copied(&w));
}
#[test]
fn producer_sparse_reset_reuse_codec_continuation_is_exact() {
    let mut w = World::default();
    let a = w.spawn_player(0., 0., 0);
    let b = w.spawn_enemy(100., 0., 1);
    w.set_rigid_body(a, RigidBody::dynamic(2.));
    add_all(&mut w, a, b);
    w.set_gameplay_lifetime(b, 5.);
    w.despawn(b);
    let c = w.spawn_enemy(100., 0., 1);
    assert_ne!(b, c);
    w.set_movement_pattern(
        a,
        MovementPattern::Chase {
            target: MovementTarget::Entity(b),
            speed: 1.,
        },
    );
    w.apply_force(a, Velocity { vx: -3., vy: 2. });
    w.apply_impulse(a, Velocity { vx: 2., vy: -1. });
    let mut copy = copied(&w);
    assert_eq!(admitted(&w), admitted(&copy));
    for _ in 0..30 {
        w.update(0.01);
        copy.update(0.01);
        assert_eq!(w.snapshot(), copy.snapshot());
        assert_eq!(bytes(&w), bytes(&copy));
        assert_eq!(admitted(&w), admitted(&copy));
    }
    w.reset_preserving_gameplay_variables();
    admitted(&copied(&w));
    for _ in 0..6 {
        w.spawn_entity();
        admitted(&copied(&w));
    }
}

#[test]
fn every_named_numeric_component_and_joint_field_rejects_nan_after_actual_codec() {
    type Case = (&'static str, fn(&mut World));
    let cases: [Case; 209] = [
        ("transforms.x", |w| {
            w.transforms[0].as_mut().unwrap().x = f32::NAN
        }),
        ("transforms.y", |w| {
            w.transforms[0].as_mut().unwrap().y = f32::NAN
        }),
        ("velocities.vx", |w| {
            w.velocities[0].as_mut().unwrap().vx = f32::NAN
        }),
        ("velocities.vy", |w| {
            w.velocities[0].as_mut().unwrap().vy = f32::NAN
        }),
        ("rotations.radians", |w| {
            w.rotations[0].as_mut().unwrap().radians = f32::NAN
        }),
        ("angular_velocities.radians_per_second", |w| {
            w.angular_velocities[0].as_mut().unwrap().radians_per_second = f32::NAN
        }),
        ("gameplay_timer_triggers.duration_seconds", |w| {
            w.gameplay_timer_triggers[0]
                .as_mut()
                .unwrap()
                .duration_seconds = f32::NAN
        }),
        ("gameplay_timer_triggers.remaining_seconds", |w| {
            w.gameplay_timer_triggers[0]
                .as_mut()
                .unwrap()
                .remaining_seconds = f32::NAN
        }),
        ("interactions.radius", |w| {
            w.interactions[0].as_mut().unwrap().radius = f32::NAN
        }),
        ("distance_joints.local_anchor_a_x", |w| {
            w.distance_joints[0].as_mut().unwrap().local_anchor_a_x = f32::NAN
        }),
        ("distance_joints.local_anchor_a_y", |w| {
            w.distance_joints[0].as_mut().unwrap().local_anchor_a_y = f32::NAN
        }),
        ("distance_joints.local_anchor_b_x", |w| {
            w.distance_joints[0].as_mut().unwrap().local_anchor_b_x = f32::NAN
        }),
        ("distance_joints.local_anchor_b_y", |w| {
            w.distance_joints[0].as_mut().unwrap().local_anchor_b_y = f32::NAN
        }),
        ("distance_joints.rest_length", |w| {
            w.distance_joints[0].as_mut().unwrap().rest_length = f32::NAN
        }),
        ("distance_joints.break_force", |w| {
            w.distance_joints[0].as_mut().unwrap().break_force = f32::NAN
        }),
        ("distance_joints.break_torque", |w| {
            w.distance_joints[0].as_mut().unwrap().break_torque = f32::NAN
        }),
        ("distance_joints.break_distance", |w| {
            w.distance_joints[0].as_mut().unwrap().break_distance = f32::NAN
        }),
        ("distance_joints.stiffness", |w| {
            w.distance_joints[0].as_mut().unwrap().stiffness = f32::NAN
        }),
        ("distance_joints.damping", |w| {
            w.distance_joints[0].as_mut().unwrap().damping = f32::NAN
        }),
        ("rope_joints.local_anchor_a_x", |w| {
            w.rope_joints[0].as_mut().unwrap().local_anchor_a_x = f32::NAN
        }),
        ("rope_joints.local_anchor_a_y", |w| {
            w.rope_joints[0].as_mut().unwrap().local_anchor_a_y = f32::NAN
        }),
        ("rope_joints.local_anchor_b_x", |w| {
            w.rope_joints[0].as_mut().unwrap().local_anchor_b_x = f32::NAN
        }),
        ("rope_joints.local_anchor_b_y", |w| {
            w.rope_joints[0].as_mut().unwrap().local_anchor_b_y = f32::NAN
        }),
        ("rope_joints.max_length", |w| {
            w.rope_joints[0].as_mut().unwrap().max_length = f32::NAN
        }),
        ("rope_joints.break_force", |w| {
            w.rope_joints[0].as_mut().unwrap().break_force = f32::NAN
        }),
        ("rope_joints.break_torque", |w| {
            w.rope_joints[0].as_mut().unwrap().break_torque = f32::NAN
        }),
        ("rope_joints.break_distance", |w| {
            w.rope_joints[0].as_mut().unwrap().break_distance = f32::NAN
        }),
        ("rope_joints.stiffness", |w| {
            w.rope_joints[0].as_mut().unwrap().stiffness = f32::NAN
        }),
        ("rope_joints.damping", |w| {
            w.rope_joints[0].as_mut().unwrap().damping = f32::NAN
        }),
        ("spring_joints.damping_ratio", |w| {
            w.spring_joints[0].as_mut().unwrap().damping_ratio = f32::NAN
        }),
        ("spring_joints.local_anchor_a_x", |w| {
            w.spring_joints[0].as_mut().unwrap().local_anchor_a_x = f32::NAN
        }),
        ("spring_joints.local_anchor_a_y", |w| {
            w.spring_joints[0].as_mut().unwrap().local_anchor_a_y = f32::NAN
        }),
        ("spring_joints.local_anchor_b_x", |w| {
            w.spring_joints[0].as_mut().unwrap().local_anchor_b_x = f32::NAN
        }),
        ("spring_joints.local_anchor_b_y", |w| {
            w.spring_joints[0].as_mut().unwrap().local_anchor_b_y = f32::NAN
        }),
        ("spring_joints.rest_length", |w| {
            w.spring_joints[0].as_mut().unwrap().rest_length = f32::NAN
        }),
        ("spring_joints.break_force", |w| {
            w.spring_joints[0].as_mut().unwrap().break_force = f32::NAN
        }),
        ("spring_joints.break_torque", |w| {
            w.spring_joints[0].as_mut().unwrap().break_torque = f32::NAN
        }),
        ("spring_joints.break_distance", |w| {
            w.spring_joints[0].as_mut().unwrap().break_distance = f32::NAN
        }),
        ("spring_joints.stiffness", |w| {
            w.spring_joints[0].as_mut().unwrap().stiffness = f32::NAN
        }),
        ("spring_joints.damping", |w| {
            w.spring_joints[0].as_mut().unwrap().damping = f32::NAN
        }),
        ("pulley_joints.ground_anchor_a_x", |w| {
            w.pulley_joints[0].as_mut().unwrap().ground_anchor_a_x = f32::NAN
        }),
        ("pulley_joints.ground_anchor_a_y", |w| {
            w.pulley_joints[0].as_mut().unwrap().ground_anchor_a_y = f32::NAN
        }),
        ("pulley_joints.ground_anchor_b_x", |w| {
            w.pulley_joints[0].as_mut().unwrap().ground_anchor_b_x = f32::NAN
        }),
        ("pulley_joints.ground_anchor_b_y", |w| {
            w.pulley_joints[0].as_mut().unwrap().ground_anchor_b_y = f32::NAN
        }),
        ("pulley_joints.local_anchor_a_x", |w| {
            w.pulley_joints[0].as_mut().unwrap().local_anchor_a_x = f32::NAN
        }),
        ("pulley_joints.local_anchor_a_y", |w| {
            w.pulley_joints[0].as_mut().unwrap().local_anchor_a_y = f32::NAN
        }),
        ("pulley_joints.local_anchor_b_x", |w| {
            w.pulley_joints[0].as_mut().unwrap().local_anchor_b_x = f32::NAN
        }),
        ("pulley_joints.local_anchor_b_y", |w| {
            w.pulley_joints[0].as_mut().unwrap().local_anchor_b_y = f32::NAN
        }),
        ("pulley_joints.rest_length", |w| {
            w.pulley_joints[0].as_mut().unwrap().rest_length = f32::NAN
        }),
        ("pulley_joints.ratio", |w| {
            w.pulley_joints[0].as_mut().unwrap().ratio = f32::NAN
        }),
        ("pulley_joints.break_force", |w| {
            w.pulley_joints[0].as_mut().unwrap().break_force = f32::NAN
        }),
        ("pulley_joints.break_torque", |w| {
            w.pulley_joints[0].as_mut().unwrap().break_torque = f32::NAN
        }),
        ("pulley_joints.break_distance", |w| {
            w.pulley_joints[0].as_mut().unwrap().break_distance = f32::NAN
        }),
        ("pulley_joints.stiffness", |w| {
            w.pulley_joints[0].as_mut().unwrap().stiffness = f32::NAN
        }),
        ("pulley_joints.damping", |w| {
            w.pulley_joints[0].as_mut().unwrap().damping = f32::NAN
        }),
        ("revolute_joints.local_anchor_a_x", |w| {
            w.revolute_joints[0].as_mut().unwrap().local_anchor_a_x = f32::NAN
        }),
        ("revolute_joints.local_anchor_a_y", |w| {
            w.revolute_joints[0].as_mut().unwrap().local_anchor_a_y = f32::NAN
        }),
        ("revolute_joints.local_anchor_b_x", |w| {
            w.revolute_joints[0].as_mut().unwrap().local_anchor_b_x = f32::NAN
        }),
        ("revolute_joints.local_anchor_b_y", |w| {
            w.revolute_joints[0].as_mut().unwrap().local_anchor_b_y = f32::NAN
        }),
        ("revolute_joints.break_force", |w| {
            w.revolute_joints[0].as_mut().unwrap().break_force = f32::NAN
        }),
        ("revolute_joints.break_torque", |w| {
            w.revolute_joints[0].as_mut().unwrap().break_torque = f32::NAN
        }),
        ("revolute_joints.break_distance", |w| {
            w.revolute_joints[0].as_mut().unwrap().break_distance = f32::NAN
        }),
        ("revolute_joints.lower_angle", |w| {
            w.revolute_joints[0].as_mut().unwrap().lower_angle = f32::NAN
        }),
        ("revolute_joints.upper_angle", |w| {
            w.revolute_joints[0].as_mut().unwrap().upper_angle = f32::NAN
        }),
        ("revolute_joints.motor_speed", |w| {
            w.revolute_joints[0].as_mut().unwrap().motor_speed = f32::NAN
        }),
        ("revolute_joints.max_motor_torque", |w| {
            w.revolute_joints[0].as_mut().unwrap().max_motor_torque = f32::NAN
        }),
        ("revolute_joints.stiffness", |w| {
            w.revolute_joints[0].as_mut().unwrap().stiffness = f32::NAN
        }),
        ("revolute_joints.damping", |w| {
            w.revolute_joints[0].as_mut().unwrap().damping = f32::NAN
        }),
        ("prismatic_joints.local_anchor_a_x", |w| {
            w.prismatic_joints[0].as_mut().unwrap().local_anchor_a_x = f32::NAN
        }),
        ("prismatic_joints.local_anchor_a_y", |w| {
            w.prismatic_joints[0].as_mut().unwrap().local_anchor_a_y = f32::NAN
        }),
        ("prismatic_joints.local_anchor_b_x", |w| {
            w.prismatic_joints[0].as_mut().unwrap().local_anchor_b_x = f32::NAN
        }),
        ("prismatic_joints.local_anchor_b_y", |w| {
            w.prismatic_joints[0].as_mut().unwrap().local_anchor_b_y = f32::NAN
        }),
        ("prismatic_joints.local_axis_a_x", |w| {
            w.prismatic_joints[0].as_mut().unwrap().local_axis_a_x = f32::NAN
        }),
        ("prismatic_joints.local_axis_a_y", |w| {
            w.prismatic_joints[0].as_mut().unwrap().local_axis_a_y = f32::NAN
        }),
        ("prismatic_joints.break_force", |w| {
            w.prismatic_joints[0].as_mut().unwrap().break_force = f32::NAN
        }),
        ("prismatic_joints.break_torque", |w| {
            w.prismatic_joints[0].as_mut().unwrap().break_torque = f32::NAN
        }),
        ("prismatic_joints.break_distance", |w| {
            w.prismatic_joints[0].as_mut().unwrap().break_distance = f32::NAN
        }),
        ("prismatic_joints.reference_angle", |w| {
            w.prismatic_joints[0].as_mut().unwrap().reference_angle = f32::NAN
        }),
        ("prismatic_joints.lower_translation", |w| {
            w.prismatic_joints[0].as_mut().unwrap().lower_translation = f32::NAN
        }),
        ("prismatic_joints.upper_translation", |w| {
            w.prismatic_joints[0].as_mut().unwrap().upper_translation = f32::NAN
        }),
        ("prismatic_joints.motor_speed", |w| {
            w.prismatic_joints[0].as_mut().unwrap().motor_speed = f32::NAN
        }),
        ("prismatic_joints.max_motor_force", |w| {
            w.prismatic_joints[0].as_mut().unwrap().max_motor_force = f32::NAN
        }),
        ("prismatic_joints.stiffness", |w| {
            w.prismatic_joints[0].as_mut().unwrap().stiffness = f32::NAN
        }),
        ("prismatic_joints.damping", |w| {
            w.prismatic_joints[0].as_mut().unwrap().damping = f32::NAN
        }),
        ("prismatic_joints.angular_stiffness", |w| {
            w.prismatic_joints[0].as_mut().unwrap().angular_stiffness = f32::NAN
        }),
        ("prismatic_joints.angular_damping", |w| {
            w.prismatic_joints[0].as_mut().unwrap().angular_damping = f32::NAN
        }),
        ("weld_joints.local_anchor_a_x", |w| {
            w.weld_joints[0].as_mut().unwrap().local_anchor_a_x = f32::NAN
        }),
        ("weld_joints.local_anchor_a_y", |w| {
            w.weld_joints[0].as_mut().unwrap().local_anchor_a_y = f32::NAN
        }),
        ("weld_joints.local_anchor_b_x", |w| {
            w.weld_joints[0].as_mut().unwrap().local_anchor_b_x = f32::NAN
        }),
        ("weld_joints.local_anchor_b_y", |w| {
            w.weld_joints[0].as_mut().unwrap().local_anchor_b_y = f32::NAN
        }),
        ("weld_joints.reference_angle", |w| {
            w.weld_joints[0].as_mut().unwrap().reference_angle = f32::NAN
        }),
        ("weld_joints.break_force", |w| {
            w.weld_joints[0].as_mut().unwrap().break_force = f32::NAN
        }),
        ("weld_joints.break_torque", |w| {
            w.weld_joints[0].as_mut().unwrap().break_torque = f32::NAN
        }),
        ("weld_joints.break_distance", |w| {
            w.weld_joints[0].as_mut().unwrap().break_distance = f32::NAN
        }),
        ("weld_joints.break_angle", |w| {
            w.weld_joints[0].as_mut().unwrap().break_angle = f32::NAN
        }),
        ("weld_joints.stiffness", |w| {
            w.weld_joints[0].as_mut().unwrap().stiffness = f32::NAN
        }),
        ("weld_joints.damping", |w| {
            w.weld_joints[0].as_mut().unwrap().damping = f32::NAN
        }),
        ("weld_joints.angular_stiffness", |w| {
            w.weld_joints[0].as_mut().unwrap().angular_stiffness = f32::NAN
        }),
        ("weld_joints.angular_damping", |w| {
            w.weld_joints[0].as_mut().unwrap().angular_damping = f32::NAN
        }),
        ("gear_joints.ratio", |w| {
            w.gear_joints[0].as_mut().unwrap().ratio = f32::NAN
        }),
        ("gear_joints.reference_angle", |w| {
            w.gear_joints[0].as_mut().unwrap().reference_angle = f32::NAN
        }),
        ("gear_joints.break_force", |w| {
            w.gear_joints[0].as_mut().unwrap().break_force = f32::NAN
        }),
        ("gear_joints.break_torque", |w| {
            w.gear_joints[0].as_mut().unwrap().break_torque = f32::NAN
        }),
        ("gear_joints.break_angle", |w| {
            w.gear_joints[0].as_mut().unwrap().break_angle = f32::NAN
        }),
        ("gear_joints.stiffness", |w| {
            w.gear_joints[0].as_mut().unwrap().stiffness = f32::NAN
        }),
        ("gear_joints.damping", |w| {
            w.gear_joints[0].as_mut().unwrap().damping = f32::NAN
        }),
        ("rigid_bodies.mass", |w| {
            w.rigid_bodies[0].as_mut().unwrap().mass = f32::NAN
        }),
        ("rigid_bodies.inverse_mass", |w| {
            w.rigid_bodies[0].as_mut().unwrap().inverse_mass = f32::NAN
        }),
        ("rigid_bodies.inertia", |w| {
            w.rigid_bodies[0].as_mut().unwrap().inertia = f32::NAN
        }),
        ("rigid_bodies.inverse_inertia", |w| {
            w.rigid_bodies[0].as_mut().unwrap().inverse_inertia = f32::NAN
        }),
        ("rigid_bodies.gravity_scale", |w| {
            w.rigid_bodies[0].as_mut().unwrap().gravity_scale = f32::NAN
        }),
        ("rigid_bodies.linear_damping", |w| {
            w.rigid_bodies[0].as_mut().unwrap().linear_damping = f32::NAN
        }),
        ("rigid_bodies.angular_damping", |w| {
            w.rigid_bodies[0].as_mut().unwrap().angular_damping = f32::NAN
        }),
        ("rigid_bodies.torque", |w| {
            w.rigid_bodies[0].as_mut().unwrap().torque = f32::NAN
        }),
        ("rigid_bodies.angular_impulse", |w| {
            w.rigid_bodies[0].as_mut().unwrap().angular_impulse = f32::NAN
        }),
        ("rigid_bodies.sleep_timer_seconds", |w| {
            w.rigid_bodies[0].as_mut().unwrap().sleep_timer_seconds = f32::NAN
        }),
        ("sprites.width", |w| {
            w.sprites[0].as_mut().unwrap().width = f32::NAN
        }),
        ("sprites.height", |w| {
            w.sprites[0].as_mut().unwrap().height = f32::NAN
        }),
        ("sprites.u0", |w| {
            w.sprites[0].as_mut().unwrap().u0 = f32::NAN
        }),
        ("sprites.v0", |w| {
            w.sprites[0].as_mut().unwrap().v0 = f32::NAN
        }),
        ("sprites.u1", |w| {
            w.sprites[0].as_mut().unwrap().u1 = f32::NAN
        }),
        ("sprites.v1", |w| {
            w.sprites[0].as_mut().unwrap().v1 = f32::NAN
        }),
        ("sprites.r", |w| w.sprites[0].as_mut().unwrap().r = f32::NAN),
        ("sprites.g", |w| w.sprites[0].as_mut().unwrap().g = f32::NAN),
        ("sprites.b", |w| w.sprites[0].as_mut().unwrap().b = f32::NAN),
        ("sprites.a", |w| w.sprites[0].as_mut().unwrap().a = f32::NAN),
        ("sprites.rotation_radians", |w| {
            w.sprites[0].as_mut().unwrap().rotation_radians = f32::NAN
        }),
        ("sprites.origin_x", |w| {
            w.sprites[0].as_mut().unwrap().origin_x = f32::NAN
        }),
        ("sprites.origin_y", |w| {
            w.sprites[0].as_mut().unwrap().origin_y = f32::NAN
        }),
        ("sprites.sort_order", |w| {
            w.sprites[0].as_mut().unwrap().sort_order = f32::NAN
        }),
        ("sprite_nine_slices.source_width", |w| {
            w.sprite_nine_slices[0].as_mut().unwrap().source_width = f32::NAN
        }),
        ("sprite_nine_slices.source_height", |w| {
            w.sprite_nine_slices[0].as_mut().unwrap().source_height = f32::NAN
        }),
        ("sprite_nine_slices.left", |w| {
            w.sprite_nine_slices[0].as_mut().unwrap().left = f32::NAN
        }),
        ("sprite_nine_slices.right", |w| {
            w.sprite_nine_slices[0].as_mut().unwrap().right = f32::NAN
        }),
        ("sprite_nine_slices.top", |w| {
            w.sprite_nine_slices[0].as_mut().unwrap().top = f32::NAN
        }),
        ("sprite_nine_slices.bottom", |w| {
            w.sprite_nine_slices[0].as_mut().unwrap().bottom = f32::NAN
        }),
        ("sprite_nine_slices.border_scale", |w| {
            w.sprite_nine_slices[0].as_mut().unwrap().border_scale = f32::NAN
        }),
        ("colliders.half_width", |w| {
            w.colliders[0].as_mut().unwrap().half_width = f32::NAN
        }),
        ("colliders.half_height", |w| {
            w.colliders[0].as_mut().unwrap().half_height = f32::NAN
        }),
        ("colliders.offset_x", |w| {
            w.colliders[0].as_mut().unwrap().offset_x = f32::NAN
        }),
        ("colliders.offset_y", |w| {
            w.colliders[0].as_mut().unwrap().offset_y = f32::NAN
        }),
        ("circle_colliders.radius", |w| {
            w.circle_colliders[0].as_mut().unwrap().radius = f32::NAN
        }),
        ("circle_colliders.offset_x", |w| {
            w.circle_colliders[0].as_mut().unwrap().offset_x = f32::NAN
        }),
        ("circle_colliders.offset_y", |w| {
            w.circle_colliders[0].as_mut().unwrap().offset_y = f32::NAN
        }),
        ("oriented_box_colliders.half_width", |w| {
            w.oriented_box_colliders[0].as_mut().unwrap().half_width = f32::NAN
        }),
        ("oriented_box_colliders.half_height", |w| {
            w.oriented_box_colliders[0].as_mut().unwrap().half_height = f32::NAN
        }),
        ("oriented_box_colliders.offset_x", |w| {
            w.oriented_box_colliders[0].as_mut().unwrap().offset_x = f32::NAN
        }),
        ("oriented_box_colliders.offset_y", |w| {
            w.oriented_box_colliders[0].as_mut().unwrap().offset_y = f32::NAN
        }),
        ("oriented_box_colliders.rotation_radians", |w| {
            w.oriented_box_colliders[0]
                .as_mut()
                .unwrap()
                .rotation_radians = f32::NAN
        }),
        ("capsule_colliders.start_x", |w| {
            w.capsule_colliders[0].as_mut().unwrap().start_x = f32::NAN
        }),
        ("capsule_colliders.start_y", |w| {
            w.capsule_colliders[0].as_mut().unwrap().start_y = f32::NAN
        }),
        ("capsule_colliders.end_x", |w| {
            w.capsule_colliders[0].as_mut().unwrap().end_x = f32::NAN
        }),
        ("capsule_colliders.end_y", |w| {
            w.capsule_colliders[0].as_mut().unwrap().end_y = f32::NAN
        }),
        ("capsule_colliders.radius", |w| {
            w.capsule_colliders[0].as_mut().unwrap().radius = f32::NAN
        }),
        ("capsule_colliders.offset_x", |w| {
            w.capsule_colliders[0].as_mut().unwrap().offset_x = f32::NAN
        }),
        ("capsule_colliders.offset_y", |w| {
            w.capsule_colliders[0].as_mut().unwrap().offset_y = f32::NAN
        }),
        ("edge_colliders.start_x", |w| {
            w.edge_colliders[0].as_mut().unwrap().start_x = f32::NAN
        }),
        ("edge_colliders.start_y", |w| {
            w.edge_colliders[0].as_mut().unwrap().start_y = f32::NAN
        }),
        ("edge_colliders.end_x", |w| {
            w.edge_colliders[0].as_mut().unwrap().end_x = f32::NAN
        }),
        ("edge_colliders.end_y", |w| {
            w.edge_colliders[0].as_mut().unwrap().end_y = f32::NAN
        }),
        ("edge_colliders.offset_x", |w| {
            w.edge_colliders[0].as_mut().unwrap().offset_x = f32::NAN
        }),
        ("edge_colliders.offset_y", |w| {
            w.edge_colliders[0].as_mut().unwrap().offset_y = f32::NAN
        }),
        ("chain_colliders.offset_x", |w| {
            w.chain_colliders[0].as_mut().unwrap().offset_x = f32::NAN
        }),
        ("chain_colliders.offset_y", |w| {
            w.chain_colliders[0].as_mut().unwrap().offset_y = f32::NAN
        }),
        ("convex_polygon_colliders.offset_x", |w| {
            w.convex_polygon_colliders[0].as_mut().unwrap().offset_x = f32::NAN
        }),
        ("convex_polygon_colliders.offset_y", |w| {
            w.convex_polygon_colliders[0].as_mut().unwrap().offset_y = f32::NAN
        }),
        ("convex_polygon_colliders.rotation_radians", |w| {
            w.convex_polygon_colliders[0]
                .as_mut()
                .unwrap()
                .rotation_radians = f32::NAN
        }),
        ("height_spans.elevation", |w| {
            w.height_spans[0].as_mut().unwrap().elevation = f32::NAN
        }),
        ("height_spans.height", |w| {
            w.height_spans[0].as_mut().unwrap().height = f32::NAN
        }),
        ("projectile_arcs.base_elevation", |w| {
            w.projectile_arcs[0].as_mut().unwrap().base_elevation = f32::NAN
        }),
        ("projectile_arcs.z", |w| {
            w.projectile_arcs[0].as_mut().unwrap().z = f32::NAN
        }),
        ("projectile_arcs.z_velocity", |w| {
            w.projectile_arcs[0].as_mut().unwrap().z_velocity = f32::NAN
        }),
        ("projectile_arcs.gravity", |w| {
            w.projectile_arcs[0].as_mut().unwrap().gravity = f32::NAN
        }),
        ("projectile_arcs.hit_height", |w| {
            w.projectile_arcs[0].as_mut().unwrap().hit_height = f32::NAN
        }),
        ("sprite_lighting_materials.alpha_cutoff", |w| {
            w.sprite_lighting_materials[0]
                .as_mut()
                .unwrap()
                .alpha_cutoff = f32::NAN
        }),
        ("sprite_surface_materials.specular", |w| {
            w.sprite_surface_materials[0].as_mut().unwrap().specular = f32::NAN
        }),
        ("sprite_surface_materials.roughness", |w| {
            w.sprite_surface_materials[0].as_mut().unwrap().roughness = f32::NAN
        }),
        ("ground_shadows.width", |w| {
            w.ground_shadows[0].as_mut().unwrap().width = f32::NAN
        }),
        ("ground_shadows.height", |w| {
            w.ground_shadows[0].as_mut().unwrap().height = f32::NAN
        }),
        ("ground_shadows.opacity", |w| {
            w.ground_shadows[0].as_mut().unwrap().opacity = f32::NAN
        }),
        ("collider_materials.restitution", |w| {
            w.collider_materials[0].as_mut().unwrap().restitution = f32::NAN
        }),
        ("rigid_bodies.material.restitution", |w| {
            w.rigid_bodies[0].as_mut().unwrap().material.restitution = f32::NAN
        }),
        ("collider_materials.friction", |w| {
            w.collider_materials[0].as_mut().unwrap().friction = f32::NAN
        }),
        ("rigid_bodies.material.friction", |w| {
            w.rigid_bodies[0].as_mut().unwrap().material.friction = f32::NAN
        }),
        ("collider_materials.density", |w| {
            w.collider_materials[0].as_mut().unwrap().density = f32::NAN
        }),
        ("rigid_bodies.material.density", |w| {
            w.rigid_bodies[0].as_mut().unwrap().material.density = f32::NAN
        }),
        ("collider_materials.contact_baumgarte_bias_scale", |w| {
            w.collider_materials[0]
                .as_mut()
                .unwrap()
                .contact_baumgarte_bias_scale = f32::NAN
        }),
        ("rigid_bodies.material.contact_baumgarte_bias_scale", |w| {
            w.rigid_bodies[0]
                .as_mut()
                .unwrap()
                .material
                .contact_baumgarte_bias_scale = f32::NAN
        }),
        (
            "collider_materials.max_contact_baumgarte_bias_velocity_scale",
            |w| {
                w.collider_materials[0]
                    .as_mut()
                    .unwrap()
                    .max_contact_baumgarte_bias_velocity_scale = f32::NAN
            },
        ),
        (
            "rigid_bodies.material.max_contact_baumgarte_bias_velocity_scale",
            |w| {
                w.rigid_bodies[0]
                    .as_mut()
                    .unwrap()
                    .material
                    .max_contact_baumgarte_bias_velocity_scale = f32::NAN
            },
        ),
        (
            "collider_materials.contact_position_correction_scale",
            |w| {
                w.collider_materials[0]
                    .as_mut()
                    .unwrap()
                    .contact_position_correction_scale = f32::NAN
            },
        ),
        (
            "rigid_bodies.material.contact_position_correction_scale",
            |w| {
                w.rigid_bodies[0]
                    .as_mut()
                    .unwrap()
                    .material
                    .contact_position_correction_scale = f32::NAN
            },
        ),
        (
            "collider_materials.contact_position_correction_slop_scale",
            |w| {
                w.collider_materials[0]
                    .as_mut()
                    .unwrap()
                    .contact_position_correction_slop_scale = f32::NAN
            },
        ),
        (
            "rigid_bodies.material.contact_position_correction_slop_scale",
            |w| {
                w.rigid_bodies[0]
                    .as_mut()
                    .unwrap()
                    .material
                    .contact_position_correction_slop_scale = f32::NAN
            },
        ),
        ("rigid_bodies.force.vx", |w| {
            w.rigid_bodies[0].as_mut().unwrap().force.vx = f32::NAN
        }),
        ("rigid_bodies.force.vy", |w| {
            w.rigid_bodies[0].as_mut().unwrap().force.vy = f32::NAN
        }),
        ("rigid_bodies.impulse.vx", |w| {
            w.rigid_bodies[0].as_mut().unwrap().impulse.vx = f32::NAN
        }),
        ("rigid_bodies.impulse.vy", |w| {
            w.rigid_bodies[0].as_mut().unwrap().impulse.vy = f32::NAN
        }),
        ("rigid_bodies.material.surface_velocity.vx", |w| {
            w.rigid_bodies[0]
                .as_mut()
                .unwrap()
                .material
                .surface_velocity
                .vx = f32::NAN
        }),
        ("rigid_bodies.material.surface_velocity.vy", |w| {
            w.rigid_bodies[0]
                .as_mut()
                .unwrap()
                .material
                .surface_velocity
                .vy = f32::NAN
        }),
        ("collider_materials.surface_velocity.vx", |w| {
            w.collider_materials[0]
                .as_mut()
                .unwrap()
                .surface_velocity
                .vx = f32::NAN
        }),
        ("collider_materials.surface_velocity.vy", |w| {
            w.collider_materials[0]
                .as_mut()
                .unwrap()
                .surface_velocity
                .vy = f32::NAN
        }),
        ("healths", |w| *w.healths[0].as_mut().unwrap() = f32::NAN),
        ("damages", |w| *w.damages[0].as_mut().unwrap() = f32::NAN),
        ("bullet_lifetimes", |w| {
            *w.bullet_lifetimes[0].as_mut().unwrap() = f32::NAN
        }),
        ("lifetimes.remaining_seconds", |w| {
            w.lifetimes[0].as_mut().unwrap().remaining_seconds = f32::NAN
        }),
        ("sprite_surface_materials.emission0", |w| {
            w.sprite_surface_materials[0].as_mut().unwrap().emission[0] = f32::NAN
        }),
        ("sprite_surface_materials.emission1", |w| {
            w.sprite_surface_materials[0].as_mut().unwrap().emission[1] = f32::NAN
        }),
        ("sprite_surface_materials.emission2", |w| {
            w.sprite_surface_materials[0].as_mut().unwrap().emission[2] = f32::NAN
        }),
    ];
    for (name, damage) in cases {
        let mut w = coverage();
        damage(&mut w);
        let error = rejected(&w);
        assert!(
            matches!(error, WorldPayloadAdmissionError::Invalid { .. }),
            "{name}: {error:?}"
        );
    }
}
#[test]
fn geometry_array_counts_and_nested_cells_are_checked() {
    let mut w = coverage();
    w.chain_colliders[0].as_mut().unwrap().vertex_count = 65;
    rejected(&w);
    let mut w = coverage();
    w.convex_polygon_colliders[0].as_mut().unwrap().vertex_count = 17;
    rejected(&w);
    for i in [0, 31, 63] {
        let mut w = coverage();
        w.chain_colliders[0].as_mut().unwrap().vertices[i].y = f32::NAN;
        rejected(&w);
    }
    for i in [0, 7, 15] {
        let mut w = coverage();
        w.convex_polygon_colliders[0].as_mut().unwrap().vertices[i].x = f32::NAN;
        rejected(&w);
    }
    let mut w = coverage();
    w.compound_colliders[0][0]
        .material
        .as_mut()
        .unwrap()
        .surface_velocity
        .vx = f32::NAN;
    rejected(&w);
    let mut w = coverage();
    if let CompoundColliderShape::Aabb(ref mut shape) = w.compound_colliders[0][0].shape {
        shape.offset_y = f32::NAN;
    }
    rejected(&w);
}
#[test]
fn material_masks_ranges_and_disabled_break_infinities_are_separate() {
    let mut w = coverage();
    w.sprite_light_masks[0].as_mut().unwrap().light_mask = 256;
    rejected(&w);
    let mut w = coverage();
    w.sprite_normal_materials[0].as_mut().unwrap().flags = 1;
    rejected(&w);
    let mut w = coverage();
    w.sprite_surface_materials[0].as_mut().unwrap().reserved = 1;
    rejected(&w);
    let mut w = coverage();
    w.sprite_surface_materials[0].as_mut().unwrap().emission[1] = 64.01;
    rejected(&w);
    let mut w = coverage();
    w.sprite_lighting_materials[0].as_mut().unwrap().mode = 3;
    rejected(&w);
    let mut w = coverage();
    w.gameplay_factions[0].as_mut().unwrap().faction_id = 32;
    rejected(&w);
    let mut w = coverage();
    w.gameplay_tags[0].as_mut().unwrap().mask = 0;
    rejected(&w);
    let mut w = coverage();
    w.distance_joints[0].as_mut().unwrap().break_force = f32::NEG_INFINITY;
    rejected(&w);
    let mut w = coverage();
    w.distance_joints[0].as_mut().unwrap().break_force = f32::INFINITY;
    admitted(&copied(&w));
}

#[test]
fn sparse_empty_entities_do_not_pay_for_absent_fixed_backing_arrays() {
    let mut w = World::default();
    for _ in 0..1024 {
        w.spawn_entity();
    }
    let storage = w.validate_storage_admission(limits().storage).unwrap();
    let stats = w
        .validate_payload_admission(WorldPayloadAdmissionLimits {
            max_work: 1_000_000,
            ..limits()
        })
        .unwrap();
    assert_eq!(stats.work_units - storage.work_units, 64 * 1024);
    assert_eq!(stats.nested_items, 0);
    w.behavior_state_machines[0] = Some(BehaviorStateMachine::new(0));
    let next = admitted(&w);
    assert_eq!(next.work_units - stats.work_units, 8192);
    let before = bytes(&w);
    assert_eq!(
        w.validate_payload_admission(WorldPayloadAdmissionLimits {
            max_work: next.work_units - 1,
            ..limits()
        }),
        Err(WorldPayloadAdmissionError::Work)
    );
    assert_eq!(before, bytes(&w));
}

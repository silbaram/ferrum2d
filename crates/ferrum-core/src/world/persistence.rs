//! Private complete runtime schema; never an unchecked public Deserialize implementation.
use super::*;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(remote = "World")]
pub(crate) struct State {
    unified_physics_entities: std::collections::BTreeSet<(u32, u32)>,
    impact_feedback_enabled: bool,
    impact_feedback_dropped: u32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    impact_feedback_impacts: Vec<RigidContactImpulse>,
    physics_diagnostics: physics_diagnostics::PhysicsDiagnostics,
    contact_impact_min_speed: Option<f32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    contact_impacts: Vec<RigidContactImpulse>,
    contact_impacts_dropped: u32,
    render_history: render_interpolation::RenderHistory,
    #[serde(with = "crate::checkpoint_codec::vector")]
    generations: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    free_list: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    alive: Vec<bool>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    alive_indices: Vec<usize>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    alive_positions: Vec<usize>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    transforms: Vec<Option<Transform2D>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    sprites: Vec<Option<Sprite>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    sprite_nine_slices: Vec<Option<crate::components::SpriteNineSlice>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    sprite_normal_materials: Vec<Option<crate::render_command::SpriteNormalMaterial>>,
    sprite_lighting_materials: Vec<Option<crate::render_command::SpriteLightingMaterial>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    sprite_surface_materials: Vec<Option<crate::render_command::SpriteSurfaceMaterial>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    sprite_light_masks: Vec<Option<crate::render_command::SpriteLightMasks>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    sprite_animations: Vec<Option<SpriteAnimation>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    ground_shadows: Vec<Option<ground_shadow::GroundShadowCaster>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    sprite_playbacks: Vec<Option<sprite_playback::SpritePlayback>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    velocities: Vec<Option<Velocity>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    rotations: Vec<Option<Rotation2D>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    angular_velocities: Vec<Option<AngularVelocity>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    height_spans: Vec<Option<HeightSpan>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    projectile_arcs: Vec<Option<ProjectileArc>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    rigid_bodies: Vec<Option<RigidBody>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    rigid_contact_impulses: Vec<RigidContactImpulse>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    rigid_body_ccd_debug_hits: Vec<RigidBodyCcdDebugHit>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    distance_joints: Vec<Option<DistanceJoint>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    distance_joint_generations: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    distance_joint_free_list: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    rope_joints: Vec<Option<RopeJoint>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    rope_joint_generations: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    rope_joint_free_list: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    spring_joints: Vec<Option<SpringJoint>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    spring_joint_generations: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    spring_joint_free_list: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pulley_joints: Vec<Option<PulleyJoint>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pulley_joint_generations: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pulley_joint_free_list: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    revolute_joints: Vec<Option<RevoluteJoint>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    revolute_joint_generations: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    revolute_joint_free_list: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    prismatic_joints: Vec<Option<PrismaticJoint>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    prismatic_joint_generations: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    prismatic_joint_free_list: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    weld_joints: Vec<Option<WeldJoint>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    weld_joint_generations: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    weld_joint_free_list: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    gear_joints: Vec<Option<GearJoint>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    gear_joint_generations: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    gear_joint_free_list: Vec<u32>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    joint_incident_counts: Vec<JointIncidentCount>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    colliders: Vec<Option<AabbCollider>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    circle_colliders: Vec<Option<CircleCollider>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    oriented_box_colliders: Vec<Option<OrientedBoxCollider>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    capsule_colliders: Vec<Option<CapsuleCollider>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    edge_colliders: Vec<Option<EdgeCollider>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    chain_colliders: Vec<Option<ChainCollider>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    convex_polygon_colliders: Vec<Option<ConvexPolygonCollider>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    compound_colliders: Vec<Vec<CompoundCollider>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    collider_materials: Vec<Option<PhysicsMaterial>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    collision_filters: Vec<Option<CollisionFilter>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    lifetimes: Vec<Option<GameplayLifetime>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    projectile_policies: Vec<Option<ProjectilePolicy>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    bullet_lifetimes: Vec<Option<f32>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    projectile_collision_targets: Vec<Option<ProjectileCollisionTarget>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    projectile_tile_impacts: Vec<Option<ProjectileTileImpact>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    healths: Vec<Option<f32>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    damages: Vec<Option<f32>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    score_rewards: Vec<Option<u32>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    gameplay_factions: Vec<Option<GameplayFaction>>,
    gameplay_faction_relations: FactionRelationTable,
    #[serde(with = "crate::checkpoint_codec::vector")]
    gameplay_tags: Vec<Option<GameplayTags>>,
    #[serde(with = "crate::checkpoint_codec::array")]
    gameplay_faction_indices: [Vec<usize>; GAMEPLAY_FACTION_INDEX_BUCKETS],
    #[serde(with = "crate::checkpoint_codec::array")]
    gameplay_tag_indices: [Vec<usize>; GAMEPLAY_TAG_INDEX_BUCKETS],
    #[serde(with = "crate::checkpoint_codec::vector")]
    action_bindings: Vec<Option<ActionBindingSet>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pickups: Vec<Option<Pickup>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    interactions: Vec<Option<Interaction>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    movement_patterns: Vec<Option<MovementPattern>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    collision_reactions: Vec<Option<CollisionReactionSet>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    behavior_state_machines: Vec<Option<BehaviorStateMachine>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    behavior_state_enter_actions: Vec<Option<BehaviorStateEnterActionSet>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    gameplay_timer_triggers: Vec<Option<GameplayTimerTrigger>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    gameplay_variable_mutation_triggers: Vec<Option<GameplayVariableMutationTriggerSet>>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    retired_gameplay_variable_mutation_triggers: Vec<(Entity, GameplayVariableMutationTriggerSet)>,
    gameplay_variables: GameplayVariableSlab,
    primary_actor: Option<Entity>,
}

#[cfg(test)]
pub(super) fn copy_for_test(world: &World) -> World {
    #[derive(serde::Serialize)]
    struct Capture<'a> {
        #[serde(with = "State")]
        world: &'a World,
    }
    #[derive(serde::Deserialize)]
    struct Restore {
        #[serde(with = "State")]
        world: World,
    }
    let bytes = crate::checkpoint_codec::encode(&Capture { world }).unwrap();
    let restored: Restore = crate::checkpoint_codec::decode(&bytes).unwrap();
    restored.world
}

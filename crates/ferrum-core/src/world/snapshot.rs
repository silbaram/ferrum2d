use super::World;
use crate::components::gameplay::{
    ActionBindingSet, BehaviorStateEnterActionSet, BehaviorStateMachine, CollisionReactionSet,
    GameplayFaction, GameplayTimerTrigger, Interaction, MovementPattern, Pickup,
    ProjectileCollisionTarget, ProjectileTileImpact,
};
use crate::components::{
    AabbCollider, AngularVelocity, CapsuleCollider, ChainCollider, CircleCollider, CollisionFilter,
    CompoundCollider, ConvexPolygonCollider, DistanceJoint, EdgeCollider, GearJoint, HeightSpan,
    OrientedBoxCollider, PhysicsMaterial, PrismaticJoint, ProjectileArc, PulleyJoint,
    RevoluteJoint, RigidBody, RigidBodyCcdDebugHit, RigidContactImpulse, RopeJoint, Rotation2D,
    SpringJoint, Sprite, SpriteAnimation, Transform2D, Velocity, WeldJoint,
};
use crate::entity::Entity;

#[derive(Clone, Debug, PartialEq)]
pub struct WorldSnapshot {
    generations: Vec<u32>,
    free_list: Vec<u32>,
    alive: Vec<bool>,
    transforms: Vec<Option<Transform2D>>,
    sprites: Vec<Option<Sprite>>,
    sprite_animations: Vec<Option<SpriteAnimation>>,
    velocities: Vec<Option<Velocity>>,
    rotations: Vec<Option<Rotation2D>>,
    angular_velocities: Vec<Option<AngularVelocity>>,
    height_spans: Vec<Option<HeightSpan>>,
    projectile_arcs: Vec<Option<ProjectileArc>>,
    rigid_bodies: Vec<Option<RigidBody>>,
    rigid_contact_impulses: Vec<RigidContactImpulse>,
    rigid_body_ccd_debug_hits: Vec<RigidBodyCcdDebugHit>,
    distance_joints: Vec<Option<DistanceJoint>>,
    distance_joint_generations: Vec<u32>,
    distance_joint_free_list: Vec<u32>,
    rope_joints: Vec<Option<RopeJoint>>,
    rope_joint_generations: Vec<u32>,
    rope_joint_free_list: Vec<u32>,
    spring_joints: Vec<Option<SpringJoint>>,
    spring_joint_generations: Vec<u32>,
    spring_joint_free_list: Vec<u32>,
    pulley_joints: Vec<Option<PulleyJoint>>,
    pulley_joint_generations: Vec<u32>,
    pulley_joint_free_list: Vec<u32>,
    revolute_joints: Vec<Option<RevoluteJoint>>,
    revolute_joint_generations: Vec<u32>,
    revolute_joint_free_list: Vec<u32>,
    prismatic_joints: Vec<Option<PrismaticJoint>>,
    prismatic_joint_generations: Vec<u32>,
    prismatic_joint_free_list: Vec<u32>,
    weld_joints: Vec<Option<WeldJoint>>,
    weld_joint_generations: Vec<u32>,
    weld_joint_free_list: Vec<u32>,
    gear_joints: Vec<Option<GearJoint>>,
    gear_joint_generations: Vec<u32>,
    gear_joint_free_list: Vec<u32>,
    colliders: Vec<Option<AabbCollider>>,
    circle_colliders: Vec<Option<CircleCollider>>,
    oriented_box_colliders: Vec<Option<OrientedBoxCollider>>,
    capsule_colliders: Vec<Option<CapsuleCollider>>,
    edge_colliders: Vec<Option<EdgeCollider>>,
    chain_colliders: Vec<Option<ChainCollider>>,
    convex_polygon_colliders: Vec<Option<ConvexPolygonCollider>>,
    compound_colliders: Vec<Vec<CompoundCollider>>,
    collider_materials: Vec<Option<PhysicsMaterial>>,
    collision_filters: Vec<Option<CollisionFilter>>,
    bullet_lifetimes: Vec<Option<f32>>,
    projectile_collision_targets: Vec<Option<ProjectileCollisionTarget>>,
    projectile_tile_impacts: Vec<Option<ProjectileTileImpact>>,
    healths: Vec<Option<f32>>,
    damages: Vec<Option<f32>>,
    score_rewards: Vec<Option<u32>>,
    gameplay_factions: Vec<Option<GameplayFaction>>,
    action_bindings: Vec<Option<ActionBindingSet>>,
    pickups: Vec<Option<Pickup>>,
    interactions: Vec<Option<Interaction>>,
    movement_patterns: Vec<Option<MovementPattern>>,
    collision_reactions: Vec<Option<CollisionReactionSet>>,
    behavior_state_machines: Vec<Option<BehaviorStateMachine>>,
    behavior_state_enter_actions: Vec<Option<BehaviorStateEnterActionSet>>,
    gameplay_timer_triggers: Vec<Option<GameplayTimerTrigger>>,
    player: Option<Entity>,
}

impl World {
    pub fn snapshot(&self) -> WorldSnapshot {
        WorldSnapshot {
            generations: self.generations.clone(),
            free_list: self.free_list.clone(),
            alive: self.alive.clone(),
            transforms: self.transforms.clone(),
            sprites: self.sprites.clone(),
            sprite_animations: self.sprite_animations.clone(),
            velocities: self.velocities.clone(),
            rotations: self.rotations.clone(),
            angular_velocities: self.angular_velocities.clone(),
            height_spans: self.height_spans.clone(),
            projectile_arcs: self.projectile_arcs.clone(),
            rigid_bodies: self.rigid_bodies.clone(),
            rigid_contact_impulses: self.rigid_contact_impulses.clone(),
            rigid_body_ccd_debug_hits: self.rigid_body_ccd_debug_hits.clone(),
            distance_joints: self.distance_joints.clone(),
            distance_joint_generations: self.distance_joint_generations.clone(),
            distance_joint_free_list: self.distance_joint_free_list.clone(),
            rope_joints: self.rope_joints.clone(),
            rope_joint_generations: self.rope_joint_generations.clone(),
            rope_joint_free_list: self.rope_joint_free_list.clone(),
            spring_joints: self.spring_joints.clone(),
            spring_joint_generations: self.spring_joint_generations.clone(),
            spring_joint_free_list: self.spring_joint_free_list.clone(),
            pulley_joints: self.pulley_joints.clone(),
            pulley_joint_generations: self.pulley_joint_generations.clone(),
            pulley_joint_free_list: self.pulley_joint_free_list.clone(),
            revolute_joints: self.revolute_joints.clone(),
            revolute_joint_generations: self.revolute_joint_generations.clone(),
            revolute_joint_free_list: self.revolute_joint_free_list.clone(),
            prismatic_joints: self.prismatic_joints.clone(),
            prismatic_joint_generations: self.prismatic_joint_generations.clone(),
            prismatic_joint_free_list: self.prismatic_joint_free_list.clone(),
            weld_joints: self.weld_joints.clone(),
            weld_joint_generations: self.weld_joint_generations.clone(),
            weld_joint_free_list: self.weld_joint_free_list.clone(),
            gear_joints: self.gear_joints.clone(),
            gear_joint_generations: self.gear_joint_generations.clone(),
            gear_joint_free_list: self.gear_joint_free_list.clone(),
            colliders: self.colliders.clone(),
            circle_colliders: self.circle_colliders.clone(),
            oriented_box_colliders: self.oriented_box_colliders.clone(),
            capsule_colliders: self.capsule_colliders.clone(),
            edge_colliders: self.edge_colliders.clone(),
            chain_colliders: self.chain_colliders.clone(),
            convex_polygon_colliders: self.convex_polygon_colliders.clone(),
            compound_colliders: self.compound_colliders.clone(),
            collider_materials: self.collider_materials.clone(),
            collision_filters: self.collision_filters.clone(),
            bullet_lifetimes: self.bullet_lifetimes.clone(),
            projectile_collision_targets: self.projectile_collision_targets.clone(),
            projectile_tile_impacts: self.projectile_tile_impacts.clone(),
            healths: self.healths.clone(),
            damages: self.damages.clone(),
            score_rewards: self.score_rewards.clone(),
            gameplay_factions: self.gameplay_factions.clone(),
            action_bindings: self.action_bindings.clone(),
            pickups: self.pickups.clone(),
            interactions: self.interactions.clone(),
            movement_patterns: self.movement_patterns.clone(),
            collision_reactions: self.collision_reactions.clone(),
            behavior_state_machines: self.behavior_state_machines.clone(),
            behavior_state_enter_actions: self.behavior_state_enter_actions.clone(),
            gameplay_timer_triggers: self.gameplay_timer_triggers.clone(),
            player: self.player,
        }
    }

    pub fn restore_snapshot(&mut self, snapshot: &WorldSnapshot) {
        self.generations = snapshot.generations.clone();
        self.free_list = snapshot.free_list.clone();
        self.alive = snapshot.alive.clone();
        self.rebuild_alive_indices();
        self.transforms = snapshot.transforms.clone();
        self.sprites = snapshot.sprites.clone();
        self.sprite_animations = snapshot.sprite_animations.clone();
        self.velocities = snapshot.velocities.clone();
        self.rotations = snapshot.rotations.clone();
        self.angular_velocities = snapshot.angular_velocities.clone();
        self.height_spans = snapshot.height_spans.clone();
        self.projectile_arcs = snapshot.projectile_arcs.clone();
        self.rigid_bodies = snapshot.rigid_bodies.clone();
        self.rigid_contact_impulses = snapshot.rigid_contact_impulses.clone();
        self.rigid_body_ccd_debug_hits = snapshot.rigid_body_ccd_debug_hits.clone();
        self.distance_joints = snapshot.distance_joints.clone();
        self.distance_joint_generations = snapshot.distance_joint_generations.clone();
        self.distance_joint_free_list = snapshot.distance_joint_free_list.clone();
        self.rope_joints = snapshot.rope_joints.clone();
        self.rope_joint_generations = snapshot.rope_joint_generations.clone();
        self.rope_joint_free_list = snapshot.rope_joint_free_list.clone();
        self.spring_joints = snapshot.spring_joints.clone();
        self.spring_joint_generations = snapshot.spring_joint_generations.clone();
        self.spring_joint_free_list = snapshot.spring_joint_free_list.clone();
        self.pulley_joints = snapshot.pulley_joints.clone();
        self.pulley_joint_generations = snapshot.pulley_joint_generations.clone();
        self.pulley_joint_free_list = snapshot.pulley_joint_free_list.clone();
        self.revolute_joints = snapshot.revolute_joints.clone();
        self.revolute_joint_generations = snapshot.revolute_joint_generations.clone();
        self.revolute_joint_free_list = snapshot.revolute_joint_free_list.clone();
        self.prismatic_joints = snapshot.prismatic_joints.clone();
        self.prismatic_joint_generations = snapshot.prismatic_joint_generations.clone();
        self.prismatic_joint_free_list = snapshot.prismatic_joint_free_list.clone();
        self.weld_joints = snapshot.weld_joints.clone();
        self.weld_joint_generations = snapshot.weld_joint_generations.clone();
        self.weld_joint_free_list = snapshot.weld_joint_free_list.clone();
        self.gear_joints = snapshot.gear_joints.clone();
        self.gear_joint_generations = snapshot.gear_joint_generations.clone();
        self.gear_joint_free_list = snapshot.gear_joint_free_list.clone();
        self.colliders = snapshot.colliders.clone();
        self.circle_colliders = snapshot.circle_colliders.clone();
        self.oriented_box_colliders = snapshot.oriented_box_colliders.clone();
        self.capsule_colliders = snapshot.capsule_colliders.clone();
        self.edge_colliders = snapshot.edge_colliders.clone();
        self.chain_colliders = snapshot.chain_colliders.clone();
        self.convex_polygon_colliders = snapshot.convex_polygon_colliders.clone();
        self.compound_colliders = snapshot.compound_colliders.clone();
        self.collider_materials = snapshot.collider_materials.clone();
        self.collision_filters = snapshot.collision_filters.clone();
        self.bullet_lifetimes = snapshot.bullet_lifetimes.clone();
        self.projectile_collision_targets = snapshot.projectile_collision_targets.clone();
        self.projectile_tile_impacts = snapshot.projectile_tile_impacts.clone();
        self.healths = snapshot.healths.clone();
        self.damages = snapshot.damages.clone();
        self.score_rewards = snapshot.score_rewards.clone();
        self.gameplay_factions = snapshot.gameplay_factions.clone();
        self.action_bindings = snapshot.action_bindings.clone();
        self.pickups = snapshot.pickups.clone();
        self.interactions = snapshot.interactions.clone();
        self.movement_patterns = snapshot.movement_patterns.clone();
        self.collision_reactions = snapshot.collision_reactions.clone();
        self.behavior_state_machines = snapshot.behavior_state_machines.clone();
        self.behavior_state_enter_actions = snapshot.behavior_state_enter_actions.clone();
        self.gameplay_timer_triggers = snapshot.gameplay_timer_triggers.clone();
        self.player = snapshot.player;
    }
}

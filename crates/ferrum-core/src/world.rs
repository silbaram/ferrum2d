use crate::components::{
    AabbCollider, AngularVelocity, CapsuleCollider, ChainCollider, CircleCollider, CollisionFilter,
    CompoundCollider, ConvexPolygonCollider, DistanceJoint, EdgeCollider, GearJoint, HeightSpan,
    OrientedBoxCollider, PhysicsMaterial, PrismaticJoint, ProjectileArc, PulleyJoint,
    RevoluteJoint, RigidBody, RigidBodyCcdDebugHit, RigidContactImpulse, RopeJoint, Rotation2D,
    SpringJoint, Sprite, SpriteAnimation, Transform2D, Velocity, WeldJoint,
};
use crate::entity::Entity;
use crate::physics::PhysicsSystem;

pub const BULLET_LIFETIME: f32 = 1.8;
const DEAD_ALIVE_POSITION: usize = usize::MAX;

mod colliders;
mod component_access;
mod entity_lifecycle;
mod hd2d;
mod joints;
mod rigid_bodies;
mod snapshot;
mod spawning;
mod sprite_animation;
mod templates;
#[cfg(test)]
mod tests;

pub use snapshot::WorldSnapshot;
pub use templates::{
    EntityTemplate, EntityTemplateCollider, EntityTemplateColliderShape, DEFAULT_BULLET_TEMPLATE,
    DEFAULT_ENEMY_TEMPLATE, DEFAULT_PLAYER_TEMPLATE,
};

#[derive(Default)]
pub struct World {
    pub(crate) generations: Vec<u32>,
    free_list: Vec<u32>,
    pub(crate) alive: Vec<bool>,
    alive_indices: Vec<usize>,
    alive_positions: Vec<usize>,
    pub(crate) transforms: Vec<Option<Transform2D>>,
    pub(crate) sprites: Vec<Option<Sprite>>,
    pub(crate) sprite_animations: Vec<Option<SpriteAnimation>>,
    pub(crate) velocities: Vec<Option<Velocity>>,
    pub(crate) rotations: Vec<Option<Rotation2D>>,
    pub(crate) angular_velocities: Vec<Option<AngularVelocity>>,
    pub(crate) height_spans: Vec<Option<HeightSpan>>,
    pub(crate) projectile_arcs: Vec<Option<ProjectileArc>>,
    pub(crate) rigid_bodies: Vec<Option<RigidBody>>,
    pub(crate) rigid_contact_impulses: Vec<RigidContactImpulse>,
    pub(crate) rigid_body_ccd_debug_hits: Vec<RigidBodyCcdDebugHit>,
    pub(crate) distance_joints: Vec<Option<DistanceJoint>>,
    pub(crate) distance_joint_generations: Vec<u32>,
    distance_joint_free_list: Vec<u32>,
    pub(crate) rope_joints: Vec<Option<RopeJoint>>,
    pub(crate) rope_joint_generations: Vec<u32>,
    rope_joint_free_list: Vec<u32>,
    pub(crate) spring_joints: Vec<Option<SpringJoint>>,
    pub(crate) spring_joint_generations: Vec<u32>,
    spring_joint_free_list: Vec<u32>,
    pub(crate) pulley_joints: Vec<Option<PulleyJoint>>,
    pub(crate) pulley_joint_generations: Vec<u32>,
    pulley_joint_free_list: Vec<u32>,
    pub(crate) revolute_joints: Vec<Option<RevoluteJoint>>,
    pub(crate) revolute_joint_generations: Vec<u32>,
    revolute_joint_free_list: Vec<u32>,
    pub(crate) prismatic_joints: Vec<Option<PrismaticJoint>>,
    pub(crate) prismatic_joint_generations: Vec<u32>,
    prismatic_joint_free_list: Vec<u32>,
    pub(crate) weld_joints: Vec<Option<WeldJoint>>,
    pub(crate) weld_joint_generations: Vec<u32>,
    weld_joint_free_list: Vec<u32>,
    pub(crate) gear_joints: Vec<Option<GearJoint>>,
    pub(crate) gear_joint_generations: Vec<u32>,
    gear_joint_free_list: Vec<u32>,
    pub(crate) colliders: Vec<Option<AabbCollider>>,
    pub(crate) circle_colliders: Vec<Option<CircleCollider>>,
    pub(crate) oriented_box_colliders: Vec<Option<OrientedBoxCollider>>,
    pub(crate) capsule_colliders: Vec<Option<CapsuleCollider>>,
    pub(crate) edge_colliders: Vec<Option<EdgeCollider>>,
    pub(crate) chain_colliders: Vec<Option<ChainCollider>>,
    pub(crate) convex_polygon_colliders: Vec<Option<ConvexPolygonCollider>>,
    pub(crate) compound_colliders: Vec<Vec<CompoundCollider>>,
    pub(crate) collider_materials: Vec<Option<PhysicsMaterial>>,
    pub(crate) collision_filters: Vec<Option<CollisionFilter>>,
    pub(crate) bullet_lifetimes: Vec<Option<f32>>,
    pub(crate) healths: Vec<Option<f32>>,
    pub(crate) damages: Vec<Option<f32>>,
    pub(crate) score_rewards: Vec<Option<u32>>,
    pub(crate) player: Option<Entity>,
}

impl World {
    pub fn update(&mut self, delta: f32) {
        PhysicsSystem::integrate(self, delta);
        self.update_sprite_animations(delta);
    }
}

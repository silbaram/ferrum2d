mod colliders;
mod collision_masks;
pub(crate) mod gameplay;
mod hd2d;
pub(crate) mod joints;
mod limits;
mod material;
mod motion;
mod rigid_body;
mod sprite;

pub use colliders::{
    AabbCollider, CapsuleCollider, ChainCollider, CircleCollider, CompoundCollider,
    CompoundColliderShape, ConvexPolygonCollider, EdgeCollider, OrientedBoxCollider,
};
pub(crate) use colliders::{CompoundColliderRef, CompoundColliderShapeRef};
pub use collision_masks::{CollisionFilter, CollisionLayer, CollisionMask};
pub use hd2d::{HeightSpan, PhysicsFloorId, ProjectileArc};
pub use joints::{
    DistanceJoint, DistanceJointId, GearJoint, GearJointId, PrismaticJoint, PrismaticJointId,
    PulleyJoint, PulleyJointId, RevoluteJoint, RevoluteJointId, RopeJoint, RopeJointId,
    SpringJoint, SpringJointId, WeldJoint, WeldJointId,
};
pub use limits::{MAX_CHAIN_COLLIDER_VERTICES, MAX_CONVEX_POLYGON_VERTICES};
pub use material::PhysicsMaterial;
pub use motion::{AngularVelocity, Rotation2D, Transform2D, Velocity};
pub use rigid_body::{RigidBody, RigidBodyCcdDebugHit, RigidBodyType, RigidContactImpulse};
pub use sprite::{
    Sprite, SpriteAnimation, SpriteAnimationFrameSequence, SpriteAnimationKind,
    SpriteAnimationState, SpriteFrame, MAX_SPRITE_ANIMATION_FRAMES,
};

#[cfg(test)]
mod tests;

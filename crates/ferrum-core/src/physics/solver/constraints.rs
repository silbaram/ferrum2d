use crate::collision::{
    ColliderCollisionManifold, ColliderPair as CollisionColliderPair, CollisionPair,
    CollisionScratch, CollisionSystem,
};
use crate::components::{Transform2D, Velocity};
use crate::world::World;

use super::super::math::sanitize_non_negative;
use super::contact_cache::cached_contact_impulse_for_point;
use super::should_solve_rigid_contact;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(in crate::physics) struct RigidContactConstraint {
    pub(super) pair: CollisionPair,
    pub(super) collider_pair: CollisionColliderPair,
    pub(super) point: Transform2D,
    pub(super) normal: Velocity,
    pub(super) penetration: f32,
    pub(super) normal_impulse: f32,
    pub(super) tangent_impulse: f32,
    pub(super) split_normal_impulse: f32,
}

#[derive(Debug, Default)]
pub(in crate::physics) struct RigidContactConstraintScratch {
    collision: CollisionScratch,
    collider_manifolds: Vec<ColliderCollisionManifold>,
}

impl RigidContactConstraint {
    pub(super) fn new(
        pair: CollisionPair,
        collider_pair: CollisionColliderPair,
        point: Transform2D,
        normal: Velocity,
        penetration: f32,
        normal_impulse: f32,
        tangent_impulse: f32,
    ) -> Self {
        Self {
            pair,
            collider_pair,
            point,
            normal,
            penetration,
            normal_impulse,
            tangent_impulse,
            split_normal_impulse: 0.0,
        }
    }

    #[inline]
    pub(in crate::physics) const fn pair(&self) -> CollisionPair {
        self.pair
    }
}

#[cfg(test)]
pub(in crate::physics) fn build_rigid_contact_constraints(
    world: &World,
) -> Vec<RigidContactConstraint> {
    let mut scratch = RigidContactConstraintScratch::default();
    let mut constraints = Vec::new();
    build_rigid_contact_constraints_into(&mut scratch, world, &mut constraints);
    constraints
}

pub(in crate::physics) fn build_rigid_contact_constraints_into(
    scratch: &mut RigidContactConstraintScratch,
    world: &World,
    constraints: &mut Vec<RigidContactConstraint>,
) {
    CollisionSystem::build_rigid_collider_manifolds_into(
        &mut scratch.collision,
        world,
        &mut scratch.collider_manifolds,
    );
    constraints.clear();
    constraints.reserve(scratch.collider_manifolds.len().saturating_mul(2));
    for collider_manifold in scratch.collider_manifolds.iter().copied() {
        let manifold = collider_manifold.manifold;
        let a_index = manifold.pair.a.id as usize;
        let b_index = manifold.pair.b.id as usize;
        if !should_solve_rigid_contact(world, a_index, b_index) {
            continue;
        }
        for point in collider_manifold.points() {
            let (normal_impulse, tangent_impulse) =
                cached_contact_impulse_for_point(world, manifold, point.point_x, point.point_y)
                    .unwrap_or_default();
            constraints.push(RigidContactConstraint::new(
                manifold.pair,
                collider_manifold.collider_pair,
                Transform2D {
                    x: point.point_x,
                    y: point.point_y,
                },
                Velocity {
                    vx: manifold.normal_x,
                    vy: manifold.normal_y,
                },
                sanitize_non_negative(point.penetration),
                normal_impulse,
                tangent_impulse,
            ));
        }
    }
}

use crate::collision::CollisionManifold;
use crate::components::{RigidContactImpulse, Velocity};
use crate::world::World;

use super::super::math::{finite_transform, finite_velocity};
use super::contact_impulse::{
    apply_contact_impulse_at_point, contact_constraint_tangent, rigid_contact_mass_context,
};
use super::{RigidBodyStepStats, RigidContactConstraint, CONTACT_IMPULSE_EPSILON};

pub(in crate::physics::solver) const CONTACT_CACHE_NORMAL_DOT_MIN: f32 = 0.95;
const CONTACT_CACHE_POINT_MATCH_DISTANCE_SQUARED: f32 = 4.0;

pub(in crate::physics::solver) fn cached_contact_impulse_for_point(
    world: &World,
    manifold: CollisionManifold,
    point_x: f32,
    point_y: f32,
) -> Option<(f32, f32)> {
    world
        .rigid_contact_impulses
        .iter()
        .copied()
        .find(|entry| {
            entry.entity_a == manifold.pair.a
                && entry.entity_b == manifold.pair.b
                && entry.normal_x * manifold.normal_x + entry.normal_y * manifold.normal_y
                    >= CONTACT_CACHE_NORMAL_DOT_MIN
                && contact_cache_point_matches(*entry, point_x, point_y)
        })
        .map(|entry| (entry.normal_impulse.max(0.0), entry.tangent_impulse))
}

pub(in crate::physics) fn warm_start_rigid_contact_constraints(
    world: &mut World,
    constraints: &[RigidContactConstraint],
    stats: &mut RigidBodyStepStats,
) {
    for constraint in constraints {
        if constraint.normal_impulse.abs() <= CONTACT_IMPULSE_EPSILON
            && constraint.tangent_impulse.abs() <= CONTACT_IMPULSE_EPSILON
        {
            continue;
        }

        let a_index = constraint.pair.a.id as usize;
        let b_index = constraint.pair.b.id as usize;
        let Some(context) = rigid_contact_mass_context(world, a_index, b_index) else {
            continue;
        };

        let normal = finite_velocity(constraint.normal);
        let tangent = contact_constraint_tangent(normal);
        apply_contact_impulse_at_point(
            world,
            context,
            finite_transform(constraint.point),
            Velocity {
                vx: normal.vx * constraint.normal_impulse + tangent.vx * constraint.tangent_impulse,
                vy: normal.vy * constraint.normal_impulse + tangent.vy * constraint.tangent_impulse,
            },
        );
        stats.warm_start_impulses = stats.warm_start_impulses.saturating_add(1);
    }
}

pub(in crate::physics) fn store_rigid_contact_impulses(
    world: &mut World,
    constraints: &[RigidContactConstraint],
) -> u32 {
    world.rigid_contact_impulses.clear();
    for constraint in constraints {
        if constraint.normal_impulse.abs() <= CONTACT_IMPULSE_EPSILON
            && constraint.tangent_impulse.abs() <= CONTACT_IMPULSE_EPSILON
        {
            continue;
        }
        world.rigid_contact_impulses.push(RigidContactImpulse {
            entity_a: constraint.pair.a,
            entity_b: constraint.pair.b,
            point_x: constraint.point.x,
            point_y: constraint.point.y,
            normal_x: constraint.normal.vx,
            normal_y: constraint.normal.vy,
            normal_impulse: constraint.normal_impulse.max(0.0),
            tangent_impulse: constraint.tangent_impulse,
        });
    }
    world.rigid_contact_impulses.len() as u32
}

fn contact_cache_point_matches(entry: RigidContactImpulse, point_x: f32, point_y: f32) -> bool {
    let dx = entry.point_x - point_x;
    let dy = entry.point_y - point_y;
    dx * dx + dy * dy <= CONTACT_CACHE_POINT_MATCH_DISTANCE_SQUARED
}

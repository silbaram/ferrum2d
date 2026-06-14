use crate::collision::{
    ColliderCollisionContact, ColliderPair as CollisionColliderPair, CollisionPair,
};
use crate::components::{Transform2D, Velocity};
use crate::world::World;

use super::math::{dot_velocity, finite_transform, finite_velocity};
use super::{RigidBodyIslandSchedule, RigidBodyStepConfig, RigidBodyStepStats};

mod baumgarte;
mod constraints;
mod contact_cache;
mod contact_filter;
mod contact_impulse;
mod contact_material;
mod restitution;
mod split_impulse;
mod surface_velocity;

use baumgarte::{contact_baumgarte_bias_velocity, contact_velocity_baumgarte_bias};
#[cfg(test)]
pub(super) use constraints::build_rigid_contact_constraints;
pub(super) use constraints::{
    build_rigid_contact_constraints_into, RigidContactConstraint, RigidContactConstraintScratch,
};
use contact_cache::CONTACT_CACHE_NORMAL_DOT_MIN;
pub(super) use contact_cache::{
    store_rigid_contact_impulses, warm_start_rigid_contact_constraints,
};
pub(super) use contact_filter::should_solve_rigid_contact;
use contact_impulse::{
    apply_contact_impulse_at_point, apply_contact_position_impulse_at_point,
    contact_constraint_tangent, contact_impulse_denominator, contact_normal_block_matrix,
    relative_contact_velocity, rigid_contact_mass_context,
};
use contact_material::contact_material_for_collider;
use restitution::{
    contact_restitution, contact_restitution_coefficient, contact_restitution_threshold_skipped,
};
pub(super) use split_impulse::RigidSplitImpulseState;
use surface_velocity::contact_surface_velocity;

pub(super) const CONTACT_IMPULSE_EPSILON: f32 = 0.0001;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct RigidContactSolveResult {
    applied_impulse: bool,
    used_baumgarte_bias: bool,
    skipped_restitution: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct RigidContactBlockSolveResult {
    applied_impulses: u32,
    used_baumgarte_biases: u32,
    skipped_restitutions: u32,
}

pub(super) fn solve_rigid_body_velocity_contacts(
    world: &mut World,
    constraints: &mut [RigidContactConstraint],
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
    stats: &mut RigidBodyStepStats,
) {
    let mut index = 0;
    while index < constraints.len() {
        if !island_schedule.contact_in_island(&constraints[index], island_root) {
            index += 1;
            continue;
        }
        if index + 1 < constraints.len()
            && island_schedule.contact_in_island(&constraints[index + 1], island_root)
            && rigid_contact_constraints_can_block_solve(
                &constraints[index],
                &constraints[index + 1],
            )
        {
            let result = {
                let (_, remaining) = constraints.split_at_mut(index);
                let (block, _) = remaining.split_at_mut(2);
                let (first, second) = block.split_at_mut(1);
                solve_velocity_contact_block(
                    world,
                    &mut first[0],
                    &mut second[0],
                    config,
                    delta_seconds,
                )
            };
            if let Some(result) = result {
                stats.contact_checks = stats.contact_checks.saturating_add(2);
                if result.applied_impulses > 0 {
                    stats.contact_block_solves = stats.contact_block_solves.saturating_add(1);
                    stats.velocity_impulses = stats
                        .velocity_impulses
                        .saturating_add(result.applied_impulses);
                }
                stats.baumgarte_velocity_biases = stats
                    .baumgarte_velocity_biases
                    .saturating_add(result.used_baumgarte_biases);
                stats.restitution_velocity_threshold_skips = stats
                    .restitution_velocity_threshold_skips
                    .saturating_add(result.skipped_restitutions);

                let tangent_impulses = {
                    let (_, remaining) = constraints.split_at_mut(index);
                    let (block, _) = remaining.split_at_mut(2);
                    let mut tangent_impulses = 0_u32;
                    for constraint in block {
                        if solve_tangent_contact_constraint(world, constraint) {
                            tangent_impulses = tangent_impulses.saturating_add(1);
                        }
                    }
                    tangent_impulses
                };
                stats.velocity_impulses = stats.velocity_impulses.saturating_add(tangent_impulses);
                index += 2;
                continue;
            }
        }

        let constraint = &mut constraints[index];
        stats.contact_checks = stats.contact_checks.saturating_add(1);
        let result = solve_velocity_contact_constraint(world, constraint, config, delta_seconds);
        if result.applied_impulse {
            stats.velocity_impulses = stats.velocity_impulses.saturating_add(1);
        }
        if result.used_baumgarte_bias {
            stats.baumgarte_velocity_biases = stats.baumgarte_velocity_biases.saturating_add(1);
        }
        if result.skipped_restitution {
            stats.restitution_velocity_threshold_skips =
                stats.restitution_velocity_threshold_skips.saturating_add(1);
        }
        index += 1;
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn solve_rigid_body_split_impulse_contacts(
    world: &World,
    split_impulses: &mut RigidSplitImpulseState,
    constraints: &mut [RigidContactConstraint],
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
    stats: &mut RigidBodyStepStats,
) {
    for constraint in constraints
        .iter_mut()
        .filter(|constraint| island_schedule.contact_in_island(constraint, island_root))
    {
        if solve_split_impulse_contact_constraint(
            world,
            split_impulses,
            constraint,
            config,
            delta_seconds,
        ) {
            stats.split_velocity_impulses = stats.split_velocity_impulses.saturating_add(1);
        }
    }
}

pub(super) fn solve_rigid_body_position_contacts(
    world: &mut World,
    contacts: &[ColliderCollisionContact],
    island_schedule: &RigidBodyIslandSchedule,
    island_root: usize,
    config: RigidBodyStepConfig,
    stats: &mut RigidBodyStepStats,
) {
    for &contact in contacts {
        if !island_schedule.pair_in_island(contact.contact.pair, island_root) {
            continue;
        }
        stats.contact_checks = stats.contact_checks.saturating_add(1);
        if solve_position_contact(world, contact, config) {
            stats.position_corrections = stats.position_corrections.saturating_add(1);
            stats.split_position_corrections = stats.split_position_corrections.saturating_add(1);
        }
    }
}

fn solve_velocity_contact_constraint(
    world: &mut World,
    constraint: &mut RigidContactConstraint,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
) -> RigidContactSolveResult {
    let mut result = solve_normal_contact_constraint(world, constraint, config, delta_seconds);
    if solve_tangent_contact_constraint(world, constraint) {
        result.applied_impulse = true;
    }
    result
}

pub(super) fn solve_ccd_velocity_contact(
    world: &mut World,
    pair: CollisionPair,
    collider_pair: CollisionColliderPair,
    point: Transform2D,
    normal: Velocity,
    config: RigidBodyStepConfig,
) -> bool {
    let mut constraint =
        RigidContactConstraint::new(pair, collider_pair, point, normal, 0.0, 0.0, 0.0);
    solve_velocity_contact_constraint(world, &mut constraint, config, 1.0).applied_impulse
}

fn solve_normal_contact_constraint(
    world: &mut World,
    constraint: &mut RigidContactConstraint,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
) -> RigidContactSolveResult {
    let a_index = constraint.pair.a.id as usize;
    let b_index = constraint.pair.b.id as usize;
    let Some(context) = rigid_contact_mass_context(world, a_index, b_index) else {
        return RigidContactSolveResult::default();
    };

    let point = finite_transform(constraint.point);
    let normal = finite_velocity(constraint.normal);
    let relative_velocity = relative_contact_velocity(world, context, point);
    let velocity_along_normal = dot_velocity(relative_velocity, normal);

    let material_a = contact_material_for_collider(world, constraint.collider_pair.a);
    let material_b = contact_material_for_collider(world, constraint.collider_pair.b);
    let material_restitution = contact_restitution_coefficient(material_a, material_b);
    let restitution = contact_restitution(
        material_restitution,
        velocity_along_normal,
        config.restitution_velocity_threshold,
    );
    let normal_denominator = contact_impulse_denominator(context, point, normal);
    if normal_denominator <= 0.0 {
        return RigidContactSolveResult::default();
    }
    let baumgarte_bias = contact_velocity_baumgarte_bias(
        constraint.penetration,
        config,
        material_a,
        material_b,
        delta_seconds,
        velocity_along_normal,
    );
    let normal_impulse_delta =
        (baumgarte_bias - (1.0 + restitution) * velocity_along_normal) / normal_denominator;
    if !normal_impulse_delta.is_finite() {
        return RigidContactSolveResult::default();
    }
    let old_normal_impulse = constraint.normal_impulse.max(0.0);
    constraint.normal_impulse = (old_normal_impulse + normal_impulse_delta).max(0.0);
    let applied_normal_impulse_delta = constraint.normal_impulse - old_normal_impulse;
    let applied_normal_impulse = applied_normal_impulse_delta.abs() > CONTACT_IMPULSE_EPSILON;
    let result = RigidContactSolveResult {
        applied_impulse: applied_normal_impulse,
        used_baumgarte_bias: baumgarte_bias > CONTACT_IMPULSE_EPSILON && applied_normal_impulse,
        skipped_restitution: contact_restitution_threshold_skipped(
            material_restitution,
            velocity_along_normal,
            config.restitution_velocity_threshold,
        ),
    };

    if applied_normal_impulse {
        apply_contact_impulse_at_point(
            world,
            context,
            point,
            Velocity {
                vx: normal.vx * applied_normal_impulse_delta,
                vy: normal.vy * applied_normal_impulse_delta,
            },
        );
    }

    result
}

fn solve_split_impulse_contact_constraint(
    world: &World,
    split_impulses: &mut RigidSplitImpulseState,
    constraint: &mut RigidContactConstraint,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
) -> bool {
    let a_index = constraint.pair.a.id as usize;
    let b_index = constraint.pair.b.id as usize;
    let Some(context) = rigid_contact_mass_context(world, a_index, b_index) else {
        return false;
    };

    let point = finite_transform(constraint.point);
    let normal = finite_velocity(constraint.normal);
    let relative_velocity = split_impulses.relative_contact_velocity_with_radii(
        context.a_index,
        context.b_index,
        context.radius_a(point),
        context.radius_b(point),
    );
    let velocity_along_normal = dot_velocity(relative_velocity, normal);
    let material_a = contact_material_for_collider(world, constraint.collider_pair.a);
    let material_b = contact_material_for_collider(world, constraint.collider_pair.b);
    let split_bias = contact_baumgarte_bias_velocity(
        constraint.penetration,
        config,
        material_a,
        material_b,
        delta_seconds,
        velocity_along_normal,
    );
    if split_bias <= CONTACT_IMPULSE_EPSILON {
        return false;
    }

    let normal_denominator = contact_impulse_denominator(context, point, normal);
    if normal_denominator <= 0.0 {
        return false;
    }

    let impulse_delta = (split_bias - velocity_along_normal) / normal_denominator;
    if !impulse_delta.is_finite() {
        return false;
    }
    let old_impulse = constraint.split_normal_impulse.max(0.0);
    constraint.split_normal_impulse = (old_impulse + impulse_delta).max(0.0);
    let applied_impulse = constraint.split_normal_impulse - old_impulse;
    if applied_impulse.abs() <= CONTACT_IMPULSE_EPSILON {
        return false;
    }

    split_impulses.apply_contact_impulse_at_radii(
        context.a_index,
        context.b_index,
        context.radius_a(point),
        context.radius_b(point),
        Velocity {
            vx: normal.vx * applied_impulse,
            vy: normal.vy * applied_impulse,
        },
        context.inverse_mass_a,
        context.inverse_mass_b,
        context.inverse_inertia_a,
        context.inverse_inertia_b,
    );
    true
}

fn solve_tangent_contact_constraint(
    world: &mut World,
    constraint: &mut RigidContactConstraint,
) -> bool {
    let a_index = constraint.pair.a.id as usize;
    let b_index = constraint.pair.b.id as usize;
    let Some(context) = rigid_contact_mass_context(world, a_index, b_index) else {
        return false;
    };

    let point = finite_transform(constraint.point);
    let normal = finite_velocity(constraint.normal);
    let material_a = contact_material_for_collider(world, constraint.collider_pair.a);
    let material_b = contact_material_for_collider(world, constraint.collider_pair.b);
    let relative_velocity = relative_contact_velocity(world, context, point);
    let tangent = contact_constraint_tangent(normal);
    let friction = (material_a.friction * material_b.friction).sqrt();
    let tangent_denominator = contact_impulse_denominator(context, point, tangent);
    if tangent_denominator <= 0.0 {
        return false;
    }
    let target_tangent_velocity = contact_surface_velocity(material_a, material_b, tangent);
    let tangent_impulse_delta =
        -(dot_velocity(relative_velocity, tangent) - target_tangent_velocity) / tangent_denominator;
    if !tangent_impulse_delta.is_finite() {
        return false;
    }
    let max_friction = constraint.normal_impulse * friction;
    let old_tangent_impulse = constraint.tangent_impulse;
    constraint.tangent_impulse =
        (old_tangent_impulse + tangent_impulse_delta).clamp(-max_friction, max_friction);
    let applied_tangent_impulse = constraint.tangent_impulse - old_tangent_impulse;
    if applied_tangent_impulse.abs() > CONTACT_IMPULSE_EPSILON {
        apply_contact_impulse_at_point(
            world,
            context,
            point,
            Velocity {
                vx: tangent.vx * applied_tangent_impulse,
                vy: tangent.vy * applied_tangent_impulse,
            },
        );
        return true;
    }

    false
}

fn solve_velocity_contact_block(
    world: &mut World,
    first: &mut RigidContactConstraint,
    second: &mut RigidContactConstraint,
    config: RigidBodyStepConfig,
    delta_seconds: f32,
) -> Option<RigidContactBlockSolveResult> {
    if !rigid_contact_constraints_can_block_solve(first, second) {
        return None;
    }

    let a_index = first.pair.a.id as usize;
    let b_index = first.pair.b.id as usize;
    let context = rigid_contact_mass_context(world, a_index, b_index)?;
    let normal = finite_velocity(first.normal);
    let point_a = finite_transform(first.point);
    let point_b = finite_transform(second.point);
    let matrix = contact_normal_block_matrix(context, point_a, point_b, normal)?;

    let velocity_a = dot_velocity(relative_contact_velocity(world, context, point_a), normal);
    let velocity_b = dot_velocity(relative_contact_velocity(world, context, point_b), normal);
    let material_a = contact_material_for_collider(world, first.collider_pair.a);
    let material_b = contact_material_for_collider(world, first.collider_pair.b);
    let restitution = contact_restitution_coefficient(material_a, material_b);
    let baumgarte_bias_a = contact_velocity_baumgarte_bias(
        first.penetration,
        config,
        material_a,
        material_b,
        delta_seconds,
        velocity_a,
    );
    let baumgarte_bias_b = contact_velocity_baumgarte_bias(
        second.penetration,
        config,
        material_a,
        material_b,
        delta_seconds,
        velocity_b,
    );
    let target_a = baumgarte_bias_a
        - contact_restitution(
            restitution,
            velocity_a,
            config.restitution_velocity_threshold,
        ) * velocity_a;
    let target_b = baumgarte_bias_b
        - contact_restitution(
            restitution,
            velocity_b,
            config.restitution_velocity_threshold,
        ) * velocity_b;
    let old_impulse_a = first.normal_impulse.max(0.0);
    let old_impulse_b = second.normal_impulse.max(0.0);
    let rhs_a = target_a - velocity_a + matrix.k11 * old_impulse_a + matrix.k12 * old_impulse_b;
    let rhs_b = target_b - velocity_b + matrix.k12 * old_impulse_a + matrix.k22 * old_impulse_b;
    let determinant = matrix.k11 * matrix.k22 - matrix.k12 * matrix.k12;
    if !determinant.is_finite() || determinant <= CONTACT_IMPULSE_EPSILON {
        return None;
    }

    let solved_impulse_a = (matrix.k22 * rhs_a - matrix.k12 * rhs_b) / determinant;
    let solved_impulse_b = (matrix.k11 * rhs_b - matrix.k12 * rhs_a) / determinant;
    if !solved_impulse_a.is_finite()
        || !solved_impulse_b.is_finite()
        || solved_impulse_a < -CONTACT_IMPULSE_EPSILON
        || solved_impulse_b < -CONTACT_IMPULSE_EPSILON
    {
        return None;
    }

    let solved_impulse_a = solved_impulse_a.max(0.0);
    let solved_impulse_b = solved_impulse_b.max(0.0);
    let impulse_delta_a = solved_impulse_a - old_impulse_a;
    let impulse_delta_b = solved_impulse_b - old_impulse_b;
    let mut result = RigidContactBlockSolveResult {
        skipped_restitutions: contact_restitution_threshold_skipped(
            restitution,
            velocity_a,
            config.restitution_velocity_threshold,
        ) as u32
            + contact_restitution_threshold_skipped(
                restitution,
                velocity_b,
                config.restitution_velocity_threshold,
            ) as u32,
        ..RigidContactBlockSolveResult::default()
    };

    if impulse_delta_a.abs() > CONTACT_IMPULSE_EPSILON {
        apply_contact_impulse_at_point(
            world,
            context,
            point_a,
            Velocity {
                vx: normal.vx * impulse_delta_a,
                vy: normal.vy * impulse_delta_a,
            },
        );
        result.applied_impulses = result.applied_impulses.saturating_add(1);
        if baumgarte_bias_a > CONTACT_IMPULSE_EPSILON {
            result.used_baumgarte_biases = result.used_baumgarte_biases.saturating_add(1);
        }
    }
    if impulse_delta_b.abs() > CONTACT_IMPULSE_EPSILON {
        apply_contact_impulse_at_point(
            world,
            context,
            point_b,
            Velocity {
                vx: normal.vx * impulse_delta_b,
                vy: normal.vy * impulse_delta_b,
            },
        );
        result.applied_impulses = result.applied_impulses.saturating_add(1);
        if baumgarte_bias_b > CONTACT_IMPULSE_EPSILON {
            result.used_baumgarte_biases = result.used_baumgarte_biases.saturating_add(1);
        }
    }

    first.normal_impulse = solved_impulse_a;
    second.normal_impulse = solved_impulse_b;
    Some(result)
}

fn rigid_contact_constraints_can_block_solve(
    first: &RigidContactConstraint,
    second: &RigidContactConstraint,
) -> bool {
    first.pair == second.pair
        && first.collider_pair == second.collider_pair
        && dot_velocity(
            finite_velocity(first.normal),
            finite_velocity(second.normal),
        ) >= CONTACT_CACHE_NORMAL_DOT_MIN
}

fn solve_position_contact(
    world: &mut World,
    collider_contact: ColliderCollisionContact,
    config: RigidBodyStepConfig,
) -> bool {
    let contact = collider_contact.contact;
    let a_index = contact.pair.a.id as usize;
    let b_index = contact.pair.b.id as usize;
    let Some(context) = rigid_contact_mass_context(world, a_index, b_index) else {
        return false;
    };

    let point = finite_transform(Transform2D {
        x: contact.point_x,
        y: contact.point_y,
    });
    let normal = finite_velocity(Velocity {
        vx: contact.normal_x,
        vy: contact.normal_y,
    });
    let position_denominator = contact_impulse_denominator(context, point, normal);
    if position_denominator <= 0.0 {
        return false;
    }

    let material_a = contact_material_for_collider(world, collider_contact.collider_pair.a);
    let material_b = contact_material_for_collider(world, collider_contact.collider_pair.b);
    let correction_scale = material_a
        .contact_position_correction_scale
        .min(material_b.contact_position_correction_scale);
    if correction_scale <= 0.0 {
        return false;
    }
    let correction_slop_scale = material_a
        .contact_position_correction_slop_scale
        .min(material_b.contact_position_correction_slop_scale);
    let position_correction_slop = config.position_correction_slop * correction_slop_scale;

    let correction_magnitude = ((contact.penetration - position_correction_slop).max(0.0)
        / position_denominator)
        * config.position_correction_percent
        * correction_scale;
    if !correction_magnitude.is_finite() || correction_magnitude <= 0.0 {
        return false;
    }
    let correction = Velocity {
        vx: normal.vx * correction_magnitude,
        vy: normal.vy * correction_magnitude,
    };
    apply_contact_position_impulse_at_point(world, context, point, correction);
    true
}

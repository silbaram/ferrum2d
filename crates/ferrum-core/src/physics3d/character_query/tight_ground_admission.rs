//! The same two read-only tight-ground predicates, with per-executed-scan
//! admission. A support face is necessary: without one the original AND is
//! already false, so no geometry-clearance scan or its reservation is needed.
use super::*;
use crate::physics3d::solver_trajectory::{TrajectoryError, Work};
use rapier3d::parry::{partitioning::TraversalAction, shape::Capsule};

// Cover the BVH predicate and then the filter and original face operands at
// each overlapping leaf. The failed-probe cost is bounded by one quarter of
// one original scan, leaving the original two scans available on fallback.
const NODE_WORK: u64 = 16;
const LEAF_WORK: u64 = 96;
const PREPARE_WORK: u64 = 64;
const MIN_SCAN_PRICE: u64 = 4096;

#[allow(clippy::too_many_arguments)]
fn no_flat_support(
    world: &rp::PhysicsWorld,
    queries: &rp::QueryPipeline<'_>,
    shape: &dyn rp::Shape,
    capsule: &Capsule,
    pose: &rp::Pose,
    epsilon: f32,
    max_distance: f32,
    mut remaining: u64,
    work: &mut Work,
) -> bool {
    use TraversalAction::{Continue, EarlyExit, Prune};

    let mut charge = |amount| {
        let Some(left) = remaining.checked_sub(amount) else {
            return false;
        };
        remaining = left;
        work.charge(amount).is_ok()
    };
    if !charge(PREPARE_WORK) {
        return false;
    }
    let bounds = shape.compute_aabb(pose).loosened(max_distance);
    let mut complete = true;
    queries.bvh.traverse(|node| {
        if !charge(NODE_WORK) {
            complete = false;
            return EarlyExit;
        }
        if !node.aabb().intersects(&bounds) {
            return Prune;
        }
        let Some(index) = node.leaf_data() else {
            return Continue;
        };
        if !charge(LEAF_WORK) {
            complete = false;
            return EarlyExit;
        }
        let Some((target, handle)) = queries.colliders.get_unknown_gen(index) else {
            return Prune;
        };
        if !queries.filter.test(queries.bodies, handle, target) || !stationary_target(world, target)
        {
            return Prune;
        }
        if let Some(cuboid) = target.shape().as_cuboid() {
            // Under an identity target rotation and +Y up, only the +Y face
            // can pass the original alignment test. Preserve that expression's
            // inverse pose, capsule endpoints, radius, and subtraction order.
            if target.position().rotation == rp::Rotation::IDENTITY {
                let relative = target.position().inv_mul(pose);
                let a = relative * capsule.segment.a;
                let b = relative * capsule.segment.b;
                let gap = (a.min(b) - rp::Vector::splat(capsule.radius)).y - cuboid.half_extents.y;
                if gap.is_finite() && (gap < -epsilon || gap > max_distance) {
                    return Prune;
                }
            }
        } else if target.shape().as_compound().is_none() {
            return Prune;
        }

        // A potential floor or a compound needs the original face census
        // and the original geometry-clearance admission.
        complete = false;
        EarlyExit
    });
    complete
}

/// `scan_price` is records*64 from the owner's unchanged collider/compound
/// census. Both scans execute at the original records*128 logical price. This
/// is the existing phase/visit model, not a bound on native GJK CPU time.
/// The internal query filter is read-only: group/exclusion/one-way/span tests
/// have no user callback, shape mutation or cached contact publication.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d) fn certified_tight_ground_admitted(
    world: &rp::PhysicsWorld,
    queries: &rp::QueryPipeline<'_>,
    shape: &dyn rp::Shape,
    pose: &rp::Pose,
    config: &CharacterConfig,
    scan_price: u64,
    work: &mut Work,
) -> Result<Option<rp::ColliderHandle>, TrajectoryError> {
    // The original support predicate cannot return Some for another shape.
    // In particular this is not an unsupported-shape geometric acceptance.
    let Some(capsule) = shape.as_capsule() else {
        return Ok(None);
    };
    let epsilon = tight_epsilon(world.integration_parameters.length_unit, config);
    let max_distance = config.skin_width * 2.;
    let probe_price = scan_price / 4;
    // In a small scene a speculative traversal offers little saving. Also
    // reserve the full old path so probing cannot exhaust its admission.
    if scan_price >= MIN_SCAN_PRICE
        && config.up == rp::Vector::Y.to_array()
        && epsilon.is_finite()
        && max_distance.is_finite()
        && work.limit.saturating_sub(work.used)
            >= scan_price.saturating_mul(2).saturating_add(probe_price)
        && no_flat_support(
            world,
            queries,
            shape,
            capsule,
            pose,
            epsilon,
            max_distance,
            probe_price,
            work,
        )
    {
        return Ok(None);
    }
    work.charge(scan_price)?;
    let Some(support) =
        certified_flat_support_handle(world, queries, shape, pose, config, epsilon, max_distance)
    else {
        return Ok(None);
    };
    work.charge(scan_price)?;
    let Some(clearance) = geometry_clearance(
        queries,
        shape,
        pose,
        config.skin_width,
        epsilon,
        rp::Vector::from(config.up),
    ) else {
        return Ok(None);
    };
    if clearance.overhead >= config.skin_width {
        return Ok(None);
    }
    Ok(Some(support))
}

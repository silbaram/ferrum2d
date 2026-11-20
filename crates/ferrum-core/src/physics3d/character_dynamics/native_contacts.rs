//! Native contact rows constrain the character prediction. Their impulses stay
//! backend-owned; only character/dynamic impulses are published by the caller.
use super::{Node, Row};
use crate::physics3d::{contact_policy::ContactPolicies, world::native_id, BodyId};
use rapier3d::parry::bounding_volume::BoundingVolume;
use rapier3d::parry::query::{
    cast_shapes, cast_shapes_nonlinear, contact, ContactManifold, DefaultQueryDispatcher,
    NonlinearRigidMotion, PersistentQueryDispatcher, ShapeCastOptions,
};
use rapier3d::prelude as rp;

#[derive(Default)]
pub(super) struct Scratch {
    visited: Vec<bool>,
    frontier: Vec<usize>,
}

fn id(handle: rp::RigidBodyHandle) -> BodyId {
    let (slot, generation) = handle.into_raw_parts();
    BodyId { slot, generation }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn collect(
    world: &rp::PhysicsWorld,
    policies: &ContactPolicies,
    nodes: &mut [Node],
    rows: &mut Vec<Row>,
    manifolds: &mut Vec<ContactManifold<(), ()>>,
    scratch: &mut Scratch,
    budget: usize,
) {
    scratch.visited.clear();
    scratch.visited.resize(nodes.len(), false);
    scratch.frontier.clear();
    for row in rows.iter().filter(|r| r.pair.is_some()) {
        if let Some(b) = row.b {
            if !scratch.visited[b] {
                scratch.visited[b] = true;
                scratch.frontier.push(b);
            }
        }
    }
    let base = rows.len();
    // The margin shares the native CCD slop. Split before the backend can clamp
    // a crate independently of its pusher; no post-penetration iteration is used.
    let margin = world.integration_parameters.allowed_linear_error() * 2.1;
    let mut cursor = 0;
    while cursor < scratch.frontier.len() && rows.len() - base < budget {
        let a = scratch.frontier[cursor];
        cursor += 1;
        let body = &world.bodies[native_id(nodes[a].id)];
        for &handle in body.colliders() {
            let collider = &world.colliders[handle];
            if !collider.is_enabled() || collider.is_sensor() {
                continue;
            }
            let queries = world.query_pipeline_with_filter(rp::QueryFilter {
                flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
                groups: Some(collider.collision_groups()),
                exclude_rigid_body: Some(native_id(nodes[a].id)),
                ..Default::default()
            });
            for (other_handle, other) in
                queries.intersect_aabb_conservative(collider.compute_aabb().loosened(margin))
            {
                if rows.len() - base >= budget {
                    nodes[a].limited = true;
                    break;
                }
                let Some(target) = other
                    .parent()
                    .and_then(|h| world.bodies.get(h))
                    .filter(|b| b.is_enabled())
                else {
                    continue;
                };
                if !other.is_enabled()
                    || !policies.pair_allows(collider.parent(), other.parent())
                    || !policies.one_way_allows(
                        other_handle,
                        other,
                        collider.shape(),
                        collider.position(),
                    )
                    || !policies.one_way_allows(handle, collider, other.shape(), other.position())
                {
                    continue;
                }
                let b = other
                    .parent()
                    .and_then(|h| nodes.binary_search_by_key(&id(h), |n| n.id).ok());
                if b.is_some_and(|b| nodes[b].character || (scratch.visited[b] && b < a)) {
                    continue;
                }
                manifolds.clear();
                if DefaultQueryDispatcher
                    .contact_manifolds(
                        &other.position().inv_mul(collider.position()),
                        other.shape(),
                        collider.shape(),
                        margin,
                        manifolds,
                        &mut None,
                    )
                    .is_err()
                {
                    continue;
                }
                let old_count = rows.len();
                for manifold in manifolds.iter() {
                    let pose = manifold
                        .subshape_pos1()
                        .map_or(*other.position(), |p| other.position() * p);
                    let mut normal = pose.rotation * manifold.local_n1;
                    if policies.planar {
                        normal.z = 0.;
                    }
                    let Some(normal) = normal.try_normalize() else {
                        continue;
                    };
                    for hit in manifold.points.iter().filter(|p| p.dist <= margin) {
                        if rows.len() - base >= budget {
                            nodes[a].limited = true;
                            break;
                        }
                        let mut point = pose * hit.local_p1;
                        if policies.planar {
                            point.z = 0.;
                        }
                        rows.push(Row {
                            a,
                            b,
                            point,
                            normal,
                            impulse: 0.,
                            minimum_velocity: 0.,
                            pair: None,
                            target_velocity: if target.is_kinematic() {
                                let m = crate::physics3d::kinematic_motion::collider_motion(
                                    target,
                                    other,
                                    world.integration_parameters.dt,
                                );
                                (m.linvel + m.angvel.cross(point - m.start * m.local_center))
                                    / world.integration_parameters.dt
                            } else {
                                target.velocity_at_point(point)
                            },
                        });
                    }
                }
                if rows.len() > old_count {
                    nodes[a].native_contact = true;
                    if let Some(b) = b {
                        nodes[b].native_contact = true;
                        if !scratch.visited[b] {
                            scratch.visited[b] = true;
                            scratch.frontier.push(b);
                        }
                    }
                }
            }
        }
    }
    for &index in &scratch.frontier[cursor..] {
        nodes[index].limited = true;
    }
}

pub(super) fn limit(
    world: &rp::PhysicsWorld,
    policies: &ContactPolicies,
    scratch: &super::Scratch,
) -> f32 {
    if !scratch.predicting {
        return 1.;
    }
    let mut earliest: f32 = 1.;
    let dt = world.integration_parameters.dt;
    let margin = world.integration_parameters.allowed_linear_error() * 2.;
    for (index, node) in scratch
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| !n.character)
    {
        if !scratch.is_coupled(index) {
            continue;
        }
        let body = &world.bodies[native_id(node.id)];
        for &handle in body.colliders() {
            let c = &world.colliders[handle];
            if !c.is_enabled() || c.is_sensor() {
                continue;
            }
            let motion = scratch.motion(body, c, world.gravity, dt);
            let bounds = crate::physics3d::kinematic_motion::motion_bounds(c.shape(), &motion)
                .loosened(margin);
            let queries = world.query_pipeline_with_filter(rp::QueryFilter {
                flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
                groups: Some(c.collision_groups()),
                exclude_rigid_body: Some(native_id(node.id)),
                ..Default::default()
            });
            for (other_handle, other) in queries.intersect_aabb_conservative(bounds) {
                let Some(target) = other
                    .parent()
                    .and_then(|h| world.bodies.get(h))
                    .filter(|b| b.is_enabled())
                else {
                    continue;
                };
                if !other.is_enabled()
                    || !policies.pair_allows(c.parent(), other.parent())
                    || !policies.one_way_allows(other_handle, other, c.shape(), c.position())
                    || !policies.one_way_allows(handle, c, other.shape(), other.position())
                {
                    continue;
                }
                if other
                    .parent()
                    .and_then(|h| scratch.nodes.binary_search_by_key(&id(h), |n| n.id).ok())
                    .is_some_and(|i| scratch.nodes[i].character)
                {
                    continue;
                }
                if contact(
                    other.position(),
                    other.shape(),
                    c.position(),
                    c.shape(),
                    margin * 1.05,
                )
                .ok()
                .flatten()
                .is_some()
                {
                    continue;
                }
                let target_motion = if target.is_dynamic() {
                    scratch.motion(target, other, world.gravity, dt)
                } else if target.is_kinematic() {
                    crate::physics3d::kinematic_motion::collider_motion(target, other, dt)
                } else {
                    NonlinearRigidMotion::constant_position(*other.position())
                };
                let result = if motion.angvel == rp::Vector::ZERO
                    && target_motion.angvel == rp::Vector::ZERO
                {
                    cast_shapes(
                        other.position(),
                        target_motion.linvel,
                        other.shape(),
                        c.position(),
                        motion.linvel,
                        c.shape(),
                        ShapeCastOptions {
                            max_time_of_impact: 1.,
                            target_distance: margin,
                            stop_at_penetration: false,
                            compute_impact_geometry_on_penetration: true,
                        },
                    )
                } else {
                    cast_shapes_nonlinear(
                        &target_motion,
                        other.shape(),
                        &motion,
                        c.shape(),
                        0.,
                        1.,
                        false,
                    )
                };
                if let Ok(Some(hit)) = result {
                    if hit.time_of_impact > 1.0e-6 {
                        earliest = earliest.min(hit.time_of_impact);
                    }
                }
            }
        }
    }
    earliest
}

use crate::collision::{
    collider_shape, AabbBounds, ColliderKey, ColliderPair as CollisionColliderPair,
    ColliderShapeRef, CollisionPair, CollisionScratch, CollisionSystem, RigidBodyCcdCandidateQuery,
};
use crate::components::{
    AabbCollider, CapsuleCollider, ConvexPolygonCollider, EdgeCollider, RigidBodyCcdDebugHit,
    RigidBodyType, Rotation2D, Transform2D, Velocity, MAX_CONVEX_POLYGON_VERTICES,
};
use crate::entity::Entity;
use crate::world::World;

use super::math::{
    dot_velocity, finite_angular_velocity, finite_rotation, finite_velocity, velocity_len_squared,
};
use super::solver::solve_ccd_velocity_contact;
use super::{has_disabled_rigid_body, RigidBodyStepConfig, RigidBodyStepStats, KINEMATIC_EPSILON};

const MAX_RIGID_BODY_CCD_ITERATIONS: u32 = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
struct RigidBodyCcdHit {
    target_index: usize,
    target_dynamic: bool,
    time: f32,
    normal: Velocity,
    point: Transform2D,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct RigidBodyCcdDynamicTarget {
    start: Transform2D,
    velocity: Velocity,
}

#[derive(Clone, Copy, Debug)]
struct RigidBodyCcdQuery<'a> {
    moving_index: usize,
    start: Transform2D,
    shape: ColliderShapeRef,
    velocity: Velocity,
    delta_seconds: f32,
    integrated: &'a [bool],
}

pub(super) struct RigidBodyCcdScratch<'a> {
    pub(super) collision: &'a mut CollisionScratch,
    pub(super) candidate_indices: &'a mut Vec<usize>,
}

pub(super) fn integrate_dynamic_rigid_body_position_with_ccd(
    world: &mut World,
    index: usize,
    delta_seconds: f32,
    config: RigidBodyStepConfig,
    integrated: &mut [bool],
    stats: &mut RigidBodyStepStats,
    scratch: &mut RigidBodyCcdScratch<'_>,
) -> bool {
    let Some(mut current_start) = world.transforms.get(index).copied().flatten() else {
        return false;
    };
    let Some(shape) = collider_shape(world, index) else {
        return false;
    };
    if shape.is_trigger() {
        return false;
    }
    let mut remaining_seconds = delta_seconds;
    let mut handled_ccd_hit = false;

    for _ in 0..MAX_RIGID_BODY_CCD_ITERATIONS {
        if remaining_seconds <= KINEMATIC_EPSILON {
            break;
        }
        let velocity = finite_velocity(world.velocities[index].unwrap_or_default());
        if velocity_len_squared(velocity) <= KINEMATIC_EPSILON * KINEMATIC_EPSILON {
            break;
        }
        let Some(hit) = earliest_rigid_body_ccd_hit(
            world,
            RigidBodyCcdQuery {
                moving_index: index,
                start: current_start,
                shape,
                velocity,
                delta_seconds: remaining_seconds,
                integrated,
            },
            stats,
            scratch,
        ) else {
            break;
        };

        let impact_seconds = remaining_seconds * hit.time.clamp(0.0, 1.0);
        let dynamic_target = hit
            .target_dynamic
            .then(|| rigid_body_ccd_dynamic_target(world, hit.target_index))
            .flatten();

        integrate_rigid_body_rotation(world, index, impact_seconds);
        current_start = Transform2D {
            x: current_start.x + velocity.vx * impact_seconds,
            y: current_start.y + velocity.vy * impact_seconds,
        };
        world.transforms[index] = Some(current_start);

        if let Some(target) = dynamic_target {
            wake_rigid_body_for_ccd_impact(world, hit.target_index, stats);
            integrate_rigid_body_rotation(world, hit.target_index, impact_seconds);
            world.transforms[hit.target_index] = Some(Transform2D {
                x: target.start.x + target.velocity.vx * impact_seconds,
                y: target.start.y + target.velocity.vy * impact_seconds,
            });
        }

        if apply_rigid_body_ccd_impact(world, index, hit, config) {
            stats.velocity_impulses = stats.velocity_impulses.saturating_add(1);
        }
        world.record_rigid_body_ccd_debug_hit(RigidBodyCcdDebugHit {
            moving_entity: entity_at_index(world, index),
            target_entity: entity_at_index(world, hit.target_index),
            time: hit.time,
            point_x: hit.point.x,
            point_y: hit.point.y,
            normal_x: hit.normal.vx,
            normal_y: hit.normal.vy,
        });
        stats.ccd_hits = stats.ccd_hits.saturating_add(1);
        handled_ccd_hit = true;

        remaining_seconds = (remaining_seconds - impact_seconds).max(0.0);
        if dynamic_target.is_some() {
            integrate_rigid_body_ccd_dynamic_target_remainder(
                world,
                hit.target_index,
                remaining_seconds,
                integrated,
            );
        }
    }

    if !handled_ccd_hit {
        return false;
    }

    let velocity_after_impact = finite_velocity(world.velocities[index].unwrap_or_default());
    if let Some(transform) = world.transforms[index].as_mut() {
        transform.x += velocity_after_impact.vx * remaining_seconds;
        transform.y += velocity_after_impact.vy * remaining_seconds;
    }
    integrate_rigid_body_rotation(world, index, remaining_seconds);
    true
}

fn rigid_body_ccd_dynamic_target(world: &World, index: usize) -> Option<RigidBodyCcdDynamicTarget> {
    let start = world.transforms.get(index).copied().flatten()?;
    let velocity = finite_velocity(
        world
            .velocities
            .get(index)
            .copied()
            .flatten()
            .unwrap_or_default(),
    );
    Some(RigidBodyCcdDynamicTarget { start, velocity })
}

fn integrate_rigid_body_ccd_dynamic_target_remainder(
    world: &mut World,
    index: usize,
    remaining_seconds: f32,
    integrated: &mut [bool],
) {
    let target_velocity_after_impact = finite_velocity(world.velocities[index].unwrap_or_default());
    if let Some(target_transform) = world.transforms[index].as_mut() {
        target_transform.x += target_velocity_after_impact.vx * remaining_seconds;
        target_transform.y += target_velocity_after_impact.vy * remaining_seconds;
    }
    integrate_rigid_body_rotation(world, index, remaining_seconds);
    if let Some(target_integrated) = integrated.get_mut(index) {
        *target_integrated = true;
    }
}

fn wake_rigid_body_for_ccd_impact(world: &mut World, index: usize, stats: &mut RigidBodyStepStats) {
    let Some(mut body) = world.rigid_bodies.get(index).copied().flatten() else {
        return;
    };
    if body.body_type != RigidBodyType::Dynamic || !body.is_sleeping {
        return;
    }
    body.is_sleeping = false;
    body.sleep_timer_seconds = 0.0;
    if let Some(slot) = world.rigid_bodies.get_mut(index) {
        *slot = Some(body);
    }
    stats.bodies_woken = stats.bodies_woken.saturating_add(1);
}

fn integrate_rigid_body_rotation(world: &mut World, index: usize, delta_seconds: f32) {
    if delta_seconds <= 0.0 {
        return;
    }
    if let (Some(rotation), Some(angular_velocity)) = (
        world.rotations[index].as_mut(),
        world.angular_velocities[index].map(finite_angular_velocity),
    ) {
        rotation.radians = finite_rotation(Rotation2D {
            radians: rotation.radians + angular_velocity.radians_per_second * delta_seconds,
        })
        .radians;
    }
}

fn earliest_rigid_body_ccd_hit(
    world: &World,
    query: RigidBodyCcdQuery<'_>,
    stats: &mut RigidBodyStepStats,
    scratch: &mut RigidBodyCcdScratch<'_>,
) -> Option<RigidBodyCcdHit> {
    let mut best = None;
    CollisionSystem::build_rigid_body_ccd_candidate_indices_into(
        scratch.collision,
        world,
        RigidBodyCcdCandidateQuery {
            moving_index: query.moving_index,
            moving_start: query.start,
            moving_shape: query.shape,
            moving_velocity: query.velocity,
            delta_seconds: query.delta_seconds,
        },
        scratch.candidate_indices,
    );
    for &target_index in scratch.candidate_indices.iter() {
        if !rigid_body_ccd_target_allows(world, query.moving_index, target_index, query.integrated)
        {
            continue;
        }
        let Some(target_shape) = collider_shape(world, target_index) else {
            continue;
        };
        if target_shape.is_trigger() {
            continue;
        }
        let Some(target_transform) = world.transforms[target_index] else {
            continue;
        };
        if CollisionSystem::shapes_overlap(query.start, query.shape, target_transform, target_shape)
        {
            continue;
        }
        let target_velocity = finite_velocity(world.velocities[target_index].unwrap_or_default());
        stats.ccd_checks = stats.ccd_checks.saturating_add(1);
        let Some(contact) = CollisionSystem::swept_shape_contact(
            query.start,
            query.velocity,
            query.shape,
            target_transform,
            target_velocity,
            target_shape,
            query.delta_seconds,
        ) else {
            continue;
        };
        let normal = Velocity {
            vx: contact.normal_x,
            vy: contact.normal_y,
        };
        let relative_velocity = Velocity {
            vx: query.velocity.vx - target_velocity.vx,
            vy: query.velocity.vy - target_velocity.vy,
        };
        if dot_velocity(relative_velocity, normal) <= KINEMATIC_EPSILON {
            continue;
        }
        let time = contact.time.clamp(0.0, 1.0);
        let moving_at_impact = Transform2D {
            x: query.start.x + query.velocity.vx * query.delta_seconds * time,
            y: query.start.y + query.velocity.vy * query.delta_seconds * time,
        };
        let target_at_impact = Transform2D {
            x: target_transform.x + target_velocity.vx * query.delta_seconds * time,
            y: target_transform.y + target_velocity.vy * query.delta_seconds * time,
        };
        let hit = RigidBodyCcdHit {
            target_index,
            target_dynamic: world
                .rigid_bodies
                .get(target_index)
                .copied()
                .flatten()
                .is_some_and(|body| body.body_type == RigidBodyType::Dynamic),
            time,
            normal,
            point: rigid_body_ccd_contact_point(
                moving_at_impact,
                query.shape,
                target_at_impact,
                target_shape,
                normal,
            ),
        };
        update_rigid_body_ccd_hit(&mut best, hit);
    }
    best
}

fn rigid_body_ccd_target_allows(
    world: &World,
    moving_index: usize,
    target_index: usize,
    integrated: &[bool],
) -> bool {
    if moving_index == target_index || !world.alive.get(target_index).copied().unwrap_or(false) {
        return false;
    }
    if has_disabled_rigid_body(world, moving_index) || has_disabled_rigid_body(world, target_index)
    {
        return false;
    }
    if !rigid_contact_filter_allows(world, moving_index, target_index) {
        return false;
    }
    if let Some(body) = world.rigid_bodies.get(target_index).copied().flatten() {
        body.body_type != RigidBodyType::Dynamic
            || !integrated.get(target_index).copied().unwrap_or(false)
    } else {
        true
    }
}

fn rigid_contact_filter_allows(world: &World, a_index: usize, b_index: usize) -> bool {
    let Some(a_filter) = world.collision_filter_at(a_index) else {
        return false;
    };
    let Some(b_filter) = world.collision_filter_at(b_index) else {
        return false;
    };
    a_filter.can_collide_with(b_filter) && world.height_spans_allow_at(a_index, b_index)
}

fn rigid_body_ccd_contact_point(
    moving_transform: Transform2D,
    moving_shape: ColliderShapeRef,
    target_transform: Transform2D,
    target_shape: ColliderShapeRef,
    normal: Velocity,
) -> Transform2D {
    match (moving_shape, target_shape) {
        (ColliderShapeRef::Aabb(moving_collider), ColliderShapeRef::Aabb(target_collider)) => {
            let moving_bounds = AabbBounds::from_transform(moving_transform, moving_collider);
            let target_bounds = AabbBounds::from_transform(target_transform, target_collider);
            let moving_center = moving_collider.center(moving_transform);
            if normal.vx != 0.0 {
                let min_y = moving_bounds.min_y.max(target_bounds.min_y);
                let max_y = moving_bounds.max_y.min(target_bounds.max_y);
                Transform2D {
                    x: moving_center.x + normal.vx * moving_collider.half_width,
                    y: (min_y + max_y) * 0.5,
                }
            } else {
                let min_x = moving_bounds.min_x.max(target_bounds.min_x);
                let max_x = moving_bounds.max_x.min(target_bounds.max_x);
                Transform2D {
                    x: (min_x + max_x) * 0.5,
                    y: moving_center.y + normal.vy * moving_collider.half_height,
                }
            }
        }
        (ColliderShapeRef::Circle(moving_collider), _) => {
            let center = moving_collider.center(moving_transform);
            Transform2D {
                x: center.x + normal.vx * moving_collider.radius,
                y: center.y + normal.vy * moving_collider.radius,
            }
        }
        (ColliderShapeRef::OrientedBox(moving_collider, moving_rotation), _) => {
            oriented_box_support_point(moving_transform, moving_collider, moving_rotation, normal)
        }
        (ColliderShapeRef::Aabb(moving_collider), ColliderShapeRef::Circle(target_collider)) => {
            let target_center = target_collider.center(target_transform);
            let moving_bounds = AabbBounds::from_transform(moving_transform, moving_collider);
            Transform2D {
                x: (target_center.x - normal.vx * target_collider.radius)
                    .clamp(moving_bounds.min_x, moving_bounds.max_x),
                y: (target_center.y - normal.vy * target_collider.radius)
                    .clamp(moving_bounds.min_y, moving_bounds.max_y),
            }
        }
        (ColliderShapeRef::Capsule(moving_collider), _) => {
            capsule_support_point(moving_transform, moving_collider, normal)
        }
        (ColliderShapeRef::Edge(moving_collider), _) => {
            edge_support_point(moving_transform, moving_collider, normal)
        }
        (ColliderShapeRef::ConvexPolygon(moving_collider, moving_rotation), _) => {
            convex_polygon_support_point(moving_transform, moving_collider, moving_rotation, normal)
        }
        (
            ColliderShapeRef::Aabb(moving_collider),
            ColliderShapeRef::Capsule(_)
            | ColliderShapeRef::Edge(_)
            | ColliderShapeRef::OrientedBox(_, _),
        ) => aabb_support_point(moving_transform, moving_collider, normal),
        (ColliderShapeRef::Aabb(moving_collider), ColliderShapeRef::ConvexPolygon(_, _)) => {
            aabb_support_point(moving_transform, moving_collider, normal)
        }
    }
}

fn aabb_support_point(
    transform: Transform2D,
    collider: AabbCollider,
    direction: Velocity,
) -> Transform2D {
    let center = collider.center(transform);
    Transform2D {
        x: center.x + support_axis_sign(direction.vx) * collider.half_width,
        y: center.y + support_axis_sign(direction.vy) * collider.half_height,
    }
}

fn oriented_box_support_point(
    transform: Transform2D,
    collider: crate::components::OrientedBoxCollider,
    rotation_radians: f32,
    direction: Velocity,
) -> Transform2D {
    let center = collider.center(transform);
    if !rotation_radians.is_finite()
        || !direction.vx.is_finite()
        || !direction.vy.is_finite()
        || collider.half_width <= 0.0
        || collider.half_height <= 0.0
    {
        return center;
    }

    let (sin, cos) = rotation_radians.sin_cos();
    let axis_x = Velocity { vx: cos, vy: sin };
    let axis_y = Velocity { vx: -sin, vy: cos };
    let x_sign = support_axis_sign(direction.vx * axis_x.vx + direction.vy * axis_x.vy);
    let y_sign = support_axis_sign(direction.vx * axis_y.vx + direction.vy * axis_y.vy);
    Transform2D {
        x: center.x
            + axis_x.vx * collider.half_width * x_sign
            + axis_y.vx * collider.half_height * y_sign,
        y: center.y
            + axis_x.vy * collider.half_width * x_sign
            + axis_y.vy * collider.half_height * y_sign,
    }
}

fn capsule_support_point(
    transform: Transform2D,
    collider: CapsuleCollider,
    direction: Velocity,
) -> Transform2D {
    let start = collider.start(transform);
    let end = collider.end(transform);
    let start_projection = start.x * direction.vx + start.y * direction.vy;
    let end_projection = end.x * direction.vx + end.y * direction.vy;
    let endpoint = if (start_projection - end_projection).abs() <= KINEMATIC_EPSILON {
        Transform2D {
            x: (start.x + end.x) * 0.5,
            y: (start.y + end.y) * 0.5,
        }
    } else if start_projection > end_projection {
        start
    } else {
        end
    };
    let (normal_x, normal_y) = normalized_direction(direction);
    Transform2D {
        x: endpoint.x + normal_x * collider.radius,
        y: endpoint.y + normal_y * collider.radius,
    }
}

fn edge_support_point(
    transform: Transform2D,
    collider: EdgeCollider,
    direction: Velocity,
) -> Transform2D {
    let start = collider.start(transform);
    let end = collider.end(transform);
    let start_projection = start.x * direction.vx + start.y * direction.vy;
    let end_projection = end.x * direction.vx + end.y * direction.vy;
    if (start_projection - end_projection).abs() <= KINEMATIC_EPSILON {
        Transform2D {
            x: (start.x + end.x) * 0.5,
            y: (start.y + end.y) * 0.5,
        }
    } else if start_projection > end_projection {
        start
    } else {
        end
    }
}

fn convex_polygon_support_point(
    transform: Transform2D,
    collider: ConvexPolygonCollider,
    rotation_radians: f32,
    direction: Velocity,
) -> Transform2D {
    let center = collider.center(transform);
    let vertex_count = collider.vertex_count as usize;
    if !(3..=MAX_CONVEX_POLYGON_VERTICES).contains(&vertex_count)
        || !rotation_radians.is_finite()
        || !direction.vx.is_finite()
        || !direction.vy.is_finite()
    {
        return center;
    }

    let (sin, cos) = rotation_radians.sin_cos();
    let mut best_projection = f32::NEG_INFINITY;
    let mut support_sum = Transform2D { x: 0.0, y: 0.0 };
    let mut support_count = 0;
    for vertex in &collider.vertices[..vertex_count] {
        if !vertex.x.is_finite() || !vertex.y.is_finite() {
            return center;
        }
        let point = Transform2D {
            x: center.x + vertex.x * cos - vertex.y * sin,
            y: center.y + vertex.x * sin + vertex.y * cos,
        };
        let projection = point.x * direction.vx + point.y * direction.vy;
        if projection > best_projection + KINEMATIC_EPSILON {
            best_projection = projection;
            support_sum = point;
            support_count = 1;
        } else if (projection - best_projection).abs() <= KINEMATIC_EPSILON {
            support_sum.x += point.x;
            support_sum.y += point.y;
            support_count += 1;
        }
    }

    if support_count == 0 {
        center
    } else {
        Transform2D {
            x: support_sum.x / support_count as f32,
            y: support_sum.y / support_count as f32,
        }
    }
}

fn normalized_direction(direction: Velocity) -> (f32, f32) {
    let length_squared = direction.vx * direction.vx + direction.vy * direction.vy;
    if length_squared <= KINEMATIC_EPSILON * KINEMATIC_EPSILON || !length_squared.is_finite() {
        return (1.0, 0.0);
    }
    let inv_length = length_squared.sqrt().recip();
    (direction.vx * inv_length, direction.vy * inv_length)
}

fn support_axis_sign(value: f32) -> f32 {
    if value > KINEMATIC_EPSILON {
        1.0
    } else if value < -KINEMATIC_EPSILON {
        -1.0
    } else {
        0.0
    }
}

fn update_rigid_body_ccd_hit(best: &mut Option<RigidBodyCcdHit>, next: RigidBodyCcdHit) {
    if best.is_none_or(|current| {
        next.time
            .total_cmp(&current.time)
            .then_with(|| next.target_index.cmp(&current.target_index))
            .is_lt()
    }) {
        *best = Some(next);
    }
}

fn apply_rigid_body_ccd_impact(
    world: &mut World,
    moving_index: usize,
    hit: RigidBodyCcdHit,
    config: RigidBodyStepConfig,
) -> bool {
    solve_ccd_velocity_contact(
        world,
        CollisionPair {
            a: entity_at_index(world, moving_index),
            b: entity_at_index(world, hit.target_index),
        },
        CollisionColliderPair {
            a: ColliderKey {
                entity_index: moving_index,
                collider_index: 0,
                segment_index: 0,
            },
            b: ColliderKey {
                entity_index: hit.target_index,
                collider_index: 0,
                segment_index: 0,
            },
        },
        hit.point,
        hit.normal,
        config,
    )
}

fn entity_at_index(world: &World, index: usize) -> Entity {
    Entity {
        id: index as u32,
        generation: world.generations[index],
    }
}

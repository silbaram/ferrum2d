use super::*;

pub(super) fn aabb_contact(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: AabbCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    let a_center = ac.center(at);
    let b_center = bc.center(bt);
    let dx = b_center.x - a_center.x;
    let overlap_x = ac.half_width + bc.half_width - dx.abs();
    if overlap_x <= 0.0 {
        return None;
    }

    let dy = b_center.y - a_center.y;
    let overlap_y = ac.half_height + bc.half_height - dy.abs();
    if overlap_y <= 0.0 {
        return None;
    }

    if overlap_x < overlap_y {
        Some(AabbContact {
            normal_x: if dx >= 0.0 { 1.0 } else { -1.0 },
            normal_y: 0.0,
            penetration: overlap_x,
        })
    } else {
        Some(AabbContact {
            normal_x: 0.0,
            normal_y: if dy >= 0.0 { 1.0 } else { -1.0 },
            penetration: overlap_y,
        })
    }
}

pub(super) fn circle_contact(
    at: Transform2D,
    ac: CircleCollider,
    bt: Transform2D,
    bc: CircleCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    if !is_valid_radius(ac.radius) || !is_valid_radius(bc.radius) {
        return None;
    }
    let a_center = ac.center(at);
    let b_center = bc.center(bt);
    let dx = b_center.x - a_center.x;
    let dy = b_center.y - a_center.y;
    let radius_sum = ac.radius + bc.radius;
    let distance_squared = dx * dx + dy * dy;
    if distance_squared >= radius_sum * radius_sum {
        return None;
    }
    if distance_squared <= RAY_EPSILON * RAY_EPSILON {
        return Some(AabbContact {
            normal_x: 1.0,
            normal_y: 0.0,
            penetration: radius_sum,
        });
    }
    let distance = distance_squared.sqrt();
    Some(AabbContact {
        normal_x: dx / distance,
        normal_y: dy / distance,
        penetration: radius_sum - distance,
    })
}

pub(super) fn aabb_circle_contact(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CircleCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    if !is_valid_radius(bc.radius) {
        return None;
    }
    let bounds = AabbBounds::from_transform(at, ac);
    let circle_center = bc.center(bt);
    let closest_x = circle_center.x.clamp(bounds.min_x, bounds.max_x);
    let closest_y = circle_center.y.clamp(bounds.min_y, bounds.max_y);
    let dx = circle_center.x - closest_x;
    let dy = circle_center.y - closest_y;
    let distance_squared = dx * dx + dy * dy;
    if distance_squared > bc.radius * bc.radius {
        return None;
    }
    if distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = distance_squared.sqrt();
        return Some(AabbContact {
            normal_x: dx / distance,
            normal_y: dy / distance,
            penetration: bc.radius - distance,
        });
    }

    let left = circle_center.x - bounds.min_x;
    let right = bounds.max_x - circle_center.x;
    let down = circle_center.y - bounds.min_y;
    let up = bounds.max_y - circle_center.y;
    let (normal_x, normal_y, distance_to_face) = if left <= right && left <= down && left <= up {
        (-1.0, 0.0, left)
    } else if right <= down && right <= up {
        (1.0, 0.0, right)
    } else if down <= up {
        (0.0, -1.0, down)
    } else {
        (0.0, 1.0, up)
    };

    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: bc.radius + distance_to_face,
    })
}

pub(super) fn aabb_capsule_contact(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    if !is_valid_half_extent(ac.half_width)
        || !is_valid_half_extent(ac.half_height)
        || !capsule_collider_is_valid(bc)
    {
        return None;
    }

    let bounds = AabbBounds::from_transform(at, ac);
    let start = bc.start(bt);
    let end = bc.end(bt);
    let closest = closest_segment_aabb_pair(start, end, bounds);
    if closest.distance_squared > bc.radius * bc.radius {
        return None;
    }
    if closest.distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = closest.distance_squared.sqrt();
        return Some(AabbContact {
            normal_x: (closest.a.x - closest.b.x) / distance,
            normal_y: (closest.a.y - closest.b.y) / distance,
            penetration: bc.radius - distance,
        });
    }

    let reference = capsule_aabb_reference_point(start, end, bounds);
    let (normal_x, normal_y, distance_to_face) = nearest_aabb_face(reference, bounds);
    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: bc.radius + distance_to_face,
    })
}

pub(super) fn capsule_circle_contact(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CircleCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    if !capsule_collider_is_valid(ac) || !is_valid_radius(bc.radius) {
        return None;
    }

    let start = ac.start(at);
    let end = ac.end(at);
    let circle_center = bc.center(bt);
    let closest = closest_point_on_segment(circle_center, start, end);
    let dx = circle_center.x - closest.x;
    let dy = circle_center.y - closest.y;
    let radius_sum = ac.radius + bc.radius;
    let distance_squared = dx * dx + dy * dy;
    if distance_squared > radius_sum * radius_sum {
        return None;
    }
    if distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = distance_squared.sqrt();
        return Some(AabbContact {
            normal_x: dx / distance,
            normal_y: dy / distance,
            penetration: radius_sum - distance,
        });
    }

    let (normal_x, normal_y) = fallback_contact_normal(ac.center(at), circle_center);
    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: radius_sum,
    })
}

pub(super) fn capsule_capsule_contact(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
) -> Option<AabbContact> {
    if !ac.enabled || !bc.enabled {
        return None;
    }
    if !capsule_collider_is_valid(ac) || !capsule_collider_is_valid(bc) {
        return None;
    }

    let closest = closest_points_on_segments(ac.start(at), ac.end(at), bc.start(bt), bc.end(bt));
    let radius_sum = ac.radius + bc.radius;
    if closest.distance_squared > radius_sum * radius_sum {
        return None;
    }
    if closest.distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = closest.distance_squared.sqrt();
        return Some(AabbContact {
            normal_x: (closest.b.x - closest.a.x) / distance,
            normal_y: (closest.b.y - closest.a.y) / distance,
            penetration: radius_sum - distance,
        });
    }

    let (normal_x, normal_y) = fallback_contact_normal(ac.center(at), bc.center(bt));
    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: radius_sum,
    })
}

pub(super) fn oriented_box_oriented_box_contact(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
) -> Option<AabbContact> {
    let axes = [
        (a.axis_x_x, a.axis_x_y),
        (a.axis_y_x, a.axis_y_y),
        (b.axis_x_x, b.axis_x_y),
        (b.axis_y_x, b.axis_y_y),
    ];
    let mut best_contact = AabbContact {
        normal_x: 0.0,
        normal_y: 0.0,
        penetration: f32::INFINITY,
    };

    for (axis_x, axis_y) in axes {
        let contact = oriented_box_axis_contact(a, b, axis_x, axis_y)?;
        if contact.penetration < best_contact.penetration {
            best_contact = contact;
        }
    }

    Some(best_contact)
}

pub(super) fn oriented_box_axis_contact(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
    axis_x: f32,
    axis_y: f32,
) -> Option<AabbContact> {
    let center_dx = b.center.x - a.center.x;
    let center_dy = b.center.y - a.center.y;
    let center_distance = center_dx * axis_x + center_dy * axis_y;
    let penetration = oriented_box_projection_radius(a, axis_x, axis_y)
        + oriented_box_projection_radius(b, axis_x, axis_y)
        - center_distance.abs();
    if penetration <= 0.0 {
        return None;
    }

    let normal_sign = if center_distance >= 0.0 { 1.0 } else { -1.0 };
    Some(AabbContact {
        normal_x: axis_x * normal_sign,
        normal_y: axis_y * normal_sign,
        penetration,
    })
}

pub(super) fn oriented_box_circle_contact(
    oriented_box: OrientedBoxGeometry,
    circle_center: Transform2D,
    radius: f32,
) -> Option<AabbContact> {
    if !is_valid_radius(radius) {
        return None;
    }

    let local_center = oriented_box_local_point(oriented_box, circle_center);
    let closest_local = Transform2D {
        x: local_center
            .x
            .clamp(-oriented_box.half_width, oriented_box.half_width),
        y: local_center
            .y
            .clamp(-oriented_box.half_height, oriented_box.half_height),
    };
    let separation_x = local_center.x - closest_local.x;
    let separation_y = local_center.y - closest_local.y;
    let distance_squared = separation_x * separation_x + separation_y * separation_y;
    if distance_squared > radius * radius {
        return None;
    }
    if distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = distance_squared.sqrt();
        let (normal_x, normal_y) = oriented_box_world_vector(
            oriented_box,
            separation_x / distance,
            separation_y / distance,
        );
        return Some(AabbContact {
            normal_x,
            normal_y,
            penetration: radius - distance,
        });
    }

    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    )?;
    let (local_normal_x, local_normal_y, distance_to_face) =
        nearest_aabb_face(local_center, local_bounds);
    let (normal_x, normal_y) =
        oriented_box_world_vector(oriented_box, local_normal_x, local_normal_y);
    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: radius + distance_to_face,
    })
}

pub(super) fn oriented_box_capsule_contact(
    oriented_box: OrientedBoxGeometry,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
) -> Option<AabbContact> {
    if !is_valid_radius(radius) {
        return None;
    }

    let local_start = oriented_box_local_point(oriented_box, start);
    let local_end = oriented_box_local_point(oriented_box, end);
    let local_bounds = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    )?;
    let closest = closest_segment_aabb_pair(local_start, local_end, local_bounds);
    if closest.distance_squared > radius * radius {
        return None;
    }
    if closest.distance_squared > RAY_EPSILON * RAY_EPSILON {
        let distance = closest.distance_squared.sqrt();
        let (normal_x, normal_y) = oriented_box_world_vector(
            oriented_box,
            (closest.a.x - closest.b.x) / distance,
            (closest.a.y - closest.b.y) / distance,
        );
        return Some(AabbContact {
            normal_x,
            normal_y,
            penetration: radius - distance,
        });
    }

    let reference = capsule_aabb_reference_point(local_start, local_end, local_bounds);
    let (local_normal_x, local_normal_y, distance_to_face) =
        nearest_aabb_face(reference, local_bounds);
    let (normal_x, normal_y) =
        oriented_box_world_vector(oriented_box, local_normal_x, local_normal_y);
    Some(AabbContact {
        normal_x,
        normal_y,
        penetration: radius + distance_to_face,
    })
}

pub(super) fn invert_contact(contact: AabbContact) -> AabbContact {
    AabbContact {
        normal_x: -contact.normal_x,
        normal_y: -contact.normal_y,
        penetration: contact.penetration,
    }
}

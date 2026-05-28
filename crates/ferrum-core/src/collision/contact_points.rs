use super::*;

pub(super) fn contact_point(
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
    contact: AabbContact,
) -> (f32, f32) {
    match (ac, bc) {
        (ColliderShapeRef::Edge(ac), other) => contact_point(
            at,
            ColliderShapeRef::Capsule(edge_as_capsule(ac)),
            bt,
            other,
            contact,
        ),
        (other, ColliderShapeRef::Edge(bc)) => contact_point(
            at,
            other,
            bt,
            ColliderShapeRef::Capsule(edge_as_capsule(bc)),
            contact,
        ),
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_aabb_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Circle(bc)) => {
            aabb_circle_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Aabb(bc)) => {
            circle_aabb_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Circle(_bc)) => {
            circle_circle_contact_point(at, ac, contact)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let a_box = aabb_as_oriented_box(AabbBounds::from_transform(at, ac));
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation);
            if let (Some(a_box), Some(b_box)) = (a_box, b_box) {
                let point = oriented_box_oriented_box_contact_point(a_box, b_box, contact);
                return (point.x, point.y);
            }
            aabb_aabb_contact_point(
                at,
                ac,
                bt,
                AabbCollider::new(0.0, 0.0, false, bc.layer),
                contact,
            )
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Aabb(bc)) => {
            if let (Some(a_box), Some(b_box)) = (
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation),
                aabb_as_oriented_box(AabbBounds::from_transform(bt, bc)),
            ) {
                let point = oriented_box_oriented_box_contact_point(a_box, b_box, contact);
                return (point.x, point.y);
            }
            let a_center = ac.center(at);
            (a_center.x, a_center.y)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            if let Some(oriented_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            {
                let point = oriented_box_circle_contact_point(
                    oriented_box,
                    ac.center(at),
                    ac.radius,
                    invert_contact(contact),
                );
                return (point.x, point.y);
            }
            let center = ac.center(at);
            (center.x, center.y)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Circle(bc)) => {
            if let Some(oriented_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            {
                let point = oriented_box_circle_contact_point(
                    oriented_box,
                    bc.center(bt),
                    bc.radius,
                    contact,
                );
                return (point.x, point.y);
            }
            let center = bc.center(bt);
            (center.x, center.y)
        }
        (
            ColliderShapeRef::OrientedBox(ac, a_rotation),
            ColliderShapeRef::OrientedBox(bc, b_rotation),
        ) => {
            if let (Some(a_box), Some(b_box)) = (
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation),
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation),
            ) {
                let point = oriented_box_oriented_box_contact_point(a_box, b_box, contact);
                return (point.x, point.y);
            }
            let a_center = ac.center(at);
            let b_center = bc.center(bt);
            (
                (a_center.x + b_center.x) * 0.5,
                (a_center.y + b_center.y) * 0.5,
            )
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Capsule(bc)) => {
            if let Some(oriented_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            {
                let point = oriented_box_capsule_contact_point(
                    oriented_box,
                    bc.start(bt),
                    bc.end(bt),
                    bc.radius,
                    contact,
                );
                return (point.x, point.y);
            }
            let center = bc.center(bt);
            (center.x, center.y)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            if let Some(oriented_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            {
                let point = oriented_box_capsule_contact_point(
                    oriented_box,
                    ac.start(at),
                    ac.end(at),
                    ac.radius,
                    invert_contact(contact),
                );
                return (point.x, point.y);
            }
            let center = ac.center(at);
            (center.x, center.y)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Capsule(bc)) => {
            aabb_capsule_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Capsule(_bc)) => {
            circle_circle_contact_point(at, ac, contact)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Aabb(bc)) => {
            capsule_aabb_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Circle(bc)) => {
            capsule_circle_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Capsule(bc)) => {
            capsule_capsule_contact_point(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::ConvexPolygon(_, _), _) | (_, ColliderShapeRef::ConvexPolygon(_, _)) => {
            if let (Some(a), Some(b)) = (
                convex_contact_geometry_from_shape(at, ac),
                convex_contact_geometry_from_shape(bt, bc),
            ) {
                let point = convex_shape_contact_point(a, b, contact);
                return (point.x, point.y);
            }
            let a_center = collider_shape_center(at, ac);
            let b_center = collider_shape_center(bt, bc);
            (
                (a_center.x + b_center.x) * 0.5,
                (a_center.y + b_center.y) * 0.5,
            )
        }
    }
}

fn aabb_aabb_contact_point(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: AabbCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let a_bounds = AabbBounds::from_transform(at, ac);
    let b_bounds = AabbBounds::from_transform(bt, bc);
    let a_center = ac.center(at);
    if contact.normal_x != 0.0 {
        let min_y = a_bounds.min_y.max(b_bounds.min_y);
        let max_y = a_bounds.max_y.min(b_bounds.max_y);
        (
            a_center.x + contact.normal_x * ac.half_width,
            (min_y + max_y) * 0.5,
        )
    } else {
        let min_x = a_bounds.min_x.max(b_bounds.min_x);
        let max_x = a_bounds.max_x.min(b_bounds.max_x);
        (
            (min_x + max_x) * 0.5,
            a_center.y + contact.normal_y * ac.half_height,
        )
    }
}

fn aabb_circle_contact_point(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CircleCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let bounds = AabbBounds::from_transform(at, ac);
    let circle_center = bc.center(bt);
    let closest_x = circle_center.x.clamp(bounds.min_x, bounds.max_x);
    let closest_y = circle_center.y.clamp(bounds.min_y, bounds.max_y);
    let inside = (closest_x - circle_center.x).abs() <= RAY_EPSILON
        && (closest_y - circle_center.y).abs() <= RAY_EPSILON;
    if inside {
        (
            circle_center.x - contact.normal_x * bc.radius,
            circle_center.y - contact.normal_y * bc.radius,
        )
    } else {
        (closest_x, closest_y)
    }
}

fn circle_aabb_contact_point(
    at: Transform2D,
    ac: CircleCollider,
    bt: Transform2D,
    bc: AabbCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let circle_center = ac.center(at);
    let point_on_circle = (
        circle_center.x + contact.normal_x * ac.radius,
        circle_center.y + contact.normal_y * ac.radius,
    );
    let bounds = AabbBounds::from_transform(bt, bc);
    (
        point_on_circle.0.clamp(bounds.min_x, bounds.max_x),
        point_on_circle.1.clamp(bounds.min_y, bounds.max_y),
    )
}

fn circle_circle_contact_point(
    at: Transform2D,
    ac: CircleCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let center = ac.center(at);
    (
        center.x + contact.normal_x * ac.radius,
        center.y + contact.normal_y * ac.radius,
    )
}

pub(super) fn aabb_capsule_contact_point(
    at: Transform2D,
    ac: AabbCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let bounds = AabbBounds::from_transform(at, ac);
    let start = bc.start(bt);
    let end = bc.end(bt);
    let closest = closest_segment_aabb_pair(start, end, bounds);
    if closest.distance_squared > RAY_EPSILON * RAY_EPSILON {
        return (closest.b.x, closest.b.y);
    }

    let reference = capsule_aabb_reference_point(start, end, bounds);
    (
        reference.x - contact.normal_x * bc.radius,
        reference.y - contact.normal_y * bc.radius,
    )
}

fn capsule_aabb_contact_point(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: AabbCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let bounds = AabbBounds::from_transform(bt, bc);
    let start = ac.start(at);
    let end = ac.end(at);
    let reference = closest_point_on_segment(aabb_center(bounds), start, end);
    let point_on_capsule = Transform2D {
        x: reference.x + contact.normal_x * ac.radius,
        y: reference.y + contact.normal_y * ac.radius,
    };
    (
        point_on_capsule.x.clamp(bounds.min_x, bounds.max_x),
        point_on_capsule.y.clamp(bounds.min_y, bounds.max_y),
    )
}

fn capsule_circle_contact_point(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CircleCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let circle_center = bc.center(bt);
    let closest = closest_point_on_segment(circle_center, ac.start(at), ac.end(at));
    (
        closest.x + contact.normal_x * ac.radius,
        closest.y + contact.normal_y * ac.radius,
    )
}

pub(super) fn capsule_capsule_contact_point(
    at: Transform2D,
    ac: CapsuleCollider,
    bt: Transform2D,
    bc: CapsuleCollider,
    contact: AabbContact,
) -> (f32, f32) {
    let closest = closest_points_on_segments(ac.start(at), ac.end(at), bc.start(bt), bc.end(bt));
    let a_surface = Transform2D {
        x: closest.a.x + contact.normal_x * ac.radius,
        y: closest.a.y + contact.normal_y * ac.radius,
    };
    let b_surface = Transform2D {
        x: closest.b.x - contact.normal_x * bc.radius,
        y: closest.b.y - contact.normal_y * bc.radius,
    };
    (
        (a_surface.x + b_surface.x) * 0.5,
        (a_surface.y + b_surface.y) * 0.5,
    )
}

pub(super) fn oriented_box_oriented_box_contact_point(
    a: OrientedBoxGeometry,
    b: OrientedBoxGeometry,
    contact: AabbContact,
) -> Transform2D {
    let a_point = oriented_box_contact_face_point(a, contact.normal_x, contact.normal_y);
    let b_point = oriented_box_contact_face_point(b, -contact.normal_x, -contact.normal_y);
    Transform2D {
        x: (a_point.x + b_point.x) * 0.5,
        y: (a_point.y + b_point.y) * 0.5,
    }
}

fn oriented_box_circle_contact_point(
    oriented_box: OrientedBoxGeometry,
    circle_center: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Transform2D {
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
    if distance_squared > RAY_EPSILON * RAY_EPSILON {
        return oriented_box_world_point(oriented_box, closest_local);
    }

    Transform2D {
        x: circle_center.x - contact.normal_x * radius,
        y: circle_center.y - contact.normal_y * radius,
    }
}

pub(super) fn oriented_box_capsule_contact_point(
    oriented_box: OrientedBoxGeometry,
    start: Transform2D,
    end: Transform2D,
    radius: f32,
    contact: AabbContact,
) -> Transform2D {
    let local_start = oriented_box_local_point(oriented_box, start);
    let local_end = oriented_box_local_point(oriented_box, end);
    let Some(local_bounds) = AabbBounds::from_center(
        Transform2D { x: 0.0, y: 0.0 },
        oriented_box.half_width,
        oriented_box.half_height,
    ) else {
        return oriented_box.center;
    };
    let closest = closest_segment_aabb_pair(local_start, local_end, local_bounds);
    if closest.distance_squared > RAY_EPSILON * RAY_EPSILON {
        return oriented_box_world_point(oriented_box, closest.b);
    }

    let reference = capsule_aabb_reference_point(local_start, local_end, local_bounds);
    let (local_normal_x, local_normal_y) =
        oriented_box_local_vector(oriented_box, contact.normal_x, contact.normal_y);
    oriented_box_world_point(
        oriented_box,
        Transform2D {
            x: reference.x - local_normal_x * radius,
            y: reference.y - local_normal_y * radius,
        },
    )
}

fn oriented_box_contact_face_point(
    oriented_box: OrientedBoxGeometry,
    normal_x: f32,
    normal_y: f32,
) -> Transform2D {
    let (local_normal_x, local_normal_y) =
        oriented_box_local_vector(oriented_box, normal_x, normal_y);
    let local_point = if local_normal_x.abs() >= local_normal_y.abs() {
        Transform2D {
            x: if local_normal_x >= 0.0 {
                oriented_box.half_width
            } else {
                -oriented_box.half_width
            },
            y: 0.0,
        }
    } else {
        Transform2D {
            x: 0.0,
            y: if local_normal_y >= 0.0 {
                oriented_box.half_height
            } else {
                -oriented_box.half_height
            },
        }
    };
    oriented_box_world_point(oriented_box, local_point)
}

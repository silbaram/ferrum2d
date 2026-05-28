use super::*;

pub(super) fn contact_manifold_points(
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
    contact: AabbContact,
) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
    match (ac, bc) {
        (ColliderShapeRef::Edge(ac), other) => contact_manifold_points(
            at,
            ColliderShapeRef::Capsule(edge_as_capsule(ac)),
            bt,
            other,
            contact,
        ),
        (other, ColliderShapeRef::Edge(bc)) => contact_manifold_points(
            at,
            other,
            bt,
            ColliderShapeRef::Capsule(edge_as_capsule(bc)),
            contact,
        ),
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_aabb_contact_manifold_points(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Circle(bc)) => {
            if let Some(points) = aabb_circle_contact_manifold_points(at, ac, bt, bc, contact) {
                return points;
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Aabb(ac),
                bt,
                ColliderShapeRef::Circle(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Aabb(bc)) => {
            if let Some(points) =
                aabb_circle_contact_manifold_points(bt, bc, at, ac, invert_contact(contact))
            {
                return points;
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Circle(ac),
                bt,
                ColliderShapeRef::Aabb(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let a_box = aabb_as_oriented_box(AabbBounds::from_transform(at, ac));
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation);
            if let (Some(a_box), Some(b_box)) = (a_box, b_box) {
                return oriented_box_oriented_box_contact_manifold_points(a_box, b_box, contact);
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Aabb(ac),
                bt,
                ColliderShapeRef::OrientedBox(bc, b_rotation),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Aabb(bc)) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation);
            let b_box = aabb_as_oriented_box(AabbBounds::from_transform(bt, bc));
            if let (Some(a_box), Some(b_box)) = (a_box, b_box) {
                return oriented_box_oriented_box_contact_manifold_points(a_box, b_box, contact);
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::OrientedBox(ac, a_rotation),
                bt,
                ColliderShapeRef::Aabb(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            if let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            {
                if let Some(points) = oriented_box_circle_contact_manifold_points(
                    b_box,
                    ac.center(at),
                    ac.radius,
                    invert_contact(contact),
                ) {
                    return points;
                }
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Circle(ac),
                bt,
                ColliderShapeRef::OrientedBox(bc, b_rotation),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Circle(bc)) => {
            if let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            {
                if let Some(points) = oriented_box_circle_contact_manifold_points(
                    a_box,
                    bc.center(bt),
                    bc.radius,
                    contact,
                ) {
                    return points;
                }
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::OrientedBox(ac, a_rotation),
                bt,
                ColliderShapeRef::Circle(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (
            ColliderShapeRef::OrientedBox(ac, a_rotation),
            ColliderShapeRef::OrientedBox(bc, b_rotation),
        ) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation);
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation);
            if let (Some(a_box), Some(b_box)) = (a_box, b_box) {
                return oriented_box_oriented_box_contact_manifold_points(a_box, b_box, contact);
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::OrientedBox(ac, a_rotation),
                bt,
                ColliderShapeRef::OrientedBox(bc, b_rotation),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Capsule(bc)) => {
            if let Some(a_box) =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)
            {
                return oriented_box_capsule_contact_manifold_points(
                    a_box,
                    bc.start(bt),
                    bc.end(bt),
                    bc.radius,
                    contact,
                );
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::OrientedBox(ac, a_rotation),
                bt,
                ColliderShapeRef::Capsule(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            if let Some(b_box) =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)
            {
                return oriented_box_capsule_contact_manifold_points(
                    b_box,
                    ac.start(at),
                    ac.end(at),
                    ac.radius,
                    invert_contact(contact),
                );
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Capsule(ac),
                bt,
                ColliderShapeRef::OrientedBox(bc, b_rotation),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Capsule(bc)) => {
            aabb_capsule_contact_manifold_points(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Capsule(bc)) => {
            if let Some(points) =
                capsule_circle_contact_manifold_points(bt, bc, at, ac, invert_contact(contact))
            {
                return points;
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Circle(ac),
                bt,
                ColliderShapeRef::Capsule(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_capsule_contact_manifold_points(bt, bc, at, ac, invert_contact(contact))
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Circle(bc)) => {
            if let Some(points) = capsule_circle_contact_manifold_points(at, ac, bt, bc, contact) {
                return points;
            }
            let (point_x, point_y) = contact_point(
                at,
                ColliderShapeRef::Capsule(ac),
                bt,
                ColliderShapeRef::Circle(bc),
                contact,
            );
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Capsule(bc)) => {
            capsule_capsule_contact_manifold_points(at, ac, bt, bc, contact)
        }
        (ColliderShapeRef::ConvexPolygon(_, _), _) | (_, ColliderShapeRef::ConvexPolygon(_, _)) => {
            if let (Some(a), Some(b)) = (
                convex_contact_geometry_from_shape(at, ac),
                convex_contact_geometry_from_shape(bt, bc),
            ) {
                if let Some(points) = convex_polygon_contact_manifold_points(a, b, contact) {
                    return points;
                }
            }
            let (point_x, point_y) = contact_point(at, ac, bt, bc, contact);
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
        _ => {
            let (point_x, point_y) = contact_point(at, ac, bt, bc, contact);
            single_contact_manifold_point(point_x, point_y, contact.penetration)
        }
    }
}

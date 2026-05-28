use super::*;

pub(super) fn shape_contact(
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
) -> Option<AabbContact> {
    match (ac, bc) {
        (ColliderShapeRef::Edge(ac), other) => shape_contact(
            at,
            ColliderShapeRef::Capsule(edge_as_capsule(ac)),
            bt,
            other,
        ),
        (other, ColliderShapeRef::Edge(bc)) => shape_contact(
            at,
            other,
            bt,
            ColliderShapeRef::Capsule(edge_as_capsule(bc)),
        ),
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Aabb(bc)) => aabb_contact(at, ac, bt, bc),
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Circle(bc)) => {
            aabb_circle_contact(at, ac, bt, bc)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_circle_contact(bt, bc, at, ac).map(|contact| AabbContact {
                normal_x: -contact.normal_x,
                normal_y: -contact.normal_y,
                penetration: contact.penetration,
            })
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Circle(bc)) => {
            circle_contact(at, ac, bt, bc)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let a_box = aabb_as_oriented_box(AabbBounds::from_transform(at, ac))?;
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)?;
            oriented_box_oriented_box_contact(a_box, b_box)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Aabb(bc)) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)?;
            let b_box = aabb_as_oriented_box(AabbBounds::from_transform(bt, bc))?;
            oriented_box_oriented_box_contact(a_box, b_box)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)?;
            oriented_box_circle_contact(b_box, ac.center(at), ac.radius).map(invert_contact)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Circle(bc)) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)?;
            oriented_box_circle_contact(a_box, bc.center(bt), bc.radius)
        }
        (
            ColliderShapeRef::OrientedBox(ac, a_rotation),
            ColliderShapeRef::OrientedBox(bc, b_rotation),
        ) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)?;
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)?;
            oriented_box_oriented_box_contact(a_box, b_box)
        }
        (ColliderShapeRef::OrientedBox(ac, a_rotation), ColliderShapeRef::Capsule(bc)) => {
            let a_box =
                oriented_box_geometry(ac.center(at), ac.half_width, ac.half_height, a_rotation)?;
            oriented_box_capsule_contact(a_box, bc.start(bt), bc.end(bt), bc.radius)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::OrientedBox(bc, b_rotation)) => {
            let b_box =
                oriented_box_geometry(bc.center(bt), bc.half_width, bc.half_height, b_rotation)?;
            oriented_box_capsule_contact(b_box, ac.start(at), ac.end(at), ac.radius)
                .map(invert_contact)
        }
        (ColliderShapeRef::Aabb(ac), ColliderShapeRef::Capsule(bc)) => {
            aabb_capsule_contact(at, ac, bt, bc)
        }
        (ColliderShapeRef::Circle(ac), ColliderShapeRef::Capsule(bc)) => {
            capsule_circle_contact(bt, bc, at, ac).map(invert_contact)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Aabb(bc)) => {
            aabb_capsule_contact(bt, bc, at, ac).map(invert_contact)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Circle(bc)) => {
            capsule_circle_contact(at, ac, bt, bc)
        }
        (ColliderShapeRef::Capsule(ac), ColliderShapeRef::Capsule(bc)) => {
            capsule_capsule_contact(at, ac, bt, bc)
        }
        (ColliderShapeRef::ConvexPolygon(_, _), _) | (_, ColliderShapeRef::ConvexPolygon(_, _)) => {
            convex_shape_contact_from_shapes(at, ac, bt, bc)
        }
    }
}

use super::*;

#[test]
fn overlapping_aabbs_are_detected() {
    let a = Transform2D { x: 10.0, y: 10.0 };
    let b = Transform2D { x: 18.0, y: 10.0 };

    assert!(CollisionSystem::overlaps(
        a,
        collider(5.0, 5.0),
        b,
        collider(5.0, 5.0),
    ));
}

#[test]
fn separated_aabbs_are_not_detected() {
    let a = Transform2D { x: 10.0, y: 10.0 };
    let b = Transform2D { x: 30.1, y: 10.0 };

    assert!(!CollisionSystem::overlaps(
        a,
        collider(10.0, 10.0),
        b,
        collider(10.0, 10.0),
    ));
}

#[test]
fn aabb_bounds_from_transform_respects_collider_offset() {
    let bounds = AabbBounds::from_transform(
        Transform2D { x: 10.0, y: 20.0 },
        collider(3.0, 4.0).with_offset(5.0, -2.0),
    );

    assert_eq!(bounds.min_x, 12.0);
    assert_eq!(bounds.max_x, 18.0);
    assert_eq!(bounds.min_y, 14.0);
    assert_eq!(bounds.max_y, 22.0);
}

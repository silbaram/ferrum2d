use super::*;

#[test]
fn physics_material_density_defaults_and_builder() {
    let material = PhysicsMaterial::new(0.25, 0.75);
    let dense_material = material
        .with_density(3.0)
        .with_contact_baumgarte_bias_scale(0.25)
        .with_max_contact_baumgarte_bias_velocity_scale(0.5)
        .with_contact_position_correction_scale(0.75)
        .with_contact_position_correction_slop_scale(0.5);

    assert_eq!(material.density, PhysicsMaterial::DEFAULT_DENSITY);
    assert_eq!(
        material.contact_baumgarte_bias_scale,
        PhysicsMaterial::DEFAULT_CONTACT_BAUMGARTE_BIAS_SCALE
    );
    assert_eq!(
        material.max_contact_baumgarte_bias_velocity_scale,
        PhysicsMaterial::DEFAULT_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY_SCALE
    );
    assert_eq!(
        material.contact_position_correction_scale,
        PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SCALE
    );
    assert_eq!(
        material.contact_position_correction_slop_scale,
        PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SLOP_SCALE
    );
    assert_eq!(dense_material.density, 3.0);
    assert_eq!(dense_material.contact_baumgarte_bias_scale, 0.25);
    assert_eq!(
        dense_material.max_contact_baumgarte_bias_velocity_scale,
        0.5
    );
    assert_eq!(dense_material.contact_position_correction_scale, 0.75);
    assert_eq!(dense_material.contact_position_correction_slop_scale, 0.5);
    assert_eq!(
        PhysicsMaterial::default().density,
        PhysicsMaterial::DEFAULT_DENSITY
    );
    assert_eq!(
        PhysicsMaterial::default().contact_baumgarte_bias_scale,
        PhysicsMaterial::DEFAULT_CONTACT_BAUMGARTE_BIAS_SCALE
    );
    assert_eq!(
        PhysicsMaterial::default().max_contact_baumgarte_bias_velocity_scale,
        PhysicsMaterial::DEFAULT_MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY_SCALE
    );
    assert_eq!(
        PhysicsMaterial::default().contact_position_correction_scale,
        PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SCALE
    );
    assert_eq!(
        PhysicsMaterial::default().contact_position_correction_slop_scale,
        PhysicsMaterial::DEFAULT_CONTACT_POSITION_CORRECTION_SLOP_SCALE
    );
    assert_eq!(PhysicsMaterial::default(), PhysicsMaterial::DEFAULT);
    assert_eq!(
        RigidBody::static_body().material,
        PhysicsMaterial::default()
    );
    assert_eq!(RigidBody::kinematic().material, PhysicsMaterial::default());
}

#[test]
fn dynamic_box_with_density_calculates_mass_and_inertia() {
    let body = RigidBody::dynamic_box_with_density(0.5, 4.0, 2.0);
    let expected_inertia = 4.0 * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

    assert_eq!(body.body_type, RigidBodyType::Dynamic);
    assert!((body.mass - 4.0).abs() < 0.001);
    assert!((body.inverse_mass - 0.25).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
    assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
}

#[test]
fn dynamic_oriented_box_with_density_calculates_mass_and_inertia_from_half_extents() {
    let body = RigidBody::dynamic_oriented_box_with_density(0.5, 2.0, 1.0);
    let expected_mass = 4.0;
    let expected_inertia = expected_mass * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

    assert_eq!(body.body_type, RigidBodyType::Dynamic);
    assert!((body.mass - expected_mass).abs() < 0.001);
    assert!((body.inverse_mass - (1.0 / expected_mass)).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
    assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
}

#[test]
fn dynamic_circle_with_density_calculates_mass_and_inertia() {
    let body = RigidBody::dynamic_circle_with_density(2.0, 3.0);
    let expected_mass = 2.0 * core::f32::consts::PI * 3.0 * 3.0;
    let expected_inertia = 0.5 * expected_mass * 3.0 * 3.0;

    assert_eq!(body.body_type, RigidBodyType::Dynamic);
    assert!((body.mass - expected_mass).abs() < 0.001);
    assert!((body.inverse_mass - (1.0 / expected_mass)).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
    assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
}

#[test]
fn dynamic_capsule_with_density_calculates_mass_and_inertia() {
    let body = RigidBody::dynamic_capsule_with_density(2.0, -2.0, 0.0, 2.0, 0.0, 1.0);
    let expected_mass = capsule_expected_mass(2.0, 4.0, 1.0);
    let expected_inertia = capsule_expected_inertia(2.0, 4.0, 1.0);

    assert_eq!(body.body_type, RigidBodyType::Dynamic);
    assert!((body.mass - expected_mass).abs() < 0.001);
    assert!((body.inverse_mass - (1.0 / expected_mass)).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
    assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
}

#[test]
fn dynamic_capsule_with_density_treats_zero_length_as_circle() {
    let body = RigidBody::dynamic_capsule_with_density(2.0, 1.0, 1.0, 1.0, 1.0, 3.0);
    let expected_mass = capsule_expected_mass(2.0, 0.0, 3.0);
    let expected_inertia = 0.5 * expected_mass * 3.0 * 3.0;

    assert!((body.mass - expected_mass).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
}

#[test]
fn dynamic_capsule_uses_explicit_mass_with_shape_inertia() {
    let body = RigidBody::dynamic_capsule(10.0, 0.0, -2.0, 0.0, 2.0, 1.0);
    let expected_density = 10.0 / capsule_expected_area(4.0, 1.0);
    let expected_inertia = capsule_expected_inertia(expected_density, 4.0, 1.0);

    assert_eq!(body.body_type, RigidBodyType::Dynamic);
    assert!((body.mass - 10.0).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
}

#[test]
fn dynamic_convex_polygon_with_density_calculates_mass_and_inertia() {
    let vertices = convex_polygon_vertices(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]);
    let body = RigidBody::dynamic_convex_polygon_with_density(0.5, vertices, 4);
    let expected_mass = 4.0;
    let expected_inertia = expected_mass * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

    assert_eq!(body.body_type, RigidBodyType::Dynamic);
    assert!((body.mass - expected_mass).abs() < 0.001);
    assert!((body.inverse_mass - (1.0 / expected_mass)).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
    assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
}

#[test]
fn dynamic_convex_polygon_uses_explicit_mass_with_shape_inertia() {
    let vertices = convex_polygon_vertices(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]);
    let body = RigidBody::dynamic_convex_polygon(10.0, vertices, 4);
    let expected_inertia = 10.0 * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

    assert_eq!(body.body_type, RigidBodyType::Dynamic);
    assert!((body.mass - 10.0).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
    assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
}

#[test]
fn dynamic_oriented_box_uses_explicit_mass_with_shape_inertia() {
    let body = RigidBody::dynamic_oriented_box(10.0, 2.0, 1.0);
    let expected_inertia = 10.0 * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

    assert_eq!(body.body_type, RigidBodyType::Dynamic);
    assert!((body.mass - 10.0).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
    assert!((body.inverse_inertia - (1.0 / expected_inertia)).abs() < 0.001);
}

#[test]
fn dynamic_box_with_material_uses_material_density() {
    let material = PhysicsMaterial::new(0.25, 0.75)
        .with_density(0.5)
        .with_surface_velocity(Velocity { vx: 2.0, vy: 0.0 });
    let body = RigidBody::dynamic_box_with_material(material, 4.0, 2.0);
    let expected_inertia = 4.0 * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

    assert_eq!(body.material, material);
    assert!((body.mass - 4.0).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
}

#[test]
fn dynamic_oriented_box_with_material_uses_material_density() {
    let material = PhysicsMaterial::new(0.25, 0.75).with_density(0.5);
    let body = RigidBody::dynamic_oriented_box_with_material(material, 2.0, 1.0);
    let expected_mass = 4.0;
    let expected_inertia = expected_mass * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

    assert_eq!(body.material, material);
    assert!((body.mass - expected_mass).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
}

#[test]
fn dynamic_circle_with_material_uses_material_density() {
    let material = PhysicsMaterial::new(0.25, 0.75).with_density(2.0);
    let body = RigidBody::dynamic_circle_with_material(material, 3.0);
    let expected_mass = 2.0 * core::f32::consts::PI * 3.0 * 3.0;
    let expected_inertia = 0.5 * expected_mass * 3.0 * 3.0;

    assert_eq!(body.material, material);
    assert!((body.mass - expected_mass).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
}

#[test]
fn dynamic_capsule_with_material_uses_material_density() {
    let material = PhysicsMaterial::new(0.25, 0.75).with_density(2.0);
    let body = RigidBody::dynamic_capsule_with_material(material, -2.0, 0.0, 2.0, 0.0, 1.0);
    let expected_mass = capsule_expected_mass(2.0, 4.0, 1.0);
    let expected_inertia = capsule_expected_inertia(2.0, 4.0, 1.0);

    assert_eq!(body.material, material);
    assert!((body.mass - expected_mass).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
}

#[test]
fn dynamic_convex_polygon_with_material_uses_material_density() {
    let material = PhysicsMaterial::new(0.25, 0.75).with_density(0.5);
    let vertices = convex_polygon_vertices(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]);
    let body = RigidBody::dynamic_convex_polygon_with_material(material, vertices, 4);
    let expected_mass = 4.0;
    let expected_inertia = expected_mass * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

    assert_eq!(body.material, material);
    assert!((body.mass - expected_mass).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
}

#[test]
fn dynamic_density_helpers_sanitize_invalid_input() {
    let box_body = RigidBody::dynamic_box_with_density(f32::NAN, -4.0, f32::INFINITY);
    let oriented_box_body =
        RigidBody::dynamic_oriented_box_with_density(f32::NAN, -4.0, f32::INFINITY);
    let circle_body = RigidBody::dynamic_circle_with_density(-2.0, f32::NAN);
    let capsule_body =
        RigidBody::dynamic_capsule_with_density(f32::NAN, f32::NAN, 0.0, 1.0, f32::INFINITY, -2.0);
    let invalid_polygon_vertices =
        convex_polygon_vertices(&[(f32::NAN, 0.0), (1.0, 0.0), (0.0, 1.0)]);
    let polygon_body =
        RigidBody::dynamic_convex_polygon_with_density(f32::NAN, invalid_polygon_vertices, 3);
    let expected_capsule_mass = capsule_expected_mass(1.0, 1.0, 1.0);
    let expected_capsule_inertia = capsule_expected_inertia(1.0, 1.0, 1.0);

    assert!((box_body.mass - 1.0).abs() < 0.001);
    assert!((box_body.inertia - (1.0 / 6.0)).abs() < 0.001);
    assert!((oriented_box_body.mass - 4.0).abs() < 0.001);
    assert!((oriented_box_body.inertia - (8.0 / 3.0)).abs() < 0.001);
    assert!((circle_body.mass - core::f32::consts::PI).abs() < 0.001);
    assert!((circle_body.inertia - (0.5 * core::f32::consts::PI)).abs() < 0.001);
    assert!((capsule_body.mass - expected_capsule_mass).abs() < 0.001);
    assert!((capsule_body.inertia - expected_capsule_inertia).abs() < 0.001);
    assert!((polygon_body.mass - 1.0).abs() < 0.001);
    assert!((polygon_body.inertia - (1.0 / 6.0)).abs() < 0.001);
}

#[test]
fn material_density_helpers_sanitize_invalid_density_for_mass() {
    let material = PhysicsMaterial::new(0.25, 0.75).with_density(f32::NAN);
    let body = RigidBody::dynamic_box_with_material(material, 4.0, 2.0);
    let expected_inertia = 8.0 * (4.0 * 4.0 + 2.0 * 2.0) / 12.0;

    assert_eq!(body.material.restitution, material.restitution);
    assert_eq!(body.material.friction, material.friction);
    assert!(body.material.density.is_nan());
    assert!((body.mass - 8.0).abs() < 0.001);
    assert!((body.inertia - expected_inertia).abs() < 0.001);
}

fn capsule_expected_area(length: f32, radius: f32) -> f32 {
    2.0 * radius * length + core::f32::consts::PI * radius * radius
}

fn capsule_expected_mass(density: f32, length: f32, radius: f32) -> f32 {
    density * capsule_expected_area(length, radius)
}

fn capsule_expected_inertia(density: f32, length: f32, radius: f32) -> f32 {
    let rect_mass = density * 2.0 * radius * length;
    let rect_inertia = rect_mass * (length * length + 4.0 * radius * radius) / 12.0;
    let half_cap_mass = density * 0.5 * core::f32::consts::PI * radius * radius;
    let half_length = length * 0.5;
    let cap_centroid_offset = 4.0 * radius / (3.0 * core::f32::consts::PI);
    let half_cap_inertia_about_center = 0.5 * half_cap_mass * radius * radius;
    let cap_pair_inertia = 2.0
        * (half_cap_inertia_about_center
            + half_cap_mass
                * (half_length * half_length + 2.0 * half_length * cap_centroid_offset));

    rect_inertia + cap_pair_inertia
}

fn convex_polygon_vertices(points: &[(f32, f32)]) -> [Transform2D; MAX_CONVEX_POLYGON_VERTICES] {
    let mut vertices = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
    for (index, (x, y)) in points.iter().copied().enumerate() {
        vertices[index] = Transform2D { x, y };
    }
    vertices
}

use super::*;
use crate::collision::CollisionSystem;

#[test]
fn rigid_body_contact_block_solver_handles_two_point_aabb_face_contact() {
    let mut world = World::default();
    let body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 1.4, CollisionLayer::Wall, false, 4.0, 0.5);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        },
    );

    let velocity = world.velocity(body).unwrap();
    let angular_velocity = world.angular_velocity(body).unwrap_or_default();
    assert_eq!(stats.contact_block_solves, 1);
    assert_eq!(stats.contact_cache_entries, 2);
    assert!(stats.velocity_impulses >= 2);
    assert!(
        velocity.vy < 0.0,
        "two-point block solve should create separating normal velocity, got {velocity:?}"
    );
    assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "symmetric two-point contact should not leave residual angular velocity, got {angular_velocity:?}"
        );
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_aabb_circle_face_contact() {
    let mut world = World::default();
    let circle = spawn_dynamic_circle(&mut world, 0.0, 0.0, 1.0);
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 1.4, CollisionLayer::Wall, false, 4.0, 0.5);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    assert_circle_two_point_contact_block_solve(&mut world, circle);
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_capsule_circle_side_contact() {
    let mut world = World::default();
    let circle = spawn_dynamic_circle(&mut world, 0.0, 0.0, 1.0);
    let capsule = world.spawn_entity();
    world.set_transform(capsule, Transform2D { x: 0.0, y: 1.5 });
    world.set_capsule_collider(
        capsule,
        CapsuleCollider::new(-4.0, 0.0, 4.0, 0.0, 1.0, false, CollisionLayer::Wall),
    );
    world.set_collision_filter(
        capsule,
        CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(
        capsule,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    assert_circle_two_point_contact_block_solve(&mut world, circle);
}

#[test]
fn rigid_body_contact_solver_handles_single_point_circle_circle_contact() {
    let mut world = World::default();
    let dynamic = spawn_dynamic_circle(&mut world, 0.0, 0.0, 1.0);
    let static_circle = world.spawn_entity();
    world.set_transform(static_circle, Transform2D { x: 1.5, y: 0.0 });
    world.set_circle_collider(
        static_circle,
        CircleCollider {
            radius: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Wall,
        },
    );
    world.set_collision_filter(
        static_circle,
        CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(
        static_circle,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let manifolds = CollisionSystem::build_manifolds(&world);
    assert_eq!(manifolds.len(), 1);
    assert_eq!(manifolds[0].point_count, 1);

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        contact_block_solver_test_config(),
    );

    let velocity = world.velocity(dynamic).unwrap();
    assert_eq!(stats.contact_block_solves, 0);
    assert_eq!(stats.contact_cache_entries, 1);
    assert!(stats.velocity_impulses >= 1);
    assert!(
        velocity.vx < 0.0,
        "single-point circle contact should create separating normal velocity, got {velocity:?}"
    );
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_capsule_side_contact() {
    let mut world = World::default();
    let capsule = spawn_dynamic_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(-2.0, 0.0, 2.0, 0.0, 1.0, false, CollisionLayer::Player),
    );
    world.set_rigid_body(
        capsule,
        RigidBody::dynamic_capsule(1.0, -2.0, 0.0, 2.0, 0.0, 1.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 1.4, CollisionLayer::Wall, false, 4.0, 0.5);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        },
    );

    let velocity = world.velocity(capsule).unwrap();
    let angular_velocity = world.angular_velocity(capsule).unwrap_or_default();
    assert_eq!(stats.contact_block_solves, 1);
    assert_eq!(stats.contact_cache_entries, 2);
    assert!(stats.velocity_impulses >= 2);
    assert!(
        velocity.vy < 0.0,
        "capsule side block solve should create separating normal velocity, got {velocity:?}"
    );
    assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "symmetric capsule side contact should not leave residual angular velocity, got {angular_velocity:?}"
        );
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_capsule_endpoint_contact() {
    let mut world = World::default();
    let dynamic = spawn_dynamic_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(-3.0, 0.0, 3.0, 0.0, 1.0, false, CollisionLayer::Player),
    );
    world.set_rigid_body(
        dynamic,
        RigidBody::dynamic_capsule(1.0, -3.0, 0.0, 3.0, 0.0, 1.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let static_capsule = world.spawn_entity();
    world.set_transform(static_capsule, Transform2D { x: 0.0, y: 0.0 });
    world.set_capsule_collider(
        static_capsule,
        CapsuleCollider::new(-2.0, 1.5, 2.0, 1.55, 1.0, false, CollisionLayer::Wall),
    );
    world.set_collision_filter(
        static_capsule,
        CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(
        static_capsule,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        },
    );

    let velocity = world.velocity(dynamic).unwrap();
    assert_eq!(stats.contact_block_solves, 1);
    assert_eq!(stats.contact_cache_entries, 2);
    assert!(stats.velocity_impulses >= 1);
    assert!(
        velocity.vy < 0.0,
        "capsule endpoint block solve should create separating normal velocity, got {velocity:?}"
    );
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_oriented_box_face_contact() {
    let mut world = World::default();
    let body = spawn_dynamic_oriented_box(
        &mut world,
        0.0,
        0.0,
        OrientedBoxCollider::new(1.0, 1.0, 0.0, false, CollisionLayer::Player),
    );
    world.set_rigid_body(
        body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let ground = world.spawn_entity();
    world.set_transform(ground, Transform2D { x: 0.0, y: 1.4 });
    world.set_oriented_box_collider(
        ground,
        OrientedBoxCollider::new(4.0, 0.5, 0.0, false, CollisionLayer::Wall),
    );
    world.set_collision_filter(
        ground,
        CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        },
    );

    let velocity = world.velocity(body).unwrap();
    let angular_velocity = world.angular_velocity(body).unwrap_or_default();
    assert_eq!(stats.contact_block_solves, 1);
    assert_eq!(stats.contact_cache_entries, 2);
    assert!(stats.velocity_impulses >= 2);
    assert!(
        velocity.vy < 0.0,
        "oriented box block solve should create separating normal velocity, got {velocity:?}"
    );
    assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "symmetric oriented box contact should not leave residual angular velocity, got {angular_velocity:?}"
        );
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_convex_polygon_face_contact() {
    let mut world = World::default();
    let collider = convex_polygon_collider(&[(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]);
    let body = spawn_static_convex_polygon(&mut world, 0.0, 0.0, collider);
    world.set_collision_filter(
        body,
        CollisionFilter::new(CollisionLayer::Player.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(
        body,
        RigidBody::dynamic_convex_polygon(1.0, collider.vertices, collider.vertex_count)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 1.4, CollisionLayer::Wall, false, 4.0, 0.5);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        },
    );

    let velocity = world.velocity(body).unwrap();
    let angular_velocity = world.angular_velocity(body).unwrap_or_default();
    assert_eq!(stats.contact_block_solves, 1);
    assert_eq!(stats.contact_cache_entries, 2);
    assert!(stats.velocity_impulses >= 2);
    assert!(
        velocity.vy < 0.0,
        "convex polygon block solve should create separating normal velocity, got {velocity:?}"
    );
    assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "symmetric convex polygon contact should not leave residual angular velocity, got {angular_velocity:?}"
        );
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_convex_polygon_circle_face_contact() {
    let mut world = World::default();
    let circle = spawn_dynamic_circle(&mut world, 0.0, 0.0, 1.0);
    let ground = spawn_static_convex_polygon(
        &mut world,
        0.0,
        1.4,
        convex_polygon_collider(&[(-4.0, -0.5), (4.0, -0.5), (4.0, 0.5), (-4.0, 0.5)]),
    );
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    assert_circle_two_point_contact_block_solve(&mut world, circle);
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_convex_polygon_capsule_side_contact() {
    let mut world = World::default();
    let capsule = spawn_dynamic_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(-2.0, 0.0, 2.0, 0.0, 1.0, false, CollisionLayer::Player),
    );
    world.set_rigid_body(
        capsule,
        RigidBody::dynamic_capsule(1.0, -2.0, 0.0, 2.0, 0.0, 1.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let ground = spawn_static_convex_polygon(
        &mut world,
        0.0,
        1.4,
        convex_polygon_collider(&[(-2.0, -0.5), (2.0, -0.5), (2.0, 0.5), (-2.0, 0.5)]),
    );
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
        },
    );

    let velocity = world.velocity(capsule).unwrap();
    let angular_velocity = world.angular_velocity(capsule).unwrap_or_default();
    assert_eq!(stats.contact_block_solves, 1);
    assert_eq!(stats.contact_cache_entries, 2);
    assert!(stats.velocity_impulses >= 2);
    assert!(
            velocity.vy < 0.0,
            "convex polygon capsule block solve should create separating normal velocity, got {velocity:?}"
        );
    assert!(
            angular_velocity.radians_per_second.abs() < 0.001,
            "symmetric convex polygon capsule contact should not leave residual angular velocity, got {angular_velocity:?}"
        );
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_aabb_capsule_arc_clipped_contact() {
    let mut world = World::default();
    let capsule = spawn_dynamic_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(-8.0, 4.5, 8.0, 5.5, 1.0, false, CollisionLayer::Player),
    );
    world.set_rigid_body(
        capsule,
        RigidBody::dynamic_capsule(1.0, -8.0, 4.5, 8.0, 5.5, 1.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 0.0, CollisionLayer::Wall, false, 5.0, 5.0);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    assert_capsule_two_point_contact_block_solve(&mut world, capsule);
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_oriented_box_capsule_arc_clipped_contact() {
    let mut world = World::default();
    let rotation = 0.35;
    let start = rotated_test_point(-8.0, 4.5, rotation);
    let end = rotated_test_point(8.0, 5.5, rotation);
    let capsule = spawn_dynamic_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(
            start.x,
            start.y,
            end.x,
            end.y,
            1.0,
            false,
            CollisionLayer::Player,
        ),
    );
    world.set_rigid_body(
        capsule,
        RigidBody::dynamic_capsule(1.0, start.x, start.y, end.x, end.y, 1.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let ground = world.spawn_entity();
    world.set_transform(ground, Transform2D { x: 0.0, y: 0.0 });
    world.set_oriented_box_collider(
        ground,
        OrientedBoxCollider::new(5.0, 5.0, rotation, false, CollisionLayer::Wall),
    );
    world.set_collision_filter(
        ground,
        CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    assert_capsule_two_point_contact_block_solve(&mut world, capsule);
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_convex_polygon_capsule_arc_clipped_contact() {
    let mut world = World::default();
    let capsule = spawn_dynamic_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(-4.0, 0.6, 4.0, 1.4, 1.0, false, CollisionLayer::Player),
    );
    world.set_rigid_body(
        capsule,
        RigidBody::dynamic_capsule(1.0, -4.0, 0.6, 4.0, 1.4, 1.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let ground = spawn_static_convex_polygon(
        &mut world,
        0.0,
        0.0,
        convex_polygon_collider(&[(-2.0, -1.0), (2.0, -1.0), (2.0, 1.0), (-2.0, 1.0)]),
    );
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    assert_capsule_two_point_contact_block_solve(&mut world, capsule);
}

#[test]
fn rigid_body_contact_block_solver_handles_two_point_capsule_curve_contact() {
    let mut world = World::default();
    let capsule = spawn_dynamic_capsule(
        &mut world,
        0.0,
        0.0,
        CapsuleCollider::new(-3.0, 0.0, 3.0, 0.0, 1.0, false, CollisionLayer::Player),
    );
    world.set_rigid_body(
        capsule,
        RigidBody::dynamic_capsule(1.0, -3.0, 0.0, 3.0, 0.0, 1.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let static_capsule = world.spawn_entity();
    world.set_transform(static_capsule, Transform2D { x: 0.0, y: 0.0 });
    world.set_capsule_collider(
        static_capsule,
        CapsuleCollider::new(0.0, -3.0, 0.0, 3.0, 1.0, false, CollisionLayer::Wall),
    );
    world.set_collision_filter(
        static_capsule,
        CollisionFilter::new(CollisionLayer::Wall.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(
        static_capsule,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );

    assert_capsule_two_point_contact_block_solve(&mut world, capsule);
}

fn assert_capsule_two_point_contact_block_solve(world: &mut World, capsule: Entity) {
    assert_body_two_point_contact_block_solve(world, capsule, "capsule");
}

fn assert_circle_two_point_contact_block_solve(world: &mut World, circle: Entity) {
    assert_body_two_point_contact_block_solve(world, circle, "circle");
}

fn assert_body_two_point_contact_block_solve(world: &mut World, body: Entity, body_label: &str) {
    let manifolds = CollisionSystem::build_manifolds(world);
    assert_eq!(manifolds.len(), 1);
    let manifold = manifolds[0];
    assert_eq!(manifold.point_count, 2);
    assert!(
        manifold.pair.a == body || manifold.pair.b == body,
        "expected {body_label} to participate in two-point contact, got {manifold:?}"
    );

    let moving_normal_sign = if manifold.pair.a == body { -1.0 } else { 1.0 };
    let normal = Velocity {
        vx: manifold.normal_x,
        vy: manifold.normal_y,
    };
    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        world,
        0.1,
        contact_block_solver_test_config(),
    );

    let velocity = world.velocity(body).unwrap();
    let normal_velocity = moving_normal_sign * (velocity.vx * normal.vx + velocity.vy * normal.vy);
    assert_eq!(stats.contact_block_solves, 1);
    assert_eq!(stats.contact_cache_entries, 2);
    assert!(stats.velocity_impulses >= 2);
    assert!(
            normal_velocity > 0.0,
            "{body_label} two-point block solve should create separating normal velocity, got velocity={velocity:?}, normal={normal:?}, stats={stats:?}"
        );
}

fn contact_block_solver_test_config() -> RigidBodyStepConfig {
    RigidBodyStepConfig {
        gravity: Velocity::default(),
        velocity_iterations: 1,
        position_iterations: 1,
        position_correction_percent: 0.0,
        position_correction_slop: 0.0,
        restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
        contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
        max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
        contact_split_impulse: false,
    }
}

fn rotated_test_point(x: f32, y: f32, radians: f32) -> Transform2D {
    let (sin, cos) = radians.sin_cos();
    Transform2D {
        x: x * cos - y * sin,
        y: x * sin + y * cos,
    }
}

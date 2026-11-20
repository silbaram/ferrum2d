use super::*;
use crate::components::Rotation2D;
use crate::physics3d::{BodyKind, Shape};

fn engine(space: Space) -> Engine {
    configure_engine(Engine::new(), space)
}

fn configure_engine(mut engine: Engine, space: Space) -> Engine {
    engine.activate_data_scene();
    engine
        .configure_unified_physics(WorldConfig {
            space,
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
    assert!(engine.configure_spatial_camera(&[
        0., 0., 160., 200., 0., 0., 0., 128., 0.1, 1000., 400., 300.,
    ]));
    engine
}

fn model(engine: &mut Engine, entity: Entity, elevation: f32, yaw: f32, scale: f32) {
    assert!(engine.spatial_scene.models.configure(
        &engine.world,
        &[entity.id, entity.generation, 7, 3, 1, 12],
        &[elevation, yaw, scale, -1., -2., -3., 1., 2., 3.],
    ));
}

fn matrix(engine: &Engine, entity: Entity) -> [f32; 16] {
    let words = engine.spatial_model_draw_snapshot(entity.id, entity.generation);
    assert_eq!(words.len(), 20);
    assert_eq!(words[0..2], [7, 3]);
    assert_eq!(words[3], 0);
    std::array::from_fn(|i| f32::from_bits(words[4 + i]))
}

fn near(actual: f32, expected: f32) {
    assert!((actual - expected).abs() < 1e-5, "{actual} != {expected}");
}

fn collider() -> ColliderDesc {
    ColliderDesc::new(Shape::Sphere { radius: 0.5 })
}

#[test]
fn explicit_spatial_models_compose_native_tilt_local_yaw_scale_and_world_offsets() {
    let half = std::f32::consts::FRAC_1_SQRT_2;
    for kind in [
        BodyKind::Fixed,
        BodyKind::Dynamic,
        BodyKind::KinematicPosition,
        BodyKind::KinematicVelocity,
    ] {
        let mut e = engine(Space::Spatial);
        let entity = e
            .create_unified_body(
                BodyDesc {
                    kind,
                    pose: Pose {
                        position: [10., 20., 30.],
                        rotation: [half, 0., 0., half],
                    },
                    ..BodyDesc::default()
                },
                collider(),
                [1., 2., 3.],
            )
            .unwrap();
        // Native orientation already includes placement rotation; never add this again.
        e.world.set_rotation(entity, Rotation2D { radians: 0.7 });
        model(&mut e, entity, 3., std::f32::consts::FRAC_PI_2, 2.);
        e.update(0.);
        let actual = matrix(&e, entity);
        let expected = [
            0., 2., 0., 0., 0., 0., 2., 0., 2., 0., 0., 0., 11., 25., 33., 1.,
        ];
        for (actual, expected) in actual.into_iter().zip(expected) {
            near(actual, expected);
        }
        assert_eq!(e.spatial_model_stride(), 20);
    }
}

#[test]
fn native_models_use_consistent_current_pose_while_projected_world_keeps_interpolation() {
    let mut e = engine(Space::Spatial);
    e.configure_physics_render_interpolation(true);
    let entity = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                linear_velocity: [6., 4., 2.],
                angular_velocity: [1., 0., 0.],
                ..BodyDesc::default()
            },
            collider(),
            [1., 2., 3.],
        )
        .unwrap();
    model(&mut e, entity, 5., 0., 1.);
    let dt = e.fixed_timestep.config().step_seconds;
    e.update(f64::from(dt) * 1.5);
    let native = e.unified_body_state(entity).unwrap();
    let rendered = matrix(&e, entity);
    for (index, offset) in [1., 7., 3.].into_iter().enumerate() {
        near(rendered[12 + index], native.pose.position[index] + offset);
    }
    let angle = dt;
    near(rendered[5], angle.cos());
    near(rendered[6], angle.sin());
    let projected = e
        .world
        .render_transform_at_index(entity.id as usize)
        .unwrap();
    near(projected.x, 1. + 3. * dt);
    assert!((rendered[12] - projected.x).abs() > dt);
}

#[test]
fn unbinding_deletion_reuse_and_scene_clear_cannot_retain_native_orientation() {
    let mut e = configure_engine(crate::engine::legacy_test_fixture::engine(), Space::Spatial);
    let half = std::f32::consts::FRAC_1_SQRT_2;
    let old = e
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    rotation: [half, 0., 0., half],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            collider(),
            [0.; 3],
        )
        .unwrap();
    model(&mut e, old, 0., 0., 1.);
    e.update(0.);
    near(matrix(&e, old)[6], 1.);
    e.unbind_unified_body(old).unwrap();
    e.update(0.);
    near(matrix(&e, old)[5], 1.);
    near(matrix(&e, old)[6], 0.);
    e.bind_unified_body(
        old,
        BodyDesc {
            pose: Pose {
                rotation: [half, 0., 0., half],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        collider(),
        [0.; 3],
    )
    .unwrap();
    e.world.despawn(old);
    let fresh = e.world.spawn_entity();
    assert_eq!(old.id, fresh.id);
    assert_ne!(old.generation, fresh.generation);
    e.world.set_transform(fresh, Transform2D { x: 4., y: 5. });
    e.update(0.);
    assert!(e
        .spatial_model_draw_snapshot(old.id, old.generation)
        .is_empty());
    model(&mut e, fresh, 0., 0., 1.);
    e.update(0.);
    near(matrix(&e, fresh)[5], 1.);
    near(matrix(&e, fresh)[6], 0.);
    e.clear_spatial_scene();
    assert!(e
        .spatial_model_draw_snapshot(fresh.id, fresh.generation)
        .is_empty());
    e.activate_built_in_shooter_scene();
    assert!(e.unified_physics.is_none());
    assert!(e
        .spatial_model_draw_snapshot(fresh.id, fresh.generation)
        .is_empty());
}

#[test]
fn planar_models_keep_projected_entity_yaw_and_model_yaw() {
    let mut e = engine(Space::PlanarXy);
    let half = std::f32::consts::FRAC_1_SQRT_2;
    let entity = e
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    rotation: [0., 0., half, half],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            collider(),
            [0.; 3],
        )
        .unwrap();
    model(&mut e, entity, 0., std::f32::consts::FRAC_PI_2, 1.);
    e.update(0.);
    let actual = matrix(&e, entity);
    near(actual[0], -1.);
    near(actual[5], 1.);
    near(actual[10], -1.);
    near(actual[6], 0.);
}

#[test]
fn native_spatial_quaternion_does_not_rotate_cylindrical_billboards() {
    let mut e = engine(Space::Spatial);
    let entity = e
        .create_unified_body(BodyDesc::default(), collider(), [0.; 3])
        .unwrap();
    e.world.sprites[entity.id as usize] = Some(crate::components::Sprite {
        texture_id: 11,
        width: 8.,
        height: 12.,
        u0: 0.,
        v0: 0.,
        u1: 1.,
        v1: 1.,
        r: 1.,
        g: 1.,
        b: 1.,
        a: 1.,
        rotation_radians: 0.3,
        render_layer: 1000,
        origin_x: 0.5,
        origin_y: 0.5,
        sort_order: 0.,
        depth_sort: false,
        project_ground: false,
    });
    e.world.set_rotation(entity, Rotation2D { radians: 0.2 });
    assert!(e.configure_spatial_billboards(&[entity.id, entity.generation], &[1., 0.5, 0.]));
    e.update(0.);
    let before = e.spatial_scene.billboards.clone();
    assert_eq!(before.len(), 6);
    let half = std::f32::consts::FRAC_1_SQRT_2;
    e.set_unified_body_pose(
        entity,
        Pose {
            rotation: [half, 0., 0., half],
            ..Pose::default()
        },
    )
    .unwrap();
    e.update(0.);
    assert_eq!(before, e.spatial_scene.billboards);
}

#[test]
fn checkpoint_restores_native_model_matrix_and_exact_future_continuation() {
    let mut e = engine(Space::Spatial);
    let entity = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                linear_velocity: [1., 2., 3.],
                angular_velocity: [0.7, -0.4, 0.3],
                ..BodyDesc::default()
            },
            collider(),
            [0.5, 1., 2.],
        )
        .unwrap();
    model(&mut e, entity, 3., 0.2, 2.);
    let dt = f64::from(e.fixed_timestep.config().step_seconds);
    e.update(dt * 1.5);
    let checkpoint = e.capture_runtime_checkpoint().unwrap();
    let before = matrix(&e, entity);
    e.update(dt * 3.);
    let future = matrix(&e, entity);
    assert_ne!(before, future);
    assert!(e.restore_runtime_checkpoint(&checkpoint));
    assert_eq!(before, matrix(&e, entity));
    e.update(dt * 3.);
    assert_eq!(future, matrix(&e, entity));
}

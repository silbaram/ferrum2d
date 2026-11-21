use super::*;
use crate::components::{AabbCollider, CollisionLayer, CollisionMask, RigidBody};
use crate::physics3d::{BodyKind, Shape};

fn engine(space: Space, limit: usize) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        max_events: limit,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn tick(e: &mut Engine) {
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
}
fn box_body(
    e: &mut Engine,
    position: [f32; 3],
    kind: BodyKind,
    category: u32,
    offset: [f32; 3],
) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind,
            pose: Pose {
                position,
                ..Pose::default()
            },
            can_sleep: false,
            ..BodyDesc::default()
        },
        ColliderDesc {
            category,
            ..ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            })
        },
        offset,
    )
    .unwrap()
}
fn feedback(e: &mut Engine, mask: u32) {
    assert!(e.configure_physics_impact_feedback(&[
        mask as f64,
        0.001,
        0.2,
        7.0,
        u32::MAX as f64,
        0.8
    ]));
}
fn impact_pair(e: &mut Engine) -> (Entity, Entity) {
    let a = box_body(e, [0.0; 3], BodyKind::Fixed, 2, [0.0; 3]);
    let b = box_body(e, [0.0, 1.0, 0.0], BodyKind::Dynamic, 4, [0.0; 3]);
    e.set_unified_body_velocity(b, [0.0, -6.0, 0.0], [0.0; 3])
        .unwrap();
    (a, b)
}

#[test]
fn contact_impulses_native_engine_feed_existing_buffers_with_entities_and_fixture_categories() {
    let mut e = engine(Space::PlanarXy, 4096);
    let (a, b) = impact_pair(&mut e);
    feedback(&mut e, 4);
    e.configure_physics_contact_impacts(true, 1.0);
    tick(&mut e);
    let contacts = e.unified_contact_impulses().unwrap();
    assert!(!contacts.is_empty());
    assert!(contacts
        .iter()
        .all(|c| (c.a == a && c.b == b) || (c.a == b && c.b == a)));
    assert!(contacts.iter().all(|c| c.contact.categories == 6));
    assert_eq!(e.physics_impact_feedback_stats()[0], 1);
    assert_eq!(e.frame_buffers.audio_events.len(), 1);
    assert_eq!(e.frame_buffers.audio_events[0].sound_id, 7.0);
    assert!(e.query_rigid_contact_impulses() > 0);
    assert!(e.query_physics_contact_impacts() > 0);
    assert!(e.world.collision_filter(a).is_none() && e.world.collision_filter(b).is_none());
    assert_eq!(e.physics_contact_impacts_dropped(), 0);
}

#[test]
fn contact_impulses_feedback_independent_of_impact_reporting_and_primary_fixture() {
    for enabled in [false, true] {
        let mut e = engine(Space::PlanarXy, 4096);
        let (_, b) = impact_pair(&mut e);
        feedback(&mut e, 8);
        e.configure_physics_contact_impacts(enabled, 1000.0);
        // Non-contacting secondary fixture must not select the profile.
        let id = e.unified_body_id(b).unwrap();
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .add_collider(
                id,
                ColliderDesc {
                    category: 8,
                    pose: Pose {
                        position: [10.0, 10.0, 0.0],
                        ..Pose::default()
                    },
                    ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
                },
            )
            .unwrap();
        tick(&mut e);
        assert_eq!(e.physics_impact_feedback_stats()[0], 0);
        feedback(&mut e, 4);
        e.set_unified_body_pose(
            b,
            Pose {
                position: [0.0, 1.0, 0.0],
                ..Pose::default()
            },
        )
        .unwrap();
        e.set_unified_body_velocity(b, [0.0, -6.0, 0.0], [0.0; 3])
            .unwrap();
        tick(&mut e);
        assert_eq!(e.physics_impact_feedback_stats()[0], 1);
        assert_eq!(e.query_physics_contact_impacts(), 0);
    }
}

#[test]
fn contact_impulses_spatial_reports_keep_xyz_and_project_without_visual_offsets() {
    let mut e = engine(Space::Spatial, 4096);
    box_body(
        &mut e,
        [2.0, 5.0, 3.0],
        BodyKind::Fixed,
        2,
        [100.0, 200.0, 300.0],
    );
    let b = box_body(
        &mut e,
        [2.0, 6.0, 3.0],
        BodyKind::Dynamic,
        4,
        [100.0, 200.0, 300.0],
    );
    e.set_unified_body_velocity(b, [0.0, -6.0, 0.0], [0.0; 3])
        .unwrap();
    feedback(&mut e, 4);
    e.configure_physics_contact_impacts(true, 1.0);
    tick(&mut e);
    assert_eq!(e.physics_impact_feedback_stats()[0], 1);
    let full = e.unified_contact_impulses().unwrap();
    let projected: Vec<_> = e.world.rigid_contact_impulses().collect();
    assert!(!full.is_empty());
    assert_eq!(full.len(), projected.len());
    for (a, b) in full.iter().zip(projected) {
        assert!((a.contact.point[1] - 5.5).abs() < 0.1, "{a:?}");
        assert_eq!(b.point_x, a.contact.point[0]);
        assert_eq!(b.point_y, -a.contact.point[2]);
        assert_eq!(b.normal_x, a.contact.normal[0]);
        assert_eq!(b.normal_y, -a.contact.normal[2]);
    }
}

#[test]
fn contact_impulses_planar_authored_bodies_enter_native_effect_and_report_path() {
    let mut e = engine(Space::PlanarXy, 4096);
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D::default());
    e.world
        .set_aabb_collider(a, AabbCollider::new(1.0, 0.5, false, CollisionLayer::Wall));
    let b = e.world.spawn_entity();
    e.world.set_transform(b, Transform2D { x: 0.0, y: 1.0 });
    e.world.set_aabb_collider(
        b,
        AabbCollider::new(0.5, 0.5, false, CollisionLayer::Player),
    );
    e.world
        .set_rigid_body(b, RigidBody::dynamic_box(2.0, 1.0, 1.0));
    e.world.set_velocity(b, Velocity { vx: 0.0, vy: -6.0 });
    feedback(&mut e, CollisionMask::PLAYER.bits);
    e.configure_physics_contact_impacts(true, 1.0);
    tick(&mut e);
    assert_eq!(e.physics_impact_feedback_stats()[0], 1);
    assert!(e.query_physics_contact_impacts() > 0);
    assert!(e
        .unified_contact_impulses()
        .unwrap()
        .iter()
        .all(|c| c.contact.approach_speed > 5.9));
}

#[test]
fn contact_impulses_fixed_frame_retains_first_tick_impacts_and_no_duplicate_effects() {
    let mut e = engine(Space::PlanarXy, 4096);
    impact_pair(&mut e);
    feedback(&mut e, 4);
    e.configure_physics_contact_impacts(true, 1.0);
    e.update(3.0 * f64::from(e.fixed_timestep.config().step_seconds));
    assert_eq!(e.last_fixed_update.steps, 3);
    assert!(e.query_physics_contact_impacts() > 0);
    assert_eq!(e.physics_impact_feedback_stats()[0], 1);
    assert_eq!(e.frame_buffers.audio_events.len(), 1);
    e.update(0.0);
    assert_eq!(e.query_physics_contact_impacts(), 0);
    assert_eq!(e.physics_impact_feedback_stats()[0], 0);
}

#[test]
fn contact_impulses_manual_step_and_queries_preserve_generation_and_invalid_step_does_not_reemit() {
    let mut e = engine(Space::PlanarXy, 4096);
    let (_, b) = impact_pair(&mut e);
    feedback(&mut e, 4);
    e.configure_physics_contact_impacts(true, 1.0);
    let dt = e.fixed_timestep.config().step_seconds;
    e.step_rigid_bodies(dt);
    assert!(e.query_physics_contact_impacts() > 0);
    assert_eq!(e.physics_impact_feedback_stats()[0], 1);
    let old = e.unified_contact_impulses().unwrap().to_vec();
    let count = e.query_physics_contact_impacts();
    e.query_body_contacts(2, 4);
    assert_eq!(e.unified_contact_impulses().unwrap(), old);
    for dt in [0.0, -1.0, dt * 2.0] {
        e.step_rigid_bodies(dt);
        assert_eq!(e.unified_contact_impulses().unwrap(), old);
        assert_eq!(e.query_physics_contact_impacts(), count);
        assert_eq!(e.physics_impact_feedback_stats()[0], 1);
    }
    e.world.despawn(b);
    let replacement = e.world.spawn_entity();
    assert_eq!(replacement.id, b.id);
    assert_ne!(replacement.generation, b.generation);
    assert!(old.iter().any(|c| c.a == b || c.b == b));
    tick(&mut e);
    assert!(e.unified_contact_impulses().unwrap().is_empty());
}

#[test]
fn contact_impulses_overflow_reaches_diagnostics_and_enabled_consumers() {
    let mut e = engine(Space::PlanarXy, 1);
    impact_pair(&mut e);
    feedback(&mut e, 4);
    e.configure_physics_contact_impacts(true, 1.0);
    tick(&mut e);
    let d = e.unified_contact_impulse_diagnostics().unwrap();
    assert!(d.dropped > 0);
    assert_eq!(d.solved_contacts, d.dropped + 1);
    assert_eq!(e.physics_contact_impacts_dropped(), d.dropped as u32);
    assert_eq!(e.physics_impact_feedback_stats()[1], d.dropped as u32);
    assert_eq!(e.query_physics_contact_impacts(), 1);
}

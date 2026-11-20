use super::*;
use crate::entity::Entity;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Pose, Shape, Space, WorldConfig};

fn engine(space: Space, limit: usize) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        step_seconds: 0.01,
        max_events: limit,
        length_unit: 1.0,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn cube(e: &mut Engine, p: [f32; 3], kind: BodyKind, category: u32, sensor: bool) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind,
            pose: Pose {
                position: p,
                ..Pose::default()
            },
            can_sleep: false,
            ..BodyDesc::default()
        },
        ColliderDesc {
            category,
            sensor,
            ..ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            })
        },
        [0.0, 100.0, 0.0],
    )
    .unwrap()
}
fn tick(e: &mut Engine) {
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
}
fn contacts(e: &mut Engine) {
    e.query_unified_physics_contacts(u32::MAX, u32::MAX, true, 64, 256)
        .unwrap();
}

#[test]
fn observation_contacts_keep_xyz_witnesses_oriented_categories_and_whole_patch_limits() {
    let mut e = engine(Space::Spatial, 16);
    let a = cube(&mut e, [0.0; 3], BodyKind::Fixed, 2, false);
    let b = cube(&mut e, [0.0, 0.9, 0.0], BodyKind::Fixed, 4, false);
    e.query_unified_physics_contacts(2, 4, false, 8, 32)
        .unwrap();
    let o = &e.unified_physics_observations;
    assert_eq!(o.manifolds.len(), 1);
    assert!(o.points.len() >= 4); // Native face patches can retain additional witnesses.
    assert_eq!(o.manifolds[0].first.entity, [a.id, a.generation]);
    assert_eq!(o.manifolds[0].second.entity, [b.id, b.generation]);
    assert!(o.manifolds[0].normal[1] > 0.99);
    assert!(o.points.iter().all(|p| (p.first[1] - 0.5).abs() < 1e-5
        && (p.second[1] - 0.4).abs() < 1e-5
        && (p.penetration - 0.1).abs() < 1e-5));
    let points = o.points.clone();
    e.query_unified_physics_contacts(4, 2, false, 8, 32)
        .unwrap();
    assert_eq!(
        e.unified_physics_observations.manifolds[0].first.entity,
        [b.id, b.generation]
    );
    assert!(e.unified_physics_observations.manifolds[0].normal[1] < -0.99);
    e.query_unified_physics_contacts(2, 4, false, 8, 3).unwrap();
    assert!(e.unified_physics_observations.truncated);
    assert_eq!(e.unified_physics_contacts_total_manifolds(), 1);
    assert_eq!(
        e.unified_physics_contacts_total_points(),
        points.len() as u32
    );
    assert_eq!(e.unified_physics_observation_count(0), 0);
    assert_eq!(e.unified_physics_observation_count(1), 0);
    e.query_unified_physics_observations().unwrap();
    assert!(e.unified_physics_observations.impulses.is_empty());
    assert_eq!(
        e.unified_physics_observations
            .diagnostics
            .step
            .backend_steps,
        0
    );
    assert_eq!(e.elapsed_seconds, 0.0);
    assert!(e.query_unified_physics_contacts(2, 4, false, 0, 3).is_err());
    assert_eq!(e.unified_physics_contacts_total_points(), 0);
    assert!(!e.unified_physics_contacts_truncated());
}

#[test]
fn observation_contacts_refresh_geometry_and_sensors_without_consuming_targets() {
    let mut e = engine(Space::Spatial, 16);
    cube(&mut e, [0.0; 3], BodyKind::Fixed, 2, true);
    let b = cube(
        &mut e,
        [0.0, 0.9, 0.0],
        BodyKind::KinematicPosition,
        4,
        false,
    );
    e.command_unified_physics_bodies(
        1,
        &[b.id, b.generation],
        &[0.0, 4.0, 0.0, 0.0, 0.0, 0.0, 1.0],
    )
    .unwrap();
    e.query_unified_physics_contacts(2, 4, false, 8, 32)
        .unwrap();
    assert_eq!(e.unified_physics_observation_count(0), 0);
    contacts(&mut e);
    assert_eq!(e.unified_physics_observation_count(0), 1);
    assert_eq!(
        e.unified_physics_observations.manifolds[0].first.flags & 2,
        2
    );
    assert_eq!(e.unified_body_state(b).unwrap().pose.position[1], 0.9);
    tick(&mut e);
    contacts(&mut e);
    assert_eq!(e.unified_physics_observation_count(0), 0);
    assert_eq!(e.unified_body_state(b).unwrap().pose.position[1], 4.0);
    e.set_unified_body_pose(
        b,
        Pose {
            position: [0.0, 0.9, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    contacts(&mut e);
    assert_eq!(e.unified_physics_observation_count(0), 1);
}

#[test]
fn observation_impulses_report_solved_xyz_not_geometric_estimates_and_survive_removal() {
    let mut e = engine(Space::Spatial, 64);
    cube(&mut e, [0.0; 3], BodyKind::Fixed, 2, false);
    let b = cube(&mut e, [0.0, 1.0, 0.0], BodyKind::Dynamic, 4, false);
    e.set_unified_body_velocity(b, [1.0, -6.0, 2.0], [0.0; 3])
        .unwrap();
    tick(&mut e);
    e.query_unified_physics_observations().unwrap();
    let o = &e.unified_physics_observations;
    assert!(!o.impulses.is_empty());
    assert_eq!(o.impulses.len() as u32, o.diagnostics.solved_contacts);
    assert_eq!(o.diagnostics.impulses_dropped, 0);
    assert!(o.impulses.iter().all(|c| c.categories == 6
        && c.normal_impulse > 0.0
        && c.normal[1].abs() > 0.99
        && c.point[1].abs() < 2.0
        && (c.approach_speed - 6.0).abs() < 1e-4));
    assert!(o.impulses.iter().any(|c| c.tangent_impulse[2].abs() > 1e-4));
    let before = o.impulses.clone();
    e.remove_unified_body(b).unwrap();
    contacts(&mut e);
    e.query_unified_physics_observations().unwrap();
    assert_eq!(e.unified_physics_observations.impulses, before);
    e.update(0.0);
    e.query_unified_physics_observations().unwrap();
    assert_eq!(e.unified_physics_observations.impulses, before);
    assert_eq!(e.unified_physics_observations.diagnostics.fixed_steps, 0);
    assert_eq!(
        e.unified_physics_observations
            .diagnostics
            .step
            .backend_steps,
        1
    );
    assert_eq!(
        e.unified_physics_observations
            .diagnostics
            .frame
            .backend_steps,
        0
    );
}

#[test]
fn observation_terrain_contacts_and_solved_overflow_preserve_source_after_retirement() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space, 1);
        if space == Space::PlanarXy {
            e.tilemap
                .set_layer(0, 1, 1, 2.0, 1.0, -1.0, -1.0, true, vec![1]);
        } else {
            assert!(e.spatial_scene.configure_surfaces(
                &[-1.0, -1.0, 2.0, 2.0, -0.5, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
                &[7, 7, 0, 9]
            ));
        }
        let b = cube(&mut e, [0.0, 0.49, 0.0], BodyKind::Dynamic, 4, false);
        contacts(&mut e);
        assert!(!e.unified_physics_observations.manifolds.is_empty());
        let m = e.unified_physics_observations.manifolds[0];
        let t = if m.first.terrain[0] != 0 {
            m.first
        } else {
            m.second
        };
        assert_eq!(t.flags & 1, 0);
        assert_eq!(
            t.terrain,
            if space == Space::PlanarXy {
                [1, 0, 0]
            } else {
                [2, 7, 0]
            }
        );
        e.set_unified_body_velocity(b, [0.0, -6.0, 0.0], [0.0; 3])
            .unwrap();
        tick(&mut e);
        e.query_unified_physics_observations().unwrap();
        let o = &e.unified_physics_observations;
        assert_eq!(o.impulses.len(), 1);
        assert!(o.diagnostics.impulses_dropped > 0);
        assert_eq!(
            o.diagnostics.solved_contacts,
            1 + o.diagnostics.impulses_dropped
        );
        let before = o.impulses.clone();
        let t2 = if before[0].first.terrain[0] != 0 {
            before[0].first
        } else {
            before[0].second
        };
        assert_eq!(t, t2);
        e.tilemap
            .set_layer(0, 1, 1, 2.0, 1.0, -1.0, -1.0, true, vec![0]);
        assert!(e.spatial_scene.configure_surfaces(&[], &[]));
        contacts(&mut e);
        e.query_unified_physics_observations().unwrap();
        assert_eq!(e.unified_physics_observations.impulses, before);
    }
}

#[test]
fn observation_diagnostics_retain_early_ccd_terrain_witness_and_exact_native_frame_counts() {
    let mut e = engine(Space::PlanarXy, 64);
    e.tilemap
        .set_layer(0, 1, 1, 0.1, 2.0, 0.0, -1.0, true, vec![1]);
    let a = e
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [-2.0, 0.0, 0.0],
                    ..Pose::default()
                },
                linear_velocity: [600.0, 0.0, 0.0],
                ccd: true,
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.0; 3],
        )
        .unwrap();
    e.update(3.0 * f64::from(e.fixed_timestep.config().step_seconds));
    e.query_unified_physics_observations().unwrap();
    let o = &e.unified_physics_observations;
    assert_eq!(o.diagnostics.fixed_steps, 3);
    assert_eq!(o.diagnostics.frame.backend_steps, 3);
    assert_eq!(
        o.diagnostics.step,
        e.unified_physics_step_statistics().unwrap()
    );
    assert_eq!(
        o.diagnostics.frame,
        e.unified_physics_frame_statistics().unwrap().totals
    );
    assert!(o.diagnostics.frame.ccd_clamps > 0);
    assert_eq!(o.diagnostics.step.ccd_clamps, 0);
    assert!(!o.clamps.is_empty());
    let clamp = o.clamps[0];
    assert_eq!(clamp.moving.entity, [a.id, a.generation]);
    assert_eq!(clamp.target.terrain, [1, 0, 0]);
    assert!(clamp.fraction >= 0.0 && clamp.fraction < 1.0 && clamp.sweep_seconds > 0.0);
    assert!(clamp.normal[0] < -0.99);
    assert!(clamp.point[0].abs() < 0.11);
    e.remove_unified_body(a).unwrap();
    e.tilemap
        .set_layer(0, 1, 1, 0.1, 2.0, 0.0, -1.0, true, vec![0]);
    contacts(&mut e);
    e.query_unified_physics_observations().unwrap();
    assert_eq!(e.unified_physics_observations.clamps[0], clamp);
    e.update(0.0);
    e.query_unified_physics_observations().unwrap();
    assert!(e.unified_physics_observations.clamps.is_empty());
    assert_eq!(e.unified_physics_observations.diagnostics.fixed_steps, 0);
    assert!(e.query_unified_physics_diagnostics());
    assert_eq!(e.unified_physics_observations.diagnostics.fixed_steps, 0);
    e.unified_physics = None;
    assert!(!e.query_unified_physics_diagnostics());
    assert!(e.query_unified_physics_observations().is_err());
    assert_eq!(e.unified_physics_observation_count(4), 0);
    assert!(e.query_unified_physics_contacts(1, 1, false, 1, 1).is_err());
    assert_eq!(e.unified_physics_observation_count(0), 0);
}

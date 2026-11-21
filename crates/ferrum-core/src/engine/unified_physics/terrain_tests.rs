use super::*;
use crate::components::CollisionMask;
use crate::physics3d::{QueryFilter, RayCast, Shape};

fn engine(space: Space, capacity: usize) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        max_bodies: capacity,
        max_colliders: capacity,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn tile(e: &mut Engine, x: f32, y: f32, w: f32, h: f32) {
    e.tilemap.set_layer(0, 1, 1, w, h, x, y, true, vec![1]);
}
fn ray(e: &mut Engine, origin: [f32; 3], direction: [f32; 3]) -> Vec<UnifiedTerrainRayHit> {
    let mut hits = Vec::new();
    e.cast_unified_terrain_ray_all(
        &RayCast {
            origin,
            direction,
            max_distance: 100.0,
            solid: true,
        },
        &QueryFilter {
            respect_target_mask: false,
            include_sensors: true,
            ..QueryFilter::default()
        },
        &mut hits,
        16.min(
            e.unified_physics
                .as_ref()
                .unwrap()
                .physics
                .config()
                .max_colliders,
        ),
    )
    .unwrap();
    hits
}
fn ball(e: &mut Engine, position: [f32; 3], velocity: [f32; 3]) -> Entity {
    e.create_unified_body(
        BodyDesc {
            pose: Pose {
                position,
                ..Pose::default()
            },
            linear_velocity: velocity,
            ccd: true,
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
        [0.0; 3],
    )
    .unwrap()
}
fn tick(e: &mut Engine, count: usize) {
    for _ in 0..count {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
        assert_eq!(e.unified_physics_error(), None);
    }
}
fn surfaces(e: &mut Engine, specs: &[(u32, [f32; 7], u32)]) {
    let mut f = Vec::new();
    let mut n = Vec::new();
    for &(id, bounds, flags) in specs {
        f.extend(bounds);
        f.extend([1.0; 4]);
        n.extend([id, id, 0, flags]);
    }
    assert!(e.spatial_scene.configure_surfaces(&f, &n));
}

#[test]
fn authored_tile_stops_native_body_and_edits_preserve_or_retire_identity() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space, 8);
        tile(&mut e, 2.0, -1.0, 1.0, 2.0);
        let position = if space == Space::PlanarXy {
            [0.0; 3]
        } else {
            [0.0, 1.0, 0.0]
        };
        let body = ball(&mut e, position, [10.0, 0.0, 0.0]);
        let initial = ray(&mut e, position, [1.0, 0.0, 0.0]);
        assert_eq!(initial.len(), 1);
        assert_eq!(
            initial[0].source,
            UnifiedTerrainSource::Tile { layer: 0, tile: 0 }
        );
        tick(&mut e, 30);
        assert!(e.unified_body_state(body).unwrap().pose.position[0] < 1.8);
        tile(&mut e, 4.0, -1.0, 1.0, 2.0);
        let edited = ray(&mut e, position, [1.0, 0.0, 0.0]);
        assert_eq!(initial[0].hit.target, edited[0].hit.target);
        assert!((edited[0].hit.distance - 4.0).abs() < 0.001);
        assert!(e.tilemap.set_tile(0, 0, 0, 0));
        assert!(ray(&mut e, position, [1.0, 0.0, 0.0]).is_empty());
        tile(&mut e, 4.0, -1.0, 1.0, 2.0);
        assert_ne!(
            ray(&mut e, position, [1.0, 0.0, 0.0])[0].hit.target,
            initial[0].hit.target
        );
    }
}

#[test]
fn spatial_ramp_and_bridge_queries_follow_actual_top_and_underside() {
    let mut e = engine(Space::Spatial, 8);
    surfaces(
        &mut e,
        &[
            (7, [0.0, 0.0, 4.0, 4.0, 2.0, 3.0, 3.0], 9),
            (8, [5.0, 0.0, 4.0, 4.0, 0.0, 0.0, 2.0], 5 | 32),
        ],
    );
    assert!(ray(&mut e, [-1.0, 1.0, -2.0], [1.0, 0.0, 0.0])
        .iter()
        .all(|h| h.source != UnifiedTerrainSource::SpatialSurface { id: 7 }));
    let above = ray(&mut e, [2.0, 10.0, -2.0], [0.0, -1.0, 0.0]);
    assert!((above[0].hit.point[1] - 3.0).abs() < 0.001);
    let below = ray(&mut e, [2.0, 0.0, -2.0], [0.0, 1.0, 0.0]);
    assert!((below[0].hit.point[1] - 2.0).abs() < 0.001);
    assert!(below[0].hit.normal[1] < -0.99);
    for (x, height) in [(6.0, 0.5), (8.0, 1.5)] {
        let ramp = ray(&mut e, [x, 10.0, -2.0], [0.0, -1.0, 0.0]);
        assert!((ramp[0].hit.point[1] - height).abs() < 0.001, "{ramp:?}");
        assert!(ramp[0].hit.normal[0] < -0.4 && ramp[0].hit.normal[1] > 0.8);
    }
    let body = ball(&mut e, [2.0, 5.0, -2.0], [0.0; 3]);
    let solver = e.unified_physics.as_ref().unwrap().physics.config().solver;
    e.set_unified_runtime_settings([0.0, -9.81, 0.0], solver)
        .unwrap();
    tick(&mut e, 120);
    assert!((e.unified_body_state(body).unwrap().pose.position[1] - 3.25).abs() < 0.02);
}

#[test]
fn terrain_admission_is_atomic_when_capacity_or_geometry_is_invalid() {
    let mut e = engine(Space::PlanarXy, 2);
    tile(&mut e, 2.0, -1.0, 1.0, 2.0);
    let original = ray(&mut e, [0.0; 3], [1.0, 0.0, 0.0]);
    assert!((original[0].hit.point[0] - 2.0).abs() < 0.001);
    // The fixed body is now a chunk origin; the unchanged collider still owns
    // the actual tile geometry at x=2..3.
    let b = ball(&mut e, [-5.0, 0.0, 0.0], [1.0, 0.0, 0.0]);
    let before = e.unified_body_state(b).unwrap();
    e.tilemap
        .set_layer(0, 2, 1, 1.0, 2.0, 4.0, -1.0, true, vec![1, 1]);
    let mut out = original.clone();
    let cast = RayCast {
        origin: [0.0; 3],
        direction: [1.0, 0.0, 0.0],
        max_distance: 10.0,
        solid: true,
    };
    assert_eq!(
        e.cast_unified_terrain_ray_all(&cast, &QueryFilter::default(), &mut out, 2),
        Err(PhysicsError::CapacityExceeded.into())
    );
    assert_eq!(out, original);
    assert_eq!(e.unified_body_state(b).unwrap(), before);
    let native = &mut e.unified_physics.as_mut().unwrap().physics;
    assert_eq!(native.body_count(), 2);
    assert_eq!(
        native
            .body_state(original[0].hit.target.body)
            .unwrap()
            .pose
            .position[0],
        0.0
    );
    // All geometry validates before any existing cell moves.
    e.tilemap
        .set_layer(0, 1, 1, 1.0, 2.0, 4.0, -1.0, true, vec![1]);
    e.tilemap
        .set_layer(1, 1, 1, 1e6, 2.0, 0.0, -1.0, true, vec![1]);
    assert!(e
        .cast_unified_terrain_ray_all(&cast, &QueryFilter::default(), &mut out, 2)
        .is_err());
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .body_state(original[0].hit.target.body)
            .unwrap()
            .pose
            .position[0],
        0.0
    );
    e.tilemap
        .set_layer(1, 1, 1, 1.0, 2.0, 0.0, 0.0, false, vec![1]);
    assert!((ray(&mut e, [0.0; 3], [1.0, 0.0, 0.0])[0].hit.distance - 4.0).abs() < 0.001);
}

#[test]
fn planar_slope_is_a_surface_and_one_way_tiles_pass_upward_then_support_fall() {
    let mut e = engine(Space::PlanarXy, 8);
    tile(&mut e, 0.0, 0.0, 4.0, 4.0);
    e.tilemap.set_tile_slope_definition(1, 0.0, 1.0, 1.0, 0.0);
    let h = ray(&mut e, [1.0, -1.0, 0.0], [0.0, 1.0, 0.0]);
    assert!((h[0].hit.point[1] - 3.0).abs() < 0.001);
    e.tilemap.clear_tile_slope_definition(1);
    e.tilemap.set_tile_one_way_platform(1);
    let body = ball(&mut e, [2.0, 5.0, 0.0], [0.0, -12.0, 0.0]);
    let solver = e.unified_physics.as_ref().unwrap().physics.config().solver;
    e.set_unified_runtime_settings([0.0, 10.0, 0.0], solver)
        .unwrap();
    tick(&mut e, 70);
    assert!(e.unified_body_state(body).unwrap().pose.position[1] < -1.0);
    tick(&mut e, 150);
    let p = e.unified_body_state(body).unwrap().pose.position;
    assert!((p[1] + 0.25).abs() < 0.03, "{p:?}");
    // Ordinary inspection still sees the underside.
    let h = ray(&mut e, [2.0, 5.0, 0.0], [0.0, -1.0, 0.0]);
    assert!((h[0].hit.point[1] - 4.0).abs() < 0.001);
}

#[test]
fn terrain_masks_distinguish_movement_projectile_and_logical_floors() {
    let mut e = engine(Space::PlanarXy, 8);
    tile(&mut e, 2.0, -1.0, 1.0, 2.0);
    assert!(e
        .tilemap
        .set_tile_hd2d_definition(1, 0, false, true, false, 0.0, false, 0, 0.0, 0.0));
    let b = ball(&mut e, [0.0; 3], [10.0, 0.0, 0.0]);
    tick(&mut e, 30);
    assert!(e.unified_body_state(b).unwrap().pose.position[0] > 4.9);
    let h = ray(&mut e, [0.0; 3], [1.0, 0.0, 0.0]);
    assert!(h[0].hit.target.sensor);
    let mut hits = Vec::new();
    e.cast_unified_terrain_ray_all(
        &RayCast {
            origin: [0.0; 3],
            direction: [1.0, 0.0, 0.0],
            max_distance: 10.0,
            solid: true,
        },
        &QueryFilter {
            category: CollisionMask::BULLET.bits,
            include_sensors: true,
            ..QueryFilter::default()
        },
        &mut hits,
        8,
    )
    .unwrap();
    assert_eq!(hits.len(), 1);
    assert!(e
        .tilemap
        .set_tile_hd2d_definition(1, 0, true, false, true, 0.0, false, 0, 0.0, 0.0));
    assert!(e.tilemap.set_tile_height_span_definition(1, 9, 0.0, 2.0));
    let id = e.unified_body_id(b).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_planar_collision_span(
            id,
            Some(crate::physics3d::PlanarCollisionSpan {
                floor: 3,
                elevation: 0.0,
                height: 2.0,
            }),
        )
        .unwrap();
    // Return through the wall on another logical floor.
    e.set_unified_body_velocity(b, [-10.0, 0.0, 0.0], [0.0; 3])
        .unwrap();
    tick(&mut e, 30);
    assert!(e.unified_body_state(b).unwrap().pose.position[0] < 0.1);
}

#[test]
fn one_way_native_ccd_stops_fast_fall_and_allows_fast_rise_in_both_spaces() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for falling in [true, false] {
            let mut e = engine(space, 8);
            tile(&mut e, -2.0, -2.0, 4.0, 4.0);
            e.tilemap.set_tile_height_span_definition(1, 0, 0.0, 1.0);
            e.tilemap.set_tile_one_way_platform(1);
            let (position, velocity) = if space == Space::PlanarXy {
                if falling {
                    ([0.0, -3.0, 0.0], [0.0, 300.0, 0.0])
                } else {
                    ([0.0, 3.0, 0.0], [0.0, -400.0, 0.0])
                }
            } else if falling {
                ([0.0, 2.0, 0.0], [0.0, -300.0, 0.0])
            } else {
                ([0.0, -1.0, 0.0], [0.0, 300.0, 0.0])
            };
            let b = ball(&mut e, position, velocity);
            tick(&mut e, 1);
            let y = e.unified_body_state(b).unwrap().pose.position[1];
            if space == Space::PlanarXy {
                assert!(y < -2.2, "{falling}: {y}");
            } else {
                assert!(y > 1.2, "{falling}: {y}");
            }
        }
    }
}

#[test]
fn spatial_hd_tile_supports_at_authored_elevation_and_capsule_climbs_one_way_ramp() {
    let mut e = engine(Space::Spatial, 8);
    tile(&mut e, 0.0, 0.0, 8.0, 4.0);
    e.tilemap.set_tile_height_span_definition(1, 0, 3.0, 4.0);
    assert!(e
        .tilemap
        .set_tile_hd2d_definition(1, 2, false, true, true, 0.0, true, 0, 3.0, 5.0));
    e.tilemap.set_tile_one_way_platform(1);
    let h = ray(&mut e, [4.0, 10.0, -2.0], [0.0, -1.0, 0.0]);
    assert!((h[0].hit.point[1] - 4.0).abs() < 0.001);
    let actor = e
        .create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::KinematicPosition,
                pose: Pose {
                    position: [1.0, 5.0, -2.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
            [0.0; 3],
        )
        .unwrap();
    e.enable_unified_character(actor, CharacterConfig::default())
        .unwrap();
    let solver = e.unified_physics.as_ref().unwrap().physics.config().solver;
    e.set_unified_runtime_settings([0.0, -9.81, 0.0], solver)
        .unwrap();
    tick(&mut e, 90);
    assert!(e.unified_character_state(actor).unwrap().grounded);
    e.set_unified_character_input(
        actor,
        CharacterInput {
            velocity: [2.0, 0.0, 0.0],
            jump_speed: 0.0,
        },
    )
    .unwrap();
    tick(&mut e, 120);
    let state = e.unified_body_state(actor).unwrap();
    assert!(
        state.pose.position[0] > 4.0 && state.pose.position[1] > 4.5,
        "{state:?}"
    );
    assert!(e.unified_character_state(actor).unwrap().grounded);
    // Removing the actual support invalidates grounding even through a non-stepping query.
    assert!(e.tilemap.set_tile(0, 0, 0, 0));
    assert!(ray(&mut e, [4.0, 10.0, -2.0], [0.0, -1.0, 0.0]).is_empty());
    assert!(!e.unified_character_state(actor).unwrap().grounded);
}

#[test]
fn spatial_surface_reorder_retains_handles_and_full_capacity_replacement_retires_first() {
    let mut e = engine(Space::Spatial, 2);
    let a = (4, [0.0, 0.0, 2.0, 2.0, 0.0, 1.0, 1.0], 1);
    let b = (9, [3.0, 0.0, 2.0, 2.0, 0.0, 1.0, 1.0], 1);
    surfaces(&mut e, &[a, b]);
    let initial = ray(&mut e, [-1.0, 0.5, -1.0], [1.0, 0.0, 0.0]);
    surfaces(&mut e, &[b, a]);
    assert_eq!(ray(&mut e, [-1.0, 0.5, -1.0], [1.0, 0.0, 0.0]), initial);
    let c = (12, [0.0, 0.0, 2.0, 2.0, 0.0, 1.0, 1.0], 1);
    surfaces(&mut e, &[b, c]);
    let replacement = ray(&mut e, [-1.0, 0.5, -1.0], [1.0, 0.0, 0.0]);
    assert_eq!(replacement.len(), 2);
    assert_ne!(replacement[0].hit.target, initial[0].hit.target);
    assert_eq!(replacement[1].hit.target, initial[1].hit.target);
}

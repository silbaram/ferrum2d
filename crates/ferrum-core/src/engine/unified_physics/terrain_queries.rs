//! Legacy tile DTOs backed by actual native tile colliders. Spatial surfaces
//! remain typed terrain in the native bulk API; they never acquire fake tile IDs.
use super::queries::legacy_filter;
use super::*;
use crate::collision::CollisionQueryShape;
use crate::engine::physics_bridge::PhysicsQueryResult;
use crate::tilemap::{TilemapContactManifoldHit, TilemapContactPoint, TilemapShapeCastHit};

impl Engine {
    pub(in crate::engine) fn query_native_tile_nearest(
        &mut self,
        p: Transform2D,
        distance: f32,
        span: Option<HeightSpan>,
    ) -> Option<bool> {
        let rt = self.unified_physics.as_mut()?;
        self.physics_query_result = PhysicsQueryResult::default();
        let result = rt
            .require_planar_query()
            .and_then(|()| {
                rt.prepare_query(
                    &mut self.world,
                    self.auto_rigid_body_step_config,
                    &self.tilemap,
                    &self.spatial_scene,
                )
            })
            .and_then(|()| {
                rt.physics.project_point_all(
                    [p.x, p.y, 0.],
                    distance,
                    &legacy_filter(u32::MAX, span),
                    &mut rt.native_nearest_hits,
                    rt.physics.config().max_colliders,
                )?;
                Ok(())
            });
        if let Err(e) = result {
            rt.last_error.record(e);
            return Some(false);
        }
        let hit = rt
            .native_nearest_hits
            .iter()
            .filter_map(|h| {
                let UnifiedTerrainSource::Tile { layer, tile } =
                    rt.terrain.source(h.target.collider)?
                else {
                    return None;
                };
                rt.terrain
                    .allows(h.target.collider, 1)
                    .then_some((h, layer, tile))
            })
            .min_by(|a, b| {
                a.0.distance
                    .total_cmp(&b.0.distance)
                    .then((a.1, a.2).cmp(&(b.1, b.2)))
            });
        if let Some((hit, layer, tile)) = hit {
            self.physics_query_result = PhysicsQueryResult {
                tile_layer_index: layer,
                tile_index: tile,
                point_x: hit.point[0],
                point_y: hit.point[1],
                distance: hit.distance,
                ..PhysicsQueryResult::default()
            };
            Some(true)
        } else {
            Some(false)
        }
    }

    pub(in crate::engine) fn query_native_tile_sweep(
        &mut self,
        query: CollisionQueryShape,
        direction: Velocity,
        distance: f32,
        span: Option<HeightSpan>,
        ray: bool,
    ) -> Option<u32> {
        let rt = self.unified_physics.as_mut()?;
        self.physics_tile_shape_cast_scratch.clear();
        self.physics_tile_shape_cast_hits.clear();
        let result = rt
            .require_planar_query()
            .and_then(|()| {
                if ray {
                    // A ray has no shape extent. Validate its origin/direction in
                    // native RayCast; zero-sized OrientedBox is not a valid cast shape.
                    let point = crate::collision::query_shape_reference_point(query);
                    Ok((
                        None,
                        Pose {
                            position: [point.x, point.y, 0.],
                            ..Pose::default()
                        },
                    ))
                } else {
                    query_geometry::convert(query).map(|(shape, pose)| (Some(shape), pose))
                }
            })
            .and_then(|(shape, pose)| {
                let length = direction.vx.hypot(direction.vy);
                if !length.is_finite()
                    || length <= 0.
                    || !distance.is_finite()
                    || !(0. ..=1e6).contains(&distance)
                {
                    return Err(PhysicsError::InvalidQuery.into());
                }
                let translation = [
                    direction.vx / length * distance,
                    direction.vy / length * distance,
                    0.,
                ];
                rt.prepare_query(
                    &mut self.world,
                    self.auto_rigid_body_step_config,
                    &self.tilemap,
                    &self.spatial_scene,
                )?;
                if ray {
                    rt.physics.cast_ray_all(
                        &crate::physics3d::RayCast {
                            origin: pose.position,
                            direction: [direction.vx, direction.vy, 0.],
                            max_distance: distance,
                            solid: true,
                        },
                        &legacy_filter(u32::MAX, span),
                        &mut rt.native_ray_hits,
                        rt.physics.config().max_colliders,
                    )?;
                } else {
                    rt.physics.sweep_all(
                        shape.as_ref().ok_or(PhysicsError::InvalidQuery)?,
                        pose,
                        translation,
                        &legacy_filter(u32::MAX, span),
                        &mut rt.native_sweep_hits,
                        rt.physics.config().max_colliders,
                    )?;
                }
                Ok((pose, translation))
            });
        let (pose, translation) = match result {
            Ok(v) => v,
            Err(e) => {
                rt.last_error.record(e);
                return Some(0);
            }
        };
        let out = &mut self.physics_tile_shape_cast_scratch;
        let mut push = |collider, dist, point: [f32; 3], normal: [f32; 3]| {
            if let Some(UnifiedTerrainSource::Tile { layer, tile }) = rt.terrain.source(collider) {
                if rt.terrain.allows(collider, 1) {
                    out.push(TilemapShapeCastHit {
                        layer_index: layer as usize,
                        tile_index: tile as usize,
                        distance: dist,
                        point_x: point[0],
                        point_y: point[1],
                        normal_x: normal[0],
                        normal_y: normal[1],
                    });
                }
            }
        };
        if ray {
            for h in &rt.native_ray_hits {
                push(h.target.collider, h.distance, h.point, h.normal);
            }
        } else {
            for h in &rt.native_sweep_hits {
                push(
                    h.target.collider,
                    h.fraction * distance,
                    std::array::from_fn(|i| pose.position[i] + translation[i] * h.fraction),
                    h.normal,
                );
            }
        }
        out.sort_unstable_by(|a, b| {
            a.distance
                .total_cmp(&b.distance)
                .then((a.layer_index, a.tile_index).cmp(&(b.layer_index, b.tile_index)))
        });
        Some(self.store_physics_tile_shape_cast_hits_from_scratch())
    }

    pub(in crate::engine) fn query_native_tile_contacts(
        &mut self,
        p: Transform2D,
        half: [f32; 2],
        span: Option<HeightSpan>,
        manifolds: bool,
    ) -> Option<u32> {
        let rt = self.unified_physics.as_mut()?;
        self.physics_tile_manifold_scratch.clear();
        self.physics_tile_manifold_hits.clear();
        self.physics_tile_contact_scratch.clear();
        self.physics_tile_contact_hits.clear();
        let result = rt
            .require_planar_query()
            .and_then(|()| {
                query_geometry::convert(CollisionQueryShape::Aabb(crate::collision::AabbBounds {
                    min_x: p.x - half[0],
                    min_y: p.y - half[1],
                    max_x: p.x + half[0],
                    max_y: p.y + half[1],
                }))
            })
            .and_then(|(shape, pose)| {
                rt.prepare_query(
                    &mut self.world,
                    self.auto_rigid_body_step_config,
                    &self.tilemap,
                    &self.spatial_scene,
                )?;
                let out = &mut self.physics_tile_manifold_scratch;
                rt.physics.visit_shape_contacts(
                    &shape,
                    pose,
                    &legacy_filter(u32::MAX, span),
                    &mut |target, normal, point, penetration| {
                        let Some(UnifiedTerrainSource::Tile { layer, tile }) =
                            rt.terrain.source(target.collider)
                        else {
                            return;
                        };
                        if !rt.terrain.allows(target.collider, 1) {
                            return;
                        }
                        let key = (layer as usize, tile as usize);
                        let index = out
                            .iter()
                            .position(|m| (m.layer_index, m.tile_index) == key);
                        let m = if let Some(i) = index {
                            &mut out[i]
                        } else {
                            out.push(TilemapContactManifoldHit {
                                layer_index: key.0,
                                tile_index: key.1,
                                normal_x: normal[0],
                                normal_y: normal[1],
                                penetration,
                                point_count: 0,
                                points: [TilemapContactPoint::default(); 2],
                            });
                            out.last_mut().expect("just inserted")
                        };
                        if penetration > m.penetration {
                            m.penetration = penetration;
                            m.normal_x = normal[0];
                            m.normal_y = normal[1];
                        }
                        let point = TilemapContactPoint {
                            point_x: point[0],
                            point_y: point[1],
                            penetration,
                        };
                        if m.points[..m.point_count as usize]
                            .iter()
                            .any(|p| p.point_x == point.point_x && p.point_y == point.point_y)
                        {
                            return;
                        }
                        if m.point_count < 2 {
                            m.points[m.point_count as usize] = point;
                            m.point_count += 1;
                        } else {
                            // Retain the extrema along the contact tangent, not duplicate
                            // front/back witnesses of the planar extrusion.
                            let tangent = |p: TilemapContactPoint| {
                                -m.normal_y * p.point_x + m.normal_x * p.point_y
                            };
                            let mut points = [m.points[0], m.points[1], point];
                            points.sort_by(|a, b| tangent(*a).total_cmp(&tangent(*b)));
                            m.points = [points[0], points[2]];
                        }
                    },
                )?;
                Ok(())
            });
        if let Err(e) = result {
            rt.last_error.record(e);
            self.physics_tile_manifold_scratch.clear();
            return Some(0);
        }
        self.physics_tile_manifold_scratch
            .sort_unstable_by_key(|m| (m.layer_index, m.tile_index));
        if manifolds {
            Some(self.store_physics_tile_manifold_hits_from_scratch())
        } else {
            self.physics_tile_contact_scratch.extend(
                self.physics_tile_manifold_scratch.iter().map(|m| {
                    crate::tilemap::TilemapContactHit {
                        layer_index: m.layer_index,
                        tile_index: m.tile_index,
                        normal_x: m.normal_x,
                        normal_y: m.normal_y,
                        penetration: m.penetration,
                        point_x: m.points[0].point_x,
                        point_y: m.points[0].point_y,
                    }
                }),
            );
            Some(self.store_physics_tile_contact_hits_from_scratch())
        }
    }
}

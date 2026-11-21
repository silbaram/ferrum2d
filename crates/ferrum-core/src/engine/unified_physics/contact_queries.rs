//! Native contact geometry mapped to gameplay identities and existing planar hit layouts.
use super::*;
use crate::collision::{CollisionContact, CollisionContactPoint, CollisionManifold, CollisionPair};
use crate::physics3d::ContactManifold as NativeManifold;

/// Spatial contact geometry with Engine entity identities.
#[derive(Debug, Clone, PartialEq)]
pub struct UnifiedContactManifold {
    /// Entity owning the first collider, oriented by requested category masks.
    pub a: Entity,
    /// Entity owning the second collider.
    pub b: Entity,
    /// Full XYZ surface witnesses and collider/subshape identities.
    pub contact: NativeManifold,
}

impl Engine {
    /// Queries current XYZ geometric contacts without stepping the unified world.
    /// Includes each matching collider/subshape patch. Storage grows with contact count.
    /// Direct authored edits are synchronized without consuming pending impulses.
    /// Failed queries leave the caller's output unchanged.
    pub fn query_unified_contact_manifolds(
        &mut self,
        category_a: u32,
        category_b: u32,
        include_sensors: bool,
        out: &mut Vec<UnifiedContactManifold>,
    ) -> Result<(), UnifiedPhysicsError> {
        let runtime = self
            .unified_physics
            .as_mut()
            .ok_or(UnifiedPhysicsError::NotConfigured)?;
        runtime.prepare_query(
            &mut self.world,
            self.auto_rigid_body_step_config,
            &self.tilemap,
            &self.spatial_scene,
        )?;
        runtime.physics.query_contact_manifolds(
            category_a,
            category_b,
            include_sensors,
            &mut runtime.native_contact_manifolds,
        )?;
        out.clear();
        out.extend(
            runtime
                .native_contact_manifolds
                .iter()
                .filter_map(|contact| {
                    Some(UnifiedContactManifold {
                        a: *runtime.entities_by_body.get(&contact.first.body)?,
                        b: *runtime.entities_by_body.get(&contact.second.body)?,
                        contact: contact.clone(),
                    })
                }),
        );
        Ok(())
    }

    pub(in crate::engine) fn query_unified_planar_contacts(
        &mut self,
        category_a: u32,
        category_b: u32,
        manifold_output: bool,
    ) -> Option<u32> {
        let runtime = self.unified_physics.as_mut()?;
        if manifold_output {
            self.physics_body_manifold_hits.clear();
            self.physics_body_manifold_scratch.clear();
        } else {
            self.physics_body_contact_hits.clear();
            self.physics_body_contact_scratch.clear();
        }
        let result = runtime
            .require_planar_query()
            .and_then(|()| {
                runtime.prepare_query(
                    &mut self.world,
                    self.auto_rigid_body_step_config,
                    &self.tilemap,
                    &self.spatial_scene,
                )
            })
            .and_then(|()| {
                runtime
                    .physics
                    .query_contact_manifolds(
                        category_a,
                        category_b,
                        true,
                        &mut runtime.native_contact_manifolds,
                    )
                    .map_err(Into::into)
            });
        if let Err(error) = result {
            runtime.last_error.record(error);
            return Some(0);
        }
        for native in &runtime.native_contact_manifolds {
            let (Some(&a), Some(&b)) = (
                runtime.entities_by_body.get(&native.first.body),
                runtime.entities_by_body.get(&native.second.body),
            ) else {
                continue;
            };
            let Some(manifold) = planar_manifold(native, CollisionPair { a, b }) else {
                // Raw explicit 3D shapes can have a Z contact even with XY motion locks.
                // Do not silently turn an unrepresentable contact into a planar miss.
                runtime.last_error.record(PhysicsError::OutOfPlane.into());
                self.physics_body_manifold_scratch.clear();
                self.physics_body_contact_scratch.clear();
                return Some(0);
            };
            if manifold_output {
                self.physics_body_manifold_scratch.push(manifold);
            } else {
                let points = manifold.points();
                let x = points.iter().map(|p| p.point_x).sum::<f32>() / points.len() as f32;
                let y = points.iter().map(|p| p.point_y).sum::<f32>() / points.len() as f32;
                self.physics_body_contact_scratch.push(CollisionContact {
                    pair: manifold.pair,
                    normal_x: manifold.normal_x,
                    normal_y: manifold.normal_y,
                    penetration: manifold.penetration,
                    point_x: x,
                    point_y: y,
                });
            }
        }
        Some(if manifold_output {
            self.store_physics_body_manifolds_from_scratch()
        } else {
            self.store_physics_body_contacts_from_scratch()
        })
    }
}

fn planar_manifold(native: &NativeManifold, pair: CollisionPair) -> Option<CollisionManifold> {
    let [nx, ny, nz] = native.normal;
    let length = nx.hypot(ny);
    if length <= 1e-6 || nz.abs() > 1e-4 {
        return None;
    }
    let normal_x = nx / length;
    let normal_y = ny / length;
    // A box face has duplicate XY witnesses at its two Z faces. Retain the
    // tangent extremes, preserving the existing two-point planar ABI.
    let tangent =
        |p: &&crate::physics3d::ContactPoint| -normal_y * p.first[0] + normal_x * p.first[1];
    let compare = |a: &&crate::physics3d::ContactPoint, b: &&crate::physics3d::ContactPoint| {
        tangent(a).total_cmp(&tangent(b))
    };
    let lo = native.points.iter().min_by(compare)?;
    let hi = native.points.iter().max_by(compare)?;
    let point = |p: &crate::physics3d::ContactPoint| CollisionContactPoint {
        point_x: p.first[0],
        point_y: p.first[1],
        penetration: p.penetration,
    };
    let duplicate = (lo.first[0] - hi.first[0]).hypot(lo.first[1] - hi.first[1]) <= 1e-6;
    Some(CollisionManifold {
        pair,
        normal_x,
        normal_y,
        penetration: native
            .points
            .iter()
            .map(|p| p.penetration)
            .fold(0.0, f32::max),
        point_count: if duplicate { 1 } else { 2 },
        points: [
            point(lo),
            if duplicate {
                CollisionContactPoint {
                    point_x: 0.0,
                    point_y: 0.0,
                    penetration: 0.0,
                }
            } else {
                point(hi)
            },
        ],
    })
}

//! Cold standalone actor definitions; no live handles or pending simulation state are copied.
use super::events::collider_id;
use super::world::native_id;
use super::{
    BodyDesc, BodyId, BodyKind, CharacterConfig, ColliderDesc, PhysicsError, PhysicsWorld3d, Pose,
    QueryFilter, Shape, ShapePart,
};
use rapier3d::{parry::shape::TypedShape, prelude as rp};

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct BodyPrototype {
    pub(crate) body: BodyDesc,
    enabled: bool,
    lock_rotation: bool,
    #[serde(with = "crate::checkpoint_codec::vector")]
    colliders: Vec<(ColliderDesc, bool)>,
    character: Option<CharacterConfig>,
}

impl BodyPrototype {
    pub(crate) fn collider_count(&self) -> usize {
        self.colliders.len()
    }

    pub(crate) fn query_work(&self) -> u64 {
        fn work(shape: &Shape) -> u64 {
            match shape {
                Shape::TriangleMesh { triangles, .. } => triangles.len() as u64,
                Shape::Heightfield { rows, columns, .. } => {
                    rows.saturating_sub(1)
                        .saturating_mul(columns.saturating_sub(1))
                        .saturating_mul(2) as u64
                }
                Shape::ConvexHull { points } => points.len() as u64,
                Shape::Compound { parts } => parts.iter().map(|part| work(&part.shape)).sum(),
                _ => 64,
            }
        }
        self.colliders
            .iter()
            .map(|(collider, _)| work(&collider.shape))
            .sum::<u64>()
            .max(1)
    }
}

fn pose(value: &rp::Pose) -> Pose {
    Pose {
        position: value.translation.to_array(),
        rotation: value.rotation.to_array(),
    }
}

fn shape(value: &dyn rp::Shape) -> Result<Shape, PhysicsError> {
    Ok(match value.as_typed_shape() {
        TypedShape::Ball(ball) => Shape::Sphere {
            radius: ball.radius,
        },
        TypedShape::Cuboid(box_shape) => Shape::Box {
            half_extents: box_shape.half_extents.to_array(),
        },
        TypedShape::Capsule(capsule) => {
            // All public native capsule authoring uses the local Y axis.
            if capsule.segment.a.x != 0.
                || capsule.segment.a.z != 0.
                || capsule.segment.b.x != 0.
                || capsule.segment.b.z != 0.
                || capsule.segment.a.y != -capsule.segment.b.y
            {
                return Err(PhysicsError::UnsupportedShape);
            }
            Shape::Capsule {
                half_height: capsule.segment.a.y.abs(),
                radius: capsule.radius,
            }
        }
        TypedShape::ConvexPolyhedron(hull) => Shape::ConvexHull {
            points: hull.points().iter().map(|p| p.to_array()).collect(),
        },
        TypedShape::TriMesh(mesh) => Shape::TriangleMesh {
            vertices: mesh.vertices().iter().map(|p| p.to_array()).collect(),
            triangles: mesh.indices().to_vec(),
        },
        TypedShape::HeightField(field) => {
            let rows = field.nrows() + 1;
            let columns = field.ncols() + 1;
            let mut heights = Vec::with_capacity(rows * columns);
            for r in 0..rows {
                for c in 0..columns {
                    heights.push(field.heights()[(r, c)] * field.scale().y);
                }
            }
            Shape::Heightfield {
                rows,
                columns,
                heights,
                size: [field.scale().x, field.scale().z],
            }
        }
        TypedShape::Compound(compound) => Shape::Compound {
            parts: compound
                .shapes()
                .iter()
                .map(|(at, part)| {
                    Ok(ShapePart {
                        pose: pose(at),
                        shape: shape(part.as_ref())?,
                    })
                })
                .collect::<Result<_, PhysicsError>>()?,
        },
        _ => return Err(PhysicsError::UnsupportedShape),
    })
}

impl PhysicsWorld3d {
    pub(crate) fn body_prototype(&self, id: BodyId) -> Result<BodyPrototype, PhysicsError> {
        let body = self
            .backend
            .bodies
            .get(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        let kind = self.body_kind(id)?;
        if kind == BodyKind::Dynamic
            || self
                .joints
                .values()
                .any(|joint| joint.desc.body_a == id || joint.desc.body_b == id)
        {
            return Err(PhysicsError::WrongBodyKind);
        }
        let character = self
            .characters
            .get(&id)
            .map(|runtime| runtime.config.clone());
        let colliders = body
            .colliders()
            .iter()
            .map(|&handle| {
                let collider = self
                    .backend
                    .colliders
                    .get(handle)
                    .ok_or(PhysicsError::StaleCollider)?;
                let key = collider_id(handle);
                let groups = collider.collision_groups();
                Ok((
                    ColliderDesc {
                        shape: shape(collider.shape())?,
                        pose: pose(
                            collider
                                .position_wrt_parent()
                                .ok_or(PhysicsError::InvalidCollider)?,
                        ),
                        density: collider.density(),
                        friction: collider.friction().powi(2),
                        restitution: collider.restitution(),
                        surface_velocity: self
                            .contact_policies
                            .surfaces
                            .get(&key)
                            .copied()
                            .unwrap_or([0.; 3]),
                        contact_correction: self.contact_policies.corrections.get(&key).copied(),
                        sensor: collider.is_sensor(),
                        category: groups.memberships.bits(),
                        mask: groups.filter.bits(),
                    },
                    collider.is_enabled(),
                ))
            })
            .collect::<Result<Vec<_>, PhysicsError>>()?;
        Ok(BodyPrototype {
            body: BodyDesc {
                kind,
                pose: self.body_state(id)?.pose,
                // Character input, force/impulse queues and contact velocity are runtime state.
                linear_velocity: if character.is_some() {
                    [0.; 3]
                } else {
                    body.linvel().to_array()
                },
                angular_velocity: if character.is_some() {
                    [0.; 3]
                } else {
                    body.angvel().to_array()
                },
                gravity_scale: body.gravity_scale(),
                linear_damping: body.linear_damping(),
                angular_damping: body.angular_damping(),
                ccd: body.is_ccd_enabled(),
                can_sleep: body.activation().normalized_linear_threshold >= 0.,
            },
            enabled: body.is_enabled(),
            lock_rotation: body.locked_axes().contains(rp::LockedAxes::ROTATION_LOCKED),
            colliders,
            character,
        })
    }

    pub(crate) fn spawn_body_prototype(
        &mut self,
        prototype: &BodyPrototype,
        position: [f32; 3],
    ) -> Result<BodyId, PhysicsError> {
        if self.body_count() >= self.config.max_bodies
            || self
                .collider_count()
                .saturating_add(prototype.colliders.len())
                > self.config.max_colliders
            || (prototype.character.is_some()
                && self.characters.len() >= self.config.max_characters)
        {
            return Err(PhysicsError::CapacityExceeded);
        }
        let mut desc = prototype.body.clone();
        desc.pose.position = position;
        let options = super::BodyOptions {
            enabled: prototype.enabled,
            lock_rotation: prototype.lock_rotation,
            ..super::BodyOptions::from(&desc)
        };
        let id = self.create_body_without_collider(desc)?;
        let apply = (|| {
            self.set_body_options(id, &options)?;
            for (desc, enabled) in &prototype.colliders {
                let collider = self.add_collider(id, desc.clone())?;
                self.backend
                    .colliders
                    .get_mut(super::colliders::native_collider(collider))
                    .ok_or(PhysicsError::StaleCollider)?
                    .set_enabled(*enabled);
            }
            if let Some(config) = &prototype.character {
                self.enable_character(id, config.clone())?;
            }
            self.backend
                .bodies
                .get_mut(native_id(id))
                .ok_or(PhysicsError::StaleBody)?
                .set_enabled(prototype.enabled);
            Ok(id)
        })();
        if apply.is_err() {
            let _ = self.remove_body(id);
        }
        apply
    }

    /// Placement reads native geometry without advancing time or copying support/contact identities.
    pub(crate) fn actor_placement_blocked(
        &mut self,
        id: BodyId,
        mask: u32,
    ) -> Result<bool, PhysicsError> {
        self.refresh_queries();
        let body = self
            .backend
            .bodies
            .get(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        if !body.is_enabled() {
            return Ok(false);
        }
        let span = self.planar_collision_span(id)?;
        for &handle in body.colliders() {
            let source = &self.backend.colliders[handle];
            if source.is_sensor() || !source.is_enabled() {
                continue;
            }
            let groups = source.collision_groups();
            let filter = QueryFilter {
                category: groups.memberships.bits(),
                mask: groups.filter.bits() & mask,
                exclude_body: Some(id),
                ..Default::default()
            };
            let enabled = |_, target: &rp::Collider| {
                target.is_enabled()
                    && target.collision_groups().memberships.bits() & filter.mask != 0
                    && self
                        .contact_policies
                        .pair_span_allows(span, target.parent())
                    && target.parent().is_none_or(|parent| {
                        self.backend
                            .bodies
                            .get(parent)
                            .is_some_and(|body| body.is_enabled())
                    })
            };
            let pipeline = self
                .backend
                .query_pipeline_with_filter(self.query_filter(&filter)?.predicate(&enabled));
            for (_, target) in pipeline.intersect_aabb_conservative(source.compute_aabb()) {
                let contact = rapier3d::parry::query::contact(
                    source.position(),
                    source.shape(),
                    target.position(),
                    target.shape(),
                    0.,
                )
                .map_err(|_| PhysicsError::UnsupportedShape)?;
                if contact.is_some_and(|contact| contact.dist < -1e-5 * self.config.length_unit) {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefab_controller_cold_descriptors_roundtrip_every_authored_shape_and_material() {
        let points = vec![
            [-1., -1., -1.],
            [1., -1., -1.],
            [-1., 1., -1.],
            [-1., -1., 1.],
            [1., 1., 1.],
        ];
        let shapes = vec![
            Shape::Box {
                half_extents: [1., 2., 3.],
            },
            Shape::Sphere { radius: 0.5 },
            Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            },
            Shape::ConvexHull { points },
            Shape::TriangleMesh {
                vertices: vec![[0., 0., 0.], [1., 0., 0.], [0., 0., 1.]],
                triangles: vec![[0, 2, 1]],
            },
            Shape::Heightfield {
                rows: 2,
                columns: 3,
                heights: vec![0., 1., 0., 2., 0., 1.],
                size: [4., 2.],
            },
            Shape::Compound {
                parts: vec![
                    ShapePart {
                        pose: Pose {
                            position: [1., 2., 3.],
                            ..Default::default()
                        },
                        shape: Shape::Sphere { radius: 0.5 },
                    },
                    ShapePart {
                        pose: Pose::default(),
                        shape: Shape::Box {
                            half_extents: [0.5; 3],
                        },
                    },
                ],
            },
        ];
        for shape in shapes {
            let mut world = PhysicsWorld3d::new(super::super::WorldConfig::default()).unwrap();
            let mut collider = ColliderDesc::new(shape);
            collider.pose.position = [0.1, 0.2, 0.3];
            collider.friction = 0.36;
            collider.restitution = 0.4;
            collider.surface_velocity = [1., 0., 0.];
            collider.category = 16;
            collider.mask = 31;
            collider.contact_correction = Some(super::super::ContactCorrection {
                velocity_rate: 0.1,
                max_velocity: 2.,
                position_rate: 0.2,
                position_slop: 0.01,
                velocity_slop: 0.02,
                split_impulse: false,
            });
            let source = world
                .create_body(
                    BodyDesc {
                        kind: BodyKind::KinematicVelocity,
                        linear_velocity: [1., 2., 3.],
                        linear_damping: 0.2,
                        angular_damping: 0.3,
                        gravity_scale: 2.,
                        ccd: true,
                        can_sleep: false,
                        ..Default::default()
                    },
                    collider,
                )
                .unwrap();
            let mut captured = world.body_prototype(source).unwrap();
            let child = world
                .spawn_body_prototype(&captured, [10., 20., 30.])
                .unwrap();
            captured.body.pose.position = [10., 20., 30.];
            assert_eq!(world.body_prototype(child).unwrap(), captured);
            world.remove_body(source).unwrap();
            world.remove_body(child).unwrap();
            assert_eq!(world.body_count(), 0);
            assert_eq!(world.collider_count(), 0);
            let fresh = world.spawn_body_prototype(&captured, [0.; 3]).unwrap();
            assert_eq!(world.collider_ids(fresh).unwrap().count(), 1);
        }
    }
}

#[allow(dead_code)]
mod file_admission;

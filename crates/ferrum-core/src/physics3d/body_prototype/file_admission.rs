//! Owned prefab geometry is inspected without building native shapes. A compound
//! has only convex leaves, so malformed nested trees are rejected at the edge.
use super::*;
use crate::gameplay::file_admission::{require, Budget, Error, Problem};
fn finite(v: &[f32]) -> bool {
    v.iter().all(|v| v.is_finite())
}
fn pose(v: Pose) -> bool {
    finite(&v.position)
        && finite(&v.rotation)
        && (v
            .rotation
            .iter()
            .map(|v| f64::from(*v).powi(2))
            .sum::<f64>()
            - 1.)
            .abs()
            <= 1e-5
}
fn point(v: &[f32; 3], space: super::super::Space) -> bool {
    v.iter().enumerate().all(|(i, v)| {
        v.is_finite()
            && v.abs()
                <= if i == 2 && space == super::super::Space::PlanarXy {
                    30000.
                } else {
                    10000.
                }
    })
}
fn hull_rank(points: &[[f32; 3]]) -> bool {
    // Affine-rank check only: point-cloud order/interior points are not normalized.
    let first = points[0].map(f64::from);
    let delta = |p: [f32; 3]| {
        [
            f64::from(p[0]) - first[0],
            f64::from(p[1]) - first[1],
            f64::from(p[2]) - first[2],
        ]
    };
    let mut axis = None;
    for &p in &points[1..] {
        let v = delta(p);
        if v.iter().any(|v| *v != 0.) {
            axis = Some(v);
            break;
        }
    }
    let Some(a) = axis else {
        return false;
    };
    let mut normal = None;
    for &p in &points[1..] {
        let v = delta(p);
        let n = [
            a[1] * v[2] - a[2] * v[1],
            a[2] * v[0] - a[0] * v[2],
            a[0] * v[1] - a[1] * v[0],
        ];
        if n.iter().any(|v| *v != 0.) {
            normal = Some(n);
            break;
        }
    }
    let Some(n) = normal else {
        return false;
    };
    points[1..].iter().any(|p| {
        let v = delta(*p);
        n[0] * v[0] + n[1] * v[1] + n[2] * v[2] != 0.
    })
}
fn leaf(shape: &Shape, space: super::super::Space, b: &mut Budget) -> Result<u64, Error> {
    b.work(16)?;
    let invalid = |field| Error::Invalid {
        owner: "body_prototype",
        field,
        index: 0,
        problem: Problem::Number,
    };
    match shape {
        Shape::Box { half_extents } => {
            require(
                super::super::geometry::valid_box_extents(*half_extents, space, 0.0001),
                "body_prototype",
                "box",
                0,
                Problem::Number,
            )?;
            Ok(64)
        }
        Shape::Sphere { radius } => {
            require(
                super::super::geometry::positive(*radius),
                "body_prototype",
                "sphere",
                0,
                Problem::Number,
            )?;
            Ok(64)
        }
        Shape::Capsule {
            half_height,
            radius,
        } => {
            require(
                half_height.is_finite()
                    && (0.0..=10000.).contains(half_height)
                    && super::super::geometry::positive(*radius),
                "body_prototype",
                "capsule",
                0,
                Problem::Number,
            )?;
            Ok(64)
        }
        Shape::ConvexHull { points } => {
            b.vector(points)?;
            require(
                (4..=256).contains(&points.len()),
                "body_prototype",
                "hull_count",
                0,
                Problem::Length,
            )?;
            b.product(points.len(), 32)?;
            require(
                points.iter().all(|p| point(p, space)) && hull_rank(points),
                "body_prototype",
                "hull",
                0,
                Problem::Number,
            )?;
            Ok(points.len() as u64)
        }
        Shape::TriangleMesh {
            vertices,
            triangles,
        } => {
            b.vector(vertices)?;
            b.vector(triangles)?;
            require(
                (3..=65536).contains(&vertices.len()) && (1..=131072).contains(&triangles.len()),
                "body_prototype",
                "mesh_count",
                0,
                Problem::Length,
            )?;
            b.product(vertices.len(), 8)?;
            b.product(triangles.len(), 64)?;
            require(
                vertices
                    .iter()
                    .all(|p| point(p, super::super::Space::Spatial)),
                "body_prototype",
                "vertices",
                0,
                Problem::Number,
            )?;
            for (i, indices) in triangles.iter().enumerate() {
                let [a, c, d] = *indices;
                let [Some(a), Some(c), Some(d)] = [
                    vertices.get(a as usize),
                    vertices.get(c as usize),
                    vertices.get(d as usize),
                ] else {
                    return Err(Error::Invalid {
                        owner: "body_prototype",
                        field: "triangle_index",
                        index: i,
                        problem: Problem::Reference,
                    });
                };
                let ab = rp::Vector::from(*c) - rp::Vector::from(*a);
                let ac = rp::Vector::from(*d) - rp::Vector::from(*a);
                require(
                    ab.cross(ac).length_squared() > 1e-16,
                    "body_prototype",
                    "triangle",
                    i,
                    Problem::Number,
                )?;
            }
            Ok(triangles.len() as u64)
        }
        Shape::Heightfield {
            rows,
            columns,
            heights,
            size,
        } => {
            b.vector(heights)?;
            require(
                *rows >= 2
                    && *columns >= 2
                    && rows.checked_mul(*columns) == Some(heights.len())
                    && heights.len() <= 65536,
                "body_prototype",
                "heightfield_count",
                0,
                Problem::Length,
            )?;
            b.product(heights.len(), 8)?;
            require(
                heights.iter().all(|v| v.is_finite() && v.abs() <= 10000.)
                    && size.iter().copied().all(super::super::geometry::positive),
                "body_prototype",
                "heightfield",
                0,
                Problem::Number,
            )?;
            let work = (rows - 1)
                .checked_mul(columns - 1)
                .and_then(|n| n.checked_mul(2))
                .ok_or_else(|| invalid("heightfield_work"))?;
            Ok(work as u64)
        }
        Shape::Compound { .. } => Err(Error::Invalid {
            owner: "body_prototype",
            field: "nested_compound",
            index: 0,
            problem: Problem::Layout,
        }),
    }
}
fn shape(shape: &Shape, space: super::super::Space, b: &mut Budget) -> Result<u64, Error> {
    if let Shape::Compound { parts } = shape {
        b.vector(parts)?;
        require(
            (1..=64).contains(&parts.len()),
            "body_prototype",
            "parts",
            0,
            Problem::Length,
        )?;
        b.product(parts.len(), 32)?;
        let mut work = 0u64;
        for (i, p) in parts.iter().enumerate() {
            require(
                super::super::geometry::is_convex(&p.shape)
                    && pose(p.pose)
                    && super::super::types::validate_plane(space, p.pose, [0.; 3], [0.; 3]).is_ok(),
                "body_prototype",
                "part",
                i,
                Problem::Layout,
            )?;
            work = work
                .checked_add(leaf(&p.shape, space, b)?)
                .ok_or(Error::WorkLimit)?;
        }
        Ok(work)
    } else {
        leaf(shape, space, b)
    }
}
impl BodyPrototype {
    /// Returns the exact stored-definition work scalar used by prefab admission.
    /// Body pose/velocity are captured simulation history: input-only magnitude
    /// clamps are not reapplied. No collider/World is constructed or repaired.
    pub(crate) fn validate_file_definition(
        &self,
        space: super::super::Space,
        b: &mut Budget,
    ) -> Result<u64, Error> {
        let Self {
            body: _,
            enabled: _,
            lock_rotation: _,
            colliders: _,
            character: _,
        } = self;
        b.work(5)?;
        let d = &self.body;
        Self::validate_file_body_desc(d, space, b)?;
        require(
            d.kind != BodyKind::Dynamic,
            "body_prototype",
            "captured_kind",
            0,
            Problem::Layout,
        )?;
        b.vector(&self.colliders)?;
        let mut work = 0u64;
        let mut solid = None;
        for (i, (c, _enabled)) in self.colliders.iter().enumerate() {
            work = work
                .checked_add(Self::validate_file_collider_desc(c, space, b)?)
                .ok_or(Error::WorkLimit)?;
            if self.character.is_some() && !c.sensor {
                require(
                    solid.is_none(),
                    "body_prototype",
                    "character_solids",
                    i,
                    Problem::Reference,
                )?;
                solid = Some(c);
            }
        }
        if let Some(config) = &self.character {
            b.work(128)?;
            require(
                config.validate(space).is_ok() && d.kind == BodyKind::KinematicPosition,
                "body_prototype",
                "character_config",
                0,
                Problem::Layout,
            )?;
            let Some(c) = solid else {
                return Err(Error::Invalid {
                    owner: "body_prototype",
                    field: "character_capsule",
                    index: 0,
                    problem: Problem::Reference,
                });
            };
            require(
                matches!(c.shape,Shape::Capsule{radius,..}if config.skin_width<radius*0.5),
                "body_prototype",
                "character_capsule",
                0,
                Problem::Layout,
            )?;
            let at =
                super::super::world::native_pose(d.pose) * super::super::world::native_pose(c.pose);
            require(
                (at.rotation * rp::Vector::Y).dot(config.up.into()).abs() >= 1. - 1e-5,
                "body_prototype",
                "character_up",
                0,
                Problem::Number,
            )?;
        }
        Ok(work.max(1))
    }
}

impl BodyPrototype {
    /// Stored descriptor projection. It does not construct a native body and does
    /// not reapply input-only pose/velocity magnitude clamps to captured history.
    pub(crate) fn validate_file_body_desc(
        d: &BodyDesc,
        space: super::super::Space,
        b: &mut Budget,
    ) -> Result<(), Error> {
        b.work(64)?;
        require(
            pose(d.pose)
                && finite(&d.linear_velocity)
                && finite(&d.angular_velocity)
                && d.gravity_scale.is_finite()
                && d.gravity_scale.abs() <= 1000.
                && [d.linear_damping, d.angular_damping]
                    .iter()
                    .all(|v| v.is_finite() && (0.0..=10000.).contains(v))
                && super::super::types::validate_plane(
                    space,
                    d.pose,
                    d.linear_velocity,
                    d.angular_velocity,
                )
                .is_ok(),
            "body_descriptor",
            "numeric",
            0,
            Problem::Number,
        )
    }
    pub(crate) fn validate_file_collider_desc(
        c: &ColliderDesc,
        space: super::super::Space,
        b: &mut Budget,
    ) -> Result<u64, Error> {
        b.work(64)?;
        require(
            pose(c.pose)
                && c.density.is_finite()
                && (0.0..=10000.).contains(&c.density)
                && c.friction.is_finite()
                && (0.0..=10.).contains(&c.friction)
                && c.restitution.is_finite()
                && (0.0..=1.).contains(&c.restitution)
                && finite(&c.surface_velocity)
                && c.contact_correction.is_none_or(|v| v.validate().is_ok())
                && super::super::types::validate_plane(space, c.pose, c.surface_velocity, [0.; 3])
                    .is_ok(),
            "collider_descriptor",
            "numeric",
            0,
            Problem::Number,
        )?;
        shape(&c.shape, space, b)
    }
    pub(crate) fn validate_file_shape(
        value: &Shape,
        space: super::super::Space,
        b: &mut Budget,
    ) -> Result<u64, Error> {
        shape(value, space, b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::file_admission::{Limits, Usage};
    use crate::physics3d::{Space, WorldConfig};
    fn limits() -> Limits {
        Limits {
            max_work: 50_000_000,
            max_scratch_bytes: 1_000_000,
        }
    }
    fn world() -> PhysicsWorld3d {
        PhysicsWorld3d::new(WorldConfig {
            space: Space::Spatial,
            gravity: [0.; 3],
            step_seconds: 0.01,
            ..WorldConfig::default()
        })
        .unwrap()
    }
    fn bytes(p: &BodyPrototype) -> Vec<u8> {
        crate::checkpoint_codec::encode(p).unwrap()
    }
    fn check(p: &BodyPrototype) -> (u64, Usage) {
        let old = bytes(p);
        let mut b = Budget::new(limits());
        let work = p.validate_file_definition(Space::Spatial, &mut b).unwrap();
        assert_eq!(work, p.query_work());
        assert_eq!(bytes(p), old);
        let d: BodyPrototype = crate::checkpoint_codec::decode(&old).unwrap();
        let mut b2 = Budget::new(limits());
        assert_eq!(
            d.validate_file_definition(Space::Spatial, &mut b2).unwrap(),
            work
        );
        assert_eq!(bytes(&d), old);
        (work, b.usage())
    }
    fn fixtures() -> Vec<Shape> {
        vec![
            Shape::Box {
                half_extents: [0.5; 3],
            },
            Shape::Sphere { radius: 0.5 },
            Shape::Capsule {
                half_height: 0.5,
                radius: 0.2,
            },
            Shape::ConvexHull {
                points: vec![[0., 0., 0.], [1., 0., 0.], [0., 1., 0.], [0., 0., 1.]],
            },
            Shape::TriangleMesh {
                vertices: vec![[0., 0., 0.], [1., 0., 0.], [0., 0., 1.]],
                triangles: vec![[0, 1, 2]],
            },
            Shape::Heightfield {
                rows: 2,
                columns: 2,
                heights: vec![0.; 4],
                size: [10., 10.],
            },
            Shape::Compound {
                parts: vec![
                    ShapePart {
                        pose: Pose::default(),
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
        ]
    }
    #[test]
    fn file_gameplay_descriptor_all_native_public_shapes_codec_and_original_query_work() {
        for shape in fixtures() {
            let mut w = world();
            let id = w
                .create_body(
                    BodyDesc {
                        kind: BodyKind::Fixed,
                        ..BodyDesc::default()
                    },
                    ColliderDesc::new(shape),
                )
                .unwrap();
            let p = w.body_prototype(id).unwrap();
            check(&p);
        }
    }
    #[test]
    fn file_gameplay_descriptor_real_kinematic_capture_exceeds_input_velocity_clamp() {
        let mut w = world();
        let id = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            )
            .unwrap();
        w.set_kinematic_target(
            id,
            Pose {
                position: [1_000_000., 0., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
        w.step();
        let p = w.body_prototype(id).unwrap();
        assert!(p.body.linear_velocity[0] > 1_000_000.);
        check(&p);
    }
    #[test]
    fn file_gameplay_descriptor_actual_character_capsule_and_sensor_history() {
        let mut w = world();
        let id = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.5,
                    radius: 0.2,
                }),
            )
            .unwrap();
        w.enable_character(id, CharacterConfig::default()).unwrap();
        w.add_collider(
            id,
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
            },
        )
        .unwrap();
        let p = w.body_prototype(id).unwrap();
        assert_eq!(p.colliders.len(), 2);
        check(&p);
    }
    #[test]
    fn file_gameplay_descriptor_valid_crc_private_payload_and_nested_shape_reject() {
        let mut w = world();
        let id = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            )
            .unwrap();
        let old = w.body_prototype(id).unwrap();
        let original = bytes(&old);
        for case in 0..5 {
            let mut p = old.clone();
            match case {
                0 => p.body.pose.rotation = [0.; 4],
                1 => p.colliders[0].0.friction = f32::NAN,
                2 => {
                    p.colliders[0].0.shape = Shape::TriangleMesh {
                        vertices: vec![[0.; 3]; 3],
                        triangles: vec![[0, 1, 9]],
                    }
                }
                3 => {
                    p.colliders[0].0.shape = Shape::Compound {
                        parts: vec![ShapePart {
                            pose: Pose::default(),
                            shape: Shape::Compound { parts: vec![] },
                        }],
                    }
                }
                _ => p.body.kind = BodyKind::Dynamic,
            }
            let bad = bytes(&p);
            let d: BodyPrototype = crate::checkpoint_codec::decode(&bad).unwrap();
            assert!(
                matches!(
                    d.validate_file_definition(Space::Spatial, &mut Budget::new(limits())),
                    Err(Error::Invalid { .. })
                ),
                "case {case}"
            );
            assert_eq!(bytes(&d), bad);
            assert_eq!(bytes(&old), original);
        }
    }
    #[test]
    fn file_gameplay_descriptor_exact_one_below_work_and_dynamic_creation_header() {
        let mut w = world();
        let id = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(fixtures().pop().unwrap()),
            )
            .unwrap();
        let p = w.body_prototype(id).unwrap();
        let (work, u) = check(&p);
        let mut exact = Budget::new(Limits {
            max_work: u.work,
            max_scratch_bytes: u.scratch_bytes,
        });
        assert_eq!(
            p.validate_file_definition(Space::Spatial, &mut exact),
            Ok(work)
        );
        assert_eq!(
            p.validate_file_definition(
                Space::Spatial,
                &mut Budget::new(Limits {
                    max_work: u.work - 1,
                    max_scratch_bytes: 0
                })
            ),
            Err(Error::WorkLimit)
        );
        assert!(BodyPrototype::validate_file_body_desc(
            &BodyDesc::default(),
            Space::Spatial,
            &mut Budget::new(limits())
        )
        .is_ok());
    }
}

use super::native_id;
use crate::physics3d::events::collider_id;
use crate::physics3d::{
    BodyDesc, BodyId, BodyKind, ColliderDesc, ColliderId, PhysicsWorld3d, Pose, Shape, WorldConfig,
};
use rapier3d::parry::{bounding_volume::BoundingVolume, query::contact};
use rapier3d::prelude as rp;

#[derive(Clone, Copy, Debug)]
pub(crate) struct OverlapBody {
    pub id: BodyId,
    pub collider: ColliderId,
    pub kind: rp::RigidBodyType,
    pub shape: rapier3d::parry::shape::ShapeType,
    pub position: [f32; 3],
    pub velocity: [f32; 3],
    pub angular: [f32; 3],
    pub ccd_active: bool,
    pub ccd_thickness: f32,
}

#[derive(Clone, Copy)]
pub(crate) struct OverlapSample {
    pub bodies: [OverlapBody; 2],
    pub depth: f32,
    pub normal: [f32; 3],
    pub solver_allowed: bool,
    pub solver_depth: Option<f32>,
}

impl PhysicsWorld3d {
    pub(crate) fn p2a_set_soft_ccd_fraction(&mut self, fraction: f32) {
        let colliders = &self.backend.colliders;
        for (_, body) in self
            .backend
            .bodies
            .iter_mut()
            .filter(|(_, body)| body.is_dynamic())
        {
            let thickness = body
                .colliders()
                .iter()
                .filter_map(|&id| {
                    colliders
                        .get(id)
                        .filter(|c| c.is_enabled() && !c.is_sensor())
                        .map(|c| c.shape().ccd_thickness())
                })
                .reduce(f32::min)
                .unwrap_or(0.);
            body.set_soft_ccd_prediction(fraction * thickness);
        }
    }

    pub(crate) fn p1a_uses_motion_proof(&self) -> bool {
        self.backend_motion_enabled()
    }

    pub(crate) fn p1a_integration_settings(&self) -> (f32, f32, f32, f32, usize, f32) {
        let p = &self.backend.integration_parameters;
        (
            p.length_unit,
            p.allowed_linear_error(),
            p.prediction_distance(),
            p.min_ccd_dt,
            p.max_ccd_substeps,
            p.static_contact_softness.natural_frequency,
        )
    }

    pub(crate) fn p1a_max_overlap(&self) -> f32 {
        let mut depth = 0.0_f32;
        self.p1a_visit_overlaps(|sample| depth = depth.max(sample.depth));
        depth
    }

    pub(crate) fn p1a_visit_overlaps(&self, mut visit: impl FnMut(OverlapSample)) {
        use rp::PhysicsHooks as _;
        let colliders: Vec<_> = self
            .backend
            .colliders
            .iter()
            .filter(|(_, c)| c.is_enabled() && !c.is_sensor())
            .filter_map(|(handle, c)| Some((c.parent()?, handle, c, c.compute_aabb())))
            .collect();
        for (index, &(a_body, a_handle, a, aabb)) in colliders.iter().enumerate() {
            for &(b_body, b_handle, b, bb) in &colliders[index + 1..] {
                if a_body == b_body
                    || !aabb.intersects(&bb)
                    || !a.collision_groups().test(b.collision_groups())
                    || !a.solver_groups().test(b.solver_groups())
                    || !(self.backend.bodies[a_body].is_dynamic()
                        || self.backend.bodies[b_body].is_dynamic())
                    || self
                        .backend
                        .impulse_joints
                        .joints_between(a_body, b_body)
                        .any(|(_, joint)| joint.data.is_enabled() && !joint.data.contacts_enabled())
                {
                    continue;
                }
                let contact = contact(a.position(), a.shape(), b.position(), b.shape(), 0.)
                    .expect("all P1a solid shape pairs must be measurable");
                let Some(contact) = contact else { continue };
                assert!(contact.dist.is_finite());
                if contact.dist >= 0. {
                    continue;
                }
                let a_native = &self.backend.bodies[a_body];
                let b_native = &self.backend.bodies[b_body];
                let (a_kind, b_kind) = (a_native.body_type(), b_native.body_type());
                let solver_allowed = a_native.is_enabled()
                    && b_native.is_enabled()
                    && (a.active_collision_types().test(a_kind, b_kind)
                        || b.active_collision_types().test(a_kind, b_kind))
                    && (!(a.active_hooks() | b.active_hooks())
                        .contains(rp::ActiveHooks::FILTER_CONTACT_PAIRS)
                        || self
                            .contact_policies
                            .filter_contact_pair(&rp::PairFilterContext {
                                bodies: &self.backend.bodies,
                                colliders: &self.backend.colliders,
                                rigid_body1: Some(a_body),
                                rigid_body2: Some(b_body),
                                collider1: a_handle,
                                collider2: b_handle,
                            })
                            .is_some_and(|f| f.contains(rp::SolverFlags::COMPUTE_RIGID_IMPULSES)));
                let solver_depth = self
                    .backend
                    .narrow_phase
                    .contact_pair(a_handle, b_handle)
                    .into_iter()
                    .flat_map(|pair| pair.manifolds())
                    .filter(|m| {
                        m.data
                            .solver_flags
                            .contains(rp::SolverFlags::COMPUTE_RIGID_IMPULSES)
                    })
                    .flat_map(|m| &m.data.solver_contacts)
                    .map(|p| -p.dist)
                    .reduce(f32::max);
                let describe =
                    |body: &rp::RigidBody, id: rp::RigidBodyHandle, h, c: &rp::Collider| {
                        let (slot, generation) = id.into_raw_parts();
                        OverlapBody {
                            id: BodyId { slot, generation },
                            collider: collider_id(h),
                            kind: body.body_type(),
                            shape: c.shape().shape_type(),
                            position: body.translation().to_array(),
                            velocity: body.linvel().to_array(),
                            angular: body.angvel().to_array(),
                            ccd_active: body.is_ccd_active(),
                            ccd_thickness: c.shape().ccd_thickness(),
                        }
                    };
                visit(OverlapSample {
                    bodies: [
                        describe(a_native, a_body, a_handle, a),
                        describe(b_native, b_body, b_handle, b),
                    ],
                    depth: -contact.dist,
                    normal: contact.normal1.to_array(),
                    solver_allowed,
                    solver_depth,
                });
            }
        }
    }

    pub(crate) fn p1a_stack_is_supported(&self, floor: BodyId, blocks: &[BodyId]) -> bool {
        let collider = |body| {
            let [handle] = self.backend.bodies[native_id(body)].colliders() else {
                panic!("each stack body must have exactly one collider");
            };
            &self.backend.colliders[*handle]
        };
        let prediction = self.backend.integration_parameters.prediction_distance();
        std::iter::once(floor)
            .chain(blocks.iter().copied())
            .zip(blocks.iter().copied())
            .all(|(lower, upper)| {
                let lower = collider(lower);
                let upper = collider(upper);
                let local_center = lower
                    .position()
                    .inverse_transform_point(upper.position().translation);
                let half = lower.shape().as_cuboid().unwrap().half_extents;
                local_center.y > 0.
                    && local_center.x.abs() <= half.x
                    && local_center.z.abs() <= half.z
                    && contact(
                        lower.position(),
                        lower.shape(),
                        upper.position(),
                        upper.shape(),
                        prediction,
                    )
                    .unwrap()
                    .is_some_and(|c| c.normal1.y > c.normal1.x.hypot(c.normal1.z))
            })
    }
}

#[test]
fn rigid_step_respects_continuous_ccd_without_motion_proof() {
    for (continuous, ccd) in [(true, true), (false, true), (true, false)] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let mut solver = world.config().solver;
        solver.continuous = continuous;
        world.set_runtime_settings([0.; 3], solver).unwrap();
        let wall = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.05, 10., 10.],
                }),
            )
            .unwrap();
        let ball = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Dynamic,
                    pose: Pose {
                        position: [-2., 0., 0.],
                        ..Pose::default()
                    },
                    linear_velocity: [300., 0., 0.],
                    ccd,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            )
            .unwrap();
        assert!(!world.backend_motion_enabled());
        world.step_checked().unwrap();
        let x = world.body_state(ball).unwrap().pose.position[0];
        println!(
            "P1A_CCD continuous={continuous} body_ccd={ccd} x={x} clamps={} checks={}",
            world.ccd_clamps().len(),
            world.step_statistics().ccd_clamp_checks
        );
        // The vendor's default tier sweeps any fast dynamic body against fixed terrain.
        // The per-body CCD flag also enables the bullet tier against moving targets.
        if continuous {
            assert_eq!(world.step_statistics().ccd_substeps, 1);
            assert!(world.step_statistics().ccd_clamp_checks > 0);
            assert_eq!(world.ccd_clamps().len(), 1);
            assert_eq!(world.ccd_clamps()[0].moving.body, ball);
            assert_eq!(world.ccd_clamps()[0].target.body, wall);
            assert!(x < -0.5, "CCD should stop the ball before the wall, x={x}");
        } else {
            assert!(world.ccd_clamps().is_empty());
            assert!(x > 0.55, "the control must pass through the wall, x={x}");
        }
        world.set_step_motion_enabled(true);
        assert!(world.backend_motion_enabled());
    }
}

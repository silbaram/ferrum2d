use crate::physics3d::{
    BodyDesc, BodyKind, ColliderDesc, PhysicsWorld3d, Pose, Shape, WorldConfig,
};
use rapier3d::parry::{bounding_volume::BoundingVolume, query::contact};

impl PhysicsWorld3d {
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
        let colliders: Vec<_> = self
            .backend
            .colliders
            .iter()
            .filter(|(_, c)| c.is_enabled() && !c.is_sensor())
            .filter_map(|(_, c)| Some((c.parent()?, c, c.compute_aabb())))
            .collect();
        let mut depth = 0.0_f32;
        for (index, &(a_body, a, aabb)) in colliders.iter().enumerate() {
            for &(b_body, b, bb) in &colliders[index + 1..] {
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
                if let Some(contact) = contact {
                    assert!(contact.dist.is_finite());
                    depth = depth.max(-contact.dist);
                }
            }
        }
        depth
    }
}

#[test]
fn p1a_unproved_rigid_step_respects_continuous_ccd() {
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
        assert_eq!(world.backend_motion_enabled(), continuous);
        world.enable_experimental_rigid_rapier_ccd();
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

use super::*;

fn unchecked_snapshot(world: &PhysicsWorld3d, envelope: &PhysicsSnapshot) -> PhysicsSnapshot {
    // Valid envelope, checksum and build: rejection must come from numerical
    // admission of the decoded candidate, rather than an envelope shortcut.
    let payload = postcard::to_allocvec(&Capture { world }).unwrap();
    let mut snapshot = envelope.clone();
    snapshot.bytes.truncate(HEADER);
    snapshot.bytes.extend_from_slice(&payload);
    snapshot.bytes[20..24].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    snapshot.bytes[24..28].copy_from_slice(&crc(&payload).to_le_bytes());
    assert!(snapshot.payload().is_ok());
    snapshot
}

fn invalid_parameters(
    base: rp::IntegrationParameters,
) -> Vec<(&'static str, rp::IntegrationParameters)> {
    let mut cases = Vec::new();
    macro_rules! change {
        ($name:literal, $($field:ident).+, $value:expr) => {{
            let mut changed = base;
            changed.$($field).+ = $value;
            cases.push(($name, changed));
        }};
    }
    change!("unbounded substeps", num_solver_iterations, usize::MAX);
    change!("zero solver substeps", num_solver_iterations, 0);
    change!("transient one-pass solver", num_solver_iterations, 1);
    change!("unbounded PGS", num_internal_pgs_iterations, usize::MAX);
    change!("PGS outside config range", num_internal_pgs_iterations, 33);
    change!(
        "valid PGS inconsistent with config",
        num_internal_pgs_iterations,
        2
    );
    change!(
        "unbounded stabilization",
        num_internal_stabilization_iterations,
        usize::MAX
    );
    change!(
        "valid stabilization inconsistent with config",
        num_internal_stabilization_iterations,
        2
    );
    change!("unbounded CCD", max_ccd_substeps, usize::MAX);
    change!("CCD above cold work cap", max_ccd_substeps, 33);
    change!("CCD inconsistent with enabled config", max_ccd_substeps, 0);
    change!("non-finite dt", dt, f32::NAN);
    change!("zero dt", dt, 0.0);
    change!("finite dt inconsistent with config", dt, 0.02);
    change!("non-finite length", length_unit, f32::INFINITY);
    change!("finite length inconsistent with config", length_unit, 2.0);
    change!(
        "non-finite threshold",
        restitution_velocity_threshold,
        f32::NAN
    );
    change!(
        "finite threshold inconsistent with config",
        restitution_velocity_threshold,
        1.0
    );
    change!("non-finite CCD minimum", min_ccd_dt, f32::NAN);
    change!("unsupported finite CCD minimum", min_ccd_dt, 0.0);
    change!(
        "non-finite dynamic softness",
        contact_softness.natural_frequency,
        f32::INFINITY
    );
    change!(
        "finite dynamic softness outside Ferrum producer",
        contact_softness.damping_ratio,
        11.0
    );
    change!(
        "non-finite static softness",
        static_contact_softness.damping_ratio,
        f32::NAN
    );
    change!(
        "missing Ferrum static softness override",
        static_contact_softness.natural_frequency,
        60.0
    );
    change!("non-finite warmstart", warmstart_coefficient, f32::NAN);
    change!("negative warmstart", warmstart_coefficient, -0.01);
    change!("overshooting warmstart", warmstart_coefficient, 1.01);
    change!("non-finite slop", normalized_allowed_linear_error, f32::NAN);
    change!(
        "non-finite correction cap",
        normalized_max_corrective_velocity,
        f32::INFINITY
    );
    change!(
        "non-finite prediction",
        normalized_prediction_distance,
        f32::NAN
    );
    change!(
        "non-finite speed cap",
        normalized_max_linear_velocity,
        f32::INFINITY
    );
    change!(
        "non-finite recycling",
        normalized_contact_recycle_distance,
        f32::NAN
    );
    change!("unsupported clustering policy", contact_clustering, false);
    change!("unsupported recycling policy", contact_recycling, false);
    change!("unsupported bias friction", friction_in_bias_pass, true);
    change!("unsupported joint warmstart", warmstart_joints, true);
    change!(
        "unused soft non-finite payload",
        soft_bodies.contact_stiffening,
        f32::NAN
    );
    change!(
        "unused soft iteration budget",
        soft_bodies.max_extra_substeps,
        usize::MAX
    );
    change!(
        "unused soft non-default strain",
        soft_bodies.resweep_strain,
        0.5
    );
    change!(
        "unused recovery non-finite payload",
        soft_bodies.recovery.recovery_pace,
        f32::NAN
    );
    change!(
        "unused recovery subdivision budget",
        soft_bodies.recovery.overlap_split,
        u32::MAX
    );
    change!(
        "unused recovery policy",
        soft_bodies.recovery.authored_velocity_margin,
        false
    );
    cases
}

#[test]
fn native_snapshot_integration_rejects_invalid_actual_parameters_before_commit() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let create = || {
            PhysicsWorld3d::new(WorldConfig {
                space,
                gravity: [0.; 3],
                ..WorldConfig::default()
            })
            .unwrap()
        };
        let mut source = create();
        cube(&mut source, BodyKind::Dynamic, [0.; 3]);
        let base = source.backend.integration_parameters;
        let mut live = create();
        let kinematic = cube(&mut live, BodyKind::KinematicPosition, [0.; 3]);
        live.set_kinematic_target(
            kinematic,
            Pose {
                position: [1., 0., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
        let before = live.capture_snapshot().unwrap();
        let cases = invalid_parameters(base);
        assert_eq!(cases.len(), 42);
        for (name, params) in cases {
            source.backend.integration_parameters = params;
            let source_before = postcard::to_allocvec(&Capture { world: &source }).unwrap();
            assert_eq!(
                source.capture_snapshot().unwrap_err(),
                PhysicsSnapshotError::InvalidState,
                "{space:?}: {name}"
            );
            assert_eq!(
                postcard::to_allocvec(&Capture { world: &source }).unwrap(),
                source_before,
                "capture repaired {name}"
            );
            let invalid = unchecked_snapshot(&source, &before);
            assert_eq!(
                live.restore_snapshot(&invalid),
                Err(PhysicsSnapshotError::InvalidState),
                "{space:?}: {name}"
            );
            assert_eq!(
                live.capture_snapshot().unwrap().encoded_bytes(),
                before.encoded_bytes(),
                "failed restore changed live state: {name}"
            );
        }
        live.step();
        assert_eq!(live.body_state(kinematic).unwrap().pose.position[0], 1.0);
    }
}

#[test]
fn native_snapshot_integration_rejects_before_any_reference_work() {
    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    world.backend.integration_parameters.num_solver_iterations = usize::MAX;
    assert_eq!(
        world.validate_snapshot_state_with_reference_limits(rp::StoredReferenceLimits {
            max_work: 0,
            max_scratch_bytes: 0,
        }),
        Err(PhysicsSnapshotError::InvalidState)
    );
}

#[test]
fn native_snapshot_integration_preserves_clock_solver_and_native_tuning_roundtrips() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for continuous in [false, true] {
            for ccd in if continuous {
                &[1, 4, 32][..]
            } else {
                &[0][..]
            } {
                for warmstart in [-0.0_f32, 0.5, 1.0] {
                    for friction in [rp::FrictionModel::Simplified, rp::FrictionModel::Coulomb] {
                        let mut world = PhysicsWorld3d::new(WorldConfig {
                            space,
                            gravity: [0.; 3],
                            ..WorldConfig::default()
                        })
                        .unwrap();
                        let id = cube(&mut world, BodyKind::KinematicPosition, [0.; 3]);
                        world
                            .set_runtime_settings(
                                [0.; 3],
                                SolverSettings {
                                    velocity_iterations: 32,
                                    position_iterations: 32,
                                    restitution_velocity_threshold: 1.0e6,
                                    continuous,
                                },
                            )
                            .unwrap();
                        world.backend.integration_parameters.max_ccd_substeps = *ccd;
                        world.backend.integration_parameters.warmstart_coefficient = warmstart;
                        world.backend.integration_parameters.friction_model = friction;
                        world
                            .set_kinematic_target(
                                id,
                                Pose {
                                    position: [1., 0., 0.],
                                    ..Pose::default()
                                },
                            )
                            .unwrap();
                        let before = world.capture_snapshot().unwrap();
                        let mut restored = PhysicsWorld3d::from_snapshot(&before).unwrap();
                        assert_eq!(
                            restored.capture_snapshot().unwrap().encoded_bytes(),
                            before.encoded_bytes()
                        );
                        assert_eq!(
                            restored
                                .backend
                                .integration_parameters
                                .warmstart_coefficient
                                .to_bits(),
                            warmstart.to_bits()
                        );
                        world.step();
                        restored.step();
                        same(&world, &restored, &[id]);
                    }
                }
            }
        }
    }
}

#[test]
fn native_snapshot_integration_variable_intervals_restore_nominal_before_capture() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            space,
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let id = cube(&mut world, BodyKind::Dynamic, [0.; 3]);
        world.set_velocity(id, [1., 0., 0.], [0.; 3]).unwrap();
        let nominal = world.backend.integration_parameters;
        for duration in [0.0001, 0.007, 0.021, 0.1] {
            assert!(world.begin_interval(duration, true).unwrap());
            assert_eq!(world.backend.integration_parameters.dt, duration);
            assert_eq!(
                world.capture_snapshot().unwrap_err(),
                PhysicsSnapshotError::InvalidState
            );
            world.step();
            world.end_interval();
            assert_eq!(world.backend.integration_parameters, nominal);
            let saved = world.capture_snapshot().unwrap();
            let mut restored = PhysicsWorld3d::from_snapshot(&saved).unwrap();
            assert_eq!(
                restored.capture_snapshot().unwrap().encoded_bytes(),
                saved.encoded_bytes()
            );
            world.begin_interval(0.013, true).unwrap();
            restored.begin_interval(0.013, true).unwrap();
            world.step();
            restored.step();
            world.end_interval();
            restored.end_interval();
            same(&world, &restored, &[id]);
        }
    }
}

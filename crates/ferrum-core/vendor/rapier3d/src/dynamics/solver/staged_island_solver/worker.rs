// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
//! The stage machine executed by every worker: solver-body init, constraint
//! generation, the per-group substep loop, and the impulse/rigid-body
//! writeback stages.

use core::sync::atomic::Ordering;

#[cfg(feature = "dim3")]
use crate::dynamics::rigid_body::gyroscopic_corrected_angvel;
use crate::dynamics::solver::contact_constraint::ContactWithCoulombFrictionBuilder;
#[cfg(feature = "dim3")]
use crate::dynamics::solver::contact_constraint::ContactWithTwistFrictionBuilder;
use crate::dynamics::solver::joint_constraint::GenericJointConstraintBuilder;
use crate::dynamics::solver::solver_body::{
    SOLVER_BODY_ALLOW_FAST_ROTATION, SOLVER_BODY_KINEMATIC, SOLVER_BODY_MOTION_RESOLVED,
};
use crate::dynamics::solver::solver_contact_graph::ContactRef;
use crate::dynamics::solver::JointConstraintsSet;
use crate::dynamics::{JointGraphEdge, RigidBodyType, RigidBodyVelocity};
use crate::geometry::ContactManifold;
use crate::math::Real;
use parry::math::SIMD_WIDTH;

use super::solve::solve_pass;
use super::{chunk_at, stage_batch, SharedCtx, BODY_BATCH};

/// The stage machine executed by every worker. See [`SharedCtx`] for the safety contract.
pub(super) unsafe fn run_worker(ctx: &SharedCtx, worker_id: usize) {
    let sync = ctx.sync;
    let num_chunks = ctx.num_chunks;
    let all_chunks = 0..num_chunks;
    let all_island_bodies = 0..ctx.island_bodies.len();
    // The caller's stage ordinal; every worker passes the same sequence of
    // stage sites, so ordinals agree by construction. See `StageSync`.
    let mut stage = 0;

    // The two sites reuse the original worker-zero pointer expressions after
    // a completed StageSync barrier. Integration, final approval and all
    // references stay inside exactly the original exclusive borrow contract.
    let motion_boundary = |index: usize, count: usize| {
        let (start, end) = ctx.motion_time;
        if index == 0 {
            start
        } else if index == count {
            end
        } else {
            start + (end - start) * (index as f64 / count as f64)
        }
    };
    let approve_motion =
        |range: core::ops::Range<usize>,
         start_time: Real,
         end_time: Real,
         precise_start: f64,
         precise_end: f64,
         is_last_interval: bool,
         final_view: bool,
         params: &crate::dynamics::IntegrationParameters| {
            let vs = unsafe { &mut *ctx.velocity_solver };
            let bodies = unsafe { &mut *ctx.bodies };
            if !final_view {
                let multibodies = unsafe { &mut *ctx.multibodies };
                vs.integrate_multibody_positions(params, is_last_interval, bodies, multibodies);
            }
            let Some(resolver) = ctx.motion_resolver else {
                return crate::pipeline::SolverMotionDecision::Approved;
            };
            let mut approval = MotionApproval {
                bodies,
                colliders: ctx.motion_colliders,
                handles: &ctx.island_bodies[range.clone()],
                solver: &mut vs.solver_bodies,
                first: range.start,
                start_time,
                end_time,
                precise_start,
                precise_end,
                is_last_interval,
                final_view,
            };
            if final_view {
                vs.ccd_plan.clear();
                let decision =
                    resolver.plan_solver_ccd(&approval, ctx.base_params, &mut vs.ccd_plan);
                if decision == crate::pipeline::SolverMotionDecision::Approved
                    && !vs.ccd_plan.valid(&approval)
                {
                    crate::pipeline::SolverMotionDecision::Rejected
                } else {
                    decision
                }
            } else {
                resolver.resolve_solver_motion(&mut approval)
            }
        };

    /*
     * Stage: initialize solver bodies and their velocity increments (parallel over
     * claimed body slots; each writes solver-body slot i for island body i).
     * Multibodies were initialized in the serial pre-phase.
     */
    {
        let all_fill_slots = 0..ctx.island_bodies.len();
        let stage_work = all_fill_slots.end;
        let mut done = 0;
        while let Some(claimed) = sync.claim(stage, &all_fill_slots, BODY_BATCH, worker_id) {
            let claimed_len = claimed.len();
            for i in claimed {
                let handle = ctx.island_bodies[i];
                if ctx.has_multibodies {
                    let multibodies = unsafe { &*ctx.multibodies };
                    if multibodies.rigid_body_link(handle).is_some() {
                        continue;
                    }
                }

                let bodies = unsafe { &*ctx.bodies };
                let rb = &bodies[handle];
                debug_assert_eq!(rb.ids.active_set_id, i as u32);
                let vs = unsafe { &mut *ctx.velocity_solver };
                vs.solver_bodies.copy_from(i, rb);

                // The per-substep external-force increment, baked with the
                // slot's group substep dt (groups are few; the scan is cheap).
                let slot_dt = ctx
                    .groups
                    .iter()
                    .find(|g| g.bodies.contains(&i))
                    .map(|g| g.dt)
                    .unwrap_or(ctx.groups[0].dt);
                let incr = &mut vs.solver_vels_increment[i];
                incr.angular = rb.mprops.effective_world_inv_inertia * rb.forces.torque * slot_dt;
                incr.linear = rb.forces.force * rb.mprops.effective_inv_mass * slot_dt;

                // Gyroscopic forces (3D) are applied per-substep by the increment
                // stage; record the body's diagonal local inertia here.
                #[cfg(feature = "dim3")]
                {
                    let gyro = &mut vs.solver_gyro[i];
                    // Only dynamic bodies: a kinematic body's velocity is
                    // user-prescribed and must not be altered by the solver.
                    if rb.forces.gyroscopic_forces_enabled && rb.is_dynamic() && !rb.is_sleeping() {
                        gyro.principal_inertia = rb.mprops.local_mprops.principal_inertia();
                        gyro.inv_principal_inertia = rb.mprops.local_mprops.inv_principal_inertia;
                        gyro.principal_frame = rb.mprops.local_mprops.principal_inertia_local_frame;
                        gyro.enabled = true;
                        // SAFETY: shared atomic; claimed slots make the writes disjoint.
                        unsafe { &*ctx.any_gyroscopic }.store(true, Ordering::Relaxed);
                    } else {
                        gyro.enabled = false;
                    }
                }
            }
            done += claimed_len;
        }
        // One completion flush per worker per stage: per-batch RMWs on the
        // shared counter measurably throttle scalar builds (4x the chunks).
        sync.complete(stage, done, stage_work);
        stage = sync.sync(stage, stage_work);
    }

    /*
     * Stage: generate SIMD contact constraints (parallel over claimed chunk slots).
     */
    {
        let bodies = unsafe { &*ctx.bodies };
        let mut done = 0;
        let mut local_bouncy = false;
        while let Some(claimed) = sync.claim(
            stage,
            &all_chunks,
            stage_batch(all_chunks.end, sync.num_workers),
            worker_id,
        ) {
            let claimed_len = claimed.len();
            let claim_end = claimed.end;
            for chunk_id in claimed {
                // Software prefetch: `store.get` walks a dependent edge → pair → manifold chain
                // per lane and the random-order misses otherwise serialize. Pair headers at
                // distance 2, manifolds at distance 1 (their address needs the header in cache).
                if chunk_id + 2 < claim_end {
                    for r in chunk_at(ctx.chunk_segments, chunk_id + 2) {
                        ctx.store.prefetch_pair(r);
                    }
                }
                if chunk_id + 1 < claim_end {
                    for r in chunk_at(ctx.chunk_segments, chunk_id + 1) {
                        ctx.store.prefetch_manifold(r);
                    }
                }
                // The chunk lanes are the (edge, ordinal) addresses the
                // constraint stores per lane (PADDING for unused lanes, whose
                // manifold gather replicates lane 0).
                let cref_ids = chunk_at(ctx.chunk_segments, chunk_id);
                let manifold_refs: [&ContactManifold; SIMD_WIDTH] = core::array::from_fn(|ii| {
                    let r = if cref_ids[ii].is_padding() {
                        cref_ids[0]
                    } else {
                        cref_ids[ii]
                    };
                    ctx.store.get(r)
                });
                // SAFETY: reads solver bodies (no other writer during this stage),
                //         writes the claimed constraint slot only.
                let solver_bodies = unsafe { &(*ctx.velocity_solver).solver_bodies };

                #[cfg(feature = "dim3")]
                if ctx.use_twist {
                    let builder = unsafe { &mut *ctx.twist_builders.add(chunk_id) };
                    let constraint = unsafe { &mut *ctx.twist_constraints.add(chunk_id) };
                    ContactWithTwistFrictionBuilder::generate(
                        ctx.base_params.restitution_velocity_threshold,
                        cref_ids,
                        manifold_refs,
                        bodies,
                        solver_bodies,
                        builder,
                        constraint,
                    );
                    local_bouncy |= builder.has_bouncy_seed(constraint.num_contacts);
                }
                if !ctx.use_twist {
                    let builder = unsafe { &mut *ctx.coulomb_builders.add(chunk_id) };
                    let constraint = unsafe { &mut *ctx.coulomb_constraints.add(chunk_id) };
                    ContactWithCoulombFrictionBuilder::generate(
                        ctx.base_params.restitution_velocity_threshold,
                        cref_ids,
                        manifold_refs,
                        bodies,
                        solver_bodies,
                        builder,
                        constraint,
                    );
                    local_bouncy |= builder.has_bouncy_seed(constraint.num_contacts);
                }
            }
            done += claimed_len;
        }
        // Publish this worker's restitution-seed sightings BEFORE the completion flush so
        // every worker reads a settled value after the stage barrier.
        if local_bouncy {
            unsafe { &*ctx.any_bouncy }.store(true, Ordering::Relaxed);
        }
        // One completion flush per worker per stage: per-batch RMWs on the
        // shared counter measurably throttle scalar builds (4x the chunks).
        sync.complete(stage, done, num_chunks);
        stage = sync.sync(stage, num_chunks);
    }

    /*
     * Group ring: each substep solve-group runs its whole substep loop in turn on its own
     * slots/chunks/colors/builders. Groups are ordered by decreasing substep count, so
     * lower-cadence groups see higher-cadence bodies at end-of-step poses; every worker walks
     * the identical group/substep/stage sequence, keeping the `StageSync` ordinals in lockstep.
     */
    // Whether any island body has gyroscopic forces enabled. Set by the body-copy
    // stage above and published by its barrier, so every worker reads the same
    // value; gyro-free islands (the common case) skip the per-substep pass.
    #[cfg(feature = "dim3")]
    let has_gyroscopic = unsafe { &*ctx.any_gyroscopic }.load(Ordering::Relaxed);
    // Whether any contact constraint captured a restitution seed, published by the
    // constraint-generation barrier so every worker agrees. Bounce-free steps (the common
    // case) skip the end-of-step restitution stages entirely.
    let has_bouncy = unsafe { &*ctx.any_bouncy }.load(Ordering::Relaxed);
    let has_soft = !unsafe { &*ctx.soft_constraints }.is_empty();
    // Soft bodies solved by the FEM path: their implicit elastic step is one stage per substep,
    // and their pass stages live in `solve_pass`. Read-only during the solve, so every worker
    // takes the same branches.
    #[cfg(feature = "fem")]
    let has_fem = !unsafe { &*ctx.soft_fem }.is_empty();

    /*
     * Stage: the FEM bodies' step factorization and the responses of the constraints acting on
     * them (parallel over the FEM bodies, each writing its own system, response ranges and
     * constraint-side gains). Runs before the substeps, whose constraint updates read the gains.
     */
    #[cfg(feature = "fem")]
    if has_fem {
        let soft_fem = unsafe { &*ctx.soft_fem };
        let all_bodies = 0..soft_fem.num_active();
        let stage_work = all_bodies.len();
        let mut done = 0;
        while let Some(claimed) = sync.claim(stage, &all_bodies, 1, worker_id) {
            let claimed_len = claimed.len();
            for index in claimed {
                // SAFETY: one worker per claimed index; the body writes only its own system,
                // pool ranges and constraint sides.
                unsafe { soft_fem.compute_responses(index, ctx.soft_constraints) };
            }
            done += claimed_len;
        }
        sync.complete(stage, done, stage_work);
        stage = sync.sync(stage, stage_work);
    }

    for (group_index, group) in ctx.groups.iter().enumerate() {
        // This group's substep parameters: identical to `base_params` except
        // for the substep dt. Everything dt-derived downstream (soft erp/cfm,
        // rhs, speculative terms, integration) recomputes from this copy.
        let mut gparams = *ctx.base_params;
        gparams.dt = group.dt;
        let params = &gparams;
        let num_substeps = group.num_substeps;
        // This group's claim domains; single-group they span everything, except `group_bodies`
        // (island slots only — the omitted padding tail slots hold zero velocities and
        // increments, so skipping them is behavior-preserving).
        let group_bodies = group.bodies.clone();
        // The per-slot stages (velocity increments, integration) cover the group's rigid slots
        // then its soft-body particle slots, through one virtual index range.
        let group_soft_slots = group.soft_slots.clone();
        let num_group_bodies = group_bodies.len() + group_soft_slots.len();
        let group_slots = 0..num_group_bodies;
        let slot_of = |i: usize| -> usize {
            if i < group_bodies.len() {
                group_bodies.start + i
            } else {
                group_soft_slots.start + (i - group_bodies.len())
            }
        };
        let num_joint_chunks = group.joint_chunks.len();
        let joint_builders = group.joint_builders.clone();
        // Update-stage virtual claim domain: this group's contact chunks,
        // then its SIMD joint chunks, then its scalar joint builders.
        let group_chunks_len = group.chunks.len();
        let all_updates = 0..group_chunks_len + num_joint_chunks + joint_builders.len();

        for substep_id in 0..num_substeps {
            let is_last_substep = substep_id == num_substeps - 1;
            let solved_dt = substep_id as Real * params.dt;

            /*
             * Stage: apply velocity increments (parallel over claimed body slots).
             * Worker 0 also applies the generic (multibody) increments.
             */
            {
                // +1: worker 0's generic increments.
                let stage_work = num_group_bodies + 1;
                let mut done = 0;
                while let Some(claimed) = sync.claim(stage, &group_slots, BODY_BATCH, worker_id) {
                    let vs = unsafe { &mut *ctx.velocity_solver };
                    let claimed_len = claimed.len();
                    for i in claimed {
                        let i = slot_of(i);
                        let incr = vs.solver_vels_increment[i];
                        {
                            let vels = &mut vs.solver_bodies.vels[i];
                            vels.linear += incr.linear;
                            vels.angular += incr.angular;
                        }

                        // Per-substep gyroscopic correction (applied every substep
                        // to keep long, skinny bodies stable), using the
                        // orientation integrated by the previous substep.
                        #[cfg(feature = "dim3")]
                        if has_gyroscopic {
                            let gyro = vs.solver_gyro[i];
                            if gyro.enabled {
                                // World-space principal axes = body rotation ∘ principal frame.
                                let principal_axes =
                                    vs.solver_bodies.poses[i].rotation * gyro.principal_frame;
                                let angular = vs.solver_bodies.vels[i].angular;
                                vs.solver_bodies.vels[i].angular = gyroscopic_corrected_angvel(
                                    angular,
                                    principal_axes,
                                    gyro.principal_inertia,
                                    gyro.inv_principal_inertia,
                                    params.dt,
                                );
                            }
                        }
                    }
                    done += claimed_len;
                }
                // One completion flush per worker per stage: per-batch RMWs on the
                // shared counter measurably throttle scalar builds (4x the chunks).
                sync.complete(stage, done, stage_work);
                if worker_id == 0 {
                    let vs = unsafe { &mut *ctx.velocity_solver };
                    let incr = core::mem::take(&mut vs.generic_solver_vels_increment);
                    vs.generic_solver_vels += &incr;
                    vs.generic_solver_vels_increment = incr;
                    sync.complete(stage, 1, stage_work);
                }
                stage = sync.sync(stage, stage_work);
            }

            /*
             * Stage: the FEM soft bodies' implicit elastic step (parallel over the group's FEM
             * bodies): assemble `A = M + h D + h² K` and solve `A Δv = h f - (A - M) v`. One body
             * per claim; nothing else touches its system or particle slots during this stage.
             */
            #[cfg(feature = "fem")]
            if has_fem {
                let soft_fem = unsafe { &*ctx.soft_fem };
                let fem_bodies = soft_fem.group(group_index);
                let stage_work = fem_bodies.len();
                let mut done = 0;
                while let Some(claimed) = sync.claim(stage, &fem_bodies, 1, worker_id) {
                    let solver_bodies = unsafe { &mut (*ctx.velocity_solver).solver_bodies };
                    let claimed_len = claimed.len();
                    for index in claimed {
                        // SAFETY: one worker per claimed index; a body writes only its own
                        // particles (soft bodies share no particle).
                        unsafe {
                            soft_fem.predict(index, solver_bodies, &params.soft_bodies.fem);
                        }
                    }
                    done += claimed_len;
                }
                sync.complete(stage, done, stage_work);
                stage = sync.sync(stage, stage_work);
            }

            /*
             * Stage: update constraints from builders (parallel; contact chunks first, then
             * scalar joint builders — each writes only its own constraint slot/rows).
             * Worker 0 also updates the generic joint and generic contact constraints.
             */
            {
                let multibodies = unsafe { &*ctx.multibodies };
                // NOTE: when warm-starting is enabled (the common case), the contact
                //       constraint updates are fused into the warmstart stage below so
                //       each constraint is only swept once per substep.
                let fused_contact_update = params.warmstart_coefficient != 0.0;
                let update_domain = if fused_contact_update {
                    group_chunks_len..all_updates.end
                } else {
                    all_updates.clone()
                };
                let stage_work = update_domain.len() + 1;
                let mut done = 0;
                while let Some(claimed) = sync.claim(
                    stage,
                    &update_domain,
                    stage_batch(update_domain.end - update_domain.start, sync.num_workers),
                    worker_id,
                ) {
                    let solver_bodies = unsafe { &(*ctx.velocity_solver).solver_bodies };
                    let claimed_len = claimed.len();
                    for idx in claimed {
                        if idx >= group_chunks_len + num_joint_chunks {
                            // SAFETY: each builder is claimed by exactly one worker per
                            // stage and only writes itself (substep-0 GS recording) and
                            // its own constraint rows.
                            let joints = unsafe { &mut *ctx.joint_constraints };
                            let builder = unsafe {
                                &mut *joints.velocity_constraints_builder.as_mut_ptr().add(
                                    joint_builders.start
                                        + (idx - group_chunks_len - num_joint_chunks),
                                )
                            };
                            let warmstart_joints = params
                                .warmstart_joints
                                .then_some(params.warmstart_coefficient);
                            builder.update(
                                params,
                                substep_id,
                                warmstart_joints,
                                solver_bodies,
                                &mut joints.velocity_constraints,
                            );
                            continue;
                        }
                        if idx >= group_chunks_len {
                            // SIMD joint chunk of this group.
                            // SAFETY: same as the scalar builders.
                            let joints = unsafe { &mut *ctx.joint_constraints };
                            let builder = unsafe {
                                &mut *joints
                                    .simd_velocity_constraints_builder
                                    .as_mut_ptr()
                                    .add(group.joint_chunks.start + (idx - group_chunks_len))
                            };
                            let warmstart_joints = params
                                .warmstart_joints
                                .then_some(params.warmstart_coefficient);
                            builder.update(
                                params,
                                substep_id,
                                warmstart_joints,
                                solver_bodies,
                                &mut joints.simd_velocity_constraints,
                            );
                            continue;
                        }

                        let chunk_id = group.chunks.start + idx;
                        #[cfg(feature = "dim3")]
                        if ctx.use_twist {
                            let builder = unsafe { &*ctx.twist_builders.add(chunk_id) };
                            builder.update(params, solved_dt, solver_bodies, multibodies, unsafe {
                                &mut *ctx.twist_constraints.add(chunk_id)
                            });
                        }
                        if !ctx.use_twist {
                            let builder = unsafe { &*ctx.coulomb_builders.add(chunk_id) };
                            builder.update(params, solved_dt, solver_bodies, multibodies, unsafe {
                                &mut *ctx.coulomb_constraints.add(chunk_id)
                            });
                        }
                    }
                    done += claimed_len;
                }
                // One completion flush per worker per stage: per-batch RMWs on the
                // shared counter measurably throttle scalar builds (4x the chunks).
                sync.complete(stage, done, stage_work);

                if worker_id == 0 {
                    // Generic (multibody) constraints exist only on the
                    // single-group path (multibody scenes never split).
                    if ctx.groups.len() == 1 {
                        let joints = unsafe { &mut *ctx.joint_constraints };
                        let solver_bodies = unsafe { &(*ctx.velocity_solver).solver_bodies };
                        let JointConstraintsSet {
                            generic_velocity_constraints_builder,
                            generic_jacobians,
                            generic_velocity_constraints,
                            ..
                        } = joints;
                        for builder in generic_velocity_constraints_builder.iter_mut() {
                            match builder {
                                GenericJointConstraintBuilder::External(b) => b.update(
                                    params,
                                    multibodies,
                                    solver_bodies,
                                    generic_jacobians,
                                    generic_velocity_constraints,
                                ),
                                GenericJointConstraintBuilder::Internal(b) => b.update(
                                    params,
                                    multibodies,
                                    generic_jacobians,
                                    generic_velocity_constraints,
                                ),
                                GenericJointConstraintBuilder::Empty => {}
                            }
                        }

                        if !fused_contact_update {
                            let contacts = unsafe { &mut *ctx.contact_constraints };
                            let solver_bodies = unsafe { &(*ctx.velocity_solver).solver_bodies };
                            for (builder, constraint) in contacts
                                .generic_velocity_constraints_builder
                                .iter()
                                .zip(contacts.generic_velocity_constraints.iter_mut())
                            {
                                builder.update(
                                    params,
                                    solved_dt,
                                    solver_bodies,
                                    multibodies,
                                    constraint,
                                );
                            }
                        }
                    }
                    sync.complete(stage, 1, stage_work);
                }
                stage = sync.sync(stage, stage_work);
            }

            /*
             * Stages: warmstart, color by color (parallel within a color: constraints of a
             * same color write disjoint solver bodies).
             */
            if params.warmstart_coefficient != 0.0 {
                let multibodies = unsafe { &*ctx.multibodies };
                for (_, color) in &ctx.color_ranges[group.colors.clone()] {
                    let mut done = 0;
                    while let Some(claimed) = sync.claim(
                        stage,
                        color,
                        stage_batch(color.end - color.start, sync.num_workers),
                        worker_id,
                    ) {
                        let claimed_len = claimed.len();
                        for chunk_id in claimed {
                            let solver_bodies =
                                unsafe { &mut (*ctx.velocity_solver).solver_bodies };
                            // Fused per-substep constraint update + warmstart: one sweep
                            // over the constraint memory instead of two.
                            #[cfg(feature = "dim3")]
                            if ctx.use_twist {
                                let builder = unsafe { &*ctx.twist_builders.add(chunk_id) };
                                let constraint =
                                    unsafe { &mut *ctx.twist_constraints.add(chunk_id) };
                                builder.update(
                                    params,
                                    solved_dt,
                                    solver_bodies,
                                    multibodies,
                                    constraint,
                                );
                                constraint.warmstart(solver_bodies);
                            }
                            if !ctx.use_twist {
                                let builder = unsafe { &*ctx.coulomb_builders.add(chunk_id) };
                                let constraint =
                                    unsafe { &mut *ctx.coulomb_constraints.add(chunk_id) };
                                builder.update(
                                    params,
                                    solved_dt,
                                    solver_bodies,
                                    multibodies,
                                    constraint,
                                );
                                constraint.warmstart(solver_bodies);
                            }
                        }
                        done += claimed_len;
                    }
                    // One completion flush per worker per stage: per-batch RMWs on the
                    // shared counter measurably throttle scalar builds (4x the chunks).
                    sync.complete(stage, done, color.len());
                    stage = sync.sync(stage, color.len());
                }

                // Overflow + generic (multibody) contacts, exclusively on worker 0
                // (fused update + warmstart, like the colored chunks above).
                if worker_id == 0 {
                    for chunk_id in group.overflow.clone() {
                        let solver_bodies = unsafe { &mut (*ctx.velocity_solver).solver_bodies };
                        #[cfg(feature = "dim3")]
                        if ctx.use_twist {
                            let builder = unsafe { &*ctx.twist_builders.add(chunk_id) };
                            let constraint = unsafe { &mut *ctx.twist_constraints.add(chunk_id) };
                            builder.update(
                                params,
                                solved_dt,
                                solver_bodies,
                                multibodies,
                                constraint,
                            );
                            constraint.warmstart(solver_bodies);
                        }
                        if !ctx.use_twist {
                            let builder = unsafe { &*ctx.coulomb_builders.add(chunk_id) };
                            let constraint = unsafe { &mut *ctx.coulomb_constraints.add(chunk_id) };
                            builder.update(
                                params,
                                solved_dt,
                                solver_bodies,
                                multibodies,
                                constraint,
                            );
                            constraint.warmstart(solver_bodies);
                        }
                    }

                    let contacts = unsafe { &mut *ctx.contact_constraints };
                    let vs = unsafe { &mut *ctx.velocity_solver };
                    for (builder, c) in contacts
                        .generic_velocity_constraints_builder
                        .iter()
                        .zip(contacts.generic_velocity_constraints.iter_mut())
                    {
                        builder.update(params, solved_dt, &vs.solver_bodies, multibodies, c);
                        c.warmstart(
                            &contacts.generic_jacobians,
                            &mut vs.solver_bodies,
                            &mut vs.generic_solver_vels,
                        );
                    }
                    sync.complete(stage, 1, 1);
                }
                stage = sync.sync(stage, 1);
            }

            /*
             * Stages: solve with bias. The group's count includes the extra iterations its bodies
             * request (`RigidBody::additional_pgs_iterations`, 3 by default for soft bodies), so
             * the substep's constraints converge against each other at the same positions.
             */
            for pgs_iter in 0..group.num_pgs_iterations {
                // Joint warm-starting is fused into the first biased pass: each claimed joint
                // applies its warm impulse right before being solved. Soft-body constraints do
                // the same and update their geometry on the first iteration of the pass.
                let warmstart_joints = params.warmstart_joints && pgs_iter == 0;
                let soft_warmstart = (pgs_iter == 0 && params.warmstart_coefficient != 0.0)
                    .then_some(params.warmstart_coefficient);
                stage = unsafe {
                    solve_pass(
                        ctx,
                        group_index,
                        worker_id,
                        stage,
                        false,
                        warmstart_joints,
                        pgs_iter == 0,
                        soft_warmstart,
                        params,
                        solved_dt,
                    )
                };
            }

            /*
             * Stage: integrate positions (parallel over claimed body slots).
             * Worker 0 also integrates the multibodies (sole accessor of `bodies` and
             * `multibodies` during this stage).
             */
            {
                // Per-substep speed cap. `max_ang` ties to the *full-step* inv_dt
                // so per-step rotation stays under `MAX_ROTATION` regardless of substep count;
                // clamped in place on the solver body so the cap persists into later substeps
                // and the final velocity writeback.
                let base_params = ctx.base_params;
                let max_lin = base_params.max_linear_velocity();
                let max_ang = RigidBodyVelocity::solver_max_angular_velocity(base_params.inv_dt());

                let mut done = 0;
                while let Some(claimed) = sync.claim(stage, &group_slots, BODY_BATCH, worker_id) {
                    let vs = unsafe { &mut *ctx.velocity_solver };
                    let claimed_len = claimed.len();
                    for i in claimed {
                        let i = slot_of(i);
                        {
                            let vel = &mut vs.solver_bodies.vels[i];
                            // Kinematic velocity/position is an authored motion command.
                            if max_lin != Real::MAX
                                && vs.solver_bodies.flags[i] & SOLVER_BODY_KINEMATIC == 0
                            {
                                let n = vel.linear.length();
                                if n > max_lin {
                                    vel.linear *= max_lin / n;
                                }
                            }
                            if vs.solver_bodies.flags[i] & SOLVER_BODY_ALLOW_FAST_ROTATION == 0 {
                                RigidBodyVelocity::cap_solver_angular_velocity(
                                    &mut vel.angular,
                                    max_ang,
                                );
                            }
                        }

                        let vels = vs.solver_bodies.vels[i];
                        let pose = &mut vs.solver_bodies.poses[i];
                        let new_vels = RigidBodyVelocity {
                            linvel: vels.linear,
                            angvel: vels.angular,
                        };
                        let observed_start =
                            (ctx.motion_body_mask.get(i) == Some(&true)).then(|| pose.pose());
                        new_vels.integrate_linearized(
                            params.dt,
                            &mut pose.translation,
                            &mut pose.rotation,
                        );
                        if let (Some(events), Some(start), Some(&body)) =
                            (ctx.motion_events, observed_start, ctx.island_bodies.get(i))
                        {
                            events.handle_solver_body_proposal(
                                crate::pipeline::SolverBodyIntegration {
                                    motion: crate::pipeline::SolverBodyMotion {
                                        body,
                                        start_time: solved_dt,
                                        end_time: (substep_id + 1) as Real * params.dt,
                                        start,
                                        end: pose.pose(),
                                    },
                                    integration_seconds: params.dt,
                                    linear_velocity: new_vels.linvel,
                                    angular_velocity: new_vels.angvel,
                                },
                            );
                        }
                    }
                    done += claimed_len;
                }
                // One completion flush per worker per stage: per-batch RMWs on the
                // shared counter measurably throttle scalar builds (4x the chunks).
                if ctx.motion_resolver.is_some() {
                    // The new approval callback needs every claimed rigid slot.
                    // Finish their stage before reusing the existing worker-0
                    // exclusive borrows below. No pointer or alias is added.
                    sync.complete(stage, done, num_group_bodies);
                    stage = sync.sync(stage, num_group_bodies);
                } else {
                    sync.complete(stage, done, num_group_bodies + 1);
                }

                if worker_id == 0 {
                    let decision = approve_motion(
                        group.bodies.clone(),
                        solved_dt,
                        (substep_id + 1) as Real * params.dt,
                        motion_boundary(substep_id, num_substeps),
                        motion_boundary(substep_id + 1, num_substeps),
                        is_last_substep,
                        false,
                        params,
                    );
                    if ctx.motion_resolver.is_some() {
                        ctx.motion_decision.store(decision as u8, Ordering::Release);
                        sync.complete(stage, 1, 1);
                    } else {
                        sync.complete(stage, 1, num_group_bodies + 1);
                    }
                }
                stage = sync.sync(
                    stage,
                    if ctx.motion_resolver.is_some() {
                        1
                    } else {
                        num_group_bodies + 1
                    },
                );
                if ctx.motion_resolver.is_some() && ctx.motion_decision.load(Ordering::Acquire) != 0
                {
                    // All workers have crossed the same decision barrier. Stop
                    // before stabilization and persistent impulse/body writeback.
                    return;
                }
            }

            /*
             * Stages: solve without bias.
             */
            for stab_iter in 0..params.num_internal_stabilization_iterations {
                stage = unsafe {
                    solve_pass(
                        ctx,
                        group_index,
                        worker_id,
                        stage,
                        true,
                        false,
                        stab_iter == 0,
                        None,
                        params,
                        solved_dt + params.dt,
                    )
                };
            }
        }

        /*
         * Stages: end-of-step restitution, color by color (box2d-style). Applied ONCE after
         * all substeps, gated on the point having applied an impulse: inside the substep rhs
         * the speculative `dist * inv_dt` slack would truncate the bounce.
         */
        if has_bouncy {
            for (_, color) in &ctx.color_ranges[group.colors.clone()] {
                let mut done = 0;
                while let Some(claimed) = sync.claim(
                    stage,
                    color,
                    stage_batch(color.end - color.start, sync.num_workers),
                    worker_id,
                ) {
                    let claimed_len = claimed.len();
                    for chunk_id in claimed {
                        // SAFETY: constraints of a same color touch pairwise-disjoint bodies.
                        let solver_bodies = unsafe { &mut (*ctx.velocity_solver).solver_bodies };
                        #[cfg(feature = "dim3")]
                        if ctx.use_twist {
                            let builder = unsafe { &*ctx.twist_builders.add(chunk_id) };
                            builder.apply_restitution(
                                unsafe { &mut *ctx.twist_constraints.add(chunk_id) },
                                solver_bodies,
                            );
                        }
                        if !ctx.use_twist {
                            let builder = unsafe { &*ctx.coulomb_builders.add(chunk_id) };
                            builder.apply_restitution(
                                unsafe { &mut *ctx.coulomb_constraints.add(chunk_id) },
                                solver_bodies,
                            );
                        }
                    }
                    done += claimed_len;
                }
                // One completion flush per worker per stage (see the warmstart stages).
                sync.complete(stage, done, color.len());
                stage = sync.sync(stage, color.len());
            }

            // Overflow + generic (multibody) contacts, exclusively on worker 0.
            if worker_id == 0 {
                for chunk_id in group.overflow.clone() {
                    let solver_bodies = unsafe { &mut (*ctx.velocity_solver).solver_bodies };
                    #[cfg(feature = "dim3")]
                    if ctx.use_twist {
                        let builder = unsafe { &*ctx.twist_builders.add(chunk_id) };
                        builder.apply_restitution(
                            unsafe { &mut *ctx.twist_constraints.add(chunk_id) },
                            solver_bodies,
                        );
                    }
                    if !ctx.use_twist {
                        let builder = unsafe { &*ctx.coulomb_builders.add(chunk_id) };
                        builder.apply_restitution(
                            unsafe { &mut *ctx.coulomb_constraints.add(chunk_id) },
                            solver_bodies,
                        );
                    }
                }

                // Generic constraints exist only on the single-group path.
                if ctx.groups.len() == 1 {
                    let contacts = unsafe { &mut *ctx.contact_constraints };
                    let vs = unsafe { &mut *ctx.velocity_solver };
                    for (builder, c) in contacts
                        .generic_velocity_constraints_builder
                        .iter()
                        .zip(contacts.generic_velocity_constraints.iter_mut())
                    {
                        builder.apply_restitution(
                            c,
                            &contacts.generic_jacobians,
                            &mut vs.solver_bodies,
                            &mut vs.generic_solver_vels,
                        );
                    }
                }
                sync.complete(stage, 1, 1);
            }
            stage = sync.sync(stage, 1);
        }
    }

    // Final approval is global to this staged solve, after all groups and
    // restitution and before persistent impulse/body writeback. Worker zero
    // reuses the existing exclusive body/solver borrow; no pointer or alias
    // contract is introduced by this adapter.
    if ctx.motion_resolver.is_some() {
        if worker_id == 0 {
            let decision = approve_motion(
                0..ctx.island_bodies.len(),
                0.,
                ctx.base_params.dt,
                ctx.motion_time.0,
                ctx.motion_time.1,
                true,
                true,
                ctx.base_params,
            );
            ctx.motion_decision.store(decision as u8, Ordering::Release);
            sync.complete(stage, 1, 1);
        }
        stage = sync.sync(stage, 1);
        if ctx.motion_decision.load(Ordering::Acquire) != 0 {
            return;
        }
    }

    /*
     * Stage: write impulses back to the manifolds (parallel; each chunk writes only its own
     * manifolds, padding lanes skipped). Worker 0 also writes back the joint and generic
     * contact impulses (disjoint from the chunk manifolds).
     */
    {
        let mut done = 0;
        while let Some(claimed) = sync.claim(
            stage,
            &all_chunks,
            stage_batch(all_chunks.end, sync.num_workers),
            worker_id,
        ) {
            let claimed_len = claimed.len();
            let claim_end = claimed.end;
            // Same two-distance software prefetch as the constraint-generation
            // stage: the impulse writeback walks the same dependent
            // edge → pair → manifold chain per lane.
            let manifold_ids_of = |chunk_id: usize| -> [ContactRef; SIMD_WIDTH] {
                #[cfg(feature = "dim3")]
                if ctx.use_twist {
                    return unsafe { (*ctx.twist_constraints.add(chunk_id)).manifold_id };
                }
                unsafe { (*ctx.coulomb_constraints.add(chunk_id)).manifold_id }
            };
            for chunk_id in claimed {
                if chunk_id + 2 < claim_end {
                    for r in manifold_ids_of(chunk_id + 2) {
                        ctx.store.prefetch_pair(r);
                    }
                }
                if chunk_id + 1 < claim_end {
                    for r in manifold_ids_of(chunk_id + 1) {
                        ctx.store.prefetch_manifold(r);
                    }
                }
                #[cfg(feature = "dim3")]
                if ctx.use_twist {
                    unsafe { (*ctx.twist_constraints.add(chunk_id)).writeback_impulses(ctx.store) };
                }
                if !ctx.use_twist {
                    unsafe {
                        (*ctx.coulomb_constraints.add(chunk_id)).writeback_impulses(ctx.store)
                    };
                }
            }
            done += claimed_len;
        }
        // One completion flush per worker per stage: per-batch RMWs on the
        // shared counter measurably throttle scalar builds (4x the chunks).
        sync.complete(stage, done, num_chunks + 1);

        if worker_id == 0 {
            let joints_all: &mut [JointGraphEdge] =
                unsafe { core::slice::from_raw_parts_mut(ctx.joints, ctx.num_joints) };
            let joint_constraints = unsafe { &mut *ctx.joint_constraints };
            joint_constraints.writeback_impulses(joints_all);

            let contacts = unsafe { &mut *ctx.contact_constraints };
            for c in contacts.generic_velocity_constraints.iter_mut() {
                c.writeback_impulses(ctx.store);
            }
            sync.complete(stage, 1, num_chunks + 1);
        }
        stage = sync.sync(stage, num_chunks + 1);
    }

    /*
     * Stage: write the soft-body impulses back to the soft bodies (parallel over constraints) and
     * the solved particles back to their bodies (parallel over awake bodies; the virtual claim
     * range covers the constraints then the bodies); worker 0 also writes back the per-body state.
     */
    if has_soft {
        let soft = unsafe { &*ctx.soft_constraints };
        let num_constraints = soft.num_element_constraints();
        let all_units = 0..num_constraints + soft.awake.len();
        let stage_work = all_units.len() + 1;
        let mut done = 0;
        while let Some(claimed) = sync.claim(
            stage,
            &all_units,
            stage_batch(all_units.end, sync.num_workers),
            worker_id,
        ) {
            let claimed_len = claimed.len();
            let constraints = claimed.start.min(num_constraints)..claimed.end.min(num_constraints);
            let awake = claimed.start.max(num_constraints) - num_constraints
                ..claimed.end.max(num_constraints) - num_constraints;
            // SAFETY: each constraint is claimed by exactly one worker and writes its own element; each
            // awake body likewise writes its own particles.
            unsafe {
                soft.writeback_constraints(constraints, ctx.base_params.dt);
                let vs = &*ctx.velocity_solver;
                for ai in awake {
                    soft.writeback_particles(ai, &vs.solver_bodies, ctx.base_params.dt);
                }
            }
            done += claimed_len;
        }
        sync.complete(stage, done, stage_work);
        if worker_id == 0 {
            soft.writeback_bodies();
            sync.complete(stage, 1, stage_work);
        }
        stage = sync.sync(stage, stage_work);
    }

    /*
     * Stage: write the FEM soft bodies' per-cell state back (the warm-started polar rotation,
     * the plastic flow and the tearing marks), parallel over the FEM bodies.
     */
    #[cfg(feature = "fem")]
    if has_fem {
        let set = unsafe { &*ctx.soft_fem };
        let all_bodies = 0..set.num_active();
        let stage_work = all_bodies.len();
        let mut done = 0;
        while let Some(claimed) = sync.claim(stage, &all_bodies, 1, worker_id) {
            let claimed_len = claimed.len();
            for index in claimed {
                // SAFETY: one worker per claimed index; a body writes only its own cells.
                unsafe { set.writeback(index, ctx.base_params.dt) };
            }
            done += claimed_len;
        }
        sync.complete(stage, done, stage_work);
        stage = sync.sync(stage, stage_work);
    }

    /*
     * Stage: write velocities and poses back to the rigid-bodies (parallel over
     * claimed island bodies; each writes its own rigid-body). The multibody
     * writeback runs on worker 0 afterwards, exclusively.
     */
    {
        let base_params = ctx.base_params;
        let mut done = 0;
        while let Some(claimed) = sync.claim(stage, &all_island_bodies, BODY_BATCH, worker_id) {
            let claimed_len = claimed.len();
            for i in claimed {
                let handle = ctx.island_bodies[i];
                if ctx.has_multibodies {
                    let multibodies = unsafe { &*ctx.multibodies };
                    if multibodies.rigid_body_link(handle).is_some() {
                        continue;
                    }
                }

                let bodies = unsafe { &mut *ctx.bodies };
                let rb = bodies.index_mut_internal(handle);
                let vs = unsafe { &*ctx.velocity_solver };
                let solver_vels = &vs.solver_bodies.vels[rb.ids.active_set_id as usize];
                let solver_poses = &vs.solver_bodies.poses[rb.ids.active_set_id as usize];

                let mut new_vels = RigidBodyVelocity {
                    linvel: solver_vels.linear,
                    angvel: solver_vels.angular,
                };
                new_vels = new_vels.apply_damping(base_params.dt, &rb.damping);
                rb.vels = new_vels;

                // NOTE: if it's a position-based kinematic body, don't writeback as we want
                //       to preserve exactly the value given by the user (it might not be
                //       exactly equal to the integrated position because of rounding errors).
                // A soft-frame proxy's pose is not integrated either: the soft-body sync
                // re-derives it exactly from the particles at the end of the step.
                if (rb.body_type != RigidBodyType::KinematicPositionBased
                    || vs.solver_bodies.flags[i] & SOLVER_BODY_MOTION_RESOLVED != 0)
                    && !rb.is_soft_frame()
                {
                    let local_com = -rb.mprops.local_mprops.local_com;
                    rb.pos.next_position = solver_poses.pose().prepend_translation(local_com);
                }

                // Capture the post-solve velocity used by the CCD sweep — for *every* dynamic
                // body (fast bodies get CCD vs fixed colliders by default), skipped entirely
                // when CCD is globally off (`max_ccd_substeps == 0`) so those users pay nothing.
                if base_params.max_ccd_substeps != 0 && rb.is_dynamic() && !rb.is_soft_frame() {
                    rb.ccd_vels = rb
                        .pos
                        .interpolate_velocity(base_params.inv_dt(), rb.local_center_of_mass());

                    // Fused post-solve CCD activation (fast-body criterion on the
                    // solved motion): replaces the pipeline's serial post-solve
                    // walk over every active body when no multibody is present.
                    let moving_fast = crate::dynamics::post_solve_ccd_active(
                        rb,
                        ctx.motion_colliders,
                        &rb.pos,
                        &rb.ccd_vels,
                        base_params.dt,
                    );
                    rb.ccd.ccd_active = moving_fast;
                    if moving_fast {
                        // SAFETY: shared atomic; claimed slots make the flag
                        // writes disjoint.
                        unsafe { &*ctx.any_ccd_active }.store(true, Ordering::Relaxed);
                    }
                } else {
                    rb.ccd_vels = RigidBodyVelocity::zero();
                }
            }
            done += claimed_len;
        }
        // One completion flush per worker per stage: per-batch RMWs on the
        // shared counter measurably throttle scalar builds (4x the chunks).
        sync.complete(stage, done, all_island_bodies.end);
        // This sync is still needed: the loop above reads `ctx.multibodies`
        // (link lookups) while the block below takes it mutably.
        stage = sync.sync(stage, all_island_bodies.end);

        if worker_id == 0 && ctx.has_multibodies {
            let vs = unsafe { &mut *ctx.velocity_solver };
            let multibodies = unsafe { &mut *ctx.multibodies };
            for link in &vs.multibody_roots {
                let multibody = multibodies
                    .get_multibody_mut_internal(link.multibody)
                    .unwrap();
                let solver_vels = vs
                    .generic_solver_vels
                    .rows(multibody.solver_id as usize, multibody.ndofs());
                multibody.velocities.copy_from(&solver_vels);
            }
        }
        // No sync after the multibody-velocity writeback: nothing follows, and
        // the caller's scope join is the final synchronization point.
        let _ = stage;
    }
}

/// This adapter is constructed only inside the existing worker-0 exclusive
/// borrow after the integration barrier. It contains ordinary references only.
struct MotionApproval<'a> {
    bodies: &'a crate::dynamics::RigidBodySet,
    colliders: &'a crate::geometry::ColliderSet,
    handles: &'a [crate::dynamics::RigidBodyHandle],
    solver: &'a mut crate::dynamics::solver::solver_body::SolverBodies,
    first: usize,
    start_time: Real,
    end_time: Real,
    precise_start: f64,
    precise_end: f64,
    is_last_interval: bool,
    final_view: bool,
}
impl MotionApproval<'_> {
    fn validate(
        &self,
        index: usize,
        value: crate::pipeline::SolverMotionBody,
    ) -> Result<(), crate::pipeline::SolverMotionWriteError> {
        use crate::pipeline::SolverMotionWriteError as E;
        if self.handles.get(index).copied() != Some(value.handle) {
            return Err(E::Index);
        }
        if !value.end.is_finite()
            || !value.linear_velocity.is_finite()
            || !value.angular_velocity.is_finite()
        {
            return Err(E::NonFinite);
        }
        #[cfg(feature = "dim3")]
        let norm = value
            .end
            .rotation
            .to_array()
            .iter()
            .map(|v| {
                let v = f64::from(*v);
                v * v
            })
            .sum::<f64>();
        #[cfg(feature = "dim2")]
        let norm = {
            let re = f64::from(value.end.rotation.re);
            let im = f64::from(value.end.rotation.im);
            re * re + im * im
        };
        // Rotation is a concrete floating quaternion/complex type. Its
        // constructor does not enforce unit length. Match Ferrum's existing
        // admitted body-pose squared-norm error; do not silently normalize.
        if (norm - 1.).abs() > 1e-5 {
            return Err(E::InvalidRotation);
        }
        Ok(())
    }
    fn publish(&mut self, index: usize, value: crate::pipeline::SolverMotionBody) {
        let i = self.first + index;
        let pose = &mut self.solver.poses[i];
        let same_translation = pose.translation.to_array().map(Real::to_bits)
            == value.end.translation.to_array().map(Real::to_bits);
        #[cfg(feature = "dim3")]
        let same_rotation = pose.rotation.to_array().map(Real::to_bits)
            == value.end.rotation.to_array().map(Real::to_bits);
        #[cfg(feature = "dim2")]
        let same_rotation = [pose.rotation.re, pose.rotation.im].map(Real::to_bits)
            == [value.end.rotation.re, value.end.rotation.im].map(Real::to_bits);
        pose.translation = value.end.translation;
        pose.rotation = value.end.rotation;
        let velocity = &mut self.solver.vels[i];
        let same_linear = velocity.linear.to_array().map(Real::to_bits)
            == value.linear_velocity.to_array().map(Real::to_bits);
        #[cfg(feature = "dim3")]
        let same_angular = velocity.angular.to_array().map(Real::to_bits)
            == value.angular_velocity.to_array().map(Real::to_bits);
        #[cfg(feature = "dim2")]
        let same_angular = velocity.angular.to_bits() == value.angular_velocity.to_bits();
        velocity.linear = value.linear_velocity;
        velocity.angular = value.angular_velocity;
        // An unchanged approval must not turn prescribed exact-target
        // writeback into an approximate integrated endpoint. Compare bits so
        // explicit signed-zero changes are retained too.
        if value.keep_integrated_endpoint
            || !(same_translation && same_rotation && same_linear && same_angular)
        {
            self.solver.flags[i] |= SOLVER_BODY_MOTION_RESOLVED;
        }
    }
}
impl crate::pipeline::SolverMotionContext for MotionApproval<'_> {
    fn bodies(&self) -> &crate::dynamics::RigidBodySet {
        self.bodies
    }
    fn colliders(&self) -> &crate::geometry::ColliderSet {
        self.colliders
    }
    fn start_time(&self) -> Real {
        self.start_time
    }
    fn end_time(&self) -> Real {
        self.end_time
    }
    fn precise_start_time(&self) -> f64 {
        self.precise_start
    }
    fn precise_end_time(&self) -> f64 {
        self.precise_end
    }
    fn is_last_interval(&self) -> bool {
        self.is_last_interval
    }
    fn prescribed_motion_resolved(&self, index: usize) -> Option<bool> {
        (index < self.handles.len())
            .then(|| self.solver.flags[self.first + index] & SOLVER_BODY_MOTION_RESOLVED != 0)
    }
    fn body_count(&self) -> usize {
        self.handles.len()
    }
    fn body(&self, index: usize) -> Option<crate::pipeline::SolverMotionBody> {
        let handle = *self.handles.get(index)?;
        let i = self.first + index;
        let pose = self.solver.poses.get(i)?;
        let velocity = self.solver.vels.get(i)?;
        Some(crate::pipeline::SolverMotionBody {
            handle,
            end: if self.final_view
                && self.bodies[handle].body_type() == RigidBodyType::KinematicPositionBased
                && self.solver.flags[i] & SOLVER_BODY_MOTION_RESOLVED == 0
            {
                let body = &self.bodies[handle];
                body.pos
                    .next_position
                    .prepend_translation(body.local_center_of_mass())
            } else {
                pose.pose()
            },
            linear_velocity: velocity.linear,
            angular_velocity: velocity.angular,
            keep_integrated_endpoint: self.solver.flags[i] & SOLVER_BODY_MOTION_RESOLVED != 0,
        })
    }
    fn write_body(
        &mut self,
        index: usize,
        value: crate::pipeline::SolverMotionBody,
    ) -> Result<(), crate::pipeline::SolverMotionWriteError> {
        self.validate(index, value)?;
        self.publish(index, value);
        Ok(())
    }
    fn write_bodies(
        &mut self,
        values: &[(usize, crate::pipeline::SolverMotionBody)],
    ) -> Result<(), crate::pipeline::SolverMotionWriteError> {
        let mut previous = None;
        for &(index, value) in values {
            if previous.is_some_and(|p| p >= index) {
                return Err(crate::pipeline::SolverMotionWriteError::IndexOrder);
            }
            self.validate(index, value)?;
            previous = Some(index);
        }
        // No fallible operation or external callback occurs after validation.
        for &(index, value) in values {
            self.publish(index, value);
        }
        Ok(())
    }
}

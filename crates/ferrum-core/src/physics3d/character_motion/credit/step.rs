//! Exactly the rigid backend state the staged solver may change before accepting time.
//! Geometry, arenas, stable handles and the full engine snapshot are never serialized here.
use crate::physics3d::{
    solver_trajectory::{TrajectoryError, Work},
    PhysicsWorld3d,
};
use postcard::ser_flavors::Flavor;
use rapier3d::prelude as rp;

#[derive(Default)]
pub(in crate::physics3d) struct StepRollback {
    rows: rp::RigidStepCredit,
    graphs: Vec<u8>,
    reserved: usize,
    active: bool,
}

struct Buffer<'a> {
    bytes: &'a mut Vec<u8>,
    limit: usize,
}

impl Flavor for Buffer<'_> {
    type Output = ();

    fn try_push(&mut self, value: u8) -> postcard::Result<()> {
        self.try_extend(&[value])
    }

    fn try_extend(&mut self, input: &[u8]) -> postcard::Result<()> {
        let required = self
            .bytes
            .len()
            .checked_add(input.len())
            .ok_or(postcard::Error::SerializeBufferFull)?;
        if required > self.limit {
            return Err(postcard::Error::SerializeBufferFull);
        }
        if required > self.bytes.capacity() {
            let cap = self
                .bytes
                .capacity()
                .saturating_mul(2)
                .max(required)
                .min(self.limit);
            self.bytes
                .try_reserve_exact(cap - self.bytes.len())
                .map_err(|_| postcard::Error::SerializeBufferFull)?;
        }
        self.bytes.extend_from_slice(input);
        Ok(())
    }

    fn finalize(self) -> postcard::Result<()> {
        Ok(())
    }
}

impl PhysicsWorld3d {
    pub(in crate::physics3d) fn begin_backend_step_rollback(
        &mut self,
    ) -> Result<(), TrajectoryError> {
        // Temporarily detach the previous backing so the fresh admission starts
        // with the full allowance; on any failure its allocations are released.
        let mut journal = std::mem::take(&mut self.character_motion.rollback);
        let work = journal.prepare(self)?;
        self.commit_saved_motion_proof_work(work)?;
        self.character_motion.rollback = journal;
        Ok(())
    }

    pub(in crate::physics3d) fn finish_backend_step_rollback(&mut self) {
        let restore =
            self.actual_motion_completed_time() == 0. && self.actual_motion_result().is_err();
        let journal = &mut self.character_motion.rollback;
        if std::mem::take(&mut journal.active) && restore {
            // These bytes have no file/host entry point. Only the built-in rigid
            // dispatcher and its deserializable workspaces can reach this journal.
            // Drop the tentative owner allocations before rebuilding their originals.
            self.backend.islands = rp::IslandManager::new();
            self.backend.narrow_phase = rp::NarrowPhase::new();
            self.backend.impulse_joints = rp::ImpulseJointSet::new();
            let (islands, narrow, joints) = postcard::from_bytes(&journal.graphs)
                .expect("trusted rigid step journal must restore its own graph types");
            self.backend.islands = islands;
            self.backend.narrow_phase = narrow;
            self.backend.impulse_joints = joints;
            journal.rows.restore(&mut self.backend);
            // The scratch solvers must not retain cached indices into the discarded graphs.
            self.backend.physics_pipeline = rp::PhysicsPipeline::new();
            self.backend.collision_pipeline = rp::CollisionPipeline::new();
            self.backend.ccd_solver = rp::CCDSolver::new();
            self.backend
                .ccd_solver
                .set_diagnostic_limit(self.config.max_events);
            // Swaps may have returned much larger tentative solver arrays. They
            // have never been admitted as reusable scratch for another step.
            *journal = StepRollback::default();
        }
        journal.graphs.clear();
    }
}

// Fixed-size buckets make the active reservation independent of earlier
// scene sizes, while allowing small graph-size fluctuations in a warm scene.
fn graph_reservation(bytes: usize, limit: usize) -> usize {
    let block = if bytes <= 4096 { 64 } else { 1024 };
    bytes.div_ceil(block).saturating_mul(block).min(limit)
}

impl StepRollback {
    fn prepare(&mut self, world: &PhysicsWorld3d) -> Result<Work, TrajectoryError> {
        let backend = &world.backend;
        let limit = world.actual_motion_scratch_bound()?;
        let (sort_bytes, sort_work) = backend
            .rigid_step_graph_sort_cost()
            .ok_or(TrajectoryError::WorkLimit)?;
        let mut work = world.saved_motion_proof_work();
        work.charge(
            rp::RigidStepCredit::sizing_visits(backend).ok_or(TrajectoryError::WorkLimit)? as u64,
        )?;
        let row_bytes = self
            .rows
            .trim_and_size(backend)
            .ok_or(TrajectoryError::WorkLimit)?;
        let initial_work = backend
            .bodies
            .motion_storage_slots()
            .checked_add(backend.colliders.motion_storage_slots())
            .and_then(|n| n.checked_add(sort_work))
            .and_then(|n| n.checked_add(row_bytes.div_ceil(std::mem::size_of::<usize>())))
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(initial_work as u64)?;
        let limit = limit
            .checked_sub(sort_bytes)
            .and_then(|v| v.checked_sub(row_bytes))
            .ok_or(TrajectoryError::WorkLimit)?;
        let limit = limit.min(usize::try_from(work.limit - work.used).unwrap_or(usize::MAX));
        if self.graphs.capacity() > limit {
            self.graphs = Vec::new();
        }
        self.graphs.clear();
        let graphs = (
            &backend.islands,
            &backend.narrow_phase,
            &backend.impulse_joints,
        );
        postcard::serialize_with_flavor(
            &graphs,
            Buffer {
                bytes: &mut self.graphs,
                limit,
            },
        )
        .map_err(|_| TrajectoryError::WorkLimit)?;
        work.charge(self.graphs.len() as u64)?;
        let graph_capacity = graph_reservation(self.graphs.len(), limit);
        if self.graphs.capacity() > graph_capacity {
            self.graphs.shrink_to(graph_capacity);
        }
        if self.graphs.capacity() > graph_capacity {
            return Err(TrajectoryError::WorkLimit);
        }
        self.rows
            .capture(backend)
            .ok_or(TrajectoryError::WorkLimit)?;
        if self
            .rows
            .retained_bytes()
            .ok_or(TrajectoryError::WorkLimit)?
            > row_bytes
        {
            return Err(TrajectoryError::WorkLimit);
        }
        self.reserved = row_bytes + graph_capacity;
        self.active = true;
        Ok(work)
    }

    pub(in crate::physics3d) fn reserved(&self) -> usize {
        self.reserved
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::WorldConfig;

    #[test]
    fn rigid_step_credit_keeps_warm_storage_bounded_when_dense_adjacency_moves() {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let centers = [0., 32., 64., 96.];
        let hubs = centers.map(|x| {
            world
                .backend
                .insert(
                    rp::RigidBodyBuilder::fixed().translation(rp::Vector::new(x, 0., 0.)),
                    rp::ColliderBuilder::ball(8.).sensor(true),
                )
                .1
        });
        let movers: Vec<_> = (0..10)
            .map(|_| {
                world.backend.insert(
                    rp::RigidBodyBuilder::dynamic(),
                    rp::ColliderBuilder::ball(0.125),
                )
            })
            .collect();
        let mut journal = StepRollback {
            graphs: Vec::with_capacity(1024 * 1024),
            ..StepRollback::default()
        };
        for (hub, x) in hubs.into_iter().zip(centers).cycle().take(8) {
            for (i, &(handle, _)) in movers.iter().enumerate() {
                world.backend.bodies[handle]
                    .set_translation(rp::Vector::new(x, i as f32 - 5., 0.), true);
            }
            world.backend.step();
            assert!(movers.iter().all(|&(_, collider)| world
                .backend
                .narrow_phase
                .intersection_pair(hub, collider)
                == Some(true)));
            journal.prepare(&world).unwrap();
            let mut fresh = StepRollback::default();
            fresh.prepare(&world).unwrap();
            assert_eq!(journal.reserved(), fresh.reserved());
            let rows = journal.rows.retained_bytes().unwrap();
            assert_eq!(rows, fresh.rows.retained_bytes().unwrap());
            assert!(journal.graphs.capacity() <= journal.reserved() - rows);
            let buffer = journal.graphs.as_ptr();
            journal.prepare(&world).unwrap();
            assert_eq!(journal.graphs.as_ptr(), buffer);
        }
    }
}

//! Reusable bounded journal of the local character/preplan producer effects.
//! It never clones/restores the arena, native contact solver, islands or BVH.
use crate::physics3d::{
    character::interval_credit::Credit,
    solver_trajectory::{TrajectoryError, Work},
    world::native_id,
    BodyId, ColliderId, PhysicsWorld3d,
};
use rapier3d::prelude as rp;

struct NativeCredit {
    body: BodyId,
    credit: rp::RigidBodyMotionCredit,
}
#[derive(Default)]
pub(in crate::physics3d) struct CharacterIntervalCredit {
    characters: Vec<(BodyId, Credit)>,
    native: Vec<NativeCredit>,
    hooks: Vec<(rp::ColliderHandle, rp::ActiveHooks)>,
    pairs: Vec<(ColliderId, ColliderId)>,
    ready: bool,
    max_pairs: usize,
}
fn reserve<T>(v: &mut Vec<T>, len: usize) -> Result<(), TrajectoryError> {
    v.try_reserve(len.saturating_sub(v.len()))
        .map_err(|_| TrajectoryError::WorkLimit)
}
impl CharacterIntervalCredit {
    /// The original grounded, non-jumping support is a saved producer token,
    /// not proof that the current carrier is live or still supports this body.
    /// The actual motion owner rechecks that state before building its curve.
    pub fn original_carry_support(&self, body: BodyId) -> Option<BodyId> {
        if !self.ready {
            return None;
        }
        self.characters
            .binary_search_by_key(&body, |entry| entry.0)
            .ok()
            .and_then(|i| self.characters[i].1.original_carry_support())
    }
    pub fn capture(
        &mut self,
        world: &mut PhysicsWorld3d,
        work: &mut Work,
        max_scratch: usize,
    ) -> Result<usize, TrajectoryError> {
        self.ready = false;
        let c = world.characters.len();
        let n = world.backend.bodies.len();
        let h = world.backend.colliders.len();
        let p = world.contact_policies.character_dynamic_pairs.len();
        let queue_bytes = n
            .checked_mul(std::mem::size_of::<rp::RigidBodyHandle>())
            .and_then(|v| {
                h.checked_mul(std::mem::size_of::<rp::ColliderHandle>())
                    .and_then(|a| v.checked_add(a))
            })
            .ok_or(TrajectoryError::WorkLimit)?;
        let bytes = c
            .checked_mul(std::mem::size_of::<(BodyId, Credit)>())
            .and_then(|v| {
                n.checked_mul(std::mem::size_of::<NativeCredit>())
                    .and_then(|a| v.checked_add(a))
            })
            .and_then(|v| {
                h.checked_mul(std::mem::size_of::<(rp::ColliderHandle, rp::ActiveHooks)>())
                    .and_then(|a| v.checked_add(a))
            })
            .and_then(|v| {
                p.checked_mul(std::mem::size_of::<(ColliderId, ColliderId)>())
                    .and_then(|a| v.checked_add(a))
            })
            .and_then(|v| v.checked_add(queue_bytes))
            .ok_or(TrajectoryError::WorkLimit)?;
        if bytes > max_scratch {
            return Err(TrajectoryError::WorkLimit);
        }
        let max_pairs = p
            .checked_add(c.checked_mul(256).ok_or(TrajectoryError::WorkLimit)?)
            .ok_or(TrajectoryError::WorkLimit)?;
        let log = if p == 0 {
            1
        } else {
            usize::BITS as usize - p.leading_zeros() as usize + 1
        };
        let visits = world
            .backend
            .bodies
            .motion_storage_slots()
            .checked_add(world.backend.colliders.motion_storage_slots())
            .and_then(|slots| c.checked_mul(256).and_then(|n| slots.checked_add(n)))
            .and_then(|v| n.checked_mul(64).and_then(|a| v.checked_add(a)))
            .and_then(|v| h.checked_mul(8).and_then(|a| v.checked_add(a)))
            .and_then(|v| {
                max_pairs
                    .checked_mul(log + 4)
                    .and_then(|a| v.checked_add(a))
            })
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(u64::try_from(visits).map_err(|_| TrajectoryError::WorkLimit)?)?;
        reserve(&mut self.characters, c)?;
        reserve(&mut self.native, n)?;
        reserve(&mut self.hooks, h)?;
        reserve(&mut self.pairs, p)?;
        world
            .backend
            .bodies
            .try_reserve_motion_credit_returns(n)
            .map_err(|_| TrajectoryError::WorkLimit)?;
        world
            .backend
            .colliders
            .try_reserve_motion_credit_returns(h)
            .map_err(|_| TrajectoryError::WorkLimit)?;
        self.max_pairs = max_pairs;
        self.characters.clear();
        self.native.clear();
        self.hooks.clear();
        self.pairs.clear();
        self.characters.extend(
            world
                .characters
                .iter()
                .map(|(&id, r)| (id, r.interval_credit())),
        );
        self.native
            .extend(world.backend.bodies.iter().map(|(id, b)| {
                let (slot, generation) = id.into_raw_parts();
                NativeCredit {
                    body: BodyId { slot, generation },
                    credit: b.motion_credit(),
                }
            }));
        self.hooks.extend(
            world
                .backend
                .colliders
                .iter()
                .map(|(id, c)| (id, c.active_hooks())),
        );
        self.pairs.extend(
            world
                .contact_policies
                .character_dynamic_pairs
                .iter()
                .copied(),
        );
        self.ready = true;
        Ok(bytes)
    }
    /// Only call when the corresponding candidate interval committed zero body
    /// time. Cache/island/user-change bookkeeping is intentionally not reverted.
    pub fn rollback(&mut self, world: &mut PhysicsWorld3d) -> Result<(), TrajectoryError> {
        if !self.ready {
            return Err(TrajectoryError::InvalidReference);
        }
        // No producer may add/remove bodies, colliders or characters inside a
        // local step. Reject an invalid caller before changing any field.
        if world.contact_policies.character_dynamic_pairs.len() > self.max_pairs {
            return Err(TrajectoryError::WorkLimit);
        }
        if self
            .characters
            .iter()
            .any(|(id, _)| !world.characters.contains_key(id))
            || self
                .native
                .iter()
                .any(|c| !world.backend.bodies.contains(native_id(c.body)))
            || self
                .hooks
                .iter()
                .any(|(id, _)| !world.backend.colliders.contains(*id))
        {
            return Err(TrajectoryError::InvalidReference);
        }
        for (id, c) in &self.characters {
            world
                .characters
                .get_mut(id)
                .expect("prevalidated credit owner")
                .return_interval_credit(c);
        }
        for c in &self.native {
            let b = world
                .backend
                .bodies
                .get_mut(native_id(c.body))
                .expect("prevalidated credit body");
            b.return_motion_credit(&c.credit);
        }
        for &(id, hooks) in &self.hooks {
            if world.backend.colliders[id].active_hooks() != hooks {
                world
                    .backend
                    .colliders
                    .get_mut(id)
                    .expect("prevalidated credit collider")
                    .set_active_hooks(hooks);
            }
        }
        // The preplan only inserts these keys. Remove its new keys without
        // rebuilding or allocating a replacement tree.
        world
            .contact_policies
            .character_dynamic_pairs
            .retain(|pair| self.pairs.binary_search(pair).is_ok());
        world.character_dynamics.invalidate();
        self.ready = false;
        Ok(())
    }
    pub fn commit(&mut self) {
        self.ready = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::{
        BodyDesc, BodyKind, CharacterConfig, CharacterInput, ColliderDesc, Pose, Shape, WorldConfig,
    };
    fn fixture() -> (PhysicsWorld3d, BodyId, BodyId) {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let actor = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.25,
                    radius: 0.25,
                }),
            )
            .unwrap();
        let target = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Dynamic,
                    pose: Pose {
                        position: [0.505, 0., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.25; 3],
                }),
            )
            .unwrap();
        world
            .enable_character(
                actor,
                CharacterConfig {
                    push_mass: 10.,
                    step_height: 0.,
                    snap_distance: 0.,
                    ..CharacterConfig::default()
                },
            )
            .unwrap();
        world
            .set_character_input(
                actor,
                CharacterInput {
                    velocity: [5., 0., 0.],
                    jump_speed: 3.,
                },
            )
            .unwrap();
        world.apply_character_impulse(actor, [2., 0., 0.]).unwrap();
        world.add_character_force(actor, [1., 0., 0.]).unwrap();
        world.add_force(target, [0., 0., 1.], [0.; 3]).unwrap();
        world.refresh_queries();
        (world, actor, target)
    }
    #[test]
    fn zero_time_preplan_credit_returns_pending_input_impulse_and_native_momentum() {
        let (mut world, actor, target) = fixture();
        let character = postcard::to_allocvec(&world.characters[&actor]).unwrap();
        let body = world.body_state(target).unwrap();
        let force = world.backend.bodies[native_id(target)].user_force();
        let mut credit = CharacterIntervalCredit::default();
        let mut work = Work {
            used: 0,
            limit: u64::MAX,
        };
        credit.capture(&mut world, &mut work, usize::MAX).unwrap();
        world.step_characters();
        world.solve_character_dynamic_contacts();
        assert_ne!(
            postcard::to_allocvec(&world.characters[&actor]).unwrap(),
            character
        );
        assert_ne!(
            world.body_state(target).unwrap().linear_velocity,
            body.linear_velocity
        );
        credit.rollback(&mut world).unwrap();
        assert_eq!(
            postcard::to_allocvec(&world.characters[&actor]).unwrap(),
            character
        );
        assert_eq!(world.body_state(target).unwrap(), body);
        assert_eq!(world.backend.bodies[native_id(target)].user_force(), force);
        assert_eq!(
            credit.rollback(&mut world),
            Err(TrajectoryError::InvalidReference)
        );
        // Native query/contact caches may have been refreshed by preplanning;
        // this test proves local command/momentum credit, not world byte rollback.
    }
    #[test]
    fn interval_credit_capture_exact_and_one_below_limits_precede_command_changes() {
        let (mut world, actor, target) = fixture();
        let before = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
        let mut credit = CharacterIntervalCredit::default();
        let mut work = Work {
            used: 0,
            limit: u64::MAX,
        };
        let bytes = credit.capture(&mut world, &mut work, usize::MAX).unwrap();
        credit.commit();
        let mut exact = Work {
            used: 0,
            limit: work.used,
        };
        assert_eq!(credit.capture(&mut world, &mut exact, bytes), Ok(bytes));
        credit.commit();
        for (limit, scratch) in [(work.used - 1, bytes), (work.used, bytes - 1)] {
            let mut quota = Work { used: 0, limit };
            assert_eq!(
                credit.capture(&mut world, &mut quota, scratch),
                Err(TrajectoryError::WorkLimit)
            );
        }
        assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), before);
        assert_eq!(world.body_state(target).unwrap().linear_velocity, [0.; 3]);
        assert_eq!(world.characters[&actor].pending_impulse, [2., 0., 0.]);
    }
}

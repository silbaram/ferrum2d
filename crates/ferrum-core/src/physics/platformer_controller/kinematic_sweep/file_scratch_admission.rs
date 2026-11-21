use super::*;
use crate::collision::file_scratch_admission::{
    self as f, Budget, Error, Limits, Owner, Problem, Usage,
};
#[allow(dead_code)]
impl KinematicSweepScratch {
    /// World/native admission is the caller's earlier phase. Historical scratch
    /// has no World epoch: even Some(actor) is not proof of current geometry.
    pub(crate) fn validate_file(&self, _world: &World, limits: Limits) -> Result<Usage, Error> {
        let mut b = Budget::new(limits);
        self.validate_file_with_budget(&mut b)?;
        Ok(b.usage)
    }
    pub(crate) fn validate_file_with_budget(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            collision: _,
            candidates: _,
            spatial_tile_contacts: _,
            debug_hits: _,
            debug_truncated: _,
            capture_debug_hits: _,
            spatial_query_actor: _,
            spatial_segment_targets: _,
            spatial_segment_active: _,
        } = self;
        b.work(9)?;
        self.collision.validate_file_with_budget(b)?;
        f::keys(&self.candidates, b, Owner::Kinematic, "candidates")?;
        f::keys(
            &self.spatial_segment_targets,
            b,
            Owner::Kinematic,
            "spatial_segment_targets",
        )?;
        b.vector(&self.spatial_tile_contacts)?;
        b.vector(&self.debug_hits)?;
        f::require(
            self.debug_hits.len() <= 128 && (!self.debug_truncated || self.debug_hits.len() == 128),
            Owner::Kinematic,
            "debug_hits",
            0,
            Problem::Length,
        )?;
        f::require(
            !self.spatial_segment_active || self.spatial_query_actor.is_some(),
            Owner::Kinematic,
            "spatial_segment_active",
            0,
            Problem::History,
        )?;
        for (i, v) in self.spatial_tile_contacts.iter().enumerate() {
            f::require(
                f::finite(&[v.normal_x, v.normal_y, v.penetration, v.point_x, v.point_y])
                    && v.penetration >= 0.0,
                Owner::Kinematic,
                "spatial_tile_contacts",
                i,
                Problem::Number,
            )?;
        }
        for (i, v) in self.debug_hits.iter().enumerate() {
            f::require(
                f::finite(&[v.point.x, v.point.y, v.normal.vx, v.normal.vy])
                    && v.span.is_none_or(f::span),
                Owner::Kinematic,
                "debug_hits",
                i,
                Problem::Number,
            )?;
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::collision::file_scratch_admission::test_support as t;
    fn source() -> (World, Vec<Entity>, KinematicSweepScratch) {
        let (w, es) = t::fixture();
        let mut s = KinematicSweepScratch::default();
        s.begin_spatial_query(&w, es[1]);
        s.begin_spatial_segment(
            &w,
            es[1],
            Transform2D::default(),
            Transform2D { x: 5.0, y: 5.0 },
        );
        s.build_candidates(
            &w,
            es[1],
            KinematicSweepCandidateQuery {
                moving_index: es[1].id as usize,
                ignored_index: None,
                moving_start: Transform2D::default(),
                moving_collider: w.collider(es[1]).unwrap(),
                remaining: Velocity { vx: 5.0, vy: 5.0 },
            },
        );
        s.begin_debug_capture(true);
        for _ in 0..129 {
            s.record_debug_hit(
                KinematicHit {
                    entity: Some(es[0]),
                    contact: SweptAabbContactHit {
                        time: 0.0,
                        normal_x: -1.0,
                        normal_y: 0.0,
                    },
                },
                Transform2D { x: -0.0, y: 1.0 },
                w.collider(es[1]).unwrap(),
                Some(
                    HeightSpan::new(crate::components::PhysicsFloorId(u32::MAX), -1.0, 0.0)
                        .unwrap(),
                ),
            );
        }
        (w, es, s)
    }
    #[test]
    fn file_scratch_kinematic_some_actor_and_targets_remain_historical_after_geometry_despawn() {
        let (mut w, es, mut s) = source();
        assert!(s.spatial_segment_active && s.debug_truncated);
        let before = t::bytes(&s);
        w.despawn(es[1]);
        w.set_transform(
            es[0],
            Transform2D {
                x: 1000.0,
                y: 1000.0,
            },
        );
        s.validate_file(&w, t::limits()).unwrap();
        assert_eq!(t::bytes(&s), before);
        let mut r: KinematicSweepScratch = t::restored(&s);
        r.validate_file(&w, t::limits()).unwrap();
        assert_eq!(t::bytes(&r), before);
        for scratch in [&mut s, &mut r] {
            scratch.end_spatial_query();
            scratch.begin_spatial_query(&w, es[2]);
            scratch.end_spatial_query();
            scratch.validate_file(&w, t::limits()).unwrap();
        }
        assert_eq!(t::bytes(&s), t::bytes(&r));
    }
    #[test]
    fn file_scratch_kinematic_flags_keys_debug_and_numeric_failures_are_typed() {
        let (w, _, s) = source();
        type Corruption = fn(&mut KinematicSweepScratch);
        let cases: [Corruption; 5] = [
            |s| s.spatial_query_actor = None,
            |s| {
                s.debug_hits.pop();
            },
            |s| s.debug_hits[0].point.x = f32::NAN,
            |s| s.spatial_segment_targets.push(s.spatial_segment_targets[0]),
            |s| {
                s.candidates.push(ColliderKey {
                    entity_index: 0,
                    collider_index: 0,
                    segment_index: 64,
                })
            },
        ];
        for corrupt in cases {
            let mut c = s.clone();
            corrupt(&mut c);
            let before = t::bytes(&c);
            assert!(matches!(
                c.validate_file(&w, t::limits()),
                Err(Error::Invalid { .. })
            ));
            assert_eq!(t::bytes(&c), before);
        }
    }
    #[test]
    fn file_scratch_kinematic_exact_and_one_below_preserve_codec() {
        let (w, _, s) = source();
        let before = t::bytes(&s);
        t::check_budgets(|limits| s.validate_file(&w, limits));
        assert_eq!(t::bytes(&s), before);
    }
}
#[cfg(test)]
mod tile_tests {
    use super::*;
    use crate::collision::file_scratch_admission::test_support as t;
    #[test]
    fn file_scratch_kinematic_actual_tile_contact_payload_and_stale_indices() {
        let (mut w, es) = t::fixture();
        w.set_aabb_collider(
            es[1],
            AabbCollider::new(1.0, 1.0, false, crate::components::CollisionLayer::Player),
        );
        let mut map = Tilemap::default();
        map.set_layer(0, 1, 1, 10.0, 10.0, 100.0, 100.0, true, vec![1]);
        let mut s = KinematicSweepScratch::default();
        assert!(spatial_pose_overlaps_solid(
            &w,
            &map,
            es[1],
            Transform2D { x: 105.0, y: 105.0 },
            &mut s,
            None,
            CollisionMask::ALL
        ));
        assert!(!s.spatial_tile_contacts.is_empty());
        let before = t::bytes(&s);
        map.clear();
        w.despawn(es[1]);
        s.validate_file(&w, t::limits()).unwrap();
        assert_eq!(t::bytes(&s), before);
        let r: KinematicSweepScratch = t::restored(&s);
        r.validate_file(&w, t::limits()).unwrap();
        assert_eq!(t::bytes(&r), before);
        s.spatial_tile_contacts[0].point_x = f32::NAN;
        let before = t::bytes(&s);
        assert!(matches!(
            s.validate_file(&w, t::limits()),
            Err(Error::Invalid { .. })
        ));
        assert_eq!(t::bytes(&s), before);
    }
}

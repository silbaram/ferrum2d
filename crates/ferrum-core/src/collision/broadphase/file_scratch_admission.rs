use super::*;
use crate::collision::file_scratch_admission::{
    self as f, Budget, Error, Limits, Owner, Problem, Usage,
};
#[allow(dead_code)]
impl CollisionScratch {
    pub(crate) fn validate_file(&self, _world: &World, limits: Limits) -> Result<Usage, Error> {
        let mut b = Budget::new(limits);
        self.validate_file_with_budget(&mut b)?;
        Ok(b.usage)
    }
    pub(crate) fn validate_file_with_budget(&self, b: &mut Budget) -> Result<(), Error> {
        let Self {
            static_entries: _,
            static_proxies: _,
            dynamic_proxies: _,
            current_proxies: _,
            moving_proxies: _,
            target_proxies: _,
            collider_pairs: _,
            pair_dedupe: _,
            kinematic_target_visits: _,
        } = self;
        b.work(9)?;
        b.vector(&self.static_entries)?;
        b.vector(&self.collider_pairs)?;
        b.vector(&self.pair_dedupe)?;
        for (name, v) in [
            ("static_proxies", &self.static_proxies),
            ("dynamic_proxies", &self.dynamic_proxies),
            ("current_proxies", &self.current_proxies),
            ("moving_proxies", &self.moving_proxies),
            ("target_proxies", &self.target_proxies),
        ] {
            validate_proxies(v, b, name)?;
        }
        f::require(
            self.static_entries.len() == self.static_proxies.len(),
            Owner::Collision,
            "static_cache",
            0,
            Problem::Length,
        )?;
        b.sort(self.static_entries.len())?;
        let mut entries = b.reserve::<((usize, usize, usize), usize)>(self.static_entries.len())?;
        for (i, e) in self.static_entries.iter().enumerate() {
            b.work(
                crate::components::MAX_CONVEX_POLYGON_VERTICES
                    * crate::components::MAX_CONVEX_POLYGON_VERTICES,
            )?;
            f::require(
                f::key(e.key) && f::finite(&[e.transform.x, e.transform.y]) && f::shape(e.shape),
                Owner::Collision,
                "static_entries",
                i,
                Problem::Geometry,
            )?;
            f::require(
                matches!(e.shape, ColliderShapeRef::Edge(_)) || e.key.segment_index == 0,
                Owner::Collision,
                "static_entries",
                i,
                Problem::Key,
            )?;
            entries.push((f::key_tuple(e.key), i));
        }
        entries.sort_unstable_by_key(|x| x.0);
        f::require(
            !entries.windows(2).any(|w| w[0].0 == w[1].0),
            Owner::Collision,
            "static_entries",
            0,
            Problem::Duplicate,
        )?;
        let search = (usize::BITS - entries.len().leading_zeros()) as usize + 1;
        b.work(
            self.static_proxies
                .len()
                .checked_mul(search)
                .ok_or(Error::WorkLimit)?,
        )?;
        for (i, p) in self.static_proxies.iter().enumerate() {
            let at = entries
                .binary_search_by_key(&f::key_tuple(p.key), |x| x.0)
                .map_err(|_| Error::Invalid {
                    owner: Owner::Collision,
                    field: "static_proxies",
                    index: i,
                    problem: Problem::Reference,
                })?;
            let e = self.static_entries[entries[at].1];
            b.work(
                crate::components::MAX_CONVEX_POLYGON_VERTICES
                    * crate::components::MAX_CONVEX_POLYGON_VERTICES,
            )?;
            let expected = collider_bounds(e.transform, e.shape);
            f::require(
                bounds_equal(expected, p.bounds),
                Owner::Collision,
                "static_proxies",
                i,
                Problem::Geometry,
            )?;
        }
        for (i, &p) in self.collider_pairs.iter().enumerate() {
            f::require(
                f::collider_pair(p),
                Owner::Collision,
                "collider_pairs",
                i,
                Problem::Reference,
            )?;
        }
        b.sort(self.pair_dedupe.len())?;
        let mut dedupe = b.reserve::<CollisionPairKey>(self.pair_dedupe.len())?;
        b.sort(self.pair_dedupe.len())?;
        let mut orders = b.reserve::<usize>(self.pair_dedupe.len())?;
        for (i, e) in self.pair_dedupe.iter().enumerate() {
            let direct = CollisionPairKey::from_pair(e.pair);
            let reversed = CollisionPairKey::from_pair(CollisionPair {
                a: e.pair.b,
                b: e.pair.a,
            });
            let canonical = direct.min(reversed);
            f::require(
                f::pair(e.pair) && (e.key == direct || e.key == canonical),
                Owner::Collision,
                "pair_dedupe",
                i,
                Problem::Key,
            )?;
            dedupe.push(e.key);
            orders.push(e.first_order);
        }
        dedupe.sort_unstable();
        orders.sort_unstable();
        f::require(
            !dedupe.windows(2).any(|w| w[0] == w[1]) && !orders.windows(2).any(|w| w[0] == w[1]),
            Owner::Collision,
            "pair_dedupe",
            0,
            Problem::Duplicate,
        )?;
        let by_key = self.pair_dedupe.windows(2).all(|w| w[0].key < w[1].key);
        let by_order = self
            .pair_dedupe
            .windows(2)
            .all(|w| w[0].first_order < w[1].first_order);
        f::require(
            by_key || by_order,
            Owner::Collision,
            "pair_dedupe",
            0,
            Problem::Order,
        )?;
        // visits belongs to the last kinematic preparation; later query kinds can
        // replace targets independently, so no current-count equality is valid.
        Ok(())
    }
}
fn bounds_equal(a: AabbBounds, b: AabbBounds) -> bool {
    [a.min_x, a.min_y, a.max_x, a.max_y]
        .iter()
        .zip([b.min_x, b.min_y, b.max_x, b.max_y])
        .all(|(a, b)| a.to_bits() == b.to_bits())
}
fn validate_proxies(
    v: &Vec<CollisionProxy>,
    b: &mut Budget,
    name: &'static str,
) -> Result<(), Error> {
    b.vector(v)?;
    b.sort(v.len())?;
    let mut keys = b.reserve::<(usize, usize, usize)>(v.len())?;
    for (i, p) in v.iter().enumerate() {
        f::require(
            f::key(p.key)
                && f::finite(&[
                    p.bounds.min_x,
                    p.bounds.min_y,
                    p.bounds.max_x,
                    p.bounds.max_y,
                ]),
            Owner::Collision,
            name,
            i,
            Problem::Number,
        )?;
        if i > 0 {
            f::require(
                proxy_order(&v[i - 1], p).is_lt(),
                Owner::Collision,
                name,
                i,
                Problem::Order,
            )?;
        }
        keys.push(f::key_tuple(p.key));
    }
    keys.sort_unstable();
    f::require(
        !keys.windows(2).any(|w| w[0] == w[1]),
        Owner::Collision,
        name,
        0,
        Problem::Duplicate,
    )
}
#[cfg(test)]
impl CollisionScratch {
    pub(crate) fn file_corrupt_fixture(&mut self) {
        self.static_proxies[0].bounds.max_x += 1.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collision::file_scratch_admission::test_support as t;
    #[test]
    fn file_scratch_collision_all_shapes_stale_world_history_actual_codec_and_refresh() {
        let (mut w, es) = t::fixture();
        let mut s = CollisionScratch::default();
        let mut pairs = Vec::new();
        CollisionSystem::build_pairs_into(&mut s, &w, &mut pairs);
        assert!(s.static_entries.len() >= 8);
        let mut kinds = std::collections::HashSet::new();
        for e in &s.static_entries {
            kinds.insert(std::mem::discriminant(&e.shape));
        }
        assert_eq!(kinds.len(), 6);
        assert!(s
            .static_proxies
            .iter()
            .any(|p| p.bounds.min_x > p.bounds.max_x));
        let before = t::bytes(&s);
        s.validate_file(&w, t::limits()).unwrap();
        assert_eq!(t::bytes(&s), before);
        w.set_transform(es[0], Transform2D { x: 100.0, y: -0.0 });
        w.despawn(es[4]);
        let e = w.spawn_entity();
        w.set_transform(e, Transform2D { x: -50.0, y: 0.0 });
        w.set_aabb_collider(e, AabbCollider::new(2.0, 2.0, false, CollisionLayer::Wall));
        s.validate_file(&w, t::limits()).unwrap();
        assert_eq!(t::bytes(&s), before);
        let mut r: CollisionScratch = t::restored(&s);
        assert_eq!(t::bytes(&r), before);
        r.validate_file(&w, t::limits()).unwrap();
        CollisionSystem::build_pairs_into(&mut s, &w, &mut pairs);
        let mut other = Vec::new();
        CollisionSystem::build_pairs_into(&mut r, &w, &mut other);
        assert_eq!(pairs, other);
        assert_eq!(t::bytes(&s), t::bytes(&r));
        s.validate_file(&w, t::limits()).unwrap();
        for bound in [0, 1, 5, 1000] {
            CollisionSystem::build_pairs_bounded_into(&mut s, &w, &mut pairs, bound, bound);
            s.validate_file(&w, t::limits()).unwrap();
        }
        CollisionSystem::build_swept_layer_pairs_into(
            &mut s,
            &w,
            CollisionLayer::Wall,
            CollisionLayer::Wall,
            0.1,
            &mut pairs,
        );
        s.validate_file(&w, t::limits()).unwrap();
    }
    #[test]
    fn file_scratch_collision_local_geometry_order_keys_and_dedupe_rejections_preserve_bytes() {
        let (w, _) = t::fixture();
        let mut source = CollisionScratch::default();
        CollisionSystem::build_pairs_into(&mut source, &w, &mut Vec::new());
        assert!(!source.pair_dedupe.is_empty());
        type Corruption = fn(&mut CollisionScratch);
        let cases: [Corruption; 8] = [
            |s| {
                s.static_proxies.pop();
            },
            |s| s.static_proxies[0].bounds.max_x += 1.0,
            |s| s.static_entries[0].key.segment_index = 64,
            |s| s.static_entries[0].transform.x = f32::NAN,
            |s| s.current_proxies.reverse(),
            |s| {
                s.target_proxies.push(CollisionProxy {
                    key: s.static_entries[0].key,
                    bounds: AabbBounds {
                        min_x: f32::INFINITY,
                        min_y: 0.0,
                        max_x: 0.0,
                        max_y: 0.0,
                    },
                })
            },
            |s| {
                s.collider_pairs.push(ColliderPair {
                    a: s.current_proxies[0].key,
                    b: s.current_proxies[0].key,
                })
            },
            |s| s.pair_dedupe.push(s.pair_dedupe[0]),
        ];
        for corrupt in cases {
            let mut s = source.clone();
            corrupt(&mut s);
            let before = t::bytes(&s);
            assert!(matches!(
                s.validate_file(&w, t::limits()),
                Err(Error::Invalid { .. })
            ));
            assert_eq!(t::bytes(&s), before);
        }
    }
    #[test]
    fn file_scratch_collision_exact_and_one_below_work_scratch_keep_source() {
        let (w, _) = t::fixture();
        let mut s = CollisionScratch::default();
        CollisionSystem::build_pairs_into(&mut s, &w, &mut Vec::new());
        let before = t::bytes(&s);
        t::check_budgets(|limits| s.validate_file(&w, limits));
        assert_eq!(t::bytes(&s), before);
    }
}

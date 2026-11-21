use super::*;
use crate::engine::file_controller_admission::{finite, Budget, Error, Owner, Result};
use crate::engine::unified_physics::spatial_actor::navigation::file_admission::point_valid;
impl Key {
    pub(in crate::engine) fn validate_file_controller(&self, b: &mut Budget) -> Result {
        b.work(128)?;
        b.require(
            finite(&self.goal)
                && self.floor <= 65535
                && self.radius.is_finite()
                && (0. ..=4096.).contains(&self.radius)
                && self.cell.is_finite()
                && self.cell > 0.
                && self.cell <= 4096.
                && self.profile.saved_controller_profile_valid(),
            Owner::Cache,
            "key-profile",
            0,
        )
    }
}
impl RouteCache {
    pub(in crate::engine) fn validate_file_controller(&self, b: &mut Budget) -> Result {
        b.work(16)?;
        b.require(
            self.entries.len() <= 8
                && self.geometry.is_some() == self.revision.is_some()
                && (self.entries.is_empty() || self.geometry.is_some()),
            Owner::Cache,
            "presence-count",
            0,
        )?;
        // At most8 fixed-size Key comparisons per row; no current target/world query.
        b.work((self.entries.len() as u64).pow(2) * 192)?;
        for (i, entry) in self.entries.iter().enumerate() {
            entry.key.validate_file_controller(b)?;
            b.require(
                !self.entries[..i].iter().any(|e| e.key == entry.key),
                Owner::Cache,
                "duplicate-key",
                i,
            )?;
            b.require(
                !entry.points.is_empty() && entry.points.len() <= 4096,
                Owner::Cache,
                "points-count",
                i,
            )?;
            b.work((entry.points.len() as u64) * 16)?;
            for (j, p) in entry.points.iter().enumerate() {
                b.require(point_valid(*p), Owner::Cache, "point", j)?;
            }
        }
        if let Some(geometry) = &self.geometry {
            b.work(geometry.saved_controller_work().ok_or(Error::Work)?)?;
            b.require(
                geometry.saved_controller_payload_valid(),
                Owner::Cache,
                "geometry-snapshot",
                0,
            )?;
        }
        Ok(())
    }
}
#[cfg(test)]
mod controller_admission_tests {
    use super::*;
    use crate::engine::file_controller_admission::Limits;
    fn source() -> (Engine, RouteCache) {
        let (mut e, _, _) = crate::engine::unified_physics::combat_navigation::tests::setup();
        for _ in 0..80 {
            crate::engine::unified_physics::combat_navigation::tests::tick(&mut e, 1);
            if !e
                .data_scene
                .gameplay
                .combat
                .file_native_routes()
                .cache
                .entries
                .is_empty()
            {
                break;
            }
        }
        let c = e
            .data_scene
            .gameplay
            .combat
            .file_native_routes()
            .cache
            .clone();
        assert!(!c.entries.is_empty());
        (e, c)
    }
    fn validate(c: &RouteCache) -> Result {
        let mut b = Budget::new(Limits {
            max_work: 1_000_000,
            max_scratch_bytes: 1_000_000,
        });
        c.validate_file_controller(&mut b)
    }
    #[test]
    fn controller_admission_cache_all_eight_slots_and_valid_crc_damage() {
        let (e, mut c) = source();
        let base = c.entries[0].clone();
        c.entries.clear();
        for i in 0..8 {
            let mut entry = base.clone();
            entry.key.target = Entity {
                id: u32::MAX - i,
                generation: 9,
            };
            c.entries.push(entry);
        }
        validate(&c).unwrap();
        let original = crate::checkpoint_codec::encode(&c).unwrap();
        for case in 0..8 {
            let mut bad = c.clone();
            match case {
                0 => bad.entries.push(base.clone()),
                1 => bad.entries[1].key = bad.entries[0].key.clone(),
                2 => bad.entries[0].key.cell = 0.,
                3 => bad.entries[0].key.radius = -1.,
                4 => bad.entries[0].key.goal[2] = f32::NAN,
                5 => bad.entries[0].points = Arc::from([]),
                6 => bad.geometry = None,
                _ => bad.revision = None,
            }
            let bytes = crate::checkpoint_codec::encode(&bad).unwrap();
            let decoded: RouteCache = crate::checkpoint_codec::decode(&bytes).unwrap();
            assert!(validate(&decoded).is_err(), "case{case}");
            assert_eq!(crate::checkpoint_codec::encode(&decoded).unwrap(), bytes);
            assert_eq!(crate::checkpoint_codec::encode(&c).unwrap(), original);
        }
        // Scene/native revisions may have advanced; a saved cache is data until its
        // existing runtime guard invalidates it. Admission does not clear/requery it.
        drop(e);
        validate(&c).unwrap();
    }
}

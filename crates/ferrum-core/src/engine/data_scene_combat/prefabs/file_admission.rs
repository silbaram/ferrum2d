use super::*;
use crate::gameplay::file_admission::{require, Budget, Error, Problem};
impl ProjectilePrefabConfig {
    pub(in crate::engine::data_scene_combat) fn validate_file(
        &self,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            definitions: _,
            bindings: _,
        } = self;
        b.work(2)?;
        b.vector(&self.definitions)?;
        b.work(self.bindings.len())?;
        require(
            self.definitions.len() <= MAX_PREFABS && self.bindings.len() <= MAX_ACTORS * 16,
            "projectile_catalog",
            "length",
            0,
            Problem::Length,
        )?;
        for (i, p) in self.definitions.iter().enumerate() {
            let ProjectilePrefab {
                texture: _,
                values: _,
                animation: _,
                align_velocity: _,
            } = p;
            b.work(64)?;
            let v = &p.values;
            require(
                p.texture <= 0x00ff_ffff
                    && v.iter().all(|v| v.is_finite())
                    && [0, 1, 6, 7, 8]
                        .into_iter()
                        .all(|j| v[j] > 0. && v[j] <= 10000.)
                    && v[2..6].iter().all(|v| (0.0..=1.).contains(v))
                    && v[2] != v[4]
                    && v[3] != v[5]
                    && (0.0..=1.).contains(&v[9])
                    && v[10].abs() <= 1000000.
                    && v[11..15].iter().all(|v| (0.0..=1.).contains(v)),
                "projectile_catalog",
                "definition",
                i,
                Problem::Number,
            )?;
            if let Some(clips) = &p.animation {
                b.work(clips.len())?;
                require(
                    clips.len() == 1,
                    "projectile_catalog",
                    "clip_count",
                    i,
                    Problem::Length,
                )?;
                let clip = &clips[0];
                let lengths = clip.saved_payload_lengths();
                let nested = lengths
                    .into_iter()
                    .try_fold(0usize, |a, v| a.checked_add(v))
                    .ok_or(Error::WorkLimit)?;
                b.product(nested, 8)?;
                b.work(128)?;
                require(
                    clip.admit_saved_payload().is_ok()
                        && clip.id == 0
                        && lengths[0] <= 32
                        && lengths[1] == 0
                        && lengths[2] == 0
                        && !clip.emit_events
                        && (0.001..=1000.).contains(&clip.fps)
                        && clip.frames.iter().all(|frame| {
                            [frame.u0, frame.v0, frame.u1, frame.v1]
                                .iter()
                                .all(|v| (0. ..=1.).contains(v))
                                && frame.u0 != frame.u1
                                && frame.v0 != frame.v1
                        })
                        && clip
                            .frames
                            .first()
                            .is_some_and(|f| f.uv() == (v[2], v[3], v[4], v[5])),
                    "projectile_catalog",
                    "clip",
                    i,
                    Problem::Layout,
                )?;
            }
        }
        for (i, (&(id, _generation, action), &prefab)) in self.bindings.iter().enumerate() {
            b.work(4)?;
            require(
                (id as usize) < MAX_COMBAT_ENTITIES
                    && action != 0
                    && prefab != 0
                    && (prefab as usize) <= self.definitions.len(),
                "projectile_catalog",
                "binding",
                i,
                Problem::Reference,
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use serde::ser::SerializeMap;
    struct Raw<'a, K, V>(&'a [(K, V)]);
    impl<K: serde::Serialize, V: serde::Serialize> serde::Serialize for Raw<'_, K, V> {
        fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let mut m = s.serialize_map(Some(self.0.len()))?;
            for (k, v) in self.0 {
                m.serialize_entry(k, v)?;
            }
            m.end()
        }
    }
    fn replace(original: &[u8], needle: &[u8], value: &[u8]) -> Vec<u8> {
        assert_eq!(needle.len(), value.len());
        let matches: Vec<_> = original[32..]
            .windows(needle.len())
            .enumerate()
            .filter_map(|(i, v)| (v == needle).then_some(i + 32))
            .collect();
        assert_eq!(matches.len(), 1);
        let mut out = original.to_vec();
        out[matches[0]..matches[0] + needle.len()].copy_from_slice(value);
        let mut crc = !0u32;
        for byte in &out[32..] {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
            }
        }
        out[24..28].copy_from_slice(&(!crc).to_le_bytes());
        out
    }

    #[test]
    fn file_data_gameplay_projectile_catalog_actual_crc_duplicate_and_decreasing_maps_reject() {
        let mut e = Engine::new();
        let p = &mut e.data_scene.gameplay.combat.prefabs;
        p.bindings.insert((17, 23, 5), 1);
        p.bindings.insert((31, 47, 7), 2);
        let needle = crate::checkpoint_codec::encode(&p.bindings).unwrap();
        let before = crate::engine::persistence::encode(&e).unwrap();
        for entries in [
            [((17u32, 23u32, 5u32), 1u32), ((17, 23, 5), 2)],
            [((31, 47, 7), 2), ((17, 23, 5), 1)],
        ] {
            let raw = crate::checkpoint_codec::encode(&Raw(&entries)).unwrap();
            let damaged = replace(&before, &needle[32..], &raw[32..]);
            let old = damaged.clone();
            assert!(crate::engine::persistence::decode(&damaged).is_err());
            assert_eq!(damaged, old);
        }
        assert_eq!(
            crate::engine::persistence::encode(
                &crate::engine::persistence::decode(&before).unwrap()
            )
            .unwrap(),
            before
        );
    }

    use super::*;
    impl ProjectilePrefabConfig {
        pub(in crate::engine) fn corrupt_file_fixture(&mut self, _case: u32) {
            self.bindings.insert((1, 0, 1), u32::MAX);
        }
    }
}

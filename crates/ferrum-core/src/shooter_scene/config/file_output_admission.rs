//! Encoded registry history is checked against itself, never current config.
use super::*;
use crate::engine::file_physics_output_admission::{require, Budget, Error, Problem};
impl GameplayPrefabRegistry {
    pub(in crate::shooter_scene) fn validate_output_words(
        words: &[u32],
        b: &mut Budget,
    ) -> Result<(), Error> {
        require(
            words.len() == GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_U32S,
            "shooter_output",
            "registry_layout",
            0,
            Problem::Length,
        )?;
        b.work(
            GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_U32S
                + MAX_GAMEPLAY_PREFAB_REGISTRATIONS * MAX_GAMEPLAY_PREFAB_REGISTRATIONS,
        )?;
        for (i, row) in words
            .chunks_exact(GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_STRIDE)
            .enumerate()
        {
            let id = row[GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_PREFAB_ID_FIELD];
            if id == 0 {
                require(
                    row.iter().all(|x| *x == 0),
                    "shooter_output",
                    "registry_empty",
                    i,
                    Problem::Canonical,
                )?;
                continue;
            }
            let kind =
                ShooterPrefabKind::from_code(row[GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_KIND_FIELD]);
            require(
                kind.is_some()
                    && Self::reserved_kind_for_prefab_id(id).is_none_or(|k| Some(k) == kind)
                    && row[2] <= 2
                    && row[3] <= 2
                    && row[4] <= 2
                    && row[5] <= 1,
                "shooter_output",
                "registry_codes",
                i,
                Problem::Code,
            )?;
            require(
                words[..i * GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_STRIDE]
                    .chunks_exact(GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_STRIDE)
                    .all(|r| r[0] != id),
                "shooter_output",
                "registry_ids",
                i,
                Problem::Duplicate,
            )?;
        }
        Ok(())
    }
    pub(in crate::shooter_scene) fn output_binding_supported(
        words: &[u32],
        id: u32,
        projectile: bool,
        b: &mut Budget,
    ) -> Result<bool, Error> {
        b.work(MAX_GAMEPLAY_PREFAB_REGISTRATIONS)?;
        Ok(words
            .chunks_exact(GAMEPLAY_PREFAB_REGISTRY_SNAPSHOT_STRIDE)
            .find(|r| r[0] == id)
            .is_some_and(|r| match r[2] {
                1 => !projectile,
                2 => projectile,
                _ => false,
            }))
    }
}

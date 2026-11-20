//! Readonly packed snapshot admission. Fixed parsers must reproduce every word;
//! none of their returned values is installed into the candidate.
use super::super::config::GameplayPrefabRegistry;
use super::*;
use crate::components::gameplay::FactionRelationTable;
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
use crate::gameplay_variables::{GameplayVariableSlab, GAMEPLAY_VARIABLE_SNAPSHOT_U32S};
use crate::input::{InputActionRegistry, INPUT_ACTION_REGISTRY_SNAPSHOT_U32S};
impl ShooterScene {
    pub(crate) fn validate_file_output_parts(
        hf: &Vec<f32>,
        hu: &Vec<u32>,
        ef: &Vec<f32>,
        eu: &Vec<u32>,
        b: &mut Budget,
    ) -> Result<(), Error> {
        b.vector(hf)?;
        b.vector(hu)?;
        b.vector(ef)?;
        b.vector(eu)?;
        if hf.is_empty() && hu.is_empty() && ef.is_empty() && eu.is_empty() {
            return Ok(());
        }
        f::require(
            hf.len() == SHOOTER_SNAPSHOT_HEADER_FLOATS
                && hu.len() == SHOOTER_SNAPSHOT_HEADER_U32S
                && ef.len().is_multiple_of(SHOOTER_SNAPSHOT_ENTITY_FLOATS)
                && eu.len().is_multiple_of(SHOOTER_SNAPSHOT_ENTITY_U32S)
                && ef.len() / SHOOTER_SNAPSHOT_ENTITY_FLOATS
                    == eu.len() / SHOOTER_SNAPSHOT_ENTITY_U32S,
            "shooter_output",
            "layout",
            0,
            Problem::Length,
        )?;
        b.work(SHOOTER_SNAPSHOT_HEADER_FLOATS + SHOOTER_SNAPSHOT_HEADER_U32S)?;
        f::require(
            f::finite(hf),
            "shooter_output",
            "header_numbers",
            0,
            Problem::Number,
        )?;
        f::require(
            hu[SNAPSHOT_HEADER_VERSION] == SHOOTER_SNAPSHOT_VERSION
                && game_state_from_code(hu[SNAPSHOT_HEADER_GAME_STATE]).is_some(),
            "shooter_output",
            "version_state",
            0,
            Problem::Code,
        )?;
        for i in [
            SNAPSHOT_PREVIOUS_INPUT_SPACE,
            SNAPSHOT_PREVIOUS_INPUT_ENTER,
            SNAPSHOT_PREVIOUS_INPUT_MOUSE_LEFT,
            SNAPSHOT_PREVIOUS_INPUT_W,
            SNAPSHOT_PREVIOUS_INPUT_A,
            SNAPSHOT_PREVIOUS_INPUT_S,
            SNAPSHOT_PREVIOUS_INPUT_D,
        ] {
            f::require(
                hu[i] <= u8::MAX as u32,
                "shooter_output",
                "previous_input",
                i,
                Problem::Code,
            )?;
        }
        let input =
            &hu[SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET..SNAPSHOT_PREVIOUS_INPUT_W];
        b.work(INPUT_ACTION_REGISTRY_SNAPSHOT_U32S * 4)?;
        b.fixed(
            std::mem::size_of::<InputActionRegistry>() + INPUT_ACTION_REGISTRY_SNAPSHOT_U32S * 4,
        )?;
        let parsed = InputActionRegistry::from_snapshot(input).ok_or(Error::Invalid {
            owner: "shooter_output",
            field: "input_registry",
            index: 0,
            problem: Problem::Code,
        })?;
        let mut canonical = [0; INPUT_ACTION_REGISTRY_SNAPSHOT_U32S];
        f::require(
            parsed.write_snapshot(&mut canonical) && canonical == input,
            "shooter_output",
            "input_registry",
            0,
            Problem::Canonical,
        )?;
        let registry =
            &hu[SNAPSHOT_PREFAB_REGISTRY_U32_OFFSET..SNAPSHOT_FACTION_RELATION_TABLE_U32_OFFSET];
        GameplayPrefabRegistry::validate_output_words(registry, b)?;
        let faction = &hu[SNAPSHOT_FACTION_RELATION_TABLE_U32_OFFSET
            ..super::super::SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET];
        b.work(GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S * 4)?;
        b.fixed(
            std::mem::size_of::<FactionRelationTable>()
                + GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S * 4,
        )?;
        let parsed = FactionRelationTable::from_snapshot(faction).ok_or(Error::Invalid {
            owner: "shooter_output",
            field: "faction_table",
            index: 0,
            problem: Problem::Code,
        })?;
        let mut canonical = [0; GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S];
        f::require(
            parsed.write_snapshot(&mut canonical) && canonical == faction,
            "shooter_output",
            "faction_table",
            0,
            Problem::Canonical,
        )?;
        let variables = &hu[super::super::SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET..];
        b.work(GAMEPLAY_VARIABLE_SNAPSHOT_U32S * 4)?;
        b.fixed(std::mem::size_of::<GameplayVariableSlab>() + GAMEPLAY_VARIABLE_SNAPSHOT_U32S * 4)?;
        let parsed = GameplayVariableSlab::from_snapshot(variables).ok_or(Error::Invalid {
            owner: "shooter_output",
            field: "variables",
            index: 0,
            problem: Problem::Code,
        })?;
        let mut canonical = [0; GAMEPLAY_VARIABLE_SNAPSHOT_U32S];
        f::require(
            parsed.write_snapshot(&mut canonical) && canonical == variables,
            "shooter_output",
            "variables",
            0,
            Problem::Canonical,
        )?;
        for (i, (floats, words)) in ef
            .chunks_exact(SHOOTER_SNAPSHOT_ENTITY_FLOATS)
            .zip(eu.chunks_exact(SHOOTER_SNAPSHOT_ENTITY_U32S))
            .enumerate()
        {
            // Pure legacy predicates take a fixed Copy value; all their fixed scans and
            // nested slot comparisons are charged before the copy or any predicate.
            b.work(
                (SHOOTER_SNAPSHOT_ENTITY_FLOATS + SHOOTER_SNAPSHOT_ENTITY_U32S) * 8
                    + SNAPSHOT_SPAWN_PREFAB_BINDINGS * SNAPSHOT_SPAWN_PREFAB_BINDINGS,
            )?;
            b.fixed(std::mem::size_of::<ShooterEntitySnapshot>())?;
            let mut entity = ShooterEntitySnapshot {
                floats: [0.; SHOOTER_SNAPSHOT_ENTITY_FLOATS],
                u32s: [0; SHOOTER_SNAPSHOT_ENTITY_U32S],
            };
            entity.floats.copy_from_slice(floats);
            entity.u32s.copy_from_slice(words);
            f::require(
                valid_shooter_snapshot_entity(entity),
                "shooter_output",
                "entity",
                i,
                Problem::Code,
            )?;
            for slot in 0..SNAPSHOT_SPAWN_PREFAB_BINDINGS {
                let action = entity.u32s
                    [spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ACTION_ID_FIELD)];
                if action != 0 {
                    let id =
                        entity.u32s[spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_ID_FIELD)];
                    let projectile = entity.u32s
                        [spawn_prefab_u32_index(slot, SNAPSHOT_SPAWN_PREFAB_PROJECTILE_FLAG_FIELD)]
                        != 0;
                    f::require(
                        GameplayPrefabRegistry::output_binding_supported(
                            registry, id, projectile, b,
                        )?,
                        "shooter_output",
                        "prefab_reference",
                        i,
                        Problem::Reference,
                    )?;
                }
            }
        }
        Ok(())
    }
}

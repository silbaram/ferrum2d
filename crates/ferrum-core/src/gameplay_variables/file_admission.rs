//! Read-only, cold admission of the candidate's native variable slab.
//!
//! This is deliberately separate from memory checkpoint decoding and the numeric
//! snapshot API: neither existing path gains a new rejection or normalization.
//! No Engine ownership, authoring metadata, epoch or publication fence is checked.

use super::{
    normalized_value, GameplayVariableScope, GameplayVariableSlab, GameplayVariableType,
    MAX_GAMEPLAY_VARIABLES,
};

/// Native representation of `slot/type/scope/default`, indexed by native slot - 1.
/// Only configured slots contain an entry. Current values are never exported here.
/// A future JS adapter must map Bool defaults from native 0/1 to false/true, and
/// map the type/scope enums to their authoring names; this is not a JS wire DTO.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct LayoutEntry {
    pub(crate) slot: u32,
    pub(crate) variable_type: GameplayVariableType,
    pub(crate) scope: GameplayVariableScope,
    pub(crate) default_value: f64,
}

pub(crate) type Layout = [Option<LayoutEntry>; MAX_GAMEPLAY_VARIABLES];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Field {
    Default,
    Current,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InvalidValue {
    NonFinite,
    NonInteger,
    UnsafeInteger,
    InvalidBool,
    /// Every existing configure/set/increment producer stores +0. Scene reset
    /// copies that admitted default. Do not silently repair private -0 histories.
    NonCanonicalZero,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Error {
    pub(crate) slot: u32,
    pub(crate) field: Field,
    pub(crate) reason: InvalidValue,
}

impl GameplayVariableSlab {
    /// Validate both stored scalars and extract the actual candidate layout.
    ///
    /// Fixed bounds: 64 slot visits, at most 128 scalar normalizations, and one
    /// 64-entry output array. No heap allocation, untrusted loop bound, external
    /// input layout, value reset, configure call or source mutation occurs.
    /// The caller must separately admit the surrounding candidate and match its
    /// detached metadata before publication; this helper does not commit it.
    #[allow(dead_code)] // Staged file boundary; memory checkpoints stay unchanged.
    pub(crate) fn admit_file_layout(&self) -> Result<Layout, Error> {
        let mut layout = [None; MAX_GAMEPLAY_VARIABLES];
        for (index, entry) in self.slots.iter().enumerate() {
            let Some(entry) = entry else {
                continue;
            };
            let slot = (index + 1) as u32; // Fixed 64-slot array, not decoded size.
            validate_value(
                slot,
                Field::Default,
                entry.variable_type,
                entry.default_value,
            )?;
            validate_value(slot, Field::Current, entry.variable_type, entry.value)?;
            layout[index] = Some(LayoutEntry {
                slot,
                variable_type: entry.variable_type,
                scope: entry.scope,
                default_value: entry.default_value,
            });
        }
        Ok(layout)
    }
}

fn validate_value(
    slot: u32,
    field: Field,
    variable_type: GameplayVariableType,
    value: f64,
) -> Result<(), Error> {
    // Reuse the producer predicate instead of defining a second valid range.
    let reason = match normalized_value(variable_type, value) {
        Some(normalized) if normalized.to_bits() == value.to_bits() => return Ok(()),
        Some(_) => InvalidValue::NonCanonicalZero,
        None if !value.is_finite() => InvalidValue::NonFinite,
        None => match variable_type {
            GameplayVariableType::Integer if value.fract() != 0.0 => InvalidValue::NonInteger,
            GameplayVariableType::Integer => InvalidValue::UnsafeInteger,
            GameplayVariableType::Bool => InvalidValue::InvalidBool,
            // normalized_value accepts every finite Real.
            GameplayVariableType::Real => unreachable!("finite real producer predicate"),
        },
    };
    Err(Error {
        slot,
        field,
        reason,
    })
}

#[cfg(test)]
mod tests;

// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
pub use manager::IslandManager;

pub(crate) use island::Island;
pub(crate) use persistent::{INVALID_ISLAND, ImpulseJointIslandEvent, PersistentIslands};
pub(crate) use substep_groups::SolveGroup;

mod global_split;
mod island;
mod local_split;
mod manager;
mod persistent;
mod sleep;
mod substep_groups;

#[cfg(feature = "serde-serialize")]
#[doc(hidden)]
pub use persistent::validation::{StoredIslandError, StoredIslandLimits, validate_stored_islands};

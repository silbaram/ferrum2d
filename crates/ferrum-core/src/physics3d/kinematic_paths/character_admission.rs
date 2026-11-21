//! Read-only admission of the persistent character copies in path scratch.
use super::PathScratch;
use crate::physics3d::Space;

impl PathScratch {
    /// Raw cold census; callers precharge eight visits per record before validation.
    pub(in crate::physics3d) fn saved_time_payload_counts(&self) -> (usize, usize, usize) {
        (self.cuts.len(), self.ids.len(), self.stopped.len())
    }

    /// Lazy/default scratch and historical identities are valid. No current
    /// World lookup or normalization is performed on this stored execution plan.
    pub(in crate::physics3d) fn saved_time_payload_valid(&self) -> bool {
        if self.cuts.len() > 65 || self.ids.len() > 16 || self.stopped.len() != self.ids.len() {
            return false;
        }
        if (self.cuts.is_empty() && !self.ids.is_empty())
            || (!self.cuts.is_empty() && self.cuts.last() != Some(&1.))
        {
            return false;
        }
        let mut previous = 0.;
        for &cut in &self.cuts {
            if !cut.is_finite() || cut <= previous || cut > 1. {
                return false;
            }
            previous = cut;
        }
        for (i, id) in self.ids.iter().enumerate() {
            if self.ids[..i].contains(id) {
                return false;
            }
        }
        self.stopped
            .iter()
            .flatten()
            .all(|t| t.is_finite() && (0. ..=1.).contains(t))
    }

    pub(in crate::physics3d) fn saved_character_payload_counts(&self) -> (usize, usize) {
        (self.preview.len(), self.characters.len())
    }

    pub(in crate::physics3d) fn saved_character_payload_valid(&self, space: Space) -> bool {
        if self.preview.len() != self.characters.len() {
            return false;
        }
        let mut previous = None;
        for (preview, (id, total)) in self.preview.iter().zip(&self.characters) {
            if preview.id != *id
                || previous.is_some_and(|previous| previous >= *id)
                || !preview.saved_payload_valid(space)
                || !total.saved_payload_valid(space, 10000.)
                // Totals start at Default, then only translation/carry and
                // diagnostics are accumulated by step_kinematic_tick.
                || total.grounded
                || total.ground.is_some()
                || total.sliding
                || total.velocity != [0.; 3]
                || total.vertical_speed != 0.
            {
                return false;
            }
            previous = Some(*id);
        }
        true
    }
}

#[cfg(test)]
mod tests;

use super::{ContactReports, UnifiedContactImpulse};
use crate::engine::file_physics_output_admission::{self as f, Budget, Error, Problem};
use crate::engine::unified_physics::file_observation_admission::native_records as n;

impl ContactReports {
    pub(in crate::engine::unified_physics) fn validate_file_observations(
        &self,
        max: usize,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            terrain_events: _,
            terrain_dropped: _,
            native: _,
            contacts: _,
            diagnostics: _,
            observations: _,
            feedback_categories: _,
        } = self;
        let crate::physics3d::ContactImpulseDiagnostics {
            solved_contacts: _,
            dropped: _,
        } = self.diagnostics;
        b.work(9)?;
        b.vector(&self.terrain_events)?;
        f::require(
            self.terrain_events.len() <= super::super::terrain_events::MAX_TERRAIN_EVENTS,
            "runtime_contacts",
            "terrain_len",
            0,
            Problem::Graph,
        )?;
        for (index, row) in self.terrain_events.iter().enumerate() {
            row.validate_file(b, index)?;
        }
        b.vector(&self.native)?;
        b.vector(&self.contacts)?;
        b.vector(&self.observations)?;
        b.vector(&self.feedback_categories)?;
        f::require(
            self.native.len() <= max
                && self.observations.len() == self.native.len()
                && self.contacts.len() <= self.native.len()
                && self.feedback_categories.len() <= self.native.len()
                && self.diagnostics.solved_contacts
                    == self.native.len().saturating_add(self.diagnostics.dropped),
            "runtime_contacts",
            "length_diagnostics",
            0,
            Problem::Graph,
        )?;
        b.work(self.native.len().checked_mul(64).ok_or(Error::WorkLimit)?)?;
        let mut contacts = 0;
        let mut feedback = 0;
        for (i, (native, row)) in self.native.iter().zip(&self.observations).enumerate() {
            n::impulse(native, b, i)?;
            row.validate_file_output_row(b, i)?;
            f::require(
                n::participant_matches(&row.first, native.first)
                    && n::participant_matches(&row.second, native.second)
                    && row.categories == native.categories
                    && n::bits(&row.point, &native.point)
                    && n::bits(&row.normal, &native.normal)
                    && row.normal_impulse.to_bits() == native.normal_impulse.to_bits()
                    && n::bits(&row.tangent_impulse, &native.tangent_impulse)
                    && row.approach_speed.to_bits() == native.approach_speed.to_bits(),
                "runtime_contacts",
                "native_observation_copy",
                i,
                Problem::Graph,
            )?;
            if row.first.flags & 1 != 0 && row.second.flags & 1 != 0 {
                let Some(contact) = self.contacts.get(contacts) else {
                    return f::require(
                        false,
                        "runtime_contacts",
                        "mapped_coverage",
                        i,
                        Problem::Graph,
                    );
                };
                let UnifiedContactImpulse {
                    a: _,
                    b: _,
                    contact: _,
                } = contact;
                f::require(
                    [contact.a.id, contact.a.generation] == row.first.entity
                        && [contact.b.id, contact.b.generation] == row.second.entity
                        && n::same_impulse(&contact.contact, native),
                    "runtime_contacts",
                    "mapped_copy",
                    i,
                    Problem::Graph,
                )?;
                contacts += 1;
            }
            if self.feedback_categories.get(feedback) == Some(&native.categories) {
                feedback += 1;
            }
        }
        f::require(
            contacts == self.contacts.len() && feedback == self.feedback_categories.len(),
            "runtime_contacts",
            "subsequence_coverage",
            0,
            Problem::Graph,
        )
    }
}

#[cfg(test)]
impl ContactReports {
    pub(in crate::engine) fn corrupt_runtime_observation_before(&mut self) {
        self.corrupt_runtime_observation(0);
    }
    pub(in crate::engine) fn corrupt_runtime_observation(&mut self, case: usize) {
        match case {
            0 => self.native[0].approach_speed = f32::NAN,
            1 => self.native[0].point[0] = f32::NAN,
            2 => self.native[0].normal[1] = f32::NAN,
            3 => self.native[0].normal_impulse = -1.,
            4 => self.native[0].tangent_impulse[2] = f32::INFINITY,
            5 => self.diagnostics.solved_contacts += 1,
            6 => {
                self.observations.pop();
            }
            7 => {
                self.contacts.pop();
            }
            8 => self.observations[0].point[0] += 1.,
            9 => self.observations[0].first.body[0] += 1,
            10 => self.observations[0].first.entity[0] += 1,
            11 => self.contacts[0].contact.point[0] += 1.,
            12 => self.contacts[0].a.id += 1,
            13 => self.feedback_categories.push(0),
            14 => self.observations[0].normal_impulse = -1.,
            15 => self.native.clear(),
            16 => self.native.push(self.native[0].clone()),
            17 => self.observations[0].first.terrain = [0, 1, 0],
            18 => self.observations[0].first.flags |= 4,
            19 => self.native[0].first.collider.slot += 100,
            20 => self.native[0].categories ^= 1,
            21 => self.observations[0].categories ^= 1,
            22 => self.native[0].normal_impulse = f32::NAN,
            23 => self.native[0].approach_speed = f32::INFINITY,
            _ => unreachable!(),
        }
    }
}

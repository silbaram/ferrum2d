use super::*;
use crate::gameplay::file_admission::{require, Budget, Error, Problem};
impl ControllerSettings {
    pub(in crate::engine) fn validate_file_configuration(
        &self,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            solid_mask: _,
            iterations: _,
            step: _,
            drop: _,
            ledge: _,
        } = self;
        b.work(16)?;
        require(
            (1..=8).contains(&self.iterations)
                && [self.step, self.drop]
                    .iter()
                    .all(|v| v.is_finite() && (0.0..=65536.).contains(v)),
            "controller_settings",
            "configuration",
            0,
            Problem::Range,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gameplay::file_admission::Limits;
    #[test]
    fn file_gameplay_descriptor_settings_raw_bounds_not_normalized() {
        let mut settings = ControllerSettings {
            solid_mask: u32::MAX,
            iterations: 8,
            step: -0.,
            drop: 65536.,
            ledge: true,
        };
        let old = crate::checkpoint_codec::encode(&settings).unwrap();
        settings
            .validate_file_configuration(&mut Budget::new(Limits {
                max_work: 16,
                max_scratch_bytes: 0,
            }))
            .unwrap();
        assert_eq!(crate::checkpoint_codec::encode(&settings).unwrap(), old);
        settings.iterations = 0;
        let bad = crate::checkpoint_codec::encode(&settings).unwrap();
        let d: ControllerSettings = crate::checkpoint_codec::decode(&bad).unwrap();
        assert!(matches!(
            d.validate_file_configuration(&mut Budget::new(Limits {
                max_work: 16,
                max_scratch_bytes: 0
            })),
            Err(Error::Invalid { .. })
        ));
        assert_eq!(crate::checkpoint_codec::encode(&d).unwrap(), bad);
    }
}

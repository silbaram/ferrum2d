use super::*;
use crate::gameplay::file_admission::{require, Budget, Error, Problem};
impl<T> ActionTriggerQueue<T> {
    /// Inspect both stored queues. Payload admission is mandatory for every row;
    /// callers specify their producer's fixed capacity and quiescent phase policy.
    pub(crate) fn validate_file(
        &self,
        b: &mut Budget,
        expected_max: usize,
        processing_empty: bool,
        mut payload: impl FnMut(&T, &mut Budget) -> Result<(), Error>,
    ) -> Result<(), Error> {
        let Self {
            pending: _,
            processing: _,
            max_pending: _,
        } = self;
        b.work(3)?;
        b.vector(&self.pending)?;
        b.vector(&self.processing)?;
        require(
            self.max_pending == expected_max
                && self.pending.len() <= expected_max
                && self.processing.len() <= expected_max
                && self.pending.capacity() >= expected_max
                && self.processing.capacity() >= expected_max,
            "action_queue",
            "bounds",
            0,
            Problem::Length,
        )?;
        require(
            !processing_empty || self.processing.is_empty(),
            "action_queue",
            "processing",
            0,
            Problem::History,
        )?;
        for row in self.pending.iter().chain(self.processing.iter()) {
            payload(row, b)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::Entity;
    use crate::gameplay::{file_admission as f, ActionTriggerCommand as Command};
    fn limits() -> f::Limits {
        f::Limits {
            max_work: 100000,
            max_scratch_bytes: 100000,
        }
    }
    fn validate(
        q: &ActionTriggerQueue<Command>,
        empty: bool,
        l: f::Limits,
    ) -> Result<f::Usage, Error> {
        let mut b = Budget::new(l);
        q.validate_file(&mut b, 64, empty, f::action_command)?;
        Ok(b.usage())
    }
    #[test]
    fn file_gameplay_shared_queue_actual_pending_processing_codec_and_budget() {
        let mut q = ActionTriggerQueue::with_capacity(64);
        let entity = Entity {
            id: u32::MAX,
            generation: 93,
        };
        assert!(q.queue(Command::timer(entity, 0)));
        assert!(q.queue(Command::wave(entity, 7)));
        let old = crate::checkpoint_codec::encode(&q).unwrap();
        let u = validate(&q, true, limits()).unwrap();
        assert_eq!(
            validate(
                &q,
                true,
                f::Limits {
                    max_work: u.work,
                    max_scratch_bytes: u.scratch_bytes
                }
            ),
            Ok(u)
        );
        assert_eq!(
            validate(
                &q,
                true,
                f::Limits {
                    max_work: u.work - 1,
                    max_scratch_bytes: u.scratch_bytes
                }
            ),
            Err(Error::WorkLimit)
        );
        assert_eq!(crate::checkpoint_codec::encode(&q).unwrap(), old);
        let mut d: ActionTriggerQueue<Command> = crate::checkpoint_codec::decode(&old).unwrap();
        assert!(d.begin_processing());
        let pending = crate::checkpoint_codec::encode(&d).unwrap();
        validate(&d, false, limits()).unwrap();
        assert!(matches!(
            validate(&d, true, limits()),
            Err(Error::Invalid {
                problem: Problem::History,
                ..
            })
        ));
        assert_eq!(crate::checkpoint_codec::encode(&d).unwrap(), pending);
        d.finish_processing();
        validate(&d, true, limits()).unwrap();
    }
    #[test]
    fn file_gameplay_shared_queue_valid_crc_bad_bounds_not_repaired() {
        let mut q = ActionTriggerQueue::<Command>::with_capacity(64);
        q.max_pending = 65;
        let bad = crate::checkpoint_codec::encode(&q).unwrap();
        let d = crate::checkpoint_codec::decode(&bad).unwrap();
        assert!(matches!(
            validate(&d, true, limits()),
            Err(Error::Invalid {
                problem: Problem::Length,
                ..
            })
        ));
        assert_eq!(crate::checkpoint_codec::encode(&d).unwrap(), bad);
    }
}

use super::*;

pub(crate) fn has_bounded_deferred_command_capacity<T>(queue: &[T], max_pending: usize) -> bool {
    queue.len() < max_pending
}

pub(crate) fn try_push_bounded_deferred_command<T>(
    queue: &mut Vec<T>,
    max_pending: usize,
    command: T,
) -> bool {
    if !has_bounded_deferred_command_capacity(queue, max_pending) {
        return false;
    }
    queue.push(command);
    true
}

pub(crate) fn drain_deferred_commands_into<T>(queue: &mut Vec<T>, commands: &mut Vec<T>) -> usize {
    commands.clear();
    commands.append(queue);
    commands.len()
}

#[derive(Debug)]
pub(crate) struct ActionTriggerQueue<T> {
    pending: Vec<T>,
    processing: Vec<T>,
    max_pending: usize,
}

impl<T: Copy> ActionTriggerQueue<T> {
    pub(crate) fn with_capacity(max_pending: usize) -> Self {
        Self {
            pending: Vec::with_capacity(max_pending),
            processing: Vec::with_capacity(max_pending),
            max_pending,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.pending.clear();
        self.processing.clear();
    }

    pub(crate) fn queue(&mut self, command: T) -> bool {
        if self.pending.len() >= self.max_pending {
            return false;
        }
        self.pending.push(command);
        true
    }

    pub(crate) fn begin_processing(&mut self) -> bool {
        if self.pending.is_empty() {
            return false;
        }
        std::mem::swap(&mut self.pending, &mut self.processing);
        true
    }

    pub(crate) fn processing_len(&self) -> usize {
        self.processing.len()
    }

    pub(crate) fn processing_at(&self, index: usize) -> Option<T> {
        self.processing.get(index).copied()
    }

    pub(crate) fn finish_processing(&mut self) {
        self.processing.clear();
    }

    #[cfg(test)]
    pub(crate) fn pending_len(&self) -> usize {
        self.pending.len()
    }

    #[cfg(test)]
    pub(crate) fn pending_capacity(&self) -> usize {
        self.pending.capacity()
    }

    #[cfg(test)]
    pub(crate) fn processing_capacity(&self) -> usize {
        self.processing.capacity()
    }
}

impl ActionTriggerQueue<ActionTriggerCommand> {
    pub(crate) fn queue_action_trigger(
        &mut self,
        command: ActionTriggerCommand,
    ) -> Result<(), ActionFailureEventData> {
        if self.queue(command) {
            return Ok(());
        }
        Err(action_trigger_queue_full_event_data(command))
    }

    pub(crate) fn processing_at_phase(
        &self,
        index: usize,
        phase: ActionTriggerPhase,
    ) -> Option<ActionTriggerCommand> {
        let command = self.processing_at(index)?;
        action_trigger_runs_in_phase(command, phase).then_some(command)
    }
}

pub(crate) fn collect_action_triggers_for_phase(
    queue: &mut ActionTriggerQueue<ActionTriggerCommand>,
    phase: ActionTriggerPhase,
    commands: &mut Vec<ActionTriggerCommand>,
) -> usize {
    commands.clear();
    if !queue.begin_processing() {
        return 0;
    }

    let trigger_count = queue.processing_len();
    for trigger_index in 0..trigger_count {
        if let Some(command) = queue.processing_at_phase(trigger_index, phase) {
            commands.push(command);
        }
    }
    queue.finish_processing();
    commands.len()
}

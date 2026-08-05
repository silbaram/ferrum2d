use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct GameplayTimerDispatch {
    pub(crate) source: Entity,
    pub(crate) timer_id: u32,
    pub(crate) duration_seconds: f32,
    pub(crate) action_id: Option<u32>,
}

impl GameplayTimerDispatch {
    pub(crate) fn event(self) -> GameplayEvent {
        GameplayEvent::timer(self.source, self.timer_id, self.duration_seconds)
    }

    pub(crate) fn action_trigger(self) -> Option<ActionTriggerCommand> {
        self.action_id
            .filter(|action_id| *action_id != 0)
            .map(|action_id| ActionTriggerCommand::timer(self.source, action_id))
    }
}

pub(crate) fn tick_gameplay_timer_trigger_for_dispatch(
    source: Entity,
    timer: &mut GameplayTimerTrigger,
    delta_seconds: f32,
) -> Option<GameplayTimerDispatch> {
    if !timer.tick(delta_seconds) {
        return None;
    }
    Some(GameplayTimerDispatch {
        source,
        timer_id: timer.timer_id,
        duration_seconds: timer.duration_seconds,
        action_id: timer.action_id,
    })
}

pub(crate) fn tick_gameplay_timer_triggers(
    world: &mut World,
    delta_seconds: f32,
    events: &mut Vec<GameplayEvent>,
) {
    if delta_seconds <= 0.0 || !delta_seconds.is_finite() || !world.has_gameplay_timer_triggers() {
        return;
    }

    let alive_count = world.alive_indices().len();
    for alive_position in 0..alive_count {
        let index = world.alive_indices()[alive_position];
        let Some(source) = world.entity_at_index(index) else {
            continue;
        };
        let Some(timer) = world.gameplay_timer_trigger_mut_at_index(index) else {
            continue;
        };
        let Some(dispatch) = tick_gameplay_timer_trigger_for_dispatch(source, timer, delta_seconds)
        else {
            continue;
        };
        events.push(dispatch.event());
    }
}

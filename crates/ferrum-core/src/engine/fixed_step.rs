use crate::input::InputState;

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct FixedTimestepInputLatch {
    space: bool,
    enter: bool,
    mouse_left: bool,
}

impl FixedTimestepInputLatch {
    pub(super) fn observe(&mut self, previous: InputState, current: InputState) {
        self.space |= current.space == 1 && previous.space == 0;
        self.enter |= current.enter == 1 && previous.enter == 0;
        self.mouse_left |= current.mouse_left == 1 && previous.mouse_left == 0;
    }

    pub(super) fn apply_to(self, mut input: InputState) -> InputState {
        input.space = input.space.max(u8::from(self.space));
        input.enter = input.enter.max(u8::from(self.enter));
        input.mouse_left = input.mouse_left.max(u8::from(self.mouse_left));
        input
    }

    pub(super) fn clear(&mut self) {
        *self = Self::default();
    }
}

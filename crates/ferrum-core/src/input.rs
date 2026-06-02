#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct InputState {
    pub w: u8,
    pub a: u8,
    pub s: u8,
    pub d: u8,
    pub space: u8,
    pub enter: u8,
    pub mouse_left: u8,
    pub mouse_x: f32,
    pub mouse_y: f32,
}

pub(crate) const INPUT_ACTION_CONTROL_SPACE: u32 = 1;
pub(crate) const INPUT_ACTION_CONTROL_ENTER: u32 = 2;
pub(crate) const INPUT_ACTION_CONTROL_MOUSE_LEFT: u32 = 3;
pub(crate) const INPUT_ACTION_ACTIVATION_DOWN: u32 = 1;
pub(crate) const INPUT_ACTION_ACTIVATION_PRESSED: u32 = 2;

const MAX_INPUT_ACTION_BINDINGS: usize = 8;
pub(crate) const INPUT_ACTION_REGISTRY_SNAPSHOT_U32S: usize = MAX_INPUT_ACTION_BINDINGS * 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InputActionControl {
    Space,
    Enter,
    MouseLeft,
}

impl InputActionControl {
    fn from_code(code: u32) -> Option<Self> {
        match code {
            INPUT_ACTION_CONTROL_SPACE => Some(Self::Space),
            INPUT_ACTION_CONTROL_ENTER => Some(Self::Enter),
            INPUT_ACTION_CONTROL_MOUSE_LEFT => Some(Self::MouseLeft),
            _ => None,
        }
    }

    fn is_down(self, input: InputState) -> bool {
        match self {
            Self::Space => input.space == 1,
            Self::Enter => input.enter == 1,
            Self::MouseLeft => input.mouse_left == 1,
        }
    }

    fn code(self) -> u32 {
        match self {
            Self::Space => INPUT_ACTION_CONTROL_SPACE,
            Self::Enter => INPUT_ACTION_CONTROL_ENTER,
            Self::MouseLeft => INPUT_ACTION_CONTROL_MOUSE_LEFT,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum InputActionActivation {
    Down,
    Pressed,
}

impl InputActionActivation {
    fn from_code(code: u32) -> Option<Self> {
        match code {
            INPUT_ACTION_ACTIVATION_DOWN => Some(Self::Down),
            INPUT_ACTION_ACTIVATION_PRESSED => Some(Self::Pressed),
            _ => None,
        }
    }

    fn code(self) -> u32 {
        match self {
            Self::Down => INPUT_ACTION_ACTIVATION_DOWN,
            Self::Pressed => INPUT_ACTION_ACTIVATION_PRESSED,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct InputActionBinding {
    action_id: u32,
    control: InputActionControl,
    activation: InputActionActivation,
}

impl InputActionBinding {
    fn new(
        action_id: u32,
        control: InputActionControl,
        activation: InputActionActivation,
    ) -> Option<Self> {
        if action_id == 0 {
            return None;
        }
        Some(Self {
            action_id,
            control,
            activation,
        })
    }

    fn is_active(self, action_id: u32, current: InputState, previous: InputState) -> bool {
        if self.action_id != action_id {
            return false;
        }
        match self.activation {
            InputActionActivation::Down => self.control.is_down(current),
            InputActionActivation::Pressed => {
                self.control.is_down(current) && !self.control.is_down(previous)
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct InputActionRegistry {
    bindings: [Option<InputActionBinding>; MAX_INPUT_ACTION_BINDINGS],
}

impl Default for InputActionRegistry {
    fn default() -> Self {
        let mut registry = Self::empty();
        registry.bindings[0] =
            InputActionBinding::new(1, InputActionControl::Space, InputActionActivation::Down);
        registry.bindings[1] = InputActionBinding::new(
            1,
            InputActionControl::MouseLeft,
            InputActionActivation::Down,
        );
        registry.bindings[2] =
            InputActionBinding::new(2, InputActionControl::Enter, InputActionActivation::Pressed);
        registry
    }
}

impl InputActionRegistry {
    pub(crate) fn empty() -> Self {
        Self {
            bindings: [None; MAX_INPUT_ACTION_BINDINGS],
        }
    }

    pub(crate) fn set_binding(
        &mut self,
        action_id: u32,
        binding_index: u32,
        control_code: u32,
        activation_code: u32,
    ) -> bool {
        let Some(binding_slot) = self.bindings.get_mut(binding_index as usize) else {
            return false;
        };
        let Some(control) = InputActionControl::from_code(control_code) else {
            return false;
        };
        let Some(activation) = InputActionActivation::from_code(activation_code) else {
            return false;
        };
        let Some(binding) = InputActionBinding::new(action_id, control, activation) else {
            return false;
        };
        *binding_slot = Some(binding);
        true
    }

    pub(crate) fn clear_action(&mut self, action_id: u32) -> bool {
        if action_id == 0 {
            return false;
        }
        for binding in &mut self.bindings {
            if binding.is_some_and(|binding| binding.action_id == action_id) {
                *binding = None;
            }
        }
        true
    }

    pub(crate) fn is_action_active(
        &self,
        action_id: u32,
        current: InputState,
        previous: InputState,
    ) -> bool {
        self.bindings
            .iter()
            .flatten()
            .any(|binding| binding.is_active(action_id, current, previous))
    }

    pub(crate) fn write_snapshot(self, out: &mut [u32]) -> bool {
        if out.len() != INPUT_ACTION_REGISTRY_SNAPSHOT_U32S {
            return false;
        }
        for (index, binding) in self.bindings.iter().enumerate() {
            let offset = index * 3;
            if let Some(binding) = binding {
                out[offset] = binding.action_id;
                out[offset + 1] = binding.control.code();
                out[offset + 2] = binding.activation.code();
            } else {
                out[offset] = 0;
                out[offset + 1] = 0;
                out[offset + 2] = 0;
            }
        }
        true
    }

    pub(crate) fn from_snapshot(snapshot: &[u32]) -> Option<Self> {
        if snapshot.len() != INPUT_ACTION_REGISTRY_SNAPSHOT_U32S {
            return None;
        }
        let mut registry = Self::empty();
        for (index, chunk) in snapshot.chunks_exact(3).enumerate() {
            let action_id = chunk[0];
            let control_code = chunk[1];
            let activation_code = chunk[2];
            if action_id == 0 {
                if control_code != 0 || activation_code != 0 {
                    return None;
                }
                continue;
            }
            let control = InputActionControl::from_code(control_code)?;
            let activation = InputActionActivation::from_code(activation_code)?;
            registry.bindings[index] = InputActionBinding::new(action_id, control, activation);
        }
        Some(registry)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_registry_maps_shooter_primary_and_dash_actions() {
        let registry = InputActionRegistry::default();

        assert!(registry.is_action_active(
            1,
            InputState {
                space: 1,
                ..InputState::default()
            },
            InputState::default(),
        ));
        assert!(registry.is_action_active(
            1,
            InputState {
                mouse_left: 1,
                ..InputState::default()
            },
            InputState::default(),
        ));
        assert!(registry.is_action_active(
            2,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            InputState::default(),
        ));
        assert!(!registry.is_action_active(
            2,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            InputState {
                enter: 1,
                ..InputState::default()
            },
        ));
    }

    #[test]
    fn registry_set_binding_validates_codes_and_action_id() {
        let mut registry = InputActionRegistry::empty();

        assert!(!registry.set_binding(
            0,
            0,
            INPUT_ACTION_CONTROL_SPACE,
            INPUT_ACTION_ACTIVATION_DOWN
        ));
        assert!(!registry.set_binding(
            1,
            8,
            INPUT_ACTION_CONTROL_SPACE,
            INPUT_ACTION_ACTIVATION_DOWN
        ));
        assert!(!registry.set_binding(1, 0, 99, INPUT_ACTION_ACTIVATION_DOWN));
        assert!(!registry.set_binding(1, 0, INPUT_ACTION_CONTROL_SPACE, 99));
        assert!(registry.set_binding(
            7,
            0,
            INPUT_ACTION_CONTROL_MOUSE_LEFT,
            INPUT_ACTION_ACTIVATION_PRESSED,
        ));
        assert!(registry.is_action_active(
            7,
            InputState {
                mouse_left: 1,
                ..InputState::default()
            },
            InputState::default(),
        ));
        assert!(!registry.is_action_active(
            7,
            InputState {
                mouse_left: 1,
                ..InputState::default()
            },
            InputState {
                mouse_left: 1,
                ..InputState::default()
            },
        ));
    }

    #[test]
    fn registry_snapshot_round_trips_custom_bindings() {
        let mut registry = InputActionRegistry::default();
        assert!(registry.clear_action(1));
        assert!(registry.set_binding(
            1,
            7,
            INPUT_ACTION_CONTROL_ENTER,
            INPUT_ACTION_ACTIVATION_DOWN,
        ));
        let mut snapshot = [0; INPUT_ACTION_REGISTRY_SNAPSHOT_U32S];

        assert!(registry.write_snapshot(&mut snapshot));
        let restored = InputActionRegistry::from_snapshot(&snapshot).unwrap();

        assert!(!restored.is_action_active(
            1,
            InputState {
                space: 1,
                ..InputState::default()
            },
            InputState::default(),
        ));
        assert!(restored.is_action_active(
            1,
            InputState {
                enter: 1,
                ..InputState::default()
            },
            InputState::default(),
        ));
    }
}

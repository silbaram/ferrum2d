use wasm_bindgen::prelude::*;

use super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn set_input_action_binding(
        &mut self,
        action_id: u32,
        binding_index: u32,
        control_code: u32,
        activation_code: u32,
    ) -> bool {
        self.input_actions
            .set_binding(action_id, binding_index, control_code, activation_code)
    }

    pub fn clear_input_action_bindings(&mut self, action_id: u32) -> bool {
        self.input_actions.clear_action(action_id)
    }

    pub fn reset_input_action_bindings(&mut self) {
        self.input_actions = Default::default();
    }
}

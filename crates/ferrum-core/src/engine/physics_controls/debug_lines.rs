use wasm_bindgen::prelude::*;

use super::super::Engine;

#[wasm_bindgen]
impl Engine {
    pub fn set_physics_debug_lines_enabled(&mut self, enabled: bool) {
        self.physics_debug_lines_enabled = enabled;
        if !enabled {
            self.physics_debug_lines.clear();
        }
    }

    pub fn set_physics_debug_line_flags(&mut self, flags: u32) {
        self.physics_debug_line_flags = flags;
        if flags == 0 {
            self.physics_debug_lines.clear();
        }
    }
}

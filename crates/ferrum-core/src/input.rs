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

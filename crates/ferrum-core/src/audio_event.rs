#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AudioEvent {
    pub sound_id: f32,
    pub volume: f32,
    pub pitch: f32,
}

pub const AUDIO_CHANNEL_BGM: f32 = 0.0;
pub const AUDIO_CHANNEL_SFX: f32 = 1.0;
pub const AUDIO_CHANNEL_UI: f32 = 2.0;
pub const AUDIO_EVENT_FLOATS: usize = 4;
pub const AUDIO_EVENT_BYTES: usize = AUDIO_EVENT_FLOATS * std::mem::size_of::<f32>();

const _: () = assert!(core::mem::size_of::<AudioEvent>() == AUDIO_EVENT_BYTES);

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AudioEvent {
    pub sound_id: f32,
    pub volume: f32,
    pub pitch: f32,
    pub channel_id: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_event_abi_size_and_float_count_are_stable() {
        assert_eq!(std::mem::size_of::<AudioEvent>(), AUDIO_EVENT_BYTES);
        assert_eq!(
            std::mem::size_of::<AudioEvent>() / std::mem::size_of::<f32>(),
            AUDIO_EVENT_FLOATS
        );
    }

    #[test]
    fn audio_event_abi_layout_keeps_channel_id_after_pitch() {
        let event = AudioEvent {
            sound_id: 7.0,
            volume: 0.5,
            pitch: 1.25,
            channel_id: AUDIO_CHANNEL_UI,
        };

        // AudioEvent is repr(C) and made only of f32 fields, so TS reads this exact float order.
        let floats = unsafe {
            std::slice::from_raw_parts(
                (&event as *const AudioEvent).cast::<f32>(),
                AUDIO_EVENT_FLOATS,
            )
        };

        assert_eq!(floats, [7.0, 0.5, 1.25, AUDIO_CHANNEL_UI]);
    }
}

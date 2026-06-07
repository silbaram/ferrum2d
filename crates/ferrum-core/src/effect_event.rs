use crate::components::Transform2D;
use crate::entity::Entity;

pub const EFFECT_EVENT_BYTES: usize = std::mem::size_of::<EffectEvent>();

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct EffectEvent {
    pub effect_id: u32,
    pub effect_type: u32,
    pub actor_id: u32,
    pub actor_generation: u32,
    pub source_id: u32,
    pub source_generation: u32,
    pub x: f32,
    pub y: f32,
    pub intensity: f32,
    pub radius: f32,
}

impl EffectEvent {
    pub fn new(
        actor: Entity,
        source: Entity,
        effect_id: u32,
        effect_type: u32,
        position: Transform2D,
        intensity: f32,
        radius: f32,
    ) -> Self {
        Self {
            effect_id,
            effect_type,
            actor_id: actor.id,
            actor_generation: actor.generation,
            source_id: source.id,
            source_generation: source.generation,
            x: position.x,
            y: position.y,
            intensity,
            radius,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effect_event_abi_size_and_layout_are_stable() {
        assert_eq!(EFFECT_EVENT_BYTES, 40);

        let event = EffectEvent::new(
            Entity {
                id: 13,
                generation: 2,
            },
            Entity {
                id: 7,
                generation: 1,
            },
            99,
            4,
            Transform2D { x: 12.5, y: -3.0 },
            0.75,
            32.0,
        );

        let bytes = unsafe {
            std::slice::from_raw_parts(
                (&event as *const EffectEvent).cast::<u8>(),
                EFFECT_EVENT_BYTES,
            )
        };

        assert_eq!(u32::from_le_bytes(bytes[0..4].try_into().unwrap()), 99);
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 4);
        assert_eq!(u32::from_le_bytes(bytes[8..12].try_into().unwrap()), 13);
        assert_eq!(u32::from_le_bytes(bytes[12..16].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(bytes[16..20].try_into().unwrap()), 7);
        assert_eq!(u32::from_le_bytes(bytes[20..24].try_into().unwrap()), 1);
        assert_eq!(f32::from_le_bytes(bytes[24..28].try_into().unwrap()), 12.5);
        assert_eq!(f32::from_le_bytes(bytes[28..32].try_into().unwrap()), -3.0);
        assert_eq!(f32::from_le_bytes(bytes[32..36].try_into().unwrap()), 0.75);
        assert_eq!(f32::from_le_bytes(bytes[36..40].try_into().unwrap()), 32.0);
    }
}

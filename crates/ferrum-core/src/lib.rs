use wasm_bindgen::prelude::*;

pub mod audio_event;
pub mod collision;
pub mod components;
pub mod engine;
pub mod entity;
pub mod game_state;
pub mod input;
pub mod render_command;
pub mod world;

pub use audio_event::AudioEvent;
pub use collision::{CollisionPair, CollisionSystem};
pub use components::{AabbCollider, CollisionLayer, Sprite, Transform2D, Velocity};
pub use engine::Engine;
pub use entity::Entity;
pub use game_state::GameState;
pub use input::InputState;
pub use render_command::SpriteRenderCommand;
pub use world::World;

#[wasm_bindgen]
pub fn sprite_render_command_floats() -> usize {
    std::mem::size_of::<SpriteRenderCommand>() / std::mem::size_of::<f32>()
}

#[wasm_bindgen]
pub fn sprite_render_command_bytes() -> usize {
    std::mem::size_of::<SpriteRenderCommand>()
}

#[wasm_bindgen]
pub fn audio_event_floats() -> usize {
    std::mem::size_of::<AudioEvent>() / std::mem::size_of::<f32>()
}

#[wasm_bindgen]
pub fn audio_event_bytes() -> usize {
    std::mem::size_of::<AudioEvent>()
}

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}

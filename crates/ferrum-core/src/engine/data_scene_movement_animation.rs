use super::{Engine, SceneMode};
use crate::components::Transform2D;
use crate::entity::Entity;
use crate::world::World;
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy, Default)]
struct Pose {
    clip: u32,
    flip_x: bool,
    flip_y: bool,
}

struct Binding {
    actor: Entity,
    poses: [Pose; 8], // idle then walk; up/down/left/right
    facing: usize,
    before: Option<Transform2D>,
    was_following: bool,
}

/// Optional primary-actor presentation policy. Simulation and playback stay in Rust.
#[derive(Default)]
pub(super) struct DataSceneMovementAnimation {
    binding: Option<Binding>,
}

impl DataSceneMovementAnimation {
    pub(super) fn clear(&mut self) {
        self.binding = None;
    }

    pub(super) fn detach(&mut self, actor: Entity) {
        if self
            .binding
            .as_ref()
            .is_some_and(|binding| binding.actor == actor)
        {
            self.clear();
        }
    }

    pub(super) fn stop(&mut self, world: &mut World) {
        let Some(binding) = self.binding.as_mut() else {
            return;
        };
        if !valid_actor(world, binding.actor)
            || !apply_pose(world, binding.actor, binding.poses[binding.facing])
        {
            self.clear();
        }
    }

    pub(super) fn begin_step(&mut self, world: &World, following: bool, delta: f32) {
        let Some(binding) = self.binding.as_mut() else {
            return;
        };
        if !valid_actor(world, binding.actor) {
            self.clear();
            return;
        }
        binding.before = if delta.is_finite() && delta > 0.0 {
            world.transform(binding.actor)
        } else {
            None
        };
        binding.was_following = following;
    }

    pub(super) fn update(
        &mut self,
        world: &mut World,
        next: Option<Transform2D>,
        ended: bool,
        last_motion: Option<(f64, f64)>,
    ) {
        let Some(binding) = self.binding.as_mut() else {
            return;
        };
        if !valid_actor(world, binding.actor) {
            self.clear();
            return;
        }
        let Some(position) = world.transform(binding.actor) else {
            return;
        };
        let Some(before) = binding.before.take() else {
            return;
        };
        let (dx, dy) = if binding.was_following && ended {
            last_motion.unwrap_or((0.0, 0.0))
        } else if let Some(target) = next {
            (
                f64::from(target.x) - f64::from(position.x),
                f64::from(target.y) - f64::from(position.y),
            )
        } else {
            (
                f64::from(position.x) - f64::from(before.x),
                f64::from(position.y) - f64::from(before.y),
            )
        };
        let moved = dx != 0.0 || dy != 0.0;
        if moved {
            binding.facing = if dx.abs() >= dy.abs() {
                if dx < 0.0 {
                    2
                } else {
                    3
                }
            } else if dy < 0.0 {
                0
            } else {
                1
            };
        }
        let walking = next.is_some() || (moved && !(binding.was_following && ended));
        let pose = binding.poses[binding.facing + if walking { 4 } else { 0 }];
        if !apply_pose(world, binding.actor, pose) {
            self.clear();
        }
    }
}

fn valid_actor(world: &World, actor: Entity) -> bool {
    world.primary_actor_entity() == Some(actor)
        && world
            .transform(actor)
            .is_some_and(|at| at.x.is_finite() && at.y.is_finite())
        && world
            .sprite_playbacks
            .get(actor.id as usize)
            .is_some_and(Option::is_some)
        && world
            .sprites
            .get(actor.id as usize)
            .is_some_and(Option::is_some)
}

fn apply_pose(world: &mut World, actor: Entity, pose: Pose) -> bool {
    let index = actor.id as usize;
    let Some(playback) = world.sprite_playbacks[index].as_mut() else {
        return false;
    };
    if playback.clips[playback.active].id != pose.clip {
        let Some(active) = playback.clips.iter().position(|clip| clip.id == pose.clip) else {
            return false;
        };
        playback.active = active;
        playback.elapsed = 0.0;
    }
    playback.flip_x = pose.flip_x;
    playback.flip_y = pose.flip_y;
    playback.paused = false;
    if let Some(sprite) = world.sprites[index].as_mut() {
        playback.write_sprite(sprite);
    }
    true
}

#[wasm_bindgen]
impl Engine {
    /// Binds idle/walk poses to the primary actor. Eight [clip, flip_x, flip_y] records;
    /// direction order is up/down/left/right. Empty data detaches without changing playback.
    pub fn configure_data_scene_movement_animation(&mut self, poses: &[u32], facing: u32) -> bool {
        if self.scene_mode != SceneMode::Data {
            return false;
        }
        if poses.is_empty() {
            self.data_scene.movement_animation.clear();
            return true;
        }
        if poses.len() != 24 || facing > 3 {
            return false;
        }
        let Some(actor) = self.world.primary_actor_entity() else {
            return false;
        };
        if !valid_actor(&self.world, actor) {
            return false;
        }
        let Some(playback) = self.world.sprite_playbacks[actor.id as usize].as_ref() else {
            return false;
        };
        let mut compiled = [Pose::default(); 8];
        for (pose, input) in compiled.iter_mut().zip(poses.chunks_exact(3)) {
            if input[0] > 65535
                || input[1] > 1
                || input[2] > 1
                || !playback.clips.iter().any(|clip| clip.id == input[0])
            {
                return false;
            }
            *pose = Pose {
                clip: input[0],
                flip_x: input[1] != 0,
                flip_y: input[2] != 0,
            };
        }
        if !apply_pose(&mut self.world, actor, compiled[facing as usize]) {
            return false;
        }
        self.data_scene.movement_animation.binding = Some(Binding {
            actor,
            poses: compiled,
            facing: facing as usize,
            before: None,
            was_following: false,
        });
        true
    }
}

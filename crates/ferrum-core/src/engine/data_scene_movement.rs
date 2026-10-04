use super::scenes::SceneMode;
use super::Engine;
use crate::components::{CollisionMask, RigidBodyType, Transform2D, Velocity};
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::input::InputState;
use crate::physics::{KinematicSweepScratch, PhysicsCounters, PhysicsSystem};
use crate::tilemap::{Tilemap, TilemapNavigationScratch};
use crate::world::World;
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u32)]
enum MoveStatus {
    #[default]
    Idle = 0,
    Moving = 1,
    Arrived = 2,
    Blocked = 3,
    Cancelled = 4,
}

/// One scene-owned primary-actor route. No JS callbacks or per-frame path search.
pub(super) struct DataSceneMovement {
    status: MoveStatus,
    actor: Option<Entity>,
    destination: Transform2D,
    speed: f32,
    arrival_radius: f32,
    solid_mask: CollisionMask,
    cancel_on_input: bool,
    points: Vec<Transform2D>,
    next: usize,
    dirty: bool,
    last_position: Transform2D,
    pending_distance: f64,
    last_motion: Option<(f64, f64)>,
    search: TilemapNavigationScratch,
    sweep: KinematicSweepScratch,
}

impl Default for DataSceneMovement {
    fn default() -> Self {
        Self {
            status: MoveStatus::Idle,
            actor: None,
            destination: Transform2D::default(),
            speed: 0.0,
            arrival_radius: 0.0,
            solid_mask: CollisionMask::ALL,
            cancel_on_input: true,
            points: Vec::new(),
            next: 0,
            dirty: false,
            last_position: Transform2D::default(),
            pending_distance: 0.0,
            last_motion: None,
            search: TilemapNavigationScratch::default(),
            sweep: KinematicSweepScratch::default(),
        }
    }
}

impl DataSceneMovement {
    pub(super) fn animation_last_motion(&self) -> Option<(f64, f64)> {
        self.last_motion
    }
    pub(super) fn animation_target(&self) -> Option<Transform2D> {
        if self.status == MoveStatus::Moving {
            self.points.get(self.next).copied()
        } else {
            None
        }
    }

    pub(super) fn animation_ended(&self) -> bool {
        matches!(self.status, MoveStatus::Arrived | MoveStatus::Blocked)
    }

    pub(super) fn invalidate_route(&mut self) {
        self.dirty = true;
    }

    pub(super) fn cancel(&mut self) -> bool {
        if self.status != MoveStatus::Moving {
            return false;
        }
        self.finish(MoveStatus::Cancelled);
        true
    }

    fn finish(&mut self, status: MoveStatus) {
        self.status = status;
        self.actor = None;
        self.points.clear();
        self.next = 0;
        self.dirty = false;
        self.pending_distance = 0.0;
    }

    fn plan(&mut self, grid: &Tilemap, from: Transform2D, to: Transform2D) -> bool {
        let Some(start_center) = grid.data_scene_navigation_cell_center(from) else {
            return false;
        };
        let Some(goal_center) = grid.data_scene_navigation_cell_center(to) else {
            return false;
        };
        let Some(path) = grid.data_scene_navigation_path_with_scratch(from, to, &mut self.search)
        else {
            return false;
        };
        // Failed plans never replace the active route. Keep the centers at both ends:
        // cutting directly across an off-center corner can enter a blocked neighbor.
        self.points.clear();
        if start_center != goal_center {
            self.points.push(start_center);
            self.points.extend_from_slice(path);
        }
        if self.points.last() != Some(&to) {
            self.points.push(to);
        }
        self.next = 0;
        self.dirty = false;
        self.last_position = from;
        self.pending_distance = 0.0;
        true
    }

    pub(super) fn update(
        &mut self,
        world: &mut World,
        grid: &Tilemap,
        input: InputState,
        delta: f32,
        counters: &mut PhysicsCounters,
    ) {
        self.last_motion = None;
        let Some(actor) = self.actor else {
            return;
        };
        if world.primary_actor_entity() != Some(actor) || !supported_actor(world, actor) {
            self.finish(MoveStatus::Cancelled);
            return;
        }
        // Preserve velocity supplied by manual controls in this same input sample.
        if self.cancel_on_input && (input.w != 0 || input.a != 0 || input.s != 0 || input.d != 0) {
            self.finish(MoveStatus::Cancelled);
            return;
        }
        world.set_velocity(actor, Velocity::default());
        if !delta.is_finite() || delta <= 0.0 {
            return;
        }
        let Some(mut position) = world.transform(actor) else {
            return;
        };
        if (self.dirty || position != self.last_position)
            && !self.plan(grid, position, self.destination)
        {
            self.finish(MoveStatus::Blocked);
            return;
        }
        let mut budget = self.pending_distance + f64::from(self.speed) * f64::from(delta);
        // At most 4096 grid centers plus start/exact destination; no unbounded loop.
        while let Some(point) = self.points.get(self.next).copied() {
            let dx = f64::from(point.x) - f64::from(position.x);
            let dy = f64::from(point.y) - f64::from(position.y);
            let distance = dx.hypot(dy);
            let last = self.next + 1 == self.points.len();
            let tolerance = if last {
                f64::from(self.arrival_radius)
            } else {
                // Never skip a corner, even when grid cells are very small.
                0.0
            };
            if distance <= tolerance {
                self.next += 1;
                continue;
            }
            if budget <= 0.0 {
                break;
            }
            let step = budget.min(distance);
            let displacement = Velocity {
                vx: bounded_displacement(position.x, point.x, dx / distance * step),
                vy: bounded_displacement(position.y, point.y, dy / distance * step),
            };
            if !displacement.vx.is_finite() || !displacement.vy.is_finite() {
                self.finish(MoveStatus::Blocked);
                return;
            }
            let before = position;
            let movement = PhysicsSystem::move_navigation_actor_with_scratch(
                world,
                actor,
                displacement,
                self.solid_mask,
                &mut self.sweep,
                counters,
            );
            position = movement.end;
            self.last_position = position;
            if position != before {
                self.last_motion = Some((
                    f64::from(position.x) - f64::from(before.x),
                    f64::from(position.y) - f64::from(before.y),
                ));
            }
            let remaining = (f64::from(point.x) - f64::from(position.x))
                .hypot(f64::from(point.y) - f64::from(position.y));
            if movement.hit_count > 0 && remaining > tolerance {
                self.finish(MoveStatus::Blocked);
                return;
            }
            // Retain sub-epsilon / sub-ULP distance instead of losing it each frame.
            // Charge actual movement; negative credit repays float32 rounding forward.
            let travelled = (f64::from(position.x) - f64::from(before.x))
                .hypot(f64::from(position.y) - f64::from(before.y));
            if travelled == 0.0 {
                break;
            }
            budget -= travelled;
            if remaining <= tolerance {
                self.next += 1;
            } else {
                break;
            }
        }
        self.pending_distance = budget;
        if self.next == self.points.len() {
            self.finish(MoveStatus::Arrived);
        }
    }
}

fn bounded_displacement(from: f32, to: f32, requested: f64) -> f32 {
    let delta = requested as f32;
    // Casting a long segment can round its endpoint past the waypoint, even
    // though the f64 distance was capped. One ULP toward zero keeps the sweep
    // inside the segment; the residual distance is handled by the next step.
    if delta > 0.0 && from + delta > to {
        delta.next_down()
    } else if delta < 0.0 && from + delta < to {
        delta.next_up()
    } else {
        delta
    }
}

fn supported_actor(world: &World, actor: Entity) -> bool {
    world
        .rigid_body(actor)
        .is_some_and(|body| body.enabled && body.body_type == RigidBodyType::Kinematic)
        && world
            .collider(actor)
            .is_some_and(|collider| collider.enabled && !collider.is_trigger)
        && world.compound_collider_count(actor) == 1
        && world
            .transform(actor)
            .is_some_and(|position| position.x.is_finite() && position.y.is_finite())
}

#[wasm_bindgen]
impl Engine {
    /// Starts/replaces the primary actor's XY route. Invalid/unreachable requests preserve the old route.
    #[allow(clippy::too_many_arguments)]
    pub fn move_data_scene_actor_to(
        &mut self,
        x: f32,
        y: f32,
        speed: f32,
        arrival_radius: f32,
        solid_mask_bits: u32,
        cancel_on_input: bool,
    ) -> bool {
        if self.scene_mode != SceneMode::Data
            || self.data_scene.game_state() == GameState::LevelComplete
            || !x.is_finite()
            || !y.is_finite()
            || !speed.is_finite()
            || speed <= 0.0
            || !arrival_radius.is_finite()
            || arrival_radius < 0.0
        {
            return false;
        }
        let Some(actor) = self.world.primary_actor_entity() else {
            return false;
        };
        if !supported_actor(&self.world, actor) {
            return false;
        }
        let Some(from) = self.world.transform(actor) else {
            return false;
        };
        let destination = Transform2D { x, y };
        let movement = &mut self.data_scene.movement;
        if !movement.plan(&self.data_scene.navigation, from, destination) {
            return false;
        }
        movement.actor = Some(actor);
        movement.destination = destination;
        movement.speed = speed;
        movement.arrival_radius = arrival_radius;
        movement.solid_mask = CollisionMask::from_bits(solid_mask_bits);
        movement.cancel_on_input = cancel_on_input;
        movement.status = MoveStatus::Moving;
        self.world.set_velocity(actor, Velocity::default());
        true
    }

    /// Cancels only an active route; it never switches scenes.
    pub fn cancel_data_scene_move(&mut self) -> bool {
        if self.scene_mode != SceneMode::Data || !self.data_scene.movement.cancel() {
            return false;
        }
        self.data_scene.movement_animation.stop(&mut self.world);
        true
    }

    /// Idle/moving/arrived/blocked/cancelled = 0..4; u32::MAX outside Data Scene.
    pub fn data_scene_move_status(&self) -> u32 {
        if self.scene_mode == SceneMode::Data {
            self.data_scene.movement.status as u32
        } else {
            u32::MAX
        }
    }
}

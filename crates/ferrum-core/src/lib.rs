use wasm_bindgen::prelude::*;

const PLAYER_BASE_SPEED: f32 = 180.0;
const BULLET_SPEED: f32 = 360.0;
const BULLET_LIFETIME: f32 = 1.8;
const FIRE_COOLDOWN: f32 = 0.12;
const ENEMY_SPEED: f32 = 72.0;
const ENEMY_SPAWN_INTERVAL: f32 = 1.0;
const WORLD_WIDTH: f32 = 800.0;
const WORLD_HEIGHT: f32 = 480.0;
const INITIAL_ENEMY_COUNT: usize = 60;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Entity {
    pub id: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Transform2D {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sprite {
    pub width: f32,
    pub height: f32,
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Velocity {
    pub vx: f32,
    pub vy: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CollisionLayer {
    Player,
    Enemy,
    Bullet,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AabbCollider {
    pub half_width: f32,
    pub half_height: f32,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CollisionPair {
    pub a: Entity,
    pub b: Entity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameState {
    Title,
    Playing,
    GameOver,
}

#[derive(Default)]
pub struct CollisionSystem;

impl CollisionSystem {
    pub fn overlaps(at: Transform2D, ac: AabbCollider, bt: Transform2D, bc: AabbCollider) -> bool {
        let ax_min = at.x - ac.half_width;
        let ax_max = at.x + ac.half_width;
        let ay_min = at.y - ac.half_height;
        let ay_max = at.y + ac.half_height;
        let bx_min = bt.x - bc.half_width;
        let bx_max = bt.x + bc.half_width;
        let by_min = bt.y - bc.half_height;
        let by_max = bt.y + bc.half_height;
        ax_min <= bx_max && ax_max >= bx_min && ay_min <= by_max && ay_max >= by_min
    }

    pub fn build_pairs(world: &World) -> Vec<CollisionPair> {
        let mut out = Vec::new();
        let n = world.transforms.len();
        for i in 0..n {
            let Some(at) = world.transforms[i] else {
                continue;
            };
            let Some(ac) = world.colliders[i] else {
                continue;
            };
            for j in (i + 1)..n {
                let Some(bt) = world.transforms[j] else {
                    continue;
                };
                let Some(bc) = world.colliders[j] else {
                    continue;
                };
                if Self::overlaps(at, ac, bt, bc) {
                    out.push(CollisionPair {
                        a: Entity {
                            id: i as u32,
                            generation: world.generations[i],
                        },
                        b: Entity {
                            id: j as u32,
                            generation: world.generations[j],
                        },
                    });
                }
            }
        }
        out
    }
}

#[derive(Default)]
pub struct World {
    generations: Vec<u32>,
    pub alive: Vec<bool>,
    pub transforms: Vec<Option<Transform2D>>,
    pub sprites: Vec<Option<Sprite>>,
    pub velocities: Vec<Option<Velocity>>,
    pub colliders: Vec<Option<AabbCollider>>,
    pub bullet_lifetimes: Vec<Option<f32>>,
    pub player: Option<Entity>,
}

impl World {
    pub fn spawn_entity(&mut self) -> Entity {
        let id = self.generations.len() as u32;
        self.generations.push(0);
        self.alive.push(true);
        self.transforms.push(None);
        self.sprites.push(None);
        self.velocities.push(None);
        self.colliders.push(None);
        self.bullet_lifetimes.push(None);
        Entity { id, generation: 0 }
    }

    pub fn despawn(&mut self, entity: Entity) {
        let i = entity.id as usize;
        if i < self.alive.len() && self.alive[i] && self.generations[i] == entity.generation {
            self.alive[i] = false;
            self.generations[i] += 1;
            self.transforms[i] = None;
            self.sprites[i] = None;
            self.velocities[i] = None;
            self.colliders[i] = None;
            self.bullet_lifetimes[i] = None;
        }
    }

    pub fn spawn_player(&mut self, x: f32, y: f32) -> Entity {
        let e = self.spawn_entity();
        let i = e.id as usize;
        self.transforms[i] = Some(Transform2D { x, y });
        self.sprites[i] = Some(Sprite {
            width: 36.0,
            height: 36.0,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
        });
        self.velocities[i] = Some(Velocity::default());
        self.colliders[i] = Some(AabbCollider {
            half_width: 18.0,
            half_height: 18.0,
            is_trigger: true,
            layer: CollisionLayer::Player,
        });
        self.player = Some(e);
        e
    }

    pub fn spawn_enemy(&mut self, x: f32, y: f32) -> Entity {
        let e = self.spawn_entity();
        let i = e.id as usize;
        self.transforms[i] = Some(Transform2D { x, y });
        self.sprites[i] = Some(Sprite {
            width: 24.0,
            height: 24.0,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 0.9,
            g: 0.3,
            b: 0.3,
            a: 0.9,
        });
        self.colliders[i] = Some(AabbCollider {
            half_width: 12.0,
            half_height: 12.0,
            is_trigger: true,
            layer: CollisionLayer::Enemy,
        });
        e
    }

    pub fn spawn_bullet(&mut self, x: f32, y: f32, vx: f32, vy: f32) -> Entity {
        let e = self.spawn_entity();
        let i = e.id as usize;
        self.transforms[i] = Some(Transform2D { x, y });
        self.sprites[i] = Some(Sprite {
            width: 8.0,
            height: 8.0,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 1.0,
            g: 1.0,
            b: 0.2,
            a: 1.0,
        });
        self.velocities[i] = Some(Velocity { vx, vy });
        self.colliders[i] = Some(AabbCollider {
            half_width: 4.0,
            half_height: 4.0,
            is_trigger: true,
            layer: CollisionLayer::Bullet,
        });
        self.bullet_lifetimes[i] = Some(BULLET_LIFETIME);
        e
    }

    pub fn update(&mut self, delta: f32) {
        for i in 0..self.transforms.len() {
            if !self.alive[i] {
                continue;
            }
            if let (Some(t), Some(v)) = (self.transforms[i].as_mut(), self.velocities[i]) {
                t.x += v.vx * delta;
                t.y += v.vy * delta;
            }
        }
    }

    pub fn alive_count(&self) -> usize {
        self.alive.iter().filter(|a| **a).count()
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteRenderCommand {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct InputState {
    pub w: u8,
    pub a: u8,
    pub s: u8,
    pub d: u8,
    pub space: u8,
    pub mouse_left: u8,
    pub mouse_x: f32,
    pub mouse_y: f32,
}

#[wasm_bindgen]
pub struct Engine {
    elapsed_seconds: f64,
    score: u32,
    fire_cooldown_seconds: f32,
    enemy_spawn_timer: f32,
    input: InputState,
    game_state: GameState,
    spawn_index: u32,
    world: World,
    render_commands: Vec<SpriteRenderCommand>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut engine = Self {
            elapsed_seconds: 0.0,
            score: 0,
            fire_cooldown_seconds: 0.0,
            enemy_spawn_timer: ENEMY_SPAWN_INTERVAL,
            input: InputState::default(),
            game_state: GameState::Title,
            spawn_index: 0,
            world: World::default(),
            render_commands: Vec::with_capacity(256),
        };
        engine.reset_game();
        engine.game_state = GameState::Title;
        engine
    }
    pub fn set_input(
        &mut self,
        w: bool,
        a: bool,
        s: bool,
        d: bool,
        space: bool,
        mouse_left: bool,
        mouse_x: f32,
        mouse_y: f32,
    ) {
        self.input = InputState {
            w: u8::from(w),
            a: u8::from(a),
            s: u8::from(s),
            d: u8::from(d),
            space: u8::from(space),
            mouse_left: u8::from(mouse_left),
            mouse_x,
            mouse_y,
        };
    }
    pub fn update(&mut self, delta: f64) {
        let dt = delta as f32;
        self.elapsed_seconds += delta;
        if self.fire_cooldown_seconds > 0.0 {
            self.fire_cooldown_seconds = (self.fire_cooldown_seconds - dt).max(0.0);
        }
        if self.enemy_spawn_timer > 0.0 {
            self.enemy_spawn_timer -= dt;
        }

        match self.game_state {
            GameState::Title => {
                if self.input.space == 1 || self.input.mouse_left == 1 {
                    self.game_state = GameState::Playing;
                }
            }
            GameState::GameOver => {
                if self.input.space == 1 {
                    self.reset_game();
                    self.game_state = GameState::Playing;
                }
            }
            GameState::Playing => {
                self.apply_player_input();
                self.update_enemy_velocity();
                self.world.update(dt);
                self.update_bullets(dt);
                self.spawn_enemy_if_needed();
                self.handle_collisions();
            }
        }
        self.build_render_commands();
    }
    pub fn time(&self) -> f64 {
        self.elapsed_seconds
    }
    pub fn render_command_ptr(&self) -> *const SpriteRenderCommand {
        self.render_commands.as_ptr()
    }
    pub fn render_command_len(&self) -> usize {
        self.render_commands.len()
    }
    pub fn score(&self) -> u32 {
        self.score
    }
    pub fn entity_count(&self) -> usize {
        self.world.alive_count()
    }
    pub fn game_state_code(&self) -> u32 {
        match self.game_state {
            GameState::Title => 0,
            GameState::Playing => 1,
            GameState::GameOver => 2,
        }
    }
    pub fn sprite_count(&self) -> usize {
        self.render_commands.len()
    }
    pub fn reset_game(&mut self) {
        self.score = 0;
        self.fire_cooldown_seconds = 0.0;
        self.enemy_spawn_timer = ENEMY_SPAWN_INTERVAL;
        self.spawn_index = 0;
        self.world = World::default();
        self.world.spawn_player(360.0, 220.0);
        self.spawn_initial_enemy_grid();
    }
}

#[wasm_bindgen]
pub fn sprite_render_command_floats() -> usize {
    std::mem::size_of::<SpriteRenderCommand>() / std::mem::size_of::<f32>()
}
#[wasm_bindgen]
pub fn sprite_render_command_bytes() -> usize {
    std::mem::size_of::<SpriteRenderCommand>()
}
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
#[wasm_bindgen]
pub fn wasm_memory() -> JsValue {
    wasm_bindgen::memory()
}

impl Engine {
    fn normalized_input_direction(&self) -> Velocity {
        let mut x: f32 = 0.0;
        let mut y: f32 = 0.0;
        if self.input.w == 1 {
            y -= 1.0;
        }
        if self.input.s == 1 {
            y += 1.0;
        }
        if self.input.a == 1 {
            x -= 1.0;
        }
        if self.input.d == 1 {
            x += 1.0;
        }
        let len = (x * x + y * y).sqrt();
        if len > 0.0 {
            Velocity {
                vx: x / len,
                vy: y / len,
            }
        } else {
            Velocity::default()
        }
    }
    fn apply_player_input(&mut self) {
        let Some(player) = self.world.player else {
            return;
        };
        let dir = self.normalized_input_direction();
        self.world.velocities[player.id as usize] = Some(Velocity {
            vx: dir.vx * PLAYER_BASE_SPEED,
            vy: dir.vy * PLAYER_BASE_SPEED,
        });
        let wants_fire = self.input.space == 1 || self.input.mouse_left == 1;
        if wants_fire && self.fire_cooldown_seconds <= 0.0 {
            self.fire_bullet_toward_mouse(player);
            self.fire_cooldown_seconds = FIRE_COOLDOWN;
        }
    }
    fn fire_bullet_toward_mouse(&mut self, player: Entity) {
        let Some(player_t) = self.world.transforms[player.id as usize] else {
            return;
        };
        let dx = self.input.mouse_x - player_t.x;
        let dy = self.input.mouse_y - player_t.y;
        let len = (dx * dx + dy * dy).sqrt();
        let (nx, ny) = if len > 0.0001 {
            (dx / len, dy / len)
        } else {
            (1.0, 0.0)
        };
        self.world.spawn_bullet(
            player_t.x + nx * 20.0,
            player_t.y + ny * 20.0,
            nx * BULLET_SPEED,
            ny * BULLET_SPEED,
        );
    }
    fn update_enemy_velocity(&mut self) {
        let Some(player) = self.world.player else {
            return;
        };
        let Some(player_t) = self.world.transforms[player.id as usize] else {
            return;
        };
        for i in 0..self.world.transforms.len() {
            if !self.world.alive[i] {
                continue;
            }
            let Some(collider) = self.world.colliders[i] else {
                continue;
            };
            if collider.layer != CollisionLayer::Enemy {
                continue;
            }
            let Some(enemy_t) = self.world.transforms[i] else {
                continue;
            };
            let dx = player_t.x - enemy_t.x;
            let dy = player_t.y - enemy_t.y;
            let len = (dx * dx + dy * dy).sqrt();
            if len > 0.0001 {
                self.world.velocities[i] = Some(Velocity {
                    vx: dx / len * ENEMY_SPEED,
                    vy: dy / len * ENEMY_SPEED,
                });
            }
        }
    }
    fn update_bullets(&mut self, delta: f32) {
        let mut despawn = Vec::new();
        for i in 0..self.world.transforms.len() {
            if !self.world.alive[i] {
                continue;
            }
            if let Some(time_left) = self.world.bullet_lifetimes[i].as_mut() {
                *time_left -= delta;
            }
            let is_bullet = self.world.colliders[i]
                .map(|c| c.layer == CollisionLayer::Bullet)
                .unwrap_or(false);
            if !is_bullet {
                continue;
            }
            if self.world.bullet_lifetimes[i].is_some_and(|t| t <= 0.0) {
                despawn.push(Entity {
                    id: i as u32,
                    generation: self.world.generations[i],
                });
                continue;
            }
            if let Some(t) = self.world.transforms[i] {
                if t.x < -20.0
                    || t.x > WORLD_WIDTH + 20.0
                    || t.y < -20.0
                    || t.y > WORLD_HEIGHT + 20.0
                {
                    despawn.push(Entity {
                        id: i as u32,
                        generation: self.world.generations[i],
                    });
                }
            }
        }
        for e in despawn {
            self.world.despawn(e);
        }
    }
    fn spawn_enemy_if_needed(&mut self) {
        if self.enemy_spawn_timer > 0.0 {
            return;
        }
        self.enemy_spawn_timer = ENEMY_SPAWN_INTERVAL;
        let idx = self.spawn_index;
        self.spawn_index = self.spawn_index.wrapping_add(1);
        let lane = (idx % 6) as f32;
        let segment = idx % 4;
        let (x, y) = match segment {
            0 => (lane * (WORLD_WIDTH / 5.0), 0.0),
            1 => (WORLD_WIDTH, lane * (WORLD_HEIGHT / 5.0)),
            2 => (lane * (WORLD_WIDTH / 5.0), WORLD_HEIGHT),
            _ => (0.0, lane * (WORLD_HEIGHT / 5.0)),
        };
        self.world.spawn_enemy(x, y);
    }
    fn spawn_initial_enemy_grid(&mut self) {
        for i in 0..INITIAL_ENEMY_COUNT {
            let col = i % 10;
            let row = i / 10;
            self.world
                .spawn_enemy(60.0 + col as f32 * 56.0, 60.0 + row as f32 * 50.0);
        }
    }
    fn handle_collisions(&mut self) {
        let pairs = CollisionSystem::build_pairs(&self.world);
        let mut despawn: Vec<Entity> = Vec::new();
        for p in &pairs {
            let ai = p.a.id as usize;
            let bi = p.b.id as usize;
            if !self.world.alive[ai] || !self.world.alive[bi] {
                continue;
            }
            let Some(ac) = self.world.colliders[ai] else {
                continue;
            };
            let Some(bc) = self.world.colliders[bi] else {
                continue;
            };
            match (ac.layer, bc.layer) {
                (CollisionLayer::Bullet, CollisionLayer::Enemy)
                | (CollisionLayer::Enemy, CollisionLayer::Bullet) => {
                    despawn.push(p.a);
                    despawn.push(p.b);
                    self.score += 1;
                }
                (CollisionLayer::Player, CollisionLayer::Enemy)
                | (CollisionLayer::Enemy, CollisionLayer::Player) => {
                    self.game_state = GameState::GameOver;
                }
                _ => {}
            }
        }
        for e in despawn {
            self.world.despawn(e);
        }
    }
    fn build_render_commands(&mut self) {
        self.render_commands.clear();
        for i in 0..self.world.transforms.len() {
            if !self.world.alive[i] {
                continue;
            }
            if let (Some(t), Some(s)) = (self.world.transforms[i], self.world.sprites[i]) {
                self.render_commands.push(SpriteRenderCommand {
                    x: t.x,
                    y: t.y,
                    width: s.width,
                    height: s.height,
                    u0: s.u0,
                    v0: s.v0,
                    u1: s.u1,
                    v1: s.v1,
                    r: s.r,
                    g: s.g,
                    b: s.b,
                    a: s.a,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagonal_movement_is_normalized() {
        let mut engine = Engine::new();
        engine.game_state = GameState::Playing;
        engine.set_input(true, false, false, true, false, false, 0.0, 0.0);
        engine.apply_player_input();
        let player = engine.world.player.unwrap();
        let v = engine.world.velocities[player.id as usize].unwrap();
        let speed = (v.vx * v.vx + v.vy * v.vy).sqrt();
        assert!((speed - PLAYER_BASE_SPEED).abs() < 0.01);
    }
    #[test]
    fn bullet_lifetime_despawns() {
        let mut engine = Engine::new();
        engine.game_state = GameState::Playing;
        let b = engine.world.spawn_bullet(30.0, 30.0, 10.0, 0.0);
        engine.update_bullets(BULLET_LIFETIME + 0.1);
        assert!(!engine.world.alive[b.id as usize]);
    }
    #[test]
    fn bullet_enemy_collision_increments_score() {
        let mut engine = Engine::new();
        engine.game_state = GameState::Playing;
        let b = engine.world.spawn_bullet(50.0, 50.0, 0.0, 0.0);
        let e = engine.world.spawn_enemy(52.0, 50.0);
        engine.handle_collisions();
        assert!(!engine.world.alive[b.id as usize]);
        assert!(!engine.world.alive[e.id as usize]);
        assert_eq!(engine.score, 1);
    }
    #[test]
    fn player_enemy_collision_sets_game_over() {
        let mut engine = Engine::new();
        engine.game_state = GameState::Playing;
        let player = engine.world.player.unwrap();
        let pt = engine.world.transforms[player.id as usize].unwrap();
        engine.world.spawn_enemy(pt.x, pt.y);
        engine.handle_collisions();
        assert_eq!(engine.game_state, GameState::GameOver);
    }
    #[test]
    fn reset_game_clears_score_and_recreates_player() {
        let mut engine = Engine::new();
        engine.score = 42;
        if let Some(player) = engine.world.player {
            engine.world.despawn(player);
        }
        engine.world.player = None;
        engine.reset_game();
        assert_eq!(engine.score, 0);
        assert!(engine.world.player.is_some());
        let enemy_count = engine
            .world
            .alive
            .iter()
            .enumerate()
            .filter(|(idx, alive)| {
                **alive
                    && engine.world.colliders[*idx]
                        .is_some_and(|c| c.layer == CollisionLayer::Enemy)
            })
            .count();
        assert_eq!(enemy_count, INITIAL_ENEMY_COUNT);
    }
}

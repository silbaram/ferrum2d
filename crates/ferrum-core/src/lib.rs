use wasm_bindgen::prelude::*;

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
    Neutral,
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

    pub fn handle_trigger_events(&mut self, pairs: &[CollisionPair]) {
        let mut to_despawn: Vec<Entity> = Vec::new();
        for p in pairs {
            let ai = p.a.id as usize;
            let bi = p.b.id as usize;
            if !self.alive[ai] || !self.alive[bi] {
                continue;
            }
            let Some(ac) = self.colliders[ai] else {
                continue;
            };
            let Some(bc) = self.colliders[bi] else {
                continue;
            };
            if matches!(
                (ac.layer, bc.layer),
                (CollisionLayer::Bullet, CollisionLayer::Enemy)
                    | (CollisionLayer::Enemy, CollisionLayer::Bullet)
            ) {
                to_despawn.push(p.a);
                to_despawn.push(p.b);
            }
        }
        for e in to_despawn {
            self.despawn(e);
        }
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
    input: InputState,
    world: World,
    render_commands: Vec<SpriteRenderCommand>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let mut world = World::default();
        world.spawn_player(360.0, 220.0);
        for i in 0..60 {
            let col = i % 10;
            let row = i / 10;
            world.spawn_enemy(60.0 + col as f32 * 56.0, 60.0 + row as f32 * 50.0);
        }
        Self {
            elapsed_seconds: 0.0,
            input: InputState::default(),
            world,
            render_commands: Vec::with_capacity(256),
        }
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
        self.elapsed_seconds += delta;
        self.apply_player_input();
        self.world.update(delta as f32);
        let pairs = CollisionSystem::build_pairs(&self.world);
        self.world.handle_trigger_events(&pairs);
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
}

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

impl Engine {
    fn apply_player_input(&mut self) {
        if let Some(player) = self.world.player {
            let speed = if self.input.space == 1 { 280.0 } else { 180.0 };
            let mut vx = 0.0;
            let mut vy = 0.0;
            if self.input.w == 1 {
                vy -= speed;
            }
            if self.input.s == 1 {
                vy += speed;
            }
            if self.input.a == 1 {
                vx -= speed;
            }
            if self.input.d == 1 {
                vx += speed;
            }
            self.world.velocities[player.id as usize] = Some(Velocity { vx, vy });
            if self.input.mouse_left == 1 {
                if let Some(t) = self.world.transforms[player.id as usize] {
                    self.world.spawn_bullet(t.x + 14.0, t.y + 14.0, 240.0, 0.0);
                }
            }
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
    fn aabb_overlap_detects_hit() {
        let hit = CollisionSystem::overlaps(
            Transform2D { x: 10.0, y: 10.0 },
            AabbCollider {
                half_width: 4.0,
                half_height: 4.0,
                is_trigger: true,
                layer: CollisionLayer::Bullet,
            },
            Transform2D { x: 13.0, y: 10.0 },
            AabbCollider {
                half_width: 4.0,
                half_height: 4.0,
                is_trigger: true,
                layer: CollisionLayer::Enemy,
            },
        );
        assert!(hit);
    }

    #[test]
    fn bullet_enemy_collision_can_remove_enemy() {
        let mut w = World::default();
        let b = w.spawn_bullet(50.0, 50.0, 0.0, 0.0);
        let e = w.spawn_enemy(52.0, 50.0);
        let pairs = CollisionSystem::build_pairs(&w);
        w.handle_trigger_events(&pairs);
        assert!(!w.alive[b.id as usize]);
        assert!(!w.alive[e.id as usize]);
    }
}

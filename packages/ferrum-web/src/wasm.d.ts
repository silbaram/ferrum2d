declare module "../pkg/ferrum_core" {
  export interface InitOutput {
    readonly memory: WebAssembly.Memory;
  }

  export default function init(
    module_or_path?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module,
  ): Promise<InitOutput>;

  export class Engine {
    constructor();
    set_input(w:boolean,a:boolean,s:boolean,d:boolean,space:boolean,enter:boolean,mouse_left:boolean,mouse_x:number,mouse_y:number): void;
    set_texture_ids(player:number,enemy:number,bullet:number): void;
    set_sound_ids(shoot:number,hit:number,game_over:number): void;
    set_viewport_size(width:number,height:number): void;
    set_shooter_config(world_width:number,world_height:number,player_speed:number,enemy_speed:number,enemy_spawn_interval:number,bullet_speed:number,fire_cooldown:number,bullet_lifetime:number): void;
    set_shooter_prefabs(player_width:number,player_height:number,enemy_width:number,enemy_height:number,bullet_width:number,bullet_height:number): void;
    set_shooter_behavior(enemy_behavior:number): void;
    set_shooter_spawn_pattern(enemy_spawn_pattern:number): void;
    set_shooter_combat(enemy_health:number,bullet_damage:number,score_reward:number): void;
    set_shooter_resolved_config(world_width:number,world_height:number,player_speed:number,enemy_speed:number,enemy_spawn_interval:number,bullet_speed:number,fire_cooldown:number,bullet_lifetime:number,player_width:number,player_height:number,enemy_width:number,enemy_height:number,bullet_width:number,bullet_height:number,enemy_behavior:number,enemy_spawn_pattern:number,enemy_health:number,bullet_damage:number,score_reward:number): void;
    update(delta: number): void;
    time(): number;
    render_command_ptr(): number;
    render_command_len(): number;
    audio_event_ptr(): number;
    audio_event_len(): number;
    clear_events(): void;
    score(): number;
    entity_count(): number;
    game_state(): number;
    game_state_code(): number;
    sprite_count(): number;
    camera_x(): number;
    camera_y(): number;
    reset_game(): void;
    free(): void;
  }

  export function sprite_render_command_floats(): number;
  export function sprite_render_command_bytes(): number;
  export function audio_event_floats(): number;
  export function audio_event_bytes(): number;
  export function version(): string;
  export function wasm_memory(): WebAssembly.Memory;
}

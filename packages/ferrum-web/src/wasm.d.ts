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

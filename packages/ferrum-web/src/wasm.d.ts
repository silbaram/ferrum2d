declare module "../pkg/ferrum_core" {
  export interface InitOutput {
    readonly memory: WebAssembly.Memory;
  }

  export default function init(
    module_or_path?: RequestInfo | URL | Response | BufferSource | WebAssembly.Module,
  ): Promise<InitOutput>;

  export class Engine {
    constructor();
    set_input(w:boolean,a:boolean,s:boolean,d:boolean,space:boolean,mouse_left:boolean,mouse_x:number,mouse_y:number): void;
    update(delta: number): void;
    time(): number;
    render_command_ptr(): number;
    render_command_len(): number;
    free(): void;
  }

  export function sprite_render_command_floats(): number;
  export function sprite_render_command_bytes(): number;
  export function version(): string;
  export function wasm_memory(): WebAssembly.Memory;
}

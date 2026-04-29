declare module "../pkg/ferrum_core" {
  export const memory: WebAssembly.Memory;
  export default function init(): Promise<void>;

  export class Engine {
    constructor();
    set_input(w:boolean,a:boolean,s:boolean,d:boolean,space:boolean,mouse_left:boolean,mouse_x:number,mouse_y:number): void;
    update(delta: number): void;
    time(): number;
    render_command_ptr(): number;
    render_command_len(): number;
    free(): void;
  }

  export function version(): string;
}

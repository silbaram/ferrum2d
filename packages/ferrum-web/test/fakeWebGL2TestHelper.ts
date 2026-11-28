import { WebGL2Renderer, type WebGL2RendererOptions } from "../src/webgl2Renderer.js";

// Node stand-ins for the WebGL2 renderer's browser dependencies. They model the state the
// renderer saves and restores (framebuffers, viewport, clear color, mask, scissor) and count GPU
// allocations; rasterization is not modeled, so pixel results stay in the browser smokes.

export const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

type FakeResource = { readonly kind: string; readonly id: number };

/** A state-tracking WebGL2 stand-in: unknown entry points are no-ops, constants are unique. */
export function fakeWebGL2() {
  const constants = new Map<string, number>([["NO_ERROR", 0]]);
  let nextConstant = 0x10000;
  const constant = (name: string) => {
    let value = constants.get(name);
    if (value === undefined) {
      value = nextConstant++;
      constants.set(name, value);
    }
    return value;
  };
  let nextResource = 0;
  const live = { Texture: new Set<FakeResource>(), Framebuffer: new Set<FakeResource>() };
  const enabled = new Set<number>();
  const record = {
    uploads: [] as unknown[],
    clears: 0,
    draws: 0,
    flipY: [] as number[],
    failDraw: false,
    allocations: 0,
  };
  let drawFramebuffer: unknown = null;
  let readFramebuffer: unknown = null;
  let texture2d: unknown = null;
  let viewport = [0, 0, 128, 128];
  let clearColor = [0, 0, 0, 0];
  let colorMask = [true, true, true, true];
  let scissorBox = [0, 0, 128, 128];
  const methods: Record<string, (...args: never[]) => unknown> = {
    getParameter: ((name: number) => {
      if (name === constant("DRAW_FRAMEBUFFER_BINDING")) return drawFramebuffer;
      if (name === constant("READ_FRAMEBUFFER_BINDING")) return readFramebuffer;
      if (name === constant("TEXTURE_BINDING_2D")) return texture2d;
      if (name === constant("VIEWPORT")) return new Int32Array(viewport);
      if (name === constant("COLOR_CLEAR_VALUE")) return new Float32Array(clearColor);
      if (name === constant("COLOR_WRITEMASK")) return [...colorMask];
      if (name === constant("FRAMEBUFFER_BINDING")) return drawFramebuffer;
      if (name === constant("SCISSOR_BOX")) return new Int32Array(scissorBox);
      if (name === constant("MAX_TEXTURE_SIZE")) return 4096;
      if (name === constant("MAX_DRAW_BUFFERS")) return 8;
      if (name === constant("COMPRESSED_TEXTURE_FORMATS")) return new Uint32Array();
      return null;
    }) as never,
    bindFramebuffer: ((target: number, framebuffer: unknown) => {
      if (target !== constant("READ_FRAMEBUFFER")) drawFramebuffer = framebuffer;
      if (target !== constant("DRAW_FRAMEBUFFER")) readFramebuffer = framebuffer;
    }) as never,
    bindTexture: ((_target: number, texture: unknown) => { texture2d = texture; }) as never,
    viewport: ((x: number, y: number, width: number, height: number) => { viewport = [x, y, width, height]; }) as never,
    scissor: ((x: number, y: number, width: number, height: number) => { scissorBox = [x, y, width, height]; }) as never,
    clearColor: ((...rgba: number[]) => { clearColor = [...rgba].map(Math.fround); }) as never,
    colorMask: ((...mask: boolean[]) => { colorMask = [...mask]; }) as never,
    enable: ((cap: number) => { enabled.add(cap); }) as never,
    disable: ((cap: number) => { enabled.delete(cap); }) as never,
    isEnabled: ((cap: number) => enabled.has(cap)) as never,
    clear: (() => { record.clears += 1; }) as never,
    bufferSubData: ((_target: number, _offset: number, data: unknown) => { record.uploads.push(data); }) as never,
    drawElementsInstanced: (() => {
      if (record.failDraw) throw new Error("injected draw failure");
      record.draws += 1;
    }) as never,
    uniform1i: ((location: { uniform?: string } | null, value: number) => {
      if (location?.uniform === "u_texture_flip_y") record.flipY.push(value);
    }) as never,
    getUniformLocation: ((_program: unknown, uniform: string) => ({ uniform })) as never,
    getShaderParameter: (() => true) as never,
    getProgramParameter: (() => true) as never,
    getAttribLocation: (() => 0) as never,
    // Render-target formats are available; timer queries and context loss stay unsupported.
    getExtension: ((name: string) => ["EXT_color_buffer_float", "EXT_color_buffer_half_float", "OES_texture_float_linear"].includes(name)
      ? new Proxy({}, { get: (_target, property) => typeof property === "string" ? constant(`${name}.${property}`) : undefined })
      : null) as never,
    getSupportedExtensions: (() => []) as never,
    checkFramebufferStatus: (() => constant("FRAMEBUFFER_COMPLETE")) as never,
    isContextLost: (() => false) as never,
    getError: (() => 0) as never,
    // Readback has no rasterized image; report opaque white texels.
    readPixels: ((...args: unknown[]) => { const pixels = args[6]; if (ArrayBuffer.isView(pixels)) new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).fill(255); }) as never,
    deleteTexture: ((resource: FakeResource) => { live.Texture.delete(resource); }) as never,
    deleteFramebuffer: ((resource: FakeResource) => { live.Framebuffer.delete(resource); }) as never,
  };
  const gl = new Proxy({ drawingBufferWidth: 128, drawingBufferHeight: 128 } as Record<string, unknown>, {
    // Feature checks such as `"readBuffer" in gl` see a complete WebGL2 context.
    has: (_target, property) => typeof property === "string",
    get(target, property) {
      if (typeof property !== "string") return undefined;
      if (property in methods) return methods[property];
      if (property in target) return target[property];
      if (/^[A-Z0-9_]+$/.test(property)) return constant(property);
      if (property.startsWith("create")) {
        return () => {
          const resource = { kind: property.slice(6), id: ++nextResource };
          if (resource.kind === "Texture" || resource.kind === "Framebuffer") {
            live[resource.kind].add(resource);
            record.allocations += 1;
          }
          return resource;
        };
      }
      return () => undefined;
    },
  });
  const canvas = {
    width: 128, height: 128, clientWidth: 128, clientHeight: 128,
    getContext: (kind: string) => (kind === "webgl2" ? gl : null),
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 128, height: 128 }),
  };
  const callerState = () => ({
    draw: drawFramebuffer, read: readFramebuffer, viewport: [...viewport],
    clear: [...clearColor], mask: [...colorMask], scissor: enabled.has(constant("SCISSOR_TEST")),
  });
  const setCallerState = () => {
    const framebuffer = { kind: "CallerFramebuffer", id: ++nextResource };
    drawFramebuffer = framebuffer;
    readFramebuffer = framebuffer;
    viewport = [3, 4, 50, 60];
    clearColor = [0.25, 0.5, 0.75, 1].map(Math.fround);
    colorMask = [false, true, false, true];
    enabled.add(constant("SCISSOR_TEST"));
  };
  return { gl, canvas, live, record, callerState, setCallerState };
}

type BrowserGlobals = { document?: unknown; window?: unknown; createImageBitmap?: unknown };

/** Install the few browser globals the renderer touches outside the GL context; returns a restore. */
export function installRendererGlobals(): () => void {
  const globals = globalThis as unknown as BrowserGlobals;
  const previous = { document: globals.document, window: globals.window, createImageBitmap: globals.createImageBitmap };
  globals.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, fillStyle: "" }) }),
  };
  globals.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  globals.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
  return () => {
    globals.document = previous.document;
    globals.window = previous.window;
    globals.createImageBitmap = previous.createImageBitmap;
  };
}

export async function withRenderer(
  run: (fixture: ReturnType<typeof fakeWebGL2> & { renderer: WebGL2Renderer }) => Promise<void> | void,
  options: WebGL2RendererOptions = { clearColor: [0, 0, 0, 1] },
) {
  const restore = installRendererGlobals();
  const fake = fakeWebGL2();
  try {
    const renderer = new WebGL2Renderer(fake.canvas as unknown as HTMLCanvasElement, options);
    await run({ ...fake, renderer });
  } finally {
    restore();
  }
}

/** An ImageBitmap stand-in with the PNG's real size, for decoders that check image dimensions. */
export async function pngImageBitmap(blob: Blob): Promise<{ width: number; height: number; close(): void }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const png = bytes.length > 24 && view.getUint32(0) === 0x89504e47;
  return { width: png ? view.getUint32(16) : 1, height: png ? view.getUint32(20) : 1, close() {} };
}

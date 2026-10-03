import type { RenderTexture, RenderTextureOptions } from "./renderTexture";
import { WebGL2RenderTarget } from "./webgl2RenderTarget";

interface RenderTextureEntry {
  target: WebGL2RenderTarget;
  width: number;
  height: number;
  filter: "nearest" | "linear";
}

const RENDER_TEXTURE_UV = Object.freeze([0, 0, 1, 1] as const);

/** Owns GPU images separately from asset textures, avoiding double deletion. */
export class WebGL2RenderTextureStore {
  private readonly entries = new Map<RenderTexture, RenderTextureEntry>();
  private readonly byId = new Map<number, RenderTextureEntry>();
  private textureBytes = 0;
  private readonly retired = new WeakSet<RenderTexture>();

  constructor(private readonly gl: WebGL2RenderingContext, private readonly srgbStorage = false) {}

  has(textureId: number): boolean {
    return this.byId.has(textureId);
  }

  texture(textureId: number): WebGLTexture | undefined {
    return this.byId.get(textureId)?.target.texture;
  }

  create(textureId: number, options: RenderTextureOptions): RenderTexture {
    // Texture ids travel as f32 in the existing command ABI.
    if (!Number.isInteger(textureId) || textureId < 1 || textureId > 0xffffff || this.has(textureId)) {
      throw new Error("RenderTexture textureId must be unique and an integer in 1..16777215.");
    }
    const filter = options.filter ?? "nearest";
    if (filter !== "nearest" && filter !== "linear") throw new Error("Invalid RenderTexture filter.");
    const entry: RenderTextureEntry = {
      target: new WebGL2RenderTarget(this.gl, options.width, options.height, filter, this.srgbStorage),
      width: options.width,
      height: options.height,
      filter,
    };
    const handle: RenderTexture = Object.freeze({
      textureId,
      get width() { return entry.width; },
      get height() { return entry.height; },
      uv: RENDER_TEXTURE_UV,
    });
    this.textureBytes += entry.target.allocatedTextureBytes;
    this.entries.set(handle, entry);
    this.byId.set(textureId, entry);
    return handle;
  }

  target(handle: RenderTexture): WebGL2RenderTarget {
    return this.requireEntry(handle).target;
  }

  resize(handle: RenderTexture, width: number, height: number): void {
    const entry = this.requireEntry(handle);
    if (entry.width === width && entry.height === height) return;
    // Allocate first: a failed resize leaves the old image and handle intact.
    const next = new WebGL2RenderTarget(this.gl, width, height, entry.filter, this.srgbStorage);
    this.textureBytes += next.allocatedTextureBytes - entry.target.allocatedTextureBytes;
    entry.target.destroy();
    entry.target = next;
    entry.width = width;
    entry.height = height;
  }

  release(handle: RenderTexture): boolean {
    if (this.retired.has(handle)) return false;
    const target = this.requireEntry(handle).target;
    this.textureBytes -= target.allocatedTextureBytes;
    target.destroy();
    this.entries.delete(handle);
    this.byId.delete(handle.textureId);
    this.retired.add(handle);
    return true;
  }

  resourceStats(): { renderTargetCount: number; textureBytes: number } {
    return { renderTargetCount: this.entries.size, textureBytes: this.textureBytes };
  }

  destroy(): void {
    for (const handle of this.entries.keys()) this.release(handle);
  }

  private requireEntry(handle: RenderTexture): RenderTextureEntry {
    const entry = this.entries.get(handle);
    if (!entry) throw new Error("RenderTexture belongs to another renderer or has been destroyed.");
    return entry;
  }
}

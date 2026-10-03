/** Renderer-owned opaque 8-bit RGBA image; use its textureId and uv in sprite commands. */
export interface RenderTexture {
  readonly textureId: number;
  /** Physical texel dimensions, independent of canvas DPR. */
  readonly width: number;
  readonly height: number;
  /** Standard top-left sprite UVs [0, 0, 1, 1]; the renderer handles framebuffer orientation. */
  readonly uv: readonly [number, number, number, number];
}

export interface RenderTextureOptions {
  width: number;
  height: number;
  filter?: "nearest" | "linear";
}

export interface RenderToTextureOptions {
  /** Screen-coordinate extent of the supplied commands; defaults to the canvas viewport. */
  viewport?: { width: number; height: number };
  /** Opaque RGB clear color in [0, 1]. Alpha is always 1 in this first version. */
  clearColor?: readonly [number, number, number];
}

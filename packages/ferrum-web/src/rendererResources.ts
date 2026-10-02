/** Renderer-owned live allocations, independent of per-frame draw statistics. */
export interface RendererResourceStats {
  /** Unique textures, including the placeholder and render target attachments. */
  textureCount: number;
  bufferCount: number;
  /** Linked WebGL programs. Compiled code size is not estimated. */
  programCount: number;
  /** Framebuffers; their color attachments are already included in textureCount. */
  renderTargetCount: number;
  /** Textures adopted without known dimensions. */
  unmeasuredTextureCount: number;
  /** RGBA8/SRGB8_ALPHA8 base-level storage; absent if any texture size is unknown. */
  textureBytes?: number;
  /** Allocated buffer capacity, including unused capacity. */
  bufferBytes: number;
  /** textureBytes + bufferBytes. An estimate, not measured VRAM usage. */
  estimatedBytes?: number;
}

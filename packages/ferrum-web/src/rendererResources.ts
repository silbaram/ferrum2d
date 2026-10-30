/** Renderer-owned live allocations, independent of per-frame draw statistics. */
export interface RendererResourceStats {
  /** Unique textures, including the placeholder and render target attachments. */
  textureCount: number;
  bufferCount: number;
  /** Linked WebGL programs or retained WebGPU render pipelines. Code size is not estimated. */
  programCount: number;
  /** WebGL framebuffers or WebGPU attachment textures. Attachments also count as textures. */
  renderTargetCount: number;
  /** Textures with unknown dimensions or implementation-dependent storage formats. */
  unmeasuredTextureCount: number;
  /** Known texture storage (WebGPU includes mips/layers); absent if any size is unknown. */
  textureBytes?: number;
  /** Allocated buffer capacity, including unused capacity. */
  bufferBytes: number;
  /** textureBytes + bufferBytes. An estimate, not measured VRAM usage. */
  estimatedBytes?: number;
}

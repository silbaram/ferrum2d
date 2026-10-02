import type { Ktx2TextureFormat } from "./ktx2Texture";

export interface WebGL2CompressedTextureFormat {
  format: Ktx2TextureFormat;
  internalFormat: number;
}

/** Capability checks run during asset loading, never during sprite drawing. */
export function selectWebGL2Ktx2Format(gl: WebGL2RenderingContext, srgb: boolean): WebGL2CompressedTextureFormat | undefined {
  gl.getExtension("WEBGL_compressed_texture_astc");
  gl.getExtension("EXT_texture_compression_bptc");
  gl.getExtension("WEBGL_compressed_texture_etc");
  const supported: Uint32Array = gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);
  const formats: WebGL2CompressedTextureFormat[] = [
    { format: "astc-4x4", internalFormat: srgb ? 0x93d0 : 0x93b0 },
    { format: "bc7", internalFormat: srgb ? 0x8e8d : 0x8e8c },
    { format: "etc2-rgba", internalFormat: srgb ? 0x9279 : 0x9278 },
  ];
  return formats.find((candidate) => supported?.includes(candidate.internalFormat));
}

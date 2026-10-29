/** Internal, column-major glTF UV affine matrix. Immutable after CPU asset admission. */
export const IDENTITY_SPATIAL_UV = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const supportedExtensions = new Set(["KHR_materials_unlit", "KHR_materials_emissive_strength", "KHR_texture_transform"]);

export function validateSpatialRequiredExtensions(value: unknown = []): void {
  if (!Array.isArray(value) || value.length > 4096 || value.some(v => typeof v !== "string" || !supportedExtensions.has(v))) {
    throw new Error("Spatial glTF: required extensions are unsupported");
  }
}

const fail = (detail: string): never => { throw new Error(`Spatial GLB texture transform: ${detail}`); };
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("expected object");
  // Validated JSON object; its fields are still unknown until checked below.
  return value as Record<string, unknown>;
}
function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(Math.fround(value))) return fail("expected finite f32");
  return value;
}
function vector(value: unknown, fallback: readonly number[]): number[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.length !== 2) return fail("offset/scale must contain two numbers");
  // Indexed reads reject sparse arrays as well as explicit undefined/null.
  return [finite(value[0]), finite(value[1])];
}
function uvSet(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail("invalid texCoord");
  return value;
}

/** KHR_texture_transform applies scale, rotation (radians), then offset, with a top-left UV origin. */
export function resolveSpatialTextureTransform(ref: Record<string, unknown>): Float32Array | undefined {
  const extensions = ref.extensions === undefined ? {} : record(ref.extensions);
  if (Object.keys(extensions).some(key => key !== "KHR_texture_transform")) return fail("unsupported textureInfo extension");
  const raw = extensions.KHR_texture_transform;
  const transform = raw === undefined ? {} : record(raw);
  const originalSet = uvSet(ref.texCoord === undefined ? 0 : ref.texCoord);
  const selectedSet = transform.texCoord === undefined ? originalSet : uvSet(transform.texCoord);
  if (selectedSet !== 0) return fail("only TEXCOORD_0 is supported");
  if (raw === undefined) return undefined;
  const [x, y] = vector(transform.offset, [0, 0]);
  const [sx, sy] = vector(transform.scale, [1, 1]);
  const rotation = finite(transform.rotation === undefined ? 0 : transform.rotation);
  const c = Math.cos(rotation), s = Math.sin(rotation);
  // UV +V points down: positive rotation is counterclockwise in this space.
  // Match Blender/three.js, not the historical Y-up GLSL example (glTF issue #1563).
  const matrix = new Float32Array([c * sx, -s * sx, 0, s * sy, c * sy, 0, x, y, 1]);
  if (!matrix.every(Number.isFinite)) return fail("matrix overflow");
  return matrix.every((value, index) => value === IDENTITY_SPATIAL_UV[index]) ? undefined : matrix;
}

/** Reject GPU intermediate overflow before allocating decoded images or GPU resources. */
export function validateSpatialTransformedUvs(uv: readonly number[], matrix?: Float32Array): void {
  if (!matrix) return;
  for (let i = 0; i < uv.length; i += 2) {
    for (const row of [0, 1]) {
      const bound = Math.abs(matrix[row] * uv[i]) + Math.abs(matrix[row + 3] * uv[i + 1]) + Math.abs(matrix[row + 6]);
      if (!Number.isFinite(Math.fround(bound))) return fail("transformed UV exceeds f32 range");
    }
  }
}

export function spatialTransformedUv(u: number, v: number, matrix?: Float32Array): [number, number] {
  return matrix ? [matrix[0] * u + matrix[3] * v + matrix[6], matrix[1] * u + matrix[4] * v + matrix[7]] : [u, v];
}

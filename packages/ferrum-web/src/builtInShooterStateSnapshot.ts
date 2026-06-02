export const BUILT_IN_SHOOTER_STATE_FORMAT = "ferrum2d.builtin-shooter-state";
export const BUILT_IN_SHOOTER_STATE_VERSION = 11;
export const BUILT_IN_SHOOTER_STATE_HEADER_FLOATS = 8;
export const BUILT_IN_SHOOTER_STATE_HEADER_U32S = 37;
export const BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY = 35;
export const BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY = 21;

export interface BuiltInShooterStateSnapshot {
  readonly format: typeof BUILT_IN_SHOOTER_STATE_FORMAT;
  readonly version: typeof BUILT_IN_SHOOTER_STATE_VERSION;
  readonly headerFloats: readonly number[];
  readonly headerU32s: readonly number[];
  readonly entityFloats: readonly number[];
  readonly entityU32s: readonly number[];
  readonly entityCount: number;
  readonly floatsPerEntity: number;
  readonly u32sPerEntity: number;
}

export function validateBuiltInShooterStateSnapshot(snapshot: BuiltInShooterStateSnapshot): void {
  if (snapshot.format !== BUILT_IN_SHOOTER_STATE_FORMAT) {
    throw new Error(`built-in shooter state format must be '${BUILT_IN_SHOOTER_STATE_FORMAT}'.`);
  }
  if (snapshot.version !== BUILT_IN_SHOOTER_STATE_VERSION) {
    throw new Error(`built-in shooter state version must be ${BUILT_IN_SHOOTER_STATE_VERSION}.`);
  }
  if (snapshot.headerU32s[0] !== snapshot.version) {
    throw new Error("built-in shooter state headerU32s.0 must match version.");
  }
  if (snapshot.headerFloats.length !== BUILT_IN_SHOOTER_STATE_HEADER_FLOATS) {
    throw new Error(`built-in shooter state headerFloats length must be ${BUILT_IN_SHOOTER_STATE_HEADER_FLOATS}.`);
  }
  if (snapshot.headerU32s.length !== BUILT_IN_SHOOTER_STATE_HEADER_U32S) {
    throw new Error(`built-in shooter state headerU32s length must be ${BUILT_IN_SHOOTER_STATE_HEADER_U32S}.`);
  }
  if (!Number.isInteger(snapshot.entityCount) || snapshot.entityCount < 0) {
    throw new Error("built-in shooter state entityCount must be a non-negative integer.");
  }
  if (!Number.isInteger(snapshot.floatsPerEntity) || snapshot.floatsPerEntity <= 0) {
    throw new Error("built-in shooter state floatsPerEntity must be a positive integer.");
  }
  if (snapshot.floatsPerEntity !== BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY) {
    throw new Error(`built-in shooter state floatsPerEntity must be ${BUILT_IN_SHOOTER_STATE_FLOATS_PER_ENTITY}.`);
  }
  if (!Number.isInteger(snapshot.u32sPerEntity) || snapshot.u32sPerEntity <= 0) {
    throw new Error("built-in shooter state u32sPerEntity must be a positive integer.");
  }
  if (snapshot.u32sPerEntity !== BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY) {
    throw new Error(`built-in shooter state u32sPerEntity must be ${BUILT_IN_SHOOTER_STATE_U32S_PER_ENTITY}.`);
  }
  if (snapshot.entityFloats.length !== snapshot.entityCount * snapshot.floatsPerEntity) {
    throw new Error("built-in shooter state entityFloats length does not match entityCount.");
  }
  if (snapshot.entityU32s.length !== snapshot.entityCount * snapshot.u32sPerEntity) {
    throw new Error("built-in shooter state entityU32s length does not match entityCount.");
  }
  for (const value of snapshot.headerFloats) {
    validateFiniteNumber(value, "built-in shooter state float");
  }
  for (const value of snapshot.entityFloats) {
    validateFiniteNumber(value, "built-in shooter state float");
  }
  for (const value of snapshot.headerU32s) {
    validateUint32(value, "built-in shooter state u32");
  }
  for (const value of snapshot.entityU32s) {
    validateUint32(value, "built-in shooter state u32");
  }
}

function validateFiniteNumber(value: number, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be finite.`);
  }
}

function validateUint32(value: number, path: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${path} must be an unsigned 32-bit integer.`);
  }
}

import type { RenderCommandBufferView } from "./renderCommandDecoder.js";
import type {
  BuiltInShooterStateFieldOffsets,
  BuiltInShooterStateLayout,
  RenderCommandFieldOffsets,
} from "./wasmBridgeAbi.js";

const EMPTY_FLOATS = new Float32Array(0);
const EMPTY_NUMBERS: readonly number[] = Object.freeze([]);

export type BuiltInShooterGameState = "title" | "playing" | "gameOver";
export type BuiltInShooterEntityKind = "player" | "enemy" | "bullet";

export interface BuiltInShooterStateBuffers {
  readonly headerFloats: ArrayLike<number>;
  readonly headerU32s: ArrayLike<number>;
  readonly entityFloats: ArrayLike<number>;
  readonly entityU32s: ArrayLike<number>;
  readonly entityCount: number;
  readonly floatsPerEntity: number;
  readonly u32sPerEntity: number;
}

export interface MutableNumberBuffer extends ArrayLike<number> {
  [index: number]: number;
}

export interface MutableBuiltInShooterStateBuffers extends BuiltInShooterStateBuffers {
  readonly headerFloats: MutableNumberBuffer;
  readonly headerU32s: MutableNumberBuffer;
  readonly entityFloats: MutableNumberBuffer;
  readonly entityU32s: MutableNumberBuffer;
}

/**
 * Rust가 제공한 SpriteRenderCommand layout으로 frame buffer를 읽는 재사용 accessor입니다.
 * bind/select는 accessor 내부 참조만 갱신하며 객체나 배열을 만들지 않습니다.
 */
export interface RenderCommandAccessor {
  bind(view: RenderCommandBufferView): void;
  select(commandIndex: number): void;
  readonly commandIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
  readonly textureId: number;
  readonly effectFlags: number;
  readonly rotationRadians: number;
}

/**
 * Built-in Shooter snapshot buffer를 명명된 필드로 읽고 쓰는 재사용 accessor입니다.
 * 쓰기가 필요하면 bindMutable을 사용하고, entity 필드는 select/selectFirst로 선택합니다.
 */
export interface BuiltInShooterStateAccessor {
  bind(snapshot: BuiltInShooterStateBuffers): void;
  bindMutable(snapshot: MutableBuiltInShooterStateBuffers): void;
  select(entityIndex: number): void;
  selectFirst(kind: BuiltInShooterEntityKind): boolean;
  readonly entityIndex: number;

  readonly version: number;
  gameState: BuiltInShooterGameState;
  score: number;
  spawnIndex: number;
  activeWaveIndex: number;
  waveSpawnedCount: number;
  fireCooldownSeconds: number;
  enemySpawnTimer: number;
  waveElapsedSeconds: number;
  cameraElapsedSeconds: number;
  cameraX: number;
  cameraY: number;
  previousMouseX: number;
  previousMouseY: number;

  kind: BuiltInShooterEntityKind;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  health: number;
  damage: number;
  lifetimeSeconds: number;
  scoreReward: number;
  projectilePolicy: number;

  readonly primaryActionId: number;
  readonly primaryActionCooldownDuration: number;
  readonly primaryActionCooldownRemaining: number;
  readonly primaryActionProjectileSpeed: number;
  readonly primaryActionProjectileDamage: number;
  readonly primaryActionProjectileLifetime: number;
  readonly dashActionId: number;
  readonly dashCooldownDuration: number;
  readonly dashCooldownRemaining: number;
  readonly dashDistance: number;
  readonly meleeActionId: number;
  readonly meleeCooldownDuration: number;
  readonly meleeCooldownRemaining: number;
  readonly meleeRange: number;
  readonly meleeDamage: number;
}

export function createRenderCommandAccessor(
  offsets: RenderCommandFieldOffsets,
  floatsPerCommand: number,
): RenderCommandAccessor {
  return new ReusableRenderCommandAccessor(offsets, floatsPerCommand);
}

export function createBuiltInShooterStateAccessor(
  layout: BuiltInShooterStateLayout,
): BuiltInShooterStateAccessor {
  return new ReusableBuiltInShooterStateAccessor(layout);
}

class ReusableRenderCommandAccessor implements RenderCommandAccessor {
  private buffer: Float32Array = EMPTY_FLOATS;
  private commandCount = 0;
  private isBound = false;
  private selectedCommandIndex = -1;
  private selectedBase = -1;

  constructor(
    private readonly offsets: RenderCommandFieldOffsets,
    private readonly floatsPerCommand: number,
  ) {}

  bind(view: RenderCommandBufferView): void {
    this.clearBinding();
    if (view.floatsPerCommand !== this.floatsPerCommand) {
      throw new Error(
        `render command stride ${view.floatsPerCommand} does not match accessor stride ${this.floatsPerCommand}.`,
      );
    }
    if (!Number.isSafeInteger(view.commandCount) || view.commandCount < 0) {
      throw new Error("render command count must be a non-negative safe integer.");
    }
    if (view.buffer.length !== view.commandCount * view.floatsPerCommand) {
      throw new Error("render command buffer length does not match commandCount.");
    }
    this.buffer = view.buffer;
    this.commandCount = view.commandCount;
    this.isBound = true;
  }

  select(commandIndex: number): void {
    this.clearSelection();
    this.requireBound();
    if (!Number.isInteger(commandIndex) || commandIndex < 0 || commandIndex >= this.commandCount) {
      throw new RangeError(
        `render command index ${commandIndex} is outside a buffer with ${this.commandCount} commands.`,
      );
    }
    this.selectedCommandIndex = commandIndex;
    this.selectedBase = commandIndex * this.floatsPerCommand;
  }

  get commandIndex(): number {
    return this.selectedCommandIndex;
  }

  get x(): number { return this.read(this.offsets.x); }
  get y(): number { return this.read(this.offsets.y); }
  get width(): number { return this.read(this.offsets.width); }
  get height(): number { return this.read(this.offsets.height); }
  get u0(): number { return this.read(this.offsets.u0); }
  get v0(): number { return this.read(this.offsets.v0); }
  get u1(): number { return this.read(this.offsets.u1); }
  get v1(): number { return this.read(this.offsets.v1); }
  get r(): number { return this.read(this.offsets.r); }
  get g(): number { return this.read(this.offsets.g); }
  get b(): number { return this.read(this.offsets.b); }
  get a(): number { return this.read(this.offsets.a); }
  get textureId(): number { return Math.trunc(this.read(this.offsets.textureId)); }
  get effectFlags(): number { return this.read(this.offsets.effectFlags); }
  get rotationRadians(): number { return this.read(this.offsets.rotationRadians); }

  private read(offset: number): number {
    this.requireBound();
    if (this.selectedBase < 0) {
      throw new Error("select a render command before reading fields.");
    }
    return this.buffer[this.selectedBase + offset];
  }

  private clearBinding(): void {
    this.buffer = EMPTY_FLOATS;
    this.commandCount = 0;
    this.isBound = false;
    this.clearSelection();
  }

  private clearSelection(): void {
    this.selectedCommandIndex = -1;
    this.selectedBase = -1;
  }

  private requireBound(): void {
    if (!this.isBound) {
      throw new Error("bind a render command buffer before selecting or reading fields.");
    }
  }
}

class ReusableBuiltInShooterStateAccessor implements BuiltInShooterStateAccessor {
  private headerFloats: ArrayLike<number> = EMPTY_NUMBERS;
  private headerU32s: ArrayLike<number> = EMPTY_NUMBERS;
  private entityFloats: ArrayLike<number> = EMPTY_NUMBERS;
  private entityU32s: ArrayLike<number> = EMPTY_NUMBERS;
  private mutableHeaderFloats: MutableNumberBuffer | undefined;
  private mutableHeaderU32s: MutableNumberBuffer | undefined;
  private mutableEntityFloats: MutableNumberBuffer | undefined;
  private mutableEntityU32s: MutableNumberBuffer | undefined;
  private entityCount = 0;
  private isBound = false;
  private selectedEntityIndex = -1;
  private selectedFloatBase = -1;
  private selectedU32Base = -1;

  constructor(private readonly layout: BuiltInShooterStateLayout) {}

  bind(snapshot: BuiltInShooterStateBuffers): void {
    this.clearBinding();
    this.bindBuffers(snapshot);
  }

  bindMutable(snapshot: MutableBuiltInShooterStateBuffers): void {
    this.clearBinding();
    this.bindBuffers(snapshot);
    this.mutableHeaderFloats = snapshot.headerFloats;
    this.mutableHeaderU32s = snapshot.headerU32s;
    this.mutableEntityFloats = snapshot.entityFloats;
    this.mutableEntityU32s = snapshot.entityU32s;
  }

  select(entityIndex: number): void {
    this.clearSelection();
    this.requireBound();
    if (!Number.isInteger(entityIndex) || entityIndex < 0 || entityIndex >= this.entityCount) {
      throw new RangeError(
        `shooter snapshot entity index ${entityIndex} is outside a snapshot with ${this.entityCount} entities.`,
      );
    }
    this.selectUnchecked(entityIndex);
  }

  selectFirst(kind: BuiltInShooterEntityKind): boolean {
    this.clearSelection();
    this.requireBound();
    const expectedKind = entityKindCode(kind);
    const kindOffset = this.layout.fieldOffsets.entityU32s.kind;
    for (let entityIndex = 0; entityIndex < this.entityCount; entityIndex += 1) {
      const base = entityIndex * this.layout.u32sPerEntity;
      if (this.entityU32s[base + kindOffset] === expectedKind) {
        this.selectUnchecked(entityIndex);
        return true;
      }
    }
    return false;
  }

  get entityIndex(): number { return this.selectedEntityIndex; }

  get version(): number { return this.readHeaderU32(this.fields.headerU32s.version); }
  get gameState(): BuiltInShooterGameState {
    return gameStateFromCode(this.readHeaderU32(this.fields.headerU32s.gameState));
  }
  set gameState(value: BuiltInShooterGameState) {
    this.writeHeaderU32(this.fields.headerU32s.gameState, gameStateCode(value));
  }
  get score(): number { return this.readHeaderU32(this.fields.headerU32s.score); }
  set score(value: number) { this.writeHeaderU32(this.fields.headerU32s.score, value); }
  get spawnIndex(): number { return this.readHeaderU32(this.fields.headerU32s.spawnIndex); }
  set spawnIndex(value: number) { this.writeHeaderU32(this.fields.headerU32s.spawnIndex, value); }
  get activeWaveIndex(): number { return this.readHeaderU32(this.fields.headerU32s.activeWaveIndex); }
  set activeWaveIndex(value: number) { this.writeHeaderU32(this.fields.headerU32s.activeWaveIndex, value); }
  get waveSpawnedCount(): number { return this.readHeaderU32(this.fields.headerU32s.waveSpawnedCount); }
  set waveSpawnedCount(value: number) { this.writeHeaderU32(this.fields.headerU32s.waveSpawnedCount, value); }
  get fireCooldownSeconds(): number { return this.readHeaderFloat(this.fields.headerFloats.fireCooldownSeconds); }
  set fireCooldownSeconds(value: number) { this.writeHeaderFloat(this.fields.headerFloats.fireCooldownSeconds, value); }
  get enemySpawnTimer(): number { return this.readHeaderFloat(this.fields.headerFloats.enemySpawnTimer); }
  set enemySpawnTimer(value: number) { this.writeHeaderFloat(this.fields.headerFloats.enemySpawnTimer, value); }
  get waveElapsedSeconds(): number { return this.readHeaderFloat(this.fields.headerFloats.waveElapsedSeconds); }
  set waveElapsedSeconds(value: number) { this.writeHeaderFloat(this.fields.headerFloats.waveElapsedSeconds, value); }
  get cameraElapsedSeconds(): number { return this.readHeaderFloat(this.fields.headerFloats.cameraElapsedSeconds); }
  set cameraElapsedSeconds(value: number) { this.writeHeaderFloat(this.fields.headerFloats.cameraElapsedSeconds, value); }
  get cameraX(): number { return this.readHeaderFloat(this.fields.headerFloats.cameraX); }
  set cameraX(value: number) { this.writeHeaderFloat(this.fields.headerFloats.cameraX, value); }
  get cameraY(): number { return this.readHeaderFloat(this.fields.headerFloats.cameraY); }
  set cameraY(value: number) { this.writeHeaderFloat(this.fields.headerFloats.cameraY, value); }
  get previousMouseX(): number { return this.readHeaderFloat(this.fields.headerFloats.previousMouseX); }
  set previousMouseX(value: number) { this.writeHeaderFloat(this.fields.headerFloats.previousMouseX, value); }
  get previousMouseY(): number { return this.readHeaderFloat(this.fields.headerFloats.previousMouseY); }
  set previousMouseY(value: number) { this.writeHeaderFloat(this.fields.headerFloats.previousMouseY, value); }

  get kind(): BuiltInShooterEntityKind {
    return entityKindFromCode(this.readEntityU32(this.fields.entityU32s.kind));
  }
  set kind(value: BuiltInShooterEntityKind) {
    this.writeEntityU32(this.fields.entityU32s.kind, entityKindCode(value));
  }
  get x(): number { return this.readEntityFloat(this.fields.entityFloats.x); }
  set x(value: number) { this.writeEntityFloat(this.fields.entityFloats.x, value); }
  get y(): number { return this.readEntityFloat(this.fields.entityFloats.y); }
  set y(value: number) { this.writeEntityFloat(this.fields.entityFloats.y, value); }
  get velocityX(): number { return this.readEntityFloat(this.fields.entityFloats.velocityX); }
  set velocityX(value: number) { this.writeEntityFloat(this.fields.entityFloats.velocityX, value); }
  get velocityY(): number { return this.readEntityFloat(this.fields.entityFloats.velocityY); }
  set velocityY(value: number) { this.writeEntityFloat(this.fields.entityFloats.velocityY, value); }
  get health(): number { return this.readEntityFloat(this.fields.entityFloats.health); }
  set health(value: number) { this.writeEntityFloat(this.fields.entityFloats.health, value); }
  get damage(): number { return this.readEntityFloat(this.fields.entityFloats.damage); }
  set damage(value: number) { this.writeEntityFloat(this.fields.entityFloats.damage, value); }
  get lifetimeSeconds(): number { return this.readEntityFloat(this.fields.entityFloats.lifetimeSeconds); }
  set lifetimeSeconds(value: number) { this.writeEntityFloat(this.fields.entityFloats.lifetimeSeconds, value); }
  get scoreReward(): number { return this.readEntityU32(this.fields.entityU32s.scoreRewardOrProjectilePolicy); }
  set scoreReward(value: number) { this.writeEntityU32(this.fields.entityU32s.scoreRewardOrProjectilePolicy, value); }
  get projectilePolicy(): number { return this.readEntityU32(this.fields.entityU32s.scoreRewardOrProjectilePolicy); }
  set projectilePolicy(value: number) { this.writeEntityU32(this.fields.entityU32s.scoreRewardOrProjectilePolicy, value); }

  get primaryActionId(): number { return this.readEntityU32(this.fields.entityU32s.primaryActionId); }
  get primaryActionCooldownDuration(): number { return this.readEntityFloat(this.fields.entityFloats.primaryActionCooldownDuration); }
  get primaryActionCooldownRemaining(): number { return this.readEntityFloat(this.fields.entityFloats.primaryActionCooldownRemaining); }
  get primaryActionProjectileSpeed(): number { return this.readEntityFloat(this.fields.entityFloats.primaryActionProjectileSpeed); }
  get primaryActionProjectileDamage(): number { return this.readEntityFloat(this.fields.entityFloats.primaryActionProjectileDamage); }
  get primaryActionProjectileLifetime(): number { return this.readEntityFloat(this.fields.entityFloats.primaryActionProjectileLifetime); }
  get dashActionId(): number { return this.readEntityU32(this.fields.entityU32s.dashActionId); }
  get dashCooldownDuration(): number { return this.readEntityFloat(this.fields.entityFloats.dashCooldownDuration); }
  get dashCooldownRemaining(): number { return this.readEntityFloat(this.fields.entityFloats.dashCooldownRemaining); }
  get dashDistance(): number { return this.readEntityFloat(this.fields.entityFloats.dashDistance); }
  get meleeActionId(): number { return this.readEntityU32(this.fields.entityU32s.meleeActionId); }
  get meleeCooldownDuration(): number { return this.readEntityFloat(this.fields.entityFloats.meleeCooldownDuration); }
  get meleeCooldownRemaining(): number { return this.readEntityFloat(this.fields.entityFloats.meleeCooldownRemaining); }
  get meleeRange(): number { return this.readEntityFloat(this.fields.entityFloats.meleeRange); }
  get meleeDamage(): number { return this.readEntityFloat(this.fields.entityFloats.meleeDamage); }

  private get fields(): BuiltInShooterStateFieldOffsets { return this.layout.fieldOffsets; }

  private bindBuffers(snapshot: BuiltInShooterStateBuffers): void {
    if (snapshot.headerFloats.length !== this.layout.headerFloats) {
      throw new Error("shooter snapshot header float length does not match accessor layout.");
    }
    if (snapshot.headerU32s.length !== this.layout.headerU32s) {
      throw new Error("shooter snapshot header u32 length does not match accessor layout.");
    }
    if (snapshot.floatsPerEntity !== this.layout.floatsPerEntity) {
      throw new Error("shooter snapshot float stride does not match accessor layout.");
    }
    if (snapshot.u32sPerEntity !== this.layout.u32sPerEntity) {
      throw new Error("shooter snapshot u32 stride does not match accessor layout.");
    }
    if (
      !Number.isSafeInteger(snapshot.entityCount) ||
      snapshot.entityCount < 0 ||
      snapshot.entityFloats.length !== snapshot.entityCount * snapshot.floatsPerEntity ||
      snapshot.entityU32s.length !== snapshot.entityCount * snapshot.u32sPerEntity
    ) {
      throw new Error("shooter snapshot entity buffer lengths do not match entityCount.");
    }
    this.headerFloats = snapshot.headerFloats;
    this.headerU32s = snapshot.headerU32s;
    this.entityFloats = snapshot.entityFloats;
    this.entityU32s = snapshot.entityU32s;
    this.entityCount = snapshot.entityCount;
    this.isBound = true;
  }

  private selectUnchecked(entityIndex: number): void {
    this.selectedEntityIndex = entityIndex;
    this.selectedFloatBase = entityIndex * this.layout.floatsPerEntity;
    this.selectedU32Base = entityIndex * this.layout.u32sPerEntity;
  }

  private readHeaderFloat(offset: number): number {
    this.requireBound();
    return this.headerFloats[offset];
  }
  private readHeaderU32(offset: number): number {
    this.requireBound();
    return this.headerU32s[offset];
  }
  private readEntityFloat(offset: number): number {
    this.requireEntitySelected();
    return this.entityFloats[this.selectedFloatBase + offset];
  }
  private readEntityU32(offset: number): number {
    this.requireEntitySelected();
    return this.entityU32s[this.selectedU32Base + offset];
  }
  private writeHeaderFloat(offset: number, value: number): void {
    this.requireMutable(this.mutableHeaderFloats, "header float")[offset] = finite(value, "shooter snapshot header float");
  }
  private writeHeaderU32(offset: number, value: number): void {
    this.requireMutable(this.mutableHeaderU32s, "header u32")[offset] = uint32(value, "shooter snapshot header u32");
  }
  private writeEntityFloat(offset: number, value: number): void {
    this.requireEntitySelected();
    this.requireMutable(this.mutableEntityFloats, "entity float")[this.selectedFloatBase + offset] =
      finite(value, "shooter snapshot entity float");
  }
  private writeEntityU32(offset: number, value: number): void {
    this.requireEntitySelected();
    this.requireMutable(this.mutableEntityU32s, "entity u32")[this.selectedU32Base + offset] =
      uint32(value, "shooter snapshot entity u32");
  }
  private requireEntitySelected(): void {
    this.requireBound();
    if (this.selectedEntityIndex < 0) {
      throw new Error("select a shooter snapshot entity before reading or writing entity fields.");
    }
  }

  private clearBinding(): void {
    this.headerFloats = EMPTY_NUMBERS;
    this.headerU32s = EMPTY_NUMBERS;
    this.entityFloats = EMPTY_NUMBERS;
    this.entityU32s = EMPTY_NUMBERS;
    this.mutableHeaderFloats = undefined;
    this.mutableHeaderU32s = undefined;
    this.mutableEntityFloats = undefined;
    this.mutableEntityU32s = undefined;
    this.entityCount = 0;
    this.isBound = false;
    this.clearSelection();
  }

  private clearSelection(): void {
    this.selectedEntityIndex = -1;
    this.selectedFloatBase = -1;
    this.selectedU32Base = -1;
  }

  private requireBound(): void {
    if (!this.isBound) {
      throw new Error("bind a shooter snapshot before selecting, reading, or writing fields.");
    }
  }

  private requireMutable(
    buffer: MutableNumberBuffer | undefined,
    fieldKind: string,
  ): MutableNumberBuffer {
    if (buffer === undefined) {
      throw new Error(`bindMutable is required before writing a shooter snapshot ${fieldKind}.`);
    }
    return buffer;
  }
}

function gameStateCode(state: BuiltInShooterGameState): number {
  switch (state) {
    case "title": return 0;
    case "playing": return 1;
    case "gameOver": return 2;
  }
  throw new Error(`unknown built-in shooter game state '${String(state)}'.`);
}

function gameStateFromCode(code: number): BuiltInShooterGameState {
  switch (code) {
    case 0: return "title";
    case 1: return "playing";
    case 2: return "gameOver";
    default: throw new Error(`unknown built-in shooter game state code ${code}.`);
  }
}

function entityKindCode(kind: BuiltInShooterEntityKind): number {
  switch (kind) {
    case "player": return 0;
    case "enemy": return 1;
    case "bullet": return 2;
  }
  throw new Error(`unknown built-in shooter entity kind '${String(kind)}'.`);
}

function entityKindFromCode(code: number): BuiltInShooterEntityKind {
  switch (code) {
    case 0: return "player";
    case 1: return "enemy";
    case 2: return "bullet";
    default: throw new Error(`unknown built-in shooter entity kind code ${code}.`);
  }
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
  return value;
}

function uint32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be an unsigned 32-bit integer.`);
  }
  return value;
}

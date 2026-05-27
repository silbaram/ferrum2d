import { cutsceneSequenceDiagnosticError } from "./diagnostics.js";
import type { CameraPoint } from "./cameraPostProcessing.js";

export type CutsceneSequenceCommandKind = "wait" | "camera" | "audio" | "dialogue";
export type CutsceneSequenceEasing = "linear" | "easeInOut";
export type CutsceneAudioBus = "sfx" | "bgm";
export type CutsceneAudioAction = "play" | "stop";

export interface CutsceneCommandBaseSpec {
  id?: string;
  durationSeconds?: number;
}

export interface CutsceneWaitCommandSpec extends CutsceneCommandBaseSpec {
  kind: "wait";
  durationSeconds: number;
}

export interface CutsceneCameraCommandSpec extends CutsceneCommandBaseSpec {
  kind: "camera";
  target: CameraPoint;
  easing?: CutsceneSequenceEasing;
}

export interface CutsceneAudioCommandSpec extends CutsceneCommandBaseSpec {
  kind: "audio";
  sound: string | number;
  action?: CutsceneAudioAction;
  bus?: CutsceneAudioBus;
  volume?: number;
  loop?: boolean;
  fadeSeconds?: number;
}

export interface CutsceneDialogueCommandSpec extends CutsceneCommandBaseSpec {
  kind: "dialogue";
  speaker?: string;
  text?: string;
  graphId?: string;
  nodeId?: string;
}

export type CutsceneSequenceCommandSpec =
  | CutsceneWaitCommandSpec
  | CutsceneCameraCommandSpec
  | CutsceneAudioCommandSpec
  | CutsceneDialogueCommandSpec;

export interface CutsceneSequenceSpec {
  id?: string;
  loop?: boolean;
  commands: readonly CutsceneSequenceCommandSpec[];
}

export interface ResolveCutsceneSequenceOptions {
  path?: string;
}

export interface ResolvedCutsceneCommandBase {
  id: string;
  index: number;
  kind: CutsceneSequenceCommandKind;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface ResolvedCutsceneWaitCommand extends ResolvedCutsceneCommandBase {
  kind: "wait";
}

export interface ResolvedCutsceneCameraCommand extends ResolvedCutsceneCommandBase {
  kind: "camera";
  target: CameraPoint;
  easing: CutsceneSequenceEasing;
}

export interface ResolvedCutsceneAudioCommand extends ResolvedCutsceneCommandBase {
  kind: "audio";
  sound: string | number;
  action: CutsceneAudioAction;
  bus: CutsceneAudioBus;
  volume: number;
  loop: boolean;
  fadeSeconds: number;
}

export interface ResolvedCutsceneDialogueCommand extends ResolvedCutsceneCommandBase {
  kind: "dialogue";
  speaker?: string;
  text?: string;
  graphId?: string;
  nodeId?: string;
}

export type ResolvedCutsceneSequenceCommand =
  | ResolvedCutsceneWaitCommand
  | ResolvedCutsceneCameraCommand
  | ResolvedCutsceneAudioCommand
  | ResolvedCutsceneDialogueCommand;

export interface ResolvedCutsceneSequenceSpec {
  id: string;
  loop: boolean;
  durationSeconds: number;
  commands: readonly ResolvedCutsceneSequenceCommand[];
}

export interface CutsceneSequenceEvent {
  type: "command";
  sequenceId: string;
  commandIndex: number;
  command: ResolvedCutsceneSequenceCommand;
  elapsedSeconds: number;
}

export interface CutsceneSequencePlayerSnapshot {
  sequenceId: string;
  elapsedSeconds: number;
  commandIndex: number;
  commandElapsedSeconds: number;
  commandProgress: number;
  currentCommand?: ResolvedCutsceneSequenceCommand;
  completed: boolean;
}

export interface CutsceneSequenceUpdateOptions {
  maxCommands?: number;
  target?: CutsceneSequenceTarget;
}

export interface CutsceneSequenceUpdateResult {
  snapshot: CutsceneSequencePlayerSnapshot;
  events: readonly CutsceneSequenceEvent[];
  completed: boolean;
}

export interface CutsceneSequenceTarget {
  onCutsceneCommand?: (event: CutsceneSequenceEvent) => void;
  moveCamera?: (command: ResolvedCutsceneCameraCommand, event: CutsceneSequenceEvent) => void;
  playCutsceneAudio?: (command: ResolvedCutsceneAudioCommand, event: CutsceneSequenceEvent) => void;
  showCutsceneDialogue?: (command: ResolvedCutsceneDialogueCommand, event: CutsceneSequenceEvent) => void;
}

const DEFAULT_SEQUENCE_ID = "cutscene";
const DEFAULT_MAX_COMMANDS_PER_UPDATE = 64;
const TIMELINE_EPSILON = 1e-9;

export function resolveCutsceneSequenceSpec(
  spec: CutsceneSequenceSpec,
  options: ResolveCutsceneSequenceOptions = {},
): ResolvedCutsceneSequenceSpec {
  const path = options.path ?? "cutscene";
  if (!isRecord(spec)) {
    throw invalid(path, "must be an object");
  }
  const input = spec as CutsceneSequenceSpec;
  const sequenceId = stringValue(input.id ?? DEFAULT_SEQUENCE_ID, `${path}.id`);
  if (!Array.isArray(input.commands) || input.commands.length === 0) {
    throw invalid(`${path}.commands`, "must be a non-empty array");
  }

  const ids = new Set<string>();
  let cursor = 0;
  const commands = input.commands.map((command, index) => {
    const resolved = resolveCommand(command, index, cursor, `${path}.commands[${index}]`);
    if (ids.has(resolved.id)) {
      throw invalid(`${path}.commands[${index}].id`, `duplicates command id '${resolved.id}'`);
    }
    ids.add(resolved.id);
    cursor = resolved.endSeconds;
    return resolved;
  });
  const loop = input.loop ?? false;
  if (loop && cursor <= 0) {
    throw invalid(`${path}.loop`, "requires at least one command with positive duration");
  }
  return {
    id: sequenceId,
    loop,
    durationSeconds: cursor,
    commands,
  };
}

export function applyCutsceneSequenceEvent(
  target: CutsceneSequenceTarget | undefined,
  event: CutsceneSequenceEvent,
): void {
  if (target === undefined) {
    return;
  }
  target.onCutsceneCommand?.(event);
  const command = event.command;
  if (command.kind === "camera") {
    target.moveCamera?.(command, event);
  } else if (command.kind === "audio") {
    target.playCutsceneAudio?.(command, event);
  } else if (command.kind === "dialogue") {
    target.showCutsceneDialogue?.(command, event);
  }
}

export class CutsceneSequencePlayer {
  private elapsedSeconds = 0;
  private commandIndex = 0;
  private commandElapsedSeconds = 0;
  private started = false;
  private completed = false;

  constructor(private readonly sequence: ResolvedCutsceneSequenceSpec) {}

  static create(spec: CutsceneSequenceSpec | ResolvedCutsceneSequenceSpec): CutsceneSequencePlayer {
    const sequence = isResolvedSequence(spec)
      ? spec
      : resolveCutsceneSequenceSpec(spec as CutsceneSequenceSpec);
    return new CutsceneSequencePlayer(sequence);
  }

  reset(): CutsceneSequencePlayerSnapshot {
    this.elapsedSeconds = 0;
    this.commandIndex = 0;
    this.commandElapsedSeconds = 0;
    this.started = false;
    this.completed = false;
    return this.snapshot();
  }

  skip(): CutsceneSequencePlayerSnapshot {
    this.elapsedSeconds = this.sequence.durationSeconds;
    this.commandIndex = this.sequence.commands.length;
    this.commandElapsedSeconds = 0;
    this.started = true;
    this.completed = true;
    return this.snapshot();
  }

  update(deltaSeconds: number, options: CutsceneSequenceUpdateOptions = {}): CutsceneSequenceUpdateResult {
    const delta = nonNegativeNumber(deltaSeconds, "cutscene deltaSeconds");
    const maxCommands = positiveInteger(options.maxCommands ?? DEFAULT_MAX_COMMANDS_PER_UPDATE, "cutscene maxCommands");
    const events: CutsceneSequenceEvent[] = [];

    if (this.completed && !this.sequence.loop) {
      return { snapshot: this.snapshot(), events, completed: true };
    }

    let remaining = delta;
    let emittedCommands = 0;
    if (!this.started) {
      emittedCommands += this.emitCurrentCommand(events, options.target);
    }

    while (!this.completed && emittedCommands < maxCommands) {
      const command = this.currentCommand();
      if (command === undefined) {
        this.completeOrLoop();
        if (this.completed) break;
        emittedCommands += this.emitCurrentCommand(events, options.target);
        continue;
      }

      const available = command.durationSeconds - this.commandElapsedSeconds;
      if (remaining + TIMELINE_EPSILON < available || available === Infinity) {
        this.commandElapsedSeconds += remaining;
        this.elapsedSeconds += remaining;
        remaining = 0;
        break;
      }

      this.commandElapsedSeconds += available;
      this.elapsedSeconds += available;
      remaining = Math.max(0, remaining - available);
      this.advanceCommand();
      if (!this.completed) {
        emittedCommands += this.emitCurrentCommand(events, options.target);
      }
      if (remaining <= 0 && this.currentCommand()?.durationSeconds !== 0) {
        break;
      }
    }

    if (emittedCommands >= maxCommands && !this.completed) {
      throw invalid("cutscene.maxCommands", "command emission limit reached; check for zero-duration loop");
    }

    return {
      snapshot: this.snapshot(),
      events,
      completed: this.completed,
    };
  }

  snapshot(): CutsceneSequencePlayerSnapshot {
    const currentCommand = this.currentCommand();
    const progress = currentCommand === undefined || currentCommand.durationSeconds <= 0
      ? 1
      : clamp01(this.commandElapsedSeconds / currentCommand.durationSeconds);
    return {
      sequenceId: this.sequence.id,
      elapsedSeconds: this.elapsedSeconds,
      commandIndex: this.commandIndex,
      commandElapsedSeconds: this.commandElapsedSeconds,
      commandProgress: progress,
      ...(currentCommand === undefined ? {} : { currentCommand }),
      completed: this.completed,
    };
  }

  private currentCommand(): ResolvedCutsceneSequenceCommand | undefined {
    return this.sequence.commands[this.commandIndex];
  }

  private emitCurrentCommand(events: CutsceneSequenceEvent[], target: CutsceneSequenceTarget | undefined): number {
    const command = this.currentCommand();
    if (command === undefined) {
      return 0;
    }
    this.started = true;
    const event: CutsceneSequenceEvent = {
      type: "command",
      sequenceId: this.sequence.id,
      commandIndex: command.index,
      command,
      elapsedSeconds: this.elapsedSeconds,
    };
    events.push(event);
    applyCutsceneSequenceEvent(target, event);
    return 1;
  }

  private advanceCommand(): void {
    this.commandIndex += 1;
    this.commandElapsedSeconds = 0;
    if (this.commandIndex >= this.sequence.commands.length) {
      this.completeOrLoop();
    }
  }

  private completeOrLoop(): void {
    if (this.sequence.loop) {
      this.elapsedSeconds = 0;
      this.commandIndex = 0;
      this.commandElapsedSeconds = 0;
      this.started = false;
      return;
    }
    this.completed = true;
    this.commandIndex = this.sequence.commands.length;
    this.commandElapsedSeconds = 0;
  }
}

function resolveCommand(
  command: CutsceneSequenceCommandSpec,
  index: number,
  startSeconds: number,
  path: string,
): ResolvedCutsceneSequenceCommand {
  if (!isRecord(command)) {
    throw invalid(path, "must be an object");
  }
  const kind = stringValue(command.kind, `${path}.kind`) as CutsceneSequenceCommandKind;
  const id = stringValue(command.id ?? `${kind}-${index}`, `${path}.id`);
  const base = {
    id,
    index,
    startSeconds,
  };
  if (kind === "wait") {
    const wait = command as CutsceneWaitCommandSpec;
    const durationSeconds = positiveNumber(wait.durationSeconds, `${path}.durationSeconds`);
    return {
      ...base,
      kind,
      durationSeconds,
      endSeconds: startSeconds + durationSeconds,
    };
  }
  if (kind === "camera") {
    const camera = command as CutsceneCameraCommandSpec;
    const durationSeconds = nonNegativeNumber(camera.durationSeconds ?? 0, `${path}.durationSeconds`);
    const target = resolveCameraPoint(camera.target, `${path}.target`);
    return {
      ...base,
      kind,
      durationSeconds,
      endSeconds: startSeconds + durationSeconds,
      target,
      easing: resolveEasing(camera.easing, `${path}.easing`),
    };
  }
  if (kind === "audio") {
    const audio = command as CutsceneAudioCommandSpec;
    const durationSeconds = nonNegativeNumber(audio.durationSeconds ?? 0, `${path}.durationSeconds`);
    const volume = normalizedNumber(audio.volume ?? 1, `${path}.volume`);
    return {
      ...base,
      kind,
      durationSeconds,
      endSeconds: startSeconds + durationSeconds,
      sound: resolveSound(audio.sound, `${path}.sound`),
      action: resolveAudioAction(audio.action, `${path}.action`),
      bus: resolveAudioBus(audio.bus, `${path}.bus`),
      volume,
      loop: audio.loop ?? false,
      fadeSeconds: nonNegativeNumber(audio.fadeSeconds ?? 0, `${path}.fadeSeconds`),
    };
  }
  if (kind === "dialogue") {
    const dialogue = command as CutsceneDialogueCommandSpec;
    const durationSeconds = nonNegativeNumber(dialogue.durationSeconds ?? 0, `${path}.durationSeconds`);
    const text = optionalString(dialogue.text, `${path}.text`);
    const nodeId = optionalString(dialogue.nodeId, `${path}.nodeId`);
    const graphId = optionalString(dialogue.graphId, `${path}.graphId`);
    const speaker = optionalString(dialogue.speaker, `${path}.speaker`);
    if (text === undefined && nodeId === undefined) {
      throw invalid(path, "dialogue command requires text or nodeId");
    }
    return {
      ...base,
      kind,
      durationSeconds,
      endSeconds: startSeconds + durationSeconds,
      ...(speaker === undefined ? {} : { speaker }),
      ...(text === undefined ? {} : { text }),
      ...(graphId === undefined ? {} : { graphId }),
      ...(nodeId === undefined ? {} : { nodeId }),
    };
  }
  throw invalid(`${path}.kind`, `must be one of wait, camera, audio, dialogue`);
}

function resolveCameraPoint(value: unknown, path: string): CameraPoint {
  if (!isRecord(value)) {
    throw invalid(path, "must be an object");
  }
  return {
    x: finiteNumber(value.x, `${path}.x`),
    y: finiteNumber(value.y, `${path}.y`),
  };
}

function resolveSound(value: unknown, path: string): string | number {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw invalid(path, "must be a non-empty string or finite number");
}

function resolveEasing(value: unknown, path: string): CutsceneSequenceEasing {
  if (value === undefined) {
    return "linear";
  }
  if (value === "linear" || value === "easeInOut") {
    return value;
  }
  throw invalid(path, "must be 'linear' or 'easeInOut'");
}

function resolveAudioAction(value: unknown, path: string): CutsceneAudioAction {
  if (value === undefined) {
    return "play";
  }
  if (value === "play" || value === "stop") {
    return value;
  }
  throw invalid(path, "must be 'play' or 'stop'");
}

function resolveAudioBus(value: unknown, path: string): CutsceneAudioBus {
  if (value === undefined) {
    return "sfx";
  }
  if (value === "sfx" || value === "bgm") {
    return value;
  }
  throw invalid(path, "must be 'sfx' or 'bgm'");
}

function isResolvedSequence(input: CutsceneSequenceSpec | ResolvedCutsceneSequenceSpec): input is ResolvedCutsceneSequenceSpec {
  return isRecord(input)
    && typeof input.id === "string"
    && typeof input.durationSeconds === "number"
    && Array.isArray(input.commands)
    && input.commands.every((command) => isRecord(command) && typeof command.index === "number");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, "must be a non-empty string");
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return stringValue(value, path);
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(path, "must be a finite number");
  }
  return value;
}

function positiveNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) {
    throw invalid(path, "must be greater than 0");
  }
  return number;
}

function nonNegativeNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0) {
    throw invalid(path, "must be greater than or equal to 0");
  }
  return number;
}

function positiveInteger(value: unknown, path: string): number {
  const number = positiveNumber(value, path);
  if (!Number.isInteger(number)) {
    throw invalid(path, "must be an integer");
  }
  return number;
}

function normalizedNumber(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0 || number > 1) {
    throw invalid(path, "must be between 0 and 1");
  }
  return number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function invalid(path: string, detail: string): Error {
  return cutsceneSequenceDiagnosticError(path, detail);
}

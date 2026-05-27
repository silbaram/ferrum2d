export type AnimationTimelineFrameRef = string | number;
export type AnimationTimelineEventPayload =
  | null
  | boolean
  | number
  | string
  | readonly AnimationTimelineEventPayload[]
  | { readonly [key: string]: AnimationTimelineEventPayload };

export interface AnimationTimelineEventSpec {
  frame: number;
  id: string;
  payload?: AnimationTimelineEventPayload;
}

export interface AnimationTimelineTransitionSpec {
  to: string;
  on?: string;
  atEnd?: boolean;
}

export interface AnimationTimelineStateSpec {
  frames?: readonly AnimationTimelineFrameRef[];
  frameCount?: number;
  fps?: number;
  loop?: boolean;
  events?: readonly AnimationTimelineEventSpec[];
  transitions?: readonly AnimationTimelineTransitionSpec[];
}

export interface AnimationTimelineSpec {
  initialState?: string;
  states: Readonly<Record<string, AnimationTimelineStateSpec>>;
}

export interface ResolvedAnimationTimelineEvent {
  frame: number;
  id: string;
  payload?: AnimationTimelineEventPayload;
}

export interface ResolvedAnimationTimelineTransition {
  to: string;
  on?: string;
  atEnd: boolean;
}

export interface ResolvedAnimationTimelineState {
  id: string;
  frames: readonly AnimationTimelineFrameRef[];
  fps: number;
  loop: boolean;
  durationSeconds: number;
  events: readonly ResolvedAnimationTimelineEvent[];
  transitions: readonly ResolvedAnimationTimelineTransition[];
}

export interface ResolvedAnimationTimelineSpec {
  initialState: string;
  states: Readonly<Record<string, ResolvedAnimationTimelineState>>;
}

export interface AnimationTimelinePlayerSnapshot {
  state: string;
  frameIndex: number;
  frame: AnimationTimelineFrameRef;
  elapsedSeconds: number;
  loopCount: number;
  completed: boolean;
}

export interface AnimationTimelineEmittedEvent {
  state: string;
  frameIndex: number;
  frame: AnimationTimelineFrameRef;
  id: string;
  payload?: AnimationTimelineEventPayload;
}

export interface AnimationTimelineUpdateOptions {
  signals?: readonly string[];
  maxEvents?: number;
}

export interface AnimationTimelineUpdateResult {
  snapshot: AnimationTimelinePlayerSnapshot;
  events: readonly AnimationTimelineEmittedEvent[];
  transitioned: boolean;
  previousState: string;
}

export function resolveAnimationTimelineSpec(spec: AnimationTimelineSpec): ResolvedAnimationTimelineSpec {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) {
    throw new Error("animation timeline spec must be an object.");
  }
  const entries = Object.entries(spec.states ?? {});
  if (entries.length === 0) {
    throw new Error("animation timeline states must contain at least one state.");
  }

  const states: Record<string, ResolvedAnimationTimelineState> = {};
  for (const [stateId, state] of entries) {
    states[stateId] = resolveAnimationTimelineState(stateId, state);
  }
  for (const state of Object.values(states)) {
    for (const transition of state.transitions) {
      if (states[transition.to] === undefined) {
        throw new Error(`animation timeline transition '${state.id}' targets unknown state '${transition.to}'.`);
      }
    }
  }

  const initialState = spec.initialState ?? entries[0][0];
  if (states[initialState] === undefined) {
    throw new Error(`animation timeline initialState '${initialState}' is not defined in states.`);
  }
  return { initialState, states };
}

export function animationTimelineFrameAt(
  timeline: ResolvedAnimationTimelineSpec,
  stateId: string,
  elapsedSeconds: number,
): AnimationTimelinePlayerSnapshot {
  const state = requireState(timeline, stateId);
  return snapshotForState(state, finiteNumber(elapsedSeconds, "animation timeline elapsedSeconds"));
}

export class AnimationTimelinePlayer {
  private state: ResolvedAnimationTimelineState;
  private elapsedSeconds = 0;
  private completed = false;

  constructor(private readonly timeline: ResolvedAnimationTimelineSpec, initialState = timeline.initialState) {
    this.state = requireState(timeline, initialState);
  }

  static create(spec: AnimationTimelineSpec | ResolvedAnimationTimelineSpec): AnimationTimelinePlayer {
    const timeline = isResolvedTimeline(spec)
      ? spec
      : resolveAnimationTimelineSpec(spec as AnimationTimelineSpec);
    return new AnimationTimelinePlayer(timeline);
  }

  currentState(): string {
    return this.state.id;
  }

  setState(stateId: string): void {
    this.state = requireState(this.timeline, stateId);
    this.elapsedSeconds = 0;
    this.completed = false;
  }

  update(deltaSeconds: number, options: AnimationTimelineUpdateOptions = {}): AnimationTimelineUpdateResult {
    const previousState = this.state.id;
    const previousElapsed = this.elapsedSeconds;
    const delta = finiteNumber(deltaSeconds, "animation timeline deltaSeconds");
    if (delta > 0) {
      this.elapsedSeconds += delta;
    }

    const events = collectEvents(this.state, previousElapsed, this.elapsedSeconds, options.maxEvents ?? 32);
    this.completed = !this.state.loop && this.elapsedSeconds >= this.state.durationSeconds;
    let transitioned = this.applyTransition(options.signals ?? []);
    if (!transitioned && this.completed) {
      transitioned = this.applyEndTransition();
    }

    return {
      snapshot: this.snapshot(),
      events,
      transitioned,
      previousState,
    };
  }

  signal(signal: string): AnimationTimelineUpdateResult {
    const previousState = this.state.id;
    const transitioned = this.applyTransition([signal]);
    return {
      snapshot: this.snapshot(),
      events: [],
      transitioned,
      previousState,
    };
  }

  snapshot(): AnimationTimelinePlayerSnapshot {
    return snapshotForState(this.state, this.elapsedSeconds, this.completed);
  }

  private applyTransition(signals: readonly string[]): boolean {
    for (const signal of signals) {
      for (const transition of this.state.transitions) {
        if (transition.on === signal) {
          this.setState(transition.to);
          return true;
        }
      }
    }
    return false;
  }

  private applyEndTransition(): boolean {
    const transition = this.state.transitions.find((candidate) => candidate.atEnd);
    if (transition === undefined) {
      return false;
    }
    this.setState(transition.to);
    return true;
  }
}

function resolveAnimationTimelineState(
  stateId: string,
  state: AnimationTimelineStateSpec,
): ResolvedAnimationTimelineState {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    throw new Error(`animation timeline state '${stateId}' must be an object.`);
  }
  const frames = resolveFrames(state, stateId);
  const fps = positiveNumber(state.fps ?? 1, `animation timeline state '${stateId}' fps`);
  const events = (state.events ?? []).map((event, index) => resolveEvent(event, stateId, index, frames.length));
  const transitions = (state.transitions ?? []).map((transition, index) => resolveTransition(transition, stateId, index));
  return {
    id: stateId,
    frames,
    fps,
    loop: state.loop ?? true,
    durationSeconds: frames.length / fps,
    events,
    transitions,
  };
}

function resolveFrames(state: AnimationTimelineStateSpec, stateId: string): readonly AnimationTimelineFrameRef[] {
  if (state.frames !== undefined) {
    if (!Array.isArray(state.frames) || state.frames.length === 0) {
      throw new Error(`animation timeline state '${stateId}' frames must be a non-empty array.`);
    }
    return state.frames.map((frame, index) => {
      if (typeof frame !== "string" && typeof frame !== "number") {
        throw new Error(`animation timeline state '${stateId}' frames[${index}] must be a string or number.`);
      }
      return frame;
    });
  }

  const frameCount = positiveInteger(state.frameCount ?? 1, `animation timeline state '${stateId}' frameCount`);
  return Array.from({ length: frameCount }, (_, index) => index);
}

function resolveEvent(
  event: AnimationTimelineEventSpec,
  stateId: string,
  index: number,
  frameCount: number,
): ResolvedAnimationTimelineEvent {
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    throw new Error(`animation timeline state '${stateId}' events[${index}] must be an object.`);
  }
  const frame = nonNegativeInteger(event.frame, `animation timeline state '${stateId}' events[${index}].frame`);
  if (frame >= frameCount) {
    throw new Error(`animation timeline state '${stateId}' events[${index}].frame is outside the frame range.`);
  }
  if (typeof event.id !== "string" || event.id.length === 0) {
    throw new Error(`animation timeline state '${stateId}' events[${index}].id must be a non-empty string.`);
  }
  return {
    frame,
    id: event.id,
    ...(event.payload === undefined ? {} : { payload: event.payload }),
  };
}

function resolveTransition(
  transition: AnimationTimelineTransitionSpec,
  stateId: string,
  index: number,
): ResolvedAnimationTimelineTransition {
  if (typeof transition !== "object" || transition === null || Array.isArray(transition)) {
    throw new Error(`animation timeline state '${stateId}' transitions[${index}] must be an object.`);
  }
  if (typeof transition.to !== "string" || transition.to.length === 0) {
    throw new Error(`animation timeline state '${stateId}' transitions[${index}].to must be a non-empty string.`);
  }
  if (transition.on !== undefined && (typeof transition.on !== "string" || transition.on.length === 0)) {
    throw new Error(`animation timeline state '${stateId}' transitions[${index}].on must be a non-empty string.`);
  }
  return {
    to: transition.to,
    ...(transition.on === undefined ? {} : { on: transition.on }),
    atEnd: transition.atEnd ?? false,
  };
}

function collectEvents(
  state: ResolvedAnimationTimelineState,
  previousElapsed: number,
  nextElapsed: number,
  maxEvents: number,
): AnimationTimelineEmittedEvent[] {
  if (nextElapsed <= previousElapsed || maxEvents <= 0 || state.events.length === 0) {
    return [];
  }

  const previousFrame = Math.floor(previousElapsed * state.fps);
  const nextFrame = Math.floor(nextElapsed * state.fps);
  const cappedNextFrame = state.loop ? nextFrame : Math.min(nextFrame, state.frames.length - 1);
  const events: AnimationTimelineEmittedEvent[] = [];
  for (let absoluteFrame = previousFrame + 1; absoluteFrame <= cappedNextFrame; absoluteFrame += 1) {
    const frameIndex = state.loop ? absoluteFrame % state.frames.length : absoluteFrame;
    for (const event of state.events) {
      if (event.frame !== frameIndex) {
        continue;
      }
      events.push({
        state: state.id,
        frameIndex,
        frame: state.frames[frameIndex],
        id: event.id,
        ...(event.payload === undefined ? {} : { payload: event.payload }),
      });
      if (events.length >= maxEvents) {
        return events;
      }
    }
  }
  return events;
}

function snapshotForState(
  state: ResolvedAnimationTimelineState,
  elapsedSeconds: number,
  completed = false,
): AnimationTimelinePlayerSnapshot {
  const absoluteFrame = Math.floor(Math.max(elapsedSeconds, 0) * state.fps);
  const frameIndex = state.loop
    ? absoluteFrame % state.frames.length
    : Math.min(absoluteFrame, state.frames.length - 1);
  return {
    state: state.id,
    frameIndex,
    frame: state.frames[frameIndex],
    elapsedSeconds,
    loopCount: Math.floor(absoluteFrame / state.frames.length),
    completed: completed || (!state.loop && elapsedSeconds >= state.durationSeconds),
  };
}

function requireState(timeline: ResolvedAnimationTimelineSpec, stateId: string): ResolvedAnimationTimelineState {
  const state = timeline.states[stateId];
  if (state === undefined) {
    throw new Error(`animation timeline state '${stateId}' is not defined.`);
  }
  return state;
}

function isResolvedTimeline(spec: AnimationTimelineSpec | ResolvedAnimationTimelineSpec): spec is ResolvedAnimationTimelineSpec {
  const state = Object.values(spec.states)[0];
  return state !== undefined && "durationSeconds" in state;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function positiveNumber(value: number, label: string): number {
  const number = finiteNumber(value, label);
  if (number <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return number;
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

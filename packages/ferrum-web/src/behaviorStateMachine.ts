import {
  behaviorRecipeCommandsForEntity,
  resolveBehaviorRecipeDocument,
  type BehaviorRecipeApplyResult,
  type BehaviorRecipeCommand,
  type BehaviorRecipeCommandOptions,
  type BehaviorRecipeDocumentSpec,
  type ResolvedBehaviorRecipeDocument,
} from "./behaviorRecipes.js";
import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";
import {
  applyGameplayBehaviorCommands,
  type ApplyGameplayBehaviorCommandsOptions,
  type GameplayBehaviorRuntimeIds,
  type GameplayBehaviorRuntimeEngine,
  type GameplayEntityHandle,
} from "./gameplayAuthoring.js";
import {
  GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE,
  GAMEPLAY_EVENT_KIND_COLLISION_DESPAWN,
  GAMEPLAY_EVENT_KIND_INTERACTION,
  GAMEPLAY_EVENT_KIND_PICKUP_COLLECTED,
  GAMEPLAY_EVENT_KIND_TILE_IMPACT,
  GAMEPLAY_EVENT_KIND_TIMER,
} from "./gameplayEventDecoder.js";
import {
  type GameplayEventAction,
  type GameplayTileImpactNormal,
  type GameplayTileImpactPolicy,
} from "./gameplayEventActions.js";

export const BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS = 8 as const;

export type BehaviorStateMachineTriggerKind = "gameplayEvent";
export type BehaviorStateMachineGameplayEventKind =
  | "interaction"
  | "collisionDamage"
  | "collisionDespawn"
  | "timer"
  | "pickupCollected"
  | "tileImpact";
export type BehaviorStateMachineTileImpactPolicy = Exclude<GameplayTileImpactPolicy, "passThrough" | "unknown">;
export type BehaviorStateMachineBehaviorBinding = string | readonly string[];

export interface BehaviorStateMachineDocumentSpec {
  machines: Readonly<Record<string, BehaviorStateMachineSpec>>;
}

export interface BehaviorStateMachineSpec {
  initial: string;
  states: Readonly<Record<string, BehaviorStateMachineStateSpec>>;
}

export interface BehaviorStateMachineStateSpec {
  behaviorRecipes?: BehaviorStateMachineBehaviorBinding;
  transitions?: readonly BehaviorStateMachineTransitionSpec[];
}

export interface BehaviorStateMachineTransitionSpec {
  id?: string;
  to: string;
  when: BehaviorStateMachineTransitionPredicateSpec;
}

export interface BehaviorStateMachineTransitionPredicateSpec {
  type: BehaviorStateMachineTriggerKind;
  event: BehaviorStateMachineGameplayEventKind;
  action?: string;
  actionId?: number;
  timer?: string;
  timerId?: number;
  item?: string;
  itemId?: number;
  tileImpact?: BehaviorStateMachineTileImpactPolicy;
  tileImpactCode?: number;
}

export interface ResolveBehaviorStateMachineDocumentOptions {
  path?: string;
  behaviorRecipes?: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument;
}

export interface BehaviorStateMachineCommandOptions extends BehaviorRecipeCommandOptions {
  path?: string;
}

export interface BehaviorStateMachineReplayInput {
  machine: string;
  entity: GameplayEntityHandle;
  initialState?: string;
  frames: readonly BehaviorStateMachineReplayFrame[];
}

export interface BehaviorStateMachineReplayFrame {
  frame: number;
  events?: readonly GameplayEventAction[];
}

export interface BehaviorStateMachineReplayOptions {
  path?: string;
  behaviorRecipes?: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument;
  ids?: GameplayBehaviorRuntimeIds;
}

export interface BehaviorStateMachineRuntimeInstallOptions extends ResolveBehaviorStateMachineDocumentOptions {
  path?: string;
  ids?: GameplayBehaviorRuntimeIds;
}

export interface BehaviorStateMachineRuntimeEngine {
  clear_gameplay_behavior_state_machine(entityId: number, entityGeneration: number): boolean;
  set_gameplay_behavior_state_machine(entityId: number, entityGeneration: number, initialState: number): boolean;
  add_gameplay_behavior_transition(
    entityId: number,
    entityGeneration: number,
    fromState: number,
    toState: number,
    actionId: number,
  ): boolean;
  add_gameplay_behavior_event_transition?(
    entityId: number,
    entityGeneration: number,
    fromState: number,
    toState: number,
    eventKind: number,
    tokenId: number,
  ): boolean;
}

export interface BehaviorStateMachineRuntimeStateQueryEngine {
  gameplay_behavior_state(entityId: number, entityGeneration: number): number;
}

export interface BehaviorStateMachineRuntimeStateId {
  state: string;
  stateId: number;
}

export interface BehaviorStateMachineRuntimeTransitionInstall {
  id: string;
  from: string;
  to: string;
  fromStateId: number;
  toStateId: number;
  event: BehaviorStateMachineGameplayEventKind;
  eventKind: number;
  tokenId: number;
  actionId: number;
}

export interface BehaviorStateMachineRuntimeInstallPlan {
  machine: string;
  initial: string;
  initialStateId: number;
  states: readonly BehaviorStateMachineRuntimeStateId[];
  transitions: readonly BehaviorStateMachineRuntimeTransitionInstall[];
}

export interface BehaviorStateMachineRuntimeInstallResult {
  plan: BehaviorStateMachineRuntimeInstallPlan;
  applied: boolean;
}

export interface BehaviorStateMachineStateCommandOptions extends BehaviorRecipeCommandOptions {
  path?: string;
  entity?: string;
}

export type BehaviorStateMachineStateCommandApplyMode = "overlay" | "replaceSupported";

export interface ApplyBehaviorStateMachineStateCommandsOptions extends ApplyGameplayBehaviorCommandsOptions {
  entity?: string;
  mode?: BehaviorStateMachineStateCommandApplyMode;
}

export interface BehaviorStateMachineStateCommandPlan {
  machine: string;
  state: string;
  stateId: number;
  behaviorProfiles: readonly string[];
  sourceCommands: readonly BehaviorRecipeCommand[];
  commands: readonly BehaviorRecipeCommand[];
  targetEntity?: string;
}

export interface BehaviorStateMachineStateCommandApplyResult extends BehaviorRecipeApplyResult {
  plan: BehaviorStateMachineStateCommandPlan;
}

export interface BehaviorStateMachineStateCommandPreflightResult extends BehaviorRecipeApplyResult {
  plan: BehaviorStateMachineStateCommandPlan;
  mode: BehaviorStateMachineStateCommandApplyMode;
  clearOperations: readonly string[];
}

export interface BehaviorStateMachineReplayStep {
  frame: number;
  from: string;
  to: string;
  transition?: string;
  event?: BehaviorStateMachineReplayEventMatch;
}

export interface BehaviorStateMachineReplayEventMatch {
  type: GameplayEventAction["type"];
  actionId?: number;
  timerId?: number;
  durationSeconds?: number;
  itemId?: number;
  count?: number;
  tileImpact?: GameplayTileImpactPolicy;
  tileImpactCode?: number;
  layerIndex?: number;
  tileIndex?: number;
  normal?: GameplayTileImpactNormal;
  bounced?: boolean;
  identityTruncated?: boolean;
  sourceEntityId: number;
  sourceEntityGeneration: number;
  actorEntityId: number;
  actorEntityGeneration: number;
  targetRemoved?: boolean;
  damage?: number;
}

export interface BehaviorStateMachineReplayResult {
  format: "ferrum2d.behavior-state-machine.replay";
  version: 1;
  machine: string;
  entity: GameplayEntityHandle;
  initialState: string;
  finalState: string;
  steps: readonly BehaviorStateMachineReplayStep[];
  replayHash: string;
}

export interface BehaviorStateMachineReplayComparison {
  passed: boolean;
  expectedHash: string;
  actualHash: string;
  firstMismatchFrame?: number;
  expectedFinalState: string;
  actualFinalState: string;
}

interface GameplayAuthoringTransactionHooks {
  capture(entity: GameplayEntityHandle): boolean;
  restore(entity: GameplayEntityHandle): boolean;
  clear(): void;
}

export interface ResolvedBehaviorStateMachineDocument {
  machines: Readonly<Record<string, ResolvedBehaviorStateMachine>>;
}

export interface ResolvedBehaviorStateMachine {
  id: string;
  initial: string;
  states: Readonly<Record<string, ResolvedBehaviorStateMachineState>>;
}

export interface ResolvedBehaviorStateMachineState {
  id: string;
  behaviorRecipes: readonly string[];
  transitions: readonly ResolvedBehaviorStateMachineTransition[];
}

export interface ResolvedBehaviorStateMachineTransition {
  id: string;
  to: string;
  when: ResolvedBehaviorStateMachineTransitionPredicate;
}

export interface ResolvedBehaviorStateMachineTransitionPredicate {
  type: "gameplayEvent";
  event: BehaviorStateMachineGameplayEventKind;
  action?: string;
  actionId?: number;
  timer?: string;
  timerId?: number;
  item?: string;
  itemId?: number;
  tileImpact?: BehaviorStateMachineTileImpactPolicy;
  tileImpactCode?: number;
}

export function resolveBehaviorStateMachineDocument(
  document: BehaviorStateMachineDocumentSpec,
  options: ResolveBehaviorStateMachineDocumentOptions = {},
): ResolvedBehaviorStateMachineDocument {
  const path = options.path ?? "behaviorStateMachines";
  if (!isRecord(document)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  const recipes = options.behaviorRecipes === undefined
    ? undefined
    : isResolvedBehaviorRecipeDocument(options.behaviorRecipes)
      ? options.behaviorRecipes
      : resolveBehaviorRecipeDocument(options.behaviorRecipes, { path: `${path}.behaviorRecipes` });
  const machines = resolveMachines(requiredRecord(document.machines, `${path}.machines`), recipes, `${path}.machines`);
  return { machines };
}

export function behaviorStateMachineBehaviorProfilesForState(
  document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
  machineId: string,
  stateId?: string,
): readonly string[] {
  const resolved = isResolvedBehaviorStateMachineDocument(document)
    ? document
    : resolveBehaviorStateMachineDocument(document as BehaviorStateMachineDocumentSpec);
  const machine = behaviorStateMachine(resolved, machineId, "behaviorStateMachines.machine");
  const state = behaviorStateMachineState(machine, stateId ?? machine.initial, "behaviorStateMachines.state");
  return state.behaviorRecipes;
}

export function behaviorStateMachineCommandsForState(
  document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
  recipes: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
  machineId: string,
  stateId?: string,
  options: BehaviorStateMachineCommandOptions = {},
): BehaviorRecipeCommand[] {
  const path = options.path ?? "behaviorStateMachines";
  const resolvedRecipes = isResolvedBehaviorRecipeDocument(recipes)
    ? recipes
    : resolveBehaviorRecipeDocument(recipes, { path: `${path}.behaviorRecipes` });
  const resolved = isResolvedBehaviorStateMachineDocument(document)
    ? document
    : resolveBehaviorStateMachineDocument(document as BehaviorStateMachineDocumentSpec, {
      path,
      behaviorRecipes: resolvedRecipes,
    });
  const machine = behaviorStateMachine(resolved, machineId, `${path}.machine`);
  const state = behaviorStateMachineState(machine, stateId ?? machine.initial, `${path}.state`);
  return state.behaviorRecipes.flatMap((behaviorProfile) =>
    behaviorRecipeCommandsForEntity(resolvedRecipes, behaviorProfile, { kinds: options.kinds }),
  );
}

export function createBehaviorStateMachineRuntimeInstallPlan(
  document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
  machineId: string,
  options: BehaviorStateMachineRuntimeInstallOptions = {},
): BehaviorStateMachineRuntimeInstallPlan {
  const path = options.path ?? "behaviorStateMachines";
  const recipes = options.behaviorRecipes === undefined
    ? undefined
    : isResolvedBehaviorRecipeDocument(options.behaviorRecipes)
      ? options.behaviorRecipes
      : resolveBehaviorRecipeDocument(options.behaviorRecipes, { path: `${path}.behaviorRecipes` });
  const resolved = isResolvedBehaviorStateMachineDocument(document)
    ? document
    : resolveBehaviorStateMachineDocument(document as BehaviorStateMachineDocumentSpec, {
      path,
      behaviorRecipes: recipes,
    });
  const machine = behaviorStateMachine(resolved, machineId, `${path}.machine`);
  const states = Object.values(machine.states)
    .map((state) => state.id)
    .sort(compareStableStrings)
    .map((state, index) => ({
      state,
      stateId: index + 1,
    }));
  if (states.length > 0xffffffff) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.machines.${machine.id}.states`,
      "must declare at most 4294967295 runtime states",
    );
  }
  const stateIds = new Map(states.map((state) => [state.state, state.stateId]));
  const transitions = Object.values(machine.states)
    .sort((left, right) => compareStableStrings(left.id, right.id))
    .flatMap((state) =>
      state.transitions.map((transition, index) => {
        const transitionPath = `${path}.machines.${machine.id}.states.${state.id}.transitions.${index}`;
        const eventKind = runtimeEventKind(transition.when.event, `${transitionPath}.when.event`);
        const tokenId = runtimeEventTokenId(transition.when, `${transitionPath}.when`, options.ids);
        return {
          id: transition.id,
          from: state.id,
          to: transition.to,
          fromStateId: runtimeStateId(stateIds, state.id, `${path}.machines.${machine.id}.states.${state.id}`),
          toStateId: runtimeStateId(
            stateIds,
            transition.to,
            `${path}.machines.${machine.id}.states.${state.id}.transitions.${index}.to`,
          ),
          event: transition.when.event,
          eventKind,
          tokenId,
          actionId: tokenId,
        };
      }),
    );
  if (transitions.length > BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.machines.${machine.id}.transitions`,
      `must declare at most ${BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS} runtime transitions`,
    );
  }
  return {
    machine: machine.id,
    initial: machine.initial,
    initialStateId: runtimeStateId(stateIds, machine.initial, `${path}.machines.${machine.id}.initial`),
    states,
    transitions,
  };
}

export function installBehaviorStateMachineRuntime(
  engine: BehaviorStateMachineRuntimeEngine,
  document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
  machineId: string,
  entity: GameplayEntityHandle,
  options: BehaviorStateMachineRuntimeInstallOptions = {},
): BehaviorStateMachineRuntimeInstallResult {
  const path = options.path ?? "behaviorStateMachines";
  const plan = createBehaviorStateMachineRuntimeInstallPlan(document, machineId, options);
  const handle = runtimeEntityHandle(entity, `${path}.entity`);
  requireRuntimeApplied(
    engine.clear_gameplay_behavior_state_machine(handle.entityId, handle.entityGeneration),
    `${path}.clear`,
    "clear behavior state machine",
  );
  requireRuntimeApplied(
    engine.set_gameplay_behavior_state_machine(handle.entityId, handle.entityGeneration, plan.initialStateId),
    `${path}.initial`,
    "set behavior state machine initial state",
  );
  for (const [index, transition] of plan.transitions.entries()) {
    let applied: boolean;
    try {
      applied = applyRuntimeTransition(engine, handle, transition);
    } catch (error) {
      engine.clear_gameplay_behavior_state_machine(handle.entityId, handle.entityGeneration);
      throw error;
    }
    if (!applied) {
      engine.clear_gameplay_behavior_state_machine(handle.entityId, handle.entityGeneration);
      throw gameplayAuthoringDiagnosticError(
        `${path}.transitions.${index}`,
        `failed to apply behavior transition '${transition.id}' to entity '${handle.entityId}'`,
      );
    }
  }
  return {
    plan,
    applied: true,
  };
}

export function createBehaviorStateMachineStateCommandPlan(
  document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
  recipes: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
  installPlan: BehaviorStateMachineRuntimeInstallPlan,
  stateId: number,
  options: BehaviorStateMachineStateCommandOptions = {},
): BehaviorStateMachineStateCommandPlan {
  const path = options.path ?? "behaviorStateMachines";
  if (stateId === 0) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.stateId`,
      "must reference an installed behavior state machine state",
    );
  }
  const runtimeStateIdValue = positiveU32(stateId, `${path}.stateId`);
  const resolvedRecipes = isResolvedBehaviorRecipeDocument(recipes)
    ? recipes
    : resolveBehaviorRecipeDocument(recipes, { path: `${path}.behaviorRecipes` });
  const resolved = isResolvedBehaviorStateMachineDocument(document)
    ? document
    : resolveBehaviorStateMachineDocument(document as BehaviorStateMachineDocumentSpec, {
      path,
      behaviorRecipes: resolvedRecipes,
    });
  const machine = behaviorStateMachine(resolved, installPlan.machine, `${path}.installPlan.machine`);
  const stateRef = installPlan.states.find((candidate) => candidate.stateId === runtimeStateIdValue);
  if (stateRef === undefined) {
    throw gameplayAuthoringDiagnosticError(
      `${path}.stateId`,
      `references unknown runtime state id '${runtimeStateIdValue}' for state machine '${machine.id}'`,
    );
  }
  const state = behaviorStateMachineState(machine, stateRef.state, `${path}.state`);
  const sourceCommands = state.behaviorRecipes.flatMap((behaviorProfile) =>
    behaviorRecipeCommandsForEntity(resolvedRecipes, behaviorProfile, { kinds: options.kinds }),
  );
  const targetEntity = options.entity === undefined
    ? undefined
    : nonEmptyString(options.entity, `${path}.entity`);
  const commands = retargetBehaviorRecipeCommands(sourceCommands, targetEntity);
  return {
    machine: machine.id,
    state: state.id,
    stateId: runtimeStateIdValue,
    behaviorProfiles: state.behaviorRecipes,
    sourceCommands,
    commands,
    ...(targetEntity === undefined ? {} : { targetEntity }),
  };
}

export function createBehaviorStateMachineCurrentStateCommandPlan(
  engine: BehaviorStateMachineRuntimeStateQueryEngine,
  document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
  recipes: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
  installPlan: BehaviorStateMachineRuntimeInstallPlan,
  entity: GameplayEntityHandle,
  options: BehaviorStateMachineStateCommandOptions = {},
): BehaviorStateMachineStateCommandPlan {
  const path = options.path ?? "behaviorStateMachines";
  const handle = runtimeEntityHandle(entity, `${path}.entityHandle`);
  const stateId = engine.gameplay_behavior_state(handle.entityId, handle.entityGeneration);
  return createBehaviorStateMachineStateCommandPlan(document, recipes, installPlan, stateId, options);
}

export function applyBehaviorStateMachineStateCommands(
  engine: GameplayBehaviorRuntimeEngine,
  plan: BehaviorStateMachineStateCommandPlan,
  entity: GameplayEntityHandle,
  options: ApplyBehaviorStateMachineStateCommandsOptions = {},
): BehaviorStateMachineStateCommandApplyResult {
  const preflight = preflightBehaviorStateMachineStateCommands(engine, plan, entity, options);
  const path = options.path ?? "behaviorStateMachines";
  const mode = preflight.mode;
  const targetEntity = nonEmptyString(preflight.plan.targetEntity, `${path}.entity`);
  const commands = preflight.plan.commands;
  const handle = runtimeEntityHandle(entity, `${path}.entityHandle`);
  const transaction = mode === "replaceSupported"
    ? gameplayAuthoringTransactionHooks(engine)
    : undefined;
  let captured = false;
  try {
    if (transaction !== undefined) {
      requireRuntimeApplied(
        transaction.capture(handle),
        `${path}.transaction.capture`,
        "capture gameplay authoring snapshot",
      );
      captured = true;
    }
    const clearResults = mode === "replaceSupported"
      ? clearSupportedGameplayBehaviorComponents(engine, handle, `${path}.clear`)
      : [];
    const result = applyGameplayBehaviorCommands(
      engine,
      commands,
      { [targetEntity]: handle },
      { path, ids: options.ids },
    );
    return {
      plan: preflight.plan,
      commands: result.commands,
      results: [...clearResults, ...result.results],
    };
  } catch (error) {
    if (transaction !== undefined && captured) {
      requireRuntimeApplied(
        transaction.restore(handle),
        `${path}.transaction.restore`,
        "restore gameplay authoring snapshot",
      );
    }
    throw error;
  } finally {
    transaction?.clear();
  }
}

export function preflightBehaviorStateMachineStateCommands(
  engine: GameplayBehaviorRuntimeEngine,
  plan: BehaviorStateMachineStateCommandPlan,
  entity: GameplayEntityHandle,
  options: ApplyBehaviorStateMachineStateCommandsOptions = {},
): BehaviorStateMachineStateCommandPreflightResult {
  const path = options.path ?? "behaviorStateMachines";
  const handle = runtimeEntityHandle(entity, `${path}.entityHandle`);
  const targetEntity = nonEmptyString(options.entity ?? plan.targetEntity, `${path}.entity`);
  const commands = retargetBehaviorRecipeCommands(plan.sourceCommands, targetEntity);
  const mode = stateCommandApplyMode(options.mode ?? "overlay", `${path}.mode`);
  const clearOperations = mode === "replaceSupported"
    ? replaceSupportedClearOperationNames(engine, `${path}.clear`)
    : [];
  preflightRuntimeEntityHandle(engine, handle, `${path}.entityHandle`);
  const result = applyGameplayBehaviorCommands(
    gameplayBehaviorRuntimeCapabilityPreflightEngine(engine),
    commands,
    { [targetEntity]: handle },
    { path, ids: options.ids },
  );
  return {
    plan: {
      ...plan,
      targetEntity,
      commands,
    },
    commands: result.commands,
    results: result.results,
    mode,
    clearOperations,
  };
}

export function runBehaviorStateMachineReplay(
  document: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
  input: BehaviorStateMachineReplayInput,
  options: BehaviorStateMachineReplayOptions = {},
): BehaviorStateMachineReplayResult {
  const path = options.path ?? "behaviorStateMachineReplay";
  if (!isRecord(input)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  const recipes = options.behaviorRecipes === undefined
    ? undefined
    : isResolvedBehaviorRecipeDocument(options.behaviorRecipes)
      ? options.behaviorRecipes
      : resolveBehaviorRecipeDocument(options.behaviorRecipes, { path: `${path}.behaviorRecipes` });
  if (!isResolvedBehaviorStateMachineDocument(document) && recipes === undefined) {
    throw gameplayAuthoringDiagnosticError(
      path,
      "must provide behaviorRecipes when replaying an unresolved behavior state machine document",
    );
  }
  const resolved = isResolvedBehaviorStateMachineDocument(document)
    ? document
    : resolveBehaviorStateMachineDocument(document as BehaviorStateMachineDocumentSpec, {
      path,
      behaviorRecipes: recipes,
  });
  const machine = behaviorStateMachine(resolved, nonEmptyString(input.machine, `${path}.machine`), `${path}.machine`);
  const replayEntity = runtimeEntityHandle(input.entity, `${path}.entity`);
  assertReplayPredicatesUseActionIds(machine, `${path}.machines.${machine.id}`, options.ids);
  let currentState = input.initialState === undefined
    ? machine.initial
    : behaviorStateMachineState(machine, input.initialState, `${path}.initialState`).id;
  const initialState = currentState;
  const frames = arrayOf(input.frames, `${path}.frames`);
  let previousFrame = -1;
  const steps = frames.map((frameInput, index) => {
    const framePath = `${path}.frames.${index}`;
    if (!isRecord(frameInput)) {
      throw gameplayAuthoringDiagnosticError(framePath, "must be an object");
    }
    const frame = nonNegativeInteger(frameInput.frame, `${framePath}.frame`);
    if (frame <= previousFrame) {
      throw gameplayAuthoringDiagnosticError(`${framePath}.frame`, "must be strictly increasing");
    }
    previousFrame = frame;
    const events = gameplayEvents(frameInput.events ?? [], `${framePath}.events`)
      .filter((event) => gameplayEventSubjectMatchesEntity(event, replayEntity));
    const state = behaviorStateMachineState(machine, currentState, `${framePath}.state`);
    const match = firstTransitionMatch(state.transitions, events, options.ids, `${framePath}.state.${state.id}`);
    const step: BehaviorStateMachineReplayStep = {
      frame,
      from: currentState,
      to: match?.transition.to ?? currentState,
      ...(match === undefined ? {} : { transition: match.transition.id, event: match.event }),
    };
    currentState = step.to;
    return step;
  });
  const result: Omit<BehaviorStateMachineReplayResult, "replayHash"> = {
    format: "ferrum2d.behavior-state-machine.replay",
    version: 1,
    machine: machine.id,
    entity: replayEntity,
    initialState,
    finalState: currentState,
    steps,
  };
  return {
    ...result,
    replayHash: hashBehaviorStateMachineReplay(result),
  };
}

export function compareBehaviorStateMachineReplay(
  expected: BehaviorStateMachineReplayResult,
  actual: BehaviorStateMachineReplayResult,
): BehaviorStateMachineReplayComparison {
  const expectedHash = hashBehaviorStateMachineReplay(expected);
  const actualHash = hashBehaviorStateMachineReplay(actual);
  return {
    passed: expectedHash === actualHash,
    expectedHash,
    actualHash,
    ...(
      expectedHash === actualHash
        ? {}
        : { firstMismatchFrame: firstReplayMismatchFrame(expected.steps, actual.steps) }
    ),
    expectedFinalState: expected.finalState,
    actualFinalState: actual.finalState,
  };
}

function resolveMachines(
  machines: Readonly<Record<string, unknown>>,
  recipes: ResolvedBehaviorRecipeDocument | undefined,
  path: string,
): Record<string, ResolvedBehaviorStateMachine> {
  const resolved: Record<string, ResolvedBehaviorStateMachine> = {};
  for (const [machineId, machine] of Object.entries(machines)) {
    const id = nonEmptyString(machineId, `${path}.${machineId}`);
    resolved[id] = resolveMachine(id, machine, recipes, `${path}.${machineId}`);
  }
  if (Object.keys(resolved).length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must declare at least one state machine");
  }
  return resolved;
}

function resolveMachine(
  id: string,
  machine: unknown,
  recipes: ResolvedBehaviorRecipeDocument | undefined,
  path: string,
): ResolvedBehaviorStateMachine {
  if (!isRecord(machine)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  const initial = nonEmptyString(machine.initial, `${path}.initial`);
  const states = resolveStates(requiredRecord(machine.states, `${path}.states`), recipes, `${path}.states`);
  if (states[initial] === undefined) {
    throw gameplayAuthoringDiagnosticError(`${path}.initial`, `references unknown state '${initial}'`);
  }
  for (const state of Object.values(states)) {
    state.transitions.forEach((transition, index) => {
      if (states[transition.to] === undefined) {
        throw gameplayAuthoringDiagnosticError(
          `${path}.states.${state.id}.transitions.${index}.to`,
          `references unknown state '${transition.to}'`,
        );
      }
    });
  }
  return {
    id,
    initial,
    states,
  };
}

function resolveStates(
  states: Readonly<Record<string, unknown>>,
  recipes: ResolvedBehaviorRecipeDocument | undefined,
  path: string,
): Record<string, ResolvedBehaviorStateMachineState> {
  const resolved: Record<string, ResolvedBehaviorStateMachineState> = {};
  for (const [stateId, state] of Object.entries(states)) {
    const id = nonEmptyString(stateId, `${path}.${stateId}`);
    resolved[id] = resolveState(id, state, recipes, `${path}.${stateId}`);
  }
  if (Object.keys(resolved).length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must declare at least one state");
  }
  return resolved;
}

function resolveState(
  id: string,
  state: unknown,
  recipes: ResolvedBehaviorRecipeDocument | undefined,
  path: string,
): ResolvedBehaviorStateMachineState {
  if (!isRecord(state)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  const behaviorRecipes = behaviorBindings(state.behaviorRecipes ?? [], `${path}.behaviorRecipes`);
  validateBehaviorProfiles(behaviorRecipes, recipes, `${path}.behaviorRecipes`);
  const transitions = arrayOf(state.transitions ?? [], `${path}.transitions`).map((transition, index) =>
    resolveTransition(transition, `${path}.transitions.${index}`, `${id}.${index}`),
  );
  assertUniqueTransitionIds(transitions, `${path}.transitions`);
  return {
    id,
    behaviorRecipes,
    transitions,
  };
}

function resolveTransition(
  transition: unknown,
  path: string,
  fallbackId: string,
): ResolvedBehaviorStateMachineTransition {
  if (!isRecord(transition)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  return {
    id: optionalString(transition.id, `${path}.id`, fallbackId),
    to: nonEmptyString(transition.to, `${path}.to`),
    when: transitionPredicate(transition.when, `${path}.when`),
  };
}

function transitionPredicate(value: unknown, path: string): ResolvedBehaviorStateMachineTransitionPredicate {
  if (!isRecord(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  if (value.type !== "gameplayEvent") {
    throw gameplayAuthoringDiagnosticError(`${path}.type`, "must be gameplayEvent");
  }
  const event = behaviorStateMachineEventKind(value.event, `${path}.event`);
  const action = value.action === undefined ? undefined : nonEmptyString(value.action, `${path}.action`);
  const actionId = value.actionId === undefined ? undefined : positiveInteger(value.actionId, `${path}.actionId`);
  const timer = value.timer === undefined ? undefined : nonEmptyString(value.timer, `${path}.timer`);
  const timerId = value.timerId === undefined ? undefined : positiveInteger(value.timerId, `${path}.timerId`);
  const item = value.item === undefined ? undefined : nonEmptyString(value.item, `${path}.item`);
  const itemId = value.itemId === undefined ? undefined : positiveInteger(value.itemId, `${path}.itemId`);
  const tileImpact = value.tileImpact === undefined ? undefined : tileImpactPolicy(value.tileImpact, `${path}.tileImpact`);
  const tileImpactCode = value.tileImpactCode === undefined ? undefined : tileImpactPolicyCode(value.tileImpactCode, `${path}.tileImpactCode`);
  if (event === "interaction" && action === undefined && actionId === undefined) {
    throw gameplayAuthoringDiagnosticError(path, "must declare action or actionId for interaction event predicates");
  }
  if (event !== "interaction" && (action !== undefined || actionId !== undefined)) {
    throw gameplayAuthoringDiagnosticError(path, "must not declare action or actionId for non-interaction event predicates");
  }
  if (event === "timer" && timer === undefined && timerId === undefined) {
    throw gameplayAuthoringDiagnosticError(path, "must declare timer or timerId for timer event predicates");
  }
  if (event !== "timer" && (timer !== undefined || timerId !== undefined)) {
    throw gameplayAuthoringDiagnosticError(path, "must not declare timer or timerId for non-timer event predicates");
  }
  if (event === "pickupCollected" && item === undefined && itemId === undefined) {
    throw gameplayAuthoringDiagnosticError(path, "must declare item or itemId for pickupCollected event predicates");
  }
  if (event !== "pickupCollected" && (item !== undefined || itemId !== undefined)) {
    throw gameplayAuthoringDiagnosticError(path, "must not declare item or itemId for non-pickupCollected event predicates");
  }
  if (event === "tileImpact" && tileImpact === undefined && tileImpactCode === undefined) {
    throw gameplayAuthoringDiagnosticError(path, "must declare tileImpact or tileImpactCode for tileImpact event predicates");
  }
  if (
    event === "tileImpact"
    && tileImpact !== undefined
    && tileImpactCode !== undefined
    && tileImpactPolicyNameCode(tileImpact, `${path}.tileImpact`) !== tileImpactCode
  ) {
    throw gameplayAuthoringDiagnosticError(path, "tileImpact and tileImpactCode must describe the same emitted tile impact policy");
  }
  if (event !== "tileImpact" && (tileImpact !== undefined || tileImpactCode !== undefined)) {
    throw gameplayAuthoringDiagnosticError(path, "must not declare tileImpact or tileImpactCode for non-tileImpact event predicates");
  }
  return {
    type: "gameplayEvent",
    event,
    ...(action === undefined ? {} : { action }),
    ...(actionId === undefined ? {} : { actionId }),
    ...(timer === undefined ? {} : { timer }),
    ...(timerId === undefined ? {} : { timerId }),
    ...(item === undefined ? {} : { item }),
    ...(itemId === undefined ? {} : { itemId }),
    ...(tileImpact === undefined ? {} : { tileImpact }),
    ...(tileImpactCode === undefined ? {} : { tileImpactCode }),
  };
}

function behaviorBindings(value: unknown, path: string): readonly string[] {
  if (typeof value === "string") {
    return [nonEmptyString(value, path)];
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => nonEmptyString(entry, `${path}.${index}`));
  }
  throw gameplayAuthoringDiagnosticError(path, "must be a behavior profile string or string array");
}

function validateBehaviorProfiles(
  behaviorProfiles: readonly string[],
  recipes: ResolvedBehaviorRecipeDocument | undefined,
  path: string,
): void {
  if (recipes === undefined) {
    return;
  }
  behaviorProfiles.forEach((profile, index) => {
    if (recipes.entities[profile] === undefined) {
      throw gameplayAuthoringDiagnosticError(`${path}.${index}`, `references unknown behavior profile '${profile}'`);
    }
  });
}

function assertUniqueTransitionIds(
  transitions: readonly ResolvedBehaviorStateMachineTransition[],
  path: string,
): void {
  const seen = new Set<string>();
  transitions.forEach((transition, index) => {
    if (seen.has(transition.id)) {
      throw gameplayAuthoringDiagnosticError(`${path}.${index}.id`, "transition id must be unique per state");
    }
    seen.add(transition.id);
  });
}

function behaviorStateMachine(
  document: ResolvedBehaviorStateMachineDocument,
  machineId: string,
  path: string,
): ResolvedBehaviorStateMachine {
  const id = nonEmptyString(machineId, path);
  const machine = document.machines[id];
  if (machine === undefined) {
    throw gameplayAuthoringDiagnosticError(path, `references unknown state machine '${id}'`);
  }
  return machine;
}

function behaviorStateMachineState(
  machine: ResolvedBehaviorStateMachine,
  stateId: string,
  path: string,
): ResolvedBehaviorStateMachineState {
  const id = nonEmptyString(stateId, path);
  const state = machine.states[id];
  if (state === undefined) {
    throw gameplayAuthoringDiagnosticError(path, `references unknown state '${id}'`);
  }
  return state;
}

function runtimeStateId(stateIds: ReadonlyMap<string, number>, state: string, path: string): number {
  const stateId = stateIds.get(state);
  if (stateId === undefined) {
    throw gameplayAuthoringDiagnosticError(path, `references unknown runtime state '${state}'`);
  }
  return stateId;
}

function runtimeEntityHandle(value: unknown, path: string): GameplayEntityHandle {
  if (!isRecord(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an entity handle object");
  }
  return {
    entityId: nonNegativeInteger(value.entityId, `${path}.entityId`),
    entityGeneration: nonNegativeInteger(value.entityGeneration, `${path}.entityGeneration`),
  };
}

function requireRuntimeApplied(applied: boolean, path: string, operation: string): boolean {
  if (!applied) {
    throw gameplayAuthoringDiagnosticError(path, `failed to ${operation}`);
  }
  return true;
}

function applyRuntimeTransition(
  engine: BehaviorStateMachineRuntimeEngine,
  handle: GameplayEntityHandle,
  transition: BehaviorStateMachineRuntimeTransitionInstall,
): boolean {
  if (engine.add_gameplay_behavior_event_transition !== undefined) {
    return engine.add_gameplay_behavior_event_transition(
      handle.entityId,
      handle.entityGeneration,
      transition.fromStateId,
      transition.toStateId,
      transition.eventKind,
      transition.tokenId,
    );
  }
  if (transition.event !== "interaction") {
    throw gameplayAuthoringDiagnosticError(
      "behaviorStateMachines.transitions.event",
      "runtime engine must provide add_gameplay_behavior_event_transition for non-interaction FSM predicates",
    );
  }
  return engine.add_gameplay_behavior_transition(
    handle.entityId,
    handle.entityGeneration,
    transition.fromStateId,
    transition.toStateId,
    transition.actionId,
  );
}

function stateCommandApplyMode(value: unknown, path: string): BehaviorStateMachineStateCommandApplyMode {
  if (value === "overlay" || value === "replaceSupported") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of overlay or replaceSupported");
}

function behaviorStateMachineEventKind(value: unknown, path: string): BehaviorStateMachineGameplayEventKind {
  if (
    value === "interaction"
    || value === "collisionDamage"
    || value === "collisionDespawn"
    || value === "timer"
    || value === "pickupCollected"
    || value === "tileImpact"
  ) {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of interaction, collisionDamage, collisionDespawn, timer, pickupCollected, or tileImpact");
}

function runtimeEventKind(event: BehaviorStateMachineGameplayEventKind, path: string): number {
  switch (event) {
    case "interaction":
      return GAMEPLAY_EVENT_KIND_INTERACTION;
    case "collisionDamage":
      return GAMEPLAY_EVENT_KIND_COLLISION_DAMAGE;
    case "collisionDespawn":
      return GAMEPLAY_EVENT_KIND_COLLISION_DESPAWN;
    case "timer":
      return GAMEPLAY_EVENT_KIND_TIMER;
    case "pickupCollected":
      return GAMEPLAY_EVENT_KIND_PICKUP_COLLECTED;
    case "tileImpact":
      return GAMEPLAY_EVENT_KIND_TILE_IMPACT;
    default:
      throw gameplayAuthoringDiagnosticError(path, "must be a supported gameplay event kind");
  }
}

function runtimeEventTokenId(
  predicate: ResolvedBehaviorStateMachineTransitionPredicate,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): number {
  if (predicate.event !== "interaction") {
    if (predicate.event === "tileImpact") {
      return tileImpactPredicateCode(predicate, path);
    }
    if (predicate.event === "pickupCollected") {
      const itemId = predicate.itemId ?? (predicate.item === undefined ? undefined : ids?.items?.[predicate.item]);
      if (itemId === undefined) {
        throw gameplayAuthoringDiagnosticError(
          predicate.item === undefined ? `${path}.itemId` : `${path}.item`,
          predicate.item === undefined
            ? "must use itemId for runtime behavior state machine installation"
            : `must resolve pickup item '${predicate.item}' to a runtime item id`,
        );
      }
      return positiveU32(itemId, `${path}.itemId`);
    }
    if (predicate.event !== "timer") {
      return 0;
    }
    const timerId = predicate.timerId ?? (predicate.timer === undefined ? undefined : ids?.timers?.[predicate.timer]);
    if (timerId === undefined) {
      throw gameplayAuthoringDiagnosticError(
        predicate.timer === undefined ? `${path}.timerId` : `${path}.timer`,
        predicate.timer === undefined
          ? "must use timerId for runtime behavior state machine installation"
          : `must resolve timer '${predicate.timer}' to a runtime timer id`,
      );
    }
    return positiveU32(timerId, `${path}.timerId`);
  }
  const actionId = predicate.actionId ?? (predicate.action === undefined ? undefined : ids?.actions?.[predicate.action]);
  if (actionId === undefined) {
    throw gameplayAuthoringDiagnosticError(
      predicate.action === undefined ? `${path}.actionId` : `${path}.action`,
      predicate.action === undefined
        ? "must use actionId for runtime behavior state machine installation"
        : `must resolve interaction action '${predicate.action}' to a runtime action id`,
    );
  }
  return positiveU32(actionId, `${path}.actionId`);
}

function tileImpactPredicateCode(
  predicate: ResolvedBehaviorStateMachineTransitionPredicate,
  path: string,
): number {
  if (predicate.tileImpactCode !== undefined) {
    return tileImpactPolicyCode(predicate.tileImpactCode, `${path}.tileImpactCode`);
  }
  if (predicate.tileImpact !== undefined) {
    return tileImpactPolicyNameCode(predicate.tileImpact, `${path}.tileImpact`);
  }
  throw gameplayAuthoringDiagnosticError(path, "must declare tileImpact or tileImpactCode for tileImpact event predicates");
}

function tileImpactPolicyNameCode(value: BehaviorStateMachineTileImpactPolicy, path: string): number {
  if (value === "despawn") return 0;
  if (value === "bounce") return 2;
  throw gameplayAuthoringDiagnosticError(path, "must be one of despawn or bounce");
}

function clearSupportedGameplayBehaviorComponents(
  engine: GameplayBehaviorRuntimeEngine,
  handle: GameplayEntityHandle,
  path: string,
): boolean[] {
  replaceSupportedClearOperationNames(engine, path);
  const clearMovement = engine.clear_gameplay_movement!;
  const clearCollisionReactions = engine.clear_gameplay_collision_reactions!;
  const clearActions = engine.clear_gameplay_actions!;
  const clearTimerTrigger = engine.clear_gameplay_timer_trigger!;
  const clearResults = [
    requireRuntimeApplied(
      engine.clear_gameplay_health(handle.entityId, handle.entityGeneration),
      `${path}.health`,
      "clear gameplay health",
    ),
    requireRuntimeApplied(
      engine.clear_gameplay_damage(handle.entityId, handle.entityGeneration),
      `${path}.damage`,
      "clear gameplay damage",
    ),
    ...(engine.clear_gameplay_faction === undefined
      ? []
      : [
          requireRuntimeApplied(
            engine.clear_gameplay_faction(handle.entityId, handle.entityGeneration),
            `${path}.faction`,
            "clear gameplay faction",
          ),
        ]),
    requireRuntimeApplied(
      engine.clear_gameplay_lifetime(handle.entityId, handle.entityGeneration),
      `${path}.lifetime`,
      "clear gameplay lifetime",
    ),
    requireRuntimeApplied(
      engine.clear_gameplay_score_reward(handle.entityId, handle.entityGeneration),
      `${path}.scoreReward`,
      "clear gameplay score reward",
    ),
    requireRuntimeApplied(
      engine.clear_gameplay_pickup(handle.entityId, handle.entityGeneration),
      `${path}.pickup`,
      "clear gameplay pickup",
    ),
    requireRuntimeApplied(
      engine.clear_gameplay_interaction(handle.entityId, handle.entityGeneration),
      `${path}.interaction`,
      "clear gameplay interaction",
    ),
    requireRuntimeApplied(
      clearTimerTrigger.call(engine, handle.entityId, handle.entityGeneration),
      `${path}.timerTrigger`,
      "clear gameplay timer trigger",
    ),
    requireRuntimeApplied(
      clearActions.call(engine, handle.entityId, handle.entityGeneration),
      `${path}.actions`,
      "clear gameplay actions",
    ),
    requireRuntimeApplied(
      clearMovement.call(engine, handle.entityId, handle.entityGeneration),
      `${path}.movement`,
      "clear gameplay movement",
    ),
    requireRuntimeApplied(
      clearCollisionReactions.call(engine, handle.entityId, handle.entityGeneration),
      `${path}.collisionReactions`,
      "clear gameplay collision reactions",
    ),
  ];
  return clearResults;
}

function replaceSupportedClearOperationNames(
  engine: GameplayBehaviorRuntimeEngine,
  path: string,
): readonly string[] {
  requireReplaceSupportedClearMethod(engine.clear_gameplay_timer_trigger, `${path}.timerTrigger`);
  requireReplaceSupportedClearMethod(engine.clear_gameplay_actions, `${path}.actions`);
  requireReplaceSupportedClearMethod(engine.clear_gameplay_movement, `${path}.movement`);
  requireReplaceSupportedClearMethod(engine.clear_gameplay_collision_reactions, `${path}.collisionReactions`);
  return [
    "health",
    "damage",
    ...(engine.clear_gameplay_faction === undefined ? [] : ["faction"]),
    "lifetime",
    "scoreReward",
    "pickup",
    "interaction",
    "timerTrigger",
    "actions",
    "movement",
    "collisionReactions",
  ];
}

function requireReplaceSupportedClearMethod(method: unknown, path: string): void {
  if (method !== undefined) {
    return;
  }
  throw gameplayAuthoringDiagnosticError(
    path,
    "runtime engine must provide this clear method for replaceSupported mode",
  );
}

function gameplayAuthoringTransactionHooks(
  engine: GameplayBehaviorRuntimeEngine,
): GameplayAuthoringTransactionHooks | undefined {
  const capture = engine.capture_gameplay_authoring_snapshot;
  const restore = engine.restore_gameplay_authoring_snapshot;
  const clear = engine.clear_gameplay_authoring_snapshot;
  if (capture === undefined || restore === undefined || clear === undefined) {
    return undefined;
  }
  return {
    capture: (handle) => capture.call(engine, handle.entityId, handle.entityGeneration),
    restore: (handle) => restore.call(engine, handle.entityId, handle.entityGeneration),
    clear: () => clear.call(engine),
  };
}

function gameplayBehaviorRuntimeCapabilityPreflightEngine(
  engine: GameplayBehaviorRuntimeEngine,
): GameplayBehaviorRuntimeEngine {
  const entityExists = (entityId: number, entityGeneration: number): boolean =>
    preflightRuntimeEntityExists(engine, entityId, entityGeneration);
  const entitySetter = (entityId: number, entityGeneration: number): boolean =>
    entityExists(entityId, entityGeneration);
  const entityPairSetter = (
    entityId: number,
    entityGeneration: number,
    targetId: number,
    targetGeneration: number,
  ): boolean => entityExists(entityId, entityGeneration) && entityExists(targetId, targetGeneration);
  return {
    ...(engine.gameplay_entity_exists === undefined
      ? {}
      : {
          gameplay_entity_exists: entitySetter,
        }),
    set_gameplay_health: entitySetter,
    clear_gameplay_health: () => true,
    set_gameplay_damage: entitySetter,
    clear_gameplay_damage: () => true,
    ...(engine.set_gameplay_damage_reaction === undefined
      ? {}
      : { set_gameplay_damage_reaction: entitySetter }),
    ...(engine.set_gameplay_faction === undefined
      ? {}
      : { set_gameplay_faction: entitySetter }),
    ...(engine.clear_gameplay_faction === undefined ? {} : { clear_gameplay_faction: () => true }),
    set_gameplay_lifetime: entitySetter,
    clear_gameplay_lifetime: () => true,
    set_gameplay_score_reward: entitySetter,
    clear_gameplay_score_reward: () => true,
    set_gameplay_pickup: entitySetter,
    clear_gameplay_pickup: () => true,
    set_gameplay_interaction: entitySetter,
    clear_gameplay_interaction: () => true,
    ...(engine.set_gameplay_timer_trigger === undefined
      ? {}
      : { set_gameplay_timer_trigger: entitySetter }),
    ...(engine.set_gameplay_timer_action_trigger === undefined
      ? {}
      : { set_gameplay_timer_action_trigger: entitySetter }),
    ...(engine.clear_gameplay_timer_trigger === undefined ? {} : { clear_gameplay_timer_trigger: () => true }),
    ...(engine.set_gameplay_action_projectile === undefined
      ? {}
      : { set_gameplay_action_projectile: entitySetter }),
    ...(engine.set_gameplay_action_projectile_with_target === undefined
      ? {}
      : { set_gameplay_action_projectile_with_target: entitySetter }),
    ...(engine.set_gameplay_action_dash === undefined
      ? {}
      : { set_gameplay_action_dash: entitySetter }),
    ...(engine.set_gameplay_action_dash_with_aim === undefined
      ? {}
      : { set_gameplay_action_dash_with_aim: entitySetter }),
    ...(engine.set_gameplay_action_melee === undefined
      ? {}
      : { set_gameplay_action_melee: entitySetter }),
    ...(engine.set_gameplay_action_melee_with_target === undefined
      ? {}
      : { set_gameplay_action_melee_with_target: entitySetter }),
    ...(engine.set_gameplay_action_spawn_prefab === undefined
      ? {}
      : { set_gameplay_action_spawn_prefab: entitySetter }),
    ...(engine.clear_gameplay_actions === undefined ? {} : { clear_gameplay_actions: () => true }),
    set_gameplay_movement_chase_player: entitySetter,
    set_gameplay_movement_chase_entity: entityPairSetter,
    ...(engine.clear_gameplay_movement === undefined ? {} : { clear_gameplay_movement: () => true }),
    ...(engine.clear_gameplay_collision_reactions === undefined ? {} : { clear_gameplay_collision_reactions: () => true }),
    add_gameplay_collision_damage: entitySetter,
    ...(engine.add_gameplay_collision_pickup === undefined
      ? {}
      : { add_gameplay_collision_pickup: entitySetter }),
    ...(engine.add_gameplay_collision_sound === undefined
      ? {}
      : { add_gameplay_collision_sound: entitySetter }),
    ...(engine.add_gameplay_collision_sound_with_cooldown === undefined
      ? {}
      : { add_gameplay_collision_sound_with_cooldown: entitySetter }),
    ...(engine.add_gameplay_collision_sound_with_policy === undefined
      ? {}
      : { add_gameplay_collision_sound_with_policy: entitySetter }),
    ...(engine.add_gameplay_collision_sound_with_trigger === undefined
      ? {}
      : { add_gameplay_collision_sound_with_trigger: entitySetter }),
    ...(engine.add_gameplay_collision_particle === undefined
      ? {}
      : { add_gameplay_collision_particle: entitySetter }),
    ...(engine.add_gameplay_collision_particle_with_cooldown === undefined
      ? {}
      : { add_gameplay_collision_particle_with_cooldown: entitySetter }),
    ...(engine.add_gameplay_collision_particle_with_policy === undefined
      ? {}
      : { add_gameplay_collision_particle_with_policy: entitySetter }),
    ...(engine.add_gameplay_collision_particle_with_trigger === undefined
      ? {}
      : { add_gameplay_collision_particle_with_trigger: entitySetter }),
    ...(engine.add_gameplay_collision_despawn === undefined
      ? {}
      : { add_gameplay_collision_despawn: entitySetter }),
  };
}

function preflightRuntimeEntityHandle(
  engine: GameplayBehaviorRuntimeEngine,
  handle: GameplayEntityHandle,
  path: string,
): void {
  if (!preflightRuntimeEntityExists(engine, handle.entityId, handle.entityGeneration)) {
    throw gameplayAuthoringDiagnosticError(path, "references a stale or missing runtime entity handle");
  }
}

function preflightRuntimeEntityExists(
  engine: GameplayBehaviorRuntimeEngine,
  entityId: number,
  entityGeneration: number,
): boolean {
  return engine.gameplay_entity_exists?.(entityId, entityGeneration) ?? true;
}

function retargetBehaviorRecipeCommands(
  commands: readonly BehaviorRecipeCommand[],
  targetEntity: string | undefined,
): readonly BehaviorRecipeCommand[] {
  if (targetEntity === undefined) {
    return commands;
  }
  return commands.map((command) => ({
    ...command,
    entity: targetEntity,
  }));
}

function firstTransitionMatch(
  transitions: readonly ResolvedBehaviorStateMachineTransition[],
  events: readonly GameplayEventAction[],
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): { transition: ResolvedBehaviorStateMachineTransition; event: BehaviorStateMachineReplayEventMatch } | undefined {
  for (const [index, transition] of transitions.entries()) {
    const event = events.find((candidate) =>
      transitionMatchesEvent(transition.when, candidate, ids, `${path}.transitions.${index}.when`)
    );
    if (event !== undefined) {
      return {
        transition,
        event: replayEventMatch(event),
      };
    }
  }
  return undefined;
}

function transitionMatchesEvent(
  predicate: ResolvedBehaviorStateMachineTransitionPredicate,
  event: GameplayEventAction,
  ids: GameplayBehaviorRuntimeIds | undefined,
  path: string,
): boolean {
  if (predicate.type !== "gameplayEvent" || predicate.event !== event.type) {
    return false;
  }
  if (event.type !== "interaction") {
    if (event.type === "pickupCollected") {
      const itemId = predicate.itemId ?? (predicate.item === undefined ? undefined : ids?.items?.[predicate.item]);
      if (itemId !== undefined) {
        return positiveU32(itemId, `${path}.itemId`) === event.itemId;
      }
      return false;
    }
    if (event.type === "timer") {
      const timerId = predicate.timerId ?? (predicate.timer === undefined ? undefined : ids?.timers?.[predicate.timer]);
      if (timerId !== undefined) {
        return positiveU32(timerId, `${path}.timerId`) === event.timerId;
      }
      return false;
    }
    if (event.type === "tileImpact") {
      return tileImpactPredicateCode(predicate, path) === event.tileImpactCode;
    }
    return true;
  }
  const actionId = predicate.actionId ?? (predicate.action === undefined ? undefined : ids?.actions?.[predicate.action]);
  if (actionId !== undefined) {
    return positiveU32(actionId, `${path}.actionId`) === event.actionId;
  }
  return predicate.action === event.action;
}

function gameplayEventSubjectMatchesEntity(event: GameplayEventAction, entity: GameplayEntityHandle): boolean {
  if (event.type === "pickupCollected") {
    return event.actor.entityId === entity.entityId && event.actor.entityGeneration === entity.entityGeneration;
  }
  return event.source.entityId === entity.entityId && event.source.entityGeneration === entity.entityGeneration;
}

function replayEventMatch(event: GameplayEventAction): BehaviorStateMachineReplayEventMatch {
  return {
    type: event.type,
    ...(event.type === "interaction" ? { actionId: event.actionId } : {}),
    ...(event.type === "collisionDamage" ? { damage: event.damage, targetRemoved: event.targetRemoved } : {}),
    ...(event.type === "collisionDespawn" ? { targetRemoved: event.targetRemoved } : {}),
    ...(event.type === "timer" ? { timerId: event.timerId, durationSeconds: event.durationSeconds } : {}),
    ...(event.type === "pickupCollected" ? {
      itemId: event.itemId,
      count: event.count,
      targetRemoved: event.targetRemoved,
    } : {}),
    ...(event.type === "tileImpact" ? {
      tileImpact: event.tileImpact,
      tileImpactCode: event.tileImpactCode,
      layerIndex: event.layerIndex,
      tileIndex: event.tileIndex,
      normal: event.normal,
      bounced: event.bounced,
      identityTruncated: event.identityTruncated,
      targetRemoved: event.targetRemoved,
    } : {}),
    sourceEntityId: event.source.entityId,
    actorEntityId: event.actor.entityId,
    actorEntityGeneration: event.actor.entityGeneration,
    sourceEntityGeneration: event.source.entityGeneration,
  };
}

function assertReplayPredicatesUseActionIds(
  machine: ResolvedBehaviorStateMachine,
  path: string,
  ids: GameplayBehaviorRuntimeIds | undefined,
): void {
  Object.values(machine.states).forEach((state) => {
    state.transitions.forEach((transition, index) => {
      if (transition.when.event === "timer") {
        if (
          transition.when.timerId !== undefined
          || (transition.when.timer !== undefined && ids?.timers?.[transition.when.timer] !== undefined)
        ) {
          return;
        }
        throw gameplayAuthoringDiagnosticError(
          transition.when.timer === undefined
            ? `${path}.states.${state.id}.transitions.${index}.when.timerId`
            : `${path}.states.${state.id}.transitions.${index}.when.timer`,
          transition.when.timer === undefined
            ? "must use timerId for deterministic replay predicates"
            : `must resolve timer '${transition.when.timer}' to a runtime timer id`,
        );
      }
      if (transition.when.event === "pickupCollected") {
        if (
          transition.when.itemId !== undefined
          || (transition.when.item !== undefined && ids?.items?.[transition.when.item] !== undefined)
        ) {
          return;
        }
        throw gameplayAuthoringDiagnosticError(
          transition.when.item === undefined
            ? `${path}.states.${state.id}.transitions.${index}.when.itemId`
            : `${path}.states.${state.id}.transitions.${index}.when.item`,
          transition.when.item === undefined
            ? "must use itemId for deterministic replay predicates"
            : `must resolve pickup item '${transition.when.item}' to a runtime item id`,
        );
      }
      if (
        transition.when.actionId === undefined &&
        (transition.when.action === undefined || ids?.actions?.[transition.when.action] === undefined)
      ) {
        if (transition.when.event !== "interaction") {
          return;
        }
        throw gameplayAuthoringDiagnosticError(
          transition.when.action === undefined
            ? `${path}.states.${state.id}.transitions.${index}.when.actionId`
            : `${path}.states.${state.id}.transitions.${index}.when.action`,
          transition.when.action === undefined
            ? "must use actionId for deterministic replay predicates"
            : `must resolve interaction action '${transition.when.action}' to a runtime action id`,
        );
      }
    });
  });
}

function gameplayEvents(value: unknown, path: string): readonly GameplayEventAction[] {
  if (!Array.isArray(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an array");
  }
  value.forEach((event, index) => {
    const eventPath = `${path}.${index}`;
    if (!isRecord(event)) {
      throw gameplayAuthoringDiagnosticError(eventPath, "must be a gameplay event action object");
    }
    const type = behaviorStateMachineEventKind(event.type, `${eventPath}.type`);
    if (type === "interaction") {
      positiveInteger(event.actionId, `${eventPath}.actionId`);
    } else if (type === "collisionDamage") {
      finiteNumber(event.damage, `${eventPath}.damage`);
      booleanValue(event.targetRemoved, `${eventPath}.targetRemoved`);
    } else if (type === "collisionDespawn") {
      booleanValue(event.targetRemoved, `${eventPath}.targetRemoved`);
    } else if (type === "timer") {
      positiveInteger(event.timerId, `${eventPath}.timerId`);
      finiteNumber(event.durationSeconds, `${eventPath}.durationSeconds`);
    } else if (type === "pickupCollected") {
      positiveInteger(event.itemId, `${eventPath}.itemId`);
      positiveInteger(event.count, `${eventPath}.count`);
      booleanValue(event.targetRemoved, `${eventPath}.targetRemoved`);
    } else {
      tileImpactEventPolicyCode(event.tileImpactCode, `${eventPath}.tileImpactCode`);
      tileImpactEventPolicy(event.tileImpact, `${eventPath}.tileImpact`);
      nonNegativeInteger(event.layerIndex, `${eventPath}.layerIndex`);
      nonNegativeInteger(event.tileIndex, `${eventPath}.tileIndex`);
      nonEmptyString(event.normal, `${eventPath}.normal`);
      booleanValue(event.bounced, `${eventPath}.bounced`);
      booleanValue(event.identityTruncated, `${eventPath}.identityTruncated`);
      booleanValue(event.targetRemoved, `${eventPath}.targetRemoved`);
    }
    gameplayEntityHandle(event.actor, `${eventPath}.actor`);
    gameplayEntityHandle(event.source, `${eventPath}.source`);
  });
  return value as readonly GameplayEventAction[];
}

function gameplayEntityHandle(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an entity handle object");
  }
  nonNegativeInteger(value.entityId, `${path}.entityId`);
  nonNegativeInteger(value.entityGeneration, `${path}.entityGeneration`);
}

function hashBehaviorStateMachineReplay(
  replay: Omit<BehaviorStateMachineReplayResult, "replayHash"> | BehaviorStateMachineReplayResult,
): string {
  return fnv1a32(stableStringify({
    format: replay.format,
    version: replay.version,
    machine: replay.machine,
    entity: replay.entity,
    initialState: replay.initialState,
    finalState: replay.finalState,
    steps: replay.steps,
  }));
}

function firstReplayMismatchFrame(
  expected: readonly BehaviorStateMachineReplayStep[],
  actual: readonly BehaviorStateMachineReplayStep[],
): number | undefined {
  const count = Math.max(expected.length, actual.length);
  for (let index = 0; index < count; index += 1) {
    const expectedStep = expected[index];
    const actualStep = actual[index];
    if (stableStringify(expectedStep) !== stableStringify(actualStep)) {
      return expectedStep?.frame ?? actualStep?.frame;
    }
  }
  return undefined;
}

function requiredRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  return value;
}

function arrayOf(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an array");
  }
  return value;
}

function optionalString(value: unknown, path: string, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  return nonEmptyString(value, path);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-empty string");
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a positive integer");
  }
  return value;
}

function positiveU32(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value <= 0
    || value > 0xffffffff
  ) {
    throw gameplayAuthoringDiagnosticError(path, "must be a positive safe u32 integer");
  }
  return value;
}

function tileImpactPolicy(value: unknown, path: string): BehaviorStateMachineTileImpactPolicy {
  if (value === "despawn" || value === "bounce") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of despawn or bounce; passThrough does not emit tileImpact telemetry");
}

function tileImpactPolicyCode(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || (value !== 0 && value !== 2)
  ) {
    throw gameplayAuthoringDiagnosticError(path, "must be a tile impact predicate code 0 (despawn) or 2 (bounce)");
  }
  return value;
}

function tileImpactEventPolicy(value: unknown, path: string): GameplayTileImpactPolicy {
  if (value === "despawn" || value === "passThrough" || value === "bounce" || value === "unknown") {
    return value;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of despawn, passThrough, bounce, or unknown");
}

function tileImpactEventPolicyCode(value: unknown, path: string): number {
  if (
    typeof value !== "number"
    || !Number.isSafeInteger(value)
    || value < 0
    || value > 0xffffffff
  ) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-negative safe u32 tile impact event code");
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw gameplayAuthoringDiagnosticError(path, "must be a finite number");
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw gameplayAuthoringDiagnosticError(path, "must be a boolean");
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw gameplayAuthoringDiagnosticError(path, "must be a non-negative integer");
  }
  return value;
}

function compareStableStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isResolvedBehaviorRecipeDocument(
  value: BehaviorRecipeDocumentSpec | ResolvedBehaviorRecipeDocument,
): value is ResolvedBehaviorRecipeDocument {
  const firstEntity = Object.values(value.entities ?? {})[0];
  const firstRecipe = Object.values(value.recipes ?? {})[0];
  return isRecord(firstEntity)
    && typeof firstEntity.id === "string"
    && Array.isArray(firstEntity.recipes)
    && (firstRecipe === undefined || (isRecord(firstRecipe) && typeof firstRecipe.id === "string" && typeof firstRecipe.enabled === "boolean"));
}

function isResolvedBehaviorStateMachineDocument(
  value: BehaviorStateMachineDocumentSpec | ResolvedBehaviorStateMachineDocument,
): value is ResolvedBehaviorStateMachineDocument {
  const firstMachine = Object.values(value.machines ?? {})[0];
  return isRecord(firstMachine)
    && typeof firstMachine.id === "string"
    && typeof firstMachine.initial === "string"
    && isRecord(firstMachine.states);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

import { dialogueQuestDiagnosticError } from "./diagnostics.js";
import type { UiOverlayState } from "./uiOverlay.js";
import type { WasmNamespace } from "./wasmNamespace.js";
import { guardWasmNamespaceObject, nativeWasmNamespaceObject } from "./wasmNamespaceObject.js";
import {
  describeDialogueQuestFileOwner, liveDialogueQuestFileKind, markDialogueQuestFileOwnerDestroyed,
  registerDialogueFileOwner, registerQuestFileOwner, type NativeFileDialogueQuestOwner,
} from "./dialogueQuestFileOwners.js";
import {
  NativeDialogueSession, NativeQuestLog, decodeDialogueSnapshot, decodeQuestSnapshot,
  dialogueQuestNativeCall, encodeDialogueGraph, encodeDialogueSnapshot, encodeQuestConfig,
  encodeQuestSnapshot, encodeQuestUpdates, immutableDialogueQuestContent, requireDialogueQuestWasm,
} from "./dialogueQuestNative.js";

export type QuestStatus = "inactive" | "active" | "completed";
export type QuestUpdateAction = "start" | "setStage" | "completeObjective" | "complete";

export interface QuestObjectiveSpec {
  text: string;
}

export interface QuestStageSpec {
  title: string;
  objectives?: Readonly<Record<string, QuestObjectiveSpec | string>>;
}

export interface QuestSpec {
  title: string;
  stages?: Readonly<Record<string, QuestStageSpec>>;
}

export interface QuestDocumentSpec {
  quests: Readonly<Record<string, QuestSpec>>;
}

export interface QuestUpdateSpec {
  quest: string;
  action: QuestUpdateAction;
  stage?: string;
  objective?: string;
}

export interface DialogueChoiceSpec {
  id?: string;
  label: string;
  to?: string;
  setFlags?: readonly string[];
  clearFlags?: readonly string[];
  requireFlags?: readonly string[];
  questUpdates?: readonly QuestUpdateSpec[];
}

export interface DialogueNodeSpec {
  speaker?: string;
  text: string;
  choices?: readonly DialogueChoiceSpec[];
  end?: boolean;
  questUpdates?: readonly QuestUpdateSpec[];
}

export interface DialogueGraphSpec {
  initialNode: string;
  nodes: Readonly<Record<string, DialogueNodeSpec>>;
}

export interface ResolveDialogueQuestOptions {
  path?: string;
}

export interface ResolvedQuestObjective {
  id: string;
  text: string;
}

export interface ResolvedQuestStage {
  id: string;
  title: string;
  objectives: readonly ResolvedQuestObjective[];
}

export interface ResolvedQuest {
  id: string;
  title: string;
  stages: readonly ResolvedQuestStage[];
}

export interface ResolvedQuestDocument {
  quests: Readonly<Record<string, ResolvedQuest>>;
}

export interface ResolvedQuestUpdate {
  quest: string;
  action: QuestUpdateAction;
  stage?: string;
  objective?: string;
}

export interface ResolvedDialogueChoice {
  id: string;
  label: string;
  to?: string;
  setFlags: readonly string[];
  clearFlags: readonly string[];
  requireFlags: readonly string[];
  questUpdates: readonly ResolvedQuestUpdate[];
}

export interface ResolvedDialogueNode {
  id: string;
  speaker?: string;
  text: string;
  choices: readonly ResolvedDialogueChoice[];
  end: boolean;
  questUpdates: readonly ResolvedQuestUpdate[];
}

export interface ResolvedDialogueGraph {
  initialNode: string;
  nodes: Readonly<Record<string, ResolvedDialogueNode>>;
}

export interface DialogueSessionSnapshot {
  nodeId: string;
  flags: readonly string[];
  ended: boolean;
}

export interface DialogueChoiceResult {
  choice: ResolvedDialogueChoice;
  node: ResolvedDialogueNode;
  ended: boolean;
}

export interface QuestProgressSnapshot {
  id: string;
  status: QuestStatus;
  stage?: string;
  completedObjectives: readonly string[];
}

export interface QuestLogSnapshot {
  quests: readonly QuestProgressSnapshot[];
}

export interface DialogueQuestStateSnapshot {
  format: "ferrum-dialogue-quest-state";
  version: 1;
  dialogue?: DialogueSessionSnapshot;
  quests?: QuestLogSnapshot;
}

export interface RestoreDialogueQuestStateOptions {
  dialogue?: DialogueSession;
  questLog?: QuestLog;
}

export interface DialogueUiOptions {
  dialogId?: string;
  title?: string;
}

const DIALOGUE_QUEST_STATE_FORMAT = "ferrum-dialogue-quest-state" as const;
const DIALOGUE_QUEST_STATE_VERSION = 1 as const;

export function resolveQuestDocument(
  document: QuestDocumentSpec,
  options: ResolveDialogueQuestOptions = {},
): ResolvedQuestDocument {
  const path = options.path ?? "quests";
  if (!isRecord(document)) {
    throw invalid(path, "must be an object");
  }
  const input = document as QuestDocumentSpec;
  if (!isRecord(input.quests)) {
    throw invalid(`${path}.quests`, "must be an object");
  }
  const quests: Record<string, ResolvedQuest> = Object.fromEntries(Object.entries(input.quests).map(([questId, quest]) => [
    stringKey(questId, `${path}.quests key`), resolveQuest(questId, quest, `${path}.quests.${questId}`),
  ]));
  return { quests };
}

export function resolveDialogueGraph(
  graph: DialogueGraphSpec,
  options: ResolveDialogueQuestOptions = {},
): ResolvedDialogueGraph {
  const path = options.path ?? "dialogue";
  if (!isRecord(graph)) {
    throw invalid(path, "must be an object");
  }
  const input = graph as DialogueGraphSpec;
  const initialNode = stringKey(input.initialNode, `${path}.initialNode`);
  if (!isRecord(input.nodes)) {
    throw invalid(`${path}.nodes`, "must be an object");
  }
  const nodes: Record<string, ResolvedDialogueNode> = Object.fromEntries(Object.entries(input.nodes).map(([nodeId, node]) => [
    stringKey(nodeId, `${path}.nodes key`), resolveDialogueNode(nodeId, node, `${path}.nodes.${nodeId}`),
  ]));
  if (!Object.prototype.hasOwnProperty.call(nodes, initialNode)) {
    throw invalid(`${path}.initialNode`, `references missing node '${initialNode}'`);
  }
  for (const node of Object.values(nodes)) {
    for (const choice of node.choices) {
      if (choice.to !== undefined && !Object.prototype.hasOwnProperty.call(nodes, choice.to)) {
        throw invalid(`${path}.nodes.${node.id}.choices.${choice.id}.to`, `references missing node '${choice.to}'`);
      }
    }
  }
  return { initialNode, nodes };
}

// These maps retain native resource handles for combined restore and linked sessions, never progress.
const questNativeHandles = new WeakMap<QuestLog, NativeQuestLog>();
const dialogueNativeHandles = new WeakMap<DialogueSession, NativeDialogueSession>();
const destroyedDialogueQuestResources = new WeakSet<object>();
// Only the file factories can pass pre-restored native objects to the constructors.
const fileRestoreToken = Symbol("dialogue quest file restore");
interface FileRestore<Handle> {
  readonly native: Handle | undefined;
  readonly savedOrigin?: readonly [number, number];
}
export type { NativeFileDialogueQuestOwner } from "./dialogueQuestFileOwners.js";

export class QuestLog {
  private readonly document: ResolvedQuestDocument;
  private readonly native: NativeQuestLog | undefined;

  constructor(document: QuestDocumentSpec | ResolvedQuestDocument);
  constructor(
    document: QuestDocumentSpec | ResolvedQuestDocument,
    token: typeof fileRestoreToken | undefined = undefined,
    restored?: FileRestore<NativeQuestLog>,
  ) {
    const file = token === fileRestoreToken ? restored : undefined;
    if (file) {
      this.document = document as ResolvedQuestDocument;
      this.native = file.native;
    } else {
      this.document = immutableDialogueQuestContent(isResolvedQuestDocument(document) ? document : resolveQuestDocument(document));
      requireDialogueQuestWasm();
      this.native = dialogueQuestNativeCall(() => new NativeQuestLog(encodeQuestConfig(this.document)));
    }
    if (this.native) questNativeHandles.set(this, this.native);
    else destroyedDialogueQuestResources.add(this);
    registerQuestFileOwner(this, this.document, file?.savedOrigin, !this.native);
  }

  static create(document: QuestDocumentSpec | ResolvedQuestDocument): QuestLog {
    return new QuestLog(document);
  }

  apply(update: QuestUpdateSpec | ResolvedQuestUpdate): QuestProgressSnapshot {
    return this.applyAll([update])[0];
  }

  applyAll(updates: readonly (QuestUpdateSpec | ResolvedQuestUpdate)[]): readonly QuestProgressSnapshot[] {
    requireLiveDialogueQuestResource(this);
    const packet = encodeQuestUpdates(updates.map(update => resolveQuestUpdate(update, "questUpdate")));
    const native = this.liveNative();
    return decodeQuestSnapshot(dialogueQuestNativeCall(() => native.apply(packet))).quests;
  }

  snapshot(): QuestLogSnapshot {
    const native = this.liveNative();
    return decodeQuestSnapshot(dialogueQuestNativeCall(() => native.snapshot()));
  }

  restore(snapshot: QuestLogSnapshot): void {
    requireLiveDialogueQuestResource(this);
    const packet = encodeQuestSnapshot(snapshot);
    const native = this.liveNative();
    dialogueQuestNativeCall(() => native.restore(packet));
  }

  destroy(): void {
    if (destroyedDialogueQuestResources.has(this)) return;
    destroyedDialogueQuestResources.add(this);
    questNativeHandles.delete(this);
    markDialogueQuestFileOwnerDestroyed(this);
    this.native?.free();
  }

  private liveNative(): NativeQuestLog {
    requireLiveDialogueQuestResource(this);
    if (!this.native) throw invalid("dialogueQuest.lifecycle", "dialogue/quest native resource is unavailable");
    return this.native;
  }
}

export class DialogueSession {
  private readonly graph: ResolvedDialogueGraph;
  private readonly native: NativeDialogueSession | undefined;

  constructor(graph: DialogueGraphSpec | ResolvedDialogueGraph, questLog?: QuestLog);
  constructor(
    graph: DialogueGraphSpec | ResolvedDialogueGraph,
    questLog?: QuestLog,
    token: typeof fileRestoreToken | undefined = undefined,
    restored?: FileRestore<NativeDialogueSession>,
  ) {
    const file = token === fileRestoreToken ? restored : undefined;
    if (file) {
      this.graph = graph as ResolvedDialogueGraph;
      this.native = file.native;
    } else {
      this.graph = immutableDialogueQuestContent(isResolvedDialogueGraph(graph) ? graph : resolveDialogueGraph(graph));
      requireDialogueQuestWasm();
      const packet = encodeDialogueGraph(this.graph);
      const quests = questLog === undefined ? undefined : requireDialogueQuestHandle(questLog, questNativeHandles);
      this.native = dialogueQuestNativeCall(() => quests === undefined
        ? new NativeDialogueSession(packet)
        : NativeDialogueSession.with_quests(packet, quests));
    }
    if (this.native) dialogueNativeHandles.set(this, this.native);
    else destroyedDialogueQuestResources.add(this);
    registerDialogueFileOwner(this, this.graph, file?.savedOrigin, !this.native, this.native ? questLog : undefined);
  }

  static create(graph: DialogueGraphSpec | ResolvedDialogueGraph, questLog?: QuestLog): DialogueSession {
    return new DialogueSession(graph, questLog);
  }

  currentNode(): ResolvedDialogueNode {
    const native = this.liveNative();
    return Object.values(this.graph.nodes)[dialogueQuestNativeCall(() => native.current_node())];
  }

  availableChoices(): readonly ResolvedDialogueChoice[] {
    const node = this.currentNode();
    const native = this.liveNative();
    return Array.from(dialogueQuestNativeCall(() => native.available_choices()), index => node.choices[index]);
  }

  choose(choiceId: string): DialogueChoiceResult {
    const node = this.currentNode();
    const native = this.liveNative();
    const available = dialogueQuestNativeCall(() => native.available_choices());
    const index = Array.from(available).find(candidate => node.choices[candidate].id === choiceId);
    if (index === undefined) {
      if (this.snapshot().ended) throw invalid("dialogue.choice", "cannot choose after dialogue ended");
      throw invalid("dialogue.choice", `unknown or unavailable choice '${choiceId}'`);
    }
    dialogueQuestNativeCall(() => native.choose(index));
    return { choice: node.choices[index], node: this.currentNode(), ended: this.snapshot().ended };
  }

  snapshot(): DialogueSessionSnapshot {
    const native = this.liveNative();
    return decodeDialogueSnapshot(dialogueQuestNativeCall(() => native.snapshot()));
  }

  restore(snapshot: DialogueSessionSnapshot): void {
    requireLiveDialogueQuestResource(this);
    const packet = encodeDialogueSnapshot(snapshot);
    const native = this.liveNative();
    dialogueQuestNativeCall(() => native.restore(packet));
  }

  destroy(): void {
    if (destroyedDialogueQuestResources.has(this)) return;
    destroyedDialogueQuestResources.add(this);
    dialogueNativeHandles.delete(this);
    markDialogueQuestFileOwnerDestroyed(this);
    this.native?.free();
  }

  private liveNative(): NativeDialogueSession {
    requireLiveDialogueQuestResource(this);
    if (!this.native) throw invalid("dialogueQuest.lifecycle", "dialogue/quest native resource is unavailable");
    return this.native;
  }
}

/** @internal Constructor proof only; this export is absent from public barrels.
 * Borrowed records are module-owned and are never supplied by file metadata. */
export function nativeFileDialogueQuestOwner(value: object): Readonly<NativeFileDialogueQuestOwner> | undefined {
  return describeDialogueQuestFileOwner(value);
}

/** @internal The actual wrapper must be alive. Linked quest progress comes from
 * the dialogue's Rust Rc, even after the public QuestLog wrapper was destroyed. */
export function nativeFileDialogueQuestPacket(value: object, expected: Uint8Array): Uint8Array {
  const kind = liveDialogueQuestFileKind(value);
  if (!kind) throw invalid("dialogueQuest.file", "native owner is absent");
  return kind === "quest"
    ? requireDialogueQuestHandle(value as QuestLog, questNativeHandles).file_state_packet(expected)
    : requireDialogueQuestHandle(value as DialogueSession, dialogueNativeHandles).file_state_packet(expected);
}

/** @internal A new detached graph owns its own native objects. Packets/content
 * have already passed the bounded file owner validation, never caller snapshots.
 * Dead wrappers are metadata-only; no default native progress is invented. */
export function nativeFileCreateQuest(content: ResolvedQuestDocument, config: Uint8Array | undefined, progress: Uint8Array | undefined, savedOrigin?: readonly [number, number], targetNamespace?: WasmNamespace): QuestLog {
  const native = config === undefined ? undefined : targetNamespace !== undefined
    ? targetNamespace.call(bindings => guardWasmNamespaceObject(targetNamespace, new bindings.NativeQuestLog(config)))
    : new NativeQuestLog(config);
  try {
    if (native && progress) native.restore(progress);
    const restored: FileRestore<NativeQuestLog> = { native, savedOrigin };
    return Reflect.construct(QuestLog, [content, fileRestoreToken, restored]) as QuestLog;
  } catch (error) { native?.free(); throw error; }
}

/** @internal No initial quest updates are replayed by the cold linked constructor. */
export function nativeFileCreateDialogue(content: ResolvedDialogueGraph, config: Uint8Array | undefined, progress: Uint8Array | undefined, quest?: QuestLog, savedOrigin?: readonly [number, number], targetNamespace?: WasmNamespace): DialogueSession {
  let native: NativeDialogueSession | undefined;
  try {
    if (config) {
      if (targetNamespace !== undefined) {
        // Cold linked construction requires a live raw object from this exact
        // namespace. Generated prototypes or same-value progress are not proof.
        const quests = quest === undefined ? undefined : nativeWasmNamespaceObject(targetNamespace, requireDialogueQuestHandle(quest, questNativeHandles));
        native = targetNamespace.call(bindings => guardWasmNamespaceObject(targetNamespace,
          quests === undefined ? new bindings.NativeDialogueSession(config)
            : bindings.NativeDialogueSession.file_with_quests(config, progress!, quests)));
        if (quests === undefined) native.restore(progress!);
      } else if (quest) native = NativeDialogueSession.file_with_quests(config, progress!, requireDialogueQuestHandle(quest, questNativeHandles));
      else { native = new NativeDialogueSession(config); native.restore(progress!); }
    }
    const restored: FileRestore<NativeDialogueSession> = { native, savedOrigin };
    return Reflect.construct(DialogueSession, [content, quest, fileRestoreToken, restored]) as DialogueSession;
  } catch (error) { native?.free(); throw error; }
}

function requireLiveDialogueQuestResource(resource: object): void {
  if (destroyedDialogueQuestResources.has(resource)) throw invalid("dialogueQuest.lifecycle", "cannot use a destroyed dialogue/quest resource");
}

function requireDialogueQuestHandle<R extends object, N>(resource: R, handles: WeakMap<R, N>): N {
  requireLiveDialogueQuestResource(resource);
  const native = handles.get(resource);
  if (native === undefined) throw invalid("dialogueQuest.lifecycle", "dialogue/quest native resource is unavailable");
  return native;
}

export function dialogueNodeToUiOverlayState(
  session: DialogueSession,
  options: DialogueUiOptions = {},
): UiOverlayState {
  const node = session.currentNode();
  return {
    dialog: {
      id: options.dialogId ?? node.id,
      title: options.title ?? node.speaker ?? "Dialogue",
      body: node.text,
      actions: session.availableChoices().map((choice) => ({
        id: choice.id,
        label: choice.label,
      })),
    },
  };
}

export function captureDialogueQuestState(
  dialogue?: DialogueSession,
  questLog?: QuestLog,
): DialogueQuestStateSnapshot {
  return {
    format: DIALOGUE_QUEST_STATE_FORMAT,
    version: DIALOGUE_QUEST_STATE_VERSION,
    ...(dialogue === undefined ? {} : { dialogue: dialogue.snapshot() }),
    ...(questLog === undefined ? {} : { quests: questLog.snapshot() }),
  };
}

export function restoreDialogueQuestState(
  snapshot: DialogueQuestStateSnapshot,
  options: RestoreDialogueQuestStateOptions,
): void {
  if (!isRecord(snapshot) || snapshot.format !== DIALOGUE_QUEST_STATE_FORMAT || snapshot.version !== DIALOGUE_QUEST_STATE_VERSION) {
    throw invalid("dialogueQuestState", "unsupported snapshot format or version");
  }
  const dialogueSnapshot = snapshot.dialogue;
  const questSnapshot = snapshot.quests;
  const dialogue = dialogueSnapshot === undefined ? undefined : options.dialogue;
  const quests = questSnapshot === undefined ? undefined : options.questLog;
  if (dialogue !== undefined) requireLiveDialogueQuestResource(dialogue);
  if (quests !== undefined) requireLiveDialogueQuestResource(quests);
  // Input getters can dispose a resource. Finish encoding, then acquire both live handles before any commit.
  const dialoguePacket = dialogue !== undefined ? encodeDialogueSnapshot(dialogueSnapshot!) : undefined;
  const questPacket = quests !== undefined ? encodeQuestSnapshot(questSnapshot!) : undefined;
  const dialogueNative = dialogue !== undefined ? requireDialogueQuestHandle(dialogue, dialogueNativeHandles) : undefined;
  const questNative = quests !== undefined ? requireDialogueQuestHandle(quests, questNativeHandles) : undefined;
  dialogueQuestNativeCall(() => {
    if (dialogueNative && dialoguePacket) dialogueNative.validate_restore(dialoguePacket);
    if (questNative && questPacket) questNative.validate_restore(questPacket);
    if (dialogueNative && dialoguePacket) dialogueNative.restore(dialoguePacket);
    if (questNative && questPacket) questNative.restore(questPacket);
  });
}

function resolveQuest(id: string, quest: QuestSpec, path: string): ResolvedQuest {
  if (!isRecord(quest)) {
    throw invalid(path, "must be an object");
  }
  const input = quest as QuestSpec;
  return {
    id,
    title: stringKey(input.title, `${path}.title`),
    stages: resolveQuestStages(input.stages, `${path}.stages`),
  };
}

function resolveQuestStages(
  stages: Readonly<Record<string, QuestStageSpec>> | undefined,
  path: string,
): readonly ResolvedQuestStage[] {
  if (stages === undefined) {
    return [];
  }
  if (!isRecord(stages)) {
    throw invalid(path, "must be an object");
  }
  return Object.entries(stages).map(([stageId, stage]) => {
    if (!isRecord(stage)) {
      throw invalid(`${path}.${stageId}`, "must be an object");
    }
    const input = stage as QuestStageSpec;
    return {
      id: stringKey(stageId, `${path} key`),
      title: stringKey(input.title, `${path}.${stageId}.title`),
      objectives: resolveObjectives(input.objectives, `${path}.${stageId}.objectives`),
    };
  });
}

function resolveObjectives(
  objectives: Readonly<Record<string, QuestObjectiveSpec | string>> | undefined,
  path: string,
): readonly ResolvedQuestObjective[] {
  if (objectives === undefined) {
    return [];
  }
  if (!isRecord(objectives)) {
    throw invalid(path, "must be an object");
  }
  return Object.entries(objectives).map(([objectiveId, objective]) => {
    if (typeof objective === "string") {
      return { id: objectiveId, text: objective };
    }
    if (!isRecord(objective)) {
      throw invalid(`${path}.${objectiveId}`, "must be a string or object");
    }
    const input = objective as QuestObjectiveSpec;
    return { id: objectiveId, text: stringKey(input.text, `${path}.${objectiveId}.text`) };
  });
}

function resolveDialogueNode(id: string, node: DialogueNodeSpec, path: string): ResolvedDialogueNode {
  if (!isRecord(node)) {
    throw invalid(path, "must be an object");
  }
  const input = node as DialogueNodeSpec;
  return {
    id,
    ...(input.speaker === undefined ? {} : { speaker: stringKey(input.speaker, `${path}.speaker`) }),
    text: stringKey(input.text, `${path}.text`),
    choices: (input.choices ?? []).map((choice, index) => resolveChoice(choice, `${path}.choices.${index}`, index)),
    end: input.end ?? false,
    questUpdates: (input.questUpdates ?? []).map((update, index) => resolveQuestUpdate(update, `${path}.questUpdates.${index}`)),
  };
}

function resolveChoice(choice: DialogueChoiceSpec, path: string, index: number): ResolvedDialogueChoice {
  if (!isRecord(choice)) {
    throw invalid(path, "must be an object");
  }
  const input = choice as DialogueChoiceSpec;
  return {
    id: input.id === undefined ? String(index) : stringKey(input.id, `${path}.id`),
    label: stringKey(input.label, `${path}.label`),
    ...(input.to === undefined ? {} : { to: stringKey(input.to, `${path}.to`) }),
    setFlags: flags(input.setFlags, `${path}.setFlags`),
    clearFlags: flags(input.clearFlags, `${path}.clearFlags`),
    requireFlags: flags(input.requireFlags, `${path}.requireFlags`),
    questUpdates: (input.questUpdates ?? []).map((update, updateIndex) => resolveQuestUpdate(update, `${path}.questUpdates.${updateIndex}`)),
  };
}

function resolveQuestUpdate(update: QuestUpdateSpec | ResolvedQuestUpdate, path: string): ResolvedQuestUpdate {
  if (!isRecord(update)) {
    throw invalid(path, "must be an object");
  }
  const input = update as QuestUpdateSpec;
  const action = input.action;
  if (action !== "start" && action !== "setStage" && action !== "completeObjective" && action !== "complete") {
    throw invalid(`${path}.action`, "must be start, setStage, completeObjective, or complete");
  }
  return {
    quest: stringKey(input.quest, `${path}.quest`),
    action,
    ...(input.stage === undefined ? {} : { stage: stringKey(input.stage, `${path}.stage`) }),
    ...(input.objective === undefined ? {} : { objective: stringKey(input.objective, `${path}.objective`) }),
  };
}

function flags(input: readonly string[] | undefined, path: string): readonly string[] {
  return (input ?? []).map((flag, index) => stringKey(flag, `${path}.${index}`));
}

function isResolvedQuestDocument(value: unknown): value is ResolvedQuestDocument {
  return isRecord(value)
    && isRecord(value.quests)
    && Object.values(value.quests).every((quest) => (
      isRecord(quest)
      && typeof quest.id === "string"
      && typeof quest.title === "string"
      && Array.isArray(quest.stages)
      && quest.stages.every((stage) => (
        isRecord(stage)
        && typeof stage.id === "string"
        && typeof stage.title === "string"
        && Array.isArray(stage.objectives)
        && stage.objectives.every((objective) => (
          isRecord(objective)
          && typeof objective.id === "string"
          && typeof objective.text === "string"
        ))
      ))
    ));
}

function isResolvedDialogueGraph(value: unknown): value is ResolvedDialogueGraph {
  return isRecord(value)
    && typeof value.initialNode === "string"
    && isRecord(value.nodes)
    && Object.values(value.nodes).every((node) => (
      isRecord(node)
      && typeof node.id === "string"
      && typeof node.text === "string"
      && typeof node.end === "boolean"
      && Array.isArray(node.questUpdates)
      && node.questUpdates.every(isResolvedQuestUpdate)
      && Array.isArray(node.choices)
      && node.choices.every((choice) => (
        isRecord(choice)
        && typeof choice.id === "string"
        && typeof choice.label === "string"
        && Array.isArray(choice.setFlags)
        && Array.isArray(choice.clearFlags)
        && Array.isArray(choice.requireFlags)
        && Array.isArray(choice.questUpdates)
        && choice.questUpdates.every(isResolvedQuestUpdate)
      ))
    ));
}

function isResolvedQuestUpdate(value: unknown): value is ResolvedQuestUpdate {
  return isRecord(value)
    && typeof value.quest === "string"
    && (value.action === "start"
      || value.action === "setStage"
      || value.action === "completeObjective"
      || value.action === "complete");
}

function stringKey(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, "must be a non-empty string");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(path: string, detail: string): Error {
  return dialogueQuestDiagnosticError(path, detail);
}

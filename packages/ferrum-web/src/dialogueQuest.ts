import { dialogueQuestDiagnosticError } from "./diagnostics.js";
import type { UiOverlayState } from "./uiOverlay.js";

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
  const quests: Record<string, ResolvedQuest> = {};
  for (const [questId, quest] of Object.entries(input.quests)) {
    quests[stringKey(questId, `${path}.quests key`)] = resolveQuest(questId, quest, `${path}.quests.${questId}`);
  }
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
  const nodes: Record<string, ResolvedDialogueNode> = {};
  for (const [nodeId, node] of Object.entries(input.nodes)) {
    nodes[stringKey(nodeId, `${path}.nodes key`)] = resolveDialogueNode(nodeId, node, `${path}.nodes.${nodeId}`);
  }
  if (nodes[initialNode] === undefined) {
    throw invalid(`${path}.initialNode`, `references missing node '${initialNode}'`);
  }
  for (const node of Object.values(nodes)) {
    for (const choice of node.choices) {
      if (choice.to !== undefined && nodes[choice.to] === undefined) {
        throw invalid(`${path}.nodes.${node.id}.choices.${choice.id}.to`, `references missing node '${choice.to}'`);
      }
    }
  }
  return { initialNode, nodes };
}

export class QuestLog {
  private readonly document: ResolvedQuestDocument;
  private readonly progress = new Map<string, QuestProgressSnapshot>();

  constructor(document: QuestDocumentSpec | ResolvedQuestDocument) {
    this.document = isResolvedQuestDocument(document) ? document : resolveQuestDocument(document);
  }

  static create(document: QuestDocumentSpec | ResolvedQuestDocument): QuestLog {
    return new QuestLog(document);
  }

  apply(update: QuestUpdateSpec | ResolvedQuestUpdate): QuestProgressSnapshot {
    const resolved = resolveQuestUpdate(update, "questUpdate");
    const quest = this.document.quests[resolved.quest];
    if (quest === undefined) {
      throw invalid("questUpdate.quest", `references missing quest '${resolved.quest}'`);
    }
    const current = this.progress.get(quest.id) ?? inactiveQuestProgress(quest);
    let next: QuestProgressSnapshot;
    if (resolved.action === "start") {
      next = { ...current, status: "active", stage: resolved.stage ?? current.stage ?? quest.stages[0]?.id };
    } else if (resolved.action === "setStage") {
      const stage = requiredStage(quest, resolved.stage, "questUpdate.stage");
      next = { ...current, status: "active", stage };
    } else if (resolved.action === "completeObjective") {
      const objective = stringKey(resolved.objective, "questUpdate.objective");
      const completedObjectives = current.completedObjectives.includes(objective)
        ? current.completedObjectives
        : [...current.completedObjectives, objective];
      next = { ...current, status: "active", completedObjectives };
    } else {
      next = { ...current, status: "completed" };
    }
    this.progress.set(quest.id, next);
    return { ...next, completedObjectives: [...next.completedObjectives] };
  }

  applyAll(updates: readonly (QuestUpdateSpec | ResolvedQuestUpdate)[]): readonly QuestProgressSnapshot[] {
    return updates.map((update) => this.apply(update));
  }

  snapshot(): QuestLogSnapshot {
    return {
      quests: Object.keys(this.document.quests).map((questId) => (
        this.progress.get(questId) ?? inactiveQuestProgress(this.document.quests[questId])
      )),
    };
  }

  restore(snapshot: QuestLogSnapshot): void {
    this.progress.clear();
    for (const quest of snapshot.quests) {
      if (this.document.quests[quest.id] === undefined) {
        continue;
      }
      this.progress.set(quest.id, {
        id: quest.id,
        status: quest.status,
        ...(quest.stage === undefined ? {} : { stage: quest.stage }),
        completedObjectives: [...quest.completedObjectives],
      });
    }
  }
}

export class DialogueSession {
  private readonly graph: ResolvedDialogueGraph;
  private nodeId: string;
  private readonly flags = new Set<string>();
  private ended = false;

  constructor(graph: DialogueGraphSpec | ResolvedDialogueGraph, private readonly questLog?: QuestLog) {
    this.graph = isResolvedDialogueGraph(graph) ? graph : resolveDialogueGraph(graph);
    this.nodeId = this.graph.initialNode;
    this.applyNodeUpdates(this.currentNode());
  }

  static create(graph: DialogueGraphSpec | ResolvedDialogueGraph, questLog?: QuestLog): DialogueSession {
    return new DialogueSession(graph, questLog);
  }

  currentNode(): ResolvedDialogueNode {
    return this.graph.nodes[this.nodeId];
  }

  availableChoices(): readonly ResolvedDialogueChoice[] {
    return this.currentNode().choices.filter((choice) => choice.requireFlags.every((flag) => this.flags.has(flag)));
  }

  choose(choiceId: string): DialogueChoiceResult {
    if (this.ended) {
      throw invalid("dialogue.choice", "cannot choose after dialogue ended");
    }
    const choice = this.availableChoices().find((candidate) => candidate.id === choiceId);
    if (choice === undefined) {
      throw invalid("dialogue.choice", `unknown or unavailable choice '${choiceId}'`);
    }
    for (const flag of choice.setFlags) {
      this.flags.add(flag);
    }
    for (const flag of choice.clearFlags) {
      this.flags.delete(flag);
    }
    this.questLog?.applyAll(choice.questUpdates);
    if (choice.to !== undefined) {
      this.nodeId = choice.to;
      this.applyNodeUpdates(this.currentNode());
    } else {
      this.ended = true;
    }
    const node = this.currentNode();
    this.ended = this.ended || node.end;
    return { choice, node, ended: this.ended };
  }

  snapshot(): DialogueSessionSnapshot {
    return {
      nodeId: this.nodeId,
      flags: [...this.flags].sort(),
      ended: this.ended,
    };
  }

  restore(snapshot: DialogueSessionSnapshot): void {
    if (this.graph.nodes[snapshot.nodeId] === undefined) {
      throw invalid("dialogue.snapshot.nodeId", `references missing node '${snapshot.nodeId}'`);
    }
    this.nodeId = snapshot.nodeId;
    this.flags.clear();
    for (const flag of snapshot.flags) {
      this.flags.add(stringKey(flag, "dialogue.snapshot.flags"));
    }
    this.ended = snapshot.ended;
  }

  private applyNodeUpdates(node: ResolvedDialogueNode): void {
    this.questLog?.applyAll(node.questUpdates);
  }
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
  if (snapshot.format !== DIALOGUE_QUEST_STATE_FORMAT || snapshot.version !== DIALOGUE_QUEST_STATE_VERSION) {
    throw invalid("dialogueQuestState", "unsupported snapshot format or version");
  }
  if (snapshot.dialogue !== undefined) {
    options.dialogue?.restore(snapshot.dialogue);
  }
  if (snapshot.quests !== undefined) {
    options.questLog?.restore(snapshot.quests);
  }
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

function inactiveQuestProgress(quest: ResolvedQuest): QuestProgressSnapshot {
  return {
    id: quest.id,
    status: "inactive",
    ...(quest.stages[0] === undefined ? {} : { stage: quest.stages[0].id }),
    completedObjectives: [],
  };
}

function requiredStage(quest: ResolvedQuest, stage: string | undefined, path: string): string {
  const stageId = stringKey(stage, path);
  if (!quest.stages.some((candidate) => candidate.id === stageId)) {
    throw invalid(path, `references missing stage '${stageId}'`);
  }
  return stageId;
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

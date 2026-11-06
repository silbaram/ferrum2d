import { NativeDialogueSession, NativeQuestLog, wasm_memory } from "../pkg/ferrum_core.js";
import { dialogueQuestDiagnosticError } from "./diagnostics.js";
import type {
  DialogueSessionSnapshot, QuestLogSnapshot, QuestProgressSnapshot, ResolvedDialogueGraph,
  ResolvedQuestDocument, ResolvedQuestUpdate,
} from "./dialogueQuest.js";

export { NativeDialogueSession, NativeQuestLog };
const MAX_PACKET_BYTES = 16 * 1024 * 1024;
const MAX_ITEMS = 65_536;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const statuses = ["inactive", "active", "completed"] as const;
const actions = ["start", "setStage", "completeObjective", "complete"] as const;

export function requireDialogueQuestWasm(): void {
  try { wasm_memory(); }
  catch { throw dialogueQuestDiagnosticError("dialogueQuest.initialization", "await initializeFerrumWasm() or createEngine() before constructing QuestLog or DialogueSession"); }
}

export function dialogueQuestNativeCall<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const separator = message.indexOf("|");
    throw dialogueQuestDiagnosticError(separator < 0 ? "dialogueQuest.native" : message.slice(0, separator),
      separator < 0 ? message : message.slice(separator + 1));
  }
}

export function encodeQuestConfig(document: ResolvedQuestDocument): Uint8Array {
  const w = new Writer();
  const quests = Object.values(document.quests);
  w.count(quests.length);
  for (const quest of quests) {
    w.string(quest.id); w.strings(quest.stages.map(stage => stage.id));
  }
  return w.finish();
}

export function encodeDialogueGraph(graph: ResolvedDialogueGraph): Uint8Array {
  const w = new Writer(), nodes = Object.values(graph.nodes);
  const indexes = new Map(nodes.map((node, index) => [node.id, index]));
  const initial = indexes.get(graph.initialNode);
  if (initial === undefined) throw invalid("dialogue.initialNode", `references missing node '${graph.initialNode}'`);
  w.u32(initial); w.count(nodes.length);
  for (const node of nodes) {
    w.string(node.id); w.boolean(node.end); w.updates(node.questUpdates); w.count(node.choices.length);
    for (const choice of node.choices) {
      const to = choice.to === undefined ? 0xffffffff : indexes.get(choice.to);
      if (to === undefined) throw invalid(`dialogue.nodes.${node.id}.choices.${choice.id}.to`, `references missing node '${choice.to}'`);
      w.u32(to); w.strings(choice.setFlags); w.strings(choice.clearFlags); w.strings(choice.requireFlags); w.updates(choice.questUpdates);
    }
  }
  return w.finish();
}

export function encodeQuestUpdates(updates: readonly ResolvedQuestUpdate[]): Uint8Array {
  const w = new Writer(); w.updates(updates); return w.finish();
}

export function encodeQuestSnapshot(snapshot: QuestLogSnapshot): Uint8Array {
  if (!snapshot || !Array.isArray(snapshot.quests)) throw invalid("quests.snapshot.quests", "must be an array");
  const w = new Writer(); w.count(snapshot.quests.length);
  for (const quest of snapshot.quests) {
    if (!quest || typeof quest !== "object") throw invalid("quests.snapshot.quests", "must contain quest progress objects");
    const status = statuses.indexOf(quest.status);
    if (status < 0) throw invalid("quests.snapshot.status", "must be inactive, active, or completed");
    w.string(quest.id); w.u32(status); w.optional(quest.stage); w.strings(quest.completedObjectives);
  }
  return w.finish();
}

export function decodeQuestSnapshot(packet: Uint8Array): QuestLogSnapshot {
  const r = new Reader(packet), quests: QuestProgressSnapshot[] = [];
  for (let count = r.count(); count > 0; count--) {
    const id = r.string(), status = statuses[r.u32()], stage = r.optional(), completedObjectives = r.strings();
    if (status === undefined) throw invalid("dialogueQuest.native", "invalid quest status");
    quests.push({ id, status, ...(stage === undefined ? {} : { stage }), completedObjectives });
  }
  r.finish(); return { quests };
}

export function encodeDialogueSnapshot(snapshot: DialogueSessionSnapshot): Uint8Array {
  if (!snapshot || typeof snapshot !== "object") throw invalid("dialogue.snapshot", "must be an object");
  const w = new Writer(); w.string(snapshot.nodeId); w.strings(snapshot.flags); w.boolean(snapshot.ended); return w.finish();
}

export function decodeDialogueSnapshot(packet: Uint8Array): DialogueSessionSnapshot {
  const r = new Reader(packet), nodeId = r.string(), flags = r.strings().sort(), ended = r.boolean();
  r.finish(); return { nodeId, flags, ended };
}

/** A detached content copy prevents later caller mutations from diverging from native configuration. */
export function immutableDialogueQuestContent<T>(content: T): T {
  const clone = structuredClone(content);
  const visited = new WeakSet<object>();
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object" && !visited.has(value)) {
      visited.add(value);
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(clone); return clone;
}

class Writer {
  private readonly parts: Uint8Array[] = [];
  private size = 0;
  constructor() { this.u32(1); }
  u32(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw invalid("dialogueQuest.native", "invalid unsigned integer");
    const part = new Uint8Array(4); new DataView(part.buffer).setUint32(0, value, true); this.push(part);
  }
  count(value: number): void {
    if (value > MAX_ITEMS) throw invalid("dialogueQuest.native", "list exceeds 65536 entries");
    this.u32(value);
  }
  boolean(value: boolean): void {
    if (typeof value !== "boolean") throw invalid("dialogue.snapshot.ended", "must be a boolean");
    this.u32(value ? 1 : 0);
  }
  string(value: string): void {
    if (typeof value !== "string" || !value.trim()) throw invalid("dialogueQuest.native", "expected a non-empty string");
    if (value.length > MAX_PACKET_BYTES) throw invalid("dialogueQuest.native", "string exceeds 16 MiB");
    const bytes = encoder.encode(value);
    if (decoder.decode(bytes) !== value) throw invalid("dialogueQuest.native", "strings must contain valid Unicode");
    this.u32(bytes.length); this.push(bytes);
  }
  optional(value: string | undefined): void { this.u32(value === undefined ? 0 : 1); if (value !== undefined) this.string(value); }
  strings(values: readonly string[]): void {
    if (!Array.isArray(values)) throw invalid("dialogueQuest.native", "expected an array of strings");
    this.count(values.length); for (const value of values) this.string(value);
  }
  updates(updates: readonly ResolvedQuestUpdate[]): void {
    this.count(updates.length);
    for (const update of updates) {
      const action = actions.indexOf(update.action);
      if (action < 0) throw invalid("questUpdate.action", "must be start, setStage, completeObjective, or complete");
      this.string(update.quest); this.u32(action); this.optional(update.stage); this.optional(update.objective);
    }
  }
  finish(): Uint8Array {
    const packet = new Uint8Array(this.size); let offset = 0;
    for (const part of this.parts) { packet.set(part, offset); offset += part.length; }
    return packet;
  }
  private push(part: Uint8Array): void {
    if (this.size + part.length > MAX_PACKET_BYTES) throw invalid("dialogueQuest.native", "packet exceeds 16 MiB");
    this.parts.push(part); this.size += part.length;
  }
}

class Reader {
  private offset = 0;
  constructor(private readonly packet: Uint8Array) {
    if (packet.length > MAX_PACKET_BYTES || this.u32() !== 1) throw invalid("dialogueQuest.native", "invalid native packet");
  }
  u32(): number {
    if (this.offset + 4 > this.packet.length) throw invalid("dialogueQuest.native", "truncated native packet");
    const value = new DataView(this.packet.buffer, this.packet.byteOffset + this.offset, 4).getUint32(0, true); this.offset += 4; return value;
  }
  count(): number {
    const value = this.u32();
    if (value > MAX_ITEMS || value > (this.packet.length - this.offset) / 4) throw invalid("dialogueQuest.native", "invalid native count");
    return value;
  }
  string(): string {
    const length = this.u32();
    if (this.offset + length > this.packet.length) throw invalid("dialogueQuest.native", "truncated native string");
    const value = decoder.decode(this.packet.subarray(this.offset, this.offset + length)); this.offset += length; return value;
  }
  boolean(): boolean { const value = this.u32(); if (value > 1) throw invalid("dialogueQuest.native", "invalid native boolean"); return value === 1; }
  optional(): string | undefined { return this.boolean() ? this.string() : undefined; }
  strings(): string[] { return Array.from({ length: this.count() }, () => this.string()); }
  finish(): void { if (this.offset !== this.packet.length) throw invalid("dialogueQuest.native", "unexpected native packet data"); }
}
function invalid(path: string, detail: string): Error { return dialogueQuestDiagnosticError(path, detail); }

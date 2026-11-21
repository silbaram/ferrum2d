import type { DialogueSession, QuestLog, ResolvedDialogueGraph, ResolvedQuestDocument } from "./dialogueQuest.js";

type SavedOrigin = readonly [number, number] | undefined;

interface FileOwner {
  readonly token: object;
  readonly savedOrigin: SavedOrigin;
  destroyed: boolean;
}

interface FileQuestOwner extends FileOwner {
  readonly kind: "quest";
  readonly content: ResolvedQuestDocument;
}

interface FileDialogueOwner extends FileOwner {
  readonly kind: "dialogue";
  readonly content: ResolvedDialogueGraph;
  quest?: FileQuestOwner;
}

export type NativeFileDialogueQuestOwner = FileQuestOwner | FileDialogueOwner;

// The file adapter records wrapper identity, authoring metadata and lifetime.
// Progress packets and linked quest state are read from Rust when saving.
const owners = new WeakMap<object, NativeFileDialogueQuestOwner>();

export function registerQuestFileOwner(
  wrapper: QuestLog, content: ResolvedQuestDocument, savedOrigin: SavedOrigin, destroyed: boolean,
): void {
  owners.set(wrapper, { kind: "quest", token: Object.freeze({}), content, savedOrigin, destroyed });
}

export function registerDialogueFileOwner(
  wrapper: DialogueSession, content: ResolvedDialogueGraph, savedOrigin: SavedOrigin, destroyed: boolean, questLog?: QuestLog,
): void {
  const quest = questLog === undefined ? undefined : owners.get(questLog);
  owners.set(wrapper, { kind: "dialogue", token: Object.freeze({}), content, savedOrigin, destroyed,
    ...(quest?.kind === "quest" ? { quest } : {}) });
}

export function markDialogueQuestFileOwnerDestroyed(wrapper: QuestLog | DialogueSession): void {
  const owner = owners.get(wrapper);
  if (!owner) return;
  owner.destroyed = true;
  if (owner.kind === "dialogue") delete owner.quest;
}

export function describeDialogueQuestFileOwner(wrapper: object): Readonly<NativeFileDialogueQuestOwner> | undefined {
  const owner = owners.get(wrapper);
  if (!owner) return undefined;
  return Object.freeze({ ...owner, ...(owner.kind === "dialogue" && owner.quest ? { quest: Object.freeze({ ...owner.quest }) } : {}) });
}

export function liveDialogueQuestFileKind(wrapper: object): NativeFileDialogueQuestOwner["kind"] | undefined {
  const owner = owners.get(wrapper);
  return owner?.destroyed ? undefined : owner?.kind;
}

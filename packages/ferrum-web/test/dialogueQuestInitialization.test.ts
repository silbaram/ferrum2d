import { ok } from "node:assert/strict";
import { test } from "node:test";
import { DialogueSession, QuestLog, resolveDialogueGraph, resolveQuestDocument } from "../src/dialogueQuest.js";

test("dialogue and quest constructors diagnose use before Wasm initialization", () => {
  const quests = resolveQuestDocument({ quests: {} });
  const graph = resolveDialogueGraph({ initialNode: "start", nodes: { start: { text: "Start" } } });
  for (const construct of [() => new QuestLog(quests), () => new DialogueSession(graph)]) {
    let caught = false;
    try { construct(); }
    catch (error) {
      caught = true;
      ok(String(error).includes("path='dialogueQuest.initialization'"));
      ok(String(error).includes("await initializeFerrumWasm() or createEngine()"));
    }
    ok(caught);
  }
});

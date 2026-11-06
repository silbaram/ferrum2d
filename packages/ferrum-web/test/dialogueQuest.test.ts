import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import "./nativeRuntimeTestHelper.js";
import {
  DialogueSession,
  QuestLog,
  captureDialogueQuestState,
  dialogueNodeToUiOverlayState,
  resolveDialogueGraph,
  resolveQuestDocument,
  restoreDialogueQuestState,
} from "../src/dialogueQuest.js";
import type { DialogueGraphSpec, DialogueSessionSnapshot, QuestDocumentSpec, QuestLogSnapshot } from "../src/dialogueQuest.js";

const quests: QuestDocumentSpec = {
  quests: {
    tutorial: {
      title: "Tutorial",
      stages: {
        intro: {
          title: "Intro",
          objectives: {
            talk: "Talk to the guide",
          },
        },
      },
    },
  },
};

const graph: DialogueGraphSpec = {
  initialNode: "start",
  nodes: {
    start: {
      speaker: "Guide",
      text: "Ready?",
      questUpdates: [{ quest: "tutorial", action: "start", stage: "intro" }],
      choices: [
        { id: "yes", label: "Yes", to: "done", setFlags: ["accepted"], questUpdates: [{ quest: "tutorial", action: "completeObjective", objective: "talk" }] },
        { id: "locked", label: "Secret", to: "done", requireFlags: ["secret"] },
      ],
    },
    done: {
      speaker: "Guide",
      text: "Go.",
      end: true,
      choices: [],
    },
  },
};

test("DialogueSession applies choices, flags, quest updates, and UI hook", () => {
  const questLog = new QuestLog(quests);
  const session = new DialogueSession(graph, questLog);
  const initialUi = dialogueNodeToUiOverlayState(session);
  equal(initialUi.dialog?.title, "Guide");
  equal(initialUi.dialog?.actions?.length, 1);

  const result = session.choose("yes");
  equal(result.ended, true);
  equal(session.snapshot().flags[0], "accepted");
  const quest = questLog.snapshot().quests[0];
  equal(quest.status, "active");
  deepEqual(quest.completedObjectives, ["talk"]);
  session.destroy(); questLog.destroy();
});

test("dialogue/quest state captures and restores save-state snapshots", () => {
  const questLog = new QuestLog(quests);
  const session = new DialogueSession(graph, questLog);
  session.choose("yes");
  const snapshot = captureDialogueQuestState(session, questLog);

  const restoredQuestLog = new QuestLog(quests);
  const restoredSession = new DialogueSession(graph, restoredQuestLog);
  restoreDialogueQuestState(snapshot, {
    dialogue: restoredSession,
    questLog: restoredQuestLog,
  });

  equal(restoredSession.snapshot().nodeId, "done");
  equal(restoredSession.snapshot().ended, true);
  equal(restoredQuestLog.snapshot().quests[0].completedObjectives[0], "talk");
  session.destroy(); questLog.destroy(); restoredSession.destroy(); restoredQuestLog.destroy();
});

test("resolveDialogueGraph validates missing choice targets", () => {
  expectThrows(
    () => resolveDialogueGraph({
      initialNode: "start",
      nodes: {
        start: {
          text: "Broken",
          choices: [{ label: "Next", to: "missing" }],
        },
      },
    }),
    /Invalid dialogue\/quest data: kind=dialogue-quest path='dialogue\.nodes\.start\.choices\.0\.to'/,
  );
  expectThrows(() => resolveDialogueGraph({ initialNode: "constructor", nodes: { start: { text: "Start" } } }), /path='dialogue.initialNode'/);
  expectThrows(() => resolveDialogueGraph({ initialNode: "start", nodes: { start: { text: "Start", choices: [{ label: "Missing", to: "toString" }] } } }), /path='dialogue.nodes.start.choices.0.to'/);
});

test("resolveQuestDocument validates quest stages and objectives", () => {
  const resolved = resolveQuestDocument(quests);
  equal(resolved.quests.tutorial.stages[0].objectives[0].text, "Talk to the guide");
  expectThrows(
    () => resolveQuestDocument({ quests: { bad: { title: "" } } }),
    /Invalid dialogue\/quest data: kind=dialogue-quest path='quests\.quests\.bad\.title'/,
  );
});

test("native quest batches retain intermediate results and reject failures atomically", () => {
  const log = new QuestLog(quests);
  deepEqual(log.snapshot().quests[0], { id: "tutorial", status: "inactive", stage: "intro", completedObjectives: [] });
  const before = log.snapshot();
  expectThrows(() => log.applyAll([
    { quest: "tutorial", action: "start" }, { quest: "missing", action: "complete" },
  ]), /path='questUpdate.quest'/);
  deepEqual(log.snapshot(), before);
  const results = log.applyAll([
    { quest: "tutorial", action: "start" },
    { quest: "tutorial", action: "completeObjective", objective: "custom-objective" },
    { quest: "tutorial", action: "completeObjective", objective: "custom-objective" },
    { quest: "tutorial", action: "complete" },
  ]);
  deepEqual(results.map(result => result.status), ["active", "active", "active", "completed"]);
  deepEqual(results[0].completedObjectives, []);
  deepEqual(results[3].completedObjectives, ["custom-objective"]);
  expectThrows(() => log.apply({ quest: "tutorial", action: "setStage", stage: "missing" }), /path='questUpdate.stage'/);
  equal(log.snapshot().quests[0].status, "completed");
  log.destroy();
});

test("native snapshots are detached from live state and content is captured at construction", () => {
  const input = structuredClone(graph);
  const log = new QuestLog(quests), session = new DialogueSession(input, log);
  input.nodes.start.text = "changed after construction";
  equal(session.currentNode().text, "Ready?");
  equal(Object.isFrozen(session.currentNode()), true);
  session.choose("yes");
  const snapshot = log.snapshot();
  (snapshot.quests[0].completedObjectives as string[]).push("external-edit");
  deepEqual(log.snapshot().quests[0].completedObjectives, ["talk"]);
  const flags = session.snapshot().flags as string[];
  flags.push("external-flag");
  deepEqual(session.snapshot().flags, ["accepted"]);
  session.destroy(); log.destroy();
});

test("native dialogue restores arbitrary flags and preserves legacy end and flag ordering", () => {
  const session = new DialogueSession({ initialNode: "start", nodes: {
    start: { text: "Start", end: true, choices: [{ id: "next", label: "Next", to: "next", setFlags: ["both", "new"], clearFlags: ["both"], requireFlags: ["external"] }] },
    next: { text: "Next", choices: [{ id: "end", label: "End" }] },
  } });
  equal(session.snapshot().ended, false); // An initial end node was not terminal until choosing.
  equal(session.availableChoices().length, 0);
  session.restore({ nodeId: "start", flags: ["external", "😀", "\ue000", "external"], ended: false });
  equal(session.availableChoices().length, 1);
  session.choose("next");
  deepEqual(session.snapshot().flags, ["external", "new", "😀", "\ue000"]);
  equal(session.snapshot().ended, false);
  session.choose("end");
  equal(session.snapshot().ended, true);
  expectThrows(() => session.choose("end"), /cannot choose after dialogue ended/);
  session.destroy();
});

test("failed restore preserves both native dialogue and quest state", () => {
  const log = new QuestLog(quests), session = new DialogueSession(graph, log);
  const before = captureDialogueQuestState(session, log);
  expectThrows(() => session.restore({ nodeId: "done", flags: ["ok", ""], ended: true }), /non-empty string/);
  deepEqual(captureDialogueQuestState(session, log), before);
  expectThrows(() => log.restore({ quests: [{ id: "tutorial", status: "invalid", completedObjectives: [] }] } as unknown as QuestLogSnapshot), /must be inactive/);
  deepEqual(captureDialogueQuestState(session, log), before);
  expectThrows(() => restoreDialogueQuestState({ ...before,
    dialogue: { nodeId: "done", flags: ["would-change"], ended: true },
    quests: { quests: [{ id: "tutorial", status: "invalid", completedObjectives: [] }] } as unknown as QuestLogSnapshot,
  }, { dialogue: session, questLog: log }), /must be inactive/);
  deepEqual(captureDialogueQuestState(session, log), before);
  expectThrows(() => restoreDialogueQuestState({ ...before,
    dialogue: { nodeId: "missing", flags: [], ended: false },
    quests: { quests: [{ id: "tutorial", status: "completed", completedObjectives: [] }] },
  }, { dialogue: session, questLog: log }), /path='dialogue.snapshot.nodeId'/);
  deepEqual(captureDialogueQuestState(session, log), before);
  expectThrows(() => session.restore({ nodeId: "done", flags: [], ended: 1 } as unknown as DialogueSessionSnapshot), /must be a boolean/);
  session.destroy(); log.destroy();
});

test("failed native choice does not partially change linked quests or flags", () => {
  const log = new QuestLog(quests);
  const session = new DialogueSession({ initialNode: "start", nodes: {
    start: { text: "Start", choices: [{ id: "bad", label: "Bad", to: "next", setFlags: ["partial"], questUpdates: [{ quest: "tutorial", action: "complete" }] }] },
    next: { text: "Next", questUpdates: [{ quest: "missing", action: "start" }] },
  } }, log);
  const before = captureDialogueQuestState(session, log);
  expectThrows(() => session.choose("bad"), /path='questUpdate.quest'/);
  deepEqual(captureDialogueQuestState(session, log), before);
  session.destroy(); log.destroy();
});

test("legacy quest restore ignores removed content and does not replay node quest updates", () => {
  const log = new QuestLog(quests), session = new DialogueSession(graph, log);
  log.restore({ quests: [
    { id: "removed", status: "completed", completedObjectives: [] },
    { id: "tutorial", status: "completed", completedObjectives: ["custom", "custom"] },
  ] });
  session.restore({ nodeId: "start", flags: [], ended: false });
  deepEqual(log.snapshot().quests[0], { id: "tutorial", status: "completed", completedObjectives: ["custom", "custom"] });
  log.restore({ quests: [] });
  equal(log.snapshot().quests[0].status, "inactive");
  session.destroy(); log.destroy();
});

test("native resources have explicit terminal destroy and linked state outlives its quest wrapper", () => {
  const log = new QuestLog(quests), session = new DialogueSession(graph, log);
  log.destroy(); log.destroy();
  expectThrows(() => log.snapshot(), /path='dialogueQuest.lifecycle'/);
  expectThrows(() => log.apply({ quest: "tutorial", action: "complete" }), /path='dialogueQuest.lifecycle'/);
  expectThrows(() => new DialogueSession(graph, log), /path='dialogueQuest.lifecycle'/);
  equal(session.choose("yes").ended, true);
  session.destroy(); session.destroy();
  expectThrows(() => session.currentNode(), /path='dialogueQuest.lifecycle'/);
  expectThrows(() => session.availableChoices(), /path='dialogueQuest.lifecycle'/);
  expectThrows(() => session.choose("yes"), /path='dialogueQuest.lifecycle'/);
  expectThrows(() => session.restore({ nodeId: "start", flags: [], ended: false }), /path='dialogueQuest.lifecycle'/);
});

test("special own content names remain distinct through native encoding", () => {
  const document = JSON.parse('{"quests":{"__proto__":{"title":"Special"},"constructor":{"title":"Other"}}}') as QuestDocumentSpec;
  equal(Object.getPrototypeOf(resolveQuestDocument(document).quests), Object.prototype);
  const log = new QuestLog(document);
  log.apply({ quest: "__proto__", action: "complete" });
  deepEqual(log.snapshot().quests.map(quest => [quest.id, quest.status]), [["__proto__", "completed"], ["constructor", "inactive"]]);
  const session = new DialogueSession(JSON.parse('{"initialNode":"__proto__","nodes":{"__proto__":{"text":"First","choices":[{"label":"Next","to":"constructor"}]},"constructor":{"text":"Last","end":true}}}') as DialogueGraphSpec);
  equal(session.choose("0").node.text, "Last");
  session.destroy(); log.destroy();
});

test("UTF-8 transport preserves leading BOM characters inside content names and flags", () => {
  const id = "\ufeffquest", node = "\ufeffstart", flag = "\ufeffflag";
  const log = new QuestLog({ quests: { [id]: { title: "Unicode quest" } } });
  log.apply({ quest: id, action: "complete" });
  equal(log.snapshot().quests[0].id, id);
  const session = new DialogueSession({ initialNode: node, nodes: {
    [node]: { text: "Start", choices: [{ id: "next", label: "Next", to: "done", setFlags: [flag] }] },
    done: { text: "Done" },
  } });
  equal(session.snapshot().nodeId, node);
  session.choose("next");
  deepEqual(session.snapshot().flags, [flag]);
  session.destroy(); log.destroy();
});

test("combined restore rejects disposal inside snapshot getters before either native commit", () => {
  {
    const log = new QuestLog(quests), session = new DialogueSession(graph, log);
    const before = log.snapshot();
    expectThrows(() => restoreDialogueQuestState({ format: "ferrum-dialogue-quest-state", version: 1,
      dialogue: { nodeId: "done", get flags() { session.destroy(); return ["stale"]; }, ended: true },
      quests: { quests: [{ id: "tutorial", status: "completed", completedObjectives: [] }] },
    }, { dialogue: session, questLog: log }), /path='dialogueQuest.lifecycle'/);
    deepEqual(log.snapshot(), before);
    session.destroy(); log.destroy();
  }
  {
    const log = new QuestLog(quests), session = new DialogueSession(graph, log);
    const before = session.snapshot();
    expectThrows(() => restoreDialogueQuestState({ format: "ferrum-dialogue-quest-state", version: 1,
      dialogue: { nodeId: "done", flags: ["stale"], ended: true },
      quests: { quests: [{ id: "tutorial", status: "completed", get completedObjectives() { log.destroy(); return []; } }] },
    }, { dialogue: session, questLog: log }), /path='dialogueQuest.lifecycle'/);
    deepEqual(session.snapshot(), before);
    session.destroy(); log.destroy();
  }
});

test("standalone mutations recheck lifecycle after input getters", () => {
  for (const operation of ["apply", "applyAll", "restoreQuest", "restoreDialogue"] as const) {
    const log = new QuestLog(quests), session = new DialogueSession(graph, log);
    const update = { quest: "tutorial", get action() { log.destroy(); return "complete" as const; } };
    expectThrows(() => {
      if (operation === "apply") log.apply(update);
      else if (operation === "applyAll") log.applyAll([update]);
      else if (operation === "restoreQuest") log.restore({ quests: [{ id: "tutorial", status: "completed", get completedObjectives() { log.destroy(); return []; } }] });
      else session.restore({ nodeId: "done", get flags() { session.destroy(); return []; }, ended: true });
    }, /path='dialogueQuest.lifecycle'/);
    session.destroy(); log.destroy();
  }
});

test("combined restore captures snapshot properties and targets once", () => {
  const log = new QuestLog(quests), session = new DialogueSession(graph, log);
  const reads = { dialogue: 0, quests: 0, dialogueTarget: 0, questTarget: 0 };
  restoreDialogueQuestState({ format: "ferrum-dialogue-quest-state", version: 1,
    get dialogue() { reads.dialogue++; return { nodeId: "done", flags: ["captured"], ended: true }; },
    get quests() { reads.quests++; return { quests: [{ id: "tutorial", status: "completed" as const, completedObjectives: [] }] }; },
  }, {
    get dialogue() { reads.dialogueTarget++; return session; },
    get questLog() { reads.questTarget++; return log; },
  });
  deepEqual(reads, { dialogue: 1, quests: 1, dialogueTarget: 1, questTarget: 1 });
  equal(session.snapshot().nodeId, "done");
  equal(log.snapshot().quests[0].status, "completed");
  session.destroy(); log.destroy();
});

test("combined restore rejects a missing required native handle without a partial restore", () => {
  const session = new DialogueSession(graph), before = session.snapshot();
  const missingNativeHandle = Object.create(QuestLog.prototype) as QuestLog;
  expectThrows(() => restoreDialogueQuestState({ format: "ferrum-dialogue-quest-state", version: 1,
    dialogue: { nodeId: "done", flags: [], ended: true }, quests: { quests: [] },
  }, { dialogue: session, questLog: missingNativeHandle }), /path='dialogueQuest.lifecycle'/);
  deepEqual(session.snapshot(), before);
  session.destroy();
});

function expectThrows(callback: () => void, pattern: RegExp): void {
  try {
    callback();
  } catch (error) {
    ok(pattern.test(error instanceof Error ? error.message : String(error)));
    return;
  }
  throw new Error("Expected callback to throw.");
}

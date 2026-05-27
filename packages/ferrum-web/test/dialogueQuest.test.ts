import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  DialogueSession,
  QuestLog,
  captureDialogueQuestState,
  dialogueNodeToUiOverlayState,
  resolveDialogueGraph,
  resolveQuestDocument,
  restoreDialogueQuestState,
} from "../src/dialogueQuest.js";
import type { DialogueGraphSpec, QuestDocumentSpec } from "../src/dialogueQuest.js";

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
});

test("resolveQuestDocument validates quest stages and objectives", () => {
  const resolved = resolveQuestDocument(quests);
  equal(resolved.quests.tutorial.stages[0].objectives[0].text, "Talk to the guide");
  expectThrows(
    () => resolveQuestDocument({ quests: { bad: { title: "" } } }),
    /Invalid dialogue\/quest data: kind=dialogue-quest path='quests\.quests\.bad\.title'/,
  );
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

#!/usr/bin/env node
import {
  DialogueSession,
  QuestLog,
  createFerrumRuntime,
  captureDialogueQuestState,
  dialogueNodeToUiOverlayState,
  restoreDialogueQuestState,
} from "../../packages/ferrum-web/dist/index.js";

const quests = {
  quests: {
    tutorial: {
      title: "Tutorial",
      stages: {
        intro: {
          title: "Intro",
          objectives: { talk: "Talk to the guide" },
        },
      },
    },
  },
};

const graph = {
  initialNode: "start",
  nodes: {
    start: {
      speaker: "Guide",
      text: "Ready?",
      questUpdates: [{ quest: "tutorial", action: "start", stage: "intro" }],
      choices: [
        {
          id: "yes",
          label: "Yes",
          to: "done",
          setFlags: ["accepted"],
          questUpdates: [{ quest: "tutorial", action: "completeObjective", objective: "talk" }],
        },
      ],
    },
    done: { speaker: "Guide", text: "Go.", end: true },
  },
};

const questLog = new QuestLog(quests);
const session = new DialogueSession(graph, questLog);
if (typeof createFerrumRuntime !== "function") {
  throw new Error("createFerrumRuntime must expose the runtime dialogue opt-in entrypoint.");
}

const uiState = dialogueNodeToUiOverlayState(session, { dialogId: "smoke-dialogue", title: "Smoke Dialogue" });
if (uiState.dialog?.id !== "smoke-dialogue" || uiState.dialog?.title !== "Smoke Dialogue") {
  throw new Error(`dialogue runtime UI options failed: ${JSON.stringify(uiState)}`);
}
if (uiState.dialog?.actions?.[0]?.id !== "yes") {
  throw new Error(`dialogue UI hook failed: ${JSON.stringify(uiState)}`);
}
session.choose("yes");
const snapshot = captureDialogueQuestState(session, questLog);

const restoredQuestLog = new QuestLog(quests);
const restoredSession = new DialogueSession(graph, restoredQuestLog);
restoreDialogueQuestState(snapshot, { dialogue: restoredSession, questLog: restoredQuestLog });
if (restoredSession.snapshot().nodeId !== "done" || restoredQuestLog.snapshot().quests[0]?.completedObjectives[0] !== "talk") {
  throw new Error(`dialogue/quest restore failed: ${JSON.stringify(snapshot)}`);
}

console.log(JSON.stringify({
  dialogueQuestSmoke: {
    runtimeFactory: typeof createFerrumRuntime,
    dialogId: uiState.dialog?.id,
    nodeId: restoredSession.snapshot().nodeId,
    ended: restoredSession.snapshot().ended,
    quest: restoredQuestLog.snapshot().quests[0],
  },
}, null, 2));

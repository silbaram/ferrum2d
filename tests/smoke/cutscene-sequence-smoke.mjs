import {
  CutsceneSequencePlayer,
  resolveCutsceneSequenceSpec,
} from "../../packages/ferrum-web/dist/cutsceneSequence.js";
import {
  LocalizationBundle,
} from "../../packages/ferrum-web/dist/index.js";

const sequence = resolveCutsceneSequenceSpec({
  id: "intro",
  commands: [
    { kind: "wait", durationSeconds: 0.1 },
    { kind: "camera", target: { x: 120, y: 64 }, durationSeconds: 0.2, easing: "easeInOut" },
    { kind: "audio", sound: "intro-bgm", bus: "bgm", loop: true, volume: 0.7 },
    { kind: "dialogue", speaker: "Guide", text: "Welcome to Ferrum2D.", durationSeconds: 0.3 },
  ],
});

const player = CutsceneSequencePlayer.create(sequence);
const calls = [];
const target = {
  onCutsceneCommand: (event) => calls.push(`command:${event.command.kind}`),
  moveCamera: (command) => calls.push(`camera:${command.target.x},${command.target.y}`),
  playCutsceneAudio: (command) => calls.push(`audio:${command.sound}:${command.bus}`),
  showCutsceneDialogue: (command) => calls.push(`dialogue:${command.speaker}:${command.text}`),
};

player.update(0, { target });
const result = player.update(0.6, { target });

if (!result.completed) {
  throw new Error("cutscene sequence should complete after its timeline duration.");
}
if (Math.abs(sequence.durationSeconds - 0.6) > 1e-9) {
  throw new Error(`unexpected cutscene duration: ${sequence.durationSeconds}`);
}
if (!calls.includes("camera:120,64") || !calls.includes("audio:intro-bgm:bgm")) {
  throw new Error(`cutscene target adapter did not receive expected events: ${calls.join(", ")}`);
}
if (!calls.includes("dialogue:Guide:Welcome to Ferrum2D.")) {
  throw new Error("cutscene dialogue command was not emitted.");
}

const localization = new LocalizationBundle({
  defaultLocale: "en",
  fallbackLocale: "en",
  locales: {
    en: { strings: { "intro.briefing": "Begin operation, {name}." } },
    ko: { strings: { "intro.briefing": "작전을 시작하세요, {name}." } },
  },
}, "ko");
const localizedDialogueEvents = [];
const localizedPlayer = CutsceneSequencePlayer.create({
  id: "localized-intro",
  commands: [
    { kind: "dialogue", speaker: "Guide", text: "intro.briefing", durationSeconds: 0.1 },
  ],
});
localizedPlayer.update(0, {
  target: {
    showCutsceneDialogue: (command) => {
      localizedDialogueEvents.push(localization.t(command.text, { values: { name: "Ferrum2D" } }));
    },
  },
});
if (!localizedDialogueEvents.includes("작전을 시작하세요, Ferrum2D.")) {
  throw new Error(`cutscene localization adapter failed: ${localizedDialogueEvents.join(", ")}`);
}

console.log(JSON.stringify({
  cutsceneSequenceSmoke: {
    sequenceId: sequence.id,
    durationSeconds: sequence.durationSeconds,
    events: calls,
    localizedDialogueEvents,
  },
}, null, 2));

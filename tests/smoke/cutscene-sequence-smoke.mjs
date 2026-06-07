import {
  CutsceneSequencePlayer,
  resolveCutsceneSequenceSpec,
} from "../../packages/ferrum-web/dist/cutsceneSequence.js";

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

console.log(JSON.stringify({
  cutsceneSequenceSmoke: {
    sequenceId: sequence.id,
    durationSeconds: sequence.durationSeconds,
    events: calls,
  },
}, null, 2));

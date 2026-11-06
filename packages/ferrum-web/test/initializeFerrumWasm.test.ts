import { equal, rejects } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { initializeFerrumWasm } from "../src/core.js";
import { QuestLog } from "../src/dialogueQuest.js";
import { WasmBridge } from "../src/wasmBridge.js";

test("public Wasm initialization retries failure and shares concurrent initialization with engine bridges", async () => {
  await rejects(initializeFerrumWasm(new Uint8Array([0])), /WebAssembly/);
  const bytes = await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url));
  const initialized = initializeFerrumWasm(bytes);
  const bridge = WasmBridge.init();
  await Promise.all([initialized, bridge, initializeFerrumWasm(bytes)]);
  const quests = QuestLog.create({ quests: { task: { title: "Task" } } });
  try {
    quests.apply({ quest: "task", action: "start" });
    await initializeFerrumWasm();
    equal(quests.snapshot().quests[0].status, "active");
  } finally {
    quests.destroy();
    (await bridge).engine().free();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateLanguageBoundaries } from "../../scripts/validate/check-language-boundaries.mjs";

const file = "facade.ts";
const contract = { file, name: "QuestLog", nativeType: "NativeQuestLog",
  metadata: { document: "ResolvedQuestDocument" }, nativeReadonly: true,
  delegates: ["apply", "snapshot", "restore"] };
const valid = `
import { NativeQuestLog as NativeStore } from "../pkg/ferrum_core.js";
interface ResolvedQuestDocument { quests: Record<string, unknown>; }
export class QuestLog {
  private readonly document: ResolvedQuestDocument;
  private readonly native: NativeStore;
  constructor(document: ResolvedQuestDocument) {
    this.document = document;
    this.native = new NativeStore();
  }
  apply(update: unknown) { return this.native.apply(update); }
  snapshot() { const handle = this.native; return handle.snapshot(); }
  restore(value: unknown) { this.restoreNative(value); }
  private restoreNative(value: unknown) { this.native.restore(value); }
}
`;
const validate = source => validateLanguageBoundaries({ [file]: source }, [contract]);
const reject = (source, pattern) => assert.ok(validate(source).some(error => pattern.test(error.message)), JSON.stringify(validate(source)));

test("real AST resolves renamed native imports, local handle aliases and method delegation", () => {
  assert.deepEqual(validate(valid), []);
});
test("a codec re-export must resolve all the way to the actual pkg class", () => {
  const source = valid.replace("../pkg/ferrum_core.js", "./codec.js");
  const codec = 'import { NativeQuestLog } from "../pkg/ferrum_core.js"; export { NativeQuestLog };';
  assert.deepEqual(validateLanguageBoundaries({ [file]: source, "codec.ts": codec }, [contract]), []);
  assert.ok(validateLanguageBoundaries({ [file]: source, "codec.ts": "export class NativeQuestLog {}" }, [contract]).length > 0);
});
test("resource WeakMaps and lifecycle WeakSets are allowed without accepting progress payloads", () => {
  const registries = "const handles = new WeakMap<QuestLog, NativeStore>(); const destroyed = new WeakSet<object>();\n";
  const source = registries + valid.replace("this.native = new NativeStore();", "this.native = new NativeStore(); handles.set(this, this.native); destroyed.add(this);");
  assert.deepEqual(validate(source), []);
  reject(source.replace("handles.set(this, this.native)", "handles.set(this, { stage: 2 })"), /never progress snapshots/);
});
test("renaming forbidden progress storage does not evade the field contract", () => {
  reject(valid.replace("private readonly native", "private readonly unrelatedCache = new Map();\n  private readonly native"), /forbidden TS instance state/);
});
test("constructor parameter properties cannot hide TS progress", () => {
  reject(valid.replace("constructor(document:", "constructor(private flags = new Set(), document:"), /forbidden TS instance state/);
});
test("a local class with the native export name is not a pkg native handle", () => {
  reject(valid.replace('import { NativeQuestLog as NativeStore } from "../pkg/ferrum_core.js";', "class NativeStore {}"), /actual pkg export/);
});
test("the same native class name imported from a TS simulator is rejected", () => {
  reject(valid.replace("../pkg/ferrum_core.js", "./simulation.js"), /actual pkg export/);
});
test("native calls mentioned only in comments or strings do not satisfy delegation", () => {
  reject(valid.replace("return this.native.apply(update);", '/* this.native.apply(update) */ return "this.native.apply(update)";'), /apply must call/);
});
test("removing native restore behind a local wrapper is rejected", () => {
  reject(valid.replace("this.native.restore(value);", "return value;"), /restore must call/);
});
test("readonly metadata cannot be repurposed as a progress dictionary", () => {
  reject(valid.replace("return this.native.apply(update);", 'this.document.quests["active"] = update; return this.native.apply(update);'), /mutate TS-owned document/);
});
test("local aliases cannot hide metadata writes or reflective facade state", () => {
  reject(valid.replace("return this.native.apply(update);", 'const state = this.document.quests; state["active"] = update; return this.native.apply(update);'), /mutate TS-owned document/);
  reject(valid.replace("return this.native.apply(update);", 'const self = this; Object.assign(self, { progress: update }); return this.native.apply(update);'), /reflective TS state mutation/);
});
test("module singleton containers and mutable bindings cannot replace instance state", () => {
  reject("const hidden = new Map();\n" + valid, /module state containers/);
  reject("let current = 0;\n" + valid, /mutable module bindings/);
});
test("reflective property writes and inheritance cannot introduce hidden state", () => {
  reject(valid.replace("return this.native.apply(update);", 'Object.assign(this, { stage: update }); return this.native.apply(update);'), /reflective TS state mutation/);
  reject(valid.replace("class QuestLog {", "class QuestLog extends Simulation {"), /inherit hidden state/);
});
test("native delegate may use a local checked handle accessor", () => {
  const source = valid.replace("return this.native.apply(update);", "return this.requireNative().apply(update);")
    .replace("private restoreNative", "private requireNative() { const handle = this.native; if (!handle) throw new Error(); return handle; }\n  private restoreNative");
  assert.deepEqual(validate(source), []);
});
test("missing class and malformed source fail closed", () => {
  reject(valid.replace("class QuestLog", "class RenamedQuestLog"), /expected exactly one/);
  assert.ok(validate(valid + "export class {").length > 0);
});

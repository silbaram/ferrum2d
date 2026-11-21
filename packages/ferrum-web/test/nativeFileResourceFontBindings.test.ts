import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { test } from "node:test";
import { loadResourceFont } from "../src/nativeFileResourceFonts.js";
import { captureBoundResourceFonts, registerResourceFontSetBinding, prepareBoundResourceFonts, type ResourceFontSetHostAdapter } from "../src/nativeFileResourceFontBindings.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import type { ResolvedWebFontPolicy } from "../src/localization.js";
const policy: ResolvedWebFontPolicy = { id: "body", family: "Fixture", sources: [], weight: "400", style: "normal", display: "swap", preload: true, cssFontFace: "", loadExpression: "16px Fixture" };
// Declared WOFF2 header only: custom host capture is tested here. Actual native
// FontFace decode and multi-face publication are separate real-browser probes.
function source() { const data = new Uint8Array(48), v = new DataView(data.buffer); v.setUint32(0, 0x774f4632); v.setUint32(8, 48); v.setUint16(12, 1); v.setUint32(16, 28); return new Blob([data], { type: "font/woff2" }); }
async function fixture() {
    const set = { load: async () => [] }, owner = {}, blob = source(), identity = {};
    let revision = 0;
    await loadResourceFont(policy, set);
    const adapter: ResourceFontSetHostAdapter = Object.freeze({ fontSet: set, readRevision: () => revision,
        captureCurrent: async () => ({ faces: [{ identity, descriptors: { family: "Fixture", weight: "400" }, source: { blob, url: "actual.woff2" } }], bindings: [{ policyId: "body", faces: [0] }] }), acceptFile: () => { } });
    return { set, owner, blob, adapter, bump: () => revision++ };
}
test("actual custom font request owner captures through typed identity and current immutable source", async () => {
    const f = await fixture();
    await rejects(captureBoundResourceFonts(f.owner, f.set, new ResourceBudget()), /CAPABILITY/);
    registerResourceFontSetBinding(f.owner, "fonts", f.adapter);
    const data = await captureBoundResourceFonts(f.owner, f.set, new ResourceBudget());
    equal(data.fonts.externalPolicies[0].id, "body");
    equal(data.external!.faces.length, 1);
    equal(data.external!.faces[0].source.bytes.length, 48);
    deepEqual(data.external!.bindings, [{ policyId: "body", faces: [0] }]);
    equal(data.external!.reference.symbol, "fonts");
    equal(data.external!.originRevision, 0);
});
test("font trusted adapter revision changes and caught reentrancy invalidate capture", async () => {
    const f = await fixture();
    registerResourceFontSetBinding(f.owner, "fonts", Object.freeze({ ...f.adapter, captureCurrent: async (_policies: readonly ResolvedWebFontPolicy[], b: ResourceBudget) => { const selected = await f.adapter.captureCurrent([policy], b); f.bump(); return selected; } }));
    await rejects(captureBoundResourceFonts(f.owner, f.set, new ResourceBudget()), /STALE/);
    const g = await fixture();
    registerResourceFontSetBinding(g.owner, "fonts", Object.freeze({ ...g.adapter, captureCurrent: async (_policies: readonly ResolvedWebFontPolicy[], b: ResourceBudget) => {
            await rejects(captureBoundResourceFonts(g.owner, g.set, b), /BUSY/);
            return g.adapter.captureCurrent([policy], b);
        } }));
    await rejects(captureBoundResourceFonts(g.owner, g.set, new ResourceBudget()), /BUSY/);
});
test("font face ordinal errors and unavailable original bytes reject before any publication", async () => {
    const f = await fixture();
    registerResourceFontSetBinding(f.owner, "fonts", Object.freeze({ ...f.adapter, captureCurrent: async () => ({ faces: [], bindings: [{ policyId: "body", faces: [0] }] }) }));
    await rejects(captureBoundResourceFonts(f.owner, f.set, new ResourceBudget()), /DATA/);
    const g = await fixture();
    registerResourceFontSetBinding(g.owner, "fonts", Object.freeze({ ...g.adapter, captureCurrent: async () => ({ faces: [{ identity: {}, descriptors: { family: "Fixture" }, source: { blob: new Blob(), url: "empty" } }], bindings: [{ policyId: "body", faces: [0] }] }) }));
    await rejects(captureBoundResourceFonts(g.owner, g.set, new ResourceBudget()), /DATA/);
});
test("font shared ledger has exact and one-below capture limits without resetting allowance", async () => {
    const f = await fixture();
    registerResourceFontSetBinding(f.owner, "fonts", f.adapter);
    const b = new ResourceBudget(), data = await captureBoundResourceFonts(f.owner, f.set, b), u = b.usage();
    const limits = { maxResources: u.resources, maxWork: u.work, maxMetadataBytes: u.metadataBytes, maxSourceBytes: u.sourceBytes, maxDecodedBytes: u.decodedBytes, maxGpuBytes: u.gpuBytes };
    const exact = new ResourceBudget(limits);
    deepEqual(await captureBoundResourceFonts(f.owner, f.set, exact), data);
    deepEqual(exact.usage(), u);
    for (const k of ["maxResources", "maxWork", "maxMetadataBytes", "maxSourceBytes"] as const)
        await rejects(captureBoundResourceFonts(f.owner, f.set, new ResourceBudget({ ...limits, [k]: limits[k] - 1 })), /LIMIT/);
});
test("font malformed file metadata rejects before a registered target adapter can run", async () => {
    const f = await fixture();
    let calls = 0;
    registerResourceFontSetBinding(f.owner, "fonts", Object.freeze({ ...f.adapter, acceptFile: () => { calls++; } }));
    const data = await captureBoundResourceFonts(f.owner, f.set, new ResourceBudget());
    let getters = 0;
    const fonts = { ...data.fonts };
    Object.defineProperty(fonts, "entries", { get() { getters++; throw Error("getter"); } });
    await rejects(prepareBoundResourceFonts(f.owner, f.set as unknown as FontFaceSet, { ...data, fonts }, new ResourceBudget()), /DATA/);
    equal(getters, 0);
    equal(calls, 0);
    const invalid = { ...data, external: { ...data.external!, bindings: [{ policyId: "body", faces: [99] }] } };
    await rejects(prepareBoundResourceFonts(f.owner, f.set as unknown as FontFaceSet, invalid, new ResourceBudget()), /DATA/);
    equal(calls, 0);
    throws(() => registerResourceFontSetBinding({}, "bad", { ...f.adapter }), /VALUE/);
});

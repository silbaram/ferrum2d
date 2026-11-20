import "./nativeRuntimeTestHelper.js";
import { test } from "node:test";
import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { createEngine } from "../src/createEngine.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { captureNativeFileResourceSession, prepareNativeFileResourceSession } from "../src/nativeFileResourceSession.js";
import { encodeNativeFileResourceGraph, decodeNativeFileResourceGraph } from "../src/nativeFileResourceCodec.js";
const limits = (b: ResourceBudget) => { const u = b.usage(); return { maxWork: u.work, maxResources: u.resources, maxMetadataBytes: u.metadataBytes, maxSourceBytes: u.sourceBytes, maxDecodedBytes: u.decodedBytes, maxGpuBytes: u.gpuBytes }; };
test("actual native facade resource capture has two sections and a one-use detached resource lease", async () => {
    const source = await createEngine(), target = await createEngine();
    try {
        const revision = source.runtimeCheckpointRevision(), capture = await captureNativeFileResourceSession(source, new ResourceBudget());
        capture.assertCurrent();
        ok(capture.manifestBytes.length && capture.dataBytes.length);
        const data = decodeNativeFileResourceGraph(capture.manifestBytes, capture.dataBytes, new ResourceBudget()) as {
            version: number;
            models: {
                registry: unknown[];
                assets: unknown[];
            };
        };
        equal(data.version, 1);
        deepEqual(data.models, { registry: [], assets: [] });
        const lease = await prepareNativeFileResourceSession(target, capture.manifestBytes, capture.dataBytes, new ResourceBudget());
        lease.assertCurrent();
        throws(() => lease.activateAudio(), /STALE/);
        lease.adopt();
        equal(lease.activateAudio(), undefined);
        throws(() => lease.adopt(), /STALE/);
        await lease.dispose();
        await lease.dispose();
        equal(source.runtimeCheckpointRevision(), revision);
    }
    finally {
        source.destroy();
        target.destroy();
    }
});
test("capture and detached resource preparation share exact logical quotas; one-below rejects without source change", async () => {
    const source = await createEngine(), target = await createEngine();
    try {
        const b = new ResourceBudget(), capture = await captureNativeFileResourceSession(source, b), u = b.usage(), exact = new ResourceBudget(limits(b));
        await captureNativeFileResourceSession(source, exact);
        deepEqual(exact.usage(), u);
        for (const key of ["maxWork", "maxMetadataBytes", "maxSourceBytes", "maxDecodedBytes"] as const) {
            const n = limits(b)[key];
            if (n)
                await rejects(captureNativeFileResourceSession(source, new ResourceBudget({ ...limits(b), [key]: n - 1 })), /LIMIT/);
        }
        const stage = new ResourceBudget(), lease = await prepareNativeFileResourceSession(target, capture.manifestBytes, capture.dataBytes, stage);
        await lease.dispose();
        const second = new ResourceBudget(limits(stage)), at = await prepareNativeFileResourceSession(target, capture.manifestBytes, capture.dataBytes, second);
        deepEqual(second.usage(), stage.usage());
        await at.dispose();
        const below = limits(stage);
        await rejects(prepareNativeFileResourceSession(target, capture.manifestBytes, capture.dataBytes, new ResourceBudget({ ...below, maxWork: below.maxWork - 1 })), /LIMIT/);
        capture.assertCurrent();
    }
    finally {
        source.destroy();
        target.destroy();
    }
});
test("valid resource codec bytes with malformed semantic roots fail before adoption; forged facades have no roster", async () => {
    const source = await createEngine(), target = await createEngine();
    try {
        const capture = await captureNativeFileResourceSession(source, new ResourceBudget()), good = decodeNativeFileResourceGraph(capture.manifestBytes, capture.dataBytes, new ResourceBudget()) as Record<string, unknown>, before = capture.manifestBytes.slice();
        for (const data of [{ ...good, version: 2 }, { ...good, unknown: 1 }, { ...good, assets: {} }, { ...good, models: { registry: [], assets: [], renderer: { backend: "webgl2", roots: [0], active: [], warmed: [], prepared: [] } } }]) {
            const bad = encodeNativeFileResourceGraph(data, new ResourceBudget());
            await rejects(prepareNativeFileResourceSession(target, bad.manifestBytes, bad.dataBytes, new ResourceBudget()), /DATA|CAPABILITY/);
            capture.assertCurrent();
            deepEqual(capture.manifestBytes, before);
        }
        await rejects(captureNativeFileResourceSession({}, new ResourceBudget()), /STALE/);
        source.destroy();
        throws(() => capture.assertCurrent(), /STALE/);
    }
    finally {
        source.destroy();
        target.destroy();
    }
});

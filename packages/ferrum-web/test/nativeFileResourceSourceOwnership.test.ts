import { test } from "node:test";
import { deepEqual, equal, ok, throws, rejects } from "node:assert/strict";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
import { captureResourceSource, fileResourceBlob } from "../src/nativeFileResourceOwners.js";
import { cloneResourceJson, resourceJsonUnchanged } from "../src/nativeFileResourceJson.js";
test("one actual Blob keeps separate URL provenance while sharing one captured backing", async () => { const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), b = new ResourceBudget(), a = await captureResourceSource({ blob, url: "one" }, b), same = await captureResourceSource({ blob, url: "one" }, b), other = await captureResourceSource({ blob, url: "two" }, b); equal(a, same); ok(a !== other); equal(a.bytes, other.bytes); equal(other.url, "two"); equal(b.usage().sourceBytes, 3); deepEqual(new Uint8Array(await fileResourceBlob(a.bytes, a.mime, b).arrayBuffer()), a.bytes); throws(() => fileResourceBlob(a.bytes, "Image/PNG", b), /DATA/); });
test("actual mutable JSON admits null prototypes and DAG aliases, rejects hidden/symbol/accessor array data", () => {
    const shared = Object.create(null);
    shared.zero = -0;
    const source = { a: shared, b: shared }, b = new ResourceBudget(), copy = cloneResourceJson(source, b) as {
        a: object;
        b: object;
    };
    equal(copy.a, copy.b);
    equal(Object.getPrototypeOf(copy.a), null);
    equal(resourceJsonUnchanged(source, copy as never, b), true);
    shared.zero = 0;
    equal(resourceJsonUnchanged(source, copy as never, b), false);
    let calls = 0;
    for (const bad of [Object.defineProperty({}, "hidden", { value: 1 }), { [Symbol("unknown")]: 1 }, Object.defineProperty([], "x", { get() { calls++; return 1; } })])
        throws(() => cloneResourceJson(bad, new ResourceBudget()), /DATA/);
    equal(calls, 0);
});

test("source metadata quota fails before a Blob read starts",async()=>{
 let calls=0;const blob=new Blob([new Uint8Array([1,2,3])]),read=blob.arrayBuffer.bind(blob);
 blob.arrayBuffer=()=>{calls++;return read();};
 await rejects(captureResourceSource({blob,url:"actual source"},new ResourceBudget({maxMetadataBytes:0})),/LIMIT/);equal(calls,0);
});

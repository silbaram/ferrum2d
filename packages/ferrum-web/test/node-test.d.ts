declare module "node:test" {
  export type TestFn = () => void | Promise<void>;
  export function test(name: string, fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;
}

declare module "node:assert/strict" {
  export function rejects(promise: Promise<unknown>, expected: RegExp): Promise<void>;
  export function equal(actual: unknown, expected: unknown, message?: string): void;
  export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
  export function ok(value: unknown, message?: string): void;
  export function throws(block: () => unknown, error?: RegExp): void;
}

declare module "node:fs/promises" {
  export function readFile(path: URL): Promise<Uint8Array>;
}

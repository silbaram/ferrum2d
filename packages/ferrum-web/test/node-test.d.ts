declare module "node:test" {
  type MockFunction<Args extends unknown[], Result> = ((...args: Args) => Result) & {
    mock: { calls: ReadonlyArray<{ arguments: Args }>; callCount(): number };
  };
  interface TestContext {
    mock: {
      fn(): MockFunction<[], undefined>;
      method<T extends object, K extends keyof T>(object: T, key: K, implementation?: T[K]):
        T[K] extends (...args: infer Args) => infer Result ? MockFunction<Args, Result> : never;
    };
  }
  export type TestFn = (context: TestContext) => void | Promise<void>;
  export function test(name: string, fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;
}

declare module "node:assert/strict" {
  export function rejects(promise: Promise<unknown>, expected: RegExp | ((error: unknown) => boolean)): Promise<void>;
  export function equal(actual: unknown, expected: unknown, message?: string): void;
  export function deepEqual(actual: unknown, expected: unknown, message?: string): void;
  export function ok(value: unknown, message?: string): void;
  export function throws(block: () => unknown, error?: RegExp | ((error: unknown) => boolean)): void;
}

declare module "node:process" {
  const process: {
    on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
    off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  };
  export default process;
}

declare module "node:fs/promises" {
  export function readFile(path: URL): Promise<Uint8Array>;
}

import { spawn } from "node:child_process";

// A package manager can spawn build/preview processes that keep its pipes open
// after it exits. Bound the entire process group, not just npm's own lifetime.
export function runReleaseCommand(executable, args, { cwd, env = process.env, timeoutMs = 300_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive integer");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    const capture = (chunk) => { output = (output + chunk.toString()).slice(-30_000); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      killProcessTree(child);
      // Do not wait forever for a pipe held by a descendant to emit 'close'.
      child.stdout.destroy();
      child.stderr.destroy();
      finish(new Error(`${executable} ${args.join(" ")} timed out after ${timeoutMs}ms\n${output}`));
    }, timeoutMs);
    child.once("error", finish);
    child.once("close", (code) => {
      finish(code === 0 ? undefined : new Error(`${executable} ${args.join(" ")} failed (${code})\n${output}`));
    });
  });
}

function killProcessTree(child) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    killer.once("error", () => child.kill("SIGKILL"));
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") child.kill("SIGKILL");
  }
}

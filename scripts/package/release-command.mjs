import { spawn } from "node:child_process";
import path from "node:path";

/** Invoke pnpm's JS entry on Windows, keeping paths out of a command shell. */
export function resolvePackageCommand(command, args, { platform = process.platform, env = process.env, execPath = process.execPath } = {}) {
  if (platform !== "win32" || !/^pnpm(?:\.cmd)?$/i.test(command)) return { executable: command, args };
  const cli = env.npm_execpath;
  if (typeof cli !== "string" || !/^pnpm\.(?:c?js|mjs|exe)$/i.test(path.win32.basename(cli)))
    throw new Error("Run this command through pnpm on Windows so npm_execpath identifies pnpm's executable.");
  return /\.exe$/i.test(cli) ? { executable: cli, args } : { executable: execPath, args: [cli, ...args] };
}

/** Bound the whole process group, including descendants holding output pipes. */
export function runReleaseCommand(command, args, { cwd, env = process.env, timeoutMs = 300_000, onOutput } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive integer");
  const invocation = resolvePackageCommand(command, args, { env });
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    let stdout = "", stderr = "", settled = false;
    const capture = (kind, chunk) => {
      const text = chunk.toString();
      if (kind === "stdout") stdout = (stdout + text).slice(-60_000);
      else stderr = (stderr + text).slice(-60_000);
      onOutput?.(text);
    };
    child.stdout.on("data", chunk => capture("stdout", chunk));
    child.stderr.on("data", chunk => capture("stderr", chunk));
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve({ stdout, stderr });
    };
    const timer = setTimeout(() => {
      killProcessTree(child);
      child.stdout.destroy(); child.stderr.destroy();
      finish(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs}ms\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.once("error", finish);
    child.once("close", code => finish(code === 0 ? undefined : new Error(`${command} ${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`)));
  });
}

function killProcessTree(child) {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    killer.once("error", () => child.kill("SIGKILL")); killer.unref(); return;
  }
  try { process.kill(-child.pid, "SIGKILL"); }
  catch (error) { if (error.code !== "ESRCH") child.kill("SIGKILL"); }
}

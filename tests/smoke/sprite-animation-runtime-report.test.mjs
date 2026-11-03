import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const runner = fileURLToPath(new URL('./sprite-animation-runtime-smoke.mjs', import.meta.url));
const runFile = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ferrum-animation-report-'));
  const parent = join(root, 'artifacts/runtime-animation');
  await mkdir(parent, { recursive: true });
  const report = join(parent, 'verification.json');
  await writeFile(report, JSON.stringify({ ok: true, status: 'passed', run: 'old-run' }));
  return { root, report };
}

test('failed animation smoke replaces previous success in root and per-run reports', async () => {
  const { root, report } = await fixture();
  try {
    // Missing SDK artifacts fail before any browser or local server is created.
    await assert.rejects(runFile(process.execPath, [runner], { cwd: root, timeout: 10_000 }));
    const current = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(current.ok, false);
    assert.equal(current.status, 'failed');
    assert.notEqual(current.run, 'old-run');
    assert.match(current.error, /ENOENT/);
    assert.deepEqual(JSON.parse(await readFile(join(current.run, 'verification.json'), 'utf8')), current);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('interrupted animation smoke leaves running failure evidence instead of stale success', { skip: process.platform === 'win32' ? 'FIFO setup requires POSIX' : false }, async () => {
  const { root, report } = await fixture();
  let child, exited;
  try {
    const sdk = join(root, 'packages/ferrum-web/dist');
    await mkdir(sdk, { recursive: true });
    // Block the first artifact read without launching Chromium or opening a server.
    await runFile('mkfifo', [join(sdk, 'core.js')]);
    child = spawn(process.execPath, [runner], { cwd: root, stdio: 'ignore' });
    exited = once(child, 'exit');
    const deadline = Date.now() + 10_000;
    let current;
    while (Date.now() < deadline) {
      assert.equal(child.exitCode, null, 'Runner exited before its blocked read');
      try { current = JSON.parse(await readFile(report, 'utf8')); } catch { /* Writer may be replacing the report. */ }
      if (current?.status === 'running') break;
      await setTimeout(10);
    }
    assert.equal(current?.ok, false);
    assert.equal(current?.status, 'running');
    assert.notEqual(current.run, 'old-run');
    child.kill('SIGKILL');
    await exited;
    assert.deepEqual(JSON.parse(await readFile(report, 'utf8')), current);
    assert.deepEqual(JSON.parse(await readFile(join(current.run, 'verification.json'), 'utf8')), current);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (exited) await exited;
    await rm(root, { recursive: true, force: true });
  }
});

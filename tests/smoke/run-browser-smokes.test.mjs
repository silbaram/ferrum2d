import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseArgs, selectSteps, steps } from '../../scripts/validate/run-browser-smokes.mjs';

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;

test('the local browser smoke list keeps every check removed from CI', () => {
  assert.equal(steps.prepare.length, 5);
  assert.equal(steps.core.length, 39);
  assert.equal(steps.extended.length, 20);
  const names = [...steps.prepare, ...steps.core, ...steps.extended].map(step => step.name);
  assert.equal(new Set(names).size, names.length, 'step names must be unique');
  // The former extended matrix step set these for every entry.
  for (const step of steps.extended) {
    assert.deepEqual(step.env, {
      FERRUM_BROWSER_SMOKE_TIMEOUT_MS: '30000',
      FERRUM_BROWSER_SMOKE_BUDGET_ARTIFACT_DIR: 'artifacts/browser-smoke-budgets',
    }, step.name);
  }
});

test('every listed command points at an existing script', () => {
  for (const step of [...steps.prepare, ...steps.core, ...steps.extended]) {
    for (const [, file] of step.run.matchAll(/\bnode (tests\/smoke\/[\w./-]+\.mjs)/g)) {
      assert(existsSync(file), `${step.name}: missing ${file}`);
    }
    for (const [, name] of step.run.matchAll(/\bpnpm ([a-z][\w:-]*)/g)) {
      if (['exec', 'install', 'pack'].includes(name)) continue;
      assert(name in scripts, `${step.name}: missing package script ${name}`);
    }
  }
});

test('selection filters by group and name and skips Studio preparation for the extended matrix', () => {
  assert.deepEqual(parseArgs([]), { group: 'core', only: [], list: false, prepare: true, stopOnFailure: false, help: false });
  const physics = selectSteps(parseArgs(['--only', 'unified physics']));
  assert.deepEqual(physics.checks.map(step => step.name), ['Unified physics public package browser bridge']);
  assert.equal(physics.prepare.length, 5);
  assert.equal(selectSteps(parseArgs(['--group', 'extended'])).prepare.length, 0);
  assert.equal(selectSteps(parseArgs(['--group', 'all', '--skip-prepare'])).checks.length, 59);
  assert.throws(() => selectSteps(parseArgs(['--only', 'no such smoke'])), /no browser smoke matches/);
  assert.throws(() => parseArgs(['--group', 'nightly']), /--group must be one of/);
});

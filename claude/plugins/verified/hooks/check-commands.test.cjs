'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { classify } = require('./claim-patterns.cjs');
const { markChecks } = require('./check-commands.cjs');

const evidence = commands => ({ paths: new Set(), urls: new Set(), printed: new Set(), searches: [], commands, seq: 10, lastWrite: 3, testOut: 0 });
const outcome = r => r.unbacked.filter(u => u.class === 'command-outcome');

test('a run the classifier marks as a check backs "tests pass"', () => {
  const ev = evidence([{ cmd: 'pnpm nx affected -t test,typecheck --base=origin/main', ok: true, seq: 5, check: true }]);
  assert.deepStrictEqual(outcome(classify('All tests pass.', ev)), []);
});

test('the same run without the mark is still unbacked', () => {
  const ev = evidence([{ cmd: 'pnpm nx affected -t test,typecheck --base=origin/main', ok: true, seq: 5 }]);
  assert.strictEqual(outcome(classify('All tests pass.', ev)).length, 1);
});

// Needs the model: run with CLAUDE_PLUGIN_DATA and NODE_PATH pointing at an installed data dir.
test('markChecks marks nx check runs and leaves other commands alone', { skip: !process.env.CLAUDE_PLUGIN_DATA }, async () => {
  const commands = [
    { cmd: 'pnpm nx affected -t test,typecheck,validate-translations --base=origin/main', ok: true },
    { cmd: 'pnpm exec nx run-many -t lint,typecheck,test -p @sciensus/connect-portal', ok: true },
    { cmd: 'git status --short', ok: true },
    { cmd: "sed -i '' 's/\"version\": \"0.9.1\"/\"version\": \"0.9.2\"/' package.json", ok: true },
  ];
  await markChecks(commands);
  assert.deepStrictEqual(commands.map(c => c.check === true), [true, true, false, false]);
});

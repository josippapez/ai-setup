'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createContext } = require('../lib/context.cjs');
const { ensureMemoryStorage, manageMemoriesTool } = require('./manage-memories.cjs');

test('creates a self-ignored memories folder automatically', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-memories-'));
  const context = createContext(root);

  ensureMemoryStorage(context);

  assert.strictEqual(
    fs.readFileSync(path.join(root, '.opencode', 'memories', '.gitignore'), 'utf8'),
    '*\n',
  );
  assert.strictEqual(fs.existsSync(context.memoriesPath), false);
});

test('stores memories in the self-ignored folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-memories-'));
  const context = createContext(root);

  const created = JSON.parse(
    manageMemoriesTool.execute({ action: 'create', content: 'Use pnpm.' }, context),
  );
  const stored = JSON.parse(fs.readFileSync(context.memoriesPath, 'utf8'));

  assert.strictEqual(stored.memories[0].id, created.id);
  assert.strictEqual(stored.memories[0].content, 'Use pnpm.');
});

test('migrates the legacy memory file on first access', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-memories-'));
  const context = createContext(root);
  fs.mkdirSync(path.dirname(context.legacyMemoriesPath), { recursive: true });
  fs.writeFileSync(
    context.legacyMemoriesPath,
    `${JSON.stringify({ memories: [{ id: 'mem_old', scope: 'project', content: 'Legacy.' }] })}\n`,
  );

  const memories = JSON.parse(manageMemoriesTool.execute({ action: 'list' }, context));

  assert.strictEqual(memories[0].id, 'mem_old');
  assert.strictEqual(fs.existsSync(context.legacyMemoriesPath), false);
  assert.strictEqual(fs.existsSync(context.memoriesPath), true);
});

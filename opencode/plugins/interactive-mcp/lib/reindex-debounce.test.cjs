'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { claimReindex, DEBOUNCE_MS } = require('./reindex-debounce.cjs');

test('claims once per debounce window and refreshes stale locks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-reindex-'));
  const lock = path.join(root, 'reindex.lock');
  const start = Date.now();

  assert.strictEqual(claimReindex(lock, start), true);
  fs.utimesSync(lock, start / 1000, start / 1000);
  assert.strictEqual(claimReindex(lock, start + DEBOUNCE_MS - 1), false);
  assert.strictEqual(claimReindex(lock, start + DEBOUNCE_MS + 1), true);
});

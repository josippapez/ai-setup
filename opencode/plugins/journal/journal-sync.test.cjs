'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// This plugin runs a copy of the Claude Code journal core. Fix a failure by copying
// the file from the source.
const SOURCE = path.join(__dirname, '..', '..', '..', 'claude', 'plugins', 'journal', 'hooks');

test('the journal core matches the Claude Code plugin', { skip: !fs.existsSync(SOURCE) && 'source repo not present (installed copy)' }, () => {
  const drifted = ['journal.cjs', 'describe.swift'].filter(f => !fs.readFileSync(path.join(__dirname, f)).equals(fs.readFileSync(path.join(SOURCE, f))));
  assert.deepStrictEqual(drifted, [], `copy these from ${path.relative(process.cwd(), SOURCE)}`);
});

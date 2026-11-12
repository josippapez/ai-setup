'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { findLibsTool } = require('./find-libs.cjs');

function writeJson(root, rel, value) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(value));
}

// Ranges are declared in package.json, the resolved versions and keywords live in
// node_modules, and luxon is declared but not installed.
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'findlibs-'));
  writeJson(root, 'package.json', {
    dependencies: { react: '^18.2.0', dayjs: '^1.11.0', 'date-fns': '^4.0.0', luxon: '^3.0.0' },
    devDependencies: { zod: '^3.22.0' },
  });
  writeJson(root, 'node_modules/react/package.json', {
    version: '18.3.1',
    description: 'React is a JavaScript library for building user interfaces.',
    keywords: ['react'],
  });
  writeJson(root, 'node_modules/dayjs/package.json', { version: '1.11.11', keywords: ['dayjs', 'date', 'time'] });
  writeJson(root, 'node_modules/date-fns/package.json', { version: '4.4.0', description: 'Modern JavaScript date utility library' });
  writeJson(root, 'node_modules/zod/package.json', { version: '3.23.8', keywords: ['validation'] });
  return root;
}

test('reports the declared range and the version installed in node_modules', () => {
  const out = findLibsTool.execute({ query: 'react' }, { root: makeRepo() });
  assert.match(out, /^react@\^18\.2\.0 dependency installed 18\.3\.1$/m);
});

test('says when a declared package is not in node_modules', () => {
  const out = findLibsTool.execute({ query: 'luxon' }, { root: makeRepo() });
  assert.match(out, /^luxon@\^3\.0\.0 dependency not in node_modules$/m);
});

test('a category word also matches the keywords of installed packages, not their descriptions', () => {
  const out = findLibsTool.execute({ query: 'date library' }, { root: makeRepo() });
  const names = out.split('\n').slice(1).map((line) => line.split('@')[0]);
  assert.deepStrictEqual(names, ['date-fns', 'dayjs']);
});

test('a dependency name cannot send the lookup outside node_modules', () => {
  const root = makeRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'findlibs-outside-'));
  writeJson(outside, 'package.json', { version: '9.9.9' });
  const name = `../../${path.basename(outside)}`;
  writeJson(root, 'package.json', { dependencies: { [name]: '1.0.0' } });
  const out = findLibsTool.execute({ query: path.basename(outside) }, { root });
  assert.match(out, / not in node_modules$/m);
});

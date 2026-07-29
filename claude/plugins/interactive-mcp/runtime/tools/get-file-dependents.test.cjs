'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createContext } = require('../lib/context.cjs');
const { fileDependentsTool } = require('./get-file-dependents.cjs');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// A lib whose barrel re-exports a leaf hook, consumed by an app that imports the
// package by name — the shape that made a one-hop query read as "no consumers".
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-tool-'));
  writeFile(root, 'libs/web-lib/package.json', '{"name":"@scope/web-lib"}');
  writeFile(root, 'libs/web-lib/src/index.ts', "export * from './useLocale';");
  writeFile(root, 'libs/web-lib/src/useLocale.ts', 'export const useLocale = () => 1;');
  writeFile(root, 'apps/web/src/App.tsx', "import { useLocale } from '@scope/web-lib';");
  return root;
}

test('warns when every dependent is a barrel re-export', async () => {
  const out = await fileDependentsTool.execute(
    { path: 'libs/web-lib/src/useLocale.ts' },
    createContext(makeRepo()),
  );
  assert.match(out, /libs\/web-lib\/src\/index\.ts/);
  assert.match(out, /^note\tEvery dependent above is a barrel/m);
});

test('does not warn when a real consumer imports the file', async () => {
  const out = await fileDependentsTool.execute(
    { path: 'libs/web-lib/src/index.ts' },
    createContext(makeRepo()),
  );
  assert.match(out, /apps\/web\/src\/App\.tsx/);
  assert.doesNotMatch(out, /^note\t/m);
});

test('an empty result says so instead of implying the file is unused', async () => {
  const root = makeRepo();
  writeFile(root, 'libs/web-lib/src/orphan.ts', 'export const orphan = 1;');
  const out = await fileDependentsTool.execute(
    { path: 'libs/web-lib/src/orphan.ts' },
    createContext(root),
  );
  assert.match(out, /^none$/m);
  assert.match(out, /^note\tOne hop only/m);
});

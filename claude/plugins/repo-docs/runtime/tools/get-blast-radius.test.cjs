'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createContext } = require('../lib/context.cjs');
const { blastRadiusTool } = require('./get-blast-radius.cjs');

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-tool-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 1;');
  fs.writeFileSync(path.join(root, 'src/b.ts'), "import { a } from './a';");
  return root;
}

test('accepts a path written with a leading ./', async () => {
  const out = await blastRadiusTool.execute({ paths: ['./src/a.ts'] }, createContext(makeRepo()));
  assert.match(out, /^d1\tsrc\/b\.ts\tvia src\/a\.ts$/m);
});

test('a path that is not in the import graph is reported, not shown as a blast radius of zero', async () => {
  const out = await blastRadiusTool.execute({ paths: ['src/a.ts', 'src/typo.ts'] }, createContext(makeRepo()));
  assert.match(out, /^not in the import graph\tsrc\/typo\.ts\t/m);
  assert.doesNotMatch(out, /^d0\tsrc\/typo\.ts/m);
  assert.match(out, /^d1\tsrc\/b\.ts\tvia src\/a\.ts$/m);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createContext } = require('./context.cjs');
const { ensureDependencyIndex } = require('./dependency-index.cjs');

function writeFile(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// A small monorepo fixture: a `ui` lib and a `utils` lib, consumed by an `app`
// entry through tsconfig `paths` aliases plus one relative import.
function makeRepo(tsconfig) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depidx-'));
  writeFile(root, 'tsconfig.base.json', tsconfig);
  writeFile(root, 'packages/ui/src/index.ts', 'export const Button = 1;\n');
  writeFile(root, 'packages/utils/src/format.ts', 'export const fmt = 2;\n');
  writeFile(
    root,
    'apps/dashboard/src/main.ts',
    [
      "import { Button } from '@repo/ui';",
      "import { fmt } from '@repo/utils/format';",
      "import { boot } from './bootstrap';",
      "import { createServer } from 'node:http';",
      'export const app = Button + fmt + boot + createServer;',
    ].join('\n'),
  );
  writeFile(root, 'apps/dashboard/src/bootstrap.ts', 'export const boot = 3;\n');
  return root;
}

test('resolves @alias exact-key and wildcard imports to their target files', async () => {
  const root = makeRepo(
    JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@repo/ui': ['packages/ui/src/index.ts'],
          '@repo/utils/*': ['packages/utils/src/*'],
        },
      },
    }),
  );
  const context = createContext(root);
  const index = await ensureDependencyIndex(context);

  const edges = index.dependenciesByFile.get('apps/dashboard/src/main.ts');
  const resolved = Object.fromEntries(edges.map((e) => [e.specifier, e.to]));

  assert.strictEqual(resolved['@repo/ui'], 'packages/ui/src/index.ts');
  assert.strictEqual(resolved['@repo/utils/format'], 'packages/utils/src/format.ts');
  assert.strictEqual(resolved['./bootstrap'], 'apps/dashboard/src/bootstrap.ts');
  assert.strictEqual(resolved['node:http'], null); // bare import stays external
});

test('alias importers now appear as dependents (blast radius)', async () => {
  const root = makeRepo(
    JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@repo/ui': ['packages/ui/src/index.ts'] },
      },
    }),
  );
  const context = createContext(root);
  const index = await ensureDependencyIndex(context);

  const dependents = index.dependentsByFile.get('packages/ui/src/index.ts') || [];
  assert.ok(
    dependents.some((e) => e.from === 'apps/dashboard/src/main.ts'),
    'the app (which imports @repo/ui via alias) must be a dependent of ui',
  );
});

test('tolerates JSONC comments and trailing commas in tsconfig', async () => {
  const root = makeRepo(
    [
      '{',
      '  // workspace base config',
      '  "compilerOptions": {',
      '    "baseUrl": ".",',
      '    "paths": {',
      '      "@repo/ui": ["packages/ui/src/index.ts"], /* the ui lib */',
      '    },',
      '  },',
      '}',
    ].join('\n'),
  );
  const context = createContext(root);
  const index = await ensureDependencyIndex(context);
  const edges = index.dependenciesByFile.get('apps/dashboard/src/main.ts');
  const ui = edges.find((e) => e.specifier === '@repo/ui');
  assert.strictEqual(ui.to, 'packages/ui/src/index.ts');
});

test('missing tsconfig degrades to relative-only resolution', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depidx-noconfig-'));
  writeFile(root, 'src/index.ts', "import helper from './helper';");
  writeFile(root, 'src/helper.ts', 'export default 1;');
  const context = createContext(root);
  const index = await ensureDependencyIndex(context);
  const edges = index.dependenciesByFile.get('src/index.ts');
  assert.strictEqual(edges[0].to, 'src/helper.ts');
});

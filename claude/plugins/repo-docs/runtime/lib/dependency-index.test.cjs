'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createContext } = require('./context.cjs');
const {
  ensureDependencyIndex,
  invalidateDependencyIndex,
} = require('./dependency-index.cjs');

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

// A workspace monorepo with NO tsconfig `paths`: the app imports the lib by its
// package.json name, the way pnpm/npm workspaces resolve it. The lib's barrel
// re-exports a leaf hook. This is the shape that used to report the leaf as
// having a single dependent (its own barrel) and no consumers at all.
function makeWorkspaceRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depidx-ws-'));
  writeFile(root, 'package.json', '{"name":"root","workspaces":["libs/*","apps/*"]}');
  writeFile(root, 'libs/web-lib/package.json', '{"name":"@scope/web-lib"}');
  writeFile(root, 'libs/web-lib/src/index.ts', "export * from './useLocale';");
  writeFile(root, 'libs/web-lib/src/useLocale.ts', 'export const useLocale = () => 1;');
  writeFile(root, 'libs/web-lib/src/format.ts', 'export const format = () => 2;');
  writeFile(
    root,
    'apps/web/package.json',
    '{"name":"@scope/web","dependencies":{"@scope/web-lib":"*"}}',
  );
  writeFile(
    root,
    'apps/web/src/App.tsx',
    [
      "import { useLocale } from '@scope/web-lib';",
      "import { format } from '@scope/web-lib/format';",
      'export const App = () => useLocale() + format();',
    ].join('\n'),
  );
  return root;
}

test('resolves workspace-package imports without any tsconfig paths', async () => {
  const context = createContext(makeWorkspaceRepo());
  const index = await ensureDependencyIndex(context);
  const edges = index.dependenciesByFile.get('apps/web/src/App.tsx');
  const resolved = Object.fromEntries(edges.map((e) => [e.specifier, e.to]));

  assert.strictEqual(resolved['@scope/web-lib'], 'libs/web-lib/src/index.ts');
  assert.strictEqual(resolved['@scope/web-lib/format'], 'libs/web-lib/src/format.ts');
});

test('workspace consumers reach a barrel-re-exported leaf via blast radius', async () => {
  const context = createContext(makeWorkspaceRepo());
  const index = await ensureDependencyIndex(context);

  const leafDependents = index.dependentsByFile.get('libs/web-lib/src/useLocale.ts') || [];
  assert.deepStrictEqual(
    leafDependents.map((e) => e.from),
    ['libs/web-lib/src/index.ts'],
    'one hop still stops at the barrel — that is why the tool warns about it',
  );

  const barrelDependents = index.dependentsByFile.get('libs/web-lib/src/index.ts') || [];
  assert.ok(
    barrelDependents.some((e) => e.from === 'apps/web/src/App.tsx'),
    'the app importing the package by name must be a dependent of the barrel',
  );
});

test('invalidateDependencyIndex forces the next call to pick up new files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depidx-invalidate-'));
  writeFile(root, 'src/index.ts', "import helper from './helper';");
  writeFile(root, 'src/helper.ts', 'export default 1;');
  const context = createContext(root);
  const first = await ensureDependencyIndex(context);

  writeFile(root, 'src/late.ts', "import helper from './helper';");
  const cached = await ensureDependencyIndex(context);
  assert.strictEqual(cached, first, 'without invalidation the cached graph is reused');

  invalidateDependencyIndex(context);
  const rebuilt = await ensureDependencyIndex(context);
  assert.notStrictEqual(rebuilt, first);
  assert.strictEqual(rebuilt.dependenciesByFile.get('src/late.ts')[0].to, 'src/helper.ts');
});

test('an in-flight build superseded by invalidation does not commit a stale graph', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'depidx-supersede-'));
  // Enough files that the build yields to the event loop mid-way (every 50
  // files), leaving a window where invalidation arrives while it is in flight.
  for (let i = 0; i < 60; i += 1) writeFile(root, `src/mod${i}.ts`, 'export {};\n');
  writeFile(root, 'src/helper.ts', 'export default 1;');
  const context = createContext(root);

  const stale = ensureDependencyIndex(context); // parses 50 files, parks at the yield
  invalidateDependencyIndex(context);
  writeFile(root, 'src/late.ts', "import helper from './helper';");
  await stale; // finishes against its old file list — must NOT become the cached graph

  const rebuilt = await ensureDependencyIndex(context);
  assert.ok(
    rebuilt.dependenciesByFile.has('src/late.ts'),
    'post-invalidation build must see the new file',
  );
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

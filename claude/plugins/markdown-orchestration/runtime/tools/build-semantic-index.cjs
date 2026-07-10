#!/usr/bin/env node
'use strict';

const { createContext } = require('../lib/context.cjs');
const { getDocFiles } = require('../lib/docs.cjs');
const { buildSemanticIndex, shutdown } = require('../lib/semantic-index.cjs');

(async () => {
  const context = createContext(process.argv[2] || process.cwd());
  const result = await buildSemanticIndex(context, getDocFiles(context));
  process.stdout.write(
    `semantic_index updated=${result.updated} unchanged=${result.unchanged} skipped=${result.skipped} cache=${result.cachePath}\n`,
  );
  await shutdown();
})().catch((err) => {
  process.stderr.write(`semantic_index error: ${err.message}\n`);
  process.exit(1);
});

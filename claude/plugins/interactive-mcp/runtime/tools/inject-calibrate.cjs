'use strict';
// Usage: NODE_PATH=<plugin-data>/node_modules node inject-calibrate.cjs <repo-root> "query one" "query two" ...
// Prints, per query, the top-5 hit scores so a human can pick REPO_DOCS_INJECT_THRESHOLD.
const { createContext } = require('../lib/context.cjs');
const { warmUp, waitUntilReady, shutdown } = require('../lib/semantic-index.cjs');
const { rankDocs } = require('../lib/doc-search.cjs');

(async () => {
  const [root, ...queries] = process.argv.slice(2);
  if (!root || queries.length === 0) { process.stderr.write('usage: inject-calibrate.cjs <root> <query...>\n'); process.exit(1); }
  const context = createContext(root);
  warmUp();
  if (!(await waitUntilReady())) { process.stderr.write('embedder not ready\n'); process.exit(1); }
  for (const q of queries) {
    const hits = await rankDocs(context, { query: q, limit: 5, threshold: 0 });
    process.stdout.write(`\n"${q}"\n`);
    hits.forEach(h => process.stdout.write(`  ${h.score.toFixed(4)}  ${h.path}:${h.startLine}\n`));
    if (hits.length === 0) process.stdout.write('  (no hits)\n');
  }
  await shutdown();
})().catch((e) => { process.stderr.write(`calibrate error: ${e.message}\n`); process.exit(1); });

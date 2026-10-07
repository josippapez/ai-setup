'use strict';

// Marks Bash commands TEST_CMD_RE does not know (nx, turbo, custom scripts) as checks when a local
// classifier is at least 90% sure: multilingual-e5-small embeddings plus logistic weights trained on
// Haiku-labelled ledger commands. Only adds checks the regex missed, so it can lift a false block
// but never adds one. Without the model (before the first install) it does nothing.

const path = require('node:path');
const MODEL = require('./check-model.json');
const { TEST_CMD_RE } = require('./claim-patterns.cjs');

let extract;
async function embedder() {
  if (extract) return extract;
  // NODE_PATH points at the plugin data dir; ESM import() ignores it, so resolve through require.
  const entry = require.resolve('@huggingface/transformers');
  const { pipeline, env } = await import(require('node:url').pathToFileURL(entry).href);
  env.cacheDir = path.join(process.env.CLAUDE_PLUGIN_DATA, 'models');
  extract = await pipeline('feature-extraction', MODEL.model, { dtype: MODEL.dtype });
  return extract;
}

const score = vector => vector.reduce((sum, value, i) => sum + value * MODEL.weights[i], MODEL.bias);

async function markChecks(commands) {
  const unknown = commands.filter(c => c.ok && !TEST_CMD_RE.test(c.cmd));
  if (!unknown.length) return;
  const embed = await embedder();
  for (const c of unknown) {
    const output = await embed(MODEL.prefix + c.cmd.slice(0, MODEL.maxChars), { pooling: 'mean', normalize: true });
    if (score(Array.from(output.data)) >= MODEL.cutoff) c.check = true;
  }
}

module.exports = { markChecks, score, embedder };

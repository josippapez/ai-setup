'use strict';

// Marks Bash commands TEST_CMD_RE does not know (nx, turbo, custom scripts) as checks when a local
// classifier is at least 90% sure: multilingual-e5-small embeddings plus logistic weights trained on
// Haiku-labelled ledger commands. Only adds checks the regex missed, so it can lift a false block
// but never adds one. Without the model (before the first install) it does nothing.

const path = require('node:path');
const MODEL = require('./check-model.json');
const { TEST_CMD_RE } = require('./claim-patterns.cjs');
const client = require('./model-client.cjs');

const CACHE_DIR = path.join(require('node:os').homedir(), '.claude', 'models');

let extract;
async function embedder() {
  if (extract) return extract;
  // NODE_PATH points at the plugin data dir; ESM import() ignores it, so resolve through require.
  const entry = require.resolve('@huggingface/transformers');
  const { pipeline, env } = await import(require('node:url').pathToFileURL(entry).href);
  // Shared by the feedback and verified plugins, so the model is downloaded and stored once.
  env.cacheDir = CACHE_DIR;
  extract = await pipeline('feature-extraction', MODEL.model, { dtype: MODEL.dtype });
  return extract;
}

const score = vector => vector.reduce((sum, value, i) => sum + value * MODEL.weights[i], MODEL.bias);

// Scored whole, `git diff && nx run-many -t lint,typecheck ... ; git commit` fell under the cutoff
// (1.72) while its nx part alone scored 4.52, so each chained part is scored on its own.
const partsOf = cmd => cmd.split(/&&|\|\||;|\n/).map(p => p.trim()).filter(Boolean);
const textOf = part => MODEL.prefix + part.slice(0, MODEL.maxChars);

// Only runs at or after `since` (the last write) can back an outcome claim. Embedding the whole
// session's commands cost one model run per command on every Stop: 224 a Stop on average.
// The shared model server gets every part in one call; this process loads the model itself only
// when the server can't be used.
async function markChecks(commands, since = 0, deps = {}) {
  const unknown = commands.filter(c => c.ok && (c.seq || 0) >= since && !TEST_CMD_RE.test(c.cmd));
  if (!unknown.length) return;
  const owners = [];
  const texts = [];
  for (const c of unknown) {
    for (const part of partsOf(c.cmd)) { owners.push(c); texts.push(textOf(part)); }
  }
  const res = await (deps.client || client.embed)({
    model: MODEL.model,
    texts,
    load: { dtype: MODEL.dtype, cacheDir: CACHE_DIR },
    pooling: 'mean',
    normalize: true,
    priority: 'query',
  }).catch(() => null);
  const vectors = res && res.vectors;
  if (vectors && vectors.length === texts.length && vectors.every(Boolean)) {
    vectors.forEach((v, i) => { if (score(v) >= MODEL.cutoff) owners[i].check = true; });
    return;
  }
  const embed = await (deps.embedder || embedder)();
  for (const c of unknown) {
    for (const part of partsOf(c.cmd)) {
      const output = await embed(textOf(part), { pooling: 'mean', normalize: true });
      if (score(Array.from(output.data)) >= MODEL.cutoff) { c.check = true; break; }
    }
  }
}

module.exports = { markChecks, score, embedder };

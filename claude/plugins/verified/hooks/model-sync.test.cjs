'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// These two files are copies of the repo-docs model server. Fix a failure by copying them from
// the source.
const SOURCE = path.join(__dirname, '..', '..', 'repo-docs', 'runtime', 'lib');

test('the model server and client match the repo-docs copies', { skip: !fs.existsSync(SOURCE) && 'source plugin not present (installed copy)' }, () => {
  const drifted = ['model-server.cjs', 'model-client.cjs'].filter(f => !fs.readFileSync(path.join(__dirname, f)).equals(fs.readFileSync(path.join(SOURCE, f))));
  assert.deepStrictEqual(drifted, [], `copy these from ${path.relative(process.cwd(), SOURCE)}`);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const STYLE = path.join(__dirname, 'concise-output.md');
const PLUGIN = path.join(__dirname, '..');

function frontmatter(body) {
  const m = body.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(m, 'style file must open with YAML frontmatter');
  return Object.fromEntries(
    m[1].split(/\r?\n/).filter(Boolean).map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
}

test('style keeps the built-in coding instructions and applies with the plugin', () => {
  const fm = frontmatter(fs.readFileSync(STYLE, 'utf8'));
  assert.strictEqual(fm.name, 'concise-output');
  assert.ok(fm.description, 'description shows in the /config picker');
  // Without this, Claude Code drops its own software engineering instructions.
  assert.strictEqual(fm['keep-coding-instructions'], 'true');
  assert.strictEqual(fm['force-for-plugin'], 'true');
});

test('the rules the style replaced are no longer double-injected as rules/', () => {
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'rules')), 'rules/ moved into the output style');
  assert.ok(!fs.existsSync(path.join(PLUGIN, 'hooks', 'inject-rules.cjs')), 'SessionStart rule injection removed');
  const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepStrictEqual(Object.keys(hooks), ['UserPromptSubmit'], 'only the per-prompt digest remains');
});

test('style carries the substance of both former rules', () => {
  const body = fs.readFileSync(STYLE, 'utf8');
  for (const marker of [
    'Answer the question. Stop.',        // concise-output
    'Exempt: agent-to-agent traffic',    // the exemption subagents rely on
    'Outbound content',                  // former outbound-content rule
    'Not a licence to under-deliver',    // the anti-under-delivery guard
  ]) assert.ok(body.includes(marker), marker);
});

test('the digest reminder describes where the full rules actually live', () => {
  const digestHook = fs.readFileSync(path.join(PLUGIN, 'hooks', 'inject-rules-digest.cjs'), 'utf8');
  assert.match(digestHook, /output-styles/, 'hook detects the output-style mechanism');
  assert.match(digestHook, /active output style/);
});

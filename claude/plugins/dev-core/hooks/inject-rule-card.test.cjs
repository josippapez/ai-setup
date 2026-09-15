'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'inject-rule-card.cjs');
const REAL_ROOT = path.join(__dirname, '..');

function tmpRoot(cards) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-card-'));
  fs.mkdirSync(path.join(root, 'rule-cards'));
  for (const [file, body] of Object.entries(cards)) {
    fs.writeFileSync(path.join(root, 'rule-cards', file), body);
  }
  return root;
}

// Returns the additionalContext string, or null when the hook emitted nothing.
function run(root, args, event) {
  const out = execFileSync('node', [HOOK, ...args], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: root },
    input: JSON.stringify(event),
    encoding: 'utf8',
  });
  if (!out.trim()) return null;
  return JSON.parse(out).hookSpecificOutput.additionalContext;
}

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rule-card-state-'));

test('emits the card body without its frontmatter', () => {
  const root = tmpRoot({ 'demo.md': '---\nname: demo\n---\n\n# Demo\n\nBody text.' });
  const ctx = run(root, ['demo'], { scratchpad_dir: scratch() });
  assert.match(ctx, /# Demo/);
  assert.match(ctx, /Body text\./);
  assert.doesNotMatch(ctx, /name: demo/);
});

// The debounce window the hook ships with, mirrored here so a change to one fails the other.
const DEBOUNCE_MS = 2 * 60 * 1000;

// The state file holds the epoch ms the card last fired at, so a test can age it
// without waiting two real minutes.
const ageState = (dir, card, ms, agent = 'main') =>
  fs.writeFileSync(path.join(dir, `.dev-core-card-${agent}-${card}`), String(Date.now() - ms));

test('fires at most once inside the debounce window', () => {
  const root = tmpRoot({ 'demo.md': '# Demo' });
  const dir = scratch();
  assert.ok(run(root, ['demo'], { scratchpad_dir: dir }));
  assert.equal(run(root, ['demo'], { scratchpad_dir: dir }), null);
  ageState(dir, 'demo', DEBOUNCE_MS - 5000);
  assert.equal(run(root, ['demo'], { scratchpad_dir: dir }), null, 'still inside the window');
});

test('re-arms once the debounce window has passed', () => {
  const root = tmpRoot({ 'demo.md': '# Demo' });
  const dir = scratch();
  assert.ok(run(root, ['demo'], { scratchpad_dir: dir }));
  ageState(dir, 'demo', DEBOUNCE_MS + 1000);
  assert.ok(run(root, ['demo'], { scratchpad_dir: dir }));
});

test('a corrupt or future timestamp re-arms rather than locking the card out', () => {
  const root = tmpRoot({ 'demo.md': '# Demo' });
  for (const stamp of ['not-a-number', String(Date.now() + 10 * 60 * 1000)]) {
    const dir = scratch();
    fs.writeFileSync(path.join(dir, '.dev-core-card-main-demo'), stamp);
    assert.ok(run(root, ['demo'], { scratchpad_dir: dir }), `should fire for: ${stamp}`);
  }
});

test('each agent keeps its own debounce window', () => {
  const root = tmpRoot({ 'demo.md': '# Demo' });
  const dir = scratch();
  assert.ok(run(root, ['demo'], { scratchpad_dir: dir }));
  assert.ok(run(root, ['demo'], { scratchpad_dir: dir, agent_id: 'sub1' }));
  assert.equal(run(root, ['demo'], { scratchpad_dir: dir, agent_id: 'sub1' }), null);
});

test('two cards debounce independently', () => {
  const root = tmpRoot({ 'a.md': '# A', 'b.md': '# B' });
  const dir = scratch();
  assert.match(run(root, ['a'], { scratchpad_dir: dir }), /# A/);
  assert.match(run(root, ['b'], { scratchpad_dir: dir }), /# B/);
});

test('`requires` skips the card unless the path exists under cwd', () => {
  const root = tmpRoot({ 'demo.md': '---\nrequires: .codegraph\n---\n# Demo' });
  const cwd = scratch();
  assert.equal(run(root, ['demo'], { cwd, scratchpad_dir: scratch() }), null);
  fs.mkdirSync(path.join(cwd, '.codegraph'));
  assert.ok(run(root, ['demo'], { cwd, scratchpad_dir: scratch() }));
});

test('the argv path filter matches against the tool input', () => {
  const root = tmpRoot({ 'demo.md': '# Demo' });
  const args = ['demo', '(^|/)node_modules/'];
  const base = { scratchpad_dir: scratch() };
  assert.equal(run(root, args, { ...base, tool_input: { file_path: '/r/src/a.ts' } }), null);
  assert.ok(run(root, args, { ...base, tool_input: { file_path: '/r/node_modules/react/i.js' } }));
});

test('a missing card, a bad name, and a bad regex all emit nothing', () => {
  const root = tmpRoot({ 'demo.md': '# Demo' });
  const ev = { scratchpad_dir: scratch() };
  assert.equal(run(root, ['nope'], ev), null);
  assert.equal(run(root, ['../secrets'], ev), null);
  assert.equal(run(root, ['demo', '('], ev), null);
});

test('every shipped card is under the additionalContext cap and has a body', () => {
  const dir = path.join(REAL_ROOT, 'rule-cards');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.ok(files.length > 0, 'no rule cards found');
  for (const f of files) {
    const ctx = run(REAL_ROOT, [path.basename(f, '.md')], {
      cwd: REAL_ROOT,
      scratchpad_dir: scratch(),
    });
    // `searching` is gated on .codegraph/, which this plugin directory does not have.
    if (ctx === null) continue;
    assert.ok(ctx.length < 10000, `${f} too big: ${ctx.length}`);
    assert.ok(ctx.includes('#'), `${f} has no body`);
  }
});

test('the registered Bash patterns fire on real command shapes', () => {
  const bash = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8'))
    .hooks.PreToolUse.find((g) => g.matcher === 'Bash').hooks;
  // Pull each card's regex straight out of hooks.json so the test tracks the shipped config.
  const patternFor = (card) => {
    const h = bash.find((e) => e.command.includes(`.cjs" ${card} '`));
    return new RegExp(h.command.match(/'(.*)'$/)[1].replace(/\\\\/g, '\\'));
  };
  // Commands recorded from the 2026-09-14 benchmark, where the model did every file
  // read, write, search and move through Bash and no tool-name matcher ever fired.
  const cases = [
    ['writing-code', "cat >> src/math.js <<'EOF'", true],
    ['writing-code', `sed -i '' "s|'./utils.js'|'./helpers.js'|" src/index.js`, true],
    ['writing-code', 'git status --short', false],
    ['writing-code', 'node -e "x" > /dev/null', false],
    ['searching', 'grep -rn "pricing" --include="*.js" .', true],
    ['searching', 'find . -name "pricing*"', true],
    ['searching', 'codegraph explore "where is discount"', true],
    ['searching', 'cat -n src/pricing.js', false],
    ['reading-libraries', 'cat -n node_modules/tiny-dep/package.json', true],
    ['reading-libraries', 'find node_modules/tiny-dep -type f', true],
    ['reading-libraries', '/repo/node_modules/tiny-dep/index.js', true],
    ['reading-libraries', 'cat -n src/math.js', false],
    ['git-commit', 'git add -A && git commit -m x', true],
    ['git-commit', 'node --check x.cjs && rg -n DEBOUNCE x.cjs', false],
  ];
  for (const [card, cmd, want] of cases) {
    assert.equal(patternFor(card).test(cmd), want, `${card} on: ${cmd}`);
  }
});

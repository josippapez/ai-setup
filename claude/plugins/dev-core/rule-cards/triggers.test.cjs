'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// The rule-card mod (hooks/rule-cards.ts) reads these triggers; this checks them against
// command shapes the model actually produced, with plain Node, no Claude Code needed.
const DIR = path.join(__dirname, '..', 'rule-cards');
const triggers = JSON.parse(fs.readFileSync(path.join(DIR, 'triggers.json'), 'utf8'));

test('every trigger names a card that exists and is under the context cap', () => {
  for (const t of triggers) {
    const file = path.join(DIR, `${t.card}.md`);
    assert.ok(fs.existsSync(file), `missing card ${t.card}`);
    assert.ok(fs.readFileSync(file, 'utf8').length < 9000, `${t.card} too big`);
    for (const re of [t.fire, t.skip]) if (re) new RegExp(re);
  }
});

test('the Bash triggers fire on real command shapes', () => {
  const argsFor = (card) => triggers.find((t) => t.card === card && t.tools.includes('Bash'));
  const patternFor = (card) => new RegExp(argsFor(card).fire);
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

  // Naming a path is not working on it. These fired the wrong card during this plugin's
  // own audit: a find that excludes node_modules, and a grep over a Markdown file.
  const fires = (card, cmd) => {
    const { fire, skip } = argsFor(card);
    return new RegExp(fire).test(cmd) && !(skip && new RegExp(skip).test(cmd));
  };
  const skipCases = [
    ['reading-libraries', 'find . -type f -not -path "./node_modules/*"', false],
    ['reading-libraries', 'find . -path ./node_modules -prune -o -type f -print', false],
    ['reading-libraries', "rg -n foo -g '!node_modules' .", false],
    ['reading-libraries', 'grep -rn x --exclude-dir=node_modules .', false],
    ['reading-libraries', 'cat -n node_modules/tiny-dep/package.json', true],
    ['reading-libraries', 'rg -n useState node_modules/react/', true],
    ['searching', 'rg -c "digest|UserPromptSubmit" README.md', false],
    ['searching', "rg -n TODO --glob '*.md' .", false],
    ['searching', "find . -name '*.md'", false],
    ['searching', 'rg -n useAuth src/', true],
    ['searching', 'grep -rn handleSubmit src/app.ts', true],
    ['searching', "rg -n foo -g '!tmp' .", true],
  ];
  for (const [card, cmd, want] of skipCases) {
    assert.equal(fires(card, cmd), want, `${card} should ${want ? 'fire' : 'skip'} on: ${cmd}`);
  }
});

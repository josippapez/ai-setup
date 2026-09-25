'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { chunkMarkdown } = require('./chunker.cjs');

test('splits on headings and records the heading breadcrumb', () => {
  const md = '# Title\nintro line\n## Section A\nalpha content here\n### Sub\nbeta content here';
  const chunks = chunkMarkdown(md);
  assert.ok(chunks.length >= 2);
  const sub = chunks.find(c => c.text.includes('beta content'));
  assert.strictEqual(sub.headingPath, 'Title › Section A › Sub');
  assert.ok(sub.startLine >= 1);
});

test('packs long sections into overlapping windows', () => {
  const body = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const chunks = chunkMarkdown('# H\n' + body, { maxChars: 300, overlap: 50 });
  assert.ok(chunks.length > 1);
  // overlap: end of chunk[0] reappears at start of chunk[1]
  const tail = chunks[0].text.slice(-30);
  assert.ok(chunks[1].text.includes(tail.trim().split(' ')[0]));
});

test('keeps every part of a very long section instead of stopping at a chunk cap', () => {
  const body = 'x '.repeat(100000) + 'END_MARKER';
  const chunks = chunkMarkdown('# H\n' + body, { maxChars: 200, overlap: 0 });
  assert.ok(chunks.length > 200);
  assert.ok(chunks[chunks.length - 1].text.endsWith('END_MARKER'));
});

test('cuts a window short when it would pass maxTokens, without dropping or splitting words', () => {
  const words = Array.from({ length: 300 }, (_, i) => `w${i}`);
  const countTokens = s => s.split(/\s+/).filter(Boolean).length;
  const chunks = chunkMarkdown(`# T\n${words.join(' ')}`, { maxChars: 10000, overlap: 0, maxTokens: 50, countTokens });
  assert.ok(chunks.length >= 6);
  assert.ok(chunks.every(c => countTokens(c.text) <= 50));
  const seen = new Set(chunks.flatMap(c => c.text.split(/\s+/)));
  assert.ok(words.every(w => seen.has(w)), 'every word lands in a chunk');
  assert.ok([...seen].every(w => !w || w === '#' || w === 'T' || words.includes(w)), 'no word is split across chunks');
});

test('windows that fit maxTokens are cut exactly as without a token counter', () => {
  const md = '# T\n' + 'lorem ipsum dolor '.repeat(400);
  assert.deepStrictEqual(chunkMarkdown(md, { maxTokens: 10000, countTokens: s => s.length }), chunkMarkdown(md));
});

test('empty input yields no chunks', () => {
  assert.deepStrictEqual(chunkMarkdown(''), []);
});

test('does not treat a # comment line inside a fenced code block as a heading', () => {
  const md = '# Title\n```bash\n# this is a shell comment, not a heading\necho hi\n```\nafter fence';
  const chunks = chunkMarkdown(md);
  assert.strictEqual(chunks.length, 1);
  assert.strictEqual(chunks[0].headingPath, 'Title');
  assert.ok(chunks[0].text.includes('# this is a shell comment'));
});

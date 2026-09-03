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

test('honors maxChunks safety cap', () => {
  const body = 'x '.repeat(100000);
  const chunks = chunkMarkdown('# H\n' + body, { maxChars: 200, overlap: 0, maxChunks: 5 });
  assert.strictEqual(chunks.length, 5);
});

test('empty input yields no chunks', () => {
  assert.deepStrictEqual(chunkMarkdown(''), []);
});

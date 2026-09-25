'use strict';

const DEFAULTS = { maxChars: 1500, overlap: 200 };

// Largest end in (start, end] whose slice fits maxTokens, pulled back to the last
// whitespace in the window's second half so a word is not split.
function fitEnd(body, start, end, maxTokens, countTokens) {
  let lo = start + 1, hi = end;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (countTokens(body.slice(start, mid)) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  const cut = Math.max(body.lastIndexOf('\n', lo - 1), body.lastIndexOf(' ', lo - 1));
  return cut > start + (lo - start) / 2 ? cut + 1 : lo;
}

function countNewlines(text, from, to) {
  let count = 0;
  for (let i = from; i < to; i++) if (text[i] === '\n') count++;
  return count;
}

// Split markdown into heading-aware, overlapping chunks. Each chunk keeps the
// breadcrumb of ancestor headings and the 1-based line where it starts. With
// countTokens, a window that would exceed maxTokens is cut shorter, so no chunk
// runs past the embedding model's context and loses its tail.
function chunkMarkdown(text, opts = {}) {
  const { maxChars, overlap, maxTokens, countTokens } = { ...DEFAULTS, ...opts };
  if (!text || !text.trim()) return [];

  const lines = text.split(/\r?\n/);
  const sections = []; // { headingPath, startLine, body }
  const stack = []; // { level, title }
  let current = { headingPath: '', startLine: 1, body: [] };
  let fenceMarker = null; // '```' or '~~~' while inside a fenced code block

  const pushCurrent = () => { if (current.body.join('').trim()) sections.push(current); };

  lines.forEach((line, idx) => {
    // A closing fence must use the opening marker type.
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence && !fenceMarker) fenceMarker = fence[1];
    else if (fence && fence[1] === fenceMarker) fenceMarker = null;
    // A `#` comment inside a fenced code block is content, not a heading.
    const m = !fence && !fenceMarker && /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      pushCurrent();
      const level = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: m[2].trim() });
      current = {
        headingPath: stack.map(s => s.title).join(' › '),
        startLine: idx + 1,
        body: [line],
      };
    } else {
      current.body.push(line);
    }
  });
  pushCurrent();

  const chunks = [];
  for (const sec of sections) {
    const body = sec.body.join('\n');
    let start = 0;
    let startLine = sec.startLine;
    while (start < body.length) {
      let end = Math.min(start + maxChars, body.length);
      if (countTokens && countTokens(body.slice(start, end)) > maxTokens) end = fitEnd(body, start, end, maxTokens, countTokens);
      chunks.push({ headingPath: sec.headingPath, startLine, text: body.slice(start, end) });
      if (end >= body.length) break;
      const nextStart = Math.max(start + 1, end - overlap);
      startLine += countNewlines(body, start, nextStart);
      start = nextStart;
    }
  }
  return chunks;
}

module.exports = { chunkMarkdown, CHUNK_DEFAULTS: DEFAULTS };

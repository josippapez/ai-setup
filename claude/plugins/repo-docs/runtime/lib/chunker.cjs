'use strict';

const DEFAULTS = { maxChars: 1500, overlap: 200, maxChunks: 200 };

// Split markdown into heading-aware, overlapping chunks. Each chunk keeps the
// breadcrumb of ancestor headings and the 1-based line where it starts.
function chunkMarkdown(text, opts = {}) {
  const { maxChars, overlap, maxChunks } = { ...DEFAULTS, ...opts };
  if (!text || !text.trim()) return [];

  const lines = text.split(/\r?\n/);
  const sections = []; // { headingPath, startLine, body }
  const stack = []; // { level, title }
  let current = { headingPath: '', startLine: 1, body: [] };

  const pushCurrent = () => { if (current.body.join('').trim()) sections.push(current); };

  lines.forEach((line, idx) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
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
  const step = Math.max(1, maxChars - overlap);
  for (const sec of sections) {
    const body = sec.body.join('\n');
    for (let i = 0; i < body.length; i += step) {
      if (chunks.length >= maxChunks) return chunks;
      chunks.push({ headingPath: sec.headingPath, startLine: sec.startLine, text: body.slice(i, i + maxChars) });
      if (i + maxChars >= body.length) break;
    }
  }
  return chunks;
}

module.exports = { chunkMarkdown, CHUNK_DEFAULTS: DEFAULTS };

'use strict';
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

function injectSocketPath(root) {
  return path.join(root, '.claude', 'repo-docs', 'inject.sock');
}

// Connect, send one NDJSON request, resolve the parsed reply. Any error, timeout,
// or absent socket → null (caller injects nothing). Socket presence is the gate.
function queryInject(root, req, timeoutMs = 300) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const c = net.connect(injectSocketPath(root));
    const timer = setTimeout(() => { c.destroy(); finish(null); }, timeoutMs);
    let buf = '';
    c.on('connect', () => c.write(JSON.stringify(req) + '\n'));
    c.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      clearTimeout(timer); c.end();
      try { finish(JSON.parse(buf.slice(0, nl))); } catch { finish(null); }
    });
    c.on('error', () => { clearTimeout(timer); finish(null); });
    c.on('close', () => { clearTimeout(timer); finish(null); });
  });
}

// Same query, but tolerant of a cold embedder: the server answers `warming: true`
// immediately (before any ranking) while its model is still loading, which is the
// normal state for the first prompt of a fresh or resumed session. Retry only that
// case — bounded, and cheap because a warming reply is a fast path. A plain miss,
// an absent socket, or a timeout is NOT retried, so a repo without a running server
// pays nothing.
async function queryInjectWithWarmRetry(root, req, timeoutMs, { attempts = 3, delayMs = 250 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    const res = await queryInject(root, req, timeoutMs);
    if (!res?.warming || attempt >= attempts) return res;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

// Per-session record of which docs were already injected, so the same file isn't
// re-surfaced on every message. Shared by the prompt and progress hooks (both
// write the same file). Ticks advance once per injection attempt, so a doc
// becomes eligible again after `windowTicks` of activity: a hit that mattered on
// turn 2 can legitimately matter again on turn 80, and a permanent block would
// hide it forever.
function statePath(root, session) {
  return path.join(root, '.claude', 'repo-docs', 'inject-state', `${session || 'default'}.json`);
}

// v1 was a bare array of paths. Read it as "seen at tick 0" so an upgrade does
// not resurface everything at once.
function loadState(p) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (Array.isArray(raw)) return { tick: 0, seen: Object.fromEntries(raw.map((k) => [k, 0])), remindedDocLookup: false };
    return {
      tick: Number(raw.tick) || 0,
      seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {},
      remindedDocLookup: !!raw.remindedDocLookup,
    };
  } catch { return { tick: 0, seen: {}, remindedDocLookup: false }; }
}

function saveState(p, state) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      v: 2, tick: state.tick, seen: state.seen, remindedDocLookup: !!state.remindedDocLookup,
    }));
  } catch {}
}

// Has the one-time "you haven't used find_docs yet" reminder already fired this
// session? Reuses the per-session state file rather than a second file.
function hasRemindedDocLookup(root, session) {
  return loadState(statePath(root, session)).remindedDocLookup;
}

function markRemindedDocLookup(root, session) {
  const p = statePath(root, session);
  const state = loadState(p);
  saveState(p, { ...state, remindedDocLookup: true });
}

// Drop hits injected within the last `windowTicks`, record the survivors, and
// advance the tick. Returns the hits worth injecting now.
function filterFreshHits(root, session, hits, windowTicks = 20) {
  const p = statePath(root, session);
  const state = loadState(p);
  const tick = state.tick + 1;
  const fresh = (hits || []).filter((h) => {
    const last = state.seen[h.path];
    return last === undefined || tick - last >= windowTicks;
  });
  for (const h of fresh) state.seen[h.path] = tick;
  saveState(p, { tick, seen: state.seen });
  return fresh;
}

// True for unmistakable conversational filler (greetings, acknowledgements,
// yes/no) that should never trigger doc injection regardless of match score.
// Conservative: only whole-string filler; any real question word/content → false.
function isConversationalFiller(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[!.?,\s]+$/g, '');
  if (!t) return true;
  const FILLER = new Set([
    'hi','hello','hey','yo','thanks','thank you','thanks a lot','thx','ty',
    'ok','okay','k','cool','nice','great','perfect','awesome','lgtm','sounds good',
    'looks good','thanks that looks good','yes','no','yep','nope','sure','got it',
    'done','continue','go on','proceed','stop','wait','never mind',
  ]);
  if (FILLER.has(t)) return true;
  // Short pure-greeting/acknowledgement openers with no question or content noun.
  if (/^(hi|hello|hey|thanks|thank you|thx)\b/.test(t) && t.split(/\s+/).length <= 4 && !/\?|how|what|why|where|which|who|when|can you|help me (with|to)\b/.test(t)) return true;
  return false;
}

function formatBlock(hits) {
  if (!hits || hits.length === 0) return '';
  const lines = hits.map((h, i) => {
    const anchor = h.heading ? ` › ${h.heading}` : '';
    return `${i + 1}) ${h.path}:${h.startLine}${anchor} — ${h.snippet}`;
  });
  return `[repo-docs] Relevant local documentation — consult these with read_doc before relying on general knowledge:\n${lines.join('\n')}`;
}

module.exports = {
  injectSocketPath,
  statePath,
  loadState,
  saveState,
  filterFreshHits,
  hasRemindedDocLookup,
  markRemindedDocLookup,
  queryInject,
  queryInjectWithWarmRetry,
  formatBlock,
  isConversationalFiller,
};

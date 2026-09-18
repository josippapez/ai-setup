#!/usr/bin/env node
'use strict';
// The tunable half of the gate: which spans in an answer are claims, and what
// counts as backing for each.
//
// This file is config, not logic. Stage 5 (`/verified-replay`) scores a change to
// it against the stored ledger before it ships, so edits here are cheap to
// evaluate and cheap to revert.
//
// Precision over recall, deliberately. A missed claim costs one unverified
// sentence; a false positive costs the user a blocked turn and a rewrite, and a
// gate that cries wolf is a gate that gets muted. Every pattern here is anchored
// and narrow for the same reason git-mv-guard's mv parser is.

const path = require('node:path');

// A path that looks like source, optionally with :line. Requires a slash or a
// known code extension so prose like "3.5" or "node.js" does not match.
//
// The trailing lookahead deliberately excludes `.`: with it, a sentence-ending
// period after `src/db.ts:42` made the `:42` group fail and the match silently
// backtracked to the bare path, so every line number was dropped from the span.
//
// The first alternative carries its own leading `/`. Without it the lookbehind
// rejected every absolute path: `/Users/x/a.ts` was tried at `Users`, which is
// preceded by `/`, so the match failed and claims about absolute paths were
// invisible to the gate entirely. Keeping `/` in the lookbehind still keeps the
// pattern out of URLs, which `URL_RE` owns.
const PATH_RE =
  /(?<![\w@/.-])(\/(?:[\w.-]+\/)*[\w.-]+\.[A-Za-z][\w]{0,9}|(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z][\w]{0,9}|[\w.-]+\.(?:ts|tsx|js|jsx|cjs|mjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|sql|json|ya?ml|toml|md))(?::(\d+))?(?![\w/-])/g;

// Claims that a command succeeded. Anchored on the verb so "the test file" or
// "a passing grade" do not match.
const OUTCOME_RE =
  /\b(?:(?:all\s+)?(?:\d+\s+)?tests?\s+(?:now\s+)?(?:pass|passes|passed|are\s+passing|is\s+passing)|the\s+(?:test\s+)?suite\s+(?:passes|passed|is\s+green)|(?:the\s+)?build\s+(?:succeeds|succeeded|passes|passed|is\s+clean)|(?:the\s+)?lint(?:er)?\s+(?:passes|passed|is\s+clean)|type(?:check|s)\s+(?:pass|passes|passed|are\s+clean)|it\s+(?:now\s+)?works\b|verified\s+it\s+works)/gi;

// Negative existence claims. The half of Gate 1 that gets skipped most, per
// external-facts: "absence from your memory is not absence from the API".
const ABSENCE_RE =
  /\b(?:there\s+(?:is|are)\s+no\b|there\s+isn'?t\s+(?:a|an|any)\b|nothing\s+(?:in|here|else)?\s*(?:the\s+\w+\s+)?(?:does|handles|uses|calls|implements|references)\b|no\s+(?:such|other)\s+\w+\s+exists?\b|(?:does|do)\s+not\s+exist\s+(?:anywhere|in\s+the\s+(?:repo|codebase))|not\s+(?:present|defined|used)\s+anywhere\b|the\s+(?:repo|codebase)\s+(?:has|contains)\s+no\b)/gi;

// A version assertion about someone else's software. A bare decimal is not one:
// matching `\d+\.\d+` produced 208 of 497 stage-2 flags over 476 real turns, on
// prose like "Haiku 4.5" and "Claude 5.1". A version claim now has to announce
// itself — a `v` prefix, three components, the word version, or a range word.
const VERSION_RE =
  /\b(?:v\d+\.\d+(?:\.\d+)?|\d+\.\d+\.\d+|version\s+\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)?\s+(?:or\s+)?(?:later|newer|above|earlier|\+))\b/gi;

const URL_RE = /\bhttps?:\/\/[^\s<>()[\]"'`]+/gi;

// Fenced code is illustration, not assertion. Inline code is where real path
// references live, so it stays.
const stripFences = (text) => text.replace(/```[\s\S]*?(?:```|$)/g, ' ');

const norm = (p) => (typeof p === 'string' ? p.replace(/^\.\//, '').replace(/\\/g, '/') : '');

// The model writes repo-relative; tools record absolute. Match on the longest
// unambiguous tail rather than trying to resolve a root that may not be cwd.
function pathSeen(claimed, seenPaths, basenameFallback = true) {
  const c = norm(claimed);
  if (!c) return false;
  for (const s of seenPaths) {
    if (s === c || s.endsWith('/' + c) || c.endsWith('/' + s)) return true;
    // A directory read backs a file inside it only if the tool named the file.
    if (basenameFallback && path.basename(s) === path.basename(c) && (s.includes(c) || c.includes(s))) return true;
  }
  return false;
}

const TEST_CMD_RE =
  /\b(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+)?(?:test|tests|lint|typecheck|type-check|build|tsc|check)\b|\b(?:jest|vitest|mocha|ava|pytest|tox|nox|go\s+test|cargo\s+(?:test|build|check|clippy)|gradle|mvn|rspec|phpunit|tsc|eslint|ruff|mypy|make\s+(?:test|check|build))\b|\bnode\s+[^\s|;&]*\.test\.[cm]?js\b|--test\b/;

const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
const SEARCH_CMD_RE = /\b(?:rg|grep|ag|ack|find|codegraph)\b/;
const LIB_CMD_RE = /\b(?:opensrc|npm\s+(?:ls|list|view|info)|pnpm\s+(?:ls|list|why)|yarn\s+(?:list|why)|pip\s+show|cargo\s+tree)\b/;
// Files that declare a version. `plugin.json` and `manifest.json` are here
// because the gate blocked twice on version strings that the same turn had just
// read out of a plugin.json: the file that declares the version did not count as
// evidence for it.
const MANIFEST_RE = /(?:package(?:-lock)?\.json|plugin\.json|manifest\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|pyproject\.toml|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|Gemfile(?:\.lock)?|composer\.json)$/;

// The exploration policy, in Dream-RSI's sense: the part that gets rewritten and
// scored, while the evaluator and the manifest stay fixed. Expressed as config so
// a candidate is a set of values rather than a forked file, which is what makes a
// sweep over many candidates cheap.
const CONFIG = {
  path: true,
  outcome: true,
  absence: true,
  // Off on the evidence: over 651 replayed turns this class produced 2 catches
  // against 67 flags nothing ever resolved, the worst ratio of the five. Semantic
  // version claims ("React 19 added X") are stage 3's job; matching the digits
  // was never going to do it.
  version: false,
  url: true,
  // A basename match backs a claim when neither path is a suffix of the other.
  // Loose, and the replay is how we find out whether it pays for itself.
  pathBasenameFallback: true,
  // Require the search that backs an absence claim to postdate the last write.
  absenceAfterWrite: false,
};

/**
 * Classify the answer's claims against what actually ran.
 * Returns { unbacked: [{class, span, needs}], residualText: string }
 */
function classify(answer, ev, cfg) {
  const C = { ...CONFIG, ...(cfg || {}) };
  const text = stripFences(String(answer || ''));
  const unbacked = [];
  const covered = [];

  if (C.path) for (const m of text.matchAll(PATH_RE)) {
    const span = m[2] ? `${m[1]}:${m[2]}` : m[1];
    covered.push(m[0]);
    if (!pathSeen(m[1], ev.paths, C.pathBasenameFallback)) {
      unbacked.push({
        class: 'path',
        span,
        needs: `a Read, Edit, or codegraph_explore of ${m[1]} in this session`,
      });
    }
  }

  if (C.outcome) for (const m of text.matchAll(OUTCOME_RE)) {
    covered.push(m[0]);
    // The run has to be the LATEST state of the tree, not just somewhere in the
    // session. A pass followed by an edit is a claim about code that no longer
    // exists, which is the failure session-scoped evidence would otherwise let
    // through and the one worth catching on its own merits.
    const lastWrite = ev.lastWrite || 0;
    const ran = ev.commands.some((c) => TEST_CMD_RE.test(c.cmd) && c.ok && (c.seq || 0) >= lastWrite);
    if (!ran) {
      const stale = ev.commands.some((c) => TEST_CMD_RE.test(c.cmd) && c.ok);
      unbacked.push({
        class: 'command-outcome',
        span: m[0].trim(),
        needs: stale
          ? 're-running it: the last clean run was before a file was written, so it does not describe the current tree'
          : 'a Bash call this session that ran the test, build, or lint command and exited clean',
      });
    }
  }

  if (C.absence) for (const m of text.matchAll(ABSENCE_RE)) {
    covered.push(m[0]);
    const minSeq = C.absenceAfterWrite ? (ev.lastWrite || 0) : 0;
    if (!ev.searches.some((s) => (s.seq || 0) >= minSeq)) {
      unbacked.push({
        class: 'absence',
        span: m[0].trim(),
        needs: 'a Grep, Glob, rg, or codegraph_explore this session that would have found it',
      });
    }
  }

  if (C.version) for (const m of text.matchAll(VERSION_RE)) {
    covered.push(m[0]);
    if (!ev.libLookup) {
      unbacked.push({
        class: 'version',
        span: m[0].trim(),
        needs: 'find_libs, a manifest read, opensrc, or a fetched release page',
      });
    }
  }

  if (C.url) for (const m of text.matchAll(URL_RE)) {
    covered.push(m[0]);
    let host = '';
    try { host = new URL(m[0]).host; } catch { /* malformed, treat as unbacked */ }
    if (!host || !ev.urls.has(host)) {
      unbacked.push({
        class: 'url',
        span: m[0],
        needs: `a WebFetch or WebSearch of ${host || 'that URL'} this session`,
      });
    }
  }

  // Whatever the patterns did not touch goes to the judge. Drop whole sentences
  // that a pattern already handled rather than splicing the matched token out of
  // them: cutting a path mid-sentence handed the judge "the hook config lives at
  // ` ` and registers both events", which it then had to classify blind.
  const residual = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !covered.some((c) => s.includes(c)))
    .join(' ');

  return { unbacked, residualText: residual };
}

// What the session must actually have done for a claim of each kind to be backed.
// Without this the judge's verdict WAS the block: on the gate's first live run it
// flagged "no ledger yet" as unbacked even though the session had just run the
// find that established it. Classifying a claim and checking it are two different
// jobs, and only the second one gets to block.
const BACKED_BY = {
  file: (ev) => ev.paths.size > 0,
  command: (ev) => ev.commands.some((c) => c.ok),
  search: (ev) => ev.searches.length > 0,
  external: (ev) => ev.urls.size > 0 || ev.libLookup,
  state: (ev) => ev.commands.length > 0 || ev.paths.size > 0,
};

module.exports = { classify, CONFIG, BACKED_BY, pathSeen, stripFences, norm, MANIFEST_RE, SEARCH_TOOLS, SEARCH_CMD_RE, LIB_CMD_RE, TEST_CMD_RE };

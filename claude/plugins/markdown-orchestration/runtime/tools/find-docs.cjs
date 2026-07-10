"use strict";

const fs = require("node:fs");
const { getDocFiles } = require("../lib/docs.cjs");
const { clampInteger, relativePath, tokenize } = require("../lib/fs-utils.cjs");
const { findSemantic, isReady } = require("../lib/semantic-index.cjs");

const MAX_SNIPPET_CHARS = 180;

// Directory-context weighting: docs under these dirs get extra credit when the
// query intent aligns (e.g. "best practices" ≈ standards).
const DIR_TOKEN_MAP = [
  {
    dir: "/standards/",
    weight: 4,
    related: [
      "best",
      "practices",
      "practice",
      "standard",
      "standards",
      "convention",
      "rule",
      "policy",
      "guideline",
      "guidelines",
    ],
  },
  {
    dir: "/guides/",
    weight: 2,
    related: [
      "best",
      "practices",
      "practice",
      "guide",
      "guides",
      "tutorial",
      "setup",
      "walkthrough",
    ],
  },
];

function compactText(input) {
  const compacted = String(input || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .split(/\r?\n/g)
    .filter(line => !line.trim().startsWith("!["))
    .join(" ")
    .replace(/[!`*_>#~|[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compacted
    .split(/\s+/g)
    .filter(word => !word.startsWith("http://") && !word.startsWith("https://"))
    .join(" ");
}

const definition = {
  name: "find_docs",
  description:
    "Ranked search across every Markdown file in the repo (all *.md/*.mdx, excluding vendor/build dirs like node_modules and dist) for a query. Use when you need to locate which doc covers a topic/term/feature before reading it — e.g. 'where are the routing docs', 'find the auth setup guide'. Returns a ranked list of relative paths with line numbers and a short matching snippet. Keyword scoring (path, H1 title, and standards/guides directory context weighted higher) augmented by semantic-embedding matches when the index is warm. limit defaults to 12 (max 30). Pair with read_doc to open a result.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Topic, term, feature, or phrase to search docs for (keyword + semantic). Required, non-empty.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 30,
        default: 12,
        description: "Max results to return; default 12, range 1-30.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

async function execute(args, context) {
  const query = String(args.query || "").trim();
  const limit = clampInteger(args.limit, 12, 1, 30);
  const tokens = tokenize(query);
  if (!query || tokens.length === 0) return "Please provide a non-empty query.";

  const matches = [];
  for (const filePath of getDocFiles(context)) {
    let content = "";
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > context.maxFileSizeBytes) continue;
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const rel = relativePath(context.root, filePath);
    const lowerPath = rel.toLowerCase();
    const lowerContent = content.toLowerCase();

    // Whole-word frequencies (same tokenizer as the query) — avoids substring
    // noise like "closure" matching "sure" or "Firefox" matching "fire".
    const contentTokens = tokenize(lowerContent);
    const freq = new Map();
    for (const token of contentTokens) freq.set(token, (freq.get(token) || 0) + 1);

    let pathScore = 0;
    let contentScore = 0;
    for (const token of tokens) {
      if (lowerPath.includes(token)) pathScore += 4;
      contentScore += Math.min(freq.get(token) || 0, 3);
    }
    // Length-normalize the keyword score so a very long doc can't out-accumulate
    // a short, focused one just by mentioning more distinct query terms.
    const lengthFactor = 1 / (1 + Math.log10(Math.max(1, contentTokens.length / 400)));
    let score = pathScore + contentScore * lengthFactor;
    if (score <= 0) continue;
    const lines = content.split(/\r?\n/g);

    // Title bonus: tokens matching the H1 heading get extra weight.
    const titleLine = lines.find(line => /^#\s/.test(line));
    if (titleLine) {
      const lowerTitle = titleLine.toLowerCase();
      for (const token of tokens) if (lowerTitle.includes(token)) score += 3;
    }

    // Directory-context bonus aligned with the query intent.
    for (const { dir, weight, related } of DIR_TOKEN_MAP) {
      if (!lowerPath.includes(dir)) continue;
      for (const token of tokens) if (related.includes(token)) score += weight;
      break;
    }

    const lineIndex = lines.findIndex(line =>
      tokens.some(token => line.toLowerCase().includes(token))
    );
    matches.push({
      rel,
      score,
      lineIndex,
      snippet: lineIndex >= 0 ? lines[lineIndex].trim() : "",
    });
  }

  if (isReady()) {
    const semanticHits = await findSemantic(
      context,
      query,
      getDocFiles(context),
      limit * 2
    );
    const resultMap = new Map(matches.map(match => [match.rel, match]));
    for (const hit of semanticHits) {
      const semanticScore = Math.round(hit.score * 28);
      const existing = resultMap.get(hit.path);
      if (existing) {
        existing.score += semanticScore;
        continue;
      }
      matches.push({
        rel: hit.path,
        score: semanticScore,
        lineIndex: -1,
        snippet: "semantic match",
      });
      resultMap.set(hit.path, matches[matches.length - 1]);
    }
  }

  if (matches.length === 0) return `No docs for "${query}".`;
  matches.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  const parts = [`docs "${query}"`];
  for (const [index, item] of matches.slice(0, limit).entries()) {
    const location = item.lineIndex >= 0 ? `:${item.lineIndex + 1}` : "";
    const snippet = item.snippet
      ? ` ${compactText(item.snippet).slice(0, MAX_SNIPPET_CHARS)}`
      : "";
    parts.push(`${index + 1}) ${item.rel}${location}${snippet}`);
  }
  return parts.join("; ");
}

module.exports = { findDocsTool: { definition, execute } };

"use strict";

const { clampInteger } = require("../lib/fs-utils.cjs");
const { loadIndex, hybridSearch } = require("../lib/doc-index.cjs");
const { isReady, embedQuery } = require("../lib/semantic-index.cjs");
const { isRerankEnabled, rerank } = require("../lib/reranker.cjs");
const { indexPath } = require("./build-semantic-index.cjs");

const MAX_SNIPPET_CHARS = 180;

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
    "PRIMARY way to find anything in THIS repository's documentation — reach for it BEFORE answering any question about how this project works, its conventions, setup, architecture, features, or where a topic is documented, and prefer it over guessing or web search for repo-specific questions. Ranked hybrid search (semantic embeddings + BM25 keyword) over every Markdown file (*.md/*.mdx, excluding vendor/build dirs like node_modules and dist). Typical triggers: 'how does X work here', 'where are the routing/auth/testing docs', \"what's our convention for Y\", 'find the setup guide', or any repo-specific how/where/why. Returns ranked file:line results, each with its nearest section heading (anchor) and a short matching snippet, one result per file (best-matching chunk). limit defaults to 12 (max 30). Set rerank:true for exact-term/literal lookups (applies a cross-encoder to top candidates; off by default because it can hurt paraphrased queries). Then open a result with read_doc.",
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
      rerank: {
        type: "boolean",
        default: false,
        description:
          "Apply a cross-encoder reranker to the top candidates. Helps exact-term/literal queries; may hurt paraphrased ones. Off by default.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

async function execute(args, context) {
  const query = String(args.query || "").trim();
  const limit = clampInteger(args.limit, 12, 1, 30);
  if (!query) return "Please provide a non-empty query.";
  if (!isReady()) return `Semantic index not ready yet — retry shortly.`;

  const db = await loadIndex(indexPath(context));
  if (!db) return `Index not built yet — it builds automatically on first connect; retry shortly, or run the reindex command.`;

  const qvec = await embedQuery(query);
  if (!qvec) return `Could not embed the query.`;

  // Over-fetch chunk hits, optionally rerank, then collapse to best chunk per file.
  const CAND = 60;
  let hits = await hybridSearch(db, { term: query, vector: qvec, limit: CAND });
  const wantRerank = args.rerank === true || isRerankEnabled();
  if (wantRerank && hits.length > 1) {
    const orderIdx = await rerank(query, hits.map(h => ({ text: h.content })));
    hits = orderIdx.map(i => hits[i]);
  }

  const seen = new Set();
  const files = [];
  for (const h of hits) {
    if (seen.has(h.path)) continue;
    seen.add(h.path);
    files.push(h);
    if (files.length >= limit) break;
  }
  if (files.length === 0) return `No docs for "${query}".`;

  const parts = [`docs "${query}"`];
  files.forEach((h, i) => {
    const anchor = h.heading ? ` › ${h.heading}` : "";
    const snippet = compactText(h.content).slice(0, MAX_SNIPPET_CHARS);
    parts.push(`${i + 1}) ${h.path}:${h.startLine}${anchor} — ${snippet}`);
  });
  return parts.join("; ");
}

module.exports = { findDocsTool: { definition, execute } };

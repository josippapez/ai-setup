"use strict";

const { clampInteger } = require("../lib/fs-utils.cjs");
const { isRerankEnabled } = require("../lib/reranker.cjs");
const { rankDocs } = require("../lib/doc-search.cjs");
const { keywordSearch } = require("../lib/keyword-search.cjs");

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
    "PRIMARY way to find anything in THIS repository's documentation — reach for it BEFORE answering any question about how this project works, its conventions, setup, architecture, features, or where a topic is documented, and prefer it over guessing or web search for repo-specific questions. Ranked hybrid search (semantic embeddings + BM25 keyword) over every Markdown file (*.md/*.mdx, excluding vendor/build dirs like node_modules and dist). Typical triggers: 'how does X work here', 'where are the routing/auth/testing docs', \"what's our convention for Y\", 'find the setup guide', or any repo-specific how/where/why. Returns ranked file:line results, each with its nearest section heading (anchor) and a short matching snippet, one result per file (best-matching chunk). Each chunk is matched on its own text and again with its doc path and heading breadcrumb, and a cross-encoder then votes on the top 10 (about half a second); pass rerank:false for a faster ranking without that vote. While the model is still loading or the index is not built yet, it answers with a keyword scorer instead and says so in its header. limit defaults to 12 (max 30). Then open a result with read_doc, whose raw output keeps these line numbers valid.",
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
        default: true,
        description:
          "Let a cross-encoder vote on the top 10 candidates alongside the two vector rankings. On by default; it mostly helps natural-language questions. false skips it for a faster ranking.",
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

  let files;
  try {
    files = await rankDocs(context, { query, limit, threshold: 0, rerank: args.rerank !== false && isRerankEnabled() });
  } catch {
    // Runtime deps missing (e.g. still installing after a plugin reinstall).
    files = null;
  }
  if (files === null) {
    const hits = keywordSearch(context, query, limit);
    if (hits.length === 0) return `No docs for "${query}".`;
    const parts = [`docs "${query}" (keyword fallback, semantic index not ready)`];
    hits.forEach((h, i) => parts.push(`${i + 1}) ${h.path}:${h.lineNumber} — ${h.snippet.slice(0, MAX_SNIPPET_CHARS)}`));
    return parts.join("; ");
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

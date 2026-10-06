#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

const SERVER_INFO = { name: 'feedback', version: '0.4.0' };
const SUPPORTED_PROTOCOL_VERSION = '2024-11-05';
const DATA_DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data'));
const STORE = path.join(DATA_DIR, 'feedback.jsonl');
const KINDS = ['bug', 'pain_point', 'ambiguity', 'idea'];
const SEVERITIES = ['low', 'medium', 'high'];
const STATUSES = ['open', 'resolved', 'wontfix'];
const EDITABLE = ['status', 'resolution', 'kind', 'severity', 'title', 'details', 'area'];

const tools = [
  {
    name: 'collect_feedback',
    description:
      'Call this before you reply, unasked, whenever the user complains, asks why something is slow, asks whether a skill covers a task or for one to be written, or had to name a tool or skill before it got used. Also call it when you notice manual steps that could be automated or made into a skill, script or hook, unclear or conflicting instructions, or a failing tool. It records pain points, slow steps, ambiguities, bugs and automation ideas, about the project or the AI setup, so they get fixed later. Log first, then do the work.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS },
        title: { type: 'string', description: 'One line naming the problem.' },
        details: {
          type: 'string',
          description: 'What happened versus what was expected, and how to reproduce it.',
        },
        area: {
          type: 'string',
          description: 'Which part it is about, e.g. "verified hook", "orchestrate skill", "shopify price updates".',
        },
        severity: { type: 'string', enum: SEVERITIES, default: 'medium' },
        evidence: {
          type: 'string',
          description: 'Quoted error text, file:line, or the user\'s own words.',
        },
      },
      required: ['kind', 'title', 'details'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_feedback',
    description:
      'List recorded feedback, newest first. Use when the user asks what has been reported, or before working on improvements.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS },
        area: { type: 'string', description: 'Case-insensitive substring match on area.' },
        severity: { type: 'string', enum: SEVERITIES },
        query: { type: 'string', description: 'Case-insensitive substring match on title and details.' },
        status: { type: 'string', enum: [...STATUSES, 'all'], default: 'open' },
        limit: { type: 'integer', minimum: 1, default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_feedback',
    description:
      'Update a recorded feedback entry by id: resolve it (status "resolved" plus a resolution note saying what fixed it), close it as "wontfix", reopen it, or correct its kind, severity, title, details, or area. Use after fixing something read_feedback listed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The entry id read_feedback shows.' },
        status: { type: 'string', enum: STATUSES },
        resolution: { type: 'string', description: 'What fixed it, or why it will not be fixed.' },
        kind: { type: 'string', enum: KINDS },
        severity: { type: 'string', enum: SEVERITIES },
        title: { type: 'string' },
        details: { type: 'string' },
        area: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

function requireString(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`"${key}" must be a non-empty string`);
  return value.trim();
}

function optionalString(args, key) {
  if (args[key] === undefined) return undefined;
  return requireString(args, key);
}

function requireEnum(value, allowed, key) {
  if (!allowed.includes(value)) throw new Error(`"${key}" must be one of: ${allowed.join(', ')}`);
  return value;
}

function collectFeedback(args) {
  const entry = {
    id: crypto.randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    kind: requireEnum(args.kind, KINDS, 'kind'),
    severity: requireEnum(args.severity ?? 'medium', SEVERITIES, 'severity'),
    title: requireString(args, 'title'),
    details: requireString(args, 'details'),
    area: optionalString(args, 'area'),
    evidence: optionalString(args, 'evidence'),
    cwd: process.cwd(),
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // One appendFileSync per entry keeps concurrent sessions from interleaving lines.
  fs.appendFileSync(STORE, `${JSON.stringify(entry)}\n`);
  return `Recorded feedback ${entry.id}: [${entry.kind}/${entry.severity}] ${entry.title}`;
}

// The store is append-only: an entry line, then `{ op: 'update', id, ... }` lines that
// are merged into it on read. Concurrent sessions only ever append, so none overwrites another.
function loadEntries() {
  if (!fs.existsSync(STORE)) return [];
  const byId = new Map();
  for (const line of fs.readFileSync(STORE, 'utf8').split('\n').filter(Boolean)) {
    const { op, ...record } = JSON.parse(line);
    if (op === 'update') {
      if (byId.has(record.id)) byId.set(record.id, { ...byId.get(record.id), ...record });
    } else byId.set(record.id, { status: 'open', ...record });
  }
  return [...byId.values()];
}

function updateFeedback(args) {
  const id = requireString(args, 'id');
  const entry = loadEntries().find((e) => e.id === id);
  if (!entry) throw new Error(`No feedback entry with id "${id}"`);
  if (args.status !== undefined) requireEnum(args.status, STATUSES, 'status');
  if (args.kind !== undefined) requireEnum(args.kind, KINDS, 'kind');
  if (args.severity !== undefined) requireEnum(args.severity, SEVERITIES, 'severity');
  const changes = {};
  for (const key of EDITABLE) if (args[key] !== undefined) changes[key] = typeof args[key] === 'string' ? requireString(args, key) : args[key];
  if (!Object.keys(changes).length) throw new Error(`Give at least one of: ${EDITABLE.join(', ')}`);
  fs.appendFileSync(STORE, `${JSON.stringify({ op: 'update', id, ...changes, updatedAt: new Date().toISOString() })}\n`);
  const after = { ...entry, ...changes };
  return `Updated feedback ${id}: [${after.kind}/${after.severity}/${after.status}] ${after.title}`;
}

function formatEntry(e) {
  const lines = [`## ${e.id} [${e.kind}/${e.severity}/${e.status}] ${e.title}`, `${e.createdAt}${e.area ? ` · ${e.area}` : ''} · ${e.cwd}`, '', e.details];
  if (e.evidence) lines.push('', `Evidence: ${e.evidence}`);
  if (e.resolution) lines.push('', `Resolution (${e.updatedAt}): ${e.resolution}`);
  return lines.join('\n');
}

function readFeedback(args) {
  if (args.kind !== undefined) requireEnum(args.kind, KINDS, 'kind');
  if (args.severity !== undefined) requireEnum(args.severity, SEVERITIES, 'severity');
  const status = args.status ?? 'open';
  requireEnum(status, [...STATUSES, 'all'], 'status');
  const area = args.area?.toLowerCase();
  const query = args.query?.toLowerCase();
  const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 50;
  const all = loadEntries();
  const matches = all
    .filter((e) => status === 'all' || e.status === status)
    .filter((e) => !args.kind || e.kind === args.kind)
    .filter((e) => !args.severity || e.severity === args.severity)
    .filter((e) => !area || (e.area || '').toLowerCase().includes(area))
    .filter((e) => !query || `${e.title}\n${e.details}`.toLowerCase().includes(query))
    .reverse();
  if (!matches.length) return `No feedback matches (${all.length} total in ${STORE}).`;
  const shown = matches.slice(0, limit);
  return [`${matches.length} of ${all.length} entries match, showing ${shown.length}. Store: ${STORE}`, ...shown.map(formatEntry)].join('\n\n');
}

const handlers = { collect_feedback: collectFeedback, read_feedback: readFeedback, update_feedback: updateFeedback };

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handleRequest({ id, method, params }) {
  if (method === 'initialize') {
    return writeMessage({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: SUPPORTED_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Inbox for everything that could be improved: pain points, slow steps, ambiguities, bugs, and work worth automating, in the project or in the AI setup. Call collect_feedback whenever you notice one, unasked. Call read_feedback before improving things, and update_feedback once an entry is fixed.',
      },
    });
  }
  if (method === 'tools/list') return writeMessage({ jsonrpc: '2.0', id, result: { tools } });
  if (method === 'tools/call') {
    const handler = handlers[params?.name];
    if (!handler) return writeMessage({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
    try {
      const text = handler(params.arguments || {});
      return writeMessage({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (err) {
      return writeMessage({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: err.message }], isError: true } });
    }
  }
  if (method === 'ping' || method === 'shutdown') return writeMessage({ jsonrpc: '2.0', id, result: {} });
  return writeMessage({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message && Object.hasOwn(message, 'id')) handleRequest(message);
});
rl.on('close', () => process.exit(0));

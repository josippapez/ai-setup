#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

const SERVER_INFO = { name: 'feedback', version: '0.1.0' };
const SUPPORTED_PROTOCOL_VERSION = '2024-11-05';
const DATA_DIR = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data'));
const STORE = path.join(DATA_DIR, 'feedback.jsonl');
const KINDS = ['bug', 'pain_point', 'ambiguity', 'idea'];
const SEVERITIES = ['low', 'medium', 'high'];

const tools = [
  {
    name: 'collect_feedback',
    description:
      'Record a bug, pain point, ambiguity, or idea about the AI setup itself (rules, skills, hooks, agents, MCP servers, plugins, settings) so it can be acted on later. Use when the user complains about or reports a problem with the setup, or when you hit conflicting or unclear instructions, a skill that did not fire, a hook that misfired, or a tool that failed in a way the setup should fix.',
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
          description: 'Which part of the setup, e.g. "dev-core/evidence-first", "verified hook", "orchestrate skill".',
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
      'List recorded feedback about the AI setup, newest first. Use when the user asks what has been reported, or before working on improvements to the setup.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS },
        area: { type: 'string', description: 'Case-insensitive substring match on area.' },
        severity: { type: 'string', enum: SEVERITIES },
        query: { type: 'string', description: 'Case-insensitive substring match on title and details.' },
        limit: { type: 'integer', minimum: 1, default: 50 },
      },
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

function loadEntries() {
  if (!fs.existsSync(STORE)) return [];
  return fs
    .readFileSync(STORE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function formatEntry(e) {
  const lines = [`## ${e.id} [${e.kind}/${e.severity}] ${e.title}`, `${e.createdAt}${e.area ? ` · ${e.area}` : ''} · ${e.cwd}`, '', e.details];
  if (e.evidence) lines.push('', `Evidence: ${e.evidence}`);
  return lines.join('\n');
}

function readFeedback(args) {
  if (args.kind !== undefined) requireEnum(args.kind, KINDS, 'kind');
  if (args.severity !== undefined) requireEnum(args.severity, SEVERITIES, 'severity');
  const area = args.area?.toLowerCase();
  const query = args.query?.toLowerCase();
  const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 50;
  const all = loadEntries();
  const matches = all
    .filter((e) => !args.kind || e.kind === args.kind)
    .filter((e) => !args.severity || e.severity === args.severity)
    .filter((e) => !area || (e.area || '').toLowerCase().includes(area))
    .filter((e) => !query || `${e.title}\n${e.details}`.toLowerCase().includes(query))
    .reverse();
  if (!matches.length) return `No feedback matches (${all.length} total in ${STORE}).`;
  const shown = matches.slice(0, limit);
  return [`${matches.length} of ${all.length} entries match, showing ${shown.length}. Store: ${STORE}`, ...shown.map(formatEntry)].join('\n\n');
}

const handlers = { collect_feedback: collectFeedback, read_feedback: readFeedback };

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
          'Feedback inbox for the AI setup (rules, skills, hooks, agents, MCP servers, plugins). Call collect_feedback when the user reports a bug, pain point, or ambiguity with the setup, or when you hit conflicting or unclear instructions yourself. Call read_feedback to review what has been reported before improving the setup.',
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

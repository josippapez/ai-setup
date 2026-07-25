import { homedir } from 'node:os';
import net from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import injectClient from './lib/inject-client.cjs';
import reindexDebounce from './lib/reindex-debounce.cjs';

const pluginDirectory = dirname(fileURLToPath(import.meta.url));
const { formatBlock, isConversationalFiller, queryInject } = injectClient;
const { claimReindex } = reindexDebounce;
const latestPrompts = new Map();
const pendingQueries = new Map();
const seenProgressDocs = new Map();

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function messageText(parts) {
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join(' ')
    .trim();
}

function toolQuery(input) {
  const args = input.args || {};
  const target = args.filePath || args.file_path || args.path || args.command || '';
  return `${input.tool || ''} ${target}`.trim();
}

function requestsMarkdownReindex(input) {
  const tool = String(input.tool || '').toLowerCase();
  if (!['apply_patch', 'edit', 'multiedit', 'write'].includes(tool)) return false;
  const args = input.args || {};
  const file = args.filePath || args.file_path || args.path || '';
  return /\.mdx?$/i.test(file) || /(?:^|\n)[+*]{3} (?:Add|Update|Delete) File: .*\.mdx?$/im.test(args.patchText || '');
}

function requestReindex(repositoryRoot) {
  const lockPath = join(repositoryRoot, '.opencode', 'repo-docs', 'reindex.lock');
  if (!claimReindex(lockPath)) return;
  const socketPath = join(repositoryRoot, '.opencode', 'repo-docs', 'inject.sock');
  const socket = net.connect(socketPath);
  const timer = setTimeout(() => socket.destroy(), 1500);
  socket.on('connect', () => socket.write(`${JSON.stringify({ op: 'reindex' })}\n`));
  socket.on('data', () => socket.end());
  socket.on('error', () => {});
  socket.on('close', () => clearTimeout(timer));
}

/**
 * @typedef {{ directory?: string, worktree?: string, serverUrl?: URL }} PluginInput
 * @typedef {{ type: 'local', command: string[], enabled?: boolean, environment?: Record<string, string>, timeout?: number }} LocalMcpConfig
 * @typedef {{ type: 'remote', url: string, enabled?: boolean, timeout?: number }} RemoteMcpConfig
 * @typedef {{ mcp?: Record<string, LocalMcpConfig | RemoteMcpConfig> }} OpenCodeConfig
 * @typedef {{
 *   event: (input: { event?: { type?: string, properties?: { info?: { id?: string } } } }) => Promise<void>,
 *   config: (config: OpenCodeConfig) => void | Promise<void>,
 *   'chat.message': (input: { sessionID: string }, output: { parts: Array<{ type?: string, text?: string }> }) => Promise<void>,
 *   'tool.execute.after': (input: { tool?: string, args?: Record<string, unknown> }) => Promise<void>,
 *   'shell.env': (input: { sessionID?: string }, output: { env: Record<string, string> }) => Promise<void>,
 *   'experimental.chat.system.transform': (input: { sessionID?: string }, output: { system: string[] }) => Promise<void>
 * }} PluginHooks
 */

/**
 * @param {PluginInput} input
 * @returns {Promise<PluginHooks>}
 */
export default async function interactiveMcpPlugin({
  worktree,
  directory,
  serverUrl,
}) {
  const repositoryRoot = worktree || directory;
  if (!repositoryRoot) {
    throw new Error('interactive-mcp plugin requires an OpenCode directory.');
  }
  const openCodeServerUrl = serverUrl?.href || 'http://localhost:4096';
  /** @type {Record<string, string>} */
  const environment = {
    // OpenCode-namespaced model cache dir so bge-small/reranker download once
    // under ~/.config/opencode (not claude's ~/.claude/repo-docs-models). The
    // ported semantic-index.cjs/reranker.cjs honor this env var.
    REPO_DOCS_MODELS_DIR:
      process.env.REPO_DOCS_MODELS_DIR ||
      join(homedir(), '.config', 'opencode', 'repo-docs-models'),
    REPO_DOCS_INJECT: '1',
  };
  if (process.env.OPENCODE_SERVER_PASSWORD) {
    environment.OPENCODE_SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD;
  }
  if (process.env.OPENCODE_SERVER_USERNAME) {
    environment.OPENCODE_SERVER_USERNAME = process.env.OPENCODE_SERVER_USERNAME;
  }

  return {
    event: async ({ event }) => {
      if (event?.type !== 'session.deleted') return;
      const sessionID = event.properties?.info?.id;
      if (!sessionID) return;
      latestPrompts.delete(sessionID);
      pendingQueries.delete(sessionID);
      seenProgressDocs.delete(sessionID);
    },
    config: async (config) => {
      config.mcp = {
        ...config.mcp,
        'interactive-mcp-standalone': {
          type: 'local',
          command: [
            'node',
            join(pluginDirectory, 'standalone-mcp.cjs'),
            repositoryRoot,
            openCodeServerUrl,
          ],
          enabled: true,
          environment,
          timeout: 30000,
        },
      };
    },
    'chat.message': async (input, output) => {
      const prompt = messageText(output.parts || []);
      if (prompt.replace(/[^a-zA-Z]/g, '').length < 8 || isConversationalFiller(prompt)) return;
      latestPrompts.set(input.sessionID, prompt);
      pendingQueries.set(input.sessionID, { query: prompt, progress: false });
    },
    'tool.execute.after': async (input) => {
      if (requestsMarkdownReindex(input)) requestReindex(repositoryRoot);
      const prompt = latestPrompts.get(input.sessionID) || '';
      const query = `${prompt} ${toolQuery(input)}`.trim().replace(/\s+/g, ' ').slice(0, 400);
      if (query.replace(/[^a-zA-Z]/g, '').length >= 8 && !isConversationalFiller(query)) {
        pendingQueries.set(input.sessionID, { query, progress: true });
      }
    },
    'shell.env': async (input, output) => {
      if (input.sessionID) output.env.OPENCODE_SESSION_ID = input.sessionID;
    },
    'experimental.chat.system.transform': async (input, output) => {
      if (input.sessionID) {
        output.system.push(`Current OpenCode session ID: ${input.sessionID}. It is also available to shell commands as OPENCODE_SESSION_ID.`);
        const pending = pendingQueries.get(input.sessionID);
        if (!pending) return;
        pendingQueries.delete(input.sessionID);
        const threshold = pending.progress
          ? numberFromEnv('REPO_DOCS_INJECT_THRESHOLD_PROGRESS', numberFromEnv('REPO_DOCS_INJECT_THRESHOLD', 0.86))
          : numberFromEnv('REPO_DOCS_INJECT_THRESHOLD', 0.80);
        const result = await queryInject(repositoryRoot, {
          query: pending.query,
          limit: numberFromEnv('REPO_DOCS_INJECT_LIMIT', 3),
          threshold,
        }, numberFromEnv('REPO_DOCS_INJECT_TIMEOUT_MS', 300));
        if (!result?.injected || !result.hits?.length) return;
        let hits = result.hits;
        if (pending.progress) {
          const seen = seenProgressDocs.get(input.sessionID) || new Set();
          hits = hits.filter((hit) => !seen.has(hit.path));
          hits.forEach((hit) => seen.add(hit.path));
          seenProgressDocs.set(input.sessionID, seen);
        }
        const block = formatBlock(hits);
        if (block) output.system.push(block);
      }
    },
  };
}

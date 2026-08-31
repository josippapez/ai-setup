import { homedir } from 'node:os';
import fs from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import injectClient from './lib/inject-client.cjs';
import reindexDebounce from './lib/reindex-debounce.cjs';

const pluginDirectory = dirname(fileURLToPath(import.meta.url));
const { formatBlock, isConversationalFiller, queryInjectWithRetry } = injectClient;
const { claimReindex } = reindexDebounce;
const latestPrompts = new Map();
const pendingQueries = new Map();
// sessionID -> { tick, seen: Map<path, tick> }. Applies to prompt and progress
// injections alike: without it the same handful of docs is re-injected on every
// message. Ticks advance once per injection, so a doc becomes eligible again
// after REPO_DOCS_INJECT_REPEAT_AFTER ticks rather than being blocked forever.
const seenDocs = new Map();
const lastPromptMessageIDs = new Map();
const pendingSystemContexts = new Map();

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

function appendSystemContext(output, context) {
  if (!context) return;
  if (output.system.length === 0) {
    output.system.push(context);
    return;
  }
  output.system[0] = `${output.system[0]}\n\n${context}`;
}

function requestsMarkdownReindex(input) {
  const tool = String(input.tool || '').toLowerCase();
  if (!['apply_patch', 'edit', 'multiedit', 'write'].includes(tool)) return false;
  const args = input.args || {};
  const file = args.filePath || args.file_path || args.path || '';
  return /\.mdx?$/i.test(file) || /(?:^|\n)[+*]{3} (?:Add|Update|Delete) File: .*\.mdx?$/im.test(args.patchText || '');
}

// Mirrors SOURCE_EXTENSIONS in lib/dependency-index.cjs.
const SOURCE_FILE_RE = /\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/i;

function requestsDependencyInvalidate(input) {
  const tool = String(input.tool || '').toLowerCase();
  if (!['apply_patch', 'edit', 'multiedit', 'write'].includes(tool)) return false;
  const args = input.args || {};
  const file = args.filePath || args.file_path || args.path || '';
  return SOURCE_FILE_RE.test(file)
    || /(?:^|\n)[+*]{3} (?:Add|Update|Delete) File: .*\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/im.test(args.patchText || '');
}

function sendInjectOp(repositoryRoot, op) {
  const socketPath = join(repositoryRoot, '.opencode', 'repo-docs', 'inject.sock');
  const socket = net.connect(socketPath);
  const timer = setTimeout(() => socket.destroy(), 1500);
  socket.on('connect', () => socket.write(`${JSON.stringify({ op })}\n`));
  socket.on('data', () => socket.end());
  socket.on('error', () => {});
  socket.on('close', () => clearTimeout(timer));
}

function requestReindex(repositoryRoot) {
  const lockPath = join(repositoryRoot, '.opencode', 'repo-docs', 'reindex.lock');
  if (!claimReindex(lockPath)) return;
  sendInjectOp(repositoryRoot, 'reindex');
}

/**
 * @typedef {{ directory?: string, worktree?: string, serverUrl?: URL }} PluginInput
 * @typedef {{ type: 'local', command: string[], enabled?: boolean, environment?: Record<string, string>, timeout?: number }} LocalMcpConfig
 * @typedef {{ type: 'remote', url: string, enabled?: boolean, timeout?: number }} RemoteMcpConfig
 * @typedef {{ mcp?: Record<string, LocalMcpConfig | RemoteMcpConfig> }} OpenCodeConfig
 * @typedef {{
 *   event: (input: { event?: { type?: string, properties?: { info?: { id?: string } } } }) => Promise<void>,
 *   config: (config: OpenCodeConfig) => void | Promise<void>,
 *   'chat.message': (input: { sessionID: string, messageID?: string }, output: { message: { id?: string, system?: string }, parts: Array<{ type?: string, text?: string }> }) => Promise<void>,
 *   'tool.execute.after': (input: { tool?: string, args?: Record<string, unknown> }) => Promise<void>,
 *   'shell.env': (input: { sessionID?: string }, output: { env: Record<string, string> }) => Promise<void>,
 *   'experimental.chat.messages.transform': (input: {}, output: { messages: Array<{ info?: { id?: string, role?: string, sessionID?: string, system?: string }, parts?: Array<{ type?: string, text?: string }> }> }) => Promise<void>,
 *   'experimental.chat.system.transform': (input: { sessionID?: string }, output: { system: string[] }) => Promise<void>
 * }} PluginHooks
 */

/**
 * @param {PluginInput} input
 * @param {{ injectDebug?: boolean }} [options]
 * @returns {Promise<PluginHooks>}
 */
export default async function interactiveMcpPlugin({
  worktree,
  directory,
  serverUrl,
}, options = {}) {
  const repositoryRoot = worktree || directory;
  if (!repositoryRoot) {
    throw new Error('dev-core plugin requires an OpenCode directory.');
  }
  const injectionDebugEnabled = options.injectDebug === true
    || process.env.REPO_DOCS_INJECT_DEBUG === '1';
  const injectionDebugPath = join(repositoryRoot, '.opencode', 'repo-docs', 'inject-debug.log');
  function debugInjection(message) {
    if (!injectionDebugEnabled) return;
    const line = `${new Date().toISOString()} ${message}\n`;
    try {
      fs.mkdirSync(dirname(injectionDebugPath), { recursive: true });
      if (fs.existsSync(injectionDebugPath) && fs.statSync(injectionDebugPath).size > 256 * 1024) {
        fs.writeFileSync(injectionDebugPath, line);
      } else {
        fs.appendFileSync(injectionDebugPath, line);
      }
    } catch {}
    if (process.env.REPO_DOCS_INJECT_DEBUG === '1') {
      process.stderr.write(`[repo-docs-inject] ${message}\n`);
    }
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

  async function resolvePendingContext(sessionID) {
    const pending = pendingQueries.get(sessionID);
    debugInjection(`messages.transform session=${sessionID} pending=${Boolean(pending)}`);
    if (!pending) return '';
    pendingQueries.delete(sessionID);
    const threshold = pending.progress
      ? numberFromEnv('REPO_DOCS_INJECT_THRESHOLD_PROGRESS', numberFromEnv('REPO_DOCS_INJECT_THRESHOLD', 0.86))
      : numberFromEnv('REPO_DOCS_INJECT_THRESHOLD', 0.80);
    const result = await queryInjectWithRetry(repositoryRoot, {
      query: pending.query,
      limit: numberFromEnv('REPO_DOCS_INJECT_LIMIT', 3),
      threshold,
    }, {
      timeoutMs: numberFromEnv('REPO_DOCS_INJECT_TIMEOUT_MS', 750),
    });
    debugInjection(`query result injected=${Boolean(result?.injected)} hits=${result?.hits?.length || 0}`);
    if (!result?.injected || !result.hits?.length) return '';
    const windowTicks = numberFromEnv('REPO_DOCS_INJECT_REPEAT_AFTER', 20);
    const state = seenDocs.get(sessionID) || { tick: 0, seen: new Map() };
    state.tick += 1;
    let hits = result.hits.filter((hit) => {
      const last = state.seen.get(hit.path);
      return last === undefined || state.tick - last >= windowTicks;
    });
    hits.forEach((hit) => state.seen.set(hit.path, state.tick));
    seenDocs.set(sessionID, state);
    if (!hits.length) return '';
    debugInjection(`queued paths=${hits.map((hit) => hit.path).join(',')}`);
    return formatBlock(hits);
  }

  return {
    event: async ({ event }) => {
      if (event?.type !== 'session.deleted') return;
      const sessionID = event.properties?.info?.id;
      if (!sessionID) return;
      latestPrompts.delete(sessionID);
      pendingQueries.delete(sessionID);
      seenDocs.delete(sessionID);
      lastPromptMessageIDs.delete(sessionID);
      pendingSystemContexts.delete(sessionID);
    },
    config: async (config) => {
      config.mcp = {
        ...config.mcp,
        'repo-docs': {
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
      debugInjection(`chat.message session=${input.sessionID} chars=${prompt.length}`);
      if (prompt.replace(/[^a-zA-Z]/g, '').length < 8 || isConversationalFiller(prompt)) return;
      latestPrompts.set(input.sessionID, prompt);
      pendingQueries.set(input.sessionID, { query: prompt, progress: false });
      const block = await resolvePendingContext(input.sessionID);
      if (block) {
        const reminder = `<system-reminder>\n${block}\n</system-reminder>`;
        output.message.system = output.message.system
          ? `${output.message.system}\n\n${reminder}`
          : reminder;
      }
      const messageID = output.message.id || input.messageID;
      if (messageID) lastPromptMessageIDs.set(input.sessionID, messageID);
    },
    'tool.execute.after': async (input) => {
      if (requestsMarkdownReindex(input)) requestReindex(repositoryRoot);
      // Undebounced on purpose: invalidation is an in-memory flag flip, and a
      // missed one would leave dependency tools answering from a stale graph.
      if (requestsDependencyInvalidate(input)) sendInjectOp(repositoryRoot, 'invalidate-deps');
      const prompt = latestPrompts.get(input.sessionID) || '';
      const query = `${prompt} ${toolQuery(input)}`.trim().replace(/\s+/g, ' ').slice(0, 400);
      if (query.replace(/[^a-zA-Z]/g, '').length >= 8 && !isConversationalFiller(query)) {
        pendingQueries.set(input.sessionID, { query, progress: true });
      }
    },
    'shell.env': async (input, output) => {
      if (input.sessionID) output.env.OPENCODE_SESSION_ID = input.sessionID;
    },
    'experimental.chat.messages.transform': async (_input, output) => {
      const lastUser = [...(output.messages || [])]
        .reverse()
        .find((message) => message.info?.role === 'user');
      const sessionID = lastUser?.info?.sessionID;
      if (!sessionID) return;
      const prompt = messageText(lastUser.parts || []);
      if (prompt) latestPrompts.set(sessionID, prompt);
      const messageID = lastUser.info?.id;
      if (
        !pendingQueries.has(sessionID)
        && messageID
        && lastPromptMessageIDs.get(sessionID) !== messageID
        && prompt.replace(/[^a-zA-Z]/g, '').length >= 8
        && !isConversationalFiller(prompt)
      ) {
        pendingQueries.set(sessionID, { query: prompt, progress: false });
      }
      if (messageID) lastPromptMessageIDs.set(sessionID, messageID);
      const block = await resolvePendingContext(sessionID);
      if (!block) return;
      pendingSystemContexts.set(
        sessionID,
        `<system-reminder>\n${block}\n</system-reminder>`,
      );
    },
    'experimental.chat.system.transform': async (input, output) => {
      if (input.sessionID) {
        appendSystemContext(
          output,
          `Current OpenCode session ID: ${input.sessionID}. It is also available to shell commands as OPENCODE_SESSION_ID.`,
        );
        const context = pendingSystemContexts.get(input.sessionID);
        debugInjection(`system.transform session=${input.sessionID} context=${Boolean(context)}`);
        if (context) {
          pendingSystemContexts.delete(input.sessionID);
          appendSystemContext(output, context);
        }
      }
    },
  };
}

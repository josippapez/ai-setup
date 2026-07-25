import { homedir } from 'node:os';
import net from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import reindexDebounce from './lib/reindex-debounce.cjs';

const pluginDirectory = dirname(fileURLToPath(import.meta.url));
const { claimReindex } = reindexDebounce;

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
 *   config: (config: OpenCodeConfig) => void | Promise<void>,
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
    'tool.execute.after': async (input) => {
      if (requestsMarkdownReindex(input)) requestReindex(repositoryRoot);
    },
    'shell.env': async (input, output) => {
      if (input.sessionID) output.env.OPENCODE_SESSION_ID = input.sessionID;
    },
    'experimental.chat.system.transform': async (input, output) => {
      if (input.sessionID) {
        output.system.push(`Current OpenCode session ID: ${input.sessionID}. It is also available to shell commands as OPENCODE_SESSION_ID.`);
      }
    },
  };
}

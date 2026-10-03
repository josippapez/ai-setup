import { homedir } from 'node:os';
import net from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import reindexDebounce from './lib/reindex-debounce.cjs';

const pluginDirectory = dirname(fileURLToPath(import.meta.url));
const { claimReindex } = reindexDebounce;

function requestsMarkdownReindex(toolName, args) {
  const tool = String(toolName || '').toLowerCase();
  if (!['apply_patch', 'edit', 'multiedit', 'write'].includes(tool)) return false;
  args = args && typeof args === 'object' ? args : {};
  const file = args.filePath || args.file_path || args.path || '';
  return /\.mdx?$/i.test(file) || /(?:^|\n)[+*]{3} (?:Add|Update|Delete) File: .*\.mdx?$/im.test(args.patchText || '');
}

// Ask the running repo-docs MCP (which holds the warm embedder) to re-embed
// the edited Markdown. Fire-and-forget, fail-safe when no server is up.
function sendReindex(repositoryRoot) {
  const socketPath = join(repositoryRoot, '.opencode', 'repo-docs', 'inject.sock');
  const socket = net.connect(socketPath);
  const timer = setTimeout(() => socket.destroy(), 1500);
  socket.on('connect', () => socket.write(`${JSON.stringify({ op: 'reindex' })}\n`));
  socket.on('data', () => socket.end());
  socket.on('error', () => {});
  socket.on('close', () => clearTimeout(timer));
}

function requestReindex(repositoryRoot) {
  const lockPath = join(repositoryRoot, '.opencode', 'repo-docs', 'reindex.lock');
  if (!claimReindex(lockPath)) return;
  sendReindex(repositoryRoot);
}

export default {
  id: 'dev-core',
  async setup({ location, mcp, tool, shell, session }) {
    const repositoryRoot = location.project.directory || location.directory;
    if (!repositoryRoot) {
      throw new Error('dev-core plugin requires an OpenCode directory.');
    }
    const openCodeServerUrl = process.env.OPENCODE_SERVER_URL || 'http://localhost:4096';
    /** @type {Record<string, string>} */
    const environment = {
      // OpenCode-namespaced model cache dir so bge-small/reranker download once
      // under ~/.config/opencode (not claude's ~/.claude/repo-docs-models). The
      // ported semantic-index.cjs/reranker.cjs honor this env var.
      REPO_DOCS_MODELS_DIR:
        process.env.REPO_DOCS_MODELS_DIR ||
        join(homedir(), '.config', 'opencode', 'repo-docs-models'),
    };
    if (process.env.OPENCODE_SERVER_PASSWORD) {
      environment.OPENCODE_SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD;
    }
    if (process.env.OPENCODE_SERVER_USERNAME) {
      environment.OPENCODE_SERVER_USERNAME = process.env.OPENCODE_SERVER_USERNAME;
    }

    await mcp.transform((editor) => {
      editor.set('repo-docs', {
        type: 'local',
        command: [
          'node',
          join(pluginDirectory, 'standalone-mcp.cjs'),
          repositoryRoot,
          openCodeServerUrl,
        ],
        disabled: false,
        environment,
        timeout: { startup: 30000, catalog: 30000, execution: 30000 },
      });
    });

    let activeSessionID;
    await tool.hook('execute.before', async (event) => {
      if (event.sessionID) activeSessionID = event.sessionID;
    });
    await tool.hook('execute.after', async (event) => {
      if (requestsMarkdownReindex(event.tool, event.input)) requestReindex(repositoryRoot);
    });
    await shell.hook('create.before', async (event) => {
      const sessionID = event.sessionID || activeSessionID;
      if (sessionID) event.env.OPENCODE_SESSION_ID = sessionID;
    });
    await session.hook('context', (event) => {
      const sessionID = event.sessionID;
      event.system.push({
        type: 'text',
        text: sessionID
          ? `Current OpenCode session ID: ${sessionID}. It is also available to shell commands as OPENCODE_SESSION_ID.`
          : 'The current OpenCode session ID is available to shell commands as OPENCODE_SESSION_ID when a shell command is active.',
      });
    });
  },
};

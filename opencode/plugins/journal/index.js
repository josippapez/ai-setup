import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const pluginDirectory = dirname(fileURLToPath(import.meta.url));
// Set before the core loads: it reads its data folder once.
process.env.JOURNAL_DATA ||= join(homedir(), '.config', 'opencode', 'journal');
const journal = createRequire(import.meta.url)('./journal.cjs');

export default {
  id: 'journal',
  async setup({ location, session, event }) {
    const cwd = location.project.directory || location.directory;
    if (!cwd) return;

    // swiftc can take a minute, so the describer builds in its own process. Not
    // process.execPath: inside OpenCode that is the opencode binary, not node.
    spawn('node', [join(pluginDirectory, 'journal.cjs'), 'build'], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();

    await session.hook('prompt', (e) => {
      journal.snapshot({ session_id: e.sessionID, cwd, prompt: e.prompt?.text || '' });
    });

    // The last turns, once per session, the way Claude Code's SessionStart adds them.
    const told = new Set();
    await session.hook('context', (e) => {
      if (told.has(e.sessionID)) return;
      told.add(e.sessionID);
      const text = journal.injectText(cwd);
      if (text) e.system.push({ type: 'text', text });
    });

    // OpenCode 2.x declares session.idle but never sends it; a turn ends with one of these.
    const turnEnd = new Set(['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted']);
    (async () => {
      for await (const e of event.subscribe()) {
        if (turnEnd.has(e.type)) await journal.record({ session_id: e.data.sessionID, cwd }, 'opencode').catch(() => {});
      }
    })().catch(() => {});
  },
};

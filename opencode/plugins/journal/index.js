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

    // swiftc can take a minute, so the describer builds in its own process.
    spawn(process.execPath, [join(pluginDirectory, 'journal.cjs'), 'build'], { stdio: 'ignore', detached: true }).unref();

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

    (async () => {
      for await (const e of event.subscribe()) {
        if (e.type === 'session.idle') await journal.record({ session_id: e.data.sessionID, cwd }, 'opencode').catch(() => {});
      }
    })().catch(() => {});
  },
};

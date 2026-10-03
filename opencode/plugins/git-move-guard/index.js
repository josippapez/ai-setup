import { Plugin } from '@opencode/plugin';

function parsePlainMv(command) {
  if (typeof command !== "string") return null;
  const trimmed = command.trim();

  const match = trimmed.match(/^mv(?:\s+-[a-zA-Z]*)?\s+("(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)*'|\S+)\s+("(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)*'|\S+)\s*$/);
  if (!match) return null;

  const src = match[1].replace(/^['"]|['"]$/g, "");
  const dest = match[2].replace(/^['"]|['"]$/g, "");

  if (src.startsWith("/tmp/") || src.startsWith("/var/folders/")) return null;

  return [src, dest];
}

function isShellTool(tool) {
  const toolName = String(tool ?? '').toLowerCase();
  return toolName.includes('bash') || toolName.includes('shell');
}

function commandFromInput(input) {
  if (!input || typeof input !== 'object') return '';
  return input.command ?? input.cmd ?? '';
}

export default Plugin.define({
  id: 'git-move-guard',
  async setup(ctx) {
    await ctx.tool.hook('execute.before', async (event) => {
      if (!isShellTool(event.tool) || !event.input || typeof event.input !== 'object') return;

      const parsed = parsePlainMv(commandFromInput(event.input));
      if (!parsed) return;

      const [src, dest] = parsed;
      const gitMvCmd = `git mv ${JSON.stringify(src)} ${JSON.stringify(dest)}`;
      event.input.command = gitMvCmd;
      if ('cmd' in event.input) event.input.cmd = gitMvCmd;
    });

    await ctx.tool.hook('execute.after', async (event) => {
      if (!isShellTool(event.tool) || !parsePlainMv(commandFromInput(event.input))) return;
      console.warn('[git-move] plain mv used; run `git add -A` if tracked.');
    });

    await ctx.session.hook('context', (event) => {
      event.system.push({
        type: 'text',
        text: 'For tracked file moves, use `git mv <source> <dest>`; if plain `mv` was used, run `git add -A`.',
      });
    });
  },
});

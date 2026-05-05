/**
 * git-move-guard plugin
 *
 * Detects plain `mv` commands used to move tracked repository files and
 * replaces them with a `git mv` equivalent, preserving git history.
 *
 * Strategy:
 *  - tool.execute.before  — intercepts Bash tool calls and rewrites plain `mv`
 *                            to `git mv` when moving files inside the worktree.
 *  - tool.execute.after   — if a plain mv still slipped through (e.g. via a
 *                            subshell), append a warning recommending `git mv`.
 *  - experimental.chat.system.transform — injects a standing rule.
 */

/**
 * Returns [src, dest] if the command is a plain `mv src dest` that looks like
 * it moves a file inside a git repo. Returns null otherwise.
 */
function parsePlainMv(command) {
  if (typeof command !== "string") return null;
  const trimmed = command.trim();

  // Match: mv [options] source dest
  // We intentionally only handle single-source moves (most common case).
  const match = trimmed.match(/^mv(?:\s+-[a-zA-Z]*)?\s+("(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)*'|\S+)\s+("(?:[^"\\]|\\.)+"|'(?:[^'\\]|\\.)*'|\S+)\s*$/);
  if (!match) return null;

  const src = match[1].replace(/^['"]|['"]$/g, "");
  const dest = match[2].replace(/^['"]|['"]$/g, "");

  // Skip if source looks like a temp/non-repo path
  if (src.startsWith("/tmp/") || src.startsWith("/var/folders/")) return null;

  return [src, dest];
}

export const server = async (_input) => {
  return {
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool ?? "";
      if (!toolName.toLowerCase().includes("bash") && !toolName.toLowerCase().includes("shell")) return;

      const command = output.args?.command ?? output.args?.cmd ?? "";
      const parsed = parsePlainMv(command);
      if (!parsed) return;

      const [src, dest] = parsed;

      // Rewrite the command to use git mv
      const gitMvCmd = `git mv ${JSON.stringify(src)} ${JSON.stringify(dest)}`;
      output.args.command = gitMvCmd;
      if (output.args.cmd !== undefined) output.args.cmd = gitMvCmd;

      console.warn(
        `[git-move-guard] Rewrote "mv ${src} ${dest}" → "${gitMvCmd}". ` +
          "Use git mv to preserve file history in the git index."
      );
    },

    "tool.execute.after": async (input, output) => {
      const toolName = input.tool ?? "";
      if (!toolName.toLowerCase().includes("bash") && !toolName.toLowerCase().includes("shell")) return;

      const command = input.args?.command ?? input.args?.cmd ?? "";
      if (!parsePlainMv(command)) return;

      // A plain mv ran (wasn't caught before) — append advisory
      output.output =
        (output.output ?? "") +
        "\n\n[git-move-guard] WARNING: A plain `mv` was used to move a file. " +
        "If this file is tracked by git, run:\n" +
        "  git add -A\n" +
        "to ensure git detects the rename, or prefer `git mv <source> <dest>` next time " +
        "to keep the git history intact.";
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(
        "## File move policy: always use `git mv`\n" +
          "When moving a file that exists in the git repository (i.e. not git-ignored), " +
          "you MUST use `git mv <source> <dest>` instead of the plain `mv` command.\n" +
          "This preserves git history and updates the index atomically.\n" +
          "If you accidentally used `mv`, run `git add -A` immediately to let git detect the rename."
      );
    },
  };
};

/**
 * test-reminder plugin
 *
 * After any code edit (Write, Edit, or patch tool) injects a reminder to run
 * tests before handing off to the user.
 *
 * Suggested commands (in priority order):
 *   1. npx nx affected -t test           (if Nx is detected)
 *   2. npm test / pnpm test / yarn test  (generic fallback)
 *
 * The plugin detects which package manager / task runner is available by
 * inspecting the worktree root at startup.
 */

import { existsSync } from "fs";
import { join } from "path";

/** Code-editing tool names we want to intercept. */
const EDIT_TOOLS = new Set([
  "write_file",
  "edit_file",
  "str_replace_editor",
  "str_replace_based_edit_tool",
  // opencode built-ins
  "write",
  "edit",
  "patch",
  "multiedit",
  "apply_patch",
]);

function isEditTool(toolName) {
  const lower = (toolName ?? "").toLowerCase();
  return EDIT_TOOLS.has(lower);
}

/**
 * Build the recommended test command string based on what's available in the
 * worktree. Called lazily on first use.
 */
function buildTestCommand(worktree) {
  const hasNx = existsSync(join(worktree, "nx.json"));
  const hasPnpm = existsSync(join(worktree, "pnpm-lock.yaml"));
  const hasYarn = existsSync(join(worktree, "yarn.lock"));

  const commands = [];

  if (hasNx) {
    commands.push(
      "# Run tests for only the affected projects (recommended):",
      "npx nx affected -t test",
      "",
      "# Or run tests for the specific project you edited:",
      "npx nx run <project>:test"
    );
  }

  const pm = hasPnpm ? "pnpm" : hasYarn ? "yarn" : "npm";
  commands.push("", `# Generic fallback — run all tests:`, `${pm} test`);

  return commands.join("\n");
}

export const server = async input => {
  const worktree = input.worktree ?? input.directory ?? process.cwd();

  // Build test command once at plugin init time
  const testCommands = buildTestCommand(worktree);

  /** Track which sessions have already received the reminder this turn. */
  const remindedSessions = new Set();

  return {
    "tool.execute.after": async (toolInput, output) => {
      if (!isEditTool(toolInput.tool)) return;

      const sessionKey = `${toolInput.sessionID}:${toolInput.callID}`;
      if (remindedSessions.has(sessionKey)) return;
      remindedSessions.add(sessionKey);

      // Clean up after a reasonable cap so the set doesn't grow unboundedly
      if (remindedSessions.size > 500) remindedSessions.clear();

      const reminder =
        "\n\n---\n" +
        "[test-reminder] Code was edited. Before handing off to the user, " +
        "run the relevant tests to confirm nothing is broken:\n\n" +
        "```sh\n" +
        testCommands +
        "\n```\n" +
        "If tests fail, fix them before completing the task.";

      output.output = (output.output ?? "") + reminder;
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(
        "## Test before handoff\n" +
          "After making code edits, ALWAYS run the relevant tests before presenting results to the user.\n" +
          "Preferred commands:\n" +
          "```sh\n" +
          testCommands +
          "\n```\n" +
          "Do not mark a task complete if tests are failing."
      );
    },
  };
};

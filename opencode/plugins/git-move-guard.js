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

export const server = async (_input) => {
  return {
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool ?? "";
      if (!toolName.toLowerCase().includes("bash") && !toolName.toLowerCase().includes("shell")) return;

      const command = output.args?.command ?? output.args?.cmd ?? "";
      const parsed = parsePlainMv(command);
      if (!parsed) return;

      const [src, dest] = parsed;

      const gitMvCmd = `git mv ${JSON.stringify(src)} ${JSON.stringify(dest)}`;
      output.args.command = gitMvCmd;
      if (output.args.cmd !== undefined) output.args.cmd = gitMvCmd;
    },

    "tool.execute.after": async (input, output) => {
      const toolName = input.tool ?? "";
      if (!toolName.toLowerCase().includes("bash") && !toolName.toLowerCase().includes("shell")) return;

      const command = input.args?.command ?? input.args?.cmd ?? "";
      if (!parsePlainMv(command)) return;

      output.output =
        (output.output ?? "") +
        "\n\n[git-move] plain mv used; run `git add -A` if tracked.";
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(
        "For tracked file moves, use `git mv <source> <dest>`; if plain `mv` was used, run `git add -A`."
      );
    },
  };
};

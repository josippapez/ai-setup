/**
 * docs-update-reminder plugin
 *
 * When code edits touch files in 2 or more distinct Nx projects, injects a
 * reminder to keep documentation in sync across all affected projects.
 *
 * Project detection strategy:
 *   1. Reads every project.json in the repo (via a fast glob-like walk).
 *   2. Builds a map of { projectRoot → projectName }.
 *   3. On each edit tool call, resolves the edited file path against the map.
 *   4. If ≥ 2 distinct project roots are touched in a session, fires the reminder.
 */

import { readFileSync, existsSync } from "fs";
import { join, resolve, relative, dirname } from "path";
import { execSync } from "child_process";

/**
 * Walk the worktree to find all project.json files (up to depth 5) and return
 * a map of  absoluteProjectRoot → projectName.
 */
function buildProjectMap(worktree) {
  const map = new Map(); // absRoot → name

  try {
    // Use `find` bounded to depth 5 to avoid scanning node_modules
    const raw = execSync(
      `find "${worktree}" -maxdepth 5 -name "project.json" ! -path "*/node_modules/*" ! -path "*/.git/*"`,
      { encoding: "utf8", timeout: 10_000 }
    );

    for (const line of raw.split("\n")) {
      const projectJsonPath = line.trim();
      if (!projectJsonPath) continue;
      try {
        const json = JSON.parse(readFileSync(projectJsonPath, "utf8"));
        const name = json.name;
        if (!name) continue;
        const projectRoot = dirname(projectJsonPath);
        map.set(resolve(projectRoot), name);
      } catch {
        // Malformed project.json — skip
      }
    }
  } catch {
    // find failed (e.g. not on unix) — return empty map gracefully
  }

  return map;
}

/**
 * Given an absolute file path and the project map, return the project name
 * whose root is the longest prefix match of the file path.
 */
function resolveProject(absFilePath, projectMap) {
  let bestRoot = null;
  let bestLen = 0;

  for (const [root] of projectMap) {
    const rel = relative(root, absFilePath);
    // relative() returns a path starting with ".." when absFilePath is NOT under root
    if (!rel.startsWith("..") && root.length > bestLen) {
      bestRoot = root;
      bestLen = root.length;
    }
  }

  return bestRoot ? projectMap.get(bestRoot) : null;
}

/** Extract a file path from tool args (handles common arg names). */
function extractFilePath(args) {
  return (
    args?.path ??
    args?.file_path ??
    args?.filePath ??
    args?.filename ??
    args?.file ??
    null
  );
}

const EDIT_TOOLS = new Set([
  "write_file",
  "edit_file",
  "str_replace_editor",
  "str_replace_based_edit_tool",
  "write",
  "edit",
  "patch",
  "multiedit",
]);

function isEditTool(toolName) {
  const lower = (toolName ?? "").toLowerCase();
  return EDIT_TOOLS.has(lower) || lower.includes("edit") || lower.includes("write");
}

export const server = async (input) => {
  const worktree = input.worktree ?? input.directory ?? process.cwd();

  // Build the project map once per plugin start
  let projectMap;
  try {
    projectMap = buildProjectMap(worktree);
  } catch {
    projectMap = new Map();
  }

  // Per-session tracking: sessionID → Set<projectName>
  const sessionProjects = new Map();

  return {
    "tool.execute.after": async (toolInput, output) => {
      if (!isEditTool(toolInput.tool)) return;

      const filePath = extractFilePath(toolInput.args);
      if (!filePath) return;

      const absPath = resolve(worktree, filePath);
      const projectName = resolveProject(absPath, projectMap);
      if (!projectName) return;

      const sid = toolInput.sessionID;
      if (!sessionProjects.has(sid)) {
        sessionProjects.set(sid, new Set());
      }
      const touched = sessionProjects.get(sid);
      touched.add(projectName);

      if (touched.size < 2) return;

      const projectList = [...touched].map((n) => `  - ${n}`).join("\n");
      const reminder =
        "\n\n---\n" +
        "[docs-update-reminder] Files in multiple Nx projects were edited this session:\n" +
        projectList +
        "\n\nEnsure documentation stays in sync across all affected projects:\n" +
        "  1. Update docs/guides/ for any cross-project behavioral changes.\n" +
        "  2. Update docs/standards/ if shared conventions changed.\n" +
        "  3. Run the docs-maintainer agent if changes are non-trivial:\n" +
        "     Task({ subagent_type: 'docs-maintainer', ... })";

      output.output = (output.output ?? "") + reminder;
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(
        "## Cross-project documentation sync\n" +
          "When your edits span 2 or more Nx projects in this monorepo, you MUST:\n" +
          "  1. Update docs/guides/ for any cross-project behavioral or API changes.\n" +
          "  2. Update docs/standards/ if a shared convention was modified.\n" +
          "  3. Delegate to the docs-maintainer agent for non-trivial doc updates.\n" +
          "Do not close the task until documentation is consistent with the code changes."
      );
    },
  };
};

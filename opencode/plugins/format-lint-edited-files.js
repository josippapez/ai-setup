import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const ESLINT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const PRETTIER_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".css",
  ".scss",
  ".html",
  ".yml",
  ".yaml",
]);
const FILE_EDIT_TOOLS = new Set(["apply_patch", "edit", "create", "write"]);

const normalizeToolName = (toolName) => {
  if (typeof toolName !== "string") return "";
  const segments = toolName.split(/[./:]/).filter(Boolean);
  return segments.length > 0 ? segments.at(-1) : toolName;
};

const extractFilesFromPatch = (patchText) => {
  const files = new Set();
  const pattern =
    /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm;

  let match = pattern.exec(patchText);
  while (match) {
    const file = match[1] ?? match[2];
    if (typeof file === "string" && file.trim().length > 0) {
      files.add(file.trim());
    }
    match = pattern.exec(patchText);
  }

  return files;
};

const addSinglePath = (files, value) => {
  if (typeof value === "string" && value.trim().length > 0) {
    files.add(value.trim());
  }
};

const resolveFilesForTool = (toolName, args) => {
  const files = new Set();

  if (toolName === "write" || toolName === "edit" || toolName === "create") {
    addSinglePath(files, args?.filePath);
    addSinglePath(files, args?.path);
  }

  if (toolName === "apply_patch") {
    const patchText = args?.patchText ?? args?.patch ?? args?.input;
    if (typeof patchText === "string" && patchText.trim().length > 0) {
      for (const file of extractFilesFromPatch(patchText)) {
        files.add(file);
      }
    }
  }

  return files;
};

const resolveEditedFiles = (toolName, args) => {
  const files = new Set(resolveFilesForTool(toolName, args));

  if (toolName !== "batch") {
    return files;
  }

  const toolCalls = Array.isArray(args?.tool_calls) ? args.tool_calls : [];
  for (const call of toolCalls) {
    const nestedToolName = normalizeToolName(
      call?.tool ?? call?.recipient_name,
    );
    const nestedArgs = call?.parameters ?? call?.args;
    for (const file of resolveFilesForTool(nestedToolName, nestedArgs)) {
      files.add(file);
    }
  }

  return files;
};

const isWithinWorkspace = (filePath, workspaceRoot) => {
  const relPath = relative(workspaceRoot, filePath);
  if (relPath === "") return true;
  if (relPath === "..") return false;
  if (relPath.startsWith(`..${sep}`)) return false;
  return !isAbsolute(relPath);
};

const toAbsolutePath = (filePath, workspaceRoot) => {
  if (isAbsolute(filePath)) return filePath;

  const candidates = [
    resolve(workspaceRoot, filePath),
    resolve(process.cwd(), filePath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return candidates[0];
};

const runNpx = (args, cwd) => {
  const result = spawnSync("npx", ["--no-install", ...args], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 0) !== 0) {
    throw new Error(`Failed: npx --no-install ${args.join(" ")}`);
  }
};

export const FormatLintEditedFilesPlugin = async ({ directory, worktree }) => {
  const workspaceRoot = directory || worktree || process.cwd();
  const marker = resolve(
    workspaceRoot,
    ".github/hooks/format-and-lint-edits.json",
  );

  if (!existsSync(marker)) {
    return {};
  }

  return {
    "tool.execute.after": async (input) => {
      const toolName = normalizeToolName(input?.tool);
      if (toolName !== "batch" && !FILE_EDIT_TOOLS.has(toolName)) {
        return;
      }

      const editedFiles = Array.from(resolveEditedFiles(toolName, input?.args))
        .map((filePath) => toAbsolutePath(filePath, workspaceRoot))
        .filter(
          (filePath) =>
            existsSync(filePath) && isWithinWorkspace(filePath, workspaceRoot),
        );

      if (editedFiles.length === 0) {
        return;
      }

      const prettierTargets = Array.from(
        new Set(
          editedFiles
            .filter((filePath) => PRETTIER_EXTENSIONS.has(extname(filePath)))
            .map((filePath) => relative(workspaceRoot, filePath)),
        ),
      );

      const eslintTargets = Array.from(
        new Set(
          editedFiles
            .filter((filePath) => ESLINT_EXTENSIONS.has(extname(filePath)))
            .map((filePath) => relative(workspaceRoot, filePath)),
        ),
      );

      if (prettierTargets.length > 0) {
        runNpx(["prettier", "--write", ...prettierTargets], workspaceRoot);
      }

      if (eslintTargets.length > 0) {
        runNpx(
          ["eslint", "--fix", "--max-warnings=0", ...eslintTargets],
          workspaceRoot,
        );
      }
    },
  };
};

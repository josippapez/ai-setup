#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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

const ESLINT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

const isFlagOn = (keys) => keys.some((key) => process.env[key] === "1");

const verbose = isFlagOn([
  "HOOK_VERBOSE",
  "CLAUDE_HOOK_VERBOSE",
  "COPILOT_HOOK_VERBOSE",
]);

const runEslint = isFlagOn([
  "HOOK_RUN_ESLINT",
  "CLAUDE_HOOK_RUN_ESLINT",
  "COPILOT_HOOK_RUN_ESLINT",
]);

const log = (...args) => {
  if (verbose) console.log("[claude-hook][verbose]", ...args);
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const normalizeToolName = (value) => {
  if (typeof value !== "string") return "";
  const parts = value.split(/[./:]/).filter(Boolean);
  const name = parts.length ? parts[parts.length - 1] : value;
  return name.trim().toLowerCase();
};

const isSuccessfulEvent = (event) => {
  if (event?.toolResult?.resultType) return event.toolResult.resultType === "success";
  if (typeof event?.success === "boolean") return event.success;
  if (event?.error) return false;
  return true;
};

const extractFilesFromPatch = (patchText) => {
  const files = new Set();

  const larkPattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  let match = larkPattern.exec(patchText);
  while (match) {
    files.add(match[1].trim());
    match = larkPattern.exec(patchText);
  }

  const gitDiffPattern = /^\+\+\+ b\/(.+)$/gm;
  match = gitDiffPattern.exec(patchText);
  while (match) {
    files.add(match[1].trim());
    match = gitDiffPattern.exec(patchText);
  }

  return files;
};

const collectInputs = (event) => {
  const inputs = [];
  const addParsed = (value) => {
    if (typeof value === "string") {
      const parsed = parseJson(value);
      if (parsed) inputs.push(parsed);
    } else if (value && typeof value === "object") {
      inputs.push(value);
    }
  };

  addParsed(event?.toolArgs);
  addParsed(event?.tool_args);
  addParsed(event?.toolInput);
  addParsed(event?.tool_input);
  addParsed(event?.input);
  addParsed(event?.payload?.tool_input);
  addParsed(event?.payload?.input);

  return inputs;
};

const fromUri = (value) => {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("file://")) return undefined;
  try {
    return new URL(value).pathname;
  } catch {
    return undefined;
  }
};

const collectEditedFiles = (event, toolName) => {
  const files = new Set();
  const editTools = new Set([
    "apply_patch",
    "edit",
    "create",
    "write",
    "multiedit",
    "replace",
    "insert",
  ]);

  if (toolName && !editTools.has(toolName)) return files;

  const addPath = (value) => {
    if (typeof value === "string" && value.trim()) files.add(value.trim());
  };

  const addMany = (value) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item === "string") addPath(item);
      if (item && typeof item === "object") {
        addPath(item.path);
        addPath(item.filePath);
        addPath(item.file_path);
      }
    }
  };

  for (const input of collectInputs(event)) {
    addPath(input.path);
    addPath(input.filePath);
    addPath(input.file_path);
    addPath(input.targetPath);
    addPath(input.target_path);
    addPath(fromUri(input.uri));
    addMany(input.paths);
    addMany(input.files);
    addMany(input.edits);
    addMany(input.operations);

    for (const key of ["input", "patch", "diff", "text", "content"]) {
      if (typeof input[key] === "string") {
        for (const file of extractFilesFromPatch(input[key])) files.add(file);
      }
    }
  }

  if (typeof event?.toolArgs === "string") {
    for (const file of extractFilesFromPatch(event.toolArgs)) files.add(file);
  }

  if (typeof event?.tool_args === "string") {
    for (const file of extractFilesFromPatch(event.tool_args)) files.add(file);
  }

  return files;
};

const resolveWorkspaceRoot = (event) =>
  [
    event?.cwd,
    event?.working_directory,
    event?.workspaceRoot,
    event?.workspace_root,
    process.cwd(),
  ].find((value) => typeof value === "string" && value.trim()) ?? process.cwd();

const toAbsolutePath = (filePath, workspaceRoot) => {
  if (isAbsolute(filePath)) return filePath;
  const roots = [workspaceRoot, process.cwd(), resolve(workspaceRoot, "..")];
  for (const root of roots) {
    const candidate = resolve(root, filePath);
    if (existsSync(candidate)) return candidate;
  }
  return resolve(workspaceRoot, filePath);
};

// Walk up from `startDir` to the nearest project that has the tool installed; undefined if none.
const findProjectRoot = (startDir, bin) => {
  let dir = startDir;
  while (true) {
    if (existsSync(resolve(dir, "node_modules", ".bin", bin))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return undefined;
    dir = parent;
  }
};

// Format/lint is best-effort: never block or fail the edit. Run the local binary
// directly (no npx auto-install) and swallow any non-zero exit.
const run = (bin, args, cwd) => {
  log(bin, ...args);
  const result = spawnSync(bin, args, { cwd, stdio: "inherit", env: process.env });
  if (result.error) log("skipped:", result.error.message);
};

const main = async () => {
  const raw = await readStdin();
  const event = parseJson(raw);
  if (!event || !isSuccessfulEvent(event)) process.exit(0);

  const toolName = normalizeToolName(
    event.toolName ?? event.tool_name ?? event.tool ?? event.name,
  );

  const workspaceRoot = resolveWorkspaceRoot(event);
  const editedFiles = Array.from(collectEditedFiles(event, toolName))
    .map((file) => toAbsolutePath(file, workspaceRoot))
    .filter((file) => existsSync(file));

  if (editedFiles.length === 0) process.exit(0);

  // Run each file through the formatter from ITS OWN project (the nearest ancestor with the
  // tool installed). Files in a repo without prettier/eslint are skipped — never an error.
  const lintFile = (file, bin, args) => {
    const root = findProjectRoot(dirname(file), bin);
    if (!root) {
      log(bin, "not installed for", file, "— skipping");
      return;
    }
    run(resolve(root, "node_modules", ".bin", bin), [...args, file], root);
  };

  for (const file of editedFiles) {
    if (PRETTIER_EXTENSIONS.has(extname(file))) lintFile(file, "prettier", ["--write"]);
    if (runEslint && ESLINT_EXTENSIONS.has(extname(file))) {
      lintFile(file, "eslint", ["--fix", "--max-warnings=0"]);
    }
  }
};

await main();

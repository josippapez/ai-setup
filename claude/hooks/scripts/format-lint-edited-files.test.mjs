import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOOK = path.join(import.meta.dirname, "format-lint-edited-files.mjs");

// The hook shells out to a project's local prettier/eslint and stays silent when neither
// is installed. Running it in verbose mode over a throwaway dir with no node_modules turns
// it into a reporter: every file it decided to format shows up as a "not installed" line.
function formattedFiles(event) {
  const out = execFileSync("node", [HOOK], {
    env: { ...process.env, HOOK_VERBOSE: "1", HOOK_RUN_ESLINT: "" },
    input: JSON.stringify(event),
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((line) => line.match(/^\[claude-hook]\[verbose] prettier not installed for (.+) —/))
    .filter(Boolean)
    .map((m) => m[1]);
}

const workspace = () => fs.mkdtempSync(path.join(os.tmpdir(), "fmt-hook-"));

function withFiles(names) {
  const cwd = workspace();
  for (const name of names) {
    fs.mkdirSync(path.join(cwd, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(cwd, name), "x\n");
  }
  return cwd;
}

const bash = (cwd, command) => ({ tool_name: "Bash", cwd, tool_input: { command } });

test("a heredoc redirect names the file it wrote", () => {
  const cwd = withFiles(["src/a.ts"]);
  assert.deepEqual(formattedFiles(bash(cwd, "cat > src/a.ts <<'EOF'\nconst x = 1\nEOF")), [
    path.join(cwd, "src/a.ts"),
  ]);
});

test("an append redirect and a tee both name their file", () => {
  const cwd = withFiles(["notes.md", "out.json"]);
  assert.deepEqual(formattedFiles(bash(cwd, "echo hi >> notes.md")), [path.join(cwd, "notes.md")]);
  assert.deepEqual(formattedFiles(bash(cwd, "echo '{}' | tee out.json")), [
    path.join(cwd, "out.json"),
  ]);
});

test("sed -i names its target on both BSD and GNU spellings", () => {
  const cwd = withFiles(["src/b.ts"]);
  assert.deepEqual(formattedFiles(bash(cwd, `sed -i '' 's/a/b/' src/b.ts`)), [
    path.join(cwd, "src/b.ts"),
  ]);
  assert.deepEqual(formattedFiles(bash(cwd, `sed -i 's/a/b/' src/b.ts`)), [
    path.join(cwd, "src/b.ts"),
  ]);
});

test("a command that writes nothing formats nothing", () => {
  const cwd = withFiles(["src/c.ts"]);
  assert.deepEqual(formattedFiles(bash(cwd, "rg -n TODO src/c.ts")), []);
  assert.deepEqual(formattedFiles(bash(cwd, "node --test > /dev/null")), []);
  assert.deepEqual(formattedFiles(bash(cwd, "git status --short")), []);
});

test("a file the command named but did not create is not formatted", () => {
  const cwd = withFiles([]);
  assert.deepEqual(formattedFiles(bash(cwd, "echo x > gone.ts")), []);
});

test("the Edit tool path still works", () => {
  const cwd = withFiles(["src/d.ts"]);
  assert.deepEqual(
    formattedFiles({ tool_name: "Edit", cwd, tool_input: { file_path: path.join(cwd, "src/d.ts") } }),
    [path.join(cwd, "src/d.ts")]
  );
});

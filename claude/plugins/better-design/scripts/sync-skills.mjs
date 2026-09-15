#!/usr/bin/env node
// Vendors every skill listed in skills-lock.json from its upstream GitHub repo
// into skills/, and records the resolved commit plus a sha256 per file so a
// later run can tell "upstream changed" from "we edited it locally".
//
//   node scripts/sync-skills.mjs            # fetch + write skills/ + update the lock
//   node scripts/sync-skills.mjs --check    # report drift, write nothing, exit 1 if any
//
// GITHUB_TOKEN is used when set; the unauthenticated API allows 60 requests/hour.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = join(root, "skills-lock.json");
const skillsDir = join(root, "skills");
const check = process.argv.includes("--check");

const headers = {
  accept: "application/vnd.github+json",
  "user-agent": "better-design-sync",
  ...(process.env.GITHUB_TOKEN
    ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}),
};

const DEFAULT_EXCLUDE = ["demo/", "agents/"];

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

async function api(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

async function raw(repo, commit, path) {
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path}`;
  const response = await fetch(url, { headers: { "user-agent": headers["user-agent"] } });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}

// Vercel ships the guidelines as a slash command, not a skill: the frontmatter
// carries `description` but no `name`, which Claude Code requires, and the body
// interpolates `$ARGUMENTS`, which nothing substitutes outside a command.
function commandToSkill(text, name) {
  return text
    .replace(/^---\n/, `---\nname: ${name}\n`)
    .replace(/^argument-hint:.*\n/m, "")
    .replace(/^(.*)\$ARGUMENTS(.*)$/m, "Review the UI code in scope for compliance:");
}

const transforms = { "command-to-skill": commandToSkill };

/** Every tracked file under skills/<name>, repo-relative, sorted. */
async function listVendored(name) {
  const base = join(skillsDir, name);
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(relative(base, full));
    }
  }
  await walk(base);
  return out.sort();
}

// One commit lookup and one tree listing per repo, not per skill: 39 skills
// across 5 repos otherwise burns 78 calls and trips the 60/hour anonymous cap.
const repoCache = new Map();
function describeRepo(repo, ref) {
  const key = `${repo}@${ref}`;
  if (!repoCache.has(key)) {
    repoCache.set(
      key,
      (async () => {
        const { sha: commit } = await api(
          `https://api.github.com/repos/${repo}/commits/${ref}`,
        );
        const tree = await api(
          `https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`,
        );
        if (tree.truncated) throw new Error(`${repo}: tree truncated`);
        return { commit, tree: tree.tree };
      })(),
    );
  }
  return repoCache.get(key);
}

async function syncSkill(name, entry) {
  const { repo, ref = "main", dir, only, exclude = [], rename = {}, transform } = entry;
  const { commit, tree } = await describeRepo(repo, ref);

  let paths;
  if (only) {
    paths = only;
  } else {
    paths = tree
      .filter((node) => node.type === "blob" && node.path.startsWith(`${dir}/`))
      .map((node) => node.path.slice(dir.length + 1))
      // Markdown only. Upstream skill folders also carry demo/ pages with
      // multi-megabyte .jpg/.webp assets (and agents/openai.yaml for other
      // harnesses); Claude Code reads none of it, and fetching a binary
      // through response.text() corrupts it.
      .filter((path) => path.endsWith(".md"))
      .filter((path) => !DEFAULT_EXCLUDE.concat(exclude).some((p) => path.startsWith(p)));
  }
  if (paths.length === 0) throw new Error(`${name}: no files matched in ${repo}`);

  const files = {};
  const contents = new Map();
  for (const path of paths.sort()) {
    const source = dir ? `${dir}/${path}` : path;
    let text = await raw(repo, commit, source);
    if (transform) text = transforms[transform](text, name);
    const target = rename[path] ?? path;
    files[target] = sha256(text);
    contents.set(target, text);
  }
  return { commit, files, contents };
}

const lock = JSON.parse(await readFile(lockPath, "utf8"));
const names = Object.keys(lock.skills).sort();
const drift = [];

for (const name of names) {
  const entry = lock.skills[name];
  const { commit, files, contents } = await syncSkill(name, entry);

  const local = Object.fromEntries(
    await Promise.all(
      (await listVendored(name)).map(async (path) => [
        path,
        sha256(await readFile(join(skillsDir, name, path), "utf8")),
      ]),
    ),
  );
  const changed =
    JSON.stringify(local) !== JSON.stringify(files) || entry.commit !== commit;

  if (check) {
    if (changed) drift.push(name);
    console.log(`${changed ? "DRIFT " : "ok    "} ${name}  ${commit.slice(0, 7)}`);
    continue;
  }

  await rm(join(skillsDir, name), { recursive: true, force: true });
  for (const [path, text] of contents) {
    const target = join(skillsDir, name, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  entry.commit = commit;
  entry.files = files;
  console.log(`${changed ? "updated" : "ok     "} ${name}  ${commit.slice(0, 7)}  ${Object.keys(files).length} file(s)`);
}

if (check) {
  console.log(drift.length ? `\n${drift.length} skill(s) drifted from upstream.` : "\nAll skills match upstream.");
  process.exit(drift.length ? 1 : 0);
}

await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`\nWrote ${names.length} skill(s) and updated skills-lock.json.`);

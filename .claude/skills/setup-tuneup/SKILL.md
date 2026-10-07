---
name: setup-tuneup
description: 'Find and fix what makes this Claude Code setup slow, flaky or noisy: mine real transcripts and the feedback inbox, measure hooks, MCP servers and local models, fix each problem with a before/after number, and verify it live. For work on the ai-setup repo itself.'
when_to_use: 'Triggers: "check today''s changes", "what else could we improve", "make the setup more reliable", "look for pain points", "check the other plugins", "check the feedback", "optimise the setup", "use the models more", "why is the hook slow", "is anything leaking". Use in the ai-setup repo when the task is improving the plugins, hooks, rules or local models rather than a feature. Use dev-core:self-improve instead when one specific correction needs to land in a skill or rule.'
---

# setup-tuneup

The loop that ran on 2026-10-07: gather evidence of friction, measure, fix one thing at a time with a number attached, verify it live, report what needs a decision. The deliverable is commits, not a list of ideas.

## 1. Gather

Run these first, in parallel where they are independent:

- `git log --since=<date> --stat` for what changed recently and may need a follow-up.
- `read_feedback` with `project: "all"`. Fix entries that belong to this repo; report the rest with who owns them.
- A transcript-mining subagent (sonnet, background). Tell it the transcript layout (`~/.claude/projects/<slug>/<session>.jsonl`, subagents under `<session>/subagents/`), to exclude eval sessions (cwd or slug under `/private/tmp`, `-tmp-`), to never print whole lines, and to return ranked pain points with counts and session paths. Ask for: hook errors and timeouts, verified blocks and what followed, tool errors by tool, user corrections quoted, long tool waits, blind `sleep` polling.
- For a plugin review, one subagent per plugin group (at most 3 at once), each told to run the plugin's tests and return up to 6 ranked candidates with evidence.
- Live state: `ps -eo pid,ppid,rss,etime,command` for MCP server memory and orphans (`ppid 1`). One `find_docs` call before and after shows what a query costs.

Subagent reports are leads. Re-check the number that decides a change before acting on it: one review claimed 19 of 20 URL blocks were pasted links, and the full ledger said 21 of 113.

## 2. Measure before changing

Time the real thing with real input, not a guess:

- A hook: pipe a real hook payload into it under `/usr/bin/time -l` and read wall time and max RSS.
- A local model: time import, load and first inference separately. On this machine e5-small loads in ~650 ms and embeds a short text in 7 ms on CPU; WebGPU loaded slower and ran slower for single texts. GPU only paid off for batched index builds.
- Memory a model holds: RSS of the owning process before and after one call.

## 3. Fix

- Name the observed case in the commit, with the before and after numbers.
- Write a test that fails on the old code. Check it with `git stash push <files>`, run, `git stash pop`.
- Stage only your own paths. Never `--no-verify`. If a repo's hook fails on problems that were already there, leave the change uncommitted and say so.
- A verified claim-pattern change goes through `/verified-replay` first.
- Contract tests pin agent wording (`agent-contracts.test.cjs`). Update the test only when the user approved the policy change.

Patterns that worked:

| Problem | Fix |
|---|---|
| A hook reads a large append-only file every run | Keep a small per-session state file, append updates instead of rewriting |
| A hook delays every prompt | Move it to an async Stop hook; its `additionalContext` arrives next turn |
| A model keeps memory after use (`dispose()` does not return RSS) | Run it in a child process that exits after N idle minutes |
| Work done at connect that few sessions use | Do it on first use |
| A stdio MCP server outlives its session | Exit on `process.stdin` `end` |

Do not do: trim the rules-index to path-scoped rules only (the user wants every rule listed); preload a model at connect when most sessions never call it.

## 4. Verify live

- Plugin hooks, skills and mods: ask the user to run `/reload-plugins`.
- A plugin MCP server keeps running old code until `/mcp reconnect <server name>` (for example `plugin:repo-docs:repo-docs`). `reconnect all` only retries disconnected servers.
- Rules under `~/.claude/rules/dev-core/` refresh at the next session start.
- `claude/hooks/scripts/*` deploy by copying to `~/.claude/hooks/scripts/`. The opencode side deploys with `bash opencode/install.sh`.
- Then check the live process: new pid, expected RSS, child processes appearing and exiting.

## 5. Report

One table of commits: change, measured before, measured after. Then what needs the user's call, one line each, with the number behind it. Things outside this repo (a team's pipeline, a package you would have to publish) are named with their owner, not fixed. Save new facts to memory: training data locations, baselines, decisions the user made.

## External facts

Fetch, do not recall. For docs where wording matters, curl the raw page (code.claude.com serves `<url>.md`) and search it. WebFetch summarises through a small model and once contradicted the hooks page it read.

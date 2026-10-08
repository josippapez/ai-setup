---
name: setup-tuneup
description: 'The ai-setup specifics for the find-improvements loop: where this setup''s friction shows up (transcripts, the feedback inbox, the verified ledger, plugin processes), how to measure its hooks, MCP servers and local models, and how to get a change live and verified in this repo.'
when_to_use: 'Triggers: "check today''s changes", "make the setup more reliable", "optimise the setup", "check the other plugins", "check the feedback", "use the models more", "why is the hook slow", "is anything leaking". Use together with dev-core:find-improvements, which owns the loop, whenever that loop runs on the ai-setup repo. Use dev-core:self-improve instead when one specific correction needs to land in a skill or rule.'
---

# setup-tuneup

Follow `dev-core:find-improvements` for the loop. This file only adds what is particular to ai-setup.

## Where the evidence is

- **Feedback inbox:** `read_feedback` with `project: "all"`. Fix the entries that belong to this repo and name the owner of the rest.
- **Transcripts:** `~/.claude/projects/<slug>/<session>.jsonl`, subagents under `<session>/subagents/`. Exclude eval sessions (cwd or slug under `/private/tmp`, `-tmp-`). Never print whole lines; some are megabytes.
- **verified ledger:** `~/.claude/verified/ledger.jsonl`. Blocks and their outcomes. Claim-pattern changes go through `/verified-replay` before they ship.
- **Plugin processes:** `ps -eo pid,ppid,rss,etime,command`, filtered to `standalone-mcp`, `reranker.cjs`, `interactive-mcp`, and anything with `ppid 1`.
- **Classifier training data:** `~/.claude/models/training/` (not in git, it holds client text).

## Measuring here

- **A hook:** pipe a real payload into it under `/usr/bin/time -l`. The payload shape is in the Claude Code hooks reference; download `https://code.claude.com/docs/en/hooks.md` and search it.
- **Local models:** e5-small loads in about 650 ms on CPU and embeds a short text in 7 ms. WebGPU was slower for single texts and only helped batched index builds. The reranker takes about 1 GB while loaded.
- **A `find_docs` query:** run one, then read the server's RSS.

## Getting a change live

| Changed | Live after |
|---|---|
| Plugin hooks, skills, mods | the user runs `/reload-plugins` |
| A plugin MCP server | `/mcp reconnect <server>`, for example `plugin:repo-docs:repo-docs`. `reconnect all` only retries disconnected servers |
| `dev-core/rules/*` | the next session start |
| `claude/hooks/scripts/*` | copying the file to `~/.claude/hooks/scripts/` |
| `opencode/*` | `bash opencode/install.sh` |

Mirror a changed dev-core skill or rule into `opencode/skills/` or `opencode/rules/`. Contract tests pin agent wording (`agent-contracts.test.cjs`). Update them only when the user approved the policy change.

## Decided here, do not revisit

- The rules-index lists every rule, always-on ones included.
- No reranker preload at connect: about 1 GB per session to save 1.3 s, and most sessions never search.
- A local copy of the verified residual judge was tested and dropped. Most of its blocks were wrong because the evidence check cannot see subagent or CLI output.
- The grep nudge fires on topic searches only, never on exact-string lookups.

---
name: agent-browser
description: 'Fetch facts from the live web and drive a real browser. Use for ANY question whose answer is not already in this repo or in a file you read — library APIs, current versions, changelogs, config keys, CLI flags, specs, error messages, pricing, docs of any kind — and for interacting with websites: navigating, filling forms, clicking, screenshots, extracting data, testing web apps. Triggers include "look this up", "check the docs", "is that still true", "what''s the latest version", "how does <library> do X", "verify this", "find out", "search for", "read this page", "what does this error mean", "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", "automate browser actions" — and any moment you are about to answer an external question from memory.'
---

# agent-browser — fetch the fact, don't recall it

> Source: [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)

**This skill's main job is research, not automation.** Per the always-on `external-facts` rule, any claim about something outside this codebase MUST come from a source you retrieved this session. `agent-browser read` is the cheapest way to do that, and it is a single command.

If you are about to write "I believe", "as of my knowledge", "typically", or "should be" in front of a library, version, flag, spec, or price — **stop and read the page instead.** One command costs less than being wrong.

## Setup

Install via `npm i -g agent-browser`, `brew install agent-browser`, or `cargo install agent-browser`; `agent-browser install` downloads Chrome. Existing Chrome, Brave, Playwright, and Puppeteer installs are auto-detected. `agent-browser upgrade` updates it. `agent-browser skills get core --full` prints the version-matched command reference — prefer it over guessing flags.

---

## 1. Fact-finding (start here)

`read` fetches a URL as agent-readable text: it prefers markdown, retries with `.md`, walks up to the nearest `llms.txt` for a matching docs link, and falls back to extracted HTML text. No snapshot, no refs, no browser reasoning needed.

```bash
# Read a docs page as markdown
agent-browser read https://example.com/docs/config

# Cheap first pass: headings only, then drill in
agent-browser read https://example.com/docs/config --outline
agent-browser read https://example.com/docs/config --filter "timeout"

# Docs sites that publish llms.txt — find the right page before fetching it
agent-browser read https://example.com --llms index
agent-browser read https://example.com --llms full --filter "authentication"

# Keep large pages from flooding context
agent-browser read https://example.com/docs/api --max-output 8000
```

**Verification loop, every time:**

1. `--outline` or `--llms index` to locate the exact page (skip if you already have the URL).
2. `read` it, with `--filter` when you know the term you need.
3. Quote the specific detail — option name, signature, version, number — and cite the URL you fetched.
4. If the fetch fails or the page is ambiguous, say `unverified` in the same sentence as the claim. Never fall back silently to memory.

**Use it for:** current library versions and changelogs, API signatures and option names, CLI flags, config keys, spec wording, error-message meanings, pricing and limits, GitHub issues and release notes, upstream migration guides, anything dated after your training cutoff.

**Prefer a narrower tool when one owns the subject** (see `external-facts` for the full ladder): `repo-docs` for our conventions and installed versions, `opensrc` for the exact installed source, `context7` for library docs, `accessibility` for WCAG, `claude-api` for Claude/Anthropic facts. Come back here when they don't cover it, or when you need the *live current* state of the world.

## 2. Interaction workflow

For anything beyond reading text, snapshot to get refs first:

1. **Navigate**: `agent-browser open <url>`
2. **Snapshot**: `agent-browser snapshot -i` (interactive elements only, refs like `@e1`)
3. **Interact**: use the refs to click, fill, select
4. **Re-snapshot**: after navigation or DOM changes, refs go stale

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# @e1 [input type="email"], @e2 [input type="password"], @e3 [button] "Submit"

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # check result
```

Useful snapshot flags: `-u` include link hrefs, `-c` drop empty structural nodes, `-d <n>` limit depth, `-s <css>` scope to a subtree.

## 3. Command chaining

The browser persists between commands via a background daemon, so `&&` chaining in one shell call is safe and cheaper than separate calls.

```bash
agent-browser open https://example.com && agent-browser wait --load networkidle && agent-browser snapshot -i
agent-browser fill @e1 "user@example.com" && agent-browser fill @e2 "pw" && agent-browser click @e3
```

Chain when you don't need to read an intermediate output; split when you must parse it first (e.g. snapshot → refs → interact).

## 4. Authentication

```bash
# Import auth from the user's browser (fastest one-off)
agent-browser --auto-connect state save ./auth.json
agent-browser --state ./auth.json open https://app.example.com/dashboard

# Persistent profile (simplest recurring)
agent-browser --profile ~/.myapp open https://app.example.com/login

# Named session, auto-saves cookies + localStorage
agent-browser --session-name myapp open https://app.example.com/login
```

## Command reference (common)

| Command | Description |
| --- | --- |
| `agent-browser read [url]` | **Fetch page as agent-readable text/markdown** |
| `agent-browser read <url> --outline` | Heading outline only (cheap first pass) |
| `agent-browser read <url> --llms index\|full` | Nearest `llms.txt` / `llms-full.txt` |
| `agent-browser read <url> --filter <text>` | Only matching sections |
| `agent-browser open <url>` | Navigate to a URL |
| `agent-browser snapshot -i` | Interactive element refs |
| `agent-browser get text\|html\|value\|url <sel>` | Extract a specific value |
| `agent-browser find role\|text\|label <v> <action>` | Locate then act without a snapshot |
| `agent-browser click\|fill\|select <ref> …` | Interact |
| `agent-browser wait --load networkidle` | Wait for network idle |
| `agent-browser screenshot [file]` | Screenshot (evidence) |
| `agent-browser console` / `errors` | Page console logs / JS errors |
| `agent-browser eval '<js>'` | Evaluate JavaScript |
| `agent-browser vitals [url]` | Core Web Vitals |
| `agent-browser close [--all]` | Close browser / all sessions |
| `agent-browser skills get core --full` | Version-matched full command reference |

## Local app checks

Point it at the dev server the project actually runs (check the repo's scripts rather than assuming a command). Good for form flows, visual regression via `screenshot`, and catching runtime errors with `console` / `errors`. `--headed` shows the browser while developing.

---

See also: `external-facts` rule (when fetching is mandatory and which tool to use), `evidence-first` rule (Gate 1 — the citation test).

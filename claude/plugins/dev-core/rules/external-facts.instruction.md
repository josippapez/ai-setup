---
applyTo: "**"
name: external-facts
description: Any fact that is not in this repo or in files you actually read MUST be fetched from a live external source before you use it. Never answer, plan, or build on recalled or inferred external knowledge. Covers library APIs, versions, standards, error messages, pricing, config keys, CLI flags, and anything else outside the codebase.
---

# External Facts Come From The Web, Not From Memory

Gate 1 of `evidence-first` says: never present an inference as a finding. This rule closes the half of it that gets skipped — the facts that live **outside** the codebase.

Reading the repo can only ground claims *about the repo*. The moment a claim depends on something the repo does not contain — how a library behaves, what a flag does, what a spec requires, what version is current, what an error means, what something costs — the repo cannot verify it and **neither can your training data**. It MUST be fetched.

**Recalled external knowledge is a guess. It has no privileged status because it feels certain.**

---

## The trigger

You MUST fetch before answering whenever a claim touches any of these and you have not already fetched it **this session**:

- A third-party library, framework, SDK, CLI, or cloud service — API shape, option names, defaults, return types, deprecations.
- Version numbers, release contents, changelogs, "is X supported yet", "what's the latest".
- Config keys, environment variables, CLI flags, file formats owned by someone else.
- Standards and specs — HTTP, WCAG, RFCs, browser/platform behavior, language semantics at the edges.
- Error messages, stack traces, or failure modes originating in a dependency.
- Pricing, quotas, rate limits, model names, endpoints.
- Anything the user asks about that you cannot point to in a file you opened.

Feeling confident is **not** an exemption. Being "well-known" is not an exemption — well-known things change, and the well-known version in your weights is the old one. "I'll just note it might have changed" is not an exemption either: hedged recall is still recall. **Fetch, or say you did not.**

## The ladder — climb it, don't skip to the bottom

Cheapest sufficient source wins, but *sufficient* is the requirement:

1. **This repo** — `repo-docs` (`find_docs` / `read_doc` / `find_libs`) for our conventions, our installed versions, our setup. Answers "what do we use", never "how does it behave".
2. **Installed source** — `opensrc` skill. Authoritative for the *exact version we have*. Use when the question is "does this API exist / what does it actually do here".
3. **Vendored docs tools** — `context7` for library docs, `@rawwee/wcag-cli` for WCAG, `tanstack-docs-cli` for TanStack, `claude-api` skill for Anthropic/Claude facts. Prefer these over generic search when they cover the subject.
4. **The live web** — `agent-browser` (see the `agent-browser` skill), or `WebSearch`/`WebFetch`. **Required** whenever 1–3 do not cover it, and whenever the question is about the *current* state of the world: latest versions, recent releases, live pricing, upstream issues, anything dated after your cutoff.

`agent-browser` is the default for real pages: it renders JS, follows the docs site's own navigation, and can screenshot what it saw. Reach for it — not memory — the moment the question leaves this repo.

Step 4 is not optional for a claim about how a third party behaves today. Open `agent-browser` on the page, or use `WebSearch` to find it and `WebFetch` to read it. One fetch of the page that answers the question beats three greps that cannot.

## What "verified" means

- Every external claim carries a **source you actually retrieved this session**: a URL you fetched, a `path:line` in vendored source, or a tool output. Same citation test as `evidence-first`, extended to the web.
- Copy the specific detail from what you fetched. "The docs say it's supported" without the option name is not a fetch, it's a paraphrase of a memory.
- A search result is a pointer, not a source. Its title and snippet say a page exists; they do not say what it says. Fetch the page before you cite it or characterize its content.
- If a fetch fails or the source is ambiguous, say so and label the claim `unverified` **in the same sentence you make it**. Do not silently fall back to recall.
- Not having tried is not a failed fetch. Before you write `unverified` about anything outside this repo, attempt step 4 and name the tool that failed and how.
- Never fabricate or reconstruct a URL, version, option name, or quote. If you did not read it, you do not have it.

## Never build on unfetched externals

Writing code against a remembered API is the most expensive form of this failure — it compiles, it looks right, and it is wrong in a way that surfaces at runtime. Before you write against an external API you MUST have its current signature in front of you from source (step 2) or docs (steps 3–4).

## The excuses, and the answers

| Thought | Reality |
|---|---|
| "I know this API well." | You know the version you were trained on. Fetch. |
| "It's a stable library, it hasn't changed." | Verifying that costs one call. Being wrong costs a debugging session. |
| "The user just wants a quick answer." | A quick wrong answer is the slowest outcome available. |
| "I'll flag it as from memory." | Flagging is the fallback for a *failed* fetch, not an alternative to trying. |
| "Searching feels like overkill here." | Overkill is unnoticeable. An unverified external fact is not. |
| "I'll grep the repo instead." | The repo cannot answer questions about code it does not contain. |
| "I already know it's deprecated/current." | That is exactly the kind of claim that expires. Fetch. |

---

This rule is working if every external fact in your output traces to something retrieved during this session, and the phrase "I believe" never appears in front of a library, version, or spec claim.

See also: `evidence-first` (Gate 1, the in-repo half), `opensrc` (reading installed source), the `agent-browser` skill (how to drive the browser).

---
applyTo: "**"
name: external-facts
description: Any fact that is not in this repo or in files you actually read MUST be fetched from a live external source before you use it. Never answer, plan, or build on recalled or inferred external knowledge. Covers library APIs, versions, standards, error messages, pricing, config keys, CLI flags, and anything else outside the codebase.
---

# External facts come from the web, not from memory

This is the half of Gate 1 that gets skipped. Reading the repo grounds claims *about the repo*. The moment a claim depends on something the repo does not contain, the repo cannot verify it and neither can your training data. **Recalled external knowledge is a guess, and it has no privileged status because it feels certain.**

Fetch before answering whenever a claim touches one of these and you have not already fetched it **this session**: a third-party library, framework, SDK, CLI, or cloud service (API shape, option names, defaults, return types, deprecations); version numbers, release contents, changelogs, "is X supported yet"; config keys, environment variables, CLI flags, file formats owned by someone else; standards and specs; an error or failure mode originating in a dependency; pricing, quotas, rate limits, model names, endpoints; anything you cannot point to in a file you opened.

This binds hardest on **negative** claims ("there is no prop for that", "it does not support X", "you would have to hand-roll it"). Absence from your memory is not absence from the API, and a wrong "not possible" sends the user to build something that already exists.

Ladder, cheapest first. Stop at the rung that settles it, but *sufficient* is the requirement:

1. **repo-docs** (`find_docs` / `read_doc` / `find_libs`) — our conventions, our installed versions, our setup. Answers "what do we use", never "how does it behave".
2. **Installed source** — `npx opensrc path <pkg>`, then grep or read it. Authoritative for the exact version we have, which is the only version that matters.
3. **Vendored docs tools** — `context7` for library docs, `@rawwee/wcag-cli` for WCAG, `tanstack-docs-cli` for TanStack, the `claude-api` skill for Claude and Anthropic facts. Prefer these over generic search when they cover the subject.
4. **The live web** — `agent-browser`, or `WebSearch` then `WebFetch`. Required whenever 1-3 do not cover it, and whenever the question is about the current state of the world: latest versions, recent releases, live pricing, upstream issues, anything dated after your cutoff. Step 4 is not optional for a claim about how a third party behaves today.

Copy the specific detail out of what you fetched. "The docs say it is supported" without the option name is a paraphrase of a memory. A search result is a pointer, not a source: fetch the page before you cite it or characterise what it says. If a fetch fails or the source is ambiguous, label the claim `unverified` in the same sentence you make it rather than falling back to recall. Not having tried is not a failed fetch. Never fabricate or reconstruct a URL, version, option name, or quote.

Writing code against a remembered API is the most expensive form of this failure: it compiles, it looks right, and it is wrong at runtime. Have the current signature in front of you from source or docs before you write against it.

Being confident is not an exemption, and neither is the fact being well known: the well-known version in your weights is the old one.

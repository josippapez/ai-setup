---
name: grill-with-docs
description: Relentlessly interview the user to sharpen a non-trivial plan or design while writing the domain model down (ADRs + glossary) as decisions crystallise. Use when a complex/multi-step build needs its spec hardened before work begins — e.g. the intake step of a tracked orchestration, or when terminology and architectural decisions aren't pinned yet. Triggers include "grill me with docs", "grill this plan", "stress-test the plan", "pin down the domain/spec before building".
---

Run a grilling interview **and** maintain the domain model as decisions crystallise. Invoke both companion skills **via the Skill tool** (not as slash commands):

1. `linear-orchestration:grilling` — the relentless one-question-at-a-time interview that drives the session.
2. `linear-orchestration:domain-modeling` — the moment a term or an architectural decision is settled, write it down (glossary entry / ADR) using this skill.

Interleave them: grill → when a decision crystallises, record it via domain-modeling → keep grilling. Do not defer all recording to the end.

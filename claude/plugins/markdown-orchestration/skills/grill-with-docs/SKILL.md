---
name: grill-with-docs
description: 'Interview the user relentlessly to sharpen a non-trivial plan while writing the domain model down (ADRs and glossary) as decisions settle.'
when_to_use: 'Triggers: "grill me with docs", "grill this plan", "stress-test the plan", "pin down the domain/spec before building", "harden this spec". Use as the intake step of a tracked orchestration, or when a complex multi-step build needs its spec hardened and its terminology pinned before work begins. Use grilling instead when nothing needs writing down.'
---

Run a grilling interview **and** maintain the domain model as decisions crystallise. Invoke both companion skills **via the Skill tool** (not as slash commands):

1. `markdown-orchestration:grilling` — the relentless one-question-at-a-time interview that drives the session.
2. `markdown-orchestration:domain-modeling` — the moment a term or an architectural decision is settled, write it down (glossary entry / ADR) using this skill.

Interleave them: grill → when a decision crystallises, record it via domain-modeling → keep grilling. Do not defer all recording to the end.

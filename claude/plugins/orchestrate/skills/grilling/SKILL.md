---
name: grilling
description: 'Interview the user relentlessly about a plan or design, one question at a time with a recommended answer each time, to find the holes before any code is written.'
when_to_use: 'Triggers: "grill me", "grill this", "grill the plan", "poke holes in this", "stress-test this", "challenge my assumptions", "what am I missing", "interrogate this design". Use when the user wants a plan pressure-tested before building. Use grill-with-docs instead when the decisions should also land as ADRs and a glossary.'
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing. Asking multiple questions at once is bewildering.

If a question can be answered by exploring the codebase, explore the codebase instead.

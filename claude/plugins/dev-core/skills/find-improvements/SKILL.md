---
name: find-improvements
description: 'Research a project for what makes it slow, flaky, costly or painful to work with, then fix the problems one at a time, each with evidence: where the friction shows up, a measurement before and after, a test that fails on the old code, and a check where the code really runs. Ends with the fixes made and the decisions left for the user.'
when_to_use: 'Triggers: "what could we improve", "look for pain points", "find improvements", "make this more reliable", "optimise this", "why is this slow", "is anything leaking", "check the other parts as well", "do a tune-up", "research and fix what is worth fixing". Use for open-ended improvement of an existing codebase, service, tool or setup when nobody has named the defect yet. Use a review skill instead (code-review, exhaustive-code-review) when the question is whether a given diff is correct, and self-improve when one specific correction needs to land in a skill or rule.'
---

# find-improvements

Open-ended "make it better" work fails in two ways: a list of ideas nobody acts on, and changes nobody can show were needed. This loop turns evidence into fixes, one at a time, and leaves the user only the decisions that are really theirs.

## 1. Gather evidence of friction

Look at how the thing is actually used, not how it reads:

- **Recent changes.** `git log --since=<date> --stat`. New work is where the follow-ups are.
- **What users and logs say.** Issue trackers, error logs, support notes, an inbox of reported problems, CI failures, flaky test history. Quote what people wrote.
- **What the system does under real load.** Slow requests, long jobs, memory that grows, processes that outlive their parent (`ps` with `ppid 1`), retries, timeouts, polling with blind sleeps.
- **Agent transcripts, when the project is worked on with agents.** Corrections the user had to make, tool errors, long waits.

Hand broad sweeps to background subagents, at most three at once, each with the data layout, what to exclude, and a return shape of ranked candidates with counts and locations. Their reports are leads. Re-check the one number that decides a change before acting on it: one sweep here claimed 19 of 20 cases, and the full data said 21 of 113.

## 2. Measure before changing

Time and size the real thing with real input:

- Wall time and peak memory: `/usr/bin/time -l <command>` on macOS, `/usr/bin/time -v` on Linux.
- For a long-running process, its RSS before and after one representative request.
- Split a slow step into its parts (start-up, load, first call, steady state). The fix depends on which part dominates.
- Compare the alternatives you are tempted by on the same input. A faster device or a bigger batch is not faster until measured.

## 3. Fix one thing at a time

- Every change names the case it fixes and carries the before and after numbers in the commit message.
- Write the test first or alongside, and prove it fails on the old code: stash the source change, run the test, restore.
- Fix at the lowest layer that holds. A guard in the shared handler beats a check in one caller.
- Stage only your own paths. Never skip hooks. If the project's own checks fail for reasons that predate you, fix those first in a separate commit, or leave your change uncommitted and say why.
- Changes that alter how the team works, trade quality for cost, or remove something someone chose are proposals, not fixes. Put them in the report.

Shapes that came up more than once:

| Friction | Usual fix |
|---|---|
| Work repeated on every call (re-reading a growing file, rebuilding an index) | Keep small state, append instead of rewriting, rebuild only what changed |
| Slow work on the user's critical path | Move it off the path: background, async, or after the response |
| Memory held after use that `dispose`/`free` does not return | Run the heavy part in a child process that exits when idle |
| Work done at start-up that few runs need | Do it on first use |
| A child process that outlives its parent | Exit when its input closes or its parent disconnects |
| Duplicate work across two layers | Let one layer own it and have the other step aside |
| A heuristic that fires on the wrong cases | Measure precision on real cases before and after narrowing it |

Do not build: speculative hardening with no observed failure, preloading that costs every run to save a rare one, a model or classifier before checking that a perfect version would change the outcome.

## 4. Verify where it runs

Tests passing is not the end. Check the running system picked up the change: restart or reload what holds the old code, then look at the live result (new process id, expected memory, the slow call now fast). Say plainly when something could not be checked live.

## 5. Report

- One table of what changed: the change, the measured before, the measured after.
- What needs the user's decision, one line each with the number behind it.
- Problems that belong to another team or system, named with their owner, not fixed.
- What was tried and dropped, and why, so nobody repeats it.

Save anything a later session needs (baselines, data locations, decisions the user made) to memory.

## External facts

Library behaviour, CLI flags, platform limits: read the installed source or fetch the docs before relying on them. When exact wording matters, download the raw page and search it rather than trusting a summary.

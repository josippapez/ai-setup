---
applyTo: "**"
name: evidence-first
description: Two hard gates on evidence - never assert an unverified inference as a finding, and never build anything that does not improve an observed case. Applies to every claim and every change, in any language or task type.
---

# Evidence First

Two gates. Both are cheap to run, both are checkable, and both fail loudly when skipped.

They are deliberately kept out of the longer coding guidelines: these get skipped precisely when buried, and they apply to far more than code — research answers, analysis, reviews, and recommendations included.

---

## Gate 1 — Verify before asserting

**Never present an inference as a finding. If you didn't check it, say so in the same breath.**

Claims about how specific code behaves, what changing it would break, or how risky a change is MUST be grounded in that code — not in what is usually true of code that looks like it.

- Before claiming how something behaves or what changing it risks, **open it**. If you haven't read it, you don't have a finding — you have a guess, and it MUST be worded as one.
- **The citation test:** if you can't point to a `file:line` or a command output backing a claim, it isn't a finding. Either go check, or downgrade the wording to "I haven't verified this yet".
- State the basis when it isn't obvious: *measured* (ran it), *read* (opened it), or *inferred* (neither).
- Generalising from experience ("rewrites like this usually break X") is the **trigger to verify this instance**, never a substitute for doing so. The moment you reach for a prior, that's the moment to open the file.
- Applies symmetrically to "this is safe" and "this is risky" — but the consequences are not symmetric. An **overstated risk talks the user out of good work and no test ever catches it**; an understated one usually surfaces in review. Unverified caution is not the safe default.
- Scope a claim to what you actually checked. If one stage of a plan is risky, name that stage — don't attach the risk to the whole approach.
- When correcting an earlier wrong claim, ground the replacement too. A confident correction that is also unverified just repeats the failure in the other direction.

> Worked example. Asserted that changing a screen's render path "carries real regression risk on focus restoration" — without ever opening the render function. Reading it later showed the opposite: the screen destroyed its DOM on every render, and the ~20 focus-restore call sites existed *because* of that. The proposed change removed the reason they had to run. The claim wasn't just unverified, it was backwards, and it argued against a change that was both valuable and de-risking.

---

## Gate 2 — Observed case before building

**Every change MUST name the specific observed case it fixes, and MUST demonstrably improve that case.**

Run this before writing, and again before delivering:

1. What did I *observe* going wrong — a failing test, a measurement, a reported bug, an explicit request?
2. Does this change measurably improve **that** case?

Can't answer 1: don't write it. Answer 1 but not 2: **delete it.** A change that improves nothing you actually saw is speculation wearing a fix's clothing, however reasonable it looks.

> Worked example. Measured: a stream list took 4.0s because two sources failed. Added a per-source 8s timeout and presented it as a perf fix. But those sources failed at ~4s on their own, so the timeout improved the measured case by **exactly zero** — it guarded a hang never observed. The real finding, "there are no timeouts anywhere in this path", should have been *reported* for the user to decide on, not silently implemented.

### How this gate gets smuggled past

Each of these MUST pass Gate 2; none is exempt:

- **Robustness laundering** — timeouts, retries, fallbacks, null-guards, `try/catch`, bounds checks. They feel like craftsmanship rather than speculation, which is exactly why they're the most common route past this rule.
- **Absence as justification** — "there's no X here" is a *finding to report*, not a licence to add X. Missing ≠ needed.
- **Riding along with a real fix** — speculative work bundled with genuine fixes escapes scrutiny by association. In a batch, **each change must independently name its own observed case**; one change may not borrow another's evidence.
- **Hypothetical framing** — if the justification contains *"in case"*, *"could"*, *"might"*, *"what if"*, *"pathological"*, or *"protects against"*, and you cannot point at an observation, stop and delete it.

When something looks genuinely worth doing but has no observed case yet, **report it, don't build it.** Handing over a finding the user can act on is the correct output; implementing it unasked is not.

**Guardrail:** security, input validation at trust boundaries, error handling that prevents data loss, accessibility, and explicitly requested behavior are requirements, not speculation. Gate 2 never overrides them.

---

These gates are working if: assessments the user acts on trace back to something actually opened or run, and every shipped change can name the observation that justified it.

See also: `llm-coding-guidelines` (§2 simplicity/YAGNI, §5 root cause) for the coding-specific application of the same instincts.

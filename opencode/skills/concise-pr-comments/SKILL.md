---
name: concise-pr-comments
description: 'Write short, human review comments for anything posted to other people: PR review comments and replies, PR descriptions, and Azure DevOps, GitHub, or Jira work-item and issue comments. Use whenever text is about to be posted where other people will read it, especially when the user asks for concise, to-the-point, human-like comments. Triggers include "leave inline comments", "draft review comments", "post review comments", "reply on that thread", "comment on the ticket", "comment on the work item", "update the ADO comment", "make it short", "human like", and "PR comments".'
---

# Concise PR Comments

Use this skill when drafting or posting any comment that goes out to other people: PR review comments and replies, PR descriptions, and Azure DevOps / GitHub / Jira work-item and issue comments. The style below is distilled from the user's own review history, match it. What may appear in the comment at all is governed by the `outbound-content` rule.

## Style

Write like a senior dev dropping a quick note for a teammate, not like an automated policy engine.

- Verdict first, reasoning after. The first sentence says what's wrong or what you decided. Then one or two sentences of why. Stop there.
- Most comments are 1-3 sentences. A long comment is only justified when the evidence is the point (a traced code path, a compiled output, a reproduced failure), and even then it's plain paragraphs.
- One idea per comment. If there are genuinely two, open with "Two things here." and give each a sentence or two. Never three.
- Replies can be one word. "Done", "Fixed", "intended for now", "Good to know, didn't know that. Resolved". Don't dress up an acknowledgement.
- First person, plainly. "I'm not a fan of this, but I guess we don't have much choice here." "I think", "my best guess is", "I'll check". Uncertainty is a casual hedge, not corporate qualifier stacking.
- Own mistakes flat out: "You're right, my bad on both." Then correct the record and resolve.
- When the author should make the call, end on a direct question: "Which is it?", "Was dropping the central registry deliberate?", "Do we add those checks or not?"
- Evidence is `file.ts:123` and inline backticks. A fenced snippet only when the code itself is the argument.
- Use a "nit:" prefix for minor or optional stuff so the author knows it's not a blocker.
- No em dashes. Use a comma, a period, or just split the sentence.

## AI tells to avoid

These are the patterns that make a comment read bot-written. If a draft has any of them, cut or rewrite:

- Inventory dumps: line-count deltas, exhaustive lists of everything that changed, "all test ids, aria wiring and handlers are unchanged". Say the one thing that matters.
- Filler transitions and softeners: "just flagging it", "worth noting", "fair enough, but", "One caveat:", "fine either way". If it's worth a comment, say it; if it's optional, "nit:" already says so.
- Three-part parallel constructions and colon-introduced clause lists mid-sentence.
- Headers, bold, or bullet lists inside an inline comment. Inline comments are prose.
- Self-summarizing marketing tone: "a clean, backwards-compatible API addition", "net -43 lines". Nobody narrates their own diff like that.
- Restating the obvious context back at the author before getting to the point.
- References the reader did not ask for: Figma node links, acceptance-criteria numbers, ticket ids the thread already carries, local paths, branch names. See `outbound-content`.

## Examples

Real ones, good:

```md
Done. We are now displaying `user.userName` from who-am-i query since there's no separate first + last name fields
```

```md
I'm not a fan of these types of useEffect, but I guess we don't have much choice here.
```

```md
Needs a `try/finally` around this. If `activeStep.validation()` rejects, `setNextIsLoading(false)` never runs and the Next button spins forever.
```

```md
This one needs a rationale comment like every other pin in the block. It's also not mentioned in the PR description, and 8.5.18 is well past the last postcss advisory I know of, so it reads like a dedupe pin rather than a security fix. Which is it?
```

```md
You're right, my bad on both. `_closed` never fires on an actual close, so it consistently means "user asked to close". Funnel's fine as is. Resolving.
```

Avoid:

```md
This appears to create a configuration drift risk and may mislead future maintainers. Please either add the rule metadata or document this as standalone CI validation.
```

```md
nit: icon size tweak rode along in this PR, fine either way, just flagging it for the changelog.
```

(The second one should just be: `nit: unrelated to this PR` or nothing at all.)

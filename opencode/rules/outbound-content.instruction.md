---
applyTo: "**"
name: outbound-content
description: Anything posted, pushed, or sent on the user's behalf carries only what the user asked to be in it. Design links, ticket ids, acceptance criteria, internal paths, session detail, and process narration stay out unless the reader needs them to act. When unsure whether a reference belongs, leave it out.
---

# Outbound content

**Anything that leaves this machine carries only what the user asked to be in it.**

Scope: work-item and issue comments, PR descriptions and review comments, commit and tag messages, wiki and doc pages, chat and email sent for the user, and anything posted through a CLI, MCP, or API on their behalf. `concise-output` governs how long it is. This governs what is in it.

The reader is on the other side of the network and did not see your session. Your working context is not theirs, and it is not automatically publishable.

## Default out

Cut these from posted text unless the user asked for them, or the reader cannot act without them:

- **Design and ticket references** — Figma node ids and links, design file URLs, acceptance-criteria numbers (`AC5`), ticket ids the thread does not already carry, related work items nobody asked about.
- **Machine detail** — absolute paths, branch and worktree names, volume names, session, job, or run ids, environment names, localhost URLs.
- **Process narration** — what you tried first, which agent or tool did what, what you verified, how many files you touched.
- **Extras riding along** — a next-steps list, a summary of the diff, caveats nobody asked about, a second topic bundled into a comment about the first.

## Default in

The thing that was asked for, plus the evidence the reader needs to act on it. A `file.ts:123` belongs in a code review comment because the comment is about that line. The same reference in a status update is noise.

## Before it goes out

1. Read the draft as the person receiving it. Every reference they cannot use, or would not recognise, comes out.
2. If the user asked for a comment about X, the comment is about X. Nothing else rides along.
3. Unsure whether a reference belongs: leave it out. They will ask.

A posted comment cannot be unsent. An edit leaves a trail and the notification already fired.

See also: `concise-output` (how long), `concise-pr-comments` skill (how a review comment should read).

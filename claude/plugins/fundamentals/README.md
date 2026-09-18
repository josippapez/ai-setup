# fundamentals

One skill, `building-blocks`. It explains what is going on, what was built, and what was
already there, in plain words, for someone who was not in the session.

It exists because end-of-session handoffs came out as a wall of text: correct, complete, and
unreadable the next morning. The skill forces a different shape. Name the pieces, say what
each one does, mark which ones are new, say what is still open, say what to do next.

- Fires on `/fundamentals:building-blocks`, and on the natural asks: "handoff", "recap",
  "catch me up", "I'm out of the loop", "explain this simply", "how does this work".
- Marks every piece **new**, **changed**, or **already there**, so a reader coming back cold
  can tell this session's work from the machinery that predates it.
- Two layouts: recap mode when work happened, explain mode when nothing changed and the
  reader just wants to understand something that already exists.
- Writes in one of three shapes (prose, bullets, sections), picked from how much happened,
  and offers the other two in a single closing line.
- Separate plugin so it can be turned off without touching the engineering rules in
  `dev-core` or the writing rules in `concise-output`.

The words are still governed by the `concise-output` style; this skill only governs the
shape of the explanation.

Mirrored by hand into `opencode/skills/building-blocks/`; edit both.

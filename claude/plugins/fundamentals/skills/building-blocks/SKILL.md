---
name: building-blocks
description: Explain what is going on, what was built, or the answer to a question in plain words, for someone who was not here. Names the building blocks, marks which ones are new and which were already there, and skips the jargon. Use for end-of-session handoffs and any moment the reader would be out of the loop.
when_to_use: 'Triggers: "handoff", "recap", "wrap up", "summarize the session", "what did we do", "what did you build", "what changed", "what was already there", "where are we", "catch me up", "I am out of the loop", "explain this simply", "in plain english", "like I am new here", "what is going on", "how does this work", "what is this", "what is this thing", "what does this do", "what does this actually do", "what is it for", "why does this exist", "eli5". Also use unprompted at the end of a long or multi-part session, in place of a wall-of-text summary. Not for a one-line factual answer that is already plain.'
---

# Building blocks

Explain the thing so someone who was not in the session gets it on one read. That someone
is usually the user tomorrow, after the context is gone.

Everything below is about the shape of the explanation. The `concise-output` writing rules
still govern the words: plain register, active voice, no em dashes, no AI vocabulary.

## The core move

Name the building blocks, say what each one does, and say whether it is new.

A building block is a thing that exists and that the reader could point at: a file, a
command, a setting, a rule, a screen, a package. Give it the name they would actually type
or see, then one clause of what it does for them. A wall of text happens when the pieces
are never named and the reader has to reverse-engineer them out of narrative.

**Always separate what you just did from what was already there.** A reader coming back
cold cannot tell them apart, and a recap that blurs the two is worse than none: they will
either take credit for machinery that predates them, or go looking for a piece you never
touched. Mark every block **new**, **changed**, or **already there**. Three words, no
ceremony:

> - `building-blocks` **(new)** writes the recap in plain words.
> - `claude/install.sh` **(changed)** now installs the plugin along with the others.
> - `concise-output` **(already there)** still decides how the sentences read.

Name an already-there block only when the new work does not make sense without it, or when
the reader will trip over it. Everything else that predates the session stays out.

## Two situations

Same move, two layouts. Pick from whether anything changed.

### Recap mode, when work happened this session

1. **What you wanted.** One sentence, in their words, so they know this is the right recap.
2. **The pieces.** The blocks, each marked new, changed, or already there.
3. **What is different now.** What they can do that they could not before.
4. **What is still open.** Unfinished work, known limits, decisions you made for them.
5. **Your move.** The next concrete action. A command, a restart, a review.

### Explain mode, when nothing changed and they want to understand something

1. **What it is.** One sentence. The job it does, not its category.
2. **The pieces.** The blocks it is made of. All of these are already there, so skip the
   marks and just name and gloss them.
3. **How they fit.** The path through them, in order, as a short chain.
4. **Where it bites.** The part people get wrong, the limit, the surprising bit.
5. **Where to look.** One path or command, the place they would start reading.

If the session did both, run recap mode and let the already-there blocks carry the
explaining.

## Rules

- **Every name gets a gloss the first time.** "A hook (a script the tool runs by itself at
  a set moment)". If you cannot gloss it in a half sentence, you do not understand it well
  enough to write the recap.
- **No process narration.** They do not need what you tried first, which agent ran, how many
  files you opened, or what you verified. What exists now, and what it does.
- **No path dumps.** One path when it is the thing they will open. Not a file tree.
- **Concrete over abstract.** "You type `/foo` and it prints X", not "provides a streamlined
  interface for X".
- **Say the boring word.** faster, smaller, fewer clicks, stops the crash. Not "improves the
  developer experience".
- **Numbers over adjectives.** "20 seconds instead of 5 minutes" beats "much quicker".
- **Do not hide bad news.** Something broken, skipped, or guessed at goes in "still open",
  in full, first.

## Three shapes, and you pick one

Same content, three layouts. Read the session, pick the fit, and write it. Do not ask first:
a question widget hides the text above it, so the recap has to land before any question.

**Prose.** Two short paragraphs, no headings, written the way you would say it out loud.
Default for a short session, one topic, one or two blocks. The new/already-there split still
happens, in words: "that part is new, the rest was already there".

**Layered.** A one-line headline in bold, then three to six bullets, one per block. Default
for a normal session with several pieces.

**Sections.** The five headings for the mode you are in, one short paragraph or bullet list
under each. Default for a long or multi-part session, and for anything with real open
questions.

After the recap, close with one line offering the other two by name, for example:
"Want that as bullets or as full sections instead?" One line, at the end, never before.

If the user names a shape, use it and skip the offer.

## Depth

Write the version that stands alone. Then say, in one clause, that there is more if they
want it: "ask about any of these and I will go deeper". Do not pre-write the deep version.

## Example

Bad, and the reason this skill exists:

> Implemented a new plugin at claude/plugins/fundamentals/ containing a SKILL.md with
> frontmatter defining name, description and when_to_use fields, registered in the
> root-level .claude-plugin/marketplace.json with a source pointing at the plugin
> directory, and added to enabledPlugins in claude/settings.json, alongside an entry in
> the install loop in claude/install.sh so that claude plugin install runs for it...

Good, same work, prose shape:

> You were getting session recaps nobody could read. So there is a new skill called
> `building-blocks`. When you ask for a handoff, or say you are out of the loop, it writes
> the recap in normal words: what you wanted, what now exists, what is left. That skill is
> the only new part. The installer and the marketplace list were already there, they just
> have one more line each now.
>
> It is turned on already. Restart Claude and it is live. Ask about any part of it and I
> will go deeper.

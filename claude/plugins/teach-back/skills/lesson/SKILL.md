---
name: lesson
description: Teach the person the task and the idea behind its solution, not only the diff, as an interactive lesson and quiz in the Teach-back pane, so work they handed over (a ticket, a bug, "just do it") doesn't leave them out of the loop. - Triggers: "teach me", "teach back", "teach it back", "quiz me", "test me on this", "what did you do and why", "help me understand what you changed", "I want to learn this change", "/teach-back", and the Teach-back "Teach me" button. Only when the person asks: never start a lesson on your own judgment. Use fundamentals:building-blocks instead for a plain text recap the person only wants to read.
---

# Teach-back

The goal: after the lesson, the person understands the task and the idea behind the solution well enough to explain it to a reviewer, a teammate or a client, and to solve the next task like it without you. The code is where the idea lives, not the lesson itself. They read a short lesson first, then answer a quiz that checks they got it.

You deliver it by calling the `mcp__teach-back__lesson` tool, which opens it in the Teach-back pane. Never write the lesson or the questions in chat.

## 1. Gather what happened

Work from evidence, not memory of the session. Collect five things:

- **The task.** What was asked, in the ticket's own words if it is in the conversation. Then the problem behind it: what was wrong or missing before, who it hurt, and why it matters now.
- **The domain.** The business or product concepts the task touches (a status flow, a calculation, a role, a lifecycle), and the rule as the business would say it.
- **The idea.** The approach in one sentence, without code. The mental model that makes it work, the general technique or pattern it uses (caching, idempotency, a state machine, moving a check to the server), and where else that idea applies.
- **The decisions.** What was tried, what was rejected and why, and the constraints hit (a convention, an API limit, a failing test, a reviewer's rule).
- **The code and the proof.** Where the idea lives: on a feature branch, `git log --oneline <base>..HEAD` and `git diff <base>...HEAD`, where `<base>` is `git merge-base HEAD origin/<default branch>`; otherwise this session's commits plus the uncommitted diff. Read changed files where the diff alone doesn't explain them. Then the test or check that shows it works, and what is still unverified.

When the request names a focus (`/teach-back the retry logic`), teach only that.

## 2. Write the lesson: 4 to 7 sections

Each section is one thing the person needs to understand. Order them like this, merging or skipping a step only when it has nothing to say:

1. **The problem.** What was wrong before and why it matters. No code.
2. **The idea.** The approach in plain words and the mental model behind it. No code, or a few lines of pseudocode at most.
3. **The domain**, when the task touched a business rule: the rule in the business's words, and how the code now follows it.
4. **Where it lives.** The pieces of code that carry the idea, one section per piece when there are several. Here the diff comes in.
5. **How it's proven and what could go wrong.**
6. **Take it with you.** The general lesson: the pattern, when to reach for it, and when not to. What the person should do the same way on the next task like this.

For each section:

- `heading`: plain words, no jargon the person hasn't seen.
- `body`: markdown, two to six short sentences. Explain each project name the first time.
- `why`: why it is done this way. Name the alternative that lost and the reason it lost. Fill it on every section where a choice was made: it is the part a handed-over ticket loses.
- `files`: repo-relative paths, on the code sections.
- `code`: the smallest snippet that shows the idea, 25 lines at most, only on code sections. A diff hunk with `isDiff: true` when the before and after matter.
- Skip mechanics (renames, formatting, lockfiles, version bumps) unless they matter.

`summary` is two or three sentences for someone who wasn't there: the problem, the idea, and the result. `ask` is the one-line request.

## 3. Write the quiz: 4 to 7 questions

Tie each question to the section it checks with `section` (0-based). At most a third of the questions ask where something is in the code. Mix these kinds:

- **Problem** (`choice`): "What went wrong before this change?", "Who was affected?"
- **Idea** (`choice`): the approach and the mental model, asked without code.
- **Why** (`choice`): the decision against its rival. The wrong options are the alternatives that were really considered, never silly ones.
- **Predict** (`choice`): "A request comes in with Z. What happens now?"
- **Transfer** (`choice`): a similar task the person might get next. "A ticket asks for Y. How does the same idea apply?" At least one.
- **Where** (`choice`): "Which part decides X?", only when finding it matters.
- **Explain it back** (`explain`): at least one, last. "Explain to a teammate the problem and the idea behind the fix." Give `modelAnswer` (two to four sentences) and `rubric` (the two or three points a right answer must hit). A small model grades it against the rubric.

For a `choice`: three or four options, one right one (`answer` is its 0-based index), with the right one's position varied across questions. `explain` says why the right one is right and why the most tempting wrong one is wrong.

Every answer has to trace back to the conversation, the ticket or the code. No trivia (line numbers, exact variable names) unless the person will need it to find the code.

## 4. Deliver

Call `mcp__teach-back__lesson` with `title`, `ask`, `summary`, `sections` and `questions`. If it answers with problems, fix them and call it again. Then tell the person in one line that the lesson is open in the Teach-back pane.

When the person asks a follow-up from the pane ("About X from the teach-back lesson: ..."), answer in chat, grounded in the code.

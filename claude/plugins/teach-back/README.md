# teach-back

Teaches you the work the agent did on a task you handed over, so you can explain it to a reviewer without rereading the diff. You read a short lesson first, then take a quiz on it.

- **Teach me button.** Once a turn changes files, a Teach me button shows above the prompt. It counts the files changed since your last lesson and stays until you use it or press Later. The agent never starts a lesson by itself.
- **`/teach-back [focus]`** asks for a lesson now, optionally on one part of the work. **`/lessons`** opens past lessons.
- **The lesson.** The task and the problem behind it, the idea of the solution, the business rule it touches, where it lives in the code, and what to take to the next task like it. Each part says why it was done this way instead of the alternative, and has an Ask about this button that puts a question in the prompt.
- **The quiz.** Multiple choice on the problem, the idea, why, what happens if, and how you'd apply it to a similar task, plus one explain-it-back answer that Haiku grades against a rubric. Without a grade you mark it yourself against a good answer. Results list what you missed, with a retry.
- Lessons are kept across sessions (the last 30), grouped by project.

The `teach-back:lesson` skill tells the agent how to build the lesson from the diff and the conversation. The mod registers the `lesson` tool that shows it.

Tests: `claude plugin test claude/plugins/teach-back`.

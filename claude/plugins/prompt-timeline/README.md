# prompt-timeline

A mod that makes your own prompts easy to find in a long session.

- Your prompts draw as a cyan card headed `› You · #N`, so they stand apart from Claude's output.
- A strip above the prompt box lists your last six prompts; click one to jump back to it.
  It sits above the prompt rather than in a pane because panes share one dock as tabs.
- `/timeline` opens a pane with every prompt of the session, each one a jump link.

Prompts are recorded as the session stores them (`session.append`, door `prompt`), so the
list starts from when the plugin loaded and survives `/reload-plugins`.

Test: `claude plugin test claude/plugins/prompt-timeline`
- A prompt that is still queued (sent while a turn runs) draws as a dim "◌ Queued" card until it is sent. Slash commands keep the default row.
- `hooks/look.tsx`: each reply opens with a magenta pill naming the model (`◆ Opus 5.5`), and startup notices get a blue `ℹ` and their `/command` as a pill. The prompt strip sits under a cyan divider as chips, the latest one highlighted.
- Each reply keeps the model and effort it was made with (saved per session in the plugin's store on disk, keyed by the start of the reply's text), so a later `/model` or effort change never relabels older replies.
- A Bash call's card leads with its description and shows the command as one dim line.
- Tool calls draw as cards (`hooks/cards.ts`): a colored label (Bash, Read, Edit, Write, Search, Web, Tools, Agent, Browser for chrome-devtools, or the MCP server name), one readable title and a dim detail line.

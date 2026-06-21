const STOP_PHRASES = [
  "stop prompting",
  "end session",
  "don't ask anymore",
  "close conversation",
];

function containsStopPhrase(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return STOP_PHRASES.some(phrase => lower.includes(phrase));
}

export const server = async _input => {
  return {
    "tool.execute.after": async (input, output) => {
      const toolName = input.tool ?? "";
      // Fire after the built-in questions tool (harness-provided ask-question tool),
      // e.g. AskUserQuestion / question / ask_question. The interactive MCP path is retired.
      const isQuestionTool = toolName.toLowerCase().includes("question");

      if (!isQuestionTool) return;

      const responseText =
        typeof output.output === "string"
          ? output.output
          : JSON.stringify(output.output ?? "");

      if (containsStopPhrase(responseText)) {
        output.output = `${responseText}\n\n[prompt-loop] stop phrase detected; no more prompts.`;
        return;
      }

      output.output = `${responseText}\n\n[prompt-loop] keep todo active; prompt after task.`;
    },

    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(
        'Use the built-in questions tool (the harness-provided ask-question tool) for every prompt and the mandatory post-task satisfaction check. Stop prompting after the exact phrase "Stop prompting", "End session", "Don\'t ask anymore", or "Close conversation"; then give a plain-text summary only.'
      );
    },
  };
};

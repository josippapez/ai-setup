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
      const isInteractiveTool =
        toolName.includes("request_user_input") ||
        toolName.includes("ask_intensive_chat") ||
        toolName.includes("interactive");

      if (!isInteractiveTool) return;

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
        'Stop prompting after exact phrase: "Stop prompting", "End session", "Don\'t ask anymore", or "Close conversation"; then give a plain-text summary only.'
      );
    },
  };
};

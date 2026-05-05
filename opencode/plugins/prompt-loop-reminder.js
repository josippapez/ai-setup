/**
 * prompt-loop-reminder plugin
 *
 * Detects when the agent may be stuck in a prompt loop or when an interactive
 * MCP response contains an explicit stop phrase. Injects a system reminder to
 * stop prompting and close the session gracefully.
 *
 * Stop phrases (exact match, case-insensitive):
 *   - "Stop prompting"
 *   - "End session"
 *   - "Don't ask anymore"
 *   - "Close conversation"
 */

const STOP_PHRASES = [
  "stop prompting",
  "end session",
  "don't ask anymore",
  "close conversation",
];

/** Returns true if text contains any stop phrase. */
function containsStopPhrase(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return STOP_PHRASES.some(phrase => lower.includes(phrase));
}

export const server = async _input => {
  return {
    /**
     * After an interactive MCP tool (e.g. request_user_input, ask_intensive_chat)
     * responds, inspect the output for stop phrases. If found, inject a
     * system message that tells the agent the session is over.
     */
    "tool.execute.after": async (input, output) => {
      const toolName = input.tool ?? "";

      // Only act on interactive MCP tools
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
        output.output =
          responseText +
          "\n\n---\n[prompt-loop-reminder] The user has indicated they want to stop. " +
          "Use one of the session stop phrases was detected. " +
          "Do NOT send any further interactive prompts. " +
          "Close the session cleanly by confirming the work is complete in a plain-text summary.";
      }

      return (
        output +
        "\n\n---\n[prompt-loop-reminder] Add a todo to prompt the user after the current task"
      );
    },

    /**
     * Inject a persistent reminder into every system prompt about when to
     * stop prompting the user.
     */
    "experimental.chat.system.transform": async (_input, output) => {
      const reminder = [
        "## Prompt-loop stop-phrase detection",
        "When the user's response (via interactive MCP tools such as request_user_input) contains ANY of these exact phrases (case-insensitive):",
        '  - "Stop prompting"',
        '  - "End session"',
        '  - "Don\'t ask anymore"',
        '  - "Close conversation"',
        "You MUST immediately stop calling interactive prompt tools and end the session with a plain-text summary.",
        "Do NOT re-prompt after a stop phrase has been detected.",
      ].join("\n");

      output.system.push(reminder);
    },
  };
};

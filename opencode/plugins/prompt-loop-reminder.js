// Nudges the agent to close a turn by checking in with the user.
//
// Kept deliberately minimal: it used to also append a reminder to every
// question-tool result and restate a full prompting policy (mandatory
// satisfaction check, stop phrases, prompt-loop todo). That policy was retired
// to retired/prompt-loop/, so the hook no longer cites it — it states only the
// live expectation, once, in the system prompt.

const REMINDER =
  'Close each turn with the deliverable as its final plain text, then ask the user whether they want any changes. Never place the deliverable above a questions-tool widget — the widget hides the text before it.';

export const server = async _input => {
  return {
    'experimental.chat.system.transform': async (_input, output) => {
      output.system.push(REMINDER);
    },
  };
};

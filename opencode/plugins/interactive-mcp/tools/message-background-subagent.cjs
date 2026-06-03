'use strict';

const { openCodeRequest } = require('../lib/opencode-api.cjs');

const definition = {
  name: 'message_background_subagent',
  description:
    "Send a fire-and-forget (noReply) text message into a running OpenCode session — either a managed background subagent or any session by id. Use to inject guidance/context into an in-flight background agent without expecting a turn back: 'tell the background agent to also check X'. Requires message, plus a target: backgroundId (a managed bg_N) OR targetSessionId. Returns 'sent <sessionId>' on success. Does not return the agent's reply — use manage_background_subagents action=output to read results.",
  inputSchema: {
    type: 'object',
    properties: {
      backgroundId: {
        type: 'string',
        description:
          'Managed background subagent id (bg_N) to resolve the target session from; optional if targetSessionId is given.',
      },
      targetSessionId: {
        type: 'string',
        description:
          'Explicit OpenCode session id to message directly; optional if backgroundId is given.',
      },
      message: {
        type: 'string',
        description: 'Text to deliver into the target session. Required, non-empty.',
      },
    },
    required: ['message'],
    additionalProperties: false,
  },
};

async function execute(args, context) {
  const message = String(args.message || '').trim();
  if (!message) return 'Missing required message.';
  const record = args.backgroundId
    ? context.backgroundSubagents.get(String(args.backgroundId))
    : null;
  const targetSessionId = String(
    args.targetSessionId || record?.sessionId || '',
  ).trim();
  if (!targetSessionId)
    return 'Provide either backgroundId for a managed subagent or targetSessionId.';
  await openCodeRequest(
    context,
    'POST',
    `/session/${encodeURIComponent(targetSessionId)}/prompt_async`,
    {
      noReply: true,
      parts: [{ type: 'text', text: message }],
    },
  );
  return `sent ${targetSessionId}`;
}

module.exports = { messageBackgroundSubagentTool: { definition, execute } };

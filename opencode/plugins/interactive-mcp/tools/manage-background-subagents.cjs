'use strict';

const { openCodeRequest } = require('../lib/opencode-api.cjs');

const definition = {
  name: 'manage_background_subagents',
  description:
    "Spawn and control background subagent sessions through the OpenCode server API. Use to offload long-running parallel work and check on it: 'run this in the background', 'list background agents', 'is the background task done', 'wait for it', 'get its output', 'cancel it'. action is required (start|list|status|wait|output|cancel); start needs prompt (optional title/agent/parentSessionId); status/wait/output/cancel need the background id. Returns a JSON status record (or the session's recent text for output). wait polls up to 120s for the session to go idle.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'list', 'status', 'wait', 'output', 'cancel'],
        description:
          "Lifecycle operation: 'start', 'list', 'status', 'wait', 'output', or 'cancel'. Required.",
      },
      id: {
        type: 'string',
        description:
          'Background subagent id (bg_N from start/list); required for status, wait, output, and cancel.',
      },
      prompt: {
        type: 'string',
        description:
          'Initial instruction text for the new subagent; required for action=start.',
      },
      title: {
        type: 'string',
        description:
          "Optional human-readable session title; defaults to 'Background subagent <id>'.",
      },
      agent: {
        type: 'string',
        description: 'Optional OpenCode agent name to run the session as.',
      },
      parentSessionId: {
        type: 'string',
        description:
          'Optional parent session id to nest the new session under.',
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

function summarizeRecord(record) {
  return {
    id: record.id,
    sessionId: record.sessionId,
    title: record.title,
    agent: record.agent,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastError: record.lastError,
  };
}

async function refreshBackgroundRecord(context, record) {
  try {
    const statuses = await openCodeRequest(context, 'GET', '/session/status');
    const status = statuses?.[record.sessionId];
    record.status = status?.type || record.status || 'unknown';
    record.updatedAt = new Date().toISOString();
    record.lastError = undefined;
  } catch (err) {
    record.lastError = err.message;
  }
  return record;
}

async function getBackgroundOutput(context, record) {
  const messages = await openCodeRequest(
    context,
    'GET',
    `/session/${encodeURIComponent(record.sessionId)}/message?limit=20`,
  );
  const lines = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = message.info?.role || message.info?.type || 'message';
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const text = parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
    if (text) lines.push(`[${role}]\n${text}`);
  }
  return lines.length > 0
    ? lines.join('\n\n')
    : 'No text output available yet.';
}

async function execute(args, context) {
  const action = String(args.action || '');
  if (action === 'list')
    return JSON.stringify(
      Array.from(context.backgroundSubagents.values()).map(summarizeRecord),
    );

  if (action === 'start') {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return 'Missing required prompt for action=start.';
    const id = `bg_${context.nextBackgroundId++}`;
    const title = String(args.title || `Background subagent ${id}`).trim();
    const created = await openCodeRequest(context, 'POST', '/session', {
      title,
      parentID: args.parentSessionId || undefined,
    });
    if (!created?.id)
      return `OpenCode did not return a session id: ${JSON.stringify(created)}`;
    await openCodeRequest(
      context,
      'POST',
      `/session/${encodeURIComponent(created.id)}/prompt_async`,
      {
        agent: args.agent || undefined,
        parts: [{ type: 'text', text: prompt }],
      },
    );
    const now = new Date().toISOString();
    const record = {
      id,
      sessionId: created.id,
      title,
      agent: args.agent || undefined,
      status: 'busy',
      createdAt: now,
      updatedAt: now,
    };
    context.backgroundSubagents.set(id, record);
    return JSON.stringify(summarizeRecord(record));
  }

  const id = String(args.id || '').trim();
  if (!id) return `Missing required id for action=${action}.`;
  const record = context.backgroundSubagents.get(id);
  if (!record) return `Unknown background subagent id: ${id}`;

  if (action === 'status')
    return JSON.stringify(summarizeRecord(await refreshBackgroundRecord(context, record)));
  if (action === 'wait') {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await refreshBackgroundRecord(context, record);
      if (record.status === 'idle') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return JSON.stringify(summarizeRecord(record));
  }
  if (action === 'output') return getBackgroundOutput(context, record);
  if (action === 'cancel') {
    await openCodeRequest(
      context,
      'POST',
      `/session/${encodeURIComponent(record.sessionId)}/abort`,
    );
    record.status = 'cancelled';
    record.updatedAt = new Date().toISOString();
    return JSON.stringify(summarizeRecord(record));
  }
  return `Unknown action: ${action}`;
}

module.exports = { manageBackgroundSubagentsTool: { definition, execute } };

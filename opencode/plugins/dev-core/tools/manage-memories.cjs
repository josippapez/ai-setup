'use strict';

const fs = require('node:fs');
const path = require('node:path');

const definition = {
  name: 'manage_memories',
  description:
    "Create, list, update, or delete persistent repo-local memory notes stored in the self-ignored .opencode/memories/ folder. Use to remember durable facts/decisions across sessions — 'remember that we use pnpm', 'note this gotcha', 'list saved memories', 'forget memory X'. action is required; create/update need content; update/delete need the memory id. scope is 'project' (default) or 'global'. Returns the affected memory record (or full list for action=list) as JSON.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'update', 'delete'],
        description:
          "Operation to perform: 'create', 'list', 'update', or 'delete'. Required.",
      },
      id: {
        type: 'string',
        description:
          'Memory id to target; required for update and delete (returned by create/list).',
      },
      content: {
        type: 'string',
        description: 'Memory text; required for create and update.',
      },
      scope: {
        type: 'string',
        enum: ['global', 'project'],
        default: 'project',
        description:
          "Storage scope label: 'project' (default) or 'global'.",
      },
    },
    required: ['action'],
    additionalProperties: false,
  },
};

function ensureMemoryStorage(context) {
  const directory = path.dirname(context.memoriesPath);
  fs.mkdirSync(directory, { recursive: true });
  const ignorePath = path.join(directory, '.gitignore');
  if (!fs.existsSync(ignorePath)) fs.writeFileSync(ignorePath, '*\n', 'utf8');
}

function readMemories(context) {
  ensureMemoryStorage(context);
  try {
    const parsed = JSON.parse(fs.readFileSync(context.memoriesPath, 'utf8'));
    return Array.isArray(parsed.memories) ? parsed.memories : [];
  } catch {}

  if (!context.legacyMemoriesPath) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(context.legacyMemoriesPath, 'utf8'));
    const memories = Array.isArray(parsed.memories) ? parsed.memories : [];
    writeMemories(context, memories);
    fs.rmSync(context.legacyMemoriesPath, { force: true });
    return memories;
  } catch {
    return [];
  }
}

function writeMemories(context, memories) {
  ensureMemoryStorage(context);
  fs.writeFileSync(
    context.memoriesPath,
    `${JSON.stringify({ memories }, null, 2)}\n`,
    'utf8',
  );
}

function execute(args, context) {
  const action = String(args.action || '');
  const memories = readMemories(context);
  if (action === 'list') return JSON.stringify(memories);

  if (action === 'create') {
    const content = String(args.content || '').trim();
    if (!content) return 'Missing required content for action=create.';
    const memory = {
      id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      scope: args.scope || 'project',
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memories.push(memory);
    writeMemories(context, memories);
    return JSON.stringify(memory);
  }

  const id = String(args.id || '').trim();
  if (!id) return `Missing required id for action=${action}.`;
  const index = memories.findIndex((memory) => memory.id === id);
  if (index < 0) return `Unknown memory id: ${id}`;
  if (action === 'update') {
    const content = String(args.content || '').trim();
    if (!content) return 'Missing required content for action=update.';
    memories[index] = {
      ...memories[index],
      content,
      scope: args.scope || memories[index].scope,
      updatedAt: new Date().toISOString(),
    };
    writeMemories(context, memories);
    return JSON.stringify(memories[index]);
  }
  if (action === 'delete') {
    const [deleted] = memories.splice(index, 1);
    writeMemories(context, memories);
    return JSON.stringify(deleted);
  }
  return `Unknown action: ${action}`;
}

module.exports = {
  ensureMemoryStorage,
  manageMemoriesTool: { definition, execute },
};

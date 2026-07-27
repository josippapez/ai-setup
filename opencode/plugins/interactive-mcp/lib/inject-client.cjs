'use strict';

const net = require('node:net');
const path = require('node:path');

function injectSocketPath(root) {
  return path.join(root, '.opencode', 'repo-docs', 'inject.sock');
}

function queryInject(root, request, timeoutMs = 300) {
  return new Promise((resolve) => {
    let complete = false;
    const finish = (value) => {
      if (complete) return;
      complete = true;
      resolve(value);
    };
    const connection = net.connect(injectSocketPath(root));
    const timer = setTimeout(() => {
      connection.destroy();
      finish(null);
    }, timeoutMs);
    let buffer = '';
    connection.on('connect', () => connection.write(`${JSON.stringify(request)}\n`));
    connection.on('data', (data) => {
      buffer += data;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      clearTimeout(timer);
      connection.end();
      try {
        finish(JSON.parse(buffer.slice(0, newline)));
      } catch {
        finish(null);
      }
    });
    connection.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });
    connection.on('close', () => {
      clearTimeout(timer);
      finish(null);
    });
  });
}

async function queryInjectWithRetry(
  root,
  request,
  { attempts = 30, delayMs = 100, timeoutMs = 750 } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await queryInject(root, request, timeoutMs);
    if (result && !result.warming) return result;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

function isConversationalFiller(text) {
  const value = String(text || '').trim().toLowerCase().replace(/[!.?,\s]+$/g, '');
  if (!value) return true;
  const filler = new Set([
    'hi', 'hello', 'hey', 'yo', 'thanks', 'thank you', 'thanks a lot', 'thx', 'ty',
    'ok', 'okay', 'k', 'cool', 'nice', 'great', 'perfect', 'awesome', 'lgtm',
    'sounds good', 'looks good', 'yes', 'no', 'yep', 'nope', 'sure', 'got it',
    'done', 'continue', 'go on', 'proceed', 'stop', 'wait', 'never mind',
  ]);
  if (filler.has(value)) return true;
  return /^(hi|hello|hey|thanks|thank you|thx)\b/.test(value)
    && value.split(/\s+/).length <= 4
    && !/\?|how|what|why|where|which|who|when|can you|help me (with|to)\b/.test(value);
}

function formatBlock(hits) {
  if (!hits?.length) return '';
  const lines = hits.map((hit, index) => {
    const anchor = hit.heading ? ` > ${hit.heading}` : '';
    return `${index + 1}) ${hit.path}:${hit.startLine}${anchor} - ${hit.snippet}`;
  });
  return `[repo-docs] These local documentation references were automatically injected for the active user turn. Read them with interactive-mcp-standalone_read_doc before relying on general knowledge. If the user asks which documentation was automatically supplied, list the exact paths below; never say no injection occurred while this block is present.\n${lines.join('\n')}`;
}

module.exports = {
  formatBlock,
  injectSocketPath,
  isConversationalFiller,
  queryInject,
  queryInjectWithRetry,
};

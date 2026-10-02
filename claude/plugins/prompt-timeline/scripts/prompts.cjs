#!/usr/bin/env node
'use strict';
// Prints this session's prompts as JSON, [{ id, text }], read from its transcript file.
// The mod cannot read the file itself: transcripts pass the 4 MiB a mod's $.fs.read allows.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const sessionId = process.argv[2];
const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const file = fs.existsSync(projects)
  ? fs.readdirSync(projects).map((dir) => path.join(projects, dir, `${sessionId}.jsonl`)).find((f) => fs.existsSync(f))
  : undefined;
if (!sessionId || !file) {
  process.stdout.write('[]');
  process.exit(0);
}

const textOf = (content) =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';

const prompts = [];
readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  .on('line', (line) => {
    let row;
    try { row = JSON.parse(line); } catch { return; }
    // A typed prompt, or one sent while a turn ran (stored as a queued command).
    if (row.type === 'user' && !row.isMeta && row.origin?.kind === 'human') {
      prompts.push({ id: row.uuid, text: textOf(row.message?.content) });
    } else if (row.type === 'attachment' && row.attachment?.type === 'queued_command' && row.attachment.origin?.kind === 'human') {
      prompts.push({ id: row.uuid, text: textOf(row.attachment.prompt) });
    }
  })
  .on('close', () => process.stdout.write(JSON.stringify(prompts.filter((p) => p.text.trim()))));

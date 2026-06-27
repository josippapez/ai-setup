#!/usr/bin/env node

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const normalizeToolName = (value) => {
  if (typeof value !== "string") return "";
  const parts = value.split(/[./:]/).filter(Boolean);
  const name = parts.length ? parts[parts.length - 1] : value;
  return name.trim().toLowerCase();
};

const isSuccessfulEvent = (event) => {
  if (event?.toolResult?.resultType) return event.toolResult.resultType === "success";
  if (typeof event?.success === "boolean") return event.success;
  if (event?.error) return false;
  return true;
};

const main = async () => {
  const event = parseJson(await readStdin());
  if (!event || !isSuccessfulEvent(event)) process.exit(0);

  const toolName = normalizeToolName(
    event.toolName ?? event.tool_name ?? event.tool ?? event.name,
  );
  const editTools = new Set([
    "apply_patch",
    "edit",
    "create",
    "write",
    "multiedit",
    "replace",
    "insert",
  ]);

  if (toolName && !editTools.has(toolName)) process.exit(0);

  console.log(
    "[claude-hook][prompt-loop] Reminder: keep or add todo 'Interactively Prompt user after [current task]' and send the mandatory satisfaction prompt after delivery.",
  );
};

await main();

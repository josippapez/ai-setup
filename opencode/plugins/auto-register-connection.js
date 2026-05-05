/**
 * auto-register-connection plugin
 *
 * Automatically injects a system instruction on every turn that tells the
 * agent to call `register_connection` (interactive-desktop MCP tool) as its
 * very first action — passing its own OpenCode session ID explicitly so the
 * desktop app wires the channel to the correct session.
 *
 * The instruction is injected via `experimental.chat.system.transform` which
 * receives the current `sessionID`. It also fetches session metadata from the
 * OpenCode API to supply `parentID` context so subagents can identify
 * themselves correctly.
 *
 * Once `register_connection` has been called the tool is idempotent (it
 * upserts), so re-injecting the instruction on subsequent turns is harmless.
 */

const OPENCODE_PORT = 4096;

/**
 * Fetch a single session record from the OpenCode API.
 * Returns null if the API is unreachable or the session is not found.
 */
async function fetchSession(sessionID) {
  try {
    const res = await fetch(
      `http://localhost:${OPENCODE_PORT}/session/${sessionID}`,
      { signal: AbortSignal.timeout(2000) },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export const server = async ({ directory }) => {
  // Cache fetched session metadata to avoid hitting the API on every turn.
  const sessionCache = new Map();

  return {
    "experimental.chat.system.transform": async (input, output) => {
      const { sessionID } = input;
      if (!sessionID) return;

      // Fetch session metadata (cached after first fetch).
      let session = sessionCache.get(sessionID);
      if (!session) {
        session = await fetchSession(sessionID);
        if (session) sessionCache.set(sessionID, session);
      }

      const parentID = session?.parentID ?? null;
      const sessionDir = session?.directory ?? directory ?? null;
      const projectName = sessionDir
        ? sessionDir.split("/").filter(Boolean).pop()
        : "unknown";

      const instruction = [
        "## Auto-register connection (interactive-desktop)",
        "",
        "You MUST call `register_connection` (interactive-desktop MCP tool) as your **very first tool call** before doing anything else.",
        "Pass the following parameters — do NOT omit `openCodeSessionId`:",
        "",
        "```json",
        JSON.stringify(
          {
            agentName: "Claude Code",
            projectName,
            baseDirectory: sessionDir,
            openCodeSessionId: sessionID,
          },
          null,
          2,
        ),
        "```",
        "",
        parentID
          ? `This session is a subagent (parentID: \`${parentID}\`). Pass \`openCodeSessionId\` explicitly so the desktop app targets this session directly.`
          : "This is a root/main agent session. Passing `openCodeSessionId` explicitly ensures the correct channel is created.",
        "",
        "If `register_connection` has already been called this session, skip this step — the tool is idempotent.",
      ].join("\n");

      output.system.push(instruction);
    },
  };
};

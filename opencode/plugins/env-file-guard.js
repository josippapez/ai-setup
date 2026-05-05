/**
 * env-file-guard plugin
 *
 * Blocks the agent from reading or writing .env files.
 * Enforces the repo policy in never-read-env.instructions.md.
 *
 * Intercepts:
 *   - tool.execute.before  — inspects file path args before any tool runs
 *   - experimental.chat.system.transform — injects a hard rule into every system prompt
 */

/** Returns true if any string argument looks like an .env file path. */
function argsContainEnvPath(args) {
  if (!args || typeof args !== "object") return false;
  return Object.values(args).some(v => {
    if (typeof v !== "string") return false;
    // Match .env, .env.local, .env.production, etc.
    return /(?:^|[\\/])\.env(\.[^/\\]*)?$/.test(v);
  });
}

// export const server = async (_input) => {
//   return {
//     /**
//      * Before any tool executes, check whether the arguments reference an
//      * .env file. If so, rewrite the args to a blocked sentinel path so the
//      * tool cannot read/write the actual file, and append a warning to any
//      * existing output.
//      */
//     "tool.execute.before": async (input, output) => {
//       if (!argsContainEnvPath(output.args)) return;

//       const blocked = Object.fromEntries(
//         Object.entries(output.args).map(([k, v]) => {
//           if (typeof v === "string" && /(?:^|[\\/])\.env(\.[^/\\]*)?$/.test(v)) {
//             return [k, "__BLOCKED_ENV_FILE__"];
//           }
//           return [k, v];
//         })
//       );

//       // Replace args so the tool receives a sentinel instead of the real path
//       Object.assign(output.args, blocked);

//       console.warn(
//         `[env-file-guard] Blocked attempt to access env file via tool "${input.tool}". ` +
//           "Reading or writing .env files is prohibited by repository policy. " +
//           "Use environment variable injection (CI secrets, shell exports) instead."
//       );
//     },

//     /**
//      * Inject a hard prohibition into every system prompt.
//      */
//     "experimental.chat.system.transform": async (_input, output) => {
//       output.system.push(
//         "## .env file access is PROHIBITED\n" +
//           "You MUST NEVER read from or write to any .env file (e.g. .env, .env.local, .env.production).\n" +
//           "This is a hard security policy. Use CI/CD secrets or shell environment variables instead.\n" +
//           "If a task requires an environment variable value, ask the user to supply it via a prompt — do not attempt to read it from disk."
//       );
//     },
//   };
// };

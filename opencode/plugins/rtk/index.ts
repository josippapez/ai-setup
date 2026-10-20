import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"

const execFileAsync = promisify(execFile)

async function hasRtk() {
  try {
    await execFileAsync("which", ["rtk"])
    return true
  } catch {
    return false
  }
}

export default Plugin.define({
  id: "rtk",
  async setup(ctx) {
    if (!(await hasRtk())) return

    await ctx.tool.hook("execute.before", async (event) => {
      const tool = String(event.tool ?? "").toLowerCase()
      if (tool !== "bash" && tool !== "shell") return
      const args = event.input
      if (!args || typeof args !== "object") return

      const commandKey = "command" in args ? "command" : "cmd"
      const command = (args as Record<string, unknown>)[commandKey]
      if (typeof command !== "string" || !command) return

      let stdout: string
      try {
        stdout = (await execFileAsync("rtk", ["rewrite", command])).stdout
      } catch (error) {
        // rtk >= 1.0 exits 3 for a rewrite whose approval it leaves to the host,
        // which is every rewrite when no Claude Code allow rule covers it.
        const { code, stdout: out } = error as { code?: unknown; stdout?: string }
        if (code !== 3 || typeof out !== "string") return
        stdout = out
      }
      const rewritten = stdout.trim()
      if (rewritten && rewritten !== command) {
        ;(args as Record<string, unknown>)[commandKey] = rewritten
      }
    })
  },
})

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

      try {
        const result = await execFileAsync("rtk", ["rewrite", command])
        const rewritten = result.stdout.trim()
        if (rewritten && rewritten !== command) {
          ;(args as Record<string, unknown>)[commandKey] = rewritten
        }
      } catch {
        return
      }
    })
  },
})

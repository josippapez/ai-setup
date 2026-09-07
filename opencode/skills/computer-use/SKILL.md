---
name: computer-use
description: Unblock a chrome-devtools call that is stuck on a native browser or OS dialog, by screenshotting the screen and clicking the button. Also drives the real desktop with mouse, keyboard, and screenshots for any UI outside a web page DOM.
---

# computer-use — click the dialog that chrome-devtools cannot

> Source: [domdomegg/computer-use-mcp](https://github.com/domdomegg/computer-use-mcp)

## The main job: unblocking a hung chrome-devtools call

Chrome 144+ shows a native "Allow remote debugging?" dialog on the first connection after a Chrome restart, and it blocks every chrome-devtools tool until dismissed. No amount of retrying clears it, and nothing cuts the call short: `chrome-devtools` sets no per-server `timeout`, and an unset `MCP_TOOL_TIMEOUT` defaults to 28 hours. What hands control back is automatic backgrounding, which moves a main-conversation MCP call to a background task after two minutes.

So the fix is yours to apply, and this MCP is the only thing here that can apply it:

1. `get_screenshot` and look for the dialog.
2. `left_click` the Allow button at its coordinates.
3. Screenshot again to confirm it is gone, then re-run the chrome-devtools call.

Spot it early rather than waiting out the two minutes: the first chrome call after a Chrome restart is the one at risk, so if it does not come straight back, screenshot instead of retrying. Backgrounding never applies to subagent calls, which block for the full wall-clock limit, so a subagent cannot rescue itself this way. Hand the browser work to the main conversation when a restart is likely.

## The tool

The `computer-use` MCP exposes one tool, `computer`. It takes an `action` plus optional `coordinate` ([x, y]) and `text`. Actions: `get_screenshot`, `get_cursor_position`, `mouse_move`, `left_click`, `double_click`, `right_click`, `middle_click`, `left_click_drag`, `scroll` (needs `coordinate` and `text` of `"up"`/`"down"`/`"left"`/`"right"`, optionally `"down:500"` for pixels), `key`, `type`.

**This gives the model full control of the machine.** Use it for the specific blocked step, then go back to chrome-devtools, which is faster and clicks by uid instead of coordinates. Do not click through consent, payment, or destructive dialogs without asking the user first.

## Everything else it covers

Native browser UI (permission prompts, autofill dropdowns, the download bar, profile pickers), OS dialogs (file pickers, keychain prompts), desktop apps, and visual checks of anything outside the page.

## Hitting the right pixel

- Screenshots draw a red crosshair at the cursor. After a click, compare crosshair to target: if it missed, adjust proportionally and in large steps first.
- On macOS a click on an unfocused window may only raise it. Screenshot, then click again.
- Prefer keyboard: `key` with a shortcut beats hunting for coordinates.

---
name: computer-use
description: 'Drive the real desktop with mouse, keyboard, and screenshots: native app UI, OS dialogs, browser chrome outside the page, and seeing what is actually on screen. Use whenever the thing you need has no API and no DOM behind it.'
---

# computer-use — drive the desktop when there is no API

> Source: [domdomegg/computer-use-mcp](https://github.com/domdomegg/computer-use-mcp)

## The tool

The `computer-use` MCP exposes one tool, `computer`.

It takes an `action` plus optional `coordinate` ([x, y]) and `text`. Actions: `get_screenshot`, `get_cursor_position`, `mouse_move`, `left_click`, `double_click`, `right_click`, `middle_click`, `left_click_drag`, `scroll` (needs `coordinate` and `text` of `"up"`/`"down"`/`"left"`/`"right"`, optionally `"down:500"` for pixels), `key`, `type`.

**This gives the model full control of the machine.** Drive the specific step you need, then stop. Do not click through consent, payment, or destructive dialogs without asking the user first.

## What it is for

Anything with no API and no DOM behind it:

- **Native app UI**, including menus, panels, and apps that ship no CLI at all.
- **OS-level chrome**: file pickers, keychain and permission prompts, notifications, System Settings, the menu bar and Dock.
- **Browser UI outside the page**: the address bar, profile pickers, extension popups, the download bar, autofill dropdowns.
- **Seeing what is on screen.** A real screenshot to check what rendered, what has focus, or which window is in front, instead of inferring it.
- **Cross-application work**: copy from one app and paste into another, drag a file onto a window.

Prefer keyboard over clicking: `key` with a shortcut is faster and lands more reliably than hunting for coordinates. For anything inside a web page use `chrome-devtools`, which reads the DOM and clicks by uid.

## Unblocking a stuck chrome-devtools call

One specific rescue worth knowing. Chrome 144+ shows a native "Allow remote debugging?" dialog on the first connection after a Chrome restart, and it blocks every chrome-devtools tool until dismissed. Retrying never clears it, and nothing cuts the call short: `chrome-devtools` sets no per-server `timeout` and an unset `MCP_TOOL_TIMEOUT` defaults to 28 hours. Control comes back through automatic backgrounding, which moves a main-conversation MCP call to a background task after two minutes. Then:

1. `get_screenshot` and look for the dialog.
2. `left_click` Allow at its coordinates.
3. Screenshot again to confirm it is gone, then re-run the chrome-devtools call.

Spot it on the first chrome call after a Chrome restart rather than waiting out the two minutes. Subagent calls are never backgrounded, so a subagent cannot rescue itself this way.

## Hitting the right pixel

- Screenshots draw a red crosshair at the cursor. After a click, compare crosshair to target: if it missed, adjust proportionally and in large steps first.
- On macOS a click on an unfocused window may only raise it. Screenshot, then click again.
- Consult a screenshot before moving the cursor, and click element centres, not edges.

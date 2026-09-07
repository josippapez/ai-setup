---
name: computer-use
description: Control the real desktop with mouse, keyboard, and screenshots through the computer-use MCP. Use for native UI outside a web page DOM, and to unblock a chrome-devtools call hanging on a browser or OS dialog.
---

# computer-use — drive the desktop when the DOM is not enough

> Source: [domdomegg/computer-use-mcp](https://github.com/domdomegg/computer-use-mcp)

The `computer-use` MCP exposes one tool, `computer`. It takes an `action` plus optional `coordinate` ([x, y]) and `text`. Actions: `get_screenshot`, `get_cursor_position`, `mouse_move`, `left_click`, `double_click`, `right_click`, `middle_click`, `left_click_drag`, `scroll` (needs `coordinate` and `text` of `"up"`/`"down"`/`"left"`/`"right"`, optionally `"down:500"` for pixels), `key`, `type`.

**This gives the model full control of the machine.** Use it for the specific blocked step, then go back to chrome-devtools, which is faster and clicks by uid instead of coordinates. Do not click through consent, payment, or destructive dialogs without asking the user first.

## When to reach for it

- A chrome-devtools call hangs, times out, or gets pushed to the background.
- Native browser UI: permission prompts, autofill dropdowns, the download bar, profile pickers.
- OS dialogs (file pickers, keychain prompts), desktop apps, and visual checks outside the page.

## Unblocking a hung chrome-devtools call

Chrome 144+ shows a native "Allow remote debugging?" dialog on the first connection after a Chrome restart, and it blocks every chrome-devtools tool until dismissed ([chrome-devtools-mcp#825](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/825)).

When a chrome-devtools call hangs or times out, do not just retry it:

1. `get_screenshot` and look for the dialog.
2. `left_click` the Allow button at its coordinates.
3. Screenshot again to confirm it is gone, then re-run the chrome-devtools call.

The dialog only appears after a Chrome restart, so this is a few-second recovery, not a per-session tax.

## Hitting the right pixel

- Screenshots draw a red crosshair at the cursor. After a click, compare crosshair to target: if it missed, adjust proportionally and in large steps first.
- On macOS a click on an unfocused window may only raise it. Screenshot, then click again.
- Prefer keyboard: `key` with a shortcut beats hunting for coordinates.

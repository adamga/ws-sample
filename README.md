# Chronicle / Chat Explorer (Baseline Web App)

A local-only, **zero-package** Node.js web application for loading, browsing, searching, and inspecting persisted VS Code (`workspaceStorage`) and Copilot Agent (`.copilot\session-state`) chat sessions.

## Run

Requires **Node.js 22 or newer**. No npm, npx, or package install is required.

```powershell
node --max-old-space-size=8192 src/server.js
```

Open **http://127.0.0.1:3210** in your browser.

- Click **Open session** (`Ctrl+O`) to load VS Code `workspaceStorage` history (pre-filled with your device default).
- Click **Agent sessions** (`Ctrl+Shift+O`) to load Agent Host / Copilot CLI `.copilot\session-state` history (pre-filled with your device default).
- Sort sessions by **Date** or **Name**, search across every session (`Ctrl+Shift+F`), inspect prompts, responses, persisted reasoning, tool calls, and reconstructed file diffs, or read an entire conversation continuously.

## SciCalc sample

The standalone `scicalc/` sample is a scientific calculator with no external packages. Start it with `node scicalc/server.js` and open **http://127.0.0.1:3211**. Enter expressions using `+`, `-`, `*`, `/`, `^`, parentheses, `pi` or `π`, and `e`; multiplication must be explicit (for example, `2*pi`). Functions include `sqrt`, `abs`, `ln`, `log` (base 10), `sin`, `cos`, `tan`, `asin`, `acos`, and `atan`, with selectable degrees or radians.

## Validate

```powershell
node --check src/server.js
node --test
```

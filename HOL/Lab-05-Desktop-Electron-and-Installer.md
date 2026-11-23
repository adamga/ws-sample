# Lab 05 — Package-Free Browser Release & Desktop Architecture Review

**Estimated time:** 17 minutes

**Starting checkpoint:** Advanced Lab 04, with the summarizer and operation log working.

## Goal

Use your specialist team to add a locally generated browser tab icon and verify that the finished app still runs with only Node.js 22+ and a browser. Review the optional desktop wrapper without installing or building it.

## Step 1 — Delegate the release change (8 minutes)

From `workshop/Advanced/sampleapp`, copy `render-icon.cjs` from the repository's [`appsample/build/`](../../appsample/build/) into your own `build/` folder. This is the reference renderer, not the Electron runtime. If that path already exists in your workspace, inspect it rather than overwriting your work.

Select **Chronicle Orchestrator** in Copilot Chat and paste. The tester can draft the checks while the developer works, but should run them only after the icon is in `public/`.

```text
Prepare the Chronicle browser release. Do not invoke npm or npx or add dependencies.

1. Developer: Run node build/render-icon.cjs to generate build/icon.png and build/icon.ico. Copy the generated PNG to public/chronicle-icon.png and replace the existing inline favicon in public/index.html with <link rel="icon" type="image/png" href="/chronicle-icon.png">. Do not change any routes or settings.
2. Tester: Write test/release-icon.test.js using node:test and node:assert/strict. Follow the setup and teardown in test/zero-deps.test.js: start the loopback server with port: 0, loadSamples: false, and a temporary data directory. Assert that the page references the new favicon, then request /chronicle-icon.png and assert status 200, image/png, and the PNG signature. Run node --check build/render-icon.cjs and node --test.
3. Security: Review the diff for local-only assets and confirm that no new third-party dependencies, secrets, or chat history files were added.
4. Documentation: Update README.md with browser start and test commands and the source of the generated icon. Desktop packaging is not required.

Allowed changes: build/ icon files, public/chronicle-icon.png, public/index.html, test/release-icon.test.js, and README.md. Preserve package.json, server behavior, .env, and original chat histories. Stop after the test and review; the learner will do the browser check.
```

## Step 2 — Verify the browser release (6 minutes)

If Lab 04's server is still running, stop it with **Ctrl+C**. In the learner workspace run:

```powershell
node --check build/render-icon.cjs
node --test
node --max-old-space-size=8192 src/server.js
```

Open `http://127.0.0.1:3210/`. Look for the Chronicle icon in the tab and open `http://127.0.0.1:3210/chronicle-icon.png` to verify the asset directly. Open a session and check that its conversation still loads. If Foundry is configured, create a summary and open the operation log, as in Lab 04. Otherwise, use the mocked summarizer tests and don't count this as a live Foundry check. Stop the server with **Ctrl+C**.

If the icon is missing, verify `public/chronicle-icon.png` exists and try a fresh browser tab after checking the asset URL. If the port is occupied, stop your previous server or set it to `3211` (`$env:PORT=3211` in PowerShell; `export PORT=3211` in macOS/Linux) before running the start command, then use that port in both browser URLs.

## Step 3 — Review and recap (3 minutes)

Read the reference [`main.mjs`](../../appsample/electron/main.mjs), [`preload.cjs`](../../appsample/electron/preload.cjs), and [`package.json`](../../appsample/package.json) without modifying them.

- **What changes in desktop mode?** Electron hosts the same web UI in a sandboxed window, runs the server in a separate utility process, and exposes native pickers through a narrow preload bridge.
- **Why aren't build tools workshop prerequisites?** The browser release uses Node built-ins. Electron and electron-builder are needed only to run the desktop source or package the Windows installer.
- **Where should `.env` live?** Outside the installer and source control. The desktop wrapper uses a writable per-user directory; the packaging allowlist excludes `.env`.

**Checkpoint:** Node tests pass, the icon loads locally, the browser still opens sessions, and no package install was needed.

**Stretch:** Trace which files would be shipped using the reference `build.files` allowlist. For maintainers who want to build a Windows installer after the workshop, see the [desktop build instructions](../../appsample/README.md#windows-desktop-app-optional-maintainer-workflow).

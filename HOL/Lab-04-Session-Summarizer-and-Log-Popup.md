# Lab 04 — LLM Session Handoff Summarizer, Progress Dialog & Popup Log Window

⏱️ **Estimated Time:** 18 minutes

---

## Goal

Now let's build the core AI workflow! Imagine working on a complex coding task on your desktop, and wanting to continue seamlessly on a laptop with **zero prior chat history**.

We need Chronicle to extract **everything that matters** from a session—user prompts, assistant replies, persisted reasoning/thoughts, tool calls/commands/results, subagent outputs, and reconstructed file changes (converted to portable workspace-relative paths)—while staying **compact and token-conscious** so we don't blow past context windows or produce bloated summaries!

---

## Step 1 — Command `Chronicle Orchestrator` to Build End-to-End Session Summarization (12 Minutes)

With **`Chronicle Orchestrator`** selected in Copilot Chat, paste the prompt below and press **Enter**:

```text
Orchestrate our agent team (Developer, Security, Tester, and Documentation) to complete full LLM Session Handoff Summarization into `<session-name>-summary.md`, keeping zero runtime npm package dependencies:

1. Comprehensive, Token-Disciplined Digest & Summarizer (`src/summarizer.js` + `src/server.js`):
   - Implement `sanitizeSummaryFileName(session)` producing `<sanitized-session-title-or-id>-summary.md`.
   - Implement `buildSessionDigest(session)` & `chunkSessionDigest(digest, maxChunkChars = 80000)`:
     - Extract session metadata, model timeline, reconstruction warnings, session-wide saved file snapshots (`CREATED`/`MODIFIED`/`DELETED` with `+added / -removed` stats and compact salient diff lines), and every chronological turn: user prompts, persisted reasoning blocks (noting count of opaque/unpersisted blocks), tool calls with commands/compact arguments/outputs/durations/failures, subagent prompts & results, assistant responses, context attachments/summaries, and reconstructed turn file edits.
     - Convert machine-specific paths inside `session.workspacePath` to portable repository-relative paths (`src/parser.js`), and middle-bound overly long individual outputs so token consumption stays lean without losing critical errors, signatures, or outcomes.
     - If the digest fits in a single chunk, run a single `MODE: FINAL_SESSION_SUMMARY` pass; if larger, run `MODE: SESSION_CHUNK_DIGEST (Part X of Y)` map passes followed by a unified `MODE: FINAL_SESSION_SUMMARY` synthesis pass!
   - Implement `startSummaryJob(sessionId)` & `getJob(jobId, { includeMarkdown })`:
     - Enforce that `.env` configuration is valid before starting (returning HTTP `400` `CONFIG_REQUIRED` if missing).
     - Track asynchronous job phases (`extracting` -> `authenticating` -> `summarizing` -> `synthesizing` -> `saving` -> `completed` / `failed`), `progress` (`0`–`100`), `stats` (prompts, tools, reasoning, edits, est. input/output tokens, chunks), redacted `logs`, and atomic output write to `<SUMMARY_OUTPUT_DIR>/<session-name>-summary.md`.
   - Add routes in `src/server.js`:
     - `POST /api/sessions/:id/summarize` (`202` returning initial job state)
     - `GET /api/summary/jobs/:jobId` (with optional `?markdown=1`)
     - `GET /api/summary/jobs/:jobId/download` (downloading `<session-name>-summary.md` as `text/markdown`)

2. Session Overview Trigger, Progress Dialog & Popup Log Window (`public/index.html`, `public/app.js`, `public/log.js`, `public/styles.css`):
   - On the right-hand **Session overview** pane, right beside **"Read full session"**, add a **"Create session summary"** button (`#create-summary-button`).
   - If `.env` is not configured yet when clicking **"Create session summary"**, automatically open `#config-dialog` with a notice banner explaining that `.env` credentials must be saved first (plus a **"Summarize now"** button once saved!).
   - During execution, open `#summary-progress-dialog` displaying live phase messages, elapsed seconds, a progress bar, session digest/token badges, any error details on failure, the saved `<session-name>-summary.md` file path, **"Copy summary"**, and **"Download .md"** upon completion.
   - Display a **"View operation log"** link in both `#summary-progress-dialog` and on the Session overview header after running; clicking it opens `/log.html?job=<jobId>` in a popup window (`window.open`, with an inline modal fallback if popups are blocked) that live-polls running jobs and copies the full log to the clipboard!

3. Quality Gates:
   - Dispatch `Chronicle Security` to audit secret redaction on upstream failure paths and download headers.
   - Dispatch `Chronicle Tester` to extend `test/summarizer.test.js` covering `.env` gate enforcement, multi-source digest extraction (prompts + reasoning + tools + subagents + portable relative file diffs), multi-chunk map-reduce synthesis, and redacted failure logging, running `node --check <file>` for each changed JavaScript file and `node --test`.
   - Dispatch `Chronicle Documentation` to document the new Session Summary workflow in `README.md`.
```

---

## Step 2 — Generate a Real Handoff Summary! (6 Minutes)

1. Start (or restart) your server in the VS Code Terminal:
   ```powershell
   node --max-old-space-size=8192 src/server.js
   ```
2. Open **http://127.0.0.1:3210** in your browser.
3. Import your sessions (click **Open session** or **Agent sessions** if you haven't imported a folder yet) and select a rich multi-turn coding session from the library.
4. On **Session overview**, look right next to **Read full session** and click **Create session summary**!
5. Watch the **Progress Dialog** move through Extracting → Authenticating → Summarizing → Saving:
   - Click **View operation log** to open the live popup log window, then click **Copy log** to test clipboard support!
   - When it finishes, open the generated `summaries/<session-name>-summary.md` file in VS Code!
   - Check the summary: notice how it captures your objective, completed vs. open work, key reasoning decisions, portable relative file paths, tool/test outcomes, pitfalls, the zero-package rule, and an ordered checklist for an agent on another machine!

*(Press `Ctrl+C` in the terminal to stop the web server before Lab 05.)*

---

## ✅ Lab 04 Checkpoint

- [x] **Create session summary** appears beside **Read full session** on Session Overview and requires `.env` configuration first.
- [x] Progress dialog updates live, logs problems cleanly, and opens the popup operation log with clipboard copy.
- [x] `summaries/<session-name>-summary.md` is generated and ready for cross-machine agent handoff!

👉 **Next up: [Lab 05 — Package-Free Browser Release & Desktop Architecture Review](./Lab-05-Desktop-Electron-and-Installer.md)**

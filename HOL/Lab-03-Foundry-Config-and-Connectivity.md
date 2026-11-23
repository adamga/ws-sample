# Lab 03 — Foundry `.env` Configuration, `/agentconfig` Docs & Live Connectivity Test

⏱️ **Estimated Time:** 15 minutes

---

## Goal

Before Chronicle can summarize a chat session using an LLM, the user must configure their **Microsoft Entra ID Service Principal** and **Microsoft Foundry Agent Endpoint**, save those settings locally to `.env`, and verify basic connectivity!

In this lab, you will give a single high-level assignment to **`Chronicle Orchestrator`**, watch it coordinate `Chronicle Developer`, `Chronicle Documentation`, `Chronicle Security`, and `Chronicle Tester`, and then test live connectivity against your workshop's shared Microsoft Foundry Agent!

---

## Step 1 — Dispatch Your Agent Team via `Chronicle Orchestrator` (10 Minutes)

Make sure **`Chronicle Orchestrator`** is selected in the Copilot Chat agent dropdown, paste the prompt below, and press **Enter**:

```text
Orchestrate our agent team (Developer, Documentation, Security, and Tester) to build Phase 1 of Microsoft Foundry session summarization—keeping zero runtime npm package dependencies:

1. Documentation (`/agentconfig` folder):
   - Create `agentconfig/README.md` and `agentconfig/agent-instructions.md` documenting how a user creates the Prompt Agent in the Microsoft Foundry Portal, sets up a Microsoft Entra ID App Registration + Service Principal + `Foundry Agent Consumer` RBAC role, configures `.env`, and copies the complete Foundry Agent System Prompt (which must handle `CONNECTION_TEST:`, `SESSION_CHUNK_DIGEST`, and `FINAL_SESSION_SUMMARY`, and explicitly enforce the Zero-Package Architecture rule).

2. Backend Configuration & Connectivity (`src/summarizer.js` + `src/server.js` + `.gitignore`):
   - Ensure `.gitignore` ignores `.env`, `.env.*` (except `!.env.example`), and `summaries/`.
   - Create `src/summarizer.js` (zero external packages) implementing:
     - `parseEnvText` & `updateEnvText` with atomic `.env` writes preserving comments and existing keys (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `FOUNDRY_AGENT_ENDPOINT`, `FOUNDRY_AGENT_NAME`, `SUMMARY_OUTPUT_DIR`, `FOUNDRY_LAST_TESTED_AT`, optional `AZURE_AUTHORITY_HOST`).
     - `resolveFoundryTarget(agentEndpoint, agentName)` supporting full `/responses` URLs, `/protocols/openai` base URLs, and Foundry project URLs (`<project>/agents/<name>/endpoint/protocols/openai/responses?api-version=v1` with fallback to `<project>/openai/v1/responses` + `agent_reference`), enforcing HTTPS (allowing `http://127.0.0.1` / `localhost` for local tests).
     - `acquireEntraToken` (`client_credentials` grant for scope `https://ai.azure.com/.default`, including full `AADSTS` `error_description` on error) and `invokeFoundryResponses` via built-in `fetch`.
     - `createSummaryService({ baseDir, getSession })` exposing `getPublicConfig()` (returning `configured`, `missing`, `tenantId`, `clientId`, `hasClientSecret` boolean—never raw `clientSecret`—`agentEndpoint`, `agentName`, `outputDir`, `lastTestedAt`), `saveConfig(input)` (preserving saved secret when `clientSecret` input is blank), and `testConnection(override)` (sending `CONNECTION_TEST: Reply with READY...`, measuring auth & agent ms, redacting secrets/tokens in returned `logs`, and recording `FOUNDRY_LAST_TESTED_AT`).
   - Wire `GET /api/summary/config`, `POST /api/summary/config`, and `POST /api/summary/test` into `src/server.js`, and add `src/summarizer.js` to `package.json` `"check"`.

3. Frontend Configuration Dialog & Connectivity Log Popup (`public/index.html`, `public/app.js`, `public/styles.css`, `public/log.html`, `public/log.js`):
   - Add `plug-zap`, `key-round`, `save`, `file-lock-2`, `file-text`, `scroll-text`, `circle-check` icons to `public/icons.js` if not already present.
   - Add a **"Summary agent"** button (with a green status dot when configured) in the top bar of `public/index.html` that opens `#config-dialog` containing fields for Directory (Tenant) ID, Application (Client) ID, Client Secret, Microsoft Foundry Agent Endpoint, Agent Name / ID, and Summary Output Folder (`summaries` default), plus **"Test connection"** and **"Save to .env"** buttons and a **"View connectivity test log"** link.
   - Create `public/log.html` and `public/log.js` as a dedicated popup log viewer window (`window.open('/log.html?...', 'chronicleSummaryLog', 'popup=yes,width=880,height=660')`) with timestamp/level/step/message formatting and a **"Copy log"** button that copies the formatted log to the clipboard.

4. Quality Gates:
   - Have `Chronicle Security` audit secret handling, redaction, HTTPS checks, and zero-package compliance.
   - Have `Chronicle Tester` create `test/summarizer.test.js` mocking Entra OAuth2 and Foundry `/responses` over local `node:http` and run `node --check <file>` for each changed JavaScript file and `node --test` until all checks and tests pass!
```

Watch in the Copilot Chat UI as **Chronicle Orchestrator** creates todos and delegates sub-tasks across your Developer, Documentation, Security, and Tester subagents!

---

## Step 2 — Configure & Test Your Workshop Foundry Agent Live! (5 Minutes)

Once the Orchestrator reports that Security and Tester gates have passed:

1. Start the server in your VS Code Terminal:
   ```powershell
   node --max-old-space-size=8192 src/server.js
   ```
2. Open **http://127.0.0.1:3210** in your browser.
3. Click **Summary agent** in the top-right bar to open the **Configure session summarizer** dialog.
4. Enter the **Service Principal and Foundry Agent Endpoint** values provided by your instructor (from Lab 00):
   - **Directory (Tenant) ID**
   - **Application (Client) ID**
   - **Client Secret**
   - **Microsoft Foundry Agent Endpoint**
   - **Agent Name / ID**
   - **Summary Output Folder:** `summaries`
5. Click **Save to `.env`**, then click **Test connection**!
   - You should see a green banner: `Connectivity verified! Entra auth ... ms · Foundry agent ... ms · Reply: "READY"`!
   - Click **View connectivity test log** to open the popup log window, click **Copy log**, and verify your client secret and bearer token are never exposed in the log!

*(Press `Ctrl+C` in the terminal before starting Lab 04, or leave it running and restart after Lab 04.)*

---

## ✅ Lab 03 Checkpoint

- [x] `agentconfig/README.md` and `agentconfig/agent-instructions.md` exist and include the zero-package rule.
- [x] Credentials save cleanly to `.env` (git-ignored) and **Test connection** succeeds against the workshop Foundry Agent!
- [x] Per-file `node --check` commands and `node --test` pass with Security sign-off.

👉 **Next up: [Lab 04 — Comprehensive LLM Session Summarizer, Progress Dialog & Log Popup](./Lab-04-Session-Summarizer-and-Log-Popup.md)**

# Lab 00 — Intro, Baseline Verification & Workshop Credentials

⏱️ **Estimated Time:** 8 minutes

---

## 1. Where We Start & Where We're Going

Inside `workshop/Advanced/sampleapp/`, you already have the completed **Fundamentals** application:
- Zero external npm packages (`package.json` has no `"dependencies"` or `"devDependencies"`).
- Native `node:http` local server (`src/server.js`), Myers line-diff engine (`src/diff.js`), dual-format VS Code + Copilot Agent session parser (`src/parser.js`), and background worker search library (`src/library.js`).
- Browser observatory (`public/index.html`, `public/app.js`, `public/icons.js`, `public/markdown.js`, `public/styles.css`) with dual defaulted Open dialogs, Date/Name sorting, and high-contrast Dark/Light themes.

### What We Will Add in the Next 90 Minutes
1. **A Multi-Agent Engineering Team + Custom Skills** (`.github/agents/*.agent.md` + `.github/skills/*/SKILL.md`):
   - **Chronicle Orchestrator** (team lead & dispatcher)
   - **Chronicle Developer** + `zero-package-engineering` skill
   - **Chronicle Tester** + `foundry-oauth-testing` skill
   - **Chronicle Security** + `local-app-security-audit` skill
   - **Chronicle Documentation** + `foundry-handoff-docs` skill
2. **Microsoft Foundry LLM Session Handoff Summarization:**
   - `/agentconfig` portal documentation & system prompt (enforcing our zero-package rule).
   - `.env`-backed Service Principal + Foundry Agent configuration dialog with live **Test connection**.
   - **Create session summary** button beside **Read full session** that generates a portable, token-efficient `<session-name>-summary.md` handoff file, displays a live progress dialog, and links to a **Popup Operation Log Window** with clipboard copy.
3. **Package-Free Browser Release & Desktop Architecture Review:**
   - Generate a browser icon with a pure-Node PNG/ICO renderer, then verify the app and summarizer in the browser.
   - Review how the optional Electron wrapper isolates the backend and keeps secrets out of the installer, without building or running it.

---

## 2. Open the Advanced Starter Workspace in VS Code (3 Minutes)

> ⚠️ **Important:** Open `workshop/Advanced/sampleapp` directly as your VS Code workspace folder! VS Code discovers `.github/copilot-instructions.md`, `.github/agents/`, and `.github/skills/` relative to the open workspace root.

1. In VS Code, choose **File → Open Folder...** and select:
   ```text
   workshop/Advanced/sampleapp
   ```
2. Open the integrated Terminal (`` Ctrl+` ``) and verify Node.js **22 or newer** and the starter baseline. npm, npx, Electron and any package install are not required:
   ```powershell
   node --version
   node --check src/server.js
   node --test
   ```
   Expect no syntax errors and zero test failures.

---

## 3. Select Agent Harness & Frontier Model (2 Minutes)

1. Open **GitHub Copilot Chat** (`Ctrl+Alt+I`).
2. Ensure you are running on the **Copilot** agent harness (**Agent** mode) and select a **Frontier Model** in the model picker:
   - **Claude Sonnet 5.5**, or an equivalent frontier **GPT** or **Gemini** model.

---

## 4. Workshop Microsoft Foundry Connection Sheet (3 Minutes)

A shared **Microsoft Foundry Prompt Agent** (`chronicle-session-summarizer`) and a **Microsoft Entra ID Service Principal** (granted the `Foundry Agent Consumer` role) have already been provisioned for your workshop group!

Keep these 5 values from your instructor handy—you will enter them into Chronicle's configuration dialog in **Lab 03**:

| Parameter | `.env` Variable | Provided by Instructor at Lab Time |
|---|---|---|
| **Directory (Tenant) ID** | `AZURE_TENANT_ID` | `<instructor-tenant-guid>` |
| **Application (Client) ID** | `AZURE_CLIENT_ID` | `<instructor-client-guid>` |
| **Client Secret** | `AZURE_CLIENT_SECRET` | `<instructor-client-secret-value>` |
| **Foundry Agent Endpoint** | `FOUNDRY_AGENT_ENDPOINT` | `https://<resource>.services.ai.azure.com/api/projects/<project>/agents/<agent>/endpoint/protocols/openai/responses?api-version=v1` |
| **Agent Name** | `FOUNDRY_AGENT_NAME` | `<instructor-agent-name>` |

*(Never commit these credentials to Git—your Security agent will verify `.env` is git-ignored and redacted from logs!)*

---

## ✅ Lab 00 Checkpoint

- [x] VS Code is open directly at `workshop/Advanced/sampleapp`.
- [x] `node --check src/server.js` and `node --test` pass with zero errors.
- [x] You have your instructor's Foundry Agent & Service Principal details ready for Lab 03.

👉 **Next up: [Lab 01 — Creating the Orchestrator & Specialist Role Agents](./Lab-01-Orchestrator-and-Role-Agents.md)**

# Lab 02 — Equipping Each Agent Role with Reusable Skills (`SKILL.md`)

⏱️ **Estimated Time:** 15 minutes

---

## Agents vs. Skills: Why Use Both?

- **Custom Agents (`.github/agents/*.agent.md`)** define **WHO** does the work: their role, tool permissions (`read` vs. `edit`/`execute`), and high-level responsibilities.
- **Agent Skills (`.github/skills/<skill-name>/SKILL.md`)** define **HOW** to perform specialized, repeatable engineering workflows! Skills follow the open [Agent Skills standard](https://agentskills.io), load on demand (keeping context lean), and can be attached directly to specific agents via `skills: [...]` in `.agent.md` frontmatter!

> ⚠️ **Important Rule for `SKILL.md`:** The `name:` field in YAML frontmatter **must exactly match** the parent folder name (for example, `.github/skills/zero-package-engineering/SKILL.md` must have `name: zero-package-engineering`).

In this lab, you will create one specialized skill for each of our four worker roles and wire them into your agents!

| Role Agent | Skill Directory & `name` | What the Skill Teaches |
|---|---|---|
| `Chronicle Developer` | `.github/skills/zero-package-engineering/SKILL.md` | Pure `node:*` patterns: atomic `.env` parser/writer, Entra ID `client_credentials` + Foundry Responses REST calls via `fetch`, `node:zlib` PNG/ICO encoding, and native `<dialog>` / popup patterns |
| `Chronicle Tester` | `.github/skills/foundry-oauth-testing/SKILL.md` | Local `node:http` mock servers for Entra OAuth2 & Foundry Responses, multi-chunk digest assertions, secret-redaction checks, and zero-dependency manifest assertions |
| `Chronicle Security` | `.github/skills/local-app-security-audit/SKILL.md` | 6-point audit rubric covering `.env` secret isolation, bearer/secret log redaction, HTTPS endpoint validation, localhost/CSP headers, DOM sanitization, and Electron sandbox flags |
| `Chronicle Documentation` | `.github/skills/foundry-handoff-docs/SKILL.md` | Blueprint for `/agentconfig` Microsoft Foundry Portal setup guides and cross-machine handoff system prompts that preserve the zero-package architecture |

---

## Step 1 — Generate the Four Specialized Skills (10 Minutes)

In **Copilot Chat (default Agent mode)**, paste the prompt below and press **Enter**:

```text
Create four workspace Agent Skills under `.github/skills/<skill-name>/SKILL.md` (making sure each `SKILL.md` YAML frontmatter `name` matches its parent directory name exactly and has a clear trigger `description`):

1. `.github/skills/zero-package-engineering/SKILL.md`:
   - `name: zero-package-engineering`
   - `description: Zero-dependency Node.js and browser implementation patterns for Chronicle. Use when building HTTP routes, .env parsers, Entra ID / Foundry REST clients, PNG/ICO generators, or browser dialogs without npm packages.`
   - Body guidelines:
     - `.env` parsing & writing: Parse `KEY=VALUE` lines preserving comments and unrelated keys, handle quoted values/escapes, and write updates atomically using a temporary file (`<path>.<pid>.tmp`, mode `0o600`) followed by `fs.rename`.
     - Microsoft Entra ID + Foundry REST calls via built-in `fetch`:
       - Acquire tokens via `POST https://login.microsoftonline.com/<tenantId>/oauth2/v2.0/token` (`application/x-www-form-urlencoded` with `client_id`, `client_secret`, `scope=https://ai.azure.com/.default`, `grant_type=client_credentials`), surfacing `error_description` (`AADSTS...`) on failure.
       - Invoke Foundry Agents via `POST <agent-responses-url>` (supporting full `/responses` URLs, `/protocols/openai` base URLs, and project URLs `<project>/agents/<agentName>/endpoint/protocols/openai/responses?api-version=v1` with fallback to `<project>/openai/v1/responses` + `agent_reference`), sending `{ input: [{ role: "user", content: prompt }] }` with `Authorization: Bearer <token>`, and extracting `output_text` or `output[].content[].text`.
     - Pure-Node binary icons: Encode RGBA buffers into valid PNG (`IHDR`, `zlib.deflateSync` `IDAT`, `IEND` with CRC32) and multi-entry Windows `.ico` headers without external imaging libraries.

2. `.github/skills/foundry-oauth-testing/SKILL.md`:
   - `name: foundry-oauth-testing`
   - `description: Deterministic zero-package testing patterns for Chronicle using node:test and local node:http mock servers. Use when writing or running automated tests for parsers, HTTP routes, Entra OAuth2, or Foundry summarization.`
   - Body guidelines:
     - Spin up ephemeral `http.createServer` listeners on port `0` bound to `'127.0.0.1'` to simulate Entra `/oauth2/v2.0/token` (401 bad secret vs 200 token) and Foundry `/responses` (`CONNECTION_TEST:` -> `READY`, `SESSION_CHUNK_DIGEST`, `FINAL_SESSION_SUMMARY`, and 500/502 upstream errors), overriding `AZURE_AUTHORITY_HOST` to `http://127.0.0.1:<port>`.
     - Verify secret redaction: assert neither `clientSecret` nor `access_token` ever appears in `getPublicConfig()`, job error strings, or operation log entries even when upstream errors echo them.
     - Always assert `package.json` has no `"dependencies"` block and run `node --check <file>` for each changed JavaScript file and `node --test`.

3. `.github/skills/local-app-security-audit/SKILL.md`:
   - `name: local-app-security-audit`
   - `description: Security and privacy review checklist for Chronicle local server, .env credentials, Foundry API calls, browser popups, and Electron desktop packaging.`
   - Body guidelines:
     - Check all 6 gates with `file:line` citations:
       1. Secret storage & git-ignore: `.env` and `summaries/` ignored in `.gitignore`; `GET /api/summary/config` returns `hasClientSecret: boolean` and NEVER raw `clientSecret`.
       2. Log & error redaction: `redactSecrets` scrubs both `clientSecret` and `Bearer <token>` across all logs and error responses.
       3. Endpoint validation: Foundry endpoint rejects non-HTTPS URLs except `http://127.0.0.1` / `localhost` for local testing.
       4. Local HTTP hardening: `127.0.0.1` bind, `Host` & `Origin`/`Sec-Fetch-Site` `403` checks, 32 KB JSON limit, strict CSP, and static path-traversal prevention.
       5. Untrusted chat content: Rendered Markdown/HTML passes through allowlist sanitization; external links open externally without `opener`.
       6. Electron isolation (when `electron/` exists): `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, narrow `contextBridge` API, and `setWindowOpenHandler` allowing only local `/log.html` popups while routing external `https://` to OS browser.

4. `.github/skills/foundry-handoff-docs/SKILL.md`:
   - `name: foundry-handoff-docs`
   - `description: Authoring guide for /agentconfig Microsoft Foundry Portal documentation, system prompts, and README updates in Chronicle.`
   - Body guidelines:
     - In `agentconfig/README.md`: Document step-by-step Foundry Portal Prompt Agent creation, Entra ID App Registration + Service Principal creation (`az ad sp create`), `Foundry Agent Consumer` RBAC assignment, `.env` keys, and `AADSTS` / `403` troubleshooting.
     - In `agentconfig/agent-instructions.md`: Provide a copy-paste system prompt handling `CONNECTION_TEST:` (`READY`), `MODE: SESSION_CHUNK_DIGEST`, and `MODE: FINAL_SESSION_SUMMARY` (9 structured sections with portable workspace-relative paths, ~600–2,200 word token discipline, and an explicit **Zero-Package Architecture** rule forbidding external npm packages).
```

---

## Step 2 — Wire Each Skill into Its Matching Role Agent (3 Minutes)

Now attach the skills to your four specialist agents so Copilot automatically loads each role's domain playbook whenever the Orchestrator dispatches that agent!

Paste this prompt into **Copilot Chat**:

```text
Update the YAML frontmatter of our four worker agents in `.github/agents/` to preload their matching workspace skills via the `skills` array:
- `chronicle-dev.agent.md` -> `skills: ['zero-package-engineering']`
- `chronicle-test.agent.md` -> `skills: ['foundry-oauth-testing']`
- `chronicle-security.agent.md` -> `skills: ['local-app-security-audit']`
- `chronicle-docs.agent.md` -> `skills: ['foundry-handoff-docs']`
```

---

## Step 3 — Verify Your Skills & Switch to Chronicle Orchestrator! (2 Minutes)

1. Press `Ctrl+Shift+P` → run **Chat: Open Customizations** → click **Skills**.
   - Confirm all 4 workspace skills appear (`zero-package-engineering`, `foundry-oauth-testing`, `local-app-security-audit`, `foundry-handoff-docs`)!
2. Start a **New Chat** (`Ctrl+N` inside the Copilot Chat view).
3. Type `/` in the chat box—notice your skills appear right in the slash-command menu!
4. Now open the **Agent dropdown** at the bottom of Copilot Chat and select **`Chronicle Orchestrator`**.

From here through the end of the workshop, **you will talk exclusively to `Chronicle Orchestrator`** and watch it dispatch your Developer, Security, Tester, and Documentation team!

---

## ✅ Lab 02 Checkpoint

- [x] All 4 `SKILL.md` files exist in `.github/skills/<name>/SKILL.md` with matching `name` frontmatter.
- [x] Each worker `.agent.md` references its skill in `skills: [...]`.
- [x] **`Chronicle Orchestrator`** is selected in the Copilot Chat agent picker!

👉 **Next up: [Lab 03 — Foundry `.env` Configuration, Setup Docs & Live Connectivity Test](./Lab-03-Foundry-Config-and-Connectivity.md)**

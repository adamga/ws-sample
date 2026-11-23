# Lab 01 — Designing Your Multi-Agent Team (Orchestrator + Role Subagents)

⏱️ **Estimated Time:** 17 minutes

---

## Why Multi-Agent Orchestration Beats One Giant Prompt

When building non-trivial software—combining OAuth2 Service Principal authentication, LLM chunking, browser popups, Electron process isolation, and security auditing—a single generalist conversation quickly accumulates noisy context:
- Implementation code crowds out security rules.
- Test output pollutes architectural planning.
- Documentation updates get forgotten at the end.

In VS Code with GitHub Copilot, custom workspace agents live in **`.github/agents/*.agent.md`**. We can design a **hub-and-spoke engineering team**:

```text
                   ┌──────────────────────────────────┐
   You (in Chat) ──▶  Chronicle Orchestrator          │  (user-invocable: true)
                   │  Plans, tracks todos & delegates │  tools: ['read','search','agent','todo']
                   └───────┬────────┬─────────┬───────┘
          ┌────────────────┼────────┴─┐       └────────────────┐
          ▼                ▼          ▼                        ▼
 ┌─────────────────┐ ┌───────────┐ ┌──────────────────┐ ┌─────────────────────┐
 │ Chronicle       │ │ Chronicle │ │ Chronicle        │ │ Chronicle           │
 │ Developer       │ │ Security  │ │ Tester           │ │ Documentation       │
 │ (code & UI)     │ │ (read-only│ │ (node:test &     │ │ (/agentconfig &     │
 │                 │ │  auditor) │ │  mock servers)   │ │  README updates)    │
 └─────────────────┘ └───────────┘ └──────────────────┘ └─────────────────────┘
```

### Key VS Code `.agent.md` Design Patterns You'll Use
- **Least-Privilege `tools`:** Notice **Chronicle Security** only gets `['read', 'search']`—it *cannot* accidentally rewrite your code while auditing it! **Chronicle Orchestrator** gets `['read', 'search', 'agent', 'todo']`—forcing it to *coordinate and delegate* edits to specialist workers rather than writing everything itself!
- **Clean Agent Picker (`user-invocable`):** Setting `user-invocable: true` on **Chronicle Orchestrator** and `user-invocable: false` on the 4 specialist workers keeps your Chat dropdown clean while allowing the Orchestrator to invoke every worker as a subagent!

---

## Step 1 — Create the Four Specialist Role Subagents (10 Minutes)

In **Copilot Chat (default Agent mode)**, paste the prompt below and press **Enter** to generate your four specialist worker agents in `.github/agents/`:

```text
Create four workspace custom subagent files inside `.github/agents/` using VS Code's `.agent.md` YAML frontmatter format. All four are specialist worker subagents invoked by our orchestrator (`user-invocable: false`, `disable-model-invocation: false`) and must strictly obey `.github/copilot-instructions.md` (ZERO runtime npm package dependencies—design everything directly into application source code):

1. `.github/agents/chronicle-dev.agent.md`:
   - `name: Chronicle Developer`
   - `description: Full-stack zero-package Node.js, browser UI, and Electron developer for Chronicle. Delegate all feature implementation, bug fixes, and build configuration changes to this agent.`
   - `tools: ['read', 'edit', 'search', 'execute']`
   - `user-invocable: false`
   - Body instructions:
     - Implement backend modules in `src/` using ONLY built-in `node:*` modules and global `fetch`. Never add `"dependencies"` to `package.json` or import npm packages at runtime.
     - Implement frontend features in `public/` using plain HTML/CSS/JS, `chronicleIcons`, and `chronicleMarkdown` (no CDNs, no `/vendor/` paths).
     - Keep all persisted chat session sources strictly read-only, use atomic temp-file + `rename` writes for `.env` and summary outputs, and run `node --check <file>` for each changed JavaScript file before returning your summary.

2. `.github/agents/chronicle-test.agent.md`:
   - `name: Chronicle Tester`
   - `description: Automated quality & test engineer for Chronicle. Delegate unit/integration test authoring and validation runs (per-file syntax checks and `node --test`) to this agent.`
   - `tools: ['read', 'edit', 'search', 'execute']`
   - `user-invocable: false`
   - Body instructions:
     - Write fast, deterministic tests in `test/*.test.js` using ONLY `node:test`, `node:assert/strict`, `node:http` (for local mock OAuth/Foundry servers), and temporary `os.tmpdir()` directories cleaned up via `t.after(...)`.
     - Test edge cases, error paths, secret redaction, and our zero-package invariant (asserting `package.json` has no `"dependencies"`).
     - Always run `node --check <file>` for each changed JavaScript file and `node --test` and report exact pass/fail counts and root causes.

3. `.github/agents/chronicle-security.agent.md`:
   - `name: Chronicle Security`
   - `description: Read-only application security, privacy, and secret-handling auditor for Chronicle. Delegate security reviews of `.env` storage, OAuth/Foundry calls, HTTP routes, HTML sanitization, and Electron sandboxing to this agent.`
   - `tools: ['read', 'search']`
   - `user-invocable: false`
   - Body instructions:
     - Never edit files. Inspect changed files and report concrete findings grouped by severity (`Critical`, `High`, `Medium`, `Pass`) with exact `file:line` references.
     - Verify: (a) `.env` and `summaries/` are in `.gitignore` and secrets are never returned by GET config APIs or leaked in operation logs/error banners; (b) Foundry endpoints require `https:` (allowing `http://127.0.0.1` only for local mock tests); (c) server binds to `127.0.0.1` with cross-origin `403` and strict CSP; (d) if reviewing the reference desktop wrapper, Electron windows enforce `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, and deny arbitrary external navigation; (e) zero third-party runtime npm packages were introduced.

4. `.github/agents/chronicle-docs.agent.md`:
   - `name: Chronicle Documentation`
   - `description: Technical writer and prompt documentation specialist for Chronicle. Delegate `/agentconfig` Microsoft Foundry Portal setup docs, system prompt authoring, and `README.md` updates to this agent.`
   - `tools: ['read', 'edit', 'search']`
   - `user-invocable: false`
   - Body instructions:
     - Write concise, accurate developer documentation and ready-to-copy Microsoft Foundry agent instructions.
     - Ensure any agent prompt or developer guide explicitly states the Zero-Package Architecture rule (never install runtime Node/npm packages; design everything directly in source code).
```

---

## Step 2 — Create the Single Orchestrating Agent (5 Minutes)

Now let's create **Chronicle Orchestrator**—the single entry-point agent you will select in Chat to coordinate all four specialists!

Paste this prompt into **Copilot Chat** and press **Enter**:

```text
Create `.github/agents/chronicle-orchestrator.agent.md` for our lead coordinating agent:

- Frontmatter:
  - `name: Chronicle Orchestrator`
  - `description: Lead engineering orchestrator for Chronicle. Breaks complex features into a structured plan and dispatches implementation, security review, automated testing, and documentation across Chronicle Developer, Chronicle Security, Chronicle Tester, and Chronicle Documentation.`
  - `tools: ['read', 'search', 'agent', 'todo']`
  - `user-invocable: true`

- Body instructions:
  - You are the technical lead and orchestrator for Chronicle. You coordinate work rather than writing production code directly (notice `edit` and `execute` are intentionally omitted from your tools).
  - For every feature request, execute this workflow:
    1. **Inspect & Plan:** Quickly read relevant workspace files to understand current interfaces, then record a concise task checklist using your `todo` tool.
    2. **Implement (`Chronicle Developer`):** Delegate concrete, self-contained file specifications and acceptance criteria to `Chronicle Developer` (always reinforcing the zero-runtime-npm-package architecture).
    3. **Parallel Quality Gates (`Chronicle Security` + `Chronicle Tester` + `Chronicle Documentation`):**
       - Dispatch `Chronicle Security` to audit the changes for secret leaks, CSP/CORS, Electron sandboxing, and zero-package compliance.
       - Dispatch `Chronicle Tester` to add focused `node:test` coverage and execute `node --check <file>` for each changed JavaScript file and `node --test`.
       - Dispatch `Chronicle Documentation` when user-facing setup docs, `/agentconfig` prompts, or `README.md` updates are required.
    4. **Remediate & Sign Off:** If `Chronicle Security` or `Chronicle Tester` reports any High/Critical issue or failing test, send a targeted fix task back to `Chronicle Developer` and re-verify with `Chronicle Tester` before reporting final completion to the user.
```

---

## Step 3 — Inspect Your Agents in VS Code (2 Minutes)

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and run **Chat: Open Customizations**.
2. Click **Agents** in the Customizations view:
   - Confirm all **5 workspace agents** appear (`Chronicle Orchestrator`, `Chronicle Developer`, `Chronicle Tester`, `Chronicle Security`, `Chronicle Documentation`) with zero YAML validation warnings!
3. Open any `.agent.md` file in `.github/agents/` and hover over `tools` or `user-invocable` to see VS Code's built-in schema hover tooltips.

---

## ✅ Lab 01 Checkpoint

- [x] Five `.agent.md` files exist in `.github/agents/`.
- [x] **Chronicle Orchestrator** is `user-invocable: true` with `tools: ['read', 'search', 'agent', 'todo']`.
- [x] All four role specialists (`Developer`, `Tester`, `Security`, `Documentation`) have role-appropriate least-privilege `tools`.

👉 **Next up: [Lab 02 — Equipping Each Agent Role with Reusable Skills (`SKILL.md`)](./Lab-02-Creating-Agent-Skills.md)**

# GitHub Copilot Workshop — Advanced (90 Minutes / 1.5 Hours)

**Multi-Agent Orchestration, Custom Agent Skills, Microsoft Foundry Session Analysis & Browser Release**

Welcome to the **Advanced Workshop**! You are starting from `workshop/Advanced/sampleapp/`—the complete, working **zero-package Chronicle web explorer** from the Fundamentals track.

Instead of prompting a single default coding assistant directly for every task, you will first engineer a **coordinated multi-agent team** inside `.github/agents/`—led by a single **Orchestrator Agent** that delegates work to specialized **Developer**, **Tester**, **Security**, and **Documentation** subagents—and equip each role with reusable **Agent Skills** (`.github/skills/<skill>/SKILL.md`).

Then you will command your **Orchestrator Agent** to build three production-grade enhancements onto Chronicle:
1. **Microsoft Foundry Agent Configuration & `.env` Connectivity Testing** (connecting to the shared workshop Foundry Agent using Service Principal credentials supplied at lab time, plus `/agentconfig` setup guides).
2. **Portable LLM Session Handoff Summarization (`<session-name>-summary.md`)** with token-disciplined chunking, a live progress dialog, and a popup operation log viewer with clipboard copy and secret redaction.
3. **Package-free browser release** with a generated Chronicle icon, regression checks, and a read-only review of the optional Electron wrapper.

---

## Schedule & Lab Map (90 Minutes Total)

**Presenting or attending?** Open the [Advanced media kit](./content/README.md) for the editable slide decks, captioned explainers, and delivery guidance. The videos are preparation and review material; they do not add time to the 90-minute lab schedule.

**Lab-centered presentation & `gpt-audio-1.5` motion-graphics explainers:** [Advanced Workshop Deck v1.pptx](./Advanced%20Workshop%20Deck%20v1.pptx) (32 editable slides) covers agent surfaces, harnesses & the Agent Host, Markdown control for `.agent.md` & `SKILL.md`, Hooks & Canvases, subagent architecture, and Labs 00–05. Watch the deck with either the [Little Helpers / Fundamental Explainer](./content/v1/Little%20Helpers.mp4) (explained simply as if to a 5-year-old) or the [Train-the-Trainer Explainer](./content/v1/Train%20the%20Trainer.mp4) — see the [v1 deck & video guide](./content/v1/README.md).

| Lab | Topic | Time |
|---|---|---|
| **[Lab 00 — Intro, Baseline & Workshop Credentials](./Lab-00-Intro-and-Baseline.md)** | Open `workshop/Advanced/sampleapp`, verify the baseline zero-package app (`node --test`), select a frontier model, and review the shared Foundry Service Principal parameters | **8 min** |
| **[Lab 01 — Orchestrator & Specialist Role Agents](./Lab-01-Orchestrator-and-Role-Agents.md)** | Create `.github/agents/chronicle-orchestrator.agent.md` plus four role-scoped worker subagents (`Developer`, `Tester`, `Security`, `Documentation`) | **17 min** |
| **[Lab 02 — Equipping Agents with Custom Skills](./Lab-02-Creating-Agent-Skills.md)** | Author four domain `SKILL.md` modules under `.github/skills/` and attach each skill to its matching specialist agent | **15 min** |
| **[Lab 03 — Foundry `.env` Config & Connectivity Test](./Lab-03-Foundry-Config-and-Connectivity.md)** | Use **Chronicle Orchestrator** to build `/agentconfig` docs, Entra ID Service Principal OAuth2 + Foundry Responses client, and the `.env` config/test dialog—then test live connectivity | **15 min** |
| **[Lab 04 — LLM Session Summarizer & Log Popup](./Lab-04-Session-Summarizer-and-Log-Popup.md)** | Use **Chronicle Orchestrator** to add comprehensive, token-bounded `<session-name>-summary.md` generation, progress dialog, and popup operation log viewer with clipboard copy | **18 min** |
| **[Lab 05 — Browser Release & Desktop Architecture](./Lab-05-Desktop-Electron-and-Installer.md)** | Generate and serve a local icon, verify the browser app, and review the reference desktop wrapper without running it | **17 min** |

---

## Core Architectural Invariant

Read `sampleapp/.github/copilot-instructions.md`: use **Node.js 22+ directly**, with no npm, npx, Electron, or package installs. Keep `package.json` free of `dependencies` and `devDependencies`. Foundry credentials are still needed for the live checks in Labs 03–04; the local tests use mocks.

👉 **Start here: [Lab 00 — Intro, Baseline & Workshop Credentials](./Lab-00-Intro-and-Baseline.md)**

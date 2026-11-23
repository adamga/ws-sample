# Copilot Coding Instructions — Chronicle / Chat Explorer

## Zero-Package Policy (Mandatory)
- **Do NOT install, import, or rely on any external Node.js / npm runtime packages** (`"dependencies"` must remain completely absent from `package.json`).
- **Design and implement every capability directly into the application source code** (`src/`, `public/`, `build/`):
  - **Backend (`src/`):** Use only built-in Node.js modules (`node:http`, `node:fs`, `node:fs/promises`, `node:path`, `node:os`, `node:url`, `node:crypto`, `node:child_process`, `node:perf_hooks`, `node:zlib`) and global `fetch`.
  - **Tests (`test/`):** Use only Node's built-in test runner (`node:test` and `node:assert/strict`).
  - **Frontend (`public/`):** Use plain, dependency-free browser JavaScript, HTML, CSS, inline SVG icons (`public/icons.js`), and in-repo Markdown, strict allowlist DOM sanitization, and syntax highlighting (`public/markdown.js`). Never reference external CDNs or `/vendor/` folders.

## Security & Local-Only Invariants
- Never modify or overwrite persisted chat history source files; treat all session inputs as strictly read-only.
- Bind the HTTP server strictly to `127.0.0.1`, reject non-local `Host` headers and cross-origin requests (`403`), enforce strict Content-Security-Policy (`CSP`) headers, and sanitize all rendered Markdown/HTML via an explicit tag/attribute allowlist.
- Never commit secrets or `.env` files to source control; redact secrets and bearer tokens from logs and error messages.

## Validation
- Use `node --check <file>` for each changed JavaScript file and `node --test` from this folder. Do not invoke npm or npx, or add `dependencies` or `devDependencies` during the workshop.

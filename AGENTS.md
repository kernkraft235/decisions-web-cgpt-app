# JEV Web

Personal, localhost-only decision-model playground. Keep it small and dark, with a compact iPhone-friendly interface. No authentication, deployment, accounts, analytics, or production infrastructure.

- A private ChatGPT/MCP app is supported through OpenAI Secure MCP Tunnel. Reuse `OPENAI_TUNNEL_ID` from `.env`; do not create a replacement tunnel or expose the web server publicly. `npm run tunnel` connects the running server. Ordinary MCP tools must work without widgets or a skill.

- React + Vite UI; Express server; lowdb persists named questions and sets in `data/library.json`.
- Prioritize the custom llama.cpp endpoint from `CUSTOM_BASE_URL`, without a key. Enumerate every local model; do not filter the local list by decision support. Blank browser URL settings follow the server default.
- OpenRouter lists only decision models from its live catalog, including image capability. OpenAI Decisions uses `gpt-6-luna`.
- Read `OPENAI_API_KEY` and `OPENROUTER_API_KEY` from `.env`. Missing keys are fine. Browser-provided keys are stored in that browser and sent with requests; never reveal server keys or log keys/input.
- Questions have individual names, can be saved separately, and can be assembled into saved sets. Sets contain snapshots so deleting an individual template does not break a set.
- Persist definitions server-side only when explicitly saved. Remember the current draft/set/settings in browser storage, and the last text and images in IndexedDB. Never save evaluation input in the server library.
- UUID workspaces are the explicit exception for working data: autosave input, local file copies, extracted text, question snapshots, and recent results under `data/workspaces/`. Save / Share assigns a unique name and protects a workspace from cleanup. Linked widgets and frontend routes edit the same workspace; Duplicate makes an independent copy. Keep input out of model-visible tool results unless explicitly requested.
- Server defaults are explicitly saved through web Settings. MCP and workspace runs resolve run overrides, workspace selection, then server defaults; never silently fall back to a different provider. Browser credentials remain browser-only.
- Reuse shared React components for the frontend and MCP Apps widgets. Use the MCP Apps bridge for ordinary operations and feature-detect ChatGPT file/Library extensions. PDF/DOCX extraction uses local MarkItDown without cloud conversion or OCR.
- Keep answers beside their questions. Fold question details by default after loading. Support yes/no, choice, and ordered scale together.
- Body text is 14px. Editable controls render at 16px and are visually scaled to 14px to avoid iOS focus zoom. Preserve pinch zoom.
- API request/response reference and primary-source links: `docs/api-reference.md`. Provider translation lives in `server/providers.js`.
- `npm start` builds and serves the app on port 4379 (falls back to an unused port if occupied unless `PORT` is explicitly set). `HOST` defaults to loopback; `PORT` overrides the port. `npm run dev` uses Vite middleware on the same server. All supported environment variables are documented in `.env.example`; restart after changing `.env`.
- Verification is a build/startup smoke check only. Let the user exercise features; do not add test suites or make paid decision requests automatically.

This directory was not a Git repository when created. Do not initialize Git merely as ceremony. If it becomes a repository, commit completed related changes and exclude `.env`, `data/`, `node_modules/`, and `dist/`.

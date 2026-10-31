# Private ChatGPT app and MCP

The existing Express server exposes `/mcp`; the homepage, workspace routes, MCP tools, and widgets use the same library and evaluation services. This is a personal app without public hosting, accounts, or authentication. Access from ChatGPT uses the existing OpenAI Secure MCP Tunnel.

## Start and connect

1. Run `npm start` with a fixed `PORT` (normally 4379).
2. In web Settings, select **Use current model as server default**. The initial server default has provider `llama` and no model; the server will not guess one.
3. Keep `OPENAI_TUNNEL_ID` in `.env`. The tunnel launcher uses `CONTROL_PLANE_API_KEY`, or `OPENAI_API_KEY` when blank.
4. Run `npm run tunnel:install` once for a current project-local client, then `npm run tunnel:doctor` and `npm run tunnel`. Keep both the app and client running. The old v0.0.10 client has a [known no-auth discovery bug](https://github.com/openai/tunnel-client/issues/24). `TUNNEL_CLIENT_BIN` can override the executable; otherwise the launcher prefers `data/bin/tunnel-client` over PATH.
5. Install the generated private JEV Decisions plugin, or add a custom MCP server in ChatGPT Plugins with **Connection: Tunnel**, the existing tunnel, and no application authentication. The Platform tunnel must be associated with the intended ChatGPT workspace and the operator needs tunnel Read + Use.
6. Refresh the custom connection after tool/schema/resource changes. `npm start` builds both frontend and widget; `npm run dev` builds the widget once, then uses Vite middleware for the frontend. Run `npm run build:widget` and restart after widget changes.

`npm run plugin:package` builds `data/jev-decisions-plugin.tar.gz`. Its portable `mcp.json` uses `extensions.com.openai.tunnelId` instead of a public URL. The source package under `plugins/jev-decisions/` uses localhost for local clients. The generated archive includes only the manifest, MCP configuration, icon, and skill. The ID is deliberately absent from tracked files.

## Tool contracts

Use `list_models` for model discovery and the current server default. All custom models remain listed; OpenRouter uses its live decision-model catalog; OpenAI uses `gpt-6-luna`. Credentials and base-URL overrides are never accepted through MCP. Existing browser overrides still work in the homepage.

`evaluate` accepts `input`, `files`, image data URLs, one question selector, optional workspace reference, and optional `provider`/`model`:

```json
{"input":"Evidence to evaluate","setName":"Editorial review"}
```

```json
{"input":"Evidence to evaluate","questionNames":["Actionable","Urgency"]}
```

```json
{"input":"Evidence to evaluate","questions":[{"type":"predicate","instructions":"Does this contain a concrete action item?"}]}
```

Public questions support `predicate`, `choice`, and `score`; `noul` remains a compatibility alias. Choices and scale levels use `{ "label": "…", "description": "…" }`. Inline questions may omit IDs and names. Library saves require names. A set and individual questions have separate name namespaces, and set contents remain snapshots.

With `workspaceId` or `workspaceName`, omitted input/questions reuse that workspace. Supply `expectedRevision` when changing its input or question selection. A run-only model override does not change its settings or the server default. A new evaluation without a workspace creates one and returns its UUID. `requestId` identifies a retry of the same run.

Evaluations run in the server process. A tool call waits up to 20 seconds and returns a `runId` if still running. `get_run` inspects it without starting inference; `cancel_run` requests cancellation. Only one active run is allowed per workspace. A restart marks unfinished runs interrupted and does not replay them. Summary results omit full probability distributions; `get_run` with `detail: "full"` includes them.

| Tools | Role |
| --- | --- |
| `list_library`, `get_definition` | Find and inspect named questions/sets |
| `save_question`, `save_set` | Explicitly save/update library definitions |
| `rename_item`, `delete_item` | Modify a question, set, or workspace using its current revision |
| `create_workspace`, `list_workspaces`, `get_workspace` | Create, recall, and inspect working data |
| `update_workspace` | Autosave input, files, questions, or execution settings |
| `save_workspace`, `duplicate_workspace` | Protect/name a workspace or make an independent copy |
| `evaluate`, `get_run`, `cancel_run` | Run and inspect/cancel native decision evaluations |
| `render_workspace`, `get_workspace_link` | Open a widget or frontend link |

`render_workspace` takes `view: "combined" | "prompt" | "questions" | "results"`. Link cards by passing the same workspace UUID. Run calls originate directly from the widget. Views refresh when visible and on focus; revision conflicts preserve local drafts and offer reload/reapply.

## Files and context

Declare chat attachments through the top-level `files` parameter. Each file object has required `download_url` and `file_id`, with optional declared `mime_type` and `file_name`. The server downloads temporary HTTPS references without forwarding credentials. URLs are not persisted. Public DNS addresses are validated and pinned, including across redirects.

The widget uses `window.openai.uploadFile`, `selectFiles`, and `getFileDownloadUrl` when present. Library selection is optional. Otherwise the widget can attach small files through an app-only MCP tool, or the user can attach them in the frontend. The text field autocompletes names of files already attached; it does not enumerate the ChatGPT Library.

PDF and DOCX use local MarkItDown with no cloud extraction, LLM conversion, or OCR. Empty scans and failed conversions are visible and block evaluation until removed or replaced. Typed text and file contents are kept in the workspace; routine tool summaries contain IDs, names, counts, and normalized answers. Widget-only hydration uses `_meta`. `get_workspace(includeInput: true)` explicitly exposes typed input to the model; document extraction is not routinely returned.

Files can be up to 32 MiB; the widget's inline fallback is smaller because the tunnel's serialized message limit is 10 MiB. Ordinary references avoid transmitting document bytes in tool arguments. No chunked upload system is used. Large extracted evidence still has to fit the selected decision model's context.

## Storage and links

Definitions and the explicit server default live in `data/library.json`. Workspace metadata, original/derived files, and the latest 20 run snapshots live in `data/workspaces/<uuid>/`. Save/Share assigns a unique name and protects that workspace. Duplicate copies current input/assets/questions/settings, with fresh identity and no run history.

Named routes use `/workspace/<encoded-name>`; permanent identity links use `/workspace/by-id/<uuid>`. Name routes change after renaming. Links use `FRONTEND_BASE_URL` when set, otherwise localhost. They require a device that can already reach the frontend. Sharing does not grant public access.

Cleanup runs at startup, hourly, and after storage mutations. It expires unsaved workspaces after `WORKSPACE_TTL_DAYS` (default 30), then evicts unsaved workspaces by least recent activity above `WORKSPACE_MAX_BYTES` (default 1 GiB). Idle polling is not activity. Saved workspaces and active runs are protected; `WORKSPACE_EXCLUDE_SAVED_FROM_LIMIT=true` excludes saved bytes. If saved bytes count and leave no room, storage growth fails rather than deleting saved work. Widget removal is not treated as permission to delete data.

## Verification and manual acceptance

Automated verification is build/startup and MCP discovery only. No decision requests or paid inference are made automatically and no test suite is installed. The user should exercise:

- Inline questions, a named set, and ordered question-name selection through ordinary tools.
- Question/set CRUD, snapshots, name collisions, and stale revisions.
- Linked prompt/questions cards, changing input, direct Run, cancellation, and slow-run status.
- A single image, chat file references, Library selection where supported, and PDF/DOCX text conversion.
- Save/Share, reopening the same workspace across chats, independent duplication, and frontend links.
- Probability charts, old-result indicators, history, provider errors, and interrupted runs.

## Primary references

- [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [MCP Apps UI and state](https://developers.openai.com/plugins/build/chatgpt-ui)
- [ChatGPT file APIs and tool metadata](https://developers.openai.com/plugins/reference)
- [Plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [MarkItDown](https://github.com/microsoft/markitdown)

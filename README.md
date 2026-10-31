# Decisions

A small dark mobile-friendly playground for llama.cpp System One, OpenRouter Decisions, and OpenAI Decisions.

```sh
npm install
npm start
```

Open the address printed on startup (normally `http://127.0.0.1:4379`). `npm run dev` runs the same server with Vite's development UI. `HOST` sets the listening address and `PORT` sets the port; both work in `.env` or the launching shell. Node 22+ is required.

All environment settings are documented in [.env.example](.env.example). Provider keys are optional; Settings can supply browser-stored overrides. `CUSTOM_BASE_URL` sets the default llama.cpp endpoint (include `/v1`); leave the browser URL blank to follow it. Server keys stay on the server, and no key is sent to the custom endpoint. Restart the server after `.env` changes. Existing shell variables take precedence.

Save questions individually, assemble any mix of types, and save whole sets. Server storage is `data/library.json`; back up that file to keep your library and server default. Sets are snapshots. The original homepage keeps its draft, provider settings, last text, and images in the browser. Library controls rename and delete saved definitions.

The folder button opens **Workspaces**. Create a blank workspace or use the homepage's current draft. Workspaces autosave text, files, questions, settings, and the latest 20 runs on this server. Add text files, images, PDF, and DOCX; PDF/DOCX text extraction requires `markitdown[pdf,docx]` on the server. **Save / Share** gives a workspace a unique name and protects it from cleanup. Reopening edits the same workspace; **Duplicate** makes an independent copy.

Unsaved workspaces expire after 30 inactive days and are removed by least recent use above the default 1 GiB budget. Saved workspaces are protected. Configure those limits in `.env.example`. Back up `data/workspaces/` too if you want to retain saved inputs and results. Evaluation input never goes in the definition library.

## ChatGPT and MCP

In Settings, choose **Use current model as server default** for calls that omit a model. MCP/workspace runs use explicit run overrides, then workspace settings, then that default. They never switch providers automatically. ChatGPT uses server `.env` keys; browser keys stay in their browser.

The server exposes streamable HTTP at `http://127.0.0.1:4379/mcp`. To connect through the existing OpenAI Secure MCP Tunnel, keep `npm start` running and run this in another terminal:

```sh
npm run tunnel:install
npm run tunnel:doctor
npm run tunnel
```

The installer downloads the current official platform-specific client, verifies its SHA-256 digest, and puts it under ignored `data/bin/`; the global installation is unchanged. The launcher reads `OPENAI_TUNNEL_ID` from `.env`. `CONTROL_PLANE_API_KEY` is optional and otherwise uses `OPENAI_API_KEY`. It leaves existing tunnel profiles alone, disables raw request logging, and redacts credentials and the tunnel ID from its terminal output. Use a fixed `PORT` for the tunnel.

Widgets offer a combined workspace and linked input/questions/results cards. They share the same UUID and can Run directly without another ChatGPT model turn. File attachments can be handed directly to tools; ChatGPT Library's picker appears when that client supports it. Ordinary MCP tools work without widgets.

`npm run plugin:package` produces the private ChatGPT plugin archive under ignored `data/`, with the existing tunnel ID embedded in its MCP configuration. The tracked `plugins/jev-decisions/` package uses localhost for local MCP clients and includes the companion skill. No credentials or input files are packaged. See [ChatGPT setup, tool contracts, and manual acceptance](docs/chatgpt-app.md).

The server listens on localhost by default. For phone access, point your own Tailscale Serve setup at its printed address, or explicitly change `HOST` if you want a different listening interface.

Set `FRONTEND_BASE_URL` to your existing Tailscale Serve origin for workspace links usable on your phone. Secure MCP Tunnel transports tools and widget resources; it does not expose the web frontend.

Provider formats and source links are in [docs/api-reference.md](docs/api-reference.md).

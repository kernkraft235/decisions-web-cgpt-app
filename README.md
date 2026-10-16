# Decisions

A small dark mobile-friendly playground for llama.cpp System One, OpenRouter Decisions, and OpenAI Decisions.

```sh
npm install
npm start
```

Open the address printed on startup (normally `http://127.0.0.1:4379`). `npm run dev` runs the same server with Vite's development UI. `HOST` sets the listening address and `PORT` sets the port; both work in `.env` or the launching shell. Node 22+ is required.

All five supported environment settings are documented in [.env.example](.env.example): `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `CUSTOM_BASE_URL`, `HOST`, and `PORT`. Keys are optional; Settings can supply browser-stored overrides. `CUSTOM_BASE_URL` sets the default llama.cpp endpoint (include `/v1`); leave the browser URL blank to follow it. Server keys stay on the server, and no key is sent to the custom endpoint. Restart the server after `.env` changes. Existing shell variables take precedence.

Save questions individually, assemble any mix of types, and save whole sets. Server storage is `data/library.json`; back up that file to keep your library. Sets are snapshots. The current draft, selected set, provider settings, last text, and images are remembered in the browser. Clear input removes remembered text and images; choosing “None — empty set” clears the questions. The Library button deletes saved questions and sets.

The server listens on localhost by default. For phone access, point your own Tailscale Serve setup at its printed address, or explicitly change `HOST` if you want a different listening interface.

Provider formats and source links are in [docs/api-reference.md](docs/api-reference.md).

# Decisions

A small dark mobile-friendly playground for llama.cpp System One, OpenRouter Decisions, and OpenAI Decisions.

```sh
npm install
npm start
```

Open the loopback address printed on startup (normally `http://127.0.0.1:4379`). `npm run dev` runs the same server with Vite's development UI. Use `PORT=4380 npm start` to pick a specific port. Node 22+ is required.

`.env` supplies `OPENAI_API_KEY` and `OPENROUTER_API_KEY`. Either can be omitted; Settings accepts a key stored in the current browser. Server keys stay on the server. The local llama.cpp default needs no key.

Save questions individually, assemble any mix of types, and save whole sets. Server storage is `data/library.json`; back up that file to keep your library. Sets are snapshots. The current draft, selected set, provider settings, last text, and images are remembered in the browser. Clear input removes remembered text and images; choosing “None — empty set” clears the questions. The Library button deletes saved questions and sets.

The server listens only on localhost. For phone access, point your own Tailscale Serve setup at its printed address.

Provider formats and source links are in [docs/api-reference.md](docs/api-reference.md).

# localnotes

## 0.7.1

### Patch Changes

- 34b3eee: Improve import/export spacing and add collapsible sidebar and Knowledge Connections panels.
- 08ae81a: Add Raw, Edit + Preview, and Reading editor modes using the existing Markdown renderer.
- eb230c8: Add a durable saved-note count and animated, non-blocking save status.

## 0.7.0

### Minor Changes

- 0f6d9ef: Import Markdown files as notes: pick a single `.md`/`.markdown` file, several at once, or a whole folder from the sidebar. Each file becomes a new note titled after its filename, with the file body as content; non-Markdown files in folder picks are skipped and reported.

## 0.6.0

### Minor Changes

- 00eddb5: Surface note persistence failures with per-note pending/failed state, an accessible banner, and retry/discard recovery, so a failed IndexedDB write can no longer look saved. Same-ID imports now preview conflicts and require an explicit keep/replace/import-as-copy choice, with archive version and duplicate-ID validation. Benchmark and bound knowledge-graph work with a reproducible lane, a documented 200-note responsiveness budget, and behavior-preserving precomputation. Refresh the roadmap, M3 plan, and README for current features and network behavior, and add a real-browser Playwright lane covering the packed MV3 extension, optional host permissions, an OpenAI-compatible streaming/tool-call contract, MiniLM download/fallback/caching, and keyboard/focus smoke paths.

## 0.5.0

### Minor Changes

- b9b20cb: M4 slice 2 — attribution and affordances: every agent tool call (provider, tool, args, tier, outcome, duration) lands in a bounded local audit log (500 entries, newest-first, clearable) viewable from the chat drawer; the remote agent's model field offers suggestions fetched from the endpoint's /models (free text still works when it doesn't implement it); and the outbound badge now names the destination host with the full base URL on hover, so what leaves the device — and where — is always explicit.

## 0.4.0

### Minor Changes

- b6f28be: Remote agents: an OpenAI-compatible provider streams from any chat-completions endpoint (Ollama, LM Studio, vLLM, OpenAI) with tool-call support; the runtime feeds tool results back across up to four rounds until the model answers without tools. Provider settings (base URL, model, API key) persist in the settings store behind the chat drawer's panel, and endpoint access stays off until the host permission is granted explicitly. Default endpoint is the local Ollama at http://localhost:11434/v1 with model qwen3:30b-a3b.

## 0.3.0

### Minor Changes

- 14c9666: Agent chat becomes useful: five read-only tools (notes.search, notes.read, notes.recent, graph.connections, graph.similar) execute against the vault with schema-validated arguments; tool calls render as collapsible transcripts; context chips (Current note / Selection / Recent notes / Graph neighborhood) make exactly what the agent receives explicit and removable. The mock agent now runs real vault searches.

## 0.2.1

### Patch Changes

- 7f05cc1: Release packaging fix: the extension zip is now built with adm-zip via node instead of the zip binary, which the self-hosted runner does not carry. No app behavior changes.

## 0.2.0

### Minor Changes

- 4851bb8: Agent chat overlay (Cmd+J) with an offline mock provider: streaming markdown responses in a right-side drawer, an agent selector with a local/remote badge, and stop/retry controls. Real providers and read-only note tools follow in the next slices.

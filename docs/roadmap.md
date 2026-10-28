# Local Notes — Roadmap: from toy app to secure agentic notes

Audience: engineers and scholars. Product promise: **local-first, private, extensible, agentic**.
This plan covers the next phase of work across four tracks — security, storage foundations,
UI, agentic features, extensibility — in dependency order.

## Where we are today

**Solid:** minimal MV3 manifest (no permissions, new-tab override only), CSP locked down
(`wasm-unsafe-eval` only, required by ONNX Runtime), no backend, knowledge graph work is
well-factored pure functions with tests, embeddings run in-browser with a deterministic
local fallback.

**Structural risks (all fixable now, expensive to fix later):**

1. **`localStorage` is the ceiling.** The whole notes array is JSON-serialized on every
   keystroke (`useNotes.persist`), the embedding cache stores 384-dim float arrays as JSON
   text under the same ~5 MB quota, there is no schema versioning, and no export/import —
   one corrupted key or an evicted extension profile loses everything.
2. **Markdown URL sanitization is disabled.** `MarkdownRenderer.tsx` passes
   `urlTransform={(url) => url}`, which bypasses react-markdown's default protocol filter —
   a `[link](javascript:...)` in pasted content renders clickable in an extension page.
3. **~1.5k lines of knowledge-graph work is uncommitted on `main`** — it should land (or be
   split into reviewable PRs) before anything builds on top of it.
4. No CI (lint is `tsc --noEmit` only, no ESLint), no command palette / search, no settings
   system — all prerequisites for the agentic phase.

---

## Phase 0 — Foundations (do first, ~1–2 weeks)

Everything else in this plan depends on these.

### 0.1 Security hardening
- **Fix URL sanitization** in `MarkdownRenderer`: custom `urlTransform` that allows
  `http:`, `https:`, `mailto:`, `#`, relative URLs, and our internal `wikilink:`/`tag:`
  schemes; reject everything else. External links get `target="_blank"` +
  `rel="noopener noreferrer"`.
- **Threat-model doc** (`docs/threat-model.md`): what "secure" means here — local data,
  pasted markdown as untrusted input, future LLM egress as untrusted output. Keep it short;
  every later feature links to it.
- **Model provenance:** `@huggingface/transformers` currently fetches MiniLM from
  huggingface.co at first run (`env.allowLocalModels = false`). No note text leaves the
  machine, but decide explicitly: bundle the ~17 MB q8 model in the extension (offline
  guarantee, bigger package) vs. first-run opt-in download. Recommend bundling — the README
  promises "never in the cloud".
- **CI:** GitHub Actions running `tsc --noEmit`, `vitest run`, `vite build` on PRs; add
  ESLint (typescript-eslint + react hooks rules). Dependabot is already active.

### 0.2 Storage migration: `NotesRepository`
Introduce a repository layer and move persistence off `localStorage`:

```ts
interface NotesRepository {
  getAll(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  upsert(note: Note): Promise<void>;      // per-note write, not whole-array rewrite
  delete(id: string): Promise<void>;
  search(query: string): Promise<Note[]>; // future: FTS
}
```

- Backed by **IndexedDB** (stores: `notes`, `embeddings` as `Float32Array`, `settings`,
  `meta` with a schema version + migration runner). localStorage is read once as a
  one-time migration source, then cleared.
- **Export/import** (JSON archive + per-note Markdown) as the data escape hatch — ship with
  the migration, not after. This is the single highest-value data-safety feature.
- Every downstream consumer (`useNotes`, `useNoteEmbeddings`, graph builders) goes through
  the repository; no component touches storage directly. This interface is also what the
  future plugin/agent layer will be given.

---

## Phase 1 — UI

### 1.1 Command palette (Cmd+K) — highest priority
There is currently no way to search notes. A command palette fixes that and becomes the
future agent entry point: fuzzy note search + actions (new note, toggle graph, reindex,
open settings) in one component. Keep it dumb in Phase 1; the agent lives behind it later.

### 1.2 App-shell refactor
`App.tsx` is becoming a god component (view switching, graph focus, delete flow, shortcuts).
- Extract a `useKeyboardShortcuts` hook and a small view state (editor | graph | split).
- Chat overlay (Phase 2) will be a global layer over any view — reserve the slot now.
- `KnowledgeGraphView.tsx` (579 lines) should own only rendering; layout/interaction
  helpers move next to `computeForceLayout`.

### 1.3 Editor & presentation
- Dark mode (`prefers-color-scheme` + manual toggle, stored in settings).
- Focus/zen mode; typographer-friendly editor typography (scholars write long-form).
- Keep desktop-first; mobile stays out of scope.

### 1.4 Accessibility pass
- Roving tabindex + `listbox`/`option` roles in the note list; focus trap and focus
  restore in `DeleteDialog` and future modals.
- `aria-live` for embedding status ("indexing notes…").
- `prefers-reduced-motion` → static layout for the force graph.

---

## Phase 2 — Agentic core

### 2.1 UX: chat overlay + agent selector
- **Cmd+J** (or palette action) opens a **right-side drawer overlay** over any view — the
  note stays visible beside the conversation, which matters for "chat about this note".
- **Agent selector** at the top of the drawer: a dropdown of registered *agent providers*
  (see 2.2) with model + capability summary. Switching mid-conversation starts a new
  session (keep it simple).
- **Context chips** above the input: `Current note`, `Selection`, `Recent notes`,
  `Graph neighborhood`. Chips control what gets attached — visible, removable, never
  implicit wholesale attachment of the vault.
- Responses render with the existing `MarkdownRenderer` (wikilinks clickable — an agent
  answer becomes part of the graph). Tool calls render as a collapsible transcript
  ("searched notes for X (3 results)").
- Streaming responses; stop button; retry.

### 2.2 Architecture

```
ChatOverlay (UI only)
   │
AgentSession ── messages, streaming, tool-call loop
   │                     │
AgentProvider(s)        ToolRegistry
   │                     │
(openai-compatible,     tools implement
 anthropic, mock,       NotesRepository +
  [later] webgpu-local) GraphAPI — nothing else
```

- **`AgentProvider`** interface: `{ id, label, describe(), stream(messages, tools) }`.
  Ship a **mock provider** (canned responses) first so the UI is testable without keys or
  network, then an **OpenAI-compatible** provider (one implementation covers OpenAI,
  Ollama, LM Studio, vLLM — good local story), then Anthropic.
- **`AgentRuntime`** owns the tool loop: model requests a tool → runtime validates args →
  executes against `NotesRepository`/graph APIs → returns result. The model never receives
  direct references to storage.
- **Settings store** (IndexedDB `settings`): provider endpoints, API keys, default agent,
  similarity threshold, theme. Keys never leave the machine and never sync.

### 2.3 Tools and permission tiers
Every tool declares a tier; the UI shows the tier before an agent runs.

| Tier | Grant | Tools |
|------|-------|-------|
| 0 — read | automatic | `notes.search`, `notes.read`, `notes.recent`, `graph.connections`, `graph.similar` |
| 1 — draft | per-session toggle | `notes.proposeEdit` (renders a diff; user clicks Apply), `notes.insertAtCursor` |
| 2 — write | confirm every action | `notes.create`, `notes.delete`, `web.fetch` (only URLs the user supplied in chat) |

Tier 1 is the key design decision: **agents propose diffs, humans apply them.** The diff
preview reuses the Phase 0 repository's per-note version snapshots (keep last N revisions
per note — cheap in IndexedDB, and it gives undo for agent edits).

### 2.4 Agent security model
- **Explicit egress only:** the runtime only calls the endpoint configured for the active
  provider. No telemetry, no "phone home", ever. A small indicator in the chat header shows
  whether the active agent is local (Ollama/mock) or remote.
- **Prompt-injection defense:** note content is *data*, never instructions — delimited
  context blocks, system prompt states it explicitly, tool args validated against schemas,
  and destructive actions stay behind Tier 2 confirmation regardless of what the model
  claims. A malicious paragraph pasted into a note must not be able to escalate.
- **Local audit log:** every tool call (agent, tool, args, tier, outcome) appended to an
  IndexedDB store, browsable in settings. Cheap, and it makes agent actions reviewable.
- **Keys** stored in the settings store / `chrome.storage.local` (never `storage.sync`).
- **Manifest:** when provider endpoints become user-configurable, use MV3
  `optional_host_permissions` so users grant network access per provider at setup, keeping
  the install-time permission list empty.

### 2.5 Sequencing within Phase 2
1. **A — Shell:** ChatOverlay UI, session state, mock provider, streaming markdown. No tools.
2. **B — Read-only:** Tier 0 tools + context chips + tool transcript.
3. **C — Providers:** OpenAI-compatible + Anthropic + settings UI + egress indicator.
4. **D — Drafts:** Tier 1 diff/apply + note revisions; then Tier 2 with confirmation.
5. **E — Skills** (later): one-shot commands surfaced in the palette — "summarize selection",
   "find related notes", "surface contradictions", "make flashcards". Skills are just
   prompt + tool presets, so they arrive cheap once C/D exist.

---

## Phase 3 — Extensibility

- **Provider registry as the plugin seam.** Agents, embedders, and (later) renderers all
  register through typed interfaces. `setCustomEmbedder` in `embeddings.ts` is the seed of
  this pattern — formalize it as `EmbeddingProvider`.
- **Plugin surface v1 (code-level):** anything importable that implements
  `AgentProvider`, `EmbeddingProvider`, or contributes graph edge kinds / markdown
  extensions / palette commands. Keep the registry typed and versioned.
- **Plugin surface v2 (declarative, later):** manifest-declared plugins loaded through a
  message-passing bridge — no direct access to storage, DOM, or `chrome.*`; capabilities
  enumerated in the manifest and shown to the user at install. Design the bridge when at
  least two real v1 plugins exist; don't spec it earlier.
- **Settings UI** from Phase 2C grows into the extension's control panel (providers,
  data/export, thresholds, theme, audit log).

---

## Deliberately deferred / open questions

- **Encryption at rest** (passphrase → WebCrypto AES-GCM, per-vault lock). Valuable for
  the "secure" pitch but real UX cost and it complicates embeddings + agent reads. Decide
  after Phase 2D; needs the threat model to say who the adversary is (device thief vs.
  cloud vs. malware).
- **In-browser LLM** (WebGPU, e.g. a small quantized model): technically possible, heavy.
  Ollama/LM Studio via the OpenAI-compatible provider delivers "local agent" sooner.
- **Sync/multi-device:** out of scope until there's a storage format worth syncing.
- **Mobile layout:** stays out of scope per MVP decision.

## Suggested milestone order

| Milestone | Ships |
|-----------|-------|
| M0 | URL sanitization fix, threat model, CI/ESLint, land graph PRs |
| M1 | NotesRepository (IndexedDB) + export/import + revisions |
| M2 | Command palette, dark mode, a11y pass, app-shell refactor |
| M3 | Chat overlay + mock agent + Tier 0 tools (2A+2B) |
| M4 | Providers + settings + audit log (2C) |
| M5 | Diff/apply + note revisions surfaced + Tier 2 (2D) |
| M6 | Skills in palette; provider registry opened for embedders (2E/3) |

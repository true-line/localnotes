# Local Notes — Roadmap: from toy app to secure agentic notes

Audience: engineers and scholars. Product promise: **local-first, private, extensible, agentic**.
This plan covers the next phase of work across four tracks — security, storage foundations,
UI, agentic features, extensibility — in dependency order.

> **Status snapshot (2026-11-07).** Phases 0–2C below have largely shipped (v0.5.0): the
> URL-sanitization fix, threat model, CI, the IndexedDB `NotesRepository` with
> export/import and revisions, the command palette, dark mode, the chat overlay with mock
> and OpenAI-compatible providers, tier-0 tools, and the agent audit log. The sections
> beneath this note describe the pre-M0 baseline and are preserved as the historical
> record — inline **Status:** annotations mark what has shipped since, and remaining work
> links to its open tracking issue.

## Where we are today

**Solid:** minimal MV3 manifest (new-tab override only; `optional_host_permissions` were
added later for per-provider egress — nothing is granted at install time), CSP locked down
(`wasm-unsafe-eval` only, required by ONNX Runtime), no backend, knowledge graph work is
well-factored pure functions with tests, embeddings run in-browser with a deterministic
local fallback.

**Structural risks (all fixable now, expensive to fix later):**

1. **`localStorage` is the ceiling.** The whole notes array is JSON-serialized on every
   keystroke (`useNotes.persist`), the embedding cache stores 384-dim float arrays as JSON
   text under the same ~5 MB quota, there is no schema versioning, and no export/import —
   one corrupted key or an evicted extension profile loses everything.
   **Status: shipped (M1).** `src/storage.ts` is now an IndexedDB-backed `NotesRepository`
   with per-note writes, schema versioning, bounded per-note revisions (last 20), a
   settings store, and JSON export/import; `localStorage` is read exactly once as a
   migration source and never written. Hardening follow-ups: surfacing write failures
   ([#69](https://github.com/true-line/localnotes/issues/69)) and import conflict
   resolution ([#70](https://github.com/true-line/localnotes/issues/70)).
2. **Markdown URL sanitization is disabled.** `MarkdownRenderer.tsx` passes
   `urlTransform={(url) => url}`, which bypasses react-markdown's default protocol filter —
   a `[link](javascript:...)` in pasted content renders clickable in an extension page.
   **Status: fixed (M0).** Every rendered URL now goes through the allowlist
   `sanitizeMarkdownUrl` (`http`/`https`/`mailto`/`tel`, relative/fragment references, and
   the internal `wikilink:`/`tag:` schemes; everything else renders inert), and external
   links open with `target="_blank" rel="noopener noreferrer"`.
3. **~1.5k lines of knowledge-graph work is uncommitted on `main`** — it should land (or be
   split into reviewable PRs) before anything builds on top of it.
   **Status: resolved.** The knowledge-graph code landed with tests
   (`src/knowledgeGraph.ts`, `src/__tests__/knowledgeGraph.test.ts`).
4. No CI (lint is `tsc --noEmit` only, no ESLint), no command palette / search, no settings
   system — all prerequisites for the agentic phase.
   **Status: shipped.** CI runs ESLint + `tsc --noEmit`, Vitest, and `vite build` on PRs,
   plus CodeQL and actionlint lanes (`.github/workflows/ci.yml`), and a changesets pipeline
   publishes packed-extension releases. The command palette (Cmd/Ctrl+K) ships with fuzzy
   full-body search, and an IndexedDB settings store backs theme and agent-provider
   settings. Remaining: real-browser extension tests
   ([#73](https://github.com/true-line/localnotes/issues/73)) and knowledge-graph
   performance benchmarks ([#71](https://github.com/true-line/localnotes/issues/71)).

---

## Phase 0 — Foundations (do first, ~1–2 weeks)

**Status: shipped**, except bundling the embedding-model weights (still a first-run
download; see "Model provenance" in [threat-model.md](threat-model.md)).

Everything else in this plan depends on these.

### 0.1 Security hardening
- **Fix URL sanitization** in `MarkdownRenderer`: custom `urlTransform` that allows
  `http:`, `https:`, `mailto:`, `#`, relative URLs, and our internal `wikilink:`/`tag:`
  schemes; reject everything else. External links get `target="_blank"` +
  `rel="noopener noreferrer"`.
  **Status: shipped** as described, plus `tel:` in the allowlist.
- **Threat-model doc** (`docs/threat-model.md`): what "secure" means here — local data,
  pasted markdown as untrusted input, future LLM egress as untrusted output. Keep it short;
  every later feature links to it.
  **Status: shipped** — [threat-model.md](threat-model.md).
- **Model provenance:** `@huggingface/transformers` currently fetches MiniLM from
  huggingface.co at first run (`env.allowLocalModels = false`). No note text leaves the
  machine, but decide explicitly: bundle the ~17 MB q8 model in the extension (offline
  guarantee, bigger package) vs. first-run opt-in download. Recommend bundling — the README
  promises "never in the cloud".
  **Status: decided — first-run download, declared as deliberate egress.** The q8 weights
  (~23 MB) are fetched from the Hugging Face hub on the first indexing run and cached by
  the browser; offline, embeddings fall back to the deterministic local estimator. The
  threat model and README document this. Bundling the weights into the extension remains
  an open M0 follow-up.
- **CI:** GitHub Actions running `tsc --noEmit`, `vitest run`, `vite build` on PRs; add
  ESLint (typescript-eslint + react hooks rules). Dependabot is already active.
  **Status: shipped** — see `.github/workflows/` (CI, CodeQL, version-cut, release).

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

**Status: shipped (M1).** The shipped interface differs in shape from the sketch above —
see `NotesRepository` in `src/storage.ts` (per-note writes, revision snapshots, settings,
embeddings, and the agent audit store; schema v2). JSON export/import shipped (merge-by-id
import); per-note Markdown export did not. Follow-ups: write-failure surfacing
([#69](https://github.com/true-line/localnotes/issues/69)), import conflict resolution and
archive-version validation ([#70](https://github.com/true-line/localnotes/issues/70)).

---

## Phase 1 — UI

**Status: mostly shipped** — palette, app-shell refactor, and dark mode landed; the
remainder is tracked in [#38](https://github.com/true-line/localnotes/issues/38).

### 1.1 Command palette (Cmd+K) — highest priority
There is currently no way to search notes. A command palette fixes that and becomes the
future agent entry point: fuzzy note search + actions (new note, toggle graph, reindex,
open settings) in one component. Keep it dumb in Phase 1; the agent lives behind it later.

**Status: shipped.** `CommandPalette.tsx` does fuzzy full-body search (`fuzzyScore` in
`src/fuzzyMatch.ts`) plus actions: new note, toggle graph, theme switching, JSON export,
and embedding re-index. It remains read-only; agent skills arrive via M6
([#42](https://github.com/true-line/localnotes/issues/42)).

### 1.2 App-shell refactor
`App.tsx` is becoming a god component (view switching, graph focus, delete flow, shortcuts).
- Extract a `useKeyboardShortcuts` hook and a small view state (editor | graph | split).
- Chat overlay (Phase 2) will be a global layer over any view — reserve the slot now.
- `KnowledgeGraphView.tsx` (579 lines) should own only rendering; layout/interaction
  helpers move next to `computeForceLayout`.

**Status: shipped** — `useKeyboardShortcuts` exists (`src/hooks/useKeyboardShortcuts.ts`)
and the chat overlay is a global layer. The view state is still editor | graph (no split
view); see [#38](https://github.com/true-line/localnotes/issues/38).

### 1.3 Editor & presentation
- Dark mode (`prefers-color-scheme` + manual toggle, stored in settings).
- Focus/zen mode; typographer-friendly editor typography (scholars write long-form).
- Keep desktop-first; mobile stays out of scope.

**Status: dark mode shipped** (system/light/dark, persisted in the settings store, via
`useTheme`). Focus/zen mode and long-form typography remain open
([#38](https://github.com/true-line/localnotes/issues/38)).

### 1.4 Accessibility pass
- Roving tabindex + `listbox`/`option` roles in the note list; focus trap and focus
  restore in `DeleteDialog` and future modals.
- `aria-live` for embedding status ("indexing notes…").
- `prefers-reduced-motion` → static layout for the force graph.

**Status: partially shipped** — `role="status"` embedding status, the note list's
`listbox`/`option` roles, the palette's `aria-activedescendant` combobox, and an app-wide
`prefers-reduced-motion` rule all exist. Still open: roving tabindex in the note list and
focus trap/restore in `DeleteDialog`
([#38](https://github.com/true-line/localnotes/issues/38)).

---

## Phase 2 — Agentic core

**Status: steps A–C shipped** (chat overlay + mock provider in v0.2.0, tier-0 tools and
context chips in v0.3.0, OpenAI-compatible provider + settings in v0.4.0, audit log +
egress affordances in v0.5.0). Anthropic provider
([#40](https://github.com/true-line/localnotes/issues/40)), draft/write tiers
([#41](https://github.com/true-line/localnotes/issues/41)), and skills
([#42](https://github.com/true-line/localnotes/issues/42)) remain open.

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

**Status: shipped as specified** (v0.2.0 + v0.3.0).

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

**Status: shipped except the Anthropic provider**
([#40](https://github.com/true-line/localnotes/issues/40)). As built, tools execute
against a read-only `ToolContext` facade rather than the repository itself, and the runtime
feeds tool results back for up to four rounds (`src/agent/runtime.ts`).

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

**Status: tier 0 shipped** (v0.3.0, with schema-validated arguments); the revision store
the diff preview depends on also shipped (M1). Tiers 1–2 remain open
([#41](https://github.com/true-line/localnotes/issues/41)).

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

**Status: shipped** (v0.4.0 + v0.5.0). As built: the egress badge names the destination
host (full base URL on hover); the audit log is bounded at 500 entries and is browsable and
clearable from the chat drawer rather than a settings page; keys live in the IndexedDB
settings store (not `chrome.storage.local`); and the chat's provider panel offers a
per-origin grant through `chrome.permissions.request` against the manifest's
`optional_host_permissions`. Tier-2 confirmation awaits
[#41](https://github.com/true-line/localnotes/issues/41).

### 2.5 Sequencing within Phase 2
1. **A — Shell:** ChatOverlay UI, session state, mock provider, streaming markdown. No tools.
2. **B — Read-only:** Tier 0 tools + context chips + tool transcript.
3. **C — Providers:** OpenAI-compatible + Anthropic + settings UI + egress indicator.
4. **D — Drafts:** Tier 1 diff/apply + note revisions; then Tier 2 with confirmation.
5. **E — Skills** (later): one-shot commands surfaced in the palette — "summarize selection",
   "find related notes", "surface contradictions", "make flashcards". Skills are just
   prompt + tool presets, so they arrive cheap once C/D exist.

**Status:** A and B shipped (v0.2.0, v0.3.0); C shipped except Anthropic
([#40](https://github.com/true-line/localnotes/issues/40)); D open
([#41](https://github.com/true-line/localnotes/issues/41)); E open
([#42](https://github.com/true-line/localnotes/issues/42)).

---

## Phase 3 — Extensibility

**Status: open** — tracked in [#42](https://github.com/true-line/localnotes/issues/42).

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

| Milestone | Ships | Status (2026-11-07) |
|-----------|-------|---------------------|
| M0 | URL sanitization fix, threat model, CI/ESLint, land graph PRs | Shipped — model-weight bundling still open |
| M1 | NotesRepository (IndexedDB) + export/import + revisions | Shipped — hardening follow-ups [#69](https://github.com/true-line/localnotes/issues/69), [#70](https://github.com/true-line/localnotes/issues/70) |
| M2 | Command palette, dark mode, a11y pass, app-shell refactor | Mostly shipped — remainder in [#38](https://github.com/true-line/localnotes/issues/38) |
| M3 | Chat overlay + mock agent + Tier 0 tools (2A+2B) | Shipped (v0.2.0, v0.3.0) |
| M4 | Providers + settings + audit log (2C) | Mostly shipped (v0.4.0, v0.5.0) — Anthropic provider in [#40](https://github.com/true-line/localnotes/issues/40) |
| M5 | Diff/apply + note revisions surfaced + Tier 2 (2D) | Open — [#41](https://github.com/true-line/localnotes/issues/41) |
| M6 | Skills in palette; provider registry opened for embedders (2E/3) | Open — [#42](https://github.com/true-line/localnotes/issues/42) |

Cross-cutting follow-ups outside the milestone sequence: knowledge-graph performance
benchmarks ([#71](https://github.com/true-line/localnotes/issues/71)), real-browser
extension and provider contract tests
([#73](https://github.com/true-line/localnotes/issues/73)), and this documentation
refresh ([#72](https://github.com/true-line/localnotes/issues/72)).

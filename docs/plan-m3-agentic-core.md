# M3 Implementation Plan — Agentic core (chat overlay, agent selector, mock provider, tier-0 tools)

Implements [#39](https://github.com/true-line/localnotes/issues/39) per
[docs/roadmap.md](roadmap.md) Phase 2 steps A+B. Shipped as **two PRs** (A: provider core
+ chat UI; B: tools + context chips) so review stays tractable.

## 0. Implementation status (2026-10-29)

**PR A shipped** (#50): runtime, registry, mock provider, session hook, ChatOverlay
(Cmd+J), shortcuts — with review-round amendments beyond this plan: wikilinks in replies
navigate find-or-create, Escape layering centralized (palette > chat > delete dialog),
palette blocks chat focus-stealing, retry control exposed via `canRetry`.

**Drift vs this plan:** the mock provider does not yet emit `tool-call` events — the
tool-execution demo (§6) lands with PR B's tools, not before. Tool loop in the runtime
is already live and tested (§8 runtime tests), so PR B is additive.

**Also shipped post-plan:** the changesets release pipeline (v0.2.1 published) — M3 PRs
now carry changesets per repo convention.

## 1. Goal and guardrails

A chat drawer usable **on any view**, with an **agent selector**, **streaming** markdown
responses, and **read-only** tools — fully functional offline through a **mock provider**.
No API keys, no network egress, no write capability, no transcript persistence in M3
(those arrive with M4's providers and audit log).

Invariants from [threat-model.md](threat-model.md) that this plan must preserve:

- Read-only tool surface only (tier 0). No code path exists that mutates notes.
- Context attachments are explicit and removable — never an implicit whole-vault send.
- Tool arguments are validated against a schema before execution, regardless of provider.
- Model output renders through the existing sanitized `MarkdownRenderer`.
- The mock provider is `localOnly`; the UI shows a local/remote indicator from day one.

## 2. Architecture

```
App.tsx
  ├─ useAgentSession ──── React state over AgentRuntime
  │     └─ AgentRuntime (src/agent/runtime.ts)
  │          ├─ AgentProvider (registry: mock now, real ones in M4)
  │          └─ ToolRegistry (tier-0 tools over a read-only facade)
  └─ ChatOverlay (UI only: drawer, selector, transcript, chips, composer)
```

Data flow for one turn: user submits text (+ attached context chips) → runtime appends a
user message with delimited context blocks → `provider.stream()` yields `StreamEvent`s →
on `tool-call`, runtime validates args against the tool's JSON schema, executes it, feeds
the `tool-result` back → text deltas accumulate on the assistant message → `done`/`error`
settles the turn. An `AbortController` powers the stop button.

## 3. Core interfaces (src/agent/types.ts)

```ts
export interface ToolCall { id: string; name: string; args: Record<string, unknown>; }
export interface ToolResult { callId: string; ok: boolean; content: string; }

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];   // assistant messages that request tools
  toolCallId?: string;      // tool-role results
}

export type StreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; result: ToolResult }
  | { type: 'done'; reason: 'end' | 'stop' | 'error' }
  | { type: 'error'; error: string };

export interface StreamOptions { tools: AgentTool[]; signal: AbortSignal; }

export interface AgentProvider {
  id: string;
  label: string;
  description: string;
  /** True when the provider cannot send data off-device (drives the badge). */
  localOnly: boolean;
  stream(messages: AgentMessage[], options: StreamOptions): AsyncIterable<StreamEvent>;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;   // JSON Schema, draft 2020-12 subset
  tier: 0 | 1 | 2;                        // M3 ships tier 0 only
  execute(args: Record<string, unknown>): Promise<{ ok: boolean; content: string }>;
}

export interface ContextAttachment {
  id: 'current-note' | 'selection' | 'recent-notes' | 'graph-neighborhood';
  label: string;
  content: string;   // delimited block included in the user turn
}
```

## 4. File-by-file plan

### New — PR A (agent core + chat UI)

| File | Contents |
|---|---|
| `src/agent/types.ts` | Interfaces above |
| `src/agent/registry.ts` | Ordered provider list; `getProviders()`, `getProvider(id)` |
| `src/agent/providers/mock.ts` | Canned, deterministic streaming provider |
| `src/agent/runtime.ts` | Turn loop, abort, message bookkeeping (framework-free class) |
| `src/agent/useAgentSession.ts` | React binding: messages, `isStreaming`, `send`, `stop`, `retry`, `clear`, provider selection |
| `src/components/ChatOverlay.tsx` + `src/styles/ChatOverlay.css` | Drawer UI |
| `src/__tests__/agent/runtime.test.ts`, `mock.test.ts`, `useAgentSession.test.ts` | See §8 |
| `.changeset/*.md` | minor: agent chat overlay with mock provider |

### New — PR B (tools + context chips)

| File | Contents |
|---|---|
| `src/agent/tools.ts` | Tier-0 `AgentTool` definitions over `ToolContext` |
| `src/agent/toolSchema.ts` | Minimal JSON-Schema validator (type/properties/required/enum — no deps) |
| `src/components/ToolTranscript.tsx` | Collapsible `<details>` rendering of calls/results |
| `src/__tests__/agent/tools.test.ts`, `toolSchema.test.ts` | See §8 |
| Changeset | minor: read-only agent tools and context chips |

### Modified

- `src/App.tsx` — chat open state, `onToggleChat`, render `<ChatOverlay>`, build `ToolContext`.
- `src/hooks/useKeyboardShortcuts.ts` — add Cmd/Ctrl+J (`onToggleChat`).
- `src/components/NoteEditor.tsx` — report selection changes (debounced `onSelectionChange`)
  so the Selection chip has content; empty selection disables the chip.
- `README.md` — short "Agent chat (mock)" note.

## 5. Tool specifications (tier 0, read-only)

Tools receive a `ToolContext` built in `App.tsx` from existing primitives — never the
repository's mutation methods:

```ts
interface ToolContext {
  searchNotes(query: string, limit?: number): Note[];          // fuzzyScore over title+content
  getNote(id: string): Note | null;
  recentNotes(limit?: number): Note[];                          // by updatedAt
  connectionsFor(id: string): NoteConnections | null;           // getNoteConnections()
  similarFor(id: string, limit?: number): SemanticNoteEntry[];  // connections.semanticNotes
}
```

| Tool | Args (schema) | Source |
|---|---|---|
| `notes.search` | `{ query: string, limit?: int 1–20 }` | `fuzzyScore` over title+content, top-N with id/title/excerpt |
| `notes.read` | `{ id: string }` | repository/getAllNotes lookup; full title + content |
| `notes.recent` | `{ limit?: int 1–20 }` | sorted notes |
| `graph.connections` | `{ id: string }` | `getNoteConnections` (backlinks, links, shared concepts) |
| `graph.similar` | `{ id: string, limit?: int 1–10 }` | `semanticNotes` from embeddings |

Tool results are truncated defensively (content excerpts capped) so a huge note cannot
flood the context window.

## 6. Mock provider behavior

- `id: 'mock'`, `label: 'Local Mock (offline)'`, `localOnly: true`.
- Streams its reply in small chunks with short delays (cancellable mid-stream).
- Reply logic: if the last user turn mentions a note title it can resolve via
  `notes.search`, it emits a genuine `tool-call` for `notes.search` then summarizes the
  *real* results — the model is fake, the data is real, and the transcript demo is honest.
- Otherwise it echoes a deterministic, clearly-labeled canned reply that lists the
  attached context chips, so users can see exactly what would be sent to a real provider.

## 7. UX spec

- **Drawer**: fixed right panel (~400px) over the main column; notes list stays visible;
  works over editor *and* graph views. Cmd/Ctrl+J toggles; Escape closes (layering rules
  like the palette; does not dismiss the delete dialog underneath).
- **Header**: agent selector (native `<select>` — accessible, zero deps) with the
  local/remote badge; clear-conversation button; close button.
- **Transcript**: user messages as plain bubbles; assistant messages via
  `MarkdownRenderer` (sanitized URLs, clickable wikilinks); tool calls as
  `<details>` with name, pretty-printed args, and result preview; `aria-live="polite"`
  on the transcript while streaming.
- **Composer**: auto-growing textarea; Enter sends, Shift+Enter newlines; Send becomes
  Stop while streaming; Retry re-sends the last failed/stopped turn.
- **Context chips**: four toggles above the composer; active chips render as removable
  pills; chip content is shown (truncated) on hover so "what will be sent" is never
  implicit. Chips snapshot at send time.
- **A11y**: drawer is `role="complementary"` `aria-label="Agent chat"`; focus moves into
  the composer on open and restores on close (same pattern as the palette).

## 8. Testing plan

- `runtime.test.ts` — turn assembly with/without attachments; tool-call → execute →
  tool-result loop; schema-validation rejection surfaces as `tool-result ok:false`;
  abort mid-stream settles with `reason: 'stop'`.
- `mock.test.ts` — deterministic chunk order, tool-call trigger path, stop.
- `toolSchema.test.ts` — accepts valid args; rejects missing/extra/mistyped fields.
- `tools.test.ts` — each tool against a seeded repository (existing `fake-indexeddb`
  setup): search relevance, read miss, recents order, connections/similar shapes.
- `useAgentSession.test.ts` / `ChatOverlay.test.tsx` — send/stop/retry wiring, provider
  switch mid-session starts a fresh session, chips snapshot into the sent message,
  transcript renders markdown + collapsible tool entries.
- `App.test.tsx` — Cmd+J toggles the drawer over editor and graph views.

## 9. Sequencing and risks

**PR A** (core + UI): types, registry, runtime, mock, session hook, overlay, shortcuts,
changeset. **PR B** (tools + chips): toolSchema, tools, transcript UI, chips, selection
wiring, changeset.

Risks / open questions (defaults chosen, cheap to flip):

1. **Selection chip** needs editor selection state — implemented as a debounced
   `onSelectionChange` from `NoteEditor`; if it proves noisy, chip falls back to
   disabled-with-tooltip in PR B.
2. **Transcript persistence** is intentionally absent in M3; M4's audit log decides the
   real storage story. Closing the drawer clears nothing; reloading does.
3. **Tool schema validator** is intentionally minimal (no dependency); if M4's real
   providers need richer schemas, swap in a library behind `toolSchema.ts`'s interface.
4. **Streaming markdown** re-renders per delta — debounce re-render to ~30ms if profiling
   shows jank with long replies; transcript window is capped (last N=50 messages).

# localnotes

A fast, private, local-first notes app that runs entirely in your browser as a
Chromium MV3 extension (new-tab override). Notes live in IndexedDB on your device —
no accounts, no backend, no cloud sync. Built with Vite + React 18 + TypeScript.

## Features

- **Markdown notes** with an edit/preview toggle, KaTeX math, `[[wikilinks]]` that
  open an existing note or offer to create it, and `#tags`.
- **Command palette** (Cmd/Ctrl+K): fuzzy search across note titles and bodies, plus
  actions — new note, toggle graph, switch theme, export, re-index embeddings.
- **Knowledge graph** (Cmd/Ctrl+G): a force-directed view of wikilinks, tags, shared
  concepts, and semantic similarity computed from in-browser embeddings.
- **Agent chat** (Cmd/Ctrl+J): a streaming chat drawer over any view, with explicit,
  removable context chips (current note, selection, recent notes, graph neighborhood),
  a collapsible tool-call transcript, and read-only tools (`notes.search`,
  `notes.read`, `notes.recent`, `graph.connections`, `graph.similar`). Ships with an
  offline mock provider; an OpenAI-compatible provider covers Ollama, LM Studio,
  vLLM, and OpenAI.
- **Dark mode**: follows the system by default; manual light/dark toggle from the
  palette, persisted in settings.
- **Data safety**: per-note IndexedDB writes with schema versioning and bounded
  per-note revision snapshots (last 20). From the sidebar: export/import the whole
  vault as a JSON archive (same-ID conflicts get an explicit resolution preview),
  or import Markdown — a single `.md` file, several at once, or a whole folder;
  each file becomes a new note titled after its filename.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Cmd/Ctrl+N | New note |
| Cmd/Ctrl+K | Command palette / search |
| Cmd/Ctrl+G | Toggle knowledge graph |
| Cmd/Ctrl+J | Toggle agent chat |
| Escape | Close the topmost layer (palette → chat → delete dialog) |

Deleting a note always asks for confirmation first.

## Privacy and network behavior

- **No note data leaves the device** except through an agent provider endpoint you
  explicitly configure and use, and remote images you embed yourself (see below).
  There is no telemetry.
- **No host permissions at install.** The manifest declares MV3
  `optional_host_permissions`; when you save a remote provider endpoint, the settings
  panel offers to grant network access to that origin only. Denying it just disables
  the remote provider.
- **First-run model download.** Semantic embeddings use all-MiniLM-L6-v2 (quantized,
  ~23 MB), fetched from the Hugging Face hub the first time indexing runs and then
  cached by the browser. This is the app's only built-in network fetch and it carries
  no note content. Offline — or if the fetch fails — embeddings fall back to a
  deterministic local estimator, and the app stays fully usable. See
  [docs/threat-model.md](docs/threat-model.md) for the full model-provenance story.
- **Remote images are real network requests.** Markdown image URLs are not blocked:
  an `![alt](https://host/path)` image is fetched by the browser whenever the note (or
  an agent reply) previews. That request discloses the image URL and ordinary viewing
  metadata (your IP, user agent) to the host — so an image URL containing note-derived
  data would leak it. Embed remote images only from hosts you trust; this is separate
  from the provider and model-fetch paths above.
- **Rendered content cannot execute.** Markdown renders without raw HTML; link URLs
  pass an allowlist (`http`, `https`, `mailto`, `tel`, relative/fragment, and the
  internal `wikilink:`/`tag:` schemes — everything else renders inert), and external
  links open in a new tab with `rel="noopener noreferrer"`.
- **Keys stay local.** Provider API keys live in the local IndexedDB settings store —
  never synced, never written into notes or logs.
- **Agent actions are auditable.** Every agent tool call (provider, tool, args, tier,
  outcome) is recorded in a bounded local audit log (last 500 entries), browsable and
  clearable from the chat drawer.

## Installation

1. Download `localnotes-v<version>.zip` from the latest
   [GitHub Release](https://github.com/true-line/localnotes/releases) — or build from
   source with `npm ci && npm run build` and zip the `dist/` output.
2. Unzip, then open `chrome://extensions`, enable **Developer mode**, and
   **Load unpacked** the folder.
3. LocalNotes takes over your new-tab page. No permissions are requested at install;
   host access is granted per provider origin only if you configure a remote agent.

## Configuring an agent provider

Open the chat drawer (Cmd/Ctrl+J) and use the provider selector in the header:

- **Local Mock (offline)** — the default. Deterministic canned replies, plus a real
  `notes.search` tool call when you ask it to find something. Nothing leaves the
  device.
- **OpenAI-compatible (remote)** — point it at any chat-completions endpoint:
  Ollama (the default base URL is `http://localhost:11434/v1`), LM Studio, vLLM, or
  OpenAI. Open **Remote provider settings** in the drawer, set the base URL, model,
  and optional API key, save, then grant the host permission when offered. The
  badge in the header names the destination host whenever a remote provider is
  active, and the model field can offer suggestions fetched from the endpoint's
  `/models`. The saved API key is only ever sent to the endpoint it was saved
  against.

## Releases

Releases follow the org's changesets flow (see `true-line/cartograph` for the reference
implementation):

1. **Author a changeset** in your PR: run `npm run changeset`, pick `patch`/`minor`/
   `major`, describe the change, and commit the generated `.changeset/*.md` file.
2. **Version cut** (`.github/workflows/version-cut.yml`): on merge to `main`, pending
   changesets are folded into a bot-maintained **"Version packages"** PR that bumps
   `package.json`, `public/manifest.json`, the lockfile, and `CHANGELOG.md`.
3. **Cut the release**: review and merge the Version packages PR once its CI is green.
   The workflow tags `v<version>` on the merged commit (only after exact-commit CI
   passes), which starts the **Release** workflow.
4. **Release** (`.github/workflows/release.yml`): re-validates the tag's provenance and
   version sync, runs the test suite and production build, and attaches
   `localnotes-v<version>.zip` to a GitHub Release with the changelog section as notes.

Install by unzipping and loading the folder as an unpacked extension
(`chrome://extensions` → Developer mode → *Load unpacked*).

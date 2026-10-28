# Threat Model

Short version: Local Notes is a browser-extension notes vault with **no backend**. Its
security posture rests on keeping data local, treating all rendered/agent-processed
content as untrusted input, and making every agent action explicit and reviewable.
This document is the reference for what "secure" means here; new features should state
which invariants they touch.

## Assets

1. **Note content** — the user's research, ideas, and credentials that end up in notes.
2. **Vault integrity** — notes must not be silently modified or deleted.
3. **API keys** — provider credentials stored for agent features.
4. **Extension privileges** — the MV3 extension page itself (a privileged origin).

## Trust boundaries

| Boundary | Notes |
|---|---|
| Network ↔ extension | No note data leaves the device by default. Egress happens only via a user-configured LLM provider endpoint. The embeddings model is bundled/copied locally (see "Model provenance"). |
| Pasted/rendered markdown ↔ extension page | Note content is **untrusted input**. It must never execute script or grant itself navigation privileges. |
| LLM output ↔ vault | Model output is **untrusted input too**. It can contain injected instructions; it must only affect the vault through permissioned tools. |
| Note content ↔ prompts | Note content included in agent context is *data, never instructions* (prompt-injection defense, see below). |

## Adversaries

| Adversary | Capability | Primary defense |
|---|---|---|
| Malicious pasted content | Crafted markdown/HTML in a note (e.g. from a web clip) | URL allowlist in the renderer; no raw HTML; CSP `script-src 'self'` |
| Malicious/prompt-injected LLM output | Crafted model responses that try to exfiltrate or mutate the vault | Tiered tool permissions; diff-review for writes; explicit egress only; audit log |
| Device thief / shared machine | Physical access to the browser profile | Out of scope for MVP (no encryption at rest yet — see roadmap "Deliberately deferred"). Export/import + OS-level profile security are the current mitigations |
| Malicious browser extension | Another extension with broad permissions | Nothing we control; keep our own permission footprint minimal |

## Invariants (must always hold)

1. **Local by default.** No note content, embedding, or key leaves the device except
   through a provider call the user explicitly configured and triggered.
2. **Rendered content cannot execute.** Markdown is rendered without raw HTML; URLs pass
   an allowlist (`http`, `https`, `mailto`, `tel`, relative/fragment, internal
   `wikilink:`/`tag:` schemes — see `sanitizeMarkdownUrl` in `MarkdownRenderer.tsx`).
   External links open in a new context with `rel="noopener noreferrer"`.
3. **Least-privilege manifest.** No host permissions at install. Provider endpoints are
   granted via `optional_host_permissions` when agent features ship.
4. **Agents propose, humans apply.** Tool permissions are tiered (read / propose-diff /
   confirm-per-write). No tier exists where a model silently rewrites or deletes notes.
5. **Every agent action is attributable.** Tool calls (agent, tool, args, tier, outcome)
   land in a local audit log once agents ship.
6. **Keys never sync.** Provider keys live in local extension storage only, never
   `storage.sync`, never notes, never logs.

## Model provenance

ONNX Runtime wasm is resolved locally (copied into `public/ort/` at dev/build time from
`node_modules`). The embedding model **weights** (all-MiniLM-L6-v2, q8, ~23 MB) are
currently fetched from the Hugging Face hub on the first indexing run and then cached by
the browser — this is the only network fetch the app performs, and note content is never
transmitted with it. Until the weights are bundled into the extension (tracked as an M0
follow-up), treat this single first-run fetch as declared, deliberate egress: it can be
avoided entirely by staying offline, in which case embeddings fall back to the
deterministic local estimator. Any future model fetch must be explicit and documented
here.

## Non-goals

- Multi-user access control, server-side auth, compliance regimes (no server exists).
- Protection against a fully compromised host OS or browser profile.
- Encrypted-at-rest storage (deferred by design until Phase 2D; see roadmap).

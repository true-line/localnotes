# Real-browser integration tests (Playwright)

The Vitest suite under `src/__tests__/` runs in jsdom with fake IndexedDB and
mocked providers. The Playwright lane under `e2e/` covers what jsdom cannot:
the packed MV3 extension in real Chromium, real optional-host-permission
state, actual MiniLM model download/fallback/caching, and a live
OpenAI-compatible endpoint. It is a separate lane — `npm test` never runs it.

## Running locally

```sh
npm ci
npx playwright install chromium   # once per machine
npm run test:e2e                  # everything: builds dist/, starts vite preview
```

Useful subsets:

```sh
npx playwright test --project=web         # app served by vite preview (headless)
npx playwright test --project=extension   # packed MV3 extension (headful Chromium)
npx playwright test e2e/keyboard.web.spec.ts
```

`npm run test:e2e` builds `dist/` and starts `vite preview` on port 4173
automatically (the `webServer` block in `playwright.config.ts`).

The extension project launches **headful** Chromium because Chrome only loads
unpacked extensions with a UI. On a headless Linux machine, wrap the command:

```sh
xvfb-run -a npx playwright test --project=extension
```

## Coverage map

| Spec | Project | What it proves |
| --- | --- | --- |
| `vault.extension.spec.ts` | extension | New-tab override, create/edit/reload/delete against real Chromium IndexedDB, JSON export download and file import |
| `permissions.extension.spec.ts` | extension | No host permissions at install; endpoint fetch blocked before a grant; real `chrome.permissions.request` grant enables the endpoint |
| `provider-contract.web.spec.ts` | web | Streaming SSE, tool-schema advertising, and a multi-round tool-call loop against a local OpenAI-compatible server started by the test (no external network) |
| `embeddings.web.spec.ts` | web | Real MiniLM download (384-dim vectors), network-unavailable fallback to deterministic 256-dim local embeddings, cached offline restart with zero model-host requests, and no note content in any request |
| `keyboard.web.spec.ts` | web | Palette, delete dialog, and agent drawer keyboard/focus smoke path |

Two deliberate testing choices:

- The MiniLM success test performs a **real** download from Hugging Face and
  needs internet access. The fallback and cached-startup tests block the model
  hosts at the browser network layer instead of mocking application code.
- Chromium's native permission and new-tab-override bubbles cannot be clicked
  by browser automation. Permission denial is therefore verified as real
  behavior (no grant persisted, endpoint unreachable), and the grant runs
  through the real `chrome.permissions.request` API — the same call the app's
  "Grant network access" button makes. Under `--deny-permission-prompts`
  Chromium auto-resolves extension optional-host prompts as a grant, which
  keeps the grant test deterministic.

## CI

`.github/workflows/e2e.yml` runs both projects on every non-draft pull request
to `main` and on manual dispatch: web headless, extension headful under
`xvfb-run`, on GitHub-hosted `ubuntu-latest`. On failure, Playwright traces
are uploaded as the `playwright-traces` artifact (7-day retention). Debug a
failure locally with `npx playwright show-trace <trace.zip>` or rerun with
`--trace on`.

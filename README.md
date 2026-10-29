# localnotes
A fast, simple, and private notes app that runs entirely in your browser. Capture, edit, and organize notes instantly with local storage—no accounts, no cloud, no backend required. Built with Vite + React + TypeScript for a playful yet minimal desktop experience.

+ install as chromium extension

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

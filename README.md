# localnotes
A fast, simple, and private notes app that runs entirely in your browser. Capture, edit, and organize notes instantly with local storage—no accounts, no cloud, no backend required. Built with Vite + React + TypeScript for a playful yet minimal desktop experience.

+ install as chromium extension

## Releases

New versions are cut and published through the **Release** workflow
(`.github/workflows/release.yml`): Actions → **Release** → *Run workflow* → enter a
semver (e.g. `0.2.0`). The workflow validates and bumps the version in
`package.json` / `public/manifest.json`, commits and tags `v<version>` on `main`,
runs the test suite and build, then attaches `localnotes-v<version>.zip` to a
GitHub Release. Install by unzipping and loading the folder as an unpacked
extension (`chrome://extensions` → Developer mode → *Load unpacked*).

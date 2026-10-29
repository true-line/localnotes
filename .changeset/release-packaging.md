---
'localnotes': patch
---

Release packaging fix: the extension zip is now built with adm-zip via node instead of the zip binary, which the self-hosted runner does not carry. No app behavior changes.

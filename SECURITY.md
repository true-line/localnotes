# Security policy

Local Notes is a notes vault whose security posture is defined in
[docs/threat-model.md](docs/threat-model.md). Note data stays on the device
**by default** — content leaves the device only through a provider endpoint
the user explicitly configures, or tool calls the user approves. Rendered and
model-generated content is treated as untrusted input, and every agent action
is explicit and reviewable. Vulnerability reports are triaged against that
document; its assets (note content, vault integrity, API keys, and the app's
privileged origin) and trust boundaries define what is in scope.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.**

Report privately through GitHub's private vulnerability reporting on this
repository (Security tab → Report a vulnerability), per the
[true-line security policy](https://github.com/true-line/.github/blob/main/SECURITY.md).
If that is unavailable, email security@true-line.ai.

Include what you can: the affected release or commit, reproduction steps, and
impact as you understand it. Expect an acknowledgement within 7 days; this is
a single-maintainer project, so please allow a reasonable window before any
public disclosure.

## Supported versions

Only the [latest release](../../releases) and the default branch (`main`) are
supported. Releases are cut exclusively by the reviewed Version packages
workflow from a merged, approved Version packages PR.

## Scope notes

- Dependency-level advisories are tracked automatically; a report is still
  welcome if you believe an advisory is exploitable in this context.
- Secrets accidentally committed to this repository: report privately as
  above rather than commenting publicly.

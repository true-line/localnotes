# localnotes

## 0.3.0

### Minor Changes

- 14c9666: Agent chat becomes useful: five read-only tools (notes.search, notes.read, notes.recent, graph.connections, graph.similar) execute against the vault with schema-validated arguments; tool calls render as collapsible transcripts; context chips (Current note / Selection / Recent notes / Graph neighborhood) make exactly what the agent receives explicit and removable. The mock agent now runs real vault searches.

## 0.2.1

### Patch Changes

- 7f05cc1: Release packaging fix: the extension zip is now built with adm-zip via node instead of the zip binary, which the self-hosted runner does not carry. No app behavior changes.

## 0.2.0

### Minor Changes

- 4851bb8: Agent chat overlay (Cmd+J) with an offline mock provider: streaming markdown responses in a right-side drawer, an agent selector with a local/remote badge, and stop/retry controls. Real providers and read-only note tools follow in the next slices.

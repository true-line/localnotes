# Knowledge-graph performance budget

Issue #71: knowledge-graph construction performs all-pairs semantic
comparisons (including facet similarity) and the force layout performs
all-pairs repulsion for 120 iterations in [`src/knowledgeGraph.ts`](../src/knowledgeGraph.ts).
Both paths rerun whenever notes, embeddings, or the similarity threshold
change, and both grow quadratically with note count. This document fixes the
responsiveness budget those paths must meet and how it is measured.

## Budget

Target vault: **200 notes** of representative length (mostly short notes with
a minority of long pasted articles), with dense wiki-link and semantic
structure (see the generator below).

| Operation | Trigger | Budget at target vault |
| --- | --- | --- |
| `buildKnowledgeGraph` | graph view open; notes/embeddings/threshold change | ≤ 1000 ms |
| `computeForceLayout` (120 iterations) | graph view open | ≤ 250 ms |
| `getNoteConnections` | note selection change | ≤ 300 ms |

Rationale: a graph view open that completes in about a second (build plus
layout) stays acceptable without a dedicated loading flow, and 300 ms keeps
the connections panel from visibly delaying note selection. Numbers are
guardrails for CI-reference hardware (GitHub-hosted `ubuntu-latest`, Node 24),
not guarantees for every device.

### Measured (2026-11-07, optimized implementation, local arm64 Mac, Node 24)

Mean of 10 samples per size, dense generated vault:

| Notes | `buildKnowledgeGraph` | `getNoteConnections` | `computeForceLayout` |
| --- | --- | --- | --- |
| 100 | 163 ms | 92 ms | 21 ms |
| 200 | 647 ms | 203 ms | 117 ms |
| 300 | 947 ms | 308 ms | 209 ms |
| 500 | 2808 ms | 793 ms | 689 ms |

The target size meets the budget with headroom. **500-note vaults exceed it**:
the remaining cost is inherently quadratic (dense clause-level cosine work in
facet similarity dominates the profile), so larger vaults need structural work
— a Web Worker, incremental recomputation, or similarity pruning — rather than
micro-optimization. That is deliberately follow-up work, not part of this
budget.

## Measuring

Benchmarks live in [`src/__benchmarks__/`](../src/__benchmarks__/) and run in a
separate lane from the fast unit suite (`vitest run` only collects
`*.test.*` files, so `npm test` is unaffected):

```sh
npm run bench:kg                                        # local smoke pass (50 and 100 notes)
KG_BENCH_SIZES=100,200,300,500 KG_BENCH_TIME_MS=1000 npm run bench:kg   # full pass, on demand
```

[`vaultGenerator.ts`](../src/__benchmarks__/vaultGenerator.ts) builds
deterministic vaults from a seeded PRNG (seed 71): themed note clusters with
shared vocabulary, `[[wiki-links]]`, plain-text title mentions, `#tags`, and
clustered 256-dim embeddings, so semantic edges are dense rather than sparse.
Keep the generator deterministic — benchmark numbers are only comparable
across commits when the input vault is identical.

Run only the smoke pass locally; full-size passes are on-demand measurements,
not a per-commit gate (timing variance on shared CI hardware would make a hard
assertion flaky).

## Optimization rules

- Profile with the benchmark lane before optimizing; keep measurements in
  commit messages or PR descriptions when an optimization lands.
- Graph output must stay deterministic and behavior-preserving: same nodes,
  same edges, same weights, same layout coordinates for the same input.
- Prefer caching precomputable per-note data (facet stems, clause vectors and
  norms, mention patterns) over approximations that change output.

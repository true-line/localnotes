import { bench, describe } from 'vitest';
import {
  buildKnowledgeGraph,
  computeForceLayout,
  getNoteConnections,
} from '../knowledgeGraph';
import { generateBenchmarkVault } from './vaultGenerator';

/**
 * Knowledge-graph performance lane. Excluded from `npm test` (vitest only
 * collects *.test.ts? files in run mode); execute with `npm run bench:kg`.
 *
 * Sizes and per-bench time are overridable for CI full runs:
 *   KG_BENCH_SIZES=100,300,500 KG_BENCH_TIME_MS=1000 npm run bench:kg
 * The local default is a minimal smoke pass; the responsiveness budget these
 * measurements are checked against lives in docs/knowledge-graph-performance.md.
 */
const sizes = (process.env.KG_BENCH_SIZES ?? '50,100')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const benchTimeMs = Number(process.env.KG_BENCH_TIME_MS ?? 300);

describe('knowledge graph benchmarks', () => {
  for (const size of sizes) {
    const { notes, embeddings } = generateBenchmarkVault(size);
    const graph = buildKnowledgeGraph(notes, embeddings);
    // The midpoint note is short (i % 5 !== 4); long articles live at
    // i % 5 === 4, and their clause-heavy connections path is the expensive
    // one. Benchmark both length classes so the selection budget is proven
    // for long notes too, not just short ones.
    const probeNoteId = notes[Math.floor(size / 2)].id;
    const longProbeNoteId = notes[4].id;

    describe(`${size} notes`, () => {
      bench(
        'buildKnowledgeGraph',
        () => {
          buildKnowledgeGraph(notes, embeddings);
        },
        { time: benchTimeMs }
      );

      bench(
        'getNoteConnections',
        () => {
          getNoteConnections(probeNoteId, notes, embeddings);
        },
        { time: benchTimeMs }
      );

      bench(
        'getNoteConnections (long article)',
        () => {
          getNoteConnections(longProbeNoteId, notes, embeddings);
        },
        { time: benchTimeMs }
      );

      bench(
        'computeForceLayout (120 iterations)',
        () => {
          computeForceLayout(graph);
        },
        { time: benchTimeMs }
      );
    });
  }
});

import type { Note } from './types';

export const EMBEDDING_STORAGE_KEY = 'localnotes-embeddings-v5';
export const DEFAULT_SIMILARITY_THRESHOLD = 0.35;
export const EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

export interface CachedNoteEmbedding {
  hash: string;
  vector: number[];
}

export type EmbeddingCacheStore = Record<string, CachedNoteEmbedding>;

export type EmbedderFn = (text: string) => Promise<number[]>;

export const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
  'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'once', 'here', 'there', 'where', 'why', 'how', 'all', 'any',
  'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can',
  'will', 'just', 'should', 'now', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
  'his', 'her', 'its', 'their', 'our', 'your', 'my', 'who', 'whom', 'which',
  'what', 'that', 'this', 'these', 'those', 'am', 'as', 'of', 'also',
  'born', 'known', 'better', 'best', 'stage', 'name', 'stylized', 'formed',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december', 'first', 'second', 'third',
  'new', 'one', 'two', 'three', 'four', 'five', 'years', 'year', 'time',
  'later', 'until', 'since', 'while', 'including', 'included', 'includes',
  'became', 'become', 'called', 'named', 'early', 'late', 'many', 'several',
  'various', 'either', 'neither', 'well', 'based', 'owned', 'gain',
  'significant', 'foothold', 'import', 'sales', 'produce', 'mass', 'notable',
  'pioneering', 'bringing', 'mainstream', 'seat', 'county', 'city', 'state',
  'states', 'united', 'american', 'japanese', 'europe', 'company', 'companies',
  'brand', 'genre', 'part', 'check', 'see', 'uses', 'related', 'explores',
  'described', 'connects', 'studying',
]);

const CANONICAL_STEMS: Record<string, string> = {
  bassist: 'bass',
  basses: 'bass',
  bass: 'bass',
  guitarist: 'guitar',
  guitars: 'guitar',
  guitar: 'guitar',
  drummer: 'drum',
  drumming: 'drum',
  drums: 'drum',
  vocalist: 'vocal',
  vocals: 'vocal',
  vocal: 'vocal',
  musician: 'music',
  musicians: 'music',
  musical: 'music',
  music: 'music',
  physicist: 'physics',
  physical: 'physics',
  scientist: 'science',
  scientific: 'science',
  sciences: 'science',
  mathematician: 'math',
  mathematical: 'math',
  mathematics: 'math',
};

/**
 * Normalizes morphological variants to a canonical stem/concept
 * (e.g., "bassist" / "basses" -> "bass", "musician" / "musical" -> "music").
 */
export function stemWord(word: string): string {
  const w = word.toLowerCase().trim();
  if (CANONICAL_STEMS[w]) return CANONICAL_STEMS[w];
  if (w.length <= 3) return w;
  if (w.endsWith('ician') && w.length > 6) return w.slice(0, -5);
  if (w.endsWith('ist') && w.length >= 6) return w.slice(0, -3);
  if (w.endsWith('ical') && w.length > 6) return w.slice(0, -4);
  if (w.endsWith('ingly') && w.length > 7) return w.slice(0, -5);
  if (w.endsWith('edly') && w.length > 6) return w.slice(0, -4);
  if (w.endsWith('ments') && w.length > 7) return w.slice(0, -5);
  if (w.endsWith('ment') && w.length > 6) return w.slice(0, -4);
  if (w.endsWith('ness') && w.length > 6) return w.slice(0, -4);
  if (w.endsWith('ings') && w.length > 6) return w.slice(0, -4);
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ies') && w.length > 5) return w.slice(0, -3) + 'y';
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

/**
 * Extracts meaningful non-stopword tokens from text.
 */
export function tokenizeMeaningfulWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function addSignedFeature(vec: number[], feature: string, weight: number): void {
  const h = fnv1a(feature);
  const idx = h % vec.length;
  const sign = (h & 0x10000) !== 0 ? 1 : -1;
  vec[idx] += sign * weight;
}

/**
 * Computes an instant, deterministic 256-dim semantic feature embedding
 * using term-frequency weighted top stems, title/lead sentence boosting,
 * and salient bigrams. Works on both short notes and long pasted articles.
 */
export function computeLocalSemanticEmbedding(
  text: string,
  dim = 256
): number[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const vec = new Array<number>(dim).fill(0);
  const lines = trimmed.split('\n');
  const firstLine = lines[0] ?? '';
  const leadText = trimmed.slice(0, 240);
  const titleStems = new Set(tokenizeMeaningfulWords(firstLine).map(stemWord));
  const leadStems = new Set(tokenizeMeaningfulWords(leadText).map(stemWord));
  const allTokens = tokenizeMeaningfulWords(trimmed);

  if (allTokens.length === 0) return [];

  const stemScores = new Map<string, number>();
  for (const token of allTokens) {
    const stem = stemWord(token);
    stemScores.set(stem, (stemScores.get(stem) ?? 0) + 1);
  }

  for (const stem of titleStems) {
    stemScores.set(stem, (stemScores.get(stem) ?? 0) + 4);
  }
  for (const stem of leadStems) {
    stemScores.set(stem, (stemScores.get(stem) ?? 0) + 2);
  }

  const topStems = Array.from(stemScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 35);
  const topStemSet = new Set(topStems.map(([s]) => s));

  for (const [stem, rawScore] of topStems) {
    const weight = 1.5 + Math.log1p(rawScore);
    addSignedFeature(vec, `uni:${stem}`, weight);
  }

  const seenBigrams = new Set<string>();
  for (let i = 0; i + 1 < allTokens.length; i++) {
    const s1 = stemWord(allTokens[i]);
    const s2 = stemWord(allTokens[i + 1]);
    if (s1 !== s2 && topStemSet.has(s1) && topStemSet.has(s2)) {
      const bi = `${s1}_${s2}`;
      if (!seenBigrams.has(bi)) {
        seenBigrams.add(bi);
        addSignedFeature(vec, `bi:${bi}`, 1.4);
      }
    }
  }

  let normSq = 0;
  for (let i = 0; i < dim; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm === 0) return [];
  return vec.map((v) => v / norm);
}

/**
 * Computes clause/facet-level semantic similarity (MaxSim across clauses +
 * shared concept overlap) so notes that share a specific entity, location,
 * or instrument facet connect even when their overall paragraphs cover different topics.
 */
export function computeFacetSimilarity(
  noteA: Pick<Note, 'title' | 'content'>,
  noteB: Pick<Note, 'title' | 'content'>
): number {
  const textA = getNoteEmbedText(noteA);
  const textB = getNoteEmbedText(noteB);
  if (!textA || !textB) return 0;

  const stemsA = new Set(tokenizeMeaningfulWords(textA).map(stemWord));
  const stemsB = new Set(tokenizeMeaningfulWords(textB).map(stemWord));
  if (stemsA.size === 0 || stemsB.size === 0) return 0;

  let sharedCount = 0;
  for (const s of stemsA) {
    if (stemsB.has(s)) sharedCount++;
  }
  if (sharedCount === 0) return 0;

  // Overlap coefficient (Szymkiewicz–Simpson) weighted toward meaningful concept matches
  const minSize = Math.min(stemsA.size, stemsB.size);
  const overlapCoeff = sharedCount / Math.max(minSize, 4);

  // Also check max clause-to-clause cosine similarity
  const clausesA = textA
    .split(/[.;!?\n]+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 12);
  const clausesB = textB
    .split(/[.;!?\n]+/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 12);

  let maxClauseSim = 0;
  for (const ca of clausesA) {
    const va = computeLocalSemanticEmbedding(ca, 128);
    if (va.length === 0) continue;
    for (const cb of clausesB) {
      const vb = computeLocalSemanticEmbedding(cb, 128);
      if (vb.length === 0) continue;
      const sim = cosineSimilarity(va, vb);
      if (sim > maxClauseSim) maxClauseSim = sim;
    }
  }

  // If they share >= 2 canonical concepts (e.g. "bass" + "music", or "bakersfield" + "california"),
  // ensure similarity is at least 0.38 + 0.08 * sharedCount
  const conceptBoost =
    sharedCount >= 2 ? Math.min(0.85, 0.32 + sharedCount * 0.08) : 0;

  return Math.max(overlapCoeff, maxClauseSim, conceptBoost);
}

/**
 * Computes cosine similarity between two numeric vectors in [-1, 1].
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Deterministic FNV-1a hash of note text for cache invalidation.
 */
export function hashText(text: string): string {
  return fnv1a(text).toString(16);
}

/**
 * Formats a note's title and content into a single string for embedding.
 */
export function getNoteEmbedText(note: Pick<Note, 'title' | 'content'>): string {
  const title = note.title.trim();
  const content = note.content.trim();
  if (!title && !content) return '';
  return title && content ? `${title}\n${content}` : title || content;
}

/**
 * Loads cached note embeddings from localStorage with defensive parsing.
 */
export function loadEmbeddingCache(): EmbeddingCacheStore {
  try {
    const raw = localStorage.getItem(EMBEDDING_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as EmbeddingCacheStore;
  } catch {
    return {};
  }
}

/**
 * Saves cached note embeddings to localStorage.
 */
export function saveEmbeddingCache(cache: EmbeddingCacheStore): void {
  try {
    localStorage.setItem(EMBEDDING_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage quota errors
  }
}

type FeatureOutput = { data: Float32Array | number[] };
type FeaturePipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<FeatureOutput>;

let pipelinePromise: Promise<FeaturePipeline> | null = null;
let customEmbedder: EmbedderFn | null = null;

/**
 * Allows overriding the embedding function (used in tests or custom providers).
 */
export function setCustomEmbedder(fn: EmbedderFn | null): void {
  customEmbedder = fn;
}

function getLocalOrtWasmBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.href) {
    try {
      return new URL('./ort/', window.location.href).href;
    } catch {
      return './ort/';
    }
  }
  return './ort/';
}

async function getTransformersPipeline(): Promise<FeaturePipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false;
        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.wasmPaths = getLocalOrtWasmBaseUrl();
          env.backends.onnx.wasm.numThreads = 1;
        }
        const extractor = await pipeline(
          'feature-extraction',
          EMBEDDING_MODEL_ID,
          { dtype: 'q8' }
        );
        return extractor as unknown as FeaturePipeline;
      } catch (err) {
        pipelinePromise = null;
        throw err;
      }
    })();
  }
  return pipelinePromise;
}

/**
 * Computes an embedding vector for `text` using @huggingface/transformers
 * (all-MiniLM-L6-v2, 384-dim normalized mean-pooled vector), falling back
 * to the instant local semantic embedding if the neural model is unavailable.
 */
export async function embedText(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (customEmbedder) {
    return customEmbedder(trimmed);
  }

  try {
    const extractor = await getTransformersPipeline();
    const output = await extractor(trimmed, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data);
  } catch {
    return computeLocalSemanticEmbedding(trimmed);
  }
}

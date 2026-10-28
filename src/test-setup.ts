import '@testing-library/jest-dom';
import { setCustomEmbedder } from './embeddings';

// Provide a fast deterministic 32-dim bag-of-trigrams embedder for unit/integration tests
setCustomEmbedder(async (text: string) => {
  const vec = new Array<number>(32).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const word of words) {
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = (h >>> 0) % 32;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return norm > 0 ? vec.map((v) => v / norm) : vec;
});


import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { setCustomEmbedder } from './embeddings';
import { resetRepositoryForTests } from './storage';

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

// Every test starts with a fresh IndexedDB and an uncached repository
beforeEach(() => {
  (globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory();
  resetRepositoryForTests();
});

// jsdom implements neither Blob.text() nor File.text(); provide the latter
// (backed by FileReader, which jsdom does implement) for import tests.
if (typeof File !== 'undefined' && typeof File.prototype.text !== 'function') {
  Object.defineProperty(File.prototype, 'text', {
    configurable: true,
    writable: true,
    value: function readAsText(): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this as unknown as Blob);
      });
    },
  });
}

// jsdom has no matchMedia; the theme hook needs prefers-color-scheme
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

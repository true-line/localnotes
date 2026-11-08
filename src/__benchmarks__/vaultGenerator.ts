import type { EmbeddingMap, Note } from '../types';

export interface GeneratedVault {
  notes: Note[];
  embeddings: EmbeddingMap;
}

/**
 * mulberry32 PRNG: small, fast, and identical across machines and runs,
 * which keeps benchmark vaults (and therefore results) reproducible.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Theme {
  name: string;
  words: string[];
}

const THEMES: Theme[] = [
  {
    name: 'physics',
    words: [
      'quantum', 'entanglement', 'qubit', 'superposition', 'photon', 'lattice',
      'momentum', 'field', 'particle', 'spin', 'orbital', 'spectrum',
      'coherence', 'tunneling', 'vacuum', 'relativity', 'tensor', 'boson',
      'fermion', 'plasma', 'diffraction', 'resonance', 'wavelength', 'entropy',
    ],
  },
  {
    name: 'music',
    words: [
      'harmony', 'rhythm', 'melody', 'tempo', 'chord', 'timbre', 'counterpoint',
      'arpeggio', 'syncopation', 'resonance', 'octave', 'scale', 'fretboard',
      'amplifier', 'distortion', 'bassline', 'groove', 'reverb', 'chorus',
      'verse', 'bridge', 'session', 'vinyl', 'acoustic',
    ],
  },
  {
    name: 'cooking',
    words: [
      'sourdough', 'fermentation', 'hydration', 'crumb', 'starter', 'proofing',
      'skillet', 'braise', 'umami', 'caramelize', 'deglaze', 'marinade',
      'blanch', 'saute', 'reduction', 'garnish', 'simmer', 'roast', 'knead',
      'leaven', 'broth', 'zest', 'emulsion', 'sear',
    ],
  },
  {
    name: 'programming',
    words: [
      'compiler', 'parser', 'lexer', 'bytecode', 'runtime', 'heap', 'stack',
      'closure', 'monad', 'functor', 'iterator', 'recursion', 'mutex',
      'scheduler', 'pipeline', 'cache', 'register', 'opcode', 'grammar',
      'syntax', 'refactor', 'debugger', 'profiler', 'allocator',
    ],
  },
  {
    name: 'geography',
    words: [
      'valley', 'plateau', 'delta', 'estuary', 'canyon', 'glacier', 'tundra',
      'savanna', 'peninsula', 'archipelago', 'watershed', 'tributary',
      'badlands', 'mesa', 'fjord', 'atoll', 'lagoon', 'prairie', 'steppe',
      'highland', 'lowland', 'basin', 'ridge', 'strait',
    ],
  },
  {
    name: 'biology',
    words: [
      'neuron', 'synapse', 'mitosis', 'genome', 'enzyme', 'protein', 'ribosome',
      'membrane', 'chlorophyll', 'photosynthesis', 'mutation', 'allele',
      'phenotype', 'organism', 'ecosystem', 'symbiosis', 'pathogen',
      'antibody', 'cellular', 'taxonomy', 'habitat', 'predator', 'plankton',
      'spore',
    ],
  },
];

const EMBEDDING_DIM = 256;

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pickWord(rand: () => number, pool: string[]): string {
  return pool[Math.floor(rand() * pool.length)];
}

function makeSentence(rand: () => number, theme: Theme, crossTheme: Theme): string {
  const length = 8 + Math.floor(rand() * 7);
  const words: string[] = [];
  for (let i = 0; i < length; i++) {
    // Occasional cross-theme words keep semantic clusters from being trivially separable.
    const pool = rand() < 0.12 ? crossTheme.words : theme.words;
    words.push(pickWord(rand, pool));
  }
  words[0] = capitalize(words[0]);
  return `${words.join(' ')}.`;
}

/**
 * Generates a deterministic vault of `size` notes with dense wiki-link and
 * semantic structure: notes cluster into themes that share vocabulary,
 * embeddings, and links, so similarity edges are plentiful rather than sparse.
 */
export function generateBenchmarkVault(size: number, seed = 71): GeneratedVault {
  const rand = mulberry32(seed);
  const embeddingRand = mulberry32(seed ^ 0x9e3779b9);

  const titles: string[] = [];
  for (let i = 0; i < size; i++) {
    const theme = THEMES[i % THEMES.length];
    titles.push(`${capitalize(theme.name)} Concept ${Math.floor(i / THEMES.length)}`);
  }

  const themeTitles = new Map<string, string[]>();
  for (let i = 0; i < size; i++) {
    const theme = THEMES[i % THEMES.length];
    const list = themeTitles.get(theme.name) ?? [];
    list.push(titles[i]);
    themeTitles.set(theme.name, list);
  }

  const notes: Note[] = [];
  for (let i = 0; i < size; i++) {
    const theme = THEMES[i % THEMES.length];
    const crossTheme = THEMES[(i + 3) % THEMES.length];

    // Mix of note lengths: mostly short notes, every fifth is a long article.
    const sentenceCount = i % 5 === 4 ? 20 + Math.floor(rand() * 10) : 4 + Math.floor(rand() * 6);
    const parts: string[] = [];
    for (let s = 0; s < sentenceCount; s++) {
      parts.push(makeSentence(rand, theme, crossTheme));
    }

    const sameThemeTitles = themeTitles.get(theme.name) ?? [];
    const linkCount = 1 + Math.floor(rand() * 3);
    for (let l = 0; l < linkCount; l++) {
      const target = sameThemeTitles[Math.floor(rand() * sameThemeTitles.length)];
      if (rand() < 0.6) {
        parts.push(`See [[${target}]] for more.`);
      } else {
        parts.push(`See [[${capitalize(theme.name)} Unresolved ${l}]] for more.`);
      }
    }

    // Plain-text mention of another note's title (exercises mention detection).
    if (i > 0 && rand() < 0.4) {
      const mentioned = titles[Math.floor(rand() * i)];
      parts.push(`This relates to ${mentioned} in practice.`);
    }

    parts.push(`#${theme.name} #${theme.name}-${i % 3}`);

    notes.push({
      id: `bench-${i}`,
      title: titles[i],
      content: parts.join('\n'),
      createdAt: 1000 + i,
      updatedAt: 2000 + i,
    });
  }

  // Clustered embeddings: a per-theme base vector plus small per-note noise,
  // so within-theme pairs clear the default similarity threshold.
  const embeddings: EmbeddingMap = {};
  const themeBases = THEMES.map(() => {
    const base = new Array<number>(EMBEDDING_DIM);
    for (let d = 0; d < EMBEDDING_DIM; d++) {
      base[d] = embeddingRand() * 2 - 1;
    }
    return base;
  });
  for (let i = 0; i < size; i++) {
    const base = themeBases[i % THEMES.length];
    const vec = new Array<number>(EMBEDDING_DIM);
    let normSq = 0;
    for (let d = 0; d < EMBEDDING_DIM; d++) {
      vec[d] = base[d] + (embeddingRand() * 2 - 1) * 0.25;
      normSq += vec[d] * vec[d];
    }
    const norm = Math.sqrt(normSq);
    embeddings[notes[i].id] = vec.map((v) => v / norm);
  }

  return { notes, embeddings };
}

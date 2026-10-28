import { describe, it, expect } from 'vitest';
import {
  extractLinksAndTags,
  buildKnowledgeGraph,
  getNoteConnections,
  computeForceLayout,
} from '../knowledgeGraph';
import type { Note } from '../types';

const makeNote = (overrides: Partial<Note>): Note => ({
  id: 'note-1',
  title: 'Default Note',
  content: '',
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides,
});

describe('extractLinksAndTags', () => {
  it('extracts wiki-links and normalizes duplicates case-insensitively', () => {
    const content =
      'Exploring [[Quantum Computing]] and [[quantum computing|QC]] plus [[Entanglement]].';
    const result = extractLinksAndTags(content);
    expect(result.wikiLinks).toEqual(['Quantum Computing', 'Entanglement']);
  });

  it('extracts #tags and ignores markdown headings and code blocks', () => {
    const content = [
      '# Heading 1',
      'Studying #physics and #machine-learning/deep-learning (#AI).',
      '`inline #ignored and [[Ignored Inline]]`',
      '```js',
      '// #ignored-in-fenced and [[Ignored Fenced]]',
      '```',
    ].join('\n');

    const result = extractLinksAndTags(content);
    expect(result.tags).toEqual([
      'physics',
      'machine-learning/deep-learning',
      'ai',
    ]);
    expect(result.wikiLinks).toEqual([]);
  });
});

describe('buildKnowledgeGraph', () => {
  it('creates note, concept, and tag nodes with appropriate edges and degrees', () => {
    const notes: Note[] = [
      makeNote({
        id: '1',
        title: 'Neural Networks',
        content: 'Related to [[Backpropagation]] and [[Deep Learning]] #ai #math',
      }),
      makeNote({
        id: '2',
        title: 'Backpropagation',
        content: 'Uses [[Chain Rule]] #math',
      }),
    ];

    const graph = buildKnowledgeGraph(notes);

    // 2 note nodes + 2 unresolved concepts (Deep Learning, Chain Rule) + 2 tags (ai, math)
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      'concept:chain rule',
      'concept:deep learning',
      'note:1',
      'note:2',
      'tag:ai',
      'tag:math',
    ]);

    // Check note-to-note wikilink edge from note:1 -> note:2
    expect(graph.edges).toContainEqual({
      id: 'wikilink:note:1->note:2',
      source: 'note:1',
      target: 'note:2',
      kind: 'wikilink',
    });

    // Check degree of #math tag node (referenced by both notes)
    const mathNode = graph.nodes.find((n) => n.id === 'tag:math');
    expect(mathNode?.degree).toBe(2);
  });
});

describe('getNoteConnections', () => {
  it('computes outgoing notes, unresolved concepts, tags, backlinks, and related notes', () => {
    const notes: Note[] = [
      makeNote({
        id: '1',
        title: 'Compilers',
        content: 'See [[Parsers]] and [[AST]] #cs #languages',
      }),
      makeNote({
        id: '2',
        title: 'Parsers',
        content: 'Part of [[Compilers]] and uses [[AST]] #cs',
      }),
      makeNote({
        id: '3',
        title: 'Type Systems',
        content: 'Check #languages for static typing',
      }),
    ];

    const connections = getNoteConnections('1', notes);

    expect(connections.outgoingNotes.map((n) => n.id)).toEqual(['2']);
    expect(connections.unresolvedConcepts).toEqual(['AST']);
    expect(connections.tags).toEqual(['cs', 'languages']);
    expect(connections.backlinks.map((n) => n.id)).toEqual(['2']);

    // Note 2 shares #cs and [[AST]] (2 topics), Note 3 shares #languages (1 topic)
    expect(connections.relatedNotes.map((r) => r.note.id)).toEqual(['2', '3']);
    expect(connections.relatedNotes[0].sharedTopics).toEqual(['#cs', '[[AST]]']);
    expect(connections.relatedNotes[1].sharedTopics).toEqual(['#languages']);
  });

  it('connects notes via semantic embeddings when cosine similarity meets threshold', () => {
    const notes: Note[] = [
      makeNote({ id: 'a', title: 'Attention Mechanism', content: 'Transformers' }),
      makeNote({ id: 'b', title: 'Self-Attention', content: 'Query key value' }),
      makeNote({ id: 'c', title: 'Sourdough Bread', content: 'Flour water salt' }),
    ];

    const embeddings = {
      a: [1, 0, 0],
      b: [0.85, 0.5267, 0], // cosine similarity with a = 0.85
      c: [0, 0, 1], // cosine similarity with a = 0
    };

    const graph = buildKnowledgeGraph(notes, embeddings, 0.6);
    const semanticEdges = graph.edges.filter((e) => e.kind === 'semantic');
    expect(semanticEdges).toHaveLength(1);
    expect(semanticEdges[0].source).toBe('note:a');
    expect(semanticEdges[0].target).toBe('note:b');
    expect(semanticEdges[0].weight).toBeCloseTo(0.85, 2);

    const connections = getNoteConnections('a', notes, embeddings, 0.6);
    expect(connections.semanticNotes).toHaveLength(1);
    expect(connections.semanticNotes[0].note.id).toBe('b');
    expect(connections.semanticNotes[0].similarity).toBeCloseTo(0.85, 2);
  });

  it('automatically connects plain-text notes via title mentions, shared concepts, and facet embeddings', async () => {
    const { computeLocalSemanticEmbedding, getNoteEmbedText } = await import(
      '../embeddings'
    );
    const notes: Note[] = [
      makeNote({
        id: 'fieldy',
        title: 'Fieldy',
        content:
          'Reginald Quincy Arvizu (born November 2, 1969), better known by his stage name Fieldy, is an American musician, best known as the bassist for the nu metal band Korn.',
      }),
      makeNote({
        id: 'korn',
        title: 'Korn',
        content:
          'Korn (stylized as KoЯn) is an American nu metal band formed in Bakersfield, California, in 1993.',
      }),
      makeNote({
        id: 'bakersfield',
        title: 'Bakersfield, Ca',
        content:
          'Bakersfield is a city in and the county seat of Kern County, California, United States.',
      }),
      makeNote({
        id: 'ibanez',
        title: 'Ibanez',
        content:
          'Ibanez is a Japanese guitar brand owned by Hoshino Gakki. They were one of the first Japanese musical instrument companies in the United States, and the first brand of guitars and basses to mass-produce seven-string guitars.',
      }),
    ];

    const embeddings = {
      fieldy: computeLocalSemanticEmbedding(getNoteEmbedText(notes[0])),
      korn: computeLocalSemanticEmbedding(getNoteEmbedText(notes[1])),
      bakersfield: computeLocalSemanticEmbedding(getNoteEmbedText(notes[2])),
      ibanez: computeLocalSemanticEmbedding(getNoteEmbedText(notes[3])),
    };

    const graph = buildKnowledgeGraph(notes, embeddings);

    // 1. Plain-text mention of "Korn" in "Fieldy" creates a direct wikilink edge
    expect(graph.edges).toContainEqual({
      id: 'wikilink:note:fieldy->note:korn',
      source: 'note:fieldy',
      target: 'note:korn',
      kind: 'wikilink',
    });

    // 2. Plain-text mention of "Bakersfield" in "Korn" matches "Bakersfield, Ca" primary title entity
    expect(graph.edges).toContainEqual({
      id: 'wikilink:note:korn->note:bakersfield',
      source: 'note:korn',
      target: 'note:bakersfield',
      kind: 'wikilink',
    });

    // 3. Shared concepts: "nu metal" (Fieldy+Korn), "bass" & "music" (Fieldy+Ibanez), "california" (Korn+Bakersfield)
    const conceptLabels = graph.nodes
      .filter((n) => n.type === 'concept')
      .map((n) => n.label);
    expect(conceptLabels).toContain('nu metal');
    expect(conceptLabels).toContain('bass');
    expect(conceptLabels).toContain('music');
    expect(conceptLabels).toContain('california');
    expect(conceptLabels).not.toContain('united states');

    // 4. Semantic edges connect Fieldy <-> Ibanez, Fieldy <-> Korn, and Korn <-> Bakersfield
    expect(
      graph.edges.some(
        (e) =>
          e.kind === 'semantic' &&
          e.source === 'note:fieldy' &&
          e.target === 'note:ibanez'
      )
    ).toBe(true);
  });
});

describe('computeForceLayout', () => {
  it('assigns finite within-bounds coordinates to all graph nodes', () => {
    const notes: Note[] = [
      makeNote({ id: '1', title: 'Alpha', content: '[[Beta]] #topic' }),
      makeNote({ id: '2', title: 'Beta', content: '#topic [[Gamma]]' }),
    ];
    const graph = buildKnowledgeGraph(notes);
    const positioned = computeForceLayout(graph, 800, 500, 60);

    expect(positioned).toHaveLength(graph.nodes.length);
    for (const node of positioned) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(40);
      expect(node.x).toBeLessThanOrEqual(760);
      expect(node.y).toBeGreaterThanOrEqual(40);
      expect(node.y).toBeLessThanOrEqual(460);
    }
  });
});


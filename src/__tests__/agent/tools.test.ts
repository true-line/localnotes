import { describe, it, expect } from 'vitest';
import { createTools, type ToolContext } from '../../agent/tools';
import type { Note, NoteConnections, SemanticNoteEntry } from '../../types';

function makeNote(id: string, title: string, content = ''): Note {
  return { id, title, content, createdAt: 1, updatedAt: 1 };
}

function fakeContext(): ToolContext & { calls: string[] } {
  const calls: string[] = [];
  const notes = [
    makeNote('n1', 'Relativity', 'spacetime curves around mass'),
    makeNote('n2', 'Quantum Mechanics', 'superposition and measurement'),
    makeNote('n3', '', 'untitled note about relativity history'),
  ];
  const conn: NoteConnections = {
    outgoingNotes: [notes[1]],
    unresolvedConcepts: ['spacetime'],
    tags: ['physics'],
    backlinks: [notes[2]],
    relatedNotes: [],
    semanticNotes: [
      { note: notes[0], similarity: 0.7 },
      { note: notes[1], similarity: 0.4 },
    ] as SemanticNoteEntry[],
  };
  return {
    calls,
    searchNotes: (query, limit = 10) => {
      calls.push(`search:${query}`);
      return notes
        .filter((n) => `${n.title} ${n.content}`.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit);
    },
    getNote: (id) => {
      calls.push(`read:${id}`);
      return notes.find((n) => n.id === id) ?? null;
    },
    recentNotes: (limit = 10) => notes.slice(0, limit),
    connectionsFor: (id) => (id === 'n1' ? conn : null),
    similarFor: (id, limit = 5) => (id === 'n1' ? conn.semanticNotes.slice(0, limit) : []),
  };
}

describe('tier-0 tools', () => {
  it('declares five read-only tools', () => {
    const tools = createTools(fakeContext());
    expect(tools.map((t) => t.name)).toEqual([
      'notes.search',
      'notes.read',
      'notes.recent',
      'graph.connections',
      'graph.similar',
    ]);
    expect(tools.every((t) => t.tier === 0)).toBe(true);
  });

  it('notes.search returns matches with ids and excerpts', async () => {
    const tools = createTools(fakeContext());
    const tool = tools.find((t) => t.name === 'notes.search')!;
    const result = await tool.execute({ query: 'relativity' });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('id=n1');
    expect(result.content).toContain('id=n3');
  });

  it('notes.read returns the full note or a miss', async () => {
    const tools = createTools(fakeContext());
    const read = tools.find((t) => t.name === 'notes.read')!;
    expect((await read.execute({ id: 'n2' })).content).toContain('Quantum Mechanics');
    expect((await read.execute({ id: 'nope' })).ok).toBe(false);
  });

  it('graph.connections summarizes backlinks, links, and tags', async () => {
    const tools = createTools(fakeContext());
    const conn = tools.find((t) => t.name === 'graph.connections')!;
    const result = await conn.execute({ id: 'n1' });
    expect(result.content).toContain('Backlinks (1)');
    expect(result.content).toContain('Links out (1)');
    expect(result.content).toContain('Tags: physics');
    expect((await conn.execute({ id: 'ghost' })).ok).toBe(false);
  });

  it('graph.similar lists ranked similar notes', async () => {
    const tools = createTools(fakeContext());
    const similar = tools.find((t) => t.name === 'graph.similar')!;
    const result = await similar.execute({ id: 'n1', limit: 1 });
    expect(result.content).toContain('0.70');
  });

  it('excerpt caps long note content in search results', async () => {
    const ctx = fakeContext();
    ctx.searchNotes = () => [makeNote('big', 'Big', 'x'.repeat(2000))];
    const tools = createTools(ctx);
    const result = await tools[0].execute({ query: 'big' });
    expect(result.content.length).toBeLessThan(1000);
  });
});

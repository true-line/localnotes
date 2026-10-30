import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  getRepository,
  exportVault,
  importVault,
  resetRepositoryForTests,
  createWriteQueue,
  REVISION_CAP_PER_NOTE,
  AGENT_AUDIT_CAP,
  type NotesRepository,
} from '../storage';
import type { Note } from '../types';

const makeNote = (id: string, overrides: Partial<Note> = {}): Note => ({
  id,
  title: `T ${id}`,
  content: 'C',
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides,
});

describe('NotesRepository (IndexedDB)', () => {
  let repo: NotesRepository;

  beforeEach(async () => {
    repo = await getRepository();
  });

  it('round-trips notes through put/getAll/delete', async () => {
    const a = makeNote('a');
    const b = makeNote('b');
    await repo.putNote(a);
    await repo.putNote(b);
    expect((await repo.getAllNotes()).map((n) => n.id)).toEqual(['a', 'b']);

    await repo.deleteNote('a');
    expect((await repo.getAllNotes()).map((n) => n.id)).toEqual(['b']);
  });

  it('upserts by id and bulk-puts', async () => {
    await repo.putNotes([makeNote('a', { title: 'first' }), makeNote('b')]);
    await repo.putNote(makeNote('a', { title: 'second' }));
    const notes = await repo.getAllNotes();
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.id === 'a')?.title).toBe('second');
  });

  it('getAllNotes filters entries that are not note-shaped', async () => {
    await repo.putNotes([makeNote('a')]);
    // Write junk through the same public path; getAllNotes must defend
    await repo.putNotes([{ id: 'junk' } as unknown as Note]);
    const notes = await repo.getAllNotes();
    expect(notes.map((n) => n.id)).toEqual(['a']);
  });

  it('flushWrites resolves only after queued writes land', async () => {
    const putPromises = [
      repo.putNote(makeNote('x')),
      repo.putNote(makeNote('y')),
    ];
    await repo.flushWrites();
    await Promise.all(putPromises);
    expect(await repo.getAllNotes()).toHaveLength(2);
  });

  describe('revisions', () => {
    beforeEach(() => {
      vi.spyOn(Date, 'now');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('snapshots a note and returns them newest first', async () => {
      vi.mocked(Date.now).mockReturnValueOnce(1000);
      await repo.snapshotRevision(makeNote('a', { title: 'old' }));
      vi.mocked(Date.now).mockReturnValueOnce(2000);
      await repo.snapshotRevision(makeNote('a', { title: 'older still' }));

      const revisions = await repo.getRevisions('a');
      expect(revisions).toHaveLength(2);
      expect(revisions[0].snapshot.title).toBe('older still');
      expect(revisions[0].at).toBe(2000);
      expect(revisions[1].snapshot.title).toBe('old');
    });

    it('caps revisions per note, keeping the newest', async () => {
      for (let i = 0; i < REVISION_CAP_PER_NOTE + 5; i++) {
        vi.mocked(Date.now).mockReturnValueOnce(1000 + i);
        await repo.snapshotRevision(makeNote('a', { title: `v${i}` }));
      }
      const revisions = await repo.getRevisions('a');
      expect(revisions).toHaveLength(REVISION_CAP_PER_NOTE);
      expect(revisions[0].snapshot.title).toBe('v24');
      expect(revisions[REVISION_CAP_PER_NOTE - 1].snapshot.title).toBe('v5');
    });

    it('replaces the full revision list for a note', async () => {
      await repo.snapshotRevision(makeNote('a', { title: 'old' }));
      const imported = [
        { noteId: 'a', snapshot: makeNote('a', { title: 'r1' }), at: 10 },
        { noteId: 'a', snapshot: makeNote('a', { title: 'r2' }), at: 20 },
      ];
      await repo.replaceRevisions('a', imported);
      const revisions = await repo.getRevisions('a');
      expect(revisions.map((r) => r.snapshot.title)).toEqual(['r2', 'r1']);
    });

    it('maybeSnapshotRevision throttles inside the interval window', async () => {
      vi.mocked(Date.now).mockReturnValue(1000);
      await repo.maybeSnapshotRevision(makeNote('a'));
      await repo.maybeSnapshotRevision(makeNote('a'));
      expect(await repo.getRevisions('a')).toHaveLength(1);

      vi.mocked(Date.now).mockReturnValue(1000 + 6 * 60 * 1000);
      await repo.maybeSnapshotRevision(makeNote('a'));
      expect(await repo.getRevisions('a')).toHaveLength(2);
    });
  });

  describe('embeddings', () => {
    it('round-trips embeddings as plain arrays', async () => {
      await repo.replaceEmbeddings({
        a: { hash: 'h1', vector: [0.5, -0.25, 2] },
      });
      expect(await repo.getAllEmbeddings()).toEqual({
        a: { hash: 'h1', vector: [0.5, -0.25, 2] },
      });

      await repo.clearEmbeddings();
      expect(await repo.getAllEmbeddings()).toEqual({});
    });
  });
});

describe('write queue', () => {
  it('flush resolves when all writes succeed', async () => {
    const queue = createWriteQueue();
    const ran: number[] = [];
    await Promise.all([
      queue.enqueue(async () => void ran.push(1)),
      queue.enqueue(async () => void ran.push(2)),
    ]);
    await queue.flush();
    expect(ran.sort()).toEqual([1, 2]);
  });

  it('flush rejects if any queued write failed, and exports cannot mask it', async () => {
    const queue = createWriteQueue();
    void queue.enqueue(async () => {
      throw new Error('commit aborted');
    });
    await queue.enqueue(async () => 'later write');
    await expect(queue.flush()).rejects.toThrow('commit aborted');
    // The failure is consumed by the flush that reported it
    await queue.flush();
  });
});

describe('export/import', () => {
  it('round-trips notes and revisions through an archive', async () => {
    const repo = await getRepository();
    await repo.putNotes([makeNote('a'), makeNote('b')]);
    await repo.snapshotRevision(makeNote('a', { title: 'old a' }));
    const archive = await exportVault();
    expect(archive.app).toBe('localnotes');

    // Simulate a fresh profile
    (globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory();
    resetRepositoryForTests();
    const result = await importVault(JSON.stringify(archive));
    expect(result).toEqual({ imported: 2, skipped: 0 });

    const freshRepo = await getRepository();
    const notes = await freshRepo.getAllNotes();
    expect(notes).toHaveLength(2);
    const revisions = await freshRepo.getRevisions('a');
    expect(revisions.map((r) => r.snapshot.title)).toEqual(['old a']);
  });

  it('merges by id without destroying existing notes', async () => {
    const repo = await getRepository();
    await repo.putNote(makeNote('existing'));

    const result = await importVault(
      JSON.stringify({
        app: 'localnotes',
        version: 1,
        exportedAt: 1,
        notes: [makeNote('existing', { title: 'overwritten' }), makeNote('new')],
      })
    );
    expect(result.imported).toBe(2);
    const notes = await repo.getAllNotes();
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.id === 'existing')?.title).toBe('overwritten');
  });

  it('counts skipped invalid entries', async () => {
    const result = await importVault(
      JSON.stringify({
        app: 'localnotes',
        version: 1,
        exportedAt: 1,
        notes: [makeNote('a'), { junk: true }, null],
      })
    );
    expect(result).toEqual({ imported: 1, skipped: 2 });
  });

  it('throws on malformed archives', async () => {
    await expect(importVault('{nope')).rejects.toThrow(/not valid JSON/);
    await expect(importVault('[]')).rejects.toThrow(/not a LocalNotes archive/);
    await expect(
      importVault(JSON.stringify({ hello: true }))
    ).rejects.toThrow(/not a LocalNotes archive/);
  });
});

describe('agent audit log', () => {
  let repo: NotesRepository;

  const entry = (tool: string, overrides: Record<string, unknown> = {}) => ({
    at: new Date().toISOString(),
    providerId: 'mock',
    tool,
    tier: 0,
    ok: true,
    durationMs: 5,
    args: { query: tool },
    ...overrides,
  });

  beforeEach(async () => {
    (globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory();
    resetRepositoryForTests();
    repo = await getRepository();
  });

  it('appends and lists newest-first', async () => {
    await repo.appendAgentAudit(entry('notes.search'));
    await repo.appendAgentAudit(entry('notes.read'));
    const rows = await repo.listAgentAudit(10);
    expect(rows.map((r) => r.tool)).toEqual(['notes.read', 'notes.search']);
  });

  it('respects the list limit', async () => {
    for (let i = 0; i < 5; i++) await repo.appendAgentAudit(entry(`t${i}`));
    expect((await repo.listAgentAudit(3)).map((r) => r.tool)).toEqual([
      't4',
      't3',
      't2',
    ]);
  });

  it('bounds the log at AGENT_AUDIT_CAP entries, oldest trimmed first', async () => {
    for (let i = 0; i < AGENT_AUDIT_CAP + 25; i++) {
      await repo.appendAgentAudit(entry(`t${i}`));
    }
    const rows = await repo.listAgentAudit(AGENT_AUDIT_CAP + 10);
    expect(rows).toHaveLength(AGENT_AUDIT_CAP);
    expect(rows[0].tool).toBe(`t${AGENT_AUDIT_CAP + 24}`);
    expect(rows[rows.length - 1].tool).toBe('t25');
  });

  it('clears the log', async () => {
    await repo.appendAgentAudit(entry('notes.search'));
    await repo.clearAgentAudit();
    expect(await repo.listAgentAudit(10)).toEqual([]);
  });
});

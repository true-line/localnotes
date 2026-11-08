import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotes } from '../hooks/useNotes';
import { getRepository, resetRepositoryForTests } from '../storage';
import type { Note } from '../types';

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'seed-1',
  title: 'Seeded note',
  content: '',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

describe('useNotes', () => {
  it('initialises with empty notes', () => {
    const { result } = renderHook(() => useNotes());
    expect(result.current.notes).toEqual([]);
    expect(result.current.selectedId).toBeNull();
  });

  it('createNote adds a note and selects it', () => {
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.createNote();
    });
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.selectedId).toBe(result.current.notes[0].id);
  });

  it('createNote sets empty title and content', () => {
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.createNote();
    });
    expect(result.current.notes[0].title).toBe('');
    expect(result.current.notes[0].content).toBe('');
  });

  it('updateNote patches title and content', () => {
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.createNote();
    });
    const id = result.current.notes[0].id;
    act(() => {
      result.current.updateNote(id, { title: 'My Title', content: 'My Content' });
    });
    const note = result.current.notes.find((n) => n.id === id)!;
    expect(note.title).toBe('My Title');
    expect(note.content).toBe('My Content');
  });

  it('updateNote updates updatedAt timestamp', () => {
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.createNote();
    });
    const id = result.current.notes[0].id;
    const originalUpdatedAt = result.current.notes[0].updatedAt;
    act(() => {
      result.current.updateNote(id, { title: 'Changed' });
    });
    const note = result.current.notes.find((n) => n.id === id)!;
    expect(note.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
  });

  it('deleteNote removes the note', () => {
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.createNote();
    });
    const id = result.current.notes[0].id;
    act(() => {
      result.current.deleteNote(id);
    });
    expect(result.current.notes).toHaveLength(0);
  });

  it('deleteNote clears selection when selected note is deleted', () => {
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.createNote();
    });
    const id = result.current.selectedId!;
    act(() => {
      result.current.deleteNote(id);
    });
    expect(result.current.selectedId).toBeNull();
  });

  it('deleteNote selects next note when selected is deleted', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNotes());
    act(() => { result.current.createNote(); });
    const firstId = result.current.notes[0].id;
    vi.advanceTimersByTime(1);
    act(() => { result.current.createNote(); });
    const secondId = result.current.notes[0].id; // most recent note is at index 0
    act(() => { result.current.selectNote(secondId); });
    act(() => { result.current.deleteNote(secondId); });
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.selectedId).toBe(firstId);
    vi.useRealTimers();
  });

  it('notes are sorted by updatedAt descending', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNotes());
    act(() => { result.current.createNote(); });
    const firstId = result.current.notes[0].id;
    vi.advanceTimersByTime(1);
    act(() => { result.current.createNote(); });
    const secondId = result.current.notes[0].id; // second note is most recent
    vi.advanceTimersByTime(1);
    // Update the first note so it becomes more recent
    act(() => { result.current.updateNote(firstId, { title: 'Updated' }); });
    expect(result.current.notes[0].id).toBe(firstId);
    expect(result.current.notes[1].id).toBe(secondId);
    vi.useRealTimers();
  });

  it('selectNote sets selectedId', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useNotes());
    act(() => { result.current.createNote(); });
    vi.advanceTimersByTime(1);
    act(() => { result.current.createNote(); });
    const targetId = result.current.notes[1].id;
    act(() => { result.current.selectNote(targetId); });
    expect(result.current.selectedId).toBe(targetId);
    vi.useRealTimers();
  });

  it('persists notes to IndexedDB on create', async () => {
    const { result } = renderHook(() => useNotes());
    act(() => {
      result.current.createNote();
    });
    const repo = await getRepository();
    await repo.flushWrites();
    const stored = await repo.getAllNotes();
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('');
  });

  it('hydrates notes from IndexedDB on mount', async () => {
    const repo = await getRepository();
    await repo.putNote(makeNote({ id: 'seed-1', title: 'Seeded note' }));
    await repo.putNote(
      makeNote({ id: 'seed-2', title: 'Newer seeded note', updatedAt: 2000 })
    );

    const { result } = renderHook(() => useNotes());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.notes.map((n) => n.title)).toEqual([
      'Newer seeded note',
      'Seeded note',
    ]);
    expect(result.current.savedNoteCount).toBe(2);
  });

  it('persists updates and deletes to IndexedDB', async () => {
    const repo = await getRepository();
    await repo.putNote(makeNote({ id: 'seed-1' }));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.updateNote('seed-1', { title: 'Updated' });
    });
    act(() => {
      result.current.deleteNote('seed-1');
    });
    await repo.flushWrites();
    expect(await repo.getAllNotes()).toHaveLength(0);
  });

  it('refreshNotes does not overwrite mutations made during the read', async () => {
    const repo = await getRepository();
    await repo.putNote(makeNote({ id: 'seed-1', title: 'Seeded note' }));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const refresh = result.current.refreshNotes();
    act(() => {
      result.current.createNote('Created during refresh');
    });
    await refresh;

    // The created note must survive: if the guard failed, the stale read
    // would have overwritten state back to just the seeded note.
    const titles = result.current.notes.map((n) => n.title);
    expect(titles).toContain('Created during refresh');
    expect(titles).toContain('Seeded note');
  });

  it('exposes a load error instead of loading forever when storage fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      open: () => {
        throw new Error('storage unavailable');
      },
    };
    resetRepositoryForTests();

    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.loadError).toBeTruthy());
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useNotes write failure recovery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('tracks pending writes while a write is in flight', async () => {
    const repo = await getRepository();
    let resolveWrite!: () => void;
    vi.spyOn(repo, 'putNote').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    );
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.createNote();
    });
    await waitFor(() => expect(result.current.pendingWrites).toBe(1));
    expect(result.current.savedNoteCount).toBe(0);
    await act(async () => {
      resolveWrite();
    });
    await waitFor(() => expect(result.current.pendingWrites).toBe(0));
    expect(result.current.savedNoteCount).toBe(1);
    expect(result.current.failedWrites).toHaveLength(0);
  });

  it('reports a failed create and keeps it out of durable storage', async () => {
    const repo = await getRepository();
    const spy = vi
      .spyOn(repo, 'putNote')
      .mockRejectedValue(new Error('injected write failure'));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.createNote('Draft');
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(1));
    expect(result.current.failedWrites[0]).toMatchObject({
      kind: 'create',
      noteTitle: 'Draft',
    });
    expect(result.current.pendingWrites).toBe(0);
    // Optimistic state shows the note; durable storage and its count do not.
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.savedNoteCount).toBe(0);
    expect(await repo.getAllNotes()).toHaveLength(0);
    spy.mockRestore();
  });

  it('retrying a failed create persists the latest in-tab state', async () => {
    const repo = await getRepository();
    const putSpy = vi
      .spyOn(repo, 'putNote')
      .mockRejectedValue(new Error('injected write failure'));
    const saveSpy = vi
      .spyOn(repo, 'saveNoteWithRevision')
      .mockRejectedValue(new Error('injected write failure'));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.createNote('Draft');
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(1));
    const id = result.current.notes[0].id;

    // The user keeps typing after the failure; retry must not lose it.
    act(() => {
      result.current.updateNote(id, { content: 'typed after failure' });
    });
    await waitFor(() =>
      expect(result.current.failedWrites).toHaveLength(1)
    );

    putSpy.mockRestore();
    saveSpy.mockRestore();
    act(() => {
      result.current.retryWrite(id);
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(0));
    await repo.flushWrites();
    const stored = await repo.getAllNotes();
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('typed after failure');
  });

  it('discarding a failed create drops the note and fixes selection', async () => {
    const repo = await getRepository();
    const spy = vi
      .spyOn(repo, 'putNote')
      .mockRejectedValue(new Error('injected write failure'));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.createNote('Draft');
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(1));
    const id = result.current.notes[0].id;
    spy.mockRestore();

    await act(async () => {
      await result.current.discardFailedWrite(id);
    });
    expect(result.current.notes).toHaveLength(0);
    expect(result.current.selectedId).toBeNull();
    expect(result.current.failedWrites).toHaveLength(0);
  });

  it('a failed update is not durable until retried', async () => {
    const repo = await getRepository();
    await repo.putNote(makeNote({ id: 'seed-1', title: 'Original' }));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const spy = vi
      .spyOn(repo, 'saveNoteWithRevision')
      .mockRejectedValue(new Error('injected write failure'));
    act(() => {
      result.current.updateNote('seed-1', { title: 'Edited' });
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(1));
    expect(result.current.failedWrites[0].kind).toBe('update');
    // Optimistic UI shows the edit; durable storage still has the old title.
    expect(result.current.notes[0].title).toBe('Edited');
    expect((await repo.getAllNotes())[0].title).toBe('Original');

    spy.mockRestore();
    act(() => {
      result.current.retryWrite('seed-1');
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(0));
    await repo.flushWrites();
    expect((await repo.getAllNotes())[0].title).toBe('Edited');
  });

  it('a failed update is not presented as durable after a reload', async () => {
    const repo = await getRepository();
    await repo.putNote(makeNote({ id: 'seed-1', title: 'Original' }));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const spy = vi
      .spyOn(repo, 'saveNoteWithRevision')
      .mockRejectedValue(new Error('injected write failure'));
    act(() => {
      result.current.updateNote('seed-1', { title: 'Edited' });
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(1));
    spy.mockRestore();

    // Reload: a fresh hook over the same database must show the durable
    // value, not the failed edit.
    const { result: reloaded } = renderHook(() => useNotes());
    await waitFor(() => expect(reloaded.current.isLoading).toBe(false));
    expect(reloaded.current.notes[0].title).toBe('Original');

    // Discard reverts the first hook's optimistic state to match.
    await act(async () => {
      await result.current.discardFailedWrite('seed-1');
    });
    expect(result.current.notes[0].title).toBe('Original');
  });

  it('a failed delete keeps the note durable; retry completes the delete', async () => {
    const repo = await getRepository();
    await repo.putNote(makeNote({ id: 'seed-1', title: 'Doomed' }));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const spy = vi
      .spyOn(repo, 'deleteNoteWithRevision')
      .mockRejectedValue(new Error('injected write failure'));
    act(() => {
      result.current.deleteNote('seed-1');
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(1));
    expect(result.current.failedWrites[0]).toMatchObject({
      kind: 'delete',
      noteTitle: 'Doomed',
    });
    // Optimistically gone from the UI, but still durable and counted.
    expect(result.current.notes).toHaveLength(0);
    expect(result.current.savedNoteCount).toBe(1);
    expect(await repo.getAllNotes()).toHaveLength(1);

    spy.mockRestore();
    act(() => {
      result.current.retryWrite('seed-1');
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(0));
    await repo.flushWrites();
    await waitFor(() => expect(result.current.savedNoteCount).toBe(0));
    expect(await repo.getAllNotes()).toHaveLength(0);
  });

  it('discarding a failed delete restores the note', async () => {
    const repo = await getRepository();
    await repo.putNote(makeNote({ id: 'seed-1', title: 'Keeper' }));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const spy = vi
      .spyOn(repo, 'deleteNoteWithRevision')
      .mockRejectedValue(new Error('injected write failure'));
    act(() => {
      result.current.deleteNote('seed-1');
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(1));
    spy.mockRestore();

    await act(async () => {
      await result.current.discardFailedWrite('seed-1');
    });
    expect(result.current.failedWrites).toHaveLength(0);
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].title).toBe('Keeper');
  });

  it('a later successful write heals an earlier failure record', async () => {
    const repo = await getRepository();
    const spy = vi
      .spyOn(repo, 'putNote')
      .mockRejectedValue(new Error('injected write failure'));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.createNote('Draft');
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(1));
    const id = result.current.notes[0].id;
    spy.mockRestore();

    // The next successful save makes the note durable, clearing the failure.
    act(() => {
      result.current.updateNote(id, { title: 'Healed' });
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(0));
    await repo.flushWrites();
    expect((await repo.getAllNotes())[0].title).toBe('Healed');
  });

  it('discard keeps the failure visible when reconciliation fails', async () => {
    const repo = await getRepository();
    const saveSpy = vi
      .spyOn(repo, 'saveNoteWithRevision')
      .mockRejectedValue(new Error('injected write failure'));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => {
      result.current.createNote('Draft');
    });
    const id = result.current.notes[0].id;
    await waitFor(() => expect(result.current.pendingWrites).toBe(0));

    act(() => {
      result.current.updateNote(id, { content: 'unsaved edit' });
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(1));
    saveSpy.mockRestore();

    // Storage is still unavailable when the user chooses Discard: the banner
    // must stay and the optimistic state must not be presented as reconciled.
    const readSpy = vi
      .spyOn(repo, 'getAllNotes')
      .mockRejectedValue(new Error('read unavailable'));
    await act(async () => {
      await result.current.discardFailedWrite(id);
    });
    expect(result.current.failedWrites).toHaveLength(1);
    expect(result.current.notes.find((n) => n.id === id)?.content).toBe(
      'unsaved edit'
    );
    readSpy.mockRestore();
  });

  it('discard settles outstanding writes before reconciling', async () => {
    const repo = await getRepository();
    await repo.putNote(makeNote({ id: 'seed-1', title: 'Original', content: '' }));
    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.notes).toHaveLength(1));

    const realSave = repo.saveNoteWithRevision;
    const saveSpy = vi.spyOn(repo, 'saveNoteWithRevision');
    saveSpy.mockRejectedValueOnce(new Error('injected write failure'));
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => (releaseSecond = resolve));
    saveSpy.mockImplementationOnce(async (previous, next) => {
      await secondGate;
      return realSave(previous, next);
    });

    act(() => {
      result.current.updateNote('seed-1', { content: 'first edit' });
    });
    await waitFor(() => expect(result.current.failedWrites).toHaveLength(1));
    act(() => {
      result.current.updateNote('seed-1', { content: 'second edit' });
    });

    // Discard while the later save is still queued: the reconciliation must
    // not read a stale durable value that the queued save then overwrites.
    await act(async () => {
      const discard = result.current.discardFailedWrite('seed-1');
      releaseSecond();
      await discard;
    });
    expect(result.current.failedWrites).toHaveLength(0);
    expect(result.current.notes[0].content).toBe('second edit');
    expect((await repo.getAllNotes())[0].content).toBe('second edit');
  });
});

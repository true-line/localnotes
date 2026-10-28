import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNotes } from '../hooks/useNotes';
import { getRepository } from '../storage';
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
});

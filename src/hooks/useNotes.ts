import { useState, useEffect, useCallback, useRef } from 'react';
import type { Note } from '../types';
import { getRepository, type NotesRepository } from '../storage';

function sortByUpdated(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  // Bumped on every local mutation; async refreshes compare against it so a
  // read that raced with an edit never overwrites newer optimistic state.
  const mutationCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const repo = await getRepository();
        const all = await repo.getAllNotes();
        if (cancelled) return;
        if (mutationCountRef.current === 0) {
          setNotes(sortByUpdated(all));
        }
        setIsLoading(false);
      } catch (err) {
        // Storage is unavailable or the legacy migration failed; the vault
        // itself is untouched. App shows a recoverable error screen.
        console.error('localnotes: failed to open notes database', err);
        if (!cancelled) {
          setLoadError(err);
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    (op: (repo: NotesRepository) => Promise<unknown>) => {
      getRepository()
        .then(op)
        .catch((err) => console.error('localnotes: write failed', err));
    },
    []
  );

  const refreshNotes = useCallback(async () => {
    const baseline = mutationCountRef.current;
    const repo = await getRepository();
    const all = await repo.getAllNotes();
    if (mutationCountRef.current !== baseline) {
      // A mutation happened during the read; its own state update stands.
      return;
    }
    setNotes(sortByUpdated(all));
  }, []);

  const createNote = useCallback((initialTitle?: string | unknown) => {
    const now = Date.now();
    const title = typeof initialTitle === 'string' ? initialTitle : '';
    const note: Note = {
      id: crypto.randomUUID(),
      title,
      content: '',
      createdAt: now,
      updatedAt: now,
    };
    mutationCountRef.current += 1;
    setNotes((prev) => sortByUpdated([note, ...prev]));
    setSelectedId(note.id);
    persist((repo) => repo.putNote(note));
    return note;
  }, [persist]);

  const updateNote = useCallback(
    (id: string, fields: Partial<Pick<Note, 'title' | 'content'>>) => {
      const previous = notes.find((n) => n.id === id);
      if (!previous) return;
      const next: Note = { ...previous, ...fields, updatedAt: Date.now() };
      mutationCountRef.current += 1;
      setNotes(sortByUpdated(notes.map((n) => (n.id === id ? next : n))));
      persist((repo) => repo.saveNoteWithRevision(previous, next));
    },
    [notes, persist]
  );

  const deleteNote = useCallback(
    (id: string) => {
      const previous = notes.find((n) => n.id === id);
      if (!previous) return;
      const updated = notes.filter((n) => n.id !== id);
      mutationCountRef.current += 1;
      setNotes(updated);
      if (selectedId === id) {
        setSelectedId(updated.length > 0 ? updated[0].id : null);
      }
      persist((repo) => repo.deleteNoteWithRevision(previous));
    },
    [notes, selectedId, persist]
  );

  const selectNote = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;

  return {
    notes,
    selectedId,
    selectedNote,
    isLoading,
    loadError,
    createNote,
    updateNote,
    deleteNote,
    selectNote,
    refreshNotes,
  };
}

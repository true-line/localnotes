import { useState, useEffect, useCallback } from 'react';
import type { Note } from '../types';
import { getRepository } from '../storage';

function sortByUpdated(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const repo = await getRepository();
      const all = await repo.getAllNotes();
      if (cancelled) return;
      setNotes(sortByUpdated(all));
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshNotes = useCallback(async () => {
    const repo = await getRepository();
    setNotes(sortByUpdated(await repo.getAllNotes()));
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
    setNotes((prev) => sortByUpdated([note, ...prev]));
    setSelectedId(note.id);
    void getRepository().then((repo) => repo.putNote(note));
    return note;
  }, []);

  const updateNote = useCallback(
    (id: string, fields: Partial<Pick<Note, 'title' | 'content'>>) => {
      const previous = notes.find((n) => n.id === id);
      if (!previous) return;
      const next: Note = { ...previous, ...fields, updatedAt: Date.now() };
      setNotes(sortByUpdated(notes.map((n) => (n.id === id ? next : n))));
      void getRepository().then((repo) =>
        repo.saveNoteWithRevision(previous, next)
      );
    },
    [notes]
  );

  const deleteNote = useCallback(
    (id: string) => {
      const previous = notes.find((n) => n.id === id);
      const updated = notes.filter((n) => n.id !== id);
      setNotes(updated);
      if (selectedId === id) {
        setSelectedId(updated.length > 0 ? updated[0].id : null);
      }
      void (async () => {
        const repo = await getRepository();
        if (previous) await repo.deleteNoteWithRevision(previous);
      })();
    },
    [notes, selectedId]
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
    createNote,
    updateNote,
    deleteNote,
    selectNote,
    refreshNotes,
  };
}

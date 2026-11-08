import { useState, useEffect, useCallback, useRef } from 'react';
import type { Note } from '../types';
import { getRepository, type NotesRepository } from '../storage';

function sortByUpdated(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
}

export type FailedWriteKind = 'create' | 'update' | 'delete';

export interface FailedWrite {
  noteId: string;
  kind: FailedWriteKind;
  /** Title at the time of the failure, so the UI can name the note even after
      a failed delete removed it from the list. */
  noteTitle: string;
}

interface FailedWriteOp {
  kind: FailedWriteKind;
  noteTitle: string;
  /** Durable-base snapshot for update retries, or the deleted note for delete
      retries. Absent for creates (nothing durable to base on). */
  previous?: Note;
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [failedWrites, setFailedWrites] = useState<FailedWrite[]>([]);
  // Bumped on every local mutation; async refreshes compare against it so a
  // read that raced with an edit never overwrites newer optimistic state.
  const mutationCountRef = useRef(0);
  // What to re-run for each failed write, keyed by note id.
  const failedOpsRef = useRef(new Map<string, FailedWriteOp>());
  // Latest notes for retry/discard callbacks, which run outside render.
  const notesRef = useRef<Note[]>([]);
  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

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

  /**
   * Runs one durable write for an optimistic mutation. Failures are recorded
   * per note (not just logged) so the UI can surface them and offer recovery;
   * a later successful write for the same note heals the record, because the
   * note is then durable in a newer form.
   */
  const runWrite = useCallback(
    (
      noteId: string,
      kind: FailedWriteKind,
      op: (repo: NotesRepository) => Promise<unknown>,
      context: { noteTitle: string; previous?: Note }
    ) => {
      setPendingWrites((count) => count + 1);
      getRepository()
        .then(op)
        .then(() => {
          if (failedOpsRef.current.delete(noteId)) {
            setFailedWrites((prev) =>
              prev.filter((f) => f.noteId !== noteId)
            );
          }
        })
        .catch((err) => {
          console.error('localnotes: write failed', err);
          const existing = failedOpsRef.current.get(noteId);
          // Keep the earliest durable base for a note: later optimistic edits
          // are recovered from live state, not from this entry. A failed
          // delete always replaces the entry — the note must end up deleted.
          if (!existing || kind === 'delete') {
            failedOpsRef.current.set(noteId, {
              kind,
              noteTitle: context.noteTitle,
              previous: context.previous,
            });
          }
          const recorded = failedOpsRef.current.get(noteId)!;
          setFailedWrites((prev) => [
            ...prev.filter((f) => f.noteId !== noteId),
            { noteId, kind: recorded.kind, noteTitle: recorded.noteTitle },
          ]);
        })
        .finally(() => {
          setPendingWrites((count) => Math.max(0, count - 1));
        });
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

  /**
   * Re-runs a failed write. Creates and updates persist the note's LATEST
   * in-tab state, so edits typed after the failure are not lost.
   */
  const retryWrite = useCallback(
    (noteId: string) => {
      const failed = failedOpsRef.current.get(noteId);
      if (!failed) return;
      failedOpsRef.current.delete(noteId);
      setFailedWrites((prev) => prev.filter((f) => f.noteId !== noteId));
      if (failed.kind === 'delete') {
        const target = failed.previous;
        if (!target) return;
        runWrite(noteId, 'delete', (repo) => repo.deleteNoteWithRevision(target), {
          noteTitle: failed.noteTitle,
          previous: target,
        });
        return;
      }
      const current = notesRef.current.find((n) => n.id === noteId);
      if (!current) return; // note was deleted since; nothing left to save
      if (failed.kind === 'create' || !failed.previous) {
        runWrite(noteId, 'create', (repo) => repo.putNote(current), {
          noteTitle: current.title,
        });
      } else {
        const previous = failed.previous;
        runWrite(
          noteId,
          'update',
          (repo) => repo.saveNoteWithRevision(previous, current),
          { noteTitle: current.title, previous }
        );
      }
    },
    [runWrite]
  );

  /**
   * Gives up on a failed write and reconciles the optimistic state with what
   * is actually durable: a failed create drops the note, a failed update
   * reverts to the stored version, a failed delete brings the note back.
   * Outstanding queued writes settle BEFORE the durable read, so a later
   * queued save cannot silently commit after the reconciliation. The failure
   * stays visible until reconciliation succeeds — a failed read must not
   * present unreconciled state as resolved.
   */
  const discardFailedWrite = useCallback(async (noteId: string) => {
    try {
      const repo = await getRepository();
      await repo.settleWrites();
      const failed = failedOpsRef.current.get(noteId);
      if (!failed) return; // healed by a queued successful write meanwhile
      const durable =
        (await repo.getAllNotes()).find((n) => n.id === noteId) ?? null;
      mutationCountRef.current += 1;
      if (failed.kind === 'delete') {
        if (durable) {
          setNotes((prev) => sortByUpdated([...prev, durable]));
        }
      } else if (failed.kind === 'create' || !durable) {
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        setSelectedId((prev) => {
          if (prev !== noteId) return prev;
          const remaining = notesRef.current.filter((n) => n.id !== noteId);
          return remaining.length > 0 ? remaining[0].id : null;
        });
      } else {
        setNotes((prev) =>
          sortByUpdated(prev.map((n) => (n.id === noteId ? durable : n)))
        );
      }
      // Only clear when the record is still the one we reconciled; a newer
      // failure for the same note keeps its own banner and queue record.
      if (failedOpsRef.current.get(noteId) === failed) {
        failedOpsRef.current.delete(noteId);
        setFailedWrites((prev) => prev.filter((f) => f.noteId !== noteId));
        repo.acknowledgeNoteWrites(noteId);
      }
    } catch (err) {
      console.error('localnotes: failed to reconcile with storage', err);
    }
  }, []);

  const createNote = useCallback(
    (initialTitle?: string | unknown, initialContent?: string) => {
      const now = Date.now();
      const title = typeof initialTitle === 'string' ? initialTitle : '';
      const note: Note = {
        id: crypto.randomUUID(),
        title,
        content: typeof initialContent === 'string' ? initialContent : '',
        createdAt: now,
        updatedAt: now,
      };
      mutationCountRef.current += 1;
      setNotes((prev) => sortByUpdated([note, ...prev]));
      setSelectedId(note.id);
      runWrite(note.id, 'create', (repo) => repo.putNote(note), {
        noteTitle: note.title,
      });
      return note;
    },
    [runWrite]
  );

  const updateNote = useCallback(
    (id: string, fields: Partial<Pick<Note, 'title' | 'content'>>) => {
      const previous = notes.find((n) => n.id === id);
      if (!previous) return;
      const next: Note = { ...previous, ...fields, updatedAt: Date.now() };
      mutationCountRef.current += 1;
      setNotes(sortByUpdated(notes.map((n) => (n.id === id ? next : n))));
      runWrite(id, 'update', (repo) => repo.saveNoteWithRevision(previous, next), {
        noteTitle: next.title,
        previous,
      });
    },
    [notes, runWrite]
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
      runWrite(id, 'delete', (repo) => repo.deleteNoteWithRevision(previous), {
        noteTitle: previous.title,
        previous,
      });
    },
    [notes, selectedId, runWrite]
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
    pendingWrites,
    failedWrites,
    createNote,
    updateNote,
    deleteNote,
    selectNote,
    refreshNotes,
    retryWrite,
    discardFailedWrite,
  };
}

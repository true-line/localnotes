import type { Note, NoteRevision } from './types';
import {
  EMBEDDING_STORAGE_KEY,
  type EmbeddingCacheStore,
} from './embeddings';

const LEGACY_NOTES_KEY = 'localnotes';
const DB_NAME = 'localnotes';
const DB_VERSION = 1;
const LEGACY_MIGRATION_KEY = 'legacy-localstorage-migration';

/** Revisions kept per note (oldest trimmed first). */
export const REVISION_CAP_PER_NOTE = 20;
/** A new revision snapshot is taken at most this often per note. */
export const REVISION_MIN_INTERVAL_MS = 5 * 60 * 1000;

export interface NotesRepository {
  getAllNotes(): Promise<Note[]>;
  putNote(note: Note): Promise<void>;
  putNotes(notes: Note[]): Promise<void>;
  deleteNote(id: string): Promise<void>;
  /** Atomically snapshots `previous` then persists `next`. */
  saveNoteWithRevision(previous: Note, next: Note): Promise<void>;
  /** Atomically snapshots `note` then deletes it. */
  deleteNoteWithRevision(note: Note): Promise<void>;
  /** Snapshots the note unless one was already taken inside the interval window. */
  maybeSnapshotRevision(note: Note): Promise<void>;
  snapshotRevision(note: Note): Promise<void>;
  getRevisions(noteId: string): Promise<NoteRevision[]>;
  replaceRevisions(noteId: string, revisions: NoteRevision[]): Promise<void>;
  replaceEmbeddings(cache: EmbeddingCacheStore): Promise<void>;
  getAllEmbeddings(): Promise<EmbeddingCacheStore>;
  clearEmbeddings(): Promise<void>;
  /** Resolves once every queued write has been persisted. */
  flushWrites(): Promise<void>;
}

export interface ExportArchive {
  app: 'localnotes';
  version: 1;
  exportedAt: number;
  notes: Note[];
  revisions?: Record<string, NoteRevision[]>;
}

export interface ImportResult {
  imported: number;
  skipped: number;
}

export function isNote(value: unknown): value is Note {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    v.id.trim() !== '' &&
    typeof v.title === 'string' &&
    typeof v.content === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.updatedAt === 'number'
  );
}

function isNoteRevision(value: unknown): value is NoteRevision {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.noteId === 'string' &&
    typeof v.at === 'number' &&
    isNote(v.snapshot)
  );
}

/**
 * Reads notes from the legacy `localStorage` key. Kept as the one-time
 * migration source only — the app never writes notes here anymore. Defensive
 * as before: corrupt JSON or non-array values recover to empty, and entries
 * that are not note-shaped are filtered out.
 */
export function loadLegacyNotes(): Note[] {
  try {
    const raw = localStorage.getItem(LEGACY_NOTES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isNote);
  } catch {
    return [];
  }
}

let repoPromise: Promise<NotesRepository> | null = null;

export function getRepository(): Promise<NotesRepository> {
  if (!repoPromise) {
    repoPromise = openRepository().catch((err) => {
      repoPromise = null;
      throw err;
    });
  }
  return repoPromise;
}

/** Test-only: drops the cached repository so the next getRepository() reopens. */
export function resetRepositoryForTests(): void {
  repoPromise = null;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('revisions')) {
        const revisions = db.createObjectStore('revisions', {
          keyPath: 'id',
          autoIncrement: true,
        });
        revisions.createIndex('byNote', 'noteId');
      }
      if (!db.objectStoreNames.contains('embeddings')) {
        db.createObjectStore('embeddings', { keyPath: 'noteId' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('failed to open localnotes database'));
    request.onblocked = () =>
      reject(new Error('localnotes database open is blocked by another tab'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('indexedDB request failed'));
  });
}

/**
 * Serializes all write operations so fire-and-forget callers can still be
 * awaited via flushWrites() and never interleave transactions.
 */
function createWriteQueue() {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    enqueue<T>(op: () => Promise<T>): Promise<T> {
      const next = chain.then(op, op);
      chain = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    flush(): Promise<void> {
      return chain.then(() => undefined);
    },
  };
}

async function openRepository(): Promise<NotesRepository> {
  const db = await openDatabase();
  const queue = createWriteQueue();

  const tx = (stores: string[], mode: IDBTransactionMode) =>
    db.transaction(stores, mode);

  const metaGet = async (key: string): Promise<unknown> => {
    const store = tx(['meta'], 'readonly').objectStore('meta');
    const record = (await requestToPromise(store.get(key))) as
      | { key: string; value: unknown }
      | undefined;
    return record?.value;
  };

  const metaPut = (key: string, value: unknown): Promise<void> =>
    queue.enqueue(() => {
      const store = tx(['meta'], 'readwrite').objectStore('meta');
      return requestToPromise(store.put({ key, value })).then(() => undefined);
    });

  /**
   * One-time import of the legacy localStorage vault. Corrupt legacy data
   * recovers to empty (never blocks startup); keys are removed afterwards so
   * a stale vault can never resurrect. Runs before the repository resolves.
   */
  const migrateLegacyStorage = async (): Promise<void> => {
    if ((await metaGet(LEGACY_MIGRATION_KEY)) === true) return;
    const legacy = loadLegacyNotes();
    if (legacy.length > 0) {
      const store = tx(['notes'], 'readwrite').objectStore('notes');
      await Promise.all(legacy.map((note) => requestToPromise(store.put(note))));
    }
    try {
      localStorage.removeItem(LEGACY_NOTES_KEY);
      localStorage.removeItem(EMBEDDING_STORAGE_KEY);
    } catch {
      // ignore storage access errors
    }
    await metaPut(LEGACY_MIGRATION_KEY, true);
  };

  await migrateLegacyStorage();

  const putNotesRaw = (notes: Note[]): Promise<void> => {
    const store = tx(['notes'], 'readwrite').objectStore('notes');
    return Promise.all(
      notes.map((note) => requestToPromise(store.put(note)))
    ).then(() => undefined);
  };

  const putNotes = (notes: Note[]): Promise<void> =>
    queue.enqueue(() => putNotesRaw(notes));

  const deleteNoteRaw = (id: string): Promise<void> => {
    const store = tx(['notes'], 'readwrite').objectStore('notes');
    return requestToPromise(store.delete(id)).then(() => undefined);
  };

  const getRevisions = async (noteId: string): Promise<NoteRevision[]> => {
    const index = tx(['revisions'], 'readonly')
      .objectStore('revisions')
      .index('byNote');
    const rows = (await requestToPromise(index.getAll(noteId))) as unknown[];
    return rows
      .filter(isNoteRevision)
      .sort((a, b) => b.at - a.at);
  };

  const snapshotRevisionRaw = async (note: Note): Promise<void> => {
    const revisions = tx(['revisions'], 'readwrite').objectStore('revisions');
    await requestToPromise(
      revisions.put({ noteId: note.id, snapshot: note, at: Date.now() })
    );
    const all = await getRevisions(note.id);
    const stale = all.slice(REVISION_CAP_PER_NOTE);
    if (stale.length === 0) return;
    const store = tx(['revisions'], 'readwrite').objectStore('revisions');
    await Promise.all(
      stale.map((rev) => {
        if (typeof rev.id !== 'number') return Promise.resolve();
        return requestToPromise(store.delete(rev.id));
      })
    );
  };

  // Reads are serialized with writes inside the queue so compound
  // mutations (snapshot + write, snapshot + delete) cannot interleave
  // and resurrect notes that a later queued operation already deleted.
  const snapshotRevision = (note: Note): Promise<void> =>
    queue.enqueue(() => snapshotRevisionRaw(note));

  const maybeSnapshotRevision = (note: Note): Promise<void> =>
    queue.enqueue(async () => {
      const latest = (await getRevisions(note.id))[0];
      if (latest && Date.now() - latest.at < REVISION_MIN_INTERVAL_MS) return;
      await snapshotRevisionRaw(note);
    });

  const saveNoteWithRevision = (previous: Note, next: Note): Promise<void> =>
    queue.enqueue(async () => {
      // Throttled: edits are per-keystroke, revisions are not
      const latest = (await getRevisions(previous.id))[0];
      if (!(latest && Date.now() - latest.at < REVISION_MIN_INTERVAL_MS)) {
        await snapshotRevisionRaw(previous);
      }
      await putNotesRaw([next]);
    });

  const deleteNoteWithRevision = (note: Note): Promise<void> =>
    queue.enqueue(async () => {
      await snapshotRevisionRaw(note);
      await deleteNoteRaw(note.id);
    });

  return {
    async getAllNotes() {
      const store = tx(['notes'], 'readonly').objectStore('notes');
      const rows = (await requestToPromise(store.getAll())) as unknown[];
      return rows.filter(isNote);
    },

    putNote(note: Note) {
      return putNotes([note]);
    },

    putNotes,

    deleteNote(id: string) {
      return queue.enqueue(() => deleteNoteRaw(id));
    },

    saveNoteWithRevision,

    deleteNoteWithRevision,

    snapshotRevision(note: Note) {
      return snapshotRevision(note);
    },

    maybeSnapshotRevision(note: Note) {
      return maybeSnapshotRevision(note);
    },

    getRevisions,

    replaceRevisions(noteId: string, revisions: NoteRevision[]) {
      const valid = revisions.filter(isNoteRevision);
      return queue.enqueue(() => {
        const store = tx(['revisions'], 'readwrite').objectStore('revisions');
        const index = store.index('byNote');
        return (async () => {
          const existing = (await requestToPromise(
            index.getAll(noteId)
          )) as Array<{ id?: number }>;
          await Promise.all(
            existing.map((row) => {
              if (typeof row.id !== 'number') return Promise.resolve();
              return requestToPromise(store.delete(row.id));
            })
          );
          await Promise.all(
            valid.slice(0, REVISION_CAP_PER_NOTE).map((rev) =>
              requestToPromise(
                store.put({ noteId, snapshot: rev.snapshot, at: rev.at })
              )
            )
          );
        })();
      });
    },

    replaceEmbeddings(cache: EmbeddingCacheStore) {
      return queue.enqueue(() => {
        const store = tx(['embeddings'], 'readwrite').objectStore('embeddings');
        return (async () => {
          await requestToPromise(store.clear());
          await Promise.all(
            Object.entries(cache).map(([noteId, entry]) =>
              requestToPromise(
                store.put({
                  noteId,
                  hash: entry.hash,
                  vector: Float32Array.from(entry.vector),
                })
              )
            )
          );
        })();
      });
    },

    async getAllEmbeddings() {
      const store = tx(['embeddings'], 'readonly').objectStore('embeddings');
      const rows = (await requestToPromise(store.getAll())) as unknown[];
      const cache: EmbeddingCacheStore = {};
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const v = row as Record<string, unknown>;
        if (typeof v.noteId !== 'string' || typeof v.hash !== 'string') continue;
        // ArrayBuffer.isView instead of instanceof: the vector may come from
        // another realm (jsdom in tests, browser internals), where instanceof
        // against this realm's Float32Array is always false.
        if (!ArrayBuffer.isView(v.vector)) continue;
        const vector = v.vector as unknown as ArrayLike<number>;
        if (vector.length === 0) continue;
        cache[v.noteId] = { hash: v.hash, vector: Array.from(vector) };
      }
      return cache;
    },

    clearEmbeddings() {
      return queue.enqueue(() => {
        const store = tx(['embeddings'], 'readwrite').objectStore('embeddings');
        return requestToPromise(store.clear()).then(() => undefined);
      });
    },

    flushWrites: () => {
      // Fire-and-forget callers enqueue their write one microtask after the
      // mutation call; yield one turn so everything already requested is in
      // the chain, then wait for the whole chain.
      return queue
        .enqueue(async () => {
          await Promise.resolve();
        })
        .then(() => queue.flush());
    },
  };
}

export async function exportVault(): Promise<ExportArchive> {
  const repo = await getRepository();
  await repo.flushWrites();
  const notes = await repo.getAllNotes();
  const revisions: Record<string, NoteRevision[]> = {};
  for (const note of notes) {
    revisions[note.id] = await repo.getRevisions(note.id);
  }
  return {
    app: 'localnotes',
    version: 1,
    exportedAt: Date.now(),
    notes,
    revisions,
  };
}

/**
 * Imports a JSON archive, merging by note id (upsert) so an import can never
 * silently destroy existing notes. Malformed archives throw; invalid entries
 * are skipped and counted.
 */
export async function importVault(text: string): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('import failed: file is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('import failed: not a LocalNotes archive');
  }
  const archive = parsed as Record<string, unknown>;
  if (archive.app !== 'localnotes' || !Array.isArray(archive.notes)) {
    throw new Error('import failed: not a LocalNotes archive');
  }

  const candidates = archive.notes as unknown[];
  const valid = candidates.filter(isNote);
  const repo = await getRepository();
  await repo.flushWrites();
  await repo.putNotes(valid);

  const importedIds = new Set(valid.map((note) => note.id));
  const revisions = archive.revisions;
  if (revisions && typeof revisions === 'object' && !Array.isArray(revisions)) {
    for (const [noteId, list] of Object.entries(
      revisions as Record<string, unknown>
    )) {
      if (!importedIds.has(noteId) || !Array.isArray(list)) continue;
      await repo.replaceRevisions(noteId, list as NoteRevision[]);
    }
  }

  return { imported: valid.length, skipped: candidates.length - valid.length };
}

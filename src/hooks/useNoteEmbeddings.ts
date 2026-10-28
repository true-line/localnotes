import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Note, EmbeddingMap, EmbeddingStatus } from '../types';
import {
  getNoteEmbedText,
  hashText,
  embedText,
  computeLocalSemanticEmbedding,
  type EmbeddingCacheStore,
} from '../embeddings';
import { getRepository } from '../storage';

export function useNoteEmbeddings(notes: Note[], debounceMs = 60) {
  const [cache, setCache] = useState<EmbeddingCacheStore>({});
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<EmbeddingStatus>('idle');
  const [reindexTrigger, setReindexTrigger] = useState(0);
  const modelLoadedRef = useRef(false);

  // Hydrate the embedding cache from IndexedDB before any indexing runs,
  // so already-computed vectors are never recomputed or overwritten.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await getRepository().then((repo) =>
        repo.getAllEmbeddings()
      );
      if (cancelled) return;
      setCache(stored);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reindexEmbeddings = useCallback(() => {
    void getRepository().then((repo) => repo.clearEmbeddings());
    setCache({});
    setReindexTrigger((t) => t + 1);
  }, []);

  // Immediately provide cached neural embeddings or instant local semantic embeddings
  const embeddings: EmbeddingMap = useMemo(() => {
    const map: EmbeddingMap = {};
    for (const note of notes) {
      const text = getNoteEmbedText(note);
      if (!text) continue;
      const hash = hashText(text);
      const entry = cache[note.id];
      if (entry && entry.hash === hash && entry.vector.length > 0) {
        map[note.id] = entry.vector;
      } else {
        map[note.id] = computeLocalSemanticEmbedding(text);
      }
    }
    return map;
  }, [notes, cache]);

  useEffect(() => {
    if (!hydrated) return;

    const pending: Array<{ id: string; text: string; hash: string }> = [];
    let hasNonEmptyNotes = false;

    for (const note of notes) {
      const text = getNoteEmbedText(note);
      if (!text) continue;
      hasNonEmptyNotes = true;
      const hash = hashText(text);
      const cached = cache[note.id];
      if (!cached || cached.hash !== hash || cached.vector.length === 0) {
        pending.push({ id: note.id, text, hash });
      }
    }

    if (pending.length === 0) {
      setStatus(hasNonEmptyNotes ? 'ready' : 'idle');
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setStatus(modelLoadedRef.current ? 'indexing' : 'loading-model');

      try {
        const updatedCache: EmbeddingCacheStore = { ...cache };
        const validIds = new Set(notes.map((n) => n.id));
        for (const cachedId of Object.keys(updatedCache)) {
          if (!validIds.has(cachedId)) {
            delete updatedCache[cachedId];
          }
        }

        for (const item of pending) {
          if (cancelled) return;
          const vector = await embedText(item.text);
          modelLoadedRef.current = true;
          if (cancelled) return;
          setStatus('indexing');
          if (vector.length > 0) {
            updatedCache[item.id] = { hash: item.hash, vector };
          }
        }

        if (!cancelled) {
          setCache(updatedCache);
          void getRepository().then((repo) =>
            repo.replaceEmbeddings(updatedCache)
          );
          setStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setStatus('ready');
        }
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrated, notes, cache, debounceMs, reindexTrigger]);

  return {
    embeddings,
    embeddingStatus: status,
    reindexEmbeddings,
  };
}

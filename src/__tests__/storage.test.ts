import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLegacyNotes,
  getRepository,
  resetRepositoryForTests,
} from '../storage';
import { EMBEDDING_STORAGE_KEY } from '../embeddings';
import type { Note } from '../types';

const STORAGE_KEY = 'localnotes';

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: '1',
  title: 'Test note',
  content: 'Content',
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
});

describe('loadLegacyNotes', () => {
  it('returns empty array when storage is empty', () => {
    expect(loadLegacyNotes()).toEqual([]);
  });

  it('returns empty array when storage value is null', () => {
    localStorage.removeItem(STORAGE_KEY);
    expect(loadLegacyNotes()).toEqual([]);
  });

  it('returns empty array on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json}}}');
    expect(loadLegacyNotes()).toEqual([]);
  });

  it('returns empty array when stored value is not an array', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ notes: [] }));
    expect(loadLegacyNotes()).toEqual([]);
  });

  it('returns stored notes array', () => {
    const notes = [makeNote()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
    expect(loadLegacyNotes()).toEqual(notes);
  });

  it('filters entries that are not note-shaped', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([makeNote({ id: 'ok' }), { id: 42 }, null, 'junk'])
    );
    expect(loadLegacyNotes()).toEqual([makeNote({ id: 'ok' })]);
  });
});

describe('legacy localStorage migration', () => {
  it('imports legacy notes into IndexedDB and clears the old keys', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([makeNote({ id: 'a' })]));
    localStorage.setItem(
      EMBEDDING_STORAGE_KEY,
      JSON.stringify({ a: { hash: 'h', vector: [1, 2] } })
    );

    const repo = await getRepository();
    expect(await repo.getAllNotes()).toEqual([makeNote({ id: 'a' })]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(EMBEDDING_STORAGE_KEY)).toBeNull();
  });

  it('runs only once — later writes to the legacy key are ignored', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([makeNote({ id: 'a' })]));
    await getRepository();

    localStorage.setItem(STORAGE_KEY, JSON.stringify([makeNote({ id: 'b' })]));
    resetRepositoryForTests();
    const repo = await getRepository();
    const notes = await repo.getAllNotes();
    expect(notes.map((n) => n.id)).toEqual(['a']);
  });

  it('recovers to empty on corrupt legacy JSON and still clears the keys', async () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json}}}');
    const repo = await getRepository();
    expect(await repo.getAllNotes()).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

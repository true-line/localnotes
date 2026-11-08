import { useEffect, useRef, useState, useCallback } from 'react';
import type { Note, EmbeddingMap, EmbeddingStatus } from '../types';
import { normalizeKey } from '../knowledgeGraph';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { MarkdownRenderer } from './MarkdownRenderer';
import { NoteConnections } from './NoteConnections';
import '../styles/NoteEditor.css';

type EditorMode = 'raw' | 'split' | 'reading';

interface Props {
  note: Note;
  allNotes?: Note[];
  embeddings?: EmbeddingMap;
  embeddingStatus?: EmbeddingStatus;
  onUpdate: (id: string, fields: Partial<Pick<Note, 'title' | 'content'>>) => void;
  onDelete: (id: string) => void;
  onSelectNote?: (id: string) => void;
  onCreateConceptNote?: (title: string) => void;
  onOpenGraphNode?: (nodeId: string) => void;
  onReindexEmbeddings?: () => void;
  /** Debounced report of the content-area text selection (for agent context). */
  onSelectionChange?: (selectedText: string) => void;
}

export function NoteEditor({
  note,
  allNotes = [],
  embeddings = {},
  embeddingStatus = 'idle',
  onUpdate,
  onDelete,
  onSelectNote,
  onCreateConceptNote,
  onOpenGraphNode,
  onReindexEmbeddings,
  onSelectionChange,
}: Props) {
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<EditorMode>('raw');
  const prevModeRef = useRef<EditorMode | null>(null);
  const selectionTimerRef = useRef<number | null>(null);

  const reportSelection = useCallback(() => {
    if (!onSelectionChange) return;
    if (selectionTimerRef.current !== null) {
      window.clearTimeout(selectionTimerRef.current);
    }
    selectionTimerRef.current = window.setTimeout(() => {
      const area = contentRef.current;
      if (!area) return;
      const selected =
        area.value.slice(area.selectionStart ?? 0, area.selectionEnd ?? 0);
      onSelectionChange(selected);
    }, 300);
  }, [onSelectionChange]);

  // Reading unmounts the textarea without any select event: the reported
  // selection is gone, so the Selection chip must reset.
  useEffect(() => {
    if (mode === 'reading') onSelectionChange?.('');
  }, [mode, onSelectionChange]);

  useEffect(() => {
    setMode('raw');
    prevModeRef.current = null;
  }, [note.id]);

  useEffect(() => {
    if (note.title === '' && mode !== 'reading') {
      titleRef.current?.focus();
    }
  }, [note.id, note.title, mode]);

  useEffect(() => {
    if (prevModeRef.current === 'reading' && mode !== 'reading') {
      contentRef.current?.focus();
    }
    prevModeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'p') {
        e.preventDefault();
        setMode('reading');
      } else if (e.key === 'e') {
        e.preventDefault();
        setMode('raw');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleWikiLinkClick = useCallback(
    (target: string) => {
      const norm = normalizeKey(target);
      const existing = allNotes.find((n) => normalizeKey(n.title) === norm);
      if (existing) {
        onSelectNote?.(existing.id);
      } else {
        onCreateConceptNote?.(target);
      }
    },
    [allNotes, onSelectNote, onCreateConceptNote]
  );

  const handleTagClick = useCallback(
    (tag: string) => {
      onOpenGraphNode?.(`tag:${tag}`);
    },
    [onOpenGraphNode]
  );

  const debouncedContent = useDebouncedValue(note.content);
  const contentEditor = (
    <textarea
      ref={contentRef}
      className="note-editor__content"
      placeholder="Start writing… (use [[Note or Concept]] and #tags to connect ideas)"
      aria-label="Note content"
      value={note.content}
      onChange={(e) => onUpdate(note.id, { content: e.target.value })}
      onSelect={reportSelection}
      onKeyUp={reportSelection}
    />
  );
  const renderedNote = (
    <div className="note-editor__preview" role="region" aria-label="Note preview">
      <MarkdownRenderer
        content={mode === 'reading' ? note.content : debouncedContent}
        onWikiLinkClick={handleWikiLinkClick}
        onTagClick={handleTagClick}
      />
    </div>
  );

  return (
    <main className="note-editor">
      <div className="note-editor__toolbar">
        <div className="note-editor__mode-toggle" role="group" aria-label="Editor mode">
          <button
            type="button"
            className={`note-editor__mode-btn${mode === 'raw' ? ' note-editor__mode-btn--active' : ''}`}
            aria-pressed={mode === 'raw'}
            onClick={() => setMode('raw')}
          >
            Raw
          </button>
          <button
            type="button"
            className={`note-editor__mode-btn${mode === 'split' ? ' note-editor__mode-btn--active' : ''}`}
            aria-pressed={mode === 'split'}
            onClick={() => setMode('split')}
          >
            Edit + Preview
          </button>
          <button
            type="button"
            className={`note-editor__mode-btn${mode === 'reading' ? ' note-editor__mode-btn--active' : ''}`}
            aria-pressed={mode === 'reading'}
            onClick={() => setMode('reading')}
          >
            Reading
          </button>
        </div>
        <button
          type="button"
          className="note-editor__delete-btn"
          aria-label="Delete note"
          onClick={() => onDelete(note.id)}
        >
          Delete note
        </button>
      </div>
      {mode !== 'reading' ? (
        <input
          ref={titleRef}
          className="note-editor__title"
          type="text"
          placeholder="Note title"
          aria-label="Note title"
          value={note.title}
          onChange={(e) => onUpdate(note.id, { title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              contentRef.current?.focus();
            }
          }}
        />
      ) : (
        <h1 className="note-editor__title note-editor__title--reading">
          {note.title.trim() || 'Untitled'}
        </h1>
      )}
      {mode === 'raw' && contentEditor}
      {mode === 'split' && (
        <div className="note-editor__split">
          {contentEditor}
          {renderedNote}
        </div>
      )}
      {mode === 'reading' && renderedNote}
      <NoteConnections
        note={note}
        allNotes={allNotes}
        embeddings={embeddings}
        embeddingStatus={embeddingStatus}
        onSelectNote={(id) => onSelectNote?.(id)}
        onCreateConceptNote={(title) => onCreateConceptNote?.(title)}
        onOpenGraphNode={onOpenGraphNode}
        onReindexEmbeddings={onReindexEmbeddings}
      />
    </main>
  );
}


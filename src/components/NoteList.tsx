import { useRef } from 'react';
import type { Note } from '../types';
import { NoteListItem } from './NoteListItem';
import '../styles/NoteList.css';

interface Props {
  notes: Note[];
  selectedId: string | null;
  isGraphOpen?: boolean;
  dataStatus?: string | null;
  savedNoteCount: number;
  isSaving?: boolean;
  /** Notes whose latest write failed to persist. */
  failedNoteIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewNote: () => void;
  onToggleGraph?: () => void;
  onOpenPalette?: () => void;
  onExport?: () => void;
  onImportFiles?: (files: File[]) => void;
}

export function NoteList({
  notes,
  selectedId,
  isGraphOpen = false,
  dataStatus,
  savedNoteCount,
  isSaving = false,
  failedNoteIds,
  onSelect,
  onDelete,
  onNewNote,
  onToggleGraph,
  onOpenPalette,
  onExport,
  onImportFiles,
}: Props) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const importFolderInputRef = useRef<HTMLInputElement>(null);
  return (
    <aside className="note-list">
      <div className="note-list__header">
        <h1 className="note-list__app-name">localnotes</h1>
        <div className="note-list__actions">
          {onOpenPalette && (
            <button
              type="button"
              className="note-list__graph-btn"
              onClick={onOpenPalette}
              aria-label="Search (Cmd+K)"
              title="Search (Cmd+K)"
            >
              ⌘K
            </button>
          )}
          {onToggleGraph && (
            <button
              type="button"
              className={`note-list__graph-btn${
                isGraphOpen ? ' note-list__graph-btn--active' : ''
              }`}
              onClick={onToggleGraph}
              aria-label="Knowledge graph (Cmd+G)"
              aria-pressed={isGraphOpen}
              title="Knowledge graph (Cmd+G)"
            >
              Graph
            </button>
          )}
          <button
            className="note-list__new-btn"
            onClick={onNewNote}
            aria-label="New note (Cmd+N)"
            title="New note (Cmd+N)"
          >
            +
          </button>
        </div>
      </div>
      {notes.length === 0 ? (
        <p className="note-list__empty">No notes yet.</p>
      ) : (
        <ul className="note-list__list" role="listbox" aria-label="Notes">
          {notes.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              isSelected={note.id === selectedId}
              saveFailed={failedNoteIds?.has(note.id) ?? false}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
      <div className="note-list__persistence-status" role="status">
        <span>
          {savedNoteCount} saved {savedNoteCount === 1 ? 'note' : 'notes'}
        </span>
        <span
          className={`note-list__save-state${
            failedNoteIds?.size ? ' note-list__save-state--error' : ''
          }`}
        >
          {isSaving && <span className="note-list__save-spinner" aria-hidden="true" />}
          {isSaving ? 'Saving…' : failedNoteIds?.size ? 'Save failed' : 'Saved'}
        </span>
      </div>
      {(onExport || onImportFiles) && (
        <div className="note-list__footer">
          {onExport && (
            <button
              type="button"
              className="note-list__data-btn"
              onClick={onExport}
              title="Export all notes as a JSON archive"
            >
              Export
            </button>
          )}
          {onImportFiles && (
            <>
              <button
                type="button"
                className="note-list__data-btn"
                onClick={() => importInputRef.current?.click()}
                title="Import notes from a JSON archive or Markdown files"
              >
                Import
              </button>
              <button
                type="button"
                className="note-list__data-btn"
                onClick={() => importFolderInputRef.current?.click()}
                title="Import every Markdown file in a folder"
              >
                Import folder
              </button>
              {/* Programmatically driven by the buttons; visually hidden but
                  not display:none so the click() path stays valid */}
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json,.md,.markdown"
                multiple
                className="note-list__import-input"
                data-testid="import-file-input"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) onImportFiles(files);
                  e.target.value = '';
                }}
              />
              <input
                ref={importFolderInputRef}
                type="file"
                multiple
                // Folder selection is a Chromium-supported, non-standard
                // attribute; React has no typed prop for it.
                {...({ webkitdirectory: '' } as object)}
                className="note-list__import-input"
                data-testid="import-folder-input"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  // Folder picks report even an empty selection: an empty
                  // folder must surface "No Markdown files found" instead of
                  // silently doing nothing. (The file picker above treats
                  // empty as a canceled dialog and stays quiet.)
                  onImportFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>
      )}
      {dataStatus && (
        <p className="note-list__data-status" role="status">
          {dataStatus}
        </p>
      )}
    </aside>
  );
}

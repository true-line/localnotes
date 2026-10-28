import { useRef } from 'react';
import type { Note } from '../types';
import { NoteListItem } from './NoteListItem';
import '../styles/NoteList.css';

interface Props {
  notes: Note[];
  selectedId: string | null;
  isGraphOpen?: boolean;
  dataStatus?: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewNote: () => void;
  onToggleGraph?: () => void;
  onExport?: () => void;
  onImportFile?: (file: File) => void;
}

export function NoteList({
  notes,
  selectedId,
  isGraphOpen = false,
  dataStatus,
  onSelect,
  onDelete,
  onNewNote,
  onToggleGraph,
  onExport,
  onImportFile,
}: Props) {
  const importInputRef = useRef<HTMLInputElement>(null);
  return (
    <aside className="note-list">
      <div className="note-list__header">
        <h1 className="note-list__app-name">localnotes</h1>
        <div className="note-list__actions">
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
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
      {(onExport || onImportFile) && (
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
          {onImportFile && (
            <>
              <button
                type="button"
                className="note-list__data-btn"
                onClick={() => importInputRef.current?.click()}
                title="Import notes from a JSON archive"
              >
                Import
              </button>
              {/* Programmatically driven by the button; visually hidden but
                  not display:none so the click() path stays valid */}
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="note-list__import-input"
                data-testid="import-file-input"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportFile(file);
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

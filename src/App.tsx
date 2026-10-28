import { useState, useEffect, useCallback } from 'react';
import { useNotes } from './hooks/useNotes';
import { useNoteEmbeddings } from './hooks/useNoteEmbeddings';
import { exportVault, importVault } from './storage';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { EmptyState } from './components/EmptyState';
import { DeleteDialog } from './components/DeleteDialog';
import { KnowledgeGraphView } from './components/KnowledgeGraphView';
import './styles/App.css';

const DATA_STATUS_CLEAR_MS = 5000;

export function App() {
  const {
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
  } = useNotes();
  const { embeddings, embeddingStatus, reindexEmbeddings } =
    useNoteEmbeddings(notes);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isGraphOpen, setIsGraphOpen] = useState(false);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!dataStatus) return;
    const timer = setTimeout(() => setDataStatus(null), DATA_STATUS_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [dataStatus]);

  const handleExport = useCallback(async () => {
    try {
      const archive = await exportVault();
      const blob = new Blob([JSON.stringify(archive, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `localnotes-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      const count = archive.notes.length;
      setDataStatus(`Exported ${count} note${count === 1 ? '' : 's'}`);
    } catch {
      setDataStatus('Export failed');
    }
  }, []);

  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const result = await importVault(await file.text());
        await refreshNotes();
        const count = result.imported;
        setDataStatus(`Imported ${count} note${count === 1 ? '' : 's'}`);
      } catch (err) {
        setDataStatus(
          err instanceof Error && err.message
            ? `Import failed: ${err.message}`
            : 'Import failed'
        );
      }
    },
    [refreshNotes]
  );

  const handleDeleteRequest = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (pendingDeleteId) {
      deleteNote(pendingDeleteId);
      setPendingDeleteId(null);
    }
  }, [pendingDeleteId, deleteNote]);

  const handleDeleteCancel = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  const handleNewNote = useCallback(() => {
    createNote();
    setIsGraphOpen(false);
  }, [createNote]);

  const handleCreateConceptNote = useCallback(
    (title: string) => {
      createNote(title);
      setIsGraphOpen(false);
    },
    [createNote]
  );

  const handleSelectNote = useCallback(
    (id: string) => {
      selectNote(id);
      setIsGraphOpen(false);
    },
    [selectNote]
  );

  const handleToggleGraph = useCallback(() => {
    setIsGraphOpen((prev) => {
      const next = !prev;
      if (next) {
        setGraphFocusNodeId(null);
      }
      return next;
    });
  }, []);

  const handleOpenGraphNode = useCallback((nodeId: string) => {
    setGraphFocusNodeId(nodeId);
    setIsGraphOpen(true);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Shortcuts mutate notes; ignore keys until hydration has populated
      // state, otherwise a pre-load create is overwritten by getAllNotes.
      if (isLoading) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        handleNewNote();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        handleToggleGraph();
      }
      if (e.key === 'Escape' && pendingDeleteId) {
        setPendingDeleteId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isLoading, handleNewNote, handleToggleGraph, pendingDeleteId]);

  if (loadError) {
    // Storage is unavailable or migration failed; the vault is untouched.
    // Reload retries — migration keeps the legacy copy on failure.
    return (
      <div className="app app--loading">
        <div className="app__load-error" role="alert">
          <p>LocalNotes couldn’t open its notes database. Your notes have not been modified.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload LocalNotes
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="app app--loading" aria-busy="true" aria-label="Loading notes" />
    );
  }

  const pendingNote = pendingDeleteId ? notes.find((n) => n.id === pendingDeleteId) : null;

  return (
    <div className="app">
      <NoteList
        notes={notes}
        selectedId={selectedId}
        isGraphOpen={isGraphOpen}
        dataStatus={dataStatus}
        onSelect={handleSelectNote}
        onDelete={handleDeleteRequest}
        onNewNote={handleNewNote}
        onToggleGraph={handleToggleGraph}
        onExport={handleExport}
        onImportFile={handleImportFile}
      />
      <div className="app__main">
        {isGraphOpen ? (
          <KnowledgeGraphView
            notes={notes}
            embeddings={embeddings}
            embeddingStatus={embeddingStatus}
            initialSelectedNodeId={graphFocusNodeId}
            onOpenNote={handleSelectNote}
            onCreateConceptNote={handleCreateConceptNote}
            onReindex={reindexEmbeddings}
            onClose={() => setIsGraphOpen(false)}
          />
        ) : selectedNote ? (
          <NoteEditor
            note={selectedNote}
            allNotes={notes}
            embeddings={embeddings}
            embeddingStatus={embeddingStatus}
            onUpdate={updateNote}
            onDelete={handleDeleteRequest}
            onSelectNote={handleSelectNote}
            onCreateConceptNote={handleCreateConceptNote}
            onOpenGraphNode={handleOpenGraphNode}
            onReindexEmbeddings={reindexEmbeddings}
          />
        ) : (
          <EmptyState onNewNote={handleNewNote} />
        )}
      </div>
      {pendingDeleteId && pendingNote && (
        <DeleteDialog
          noteTitle={pendingNote.title}
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}
    </div>
  );
}

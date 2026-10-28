import { useState, useEffect, useCallback } from 'react';
import { useNotes } from './hooks/useNotes';
import { useNoteEmbeddings } from './hooks/useNoteEmbeddings';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { EmptyState } from './components/EmptyState';
import { DeleteDialog } from './components/DeleteDialog';
import { KnowledgeGraphView } from './components/KnowledgeGraphView';
import './styles/App.css';

export function App() {
  const { notes, selectedId, selectedNote, createNote, updateNote, deleteNote, selectNote } =
    useNotes();
  const { embeddings, embeddingStatus, reindexEmbeddings } =
    useNoteEmbeddings(notes);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isGraphOpen, setIsGraphOpen] = useState(false);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | null>(null);

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
  }, [handleNewNote, handleToggleGraph, pendingDeleteId]);

  const pendingNote = pendingDeleteId ? notes.find((n) => n.id === pendingDeleteId) : null;

  return (
    <div className="app">
      <NoteList
        notes={notes}
        selectedId={selectedId}
        isGraphOpen={isGraphOpen}
        onSelect={handleSelectNote}
        onDelete={handleDeleteRequest}
        onNewNote={handleNewNote}
        onToggleGraph={handleToggleGraph}
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


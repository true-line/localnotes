import { useState, useEffect, useCallback } from 'react';
import { useNotes } from './hooks/useNotes';
import { useNoteEmbeddings } from './hooks/useNoteEmbeddings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import { useAgentSession } from './agent/useAgentSession';
import { normalizeKey } from './knowledgeGraph';
import { exportVault, importVault } from './storage';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { EmptyState } from './components/EmptyState';
import { DeleteDialog } from './components/DeleteDialog';
import { KnowledgeGraphView } from './components/KnowledgeGraphView';
import { ChatOverlay } from './components/ChatOverlay';
import {
  CommandPalette,
  type PaletteAction,
} from './components/CommandPalette';
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
  const { resolved: resolvedTheme, setTheme } = useTheme();
  const session = useAgentSession();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isGraphOpen, setIsGraphOpen] = useState(false);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

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

  useKeyboardShortcuts({
    enabled: !isLoading && !loadError,
    onNewNote: handleNewNote,
    onToggleGraph: handleToggleGraph,
    onTogglePalette: () => setIsPaletteOpen((prev) => !prev),
    onToggleChat: () => setIsChatOpen((prev) => !prev),
    onEscape: () => {
      // Topmost layer first: palette self-handles Escape, then chat, then
      // the delete dialog.
      if (isPaletteOpen) return;
      if (isChatOpen) {
        setIsChatOpen(false);
        return;
      }
      if (pendingDeleteId) setPendingDeleteId(null);
    },
  });

  const handleSelectNoteFromPalette = useCallback(
    (id: string) => {
      selectNote(id);
      setIsGraphOpen(false);
    },
    [selectNote]
  );

  // Wikilinks inside agent replies navigate exactly like editor wikilinks:
  // open the note if it exists, otherwise offer a fresh note with that title.
  const handleChatWikiLinkClick = useCallback(
    (target: string) => {
      const norm = normalizeKey(target);
      const existing = notes.find((n) => normalizeKey(n.title) === norm);
      if (existing) {
        handleSelectNote(existing.id);
      } else {
        handleCreateConceptNote(target);
      }
    },
    [notes, handleSelectNote, handleCreateConceptNote]
  );

  const paletteActions: PaletteAction[] = [
    { id: 'new-note', label: 'New note', hint: '⌘N', run: handleNewNote },
    {
      id: 'toggle-graph',
      label: isGraphOpen ? 'Close knowledge graph' : 'Open knowledge graph',
      hint: '⌘G',
      run: handleToggleGraph,
    },
    {
      id: 'toggle-theme',
      label:
        resolvedTheme === 'dark'
          ? 'Switch to light mode'
          : 'Switch to dark mode',
      run: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
    },
    {
      id: 'system-theme',
      label: 'Follow system theme',
      run: () => setTheme('system'),
    },
    { id: 'export', label: 'Export notes (JSON)', run: () => void handleExport() },
    {
      id: 'reindex',
      label: 'Re-index semantic embeddings',
      run: reindexEmbeddings,
    },
  ];

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
        onOpenPalette={() => setIsPaletteOpen(true)}
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
      <CommandPalette
        open={isPaletteOpen}
        notes={notes}
        actions={paletteActions}
        onClose={() => setIsPaletteOpen(false)}
        onSelectNote={handleSelectNoteFromPalette}
      />
      <ChatOverlay
        open={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        session={session}
        onWikiLinkClick={handleChatWikiLinkClick}
      />
    </div>
  );
}

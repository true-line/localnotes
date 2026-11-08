import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNotes } from './hooks/useNotes';
import { useNoteEmbeddings } from './hooks/useNoteEmbeddings';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import { useAgentSession } from './agent/useAgentSession';
import { buildProviders } from './agent/registry';
import { DEFAULT_AGENT_SETTINGS, loadAgentSettings, saveAgentSettings } from './agent/settings';
import type { AgentSettings } from './agent/settings';
import { createTools, type ToolContext } from './agent/tools';
import { fuzzyScore } from './fuzzyMatch';
import { getNoteConnections } from './knowledgeGraph';
import type { ContextAttachment } from './agent/types';
import { normalizeKey } from './knowledgeGraph';
import { exportVault, importVault, previewImport } from './storage';
import type {
  ImportConflictResolution,
  ImportPreview,
  ImportResult,
} from './storage';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { EmptyState } from './components/EmptyState';
import { DeleteDialog } from './components/DeleteDialog';
import { SaveFailureBanner } from './components/SaveFailureBanner';
import { ImportConflictDialog } from './components/ImportConflictDialog';
import { KnowledgeGraphView } from './components/KnowledgeGraphView';
import { ChatOverlay } from './components/ChatOverlay';
import {
  CommandPalette,
  type PaletteAction,
} from './components/CommandPalette';
import './styles/App.css';

const DATA_STATUS_CLEAR_MS = 5000;

function importStatusMessage(result: ImportResult): string {
  const parts = [
    `Imported ${result.imported} note${result.imported === 1 ? '' : 's'}`,
  ];
  if (result.replaced > 0) parts.push(`replaced ${result.replaced} existing`);
  if (result.kept > 0) parts.push(`kept ${result.kept} existing`);
  if (result.skipped > 0) parts.push(`skipped ${result.skipped} invalid`);
  return parts.join(', ');
}

export function App() {
  const {
    notes,
    selectedId,
    selectedNote,
    isLoading,
    loadError,
    pendingWrites,
    failedWrites,
    savedNoteCount,
    createNote,
    updateNote,
    deleteNote,
    selectNote,
    refreshNotes,
    retryWrite,
    discardFailedWrite,
  } = useNotes();
  const { embeddings, embeddingStatus, reindexEmbeddings } =
    useNoteEmbeddings(notes);
  const { resolved: resolvedTheme, setTheme } = useTheme();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isGraphOpen, setIsGraphOpen] = useState(false);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    text: string;
    preview: ImportPreview;
  } | null>(null);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [selectionText, setSelectionText] = useState('');

  // The Selection chip must reflect the CURRENT note: switching notes (or
  // deleting the selection's source) invalidates the reported text.
  useEffect(() => {
    setSelectionText('');
  }, [selectedId]);

  // Tier-0 read-only facade for agent tools: nothing here can mutate the vault.
  const tools = useMemo(() => {
    const ctx: ToolContext = {
      searchNotes: (query, limit = 10) =>
        notes
          .map((note) => ({
            note,
            score: fuzzyScore(query, `${note.title}\n${note.content}`),
          }))
          .filter((entry) => entry.score >= 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((entry) => entry.note),
      getNote: (id) => notes.find((n) => n.id === id) ?? null,
      recentNotes: (limit = 10) => notes.slice(0, limit),
      connectionsFor: (id) =>
        notes.some((n) => n.id === id)
          ? getNoteConnections(id, notes, embeddings)
          : null,
      similarFor: (id, limit = 5) =>
        notes.some((n) => n.id === id)
          ? (getNoteConnections(id, notes, embeddings)?.semanticNotes.slice(0, limit) ?? [])
          : [],
    };
    return createTools(ctx);
  }, [notes, embeddings]);
  // Agent settings (provider, endpoint, model) persist in the settings store
  // and drive the provider registry.
  const [agentSettings, setAgentSettings] = useState(DEFAULT_AGENT_SETTINGS);
  useEffect(() => {
    void loadAgentSettings().then(setAgentSettings);
  }, []);
  const handleSaveAgentSettings = useCallback((next: AgentSettings) => {
    setAgentSettings(next);
    saveAgentSettings(next).catch((error) =>
      console.error('localnotes: failed to save agent settings', error)
    );
  }, []);
  const providers = useMemo(() => buildProviders(agentSettings), [agentSettings]);
  const session = useAgentSession({ tools, providers, initialProviderId: agentSettings.providerId });

  // Explicit context chips: what the agent receives is decided here, shown
  // in the drawer as removable pills, and never attached implicitly.
  const attachmentOptions = useMemo<ContextAttachment[]>(() => {
    const options: ContextAttachment[] = [];
    if (selectedNote) {
      options.push({
        id: 'current-note',
        label: 'Current note',
        content: `${selectedNote.title || 'Untitled'}\n${selectedNote.content}`,
        defaultActive: true,
      });
    }
    if (selectionText.trim()) {
      options.push({
        id: 'selection',
        label: 'Selection',
        content: selectionText,
        defaultActive: true,
      });
    }
    if (notes.length > 0) {
      options.push({
        id: 'recent-notes',
        label: 'Recent notes',
        content: notes
          .slice(0, 5)
          .map((n) => `- ${n.title || 'Untitled'}`)
          .join('\n'),
      });
    }
    if (selectedNote) {
      const conn = getNoteConnections(selectedNote.id, notes, embeddings);
      const bits = [
        conn.backlinks.length &&
          `backlinks: ${conn.backlinks.map((n) => n.title || 'Untitled').join(', ')}`,
        conn.outgoingNotes.length &&
          `links: ${conn.outgoingNotes.map((n) => n.title || 'Untitled').join(', ')}`,
        conn.tags.length && `tags: ${conn.tags.join(', ')}`,
      ].filter(Boolean);
      if (bits.length) {
        options.push({
          id: 'graph-neighborhood',
          label: 'Graph neighborhood',
          content: bits.join('\n'),
        });
      }
    }
    return options;
  }, [selectedNote, selectionText, notes, embeddings]);

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

  const handleImportJson = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const preview = await previewImport(text);
        if (preview.conflicts.length > 0) {
          // Same-id notes need an explicit per-note decision before anything
          // is written; the dialog owns that choice.
          setPendingImport({ text, preview });
          return;
        }
        const result = await importVault(text);
        await refreshNotes();
        setDataStatus(importStatusMessage(result));
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

  // One JSON file is a vault archive (with conflict preview); any other
  // selection — a single file, several files, or a whole folder — imports one
  // new note per Markdown file. Folder picks may carry other file types,
  // which are skipped and reported rather than imported as garbage.
  const handleImportFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.json')) {
        await handleImportJson(files[0]);
        return;
      }
      const markdownFiles = files.filter((file) => /\.(md|markdown)$/i.test(file.name));
      if (markdownFiles.length === 0) {
        setDataStatus('No Markdown files found');
        return;
      }
      try {
        for (const file of markdownFiles) {
          const content = await file.text();
          createNote(file.name.replace(/\.[^.]+$/, '').trim(), content);
        }
        const skipped = files.length - markdownFiles.length;
        const skippedNote =
          skipped > 0
            ? `, skipped ${skipped} non-Markdown file${skipped === 1 ? '' : 's'}`
            : '';
        setDataStatus(
          `Imported ${markdownFiles.length} note${markdownFiles.length === 1 ? '' : 's'} from Markdown${skippedNote}`
        );
      } catch {
        setDataStatus('Import failed');
      }
    },
    [createNote, handleImportJson]
  );

  const handleImportResolve = useCallback(
    async (resolutions: Record<string, ImportConflictResolution>) => {
      const pending = pendingImport;
      setPendingImport(null);
      if (!pending) return;
      try {
        const result = await importVault(pending.text, resolutions);
        await refreshNotes();
        setDataStatus(importStatusMessage(result));
      } catch (err) {
        setDataStatus(
          err instanceof Error && err.message
            ? `Import failed: ${err.message}`
            : 'Import failed'
        );
      }
    },
    [pendingImport, refreshNotes]
  );

  const handleImportCancel = useCallback(() => {
    setPendingImport(null);
    setDataStatus('Import canceled');
  }, []);

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
    // The palette is the topmost command surface: chat must not open (and
    // steal focus) beneath it. Palette over an already-open chat is fine —
    // opening the palette moves focus to the topmost layer.
    onToggleChat: () => {
      if (isPaletteOpen) return;
      setIsChatOpen((prev) => !prev);
    },
    onEscape: () => {
      // Topmost layer first: palette self-handles Escape, then chat, then
      // the import dialog, then the delete dialog.
      if (isPaletteOpen) return;
      if (isChatOpen) {
        setIsChatOpen(false);
        return;
      }
      if (pendingImport) {
        setPendingImport(null);
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

  // The banner shows one failure at a time; retry/discard resolves it and the
  // next one (if any) takes its place.
  const saveFailure = failedWrites[0] ?? null;
  const failedNoteIds = new Set(failedWrites.map((f) => f.noteId));

  return (
    <div className={`app${isSidebarCollapsed ? ' app--sidebar-collapsed' : ''}`}>
      <NoteList
        notes={notes}
        selectedId={selectedId}
        isGraphOpen={isGraphOpen}
        isCollapsed={isSidebarCollapsed}
        dataStatus={dataStatus}
        savedNoteCount={savedNoteCount}
        isSaving={pendingWrites > 0}
        failedNoteIds={failedNoteIds}
        onSelect={handleSelectNote}
        onDelete={handleDeleteRequest}
        onNewNote={handleNewNote}
        onToggleGraph={handleToggleGraph}
        onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
        onOpenPalette={() => setIsPaletteOpen(true)}
        onExport={handleExport}
        onImportFiles={handleImportFiles}
      />
      <div className="app__main">
        {saveFailure && (
          <SaveFailureBanner
            failure={saveFailure}
            additionalCount={failedWrites.length - 1}
            onRetry={retryWrite}
            onDiscard={(noteId) => void discardFailedWrite(noteId)}
          />
        )}
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
            onSelectionChange={setSelectionText}
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
      {pendingImport && (
        <ImportConflictDialog
          conflicts={pendingImport.preview.conflicts}
          onResolve={handleImportResolve}
          onCancel={handleImportCancel}
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
        attachmentOptions={attachmentOptions}
        onWikiLinkClick={handleChatWikiLinkClick}
        settings={agentSettings}
        onSettingsChange={handleSaveAgentSettings}
      />
    </div>
  );
}

import { useEffect } from 'react';

interface Handlers {
  /** False while the app is loading or unusable; shortcuts become no-ops. */
  enabled?: boolean;
  onNewNote: () => void;
  onToggleGraph: () => void;
  onTogglePalette: () => void;
  onToggleChat: () => void;
  /** Escape with nothing else claiming it (palette, chat, delete dialog). */
  onEscape?: () => void;
}

/** Global app shortcuts: Cmd/Ctrl+N, G, K, J, and Escape. */
export function useKeyboardShortcuts({
  enabled = true,
  onNewNote,
  onToggleGraph,
  onTogglePalette,
  onToggleChat,
  onEscape,
}: Handlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!enabled) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'n') {
        e.preventDefault();
        onNewNote();
      } else if (mod && key === 'g') {
        e.preventDefault();
        onToggleGraph();
      } else if (mod && key === 'k') {
        e.preventDefault();
        onTogglePalette();
      } else if (mod && key === 'j') {
        e.preventDefault();
        onToggleChat();
      } else if (e.key === 'Escape') {
        onEscape?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, onNewNote, onToggleGraph, onTogglePalette, onToggleChat, onEscape]);
}

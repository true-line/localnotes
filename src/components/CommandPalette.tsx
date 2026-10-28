import { useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '../types';
import { fuzzyScore } from '../fuzzyMatch';
import '../styles/CommandPalette.css';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  notes: Note[];
  actions: PaletteAction[];
  onClose: () => void;
  onSelectNote: (id: string) => void;
}

interface Item {
  key: string;
  label: string;
  hint?: string;
  score: number;
  run: () => void;
}

export function CommandPalette({
  open,
  notes,
  actions,
  onClose,
  onSelectNote,
}: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const actionItems = actions
      .map((a) => ({
        key: `action:${a.id}`,
        label: a.label,
        hint: a.hint,
        run: a.run,
        score: q ? fuzzyScore(q, a.label) : 0,
      }))
      .filter((item) => item.score >= 0);
    const noteItems = notes
      .map((note) => {
        const haystack = `${note.title}\n${note.content.slice(0, 200)}`;
        return {
          key: `note:${note.id}`,
          label: note.title.trim() || 'Untitled',
          hint: 'Note',
          run: () => onSelectNote(note.id),
          score: q ? fuzzyScore(q, haystack) : 0,
        };
      })
      .filter((item) => item.score >= 0);
    const sorted = [...actionItems, ...noteItems].sort(
      (a, b) => b.score - a.score
    );
    // Unfiltered view stays digestible; with a query, show everything relevant
    return q ? sorted : sorted.slice(0, 12);
  }, [query, notes, actions, onSelectNote]);

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      restoreRef.current?.focus?.();
      restoreRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    // Optional call: scrollIntoView is missing in jsdom and some embedded webviews
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runItem = (item: Item) => {
    onClose();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(items.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[active];
      if (item) runItem(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="command-palette__overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          className="command-palette__input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={
            items[active] ? `command-palette-option-${active}` : undefined
          }
          aria-label="Search notes and commands"
          placeholder="Search notes and commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {items.length === 0 ? (
          <p className="command-palette__empty">No matches.</p>
        ) : (
          <ul
            id="command-palette-list"
            className="command-palette__list"
            role="listbox"
            aria-label="Results"
            ref={listRef}
          >
            {items.map((item, index) => (
              <li
                key={item.key}
                id={`command-palette-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === active}
                className={`command-palette__item${
                  index === active ? ' command-palette__item--active' : ''
                }`}
                onMouseEnter={() => setActive(index)}
                onClick={() => runItem(item)}
              >
                <span className="command-palette__item-label">{item.label}</span>
                {item.hint && (
                  <span className="command-palette__item-hint">{item.hint}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

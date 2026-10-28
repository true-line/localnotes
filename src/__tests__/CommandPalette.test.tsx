import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../components/CommandPalette';
import type { Note } from '../types';

const makeNote = (overrides: Partial<Note>): Note => ({
  id: overrides.id ?? 'n1',
  title: overrides.title ?? 'Untitled',
  content: overrides.content ?? '',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const baseProps = (overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) => ({
  open: true,
  notes: [] as Note[],
  actions: [] as Parameters<typeof CommandPalette>[0]['actions'],
  onClose: vi.fn(),
  onSelectNote: vi.fn(),
  ...overrides,
});

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    render(<CommandPalette {...baseProps({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists actions and notes when opened', () => {
    render(
      <CommandPalette
        {...baseProps({
          notes: [makeNote({ id: 'a', title: 'Relativity' })],
          actions: [{ id: 'new', label: 'New note', run: vi.fn() }],
        })}
      />
    );
    expect(screen.getByRole('option', { name: /new note/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /relativity/i })).toBeInTheDocument();
  });

  it('filters by query', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        {...baseProps({
          notes: [
            makeNote({ id: 'a', title: 'Relativity' }),
            makeNote({ id: 'b', title: 'Category Theory' }),
          ],
        })}
      />
    );
    await user.type(screen.getByRole('combobox'), 'theory');
    expect(screen.getByRole('option', { name: /category theory/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^relativity$/i })).toBeNull();
  });

  it('runs the selected note on Enter and closes', async () => {
    const user = userEvent.setup();
    const onSelectNote = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        {...baseProps({
          notes: [makeNote({ id: 'a', title: 'Relativity' })],
          onSelectNote,
          onClose,
        })}
      />
    );
    await user.type(screen.getByRole('combobox'), 'relativity');
    await user.keyboard('{Enter}');
    expect(onSelectNote).toHaveBeenCalledWith('a');
    expect(onClose).toHaveBeenCalled();
  });

  it('runs an action on Enter', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(
      <CommandPalette
        {...baseProps({
          actions: [{ id: 'new', label: 'New note', run }],
        })}
      />
    );
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Enter}');
    expect(run).toHaveBeenCalled();
  });

  it('navigates with arrow keys and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <CommandPalette
        {...baseProps({
          notes: [
            makeNote({ id: 'a', title: 'Alpha' }),
            makeNote({ id: 'b', title: 'Beta' }),
          ],
          onClose,
        })}
      />
    );
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an empty state for queries with no matches', async () => {
    const user = userEvent.setup();
    render(<CommandPalette {...baseProps()} />);
    await user.type(screen.getByRole('combobox'), 'zzzznothing');
    expect(screen.getByText(/no matches/i)).toBeInTheDocument();
  });
});

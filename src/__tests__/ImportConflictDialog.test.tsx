import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportConflictDialog } from '../components/ImportConflictDialog';
import type { Note } from '../types';

const makeNote = (id: string, title: string): Note => ({
  id,
  title,
  content: `content of ${id}`,
  createdAt: 1,
  updatedAt: 2,
});

const makeConflict = (id: string, existingTitle: string, incomingTitle: string) => ({
  existing: makeNote(id, existingTitle),
  incoming: makeNote(id, incomingTitle),
});

describe('ImportConflictDialog', () => {
  it('lists every conflict with "keep" preselected and focuses the first option', () => {
    render(
      <ImportConflictDialog
        conflicts={[
          makeConflict('a', 'Current A', 'Imported A'),
          makeConflict('b', 'Same title', 'Same title'),
        ]}
        onResolve={() => undefined}
        onCancel={() => undefined}
      />
    );

    expect(
      screen.getByRole('dialog', { name: /resolve import conflicts/i })
    ).toBeInTheDocument();
    // The existing title is shown when it differs from the incoming one
    expect(screen.getByText(/current a/i)).toBeInTheDocument();

    const keepRadios = screen.getAllByRole('radio', { name: /keep existing/i });
    expect(keepRadios).toHaveLength(2);
    for (const radio of keepRadios) expect(radio).toBeChecked();
    expect(
      screen.getAllByRole('radio', { name: /replace with imported/i })
    ).toHaveLength(2);
    expect(
      screen.getAllByRole('radio', { name: /import as a copy/i })
    ).toHaveLength(2);
    // Keyboard users land on the first option of the first conflict
    expect(keepRadios[0]).toHaveFocus();
  });

  it('passes the chosen per-note resolutions to onResolve', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <ImportConflictDialog
        conflicts={[
          makeConflict('a', 'Current A', 'Imported A'),
          makeConflict('b', 'Current B', 'Imported B'),
        ]}
        onResolve={onResolve}
        onCancel={() => undefined}
      />
    );

    // First conflict: replace; second conflict: leave on the default keep
    const groups = screen.getAllByRole('group');
    const replaceA = screen.getAllByRole('radio', {
      name: /replace with imported/i,
    })[0];
    await user.click(replaceA);
    expect(groups).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onResolve).toHaveBeenCalledWith({ a: 'replace', b: 'keep' });
  });

  it('supports "import as a copy" and reports it in the resolutions', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    render(
      <ImportConflictDialog
        conflicts={[makeConflict('a', 'Current A', 'Imported A')]}
        onResolve={onResolve}
        onCancel={() => undefined}
      />
    );

    await user.click(screen.getByRole('radio', { name: /import as a copy/i }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onResolve).toHaveBeenCalledWith({ a: 'duplicate' });
  });

  it('calls onCancel from the Cancel button', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ImportConflictDialog
        conflicts={[makeConflict('a', 'Current A', 'Imported A')]}
        onResolve={() => undefined}
        onCancel={onCancel}
      />
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

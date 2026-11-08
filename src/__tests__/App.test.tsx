import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { getRepository, resetRepositoryForTests } from '../storage';

beforeEach(() => {
  localStorage.clear();
  Object.assign(globalThis.URL, {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
});

describe('App integration', () => {
  it('shows empty state on first load', async () => {
    render(<App />);
    expect(await screen.findByText(/no note selected/i)).toBeInTheDocument();
  });

  it('creates a note when New note button is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Use the EmptyState "New note" button (exact text, not the sidebar "+" button)
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    expect(screen.getByLabelText(/note title/i)).toBeInTheDocument();
    expect(screen.queryByText(/no note selected/i)).not.toBeInTheDocument();
  });

  it('creates a note with Cmd+N shortcut', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);
    await user.keyboard('{Meta>}n{/Meta}');
    expect(screen.getByLabelText(/note title/i)).toBeInTheDocument();
  });

  it('collapses and restores the notes sidebar without unmounting the editor', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText(/note title/i), 'Visible while collapsed');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.queryByRole('listbox', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/note title/i)).toHaveValue('Visible while collapsed');

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(screen.getByRole('listbox', { name: 'Notes' })).toBeInTheDocument();
  });

  it('collapses and restores the Knowledge Connections bar', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    const hint = screen.getByText(/link notes and concepts/i);
    expect(hint).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: 'Collapse knowledge connections' })
    );
    expect(hint).not.toBeVisible();
    expect(screen.getByText('Embeddings: Idle')).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: 'Expand knowledge connections' })
    );
    expect(hint).toBeVisible();
  });

  it('auto-saves title as user types', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    const titleInput = screen.getByLabelText(/note title/i);
    await user.type(titleInput, 'My First Note');
    expect(titleInput).toHaveValue('My First Note');
    // Check the sidebar reflects the title
    expect(screen.getByText('My First Note')).toBeInTheDocument();
  });

  it('auto-saves content as user types', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    const contentArea = screen.getByLabelText(/note content/i);
    await user.type(contentArea, 'Hello world');
    expect(contentArea).toHaveValue('Hello world');
  });

  it('shows durable count and save progress without blocking editing', async () => {
    const repo = await getRepository();
    let resolveWrite!: () => void;
    vi.spyOn(repo, 'putNote').mockImplementation(
      () => new Promise<void>((resolve) => (resolveWrite = resolve))
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);
    expect(screen.getByText('0 saved notes')).toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(await screen.findByText('Saving…')).toBeInTheDocument();
    expect(screen.getByText('0 saved notes')).toBeInTheDocument();
    expect(document.querySelector('.note-list__save-spinner')).toBeInTheDocument();

    const titleInput = screen.getByLabelText(/note title/i);
    await user.type(titleInput, 'Still editable');
    expect(titleInput).toHaveValue('Still editable');

    await act(async () => resolveWrite());
    expect(await screen.findByText('1 saved note')).toBeInTheDocument();
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });

  it('shows delete confirmation dialog when delete is triggered', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/delete note\?/i)).toBeInTheDocument();
  });

  it('cancels delete when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/note title/i)).toBeInTheDocument();
  });

  it('deletes note after confirmation and shows empty state', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/no note selected/i)).toBeInTheDocument();
  });

  it('persists notes across re-mounts (simulates page refresh)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    const titleInput = screen.getByLabelText(/note title/i);
    await user.type(titleInput, 'Persistent note');

    // Wait for the fire-and-forget writes to land before "refreshing"
    const repo = await getRepository();
    await repo.flushWrites();
    unmount();

    render(<App />);
    expect(await screen.findByText('Persistent note')).toBeInTheDocument();
  });

  it('closes dialog with Escape key', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exports the vault as JSON and reports the count', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText(/note title/i), 'Exported note');

    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByText('Exported 1 note')).toBeInTheDocument();
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'application/json' })
    );
  });

  it('imports notes from a JSON archive', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);

    const archive = {
      app: 'localnotes',
      version: 1,
      exportedAt: 1,
      notes: [
        {
          id: 'imported-1',
          title: 'Imported note',
          content: 'From archive',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    };
    const file = new File([JSON.stringify(archive)], 'vault.json', {
      type: 'application/json',
    });
    // The visible button drives the hidden file input programmatically
    await user.click(screen.getByRole('button', { name: 'Import' }));
    const input = screen.getByTestId('import-file-input');
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('Imported 1 note')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Imported note')).toBeInTheDocument()
    );
  });

  it('imports a single Markdown file as a new note', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);

    const file = new File(['# Hello\n\nSome **Markdown** content'], 'hello.md', {
      type: 'text/markdown',
    });
    await user.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.change(screen.getByTestId('import-file-input'), {
      target: { files: [file] },
    });

    expect(
      await screen.findByText('Imported 1 note from Markdown')
    ).toBeInTheDocument();
    expect(await screen.findByText('hello')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText('Note content')).toHaveValue(
        '# Hello\n\nSome **Markdown** content'
      )
    );
  });

  it('imports several Markdown files at once', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);

    const files = [
      new File(['first body'], 'alpha.md'),
      new File(['second body'], 'beta.markdown'),
    ];
    await user.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.change(screen.getByTestId('import-file-input'), {
      target: { files },
    });

    expect(
      await screen.findByText('Imported 2 notes from Markdown')
    ).toBeInTheDocument();
    const list = within(screen.getByRole('listbox', { name: 'Notes' }));
    expect(await list.findByText('alpha')).toBeInTheDocument();
    expect(list.getByText('beta')).toBeInTheDocument();
  });

  it('imports Markdown files from a folder and skips other file types', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);

    await user.click(screen.getByRole('button', { name: 'Import folder' }));
    const files = [
      new File(['one body'], 'one.md'),
      new File(['not markdown'], 'image.png'),
      new File(['two body'], 'two.markdown'),
    ];
    fireEvent.change(screen.getByTestId('import-folder-input'), {
      target: { files },
    });

    expect(
      await screen.findByText(
        'Imported 2 notes from Markdown, skipped 1 non-Markdown file'
      )
    ).toBeInTheDocument();
    const list = within(screen.getByRole('listbox', { name: 'Notes' }));
    expect(await list.findByText('one')).toBeInTheDocument();
    expect(list.getByText('two')).toBeInTheDocument();
  });

  it('reports a folder pick with no Markdown files', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);

    await user.click(screen.getByRole('button', { name: 'Import folder' }));
    fireEvent.change(screen.getByTestId('import-folder-input'), {
      target: { files: [new File(['plain'], 'notes.txt')] },
    });

    expect(await screen.findByText('No Markdown files found')).toBeInTheDocument();
  });

  it('reports an empty folder pick instead of doing nothing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);

    await user.click(screen.getByRole('button', { name: 'Import folder' }));
    fireEvent.change(screen.getByTestId('import-folder-input'), {
      target: { files: [] },
    });

    expect(await screen.findByText('No Markdown files found')).toBeInTheDocument();
  });

  const seedNote = async (id: string, title: string) => {
    const repo = await getRepository();
    await repo.putNote({
      id,
      title,
      content: `content of ${id}`,
      createdAt: 1,
      updatedAt: 2,
    });
    await repo.flushWrites();
  };

  const conflictArchive = () =>
    new File(
      [
        JSON.stringify({
          app: 'localnotes',
          version: 1,
          exportedAt: 1,
          notes: [
            {
              id: 'dup',
              title: 'Archive title',
              content: 'archive content',
              createdAt: 1,
              updatedAt: 3,
            },
            {
              id: 'fresh',
              title: 'Fresh note',
              content: 'new',
              createdAt: 1,
              updatedAt: 3,
            },
          ],
        }),
      ],
      'vault.json',
      { type: 'application/json' }
    );

  it('keeps conflicting notes by default and imports the rest', async () => {
    const user = userEvent.setup();
    await seedNote('dup', 'Current title');
    render(<App />);
    await screen.findByText('Current title');

    fireEvent.change(screen.getByTestId('import-file-input'), {
      target: { files: [conflictArchive()] },
    });
    const dialog = await screen.findByRole('dialog', {
      name: /resolve import conflicts/i,
    });
    // The safe default is preselected
    expect(
      screen.getByRole('radio', { name: /keep existing/i })
    ).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(dialog).not.toBeInTheDocument();
    expect(
      await screen.findByText('Imported 1 note, kept 1 existing')
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Fresh note')).toBeInTheDocument()
    );
    expect(screen.getByText('Current title')).toBeInTheDocument();
    expect(screen.queryByText('Archive title')).not.toBeInTheDocument();
  });

  it('replaces a conflicting note only when the user chooses Replace', async () => {
    const user = userEvent.setup();
    await seedNote('dup', 'Current title');
    render(<App />);
    await screen.findByText('Current title');

    fireEvent.change(screen.getByTestId('import-file-input'), {
      target: { files: [conflictArchive()] },
    });
    await screen.findByRole('dialog', { name: /resolve import conflicts/i });
    await user.click(
      screen.getByRole('radio', { name: /replace with imported/i })
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(
      await screen.findByText('Imported 1 note, replaced 1 existing')
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('Archive title')).toBeInTheDocument()
    );
    expect(screen.queryByText('Current title')).not.toBeInTheDocument();
  });

  it('cancelling the conflict dialog imports nothing', async () => {
    const user = userEvent.setup();
    await seedNote('dup', 'Current title');
    render(<App />);
    await screen.findByText('Current title');

    fireEvent.change(screen.getByTestId('import-file-input'), {
      target: { files: [conflictArchive()] },
    });
    await screen.findByRole('dialog', { name: /resolve import conflicts/i });
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Import canceled')).toBeInTheDocument();
    expect(screen.getByText('Current title')).toBeInTheDocument();
    expect(screen.queryByText('Fresh note')).not.toBeInTheDocument();
  });

  it('closes the conflict dialog with Escape without writing anything', async () => {
    const user = userEvent.setup();
    await seedNote('dup', 'Current title');
    render(<App />);
    await screen.findByText('Current title');

    fireEvent.change(screen.getByTestId('import-file-input'), {
      target: { files: [conflictArchive()] },
    });
    await screen.findByRole('dialog', { name: /resolve import conflicts/i });
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const repo = await getRepository();
    const notes = await repo.getAllNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('Current title');
  });

  it('shows a recoverable error screen when the database cannot open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      open: () => {
        throw new Error('storage unavailable');
      },
    };
    resetRepositoryForTests();

    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn’t open its notes database/i);
    expect(screen.getByRole('button', { name: 'Reload LocalNotes' })).toBeInTheDocument();
  });

  it('surfaces an injected write failure and recovers on retry', async () => {
    const user = userEvent.setup();
    const repo = await getRepository();
    render(<App />);
    await screen.findByText(/no note selected/i);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spy = vi
      .spyOn(repo, 'putNote')
      .mockRejectedValue(new Error('injected write failure'));

    await user.click(screen.getByRole('button', { name: 'New note' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn’t save changes/i);
    // The unsaved note is still listed, marked as not saved.
    expect(
      screen.getByRole('img', { name: /changes not saved/i })
    ).toBeInTheDocument();
    expect(screen.getByText('0 saved notes')).toBeInTheDocument();
    expect(screen.getByText('Save failed')).toBeInTheDocument();
    expect(await repo.getAllNotes()).toHaveLength(0);

    spy.mockRestore();
    await user.click(screen.getByRole('button', { name: /^retry$/i }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    );
    await repo.flushWrites();
    expect(await repo.getAllNotes()).toHaveLength(1);
    expect(
      screen.queryByRole('img', { name: /changes not saved/i })
    ).not.toBeInTheDocument();
  });

  it('discard reverts a failed edit to the durable version', async () => {
    const user = userEvent.setup();
    const repo = await getRepository();
    await repo.putNote({
      id: 'seed-1',
      title: 'Original',
      content: '',
      createdAt: 1000,
      updatedAt: 1000,
    });
    render(<App />);
    // Open the seeded note in the editor.
    await user.click(await screen.findByRole('option', { name: /original/i }));
    const titleInput = screen.getByLabelText(/note title/i);
    await waitFor(() => expect(titleInput).toHaveValue('Original'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spy = vi
      .spyOn(repo, 'saveNoteWithRevision')
      .mockRejectedValue(new Error('injected write failure'));

    await user.clear(titleInput);
    await user.type(titleInput, 'Edited');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn’t save changes/i);
    // Durable storage still holds the original.
    expect((await repo.getAllNotes())[0].title).toBe('Original');

    spy.mockRestore();
    await user.click(screen.getByRole('button', { name: /discard changes/i }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/note title/i)).toHaveValue('Original')
    );
  });

  it('opens the command palette with Cmd+K and jumps to a note', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText(/note title/i), 'Findable note');

    await user.keyboard('{Meta>}k{/Meta}');
    const dialog = await screen.findByRole('dialog', { name: /command palette/i });
    expect(dialog).toBeInTheDocument();

    await user.type(screen.getByRole('combobox'), 'findable');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/note title/i)).toHaveValue('Findable note');
  });

  it('toggles dark mode from the command palette', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);

    await user.keyboard('{Meta>}k{/Meta}');
    await user.click(await screen.findByRole('option', { name: /switch to dark mode/i }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('keeps the delete dialog open when Escape closes the palette above it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.getByRole('dialog', { name: /delete note\?/i })).toBeInTheDocument();

    await user.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog', { name: /command palette/i });
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /delete note\?/i })).toBeInTheDocument();
  });

  it('toggles the agent chat drawer with Cmd+J over any view', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);

    await user.keyboard('{Meta>}j{/Meta}');
    const drawer = await screen.findByRole('complementary', { name: /agent chat/i });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Agent' })).toBeInTheDocument();

    await user.keyboard('{Meta>}j{/Meta}');
    expect(
      screen.queryByRole('complementary', { name: /agent chat/i })
    ).not.toBeInTheDocument();

    // Works over the graph view too
    await user.click(screen.getByRole('button', { name: /knowledge graph \(cmd\+g\)/i }));
    await user.keyboard('{Meta>}j{/Meta}');
    expect(await screen.findByRole('complementary', { name: /agent chat/i })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: /knowledge graph view/i })).toBeInTheDocument();
  });

  it('sends a message in the agent chat and shows the canned reply', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);
    await user.keyboard('{Meta>}j{/Meta}');

    await user.type(screen.getByLabelText(/message the agent/i), 'hello agent');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/offline mock provider/i).length).toBeGreaterThan(0)
    );
  }, 10_000);

  it('keeps the delete dialog open when Escape closes the chat above it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.keyboard('{Meta>}j{/Meta}');
    await screen.findByRole('complementary', { name: /agent chat/i });

    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('complementary', { name: /agent chat/i })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not open the chat beneath an open command palette', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/no note selected/i);

    await user.keyboard('{Meta>}k{/Meta}');
    await screen.findByRole('dialog', { name: /command palette/i });

    await user.keyboard('{Meta>}j{/Meta}');
    expect(
      screen.queryByRole('complementary', { name: /agent chat/i })
    ).not.toBeInTheDocument();
    // Typing still reaches the palette, not an obscured composer
    await user.type(screen.getByRole('combobox'), 'still searching');
    expect(screen.getByRole('combobox')).toHaveValue('still searching');
  });

  it('runs a real vault search through the mock agent tool-call', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText(/note title/i), 'Spacetime Notes');
    await user.type(screen.getByLabelText(/note content/i), 'curved spacetime');

    await user.keyboard('{Meta>}j{/Meta}');
    await user.type(screen.getByLabelText(/message the agent/i), 'find spacetime');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    // The mock emits a real tool-call; the runtime executes it against the
    // vault and the transcript shows the tool entry with the live result,
    // then the mock answers from that result.
    expect(await screen.findByText('🛠 notes.search')).toBeInTheDocument();
    fireEvent.click(screen.getByText('🛠 notes.search'));
    expect(await screen.findByText(/"query": "spacetime"/)).toBeInTheDocument();
    expect(
      await screen.findByText(/1 note\(s\) matched/, { selector: 'pre' })
    ).toBeInTheDocument();
  }, 15_000);

  it('shows the Current note chip as active and clears stale selection on note switch', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText(/note title/i), 'First Note');
    await user.type(screen.getByLabelText(/note content/i), 'selectable words here');

    // Select some text in the content area
    const content = screen.getByLabelText(/note content/i);
    fireEvent.select(content, { target: { selectionStart: 0, selectionEnd: 9 } });

    await user.keyboard('{Meta>}j{/Meta}');
    const selectionChip = await screen.findByRole('button', { name: 'Selection' });
    expect(selectionChip).toHaveAttribute('aria-pressed', 'true');

    // Switch to a second note: the Selection chip must disappear (stale)
    await user.click(screen.getByRole('button', { name: /new note \(cmd\+n\)/i }));
    await user.type(screen.getByLabelText(/note title/i), 'Second Note');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Selection' })).toBeNull()
    );
    // And the current-note chip now points at the second note
    const currentChip = screen.getByRole('button', { name: 'Current note' });
    expect(currentChip).toHaveAttribute('aria-pressed', 'true');
    expect(currentChip).toHaveAttribute('title', expect.stringContaining('Second Note'));
  }, 15_000);

  it('shows backlinks, related notes, and concept creation in Knowledge Connections panel', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Create first note: "Relativity" with #physics and [[Spacetime]]
    // Note: in userEvent v14, '[' is escaped as '[['
    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText(/note title/i), 'Relativity');
    await user.type(
      screen.getByLabelText(/note content/i),
      'Explores [[[[Spacetime]] in #physics'
    );

    // Create second note: "Gravity" linking to [[Relativity]] and #physics
    await user.click(screen.getByRole('button', { name: /new note \(cmd\+n\)/i }));
    await user.type(screen.getByLabelText(/note title/i), 'Gravity');
    await user.type(
      screen.getByLabelText(/note content/i),
      'Described by [[[[Relativity]] in #physics'
    );

    // Click outgoing [[Relativity]] pill in Knowledge Connections to navigate back to Relativity
    await user.click(screen.getByRole('button', { name: '[[Relativity]]' }));
    expect(screen.getByLabelText(/note title/i)).toHaveValue('Relativity');

    // Verify "Gravity" appears under Backlinks and Related by Topic
    expect(screen.getByText(/backlinks \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText(/related by topic \(1\)/i)).toBeInTheDocument();

    // Create note from unresolved concept [[Spacetime]]
    await user.click(
      screen.getByRole('button', { name: /create note for spacetime/i })
    );
    expect(screen.getByLabelText(/note title/i)).toHaveValue('Spacetime');
  });

  it('toggles Knowledge Graph View and allows inspecting and creating concept notes', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'New note' }));
    await user.type(screen.getByLabelText(/note title/i), 'Category Theory');
    await user.type(
      screen.getByLabelText(/note content/i),
      'Connects [[[[Functors]] and #math'
    );

    // Open Knowledge Graph View via sidebar button
    await user.click(
      screen.getByRole('button', { name: /knowledge graph \(cmd\+g\)/i })
    );
    expect(
      screen.getByRole('main', { name: /knowledge graph view/i })
    ).toBeInTheDocument();

    // Verify note, topic, and concept nodes are rendered
    expect(
      screen.getByRole('button', { name: 'note node: Category Theory' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'tag node: #math' })
    ).toBeInTheDocument();
    const conceptNode = screen.getByRole('button', {
      name: 'concept node: Functors',
    });
    expect(conceptNode).toBeInTheDocument();

    // Click concept node to open inspector and create a note from it
    await user.click(conceptNode);
    await user.click(
      screen.getByRole('button', { name: /create note “functors”/i })
    );

    // Should return to editor with new note titled "Functors"
    expect(screen.getByLabelText(/note title/i)).toHaveValue('Functors');
  });
});

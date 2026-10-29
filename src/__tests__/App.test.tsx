import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

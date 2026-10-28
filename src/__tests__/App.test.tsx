import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';

beforeEach(() => {
  localStorage.clear();
});

describe('App integration', () => {
  it('shows empty state on first load', () => {
    render(<App />);
    expect(screen.getByText(/no note selected/i)).toBeInTheDocument();
  });

  it('creates a note when New note button is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Use the EmptyState "New note" button (exact text, not the sidebar "+" button)
    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(screen.getByLabelText(/note title/i)).toBeInTheDocument();
    expect(screen.queryByText(/no note selected/i)).not.toBeInTheDocument();
  });

  it('creates a note with Cmd+N shortcut', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard('{Meta>}n{/Meta}');
    expect(screen.getByLabelText(/note title/i)).toBeInTheDocument();
  });

  it('auto-saves title as user types', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    const titleInput = screen.getByLabelText(/note title/i);
    await user.type(titleInput, 'My First Note');
    expect(titleInput).toHaveValue('My First Note');
    // Check the sidebar reflects the title
    expect(screen.getByText('My First Note')).toBeInTheDocument();
  });

  it('auto-saves content as user types', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    const contentArea = screen.getByLabelText(/note content/i);
    await user.type(contentArea, 'Hello world');
    expect(contentArea).toHaveValue('Hello world');
  });

  it('shows delete confirmation dialog when delete is triggered', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/delete note\?/i)).toBeInTheDocument();
  });

  it('cancels delete when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/note title/i)).toBeInTheDocument();
  });

  it('deletes note after confirmation and shows empty state', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/no note selected/i)).toBeInTheDocument();
  });

  it('persists notes across re-mounts (simulates page refresh)', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    const titleInput = screen.getByLabelText(/note title/i);
    await user.type(titleInput, 'Persistent note');
    unmount();

    render(<App />);
    expect(screen.getByText('Persistent note')).toBeInTheDocument();
  });

  it('closes dialog with Escape key', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New note' }));
    await user.click(screen.getByRole('button', { name: 'Delete note' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows backlinks, related notes, and concept creation in Knowledge Connections panel', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Create first note: "Relativity" with #physics and [[Spacetime]]
    // Note: in userEvent v14, '[' is escaped as '[['
    await user.click(screen.getByRole('button', { name: 'New note' }));
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

    await user.click(screen.getByRole('button', { name: 'New note' }));
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


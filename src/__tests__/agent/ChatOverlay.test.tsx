import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatOverlay } from '../../components/ChatOverlay';
import { DEFAULT_AGENT_SETTINGS } from '../../agent/settings';
import type { AgentSession } from '../../agent/useAgentSession';

function fakeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  const base: AgentSession = {
    providers: [
      {
        id: 'mock',
        label: 'Local Mock (offline)',
        description: '',
        localOnly: true,
        stream: function* () {} as unknown as AgentSession['providers'][0]['stream'],
      },
    ],
    providerId: 'mock',
    setProviderId: vi.fn(),
    messages: [],
    isStreaming: false,
    lastError: null,
    canRetry: false,
    send: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    retry: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
  };
  return { ...base, ...overrides };
}

describe('ChatOverlay', () => {
  it('renders nothing when closed', () => {
    render(<ChatOverlay open={false} onClose={vi.fn()} session={fakeSession()} />);
    expect(screen.queryByRole('complementary', { name: /agent chat/i })).toBeNull();
  });

  it('shows the selector, local badge, and empty hint when open', () => {
    render(<ChatOverlay open onClose={vi.fn()} session={fakeSession()} />);
    expect(screen.getByRole('complementary', { name: /agent chat/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getByText(/chat with an agent about your notes/i)).toBeInTheDocument();
  });

  it('sends the draft and clears the composer', async () => {
    const user = userEvent.setup();
    const session = fakeSession();
    render(<ChatOverlay open onClose={vi.fn()} session={session} />);
    const input = screen.getByLabelText(/message the agent/i);
    await user.type(input, 'what did I write?');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    expect(session.send).toHaveBeenCalledWith('what did I write?', []);
    expect(input).toHaveValue('');
  });

  it('shows the stop control while streaming', () => {
    const session = fakeSession({ isStreaming: true });
    render(<ChatOverlay open onClose={vi.fn()} session={session} />);
    fireEvent.click(screen.getByRole('button', { name: /stop generating/i }));
    expect(session.stop).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /send message/i })).toBeNull();
  });

  it('renders assistant replies through the markdown renderer', () => {
    const session = fakeSession({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '## Reply heading' },
      ],
    });
    render(<ChatOverlay open onClose={vi.fn()} session={session} />);
    expect(
      screen.getByRole('heading', { level: 2, name: /reply heading/i })
    ).toBeInTheDocument();
  });

  it('changes agent via the selector', () => {
    const session = fakeSession();
    render(<ChatOverlay open onClose={vi.fn()} session={session} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent' }), {
      target: { value: 'mock' },
    });
    expect(session.setProviderId).toHaveBeenCalledWith('mock');
  });

  it('persists a selector change through the settings callback', () => {
    // Session state alone is lost on reload and would silently reselect the
    // previously persisted provider, so a selector change persists too.
    const stream = function* () {} as unknown as AgentSession['providers'][0]['stream'];
    const session = fakeSession({
      providers: [
        { id: 'mock', label: 'Local Mock (offline)', description: '', localOnly: true, stream },
        { id: 'openai', label: 'OpenAI-compatible (remote)', description: '', localOnly: false, stream },
      ],
      providerId: 'openai',
    });
    const settings = { ...DEFAULT_AGENT_SETTINGS, providerId: 'openai' };
    const onSettingsChange = vi.fn();
    render(
      <ChatOverlay
        open
        onClose={vi.fn()}
        session={session}
        settings={settings}
        onSettingsChange={onSettingsChange}
      />
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Agent' }), {
      target: { value: 'mock' },
    });
    expect(session.setProviderId).toHaveBeenCalledWith('mock');
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, providerId: 'mock' });
  });

  it('surfaces the last error', () => {
    const session = fakeSession({ lastError: 'connection reset' });
    render(<ChatOverlay open onClose={vi.fn()} session={session} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/connection reset/);
  });

  it('navigates wikilinks inside assistant replies', async () => {
    const user = userEvent.setup();
    const onWikiLinkClick = vi.fn();
    const session = fakeSession({
      messages: [
        { role: 'user', content: 'where should I look?' },
        { role: 'assistant', content: 'Check [[My Note]] for details.' },
      ],
    });
    render(
      <ChatOverlay open onClose={vi.fn()} session={session} onWikiLinkClick={onWikiLinkClick} />
    );
    await user.click(screen.getByRole('button', { name: '[[My Note]]' }));
    expect(onWikiLinkClick).toHaveBeenCalledWith('My Note');
  });

  it('offers retry only when a previous input can be re-sent', async () => {
    const user = userEvent.setup();
    const retry = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatOverlay open onClose={vi.fn()} session={fakeSession({ canRetry: true, retry })} />
    );
    await user.click(screen.getByRole('button', { name: /retry last message/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('hides retry when there is nothing to retry', () => {
    render(<ChatOverlay open onClose={vi.fn()} session={fakeSession({ canRetry: false })} />);
    expect(screen.queryByRole('button', { name: /retry last message/i })).toBeNull();
  });

  it('activates a defaultActive chip the first time it appears, not only at mount', () => {
    // Mount with no options (normal startup: notes still hydrating)
    const options = [{ id: 'current-note', label: 'Current note', content: 'x', defaultActive: true }];
    const { rerender } = render(
      <ChatOverlay open onClose={vi.fn()} session={fakeSession()} attachmentOptions={[]} />
    );
    expect(screen.queryByRole('button', { name: 'Current note' })).toBeNull();

    // Notes hydrate and the current-note chip appears — it must activate
    rerender(<ChatOverlay open onClose={vi.fn()} session={fakeSession()} attachmentOptions={options} />);
    expect(screen.getByRole('button', { name: 'Current note' })).toHaveAttribute('aria-pressed', 'true');

    // User toggles it off; a re-render with the same option must not re-activate it
    fireEvent.click(screen.getByRole('button', { name: 'Current note' }));
    rerender(<ChatOverlay open onClose={vi.fn()} session={fakeSession()} attachmentOptions={options} />);
    expect(screen.getByRole('button', { name: 'Current note' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders context chips, toggles them, and snapshots active ones at send', async () => {
    const user = userEvent.setup();
    const send = vi.fn().mockResolvedValue(undefined);
    const session = fakeSession({ send });
    const options = [
      { id: 'current-note', label: 'Current note', content: 'note body', defaultActive: true },
      { id: 'recent-notes', label: 'Recent notes', content: '- a\n- b' },
    ];
    render(
      <ChatOverlay open onClose={vi.fn()} session={session} attachmentOptions={options} />
    );
    const currentChip = screen.getByRole('button', { name: 'Current note' });
    const recentChip = screen.getByRole('button', { name: 'Recent notes' });
    expect(currentChip).toHaveAttribute('aria-pressed', 'true');
    expect(recentChip).toHaveAttribute('aria-pressed', 'false');

    await user.click(recentChip);
    expect(recentChip).toHaveAttribute('aria-pressed', 'true');

    await user.type(screen.getByLabelText(/message the agent/i), 'hello');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    expect(send).toHaveBeenCalledWith('hello', [
      { id: 'current-note', label: 'Current note', content: 'note body', defaultActive: true },
      { id: 'recent-notes', label: 'Recent notes', content: '- a\n- b' },
    ]);
  });

  it('renders tool results as collapsible transcripts with their call args', () => {
    const session = fakeSession({
      messages: [
        { role: 'user', content: 'find notes' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'notes.search', args: { query: 'physics' } }],
        },
        { role: 'tool', content: '2 note(s) matched', toolCallId: 'c1', ok: true },
        { role: 'assistant', content: 'Here is what I found.' },
      ],
    });
    render(<ChatOverlay open onClose={vi.fn()} session={session} />);
    const summary = screen.getByText('🛠 notes.search');
    fireEvent.click(summary);
    expect(screen.getByText(/"query": "physics"/)).toBeInTheDocument();
    expect(screen.getByText(/2 note\(s\) matched/)).toBeInTheDocument();
  });
});

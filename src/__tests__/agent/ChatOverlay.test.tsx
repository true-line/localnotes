import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatOverlay } from '../../components/ChatOverlay';
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

  it('surfaces the last error', () => {
    const session = fakeSession({ lastError: 'connection reset' });
    render(<ChatOverlay open onClose={vi.fn()} session={session} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/connection reset/);
  });
});

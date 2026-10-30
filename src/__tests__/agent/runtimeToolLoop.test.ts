import { describe, it, expect } from 'vitest';
import { AgentRuntime } from '../../agent/runtime';
import type { AgentMessage, AgentProvider, StreamEvent } from '../../agent/types';

async function collect(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

describe('AgentRuntime tool loop', () => {
  it('feeds tool results back for a follow-up round', async () => {
    const runtime = new AgentRuntime();
    let round = 0;
    const requests: AgentMessage[][] = [];
    // Round 1 requests a tool; round 2 answers from the tool result.
    const provider: AgentProvider = {
      id: 'loop',
      label: 'loop',
      description: '',
      localOnly: true,
      async *stream(messages) {
        round += 1;
        requests.push([...messages]);
        if (round === 1) {
          yield { type: 'tool-call', call: { id: 'c1', name: 'notes.search', args: { query: 'x' } } };
        } else {
          yield { type: 'text-delta', delta: 'found it, thanks' };
        }
      },
    };
    const tools = [
      {
        name: 'notes.search',
        description: 'search',
        inputSchema: { type: 'object' },
        tier: 0 as const,
        execute: async () => ({ ok: true, content: '1 result: spacetime' }),
      },
    ];
    const events = await collect(runtime.run({ text: 'find x' }, provider, tools));

    // Two rounds were streamed; the loop terminated on the text-only round
    expect(round).toBe(2);
    const roles = runtime.getMessages().map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
    // Round 2's request snapshot contained the tool result
    const toolMessageInRequest = requests[1].find(
      (m) => m.role === 'tool' && m.content === '1 result: spacetime'
    );
    expect(toolMessageInRequest).toBeDefined();
    const done = events[events.length - 1] as Extract<StreamEvent, { type: 'done' }>;
    expect(done.reason).toBe('end');
  });

  it('bounds the tool loop at four rounds', async () => {
    const runtime = new AgentRuntime();
    let calls = 0;
    const toolSpam: AgentProvider = {
      id: 'spam',
      label: 'spam',
      description: '',
      localOnly: true,
      async *stream() {
        calls += 1;
        yield { type: 'tool-call', call: { id: `c${calls}`, name: 'noop', args: {} } };
      },
    };
    const tools = [
      {
        name: 'noop',
        description: 'noop',
        inputSchema: { type: 'object' },
        tier: 0 as const,
        execute: async () => ({ ok: true, content: 'ok' }),
      },
    ];
    const events = await collect(runtime.run({ text: 'go' }, toolSpam, tools));
    const errorEvent = events.find(
      (e) => e.type === 'error'
    ) as Extract<StreamEvent, { type: 'error' }>;
    expect(errorEvent.error).toContain('tool loop exceeded');
    expect(doneReason(events)).toBe('error');
  });

  it('marks the turn stopped when aborted between rounds', async () => {
    const runtime = new AgentRuntime();
    const provider: AgentProvider = {
      id: 'loopstop',
      label: 'loopstop',
      description: '',
      localOnly: true,
      async *stream(_messages, { signal }) {
        yield { type: 'tool-call', call: { id: 'c1', name: 'noop', args: {} } };
        if (signal.aborted) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      },
    };
    const tools = [
      {
        name: 'noop',
        description: 'noop',
        inputSchema: { type: 'object' },
        tier: 0 as const,
        execute: async () => ({ ok: true, content: 'ok' }),
      },
    ];
    const generator = runtime.run({ text: 'go' }, provider, tools);
    const events: StreamEvent[] = [];
    for await (const event of generator) {
      events.push(event);
      if (event.type === 'tool-result') runtime.stop();
    }
    const done = events[events.length - 1] as Extract<StreamEvent, { type: 'done' }>;
    expect(done.reason).toBe('stop');
  });
});

function doneReason(events: StreamEvent[]): string {
  const last = events[events.length - 1];
  return last?.type === 'done' ? last.reason : 'missing';
}

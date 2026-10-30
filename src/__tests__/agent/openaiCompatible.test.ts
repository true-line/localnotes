import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOpenAICompatibleProvider } from '../../agent/providers/openaiCompatible';
import type { AgentMessage, StreamEvent } from '../../agent/types';

const CONFIG = {
  baseUrl: 'http://localhost:11434/v1',
  model: 'qwen3:30b-a3b',
  apiKey: '',
};

function sseResponse(frames: string[]): Response {
  return new Response(frames.map((f) => `data: ${f}\n\n`).join('') + 'data: [DONE]\n\n');
}

async function collect(
  stream: AsyncIterable<StreamEvent>
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

const userMsg: AgentMessage = { role: 'user', content: 'hi' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openaiCompatible provider', () => {
  it('streams content deltas from SSE frames', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
        JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAICompatibleProvider(() => CONFIG);
    const events = await collect(provider.stream([userMsg], {
      tools: [],
      signal: new AbortController().signal,
    }));

    expect(events).toEqual([
      { type: 'text-delta', delta: 'Hel' },
      { type: 'text-delta', delta: 'lo' },
    ]);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).model).toBe('qwen3:30b-a3b');
    expect(init.body).not.toContain('"tools"');
  });

  it('advances past keep-alive lines and [DONE] without stalling', async () => {
    // Comment lines, non-data lines, and [DONE] must not leave the SSE
    // cursor stale: earlier code looped forever once such a line appeared.
    const stream =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      ': keep-alive\n\n' +
      'event: ping\ndata: not-json\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      'data: [DONE]\n\n';
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAICompatibleProvider(() => CONFIG);
    const events = await collect(provider.stream([userMsg], {
      tools: [],
      signal: new AbortController().signal,
    }));

    expect(events).toEqual([
      { type: 'text-delta', delta: 'Hel' },
      { type: 'text-delta', delta: 'lo' },
    ]);
  });

  it('accumulates streamed tool_calls and emits them as calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'notes.search', arguments: '{"que' } },
              ],
            },
          }],
        }),
        JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: 'ry": "physics"}' } },
              ],
            },
          }],
        }),
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAICompatibleProvider(() => CONFIG);
    const events = await collect(provider.stream([userMsg], {
      tools: [{
        name: 'notes.search',
        description: 'search',
        inputSchema: { type: 'object' },
        tier: 0,
        execute: async () => ({ ok: true, content: 'x' }),
      }],
      signal: new AbortController().signal,
    }));

    const call = events.find((e) => e.type === 'tool-call') as Extract<
      StreamEvent,
      { type: 'tool-call' }
    >;
    expect(call.call).toEqual({
      id: 'call_1',
      name: 'notes.search',
      args: { query: 'physics' },
    });
    // Tools were sent in the request body
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.tools[0].function.name).toBe('notes.search');
  });

  it('converts tool-role messages back into OpenAI format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAICompatibleProvider(() => CONFIG);
    const messages: AgentMessage[] = [
      { role: 'user', content: 'find x' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_9', name: 'notes.search', args: { query: 'x' } }],
      },
      { role: 'tool', content: '1 match', toolCallId: 'call_9' },
    ];
    await collect(provider.stream(messages, {
      tools: [],
      signal: new AbortController().signal,
    }));

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body).messages;
    expect(sent[1].tool_calls[0].function.name).toBe('notes.search');
    expect(sent[2]).toEqual({ role: 'tool', content: '1 match', tool_call_id: 'call_9' });
  });

  it('surfaces HTTP failures as thrown errors for the runtime', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"error":"nope"}', { status: 500 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAICompatibleProvider(() => CONFIG);
    await expect(
      collect(provider.stream([userMsg], {
        tools: [],
        signal: new AbortController().signal,
      }))
    ).rejects.toThrow(/provider responded 500/);
  });
});

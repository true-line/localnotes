import type { AgentProvider, StreamEvent } from '../types';

const CHUNK_SIZE = 24;
const CHUNK_DELAY_MS = 15;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function chunkReply(text: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

function buildReply(lastUserTurn: string, contextCount: number): string {
  const quoted =
    lastUserTurn.length > 120 ? `${lastUserTurn.slice(0, 120)}…` : lastUserTurn;
  return [
    `You said: “${quoted}”`,
    '',
    "I'm the offline mock provider, so this reply is canned — nothing left your device.",
    contextCount > 0
      ? `I can see ${contextCount} attached context block${contextCount === 1 ? '' : 's'}; when a real provider is configured (M4), that content is exactly what it would receive.`
      : 'No context is attached; use the chips above the composer to attach notes.',
  ].join('\n\n');
}

const SEARCH_RE = /(?:^|\s)(?:find|search(?:\s+for)?|look\s+up)\s+(.+)/i;

/**
 * Deterministic offline provider: streams canned replies in small chunks so
 * the drawer's streaming, stop, and retry paths work with zero keys and zero
 * network. Fake model, real data — when the user's message looks like a
 * search, it emits a genuine notes.search tool-call that the runtime executes
 * against the vault; the tool result shown in the transcript is real.
 */
export function createMockProvider(): AgentProvider {
  return {
    id: 'mock',
    label: 'Local Mock (offline)',
    description:
      'Deterministic offline assistant. Canned replies; useful for testing the chat experience without a provider.',
    localOnly: true,
    async *stream(messages, { tools, signal }): AsyncGenerator<StreamEvent> {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      // Context blocks live in the enriched `content`; the user's own words
      // are in `displayText`.
      const text = lastUser?.displayText ?? lastUser?.content ?? '';
      const contextCount = (lastUser?.content.match(/<context /g) ?? []).length;
      const match = SEARCH_RE.exec(text);
      if (match && tools.some((t) => t.name === 'notes.search')) {
        yield {
          type: 'tool-call',
          call: { id: 'mock-call-1', name: 'notes.search', args: { query: match[1].trim() } },
        };
        if (signal.aborted) return;
        yield {
          type: 'text-delta',
          delta: 'I ran a real search against your vault — the result is in the tool entry above.',
        };
        return;
      }
      const reply = buildReply(text, contextCount);
      for (const chunk of chunkReply(reply)) {
        if (signal.aborted) return;
        await delay(CHUNK_DELAY_MS);
        if (signal.aborted) return;
        yield { type: 'text-delta', delta: chunk };
      }
    },
  };
}

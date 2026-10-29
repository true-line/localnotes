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

function buildReply(lastUserTurn: string): string {
  const contextCount = (lastUserTurn.match(/<context /g) ?? []).length;
  const quoted =
    lastUserTurn.length > 120 ? `${lastUserTurn.slice(0, 120)}…` : lastUserTurn;
  return [
    `You said: “${quoted}”`,
    '',
    "I'm the offline mock provider, so this reply is canned — nothing left your device.",
    contextCount > 0
      ? `I can see ${contextCount} attached context block${contextCount === 1 ? '' : 's'}; when a real provider is configured (M4), that content is exactly what it would receive.`
      : 'No context is attached; use the chips above the composer to attach notes.',
    'Read-only note tools arrive in the next milestone slice.',
  ].join('\n\n');
}

/**
 * Deterministic offline provider: streams a canned reply in small chunks so
 * the drawer's streaming, stop, and retry paths can be exercised with zero
 * keys and zero network. It never emits `done` — the runtime owns it.
 */
export function createMockProvider(): AgentProvider {
  return {
    id: 'mock',
    label: 'Local Mock (offline)',
    description:
      'Deterministic offline assistant. Canned replies; useful for testing the chat experience without a provider.',
    localOnly: true,
    async *stream(messages, { signal }): AsyncGenerator<StreamEvent> {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const reply = buildReply(lastUser?.content ?? '');
      for (const chunk of chunkReply(reply)) {
        if (signal.aborted) return;
        await delay(CHUNK_DELAY_MS);
        if (signal.aborted) return;
        yield { type: 'text-delta', delta: chunk };
      }
    },
  };
}

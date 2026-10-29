import { useCallback, useRef, useState } from 'react';
import { AgentRuntime } from '../agent/runtime';
import { getProvider, getProviders } from '../agent/registry';
import type { AgentMessage, ContextAttachment, StreamEvent } from '../agent/types';

export interface AgentSession {
  providers: ReturnType<typeof getProviders>;
  providerId: string;
  /** Switching providers starts a fresh session. */
  setProviderId: (id: string) => void;
  messages: AgentMessage[];
  isStreaming: boolean;
  lastError: string | null;
  send: (text: string, attachments?: ContextAttachment[]) => Promise<void>;
  stop: () => void;
  retry: () => Promise<void>;
  clear: () => void;
}

export function useAgentSession(initialProviderId?: string): AgentSession {
  const providers = getProviders();
  const fallback = providers[0]?.id ?? 'mock';
  const [providerId, setProviderIdState] = useState(
    initialProviderId ?? fallback
  );
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const runtimeRef = useRef(new AgentRuntime());
  const lastInputRef = useRef<{
    text: string;
    attachments: ContextAttachment[];
  } | null>(null);
  const streamingRef = useRef(false);

  const send = useCallback(
    async (text: string, attachments: ContextAttachment[] = []) => {
      if (streamingRef.current || text.trim() === '') return;
      const provider = getProvider(providerId);
      if (!provider) {
        setLastError(`unknown provider: ${providerId}`);
        return;
      }
      lastInputRef.current = { text, attachments };
      setLastError(null);
      streamingRef.current = true;
      setIsStreaming(true);
      const runtime = runtimeRef.current;
      try {
        for await (const event of runtime.run({ text, attachments }, provider, [])) {
          setMessages(runtime.getMessages());
          if (event.type === 'error') setLastError(event.error);
          if (event.type === 'done') break;
        }
      } finally {
        streamingRef.current = false;
        setIsStreaming(false);
        setMessages(runtime.getMessages());
      }
    },
    [providerId]
  );

  const stop = useCallback(() => {
    runtimeRef.current.stop();
  }, []);

  const retry = useCallback(async () => {
    const last = lastInputRef.current;
    if (!last || streamingRef.current) return;
    runtimeRef.current.dropLastTurn();
    setMessages(runtimeRef.current.getMessages());
    await send(last.text, last.attachments);
  }, [send]);

  const setProviderId = useCallback((id: string) => {
    // Switching providers starts a fresh session; a mid-conversation switch
    // would otherwise mix context across providers with different semantics.
    setProviderIdState(id);
    runtimeRef.current.clear();
    lastInputRef.current = null;
    setMessages([]);
    setLastError(null);
  }, []);

  const clear = useCallback(() => {
    runtimeRef.current.clear();
    lastInputRef.current = null;
    setMessages([]);
    setLastError(null);
  }, []);

  return {
    providers,
    providerId,
    setProviderId,
    messages,
    isStreaming,
    lastError,
    send,
    stop,
    retry,
    clear,
  };
}

/** Re-exported for tests that want the exact event union. */
export type { StreamEvent };

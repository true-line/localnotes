import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentRuntime } from '../agent/runtime';
import { createMockProvider } from '../agent/providers/mock';
import { recordAgentAudit } from '../agent/audit';
import type { AgentMessage, AgentProvider, AgentTool, ContextAttachment } from '../agent/types';

export interface AgentSessionOptions {
  tools?: AgentTool[];
  providers?: AgentProvider[];
  /** Followed until the user picks an agent manually. */
  initialProviderId?: string;
}

export interface AgentSession {
  providers: AgentProvider[];
  providerId: string;
  /** Switching providers starts a fresh session. */
  setProviderId: (id: string) => void;
  messages: AgentMessage[];
  isStreaming: boolean;
  lastError: string | null;
  /** True when a previous input exists and can be re-sent via retry(). */
  canRetry: boolean;
  send: (text: string, attachments?: ContextAttachment[]) => Promise<void>;
  stop: () => void;
  retry: () => Promise<void>;
  clear: () => void;
}

export function useAgentSession(options: AgentSessionOptions = {}): AgentSession {
  const { tools = [], initialProviderId } = options;
  const providers = options.providers ?? [createMockProvider()];
  const fallbackId = providers[0]?.id ?? 'mock';

  const [providerId, setProviderIdState] = useState(initialProviderId ?? fallbackId);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [hasLastInput, setHasLastInput] = useState(false);
  // Threat-model invariant 5: every agent action lands in the local audit
  // log. Recording is fire-and-forget — a failed write must never break a
  // running turn.
  const runtimeRef = useRef(
    new AgentRuntime({
      audit: (entry) => {
        void recordAgentAudit(entry).catch(() => {});
      },
    })
  );
  const toolsRef = useRef<AgentTool[]>(tools);
  toolsRef.current = tools;
  const providersRef = useRef<AgentProvider[]>(providers);
  providersRef.current = providers;
  const lastInputRef = useRef<{
    text: string;
    attachments: ContextAttachment[];
  } | null>(null);
  const streamingRef = useRef(false);
  // Once the user picks an agent, settings-driven initial ids stop applying.
  const userChosenRef = useRef(false);

  useEffect(() => {
    if (initialProviderId && !userChosenRef.current) {
      setProviderIdState(initialProviderId);
    }
  }, [initialProviderId]);

  const send = useCallback(
    async (text: string, attachments: ContextAttachment[] = []) => {
      if (streamingRef.current || text.trim() === '') return;
      const provider =
        providersRef.current.find((p) => p.id === providerId) ??
        providersRef.current[0];
      if (!provider) {
        setLastError('no agent provider available');
        return;
      }
      lastInputRef.current = { text, attachments };
      setHasLastInput(true);
      setLastError(null);
      streamingRef.current = true;
      setIsStreaming(true);
      const runtime = runtimeRef.current;
      try {
        for await (const event of runtime.run(
          { text, attachments },
          provider,
          toolsRef.current
        )) {
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
    userChosenRef.current = true;
    setProviderIdState(id);
    runtimeRef.current.clear();
    lastInputRef.current = null;
    setMessages([]);
    setLastError(null);
    setHasLastInput(false);
  }, []);

  const clear = useCallback(() => {
    runtimeRef.current.clear();
    lastInputRef.current = null;
    setMessages([]);
    setLastError(null);
    setHasLastInput(false);
  }, []);

  return {
    providers,
    providerId,
    setProviderId,
    messages,
    isStreaming,
    lastError,
    canRetry: hasLastInput && !isStreaming,
    send,
    stop,
    retry,
    clear,
  };
}

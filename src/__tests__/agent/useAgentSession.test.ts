import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAgentSession } from '../../agent/useAgentSession';
import type { AgentMessage } from '../../agent/types';

describe('useAgentSession', () => {
  it('streams a reply through send and settles', async () => {
    const { result } = renderHook(() => useAgentSession());
    await act(async () => {
      await result.current.send('hello');
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(result.current.messages[1].content).toContain('offline mock provider');
    expect(result.current.lastError).toBeNull();
  });

  it('stops a running stream', async () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => {
      void result.current.send('long question');
    });
    expect(result.current.isStreaming).toBe(true);
    act(() => {
      result.current.stop();
    });
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(result.current.lastError).toBeNull();
  });

  it('retry resends the last input', async () => {
    const { result } = renderHook(() => useAgentSession());
    await act(async () => {
      await result.current.send('ask once');
    });
    const countAfterFirst = result.current.messages.length;
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.messages.length).toBe(countAfterFirst + 2);
    const secondToLast: AgentMessage | undefined =
      result.current.messages[result.current.messages.length - 2];
    expect(secondToLast?.content).toContain('ask once');
  });

  it('switching provider starts a fresh session', async () => {
    const { result } = renderHook(() => useAgentSession());
    await act(async () => {
      await result.current.send('hello');
    });
    expect(result.current.messages.length).toBe(2);
    act(() => {
      result.current.setProviderId('mock');
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.providerId).toBe('mock');
  });

  it('ignores sends while streaming', async () => {
    const { result } = renderHook(() => useAgentSession());
    act(() => {
      void result.current.send('first');
    });
    // First delta must have landed before the second send: the guard test
    // is meaningless if the first turn already finished.
    await waitFor(() => expect(result.current.messages.length).toBeGreaterThan(0));
    expect(result.current.isStreaming).toBe(true);
    await act(async () => {
      await result.current.send('second');
    });
    // The second send was a no-op because the first was still streaming
    const userMessages: AgentMessage[] = result.current.messages.filter(
      (m) => m.role === 'user'
    );
    expect(userMessages.map((m) => m.content)).toEqual(['first']);
  });

  it('rejects empty text', async () => {
    const { result } = renderHook(() => useAgentSession());
    await act(async () => {
      await result.current.send('   ');
    });
    expect(result.current.messages).toEqual([]);
  });

  it('clear resets the conversation', async () => {
    const { result } = renderHook(() => useAgentSession());
    await act(async () => {
      await result.current.send('hello');
    });
    expect(result.current.canRetry).toBe(true);
    act(() => {
      result.current.clear();
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.canRetry).toBe(false);
    expect(result.current.lastError).toBeNull();
  });
});

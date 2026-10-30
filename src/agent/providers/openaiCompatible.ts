import type { AgentProvider, AgentTool, AgentMessage, StreamEvent } from '../types';

export interface OpenAIProviderConfig {
  /** OpenAI-compatible base URL, e.g. http://localhost:11434/v1 (Ollama). */
  baseUrl: string;
  model: string;
  /** Optional; Ollama needs none. */
  apiKey?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

function toOpenAIMessages(messages: AgentMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content });
    } else if (message.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args),
                },
              })),
            }
          : {}),
      });
    } else if (message.role === 'tool') {
      out.push({
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId ?? '',
      });
    }
  }
  return out;
}

function toOpenAITools(tools: AgentTool[]) {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

/**
 * Provider for any OpenAI-compatible chat-completions endpoint — one
 * implementation covers Ollama, LM Studio, vLLM, and OpenAI itself.
 * Streams SSE deltas; accumulates streamed tool_calls and emits them as
 * tool-call events (the runtime executes and feeds results back as tool
 * messages, so multi-round tool use is the runtime loop's job).
 */
export function createOpenAICompatibleProvider(
  getConfig: () => OpenAIProviderConfig
): AgentProvider {
  return {
    id: 'openai',
    label: 'OpenAI-compatible (remote)',
    description:
      'Streams from any OpenAI-compatible chat-completions endpoint (Ollama, LM Studio, vLLM, OpenAI).',
    localOnly: false,
    async *stream(messages, { tools, signal }): AsyncGenerator<StreamEvent> {
      const config = getConfig();
      const body = {
        model: config.model,
        messages: toOpenAIMessages(messages),
        ...(tools.length > 0 ? { tools: toOpenAITools(tools) } : {}),
        stream: true,
      };

      const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `provider responded ${response.status}: ${detail.slice(0, 200) || response.statusText}`
        );
      }
      if (!response.body) {
        throw new Error('provider returned an empty body');
      }

      // Accumulates streamed tool_calls by index until finish_reason.
      const pendingCalls = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let buffer = '';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const flushSse = function* (chunk: string): Generator<StreamEvent> {
        buffer += chunk;
        // The cursor is recomputed at the top of every iteration: a skipped
        // line (keep-alive, [DONE], unparseable) must not leave a stale index.
        for (;;) {
          const newline = buffer.indexOf('\n');
          if (newline === -1) break;
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          let parsed: {
            choices?: Array<{
              delta?: {
                content?: string | null;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue; // keep-alive or split frame; ignore
          }
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) yield { type: 'text-delta', delta: delta.content };
          for (const call of delta?.tool_calls ?? []) {
            const index = call.index ?? 0;
            const existing = pendingCalls.get(index) ?? {
              id: '',
              name: '',
              arguments: '',
            };
            pendingCalls.set(index, {
              id: call.id || existing.id,
              name: call.function?.name || existing.name,
              arguments: existing.arguments + (call.function?.arguments ?? ''),
            });
          }
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield* flushSse(decoder.decode(value, { stream: true }));
        }
        yield* flushSse(decoder.decode());
      } finally {
        reader.releaseLock();
      }

      // Stream ended: emit any accumulated tool-call requests in index order
      for (const call of [...pendingCalls.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, call]) => call)) {
        if (!call.name) continue;
        // Unparseable arguments fall through as empty; the runtime's schema
        // validation then reports the mismatch in the tool result.
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call.arguments) as Record<string, unknown>;
          if (parsed && typeof parsed === 'object') args = parsed;
        } catch {
          args = {};
        }
        if (signal.aborted) return;
        yield {
          type: 'tool-call',
          call: { id: call.id || `call-${crypto.randomUUID()}`, name: call.name, args },
        };
      }
    },
  };
}

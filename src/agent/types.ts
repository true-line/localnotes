// Agent chat core types. The runtime owns exactly one `done` event per turn;
// providers simply end their stream (or throw) — any `done` a provider yields
// is ignored by the runtime.

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  ok: boolean;
  content: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  /** Original user text when `content` carries enriched context blocks. */
  displayText?: string;
}

export type StreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; result: ToolResult }
  | { type: 'done'; reason: 'end' | 'stop' | 'error' }
  | { type: 'error'; error: string };

export interface StreamOptions {
  tools: AgentTool[];
  signal: AbortSignal;
}

export interface AgentProvider {
  id: string;
  label: string;
  description: string;
  /** True when the provider cannot send data off-device (drives the badge). */
  localOnly: boolean;
  stream(messages: AgentMessage[], options: StreamOptions): AsyncIterable<StreamEvent>;
}

export interface AgentTool {
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12 subset) for `args`. */
  inputSchema: Record<string, unknown>;
  tier: 0 | 1 | 2;
  execute(args: Record<string, unknown>): Promise<{ ok: boolean; content: string }>;
}

export interface ContextAttachment {
  id: string;
  label: string;
  content: string;
}

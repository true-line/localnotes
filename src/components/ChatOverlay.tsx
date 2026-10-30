import { useEffect, useRef, useState } from 'react';
import type { ContextAttachment } from '../agent/types';
import type { AgentSession } from '../agent/useAgentSession';
import { MarkdownRenderer } from './MarkdownRenderer';
import '../styles/ChatOverlay.css';

interface Props {
  open: boolean;
  onClose: () => void;
  session: AgentSession;
  /** Available context chips; active ones snapshot into the sent message. */
  attachmentOptions?: ContextAttachment[];
  /** Wikilinks inside assistant replies navigate like editor wikilinks. */
  onWikiLinkClick?: (target: string) => void;
  onTagClick?: (tag: string) => void;
}

export function ChatOverlay({
  open,
  onClose,
  session,
  attachmentOptions = [],
  onWikiLinkClick,
  onTagClick,
}: Props) {
  const [draft, setDraft] = useState('');
  const [activeIds, setActiveIds] = useState<Set<string>>(
    () => new Set(attachmentOptions.filter((a) => a.defaultActive).map((a) => a.id))
  );
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const activeProvider =
    session.providers.find((p) => p.id === session.providerId) ??
    session.providers[0];

  useEffect(() => {
    // Drop active ids that no longer exist (e.g. Selection when deselected)
    setActiveIds((prev) => {
      const valid = new Set(attachmentOptions.map((a) => a.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      const changed =
        next.size !== prev.size || [...next].some((id) => !prev.has(id));
      return changed ? next : prev;
    });
  }, [attachmentOptions]);

  const toggleChip = (id: string) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (open) {
      restoreRef.current = document.activeElement as HTMLElement | null;
      composerRef.current?.focus();
    } else {
      restoreRef.current?.focus?.();
      restoreRef.current = null;
    }
  }, [open]);

  // Keep the newest message in view while streaming.
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [session.messages, session.isStreaming]);

  if (!open) return null;

  const canSend = draft.trim() !== '' && !session.isStreaming;

  const send = () => {
    if (!canSend) return;
    const text = draft;
    const attachments = attachmentOptions.filter((a) => activeIds.has(a.id));
    setDraft('');
    void session.send(text, attachments);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <aside className="agent-chat" aria-label="Agent chat">
      <div className="agent-chat__header">
        <div className="agent-chat__selector-wrap">
          <select
            className="agent-chat__selector"
            aria-label="Agent"
            value={session.providerId}
            onChange={(e) => session.setProviderId(e.target.value)}
          >
            {session.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
          <span
            className={`agent-chat__reach${
              activeProvider?.localOnly ? ' agent-chat__reach--local' : ''
            }`}
            title={
              activeProvider?.localOnly
                ? 'This agent runs locally; nothing leaves the device'
                : 'This agent sends data to a remote endpoint'
            }
          >
            {activeProvider?.localOnly ? 'local' : 'remote'}
          </span>
        </div>
        <div className="agent-chat__header-actions">
          <button
            type="button"
            className="agent-chat__icon-btn"
            onClick={session.clear}
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            ⌫
          </button>
          <button
            type="button"
            className="agent-chat__icon-btn"
            onClick={onClose}
            aria-label="Close agent chat"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="agent-chat__transcript" ref={transcriptRef}>
        {session.messages.length === 0 ? (
          <p className="agent-chat__empty">
            Chat with an agent about your notes. Press Cmd+J to toggle this
            panel.
          </p>
        ) : (
          session.messages.map((message, index) => {
            if (message.role === 'user') {
              return (
                <div className="agent-chat__msg agent-chat__msg--user" key={index}>
                  {message.displayText ?? message.content}
                </div>
              );
            }
            if (message.role === 'assistant') {
              const isPending =
                session.isStreaming &&
                index === session.messages.length - 1 &&
                message.content === '';
              return (
                <div
                  className="agent-chat__msg agent-chat__msg--assistant"
                  key={index}
                >
                  {isPending ? (
                    <span className="agent-chat__pending">Thinking…</span>
                  ) : (
                    <MarkdownRenderer
                      content={message.content}
                      onWikiLinkClick={onWikiLinkClick}
                      onTagClick={onTagClick}
                    />
                  )}
                </div>
              );
            }
            if (message.role === 'tool') {
              // Pair the result with its originating call (name + args)
              const call = session.messages
                .slice(0, index)
                .reverse()
                .find(
                  (m) =>
                    m.role === 'assistant' &&
                    m.toolCalls?.some((c) => c.id === message.toolCallId)
                )
                ?.toolCalls?.find((c) => c.id === message.toolCallId);
              return (
                <details className="agent-chat__tool" key={index}>
                  <summary>
                    🛠 {call ? call.name : 'tool'}
                    {message.ok === false ? ' — failed' : ''}
                  </summary>
                  {call && (
                    <pre className="agent-chat__tool-args">
                      {JSON.stringify(call.args, null, 2)}
                    </pre>
                  )}
                  <pre className="agent-chat__tool-result">{message.content}</pre>
                </details>
              );
            }
            return null;
          })
        )}
      </div>

      {session.lastError && (
        <p className="agent-chat__error" role="alert">
          {session.lastError}
        </p>
      )}

      <div className="agent-chat__chips" aria-label="Context attachments">
        {attachmentOptions.length === 0 ? (
          <span className="agent-chat__chips-empty">No context available</span>
        ) : (
          attachmentOptions.map((option) => {
            const active = activeIds.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className={`agent-chat__chip${active ? ' agent-chat__chip--active' : ''}`}
                aria-pressed={active}
                onClick={() => toggleChip(option.id)}
                title={option.content.length > 300 ? `${option.content.slice(0, 300)}…` : option.content}
              >
                {option.label}
              </button>
            );
          })
        )}
      </div>

      <div className="agent-chat__composer">
        <textarea
          ref={composerRef}
          className="agent-chat__input"
          aria-label="Message the agent"
          placeholder="Ask about your notes…"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {session.isStreaming ? (
          <button
            type="button"
            className="agent-chat__send agent-chat__send--stop"
            onClick={session.stop}
            aria-label="Stop generating"
          >
            ■
          </button>
        ) : (
          <>
            {session.canRetry && (
              <button
                type="button"
                className="agent-chat__retry"
                onClick={() => void session.retry()}
                aria-label="Retry last message"
                title="Retry last (re-sends your previous message)"
              >
                ↻
              </button>
            )}
            <button
              type="button"
              className="agent-chat__send"
              onClick={send}
              disabled={!canSend}
              aria-label="Send message"
              title="Send (Enter)"
            >
              ➤
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

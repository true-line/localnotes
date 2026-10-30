import { useEffect, useRef, useState } from 'react';
import type { ContextAttachment } from '../agent/types';
import type { AgentSession } from '../agent/useAgentSession';
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from '../agent/settings';
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
  settings?: AgentSettings;
  onSettingsChange?: (settings: AgentSettings) => void;
}

export function ChatOverlay({
  open,
  onClose,
  session,
  attachmentOptions = [],
  onWikiLinkClick,
  onTagClick,
  settings = DEFAULT_AGENT_SETTINGS,
  onSettingsChange,
}: Props) {
  const [draft, setDraft] = useState('');
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [remoteDraft, setRemoteDraft] = useState(settings.openai);
  // Selected text from the agent-settings panel.
  const [permissionNote, setPermissionNote] = useState('');
  // Chips the user has already decided about (toggled) or that were offered:
  // defaultActive applies exactly once per chip, the first time it appears —
  // later appearances (notes hydrating, note switching) must not fight the
  // user's explicit toggle-off.
  const decidedIdsRef = useRef<Set<string>>(new Set());
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const activeProvider =
    session.providers.find((p) => p.id === session.providerId) ??
    session.providers[0];
  const isRemoteProvider = activeProvider?.id === 'openai';

  // Sync the remote-settings draft when settings change externally.
  useEffect(() => {
    setRemoteDraft(settings.openai);
  }, [settings.openai]);

  const grantNetworkAccess = async () => {
    try {
      const origin = new URL(remoteDraft.baseUrl).origin;
      const pattern = `${origin}/*`;
      const chromeApi = (
        globalThis as {
          chrome?: {
            permissions?: {
              request?: (details: { origins: string[] }) => Promise<boolean>;
            };
          };
        }
      ).chrome;
      if (chromeApi?.permissions?.request) {
        const granted = await chromeApi.permissions.request({ origins: [pattern] });
        setPermissionNote(
          granted ? `Access granted for ${pattern}` : `Access not granted for ${pattern}`
        );
      } else {
        setPermissionNote(`Add ${pattern} to the extension's host permissions`);
      }
    } catch {
      setPermissionNote('Invalid base URL');
    }
  };

  const saveRemoteSettings = () => {
    onSettingsChange?.({
      ...settings,
      providerId: 'openai',
      openai: { ...remoteDraft },
    });
  };

  // A selector change is a settings change too: session state alone would be
  // lost on reload, silently reselecting the previously persisted provider.
  const changeProvider = (id: string) => {
    session.setProviderId(id);
    if (id !== settings.providerId) {
      onSettingsChange?.({ ...settings, providerId: id });
    }
  };

  useEffect(() => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const option of attachmentOptions) {
        const firstAppearance = !decidedIdsRef.current.has(option.id);
        decidedIdsRef.current.add(option.id);
        if (firstAppearance && option.defaultActive && !next.has(option.id)) {
          next.add(option.id);
          changed = true;
        }
      }
      // Drop ids that no longer exist (e.g. Selection when deselected)
      const valid = new Set(attachmentOptions.map((a) => a.id));
      for (const id of [...next]) {
        if (!valid.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [attachmentOptions]);

  const toggleChip = (id: string) => {
    decidedIdsRef.current.add(id);
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
            onChange={(e) => changeProvider(e.target.value)}
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

      {isRemoteProvider && (
        <details className="agent-chat__remote-settings">
          <summary>Remote provider settings</summary>
          <label className="agent-chat__field">
            <span>Base URL</span>
            <input
              type="text"
              value={remoteDraft.baseUrl}
              onChange={(e) =>
                setRemoteDraft({ ...remoteDraft, baseUrl: e.target.value })
              }
              placeholder="http://localhost:11434/v1"
            />
          </label>
          <label className="agent-chat__field">
            <span>Model</span>
            <input
              type="text"
              value={remoteDraft.model}
              onChange={(e) =>
                setRemoteDraft({ ...remoteDraft, model: e.target.value })
              }
              placeholder="qwen3:30b-a3b"
            />
          </label>
          <label className="agent-chat__field">
            <span>API key (optional)</span>
            <input
              type="password"
              value={remoteDraft.apiKey}
              onChange={(e) =>
                setRemoteDraft({ ...remoteDraft, apiKey: e.target.value })
              }
              placeholder="none needed for Ollama"
            />
          </label>
          <div className="agent-chat__settings-actions">
            <button
              type="button"
              className="agent-chat__chip"
              onClick={() => void grantNetworkAccess()}
              title="Grant this extension access to the endpoint origin"
            >
              Grant network access
            </button>
            <button
              type="button"
              className="agent-chat__chip agent-chat__chip--active"
              onClick={saveRemoteSettings}
              disabled={
                remoteDraft.baseUrl.trim() === '' || remoteDraft.model.trim() === ''
              }
            >
              Save
            </button>
          </div>
          {permissionNote && (
            <p className="agent-chat__settings-note" role="status">
              {permissionNote}
            </p>
          )}
        </details>
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

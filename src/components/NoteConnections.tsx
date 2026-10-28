import { useMemo } from 'react';
import type { Note, EmbeddingMap, EmbeddingStatus } from '../types';
import { getNoteConnections, normalizeKey } from '../knowledgeGraph';
import '../styles/NoteConnections.css';

interface Props {
  note: Note;
  allNotes: Note[];
  embeddings?: EmbeddingMap;
  embeddingStatus?: EmbeddingStatus;
  onSelectNote: (id: string) => void;
  onCreateConceptNote: (title: string) => void;
  onOpenGraphNode?: (nodeId: string) => void;
  onReindexEmbeddings?: () => void;
}

const STATUS_LABELS: Record<EmbeddingStatus, string> = {
  idle: 'Embeddings: Idle',
  'loading-model': 'Loading MiniLM model…',
  indexing: 'Indexing embeddings…',
  ready: 'Embeddings: Active',
  error: 'Embeddings: Offline',
};

export function NoteConnections({
  note,
  allNotes,
  embeddings = {},
  embeddingStatus = 'idle',
  onSelectNote,
  onCreateConceptNote,
  onOpenGraphNode,
  onReindexEmbeddings,
}: Props) {
  const connections = useMemo(
    () => getNoteConnections(note.id, allNotes, embeddings),
    [note, allNotes, embeddings]
  );

  const {
    outgoingNotes,
    unresolvedConcepts,
    tags,
    backlinks,
    relatedNotes,
    semanticNotes,
  } = connections;

  const hasOutgoing =
    tags.length > 0 || outgoingNotes.length > 0 || unresolvedConcepts.length > 0;
  const hasAny =
    hasOutgoing ||
    backlinks.length > 0 ||
    relatedNotes.length > 0 ||
    semanticNotes.length > 0;

  return (
    <section
      className="note-connections"
      aria-label="Knowledge graph connections"
    >
      <div className="note-connections__header">
        <div className="note-connections__title-row">
          <span className="note-connections__title">Knowledge Connections</span>
          <span
            role="status"
            className={`note-connections__status note-connections__status--${embeddingStatus}`}
          >
            {STATUS_LABELS[embeddingStatus]}
          </span>
          {onReindexEmbeddings && (
            <button
              type="button"
              className="note-connections__graph-link"
              onClick={onReindexEmbeddings}
              title="Re-compute semantic embeddings for all notes"
            >
              ↻ Re-index
            </button>
          )}
        </div>
        {onOpenGraphNode && (
          <button
            type="button"
            className="note-connections__graph-link"
            onClick={() => onOpenGraphNode(`note:${note.id}`)}
          >
            Explore in Graph
          </button>
        )}
      </div>

      {!hasAny ? (
        <p className="note-connections__hint">
          Link notes and concepts with <code>[[Wiki Links]]</code> or categorize
          with <code>#tags</code> to build your knowledge graph. Neural
          embeddings also automatically link semantically related notes.
        </p>
      ) : (
        <div className="note-connections__grid">
          {hasOutgoing && (
            <div className="note-connections__group">
              <h3 className="note-connections__group-title">
                Topics &amp; Links in Note
              </h3>
              <div className="note-connections__pills">
                {tags.map((tag) => (
                  <button
                    key={`tag:${tag}`}
                    type="button"
                    className="note-connections__pill note-connections__pill--tag"
                    title={`View #${tag} in knowledge graph`}
                    onClick={() => onOpenGraphNode?.(`tag:${tag}`)}
                  >
                    #{tag}
                  </button>
                ))}
                {outgoingNotes.map((target) => (
                  <button
                    key={`out:${target.id}`}
                    type="button"
                    className="note-connections__pill note-connections__pill--note"
                    title={`Open note "${target.title || 'Untitled'}"`}
                    onClick={() => onSelectNote(target.id)}
                  >
                    [[{target.title || 'Untitled'}]]
                  </button>
                ))}
                {unresolvedConcepts.map((concept) => (
                  <span
                    key={`concept:${normalizeKey(concept)}`}
                    className="note-connections__concept-group"
                  >
                    <button
                      type="button"
                      className="note-connections__pill note-connections__pill--concept"
                      title={`View concept "${concept}" in graph`}
                      onClick={() =>
                        onOpenGraphNode?.(`concept:${normalizeKey(concept)}`)
                      }
                    >
                      [[{concept}]]
                    </button>
                    <button
                      type="button"
                      className="note-connections__create-concept-btn"
                      aria-label={`Create note for ${concept}`}
                      title={`Create note "${concept}"`}
                      onClick={() => onCreateConceptNote(concept)}
                    >
                      + Note
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {backlinks.length > 0 && (
            <div className="note-connections__group">
              <h3 className="note-connections__group-title">
                Backlinks ({backlinks.length})
              </h3>
              <ul className="note-connections__list">
                {backlinks.map((source) => (
                  <li key={source.id}>
                    <button
                      type="button"
                      className="note-connections__item-btn"
                      onClick={() => onSelectNote(source.id)}
                    >
                      <span className="note-connections__item-title">
                        {source.title || 'Untitled'}
                      </span>
                      <span className="note-connections__item-badge">
                        links here
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {relatedNotes.length > 0 && (
            <div className="note-connections__group">
              <h3 className="note-connections__group-title">
                Related by Topic ({relatedNotes.length})
              </h3>
              <ul className="note-connections__list">
                {relatedNotes.map(({ note: relNote, sharedTopics }) => (
                  <li key={relNote.id}>
                    <button
                      type="button"
                      className="note-connections__item-btn"
                      onClick={() => onSelectNote(relNote.id)}
                    >
                      <span className="note-connections__item-title">
                        {relNote.title || 'Untitled'}
                      </span>
                      <span className="note-connections__shared-topics">
                        {sharedTopics.map((topic) => (
                          <span
                            key={topic}
                            className="note-connections__shared-badge"
                          >
                            {topic}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {semanticNotes.length > 0 && (
            <div className="note-connections__group">
              <h3 className="note-connections__group-title">
                Semantically Similar ({semanticNotes.length})
              </h3>
              <ul className="note-connections__list">
                {semanticNotes.map(({ note: semNote, similarity }) => (
                  <li key={semNote.id}>
                    <button
                      type="button"
                      className="note-connections__item-btn"
                      onClick={() => onSelectNote(semNote.id)}
                    >
                      <span className="note-connections__item-title">
                        {semNote.title || 'Untitled'}
                      </span>
                      <span className="note-connections__semantic-badge">
                        {Math.round(similarity * 100)}% match
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}


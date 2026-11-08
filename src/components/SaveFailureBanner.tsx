import type { FailedWrite } from '../hooks/useNotes';
import '../styles/SaveFailureBanner.css';

interface Props {
  failure: FailedWrite;
  /** How many other writes are also failed, shown so stacked failures are visible. */
  additionalCount?: number;
  onRetry: (noteId: string) => void;
  onDiscard: (noteId: string) => void;
}

export function SaveFailureBanner({
  failure,
  additionalCount = 0,
  onRetry,
  onDiscard,
}: Props) {
  const label = failure.noteTitle.trim() || 'Untitled';
  const isDelete = failure.kind === 'delete';
  return (
    <div className="save-failure" role="alert">
      <p className="save-failure__message">
        {isDelete
          ? `Couldn’t delete “${label}” — the note is still stored on this device.`
          : `Couldn’t save changes to “${label}”. Your latest edits are kept in this tab but are not stored yet.`}
        {additionalCount > 0 && ` (${additionalCount} more unsaved)`}
      </p>
      <div className="save-failure__actions">
        <button
          type="button"
          className="save-failure__btn save-failure__btn--primary"
          onClick={() => onRetry(failure.noteId)}
        >
          Retry
        </button>
        <button
          type="button"
          className="save-failure__btn"
          onClick={() => onDiscard(failure.noteId)}
        >
          {isDelete ? 'Restore note' : 'Discard changes'}
        </button>
      </div>
    </div>
  );
}

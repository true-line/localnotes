import { useEffect, useRef, useState } from 'react';
import type { ImportConflict, ImportConflictResolution } from '../storage';
import '../styles/ImportConflictDialog.css';

interface Props {
  conflicts: ImportConflict[];
  onResolve: (resolutions: Record<string, ImportConflictResolution>) => void;
  onCancel: () => void;
}

const RESOLUTIONS: Array<{ value: ImportConflictResolution; label: string }> = [
  { value: 'keep', label: 'Keep existing' },
  { value: 'replace', label: 'Replace with imported' },
  { value: 'duplicate', label: 'Import as a copy' },
];

export function ImportConflictDialog({ conflicts, onResolve, onCancel }: Props) {
  const firstInputRef = useRef<HTMLInputElement>(null);
  // Safe default: every conflict starts on "keep" so applying without
  // touching the radios changes nothing.
  const [selections, setSelections] = useState<
    Record<string, ImportConflictResolution>
  >(() =>
    Object.fromEntries(
      conflicts.map((conflict) => [conflict.incoming.id, 'keep' as const])
    )
  );

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  // Escape is handled by App's layered shortcut handler (palette > chat >
  // dialog), so this dialog deliberately registers no global key listener.

  return (
    <div
      className="import-dialog__overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-dialog-title"
    >
      <div className="import-dialog__box">
        <h2 id="import-dialog-title" className="import-dialog__title">
          Resolve import conflicts
        </h2>
        <p className="import-dialog__body">
          {conflicts.length} note{conflicts.length === 1 ? '' : 's'} in this
          archive {conflicts.length === 1 ? 'has' : 'have'} the same ID as
          existing notes. Choose how to handle each one — nothing is
          overwritten without your approval.
        </p>
        <div className="import-dialog__conflicts">
          {conflicts.map((conflict, index) => {
            const incomingTitle = conflict.incoming.title || 'Untitled';
            const existingTitle = conflict.existing.title || 'Untitled';
            return (
              <fieldset
                key={conflict.incoming.id}
                className="import-dialog__conflict"
              >
                <legend className="import-dialog__legend">
                  &ldquo;{incomingTitle}&rdquo;
                  {incomingTitle !== existingTitle && (
                    <span className="import-dialog__existing">
                      {' '}
                      (existing: &ldquo;{existingTitle}&rdquo;)
                    </span>
                  )}
                </legend>
                {RESOLUTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="import-dialog__option"
                  >
                    <input
                      ref={
                        index === 0 && option.value === 'keep'
                          ? firstInputRef
                          : undefined
                      }
                      type="radio"
                      name={`import-conflict-${conflict.incoming.id}`}
                      value={option.value}
                      checked={
                        selections[conflict.incoming.id] === option.value
                      }
                      onChange={() =>
                        setSelections((prev) => ({
                          ...prev,
                          [conflict.incoming.id]: option.value,
                        }))
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
        <div className="import-dialog__actions">
          <button className="import-dialog__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="import-dialog__confirm"
            onClick={() => onResolve(selections)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { FORM_FIELDS, emptyFormState, rowToFormState } from '@/lib/vdpLogics/fields';

export default function VdpLogicsFormModal({
  open,
  mode,
  initialRow,
  saving,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState(emptyFormState());
  const [localError, setLocalError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(rowToFormState(initialRow));
    setLocalError(null);
  }, [open, initialRow]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    if (!form.dealerName?.trim()) {
      setLocalError('Dealer name is required.');
      return;
    }
    try {
      await onSave(form);
    } catch (err) {
      setLocalError(err?.message || 'Save failed.');
    }
  };

  return (
    <div className="vdp-logics-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="vdp-logics-modal"
        role="dialog"
        aria-labelledby="vdp-logics-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vdp-logics-modal-head">
          <h2 id="vdp-logics-modal-title">
            {mode === 'edit' ? 'Edit VDP logic' : 'Add VDP logic'}
          </h2>
          <button type="button" className="vdp-logics-modal-close" onClick={onClose}>
            ×
          </button>
        </header>

        <form className="vdp-logics-modal-form" onSubmit={handleSubmit}>
          <div className="vdp-logics-modal-grid">
            {FORM_FIELDS.map((f) => (
              <label key={f.key} className={f.wide ? 'vdp-logics-field--wide' : ''}>
                <span className="admin-date-label">
                  {f.label}
                  {f.requiredFlag ? ' *' : ''}
                </span>
                {f.wide ? (
                  <textarea
                    className="vdp-logics-textarea"
                    rows={3}
                    value={form[f.key]}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  />
                ) : (
                  <input
                    type="text"
                    className="admin-date-input"
                    value={form[f.key]}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                  />
                )}
              </label>
            ))}
          </div>

          {localError && <p className="vdp-logics-modal-error">{localError}</p>}

          <footer className="vdp-logics-modal-foot">
            <button type="button" className="ga4-count-export-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ga4-count-export-btn vdp-logics-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

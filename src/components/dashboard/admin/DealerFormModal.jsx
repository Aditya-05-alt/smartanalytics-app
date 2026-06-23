'use client';

import { useEffect, useState } from 'react';
import { FORM_FIELDS, emptyFormState, rowToFormState } from '@/lib/dealers/fields';

const HOOT_FIELDS = FORM_FIELDS.filter((f) => f.section === 'hoot');
const GA4_FIELDS = FORM_FIELDS.filter((f) => f.section === 'ga4');

function FieldInput({ field, form, setForm }) {
  if (field.type === 'boolean') {
    return (
      <label className="dealers-field dealers-field--checkbox">
        <input
          type="checkbox"
          checked={Boolean(form[field.key])}
          onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.checked }))}
        />
        <span className="admin-date-label">{field.label}</span>
      </label>
    );
  }

  return (
    <label className={field.key === 'hootUrl' ? 'dealers-field dealers-field--wide' : 'dealers-field'}>
      <span className="admin-date-label">
        {field.label}
        {field.required ? ' *' : ''}
      </span>
      <input
        type="text"
        className="admin-date-input"
        value={form[field.key] ?? ''}
        onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
        placeholder={field.label}
      />
    </label>
  );
}

export default function DealerFormModal({
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
    if (!form.customerName?.trim()) {
      setLocalError('Dealer name is required.');
      return;
    }
    if (!form.hootUrl?.trim()) {
      setLocalError('Hoot URL is required.');
      return;
    }
    if (!form.ga4CustomerId?.trim()) {
      setLocalError('GA4 customer ID is required.');
      return;
    }
    if (!form.ga4PropertyId?.trim()) {
      setLocalError('GA4 property ID is required.');
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
        className="vdp-logics-modal dealers-modal"
        role="dialog"
        aria-labelledby="dealers-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="vdp-logics-modal-head">
          <h2 id="dealers-modal-title">
            {mode === 'edit' ? 'Edit dealer' : 'Add dealer'}
          </h2>
          <button type="button" className="vdp-logics-modal-close" onClick={onClose}>
            ×
          </button>
        </header>

        <form className="vdp-logics-modal-form" onSubmit={handleSubmit}>
          <p className="dealers-modal-hint">
            Saves to <code>smart_hoot_config</code> and <code>smart_ga4_config</code>.
            GA4 customer ID must match <code>client_id</code>.
          </p>

          <h3 className="dealers-section-title">Dealer (Hoot)</h3>
          <div className="vdp-logics-modal-grid">
            {HOOT_FIELDS.map((f) => (
              <FieldInput key={f.key} field={f} form={form} setForm={setForm} />
            ))}
          </div>

          <h3 className="dealers-section-title">GA4</h3>
          <div className="vdp-logics-modal-grid">
            {GA4_FIELDS.map((f) => (
              <FieldInput key={f.key} field={f} form={form} setForm={setForm} />
            ))}
          </div>

          {localError && <p className="ga4-count-error-text">{localError}</p>}

          <footer className="vdp-logics-modal-foot">
            <button type="button" className="ga4-count-export-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="ga4-count-export-btn vdp-logics-btn-primary"
              disabled={saving}
            >
              {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add dealer'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

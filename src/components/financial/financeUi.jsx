// Small pieces shared by the Vendors, Purchase Invoices, Tax Summary and P&L
// pages. They reuse the Products page's prod-* classes so the finance pages
// look like the rest of the app rather than like a bolt-on.
import { useRef, useState } from 'react';
import { X, Paperclip, Eye, Trash2 } from 'lucide-react';
import { orgStore } from '../../services/orgStore';
import { receiptService, RECEIPT_ACCEPT, validateReceipt } from '../../services/receiptService';

export function Stat({ icon, label, value, accent, sub, onClick }) {
  return (
    <div
      className="prod-stat"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <div className="prod-stat-icon" style={accent ? { color: accent } : undefined}>{icon}</div>
      <div>
        <div className="prod-stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
        <div className="prod-stat-label">{label}</div>
        {sub && <div className="prod-stat-label" style={{ opacity: 0.8 }}>{sub}</div>}
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, width }) {
  return (
    <div className="prod-modal-backdrop" onClick={onClose}>
      <div className="prod-modal" onClick={(e) => e.stopPropagation()} style={width ? { maxWidth: width } : undefined}>
        <div className="prod-modal-head">
          <h3>{title}</h3>
          <button type="button" onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Attach / view / remove one receipt. The file is uploaded immediately and the
 * returned path handed to `onChange`; the parent saves it on the row.
 */
export function ReceiptField({ path, onChange, kind }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = validateReceipt(file);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    try {
      const newPath = await receiptService.upload(orgStore.getOrgId(), kind, file);
      if (path) receiptService.remove(path);
      onChange(newPath);
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <input ref={inputRef} type="file" accept={RECEIPT_ACCEPT} onChange={pick} hidden />
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="prod-btn-ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
          <Paperclip size={13} /> {busy ? 'Uploading...' : path ? 'Replace receipt' : 'Attach receipt'}
        </button>
        {path && (
          <>
            <button type="button" className="prod-btn-ghost" onClick={() => receiptService.open(path)}>
              <Eye size={13} /> View
            </button>
            <button
              type="button"
              className="prod-btn-ghost"
              onClick={() => { receiptService.remove(path); onChange(null); }}
            >
              <Trash2 size={13} /> Remove
            </button>
          </>
        )}
      </div>
      <div className="prod-field-note" style={{ marginTop: '0.3rem' }}>
        PDF, PNG, JPEG or WebP, up to 5 MB. Stored privately; links expire after five minutes.
      </div>
      {error && <div className="prod-form-error" style={{ marginTop: '0.4rem' }}>{error}</div>}
    </div>
  );
}

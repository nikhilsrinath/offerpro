import { useState } from 'react';
import { Modal, Btn, Field, Input, Status } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { docNumber } from '../../services/documentStore';
import { advanceOf, DEFAULT_ADVANCE_PERCENT } from '../../services/proformaAdvance';
import { recommendTarget, DUE_DAYS } from '../../services/documentConversion';

const money = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const OPTIONS = {
  proforma: {
    label: 'Proforma invoice',
    what: 'The client confirms the order and pays an advance through the portal. The tax invoice follows on delivery, with the advance already set against it.',
  },
  invoice: {
    label: 'Tax invoice',
    what: 'Bill now. The invoice is dated today and the full amount becomes receivable once it is sent.',
  },
};

/* Choose how an accepted quotation moves to billing: via a proforma or
   straight to the invoice. The recommendation is only a default — both are
   always offered, and every reason shown is a fact from this org's records. */
export default function ConvertDialog({ source, ...rest }) {
  // Keyed on the source so the choice starts from the suggestion once per
  // quotation and is never reset under the user by a re-render.
  return source ? <ConvertSheet key={source.id} source={source} {...rest} /> : null;
}

function ConvertSheet({ source, docs, busy, onClose, onConvert }) {
  const t = useT();
  // Read once: the org's documents change identity on every render.
  const [rec] = useState(() => recommendTarget(source, docs));
  const [target, setTarget] = useState(rec.target);
  const [percent, setPercent] = useState(() => {
    const p = source.advance_percent;
    return String(p === null || p === undefined || p === '' ? DEFAULT_ADVANCE_PERCENT : p);
  });

  const pct = Math.min(100, Math.max(0, Number(percent) || 0));
  const percentValid = percent !== '' && Number.isFinite(Number(percent)) && Number(percent) >= 0 && Number(percent) <= 100;
  const a = advanceOf({ grand_total: source.grand_total ?? source.amount, advance_percent: pct });
  const canSubmit = !busy && (target === 'invoice' || percentValid);

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title={`Convert ${docNumber(source) || 'quotation'}`}
      note={`${source.issued_to || source.clientName || 'Client'} · ${money(source.grand_total ?? source.amount)}`}
      width={540}
      footer={(
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn
            primary
            disabled={!canSubmit}
            onClick={() => onConvert(target, target === 'proforma' ? { advancePercent: pct } : {})}
          >
            {busy ? 'Converting…' : `Create ${OPTIONS[target].label.toLowerCase()}`}
          </Btn>
        </>
      )}
    >
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        <legend style={{ fontSize: 11, color: t.dim, marginBottom: 8, padding: 0 }}>Bill this quotation as</legend>
        {['proforma', 'invoice'].map((key) => {
          const selected = target === key;
          return (
            <label
              key={key}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', cursor: busy ? 'default' : 'pointer',
                padding: '10px 12px', borderRadius: 9,
                border: '1px solid ' + (selected ? t.text : t.line),
                background: selected ? t.panelAlt : t.panel,
              }}
            >
              <input
                type="radio" name="convert-target" value={key} checked={selected} disabled={busy}
                onChange={() => setTarget(key)} style={{ marginTop: 2 }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: t.text }}>{OPTIONS[key].label}</span>
                  {rec.target === key && <Status tone="up">Suggested</Status>}
                </span>
                <span style={{ display: 'block', fontSize: 10.5, lineHeight: 1.5, color: t.dim, marginTop: 3 }}>
                  {OPTIONS[key].what}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <section aria-label="Why this is suggested" style={{
        marginTop: 12, padding: '9px 11px', borderRadius: 8, background: t.panelAlt, border: '1px solid ' + t.lineSoft,
      }}>
        <div style={{ fontSize: 9, letterSpacing: '0.09em', color: t.faint, marginBottom: 5 }}>
          WHY {OPTIONS[rec.target].label.toUpperCase()}
        </div>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, lineHeight: 1.6, color: t.text }}>
          {rec.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>

      {target === 'proforma' ? (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'minmax(0, 140px) 1fr', gap: 12, alignItems: 'end' }}>
          <Field label="Advance %" hint={percentValid ? undefined : 'Between 0 and 100'}>
            <Input
              type="number" min={0} max={100} step="any" inputMode="decimal"
              value={percent} disabled={busy} aria-invalid={!percentValid}
              onChange={(e) => setPercent(e.target.value)}
            />
          </Field>
          <div style={{ fontSize: 11, color: t.dim, paddingBottom: 8 }}>
            {pct === 0
              ? 'No advance — the client only confirms the order.'
              : <>Advance {money(a.advance)} · balance {money(a.balance)} on the tax invoice</>}
          </div>
        </div>
      ) : (
        <p style={{ margin: '12px 0 0', fontSize: 11, color: t.dim }}>
          Dated today, due in {DUE_DAYS.invoice} days.
        </p>
      )}

      <p style={{ margin: '12px 0 0', fontSize: 10.5, color: t.faint, lineHeight: 1.5 }}>
        The new document is a draft with its own number, built from the version the client accepted.
        The quotation is marked converted.
      </p>
    </Modal>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, ExternalLink, Loader2, X } from 'lucide-react';
import { MONO } from '../../theme/edge';
import {
  TREATMENTS, groupedCategories, loadFinanceCategories, categoryLabel,
} from '../../services/financeCategories';
import {
  CURRENCIES, baseAmount, draftTreatment, methodOptions, taxFromRate, validateDraft,
} from '../../services/cashIntent';
import { useSection } from '../financial/financeHooks';
import { canAllocate } from '../../services/projectService';
import { isOpen } from '../../services/projectAnalytics';

/* ══════════════════════════════════════════════════════════════════════════
   The confirmation card.

   The chat gathers an entry by asking; nothing reaches the ledger until this
   card has been read and the button pressed. That is the whole contract: the
   assistant may fill a form, it may not file a record. Everything it inferred
   — the category it chose, the date it read out of "yesterday", the rail it
   guessed from "by UPI" — is shown as an editable field rather than as prose,
   so a wrong guess is corrected in place instead of argued with in chat.

   The card says out loud what the entry will do to profit, because that is the
   one thing a cash book cannot infer for you: a laptop and a month's rent are
   both money gone, and only one of them is a cost.
   ══════════════════════════════════════════════════════════════════════════ */

const GST_RATES = [0, 5, 12, 18, 28];
const SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
const sym = (c) => SYMBOL[c] || `${c} `;

const money = (v) => (Number(v) || 0).toLocaleString('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
});

export default function CashEntryCard({
  t, draft, onChange, onSave, onCancel, onOpenCashBook, saving, error, saved,
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => { loadFinanceCategories().then(() => setReady(true)); }, []);

  const clients = useSection('customers');
  const vendors = useSection('vendors');
  const projects = useSection('projects');

  const base = baseAmount(draft);
  const treatment = TREATMENTS[draftTreatment(draft)];
  const problems = useMemo(() => validateDraft(draft), [draft]);

  const set = (patch) => onChange(patch);

  // Picking a rate fills the GST amount inclusive of tax — the same arithmetic
  // the cash-book form and app.cash_entry_tax() apply, so no two of the three
  // ever disagree about what "18%" means on a gross figure.
  const setRate = (rate) => set({
    tax_rate: rate,
    tax_amount: rate > 0 ? String(taxFromRate(base, rate)) : '',
  });

  const inward = draft.direction === 'in';
  const accent = inward ? t.up : t.down;

  if (saved) {
    return (
      <div style={shell(t)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 15px' }}>
          <Check size={15} strokeWidth={2} style={{ color: accent, flexShrink: 0 }} aria-hidden="true" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: t.text }}>
              {inward ? 'Money in' : 'Money out'} recorded — {money(base)}
            </div>
            <div style={{ fontSize: 10.5, color: t.faint, marginTop: 3 }}>
              {saved.description} · {ready ? categoryLabel(saved.category) : saved.category} · {saved.date}
            </div>
          </div>
          {onOpenCashBook && (
            <button type="button" onClick={onOpenCashBook} style={ghost(t)}>
              <ExternalLink size={12} strokeWidth={1.8} aria-hidden="true" /> Cash book
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      style={shell(t)}
      onSubmit={(e) => { e.preventDefault(); onSave(); }}
      aria-label={inward ? 'Confirm this money-in entry' : 'Confirm this money-out entry'}
    >
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        borderBottom: `1px solid ${t.line}`,
      }}>
        {inward
          ? <ArrowDownLeft size={14} strokeWidth={1.9} style={{ color: accent }} aria-hidden="true" />
          : <ArrowUpRight size={14} strokeWidth={1.9} style={{ color: accent }} aria-hidden="true" />}
        <span style={{ fontSize: 11, letterSpacing: '0.08em', color: t.dim }}>
          {inward ? 'MONEY IN' : 'MONEY OUT'}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: t.text, fontVariantNumeric: 'tabular-nums' }}>
          {money(base)}
        </span>
      </header>

      <div style={{ padding: 14, display: 'grid', gap: 11 }}>
        <Field t={t} label="What it was for" wide>
          <input
            className="ai-input" style={input(t)} value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Office chairs, October rent…"
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <Field t={t} label={`Amount (${sym(draft.currency)})`}>
            <input
              className="ai-input" style={input(t)} inputMode="decimal" value={draft.original_amount}
              onChange={(e) => set({ original_amount: e.target.value })}
            />
          </Field>
          <Field t={t} label="Currency">
            <select
              style={input(t)} value={draft.currency}
              onChange={(e) => set({
                currency: e.target.value,
                // Leaving a stale rate behind when the currency goes back to
                // rupees would multiply a rupee figure by eighty.
                fx_rate: e.target.value === 'INR' ? 1 : draft.fx_rate,
              })}
            >
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        {draft.currency !== 'INR' && (
          <Field t={t} label={`Rate — 1 ${draft.currency} in ₹`} hint="Entered by hand: there is no rate feed, and a stale automatic rate is worse than a deliberate one.">
            <input
              className="ai-input" style={input(t)} inputMode="decimal" value={draft.fx_rate}
              onChange={(e) => set({ fx_rate: e.target.value })}
            />
          </Field>
        )}

        <Field t={t} label="Counts as" wide>
          <select
            style={input(t)} value={draft.category}
            onChange={(e) => set({ category: e.target.value })}
          >
            <option value="">Choose a category…</option>
            {groupedCategories(draft.direction).map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>

        {treatment && (
          <p style={{
            margin: 0, fontSize: 10.5, lineHeight: 1.6, color: t.dim,
            padding: '8px 10px', borderRadius: 8, background: t.raised,
          }}>
            <strong style={{ color: t.text }}>{treatment.label}.</strong> {treatment.note}
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <Field t={t} label="Date">
            <input
              type="date" style={input(t)} value={draft.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </Field>
          <Field t={t} label={inward ? 'Received by' : 'Paid by'}>
            <select
              style={input(t)} value={draft.payment_method}
              onChange={(e) => set({ payment_method: e.target.value })}
            >
              {methodOptions().map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
          <Field t={t} label={inward ? 'Customer (optional)' : 'Vendor (optional)'}>
            <select
              style={input(t)}
              value={(inward ? draft.client_id : draft.vendor_id) || ''}
              onChange={(e) => set(inward ? { client_id: e.target.value } : { vendor_id: e.target.value })}
            >
              <option value="">—</option>
              {(inward ? clients : vendors).map((p) => (
                <option key={p.id} value={p.id}>{p.name || p.company_name}</option>
              ))}
            </select>
          </Field>
          <Field t={t} label="GST inside this amount">
            <select
              style={input(t)} value={Number(draft.tax_rate) || 0}
              onChange={(e) => setRate(Number(e.target.value))}
              aria-label="GST rate"
            >
              {GST_RATES.map((r) => (
                <option key={r} value={r}>{r === 0 ? 'No GST' : `${r}% — ${money(taxFromRate(base, r))}`}</option>
              ))}
            </select>
          </Field>
        </div>

        {canAllocate() && (
          <Field t={t} label="Project (optional)" wide>
            <select style={input(t)} value={draft.project_id || ''} aria-label="Project"
              onChange={(e) => set({ project_id: e.target.value, project_candidates: [] })}>
              <option value="">None — overhead</option>
              {projects.filter((p) => isOpen(p) || p.id === draft.project_id).map((p) => (
                <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field t={t} label="Reference (optional)" wide>
          <input
            className="ai-input" style={input(t)} value={draft.reference || ''}
            onChange={(e) => set({ reference: e.target.value })}
            placeholder="Bill number, UTR, cheque number…"
          />
        </Field>

        {(error || problems.length > 0) && (
          <p role="alert" style={{ margin: 0, fontSize: 10.5, lineHeight: 1.6, color: t.down }}>
            {error || problems[0]}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="submit" disabled={saving || problems.length > 0}
            style={{
              ...ghost(t), height: 32, padding: '0 14px',
              background: t.text, color: t.panel, border: 'none',
              opacity: saving || problems.length ? 0.5 : 1,
              cursor: saving || problems.length ? 'not-allowed' : 'pointer',
            }}
          >
            {saving
              ? <><Loader2 size={12} strokeWidth={2} className="ai-spin" aria-hidden="true" /> Saving…</>
              : <><Check size={12} strokeWidth={2} aria-hidden="true" /> Record this entry</>}
          </button>
          <button type="button" onClick={onCancel} disabled={saving} style={ghost(t)}>
            <X size={12} strokeWidth={1.9} aria-hidden="true" /> Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function Field({ t, label, hint, children, wide }) {
  return (
    <label style={{ display: 'grid', gap: 4, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 9.5, letterSpacing: '0.07em', color: t.faint, textTransform: 'uppercase' }}>
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: 9.5, color: t.faint, lineHeight: 1.5 }}>{hint}</span>}
    </label>
  );
}

const shell = (t) => ({
  border: `1px solid ${t.line}`, borderRadius: 12, background: t.panelAlt,
  fontFamily: MONO, overflow: 'hidden', maxWidth: 520,
});

const input = (t) => ({
  width: '100%', boxSizing: 'border-box', height: 32, padding: '0 9px',
  borderRadius: 7, border: `1px solid ${t.line}`, background: t.panel,
  color: t.text, fontFamily: MONO, fontSize: 11.5, outline: 'none',
});

const ghost = (t) => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px',
  borderRadius: 8, border: `1px solid ${t.line}`, background: 'transparent',
  color: t.text, fontFamily: MONO, fontSize: 11, cursor: 'pointer',
});

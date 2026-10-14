import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Truck } from 'lucide-react';
import { groupedCategories, loadFinanceCategories } from '../../services/financeCategories';
import { useT } from '../ui/edgeUtils';
import { titleCase } from '../../utils/titleCase';
import { Modal } from './financeUi';

/** Sales & Services on the Credit side is goods or services taken on a bill. */
const isSalesGroup = (label) => /^sales/i.test(String(label || ''));

/**
 * The first steps of a project's Credit or Debit: the Type, then the
 * Sub-Type inside it, so the form that follows does not ask for either. The
 * Types are the category groups; Debit also offers Vendor Payment. `onPick`
 * gets { kind: 'bill' } for Sales & Services (a purchase bill, owed to the
 * vendor), { kind: 'vendor' } for Vendor Payment, or
 * { kind: 'entry', group, category } once a Sub-Type is chosen.
 */
export default function LedgerTypePicker({ direction, onPick, onClose }) {
  const t = useT();
  const [, setReady] = useState(false);
  useEffect(() => { loadFinanceCategories().then(() => setReady(true)); }, []);
  const [group, setGroup] = useState(null); // the Type, once chosen

  const isIn = direction === 'in';
  const side = isIn ? 'Credit' : 'Debit';
  const options = group
    ? group.items.map((c) => ({
      key: c.key, label: c.label, note: c.hint || '',
      pick: () => onPick({ kind: 'entry', group, category: c.key }),
    }))
    : [
      ...groupedCategories(direction).map((g) => {
        const bill = isIn && isSalesGroup(g.label);
        return {
          key: g.label, label: g.label,
          note: bill ? 'Goods or services taken on a bill, owed to the vendor' : g.items.map((c) => c.label).join(', '),
          pick: bill ? () => onPick({ kind: 'bill' }) : () => setGroup(g),
        };
      }),
      ...(isIn ? [] : [{ key: 'vendor', label: 'Vendor Payment', note: 'Pay a vendor what is pending to them', icon: Truck, pick: () => onPick({ kind: 'vendor' }) }]),
    ];

  return (
    <Modal title={group ? `${titleCase(group.label)}: Choose a Sub-Type` : `What Kind of ${side}?`} onClose={onClose} width={760}>
      <div className="prod-modal-body" style={{ display: 'grid', gap: 10, overflowX: 'hidden' }}>
        <Steps t={t} step={group ? 2 : 1} />
        {group && (
          <button type="button" onClick={() => setGroup(null)} style={{
            justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px 4px 4px',
            border: 'none', borderRadius: 8, background: 'transparent', color: t.dim, fontFamily: 'inherit',
            fontSize: 13, cursor: 'pointer',
          }}>
            <ChevronLeft size={15} aria-hidden="true" /> Back to Types
          </button>
        )}
        {options.length === 0 && <p className="prod-field-note">Loading the types…</p>}
        {options.map((o) => (
          <Choice key={o.key} t={t} tone={isIn ? t.up : t.down} icon={o.icon || (isIn ? ArrowDownLeft : ArrowUpRight)}
            label={titleCase(o.label)} note={o.note} onClick={o.pick} />
        ))}
      </div>
    </Modal>
  );
}

/** Where the user is: Type, then Sub-Type, then the details. */
function Steps({ t, step }) {
  return (
    <ol aria-label="Steps" style={{ display: 'flex', gap: 8, margin: '0 0 4px', padding: 0, listStyle: 'none', flexWrap: 'wrap' }}>
      {['Type', 'Sub-Type', 'Details'].map((label, i) => {
        const at = i + 1 === step;
        const done = i + 1 < step;
        return (
          <li key={label} aria-current={at ? 'step' : undefined} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: at ? 600 : 500,
            color: at ? t.accent : done ? t.dim : t.faint,
          }}>
            <span aria-hidden="true" style={{
              width: 20, height: 20, borderRadius: 99, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600,
              background: at ? t.accent : done ? t.accentSoft : t.panelAlt, color: at ? '#fff' : done ? t.accent : t.faint,
            }}>{i + 1}</span>
            {label}
            {i < 2 && <ChevronRight size={13} aria-hidden="true" style={{ color: t.ghost || t.faint }} />}
          </li>
        );
      })}
    </ol>
  );
}

function Choice({ t, tone, icon: Icon, label, note, onClick }) {
  return (
    <button type="button" className="edge-tr" onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 14, width: '100%', boxSizing: 'border-box', padding: '14px 16px', borderRadius: 12,
      border: '1px solid ' + t.line, background: t.card, cursor: 'pointer', fontFamily: 'inherit',
      color: t.text, textAlign: 'left',
    }}>
      <span aria-hidden="true" style={{
        width: 32, height: 32, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
        color: tone, background: `color-mix(in srgb, ${tone} 12%, transparent)`,
      }}><Icon size={16} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{label}</span>
        {note && <span style={{ display: 'block', fontSize: 12, color: t.faint, marginTop: 3, lineHeight: 1.45 }}>{note}</span>}
      </span>
      <ChevronRight size={16} aria-hidden="true" style={{ color: t.faint, flexShrink: 0 }} />
    </button>
  );
}

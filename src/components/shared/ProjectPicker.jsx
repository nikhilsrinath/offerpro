import React, { useMemo, useId } from 'react';
import { pickerOrder, projectLabel, splitRemainder } from '../../services/projectAnalytics';
import { canAllocate } from '../../services/projectService';
import { useSection, money } from '../financial/financeHooks';

/* ══════════════════════════════════════════════════════════════════════════
   Which project(s) a piece of money belongs to — inside the invoice, cash-book
   and purchase-bill forms.

   Single (the default): one project gets the whole entry, or none does. Split:
   rows of project + amount, with the remainder shown live as overhead. Only
   open projects are offered, and when the form knows the client, that
   client's projects come first.

   Controlled: the form owns `value` ({ mode, rows, touched }) and saves it after
   its own row saves, through projectService.saveSplitFromPicker(). An untouched
   picker saves nothing, so a form nobody uses the picker in behaves exactly as
   it did before Projects. Hidden entirely from anyone who cannot allocate.

   Written with plain labelled controls rather than the edge kit because it sits
   inside the legacy-styled finance forms; it takes their `prod-field` look.
   ══════════════════════════════════════════════════════════════════════════ */


export default function ProjectPicker({ value, onChange, net = 0, clientId = null, label = 'Project' }) {
    const id = useId();
    const projects = useSection('projects');
    const clients = useSection('customers');
    const options = useMemo(() => pickerOrder(projects, clientId), [projects, clientId]);
    const names = useMemo(() => Object.fromEntries(clients.map((c) => [c.id, c.name || c.clientName])), [clients]);

    if (!canAllocate() || !value) return null;

    const set = (patch) => onChange({ ...value, ...patch, touched: true });
    const setRow = (i, patch) => set({ rows: value.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
    const split = value.mode === 'split';
    const { remainder, over } = splitRemainder(net, value.rows);

    // A project already allocated but now closed stays visible on its own row,
    // so opening an old entry never silently drops its link.
    const optionList = (current) => {
        const extra = current && !options.some((p) => p.id === current)
            ? projects.filter((p) => p.id === current) : [];
        return [...options, ...extra];
    };

    const projectSelect = (row, i, aria) => (
        <select id={i === 0 ? id : undefined} aria-label={aria} value={row.project_id}
            onChange={(e) => setRow(i, { project_id: e.target.value })}>
            <option value="">{split ? 'Choose a project…' : 'No project — overhead'}</option>
            {optionList(row.project_id).map((p) => (
                <option key={p.id} value={p.id}>
                    {projectLabel(p)}{p.client_id && names[p.client_id] ? ` — ${names[p.client_id]}` : ''}
                </option>
            ))}
        </select>
    );

    return (
        <div className="prod-field full" role="group" aria-labelledby={`${id}-label`}>
            <label id={`${id}-label`} htmlFor={id}>{label}</label>
            {!split ? (
                projectSelect(value.rows[0] || { project_id: '' }, 0, label)
            ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                    {value.rows.map((row, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 130px auto', gap: 6 }}>
                            {projectSelect(row, i, `Project ${i + 1}`)}
                            <input type="number" min="0" step="0.01" inputMode="decimal"
                                aria-label={`Amount for project ${i + 1}, before GST`}
                                placeholder="Amount (net)" value={row.amount}
                                onChange={(e) => setRow(i, { amount: e.target.value })} />
                            <button type="button" className="prod-btn-ghost"
                                aria-label={`Remove project ${i + 1} from the split`}
                                onClick={() => set({ rows: value.rows.filter((_, j) => j !== i) })}>Remove</button>
                        </div>
                    ))}
                    <div>
                        <button type="button" className="prod-btn-ghost"
                            onClick={() => set({ rows: [...value.rows, { project_id: '', amount: '' }] })}>
                            Add a project
                        </button>
                    </div>
                    <p className="prod-field-note" role="status" aria-live="polite"
                        style={over ? { color: 'var(--error)' } : undefined}>
                        {over
                            ? `Split is ${money(-remainder, 2)} more than the entry's ${money(net, 2)} before GST.`
                            : `${money(remainder, 2)} of ${money(net, 2)} before GST — the rest is overhead.`}
                    </p>
                </div>
            )}
            <p className="prod-field-note" style={{ marginTop: 6 }}>
                <button type="button" className="prod-btn-ghost" onClick={() => set(split
                    ? { mode: 'single', rows: [{ project_id: value.rows[0]?.project_id || '', amount: '' }] }
                    : { mode: 'split', rows: value.rows[0]?.project_id
                        ? [{ project_id: value.rows[0].project_id, amount: String(net || '') }]
                        : [{ project_id: '', amount: '' }] })}>
                    {split ? 'Put it all on one project' : 'Split across projects'}
                </button>
            </p>
        </div>
    );
}

import { useState } from 'react';
import { storageService } from '../../services/storageService';
import { DEPT_PALETTE } from '../TeamHierarchy';
import { Panel, Row, Btn, Field, Input, Breakdown, ConfirmBtn } from '../ui/edge';
import { useT, MONO } from '../ui/edgeUtils';

/* ══════════════════════════════════════════════════════════════════════════
   The department list with head-counts, delete, and the add-a-department form.
   Shared by the Employees registry side panel and the employee form, so a
   department can be created without leaving the person being added.
   ══════════════════════════════════════════════════════════════════════════ */

export default function DepartmentsPanel({ rows, total, orgId, onChanged, onAdded, active, onPick }) {
    const t = useT();
    const [name, setName] = useState('');
    const [color, setColor] = useState(DEPT_PALETTE[0]);
    const [busy, setBusy] = useState(false);

    const add = async () => {
        const n = name.trim();
        if (!n) return;
        setBusy(true);
        try {
            // A name already in the list is picked rather than saved twice.
            if (!rows.some((r) => r.id && r.name.toLowerCase() === n.toLowerCase())) {
                await storageService.saveDepartment({ name: n, color }, orgId);
            }
            setName(''); setColor(DEPT_PALETTE[0]);
            await onChanged?.();
            onAdded?.(rows.find((r) => r.name.toLowerCase() === n.toLowerCase())?.name || n);
        } catch (err) {
            alert('Could not add the department: ' + err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Panel title="Departments" note={rows.length + ' in use'} pad={13}>
            {rows.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                    <Breakdown rows={rows.map((d) => ({ label: d.name, value: d.count, color: d.color }))}
                        total={total} max={8} />
                </div>
            )}

            <div style={{ display: 'grid', gap: 2, marginBottom: 13 }}>
                {rows.map((d) => (
                    <Row key={d.name} gap={8}>
                        <button type="button" onClick={() => onPick?.(d.name)}
                            className="edge-tr"
                            style={{
                                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
                                padding: '6px 8px', borderRadius: 6, cursor: onPick ? 'pointer' : 'default', textAlign: 'left',
                                background: active === d.name ? t.panelAlt : 'transparent',
                                border: '1px solid ' + (active === d.name ? t.line : 'transparent'),
                                fontFamily: MONO, color: t.text, fontSize: 12.5,
                            }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                            <span style={{ fontSize: 11, color: t.ghost }}>{d.count}</span>
                        </button>
                        {d.id && (
                            <ConfirmBtn label="×" confirmLabel="Delete" title="Delete department"
                                message={`Are you sure you want to delete the ${d.name} department? People in it keep their records.`}
                                onConfirm={() => storageService.deleteDepartment(d.id, orgId).then(() => onChanged?.())} />
                        )}
                    </Row>
                ))}
            </div>

            <div style={{ borderTop: '1px solid ' + t.lineSoft, paddingTop: 12 }}>
                <Field required label="New department">
                    <Input value={name} onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                        placeholder="Engineering" aria-label="New department name" />
                </Field>
                <div role="radiogroup" aria-label="Department colour" style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '10px 0' }}>
                    {DEPT_PALETTE.map((c) => (
                        <button key={c} type="button" role="radio" aria-checked={color === c}
                            aria-label={'Colour ' + c} onClick={() => setColor(c)}
                            style={{
                                width: 16, height: 16, borderRadius: '50%', background: c, padding: 0, cursor: 'pointer',
                                border: '2px solid ' + (color === c ? t.text : 'transparent'),
                            }} />
                    ))}
                </div>
                <Btn full primary onClick={add} disabled={busy || !name.trim()}>
                    {busy ? 'Adding…' : 'Add department'}
                </Btn>
            </div>
        </Panel>
    );
}

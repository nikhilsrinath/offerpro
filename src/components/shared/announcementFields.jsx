import { useMemo, useState } from 'react';
import { Avatar, Btn, Input, Seg, Select } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { sendAtOf, whenText } from './announcementForm';

/*
 * The Send Date and Audience rows of the announcement editors (company board
 * and a project's Team › Announcements). Each is one row of the side panel,
 * label on the left, laid out by drawer.css like a <Field>; they are divs, not
 * <label>s, because they hold several controls.
 */

export function FieldRow({ label, hint, children }) {
    const t = useT();
    return (
        <div className="edge-field" role="group" aria-label={label} style={{ display: 'block', minWidth: 0 }}>
            <span className="edge-field-label" style={{ display: 'block', fontSize: 13.5, fontWeight: 500, lineHeight: 1.4, color: t.text, marginBottom: 6 }}>
                {label}
            </span>
            <span className="edge-field-control" style={{ display: 'grid', gap: 8, minWidth: 0 }}>
                {children}
                {hint && <span className="edge-field-hint" style={{ fontSize: 11.5, color: t.faint, lineHeight: 1.5 }}>{hint}</span>}
            </span>
        </div>
    );
}

const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/**
 * Send now, or on a day and time. A notice already out says when it went
 * and cannot be moved back into the future.
 */
export function SendDateField({ form, setForm }) {
    const t = useT();
    if (form.sentAt) {
        return (
            <FieldRow label="Send Date" hint="Already out. Its send date stays as it is.">
                <span style={{ fontSize: 13, color: t.text, paddingTop: 7 }}>Sent {whenText(form.sentAt)}</span>
            </FieldRow>
        );
    }
    const later = form.sendMode === 'later';
    const at = sendAtOf(form);
    return (
        <FieldRow label="Send Date"
            hint={later
                ? (at ? `Goes out on ${whenText(at)}. Until then only you and admins can see it.` : 'Pick the day it should go out.')
                : 'Goes out as soon as you post it.'}>
            <Seg size="sm" value={form.sendMode} onChange={(v) => setForm({ ...form, sendMode: v })} label="When to send"
                options={[{ id: 'now', label: 'Send Now' }, { id: 'later', label: 'Schedule' }]} />
            {later && (
                <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 8 }}>
                    <Input type="date" aria-label="Send date" min={today()} value={form.sendDate}
                        onChange={(e) => setForm({ ...form, sendDate: e.target.value })} />
                    <Input type="time" aria-label="Send time" step={300} value={form.sendTime}
                        onChange={(e) => setForm({ ...form, sendTime: e.target.value })} />
                </span>
            )}
        </FieldRow>
    );
}

/**
 * Who it is for: everyone it can reach (the whole team, or the project's
 * people), one department (company board only), or members picked by name.
 * `people` is [{ id, name, sub }] — the employees who could be picked.
 */
export function AudienceField({ form, setForm, people, departments = null, scope = 'Whole Team' }) {
    const t = useT();
    const [query, setQuery] = useState('');
    const mode = form.audienceMode;
    const selected = useMemo(() => new Set(form.audience || []), [form.audience]);
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? people.filter((p) => `${p.name} ${p.sub || ''}`.toLowerCase().includes(q)) : people;
    }, [people, query]);

    const setMode = (v) => setForm({ ...form, audienceMode: v });
    const toggle = (id) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id); else next.add(id);
        setForm({ ...form, audience: [...next] });
    };
    const allShown = shown.length > 0 && shown.every((p) => selected.has(p.id));
    const pickShown = () => setForm({ ...form, audience: [...new Set([...selected, ...shown.map((p) => p.id)])] });
    const clearShown = () => {
        const drop = new Set(shown.map((p) => p.id));
        setForm({ ...form, audience: [...selected].filter((id) => !drop.has(id)) });
    };

    const options = [
        { id: 'everyone', label: scope },
        ...(departments ? [{ id: 'department', label: 'Department' }] : []),
        { id: 'members', label: 'Selected Members' },
    ];

    return (
        <FieldRow label="Audience"
            hint={mode === 'members'
                ? `${selected.size} of ${people.length} selected. Only they will see it.`
                : mode === 'department' ? 'Only people in this department will see it.'
                    : departments ? 'Everyone in the company will see it.' : 'Everyone on the project will see it.'}>
            <Seg size="sm" value={mode} onChange={setMode} label="Audience" options={options} />

            {mode === 'department' && departments && (
                <Select aria-label="Department" value={form.departmentId}
                    onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                    <option value="">Choose a department…</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
            )}

            {mode === 'members' && (
                <span style={{ display: 'grid', gap: 6 }}>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <Input type="search" aria-label="Search members" placeholder={`Search ${people.length} members…`}
                            value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
                        <Btn size="sm" onClick={allShown ? clearShown : pickShown} disabled={shown.length === 0}>
                            {allShown ? 'Clear' : 'Select All'}
                        </Btn>
                    </span>
                    <span role="listbox" aria-multiselectable="true" aria-label="Members" className="ann-members" style={{
                        display: 'block', maxHeight: 264, overflowY: 'auto', border: '1px solid ' + t.line, borderRadius: 8,
                    }}>
                        {people.length === 0 ? (
                            <span style={{ display: 'block', padding: '14px 12px', fontSize: 12.5, color: t.faint }}>
                                {departments ? 'No employees yet. Add people under Company › Employees.' : 'No one is on this project yet. Add people on Team Members.'}
                            </span>
                        ) : shown.length === 0 ? (
                            <span style={{ display: 'block', padding: '14px 12px', fontSize: 12.5, color: t.faint }}>No member matches “{query}”.</span>
                        ) : shown.map((p) => {
                            const on = selected.has(p.id);
                            return (
                                <label key={p.id} role="option" aria-selected={on} className={`ann-member${on ? ' on' : ''}`}>
                                    <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
                                    <Avatar name={p.name} size={26} />
                                    <span style={{ minWidth: 0, flex: 1 }}>
                                        <span style={{ display: 'block', fontSize: 13, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                        {p.sub && <span style={{ display: 'block', fontSize: 11.5, color: t.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.sub}</span>}
                                    </span>
                                </label>
                            );
                        })}
                    </span>
                </span>
            )}
        </FieldRow>
    );
}

// EmployeeProjectPicker: the Projects section of the add / edit employee form.
// Lists the projects the person is already on (edit only) and lets the admin
// queue more: project, project role, time share. Nothing is written here; the
// form adds the queued memberships after the employee itself is saved, so a
// new hire has an id to attach them to.
import { useState } from 'react';
import { X } from 'lucide-react';
import { useSection } from '../financial/financeHooks';
import { MEMBER_ROLES, isOpen, statusLabel } from '../../services/projectAnalytics';
import AllocationBar from '../projects/AllocationBar';
import { Panel, Row, Btn, Field, Input, Select, Empty } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useEmployeeProjects } from './useEmployeeProjects';

const roleLabel = (id) => MEMBER_ROLES.find((r) => r.id === id)?.label || 'Member';
const projectName = (p) => (p.code ? `${p.code} · ${p.name}` : p.name);

export default function EmployeeProjectPicker({ employeeId, pending, onChange }) {
    const t = useT();
    const projects = useSection('projects');
    const existing = useEmployeeProjects(employeeId);
    const [draft, setDraft] = useState({ project_id: '', role: 'member', allocation_pct: '100' });
    const [error, setError] = useState('');

    const taken = new Set([...existing.current.map((r) => r.p.id), ...pending.map((x) => x.project_id)]);
    const choices = projects.filter((p) => isOpen(p) && !taken.has(p.id))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));
    const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

    const add = () => {
        if (!draft.project_id) { setError('Choose a project.'); return; }
        const pct = Number(draft.allocation_pct);
        if (!(pct > 0 && pct <= 100)) { setError('Time share is between 1 and 100%.'); return; }
        onChange([...pending, { ...draft, allocation_pct: pct }]);
        setDraft({ project_id: '', role: 'member', allocation_pct: '100' });
        setError('');
    };

    const line = (key, p, meta, pct, action, i) => (
        <div key={key} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
            borderTop: i ? '1px solid ' + t.lineSoft : 'none',
        }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: t.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{projectName(p)}</div>
                <div style={{ fontSize: 11.5, color: t.faint, marginTop: 2 }}>{meta}</div>
            </div>
            {pct != null && <AllocationBar pct={pct} width={56} />}
            {action}
        </div>
    );

    const rows = [
        ...existing.current.map(({ m, p }) => ({ key: m.id, p, meta: [m.role_title || roleLabel(m.role), statusLabel(p.status)].filter(Boolean).join(' · '), pct: m.allocation_pct })),
        ...pending.map((x, i) => ({
            key: 'new-' + x.project_id, p: byId[x.project_id] || { name: 'Project' }, meta: `${roleLabel(x.role)} · added when you save`, pct: x.allocation_pct,
            action: (
                <Btn size="sm" title="Remove" aria-label="Remove from the list" onClick={() => onChange(pending.filter((_, j) => j !== i))}>
                    <X size={12} />
                </Btn>
            ),
        })),
    ];

    return (
        <Panel title="Projects" pad={15} note={existing.current.length ? `On ${existing.current.length} now` : undefined}>
            {rows.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                    {rows.map((r, i) => line(r.key, r.p, r.meta, r.pct, r.action, i))}
                </div>
            )}
            {choices.length === 0 ? (
                rows.length === 0 && <Empty>There are no open projects to add them to.</Empty>
            ) : (
                <Row gap={10} align="flex-end" wrap>
                    <div style={{ flex: '2 1 240px', minWidth: 0 }}>
                        <Field label="Add to project">
                            <Select value={draft.project_id} onChange={set('project_id')}>
                                <option value="">Choose a project…</option>
                                {choices.map((p) => <option key={p.id} value={p.id}>{projectName(p)}</option>)}
                            </Select>
                        </Field>
                    </div>
                    <div style={{ flex: '1 1 130px', minWidth: 0 }}>
                        <Field label="Project role">
                            <Select value={draft.role} onChange={set('role')}>
                                {MEMBER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                            </Select>
                        </Field>
                    </div>
                    <div style={{ flex: '0 1 100px', minWidth: 0 }}>
                        <Field label="Time %">
                            <Input type="number" min="1" max="100" value={draft.allocation_pct} onChange={set('allocation_pct')} />
                        </Field>
                    </div>
                    <Btn onClick={add} disabled={!draft.project_id}>Add</Btn>
                </Row>
            )}
            {error && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: t.down }}>{error}</div>}
        </Panel>
    );
}

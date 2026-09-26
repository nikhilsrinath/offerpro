import { useCallback, useEffect, useState } from 'react';
import { Btn, Empty, Loading, Status } from '../../ui/edge';
import { useT } from '../../ui/edgeUtils';
import { myProjects, setMyTaskStatus } from '../../../services/projectService';
import { statusLabel } from '../../../services/projectAnalytics';
import { fmtLongDay } from './portalUtils';

/* "My projects": the projects you are on, your role, the manager, what is due
   next, and your own tasks — which you can move along here. No money and no
   one else's time share: it all comes from my_projects() (0052), which returns
   neither. */

const NEXT = { pending: 'in_progress', in_progress: 'done' };
const TASK_LABEL = { pending: 'Not started', in_progress: 'In progress', done: 'Done', overdue: 'Overdue' };

export default function ProjectsTab({ orgId }) {
    const t = useT();
    const [rows, setRows] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');

    const load = useCallback(() => myProjects(orgId)
        .then((r) => { setRows(r); setError(''); })
        .catch((e) => setError(e.message)), [orgId]);
    useEffect(() => { load(); }, [load]);

    const move = async (task, status) => {
        setBusy(task.id);
        try { await setMyTaskStatus(task.id, status); await load(); }
        catch (e) { setError(e.message); }
        finally { setBusy(''); }
    };

    if (error) return <Empty>{error}</Empty>;
    if (!rows) return <Loading />;
    if (rows.length === 0) return <Empty>You are not on any project right now.</Empty>;

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            {rows.map((p) => {
                const upcoming = (p.milestones || []).filter((m) => m.status === 'pending' || m.status === 'in_progress').slice(0, 3);
                return (
                    <section key={p.project_id} aria-label={p.name} style={{ border: '1px solid ' + t.line, borderRadius: 10, padding: 14 }}>
                        <div style={{ fontSize: 9.5, color: t.faint }}>{p.code}</div>
                        <div style={{ fontSize: 14, color: t.text, margin: '2px 0 6px' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: t.dim, lineHeight: 1.7 }}>
                            {p.client_name ? `For ${p.client_name}` : 'Internal'} · {statusLabel(p.status)}<br />
                            You: {p.my_role}, {Math.round(p.my_allocation_pct)}% of your time
                            {p.my_end ? ` until ${fmtLongDay(p.my_end)}` : ''}
                            {p.manager_name ? ` · Manager: ${p.manager_name}` : ''}
                        </div>

                        {upcoming.length > 0 && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, marginBottom: 5 }}>NEXT MILESTONES</div>
                                {upcoming.map((m) => (
                                    <div key={m.id} style={{ fontSize: 11.5, display: 'flex', gap: 8 }}>
                                        <span style={{ flex: 1 }}>{m.title}</span>
                                        <span style={{ color: t.faint }}>{m.due_date ? fmtLongDay(m.due_date) : 'No date'}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div style={{ marginTop: 10 }}>
                            <div style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, marginBottom: 5 }}>YOUR TASKS</div>
                            {(p.my_tasks || []).length === 0 ? <div style={{ fontSize: 11, color: t.faint }}>None assigned to you.</div>
                                : p.my_tasks.map((task) => (
                                    <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid ' + t.lineSoft }}>
                                        <span style={{ flex: 1, fontSize: 11.5, color: t.text }}>{task.title}</span>
                                        <Status tone={task.status === 'done' ? 'up' : 'neutral'}>{TASK_LABEL[task.status] || task.status}</Status>
                                        {NEXT[task.status] && (
                                            <Btn size="sm" disabled={busy === task.id} onClick={() => move(task, NEXT[task.status])}>
                                                {NEXT[task.status] === 'done' ? 'Done' : 'Start'}
                                            </Btn>
                                        )}
                                        {task.status === 'done' && (
                                            <Btn size="sm" disabled={busy === task.id} onClick={() => move(task, 'pending')}>Reopen</Btn>
                                        )}
                                    </div>
                                ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

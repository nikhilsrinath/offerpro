import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import { MONO, useT } from '../ui/edgeUtils';
import { useOrg } from '../../context/OrgContext';
import { useToast } from '../shared/Toast';
import { workspaceService, useWorkspace } from '../../services/workspaceService';
import { eventOccurrences, sortDayItems, timeText, localDay } from './calendarModel';
import { dueNow, dueText } from './tasksModel';
import { eventColor } from './workspaceTheme';
import { TickBox, WorkspaceStyle } from './workspaceUi';

/* "My Day" on the Today page: the person's own events today, and their own
   tasks due today or already late, ticked off from here. Everything else on
   Today is the company's; this card is the person's (Workspace, 0112). Shows
   nothing at all while the database has no workspace tables. */

const MAX_TASKS = 6;

export default function MyDay({ today = localDay() }) {
    const t = useT();
    const navigate = useNavigate();
    const toast = useToast();
    const { activeOrg } = useOrg();
    const orgId = activeOrg?.id || null;
    const events = useWorkspace('events', orgId);
    const tasks = useWorkspace('tasks', orgId);

    const todays = useMemo(() => sortDayItems(eventOccurrences(events.rows, today, today)), [events.rows, today]);
    const due = useMemo(() => dueNow(tasks.rows, today), [tasks.rows, today]);

    if (!orgId || events.missing || tasks.missing || (!events.ready && !tasks.ready)) return null;

    const tick = (task) => workspaceService.update('tasks', task.id, { completed_at: new Date().toISOString() })
        .then(() => toast('Task completed', 'success', 5000, {
            label: 'Undo', onClick: () => workspaceService.update('tasks', task.id, { completed_at: null }).catch((e) => toast(e.message, 'error')),
        }))
        .catch((e) => toast(e.message, 'error'));

    const head = (label, to) => (
        <div style={{ display: 'flex', alignItems: 'center', height: 28, padding: '0 14px', background: t.panelAlt, borderTop: '1px solid ' + t.lineSoft, borderBottom: '1px solid ' + t.lineSoft, fontSize: 11.5, fontWeight: 600, color: t.dim }}>
            {label}
            <button type="button" onClick={() => navigate(to)} style={{ marginLeft: 'auto', border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: MONO, fontSize: 11.5, fontWeight: 500, color: t.accent }}>Open</button>
        </div>
    );

    return (
        <section aria-label="My Day" style={{ minWidth: 0, background: t.card, border: '1px solid ' + t.line, borderRadius: 12, overflow: 'hidden' }}>
            <WorkspaceStyle />
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, height: 42, padding: '0 10px 0 14px' }}>
                <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '-0.005em', color: t.text }}>My Day</h2>
                <span style={{ fontSize: 11.5, color: t.faint }}>Only you see this</span>
                <button type="button" onClick={() => navigate('/workspace/tasks')} title="Add a task" aria-label="Add a task" className="ws-ghost-btn" style={{
                    marginLeft: 'auto', width: 28, height: 28, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 7, background: 'transparent', color: t.dim, cursor: 'pointer',
                }}><Plus size={15} aria-hidden="true" /></button>
            </header>

            {head(`Events${todays.length ? ` · ${todays.length}` : ''}`, '/workspace/calendar?view=day')}
            {todays.length === 0 ? (
                <p style={{ margin: 0, padding: '12px 14px', fontSize: 12, color: t.faint }}>No events today.</p>
            ) : todays.map((it, i) => (
                <button key={it.key} type="button" onClick={() => navigate('/workspace/calendar?view=day')} className="ws-hover" style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 40, padding: '6px 14px', border: 'none',
                    borderTop: i ? '1px solid ' + t.lineSoft : 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', fontFamily: MONO, color: t.text,
                }}>
                    <span aria-hidden="true" style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: eventColor(t, it.color), flexShrink: 0 }} />
                    <span style={{ width: 84, flexShrink: 0, fontSize: 11.5, color: t.dim, fontVariantNumeric: 'tabular-nums' }}>{timeText(it, today)}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
                    <ChevronRight aria-hidden="true" size={13} style={{ color: t.ghost, flexShrink: 0 }} />
                </button>
            ))}

            {head(`Tasks${due.length ? ` · ${due.length}` : ''}`, '/workspace/tasks')}
            {due.length === 0 ? (
                <p style={{ margin: 0, padding: '12px 14px', fontSize: 12, color: t.faint }}>Nothing due today.</p>
            ) : (
                <>
                    {due.slice(0, MAX_TASKS).map((task, i) => {
                        const d = dueText(task, today);
                        return (
                            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, padding: '6px 14px', borderTop: i ? '1px solid ' + t.lineSoft : 'none' }}>
                                <TickBox done={false} onToggle={() => tick(task)} label={`Mark done: ${task.title}`} size={17} />
                                <button type="button" onClick={() => navigate(`/workspace/tasks?task=${task.id}`)} style={{
                                    flex: 1, minWidth: 0, border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: MONO, color: t.text,
                                    fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>{task.title}</button>
                                {d && <span style={{ fontSize: 11, fontWeight: 600, color: d.tone === 'down' ? t.down : t.accent, whiteSpace: 'nowrap' }}>{d.text}</span>}
                            </div>
                        );
                    })}
                    {due.length > MAX_TASKS && (
                        <div style={{ padding: '8px 14px', borderTop: '1px solid ' + t.lineSoft, fontSize: 11.5, color: t.faint, background: t.panelAlt }}>
                            {due.length - MAX_TASKS} more in My Tasks
                        </div>
                    )}
                </>
            )}
        </section>
    );
}

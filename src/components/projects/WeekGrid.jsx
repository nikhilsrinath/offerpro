import React, { useMemo, useState } from 'react';
import { Row, Btn, Muted, Status } from '../ui/edge';
import { useT, MONO, tableFrame, thStyle, tdStyle } from '../ui/edgeUtils';
import { saveTimeCell, submitWeek } from '../../services/projectService';
import { useToast } from '../shared/Toast';

/* ══════════════════════════════════════════════════════════════════════════
   One person's week: projects down, days across, hours in the cells.
   Typing saves a draft on blur; "Submit week" sends the drafts for approval.
   Approved hours are locked (the database refuses them anyway). Used by the
   Timesheets page and the employee portal.
   ══════════════════════════════════════════════════════════════════════════ */

const DAY = 86400000;
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function mondayOf(d = new Date()) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
}
const fmtH = (m) => (m ? String(Math.round((m / 60) * 100) / 100) : '');

export default function WeekGrid({ employeeId, projects, entries, readOnly = false }) {
    const t = useT();
    const toast = useToast();
    const [week, setWeek] = useState(() => mondayOf());
    const [busy, setBusy] = useState(false);
    const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * DAY)), [week]);
    const dayKeys = days.map(key);

    const mine = entries.filter((e) => e.employee_id === employeeId && dayKeys.includes(e.work_date));
    const cell = (pid, dk) => mine.filter((e) => e.project_id === pid && e.work_date === dk);
    const rows = projects.filter((p) => !p.closed || mine.some((e) => e.project_id === p.id));
    const drafts = mine.filter((e) => e.status === 'draft' || e.status === 'rejected');

    const save = async (pid, dk, hoursText, existing) => {
        const minutes = Math.round((Number(hoursText) || 0) * 60);
        if ((existing?.minutes || 0) === minutes) return;
        if (minutes > 1440) { toast('A day has 24 hours.', 'error'); return; }
        try { await saveTimeCell({ employeeId, projectId: pid, workDate: dk, minutes, existing }); }
        catch (e) { toast(e.message, 'error'); }
    };

    const submit = async () => {
        setBusy(true);
        try { await submitWeek(drafts); toast('Week submitted for approval', 'success'); }
        catch (e) { toast(e.message, 'error'); }
        finally { setBusy(false); }
    };

    const th = { ...thStyle(t, 'center'), padding: '10px 8px' };
    const td = { ...tdStyle(t, 'center'), padding: 5 };
    const dayTotal = (dk) => mine.filter((e) => e.work_date === dk).reduce((s, e) => s + e.minutes, 0);

    return (
        <div>
            <Row gap={8} wrap style={{ marginBottom: 10 }}>
                <Btn size="sm" aria-label="Previous week" onClick={() => setWeek((w) => new Date(w.getTime() - 7 * DAY))}>←</Btn>
                <span style={{ fontSize: 13 }}>
                    Week of {days[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {days[6].toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
                <Btn size="sm" aria-label="Next week" onClick={() => setWeek((w) => new Date(w.getTime() + 7 * DAY))}>→</Btn>
                <Btn size="sm" onClick={() => setWeek(mondayOf())}>This week</Btn>
                <div style={{ flex: 1 }} />
                <Muted>{fmtH(mine.reduce((s, e) => s + e.minutes, 0)) || 0} h this week</Muted>
                {!readOnly && (
                    <Btn size="sm" primary disabled={busy || drafts.length === 0} onClick={submit}>
                        Submit week{drafts.length ? ` (${drafts.length})` : ''}
                    </Btn>
                )}
            </Row>
            {rows.length === 0 ? <Muted>Not on any project this week.</Muted> : (
                <div className="edge-scroll" style={{ ...tableFrame(t), overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO }}>
                        <thead>
                            <tr>
                                <th scope="col" style={{ ...th, textAlign: 'left', padding: '10px 14px' }}>Project</th>
                                {days.map((d) => (
                                    <th key={key(d)} scope="col" style={th}>
                                        {d.toLocaleDateString('en-IN', { weekday: 'short' })} {d.getDate()}
                                    </th>
                                ))}
                                <th scope="col" style={th}>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((p) => {
                                const total = mine.filter((e) => e.project_id === p.id).reduce((s, e) => s + e.minutes, 0);
                                return (
                                    <tr key={p.id}>
                                        <th scope="row" style={{ ...td, textAlign: 'left', padding: '5px 14px', fontWeight: 400 }}>
                                            <span style={{ color: t.faint, fontSize: 11 }}>{p.code}</span> {p.name}
                                        </th>
                                        {dayKeys.map((dk) => {
                                            const es = cell(p.id, dk);
                                            const one = es.length === 1 ? es[0] : null;
                                            const locked = readOnly || es.length > 1 || es.some((e) => e.status === 'approved') || p.closed;
                                            const status = es[0]?.status;
                                            return (
                                                <td key={dk} style={td}>
                                                    <input
                                                        type="number" min="0" max="24" step="0.25" inputMode="decimal"
                                                        aria-label={`Hours on ${p.name}, ${dk}`}
                                                        defaultValue={fmtH(es.reduce((s, e) => s + e.minutes, 0))}
                                                        key={`${dk}:${es.map((e) => e.id + e.minutes).join()}`}
                                                        disabled={locked}
                                                        onBlur={(e) => save(p.id, dk, e.target.value, one)}
                                                        title={status ? `Status: ${status}` : undefined}
                                                        className="edge-input"
                                                        style={{
                                                            width: 56, height: 28, textAlign: 'center', fontFamily: MONO, fontSize: 12.5,
                                                            background: status === 'approved' ? t.raised : t.panelAlt, color: t.text,
                                                            border: '1px solid ' + (status === 'rejected' ? t.down : status === 'submitted' ? t.accent : t.line),
                                                            borderRadius: 8,
                                                        }} />
                                                </td>
                                            );
                                        })}
                                        <td style={{ ...td, fontSize: 12.5 }}>{fmtH(total) || '-'}</td>
                                    </tr>
                                );
                            })}
                            <tr>
                                <th scope="row" style={{ ...td, textAlign: 'left', fontSize: 12, color: t.faint, fontWeight: 500, padding: '9px 14px' }}>Day total</th>
                                {dayKeys.map((dk) => <td key={dk} style={{ ...td, fontSize: 12.5, color: t.dim }}>{fmtH(dayTotal(dk)) || '-'}</td>)}
                                <td style={td} />
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}
            <Row gap={14} wrap style={{ marginTop: 8 }}>
                <Status tone="mute">Draft</Status><Status tone="neutral">Submitted</Status>
                <Status tone="up">Approved (locked)</Status><Status tone="down">Rejected, edit and resubmit</Status>
            </Row>
        </div>
    );
}

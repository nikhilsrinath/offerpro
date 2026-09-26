import React, { useMemo, useState } from 'react';
import { Row, Btn, Muted, Status } from '../ui/edge';
import { useT, MONO } from '../ui/edgeUtils';
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

    const th = { padding: '7px 8px', fontSize: 9.5, letterSpacing: '0.06em', color: t.faint, fontWeight: 400, textAlign: 'center', borderBottom: '1px solid ' + t.line };
    const td = { padding: 4, borderBottom: '1px solid ' + t.lineSoft, textAlign: 'center' };
    const dayTotal = (dk) => mine.filter((e) => e.work_date === dk).reduce((s, e) => s + e.minutes, 0);

    return (
        <div>
            <Row gap={8} wrap style={{ marginBottom: 10 }}>
                <Btn size="sm" aria-label="Previous week" onClick={() => setWeek((w) => new Date(w.getTime() - 7 * DAY))}>←</Btn>
                <span style={{ fontSize: 11.5 }}>
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
                <div className="edge-scroll" style={{ overflowX: 'auto', border: '1px solid ' + t.line, borderRadius: 10 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO }}>
                        <thead>
                            <tr>
                                <th scope="col" style={{ ...th, textAlign: 'left' }}>PROJECT</th>
                                {days.map((d) => (
                                    <th key={key(d)} scope="col" style={th}>
                                        {d.toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase()} {d.getDate()}
                                    </th>
                                ))}
                                <th scope="col" style={th}>TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((p) => {
                                const total = mine.filter((e) => e.project_id === p.id).reduce((s, e) => s + e.minutes, 0);
                                return (
                                    <tr key={p.id}>
                                        <th scope="row" style={{ ...td, textAlign: 'left', fontSize: 11, fontWeight: 400, color: t.text }}>
                                            <span style={{ color: t.faint, fontSize: 9.5 }}>{p.code}</span> {p.name}
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
                                                            width: 56, height: 28, textAlign: 'center', fontFamily: MONO, fontSize: 11,
                                                            background: status === 'approved' ? t.panelAlt : t.panel, color: t.text,
                                                            border: '1px solid ' + (status === 'rejected' ? t.down : status === 'submitted' ? t.lineStrong : t.line),
                                                            borderRadius: 6,
                                                        }} />
                                                </td>
                                            );
                                        })}
                                        <td style={{ ...td, fontSize: 11 }}>{fmtH(total) || '—'}</td>
                                    </tr>
                                );
                            })}
                            <tr>
                                <th scope="row" style={{ ...td, textAlign: 'left', fontSize: 9.5, color: t.faint, fontWeight: 400 }}>DAY TOTAL</th>
                                {dayKeys.map((dk) => <td key={dk} style={{ ...td, fontSize: 11, color: t.dim }}>{fmtH(dayTotal(dk)) || '—'}</td>)}
                                <td style={td} />
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}
            <Row gap={14} wrap style={{ marginTop: 8 }}>
                <Status tone="mute">Draft</Status><Status tone="neutral">Submitted</Status>
                <Status tone="up">Approved (locked)</Status><Status tone="down">Rejected — edit and resubmit</Status>
            </Row>
        </div>
    );
}

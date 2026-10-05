// AttendanceSheet — the manager's two views of attendance.
//
//   Daily    the whole team on one date: status, times, a note, bulk marking.
//   Monthly  the team's month as a calendar of daily counts (click a day for
//            who was where), or one employee's month when one is picked —
//            clicking a name on the daily sheet opens theirs.
//
// Both write through attendanceService.markDay(), which always stamps
// `source: 'admin'` — that is what stops the employee's portal overwriting a
// correction afterwards (0029 §6).
//
// Marking is the job, so the status control is on the row itself: a segmented
// button per person, one click, no dialog. The dialog is only for the details
// (times and a note) that not every row needs. Statuses are shown as words
// and counts, not colours.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSection } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { orgStore } from '../../services/orgStore';
import {
    attendanceService, ATTENDANCE_STATUSES, statusLabel, todayKey,
    currentMonthKey, monthBounds, workedMinutes, formatDuration, summariseMonth,
} from '../../services/attendanceService';
import {
    Page, Toolbar, Panel, Row, Btn, Seg, Field, Input, Select, Textarea,
    Table, Tr, Td, Avatar, Status, StatBand, Empty, Loading, Modal, Muted, Label,
} from '../ui/edge';
import { useT, fmtDate, MONO } from '../ui/edgeUtils';

// The four counts the sheets report. A half day is counted as leave, and a
// holiday in none of them.
const BUCKETS = [
    { key: 'present', label: 'Present', statuses: ['present'] },
    { key: 'absent', label: 'Absent', statuses: ['absent'] },
    { key: 'leave', label: 'On leave', statuses: ['leave', 'half_day'] },
    { key: 'remote', label: 'Remote', statuses: ['remote'] },
];
const bucketOf = (status) => BUCKETS.find((b) => b.statuses.includes(status))?.key || null;
const countBuckets = (rows) => {
    const out = { present: 0, absent: 0, leave: 0, remote: 0 };
    rows.forEach((r) => { const k = bucketOf(r.status); if (k) out[k] += 1; });
    return out;
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// The four marks that cover almost every row; the rest live in the details
// dialog so the inline control stays one glance wide.
const QUICK = ['present', 'absent', 'leave', 'remote'].filter(
    (k) => ATTENDANCE_STATUSES.some((s) => s.key === k),
);

const toTimeInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const fromTimeInput = (value, dateKey) => {
    if (!value) return null;
    const [h, m] = value.split(':').map(Number);
    const d = new Date(`${dateKey}T00:00:00`);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
};

const shiftMonth = (monthKey, delta) => {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const shiftDate = (dateKey, delta) => {
    const d = new Date(`${dateKey}T00:00:00`);
    d.setDate(d.getDate() + delta);
    return todayKey(d);
};

const monthLabel = (monthKey) => new Date(`${monthKey}-01T00:00:00`)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export default function AttendanceSheet() {
    const t = useT();
    const toast = useToast();
    const employees = useSection('employees');
    const departments = useSection('departments');
    const orgId = orgStore.getOrgId();

    const [tab, setTab] = useState('daily');
    const [date, setDate] = useState(todayKey());
    const [monthKey, setMonthKey] = useState(currentMonthKey());
    const [personId, setPersonId] = useState('');
    const [dept, setDept] = useState('');
    const [dayRows, setDayRows] = useState({});
    const [monthRows, setMonthRows] = useState({});
    const [teamMonth, setTeamMonth] = useState([]);
    const [dayList, setDayList] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState('');
    const [editing, setEditing] = useState(null);
    const [exporting, setExporting] = useState(false);
    const [bulk, setBulk] = useState(null);

    const roster = useMemo(() => employees
        .filter((e) => !dept || e.department_id === dept)
        .sort((a, b) => String(a.name || a.full_name || '').localeCompare(String(b.name || b.full_name || ''))),
    [employees, dept]);

    const employeesById = useMemo(
        () => Object.fromEntries(employees.map((e) => [e.id, e])), [employees],
    );

    const loadDay = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            setDayRows(await attendanceService.listDay(orgId, date));
        } catch (err) {
            toast(err.message || 'Could not load the day.', 'error');
        } finally {
            setLoading(false);
        }
    }, [orgId, date, toast]);

    // No one picked is the whole team's month; a person is their calendar.
    const loadMonth = useCallback(async () => {
        if (!orgId) return;
        setLoading(true);
        try {
            if (personId) setMonthRows(await attendanceService.listMonth(orgId, personId, monthKey));
            else setTeamMonth(await attendanceService.listMonthForOrg(orgId, monthKey));
        } catch (err) {
            toast(err.message || 'Could not load the month.', 'error');
        } finally {
            setLoading(false);
        }
    }, [orgId, personId, monthKey, toast]);

    useEffect(() => { if (tab === 'daily') loadDay(); }, [tab, loadDay]);
    useEffect(() => { if (tab === 'monthly') loadMonth(); }, [tab, loadMonth]);

    const setStatus = async (employeeId, status) => {
        setBusyId(employeeId);
        try {
            const row = await attendanceService.markDay(orgId, employeeId, date, { status });
            setDayRows((prev) => ({ ...prev, [employeeId]: row }));
        } catch (err) {
            toast(err.message || 'Could not save.', 'error');
        } finally {
            setBusyId('');
        }
    };

    const markEveryone = async (status) => {
        const ids = roster.map((e) => e.id);
        if (!ids.length) return;
        setBulk(null);
        try {
            await attendanceService.markMany(orgId, ids, date, { status });
            await loadDay();
            toast(`${ids.length} marked ${statusLabel(status).toLowerCase()}`, 'success');
        } catch (err) {
            toast(err.message || 'Could not mark the team.', 'error');
        }
    };

    const saveDetails = async () => {
        const { employeeId, dateKey, checkIn, checkOut, status, note } = editing;
        if (checkIn && checkOut && checkOut < checkIn) {
            toast('Check-out cannot be before check-in.', 'error');
            return;
        }
        try {
            const row = await attendanceService.markDay(orgId, employeeId, dateKey, {
                check_in: fromTimeInput(checkIn, dateKey),
                check_out: fromTimeInput(checkOut, dateKey),
                status,
                note: note?.trim() || null,
            });
            if (dateKey === date) setDayRows((prev) => ({ ...prev, [employeeId]: row }));
            if (employeeId === personId) setMonthRows((prev) => ({ ...prev, [dateKey]: row }));
            setEditing(null);
            toast('Attendance updated', 'success');
        } catch (err) {
            toast(err.message || 'Could not save.', 'error');
        }
    };

    const openEditor = (employeeId, dateKey, row) => setEditing({
        employeeId, dateKey,
        name: employeesById[employeeId]?.name || employeesById[employeeId]?.full_name || 'Employee',
        checkIn: toTimeInput(row?.check_in),
        checkOut: toTimeInput(row?.check_out),
        status: row?.status || 'present',
        note: row?.note || '',
    });

    const exportMonth = async () => {
        setExporting(true);
        try {
            const n = await attendanceService.exportMonth(orgId, monthKey, employeesById);
            toast(n ? `Exported ${n} rows` : 'Nothing recorded in that month', n ? 'success' : 'info');
        } catch (err) {
            toast(err.message || 'Could not export.', 'error');
        } finally {
            setExporting(false);
        }
    };

    const dayTotals = useMemo(() => {
        const rows = roster.map((e) => dayRows[e.id]).filter(Boolean);
        return { ...countBuckets(rows), unmarked: roster.length - rows.length };
    }, [roster, dayRows]);

    // From the daily sheet: that person's month, the month of the day on screen.
    const openPersonMonth = (employeeId) => {
        setPersonId(employeeId);
        setMonthKey(date.slice(0, 7));
        setTab('monthly');
    };

    const isToday = date === todayKey();

    return (
        <Page>
            <Toolbar right={
                tab === 'daily'
                    ? (
                        <Row gap={8}>
                            {QUICK.slice(0, 2).map((s) => (
                                <Btn key={s} onClick={() => setBulk(s)} disabled={!roster.length}>
                                    Mark all {statusLabel(s).toLowerCase()}
                                </Btn>
                            ))}
                        </Row>
                    )
                    : (
                        // Exports the whole team, not just the person on screen — a
                        // month of attendance for payroll is never one row of people.
                        <Btn primary onClick={exportMonth} disabled={exporting}>
                            {exporting ? 'Exporting…' : 'Export month (all staff)'}
                        </Btn>
                    )
            }>
                <Seg value={tab} onChange={setTab} options={[
                    { id: 'daily', label: 'Daily sheet' },
                    { id: 'monthly', label: 'Monthly sheet' },
                ]} />

                {tab === 'daily' ? (
                    <>
                        <Row gap={4}>
                            <Btn size="sm" onClick={() => setDate(shiftDate(date, -1))} title="Previous day">←</Btn>
                            <Input type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)}
                                style={{ width: 140, height: 29 }} />
                            <Btn size="sm" onClick={() => setDate(shiftDate(date, 1))} disabled={isToday} title="Next day">→</Btn>
                            {!isToday && <Btn size="sm" onClick={() => setDate(todayKey())}>Today</Btn>}
                        </Row>
                        {departments.length > 0 && (
                            <Select value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 160, height: 29 }}>
                                <option value="">All departments</option>
                                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </Select>
                        )}
                    </>
                ) : (
                    <>
                        <Row gap={4}>
                            <Btn size="sm" onClick={() => setMonthKey(shiftMonth(monthKey, -1))} title="Previous month">←</Btn>
                            <span style={{ minWidth: 128, textAlign: 'center', fontSize: 13, color: t.text }}>
                                {monthLabel(monthKey)}
                            </span>
                            <Btn size="sm" onClick={() => setMonthKey(shiftMonth(monthKey, 1))}
                                disabled={monthKey >= currentMonthKey()} title="Next month">→</Btn>
                        </Row>
                        <Select value={personId} onChange={(e) => setPersonId(e.target.value)} style={{ width: 190, height: 29 }}
                            aria-label="Whose month">
                            <option value="">Whole team</option>
                            {roster.map((e) => <option key={e.id} value={e.id}>{e.name || e.full_name}</option>)}
                        </Select>
                    </>
                )}
            </Toolbar>

            {tab === 'daily' ? (
                <>
                    <Row gap={10} style={{ marginBottom: 12 }}>
                        <span style={{ fontSize: 13.5, color: t.text }}>{fmtDate(date)}</span>
                        <Muted>{roster.length} on the roster</Muted>
                    </Row>

                    <StatBand items={[
                        ...BUCKETS.map((b) => ({ label: b.label, value: dayTotals[b.key] })),
                        { label: 'Not marked', value: dayTotals.unmarked },
                    ]} />

                    {loading ? <Loading /> : roster.length === 0 ? (
                        <Panel><Empty>No one to mark. Add employees to the registry first.</Empty></Panel>
                    ) : (
                        <Table cols={[
                            { key: 'w', label: 'Who' },
                            { key: 'm', label: 'Mark', width: 300 },
                            { key: 'i', label: 'In', align: 'right', width: 62 },
                            { key: 'o', label: 'Out', align: 'right', width: 62 },
                            { key: 'h', label: 'Hours', align: 'right', width: 72 },
                            { key: 'n', label: 'Note' },
                            { key: 'a', label: '', align: 'right', width: 82 },
                        ]}>
                            {roster.map((e) => {
                                const row = dayRows[e.id];
                                const name = e.name || e.full_name || 'Unnamed';
                                return (
                                    <Tr key={e.id} label={`Open ${name}’s month`}
                                        onClick={(ev) => {
                                            // Marking and Details keep their own behaviour; anywhere else opens the month.
                                            if (ev.target.closest('button, input, select, textarea, a, [role="radiogroup"]')) return;
                                            openPersonMonth(e.id);
                                        }}>
                                        <Td>
                                            <div title={`Open ${name}’s month`}
                                                style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                                <Avatar name={name} size={26} />
                                                <span style={{ minWidth: 0 }}>
                                                    <span style={{ display: 'block', textDecoration: 'underline', textDecorationColor: t.line, textUnderlineOffset: 3 }}>{name}</span>
                                                    <span style={{ display: 'block', fontSize: 11, color: t.faint, marginTop: 1 }}>
                                                        {e.role || '—'}
                                                    </span>
                                                </span>
                                            </div>
                                        </Td>
                                        <Td>
                                            <div style={{ opacity: busyId === e.id ? 0.5 : 1, transition: 'opacity .15s' }}>
                                                <Seg size="sm" value={row?.status || ''}
                                                    onChange={(s) => setStatus(e.id, s)}
                                                    options={QUICK.map((k) => ({ id: k, label: statusLabel(k) }))} />
                                            </div>
                                        </Td>
                                        <Td align="right" muted nowrap>{toTimeInput(row?.check_in) || '—'}</Td>
                                        <Td align="right" muted nowrap>{toTimeInput(row?.check_out) || '—'}</Td>
                                        <Td align="right" muted nowrap>
                                            {row ? formatDuration(workedMinutes(row)) : '—'}
                                        </Td>
                                        <Td muted>{row?.note || ''}</Td>
                                        <Td align="right">
                                            <Btn size="sm" onClick={() => openEditor(e.id, date, row)}>Details</Btn>
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </Table>
                    )}
                </>
            ) : personId ? (
                <MonthlyView
                    t={t} monthKey={monthKey} rows={monthRows} loading={loading}
                    personId={personId} roster={roster}
                    onPick={(dateKey, row) => openEditor(personId, dateKey, row)}
                />
            ) : (
                <TeamMonthView
                    t={t} monthKey={monthKey} rows={teamMonth} loading={loading} roster={roster}
                    onPick={setDayList}
                />
            )}

            {dayList && (
                <DayListModal t={t} dateKey={dayList} roster={roster}
                    rows={teamMonth.filter((r) => r.work_date === dayList)}
                    onClose={() => setDayList(null)}
                    onOpenDay={() => { setDate(dayList); setTab('daily'); setDayList(null); }}
                />
            )}

            {editing && (
                <Modal open onClose={() => setEditing(null)} width={470}
                    title={editing.name} note={fmtDate(editing.dateKey)}
                    footer={
                        <>
                            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
                            <Btn primary onClick={saveDetails}>Save</Btn>
                        </>
                    }>
                    <Field label="Status">
                        <Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                            {ATTENDANCE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </Select>
                    </Field>
                    <div style={{ height: 13 }} />
                    <Row gap={13}>
                        <div style={{ flex: 1 }}>
                            <Field label="Check in">
                                <Input type="time" value={editing.checkIn}
                                    onChange={(e) => setEditing({ ...editing, checkIn: e.target.value })} />
                            </Field>
                        </div>
                        <div style={{ flex: 1 }}>
                            <Field label="Check out">
                                <Input type="time" value={editing.checkOut}
                                    onChange={(e) => setEditing({ ...editing, checkOut: e.target.value })} />
                            </Field>
                        </div>
                    </Row>
                    <div style={{ height: 13 }} />
                    <Field label="Note" hint="Visible to this employee in their portal">
                        <Textarea rows={2} value={editing.note} style={{ minHeight: 58 }}
                            onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
                    </Field>
                </Modal>
            )}

            {bulk && (
                <Modal open onClose={() => setBulk(null)} width={420}
                    title={`Mark everyone ${statusLabel(bulk).toLowerCase()}?`}
                    note={fmtDate(date)}
                    footer={
                        <>
                            <Btn onClick={() => setBulk(null)}>Cancel</Btn>
                            <Btn primary onClick={() => markEveryone(bulk)}>
                                Mark {roster.length} {roster.length === 1 ? 'person' : 'people'}
                            </Btn>
                        </>
                    }>
                    <p style={{ margin: 0, fontSize: 13, color: t.dim, lineHeight: 1.75 }}>
                        This overwrites anything already marked for {fmtDate(date)}, including times and notes
                        people entered themselves. You can still correct individual rows afterwards.
                    </p>
                </Modal>
            )}
        </Page>
    );
}

/** One employee's month as a calendar grid, Monday-first. */
function MonthlyView({ t, monthKey, rows, loading, personId, roster, onPick }) {
    const { days } = monthBounds(monthKey);
    // getDay() is Sunday-0; the grid starts on Monday, so rotate it.
    const firstDow = (new Date(`${monthKey}-01T00:00:00`).getDay() + 6) % 7;
    const summary = summariseMonth(rows);
    const counts = countBuckets(Object.values(rows || {}));

    const cells = [];
    for (let i = 0; i < firstDow; i += 1) cells.push(null);
    for (let d = 1; d <= days; d += 1) cells.push(`${monthKey}-${String(d).padStart(2, '0')}`);

    const person = roster.find((e) => e.id === personId);

    if (loading) return <Loading />;

    return (
        <>
            <StatBand items={[
                ...BUCKETS.map((b) => ({ label: b.label, value: counts[b.key] })),
                { label: 'Hours logged', value: formatDuration(summary.workedMinutes) },
            ]} />

            <Panel title={person?.name || person?.full_name || 'Calendar'} note={monthLabel(monthKey)} pad={13}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 5 }}>
                    {WEEKDAYS.map((w) => (
                        <div key={w} style={{
                            fontSize: 10.5, letterSpacing: '0.09em', color: t.faint,
                            textAlign: 'center', paddingBottom: 5,
                        }}>{w.toUpperCase()}</div>
                    ))}
                    {cells.map((dateKey, i) => {
                        if (!dateKey) return <div key={'pad-' + i} />;
                        const row = rows[dateKey];
                        const today = dateKey === todayKey();
                        return (
                            <button
                                key={dateKey} type="button" className="edge-btn"
                                onClick={() => onPick(dateKey, row)}
                                title={row ? `${statusLabel(row.status)}${row.note ? ' — ' + row.note : ''}` : 'Not marked'}
                                style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3,
                                    minHeight: 62, padding: '7px 8px', cursor: 'pointer', textAlign: 'left',
                                    fontFamily: MONO, color: t.text, background: t.panel,
                                    border: '1px solid ' + (today ? t.lineStrong : t.line),
                                    borderRadius: 7,
                                }}
                            >
                                <span style={{ fontSize: 12.5, color: today ? t.text : t.dim }}>
                                    {Number(dateKey.slice(-2))}
                                </span>
                                {row && (
                                    <>
                                        <span style={{ fontSize: 10.5, color: t.faint, lineHeight: 1.3 }}>
                                            {statusLabel(row.status)}
                                        </span>
                                        <span style={{ fontSize: 10.5, color: t.ghost }}>
                                            {formatDuration(workedMinutes(row))}
                                        </span>
                                    </>
                                )}
                            </button>
                        );
                    })}
                </div>

            </Panel>
        </>
    );
}

/** The whole team's month: each day shows how many were present, absent, on
    leave and remote; clicking a day lists who. */
function TeamMonthView({ t, monthKey, rows, loading, roster, onPick }) {
    const { days } = monthBounds(monthKey);
    const firstDow = (new Date(`${monthKey}-01T00:00:00`).getDay() + 6) % 7;
    const byDay = useMemo(() => {
        const onRoster = new Set(roster.map((e) => e.id));
        const out = {};
        rows.filter((r) => onRoster.has(r.employee_id)).forEach((r) => { (out[r.work_date] ||= []).push(r); });
        return out;
    }, [rows, roster]);
    const totals = countBuckets(Object.values(byDay).flat());

    const cells = [];
    for (let i = 0; i < firstDow; i += 1) cells.push(null);
    for (let d = 1; d <= days; d += 1) cells.push(`${monthKey}-${String(d).padStart(2, '0')}`);

    if (loading) return <Loading />;
    if (!roster.length) return <Panel><Empty>Add employees to the registry to see the month.</Empty></Panel>;

    return (
        <>
            <StatBand items={BUCKETS.map((b) => ({ label: `${b.label} · person-days`, value: totals[b.key] }))} />

            <Panel title="Whole team" note={`${monthLabel(monthKey)} · ${roster.length} on the roster · click a day to see who`} pad={13}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 5 }}>
                    {WEEKDAYS.map((w) => (
                        <div key={w} style={{
                            fontSize: 10.5, letterSpacing: '0.09em', color: t.faint,
                            textAlign: 'center', paddingBottom: 5,
                        }}>{w.toUpperCase()}</div>
                    ))}
                    {cells.map((dateKey, i) => {
                        if (!dateKey) return <div key={'pad-' + i} />;
                        const dayRows = byDay[dateKey] || [];
                        const c = countBuckets(dayRows);
                        const today = dateKey === todayKey();
                        return (
                            <button
                                key={dateKey} type="button" className="edge-btn"
                                onClick={() => onPick(dateKey)}
                                aria-label={`${fmtDate(dateKey)}: ${BUCKETS.map((b) => `${c[b.key]} ${b.label.toLowerCase()}`).join(', ')}`}
                                style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 2,
                                    minHeight: 86, padding: '7px 8px', cursor: 'pointer', textAlign: 'left',
                                    fontFamily: MONO, color: t.text, background: t.panel,
                                    border: '1px solid ' + (today ? t.lineStrong : t.line),
                                    borderRadius: 7, opacity: dateKey > todayKey() ? 0.55 : 1,
                                }}
                            >
                                <span style={{ fontSize: 12.5, color: today ? t.text : t.dim }}>
                                    {Number(dateKey.slice(-2))}
                                </span>
                                {dayRows.length > 0 && BUCKETS.map((b) => (
                                    <span key={b.key} style={{
                                        display: 'flex', justifyContent: 'space-between', gap: 4,
                                        fontSize: 10.5, lineHeight: 1.3, color: c[b.key] ? t.dim : t.ghost,
                                    }}>
                                        <span>{b.label}</span><span>{c[b.key]}</span>
                                    </span>
                                ))}
                            </button>
                        );
                    })}
                </div>
            </Panel>
        </>
    );
}

/** Who was present, absent, on leave and remote on one day. */
function DayListModal({ t, dateKey, roster, rows, onClose, onOpenDay }) {
    const byEmployee = Object.fromEntries(rows.map((r) => [r.employee_id, r]));
    const nameOf = (e) => e.name || e.full_name || 'Unnamed';
    const groups = [
        ...BUCKETS.map((b) => ({ ...b, people: roster.filter((e) => bucketOf(byEmployee[e.id]?.status) === b.key) })),
        { key: 'unmarked', label: 'Not marked', people: roster.filter((e) => !byEmployee[e.id]) },
    ];
    return (
        <Modal open onClose={onClose} width={470} title={fmtDate(dateKey)} note={`${roster.length} on the roster`}
            footer={
                <>
                    <Btn onClick={onClose}>Close</Btn>
                    {dateKey <= todayKey() && <Btn primary onClick={onOpenDay}>Open daily sheet</Btn>}
                </>
            }>
            {groups.map((g) => (
                <div key={g.key} style={{ marginBottom: 13 }}>
                    <Label>{g.label} · {g.people.length}</Label>
                    {g.people.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: t.ghost, marginTop: 4 }}>No one</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                            {g.people.map((e) => (
                                <Row key={e.id} gap={9}>
                                    <Avatar name={nameOf(e)} size={22} />
                                    <span style={{ fontSize: 13, color: t.text }}>{nameOf(e)}</span>
                                    <span style={{ fontSize: 11, color: t.faint }}>{e.role || ''}</span>
                                    {byEmployee[e.id]?.status === 'half_day' && <Muted>half day</Muted>}
                                </Row>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </Modal>
    );
}

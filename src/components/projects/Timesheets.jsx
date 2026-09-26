import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Toolbar, Panel, Row, Btn, Seg, Select, Table, Tr, Td, Empty, Muted, Field, Input } from '../ui/edge';
import { useT } from '../ui/edgeUtils';
import { useAuth } from '../../context/AuthContext';
import { useSection, fmtDate } from '../financial/financeHooks';
import { useToast } from '../shared/Toast';
import { orgStore } from '../../services/orgStore';
import { hasFeature } from '../../services/planConfig';
import { isClosed, memberActive } from '../../services/projectAnalytics';
import { decideTimesheets } from '../../services/projectService';
import WeekGrid from './WeekGrid';

/* ══════════════════════════════════════════════════════════════════════════
   Timesheets (Max). Log your week; if you manage a project (or are an admin),
   approve the team's. Approval is the database's rule (0059): never your own.
   ══════════════════════════════════════════════════════════════════════════ */

export default function Timesheets() {
    const t = useT();
    const toast = useToast();
    const navigate = useNavigate();
    const { user } = useAuth();
    const entries = useSection('timesheet_entries');
    const projects = useSection('projects');
    const members = useSection('project_members');
    const employees = useSection('employees');
    const [view, setView] = useState('week');
    const [picked, setPicked] = useState(null);
    const [selected, setSelected] = useState(new Set());
    const [note, setNote] = useState('');
    const allowed = hasFeature(orgStore.getProfile().plan || 'free', 'timesheets');

    const me = useMemo(() => employees.find((e) => e.user_id && e.user_id === user?.id)?.id || null, [employees, user]);
    const admin = ['owner', 'admin'].includes(orgStore.getRole());
    const canLogForOthers = orgStore.can('timesheets', 'create');
    const person = picked || me;
    const managed = projects.filter((p) => admin || (me && p.manager_employee_id === me));
    const empName = (id) => employees.find((e) => e.id === id)?.name || 'Someone';
    const projectById = Object.fromEntries(projects.map((p) => [p.id, p]));

    const today = new Date().toISOString().slice(0, 10);
    const personProjects = projects
        .filter((p) => members.some((m) => m.project_id === p.id && m.employee_id === person
            && (memberActive(m, today) || (m.end_date && m.end_date >= `${today.slice(0, 8)}01`)))
            || entries.some((e) => e.project_id === p.id && e.employee_id === person))
        .map((p) => ({ id: p.id, code: p.code, name: p.name, closed: isClosed(p) }));

    const queue = entries
        .filter((e) => e.status === 'submitted' && managed.some((p) => p.id === e.project_id) && e.employee_id !== me)
        .sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));

    const decide = async (decision) => {
        try {
            const n = await decideTimesheets([...selected], decision, note);
            toast(`${n} entr${n === 1 ? 'y' : 'ies'} ${decision}`, 'success');
            setSelected(new Set()); setNote('');
        } catch (e) { toast(e.message, 'error'); }
    };

    if (!allowed) {
        return <Page><Panel><Empty action={<Btn primary onClick={() => navigate('/pricing')}>See plans</Btn>}>
            Timesheets — log hours, approve them, cost projects by time and bill hours — are part of the Max plan.
        </Empty></Panel></Page>;
    }

    const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

    return (
        <Page>
            <Toolbar>
                <Seg value={view} onChange={setView} label="View" options={[
                    { id: 'week', label: 'Week' },
                    ...(managed.length ? [{ id: 'approve', label: 'Approvals', count: queue.length }] : []),
                ]} />
                {view === 'week' && canLogForOthers && (
                    <Select aria-label="Person" value={person || ''} onChange={(e) => setPicked(e.target.value || null)} style={{ width: 190, height: 29 }}>
                        {!me && <option value="">Choose a person…</option>}
                        {employees.filter((e) => !e.exited_at).map((e) => <option key={e.id} value={e.id}>{e.name}{e.id === me ? ' (you)' : ''}</option>)}
                    </Select>
                )}
            </Toolbar>

            {view === 'week' ? (
                person ? <WeekGrid employeeId={person} projects={personProjects} entries={entries} />
                    : <Panel><Empty>Your login is not linked to an employee record, so there is no week of your own to fill. Choose a person above.</Empty></Panel>
            ) : (
                <Panel title="Waiting for approval" note="Projects you manage">
                    {queue.length === 0 ? <Empty>Nothing to approve.</Empty> : (
                        <>
                            <Table cols={[
                                { key: 'c', label: '', width: 36 }, { key: 'p', label: 'Person' }, { key: 'j', label: 'Project' },
                                { key: 'd', label: 'Day' }, { key: 'h', label: 'Hours', align: 'right' }, { key: 'n', label: 'Note' },
                            ]}>
                                {queue.map((e) => (
                                    <Tr key={e.id} onClick={() => toggle(e.id)} selected={selected.has(e.id)}>
                                        <Td><input type="checkbox" aria-label={`Select ${empName(e.employee_id)} ${e.work_date}`}
                                            checked={selected.has(e.id)} onChange={() => toggle(e.id)} onClick={(ev) => ev.stopPropagation()} /></Td>
                                        <Td>{empName(e.employee_id)}</Td>
                                        <Td muted>{projectById[e.project_id]?.name}</Td>
                                        <Td muted nowrap>{fmtDate(e.work_date)}</Td>
                                        <Td align="right">{Math.round((e.minutes / 60) * 100) / 100}</Td>
                                        <Td muted>{e.note || ''}{e.billable ? '' : ' · non-billable'}</Td>
                                    </Tr>
                                ))}
                            </Table>
                            <Row gap={8} wrap style={{ padding: 12 }}>
                                <Btn size="sm" onClick={() => setSelected(new Set(queue.map((e) => e.id)))}>Select all</Btn>
                                <div style={{ width: 260 }}><Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
                                <div style={{ flex: 1 }} />
                                <Muted>{selected.size} selected</Muted>
                                <Btn disabled={!selected.size} onClick={() => decide('rejected')}>Reject</Btn>
                                <Btn primary disabled={!selected.size} onClick={() => decide('approved')}>Approve</Btn>
                            </Row>
                        </>
                    )}
                </Panel>
            )}
            <p style={{ fontSize: 10, color: t.faint, marginTop: 10 }}>Nobody approves their own hours; approved hours are locked.</p>
        </Page>
    );
}

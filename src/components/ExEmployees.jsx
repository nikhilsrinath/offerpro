import { useState, useEffect, useMemo } from 'react';
import { useOrg } from '../context/OrgContext';
import { orgStore } from '../services/orgStore';
import { listMembers } from '../services/permissionService';
import { DEPT_PALETTE } from './TeamHierarchy';
import {
    Page, Toolbar, Panel, Row, Btn, Search, Table, Tr, Td, Avatar, Status,
    StatBand, Breakdown, Empty, Loading, Muted, Modal, Field, Input,
} from './ui/edge';
import { useT, fmtDate } from './ui/edgeUtils';
import { confirmDialog } from '../services/confirm';
import { useToast } from './shared/Toast';
import { useAuth } from '../context/AuthContext';
import { Detail } from './Employees';
import { hasSalary } from '../shared/payroll';

/* ══════════════════════════════════════════════════════════════════════════
   Ex-employees.

   An archive, so it reads like one: a table sorted by when each person left,
   with a tenure column that turns two dates into the number people actually
   want. The one live question, can they still sign in, is a status word on
   the row rather than a shield icon whose colour you have to interpret.
   ══════════════════════════════════════════════════════════════════════════ */

function getDisplayName(emp) {
    if (emp.studentName) return emp.studentName;
    const first = (emp.first_name || '').trim();
    const last = (emp.last_name || '').trim();
    if (first || last) return `${first} ${last}`.trim();
    return emp.name || '';
}

const leftOn = (e) => e.terminated_at || e.archived_at || e.exited_at || null;

/** Tenure as a person would say it, not as a date range. */
function tenure(emp) {
    const from = emp.startDate || emp.start_date || emp.created_at;
    const to = leftOn(emp);
    if (!from || !to) return '-';
    const months = Math.max(0, Math.round((new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24 * 30.44)));
    if (months < 1) return 'Under a month';
    if (months < 12) return months + (months === 1 ? ' month' : ' months');
    const y = Math.floor(months / 12);
    const m = months % 12;
    return y + (y === 1 ? ' year' : ' years') + (m ? ', ' + m + 'mo' : '');
}

function deptColor(name) {
    if (!name) return null;
    const h = [...name].reduce((a, c) => c.charCodeAt(0) + ((a << 5) - a), 0);
    return DEPT_PALETTE[Math.abs(h) % DEPT_PALETTE.length];
}

export default function ExEmployees() {
    const t = useT();
    const toast = useToast();
    const { activeOrg } = useOrg();
    const { user } = useAuth();
    const [people, setPeople] = useState([]);
    // Null means "not known": listMembers is admin-only, so a member viewing
    // this page gets no claim about anyone's access rather than a wrong one.
    const [liveUserIds, setLiveUserIds] = useState(null);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(null);

    useEffect(() => {
        if (!activeOrg?.id) return undefined;
        const unsubscribe = orgStore.listenSection('ex_employees', (data) => {
            const list = Object.values(data || {});
            list.sort((a, b) => new Date(leftOn(b) || 0) - new Date(leftOn(a) || 0));
            setPeople(list);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [activeOrg?.id]);

    useEffect(() => {
        let cancelled = false;
        Promise.resolve(activeOrg?.id ? listMembers(activeOrg.id) : null)
            .then((members) => {
                if (cancelled) return;
                setLiveUserIds(members ? new Set(members.map((m) => m.user_id)) : null);
            })
            .catch(() => { if (!cancelled) setLiveUserIds(null); });
        return () => { cancelled = true; };
    }, [activeOrg?.id]);

    const list = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return people;
        return people.filter((e) => getDisplayName(e).toLowerCase().includes(q)
            || (e.email || '').toLowerCase().includes(q)
            || (e.role || '').toLowerCase().includes(q)
            || (e.department || '').toLowerCase().includes(q));
    }, [people, query]);

    const stats = useMemo(() => {
        const now = new Date();
        const thisYear = people.filter((e) => leftOn(e) && new Date(leftOn(e)).getFullYear() === now.getFullYear()).length;
        const stillIn = liveUserIds ? people.filter((e) => e.user_id && liveUserIds.has(e.user_id)).length : null;
        return { total: people.length, thisYear, stillIn };
    }, [people, liveUserIds]);

    const byDept = useMemo(() => {
        const m = {};
        people.forEach((e) => { if (e.department) m[e.department] = (m[e.department] || 0) + 1; });
        return Object.entries(m).map(([label, value]) => ({ label, value, color: deptColor(label) }));
    }, [people]);

    // Revert: they join again on their own record (same ID, history and
    // payments), back on the registry. Pay and projects stay as they were.
    const revert = async (emp) => {
        const name = getDisplayName(emp) || 'this person';
        if (!(await confirmDialog({
            title: 'Revert to employee',
            message: `Bring ${name} back onto the team? They move from Ex-Employees to the registry, with their record as it was. Their exit date and reason are cleared.`,
            confirmLabel: 'Revert',
        }))) return;
        try {
            await orgStore.rejoinEmployee(emp.id);
            setSelected(null);
            toast(`${name} is back on the team`, 'success');
        } catch (err) {
            toast(`Could not revert ${name}: ${err.message}`, 'error');
        }
    };

    // Deleting removes the record for good. A person other records still point
    // at (their documents, tasks) is refused by the database, and says so.
    // `confirmed`: the sheet's Delete has asked already.
    const remove = async (emp, confirmed = false) => {
        const name = getDisplayName(emp) || 'this person';
        if (!confirmed && !(await confirmDialog({
            title: 'Delete ex-employee',
            message: `Delete ${name} from the archive? This removes the record permanently and cannot be undone.`,
        }))) return;
        try {
            await orgStore.removeItem('ex_employees', emp.id);
            setSelected(null);
            toast(`${name} deleted`, 'success');
        } catch (err) {
            toast(`Could not delete ${name}: ${err.message}`, 'error');
        }
    };

    // An owner or admin may change someone's Employee ID (0102), here as on a
    // current employee's form: to put past hires in joining order, once.
    const canSetId = ['owner', 'admin'].includes(orgStore.getRole());
    const [codeFor, setCodeFor] = useState(null);
    const [code, setCode] = useState('');
    const [codeError, setCodeError] = useState('');
    const [codeSaving, setCodeSaving] = useState(false);
    const openCode = (emp) => { setCodeFor(emp); setCode(emp.employee_code || ''); setCodeError(''); };
    const saveCode = async () => {
        const value = code.trim();
        if (!value) { setCodeError('Enter an Employee ID.'); return; }
        if (value === (codeFor.employee_code || '')) { setCodeFor(null); return; }
        const lower = value.toLowerCase();
        const taken = [...orgStore.getSectionAsList('employees'), ...orgStore.getSectionAsList('ex_employees')]
            .find((e) => e.id !== codeFor.id && (e.employee_code || '').toLowerCase() === lower);
        if (taken) {
            setCodeError(`${getDisplayName(taken) || 'Someone'}${taken.exited_at ? ' (ex-employee)' : ''} already has ${taken.employee_code}. Give them another ID first.`);
            return;
        }
        setCodeSaving(true);
        try {
            await orgStore.setEmployeeCode(codeFor.id, value);
            toast(`${getDisplayName(codeFor) || 'Their'} Employee ID is now ${value}`, 'success');
            setCodeFor(null);
        } catch (err) {
            setCodeError(err.message || 'Could not change the Employee ID.');
        } finally {
            setCodeSaving(false);
        }
    };

    const access = (emp) => {
        if (liveUserIds === null) return null;
        return emp.user_id && liveUserIds.has(emp.user_id)
            ? { tone: 'down', label: 'Can still sign in' }
            : { tone: 'mute', label: 'Access removed' };
    };

    if (loading) return <Page><Loading>Loading the archive…</Loading></Page>;

    return (
        <Page>
            <Toolbar right={<Muted>{people.length} {people.length === 1 ? 'record' : 'records'}</Muted>}>
                <Search value={query} onChange={setQuery} placeholder="Search name, role, team, email…" width={280} />
            </Toolbar>

            {people.length > 0 && (
                <StatBand items={[
                    { label: 'Left the company', value: stats.total },
                    { label: 'This year', value: stats.thisYear },
                    ...(stats.stillIn !== null
                        ? [{ label: 'Still have a login', value: stats.stillIn, tone: stats.stillIn ? 'down' : undefined }]
                        : []),
                ]} />
            )}

            {stats.stillIn ? (
                <div style={{
                    border: '1px solid ' + t.lineStrong, borderRadius: 10,
                    padding: '11px 13px', marginBottom: 12, fontSize: 12.5, color: t.dim, lineHeight: 1.7,
                }}>
                    {stats.stillIn} {stats.stillIn === 1 ? 'person' : 'people'} in this archive still hold a
                    membership and can sign in. Remove their access from Settings → Members.
                </div>
            ) : null}

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: byDept.length > 1 ? 'minmax(0,1fr) 258px' : '1fr', alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                    {list.length === 0 ? (
                        <Panel>
                            <Empty>
                                {people.length === 0
                                    ? 'Nobody has left yet. People arrive here once their employment is ended. Nothing is deleted, and Revert brings them back.'
                                    : 'Nobody matches that search.'}
                            </Empty>
                        </Panel>
                    ) : (
                        <Table cols={[
                            { key: 'n', label: 'Name' },
                            { key: 'i', label: 'Employee ID' },
                            { key: 'r', label: 'Role' },
                            { key: 'd', label: 'Department' },
                            { key: 't', label: 'Tenure' },
                            { key: 'l', label: 'Left' },
                            { key: 'a', label: 'Access' },
                            { key: 'x', label: '', align: 'right', width: canSetId ? 300 : 214 },
                        ]}>
                            {list.map((emp) => {
                                const name = getDisplayName(emp);
                                const a = access(emp);
                                return (
                                    <Tr key={emp.id} onClick={() => setSelected(emp)}>
                                        <Td>
                                            <Row gap={9}>
                                                <Avatar name={name} size={26} />
                                                <span style={{ minWidth: 0 }}>
                                                    <span style={{ display: 'block' }}>{name || '-'}</span>
                                                    <span style={{ display: 'block', fontSize: 11, color: t.faint, marginTop: 1 }}>{emp.email}</span>
                                                </span>
                                            </Row>
                                        </Td>
                                        <Td muted nowrap>{emp.employee_code || '-'}</Td>
                                        <Td muted nowrap>{emp.role || '-'}</Td>
                                        <Td nowrap>
                                            {emp.department ? (
                                                <Row gap={7}>
                                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: deptColor(emp.department), flexShrink: 0 }} />
                                                    <span style={{ color: t.dim, fontSize: 12.5 }}>{emp.department}</span>
                                                </Row>
                                            ) : <span style={{ color: t.ghost }}>-</span>}
                                        </Td>
                                        <Td muted nowrap>{tenure(emp)}</Td>
                                        <Td muted nowrap>{fmtDate(leftOn(emp))}</Td>
                                        <Td nowrap>{a ? <Status tone={a.tone}>{a.label}</Status> : <span style={{ color: t.ghost }}>-</span>}</Td>
                                        <Td align="right">
                                            <Row gap={6} style={{ justifyContent: 'flex-end' }}>
                                                <Btn size="sm" onClick={(e) => { e.stopPropagation(); setSelected(emp); }}>Open</Btn>
                                                {canSetId && (
                                                    <Btn size="sm" aria-label={`Change Employee ID of ${name || 'ex-employee'}`}
                                                        onClick={(e) => { e.stopPropagation(); openCode(emp); }}>Change ID</Btn>
                                                )}
                                                <Btn size="sm" onClick={(e) => { e.stopPropagation(); revert(emp); }}>Revert</Btn>
                                                <Btn size="sm" aria-label={`Delete ${name || 'ex-employee'}`}
                                                    onClick={(e) => { e.stopPropagation(); remove(emp); }}>Delete</Btn>
                                            </Row>
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </Table>
                    )}
                </div>

                {byDept.length > 1 && (
                    <Panel title="Where they left from" pad={13}>
                        <Breakdown rows={byDept} total={people.length} max={8} />
                    </Panel>
                )}
            </div>

            {/* The same sheet as a current employee's, read only, with Revert. */}
            {selected && (
                <Detail former emp={selected} orgId={activeOrg?.id} org={activeOrg}
                    currentUserEmail={user?.email}
                    canSeePay={hasSalary(selected) || ['owner', 'admin'].includes(orgStore.getRole())}
                    onClose={() => setSelected(null)}
                    onDelete={() => remove(selected, true)}
                    onRevert={() => revert(selected)} />
            )}

            {codeFor && (
                <Modal open compact onClose={() => setCodeFor(null)} width={480} title="Change Employee ID"
                    note={getDisplayName(codeFor)}
                    footer={(
                        <Row gap={8} style={{ justifyContent: 'flex-end' }}>
                            <Btn onClick={() => setCodeFor(null)}>Cancel</Btn>
                            <Btn primary onClick={saveCode} disabled={codeSaving}>{codeSaving ? 'Saving…' : 'Save'}</Btn>
                        </Row>
                    )}>
                    <Field label="Employee ID" hint={codeError ? undefined : 'Must be unique. Changes wherever their ID is shown.'}>
                        <Input value={code} autoFocus onChange={(e) => { setCode(e.target.value); setCodeError(''); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveCode(); }} />
                    </Field>
                    {codeError && <div style={{ fontSize: 12, color: t.down, marginTop: 8 }}>{codeError}</div>}
                </Modal>
            )}
        </Page>
    );
}

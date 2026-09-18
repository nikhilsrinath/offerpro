import { useState, useEffect, useMemo } from 'react';
import { useOrg } from '../context/OrgContext';
import { orgStore } from '../services/orgStore';
import { listMembers } from '../services/permissionService';
import { DEPT_PALETTE } from './TeamHierarchy';
import {
    Page, Toolbar, Panel, Row, Btn, Search, Table, Tr, Td, Avatar, Status,
    StatBand, Breakdown, Empty, Loading, Modal, Muted,
} from './ui/edge';
import { useT, fmtDate } from './ui/edgeUtils';

/* ══════════════════════════════════════════════════════════════════════════
   Ex-employees.

   An archive, so it reads like one: a table sorted by when each person left,
   with a tenure column that turns two dates into the number people actually
   want. The one live question — can they still sign in — is a status word on
   the row rather than a shield icon whose colour you have to interpret.
   ══════════════════════════════════════════════════════════════════════════ */

const TYPE_LABEL = {
    fulltime: 'Full-time', parttime: 'Part-time',
    internship: 'Intern', intern: 'Intern',
    contract: 'Contract', collaboration: 'Collaborator',
};

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
    if (!from || !to) return '—';
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
    const { activeOrg } = useOrg();
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
                    padding: '11px 13px', marginBottom: 14, fontSize: 11, color: t.dim, lineHeight: 1.7,
                }}>
                    {stats.stillIn} {stats.stillIn === 1 ? 'person' : 'people'} in this archive still hold a
                    membership and can sign in. Remove their access from Settings → Members.
                </div>
            ) : null}

            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: byDept.length > 1 ? 'minmax(0,1fr) 258px' : '1fr', alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                    {list.length === 0 ? (
                        <Panel>
                            <Empty>
                                {people.length === 0
                                    ? 'Nobody has left yet. People arrive here once a termination notice is acknowledged — nothing is deleted.'
                                    : 'Nobody matches that search.'}
                            </Empty>
                        </Panel>
                    ) : (
                        <Table cols={[
                            { key: 'n', label: 'Name' },
                            { key: 'r', label: 'Role' },
                            { key: 'd', label: 'Department' },
                            { key: 't', label: 'Tenure' },
                            { key: 'l', label: 'Left' },
                            { key: 'a', label: 'Access' },
                            { key: 'x', label: '', align: 'right', width: 74 },
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
                                                    <span style={{ display: 'block' }}>{name || '—'}</span>
                                                    <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 1 }}>{emp.email}</span>
                                                </span>
                                            </Row>
                                        </Td>
                                        <Td muted nowrap>{emp.role || '—'}</Td>
                                        <Td nowrap>
                                            {emp.department ? (
                                                <Row gap={7}>
                                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: deptColor(emp.department), flexShrink: 0 }} />
                                                    <span style={{ color: t.dim, fontSize: 11 }}>{emp.department}</span>
                                                </Row>
                                            ) : <span style={{ color: t.ghost }}>—</span>}
                                        </Td>
                                        <Td muted nowrap>{tenure(emp)}</Td>
                                        <Td muted nowrap>{fmtDate(leftOn(emp))}</Td>
                                        <Td nowrap>{a ? <Status tone={a.tone}>{a.label}</Status> : <span style={{ color: t.ghost }}>—</span>}</Td>
                                        <Td align="right"><Btn size="sm" onClick={() => setSelected(emp)}>Open</Btn></Td>
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

            {selected && (
                <Modal open onClose={() => setSelected(null)}
                    title={getDisplayName(selected) || 'Former employee'}
                    note={[selected.role, selected.department].filter(Boolean).join(' · ') || undefined}
                    footer={<Btn primary onClick={() => setSelected(null)}>Close</Btn>}>
                    <div style={{ border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden' }}>
                        {[
                            ['Email', selected.email],
                            ['Phone', selected.phone],
                            ['Employment', TYPE_LABEL[selected.offerType] || null],
                            ['Started', selected.startDate || selected.start_date ? fmtDate(selected.startDate || selected.start_date) : null],
                            ['Last day', leftOn(selected) ? fmtDate(leftOn(selected)) : null],
                            ['Tenure', tenure(selected)],
                            ['Reported to', selected.supervisorName],
                            ['Reason', selected.termination_reason || selected.exit_reason],
                        ].filter(([, v]) => v && v !== '—').map(([k, v], i) => (
                            <div key={k} style={{
                                display: 'flex', gap: 12, padding: '9px 13px',
                                borderTop: i ? '1px solid ' + t.lineSoft : 'none',
                            }}>
                                <span style={{ width: 98, flexShrink: 0, fontSize: 9, letterSpacing: '0.09em', color: t.faint, paddingTop: 2 }}>
                                    {k.toUpperCase()}
                                </span>
                                <span style={{ fontSize: 11.5, color: t.text, minWidth: 0, wordBreak: 'break-word' }}>{v}</span>
                            </div>
                        ))}
                    </div>
                    {access(selected)?.tone === 'down' && (
                        <p style={{ margin: '13px 0 0', fontSize: 10.5, color: t.down, lineHeight: 1.7 }}>
                            This person still holds a membership and can sign in. Remove it from Settings → Members.
                        </p>
                    )}
                </Modal>
            )}
        </Page>
    );
}

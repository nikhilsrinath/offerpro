import { useState, useEffect, useMemo } from 'react';
import { onValue, ref as dbRef } from 'firebase/database';
import { db } from '../lib/firebase';
import { storageService } from '../services/storageService';
import { useOrg } from '../context/OrgContext';
import { Search, Users, Calendar, Briefcase, Building, UserX, LayoutGrid, List } from 'lucide-react';
import { DEPT_PALETTE } from './TeamHierarchy';

const AVATAR_COLORS = [
    ['#3b82f6', '#2563eb'], ['#8b5cf6', '#7c3aed'], ['#10b981', '#059669'],
    ['#f59e0b', '#d97706'], ['#ec4899', '#db2777'], ['#14b8a6', '#0d9488'],
    ['#ef4444', '#dc2626'], ['#06b6d4', '#0891b2'],
];

function getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getDisplayName(emp) {
    if (emp.studentName) return emp.studentName;
    const first = (emp.first_name || '').trim();
    const last = (emp.last_name || '').trim();
    if (first || last) return `${first} ${last}`.trim();
    return emp.name || '';
}

function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return d; }
}

function ExEmpCard({ emp }) {
    const name = getDisplayName(emp);
    const [c1, c2] = getAvatarColor(name);
    return (
        <div style={{
            background: 'var(--surface)',
            border: '1px solid rgba(239,68,68,0.15)',
            borderRadius: '14px',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            position: 'relative',
            overflow: 'hidden',
        }}>
            {/* Red accent bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #ef4444, #f87171)' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                <div style={{
                    width: 44, height: 44, borderRadius: '12px', flexShrink: 0,
                    background: `linear-gradient(135deg, ${c1}, ${c2})`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.1rem', fontWeight: 800, color: '#fff',
                    filter: 'grayscale(0.3)',
                }}>
                    {name?.[0]?.toUpperCase() || '?'}
                </div>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                        {name || '—'}
                    </div>
                    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                        <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.5rem',
                            borderRadius: '20px', background: 'rgba(239,68,68,0.1)', color: '#f87171',
                            border: '1px solid rgba(239,68,68,0.2)',
                        }}>
                            Ex-Employee
                        </span>
                        {emp.offerType && (
                            <span style={{
                                fontSize: '0.65rem', fontWeight: 600, padding: '0.15rem 0.5rem',
                                borderRadius: '20px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)',
                            }}>
                                {emp.offerType === 'fulltime' ? 'Full-Time' : 'Intern'}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <InfoCell icon={<Briefcase size={11} />} label="Role" value={emp.role || '—'} />
                <InfoCell icon={<Building size={11} />} label="Dept" value={emp.department || '—'} />
            </div>

            {emp.email && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp.email}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                {emp.startDate && (
                    <InfoCell icon={<Calendar size={11} />} label="Joined" value={fmtDate(emp.startDate)} />
                )}
                <InfoCell
                    icon={<Calendar size={11} />}
                    label="Last Day"
                    value={fmtDate(emp.terminated_at || emp.termination_date)}
                    red
                />
            </div>

            {emp.archived_at && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.625rem' }}>
                    Archived {fmtDate(emp.archived_at)}
                </div>
            )}
        </div>
    );
}

function InfoCell({ icon, label, value, red }) {
    return (
        <div style={{ padding: '0.45rem 0.625rem', background: red ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.03)', borderRadius: '7px', border: `1px solid ${red ? 'rgba(239,68,68,0.15)' : 'var(--border-subtle)'}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '0.15rem' }}>
                <span style={{ color: red ? '#f87171' : 'var(--text-muted)' }}>{icon}</span>
                <span style={{ fontSize: '0.6rem', color: red ? '#f87171' : 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: red ? '#fca5a5' : 'var(--text-primary)', fontWeight: 500 }}>{value}</div>
        </div>
    );
}

function ExEmpRowCells({ emp }) {
    const name = getDisplayName(emp);
    const [c1, c2] = getAvatarColor(name);
    return (
        <>
            <td style={{ padding: '0.875rem 1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <div style={{
                        width: 34, height: 34, borderRadius: '9px', flexShrink: 0,
                        background: `linear-gradient(135deg, ${c1}, ${c2})`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.875rem', fontWeight: 800, color: '#fff', filter: 'grayscale(0.3)',
                    }}>
                        {name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>{name || '—'}</div>
                        {emp.email && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>{emp.email}</div>}
                    </div>
                </div>
            </td>
            <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <div>{emp.role || '—'}</div>
                {emp.department && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{emp.department}</div>}
            </td>
            <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {emp.offerType === 'fulltime' ? 'Full-Time' : emp.offerType === 'internship' ? 'Intern' : '—'}
            </td>
            <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {fmtDate(emp.startDate)}
            </td>
            <td style={{ padding: '0.875rem 1rem', fontSize: '0.8rem', fontWeight: 600, color: '#f87171', whiteSpace: 'nowrap' }}>
                {fmtDate(emp.terminated_at || emp.termination_date)}
            </td>
            <td style={{ padding: '0.875rem 1rem', fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {fmtDate(emp.archived_at)}
            </td>
        </>
    );
}

export default function ExEmployees() {
    const { activeOrg } = useOrg();
    const [exEmployees, setExEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('grid');

    useEffect(() => {
        if (!activeOrg?.id) return;
        const path = `ex_employees/${activeOrg.id}`;
        const unsubscribe = onValue(
            dbRef(db, path),
            (snap) => {
                if (snap.exists()) {
                    const list = Object.values(snap.val());
                    list.sort((a, b) => new Date(b.terminated_at || b.archived_at || 0) - new Date(a.terminated_at || a.archived_at || 0));
                    setExEmployees(list);
                } else {
                    setExEmployees([]);
                }
                setLoading(false);
            },
            (err) => {
                console.error('[ExEmployees] Firebase error:', err);
                storageService.getExEmployees(activeOrg.id).then(list => {
                    setExEmployees(list);
                    setLoading(false);
                });
            }
        );
        return () => unsubscribe();
    }, [activeOrg?.id]);

    const filtered = useMemo(() => {
        if (!searchTerm) return exEmployees;
        const t = searchTerm.toLowerCase();
        return exEmployees.filter(emp =>
            getDisplayName(emp).toLowerCase().includes(t) ||
            (emp.email || '').toLowerCase().includes(t) ||
            (emp.role || '').toLowerCase().includes(t) ||
            (emp.department || '').toLowerCase().includes(t)
        );
    }, [exEmployees, searchTerm]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8rem 2rem' }}>
                <div style={{ textAlign: 'center' }}>
                    <div className="pro-spinner" />
                    <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', fontSize: '0.875rem' }}>Loading ex-employees…</p>
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.375rem' }}>
                        <div style={{ width: 36, height: 36, borderRadius: '10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <UserX size={18} style={{ color: '#f87171' }} />
                        </div>
                        <h2 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>Ex-Employees</h2>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Archive of employees who have left the organization · {exEmployees.length} record{exEmployees.length !== 1 ? 's' : ''}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                        onClick={() => setViewMode('grid')}
                        style={{
                            padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-default)',
                            background: viewMode === 'grid' ? 'var(--surface)' : 'none',
                            color: viewMode === 'grid' ? 'var(--text-primary)' : 'var(--text-muted)',
                            cursor: 'pointer',
                        }}
                    >
                        <LayoutGrid size={15} />
                    </button>
                    <button
                        onClick={() => setViewMode('list')}
                        style={{
                            padding: '0.5rem', borderRadius: '8px', border: '1px solid var(--border-default)',
                            background: viewMode === 'list' ? 'var(--surface)' : 'none',
                            color: viewMode === 'list' ? 'var(--text-primary)' : 'var(--text-muted)',
                            cursor: 'pointer',
                        }}
                    >
                        <List size={15} />
                    </button>
                </div>
            </div>

            {/* Search */}
            <div style={{ position: 'relative', maxWidth: 360, marginBottom: '1.5rem' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
                <input
                    type="text"
                    placeholder="Search by name, role, department…"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    style={{
                        width: '100%', boxSizing: 'border-box',
                        paddingLeft: '2rem', height: '36px',
                        borderRadius: '0.5rem',
                        border: '1px solid var(--border-default)',
                        background: 'var(--background)',
                        color: 'var(--text-primary)',
                        fontSize: '0.8125rem', outline: 'none',
                    }}
                />
            </div>

            {exEmployees.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '5rem 2rem', background: 'var(--surface)', borderRadius: '1rem', border: '2px dashed rgba(239,68,68,0.2)' }}>
                    <UserX size={44} style={{ color: '#ef4444', opacity: 0.25, marginBottom: '1rem' }} />
                    <p style={{ color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 0.5rem' }}>No ex-employees yet</p>
                    <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.8125rem' }}>
                        Employees are automatically archived here after their last working day at 6 PM.
                    </p>
                </div>
            ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    No results for "{searchTerm}"
                </div>
            ) : viewMode === 'grid' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                    {filtered.map(emp => <ExEmpCard key={emp.id} emp={emp} />)}
                </div>
            ) : (
                <div style={{ background: 'var(--surface)', borderRadius: '1rem', border: '1px solid rgba(239,68,68,0.15)', overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: 'var(--background)', borderBottom: '1px solid var(--border-default)' }}>
                                    {['Employee', 'Role', 'Type', 'Joined', 'Last Day', 'Archived'].map(h => (
                                        <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((emp, i) => (
                                    <tr key={emp.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--border-default)' : 'none' }}>
                                        <ExEmpRowCells emp={emp} />
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

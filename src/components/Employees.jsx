import { useState, useEffect, useMemo } from 'react';
import {
    Search, UserPlus, Trash2, Mail, Phone, Calendar,
    Briefcase, LayoutGrid, List, Users, Building,
    Plus, X, ArrowLeft, Copy, Check, Loader,
    AlertTriangle, TrendingUp, ExternalLink, Shield,
} from 'lucide-react';
import { ref, get, update } from 'firebase/database';
import { db } from '../lib/firebase';
import { storageService } from '../services/storageService';
import { documentStore } from '../services/documentStore';
import { DEPT_PALETTE } from './TeamHierarchy';
import { useOrg } from '../context/OrgContext';
import EmployeeForm from './EmployeeForm';

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
    return '';
}

// ── Employee Detail Modal ────────────────────────────────────────────────────
function EmployeeDetailModal({ emp, orgId, org, departments, onClose, onDelete }) {
    const name = getDisplayName(emp);
    const [c1, c2] = getAvatarColor(name);
    const [view, setView] = useState('detail'); // 'detail' | 'role_change' | 'termination'
    const [portalLink, setPortalLink] = useState(null);
    const [creating, setCreating] = useState(false);
    const [copied, setCopied] = useState(false);

    const [rcForm, setRcForm] = useState({
        newRole: emp.role || '',
        newDepartment: emp.department || '',
        newSalary: '',
        salaryFrequency: 'month',
        effectiveDate: '',
        message: '',
    });
    const [termForm, setTermForm] = useState({
        lastDay: '',
        message: '',
    });

    const handleCopy = async (text) => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const createPortalDoc = async (type) => {
        setCreating(true);
        documentStore.setContext(orgId);
        await documentStore.init();

        const companyProfile = {
            company_name: org?.company_name || '',
            logo_url: org?.logo_url || '',
            company_email: org?.company_email || '',
            company_phone: org?.company_phone || '',
            address: org?.company_address || '',
        };

        let doc;
        if (type === 'role_change') {
            const id = documentStore.nextId('RC');
            doc = {
                id,
                type: 'role_change',
                status: 'sent',
                title: `Role Change – ${name}`,
                issued_to: name,
                recipient_email: emp.email || '',
                recipient_phone: emp.phone || '',
                current_role: emp.role || '',
                new_role: rcForm.newRole,
                current_department: emp.department || '',
                new_department: rcForm.newDepartment || emp.department || '',
                effective_date: rcForm.effectiveDate,
                new_salary: rcForm.newSalary ? Number(rcForm.newSalary) : null,
                salary_frequency: rcForm.salaryFrequency,
                message: rcForm.message,
                employee_id: emp.id,
                issue_date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
                company_profile: companyProfile,
                created_at: new Date().toISOString(),
            };
        } else {
            const id = documentStore.nextId('TRM');
            doc = {
                id,
                type: 'termination',
                status: 'sent',
                title: `Termination Notice – ${name}`,
                issued_to: name,
                recipient_email: emp.email || '',
                recipient_phone: emp.phone || '',
                current_role: emp.role || '',
                current_department: emp.department || '',
                last_day: termForm.lastDay,
                message: termForm.message,
                employee_id: emp.id,
                issue_date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
                company_profile: companyProfile,
                created_at: new Date().toISOString(),
            };
        }

        documentStore.save(doc);
        const link = `${window.location.origin}/portal/${doc.id}?org=${orgId}`;
        setPortalLink(link);
        setCreating(false);
    };

    const resetAction = () => {
        setView('detail');
        setPortalLink(null);
        setCopied(false);
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '1rem',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: '20px',
                    width: '100%', maxWidth: 500,
                    boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
                    overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    maxHeight: '90vh',
                }}
            >
                {/* ── Detail View ── */}
                {view === 'detail' && (
                    <>
                        {/* Header */}
                        <div style={{ padding: '1.5rem 1.5rem 1.25rem', borderBottom: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                    <div style={{
                                        width: 56, height: 56, borderRadius: '16px', flexShrink: 0,
                                        background: `linear-gradient(135deg, ${c1}, ${c2})`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '1.25rem', fontWeight: 800, color: '#fff',
                                    }}>
                                        {name?.[0]?.toUpperCase()}
                                    </div>
                                    <div>
                                        <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{name}</h2>
                                        <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                                            <span className={`emp-type-badge ${emp.offerType === 'fulltime' ? 'fulltime' : 'intern'}`}>
                                                {emp.offerType === 'fulltime' ? 'Full-Time' : 'Intern'}
                                            </span>
                                            {emp.department && (
                                                <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: '99px', background: 'rgba(255,255,255,0.07)', color: 'var(--text-muted)' }}>
                                                    {emp.department}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, borderRadius: 8, flexShrink: 0 }}>
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Body */}
                        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
                            {/* Role & Department */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                                <InfoField icon={<Briefcase size={13} />} label="Role" value={emp.role || '—'} />
                                <InfoField icon={<Building size={13} />} label="Department" value={emp.department || '—'} />
                            </div>

                            {/* Contact */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                                <InfoField icon={<Mail size={13} />} label="Email" value={emp.email || '—'} />
                                <InfoField icon={<Phone size={13} />} label="Phone" value={emp.phone || '—'} />
                            </div>

                            {/* Dates */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                                <InfoField
                                    icon={<Calendar size={13} />}
                                    label="Start Date"
                                    value={emp.startDate ? new Date(emp.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                />
                                {emp.endDate && (
                                    <InfoField
                                        icon={<Calendar size={13} />}
                                        label="End Date"
                                        value={new Date(emp.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    />
                                )}
                            </div>

                            {/* Supervisor */}
                            {emp.supervisorName && (
                                <div style={{ marginBottom: '1rem' }}>
                                    <InfoField icon={<Users size={13} />} label="Reports To" value={emp.supervisorName} />
                                </div>
                            )}

                            {/* Employee ID */}
                            <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                                <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Employee ID</span>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem', fontFamily: 'monospace' }}>{emp.id}</div>
                            </div>
                        </div>

                        {/* Footer Actions */}
                        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '0.625rem' }}>
                            <button
                                onClick={() => { setView('role_change'); setPortalLink(null); }}
                                style={{
                                    flex: 1, padding: '0.6rem 0.75rem', borderRadius: '10px',
                                    background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                                    color: '#818cf8', fontSize: '0.78rem', fontWeight: 700,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.18)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; }}
                            >
                                <TrendingUp size={14} /> Role Change
                            </button>
                            <button
                                onClick={() => { setView('termination'); setPortalLink(null); }}
                                style={{
                                    flex: 1, padding: '0.6rem 0.75rem', borderRadius: '10px',
                                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                                    color: '#f87171', fontSize: '0.78rem', fontWeight: 700,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                            >
                                <AlertTriangle size={14} /> Terminate
                            </button>
                            <button
                                onClick={() => onDelete(emp.id)}
                                style={{
                                    padding: '0.6rem 0.75rem', borderRadius: '10px',
                                    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-default)',
                                    color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem',
                                    transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'; }}
                                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-default)'; }}
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </>
                )}

                {/* ── Role Change View ── */}
                {view === 'role_change' && (
                    <>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <button onClick={resetAction} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', borderRadius: 8 }}>
                                <ArrowLeft size={16} />
                            </button>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>Role Change</h3>
                                <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>Send a notice to {name}</p>
                            </div>
                        </div>

                        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
                            {/* Current role callout */}
                            <div style={{ padding: '0.6rem 0.875rem', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', border: '1px solid var(--border-subtle)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div>
                                    <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current Role</div>
                                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem' }}>{emp.role || '—'}</div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                <FormField label="New Role *" value={rcForm.newRole} onChange={v => setRcForm(p => ({ ...p, newRole: v }))} placeholder="e.g. Senior Engineer" />
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>New Department</label>
                                    <select
                                        value={rcForm.newDepartment}
                                        onChange={e => setRcForm(p => ({ ...p, newDepartment: e.target.value }))}
                                        style={{
                                            width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-default)',
                                            borderRadius: '8px', padding: '0.55rem 0.75rem', color: 'var(--text-primary)',
                                            fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box', cursor: 'pointer',
                                        }}
                                    >
                                        <option value="" style={{ background: 'var(--bg-elevated)' }}>Same as current ({emp.department || 'None'})</option>
                                        {departments.map(d => (
                                            <option key={d.name} value={d.name} style={{ background: 'var(--bg-elevated)' }}>{d.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem', alignItems: 'end' }}>
                                    <FormField label="New Salary (optional)" type="number" value={rcForm.newSalary} onChange={v => setRcForm(p => ({ ...p, newSalary: v }))} placeholder="e.g. 75000" />
                                    <div>
                                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Per</label>
                                        <select
                                            value={rcForm.salaryFrequency}
                                            onChange={e => setRcForm(p => ({ ...p, salaryFrequency: e.target.value }))}
                                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-default)', borderRadius: '8px', padding: '0.55rem 0.5rem', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none', cursor: 'pointer' }}
                                        >
                                            <option value="month" style={{ background: 'var(--bg-elevated)' }}>Month</option>
                                            <option value="year" style={{ background: 'var(--bg-elevated)' }}>Year</option>
                                        </select>
                                    </div>
                                </div>
                                <FormField label="Effective Date *" type="date" value={rcForm.effectiveDate} onChange={v => setRcForm(p => ({ ...p, effectiveDate: v }))} />
                                <FormField label="Message to Employee" type="textarea" value={rcForm.message} onChange={v => setRcForm(p => ({ ...p, message: v }))} placeholder="Include any relevant details about this role change…" rows={3} />
                            </div>

                            {portalLink && (
                                <PortalLinkBox link={portalLink} copied={copied} onCopy={handleCopy} />
                            )}
                        </div>

                        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                            {!portalLink ? (
                                <button
                                    onClick={() => createPortalDoc('role_change')}
                                    disabled={creating || !rcForm.newRole || !rcForm.effectiveDate}
                                    style={{
                                        width: '100%', padding: '0.7rem', borderRadius: '10px',
                                        background: (!rcForm.newRole || !rcForm.effectiveDate) ? 'rgba(99,102,241,0.3)' : '#6366f1',
                                        border: 'none', color: '#fff', fontSize: '0.82rem', fontWeight: 700,
                                        cursor: (!rcForm.newRole || !rcForm.effectiveDate || creating) ? 'not-allowed' : 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                        opacity: (!rcForm.newRole || !rcForm.effectiveDate) ? 0.6 : 1,
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    {creating ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ExternalLink size={14} />}
                                    {creating ? 'Creating Portal…' : 'Generate Portal Link'}
                                </button>
                            ) : (
                                <button onClick={resetAction} style={{ width: '100%', padding: '0.7rem', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
                                    Back to Profile
                                </button>
                            )}
                        </div>
                    </>
                )}

                {/* ── Termination View ── */}
                {view === 'termination' && (
                    <>
                        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <button onClick={resetAction} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', borderRadius: 8 }}>
                                <ArrowLeft size={16} />
                            </button>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#f87171' }}>Termination Notice</h3>
                                <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>Issue a notice to {name}</p>
                            </div>
                        </div>

                        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
                            {/* Warning banner */}
                            <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', borderRadius: '10px', border: '1px solid rgba(239,68,68,0.2)', marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
                                <AlertTriangle size={15} style={{ color: '#f87171', marginTop: '0.1rem', flexShrink: 0 }} />
                                <div>
                                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f87171' }}>This action generates a termination notice</div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.5 }}>
                                        The employee will receive a portal link to acknowledge their termination. This cannot be declined.
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                                <FormField label="Last Working Day *" type="date" value={termForm.lastDay} onChange={v => setTermForm(p => ({ ...p, lastDay: v }))} />
                                <FormField label="Message / Reason" type="textarea" value={termForm.message} onChange={v => setTermForm(p => ({ ...p, message: v }))} placeholder="Include any relevant context or next steps…" rows={4} />
                            </div>

                            {portalLink && (
                                <PortalLinkBox link={portalLink} copied={copied} onCopy={handleCopy} accent="red" />
                            )}
                        </div>

                        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                            {!portalLink ? (
                                <button
                                    onClick={() => createPortalDoc('termination')}
                                    disabled={creating || !termForm.lastDay}
                                    style={{
                                        width: '100%', padding: '0.7rem', borderRadius: '10px',
                                        background: !termForm.lastDay ? 'rgba(239,68,68,0.3)' : '#ef4444',
                                        border: 'none', color: '#fff', fontSize: '0.82rem', fontWeight: 700,
                                        cursor: (!termForm.lastDay || creating) ? 'not-allowed' : 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                        opacity: !termForm.lastDay ? 0.6 : 1,
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    {creating ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Shield size={14} />}
                                    {creating ? 'Creating Notice…' : 'Generate Termination Link'}
                                </button>
                            ) : (
                                <button onClick={resetAction} style={{ width: '100%', padding: '0.7rem', borderRadius: '10px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
                                    Back to Profile
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function InfoField({ icon, label, value }) {
    return (
        <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.25rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
                <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 500, wordBreak: 'break-word' }}>{value}</div>
        </div>
    );
}

function FormField({ label, value, onChange, placeholder, type = 'text', rows }) {
    return (
        <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</label>
            {type === 'textarea' ? (
                <textarea
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    rows={rows || 3}
                    style={{
                        width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-default)',
                        borderRadius: '8px', padding: '0.55rem 0.75rem', color: 'var(--text-primary)',
                        fontSize: '0.82rem', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                        fontFamily: 'inherit', lineHeight: 1.55,
                    }}
                />
            ) : (
                <input
                    type={type}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder}
                    style={{
                        width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-default)',
                        borderRadius: '8px', padding: '0.55rem 0.75rem', color: 'var(--text-primary)',
                        fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box',
                    }}
                />
            )}
        </div>
    );
}

function PortalLinkBox({ link, copied, onCopy, accent }) {
    const accentColor = accent === 'red' ? '#f87171' : '#818cf8';
    return (
        <div style={{ marginTop: '1.25rem', padding: '1rem', background: accent === 'red' ? 'rgba(239,68,68,0.06)' : 'rgba(99,102,241,0.08)', borderRadius: '12px', border: `1px solid ${accent === 'red' ? 'rgba(239,68,68,0.2)' : 'rgba(99,102,241,0.25)'}` }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.625rem' }}>
                Portal Link Generated
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ flex: 1, background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.72rem', color: 'var(--text-secondary)', wordBreak: 'break-all', border: '1px solid rgba(255,255,255,0.06)' }}>
                    {link}
                </div>
                <button
                    onClick={() => onCopy(link)}
                    style={{
                        flexShrink: 0, padding: '0.5rem 0.75rem', borderRadius: '8px',
                        background: copied ? 'rgba(16,185,129,0.15)' : `${accentColor}18`,
                        border: `1px solid ${copied ? 'rgba(16,185,129,0.3)' : `${accentColor}33`}`,
                        color: copied ? '#10b981' : accentColor,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
                        fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
                        transition: 'all 0.15s',
                    }}
                >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <p style={{ margin: '0.625rem 0 0', fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Share this link with the employee. They can open it on any device to acknowledge the notice.
            </p>
        </div>
    );
}

// ── Main Employees Component ─────────────────────────────────────────────────
export default function Employees() {
    const { activeOrg } = useOrg();
    const [employees, setEmployees] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState('name_asc');
    const [viewMode, setViewMode] = useState('list');
    const [filter, setFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [showDeptManager, setShowDeptManager] = useState(false);
    const [newDeptName, setNewDeptName] = useState('');
    const [newDeptColor, setNewDeptColor] = useState(DEPT_PALETTE[0]);
    const [deptSaving, setDeptSaving] = useState(false);
    const [selectedEmp, setSelectedEmp] = useState(null);

    useEffect(() => {
        if (activeOrg) { loadEmployees(); loadDepartments(); }
    }, [activeOrg]);

    const loadDepartments = async () => {
        const depts = await storageService.getDepartments(activeOrg?.id);
        setDepartments(depts);
    };

    const handleAddDept = async () => {
        if (!newDeptName.trim()) return;
        setDeptSaving(true);
        await storageService.saveDepartment({ name: newDeptName.trim(), color: newDeptColor }, activeOrg?.id);
        setNewDeptName('');
        setNewDeptColor(DEPT_PALETTE[0]);
        setDeptSaving(false);
        loadDepartments();
    };

    const handleDeleteDept = async (id) => {
        await storageService.deleteDepartment(id, activeOrg?.id);
        loadDepartments();
    };

    const loadEmployees = async () => {
        setLoading(true);
        const orgId = activeOrg?.id;

        const [existingEmps, allRecords] = await Promise.all([
            storageService.getEmployees(orgId),
            storageService.getAll(orgId, 'offer'),
        ]);

        let changed = false;

        // 1. Remove duplicates — keep only the newest employee per email
        const seenEmails = new Map();
        for (const emp of existingEmps) {
            const key = (emp.email || '').toLowerCase();
            if (!key) continue;
            if (seenEmails.has(key)) {
                const prev = seenEmails.get(key);
                const prevDate = new Date(prev.created_at || 0);
                const curDate = new Date(emp.created_at || 0);
                if (curDate > prevDate) {
                    await storageService.deleteEmployee(prev.id, orgId);
                    seenEmails.set(key, emp);
                } else {
                    await storageService.deleteEmployee(emp.id, orgId);
                }
                changed = true;
            } else {
                seenEmails.set(key, emp);
            }
        }

        // 2. Sync from offer records
        for (const r of allRecords) {
            const email = (r.data?.email || '').toLowerCase();
            if (r.data?.studentName && email && !seenEmails.has(email) && !r.employee_synced) {
                await storageService.saveEmployee(r.data, orgId);
                await update(ref(db, `records/${orgId}/${r.id}`), { employee_synced: true });
                seenEmails.set(email, true);
                changed = true;
            }
        }

        // 3. Sync from OfferTracker accepted offer letters
        try {
            const finSnap = await get(ref(db, `records/${orgId}/_fin_docs`));
            if (finSnap.exists()) {
                for (const doc of Object.values(finSnap.val())) {
                    if (doc.type !== 'offer_letter' || doc.status !== 'signed' || doc.employee_synced) continue;
                    const email = (doc.recipient_email || '').toLowerCase();
                    if (!doc.issued_to || !email || seenEmails.has(email)) continue;
                    const empData = {
                        studentName: doc.issued_to,
                        email: doc.recipient_email || '',
                        phone: doc.recipient_phone || '',
                        role: doc.role || '',
                        department: doc.department || '',
                        offerType: doc.offer_type || 'internship',
                        startDate: doc.start_date || '',
                        endDate: doc.end_date || '',
                        offer_doc_id: doc.id,
                        signed_at: doc.signed_at || '',
                    };
                    await storageService.saveEmployee(empData, orgId);
                    await update(ref(db, `records/${orgId}/_fin_docs/${doc.id}`), { employee_synced: true });
                    seenEmails.set(email, empData);
                    changed = true;
                }
            }
        } catch (err) {
            console.warn('[Employees] Failed to sync from OfferTracker docs:', err.message);
        }

        let freshData = changed
            ? await storageService.getEmployees(orgId)
            : existingEmps;

        // 4. Auto-archive terminated employees whose last working day has passed 6 PM
        const now = new Date();
        const toArchive = freshData.filter(emp => {
            if (emp.status !== 'terminated' || !emp.termination_date) return false;
            const cutoff = new Date(emp.termination_date);
            cutoff.setHours(18, 0, 0, 0);
            return now >= cutoff;
        });

        if (toArchive.length > 0) {
            await Promise.all(toArchive.map(async (emp) => {
                await storageService.saveExEmployee({
                    ...emp,
                    terminated_at: emp.termination_date,
                    archived_at: now.toISOString(),
                }, orgId);
                await storageService.deleteEmployee(emp.id, orgId);
            }));
            freshData = freshData.filter(emp => !toArchive.some(a => a.id === emp.id));
            changed = true;
        }

        setEmployees(freshData);
        setLoading(false);
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this employee record? This will not delete their issued documents.')) {
            try {
                await storageService.deleteEmployee(id, activeOrg?.id);
                setSelectedEmp(null);
                loadEmployees();
            } catch (err) {
                alert("Error deleting employee: " + err.message);
            }
        }
    };

    const filteredEmployees = useMemo(() => {
        let list = employees;
        if (filter === 'fulltime') list = list.filter(e => e.offerType === 'fulltime');
        if (filter === 'intern') list = list.filter(e => e.offerType === 'internship');
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            list = list.filter(emp =>
                getDisplayName(emp).toLowerCase().includes(term) ||
                emp.role?.toLowerCase().includes(term) ||
                emp.department?.toLowerCase().includes(term) ||
                emp.email?.toLowerCase().includes(term)
            );
        }
        return [...list].sort((a, b) => {
            if (sortBy === 'name_asc')  return getDisplayName(a).localeCompare(getDisplayName(b));
            if (sortBy === 'name_desc') return getDisplayName(b).localeCompare(getDisplayName(a));
            if (sortBy === 'role')      return (a.role || '').localeCompare(b.role || '');
            if (sortBy === 'dept')      return (a.department || '').localeCompare(b.department || '');
            if (sortBy === 'date_desc') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            if (sortBy === 'date_asc')  return new Date(a.created_at || 0) - new Date(b.created_at || 0);
            return 0;
        });
    }, [employees, searchTerm, sortBy, filter]);

    const displayDepts = useMemo(() => {
        const fromEmps = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();
        const fromFb   = departments.map(d => d.name).filter(n => !fromEmps.includes(n)).sort();
        return [...fromEmps, ...fromFb].map(name => {
            const fb = departments.find(d => d.name === name);
            return { name, color: fb?.color || DEPT_PALETTE[Math.abs([...name].reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0)) % DEPT_PALETTE.length] };
        });
    }, [employees, departments]);

    const counts = useMemo(() => ({
        all: employees.length,
        fulltime: employees.filter(e => e.offerType === 'fulltime').length,
        intern: employees.filter(e => e.offerType === 'internship').length,
        departments: displayDepts.length,
    }), [employees, displayDepts]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '8rem 2rem' }}>
                <div style={{ textAlign: 'center' }}>
                    <div className="pro-spinner" />
                    <p style={{ color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>Loading employees...</p>
                </div>
            </div>
        );
    }

    if (showAddForm) {
        return <EmployeeForm onBack={() => setShowAddForm(false)} onSuccess={() => {
            setShowAddForm(false);
            loadEmployees();
        }} />;
    }

    return (
        <div className="emp-page">
            {/* Summary Stats */}
            {employees.length > 0 && (
                <div className="emp-summary-row">
                    {[
                        { label: 'Total Members', value: counts.all, color: '#3b82f6', icon: Users },
                        { label: 'Full-Time', value: counts.fulltime, color: '#10b981', icon: Briefcase },
                        { label: 'Interns', value: counts.intern, color: '#a1a1aa', icon: Calendar },
                        { label: 'Departments', value: counts.departments, color: '#8b5cf6', icon: Building },
                    ].map((s, i) => {
                        const Icon = s.icon;
                        return (
                            <div key={i} className="emp-summary-chip">
                                <div className="emp-summary-icon" style={{ background: `${s.color}12`, color: s.color }}>
                                    <Icon size={16} />
                                </div>
                                <div className="emp-summary-text">
                                    <span className="emp-summary-value">{s.value}</span>
                                    <span className="emp-summary-label">{s.label}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Toolbar */}
            <div className="emp-toolbar">
                <div className="emp-toolbar-left">
                    <div className="emp-search-wrap">
                        <Search size={15} className="emp-search-icon" />
                        <input
                            type="text"
                            placeholder="Search employees..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="emp-search-input"
                        />
                    </div>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        style={{
                            height: '36px', padding: '0 0.625rem',
                            borderRadius: '0.5rem',
                            border: '1px solid var(--border-default)',
                            background: 'var(--background)',
                            color: 'var(--text-secondary)',
                            fontSize: '0.8rem', cursor: 'pointer', outline: 'none', flexShrink: 0,
                        }}
                    >
                        <option value="name_asc">Name A–Z</option>
                        <option value="name_desc">Name Z–A</option>
                        <option value="role">By role</option>
                        <option value="dept">By department</option>
                        <option value="date_desc">Newest first</option>
                        <option value="date_asc">Oldest first</option>
                    </select>
                    <div className="emp-filter-tabs">
                        {[
                            { id: 'all', label: 'All' },
                            { id: 'fulltime', label: 'Full-Time' },
                            { id: 'intern', label: 'Interns' },
                        ].map(f => (
                            <button key={f.id}
                                className={`emp-filter-tab ${filter === f.id ? 'active' : ''}`}
                                onClick={() => { setFilter(f.id); setShowDeptManager(false); }}
                            >
                                {f.label}
                                <span className="emp-filter-count">{counts[f.id]}</span>
                            </button>
                        ))}
                        <button
                            className={`emp-filter-tab ${showDeptManager ? 'active' : ''}`}
                            onClick={() => setShowDeptManager(p => !p)}
                        >
                            <Building size={13} />
                            Departments
                            <span className="emp-filter-count">{displayDepts.length}</span>
                        </button>
                    </div>
                </div>
                <div className="emp-toolbar-right">
                    <div className="records-view-toggle">
                        <button className={`records-view-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>
                            <LayoutGrid size={18} />
                        </button>
                        <button className={`records-view-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>
                            <List size={18} />
                        </button>
                    </div>
                    <button className="btn-cinematic" onClick={() => setShowAddForm(true)}>
                        <UserPlus size={16} />
                        <span>Add Employee</span>
                    </button>
                </div>
            </div>

            {/* Department Manager */}
            {showDeptManager && (
                <div style={{ margin: '0 0 1.5rem', background: 'var(--bg-elevated)', borderRadius: '14px', border: '1px solid var(--border-default)', padding: '1.25rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>Manage Departments</h3>
                        <button onClick={() => setShowDeptManager(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
                            <X size={16} />
                        </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                        {displayDepts.length === 0 && (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No departments found in employee data yet.</span>
                        )}
                        {displayDepts.map(d => {
                            const fbEntry = departments.find(fd => fd.name === d.name);
                            return (
                                <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: `${d.color}14`, borderRadius: '99px', padding: '0.3rem 0.75rem 0.3rem 0.5rem' }}>
                                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{d.name}</span>
                                    {fbEntry && (
                                        <button onClick={() => handleDeleteDept(fbEntry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 0 0 2px', lineHeight: 1, opacity: 0.5 }}
                                            onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                                            onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}>
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 180 }}>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Department Name</label>
                            <input
                                value={newDeptName} onChange={e => setNewDeptName(e.target.value)}
                                placeholder="e.g. Engineering"
                                onKeyDown={e => e.key === 'Enter' && handleAddDept()}
                                className="easy-inp"
                                style={{ margin: 0 }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Colour</label>
                            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', maxWidth: 220 }}>
                                {DEPT_PALETTE.map(c => (
                                    <div key={c} onClick={() => setNewDeptColor(c)} style={{
                                        width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                                        boxShadow: newDeptColor === c ? `0 0 0 2px var(--background), 0 0 0 4px ${c}` : 'none',
                                        transition: 'box-shadow 0.12s',
                                    }} />
                                ))}
                            </div>
                        </div>
                        <button
                            onClick={handleAddDept} disabled={deptSaving || !newDeptName.trim()}
                            className="btn-cinematic"
                            style={{ background: newDeptColor, borderColor: newDeptColor, opacity: (!newDeptName.trim() || deptSaving) ? 0.5 : 1, flexShrink: 0 }}
                        >
                            <Plus size={15} /> Add Department
                        </button>
                    </div>
                </div>
            )}

            {/* Content */}
            {employees.length === 0 ? (
                <div className="emp-empty-state">
                    <div className="emp-empty-icon">
                        <Users size={48} strokeWidth={1} />
                    </div>
                    <h3>Build Your Team</h3>
                    <p>Add your first employee to get started. Each onboarding automatically generates a professional offer letter.</p>
                    <button className="btn-cinematic" onClick={() => setShowAddForm(true)} style={{ marginTop: '0.5rem' }}>
                        <UserPlus size={16} /> Add First Employee
                    </button>
                </div>
            ) : filteredEmployees.length === 0 ? (
                <div className="emp-empty-state" style={{ padding: '4rem 2rem' }}>
                    <Search size={36} strokeWidth={1} style={{ opacity: 0.25, marginBottom: '0.75rem' }} />
                    <h3>No matches found</h3>
                    <p>Try adjusting your search or filter.</p>
                </div>
            ) : viewMode === 'list' ? (
                /* List View */
                <div className="emp-table-card">
                    <table className="emp-table">
                        <thead>
                            <tr>
                                <th>Employee</th>
                                <th>Role</th>
                                <th>Contact</th>
                                <th>Type</th>
                                <th>Joined</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredEmployees.map((emp) => {
                                const name = getDisplayName(emp);
                                const [c1, c2] = getAvatarColor(name);
                                return (
                                    <tr
                                        key={emp.id}
                                        onClick={() => setSelectedEmp(emp)}
                                        style={{ cursor: 'pointer' }}
                                        className="emp-table-row-clickable"
                                    >
                                        <td>
                                            <div className="emp-table-name">
                                                <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                                                    {name?.[0]?.toUpperCase()}
                                                </div>
                                                <span>{name}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div className="emp-table-role">{emp.role}</div>
                                            <div className="emp-table-dept">{emp.department}</div>
                                        </td>
                                        <td>
                                            <div className="emp-table-contact">
                                                <Mail size={12} /> {emp.email}
                                            </div>
                                            {emp.phone && (
                                                <div className="emp-table-contact">
                                                    <Phone size={12} /> {emp.phone}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`emp-type-badge ${emp.offerType === 'fulltime' ? 'fulltime' : 'intern'}`}>
                                                {emp.offerType === 'fulltime' ? 'Full-Time' : 'Intern'}
                                            </span>
                                        </td>
                                        <td>
                                            <span className="emp-table-date">
                                                {emp.startDate ? new Date(emp.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            ) : (
                /* Grid View */
                <div className="emp-grid">
                    {filteredEmployees.map((emp) => {
                        const name = getDisplayName(emp);
                        const [c1, c2] = getAvatarColor(name);
                        return (
                            <div
                                key={emp.id}
                                className="emp-grid-card emp-grid-card-clickable"
                                onClick={() => setSelectedEmp(emp)}
                                style={{ cursor: 'pointer' }}
                            >
                                <div className="emp-grid-card-top">
                                    <div className="emp-avatar emp-avatar-lg" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                                        {name?.[0]?.toUpperCase()}
                                    </div>
                                </div>
                                <h4 className="emp-card-name">{name}</h4>
                                <p className="emp-card-role">{emp.role}</p>
                                <div className="emp-card-badges">
                                    <span className={`emp-type-badge ${emp.offerType === 'fulltime' ? 'fulltime' : 'intern'}`}>
                                        {emp.offerType === 'fulltime' ? 'Full-Time' : 'Intern'}
                                    </span>
                                    {emp.department && <span className="emp-dept-badge">{emp.department}</span>}
                                </div>
                                <div className="emp-card-details">
                                    <div className="emp-card-detail">
                                        <Mail size={13} /> <span>{emp.email}</span>
                                    </div>
                                    {emp.phone && (
                                        <div className="emp-card-detail">
                                            <Phone size={13} /> <span>{emp.phone}</span>
                                        </div>
                                    )}
                                    <div className="emp-card-detail">
                                        <Calendar size={13} />
                                        <span>Joined {emp.startDate ? new Date(emp.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Employee Detail Modal */}
            {selectedEmp && (
                <EmployeeDetailModal
                    emp={selectedEmp}
                    orgId={activeOrg?.id}
                    org={activeOrg}
                    departments={displayDepts}
                    onClose={() => setSelectedEmp(null)}
                    onDelete={handleDelete}
                />
            )}
        </div>
    );
}

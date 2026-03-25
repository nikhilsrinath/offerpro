import { useState, useEffect, useMemo } from 'react';
import {
    Search, UserPlus, Trash2, Mail, Phone, Calendar,
    Briefcase, LayoutGrid, List, Users, Building,
    MoreHorizontal, ChevronDown
} from 'lucide-react';
import { storageService } from '../services/storageService';
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

export default function Employees() {
    const { activeOrg } = useOrg();
    const [employees, setEmployees] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [viewMode, setViewMode] = useState('list');
    const [filter, setFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);

    useEffect(() => {
        if (activeOrg) loadEmployees();
    }, [activeOrg]);

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
                // Delete the older one
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

        // 2. Sync: create employees from offer records that don't have a matching employee
        for (const r of allRecords) {
            const email = (r.data?.email || '').toLowerCase();
            if (r.data?.studentName && email && !seenEmails.has(email)) {
                await storageService.saveEmployee(r.data, orgId);
                seenEmails.set(email, true);
                changed = true;
            }
        }

        const data = changed
            ? await storageService.getEmployees(orgId)
            : existingEmps;

        setEmployees(data);
        setLoading(false);
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this employee record? This will not delete their issued documents.')) {
            try {
                await storageService.deleteEmployee(id, activeOrg?.id);
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
        if (!searchTerm) return list;
        const term = searchTerm.toLowerCase();
        return list.filter(emp =>
            emp.studentName?.toLowerCase().includes(term) ||
            emp.role?.toLowerCase().includes(term) ||
            emp.department?.toLowerCase().includes(term) ||
            emp.email?.toLowerCase().includes(term)
        );
    }, [employees, searchTerm, filter]);

    const counts = useMemo(() => ({
        all: employees.length,
        fulltime: employees.filter(e => e.offerType === 'fulltime').length,
        intern: employees.filter(e => e.offerType === 'internship').length,
        departments: [...new Set(employees.map(e => e.department).filter(Boolean))].length,
    }), [employees]);

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
                        { label: 'Interns', value: counts.intern, color: '#f59e0b', icon: Calendar },
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
                    <div className="emp-filter-tabs">
                        {[
                            { id: 'all', label: 'All' },
                            { id: 'fulltime', label: 'Full-Time' },
                            { id: 'intern', label: 'Interns' },
                        ].map(f => (
                            <button key={f.id}
                                className={`emp-filter-tab ${filter === f.id ? 'active' : ''}`}
                                onClick={() => setFilter(f.id)}
                            >
                                {f.label}
                                <span className="emp-filter-count">{counts[f.id]}</span>
                            </button>
                        ))}
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
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredEmployees.map((emp) => {
                                const [c1, c2] = getAvatarColor(emp.studentName);
                                return (
                                    <tr key={emp.id}>
                                        <td>
                                            <div className="emp-table-name">
                                                <div className="emp-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                                                    {emp.studentName?.[0]?.toUpperCase()}
                                                </div>
                                                <span>{emp.studentName}</span>
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
                                        <td>
                                            <button onClick={() => handleDelete(emp.id)} className="emp-delete-btn" title="Delete">
                                                <Trash2 size={15} />
                                            </button>
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
                        const [c1, c2] = getAvatarColor(emp.studentName);
                        return (
                            <div key={emp.id} className="emp-grid-card">
                                <div className="emp-grid-card-top">
                                    <div className="emp-avatar emp-avatar-lg" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>
                                        {emp.studentName?.[0]?.toUpperCase()}
                                    </div>
                                    <button onClick={() => handleDelete(emp.id)} className="emp-delete-btn">
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                                <h4 className="emp-card-name">{emp.studentName}</h4>
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
        </div>
    );
}

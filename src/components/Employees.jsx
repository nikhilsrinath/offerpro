import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { storageService } from '../services/storageService';
import { documentStore } from '../services/documentStore';
import { createPortalLink } from '../services/portalService';
import { orgStore } from '../services/orgStore';
import { DEPT_PALETTE } from './TeamHierarchy';
import { useOrg } from '../context/OrgContext';
import { useAuth } from '../context/AuthContext';
import EmployeeForm from './EmployeeForm';
import MemberAccess from './settings/MemberAccess';
import { EmployeePhotoFill } from './shared/EmployeeAvatar';
import { portalAccessService } from '../services/portalAccessService';
import {
    Page, Toolbar, Panel, Grid, Row, Btn, Seg, Search, Field, Input, Select, Textarea,
    Table, Tr, Td, Avatar, Status, Bar, Breakdown, StatBand, Empty, Loading, Modal,
    ConfirmBtn, Muted, Label,
} from './ui/edge';
import { useT, fmtDate, MONO } from './ui/edgeUtils';
import { Mail, Phone } from 'lucide-react';
import EmployeeWorkInsights from './people/EmployeeWorkInsights';
import RelatedProjects from './projects/RelatedProjects';
import { PhotoPortrait } from './portal/me/portalKit';
import { tenureLabel, daysUntilBirthday, useWindowWidth } from './portal/me/portalUtils';

/* ══════════════════════════════════════════════════════════════════════════
   Employee registry.

   Two views over one list: a table for scanning many people and reading a
   column, and cards for browsing when you are looking for a face rather than
   a field. Departments are a filter you click, not a modal you open — and the
   department editor is a panel beside the list rather than on top of it.

   Everything a single person needs (portal login, role change, exit) is inside
   that person's sheet, in the order you would actually do it, instead of a row
   of icon buttons whose meanings have to be learned.
   ══════════════════════════════════════════════════════════════════════════ */

const TYPE_LABEL = {
    fulltime: 'Full-time',
    parttime: 'Part-time',
    internship: 'Intern',
    intern: 'Intern',
    contract: 'Contract',
    collaboration: 'Contract',
};

function getDisplayName(emp) {
    if (emp.studentName) return emp.studentName;
    const first = (emp.first_name || '').trim();
    const last = (emp.last_name || '').trim();
    if (first || last) return `${first} ${last}`.trim();
    return '';
}

function deptColor(name, departments) {
    if (!name) return null;
    const fb = departments.find((d) => d.name === name);
    if (fb?.color) return fb.color;
    const h = [...name].reduce((a, c) => c.charCodeAt(0) + ((a << 5) - a), 0);
    return DEPT_PALETTE[Math.abs(h) % DEPT_PALETTE.length];
}

/* ── portal access ────────────────────────────────────────────────────────── */

const ACCESS_LABEL = {
    active: 'Can sign in',
    invited: 'Invitation sent',
    revoked: 'Access turned off',
    none: 'No login yet',
    unknown: 'Checking…',
};

function PortalAccess({ emp, orgId, onChanged }) {
    const t = useT();
    const [row, setRow] = useState(null);
    const [state, setState] = useState('unknown');
    const [busy, setBusy] = useState(false);
    const [creds, setCreds] = useState(null);   // in memory only, never stored
    const [note, setNote] = useState('');
    const [error, setError] = useState('');
    const [copied, setCopied] = useState('');

    const load = useCallback(() => {
        if (!orgId) return;
        portalAccessService.states(orgId)
            .then((all) => {
                const r = all[emp.id] || null;
                setRow(r);
                setState(r?.state || (emp.user_id ? 'active' : 'none'));
            })
            .catch(() => setState(emp.user_id ? 'active' : 'none'));
    }, [orgId, emp.id, emp.user_id]);

    useEffect(load, [load]);

    const run = async (fn) => {
        setBusy(true); setError(''); setNote('');
        try { await fn(); load(); onChanged?.(); }
        catch (err) { setError(err.message || 'That did not work.'); }
        finally { setBusy(false); }
    };

    const create = () => run(async () => {
        const res = await portalAccessService.createLogin(emp.id);
        if (res.outcome === 'created') setCreds({ email: res.email, password: res.password });
        else if (res.outcome === 'linked') setNote(`${res.email} already has an EdgeOS login — they sign in with the password they already use, so there is nothing to hand over.`);
        else setNote('They already have portal access.');
    });

    const reset = () => run(async () => {
        const password = await portalAccessService.resetPassword(emp.id);
        setCreds({ email: emp.email, password });
    });

    const revoke = () => run(async () => {
        await portalAccessService.revokeLogin(emp.id);
        setCreds(null);
    });

    const handover = () => [
        'Your employee portal is ready.',
        `Sign in at: ${window.location.origin}/login`,
        `Email: ${creds.email}`,
        `Password: ${creds.password}`,
        'Please change the password once you are in.',
    ].join('\n');

    const copy = async (what, value) => {
        await navigator.clipboard.writeText(value);
        setCopied(what);
        setTimeout(() => setCopied(''), 2000);
    };

    return (
        <Panel title="Portal login" note={state !== 'unknown' ? ACCESS_LABEL[state] : undefined} pad={13}>
            {creds && (
                <div style={{
                    border: '1px solid ' + t.lineStrong, borderRadius: 8,
                    padding: 11, marginBottom: 11, background: t.panelAlt,
                }}>
                    <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                        <Row><span style={{ width: 62, flexShrink: 0 }}><Label>EMAIL</Label></span>
                            <code style={{ fontSize: 11, color: t.text, wordBreak: 'break-all' }}>{creds.email}</code></Row>
                        <Row><span style={{ width: 62, flexShrink: 0 }}><Label>PASSWORD</Label></span>
                            <code style={{ fontSize: 11, color: t.text }}>{creds.password}</code></Row>
                    </div>
                    <Row wrap gap={7}>
                        <Btn size="sm" primary onClick={() => copy('all', handover())}>
                            {copied === 'all' ? 'Copied' : 'Copy message to send'}
                        </Btn>
                        <Btn size="sm" onClick={() => copy('pw', creds.password)}>
                            {copied === 'pw' ? 'Copied' : 'Copy password'}
                        </Btn>
                        <Btn size="sm" onClick={() => setCreds(null)}>Done</Btn>
                    </Row>
                    <div style={{ fontSize: 10, color: t.down, marginTop: 9, lineHeight: 1.6 }}>
                        Shown once. Nothing stores this password — if it is lost, generate a new one.
                    </div>
                </div>
            )}

            {state === 'unknown' ? null : state === 'active' ? (
                <>
                    <p style={{ margin: '0 0 10px', fontSize: 10.5, color: t.faint, lineHeight: 1.7 }}>
                        {emp.email} signs in on the normal sign-in page and lands on their own portal —
                        attendance, leave and announcements. Archiving them removes it.
                    </p>
                    <Row wrap gap={7}>
                        {row?.can_reset_password && (
                            <Btn size="sm" onClick={reset} disabled={busy}>{busy ? 'Working…' : 'New password'}</Btn>
                        )}
                        <Btn size="sm" onClick={revoke} disabled={busy}>Turn off access</Btn>
                    </Row>
                </>
            ) : (
                <>
                    <p style={{ margin: '0 0 10px', fontSize: 10.5, color: t.faint, lineHeight: 1.7 }}>
                        {!emp.email
                            ? 'Add an email address first — that is the username.'
                            : `Creates a login for ${emp.email} and a password you hand over. No invitation to accept, no email to wait for.`}
                    </p>
                    <Btn size="sm" primary onClick={create} disabled={busy || !emp.email}>
                        {busy ? 'Creating…' : state === 'revoked' ? 'Turn access back on' : 'Create login'}
                    </Btn>
                </>
            )}

            {note && <div style={{ fontSize: 10.5, color: t.dim, marginTop: 9, lineHeight: 1.6 }}>{note}</div>}
            {error && <div style={{ fontSize: 10.5, color: t.down, marginTop: 9 }}>{error}</div>}
        </Panel>
    );
}

/* ── person sheet ─────────────────────────────────────────────────────────── */

function Detail({ emp, orgId, org, onClose, onDelete, onEdit, currentUserEmail, departments }) {
    const t = useT();
    const name = getDisplayName(emp);
    const [view, setView] = useState('detail');   // detail | role_change | termination
    const [link, setLink] = useState(null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [accessKey, setAccessKey] = useState(0);   // remounts MemberAccess after a login changes

    const winW = useWindowWidth();
    const isSelf = currentUserEmail && (emp.email || '').toLowerCase() === currentUserEmail.toLowerCase();

    const [rc, setRc] = useState({
        newRole: emp.role || '', newDepartment: emp.department || '',
        newSalary: '', salaryFrequency: 'month', effectiveDate: '', message: '',
    });
    const [term, setTerm] = useState({ lastDay: '', message: '' });

    const back = () => { setView('detail'); setLink(null); setCopied(false); };

    const issue = async (type) => {
        setBusy(true);
        documentStore.setContext(orgId);
        await documentStore.init();

        const company_profile = {
            company_name: org?.company_name || '', logo_url: org?.logo_url || '',
            company_email: org?.company_email || '', company_phone: org?.company_phone || '',
            address: org?.company_address || '',
        };
        const common = {
            status: 'sent', issued_to: name,
            recipient_email: emp.email || '', recipient_phone: emp.phone || '',
            current_role: emp.role || '', current_department: emp.department || '',
            employee_id: emp.id, company_profile,
            issue_date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
            created_at: new Date().toISOString(),
        };

        const doc = type === 'role_change'
            ? {
                ...common, type: 'role_change', title: `Role Change – ${name}`,
                new_role: rc.newRole, new_department: rc.newDepartment || emp.department || '',
                effective_date: rc.effectiveDate,
                new_salary: rc.newSalary ? Number(rc.newSalary) : null,
                salary_frequency: rc.salaryFrequency, message: rc.message,
            }
            : {
                ...common, type: 'termination', title: `Termination Notice – ${name}`,
                last_day: term.lastDay, message: term.message,
            };

        const saved = await documentStore.save(doc);
        const { url } = await createPortalLink({ orgId, documentId: saved.id, recipientEmail: emp.email });
        setLink(url);
        setBusy(false);
    };

    const copyLink = async () => {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const sentBox = (what) => (
        <div style={{ border: '1px solid ' + t.lineStrong, borderRadius: 8, padding: 13, background: t.panelAlt }}>
            <div style={{ fontSize: 11.5, color: t.text, marginBottom: 4 }}>{what} is ready</div>
            <p style={{ margin: '0 0 10px', fontSize: 10.5, color: t.faint, lineHeight: 1.7 }}>
                Send {name} this link. They read it, and acknowledge it there.
            </p>
            <code style={{
                display: 'block', fontSize: 10, color: t.dim, wordBreak: 'break-all',
                padding: '8px 10px', border: '1px solid ' + t.line, borderRadius: 6, marginBottom: 10,
            }}>{link}</code>
            <Row gap={7}>
                <Btn size="sm" primary onClick={copyLink}>{copied ? 'Copied' : 'Copy link'}</Btn>
                <Btn size="sm" onClick={back}>Done</Btn>
            </Row>
        </div>
    );

    if (view === 'role_change') {
        return (
            <Modal open onClose={onClose} title={'Role change — ' + name}
                note="Issues a notice they acknowledge in their portal"
                footer={!link && (
                    <>
                        <Btn onClick={back}>Back</Btn>
                        <Btn primary onClick={() => issue('role_change')} disabled={busy || !rc.newRole || !rc.effectiveDate}>
                            {busy ? 'Preparing…' : 'Create notice'}
                        </Btn>
                    </>
                )}>
                {link ? sentBox('The role change notice') : (
                    <Grid min={200} gap={13}>
                        <Field label="New role"><Input value={rc.newRole} onChange={(e) => setRc({ ...rc, newRole: e.target.value })} placeholder="Senior Engineer" /></Field>
                        <Field label="New department">
                            <Select value={rc.newDepartment} onChange={(e) => setRc({ ...rc, newDepartment: e.target.value })}>
                                <option value="">Unchanged</option>
                                {departments.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                            </Select>
                        </Field>
                        <Field label="Effective from"><Input type="date" value={rc.effectiveDate} onChange={(e) => setRc({ ...rc, effectiveDate: e.target.value })} /></Field>
                        <Field label="New salary" hint="Leave blank if pay is unchanged">
                            <Row gap={6}>
                                <Input type="number" value={rc.newSalary} onChange={(e) => setRc({ ...rc, newSalary: e.target.value })} placeholder="0" />
                                <Select value={rc.salaryFrequency} onChange={(e) => setRc({ ...rc, salaryFrequency: e.target.value })} style={{ width: 92 }}>
                                    <option value="month">per month</option>
                                    <option value="year">per year</option>
                                </Select>
                            </Row>
                        </Field>
                        <Field label="Message" wide>
                            <Textarea value={rc.message} onChange={(e) => setRc({ ...rc, message: e.target.value })}
                                placeholder="Anything you want them to read alongside the change." />
                        </Field>
                    </Grid>
                )}
            </Modal>
        );
    }

    if (view === 'termination') {
        return (
            <Modal open onClose={onClose} title={'End employment — ' + name}
                note="They move to Ex-Employees once they acknowledge"
                footer={!link && (
                    <>
                        <Btn onClick={back}>Back</Btn>
                        <Btn primary onClick={() => issue('termination')} disabled={busy || !term.lastDay}>
                            {busy ? 'Preparing…' : 'Create notice'}
                        </Btn>
                    </>
                )}>
                {link ? sentBox('The notice') : (
                    <>
                        <Field label="Last working day">
                            <Input type="date" value={term.lastDay} onChange={(e) => setTerm({ ...term, lastDay: e.target.value })} />
                        </Field>
                        <div style={{ height: 13 }} />
                        <Field label="Message" hint="Read by them, and kept on the record">
                            <Textarea value={term.message} onChange={(e) => setTerm({ ...term, message: e.target.value })} />
                        </Field>
                    </>
                )}
            </Modal>
        );
    }

    const tenure = tenureLabel(emp.startDate);
    const bdayIn = daysUntilBirthday(emp.date_of_birth);
    const stacked = winW < 900;
    const wide = winW >= 1180;

    const facts = [
        ['Employment', TYPE_LABEL[emp.offerType]],
        ['Department', emp.department && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: deptColor(emp.department, departments) }} />
                {emp.department}
            </span>
        )],
        ['Reports to', emp.supervisorName],
        ['Started', emp.startDate && (
            <>{fmtDate(emp.startDate)}{tenure && <span style={{ color: t.faint }}> · {tenure}</span>}</>
        )],
        ['Ends', emp.endDate ? fmtDate(emp.endDate) : null],
        ['Birthday', emp.date_of_birth && (
            <>
                {fmtDate(emp.date_of_birth)}
                {bdayIn != null && bdayIn <= 30 && (
                    <span style={{ color: t.faint }}> · {bdayIn === 0 ? 'today' : `in ${bdayIn}d`}</span>
                )}
            </>
        )],
        ['Phone', emp.phone],
        ['Email', emp.email],
        ['Address', emp.address],
    ].filter(([, v]) => v);

    return (
        <Modal open onClose={onClose} width={1120}
            title={name || 'Employee'} note={[emp.role, emp.department].filter(Boolean).join(' · ') || undefined}
            footer={
                <>
                    {!isSelf && <ConfirmBtn size="md" label="Delete record" confirmLabel="Delete" title="Delete employee"
                        message={`Are you sure you want to delete ${name || 'this employee'} from the registry? This cannot be undone.`} onConfirm={() => onDelete(emp.id)} />}
                    <div style={{ flex: 1 }} />
                    <Btn onClick={() => setView('termination')}>End employment</Btn>
                    <Btn onClick={() => setView('role_change')}>Role change</Btn>
                    <Btn primary onClick={onEdit}>Edit details</Btn>
                </>
            }>
            <div style={{
                display: 'grid', gap: 18, alignItems: 'start',
                gridTemplateColumns: stacked ? '1fr' : 'minmax(250px, 300px) minmax(0, 1fr)',
            }}>
                {/* ── left: the person ─────────────────────────────────────── */}
                <aside style={{ display: 'grid', gap: 12, minWidth: 0 }}>
                    <div style={{ width: '100%', maxWidth: stacked ? 240 : '100%', margin: stacked ? '0 auto' : 0 }}>
                        <PhotoPortrait name={name} path={emp.photo_path} />
                    </div>

                    <div>
                        <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.03em', color: t.text }}>{name}</div>
                        <div style={{ fontSize: 11, color: t.dim, marginTop: 4 }}>{emp.role || 'No role set'}</div>
                        <Row gap={12} wrap style={{ marginTop: 9 }}>
                            <Status tone={emp.user_id ? 'up' : 'mute'}>{emp.user_id ? 'Portal active' : 'No portal login'}</Status>
                            {tenure && <Status tone="neutral">{tenure} here</Status>}
                        </Row>
                    </div>

                    {(emp.email || emp.phone) && (
                        <div style={{ display: 'grid', gap: 6, gridTemplateColumns: emp.email && emp.phone ? '1fr 1fr' : '1fr' }}>
                            {emp.email && <a href={`mailto:${emp.email}`} className="edge-btn" style={contactBtn(t)}><Mail size={13} /> Email</a>}
                            {emp.phone && <a href={`tel:${emp.phone}`} className="edge-btn" style={contactBtn(t)}><Phone size={13} /> Call</a>}
                        </div>
                    )}

                    <div style={{ border: '1px solid ' + t.line, borderRadius: 10, overflow: 'hidden' }}>
                        {facts.map(([k, v], i) => (
                            <div key={k} style={{
                                display: 'flex', gap: 10, padding: '8px 12px',
                                borderTop: i ? '1px solid ' + t.lineSoft : 'none',
                            }}>
                                <span style={{ width: 76, flexShrink: 0, fontSize: 9, letterSpacing: '0.09em', color: t.faint, paddingTop: 2 }}>
                                    {k.toUpperCase()}
                                </span>
                                <span style={{ fontSize: 11, color: t.text, minWidth: 0, wordBreak: 'break-word', lineHeight: 1.5 }}>{v}</span>
                            </div>
                        ))}
                    </div>

                    {emp.bio && (
                        <div style={{ border: '1px solid ' + t.line, borderRadius: 10, padding: '10px 12px' }}>
                            <Label>ABOUT</Label>
                            <p style={{ margin: '6px 0 0', fontSize: 11, lineHeight: 1.65, color: t.dim, whiteSpace: 'pre-wrap' }}>{emp.bio}</p>
                        </div>
                    )}

                    {(emp.emergency_contact_name || emp.emergency_contact_phone) && (
                        <div style={{ border: '1px solid ' + t.line, borderRadius: 10, padding: '10px 12px' }}>
                            <Label>EMERGENCY CONTACT</Label>
                            <div style={{ fontSize: 11.5, color: t.text, marginTop: 6 }}>{emp.emergency_contact_name || '—'}</div>
                            {emp.emergency_contact_phone && (
                                <a href={`tel:${emp.emergency_contact_phone}`} style={{ fontSize: 10.5, color: t.dim, textDecoration: 'none' }}>
                                    {emp.emergency_contact_phone}
                                </a>
                            )}
                        </div>
                    )}
                </aside>

                {/* ── right: how they are working, then their access ───────── */}
                <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
                    <EmployeeWorkInsights emp={emp} orgId={orgId} narrow={!wide} />

                    <RelatedProjects employeeId={emp.id} />

                    <div>
                        <div style={{ fontSize: 9.5, letterSpacing: '0.1em', color: t.faint, margin: '4px 0 9px' }}>ACCESS</div>
                        <div style={{ display: 'grid', gap: 12, alignItems: 'start' }}>
                            <PortalAccess emp={emp} orgId={orgId} onChanged={() => setAccessKey((k) => k + 1)} />
                            <MemberAccess key={accessKey} email={emp.email} name={name} />
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function contactBtn(t) {
    return {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 30,
        borderRadius: 7, border: '1px solid ' + t.line, background: t.panel, color: t.text,
        fontFamily: MONO, fontSize: 11, textDecoration: 'none',
    };
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function Employees() {
    const t = useT();
    const navigate = useNavigate();
    const { activeOrg } = useOrg();
    const { user } = useAuth();

    const [employees, setEmployees] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [query, setQuery] = useState('');
    const [sortBy, setSortBy] = useState('name_asc');
    const [view, setView] = useState('table');
    const [type, setType] = useState('all');
    const [dept, setDept] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showDepts, setShowDepts] = useState(false);
    const [newDept, setNewDept] = useState('');
    const [newColor, setNewColor] = useState(DEPT_PALETTE[0]);
    const [deptBusy, setDeptBusy] = useState(false);
    const [selected, setSelected] = useState(null);
    const [addingSelf, setAddingSelf] = useState(false);
    const [editing, setEditing] = useState(null);

    const ownerEmail = (activeOrg?.company_email || '').toLowerCase();
    const ownerEmployee = employees.find((e) => (e.email || '').toLowerCase() === ownerEmail);
    const ownerHasName = ownerEmployee && getDisplayName(ownerEmployee);

    const loadDepartments = useCallback(async () => {
        setDepartments(await storageService.getDepartments(activeOrg?.id));
    }, [activeOrg?.id]);

    const loadEmployees = useCallback(async () => {
        setLoading(true);
        const orgId = activeOrg?.id;

        const [existing, allRecords] = await Promise.all([
            storageService.getEmployees(orgId),
            storageService.getAll(orgId, 'offer'),
        ]);

        let changed = false;

        // Keep only the newest record per email.
        const seen = new Map();
        for (const emp of existing) {
            const key = (emp.email || '').toLowerCase();
            if (!key) continue;
            if (seen.has(key)) {
                const prev = seen.get(key);
                const older = new Date(emp.created_at || 0) > new Date(prev.created_at || 0) ? prev : emp;
                await storageService.deleteEmployee(older.id, orgId, 'Duplicate record — superseded by a newer entry for the same email');
                if (older === prev) seen.set(key, emp);
                changed = true;
            } else {
                seen.set(key, emp);
            }
        }

        // An offer becomes an employee only once it has been accepted; a
        // draft or merely-sent offer is a candidate, not a colleague.
        const ACCEPTED = new Set(['signed', 'accepted']);
        const EMPLOYMENT_TYPE = {
            internship: 'intern', intern: 'intern',
            collaboration: 'contract', contract: 'contract',
            parttime: 'parttime', fulltime: 'fulltime',
        };
        try {
            for (const r of allRecords) {
                if (!ACCEPTED.has(r.status) || r.employee_synced) continue;
                const d = r.data || {};
                const name = r.issued_to || d.studentName || d.name || '';
                const email = (r.recipient_email || d.email || '').toLowerCase();
                if (!name || !email || seen.has(email)) continue;

                const empData = {
                    ...d, studentName: name, email,
                    phone: r.recipient_phone || d.phone || '',
                    role: r.role || d.role || '',
                    department: r.department || d.department || '',
                    offerType: EMPLOYMENT_TYPE[r.offer_type || d.offerType] || 'fulltime',
                    startDate: r.start_date || d.startDate || '',
                    endDate: r.end_date || d.endDate || '',
                    offer_doc_id: r.id, signed_at: r.signed_at || '',
                };
                const employee = await storageService.saveEmployee(empData, orgId);
                await orgStore.updateItem('records', r.id, {
                    employee_synced: true,
                    employee_id: employee?.id || r.employee_id || null,
                });
                seen.set(email, empData);
                changed = true;
            }
        } catch (err) {
            console.warn('[Employees] Failed to sync accepted offers:', err.message);
        }

        setEmployees(changed ? await storageService.getEmployees(orgId) : existing);
        setLoading(false);
    }, [activeOrg?.id]);

    useEffect(() => {
        if (activeOrg) { loadEmployees(); loadDepartments(); }
    }, [activeOrg, loadEmployees, loadDepartments]);

    const addSelf = async () => {
        if (!activeOrg || (ownerEmployee && ownerHasName)) return;
        setAddingSelf(true);
        try {
            const ownerName = activeOrg.owner_full_name || activeOrg.owner_name || 'Owner';
            await storageService.saveEmployee({
                ...(ownerEmployee || {}),
                studentName: ownerName,
                first_name: ownerName.split(' ')[0] || '',
                last_name: ownerName.split(' ').slice(1).join(' ') || '',
                email: activeOrg.company_email || '',
                role: activeOrg.owner_role || 'Founder',
                department: "Founder's Office",
                offerType: 'fulltime', is_owner: true,
            }, activeOrg.id);

            const depts = await storageService.getDepartments(activeOrg.id);
            if (!depts.some((d) => d.name === "Founder's Office")) {
                await storageService.saveDepartment({ name: "Founder's Office" }, activeOrg.id);
                loadDepartments();
            }
            loadEmployees();
        } catch (err) {
            console.error('Error adding self:', err);
        } finally {
            setAddingSelf(false);
        }
    };

    const addDept = async () => {
        if (!newDept.trim()) return;
        setDeptBusy(true);
        await storageService.saveDepartment({ name: newDept.trim(), color: newColor }, activeOrg?.id);
        setNewDept(''); setNewColor(DEPT_PALETTE[0]); setDeptBusy(false);
        loadDepartments();
    };

    const remove = async (id) => {
        try {
            await storageService.deleteEmployee(id, activeOrg?.id, 'Removed from the employee registry');
            setSelected(null);
            loadEmployees();
        } catch (err) {
            alert('Error deleting employee: ' + err.message);
        }
    };

    const deptRows = useMemo(() => {
        const names = [...new Set([
            ...employees.map((e) => e.department).filter(Boolean),
            ...departments.map((d) => d.name),
        ])].sort();
        return names.map((name) => ({
            name,
            color: deptColor(name, departments),
            count: employees.filter((e) => e.department === name).length,
            id: departments.find((d) => d.name === name)?.id || null,
        }));
    }, [employees, departments]);

    const list = useMemo(() => {
        let l = employees;
        if (type === 'fulltime') l = l.filter((e) => e.offerType === 'fulltime');
        if (type === 'intern') l = l.filter((e) => e.offerType === 'internship' || e.offerType === 'intern');
        if (dept) l = l.filter((e) => e.department === dept);
        const q = query.trim().toLowerCase();
        if (q) {
            l = l.filter((e) => getDisplayName(e).toLowerCase().includes(q)
                || (e.role || '').toLowerCase().includes(q)
                || (e.department || '').toLowerCase().includes(q)
                || (e.email || '').toLowerCase().includes(q));
        }
        return [...l].sort((a, b) => {
            if (sortBy === 'name_asc') return getDisplayName(a).localeCompare(getDisplayName(b));
            if (sortBy === 'name_desc') return getDisplayName(b).localeCompare(getDisplayName(a));
            if (sortBy === 'role') return (a.role || '').localeCompare(b.role || '');
            if (sortBy === 'dept') return (a.department || '').localeCompare(b.department || '');
            if (sortBy === 'date_desc') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            if (sortBy === 'date_asc') return new Date(a.created_at || 0) - new Date(b.created_at || 0);
            return 0;
        });
    }, [employees, query, sortBy, type, dept]);

    const counts = useMemo(() => ({
        all: employees.length,
        fulltime: employees.filter((e) => e.offerType === 'fulltime').length,
        intern: employees.filter((e) => e.offerType === 'internship' || e.offerType === 'intern').length,
    }), [employees]);

    if (editing) {
        return (
            <Page>
                <Toolbar right={<Btn onClick={() => setEditing(null)}>Back to registry</Btn>}>
                    <span style={{ fontSize: 12 }}>Editing {getDisplayName(editing) || 'employee'}</span>
                </Toolbar>
                <EmployeeForm employee={editing} onSuccess={() => { setEditing(null); loadEmployees(); }} onCancel={() => setEditing(null)} />
            </Page>
        );
    }

    if (loading) return <Page><Loading>Loading the registry…</Loading></Page>;

    return (
        <Page>
            <Toolbar right={
                <Row gap={8}>
                    <Btn onClick={() => setShowDepts((v) => !v)}>{showDepts ? 'Hide departments' : 'Departments'}</Btn>
                    <Btn primary onClick={() => navigate('/employees/new')}>Add employee</Btn>
                </Row>
            }>
                <Seg value={type} onChange={setType} options={[
                    { id: 'all', label: 'Everyone', count: counts.all },
                    { id: 'fulltime', label: 'Full-time', count: counts.fulltime },
                    { id: 'intern', label: 'Interns', count: counts.intern },
                ]} />
                <Search value={query} onChange={setQuery} placeholder="Search name, role, team, email…" />
                <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ width: 132, height: 29 }}>
                    <option value="name_asc">Name A–Z</option>
                    <option value="name_desc">Name Z–A</option>
                    <option value="role">Role</option>
                    <option value="dept">Department</option>
                    <option value="date_desc">Newest first</option>
                    <option value="date_asc">Oldest first</option>
                </Select>
                <Seg size="sm" value={view} onChange={setView} options={[
                    { id: 'table', label: 'Table' }, { id: 'cards', label: 'Cards' },
                ]} />
            </Toolbar>

            {employees.length > 0 && (
                <StatBand items={[
                    { label: 'On the team', value: counts.all },
                    { label: 'Full-time', value: counts.fulltime, note: counts.all ? Math.round((counts.fulltime / counts.all) * 100) + '% of the team' : undefined },
                    { label: 'Interns', value: counts.intern },
                    { label: 'Departments', value: deptRows.length },
                ]} />
            )}

            {ownerEmail && !ownerHasName && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    border: '1px solid ' + t.lineStrong, borderRadius: 10,
                    padding: '11px 13px', marginBottom: 14,
                }}>
                    <span style={{ fontSize: 11, color: t.dim, flex: 1, minWidth: 200 }}>
                        You are not in the registry yet. Adding yourself puts you on the org chart and in the team list.
                    </span>
                    <Btn onClick={addSelf} disabled={addingSelf}>{addingSelf ? 'Adding…' : 'Add me'}</Btn>
                </div>
            )}

            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: showDepts ? 'minmax(0,1fr) 268px' : '1fr', alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                    {dept && (
                        <Row gap={8} style={{ marginBottom: 10 }}>
                            <Muted>Filtered to</Muted>
                            <Btn size="sm" onClick={() => setDept(null)}>{dept} ×</Btn>
                        </Row>
                    )}

                    {list.length === 0 ? (
                        <Panel>
                            <Empty action={employees.length === 0 ? <Btn primary onClick={() => navigate('/employees/new')}>Add the first employee</Btn> : undefined}>
                                {employees.length === 0
                                    ? 'Nobody is on the team yet. Employees added here appear on the org chart, in attendance and in leave.'
                                    : 'No one matches those filters.'}
                            </Empty>
                        </Panel>
                    ) : view === 'table' ? (
                        <Table cols={[
                            { key: 'n', label: 'Name' },
                            { key: 'r', label: 'Role' },
                            { key: 'd', label: 'Department' },
                            { key: 't', label: 'Type' },
                            { key: 's', label: 'Started' },
                            { key: 'a', label: '', align: 'right', width: 74 },
                        ]}>
                            {list.map((emp) => {
                                const name = getDisplayName(emp);
                                const c = deptColor(emp.department, departments);
                                return (
                                    <Tr key={emp.id} onClick={() => setSelected(emp)}>
                                        <Td>
                                            <Row gap={9}>
                                                <Avatar name={name} size={26} photo={<EmployeePhotoFill photoPath={emp.photo_path} />} />
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
                                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: c, flexShrink: 0 }} />
                                                    <span style={{ color: t.dim, fontSize: 11 }}>{emp.department}</span>
                                                </Row>
                                            ) : <span style={{ color: t.ghost }}>—</span>}
                                        </Td>
                                        <Td muted nowrap>{TYPE_LABEL[emp.offerType] || '—'}</Td>
                                        <Td muted nowrap>{emp.startDate ? fmtDate(emp.startDate) : '—'}</Td>
                                        <Td align="right">
                                            <Btn size="sm" onClick={() => setSelected(emp)}>Open</Btn>
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </Table>
                    ) : (
                        <Grid min={228}>
                            {list.map((emp) => {
                                const name = getDisplayName(emp);
                                const c = deptColor(emp.department, departments);
                                return (
                                    <button key={emp.id} type="button" onClick={() => setSelected(emp)}
                                        className="edge-tr"
                                        style={{
                                            display: 'block', textAlign: 'left', cursor: 'pointer',
                                            border: '1px solid ' + t.line, borderRadius: 10, padding: 13,
                                            background: t.panel, fontFamily: MONO, color: t.text,
                                        }}>
                                        <Row gap={10} style={{ marginBottom: 11 }}>
                                            <Avatar name={name} size={34} photo={<EmployeePhotoFill photoPath={emp.photo_path} />} />
                                            <span style={{ minWidth: 0, flex: 1 }}>
                                                <span style={{ display: 'block', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || '—'}</span>
                                                <span style={{ display: 'block', fontSize: 9.5, color: t.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.role || 'No role'}</span>
                                            </span>
                                        </Row>
                                        <div style={{ borderTop: '1px solid ' + t.lineSoft, paddingTop: 9, display: 'flex', alignItems: 'center', gap: 8 }}>
                                            {emp.department ? (
                                                <>
                                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: c, flexShrink: 0 }} />
                                                    <span style={{ fontSize: 9.5, color: t.faint, letterSpacing: '0.05em', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {emp.department.toUpperCase()}
                                                    </span>
                                                </>
                                            ) : <span style={{ flex: 1 }} />}
                                            <span style={{ fontSize: 9.5, color: t.ghost }}>{TYPE_LABEL[emp.offerType] || ''}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </Grid>
                    )}
                </div>

                {showDepts && (
                    <Panel title="Departments" note={deptRows.length + ' in use'} pad={13}>
                        {deptRows.length > 0 && (
                            <div style={{ marginBottom: 14 }}>
                                <Breakdown rows={deptRows.map((d) => ({ label: d.name, value: d.count, color: d.color }))}
                                    total={employees.length} max={8} />
                            </div>
                        )}

                        <div style={{ display: 'grid', gap: 2, marginBottom: 13 }}>
                            {deptRows.map((d) => (
                                <Row key={d.name} gap={8}>
                                    <button type="button" onClick={() => setDept(dept === d.name ? null : d.name)}
                                        className="edge-tr"
                                        style={{
                                            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
                                            padding: '6px 8px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                                            background: dept === d.name ? t.panelAlt : 'transparent',
                                            border: '1px solid ' + (dept === d.name ? t.line : 'transparent'),
                                            fontFamily: MONO, color: t.text, fontSize: 11,
                                        }}>
                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                                        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                                        <span style={{ fontSize: 9.5, color: t.ghost }}>{d.count}</span>
                                    </button>
                                    {d.id && (
                                        <ConfirmBtn label="×" confirmLabel="Delete" title="Delete department"
                                            message={`Are you sure you want to delete the ${d.name} department? People in it keep their records.`}
                                            onConfirm={() => storageService.deleteDepartment(d.id, activeOrg?.id).then(loadDepartments)} />
                                    )}
                                </Row>
                            ))}
                        </div>

                        <div style={{ borderTop: '1px solid ' + t.lineSoft, paddingTop: 12 }}>
                            <Field label="New department">
                                <Input value={newDept} onChange={(e) => setNewDept(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && addDept()} placeholder="Engineering" />
                            </Field>
                            <div role="radiogroup" aria-label="Department colour" style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '10px 0' }}>
                                {DEPT_PALETTE.map((c) => (
                                    <button key={c} type="button" role="radio" aria-checked={newColor === c}
                                        aria-label={'Colour ' + c} onClick={() => setNewColor(c)}
                                        style={{
                                            width: 16, height: 16, borderRadius: '50%', background: c, padding: 0, cursor: 'pointer',
                                            border: '2px solid ' + (newColor === c ? t.text : 'transparent'),
                                        }} />
                                ))}
                            </div>
                            <Btn full primary onClick={addDept} disabled={deptBusy || !newDept.trim()}>Add department</Btn>
                        </div>
                    </Panel>
                )}
            </div>

            {selected && (
                <Detail
                    emp={selected} orgId={activeOrg?.id} org={activeOrg}
                    departments={deptRows} currentUserEmail={user?.email}
                    onClose={() => setSelected(null)}
                    onDelete={remove}
                    onEdit={() => { setEditing(selected); setSelected(null); }}
                />
            )}
        </Page>
    );
}

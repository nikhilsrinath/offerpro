import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from './shell/navHistory';
import { storageService } from '../services/storageService';
import { uploadOrgImage } from '../services/imageUploadService';
import EmployeeAvatar from './shared/EmployeeAvatar';
import DepartmentsPanel from './people/DepartmentsPanel';
import { departmentRows } from './people/departments';
import EmployeeProjectPicker from './people/EmployeeProjectPicker';
import { addMember, updateMember } from '../services/projectService';
import { useAuth } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { orgStore } from '../services/orgStore';
import {
    Page, Panel, Row, Btn, Seg, Field, Input, Select, Textarea, Empty,
} from './ui/edge';
import { useT } from './ui/edgeUtils';
import { baseCurrency } from '../shared/currency.js';
import { Camera, Plus, X, Trash2 } from 'lucide-react';
import { revisionOn } from '../shared/payroll';
import './people/employeeForm.css';

const todayKey = () => new Date().toISOString().slice(0, 10);
const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
let revKey = 0;
/** A pay-history row being edited: amount as typed, `key` for React. */
const revRow = (r = {}) => ({ key: `r${revKey += 1}`, id: r.id || null, effective_from: r.effective_from || '', amount: r.amount == null ? '' : String(r.amount), note: r.note || '' });

/* ══════════════════════════════════════════════════════════════════════════
   Add or edit a person.

   This was a four-step wizard over twelve fields, which meant three clicks of
   navigation to fill in a form that fits on one screen. It is now one page in
   three labelled sections, with the save button in the toolbar where it stays
   visible. Nothing is hidden behind a step, so you can fill the fields in
   whatever order you have the answers.
   ══════════════════════════════════════════════════════════════════════════ */

const TYPES = [
    { id: 'fulltime', label: 'Full-time' },
    { id: 'parttime', label: 'Part-time' },
    { id: 'internship', label: 'Internship' },
    { id: 'collaboration', label: 'Collaboration' },
];

const blank = (org) => ({
    offerType: 'fulltime',
    studentName: '', photo_path: null, email: '', phone: '', studentAddress: '',
    role: '', department: '', supervisorName: '', responsibilities: '',
    startDate: '', endDate: '', acceptanceDeadline: '',
    isPaid: true, stipend: '', currency: baseCurrency(), paymentFrequency: 'Monthly',
    companyName: org.company_name || '',
    companyTagline: org.company_tagline || '',
    companyAddress: org.company_address || '',
    companyLogo: org.logo_url || null,
    cin: org.cin || '',
    companyWebsite: org.company_website || '',
    authorizedPersonName: org.owner_full_name || '',
    authorizedPersonDesignation: org.document_designation || '',
    contactEmail: org.company_email || '',
    contactPhone: org.company_phone || '',
    signature: org.signature_url || null,
    stampType: org.stamp_type || 'generated',
    stampCity: org.stamp_city || '',
    showStamp: true,
});

export default function EmployeeForm({ onBack, onSuccess, employee }) {
    const t = useT();
    const navigate = useNavigate();
    const goBack = useGoBack();
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const org = activeOrg || {};
    const isEdit = !!employee;
    // 0102: an Employee ID is permanent; only an owner or admin may set or change it.
    const canSetId = ['owner', 'admin'].includes(orgStore.getRole());

    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(false);
    const [depts, setDepts] = useState([]);
    const [showDepts, setShowDepts] = useState(false);
    const photoInput = useRef(null);
    const [photoBusy, setPhotoBusy] = useState(false);
    const [photoError, setPhotoError] = useState('');
    // Projects queued in the Projects section; added once the person is saved.
    const [newProjects, setNewProjects] = useState([]);
    // Changes to projects they are already on (role, time, dates); written on save.
    const [projectEdits, setProjectEdits] = useState({});
    const canAssign = orgStore.can('projects', 'view') && orgStore.can('project_members', 'create');
    const canEditProjects = isEdit && orgStore.can('projects', 'view') && orgStore.can('project_members', 'edit');

    const [form, setForm] = useState(() => (employee
        ? { ...blank(org), ...employee, studentName: employee.studentName || employee.first_name || '', id: employee.id }
        : blank(org)));

    const loadDepts = useCallback(() => {
        if (!activeOrg?.id) return Promise.resolve();
        return storageService.getDepartments(activeOrg.id)
            .then((d) => setDepts(d))
            .catch(() => setDepts([]));
    }, [activeOrg?.id]);
    useEffect(() => { loadDepts(); }, [loadDepts]);

    // Head-counts for the departments panel come from the people already on
    // the registry, the same figures the Employees page shows.
    const people = useMemo(() => (showDepts ? orgStore.getSectionAsList('employees') : []), [showDepts]);
    const deptRows = useMemo(() => departmentRows(people, depts), [people, depts]);
    const deptNames = useMemo(() => [...new Set(depts.map((d) => d.name))].sort(), [depts]);

    const set = (field) => (e) => setForm((p) => ({
        ...p, [field]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e,
    }));

    // The saved department_id outranks the name when the row is written, so a
    // new pick has to drop it or the edit keeps the old department.
    const setDepartment = (e) => setForm((p) => ({ ...p, department: e.target.value, department_id: undefined }));
    const pickDepartment = (name) => setForm((p) => ({ ...p, department: name, department_id: undefined }));

    // Pay history (0121), owner/admin only as pay is: one row per change, from
    // the date it takes effect until the next. The pay now is the row in
    // effect today; without rows, the amount typed, which is saved as the
    // first row from the date of joining.
    const isAdmin = canSetId;
    const savedRevs = useMemo(() => (employee?.id
        ? orgStore.getSectionAsList('pay_revisions').filter((r) => r.employee_id === employee.id)
            .sort((a, b) => String(a.effective_from).localeCompare(String(b.effective_from)))
        : []), [employee?.id]);
    const [revs, setRevs] = useState(() => savedRevs.map(revRow));
    const setRev = (key, field) => (e) => setRevs((list) => list.map((r) => (r.key === key ? { ...r, [field]: e.target.value } : r)));
    const addRev = () => setRevs((list) => [...list, revRow({
        effective_from: list.length ? todayKey() : form.startDate || todayKey(),
        amount: list.length ? undefined : form.stipend,
    })]);
    const removeRev = (key) => setRevs((list) => list.filter((r) => r.key !== key));
    const revsSorted = useMemo(() => revs.filter((r) => r.effective_from && String(r.amount).trim() !== '')
        .map((r) => ({ ...r, amount: Number(r.amount) }))
        .sort((a, b) => a.effective_from.localeCompare(b.effective_from)), [revs]);
    const revNow = revisionOn(revsSorted, todayKey());
    const revError = (() => {
        if (!isAdmin || !form.isPaid) return '';
        if (revs.some((r) => !r.effective_from || String(r.amount).trim() === '')) return 'Give every pay change a date and an amount.';
        if (revs.some((r) => !(Number(r.amount) >= 0))) return 'A pay amount cannot be below zero.';
        const days = revs.map((r) => r.effective_from);
        if (new Set(days).size !== days.length) return 'Two pay changes on the same day: keep one.';
        return '';
    })();

    const dated = form.offerType === 'internship' || form.offerType === 'collaboration';
    // A new hire needs a name, job title and date of joining (email is
    // optional: not everyone has a work email); an edit only needs a name, so records made
    // without an email or start date (the founder's, from sign-up) can still
    // be saved.
    const missing = [
        ['Name', form.studentName],
        ...(isEdit ? [] : [['job title', form.role], ['date of joining', form.startDate]]),
    ].filter(([, v]) => !String(v ?? '').trim()).map(([label]) => label);
    const ready = missing.length === 0 && !revError;

    // The pay history, written once the person is: removed rows deleted,
    // changed ones updated, new ones added. The database then sets their pay
    // now from it. Returns what could not be saved.
    const savePayHistory = async (employeeId) => {
        if (!isAdmin || !employeeId || !form.isPaid) return '';
        let rows = revs.filter((r) => r.effective_from && String(r.amount).trim() !== '');
        // No history yet: the pay typed is the first row, from the date of joining.
        if (!rows.length && Number(form.stipend) > 0) {
            rows = [revRow({ effective_from: form.startDate || todayKey(), amount: form.stipend })];
        }
        try {
            const keep = new Set(rows.map((r) => r.id).filter(Boolean));
            for (const r of savedRevs) if (!keep.has(r.id)) await orgStore.removeItem('pay_revisions', r.id);
            for (const r of rows.filter((x) => x.id)) {
                const was = savedRevs.find((x) => x.id === r.id);
                if (was && (was.effective_from !== r.effective_from || Number(was.amount) !== Number(r.amount) || (was.note || '') !== r.note.trim())) {
                    await orgStore.updateItem('pay_revisions', r.id, { employee_id: employeeId, effective_from: r.effective_from, amount: r.amount, note: r.note });
                }
            }
            for (const r of rows.filter((x) => !x.id)) {
                await orgStore.addItem('pay_revisions', { employee_id: employeeId, effective_from: r.effective_from, amount: r.amount, note: r.note });
            }
            return '';
        } catch (err) {
            return /employee_pay_revisions/.test(String(err?.message || '')) && /exist|schema cache/i.test(String(err?.message || ''))
                ? 'the pay history needs database update 0121. Run it in Supabase, then save again.'
                : `the pay history was not saved: ${err.message}`;
        }
    };

    // Uploaded straight away rather than held until save: processImage() resizes
    // and re-encodes, and doing that during submit would stall the whole form
    // on an operation that can fail on its own.
    const onPhoto = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setPhotoBusy(true); setPhotoError('');
        try {
            const { path } = await uploadOrgImage({ orgId: activeOrg?.id, kind: 'employeePhoto', source: file });
            setForm((f) => ({ ...f, photo_path: path }));
        } catch (err) {
            setPhotoError(err.message || 'Could not upload that photo.');
        } finally {
            setPhotoBusy(false);
        }
    };

    const submit = async () => {
        // Someone the registry already holds is not added a second time.
        if (!isEdit && form.email.trim()) {
            const email = form.email.trim().toLowerCase();
            const same = [...orgStore.getSectionAsList('employees'), ...orgStore.getSectionAsList('ex_employees')]
                .find((e) => (e.email || '').toLowerCase() === email);
            if (same) {
                alert(`${same.studentName || 'Someone'} is already in the registry${same.exited_at ? ' as an ex-employee' : ''} with the email ${form.email.trim()}.`);
                return;
            }
        }
        const code = String(form.employee_code || '').trim().toLowerCase();
        if (canSetId && code) {
            const taken = [...orgStore.getSectionAsList('employees'), ...orgStore.getSectionAsList('ex_employees')]
                .find((e) => e.id !== form.id && (e.employee_code || '').toLowerCase() === code);
            if (taken) {
                alert(`${taken.studentName || 'Someone'}${taken.exited_at ? ' (ex-employee)' : ''} already has the Employee ID ${taken.employee_code}.`);
                return;
            }
        }
        setSaving(true);
        try {
            let employeeId = form.id;
            // With a pay history, the pay now is the change in effect today.
            const toSave = revNow && form.isPaid ? { ...form, stipend: String(revNow.amount) } : form;
            if (isEdit) {
                await storageService.updateEmployee(form.id, toSave, activeOrg?.id);
            } else {
                // Onboarding from this page is direct: the person joins the
                // registry immediately and the offer letter is filed as a
                // record they can download. It is not a portal offer awaiting a
                // signature, so it is stored as already accepted and linked to
                // the employee: that keeps it out of the Recruitment Tracker's
                // pending list and stops the acceptance sync creating the same
                // person twice.
                const saved = await storageService.saveEmployee(toSave, activeOrg?.id);
                await storageService.save(
                    { ...form, source: 'employee_form', employee_synced: true },
                    'offer', activeOrg?.id, user?.id,
                    { status: 'accepted', employee_id: saved?.id || employee?.id || null },
                );
                employeeId = saved?.id;
            }
            // The person is saved; a project that refuses them is reported
            // without undoing that.
            const failed = [];
            if (employeeId) {
                const today = new Date().toISOString().slice(0, 10);
                const from = !isEdit && form.startDate > today ? form.startDate : today;
                for (const x of newProjects) {
                    try {
                        await addMember(x.project_id, {
                            employee_id: employeeId, role: x.role, role_title: '', allocation_pct: x.allocation_pct,
                            start_date: x.start_date || from, end_date: null, bill_rate: null,
                        });
                    } catch (e) {
                        const p = orgStore.getItem('projects', x.project_id);
                        failed.push(`${p?.name || 'A project'}: ${e.message}`);
                    }
                }
            }
            // Edits to projects they are already on.
            const notChanged = [];
            for (const [memberId, patch] of Object.entries(projectEdits)) {
                try {
                    await updateMember(memberId, patch);
                } catch (e) {
                    const m = orgStore.getItem('project_members', memberId);
                    const p = m && orgStore.getItem('projects', m.project_id);
                    notChanged.push(`${p?.name || 'A project'}: ${e.message}`);
                }
            }
            const payProblem = await savePayHistory(employeeId);
            if (payProblem) alert(`${form.studentName} was saved, but ${payProblem}`);
            if (failed.length) alert(`${form.studentName} was saved, but was not added to:\n${failed.join('\n')}`);
            if (notChanged.length) alert(`${form.studentName} was saved, but these project changes were not:\n${notChanged.join('\n')}`);
            setDone(true);
            setTimeout(() => {
                setSaving(false);
                if (onSuccess) onSuccess();
                else navigate('/company/employees');
            }, 900);
        } catch (err) {
            console.error(err);
            const message = err.code === '23505' && /employees_org_code_idx/.test(err.message || '')
                ? 'Another person already has that Employee ID.' : err.message;
            alert((isEdit ? 'Error updating employee: ' : 'Error adding employee: ') + message);
            setSaving(false);
        }
    };

    // Cancel returns to the page the form was opened from.
    const leave = () => { if (onBack) onBack(); else goBack('/company/employees'); };

    if (done) {
        return (
            <Page>
                <Panel>
                    <Empty>
                        {form.studentName} {isEdit ? 'has been updated.' : 'is on the team.'}
                        <br />Taking you back to the registry…
                    </Empty>
                </Panel>
            </Page>
        );
    }

    return (
        <Page>
            <div style={{ display: 'grid', gap: 12 }}>
                {/* Who they are and how to reach them, under a strip with their
                    photo, name and role as they are being filled in. */}
                <Panel title="Personal details" note="Who they are and how to reach them" pad={16}>
                    <div className="ef-profile" style={{ borderBottom: '1px solid ' + t.line }}>
                        <EmployeeAvatar name={form.studentName} photoPath={form.photo_path} size={56} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: form.studentName ? t.text : t.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {form.studentName || (isEdit ? 'Employee' : 'New employee')}
                            </div>
                            <div style={{ fontSize: 12.5, color: t.faint, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {[form.role, form.department, TYPES.find((x) => x.id === form.offerType)?.label].filter(Boolean).join(' · ')}
                            </div>
                            {photoError && <div style={{ fontSize: 11.5, color: t.down, marginTop: 4 }}>{photoError}</div>}
                        </div>
                        <Btn onClick={() => photoInput.current?.click()} disabled={photoBusy}>
                            <Camera size={14} aria-hidden="true" />
                            {photoBusy ? 'Uploading…' : form.photo_path ? 'Change photo' : 'Add photo'}
                        </Btn>
                        <input ref={photoInput} type="file" accept="image/*" onChange={onPhoto} style={{ display: 'none' }} />
                    </div>
                    <div className="ef-grid">
                        <Field required label="Full name"><Input value={form.studentName} onChange={set('studentName')} /></Field>
                        <Field label="Email">
                            <Input type="email" value={form.email} onChange={set('email')} />
                        </Field>
                        <Field label="Phone"><Input value={form.phone} onChange={set('phone')} /></Field>
                        <Field label="Employee ID">
                            <Input value={form.employee_code || ''} onChange={set('employee_code')} disabled={!canSetId}
                                placeholder={isEdit ? '' : canSetId ? 'Leave blank to generate' : 'Generated when added'} aria-label="Employee ID" />
                        </Field>
                        <Field label="Work location">
                            <Input value={form.location || ''} onChange={set('location')} placeholder="City, office or Remote" />
                        </Field>
                        <div className="ef-span-3">
                            <Field label="Address">
                                <Input value={form.studentAddress} onChange={set('studentAddress')} />
                            </Field>
                        </div>
                    </div>
                </Panel>

                {/* Their role, and when they joined (start_date: what tenure,
                    new hires and attendance all count from). */}
                <Panel title="Job" note="Their role and when they joined" pad={16}>
                    <Field label="Employment type">
                        <Seg value={form.offerType} onChange={set('offerType')} options={TYPES} />
                    </Field>
                    <div style={{ height: 14 }} />
                    <div className="ef-grid">
                        <Field required={!isEdit} label="Job title"><Input value={form.role} onChange={set('role')} /></Field>
                        <Field label="Department">
                            <div style={{ display: 'flex', gap: 6 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <Select value={form.department} onChange={setDepartment} aria-label="Department">
                                        <option value="">None</option>
                                        {deptNames.map((d) => <option key={d} value={d}>{d}</option>)}
                                        {form.department && !deptNames.includes(form.department) && (
                                            <option value={form.department}>{form.department}</option>
                                        )}
                                    </Select>
                                </div>
                                <Btn onClick={(e) => { e.preventDefault(); setShowDepts((v) => !v); }} aria-expanded={showDepts}
                                    aria-label={showDepts ? 'Close departments' : 'Add new department'}
                                    title={showDepts ? 'Close' : 'Add new department'} style={{ width: 32, padding: 0, justifyContent: 'center' }}>
                                    {showDepts ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                                </Btn>
                            </div>
                        </Field>
                        <Field label="Reports to"><Input value={form.supervisorName} onChange={set('supervisorName')} /></Field>
                        <Field required={!isEdit} label="Date of joining"><Input type="date" value={form.startDate} onChange={set('startDate')} /></Field>
                        {showDepts && (
                            <div className="ef-full" style={{ maxWidth: 360 }}>
                                <DepartmentsPanel rows={deptRows} total={people.length} orgId={activeOrg?.id}
                                    onChanged={loadDepts} active={form.department}
                                    onPick={pickDepartment}
                                    onAdded={(name) => { pickDepartment(name); setShowDepts(false); }} />
                            </div>
                        )}
                        {dated && <Field label="End date"><Input type="date" value={form.endDate} onChange={set('endDate')} /></Field>}
                        <div className="ef-full">
                            <Field label="Responsibilities">
                                <Textarea value={form.responsibilities} onChange={set('responsibilities')} />
                            </Field>
                        </div>
                    </div>
                </Panel>

                <Panel title="Pay" note="What they are paid, and how often" pad={16}>
                    <Field label="Pay">
                        <Seg value={form.isPaid ? 'paid' : 'unpaid'}
                            onChange={(v) => setForm((p) => ({ ...p, isPaid: v === 'paid' }))}
                            options={[{ id: 'paid', label: 'Paid' }, { id: 'unpaid', label: 'Unpaid' }]} />
                    </Field>
                    {form.isPaid && (
                        <>
                            <div style={{ height: 14 }} />
                            <div className="ef-grid">
                                {/* With a pay history the pay now comes from it, and changes there. */}
                                <Field label={revs.length && isAdmin ? 'Current pay' : 'Amount'}
                                    hint={revs.length && isAdmin ? (revNow ? `From ${fmtDay(revNow.effective_from)}. Change it under Pay history.` : 'Starts on the first date in Pay history.') : undefined}>
                                    {revs.length && isAdmin
                                        ? <Input value={revNow ? String(revNow.amount) : ''} readOnly aria-readonly="true" placeholder="-" />
                                        : <Input type="number" value={form.stipend} onChange={set('stipend')} placeholder="0" />}
                                </Field>
                                <Field label="Currency">
                                    <Select value={form.currency} onChange={set('currency')}>
                                        {[...new Set([baseCurrency(), 'INR', 'USD', 'EUR'])].map((c) => <option key={c} value={c}>{c}</option>)}
                                    </Select>
                                </Field>
                                <Field label="Frequency">
                                    <Select value={form.paymentFrequency} onChange={set('paymentFrequency')}>
                                        <option value="Monthly">Monthly</option>
                                        <option value="Yearly">Yearly</option>
                                        <option value="One-time">One-time</option>
                                    </Select>
                                </Field>
                            </div>

                            {/* Each change in pay and the date it took effect; it
                                runs until the next. Paying a past month uses the
                                rate it had. */}
                            {isAdmin && (
                                <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid ' + t.line }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                                        <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Pay History</span>
                                        <span style={{ fontSize: 11.5, color: t.faint }}>
                                            Each change and the date it takes effect. It applies until the next one.
                                        </span>
                                    </div>
                                    {revs.length > 0 && (
                                        <div className="ef-revs" role="table" aria-label="Pay history">
                                            <div className="ef-rev ef-rev-head" role="row" style={{ color: t.faint }}>
                                                <span role="columnheader">From</span>
                                                <span role="columnheader">Amount ({form.paymentFrequency || 'Monthly'})</span>
                                                <span role="columnheader">Note</span>
                                                <span />
                                            </div>
                                            {revs.map((r) => {
                                                const now = revNow && revNow.key === r.key;
                                                return (
                                                    <div key={r.key} className="ef-rev" role="row">
                                                        <Input type="date" value={r.effective_from} onChange={setRev(r.key, 'effective_from')} aria-label="Takes effect from" />
                                                        <Input type="number" value={r.amount} onChange={setRev(r.key, 'amount')} placeholder="0" aria-label="Amount" />
                                                        <Input value={r.note} onChange={setRev(r.key, 'note')} placeholder="Joined, appraisal, revised…" aria-label="Note" />
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                                                            {now && <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 999, background: t.accentSoft, color: t.accent, whiteSpace: 'nowrap' }}>Now</span>}
                                                            <Btn aria-label="Remove this pay change" title="Remove" onClick={() => removeRev(r.key)}
                                                                style={{ width: 32, padding: 0 }}>
                                                                <Trash2 size={14} aria-hidden="true" />
                                                            </Btn>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {revError && <div style={{ fontSize: 12, color: t.down, marginTop: 8 }}>{revError}</div>}
                                    <div style={{ marginTop: revs.length ? 10 : 0 }}>
                                        <Btn onClick={addRev}><Plus size={14} aria-hidden="true" /> Add pay change</Btn>
                                        {!revs.length && (
                                            <span style={{ fontSize: 11.5, color: t.faint, marginLeft: 10 }}>
                                                Without one, the amount above is saved as their pay from the date of joining.
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </Panel>

                {canAssign && <EmployeeProjectPicker employeeId={form.id} pending={newProjects} onChange={setNewProjects}
                    edits={projectEdits} onEdits={canEditProjects ? setProjectEdits : undefined}
                    defaultDate={!isEdit && form.startDate > new Date().toISOString().slice(0, 10) ? form.startDate : undefined} />}
            </div>

            {/* Save and Cancel sit under the form, frozen to the foot of the
                screen while it scrolls. The band around the bar runs down over
                the page's own 20px bottom gutter in the page's colour, so no
                field ever shows through beneath it. */}
            <div style={{
                position: 'sticky', bottom: -20, zIndex: 20, marginTop: 14, marginBottom: -20,
                padding: '10px 0 20px', background: t.panel,
            }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: 10,
                background: t.card, border: '1px solid ' + t.lineStrong, borderRadius: 12,
            }}>
                <span style={{ fontSize: 13.5, color: t.text, flex: 1, minWidth: 0 }}>
                    {isEdit ? 'Editing ' + (form.studentName || 'employee') : 'New employee'}
                    {!ready && <span style={{ color: t.faint, fontSize: 12 }}> · still needed: {missing.join(', ')}</span>}
                </span>
                <Row gap={8}>
                    <Btn onClick={leave}>Cancel</Btn>
                    <Btn primary onClick={submit} disabled={saving || !ready}>
                        {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add to the team'}
                    </Btn>
                </Row>
            </div>
            </div>
        </Page>
    );
}
